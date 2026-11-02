// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod db;

use std::sync::Arc;
use std::path::PathBuf;
use tauri::{State, Manager};
use engine::{DownloadEngine, DownloadRequest, ProbeInfo};
use db::{Database, DownloadRecord};

pub struct AppState {
    pub engine: Arc<DownloadEngine>,
    pub db: Arc<Database>,
}

#[tauri::command]
async fn probe_target_url(
    url: String,
    state: State<'_, AppState>
) -> Result<ProbeInfo, String> {
    state.engine.probe_url(&url).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_download(
    request: DownloadRequest,
    state: State<'_, AppState>
) -> Result<String, String> {
    let id = request.id.clone();
    state.engine.start_download(request).await.map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
async fn pause_download(
    id: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    state.engine.pause_download(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn resume_download(
    id: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    state.engine.resume_download(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_download(
    id: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    state.engine.cancel_download(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_download_item(
    id: String,
    state: State<'_, AppState>
) -> Result<Option<DownloadRecord>, String> {
    state.db.get_download(&id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_all_downloads(
    state: State<'_, AppState>
) -> Result<Vec<DownloadRecord>, String> {
    state.db.get_all_downloads().map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_download_item(
    id: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    state.db.delete_download(&id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn verify_file_checksum(
    file_path: String,
    expected_sha256: String
) -> Result<bool, String> {
    engine::verify_checksum(&file_path, &expected_sha256).await.map_err(|e| e.to_string())
}

/// Helper to get user-configurable, safe destination directory
fn get_safe_download_directory() -> PathBuf {
    let dir = if let Ok(user_profile) = std::env::var("USERPROFILE") {
        PathBuf::from(user_profile).join("Downloads").join("NOVA")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join("Downloads").join("NOVA")
    } else {
        std::env::temp_dir().join("NOVA_Downloads")
    };
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Reads a complete HTTP request by parsing headers and reading exact Content-Length.
/// Handles oversized requests, malformed formatting, and partial TCP reads safely.
async fn read_full_http_request<T: tokio::io::AsyncRead + Unpin>(
    socket: &mut T
) -> Result<(String, String, Vec<u8>), (u16, &'static str)> {
    use tokio::io::AsyncReadExt;
    const MAX_HEADER_SIZE: usize = 65536; // 64 KB header limit
    const MAX_BODY_SIZE: usize = 10 * 1024 * 1024; // 10 MB body limit

    let mut buf = Vec::with_capacity(4096);
    let mut temp = [0u8; 4096];

    let mut header_end = None;
    loop {
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end = Some(pos);
            break;
        }
        if buf.len() >= MAX_HEADER_SIZE {
            return Err((431, "Request Header Fields Too Large"));
        }
        let n = socket.read(&mut temp).await.map_err(|_| (400, "Socket read error"))?;
        if n == 0 {
            if buf.is_empty() {
                return Err((400, "Connection closed"));
            }
            break;
        }
        buf.extend_from_slice(&temp[..n]);
    }

    let end_idx = match header_end {
        Some(idx) => idx,
        None => return Err((400, "Malformed HTTP request: missing header termination")),
    };

    let header_bytes = &buf[..end_idx];
    let headers_str = String::from_utf8_lossy(header_bytes).to_string();

    let mut lines = headers_str.lines();
    let method_line = lines.next().unwrap_or("").to_string();

    // Parse Content-Length header
    let mut content_length = 0usize;
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("Content-Length") {
                if let Ok(cl) = v.trim().parse::<usize>() {
                    content_length = cl;
                }
            }
        }
    }

    if content_length > MAX_BODY_SIZE {
        return Err((413, "Payload Too Large"));
    }

    let body_start = end_idx + 4;
    let mut body = if buf.len() > body_start {
        buf[body_start..].to_vec()
    } else {
        Vec::new()
    };

    while body.len() < content_length {
        let needed = content_length - body.len();
        let to_read = needed.min(temp.len());
        let n = socket.read(&mut temp[..to_read]).await.map_err(|_| (400, "Socket read error during body"))?;
        if n == 0 {
            return Err((400, "Unexpected EOF while reading request body"));
        }
        body.extend_from_slice(&temp[..n]);
    }

    Ok((method_line, headers_str, body))
}

/// Start authenticated local IPC bridge for native messaging host communication
fn start_local_ipc_service(engine: Arc<DownloadEngine>, db: Arc<Database>) {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let auth_token: String = (0..32).map(|_| format!("{:02x}", rng.gen::<u8>())).collect();
    let port = 9654u16;

    // Write session.auth file to %LOCALAPPDATA%\NOVA\session.auth
    let session_dir = if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local_app_data).join("NOVA")
    } else {
        std::env::temp_dir()
    };

    let _ = std::fs::create_dir_all(&session_dir);
    let session_file = session_dir.join("session.auth");

    let session_data = serde_json::json!({
        "port": port,
        "token": auth_token,
        "pid": std::process::id()
    });

    if let Ok(content) = serde_json::to_string_pretty(&session_data) {
        let _ = std::fs::write(&session_file, content);
    }

    let token_clone = auth_token.clone();
    tauri::async_runtime::spawn(async move {
        use tokio::net::TcpListener;
        use tokio::io::AsyncWriteExt;

        let listener = match TcpListener::bind(format!("127.0.0.1:{}", port)).await {
            Ok(l) => l,
            Err(_) => return,
        };

        while let Ok((mut socket, _)) = listener.accept().await {
            let eng = Arc::clone(&engine);
            let database = Arc::clone(&db);
            let expected_token = token_clone.clone();

            tokio::spawn(async move {
                let (method_line, headers_str, body) = match read_full_http_request(&mut socket).await {
                    Ok(req) => req,
                    Err((status_code, err_msg)) => {
                        let err_resp = format!(
                            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{{\"error\":\"{}\"}}",
                            status_code, err_msg, err_msg.len() + 11, err_msg
                        );
                        let _ = socket.write_all(err_resp.as_bytes()).await;
                        return;
                    }
                };

                // Verify Bearer token
                let auth_header = format!("Authorization: Bearer {}", expected_token);
                if !headers_str.contains(&auth_header) {
                    let resp = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 26\r\n\r\n{\"error\":\"Unauthorized\"}";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                // Full-featured authenticated IPC router
                if method_line.starts_with("POST /api/can_handle") {
                    let (is_accepted, resp_body) = if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                        if let Some(url_str) = val.get("url").and_then(|u| u.as_str()) {
                            let is_proto_valid = url_str.starts_with("http:") || url_str.starts_with("https:") ||
                                url_str.starts_with("ftp:") || url_str.starts_with("ftps:") ||
                                url_str.starts_with("sftp:");

                            if is_proto_valid {
                                if let Ok(Some(existing)) = database.find_active_or_queued_by_url(url_str) {
                                    let fname = existing.filename.clone();
                                    let dl_id = existing.id.clone();
                                    (true, serde_json::json!({
                                        "status": "accepted",
                                        "accepted": true,
                                        "download_id": dl_id,
                                        "filename": fname,
                                        "durable": true,
                                        "duplicate_prevented": true
                                    }).to_string())
                                } else {
                                    let raw_fname = val.get("filename")
                                        .and_then(|f| f.as_str())
                                        .unwrap_or("download.dat");
                                    let dest_dir = get_safe_download_directory();
                                    let target_file_path = engine::resolve_non_colliding_path(&dest_dir, raw_fname);
                                    let fname = target_file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                                    let dl_id = format!("dl-ext-{}", chrono::Utc::now().timestamp_millis());
                                    let total_hint = val.get("totalBytes").and_then(|t| t.as_u64()).unwrap_or(0);
                                    let mime = val.get("mimeType").and_then(|m| m.as_str()).map(|s| s.to_string());

                                    let rec = DownloadRecord {
                                        id: dl_id.clone(),
                                        url: url_str.to_string(),
                                        filename: fname.clone(),
                                        directory: dest_dir.to_string_lossy().to_string(),
                                        total_bytes: total_hint,
                                        downloaded_bytes: 0,
                                        status: "queued".to_string(),
                                        category: "documents".to_string(),
                                        protocol: if url_str.starts_with("ftp") { "ftp".to_string() } else if url_str.starts_with("sftp") { "sftp".to_string() } else { "http".to_string() },
                                        supports_range: true,
                                        etag: None,
                                        mime_type: mime,
                                        date_added: chrono::Utc::now().timestamp_millis(),
                                        date_finished: None,
                                        sha256_expected: None,
                                        sha256_calculated: None,
                                        segments_count: 8,
                                        priority: "normal".to_string(),
                                        error_message: None,
                                    };

                                    // 1. Durably insert to SQLite database
                                    match database.insert_download(&rec) {
                                        Ok(_) => {
                                            // Atomically claim the queued download before starting task
                                            let _ = database.claim_queued_download(&dl_id);

                                            // 2. Real download engine accepts responsibility and spawns task
                                            let download_req = engine::DownloadRequest {
                                                id: dl_id.clone(),
                                                url: url_str.to_string(),
                                                destination_path: target_file_path.to_string_lossy().to_string(),
                                                total_bytes: total_hint,
                                                segments_count: 8,
                                                expected_sha256: None,
                                                headers: None,
                                                cookies: None,
                                                username: None,
                                                password: None,
                                            };

                                            match eng.start_download(download_req).await {
                                                Ok(_) => {
                                                    (true, serde_json::json!({
                                                        "status": "accepted",
                                                        "accepted": true,
                                                        "download_id": dl_id,
                                                        "filename": fname,
                                                        "durable": true
                                                    }).to_string())
                                                },
                                                Err(e) => {
                                                    // Real engine rejected the task: rollback SQLite entry
                                                    // and return rejected so browser does NOT cancel download!
                                                    let _ = database.delete_download(&dl_id);
                                                    (false, serde_json::json!({
                                                        "status": "rejected",
                                                        "accepted": false,
                                                        "reason": format!("Engine task acceptance failed: {}", e)
                                                    }).to_string())
                                                }
                                            }
                                        },
                                        Err(e) => {
                                            (false, serde_json::json!({
                                                "status": "rejected",
                                                "accepted": false,
                                                "reason": format!("Database error: {}", e)
                                            }).to_string())
                                        }
                                    }
                                }
                             } else {
                                (false, serde_json::json!({
                                    "status": "rejected",
                                    "accepted": false,
                                    "reason": "Unsupported protocol"
                                }).to_string())
                            }
                        } else {
                            (false, serde_json::json!({
                                "status": "rejected",
                                "accepted": false,
                                "reason": "Missing url field"
                            }).to_string())
                        }
                    } else {
                        (false, serde_json::json!({
                            "status": "rejected",
                            "accepted": false,
                            "reason": "Malformed JSON payload"
                        }).to_string())
                    };

                    let status_line = if is_accepted { "HTTP/1.1 200 OK" } else { "HTTP/1.1 400 Bad Request" };
                    let resp = format!(
                        "{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        status_line, resp_body.len(), resp_body
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                } else if method_line.starts_with("POST /api/downloads") {
                    if let Ok(req_val) = serde_json::from_slice::<DownloadRequest>(&body) {
                        let dl_id = req_val.id.clone();
                        match eng.start_download(req_val).await {
                            Ok(_) => {
                                let json_resp = serde_json::json!({ "status": "started", "id": dl_id }).to_string();
                                let resp = format!("HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", json_resp.len(), json_resp);
                                let _ = socket.write_all(resp.as_bytes()).await;
                            },
                            Err(e) => {
                                let json_resp = serde_json::json!({ "error": e }).to_string();
                                let resp = format!("HTTP/1.1 500 Internal Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", json_resp.len(), json_resp);
                                let _ = socket.write_all(resp.as_bytes()).await;
                            }
                        }
                    }
                } else if method_line.starts_with("GET /api/downloads") {
                    let all_dl = database.get_all_downloads().unwrap_or_default();
                    let json_resp = serde_json::to_string(&all_dl).unwrap_or_else(|_| "[]".to_string());
                    let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", json_resp.len(), json_resp);
                    let _ = socket.write_all(resp.as_bytes()).await;
                } else if method_line.starts_with("POST /api/pause_download") || method_line.starts_with("POST /api/downloads/pause") {
                    if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                        if let Some(id_str) = val.get("download_id").or_else(|| val.get("id")).and_then(|v| v.as_str()) {
                            let _ = eng.pause_download(id_str).await;
                            let json_resp = serde_json::json!({ "status": "paused", "id": id_str }).to_string();
                            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", json_resp.len(), json_resp);
                            let _ = socket.write_all(resp.as_bytes()).await;
                        }
                    }
                } else if method_line.starts_with("POST /api/resume_download") || method_line.starts_with("POST /api/downloads/resume") {
                    if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                        if let Some(id_str) = val.get("download_id").or_else(|| val.get("id")).and_then(|v| v.as_str()) {
                            let _ = eng.resume_download(id_str).await;
                            let json_resp = serde_json::json!({ "status": "resumed", "id": id_str }).to_string();
                            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", json_resp.len(), json_resp);
                            let _ = socket.write_all(resp.as_bytes()).await;
                        }
                    }
                } else if method_line.starts_with("POST /api/cancel_download") || method_line.starts_with("POST /api/downloads/cancel") {
                    if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                        if let Some(id_str) = val.get("download_id").or_else(|| val.get("id")).and_then(|v| v.as_str()) {
                            let _ = eng.cancel_download(id_str).await;
                            let json_resp = serde_json::json!({ "status": "cancelled", "id": id_str }).to_string();
                            let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", json_resp.len(), json_resp);
                            let _ = socket.write_all(resp.as_bytes()).await;
                        }
                    }
                } else if method_line.starts_with("POST /api/probe") {
                    if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&body) {
                        if let Some(url_str) = val.get("url").and_then(|v| v.as_str()) {
                            match eng.probe_url(url_str).await {
                                Ok(probe) => {
                                    let json_resp = serde_json::to_string(&probe).unwrap();
                                    let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", json_resp.len(), json_resp);
                                    let _ = socket.write_all(resp.as_bytes()).await;
                                },
                                Err(e) => {
                                    let json_resp = serde_json::json!({ "error": e }).to_string();
                                    let resp = format!("HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", json_resp.len(), json_resp);
                                    let _ = socket.write_all(resp.as_bytes()).await;
                                }
                            }
                        }
                    }
                } else if method_line.starts_with("POST /api/ping") || method_line.starts_with("GET /api/ping") || method_line.starts_with("GET /api/status") {
                    let active = database.get_active_downloads_count().unwrap_or(0);
                    let json_resp = serde_json::json!({
                        "status": "online",
                        "version": "2.4.0",
                        "engine": "Tauri 2 Native Core",
                        "active_downloads": active,
                        "authenticated": true
                    }).to_string();

                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        json_resp.len(), json_resp
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                }
            });
        }
    });
}

/// Persistent Queue Worker: monitors SQLite for queued downloads and resumes them
fn start_persistent_queue_worker(engine: Arc<DownloadEngine>, db: Arc<Database>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            if let Ok(active) = db.get_active_downloads_count() {
                const MAX_CONCURRENT: usize = 3;
                if active < MAX_CONCURRENT {
                    let needed = MAX_CONCURRENT - active;
                    if let Ok(queued) = db.claim_next_queued_downloads(needed) {
                        for q in queued {
                            let dest_path = PathBuf::from(&q.directory).join(&q.filename);
                            let req = engine::DownloadRequest {
                                id: q.id.clone(),
                                url: q.url.clone(),
                                destination_path: dest_path.to_string_lossy().to_string(),
                                total_bytes: q.total_bytes,
                                segments_count: q.segments_count.max(1),
                                expected_sha256: q.sha256_expected.clone(),
                                headers: None,
                                cookies: None,
                                username: None,
                                password: None,
                            };
                            let _ = engine.start_download(req).await;
                        }
                    }
                }
            }
        }
    });
}

fn main() {
    // Write panics to %LOCALAPPDATA%\NOVA\crash.log (release builds have no console).
    std::panic::set_hook(Box::new(|info| {
        let dir = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("NOVA");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("crash.log"), format!("{}\n", info));
    }));

    let db = Arc::new(Database::init().expect("Failed to initialize SQLite database"));
    let engine = Arc::new(DownloadEngine::new(Arc::clone(&db)));

    // Launch secure local IPC bridge for native messaging host
    start_local_ipc_service(Arc::clone(&engine), Arc::clone(&db));

    // Launch background persistent queue worker
    start_persistent_queue_worker(Arc::clone(&engine), Arc::clone(&db));

    let engine_setup = Arc::clone(&engine);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            engine_setup.set_app_handle(app.handle().clone());
            Ok(())
        })
        .manage(AppState { engine, db })
        .invoke_handler(tauri::generate_handler![
            probe_target_url,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            get_download_item,
            get_all_downloads,
            delete_download_item,
            verify_file_checksum
        ])
        .run(tauri::generate_context!())
        .expect("error while running NOVA Download Manager application");
}
