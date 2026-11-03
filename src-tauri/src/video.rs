//! Video-site downloads (YouTube, Vimeo, X/Twitter, TikTok, Instagram, ... ) powered by the
//! bundled `yt-dlp` and `ffmpeg` tools. Progress, speed and ETA are streamed to the UI through
//! the same `download-*` events the normal download engine uses.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;

use crate::db::{Database, DownloadRecord};

#[derive(Debug, Clone, Deserialize)]
pub struct VideoRequest {
    pub id: String,
    pub url: String,
    pub directory: String,
    /// best | 1080 | 720 | 480 | audio
    #[serde(default)]
    pub quality: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct VideoProgressPayload {
    id: String,
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_bytes_sec: u64,
    eta_seconds: u64,
    filename: Option<String>,
    segments: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
struct VideoCompletedPayload {
    id: String,
    destination_path: String,
    file_path: String,
    filename: String,
    total_bytes: u64,
    sha256_verified: bool,
}

#[derive(Debug, Clone, Serialize)]
struct VideoErrorPayload {
    id: String,
    error: String,
}

#[derive(Debug, Clone, Serialize)]
struct VideoStatusPayload {
    id: String,
    status: String,
}

pub struct VideoManager {
    db: Arc<Database>,
    /// Running yt-dlp jobs. Sending "paused" or "cancelled" stops the process.
    jobs: Arc<Mutex<HashMap<String, oneshot::Sender<&'static str>>>>,
}

impl VideoManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            jobs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// True when the download with this id was created by the video downloader.
    pub fn is_video(&self, id: &str) -> bool {
        matches!(self.db.get_download(id), Ok(Some(rec)) if rec.protocol == "video")
    }

    pub fn start(&self, app: AppHandle, req: VideoRequest) -> Result<String, String> {
        let url = req.url.trim().to_string();
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("Please enter a full link starting with http:// or https://".to_string());
        }
        let quality = req.quality.clone().unwrap_or_else(|| "best".to_string());
        let directory = if req.directory.trim().is_empty() {
            default_directory()
        } else {
            req.directory.trim().to_string()
        };

        let rec = DownloadRecord {
            id: req.id.clone(),
            url: url.clone(),
            filename: "Fetching video info...".to_string(),
            directory: directory.clone(),
            total_bytes: 0,
            downloaded_bytes: 0,
            status: "downloading".to_string(),
            category: "video_audio".to_string(),
            protocol: "video".to_string(),
            supports_range: true,
            etag: None,
            // The chosen quality is stored here so Resume can restart with the same choice.
            mime_type: Some(quality.clone()),
            date_added: chrono::Utc::now().timestamp_millis(),
            date_finished: None,
            sha256_expected: None,
            sha256_calculated: None,
            segments_count: 1,
            priority: "normal".to_string(),
            error_message: None,
        };
        self.db.insert_download(&rec).map_err(|e| e.to_string())?;
        self.spawn_job(app, req.id.clone(), url, directory, quality);
        Ok(req.id)
    }

    pub fn resume(&self, app: AppHandle, id: &str) -> Result<(), String> {
        if self.jobs.lock().unwrap().contains_key(id) {
            return Ok(());
        }
        let rec = self
            .db
            .get_download(id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Download not found".to_string())?;
        let quality = rec.mime_type.clone().unwrap_or_else(|| "best".to_string());
        let _ = self.db.update_download_status(id, "downloading");
        emit_status(&app, id, "downloading");
        self.spawn_job(app, id.to_string(), rec.url, rec.directory, quality);
        Ok(())
    }

    pub fn pause(&self, id: &str) {
        self.stop(id, "paused");
    }

    pub fn cancel(&self, id: &str) {
        self.stop(id, "cancelled");
    }

    fn stop(&self, id: &str, reason: &'static str) {
        if let Some(tx) = self.jobs.lock().unwrap().remove(id) {
            let _ = tx.send(reason);
        }
    }

    fn spawn_job(&self, app: AppHandle, id: String, url: String, directory: String, quality: String) {
        let (kill_tx, kill_rx) = oneshot::channel::<&'static str>();
        self.jobs.lock().unwrap().insert(id.clone(), kill_tx);

        let db = self.db.clone();
        let jobs = self.jobs.clone();
        tauri::async_runtime::spawn(async move {
            run_job(app, db, id.clone(), url, directory, quality, kill_rx).await;
            jobs.lock().unwrap().remove(&id);
        });
    }
}

fn default_directory() -> String {
    let base = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("Downloads").join("NOVA").to_string_lossy().to_string()
}

fn emit_status(app: &AppHandle, id: &str, status: &str) {
    let _ = app.emit(
        "download-status-changed",
        VideoStatusPayload { id: id.to_string(), status: status.to_string() },
    );
}

/// Finds a bundled helper tool (yt-dlp.exe / ffmpeg.exe / ffprobe.exe).
fn find_tool(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        dirs.push(res.join("binaries"));
        dirs.push(res.clone());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("binaries"));
            dirs.push(parent.to_path_buf());
        }
    }
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

fn quality_args(quality: &str) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    match quality {
        "audio" => {
            args.extend(["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0"].map(String::from));
        }
        q @ ("1080" | "720" | "480") => {
            args.push("-f".into());
            args.push(format!("bv*[height<={q}]+ba/b[height<={q}]/b"));
            args.push("-S".into());
            args.push(format!("res:{q},ext:mp4:m4a"));
            args.extend(["--merge-output-format", "mp4"].map(String::from));
        }
        _ => {
            args.extend(["-f", "bv*+ba/b", "-S", "res,ext:mp4:m4a", "--merge-output-format", "mp4"].map(String::from));
        }
    }
    args
}

fn num(field: &str) -> f64 {
    field.trim().parse::<f64>().unwrap_or(0.0)
}

async fn run_job(
    app: AppHandle,
    db: Arc<Database>,
    id: String,
    url: String,
    directory: String,
    quality: String,
    mut kill_rx: oneshot::Receiver<&'static str>,
) {
    let fail = |msg: String| {
        let _ = db.save_download_error(&id, &msg);
        let _ = app.emit("download-error", VideoErrorPayload { id: id.clone(), error: msg });
        emit_status(&app, &id, "error");
    };

    let ytdlp = match find_tool(&app, "yt-dlp.exe") {
        Some(p) => p,
        None => {
            fail("Video downloader component (yt-dlp.exe) was not found. Please reinstall NOVA.".to_string());
            return;
        }
    };

    if let Err(e) = std::fs::create_dir_all(&directory) {
        fail(format!("Cannot create folder '{}': {}", directory, e));
        return;
    }

    let mut cmd = tokio::process::Command::new(&ytdlp);
    cmd.arg("--ignore-config")
        .arg("--no-playlist")
        .arg("--newline")
        .arg("--no-colors")
        .arg("--no-mtime")
        .arg("--windows-filenames")
        .arg("--trim-filenames")
        .arg("150")
        .arg("--concurrent-fragments")
        .arg("4")
        .arg("--retries")
        .arg("10")
        .arg("--continue")
        .arg("-P")
        .arg(&directory)
        .arg("-o")
        .arg("%(title)s.%(ext)s")
        .arg("--progress-template")
        .arg("download:NOVA|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.title)s");

    if let Some(ffmpeg) = find_tool(&app, "ffmpeg.exe") {
        if let Some(dir) = ffmpeg.parent() {
            cmd.arg("--ffmpeg-location").arg(dir);
        }
    }
    cmd.args(quality_args(&quality));
    cmd.arg(&url);
    cmd.env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: never flash a console window
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            fail(format!("Could not start the video downloader: {}", e));
            return;
        }
    };

    // Collect error output
    let err_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    if let Some(stderr) = child.stderr.take() {
        let sink = err_lines.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut buf = Vec::new();
            loop {
                buf.clear();
                match reader.read_until(b'\n', &mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&buf).trim().to_string();
                        if !line.is_empty() {
                            let mut v = sink.lock().unwrap();
                            v.push(line);
                            if v.len() > 30 {
                                v.remove(0);
                            }
                        }
                    }
                }
            }
        });
    }

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            fail("Could not read downloader output".to_string());
            return;
        }
    };
    let mut reader = BufReader::new(stdout);
    let mut buf: Vec<u8> = Vec::new();

    let mut base_done: u64 = 0; // bytes of streams already finished (video before audio)
    let mut cur_done: u64 = 0;
    let mut cur_total: u64 = 0;
    let mut title: Option<String> = None;
    let mut last_dest: Option<String> = None;
    let mut final_path: Option<String> = None;
    let mut last_save = Instant::now();
    let mut stop_reason: Option<&'static str> = None;

    loop {
        buf.clear();
        tokio::select! {
            reason = &mut kill_rx => {
                stop_reason = Some(reason.unwrap_or("cancelled"));
                let _ = child.kill().await;
                break;
            }
            read = reader.read_until(b'\n', &mut buf) => {
                match read {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        }

        let line = String::from_utf8_lossy(&buf).trim().to_string();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix("NOVA|") {
            let f: Vec<&str> = rest.splitn(6, '|').collect();
            if f.len() < 6 {
                continue;
            }
            cur_done = num(f[0]) as u64;
            let exact = num(f[1]) as u64;
            let estimate = num(f[2]) as u64;
            cur_total = if exact > 0 { exact } else { estimate };
            let speed = num(f[3]) as u64;
            let eta = num(f[4]) as u64;
            let t = f[5].trim();
            if !t.is_empty() && t != "NA" && t != "None" {
                title = Some(t.to_string());
            }

            let downloaded = base_done + cur_done;
            let total = (base_done + cur_total).max(downloaded);
            let _ = app.emit(
                "download-progress",
                VideoProgressPayload {
                    id: id.clone(),
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    speed_bytes_sec: speed,
                    eta_seconds: eta,
                    filename: title.clone(),
                    segments: Vec::new(),
                },
            );
            if last_save.elapsed() > Duration::from_secs(2) {
                let _ = db.save_download_checkpoint(&id, downloaded, "downloading");
                last_save = Instant::now();
            }
        } else if let Some(p) = line.strip_prefix("[download] Destination: ") {
            // A new stream (video or audio) is starting: bank the previous one
            if cur_total > 0 {
                base_done += cur_total;
                cur_done = 0;
                cur_total = 0;
            }
            last_dest = Some(p.trim().to_string());
        } else if let Some(p) = line.strip_prefix("[Merger] Merging formats into \"") {
            final_path = Some(p.trim_end_matches('"').to_string());
        } else if let Some(p) = line.strip_prefix("[ExtractAudio] Destination: ") {
            final_path = Some(p.trim().to_string());
        } else if let Some(p) = line
            .strip_prefix("[download] ")
            .and_then(|r| r.strip_suffix(" has already been downloaded"))
        {
            final_path = Some(p.trim().to_string());
        }
    }

    let exit_ok = if stop_reason.is_none() {
        matches!(child.wait().await, Ok(s) if s.success())
    } else {
        let _ = child.wait().await;
        false
    };

    match stop_reason {
        Some("paused") => {
            let _ = db.update_download_status(&id, "paused");
            emit_status(&app, &id, "paused");
            return;
        }
        Some(_) => {
            // Cancelled: keep the entry as paused so it can be retried or deleted
            let _ = db.update_download_status(&id, "paused");
            emit_status(&app, &id, "paused");
            return;
        }
        None => {}
    }

    if exit_ok {
        let path_str = final_path.or(last_dest).unwrap_or_default();
        let path = Path::new(&path_str);
        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .or(title.clone())
            .unwrap_or_else(|| "video".to_string());
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(base_done + cur_done);
        let dir = path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or(directory.clone());

        let _ = db.complete_video_download(&id, &filename, &dir, size);
        let _ = app.emit(
            "download-completed",
            VideoCompletedPayload {
                id: id.clone(),
                destination_path: path_str.clone(),
                file_path: path_str,
                filename,
                total_bytes: size,
                sha256_verified: false,
            },
        );
        emit_status(&app, &id, "completed");
    } else {
        let lines = err_lines.lock().unwrap().clone();
        let mut msg = lines
            .iter()
            .rev()
            .find(|l| l.starts_with("ERROR"))
            .cloned()
            .unwrap_or_else(|| lines.last().cloned().unwrap_or_else(|| "The video downloader stopped unexpectedly.".to_string()));
        if msg.to_lowercase().contains("not a bot") || msg.to_lowercase().contains("sign in to confirm") {
            msg.push_str(" (YouTube is asking for a sign-in check for this video. Try again later or try a different video.)");
        }
        fail(msg);
    }
}
