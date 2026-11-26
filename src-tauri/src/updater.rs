//! In-app updates.
//!  - NOVA: looks at the latest GitHub Release, downloads the installer (checksum verified when GitHub
//!    provides one) and runs it. The installer upgrades NOVA in place; settings and downloads stay.
//!  - yt-dlp: the video downloader breaks when sites change, so it can be updated on its own. The new
//!    copy is stored in %LOCALAPPDATA%\NOVA\tools and used instead of the one inside the installer.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const REPO: &str = "artyasif19/NOVA-Download-Manager";
const USER_AGENT: &str = "NOVA-Download-Manager-Updater";

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(15))
        // honour the proxy chosen in NOVA's settings
        .proxy(reqwest::Proxy::custom(|_url| {
            crate::net_config::current_proxy().and_then(|p| reqwest::Url::parse(&p).ok())
        }))
        .build()
        .map_err(|e| e.to_string())
}

fn parse_version(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(|c: char| c == 'v' || c == 'V')
        .split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .map(|p| p.parse::<u64>().unwrap_or(0))
        .collect()
}

/// True when `latest` is a higher version than `current` (2.10.0 > 2.9.0, v2.5 > 2.4.1)
fn is_newer(latest: &str, current: &str) -> bool {
    let a = parse_version(latest);
    let b = parse_version(current);
    for i in 0..a.len().max(b.len()) {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        if x != y {
            return x > y;
        }
    }
    false
}

#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

// ---------------------------------------------------------------------------
// NOVA
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current: String,
    pub latest: String,
    pub name: String,
    pub notes: String,
    pub page_url: String,
    pub asset_name: String,
    pub asset_url: String,
    pub asset_size: u64,
    pub sha256: String,
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let res = http()?
        .get(format!("https://api.github.com/repos/{}/releases/latest", REPO))
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {}", e))?;

    let status = res.status();
    if status.as_u16() == 404 {
        return Err("No public release was found. The NOVA repository or its releases may still be private.".to_string());
    }
    if !status.is_success() {
        return Err(format!("GitHub answered with an error ({}). Try again later.", status));
    }
    let v: Value = res.json().await.map_err(|e| format!("Unreadable answer from GitHub: {}", e))?;

    let tag = v.get("tag_name").and_then(|t| t.as_str()).unwrap_or("").to_string();
    if tag.is_empty() {
        return Err("The latest release has no version number.".to_string());
    }

    // the Windows installer: "...-setup.exe" (any other .exe as a fallback)
    let assets = v.get("assets").and_then(|a| a.as_array()).cloned().unwrap_or_default();
    let pick = |suffix: &str| {
        assets.iter().find(|a| {
            a.get("name")
                .and_then(|n| n.as_str())
                .map(|n| n.to_lowercase().ends_with(suffix))
                .unwrap_or(false)
        })
    };
    let asset = pick("-setup.exe").or_else(|| pick(".exe"));

    let (asset_name, asset_url, asset_size, sha256) = match asset {
        Some(a) => (
            a.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            a.get("browser_download_url").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            a.get("size").and_then(|x| x.as_u64()).unwrap_or(0),
            a.get("digest")
                .and_then(|x| x.as_str())
                .map(|d| d.trim_start_matches("sha256:").to_lowercase())
                .unwrap_or_default(),
        ),
        None => (String::new(), String::new(), 0, String::new()),
    };

    Ok(UpdateInfo {
        available: is_newer(&tag, &current),
        current,
        latest: tag.trim_start_matches(|c: char| c == 'v' || c == 'V').to_string(),
        name: v.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
        notes: v.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string(),
        page_url: v.get("html_url").and_then(|u| u.as_str()).unwrap_or("").to_string(),
        asset_name,
        asset_url,
        asset_size,
        sha256,
    })
}

#[derive(Serialize, Clone)]
struct UpdateProgress {
    downloaded: u64,
    total: u64,
    speed: u64,
}

fn update_dir() -> PathBuf {
    std::env::temp_dir().join("NOVA-update")
}

/// Downloads the installer and returns where it was saved.
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    url: String,
    name: String,
    size: u64,
    sha256: String,
) -> Result<String, String> {
    let allowed = format!("https://github.com/{}/releases/download/", REPO);
    if !url.starts_with(&allowed) {
        return Err("The update link is not from NOVA's GitHub releases.".to_string());
    }
    let safe_name: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if safe_name.is_empty() || !safe_name.to_lowercase().ends_with(".exe") {
        return Err("The update file is not an installer.".to_string());
    }

    let dir = update_dir();
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create the update folder: {}", e))?;
    let target = dir.join(&safe_name);

    let res = http()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("Download failed ({}).", res.status()));
    }
    let total = res.content_length().unwrap_or(size);

    let mut file = tokio::fs::File::create(&target)
        .await
        .map_err(|e| format!("Cannot write the update: {}", e))?;
    let mut hasher = Sha256::new();
    let mut stream = res.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut first_bytes: Vec<u8> = Vec::new();
    let started = Instant::now();
    let mut last_emit = Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download interrupted: {}", e))?;
        if first_bytes.len() < 2 {
            first_bytes.extend_from_slice(&chunk[..chunk.len().min(2)]);
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| format!("Cannot write the update: {}", e))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() > Duration::from_millis(250) {
            last_emit = Instant::now();
            let secs = started.elapsed().as_secs_f64().max(0.001);
            let _ = app.emit(
                "update-progress",
                UpdateProgress { downloaded, total, speed: (downloaded as f64 / secs) as u64 },
            );
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    let _ = app.emit("update-progress", UpdateProgress { downloaded, total, speed: 0 });

    if total > 0 && downloaded != total {
        let _ = std::fs::remove_file(&target);
        return Err("The download was incomplete. Please try again.".to_string());
    }
    if first_bytes.len() < 2 || first_bytes[0] != b'M' || first_bytes[1] != b'Z' {
        let _ = std::fs::remove_file(&target);
        return Err("The downloaded file is not a Windows installer.".to_string());
    }
    if !sha256.is_empty() {
        let got = hex::encode(hasher.finalize());
        if !got.eq_ignore_ascii_case(&sha256) {
            let _ = std::fs::remove_file(&target);
            return Err("The downloaded file failed its safety check (checksum mismatch).".to_string());
        }
    }
    Ok(target.to_string_lossy().to_string())
}

/// Starts the downloaded installer and closes NOVA so the installer can replace its files.
#[tauri::command]
pub fn install_update(app: AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let in_update_dir = p.starts_with(update_dir());
    if !in_update_dir || !p.is_file() || !path.to_lowercase().ends_with(".exe") {
        return Err("That file is not a downloaded NOVA update.".to_string());
    }

    let mut cmd = Command::new(p);
    // passive: shows progress only; update mode: keeps settings; relaunch NOVA when done
    cmd.args(["/UPDATE", "/P", "/R"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP: the installer outlives NOVA
        cmd.creation_flags(0x0000_0008 | 0x0000_0200);
    }
    cmd.spawn().map_err(|e| format!("Could not start the installer: {}", e))?;

    std::thread::sleep(Duration::from_millis(600));
    app.exit(0);
    Ok(())
}

/// Opens a NOVA GitHub page in the browser (release notes, issues, profile).
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let ok = url.starts_with("https://github.com/artyasif19/") || url.starts_with("https://github.com/yt-dlp/");
    if !ok {
        return Err("Only NOVA's GitHub pages can be opened from here.".to_string());
    }
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "start", "", url.as_str()]);
    hide_window(&mut cmd);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// yt-dlp
// ---------------------------------------------------------------------------

/// The updated yt-dlp (preferred over the copy inside the installer when it exists).
pub fn ytdlp_override_path() -> PathBuf {
    crate::host_setup::nova_dir().join("tools").join("yt-dlp.exe")
}

async fn run_version(exe: &Path) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.arg("--version").kill_on_drop(true);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }
    let out = tokio::time::timeout(Duration::from_secs(40), cmd.output())
        .await
        .map_err(|_| "yt-dlp did not answer in time".to_string())?
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("yt-dlp could not start".to_string());
    }
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if v.is_empty() {
        return Err("yt-dlp gave no version".to_string());
    }
    Ok(v)
}

#[tauri::command]
pub async fn ytdlp_version(app: AppHandle) -> Result<String, String> {
    let exe = crate::video::find_tool(&app, "yt-dlp.exe").ok_or_else(|| "yt-dlp was not found".to_string())?;
    run_version(&exe).await
}

#[derive(Serialize)]
pub struct YtdlpUpdate {
    pub updated: bool,
    pub old_version: String,
    pub new_version: String,
    pub message: String,
}

#[tauri::command]
pub async fn update_ytdlp(app: AppHandle) -> Result<YtdlpUpdate, String> {
    let old_version = match crate::video::find_tool(&app, "yt-dlp.exe") {
        Some(exe) => run_version(&exe).await.unwrap_or_default(),
        None => String::new(),
    };

    let client = http()?;
    let rel = client
        .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {}", e))?;
    if !rel.status().is_success() {
        return Err(format!("GitHub answered with an error ({}).", rel.status()));
    }
    let v: Value = rel.json().await.map_err(|e| e.to_string())?;
    let tag = v.get("tag_name").and_then(|t| t.as_str()).unwrap_or("").to_string();
    if tag.is_empty() {
        return Err("Could not read the latest yt-dlp version.".to_string());
    }

    if !old_version.is_empty() && !is_newer(&tag, &old_version) {
        return Ok(YtdlpUpdate {
            updated: false,
            new_version: old_version.clone(),
            old_version,
            message: "yt-dlp is already up to date.".to_string(),
        });
    }

    let base = format!("https://github.com/yt-dlp/yt-dlp/releases/download/{}", tag);
    let tools = ytdlp_override_path().parent().map(|p| p.to_path_buf()).unwrap_or_default();
    std::fs::create_dir_all(&tools).map_err(|e| format!("Cannot create the tools folder: {}", e))?;
    let temp = tools.join("yt-dlp.exe.new");
    let _ = std::fs::remove_file(&temp);

    // download
    let res = client
        .get(format!("{}/yt-dlp.exe", base))
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("Download failed ({}).", res.status()));
    }
    let mut file = tokio::fs::File::create(&temp).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download interrupted: {}", e))?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    let got = hex::encode(hasher.finalize());

    // checksum from the release (SHA2-256SUMS lists "<hash>  yt-dlp.exe")
    if let Ok(sums) = client
        .get(format!("{}/SHA2-256SUMS", base))
        .timeout(Duration::from_secs(20))
        .send()
        .await
    {
        if sums.status().is_success() {
            if let Ok(text) = sums.text().await {
                let expected = text.lines().find_map(|l| {
                    let mut parts = l.split_whitespace();
                    let hash = parts.next()?;
                    let file = parts.next()?;
                    if file.trim_start_matches('*') == "yt-dlp.exe" {
                        Some(hash.to_lowercase())
                    } else {
                        None
                    }
                });
                if let Some(exp) = expected {
                    if exp != got {
                        let _ = std::fs::remove_file(&temp);
                        return Err("The downloaded yt-dlp failed its safety check (checksum mismatch).".to_string());
                    }
                }
            }
        }
    }

    // it must run before it replaces anything
    let new_version = match run_version(&temp).await {
        Ok(v) => v,
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            return Err(format!("The new yt-dlp does not run: {}", e));
        }
    };

    let target = ytdlp_override_path();
    if target.exists() && std::fs::remove_file(&target).is_err() {
        let _ = std::fs::remove_file(&temp);
        return Err("A video download is using yt-dlp right now. Try again when it has finished.".to_string());
    }
    std::fs::rename(&temp, &target).map_err(|e| format!("Could not install the new yt-dlp: {}", e))?;

    Ok(YtdlpUpdate {
        updated: true,
        old_version,
        new_version,
        message: "yt-dlp was updated.".to_string(),
    })
}
