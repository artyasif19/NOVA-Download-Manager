//! Network settings shared by every downloader: proxy and the number of parallel downloads.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use serde::Deserialize;

static PROXY: Mutex<Option<String>> = Mutex::new(None);
static MAX_CONCURRENT: AtomicUsize = AtomicUsize::new(3);

#[derive(Debug, Clone, Deserialize)]
pub struct ProxyConfig {
    /// none | http | socks5
    pub mode: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

/// The proxy every downloader should use right now (None = connect directly).
pub fn current_proxy() -> Option<String> {
    PROXY.lock().ok().and_then(|g| g.clone())
}

pub fn max_concurrent() -> usize {
    MAX_CONCURRENT.load(Ordering::Relaxed).max(1)
}

fn build_proxy_url(cfg: &ProxyConfig) -> Option<String> {
    let scheme = match cfg.mode.as_str() {
        "http" => "http",
        "socks5" => "socks5h",
        _ => return None,
    };
    let host = cfg.host.trim();
    if host.is_empty() || cfg.port == 0 {
        return None;
    }
    let mut url = url::Url::parse(&format!("{}://{}:{}", scheme, host, cfg.port)).ok()?;
    if !cfg.username.is_empty() {
        let _ = url.set_username(&cfg.username);
        let _ = url.set_password(if cfg.password.is_empty() { None } else { Some(cfg.password.as_str()) });
    }
    Some(url.to_string())
}

#[tauri::command]
pub fn set_network_config(config: ProxyConfig) -> Result<(), String> {
    let built = build_proxy_url(&config);
    if let Ok(mut guard) = PROXY.lock() {
        *guard = built;
    }
    Ok(())
}

#[tauri::command]
pub fn set_max_concurrent(value: usize) {
    MAX_CONCURRENT.store(value.clamp(1, 20), Ordering::Relaxed);
}
