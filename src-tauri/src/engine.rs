/**
 * NOVA Download Manager - Core Rust Download Engine
 * Multi-protocol (HTTP, HTTPS, FTP, FTPS, SFTP) Range Segmented Downloader
 * with Strict Checkpoint Resuming, Range Validation & SHA-256 Integrity Verification
 */

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use futures_util::StreamExt;
use parking_lot::RwLock;
use reqwest::header::{HeaderValue, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, RANGE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::broadcast;
use crate::db::{Database, DownloadRecord};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeInfo {
    pub url: String,
    pub protocol: String,
    pub filename: String,
    pub total_bytes: u64,
    pub supports_range: bool,
    pub is_resumable: bool,
    pub mime_type: Option<String>,
    pub etag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRequest {
    pub id: String,
    pub url: String,
    #[serde(alias = "destinationPath", alias = "destination_path")]
    pub destination_path: String,
    #[serde(alias = "totalBytes", alias = "total_bytes")]
    pub total_bytes: u64,
    #[serde(alias = "segmentsCount", alias = "segments_count")]
    pub segments_count: usize,
    #[serde(alias = "expectedSha256", alias = "expected_sha256", default)]
    pub expected_sha256: Option<String>,
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub cookies: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentProgress {
    pub id: usize,
    pub start_byte: u64,
    pub end_byte: u64,
    pub downloaded_bytes: u64,
    pub speed_bytes_sec: u64,
    pub is_finished: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressPayload {
    pub id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_sec: u64,
    pub segments: Vec<SegmentProgress>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStatusPayload {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadCompletedPayload {
    pub id: String,
    pub destination_path: String,
    pub total_bytes: u64,
    pub sha256_verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadErrorPayload {
    pub id: String,
    pub error: String,
}

pub struct ActiveDownloadTask {
    pub cancel_tx: broadcast::Sender<()>,
}

pub struct DownloadEngine {
    client: reqwest::Client,
    db: Arc<Database>,
    active_tasks: Arc<RwLock<HashMap<String, ActiveDownloadTask>>>,
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
}

impl DownloadEngine {
    pub fn new(db: Arc<Database>) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) NOVA-Download-Manager/2.4")
            .pool_max_idle_per_host(32)
            .tcp_keepalive(std::time::Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("Failed to initialize reqwest client");

        Self {
            client,
            db,
            active_tasks: Arc::new(RwLock::new(HashMap::new())),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.write() = Some(handle);
    }

    pub fn emit_progress(&self, payload: &DownloadProgressPayload) {
        if let Some(ref handle) = *self.app_handle.read() {
            use tauri::Emitter;
            let _ = handle.emit("download-progress", payload);
        }
    }

    pub fn emit_status_changed(&self, id: &str, status: &str) {
        if let Some(ref handle) = *self.app_handle.read() {
            use tauri::Emitter;
            let _ = handle.emit("download-status-changed", DownloadStatusPayload {
                id: id.to_string(),
                status: status.to_string(),
            });
        }
    }

    pub fn emit_completed(&self, payload: &DownloadCompletedPayload) {
        if let Some(ref handle) = *self.app_handle.read() {
            use tauri::Emitter;
            let _ = handle.emit("download-completed", payload);
        }
    }

    pub fn emit_error(&self, id: &str, error: &str) {
        if let Some(ref handle) = *self.app_handle.read() {
            use tauri::Emitter;
            let _ = handle.emit("download-error", DownloadErrorPayload {
                id: id.to_string(),
                error: error.to_string(),
            });
        }
    }

    /// Probe server capabilities across protocols (HTTP, HTTPS, FTP, FTPS, SFTP)
    /// Never invents fake file sizes or claims unsupported resume capabilities.
    pub async fn probe_url(&self, url: &str) -> Result<ProbeInfo, String> {
        let clean = url.trim();
        let protocol = if clean.starts_with("sftp://") {
            "sftp"
        } else if clean.starts_with("ftps://") {
            "ftps"
        } else if clean.starts_with("ftp://") {
            "ftp"
        } else if clean.starts_with("https://") {
            "https"
        } else if clean.starts_with("http://") {
            "http"
        } else {
            return Err(format!("Unsupported protocol in URL: {}", mask_credentials(clean)));
        };

        // 1. Handle FTP and FTPS protocols with real client probe
        if protocol == "ftp" || protocol == "ftps" {
            let clean_str = clean.to_string();
            let is_ftps = protocol == "ftps";
            return tokio::task::spawn_blocking(move || Self::probe_ftp(&clean_str, is_ftps))
                .await
                .map_err(|e| format!("FTP probe task error: {}", e))?;
        }

        // 2. Handle SFTP protocol with real SSH/SFTP probe
        if protocol == "sftp" {
            let clean_str = clean.to_string();
            return tokio::task::spawn_blocking(move || Self::probe_sftp(&clean_str))
                .await
                .map_err(|e| format!("SFTP probe task error: {}", e))?;
        }

        // 3. Handle HTTP / HTTPS protocols
        let head_res = self.client.head(clean).send().await;

        let (resp, total_bytes, supports_range, mime_type, etag, disp_header) = match head_res {
            Ok(r) if r.status().is_success() => {
                let mut bytes = 0u64;
                if let Some(val) = r.headers().get(CONTENT_LENGTH) {
                    if let Ok(len_str) = val.to_str() {
                        bytes = len_str.parse::<u64>().unwrap_or(0);
                    }
                }
                let range = r.headers().get(ACCEPT_RANGES)
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v.eq_ignore_ascii_case("bytes"))
                    .unwrap_or(false);

                let mime = r.headers().get(reqwest::header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);

                let etag_val = r.headers().get(reqwest::header::ETAG)
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);

                let disp = r.headers().get(reqwest::header::CONTENT_DISPOSITION)
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);

                (Some(r), bytes, range, mime, etag_val, disp)
            }
            _ => {
                // If HEAD fails or is rejected by server (405 Method Not Allowed),
                // probe with a lightweight Range GET request for byte 0: bytes=0-0
                let range_probe = self.client.get(clean)
                    .header(RANGE, "bytes=0-0")
                    .send()
                    .await;

                match range_probe {
                    Ok(r) => {
                        let mut bytes = 0u64;
                        let mut range = false;

                        if r.status().as_u16() == 206 {
                            range = true;
                            if let Some(cr) = r.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
                                if let Some(slash_idx) = cr.rfind('/') {
                                    let total_str = &cr[slash_idx + 1..].trim();
                                    if *total_str != "*" {
                                        bytes = total_str.parse::<u64>().unwrap_or(0);
                                    }
                                }
                            }
                        } else if r.status().is_success() {
                            // Server returned 200 OK: Range header ignored, Range NOT supported!
                            range = false;
                            if let Some(len) = r.headers().get(CONTENT_LENGTH).and_then(|v| v.to_str().ok()) {
                                bytes = len.parse::<u64>().unwrap_or(0);
                            }
                        }

                        let mime = r.headers().get(reqwest::header::CONTENT_TYPE)
                            .and_then(|v| v.to_str().ok())
                            .map(String::from);

                        let etag_val = r.headers().get(reqwest::header::ETAG)
                            .and_then(|v| v.to_str().ok())
                            .map(String::from);

                        let disp = r.headers().get(reqwest::header::CONTENT_DISPOSITION)
                            .and_then(|v| v.to_str().ok())
                            .map(String::from);

                        (Some(r), bytes, range, mime, etag_val, disp)
                    }
                    Err(e) => return Err(format!("Network probe failed for {}: {}", mask_credentials(clean), e)),
                }
            }
        };

        let filename = extract_filename(clean, disp_header.as_deref());

        Ok(ProbeInfo {
            url: mask_credentials(clean),
            protocol: protocol.to_string(),
            filename,
            total_bytes,
            supports_range,
            is_resumable: supports_range,
            mime_type,
            etag,
        })
    }

    /// Real FTP & FTPS server inspection
    fn probe_ftp(url: &str, is_ftps: bool) -> Result<ProbeInfo, String> {
        let parsed = url::Url::parse(url)
            .map_err(|e| format!("Invalid FTP URL: {}", e))?;
        let host = parsed.host_str()
            .ok_or_else(|| "Missing host in FTP URL".to_string())?;
        let port = parsed.port().unwrap_or(21);
        let user = parsed.username();
        let pass = parsed.password().unwrap_or("");
        let path = parsed.path().trim_start_matches('/');

        let auth_user = if user.is_empty() { "anonymous" } else { user };
        let auth_pass = if user.is_empty() { "anonymous@nova" } else { pass };

        let (total_bytes, is_resumable) = if is_ftps {
            let connector = suppaftp::NativeTlsConnector::from(
                suppaftp::native_tls::TlsConnector::new()
                    .map_err(|e| format!("TLS init failed: {}", e))?
            );

            let stream = suppaftp::NativeTlsFtpStream::connect((host, port))
                .map_err(|e| format!("FTPS connection failed for {}:{}: {}", host, port, e))?;

            let mut stream = stream.into_secure(connector, host)
                .map_err(|e| format!("FTPS TLS upgrade failed for {}:{}: {}", host, port, e))?;

            stream.login(auth_user, auth_pass)
                .map_err(|e| format!("FTPS authentication failed for {}: {}", host, e))?;

            stream.transfer_type(suppaftp::types::FileType::Binary)
                .map_err(|e| format!("FTPS binary mode failed: {}", e))?;

            let total_bytes = match stream.size(path) {
                Ok(sz) => sz as u64,
                Err(_) => 0u64,
            };

            let is_resumable = stream.resume_transfer(0).is_ok();
            let _ = stream.quit();

            (total_bytes, is_resumable)
        } else {
            let mut stream = suppaftp::FtpStream::connect((host, port))
                .map_err(|e| format!("FTP connection failed for {}:{}: {}", host, port, e))?;

            stream.login(auth_user, auth_pass)
                .map_err(|e| format!("FTP authentication failed for {}: {}", host, e))?;

            stream.transfer_type(suppaftp::types::FileType::Binary)
                .map_err(|e| format!("FTP binary mode failed: {}", e))?;

            let total_bytes = match stream.size(path) {
                Ok(sz) => sz as u64,
                Err(_) => 0u64,
            };

            let is_resumable = stream.resume_transfer(0).is_ok();
            let _ = stream.quit();

            (total_bytes, is_resumable)
        };

        let filename = extract_filename_from_url(url);

        Ok(ProbeInfo {
            url: mask_credentials(url),
            protocol: if is_ftps { "ftps".to_string() } else { "ftp".to_string() },
            filename,
            total_bytes,
            supports_range: is_resumable && total_bytes > 0,
            is_resumable,
            mime_type: Some("application/octet-stream".to_string()),
            etag: None,
        })
    }

    /// Real SFTP server inspection via SSH2
    fn probe_sftp(url: &str) -> Result<ProbeInfo, String> {
        let parsed = url::Url::parse(url).map_err(|e| format!("Invalid SFTP URL: {}", e))?;
        let host = parsed.host_str().ok_or_else(|| "Missing host in SFTP URL".to_string())?;
        let port = parsed.port().unwrap_or(22);
        let user = parsed.username();
        let pass = parsed.password().unwrap_or("");
        let path = parsed.path().trim_start_matches('/');

        let tcp = std::net::TcpStream::connect((host, port))
            .map_err(|e| format!("SFTP TCP connection failed for {}:{}: {}", host, port, e))?;
        let mut sess = ssh2::Session::new()
            .map_err(|e| format!("Failed to create SSH session: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| format!("SSH handshake failed for {}: {}", host, e))?;

        if !user.is_empty() {
            sess.userauth_password(user, pass)
                .map_err(|e| format!("SFTP authentication failed for user '{}' on {}: {}", user, host, e))?;
        }

        let sftp = sess.sftp()
            .map_err(|e| format!("Failed to initialize SFTP subsystem: {}", e))?;
        
        let stat = sftp.stat(Path::new(path))
            .map_err(|e| format!("SFTP remote file not found or inaccessible at '{}': {}", path, e))?;

        let total_bytes = stat.size.unwrap_or(0);
        let filename = extract_filename_from_url(url);

        Ok(ProbeInfo {
            url: mask_credentials(url),
            protocol: "sftp".to_string(),
            filename,
            total_bytes,
            supports_range: total_bytes > 0,
            is_resumable: total_bytes > 0,
            mime_type: Some("application/octet-stream".to_string()),
            etag: None,
        })
    }

    
    /// Dedicated FTP / FTPS transfer using separate connection types.
    fn download_ftp(
        req: DownloadRequest,
        cancel_rx: broadcast::Receiver<()>,
        db: Arc<Database>,
        target_path: PathBuf,
        is_ftps: bool,
        app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    ) {
        let dl_id = req.id.clone();
        let expected_total_bytes = req.total_bytes;
        let expected_sha256 = req.expected_sha256.clone();

        let parsed = match url::Url::parse(&req.url) {
            Ok(p) => p,
            Err(e) => {
                let err_msg = format!("Malformed FTP URL: {}", e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        let host = match parsed.host_str() {
            Some(h) => h,
            None => {
                let err_msg = "FTP URL missing target hostname".to_string();
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        let port = parsed.port().unwrap_or(21);
        let user = req.username.as_deref().unwrap_or_else(|| parsed.username());
        let pass = req.password.as_deref().unwrap_or_else(|| parsed.password().unwrap_or(""));
        let path = parsed.path().trim_start_matches('/').to_string();

        let auth_user = if user.is_empty() { "anonymous" } else { user };
        let auth_pass = if user.is_empty() { "anonymous@nova" } else { pass };


        let mut cancel_rx = cancel_rx;
        let auth_user: &str = auth_user;
        let auth_pass: &str = auth_pass;

        // Shared FTP / FTPS transfer logic. A macro (instead of a generic fn) avoids
        // naming suppaftp's internal TLS-stream trait bounds, which differ between versions.
        macro_rules! ftp_transfer {
            ($stream:ident) => {{
            if let Err(e) = $stream.login(auth_user, auth_pass) {
                let err_msg = format!("FTP authentication failed for user '{}': {}", auth_user, e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }

            if let Err(e) = $stream.transfer_type(suppaftp::types::FileType::Binary) {
                let err_msg = format!("FTP binary mode selection failed: {}", e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                let _ = $stream.quit();
                return;
            }

            // Resume from the existing local file when possible.
            let mut start_offset = 0u64;

            if let Ok(metadata) = std::fs::metadata(&target_path) {
                if metadata.len() > 0
                    && (expected_total_bytes == 0 || metadata.len() < expected_total_bytes)
                {
                    start_offset = metadata.len();
                }
            }

            if start_offset > 0 {
                if $stream.resume_transfer(start_offset as usize).is_err() {
                    start_offset = 0;
                }
            }

            let mut file = match OpenOptions::new()
                .write(true)
                .create(true)
                .open(&target_path)
            {
                Ok(f) => f,
                Err(e) => {
                    let err_msg = format!("Local file open failed: {}", e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    let _ = $stream.quit();
                    return;
                }
            };

            if start_offset > 0 {
                if let Err(e) = file.seek(SeekFrom::Start(start_offset)) {
                    let err_msg = format!("Local file seek failed: {}", e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    let _ = $stream.quit();
                    return;
                }
            } else if let Err(e) = file.set_len(0) {
                let err_msg = format!("Could not reset destination file: {}", e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                let _ = $stream.quit();
                return;
            }

            let mut data_stream = match $stream.retr_as_stream(&path) {
                Ok(ds) => ds,
                Err(e) => {
                    let err_msg = format!("FTP RETR stream failed for '{}': {}", path, e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    let _ = $stream.quit();
                    return;
                }
            };

                        let mut buffer = [0u8; 65536];
            let mut downloaded = start_offset;
            let mut last_save = downloaded;
            let mut last_emit_bytes = downloaded;
            let mut last_emit_time = tokio::time::Instant::now();
            let mut interrupted = false;

            loop {
                if cancel_rx.try_recv().is_ok() {
                    interrupted = true;
                    let _ = db.update_download_status(&dl_id, "paused");
                    emit_status_handle(&app_handle, &dl_id, "paused");
                    break;
                }

                match data_stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        if let Err(e) = file.write_all(&buffer[..n]) {
                            interrupted = true;
                            let err_msg = format!("File write error: {}", e);
                            let _ = db.save_download_error(&dl_id, &err_msg);
                            emit_error_handle(&app_handle, &dl_id, &err_msg);
                            break;
                        }

                        downloaded += n as u64;

                        if downloaded.saturating_sub(last_save) >= 262144 {
                            last_save = downloaded;
                            let _ = db.save_download_checkpoint(&dl_id, downloaded, "downloading");
                        }

                        if last_emit_time.elapsed().as_millis() >= 250 {
                            let elapsed_sec = last_emit_time.elapsed().as_secs_f64().max(0.001);
                            let speed =
                                ((downloaded.saturating_sub(last_emit_bytes)) as f64 / elapsed_sec)
                                    as u64;

                            last_emit_bytes = downloaded;
                            last_emit_time = tokio::time::Instant::now();

                            emit_progress_handle(&app_handle, &DownloadProgressPayload {
                                id: dl_id.clone(),
                                downloaded_bytes: downloaded,
                                total_bytes: expected_total_bytes,
                                speed_bytes_sec: speed,
                                segments: vec![SegmentProgress {
                                    id: 0,
                                    start_byte: 0,
                                    end_byte: expected_total_bytes.saturating_sub(1),
                                    downloaded_bytes: downloaded,
                                    speed_bytes_sec: speed,
                                    is_finished: false,
                                }],
                            });
                        }
                    }
                    Err(e) => {
                        interrupted = true;
                        let err_msg = format!("FTP data stream read error: {}", e);
                        let _ = db.save_download_error(&dl_id, &err_msg);
                        emit_error_handle(&app_handle, &dl_id, &err_msg);
                        break;
                    }
                }
            }

            // Finish the data transfer before quitting the FTP session.
            if let Err(e) = $stream.finalize_retr_stream(data_stream) {
                if !interrupted {
                    interrupted = true;
                    let err_msg = format!("FTP transfer finalization failed: {}", e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                }
            }

            let _ = file.flush();
            drop(file);
            let _ = $stream.quit();

            if !interrupted {
                if expected_total_bytes > 0 && downloaded < expected_total_bytes {
                    let err_msg = format!(
                        "Premature end of FTP stream (downloaded {} of {} bytes)",
                        downloaded,
                        expected_total_bytes
                    );
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    return;
                }

                let mut sha_ok = true;

                if let Some(ref expected) = expected_sha256 {
                    if let Ok(mut f) = std::fs::File::open(&target_path) {
                        let mut hasher = Sha256::new();
                        let mut buf = vec![0u8; 65536];

                        while let Ok(n) = f.read(&mut buf) {
                            if n == 0 {
                                break;
                            }
                            hasher.update(&buf[..n]);
                        }

                        let calculated = format!("{:x}", hasher.finalize());

                        if !calculated.eq_ignore_ascii_case(expected) {
                            sha_ok = false;
                            let err_msg = format!(
                                "SHA-256 verification failed (expected {}, calculated {})",
                                expected,
                                calculated
                            );
                            let _ = db.save_download_error(&dl_id, &err_msg);
                            emit_error_handle(&app_handle, &dl_id, &err_msg);
                            return;
                        }
                    }
                }

                let _ = db.save_download_checkpoint(&dl_id, downloaded, "completed");

                emit_completed_handle(&app_handle, &DownloadCompletedPayload {
                    id: dl_id.clone(),
                    destination_path: target_path.to_string_lossy().to_string(),
                    total_bytes: downloaded,
                    sha256_verified: sha_ok,
                });

                emit_status_handle(&app_handle, &dl_id, "completed");
            }
            }};
        }

        if is_ftps {
            let connector = match suppaftp::native_tls::TlsConnector::new() {
                Ok(c) => suppaftp::NativeTlsConnector::from(c),
                Err(e) => {
                    let err_msg = format!("TLS init failed: {}", e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    return;
                }
            };

            let stream = match suppaftp::NativeTlsFtpStream::connect((host, port)) {
                Ok(s) => s,
                Err(e) => {
                    let err_msg = format!("FTPS connection to {}:{} failed: {}", host, port, e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    return;
                }
            };

            let mut secure_stream = match stream.into_secure(connector, host) {
                Ok(s) => s,
                Err(e) => {
                    let err_msg = format!("FTPS TLS negotiation failed: {}", e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    return;
                }
            };

            ftp_transfer!(secure_stream);
        } else {
            let mut plain_stream = match suppaftp::FtpStream::connect((host, port)) {
                Ok(s) => s,
                Err(e) => {
                    let err_msg = format!("FTP connection to {}:{} failed: {}", host, port, e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    return;
                }
            };

            ftp_transfer!(plain_stream);
        }
    }

    /// Dedicated SFTP transfer using real SSH2 client with offset seek and resume
    fn download_sftp_blocking(
        req: DownloadRequest,
        mut cancel_rx: broadcast::Receiver<()>,
        db: Arc<Database>,
        target_path: PathBuf,
        app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    ) {
        let dl_id = req.id.clone();
        let expected_total_bytes = req.total_bytes;
        let expected_sha256 = req.expected_sha256.clone();

        let parsed = match url::Url::parse(&req.url) {
            Ok(p) => p,
            Err(e) => {
                let err_msg = format!("Malformed SFTP URL: {}", e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        let host = match parsed.host_str() {
            Some(h) => h,
            None => {
                let err_msg = "SFTP URL missing target hostname".to_string();
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        let port = parsed.port().unwrap_or(22);
        let user = req.username.as_deref().unwrap_or_else(|| parsed.username());
        let pass = req.password.as_deref().unwrap_or_else(|| parsed.password().unwrap_or(""));
        let path = parsed.path().trim_start_matches('/');

        let tcp = match std::net::TcpStream::connect((host, port)) {
            Ok(t) => t,
            Err(e) => {
                let err_msg = format!("SFTP TCP connection to {}:{} failed: {}", host, port, e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        let mut sess = match ssh2::Session::new() {
            Ok(s) => s,
            Err(e) => {
                let err_msg = format!("SSH session init failed: {}", e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        sess.set_tcp_stream(tcp);
        if let Err(e) = sess.handshake() {
            let err_msg = format!("SSH handshake failed for {}: {}", host, e);
            let _ = db.save_download_error(&dl_id, &err_msg);
            emit_error_handle(&app_handle, &dl_id, &err_msg);
            return;
        }

        if !user.is_empty() {
            if let Err(e) = sess.userauth_password(user, pass) {
                let err_msg = format!("SFTP user authentication failed for '{}': {}", user, e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        }

        let sftp = match sess.sftp() {
            Ok(s) => s,
            Err(e) => {
                let err_msg = format!("SFTP subsystem init failed: {}", e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        let mut remote_file = match sftp.open(Path::new(path)) {
            Ok(rf) => rf,
            Err(e) => {
                let err_msg = format!("SFTP remote file open failed for '{}': {}", path, e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        let mut start_offset = 0u64;
        if let Ok(metadata) = std::fs::metadata(&target_path) {
            if metadata.len() > 0 && (expected_total_bytes == 0 || metadata.len() < expected_total_bytes) {
                start_offset = metadata.len();
            }
        }

        if start_offset > 0 {
            if let Err(_) = remote_file.seek(SeekFrom::Start(start_offset)) {
                start_offset = 0;
            }
        }

        let mut local_file = match OpenOptions::new()
            .write(true)
            .create(true)
            .open(&target_path)
        {
            Ok(f) => f,
            Err(e) => {
                let err_msg = format!("Local file open failed: {}", e);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }
        };

        if start_offset > 0 {
            let _ = local_file.seek(SeekFrom::Start(start_offset));
        }

        let mut buffer = [0u8; 65536];
        let mut downloaded = start_offset;
        let mut last_save = downloaded;
        let mut last_emit_bytes = downloaded;
        let mut last_emit_time = std::time::Instant::now();
        let mut interrupted = false;

        loop {
            if cancel_rx.try_recv().is_ok() {
                interrupted = true;
                let _ = db.update_download_status(&dl_id, "paused");
                emit_status_handle(&app_handle, &dl_id, "paused");
                break;
            }

            match remote_file.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    if let Err(e) = local_file.write_all(&buffer[..n]) {
                        interrupted = true;
                        let err_msg = format!("File write error: {}", e);
                        let _ = db.save_download_error(&dl_id, &err_msg);
                        emit_error_handle(&app_handle, &dl_id, &err_msg);
                        break;
                    }
                    downloaded += n as u64;

                    if downloaded.saturating_sub(last_save) >= 262144 {
                        last_save = downloaded;
                        let _ = db.save_download_checkpoint(&dl_id, downloaded, "downloading");
                    }

                    if last_emit_time.elapsed().as_millis() >= 250 {
                        let elapsed_sec = last_emit_time.elapsed().as_secs_f64().max(0.001);
                        let speed = ((downloaded.saturating_sub(last_emit_bytes)) as f64 / elapsed_sec) as u64;
                        last_emit_bytes = downloaded;
                        last_emit_time = std::time::Instant::now();

                        emit_progress_handle(&app_handle, &DownloadProgressPayload {
                            id: dl_id.clone(),
                            downloaded_bytes: downloaded,
                            total_bytes: expected_total_bytes,
                            speed_bytes_sec: speed,
                            segments: vec![SegmentProgress {
                                id: 0,
                                start_byte: 0,
                                end_byte: expected_total_bytes.saturating_sub(1),
                                downloaded_bytes: downloaded,
                                speed_bytes_sec: speed,
                                is_finished: false,
                            }],
                        });
                    }
                }
                Err(e) => {
                    interrupted = true;
                    let err_msg = format!("SFTP data read error: {}", e);
                    let _ = db.save_download_error(&dl_id, &err_msg);
                    emit_error_handle(&app_handle, &dl_id, &err_msg);
                    break;
                }
            }
        }

        let _ = local_file.flush();
        drop(local_file);
        drop(remote_file);

        if !interrupted {
            if expected_total_bytes > 0 && downloaded < expected_total_bytes {
                let err_msg = format!("Premature end of SFTP stream (downloaded {} of {} bytes)", downloaded, expected_total_bytes);
                let _ = db.save_download_error(&dl_id, &err_msg);
                emit_error_handle(&app_handle, &dl_id, &err_msg);
                return;
            }

            let mut sha_ok = true;
            if let Some(ref expected) = expected_sha256 {
                if let Ok(mut f) = std::fs::File::open(&target_path) {
                    let mut hasher = Sha256::new();
                    let mut buf = vec![0u8; 65536];
                    while let Ok(n) = f.read(&mut buf) {
                        if n == 0 { break; }
                        hasher.update(&buf[..n]);
                    }
                    let calculated = format!("{:x}", hasher.finalize());
                    if !calculated.eq_ignore_ascii_case(expected) {
                        sha_ok = false;
                        let err_msg = format!("SHA-256 verification failed (expected {}, calculated {})", expected, calculated);
                        let _ = db.save_download_error(&dl_id, &err_msg);
                        emit_error_handle(&app_handle, &dl_id, &err_msg);
                        return;
                    }
                }
            }

            let _ = db.save_download_checkpoint(&dl_id, downloaded, "completed");
            emit_completed_handle(&app_handle, &DownloadCompletedPayload {
                id: dl_id.clone(),
                destination_path: target_path.to_string_lossy().to_string(),
                total_bytes: downloaded,
                sha256_verified: sha_ok,
            });
            emit_status_handle(&app_handle, &dl_id, "completed");
        }
    }

    /// Launch download with protocol dispatch (HTTP/HTTPS, FTP, FTPS, SFTP)
    pub async fn start_download(&self, req: DownloadRequest) -> Result<(), String> {
        // Path sanitization check (prevent directory traversal and reserved devices)
        let target_path = validate_and_sanitize_path(&req.destination_path)?;

        let (cancel_tx, _) = broadcast::channel(1);

        {
            let mut tasks = self.active_tasks.write();
            if tasks.contains_key(&req.id) {
                return Err(format!("Download task '{}' is already actively running", req.id));
            }
            tasks.insert(req.id.clone(), ActiveDownloadTask {
                cancel_tx: cancel_tx.clone(),
            });
        }

        // Protocol dispatch: never route FTP, FTPS or SFTP through reqwest
        let is_ftp = req.url.starts_with("ftp://");
        let is_ftps = req.url.starts_with("ftps://");
        let is_sftp = req.url.starts_with("sftp://");
        let is_http = req.url.starts_with("http://") || req.url.starts_with("https://");

        if !is_http && !is_ftp && !is_ftps && !is_sftp {
            let mut tasks = self.active_tasks.write();
            tasks.remove(&req.id);
            return Err(format!("Unsupported protocol in URL: {}", mask_credentials(&req.url)));
        }

        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Directory creation failed: {}", e))?;
        }

        if is_ftp || is_ftps {
            let cancel_rx = cancel_tx.subscribe();
            let target_path_clone = target_path.clone();
            let db_clone = Arc::clone(&self.db);
            let app_handle_clone = Arc::clone(&self.app_handle);
            tokio::task::spawn_blocking(move || {
                Self::download_ftp(req, cancel_rx, db_clone, target_path_clone, is_ftps, app_handle_clone);
            });
            return Ok(());
        }

        if is_sftp {
            let cancel_rx = cancel_tx.subscribe();
            let target_path_clone = target_path.clone();
            let db_clone = Arc::clone(&self.db);
            let app_handle_clone = Arc::clone(&self.app_handle);
            tokio::task::spawn_blocking(move || {
                Self::download_sftp_blocking(req, cancel_rx, db_clone, target_path_clone, app_handle_clone);
            });
            return Ok(());
        }

        // Persist secure credentials if provided so resume retains authentication
        if req.username.is_some() || req.password.is_some() || req.headers.is_some() || req.cookies.is_some() {
            let _ = self.db.save_secure_credentials(
                &req.id,
                req.username.as_deref(),
                req.password.as_deref(),
                req.headers.as_ref(),
                req.cookies.as_deref(),
            );
        }

        // Emit downloading status
        self.emit_status_changed(&req.id, "downloading");

        let client = self.client.clone();
        let db = Arc::clone(&self.db);
        let download_id = req.id.clone();
        let app_handle = Arc::clone(&self.app_handle);

        // Pre-allocate destination file if total_bytes is known
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .open(&target_path)
            .map_err(|e| format!("Failed to create destination file: {}", e))?;

        if req.total_bytes > 0 {
            let _ = file.set_len(req.total_bytes);
        }
        drop(file);

        // 1. Probe Range support BEFORE spawning parallel workers to ensure no multiple workers write during evaluation
        let mut confirmed_range_support = false;
        let mut probe_etag: Option<String> = None;

        if req.segments_count > 1 && req.total_bytes > 0 {
            let mut probe_builder = client.get(&req.url).header(RANGE, "bytes=0-0");
            if let Some(ref headers) = req.headers {
                for (k, v) in headers {
                    if !k.eq_ignore_ascii_case("host") && !k.eq_ignore_ascii_case("content-length") {
                        if let Ok(hdr_val) = HeaderValue::from_str(v) {
                            probe_builder = probe_builder.header(k, hdr_val);
                        }
                    }
                }
            }
            if let Some(ref cookies) = req.cookies {
                probe_builder = probe_builder.header("Cookie", cookies);
            }
            if let Ok(probe_res) = probe_builder.send().await {
                if let Some(etag_hdr) = probe_res.headers().get(reqwest::header::ETAG).and_then(|v| v.to_str().ok()) {
                    probe_etag = Some(etag_hdr.to_string());
                }
                if probe_res.status().as_u16() == 206 {
                    if let Some(cr) = probe_res.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
                        // Validate format: bytes 0-0/total
                        if cr.starts_with("bytes 0-0/") {
                            confirmed_range_support = true;
                        }
                    }
                }
            }
        }

        // Check for resume capability and verify ETag integrity if resuming
        let existing_record = self.db.get_download(&req.id).ok().flatten();
        let existing_segments = self.db.get_segments(&req.id).unwrap_or_default();
        let mut restart_clean = false;

        if let Some(ref prev) = existing_record {
            if prev.downloaded_bytes > 0 && target_path.exists() {
                // If previous ETag exists and server returned a different ETag, restart clean
                if let (Some(ref prev_etag), Some(ref curr_etag)) = (&prev.etag, &probe_etag) {
                    if prev_etag != curr_etag {
                        restart_clean = true;
                    }
                }
            }
        }

        if restart_clean {
            let _ = std::fs::remove_file(&target_path);
            let _ = self.db.save_download_checkpoint(&req.id, 0, "downloading");
        }

        // If range probe failed or size is unknown, safely fall back to single-stream download
        let segments_count = if confirmed_range_support { req.segments_count } else { 1 };
        let chunk_size = if req.total_bytes > 0 && segments_count > 1 { req.total_bytes / (segments_count as u64) } else { 0 };

        // Save download record in SQLite
        let record = DownloadRecord {
            id: req.id.clone(),
            url: mask_credentials(&req.url),
            filename: target_path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            directory: target_path.parent().unwrap_or(Path::new("")).to_string_lossy().to_string(),
            total_bytes: req.total_bytes,
            downloaded_bytes: if restart_clean { 0 } else { existing_record.as_ref().map(|r| r.downloaded_bytes).unwrap_or(0) },
            status: "downloading".to_string(),
            category: "downloads".to_string(),
            protocol: if req.url.starts_with("ftp") { "ftp".to_string() } else if req.url.starts_with("sftp") { "sftp".to_string() } else { "http".to_string() },
            supports_range: confirmed_range_support,
            etag: probe_etag.or_else(|| existing_record.as_ref().and_then(|r| r.etag.clone())),
            mime_type: None,
            date_added: chrono::Utc::now().timestamp_millis(),
            date_finished: None,
            sha256_expected: req.expected_sha256.clone(),
            sha256_calculated: None,
            segments_count,
            priority: "normal".to_string(),
            error_message: None,
        };
        let _ = db.insert_download(&record);

        let expected_sha256 = req.expected_sha256.clone();
        let expected_total_bytes = req.total_bytes;
        let coord_target_path = target_path.clone();
        let coord_db = Arc::clone(&db);
        let coord_dl_id = download_id.clone();
        let coord_app_handle = Arc::clone(&app_handle);

        // Spawn coordinator task to manage and coordinate all segment workers
        tokio::spawn(async move {
            let mut join_set = tokio::task::JoinSet::new();

            for seg_idx in 0..segments_count {
                let seg_base_start = if segments_count == 1 { 0 } else { seg_idx as u64 * chunk_size };
                let end = if segments_count == 1 {
                    if expected_total_bytes > 0 { expected_total_bytes - 1 } else { 0 }
                } else if seg_idx == segments_count - 1 {
                    expected_total_bytes.saturating_sub(1)
                } else {
                    ((seg_idx + 1) as u64 * chunk_size).saturating_sub(1)
                };

                // Check for existing segment progress for resume
                let seg_prev_downloaded = if !restart_clean {
                    existing_segments.iter()
                        .find(|s| s.segment_index == seg_idx)
                        .map(|s| s.downloaded_bytes)
                        .unwrap_or(0)
                } else {
                    0
                };

                let seg_expected = if segments_count > 1 || expected_total_bytes > 0 {
                    end.saturating_sub(seg_base_start) + 1
                } else {
                    0
                };

                // If segment already finished, skip downloading it again
                if seg_expected > 0 && seg_prev_downloaded >= seg_expected {
                    join_set.spawn(async move {
                        Ok(seg_prev_downloaded)
                    });
                    continue;
                }

                let start = seg_base_start + seg_prev_downloaded;
                let seg_client = client.clone();
                let seg_url = req.url.clone();
                let seg_file_path = coord_target_path.clone();
                let mut seg_cancel = cancel_tx.subscribe();
                let seg_db = Arc::clone(&coord_db);
                let dl_id = coord_dl_id.clone();
                let custom_headers = req.headers.clone();
                let custom_cookies = req.cookies.clone();
                let is_segmented = segments_count > 1;

                join_set.spawn(async move {
                    let mut req_builder = seg_client.get(&seg_url);

                    let requested_range = is_segmented || (start > 0);
                    if requested_range {
                        let range_header = format!("bytes={}-{}", start, end);
                        req_builder = req_builder.header(RANGE, range_header);
                    }

                    if let Some(headers) = custom_headers {
                        for (k, v) in headers {
                            if !k.eq_ignore_ascii_case("host") && !k.eq_ignore_ascii_case("content-length") {
                                if let Ok(hdr_val) = HeaderValue::from_str(&v) {
                                    req_builder = req_builder.header(k, hdr_val);
                                }
                            }
                        }
                    }

                    if let Some(cookies) = custom_cookies {
                        req_builder = req_builder.header("Cookie", cookies);
                    }

                    let response = req_builder.send().await
                        .map_err(|e| format!("Worker {} request error: {}", seg_idx, e))?;

                    let status = response.status();

                    // If range was requested, status MUST be 206 Partial Content
                    if requested_range && status.as_u16() != 206 {
                        return Err(format!("Worker {} expected HTTP 206, got {}", seg_idx, status));
                    } else if !requested_range && !status.is_success() {
                        return Err(format!("Worker {} HTTP error {}", seg_idx, status));
                    }

                    // Strict Content-Range validation when 206 Partial Content is returned
                    if requested_range && status.as_u16() == 206 {
                        let cr = response.headers().get(CONTENT_RANGE)
                            .and_then(|v| v.to_str().ok())
                            .ok_or_else(|| format!("Worker {}: missing Content-Range header", seg_idx))?;

                        let expected_prefix = format!("bytes {}-{}", start, end);
                        if !cr.starts_with(&expected_prefix) {
                            return Err(format!("Worker {}: Content-Range mismatch '{}', expected '{}'", seg_idx, cr, expected_prefix));
                        }
                    }

                    let mut stream = response.bytes_stream();
                    let mut current_offset = start;
                    let mut seg_downloaded = seg_prev_downloaded;
                    let expected_bytes = if requested_range { end - seg_base_start + 1 } else { expected_total_bytes };

                    while let Some(chunk_result) = stream.next().await {
                        if seg_cancel.try_recv().is_ok() {
                            let _ = seg_db.save_segment_checkpoint(&dl_id, seg_idx, seg_downloaded, false);
                            return Err(format!("Worker {} cancelled", seg_idx));
                        }

                        let bytes = chunk_result.map_err(|e| format!("Worker {} stream error: {}", seg_idx, e))?;

                        let bytes_to_write = if requested_range && (seg_downloaded + bytes.len() as u64 > expected_bytes) {
                            (expected_bytes.saturating_sub(seg_downloaded)) as usize
                        } else {
                            bytes.len()
                        };

                        if bytes_to_write > 0 {
                            let mut write_file = OpenOptions::new().write(true).open(&seg_file_path)
                                .map_err(|e| format!("Worker {} write error: {}", seg_idx, e))?;
                            write_file.seek(SeekFrom::Start(current_offset))
                                .map_err(|e| format!("Worker {} seek error: {}", seg_idx, e))?;
                            write_file.write_all(&bytes[..bytes_to_write])
                                .map_err(|e| format!("Worker {} write error: {}", seg_idx, e))?;

                            current_offset += bytes_to_write as u64;
                            seg_downloaded += bytes_to_write as u64;
                        }

                        if requested_range && seg_downloaded >= expected_bytes {
                            break;
                        }
                    }

                    // Detect premature disconnects or incomplete transfers
                    if expected_bytes > 0 && seg_downloaded < expected_bytes {
                        let _ = seg_db.save_segment_checkpoint(&dl_id, seg_idx, seg_downloaded, false);
                        return Err(format!("Worker {} received fewer bytes than expected: {}/{}", seg_idx, seg_downloaded, expected_bytes));
                    }

                    let _ = seg_db.save_segment_checkpoint(&dl_id, seg_idx, seg_downloaded, true);
                    Ok(seg_downloaded)
                });
            }

            // Coordinate worker tasks
            let mut all_succeeded = true;
            let mut total_downloaded = 0u64;
            let mut first_error: Option<String> = None;

            while let Some(res) = join_set.join_next().await {
                match res {
                    Ok(Ok(bytes)) => {
                        total_downloaded += bytes;
                    }
                    Ok(Err(err)) => {
                        all_succeeded = false;
                        if first_error.is_none() {
                            first_error = Some(err);
                        }
                    }
                    Err(join_err) => {
                        all_succeeded = false;
                        if first_error.is_none() {
                            first_error = Some(format!("Worker joined with panic: {}", join_err));
                        }
                    }
                }
            }

            if all_succeeded {
                // Ensure all expected bytes were written
                if expected_total_bytes > 0 && total_downloaded < expected_total_bytes {
                    let err_msg = format!("Incomplete transfer: downloaded {} of {} bytes", total_downloaded, expected_total_bytes);
                    let _ = coord_db.save_download_error(&coord_dl_id, &err_msg);
                    emit_error_handle(&coord_app_handle, &coord_dl_id, &err_msg);
                    return;
                }

                // Verify SHA-256 hash if expected
                let mut sha_ok = true;
                if let Some(ref expected) = expected_sha256 {
                    if let Ok(mut f) = std::fs::File::open(&coord_target_path) {
                        let mut hasher = Sha256::new();
                        let mut buf = vec![0u8; 65536];
                        while let Ok(n) = f.read(&mut buf) {
                            if n == 0 { break; }
                            hasher.update(&buf[..n]);
                        }
                        let calculated = format!("{:x}", hasher.finalize());
                        if !calculated.eq_ignore_ascii_case(expected) {
                            sha_ok = false;
                            let err_msg = format!("SHA-256 mismatch (expected {}, calculated {})", expected, calculated);
                            let _ = coord_db.save_download_error(&coord_dl_id, &err_msg);
                            emit_error_handle(&coord_app_handle, &coord_dl_id, &err_msg);
                            return;
                        }
                    }
                }

                // Completion is reported ONLY after all expected bytes have been written and verified
                let _ = coord_db.save_download_checkpoint(&coord_dl_id, total_downloaded, "completed");
                emit_completed_handle(&coord_app_handle, &DownloadCompletedPayload {
                    id: coord_dl_id.clone(),
                    destination_path: coord_target_path.to_string_lossy().to_string(),
                    total_bytes: total_downloaded,
                    sha256_verified: sha_ok,
                });
                emit_status_handle(&coord_app_handle, &coord_dl_id, "completed");
            } else {
                let err_msg = first_error.unwrap_or_else(|| "Download failed".to_string());
                let _ = coord_db.save_download_error(&coord_dl_id, &err_msg);
                emit_error_handle(&coord_app_handle, &coord_dl_id, &err_msg);
            }
        });

        Ok(())
    }

    pub async fn pause_download(&self, id: &str) -> Result<(), String> {
        let task = {
            let mut tasks = self.active_tasks.write();
            tasks.remove(id)
        };

        if let Some(t) = task {
            let _ = t.cancel_tx.send(());
        }

        // Never reset downloaded_bytes to zero on pause!
        let _ = self.db.update_download_status(id, "paused");
        self.emit_status_changed(id, "paused");
        Ok(())
    }

    pub async fn resume_download(&self, id: &str) -> Result<(), String> {
        if let Some(record) = self.db.get_download(id).map_err(|e| e.to_string())? {
            // Restore secure credentials if saved so authenticated transfers do not lose credentials
            let (username, password, headers, cookies) = match self.db.get_secure_credentials(id) {
                Ok(Some(creds)) => (creds.username, creds.password, creds.headers, creds.cookies),
                _ => (None, None, None, None),
            };

            let req = DownloadRequest {
                id: record.id,
                url: record.url,
                destination_path: PathBuf::from(record.directory).join(record.filename).to_string_lossy().to_string(),
                total_bytes: record.total_bytes,
                segments_count: record.segments_count,
                expected_sha256: record.sha256_expected,
                headers,
                cookies,
                username,
                password,
            };
            self.start_download(req).await
        } else {
            Err(format!("Download with id {} not found", id))
        }
    }

    pub async fn cancel_download(&self, id: &str) -> Result<(), String> {
        let task = {
            let mut tasks = self.active_tasks.write();
            tasks.remove(id)
        };

        if let Some(t) = task {
            let _ = t.cancel_tx.send(());
        }

        let _ = self.db.update_download_status(id, "failed");
        self.emit_status_changed(id, "failed");
        Ok(())
    }
}

/// Prevent directory traversal and Windows reserved filenames (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
pub fn validate_and_sanitize_path(input_path: &str) -> Result<PathBuf, String> {
    if input_path.contains("..") {
        return Err("Security error: Path traversal sequence ('..') detected".to_string());
    }

    if input_path.contains('\0') {
        return Err("Security error: Null byte in path is prohibited".to_string());
    }

    let path = PathBuf::from(input_path);
    if let Some(fname) = path.file_name() {
        let fname_str = fname.to_string_lossy();
        let stem = Path::new(&*fname_str).file_stem().and_then(|s| s.to_str()).unwrap_or("");
        
        let reserved = [
            "con", "prn", "aux", "nul",
            "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
            "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
        ];

        if reserved.contains(&stem.to_ascii_lowercase().as_str()) {
            return Err(format!("Security error: '{}' is a Windows reserved device name", fname_str));
        }

        if fname_str.contains('/') || fname_str.contains('\\') {
            return Err("Security error: Invalid slash characters in filename".to_string());
        }
    }

    Ok(path)
}

/// Sanitize browser-supplied filenames:
/// - Strips directory traversal, drive specifiers, and absolute paths.
/// - Strips Windows illegal characters: < > : " / \ | ? * and control chars.
/// - Prevents Windows reserved device names (CON, PRN, AUX, NUL, COM1..9, LPT1..9).
/// - Guarantees non-empty filename.
pub fn sanitize_browser_filename(raw_filename: &str) -> String {
    let raw = raw_filename.trim();
    let cleaned_name = Path::new(raw)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "download.dat".to_string());

    let safe_chars: String = cleaned_name
        .chars()
        .filter(|&c| c >= ' ' && !['<', '>', ':', '"', '/', '\\', '|', '?', '*', '\0'].contains(&c))
        .collect();

    let safe_trimmed = safe_chars.trim_matches(|c| c == ' ' || c == '.').to_string();
    let final_name = if safe_trimmed.is_empty() {
        "download.dat".to_string()
    } else {
        safe_trimmed
    };

    let stem = Path::new(&final_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let reserved = [
        "con", "prn", "aux", "nul",
        "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
        "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
    ];

    if reserved.contains(&stem.as_str()) {
        format!("nova_{}", final_name)
    } else {
        final_name
    }
}

/// Generates a non-colliding destination file path inside target_dir.
/// If `filename` already exists in `target_dir`, appends ` (1)`, ` (2)` to avoid unintended overwrites.
pub fn resolve_non_colliding_path(target_dir: &Path, filename: &str) -> PathBuf {
    let safe_name = sanitize_browser_filename(filename);
    let mut candidate = target_dir.join(&safe_name);

    if !candidate.exists() {
        return candidate;
    }

    let stem = Path::new(&safe_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let ext = Path::new(&safe_name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();

    let mut counter = 1;
    loop {
        let new_name = format!("{} ({}){}", stem, counter, ext);
        candidate = target_dir.join(&new_name);
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
        if counter > 10000 {
            break;
        }
    }
    candidate
}

/// Mask credentials in URLs to protect privacy and prevent logging secrets
pub fn mask_credentials(url: &str) -> String {
    if let Ok(mut parsed) = url::Url::parse(url) {
        if !parsed.password().unwrap_or("").is_empty() {
            let _ = parsed.set_password(Some("********"));
            return parsed.to_string();
        }
    }
    url.to_string()
}

pub fn extract_filename(url: &str, disposition: Option<&str>) -> String {
    if let Some(disp) = disposition {
        // RFC 5987 / RFC 6266 filename*=UTF-8''
        if let Some(start) = disp.find("filename*=") {
            let rest = &disp[start + 10..];
            if let Some(utf_start) = rest.find("UTF-8''") {
                let name = &rest[utf_start + 7..];
                let end = name.find(';').unwrap_or(name.len());
                return name[..end].trim_matches('"').trim().to_string();
            }
        }
        if let Some(start) = disp.find("filename=") {
            let rest = &disp[start + 9..];
            let end = rest.find(';').unwrap_or(rest.len());
            return rest[..end].trim_matches('"').trim().to_string();
        }
    }

    extract_filename_from_url(url)
}

pub fn extract_filename_from_url(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        if let Some(segments) = parsed.path_segments() {
            if let Some(last) = segments.last() {
                if !last.is_empty() && last.contains('.') {
                    return last.to_string();
                }
            }
        }
    }
    format!("download_{}.dat", chrono::Utc::now().timestamp())
}

/// Compute SHA-256 of downloaded file
pub async fn verify_checksum(path: &str, expected_hash: &str) -> Result<bool, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    let result = hasher.finalize();
    let calculated = hex::encode(result);
    Ok(calculated.eq_ignore_ascii_case(expected_hash))
}
// Missing event helper functions used by FTP and SFTP downloads.

fn emit_error_handle(
    app_handle: &Arc<RwLock<Option<tauri::AppHandle>>>,
    id: &str,
    error: &str,
) {
    use tauri::Emitter;

    if let Some(handle) = app_handle.read().as_ref() {
        let payload = DownloadErrorPayload {
            id: id.to_string(),
            error: error.to_string(),
        };
        let _ = handle.emit("download-error", payload);
    }
}

fn emit_status_handle(
    app_handle: &Arc<RwLock<Option<tauri::AppHandle>>>,
    id: &str,
    status: &str,
) {
    use tauri::Emitter;

    if let Some(handle) = app_handle.read().as_ref() {
        let payload = DownloadStatusPayload {
            id: id.to_string(),
            status: status.to_string(),
        };
        let _ = handle.emit("download-status-changed", payload);
    }
}

fn emit_progress_handle(
    app_handle: &Arc<RwLock<Option<tauri::AppHandle>>>,
    payload: &DownloadProgressPayload,
) {
    use tauri::Emitter;

    if let Some(handle) = app_handle.read().as_ref() {
        let _ = handle.emit("download-progress", payload);
    }
}

fn emit_completed_handle(
    app_handle: &Arc<RwLock<Option<tauri::AppHandle>>>,
    payload: &DownloadCompletedPayload,
) {
    use tauri::Emitter;

    if let Some(handle) = app_handle.read().as_ref() {
        let _ = handle.emit("download-completed", payload);
    }
}
