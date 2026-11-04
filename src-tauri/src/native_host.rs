/**
 * NOVA Download Manager - Windows Native Messaging Host Binary
 * Communicates with Chromium & Firefox extensions using 32-bit native length prefix over stdin/stdout.
 * Connects securely to the running NOVA desktop application via authenticated local IPC.
 * Never returns fake diagnostic responses or simulates success.
 */

use std::io::{self, Read, Write};
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize, Debug)]
struct ExtensionMessage {
    action: String,
    url: Option<String>,
    filename: Option<String>,
    headers: Option<serde_json::Map<String, Value>>,
    cookies: Option<String>,
    category: Option<String>,
    download_id: Option<String>,
    client: Option<String>,
    referrer: Option<String>,
    total_bytes: Option<u64>,
    mime_type: Option<String>,
    video: Option<bool>,
    quality: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
struct SessionConfig {
    port: u16,
    token: String,
    pid: u32,
}

#[derive(Serialize, Deserialize, Debug)]
struct HostResponse {
    status: String,
    version: String,
    message: String,
    accepted: bool,
    received_action: String,
    data: Option<Value>,
    error: Option<String>,
}

fn get_session_file_path() -> PathBuf {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        PathBuf::from(local_app_data).join("NOVA").join("session.auth")
    } else {
        std::env::temp_dir().join("nova-session.auth")
    }
}

fn load_session() -> Option<SessionConfig> {
    let path = get_session_file_path();
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<SessionConfig>(&content).ok()
}

fn forward_to_engine(endpoint: &str, body: &Value, session: &SessionConfig) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(3000))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("http://127.0.0.1:{}/api/{}", session.port, endpoint);
    let resp = client.post(&url)
        .header("Authorization", format!("Bearer {}", session.token))
        .json(body)
        .send()
        .map_err(|e| format!("Failed to reach NOVA engine on 127.0.0.1:{}: {}", session.port, e))?;

    let json_val = resp.json::<Value>().map_err(|e| format!("Invalid JSON from engine: {}", e))?;
    Ok(json_val)
}

fn main() -> io::Result<()> {
    let mut stdin = io::stdin();
    let mut stdout = io::stdout();

    loop {
        // Read 32-bit length prefix (native endian)
        let mut length_buf = [0u8; 4];
        if stdin.read_exact(&mut length_buf).is_err() {
            // End of stream / browser closed extension port
            break;
        }

        let msg_len = u32::from_ne_bytes(length_buf) as usize;
        if msg_len == 0 || msg_len > 10 * 1024 * 1024 {
            // Buffer safety threshold
            break;
        }

        // Read payload
        let mut payload_buf = vec![0u8; msg_len];
        if stdin.read_exact(&mut payload_buf).is_err() {
            break;
        }

        if let Ok(msg) = serde_json::from_slice::<ExtensionMessage>(&payload_buf) {
            let session_opt = load_session();

            let response = match session_opt {
                None => {
                    // Application is offline: report truth honestly so browser does not lose download
                    HostResponse {
                        status: "offline".to_string(),
                        version: "2.4.0".to_string(),
                        message: "NOVA desktop application is not currently running.".to_string(),
                        accepted: false,
                        received_action: msg.action.clone(),
                        data: None,
                        error: Some("NOVA_ENGINE_NOT_RUNNING".to_string()),
                    }
                }
                Some(session) => {
                    let msg_json = serde_json::to_value(&msg).unwrap_or(Value::Null);

                    match msg.action.as_str() {
                        "ping" => {
                            match forward_to_engine("ping", &msg_json, &session) {
                                Ok(data) => HostResponse {
                                    status: "online".to_string(),
                                    version: "2.4.0".to_string(),
                                    message: "NOVA Native Bridge connected to active engine.".to_string(),
                                    accepted: true,
                                    received_action: "ping".to_string(),
                                    data: Some(data),
                                    error: None,
                                },
                                Err(err) => HostResponse {
                                    status: "offline".to_string(),
                                    version: "2.4.0".to_string(),
                                    message: "Engine IPC connection failed.".to_string(),
                                    accepted: false,
                                    received_action: "ping".to_string(),
                                    data: None,
                                    error: Some(err),
                                },
                            }
                        }
                        "can_handle" => {
                            // Forward download candidate to engine to verify protocol and disk availability
                            match forward_to_engine("can_handle", &msg_json, &session) {
                                Ok(data) => {
                                    let is_accepted = data.get("accepted").and_then(|v| v.as_bool()).unwrap_or(false);
                                    HostResponse {
                                        status: if is_accepted { "accepted".to_string() } else { "rejected".to_string() },
                                        version: "2.4.0".to_string(),
                                        message: if is_accepted {
                                            "Download handoff accepted by NOVA engine.".to_string()
                                        } else {
                                            "Download handoff declined by NOVA engine.".to_string()
                                        },
                                        accepted: is_accepted,
                                        received_action: "can_handle".to_string(),
                                        data: Some(data),
                                        error: None,
                                    }
                                }
                                Err(err) => HostResponse {
                                    status: "rejected".to_string(),
                                    version: "2.4.0".to_string(),
                                    message: "Failed to communicate with engine for handoff.".to_string(),
                                    accepted: false,
                                    received_action: "can_handle".to_string(),
                                    data: None,
                                    error: Some(err),
                                },
                            }
                        }
                        "add_download" => {
                            match forward_to_engine("downloads", &msg_json, &session) {
                                Ok(data) => HostResponse {
                                    status: "success".to_string(),
                                    version: "2.4.0".to_string(),
                                    message: "Download queued successfully in NOVA engine.".to_string(),
                                    accepted: true,
                                    received_action: "add_download".to_string(),
                                    data: Some(data),
                                    error: None,
                                },
                                Err(err) => HostResponse {
                                    status: "error".to_string(),
                                    version: "2.4.0".to_string(),
                                    message: "Failed to add download to engine.".to_string(),
                                    accepted: false,
                                    received_action: "add_download".to_string(),
                                    data: None,
                                    error: Some(err),
                                },
                            }
                        }
                        "pause_download" | "resume_download" | "cancel_download" | "get_status" => {
                            let endpoint = format!("{}/{}", msg.action, msg.download_id.as_deref().unwrap_or(""));
                            match forward_to_engine(&endpoint, &msg_json, &session) {
                                Ok(data) => HostResponse {
                                    status: "success".to_string(),
                                    version: "2.4.0".to_string(),
                                    message: format!("Operation '{}' succeeded.", msg.action),
                                    accepted: true,
                                    received_action: msg.action,
                                    data: Some(data),
                                    error: None,
                                },
                                Err(err) => HostResponse {
                                    status: "error".to_string(),
                                    version: "2.4.0".to_string(),
                                    message: format!("Operation '{}' failed.", msg.action),
                                    accepted: false,
                                    received_action: msg.action,
                                    data: None,
                                    error: Some(err),
                                },
                            }
                        }
                        _ => HostResponse {
                            status: "error".to_string(),
                            version: "2.4.0".to_string(),
                            message: format!("Unrecognized action: {}", msg.action),
                            accepted: false,
                            received_action: msg.action,
                            data: None,
                            error: Some("UNRECOGNIZED_ACTION".to_string()),
                        },
                    }
                }
            };

            let resp_bytes = serde_json::to_vec(&response)?;
            let resp_len = (resp_bytes.len() as u32).to_ne_bytes();

            stdout.write_all(&resp_len)?;
            stdout.write_all(&resp_bytes)?;
            stdout.flush()?;
        }
    }

    Ok(())
}
