//! Torrent and magnet-link downloads powered by the bundled `aria2c` engine.
//! aria2 runs as a hidden background process that only listens on 127.0.0.1 (secret protected);
//! NOVA talks to it over JSON-RPC and forwards progress, speed and ETA to the normal download list.

use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::db::{Database, DownloadRecord};

#[derive(Debug, Clone, Deserialize)]
pub struct TorrentRequest {
    pub id: String,
    /// magnet link, link to a .torrent file, or the path of a .torrent file on this PC
    pub url: String,
    pub directory: String,
}

#[derive(Debug, Clone, Serialize)]
struct TorrentProgressPayload {
    id: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_bytes_sec: u64,
    eta_seconds: u64,
    filename: Option<String>,
    segments: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
struct TorrentCompletedPayload {
    id: String,
    destination_path: String,
    file_path: String,
    filename: String,
    total_bytes: u64,
    sha256_verified: bool,
}

#[derive(Debug, Clone, Serialize)]
struct TorrentErrorPayload {
    id: String,
    error: String,
}

#[derive(Debug, Clone, Serialize)]
struct TorrentStatusPayload {
    id: String,
    status: String,
}

struct Daemon {
    #[allow(dead_code)]
    child: tokio::process::Child,
    port: u16,
    secret: String,
}

struct Inner {
    db: Arc<Database>,
    daemon: tokio::sync::Mutex<Option<Daemon>>,
    jobs: Mutex<HashMap<String, oneshot::Sender<&'static str>>>,
    http: reqwest::Client,
}

#[derive(Clone)]
pub struct TorrentManager {
    inner: Arc<Inner>,
}

fn emit_status(app: &AppHandle, id: &str, status: &str) {
    let _ = app.emit(
        "download-status-changed",
        TorrentStatusPayload { id: id.to_string(), status: status.to_string() },
    );
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len() * 4 / 3 + 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        out.push(T[(b[0] >> 2) as usize] as char);
        out.push(T[(((b[0] & 3) << 4) | (b[1] >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { T[(((b[1] & 15) << 2) | (b[2] >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(b[2] & 63) as usize] as char } else { '=' });
    }
    out
}

fn num(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(|x| x.as_str()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0)
}

impl TorrentManager {
    pub fn new(db: Arc<Database>) -> Self {
        let http = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("Failed to initialize torrent RPC client");
        Self {
            inner: Arc::new(Inner {
                db,
                daemon: tokio::sync::Mutex::new(None),
                jobs: Mutex::new(HashMap::new()),
                http,
            }),
        }
    }

    pub fn is_torrent(&self, id: &str) -> bool {
        matches!(self.inner.db.get_download(id), Ok(Some(rec)) if rec.protocol == "torrent")
    }

    pub fn start(&self, app: AppHandle, req: TorrentRequest) -> Result<String, String> {
        let url = req.url.trim().to_string();
        let ok = url.starts_with("magnet:")
            || url.starts_with("http://")
            || url.starts_with("https://")
            || url.to_lowercase().ends_with(".torrent");
        if !ok {
            return Err("Paste a magnet link, a .torrent link, or choose a .torrent file".to_string());
        }
        let directory = if req.directory.trim().is_empty() {
            crate::video::default_directory()
        } else {
            req.directory.trim().to_string()
        };

        let rec = DownloadRecord {
            id: req.id.clone(),
            url: url.clone(),
            filename: "Fetching torrent info...".to_string(),
            directory: directory.clone(),
            total_bytes: 0,
            downloaded_bytes: 0,
            status: "downloading".to_string(),
            category: "custom".to_string(),
            protocol: "torrent".to_string(),
            supports_range: true,
            etag: None,
            mime_type: None,
            date_added: chrono::Utc::now().timestamp_millis(),
            date_finished: None,
            sha256_expected: None,
            sha256_calculated: None,
            segments_count: 1,
            priority: "normal".to_string(),
            error_message: None,
        };
        self.inner.db.insert_download(&rec).map_err(|e| e.to_string())?;
        self.spawn_job(app, req.id.clone(), url, directory);
        Ok(req.id)
    }

    pub fn resume(&self, app: AppHandle, id: &str) -> Result<(), String> {
        if self.inner.jobs.lock().unwrap().contains_key(id) {
            return Ok(());
        }
        let rec = self
            .inner
            .db
            .get_download(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Download not found".to_string())?;
        let _ = self.inner.db.update_download_status(id, "downloading");
        emit_status(&app, id, "downloading");
        self.spawn_job(app, id.to_string(), rec.url, rec.directory);
        Ok(())
    }

    pub fn pause(&self, id: &str) {
        self.stop(id, "paused");
    }

    pub fn cancel(&self, id: &str) {
        self.stop(id, "cancelled");
    }

    fn stop(&self, id: &str, reason: &'static str) {
        if let Some(tx) = self.inner.jobs.lock().unwrap().remove(id) {
            let _ = tx.send(reason);
        }
    }

    fn spawn_job(&self, app: AppHandle, id: String, url: String, directory: String) {
        let (kill_tx, kill_rx) = oneshot::channel::<&'static str>();
        self.inner.jobs.lock().unwrap().insert(id.clone(), kill_tx);
        let mgr = self.clone();
        tauri::async_runtime::spawn(async move {
            mgr.run_job(app, id.clone(), url, directory, kill_rx).await;
            mgr.inner.jobs.lock().unwrap().remove(&id);
        });
    }

    // ---------------------------------------------------------------- aria2 daemon

    async fn ensure_daemon(&self, app: &AppHandle) -> Result<(u16, String), String> {
        let mut guard = self.inner.daemon.lock().await;
        let alive = match guard.as_mut() {
            Some(d) => matches!(d.child.try_wait(), Ok(None)).then(|| (d.port, d.secret.clone())),
            None => None,
        };
        if let Some(v) = alive {
            return Ok(v);
        }
        *guard = None;

        let exe = crate::host_setup::find_resource_file(app, "aria2c.exe")
            .ok_or_else(|| "Torrent component (aria2c.exe) was not found. Please reinstall NOVA.".to_string())?;

        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
            l.local_addr().map_err(|e| e.to_string())?.port()
        };
        let secret: String = {
            use rand::Rng;
            let mut rng = rand::thread_rng();
            (0..24).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
        };

        let mut cmd = tokio::process::Command::new(&exe);
        cmd.arg("--enable-rpc")
            .arg(format!("--rpc-listen-port={}", port))
            .arg(format!("--rpc-secret={}", secret))
            .arg("--rpc-listen-all=false")
            .arg("--rpc-allow-origin-all=false")
            .arg("--max-concurrent-downloads=10")
            .arg("--seed-time=0")
            .arg("--file-allocation=none")
            .arg("--continue=true")
            .arg("--auto-file-renaming=true")
            .arg("--enable-dht=true")
            .arg("--bt-enable-lpd=true")
            .arg("--enable-peer-exchange=true")
            .arg("--bt-max-peers=120")
            .arg("--quiet=true")
            .arg(format!("--stop-with-process={}", std::process::id()));
        if let Some(p) = crate::net_config::current_proxy() {
            cmd.arg(format!("--all-proxy={}", p));
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);
        #[cfg(windows)]
        {
            cmd.creation_flags(0x0800_0000);
        }
        let child = cmd.spawn().map_err(|e| format!("Could not start the torrent engine: {}", e))?;
        *guard = Some(Daemon { child, port, secret: secret.clone() });
        drop(guard);

        // wait until the RPC port answers
        for _ in 0..40 {
            if self.rpc_raw(port, &secret, "aria2.getVersion", vec![]).await.is_ok() {
                return Ok((port, secret));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        Err("The torrent engine did not start in time".to_string())
    }

    async fn rpc_raw(&self, port: u16, secret: &str, method: &str, params: Vec<Value>) -> Result<Value, String> {
        let mut p = vec![json!(format!("token:{}", secret))];
        p.extend(params);
        let body = json!({ "jsonrpc": "2.0", "id": "nova", "method": method, "params": p }).to_string();
        let resp = self
            .inner
            .http
            .post(format!("http://127.0.0.1:{}/jsonrpc", port))
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let text = resp.text().await.map_err(|e| e.to_string())?;
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        if let Some(err) = v.get("error") {
            let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("torrent engine error");
            return Err(msg.to_string());
        }
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    }

    // ---------------------------------------------------------------- job

    async fn run_job(
        &self,
        app: AppHandle,
        id: String,
        url: String,
        directory: String,
        mut kill_rx: oneshot::Receiver<&'static str>,
    ) {
        let db = self.inner.db.clone();
        let fail = |msg: String| {
            let _ = db.save_download_error(&id, &msg);
            let _ = app.emit("download-error", TorrentErrorPayload { id: id.clone(), error: msg });
            emit_status(&app, &id, "error");
        };

        if let Err(e) = std::fs::create_dir_all(&directory) {
            fail(format!("Cannot create folder '{}': {}", directory, e));
            return;
        }

        let (port, secret) = match self.ensure_daemon(&app).await {
            Ok(v) => v,
            Err(e) => {
                fail(e);
                return;
            }
        };

        let options = json!({ "dir": directory });
        let added = if url.starts_with("magnet:") || url.starts_with("http://") || url.starts_with("https://") {
            self.rpc_raw(port, &secret, "aria2.addUri", vec![json!([url]), options]).await
        } else {
            match std::fs::read(&url) {
                Ok(bytes) => {
                    self.rpc_raw(port, &secret, "aria2.addTorrent", vec![json!(base64(&bytes)), json!([]), options]).await
                }
                Err(e) => Err(format!("Cannot read the .torrent file: {}", e)),
            }
        };
        let mut gid = match added {
            Ok(v) => v.as_str().unwrap_or("").to_string(),
            Err(e) => {
                fail(e);
                return;
            }
        };
        if gid.is_empty() {
            fail("The torrent engine did not accept this link".to_string());
            return;
        }

        let keys = json!([
            "status", "totalLength", "completedLength", "downloadSpeed", "uploadSpeed",
            "numSeeders", "connections", "followedBy", "bittorrent", "files", "errorMessage", "dir"
        ]);
        let mut name: Option<String> = None;
        let mut last_total: u64 = 0;
        let mut last_save = Instant::now();

        loop {
            tokio::select! {
                reason = &mut kill_rx => {
                    let reason = reason.unwrap_or("cancelled");
                    let _ = self.rpc_raw(port, &secret, "aria2.forceRemove", vec![json!(gid)]).await;
                    let _ = self.rpc_raw(port, &secret, "aria2.removeDownloadResult", vec![json!(gid)]).await;
                    let _ = db.update_download_status(&id, "paused");
                    emit_status(&app, &id, if reason == "paused" { "paused" } else { "paused" });
                    return;
                }
                _ = tokio::time::sleep(Duration::from_millis(1000)) => {}
            }

            let st = match self.rpc_raw(port, &secret, "aria2.tellStatus", vec![json!(gid), keys.clone()]).await {
                Ok(v) => v,
                Err(e) => {
                    fail(format!("Lost contact with the torrent engine: {}", e));
                    return;
                }
            };
            let status = st.get("status").and_then(|s| s.as_str()).unwrap_or("");

            // A magnet link first downloads its metadata, then continues as a new task
            if let Some(next) = st
                .get("followedBy")
                .and_then(|f| f.as_array())
                .and_then(|a| a.first())
                .and_then(|g| g.as_str())
            {
                if status == "complete" || status == "removed" {
                    gid = next.to_string();
                    continue;
                }
            }

            let total = num(&st, "totalLength");
            let done = num(&st, "completedLength");
            let speed = num(&st, "downloadSpeed");
            if total > 0 {
                last_total = total;
            }

            // Real name of the torrent (ignore aria2's temporary metadata names)
            let from_info = st
                .get("bittorrent")
                .and_then(|b| b.get("info"))
                .and_then(|i| i.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string());
            let from_file = st
                .get("files")
                .and_then(|f| f.as_array())
                .and_then(|a| a.first())
                .and_then(|f| f.get("path"))
                .and_then(|p| p.as_str())
                .and_then(|p| Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()));
            if let Some(n) = from_info.or(from_file) {
                if !n.is_empty() && !n.starts_with("[METADATA]") {
                    name = Some(n);
                }
            }

            match status {
                "error" => {
                    let msg = st
                        .get("errorMessage")
                        .and_then(|m| m.as_str())
                        .unwrap_or("The torrent failed")
                        .to_string();
                    let _ = self.rpc_raw(port, &secret, "aria2.removeDownloadResult", vec![json!(gid)]).await;
                    fail(msg);
                    return;
                }
                "complete" => {
                    let fname = name.clone().unwrap_or_else(|| "torrent".to_string());
                    let size = if last_total > 0 { last_total } else { done };
                    let full = Path::new(&directory).join(&fname).to_string_lossy().to_string();
                    let _ = db.complete_video_download(&id, &fname, &directory, size);
                    let _ = self.rpc_raw(port, &secret, "aria2.removeDownloadResult", vec![json!(gid)]).await;
                    let _ = app.emit(
                        "download-completed",
                        TorrentCompletedPayload {
                            id: id.clone(),
                            destination_path: full.clone(),
                            file_path: full,
                            filename: fname,
                            total_bytes: size,
                            sha256_verified: false,
                        },
                    );
                    emit_status(&app, &id, "completed");
                    return;
                }
                "removed" => {
                    let _ = db.update_download_status(&id, "paused");
                    emit_status(&app, &id, "paused");
                    return;
                }
                _ => {}
            }

            let eta = if speed > 0 && total > done { (total - done) / speed } else { 0 };
            let _ = app.emit(
                "download-progress",
                TorrentProgressPayload {
                    id: id.clone(),
                    downloaded_bytes: done,
                    total_bytes: total.max(done),
                    speed_bytes_sec: speed,
                    eta_seconds: eta,
                    filename: name.clone(),
                    segments: Vec::new(),
                },
            );
            if last_save.elapsed() > Duration::from_secs(2) {
                let _ = db.save_download_checkpoint(&id, done, "downloading");
                last_save = Instant::now();
            }
        }
    }
}

/// Opens the system "choose a .torrent file" dialog is done in the UI; this just validates a path.
#[tauri::command]
pub fn check_torrent_file(path: String) -> Result<u64, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Cannot read file: {}", e))?;
    if !meta.is_file() {
        return Err("That is not a file".to_string());
    }
    if !path.to_lowercase().ends_with(".torrent") {
        return Err("Please choose a .torrent file".to_string());
    }
    Ok(meta.len())
}
