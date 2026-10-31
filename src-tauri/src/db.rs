/**
 * NOVA Download Manager - SQLite Database Layer
 * Local-First Storage for Downloads, History, and Checkpoint Recovery
 */

use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRecord {
    pub id: String,
    pub url: String,
    pub filename: String,
    pub directory: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub status: String,
    pub category: String,
    pub protocol: String,
    pub supports_range: bool,
    pub etag: Option<String>,
    pub mime_type: Option<String>,
    pub date_added: i64,
    pub date_finished: Option<i64>,
    pub sha256_expected: Option<String>,
    pub sha256_calculated: Option<String>,
    pub segments_count: usize,
    pub priority: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentRecord {
    pub id: i64,
    pub download_id: String,
    pub segment_index: usize,
    pub start_byte: u64,
    pub end_byte: u64,
    pub downloaded_bytes: u64,
    pub is_finished: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureCredentials {
    pub download_id: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub cookies: Option<String>,
}

fn get_vault_key() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"NOVA_SECURE_STORAGE_SALT_V2");
    if let Ok(app_data) = std::env::var("APPDATA") {
        hasher.update(app_data.as_bytes());
    }
    if let Ok(user) = std::env::var("USERNAME") {
        hasher.update(user.as_bytes());
    }
    if let Ok(user) = std::env::var("USER") {
        hasher.update(user.as_bytes());
    }
    hasher.finalize().into()
}

pub fn encrypt_secret(plaintext: &str) -> String {
    let key = get_vault_key();
    let iv_bytes: [u8; 16] = rand::random();
    let pt = plaintext.as_bytes();
    let mut ct = Vec::with_capacity(pt.len());

    let mut block_idx: u32 = 0;
    let mut offset = 0;
    while offset < pt.len() {
        let mut h = Sha256::new();
        h.update(&key);
        h.update(&iv_bytes);
        h.update(&block_idx.to_be_bytes());
        let stream_block = h.finalize();

        let to_xor = std::cmp::min(pt.len() - offset, 32);
        for i in 0..to_xor {
            ct.push(pt[offset + i] ^ stream_block[i]);
        }
        offset += to_xor;
        block_idx += 1;
    }

    format!("{}:{}", hex::encode(iv_bytes), hex::encode(ct))
}

pub fn decrypt_secret(encrypted: &str) -> Option<String> {
    let parts: Vec<&str> = encrypted.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let iv_bytes = hex::decode(parts[0]).ok()?;
    if iv_bytes.len() != 16 {
        return None;
    }
    let ct = hex::decode(parts[1]).ok()?;
    let key = get_vault_key();
    let mut pt = Vec::with_capacity(ct.len());

    let mut block_idx: u32 = 0;
    let mut offset = 0;
    while offset < ct.len() {
        let mut h = Sha256::new();
        h.update(&key);
        h.update(&iv_bytes);
        h.update(&block_idx.to_be_bytes());
        let stream_block = h.finalize();

        let to_xor = std::cmp::min(ct.len() - offset, 32);
        for i in 0..to_xor {
            pt.push(ct[offset + i] ^ stream_block[i]);
        }
        offset += to_xor;
        block_idx += 1;
    }

    String::from_utf8(pt).ok()
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn init() -> Result<Self> {
        let db_path = get_database_path();
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(&db_path)?;

        // Execute migrations
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                filename TEXT NOT NULL,
                directory TEXT NOT NULL,
                total_bytes INTEGER NOT NULL,
                downloaded_bytes INTEGER NOT NULL,
                status TEXT NOT NULL,
                category TEXT NOT NULL,
                protocol TEXT NOT NULL DEFAULT 'http',
                supports_range INTEGER NOT NULL,
                etag TEXT,
                mime_type TEXT,
                date_added INTEGER NOT NULL,
                date_finished INTEGER,
                sha256_expected TEXT,
                sha256_calculated TEXT,
                segments_count INTEGER NOT NULL,
                priority TEXT NOT NULL,
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS download_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                download_id TEXT NOT NULL,
                segment_index INTEGER NOT NULL,
                start_byte INTEGER NOT NULL,
                end_byte INTEGER NOT NULL,
                downloaded_bytes INTEGER NOT NULL,
                is_finished INTEGER NOT NULL,
                FOREIGN KEY (download_id) REFERENCES downloads (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS secure_credentials (
                download_id TEXT PRIMARY KEY,
                username TEXT,
                password_encrypted TEXT,
                headers_json TEXT,
                cookies TEXT,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY (download_id) REFERENCES downloads (id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads (status);
            CREATE INDEX IF NOT EXISTS idx_segments_download_id ON download_segments (download_id);
            "
        )?;

        // Migration check for existing databases
        let _ = conn.execute("ALTER TABLE downloads ADD COLUMN error_message TEXT", []);

        // Recover interrupted tasks after application restart: transition to paused
        let _ = conn.execute("UPDATE downloads SET status = 'paused' WHERE status = 'downloading'", []);

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn insert_download(&self, dl: &DownloadRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO downloads (
                id, url, filename, directory, total_bytes, downloaded_bytes,
                status, category, protocol, supports_range, etag, mime_type,
                date_added, date_finished, sha256_expected, sha256_calculated,
                segments_count, priority, error_message
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                dl.id,
                dl.url,
                dl.filename,
                dl.directory,
                dl.total_bytes as i64,
                dl.downloaded_bytes as i64,
                dl.status,
                dl.category,
                dl.protocol,
                if dl.supports_range { 1 } else { 0 },
                dl.etag,
                dl.mime_type,
                dl.date_added,
                dl.date_finished,
                dl.sha256_expected,
                dl.sha256_calculated,
                dl.segments_count as i64,
                dl.priority,
                dl.error_message,
            ],
        )?;
        Ok(())
    }

    /// Update checkpoint without resetting downloaded_bytes to zero if a placeholder 0 is passed
    pub fn save_download_checkpoint(
        &self,
        id: &str,
        downloaded_bytes: u64,
        status: &str
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        if downloaded_bytes > 0 {
            conn.execute(
                "UPDATE downloads SET downloaded_bytes = ?1, status = ?2, error_message = NULL WHERE id = ?3",
                params![downloaded_bytes as i64, status, id],
            )?;
        } else {
            conn.execute(
                "UPDATE downloads SET status = ?1 WHERE id = ?2",
                params![status, id],
            )?;
        }
        Ok(())
    }

    /// Explicitly transition status without touching downloaded_bytes
    pub fn update_download_status(&self, id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE downloads SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    /// Persist genuine engine error message to SQLite
    pub fn save_download_error(&self, id: &str, error: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE downloads SET status = 'error', error_message = ?1 WHERE id = ?2",
            params![error, id],
        )?;
        Ok(())
    }

    /// Save authenticated credentials securely (passwords are encrypted with SHA-256 keystream, never plaintext)
    pub fn save_secure_credentials(
        &self,
        download_id: &str,
        username: Option<&str>,
        password: Option<&str>,
        headers: Option<&HashMap<String, String>>,
        cookies: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let enc_pass = password.map(encrypt_secret);
        let headers_json = headers.and_then(|h| serde_json::to_string(h).ok());
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT OR REPLACE INTO secure_credentials (download_id, username, password_encrypted, headers_json, cookies, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![download_id, username, enc_pass, headers_json, cookies, now],
        )?;
        Ok(())
    }

    /// Retrieve credentials securely and decrypt password
    pub fn get_secure_credentials(&self, download_id: &str) -> Result<Option<SecureCredentials>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT download_id, username, password_encrypted, headers_json, cookies FROM secure_credentials WHERE download_id = ?1"
        )?;
        let mut rows = stmt.query(params![download_id])?;

        if let Some(row) = rows.next()? {
            let enc_pass: Option<String> = row.get(2)?;
            let decrypted_pass = enc_pass.and_then(|ep| decrypt_secret(&ep));
            let headers_json: Option<String> = row.get(3)?;
            let headers = headers_json.and_then(|hj| serde_json::from_str::<HashMap<String, String>>(&hj).ok());

            Ok(Some(SecureCredentials {
                download_id: row.get(0)?,
                username: row.get(1)?,
                password: decrypted_pass,
                headers,
                cookies: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn save_segment_checkpoint(
        &self,
        download_id: &str,
        seg_index: usize,
        downloaded: u64,
        is_finished: bool
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO download_segments (download_id, segment_index, start_byte, end_byte, downloaded_bytes, is_finished)
             VALUES (?1, ?2, 0, 0, ?3, ?4)
             ON CONFLICT(download_id, segment_index) DO UPDATE 
             SET downloaded_bytes = ?3, is_finished = ?4",
            params![download_id, seg_index as i64, downloaded as i64, if is_finished { 1 } else { 0 }],
        ).or_else(|_| {
            conn.execute(
                "UPDATE download_segments 
                 SET downloaded_bytes = ?1, is_finished = ?2 
                 WHERE download_id = ?3 AND segment_index = ?4",
                params![downloaded as i64, if is_finished { 1 } else { 0 }, download_id, seg_index as i64],
            )
        })?;
        Ok(())
    }

    pub fn get_download(&self, id: &str) -> Result<Option<DownloadRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, url, filename, directory, total_bytes, downloaded_bytes, status, category, protocol, supports_range, etag, mime_type, date_added, date_finished, sha256_expected, sha256_calculated, segments_count, priority, error_message FROM downloads WHERE id = ?1")?;
        let mut rows = stmt.query(params![id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(DownloadRecord {
                id: row.get(0)?,
                url: row.get(1)?,
                filename: row.get(2)?,
                directory: row.get(3)?,
                total_bytes: row.get::<_, i64>(4)? as u64,
                downloaded_bytes: row.get::<_, i64>(5)? as u64,
                status: row.get(6)?,
                category: row.get(7)?,
                protocol: row.get(8)?,
                supports_range: row.get::<_, i64>(9)? == 1,
                etag: row.get(10)?,
                mime_type: row.get(11)?,
                date_added: row.get(12)?,
                date_finished: row.get(13)?,
                sha256_expected: row.get(14)?,
                sha256_calculated: row.get(15)?,
                segments_count: row.get::<_, i64>(16)? as usize,
                priority: row.get(17)?,
                error_message: row.get(18)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_segments(&self, download_id: &str) -> Result<Vec<SegmentRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, download_id, segment_index, start_byte, end_byte, downloaded_bytes, is_finished 
             FROM download_segments 
             WHERE download_id = ?1 
             ORDER BY segment_index ASC"
        )?;

        let segment_iter = stmt.query_map(params![download_id], |row| {
            Ok(SegmentRecord {
                id: row.get(0)?,
                download_id: row.get(1)?,
                segment_index: row.get::<_, i64>(2)? as usize,
                start_byte: row.get::<_, i64>(3)? as u64,
                end_byte: row.get::<_, i64>(4)? as u64,
                downloaded_bytes: row.get::<_, i64>(5)? as u64,
                is_finished: row.get::<_, i64>(6)? == 1,
            })
        })?;

        let mut segments = Vec::new();
        for seg in segment_iter {
            segments.push(seg?);
        }
        Ok(segments)
    }

    pub fn delete_download(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
        conn.execute("DELETE FROM download_segments WHERE download_id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_active_downloads_count(&self) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM downloads WHERE status = 'downloading'")?;
        let count: i64 = stmt.query_row([], |row| row.get(0))?;
        Ok(count as usize)
    }

    pub fn get_all_downloads(&self) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, url, filename, directory, total_bytes, downloaded_bytes, status, category, protocol, supports_range, etag, mime_type, date_added, date_finished, sha256_expected, sha256_calculated, segments_count, priority, error_message FROM downloads ORDER BY date_added DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(DownloadRecord {
                id: row.get(0)?,
                url: row.get(1)?,
                filename: row.get(2)?,
                directory: row.get(3)?,
                total_bytes: row.get::<_, i64>(4)? as u64,
                downloaded_bytes: row.get::<_, i64>(5)? as u64,
                status: row.get(6)?,
                category: row.get(7)?,
                protocol: row.get(8)?,
                supports_range: row.get::<_, i64>(9)? == 1,
                etag: row.get(10)?,
                mime_type: row.get(11)?,
                date_added: row.get(12)?,
                date_finished: row.get(13)?,
                sha256_expected: row.get(14)?,
                sha256_calculated: row.get(15)?,
                segments_count: row.get::<_, i64>(16)? as usize,
                priority: row.get(17)?,
                error_message: row.get(18)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_queued_downloads(&self, limit: usize) -> Result<Vec<DownloadRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, url, filename, directory, total_bytes, downloaded_bytes, status, category, protocol, supports_range, etag, mime_type, date_added, date_finished, sha256_expected, sha256_calculated, segments_count, priority, error_message FROM downloads WHERE status = 'queued' ORDER BY date_added ASC LIMIT ?1")?;
        let rows = stmt.query_map([limit as i64], |row| {
            Ok(DownloadRecord {
                id: row.get(0)?,
                url: row.get(1)?,
                filename: row.get(2)?,
                directory: row.get(3)?,
                total_bytes: row.get::<_, i64>(4)? as u64,
                downloaded_bytes: row.get::<_, i64>(5)? as u64,
                status: row.get(6)?,
                category: row.get(7)?,
                protocol: row.get(8)?,
                supports_range: row.get::<_, i64>(9)? == 1,
                etag: row.get(10)?,
                mime_type: row.get(11)?,
                date_added: row.get(12)?,
                date_finished: row.get(13)?,
                sha256_expected: row.get(14)?,
                sha256_calculated: row.get(15)?,
                segments_count: row.get::<_, i64>(16)? as usize,
                priority: row.get(17)?,
                error_message: row.get(18)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    /// Atomically claim the next queued downloads inside a SQLite transaction to prevent duplicate task execution
    pub fn claim_next_queued_downloads(&self, limit: usize) -> Result<Vec<DownloadRecord>> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;

        let mut claimed = Vec::new();
        {
            let mut stmt = tx.prepare(
                "SELECT id FROM downloads WHERE status = 'queued' ORDER BY date_added ASC LIMIT ?1"
            )?;
            let ids: Vec<String> = stmt.query_map([limit as i64], |row| row.get(0))?
                .filter_map(|r| r.ok())
                .collect();

            for id in ids {
                let affected = tx.execute(
                    "UPDATE downloads SET status = 'downloading' WHERE id = ?1 AND status = 'queued'",
                    params![&id],
                )?;
                if affected > 0 {
                    let mut get_stmt = tx.prepare("SELECT id, url, filename, directory, total_bytes, downloaded_bytes, status, category, protocol, supports_range, etag, mime_type, date_added, date_finished, sha256_expected, sha256_calculated, segments_count, priority, error_message FROM downloads WHERE id = ?1")?;
                    let mut rows = get_stmt.query(params![&id])?;
                    if let Some(row) = rows.next()? {
                        claimed.push(DownloadRecord {
                            id: row.get(0)?,
                            url: row.get(1)?,
                            filename: row.get(2)?,
                            directory: row.get(3)?,
                            total_bytes: row.get::<_, i64>(4)? as u64,
                            downloaded_bytes: row.get::<_, i64>(5)? as u64,
                            status: row.get(6)?,
                            category: row.get(7)?,
                            protocol: row.get(8)?,
                            supports_range: row.get::<_, i64>(9)? == 1,
                            etag: row.get(10)?,
                            mime_type: row.get(11)?,
                            date_added: row.get(12)?,
                            date_finished: row.get(13)?,
                            sha256_expected: row.get(14)?,
                            sha256_calculated: row.get(15)?,
                            segments_count: row.get::<_, i64>(16)? as usize,
                            priority: row.get(17)?,
                            error_message: row.get(18)?,
                        });
                    }
                }
            }
        }
        tx.commit()?;
        Ok(claimed)
    }

    /// Atomically claim a specific queued download by ID
    pub fn claim_queued_download(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let affected = conn.execute(
            "UPDATE downloads SET status = 'downloading' WHERE id = ?1 AND status = 'queued'",
            params![id],
        )?;
        Ok(affected > 0)
    }

    /// Find an active or queued download with the same URL to prevent duplicate queueing
    pub fn find_active_or_queued_by_url(&self, url: &str) -> Result<Option<DownloadRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, url, filename, directory, total_bytes, downloaded_bytes, status, category, protocol, supports_range, etag, mime_type, date_added, date_finished, sha256_expected, sha256_calculated, segments_count, priority, error_message FROM downloads WHERE url = ?1 AND (status = 'downloading' OR status = 'queued') LIMIT 1"
        )?;
        let mut rows = stmt.query(params![url])?;
        if let Some(row) = rows.next()? {
            Ok(Some(DownloadRecord {
                id: row.get(0)?,
                url: row.get(1)?,
                filename: row.get(2)?,
                directory: row.get(3)?,
                total_bytes: row.get::<_, i64>(4)? as u64,
                downloaded_bytes: row.get::<_, i64>(5)? as u64,
                status: row.get(6)?,
                category: row.get(7)?,
                protocol: row.get(8)?,
                supports_range: row.get::<_, i64>(9)? == 1,
                etag: row.get(10)?,
                mime_type: row.get(11)?,
                date_added: row.get(12)?,
                date_finished: row.get(13)?,
                sha256_expected: row.get(14)?,
                sha256_calculated: row.get(15)?,
                segments_count: row.get::<_, i64>(16)? as usize,
                priority: row.get(17)?,
                error_message: row.get(18)?,
            }))
        } else {
            Ok(None)
        }
    }
}

fn get_database_path() -> PathBuf {
    if let Ok(app_data) = std::env::var("APPDATA") {
        PathBuf::from(app_data).join("NOVA").join("nova_downloads.sqlite")
    } else {
        PathBuf::from("nova_downloads.sqlite")
    }
}
