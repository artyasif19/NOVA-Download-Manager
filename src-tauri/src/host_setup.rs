//! First-run / every-run setup that makes the browser extension work without manual steps:
//!  - copies `nova_host.exe` (the native messaging helper) to %LOCALAPPDATA%\NOVA
//!  - writes the native-messaging manifests and registers them for Chrome, Edge, Brave,
//!    Chromium, Vivaldi and Firefox (current-user registry, no admin rights needed)
//!  - copies the bundled browser extensions to %LOCALAPPDATA%\NOVA\extension\{chrome,firefox}
//!  - Windows "start with PC" (autostart) and small helpers to open folders / browser pages

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

const HOST_NAME: &str = "com.nova.downloadmanager";
// Fixed by the "key" field in extension/chrome/manifest.json
const CHROME_EXTENSION_ID: &str = "pmkbechehklelnopohiefbcafghkjjil";
const FIREFOX_EXTENSION_ID: &str = "extension@nova-download-manager.local";

#[cfg(windows)]
pub fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
pub fn hide_window(_cmd: &mut Command) {}

pub fn nova_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("NOVA")
}

/// Folders where bundled helper files may live after installation.
pub fn resource_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        roots.push(res.join("binaries"));
        roots.push(res.clone());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.join("binaries"));
            roots.push(parent.to_path_buf());
        }
    }
    roots
}

/// Finds a bundled file by name: first in the usual folders, then by searching a few levels deep.
pub fn find_resource_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let roots = resource_roots(app);
    for root in &roots {
        let p = root.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    for root in &roots {
        if let Some(p) = search_file(root, name, 4) {
            return Some(p);
        }
    }
    None
}

fn search_file(dir: &Path, name: &str, depth: u32) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path.file_name().map(|n| n.to_string_lossy().eq_ignore_ascii_case(name)).unwrap_or(false) {
                return Some(path);
            }
        } else if path.is_dir() {
            subdirs.push(path);
        }
    }
    subdirs.into_iter().find_map(|d| search_file(&d, name, depth - 1))
}

/// Finds a bundled extension folder (the one that contains manifest.json).
fn find_extension_source(app: &AppHandle, browser: &str) -> Option<PathBuf> {
    for root in resource_roots(app) {
        for rel in [format!("extension/{}", browser), format!("ext-{}", browser)] {
            let p = root.join(&rel);
            if p.join("manifest.json").is_file() {
                return Some(p);
            }
        }
    }
    None
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn reg_set_default(key: &str, value: &str) {
    let mut cmd = Command::new("reg");
    cmd.args(["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"]);
    hide_window(&mut cmd);
    let _ = cmd.output();
}

/// Installs everything the browser extension needs. Safe to run on every start.
pub fn ensure_native_host(app: &AppHandle) -> Result<(), String> {
    let base = nova_dir();
    std::fs::create_dir_all(&base).map_err(|e| format!("Cannot create {}: {}", base.display(), e))?;

    // 1. Native helper
    let host_dst = base.join("nova_host.exe");
    if let Some(src) = find_resource_file(app, "nova_host.exe") {
        // Ignore copy errors (the file can be locked while a browser is using it)
        let _ = std::fs::copy(&src, &host_dst);
    }
    if !host_dst.is_file() {
        return Err("nova_host.exe was not found in the installation".to_string());
    }

    // 2. Extensions -> stable folders
    for browser in ["chrome", "firefox"] {
        if let Some(src) = find_extension_source(app, browser) {
            let _ = copy_dir(&src, &base.join("extension").join(browser));
        }
    }

    // 3. Manifests
    let host_path = host_dst.to_string_lossy().to_string();
    let chrome_manifest = serde_json::json!({
        "name": HOST_NAME,
        "description": "NOVA Download Manager Native Messaging Host",
        "path": host_path,
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{}/", CHROME_EXTENSION_ID)]
    });
    let firefox_manifest = serde_json::json!({
        "name": HOST_NAME,
        "description": "NOVA Download Manager Native Messaging Host",
        "path": host_path,
        "type": "stdio",
        "allowed_extensions": [FIREFOX_EXTENSION_ID]
    });
    let chrome_manifest_path = base.join("com.nova.downloadmanager.json");
    let firefox_manifest_path = base.join("com.nova.downloadmanager.firefox.json");
    std::fs::write(&chrome_manifest_path, serde_json::to_string_pretty(&chrome_manifest).unwrap_or_default())
        .map_err(|e| e.to_string())?;
    std::fs::write(&firefox_manifest_path, serde_json::to_string_pretty(&firefox_manifest).unwrap_or_default())
        .map_err(|e| e.to_string())?;

    // 4. Registry registration (current user)
    let chrome_path = chrome_manifest_path.to_string_lossy().to_string();
    let firefox_path = firefox_manifest_path.to_string_lossy().to_string();
    for vendor in [
        r"HKCU\Software\Google\Chrome\NativeMessagingHosts",
        r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts",
        r"HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
        r"HKCU\Software\Chromium\NativeMessagingHosts",
        r"HKCU\Software\Vivaldi\NativeMessagingHosts",
    ] {
        reg_set_default(&format!(r"{}\{}", vendor, HOST_NAME), &chrome_path);
    }
    reg_set_default(
        &format!(r"HKCU\Software\Mozilla\NativeMessagingHosts\{}", HOST_NAME),
        &firefox_path,
    );

    register_link_handlers();
    Ok(())
}

#[derive(serde::Serialize)]
pub struct ExtensionInfo {
    pub chrome_dir: String,
    pub firefox_dir: String,
    pub chrome_ready: bool,
    pub firefox_ready: bool,
    pub host_ready: bool,
}

#[tauri::command]
pub fn get_extension_info(app: AppHandle) -> ExtensionInfo {
    // Make sure everything is in place before reporting
    let _ = ensure_native_host(&app);
    let base = nova_dir();
    let chrome = base.join("extension").join("chrome");
    let firefox = base.join("extension").join("firefox");
    ExtensionInfo {
        chrome_dir: chrome.to_string_lossy().to_string(),
        firefox_dir: firefox.to_string_lossy().to_string(),
        chrome_ready: chrome.join("manifest.json").is_file(),
        firefox_ready: firefox.join("manifest.json").is_file(),
        host_ready: base.join("nova_host.exe").is_file(),
    }
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Folder does not exist yet".to_string());
    }
    Command::new("explorer").arg(&p).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Opens the extensions page of a browser (chrome | edge | brave).
#[tauri::command]
pub fn open_browser_extensions(browser: String) -> Result<(), String> {
    let (exe, url) = match browser.as_str() {
        "edge" => ("msedge", "edge://extensions"),
        "brave" => ("brave", "brave://extensions"),
        "firefox" => ("firefox", "about:debugging#/runtime/this-firefox"),
        _ => ("chrome", "chrome://extensions"),
    };
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "start", "", exe, url]);
    hide_window(&mut cmd);
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Enables / disables "start NOVA when Windows starts" (current user Run key).
#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let mut cmd = Command::new("reg");
    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let value = format!("\"{}\" --minimized", exe.display());
        cmd.args(["add", key, "/v", "NOVA", "/t", "REG_SZ", "/d", value.as_str(), "/f"]);
    } else {
        cmd.args(["delete", key, "/v", "NOVA", "/f"]);
    }
    hide_window(&mut cmd);
    cmd.output().map_err(|e| e.to_string())?;
    Ok(())
}

/// Brings the main window to the front (used when the browser sends a download).
pub fn bring_to_front(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn reg_set_value(key: &str, name: &str, value: &str) {
    let mut cmd = Command::new("reg");
    cmd.args(["add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"]);
    hide_window(&mut cmd);
    let _ = cmd.output();
}

/// Lets Windows offer NOVA for magnet: links and .torrent files ("Open with" / default apps).
fn register_link_handlers() {
    let exe = match std::env::current_exe() {
        Ok(e) => e.to_string_lossy().to_string(),
        Err(_) => return,
    };
    let open_cmd = format!("\"{}\" \"%1\"", exe);

    let magnet = r"HKCU\Software\Classes\magnet";
    reg_set_default(magnet, "URL:Magnet Link");
    reg_set_value(magnet, "URL Protocol", "");
    reg_set_default(&format!(r"{}\shell\open\command", magnet), &open_cmd);

    let prog = r"HKCU\Software\Classes\NOVA.Torrent";
    reg_set_default(prog, "BitTorrent file");
    reg_set_default(&format!(r"{}\shell\open\command", prog), &open_cmd);
    reg_set_value(r"HKCU\Software\Classes\.torrent\OpenWithProgids", "NOVA.Torrent", "");
}

/// Sends a magnet link / .torrent path to an already running NOVA. Returns true when it was taken.
pub fn forward_link_to_running_instance(link: &str) -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;

    let try_forward = || -> Option<bool> {
        let content = std::fs::read_to_string(nova_dir().join("session.auth")).ok()?;
        let v: serde_json::Value = serde_json::from_str(&content).ok()?;
        let port = v.get("port")?.as_u64()? as u16;
        let token = v.get("token")?.as_str()?.to_string();
        let body = serde_json::json!({ "url": link }).to_string();
        let mut stream =
            TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(800)).ok()?;
        stream.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
        let req = format!(
            "POST /api/open_link HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            token,
            body.len(),
            body
        );
        stream.write_all(req.as_bytes()).ok()?;
        let mut resp = String::new();
        let _ = stream.read_to_string(&mut resp);
        Some(resp.contains(" 200 "))
    };
    try_forward().unwrap_or(false)
}

/// Opens a finished file with its default program.
#[tauri::command]
pub fn open_file(path: String) -> Result<(), String> {
    if !PathBuf::from(&path).exists() {
        return Err("The file does not exist".to_string());
    }
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "start", "", path.as_str()]);
    hide_window(&mut cmd);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Shows a file selected inside its folder in Windows Explorer.
#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        return Command::new("explorer").arg(&p).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    if !p.exists() {
        // fall back to the folder
        if let Some(parent) = p.parent() {
            return Command::new("explorer").arg(parent).spawn().map(|_| ()).map_err(|e| e.to_string());
        }
        return Err("The file does not exist".to_string());
    }
    Command::new("explorer")
        .args(["/select,", path.as_str()])
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
