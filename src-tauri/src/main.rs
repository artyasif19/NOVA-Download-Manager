// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod db;
mod video;
mod host_setup;
mod dialogs;
mod net_config;
mod torrent;

use std::sync::Arc;
use std::path::PathBuf;
use tauri::{State, Manager};
use engine::{DownloadEngine, DownloadRequest, ProbeInfo};
use db::{Database, DownloadRecord};
use tauri::Emitter;
use torrent::{TorrentManager, TorrentRequest};
use video::{VideoManager, VideoRequest};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct AppState {
    pub engine: Arc<DownloadEngine>,
    pub db: Arc<Database>,
    pub video: Arc<VideoManager>,
    pub torrent: TorrentManager,
}

/// Close button hides NOVA to the tray (downloads keep running) instead of quitting
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);
/// Magnet link / .torrent file NOVA was started with (read once by the UI)
static INITIAL_LINK: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

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
async fn start_video_download(
    request: VideoRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>
) -> Result<String, String> {
    state.video.start(app, request)
}

#[tauri::command]
async fn start_torrent(
    request: TorrentRequest,
    app: tauri::AppHandle,
    state: State<'_, AppState>
) -> Result<String, String> {
    state.torrent.start(app, request)
}

#[derive(serde::Deserialize)]
struct QueueRequest {
    id: String,
    url: String,
    filename: String,
    directory: String,
    category: String,
    protocol: String,
    #[serde(default)]
    total_bytes: u64,
    #[serde(default)]
    segments_count: Option<usize>,
    #[serde(default)]
    quality: Option<String>,
}

/// "Download later": stores the download as queued; the queue worker starts it when a slot is free
#[tauri::command]
async fn queue_download(
    request: QueueRequest,
    state: State<'_, AppState>
) -> Result<String, String> {
    let rec = DownloadRecord {
        id: request.id.clone(),
        url: request.url,
        filename: request.filename,
        directory: request.directory,
        total_bytes: request.total_bytes,
        downloaded_bytes: 0,
        status: "queued".to_string(),
        category: request.category,
        protocol: request.protocol,
        supports_range: true,
        etag: None,
        mime_type: request.quality,
        date_added: chrono::Utc::now().timestamp_millis(),
        date_finished: None,
        sha256_expected: None,
        sha256_calculated: None,
        segments_count: request.segments_count.unwrap_or(8).max(1),
        priority: "normal".to_string(),
        error_message: None,
    };
    state.db.insert_download(&rec).map_err(|e| e.to_string())?;
    Ok(request.id)
}

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn take_initial_link() -> Option<String> {
    INITIAL_LINK.lock().ok().and_then(|mut g| g.take())
}

/// What to do when every download has finished: exit | sleep | shutdown
#[tauri::command]
fn power_action(action: String, app: tauri::AppHandle) -> Result<(), String> {
    use std::process::Command;
    match action.as_str() {
        "exit" => {
            app.exit(0);
            Ok(())
        }
        "sleep" => {
            let mut cmd = Command::new("rundll32.exe");
            cmd.args(["powrprof.dll,SetSuspendState", "0,1,0"]);
            host_setup::hide_window(&mut cmd);
            cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
        }
        "shutdown" => {
            let mut cmd = Command::new("shutdown");
            cmd.args(["/s", "/t", "20", "/c", "NOVA Download Manager: all downloads finished"]);
            host_setup::hide_window(&mut cmd);
            cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
        }
        _ => Err("Unknown action".to_string()),
    }
}

/// Cancels a pending Windows shutdown started by power_action
#[tauri::command]
fn cancel_shutdown() {
    let mut cmd = std::process::Command::new("shutdown");
    cmd.arg("/a");
    host_setup::hide_window(&mut cmd);
    let _ = cmd.output();
}

#[tauri::command]
async fn pause_download(
    id: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    if state.video.is_video(&id) {
        state.video.pause(&id);
        return Ok(());
    }
    if state.torrent.is_torrent(&id) {
        state.torrent.pause(&id);
        return Ok(());
    }
    state.engine.pause_download(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn resume_download(
    id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>
) -> Result<(), String> {
    if state.video.is_video(&id) {
        return state.video.resume(app, &id);
    }
    if state.torrent.is_torrent(&id) {
        return state.torrent.resume(app, &id);
    }
    state.engine.resume_download(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_download(
    id: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    if state.video.is_video(&id) {
        state.video.cancel(&id);
        return Ok(());
    }
    if state.torrent.is_torrent(&id) {
        state.torrent.cancel(&id);
        return Ok(());
    }
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
    if state.video.is_video(&id) {
        state.video.cancel(&id);
    }
    if state.torrent.is_torrent(&id) {
        state.torrent.cancel(&id);
    }
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
fn start_local_ipc_service(engine: Arc<DownloadEngine>, db: Arc<Database>, video: Arc<VideoManager>) {
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
    let session_file_clone = session_file.clone();
    let session_dir_clone = session_dir.clone();
    tauri::async_runtime::spawn(async move {
        use tokio::net::TcpListener;
        use tokio::io::AsyncWriteExt;

        // Try 9654 first, then the next ports (Windows can reserve ports, or another program may use one)
        let mut bound: Option<(TcpListener, u16)> = None;
        let mut last_err = String::new();
        for candidate in 9654u16..=9674u16 {
            match TcpListener::bind(("127.0.0.1", candidate)).await {
                Ok(l) => {
                    bound = Some((l, candidate));
                    break;
                }
                Err(e) => last_err = format!("port {}: {}", candidate, e),
            }
        }
        let (listener, port) = match bound {
            Some(v) => v,
            None => {
                let _ = std::fs::write(
                    session_dir_clone.join("ipc.log"),
                    format!("NOVA could not open a local port for the browser extension. Last error: {}\n", last_err),
                );
                return;
            }
        };

        // Publish the port that is really in use
        let session_data = serde_json::json!({
            "port": port,
            "token": token_clone,
            "pid": std::process::id()
        });
        if let Ok(content) = serde_json::to_string_pretty(&session_data) {
            let _ = std::fs::write(&session_file_clone, content);
        }

        while let Ok((mut socket, _)) = listener.accept().await {
            let eng = Arc::clone(&engine);
            let database = Arc::clone(&db);
            let video_mgr = Arc::clone(&video);
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

                // Requests made by the NOVA browser extension itself (its Origin header cannot be
                // forged by web pages) may talk to the engine without the token. Every download
                // they start still needs the user's confirmation inside NOVA.
                let origin_ok = headers_str.lines().any(|l| {
                    let l = l.trim().to_lowercase();
                    l.starts_with("origin:")
                        && (l.contains("chrome-extension://pmkbechehklelnopohiefbcafghkjjil")
                            || l.contains("moz-extension://"))
                });

                if method_line.starts_with("OPTIONS ") {
                    let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nContent-Length: 0\r\n\r\n";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                // Verify Bearer token
                let auth_header = format!("Authorization: Bearer {}", expected_token);
                if !origin_ok && !headers_str.contains(&auth_header) {
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
                            let wants_video = (url_str.starts_with("http:") || url_str.starts_with("https:"))
                                && (val.get("video").and_then(|v| v.as_bool()).unwrap_or(false)
                                    || video::is_video_page_url(url_str));

                            if url_str.starts_with("magnet:") {
                                // Magnet link clicked in the browser: open the torrent pop-up
                                match video_mgr.app_handle() {
                                    Some(app) => {
                                        let payload = serde_json::json!({ "url": url_str, "torrent": true });
                                        if dialogs::open(&app, "confirm", &payload).is_err() {
                                            host_setup::bring_to_front(&app);
                                            let _ = app.emit("open-link", serde_json::json!({ "url": url_str }));
                                        }
                                        (true, serde_json::json!({
                                            "status": "accepted",
                                            "accepted": true,
                                            "confirm": true,
                                            "torrent": true
                                        }).to_string())
                                    }
                                    None => (false, serde_json::json!({
                                        "status": "rejected",
                                        "accepted": false,
                                        "reason": "NOVA is still starting, please try again in a moment"
                                    }).to_string()),
                                }
                            } else if wants_video {
                                let quality = val.get("quality").and_then(|q| q.as_str()).unwrap_or("best");
                                match video_mgr.app_handle() {
                                    Some(app) => {
                                        let payload = serde_json::json!({
                                            "url": url_str,
                                            "video": true,
                                            "quality": quality
                                        });
                                        if dialogs::open(&app, "confirm", &payload).is_err() {
                                            // pop-up could not open: fall back to the main window
                                            host_setup::bring_to_front(&app);
                                            let _ = app.emit("extension-video-request", serde_json::json!({
                                                "url": url_str,
                                                "quality": quality
                                            }));
                                        }
                                        (true, serde_json::json!({
                                            "status": "accepted",
                                            "accepted": true,
                                            "confirm": true,
                                            "video": true
                                        }).to_string())
                                    }
                                    None => (false, serde_json::json!({
                                        "status": "rejected",
                                        "accepted": false,
                                        "reason": "NOVA is still starting, please try again in a moment"
                                    }).to_string()),
                                }
                            } else if is_proto_valid {
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
                                } else if !val.get("direct").and_then(|d| d.as_bool()).unwrap_or(false) {
                                    // Ask the user first (IDM-style "Download File Info" dialog)
                                    match video_mgr.app_handle() {
                                        Some(app) => {
                                            let payload = serde_json::json!({
                                                "url": url_str,
                                                "filename": val.get("filename").and_then(|f| f.as_str()).unwrap_or(""),
                                                "totalBytes": val.get("total_bytes").or_else(|| val.get("totalBytes")).and_then(|t| t.as_u64()).unwrap_or(0),
                                                "mimeType": val.get("mime_type").or_else(|| val.get("mimeType")).and_then(|m| m.as_str()).unwrap_or(""),
                                                "referrer": val.get("referrer").and_then(|r| r.as_str()).unwrap_or("")
                                            });
                                            if dialogs::open(&app, "confirm", &payload).is_err() {
                                                host_setup::bring_to_front(&app);
                                                let _ = app.emit("extension-download-request", payload.clone());
                                            }
                                            (true, serde_json::json!({
                                                "status": "accepted",
                                                "accepted": true,
                                                "confirm": true
                                            }).to_string())
                                        }
                                        None => (false, serde_json::json!({
                                            "status": "rejected",
                                            "accepted": false,
                                            "reason": "NOVA is still starting, please try again in a moment"
                                        }).to_string()),
                                    }
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
                } else if method_line.starts_with("POST /api/open_link") {
                    // A second NOVA launch (or the magnet: handler) passes its link to this instance
                    let link = serde_json::from_slice::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()));
                    let ok = match (link, video_mgr.app_handle()) {
                        (Some(l), Some(app)) => {
                            host_setup::bring_to_front(&app);
                            if l != "nova://show" {
                                let _ = app.emit("open-link", serde_json::json!({ "url": l }));
                            }
                            true
                        }
                        _ => false,
                    };
                    let (code, payload) = if ok {
                        ("200 OK", "{\"ok\":true}")
                    } else {
                        ("400 Bad Request", "{\"ok\":false}")
                    };
                    let resp = format!(
                        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        code, payload.len(), payload
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                } else if method_line.starts_with("POST /api/video_info") {
                    let link = serde_json::from_slice::<serde_json::Value>(&body)
                        .ok()
                        .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(|s| s.to_string()));
                    let (code, payload) = match (link, video_mgr.app_handle()) {
                        (Some(u), Some(app)) => match video::probe_video_inner(&app, u).await {
                            Ok(info) => ("200 OK", serde_json::to_string(&info).unwrap_or_else(|_| "{}".to_string())),
                            Err(e) => ("422 Unprocessable Entity", serde_json::json!({ "error": e }).to_string()),
                        },
                        _ => ("400 Bad Request", serde_json::json!({ "error": "Missing link, or NOVA is still starting" }).to_string()),
                    };
                    let resp = format!(
                        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                        code, payload.len(), payload
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
fn start_persistent_queue_worker(
    engine: Arc<DownloadEngine>,
    db: Arc<Database>,
    video: Arc<VideoManager>,
    torrent: TorrentManager,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            if let Ok(active) = db.get_active_downloads_count() {
                let max_concurrent = net_config::max_concurrent();
                if active < max_concurrent {
                    let needed = max_concurrent - active;
                    if let Ok(queued) = db.claim_next_queued_downloads(needed) {
                        for q in queued {
                            // Video-site and torrent downloads have their own engines
                            if q.protocol == "video" {
                                if let Some(app) = video.app_handle() {
                                    let _ = video.resume(app, &q.id);
                                }
                                continue;
                            }
                            if q.protocol == "torrent" {
                                if let Some(app) = video.app_handle() {
                                    let _ = torrent.resume(app, &q.id);
                                }
                                continue;
                            }
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

    // Magnet link / .torrent given on the command line (or a second launch of NOVA):
    // hand it to the running NOVA and stop, otherwise keep it for this instance.
    let link_arg = std::env::args()
        .skip(1)
        .find(|a| a.starts_with("magnet:") || a.to_lowercase().ends_with(".torrent"));
    let forward = link_arg.clone().unwrap_or_else(|| "nova://show".to_string());
    if host_setup::forward_link_to_running_instance(&forward) {
        return;
    }
    if let Some(link) = link_arg {
        if let Ok(mut g) = INITIAL_LINK.lock() {
            *g = Some(link);
        }
    }

    let db = Arc::new(Database::init().expect("Failed to initialize SQLite database"));
    let engine = Arc::new(DownloadEngine::new(Arc::clone(&db)));

    let video = Arc::new(VideoManager::new(Arc::clone(&db)));
    let torrent = TorrentManager::new(Arc::clone(&db));

    // Launch secure local IPC bridge for native messaging host
    start_local_ipc_service(Arc::clone(&engine), Arc::clone(&db), Arc::clone(&video));

    // Launch background persistent queue worker
    start_persistent_queue_worker(Arc::clone(&engine), Arc::clone(&db), Arc::clone(&video), torrent.clone());

    let video_setup = Arc::clone(&video);
    let engine_setup = Arc::clone(&engine);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && CLOSE_TO_TRAY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(move |app| {
            engine_setup.set_app_handle(app.handle().clone());
            video_setup.set_app_handle(app.handle().clone());

            // Register the browser helper + extensions (no manual steps needed)
            let setup_handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = host_setup::ensure_native_host(&setup_handle) {
                    eprintln!("[NOVA] Browser helper setup: {}", e);
                }
            });

            // System tray icon: left click opens NOVA, menu has Open / Exit
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                let show_item = MenuItem::with_id(app, "show", "Open NOVA", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Exit NOVA", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
                let mut tray = TrayIconBuilder::new()
                    .tooltip("NOVA Download Manager")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => host_setup::bring_to_front(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            host_setup::bring_to_front(tray.app_handle());
                        }
                    });
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                let _ = tray.build(app)?;
            }

            // Started by Windows at login: stay out of the way
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = tauri::Manager::get_webview_window(app, "main") {
                    let _ = w.minimize();
                }
            }
            Ok(())
        })
        .manage(AppState { engine, db, video, torrent })
        .invoke_handler(tauri::generate_handler![
            probe_target_url,
            start_download,
            start_video_download,
            start_torrent,
            queue_download,
            set_close_to_tray,
            take_initial_link,
            power_action,
            cancel_shutdown,
            torrent::check_torrent_file,
            torrent::torrent_overview,
            torrent::torrent_details,
            torrent::torrent_set_options,
            torrent::torrent_delete,
            torrent::set_torrent_settings,
            dialogs::open_dialog,
            host_setup::open_file,
            host_setup::reveal_file,
            net_config::set_network_config,
            net_config::set_max_concurrent,
            video::probe_video,
            host_setup::get_extension_info,
            host_setup::open_folder,
            host_setup::open_browser_extensions,
            host_setup::set_autostart,
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
