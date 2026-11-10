//! Small stand-alone pop-up windows (like IDM's "Download File Info" and progress windows).
//! They are separate windows, so downloads can be confirmed and watched without opening the main app.

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

static COUNTER: AtomicU64 = AtomicU64::new(1);

/// Opens a pop-up. `kind` is "confirm" or "progress"; `data` is handed to the page as JSON.
pub fn open(app: &AppHandle, kind: &str, data: &serde_json::Value) -> Result<(), String> {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("{}-{}", kind, n);
    let encoded: String = url::form_urlencoded::byte_serialize(data.to_string().as_bytes()).collect();
    let path = format!("index.html?w={}&d={}", kind, encoded);

    let (width, height, title, on_top) = match kind {
        "confirm" => (620.0, 360.0, "NOVA - Download File Info", true),
        "progress" => (580.0, 500.0, "NOVA - Download", true),
        _ => (520.0, 320.0, "NOVA", false),
    };

    WebviewWindowBuilder::new(app, label, WebviewUrl::App(path.into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(width, 260.0)
        .resizable(true)
        .maximizable(false)
        .always_on_top(on_top)
        .focused(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn open_dialog(app: AppHandle, kind: String, data: serde_json::Value) -> Result<(), String> {
    open(&app, &kind, &data)
}
