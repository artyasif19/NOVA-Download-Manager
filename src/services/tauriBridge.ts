/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NOVA Download Manager - Official Tauri 2 IPC & Web Preview Bridge
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { DownloadItem } from '../types/download';
import { mapDownloadItemToRustRequest, RustDownloadRequest } from './tauriAdapter';

export { mapDownloadItemToRustRequest };
export type { RustDownloadRequest };

/**
 * Checks if the application is running inside a Tauri 2 native desktop webview.
 * Tauri 2 injects __TAURI_INTERNALS__ on window.
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
}

export interface NativeDownloadRecord {
  id: string;
  url: string;
  filename: string;
  directory: string;
  total_bytes: number;
  downloaded_bytes: number;
  status: string;
  category: string;
  protocol: string;
  supports_range: boolean;
  etag?: string | null;
  mime_type?: string | null;
  date_added: number;
  date_finished?: number | null;
  sha256_expected?: string | null;
  sha256_calculated?: string | null;
  segments_count: number;
  priority: string;
  error_message?: string | null;
}

export interface NativeProgressPayload {
  id: string;
  eta_seconds?: number;
  filename?: string | null;
  downloaded_bytes: number;
  total_bytes: number;
  speed_bytes_sec: number;
  segments: {
    id: number;
    start_byte: number;
    end_byte: number;
    downloaded_bytes: number;
    speed_bytes_sec: number;
    is_finished: boolean;
  }[];
}

export interface NativeCompletedPayload {
  id: string;
  filename?: string | null;
  total_bytes: number;
  sha256_calculated?: string | null;
  file_path: string;
}

export interface NativeErrorPayload {
  id: string;
  error: string;
}

export interface NativeStatusPayload {
  id: string;
  status: string;
}

/**
 * Subscribes to live native Tauri events from the Rust download engine.
 * Automatically cleans up all event listeners when unlisten is invoked.
 */
export async function setupNativeDownloadListeners(callbacks: {
  onProgress?: (payload: NativeProgressPayload) => void;
  onCompleted?: (payload: NativeCompletedPayload) => void;
  onError?: (payload: NativeErrorPayload) => void;
  onStatusChanged?: (payload: NativeStatusPayload) => void;
}): Promise<() => void> {
  if (!isTauriEnvironment()) {
    return () => {};
  }

  const unlistens: UnlistenFn[] = [];
  try {
    if (callbacks.onProgress) {
      unlistens.push(await listen<NativeProgressPayload>('download-progress', (e) => callbacks.onProgress!(e.payload)));
    }
    if (callbacks.onCompleted) {
      unlistens.push(await listen<NativeCompletedPayload>('download-completed', (e) => callbacks.onCompleted!(e.payload)));
    }
    if (callbacks.onError) {
      unlistens.push(await listen<NativeErrorPayload>('download-error', (e) => callbacks.onError!(e.payload)));
    }
    if (callbacks.onStatusChanged) {
      unlistens.push(await listen<NativeStatusPayload>('download-status-changed', (e) => callbacks.onStatusChanged!(e.payload)));
    }
  } catch (err) {
    console.warn('[NOVA Tauri] Failed to register native event listeners:', err);
  }

  return () => {
    unlistens.forEach((u) => u());
  };
}

function mapRecordToDownloadItem(rec: NativeDownloadRecord | any): DownloadItem {
  return {
    id: rec.id,
    url: rec.url,
    filename: rec.filename,
    directory: rec.directory || 'C:\\Downloads',
    totalBytes: rec.total_bytes ?? rec.totalBytes ?? 0,
    downloadedBytes: rec.downloaded_bytes ?? rec.downloadedBytes ?? 0,
    speed: 0,
    status: (rec.status as any) || 'queued',
    category: (rec.category as any) || 'documents',
    segmentsCount: rec.segments_count ?? rec.segmentsCount ?? 8,
    segments: rec.segments || [],
    supportsRange: rec.supports_range ?? rec.supportsRange ?? true,
    etag: rec.etag ?? null,
    mimeType: rec.mime_type ?? rec.mimeType ?? null,
    dateAdded: rec.date_added ?? rec.dateAdded ?? Date.now(),
    dateFinished: rec.date_finished ?? rec.dateFinished ?? null,
    sha256Expected: rec.sha256_expected ?? rec.sha256Expected ?? null,
    sha256Calculated: rec.sha256_calculated ?? rec.sha256Calculated ?? null,
    priority: (rec.priority as any) || 'normal',
    errorMessage: rec.error_message ?? rec.error ?? null,
  };
}

/**
 * Invoke native Tauri command if in desktop environment.
 * CRITICAL: In native desktop mode, NEVER fall back to relative REST endpoints.
 * All errors from the native Rust engine are propagated directly to the UI.
 */
export async function invokeCommand<T>(cmd: string, args?: Record<string, any>): Promise<T> {
  // Normalize payload for start_download to ensure Rust snake_case destination_path
  let normalizedArgs = args;
  if (cmd === 'start_download' && args?.request) {
    const rawReq = args.request;
    if (rawReq.destination_path === undefined && rawReq.directory !== undefined) {
      normalizedArgs = { ...args, request: mapDownloadItemToRustRequest(rawReq) };
    }
  }

  if (isTauriEnvironment()) {
    // Direct native Tauri 2 IPC invocation
    try {
      const res = await invoke<any>(cmd, normalizedArgs);
      if (cmd === 'get_download_item') {
        return (res ? mapRecordToDownloadItem(res) : null) as T;
      }
      if (cmd === 'get_all_downloads') {
        return (Array.isArray(res) ? res.map(mapRecordToDownloadItem) : []) as T;
      }
      return res as T;
    } catch (err: any) {
      console.error(`[NOVA Native Engine Error] Command '${cmd}' failed:`, err);
      // Propagate the actual error without falling back to web endpoints
      throw new Error(typeof err === 'string' ? err : err?.message || `Native command '${cmd}' failed`);
    }
  }

  // Pure Web Browser Preview Mode ONLY (via local Express server.ts during dev/preview)
  switch (cmd) {
    case 'probe_target_url': {
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: args?.url }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errJson.error || errJson.reason || `Probe failed with status ${res.status}`);
      }
      return await res.json();
    }
    case 'start_download': {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args?.request || {}),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errJson.error || errJson.reason || `Start download failed with status ${res.status}`);
      }
      const json = await res.json();
      return json.id as T;
    }
    case 'pause_download': {
      const res = await fetch(`/api/downloads/${args?.id}/pause`, { method: 'POST' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errJson.error || `Pause failed with status ${res.status}`);
      }
      return undefined as T;
    }
    case 'resume_download': {
      const res = await fetch(`/api/downloads/${args?.id}/resume`, { method: 'POST' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errJson.error || `Resume failed with status ${res.status}`);
      }
      return undefined as T;
    }
    case 'cancel_download': {
      const res = await fetch(`/api/downloads/${args?.id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errJson.error || `Cancel failed with status ${res.status}`);
      }
      return undefined as T;
    }
    case 'delete_download_item': {
      const res = await fetch(`/api/downloads/${args?.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errJson.error || `Delete failed with status ${res.status}`);
      }
      return undefined as T;
    }
    case 'get_download_item': {
      const res = await fetch(`/api/downloads/${args?.id}`);
      if (res.status === 404) return null as T;
      if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
      const raw = await res.json();
      return mapRecordToDownloadItem(raw) as T;
    }
    case 'get_all_downloads': {
      const res = await fetch('/api/downloads');
      if (!res.ok) throw new Error(`Fetch all failed with status ${res.status}`);
      const rawList = await res.json();
      return (rawList || []).map(mapRecordToDownloadItem) as T;
    }
    default:
      throw new Error(`Unrecognized command: ${cmd}`);
  }
}

/**
 * Fetch full download history/queue from actual engine state.
 * In desktop mode: uses native invoke('get_all_downloads').
 * In dev preview mode: uses /api/downloads.
 */
export async function fetchAllDownloads(): Promise<DownloadItem[]> {
  if (isTauriEnvironment()) {
    try {
      const records = await invoke<NativeDownloadRecord[]>('get_all_downloads');
      if (!Array.isArray(records)) return [];
      return records.map(mapRecordToDownloadItem);
    } catch (err) {
      console.error('[NOVA Native] Failed to fetch downloads from native SQLite engine:', err);
      throw err;
    }
  }

  // Web preview mode
  try {
    const res = await fetch('/api/downloads');
    if (!res.ok) return [];
    const list = await res.json();
    if (!Array.isArray(list)) return [];
    return list.map(mapRecordToDownloadItem);
  } catch (err) {
    console.warn('[NOVA Web Preview] Failed to fetch downloads:', err);
    return [];
  }
}


/**
 * Opens the native Windows folder picker. Returns the chosen folder, or null if cancelled
 * (or when not running inside the desktop app).
 */
export async function pickFolder(title = 'Select download folder'): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const res = await invoke<string | string[] | null>('plugin:dialog|open', {
      options: { directory: true, multiple: false, title },
    });
    if (!res) return null;
    return Array.isArray(res) ? res[0] ?? null : res;
  } catch (err) {
    console.error('Folder picker failed:', err);
    return null;
  }
}

/** The real Windows Downloads folder joined with "NOVA" (desktop app only). */
export async function getNativeDefaultFolder(): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const { downloadDir, join } = await import('@tauri-apps/api/path');
    return await join(await downloadDir(), 'NOVA');
  } catch (err) {
    console.error('Could not resolve Downloads folder:', err);
    return null;
  }
}


// ---------------------------------------------------------------------------
// Video format probing, browser-extension setup, autostart (desktop app only)
// ---------------------------------------------------------------------------

export interface VideoFormatInfo {
  id: string;
  height: number;
  width: number;
  fps: number;
  hdr: boolean;
  ext: string;
  vcodec: string;
  size: number;
  size_estimated: boolean;
  has_audio: boolean;
}

export interface VideoInfo {
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
  formats: VideoFormatInfo[];
  preview_url: string | null;
  best_audio_size: number;
}

export async function probeVideo(url: string): Promise<VideoInfo> {
  return invoke<VideoInfo>('probe_video', { url });
}

export interface ExtensionInfo {
  chrome_dir: string;
  firefox_dir: string;
  chrome_ready: boolean;
  firefox_ready: boolean;
  host_ready: boolean;
}

export async function getExtensionInfo(): Promise<ExtensionInfo | null> {
  if (!isTauriEnvironment()) return null;
  try {
    return await invoke<ExtensionInfo>('get_extension_info');
  } catch (err) {
    console.error('Extension info failed:', err);
    return null;
  }
}

export async function openFolder(path: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invoke('open_folder', { path });
}

export async function openBrowserExtensions(browser: 'chrome' | 'edge' | 'brave' | 'firefox'): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invoke('open_browser_extensions', { browser });
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (!isTauriEnvironment()) return;
  try {
    await invoke('set_autostart', { enabled });
  } catch (err) {
    console.error('Autostart change failed:', err);
  }
}

/** Human label for a resolution: 2160 -> "4K", 1440 -> "2K", 1080 -> "Full HD", ... */
export function resolutionName(height: number): string {
  if (height >= 4320) return '8K';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return 'Full HD';
  if (height >= 720) return 'HD';
  return 'SD';
}


// ---------------------------------------------------------------------------
// Clipboard, torrent files and link detection
// ---------------------------------------------------------------------------

/** Text currently on the clipboard (desktop app only; '' when unavailable) */
export async function readClipboardText(): Promise<string> {
  if (!isTauriEnvironment()) return '';
  try {
    const r: any = await invoke('plugin:clipboard-manager|read_text');
    if (typeof r === 'string') return r;
    return r?.plainText?.text ?? r?.text ?? '';
  } catch {
    return '';
  }
}

/** Opens the Windows file picker for a .torrent file */
export async function pickTorrentFile(): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const res = await invoke<string | string[] | null>('plugin:dialog|open', {
      options: {
        multiple: false,
        directory: false,
        title: 'Choose a .torrent file',
        filters: [{ name: 'Torrent files', extensions: ['torrent'] }],
      },
    });
    if (!res) return null;
    return Array.isArray(res) ? res[0] ?? null : res;
  } catch (err) {
    console.error('Torrent file picker failed:', err);
    return null;
  }
}

export type LinkKind = 'magnet' | 'video' | 'file' | null;

const VIDEO_SITES =
  /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|soundcloud\.com|bilibili\.com)$/;
const FILE_EXT =
  /\.(zip|rar|7z|tar|gz|bz2|xz|iso|img|exe|msi|dmg|pkg|apk|deb|rpm|pdf|epub|mobi|docx?|xlsx?|pptx?|mp3|flac|wav|aac|m4a|ogg|mp4|mkv|avi|mov|wmv|flv|webm|m4v|torrent|bin|jar|psd)$/i;

/** Decides whether copied text is a link NOVA should offer to download */
export function classifyLink(text: string): LinkKind {
  const t = (text || '').trim();
  if (!t || t.length > 2000 || /\s/.test(t)) return null;
  if (/^magnet:\?xt=/i.test(t)) return 'magnet';
  try {
    const u = new URL(t);
    if (!/^(https?|ftp|ftps|sftp):$/.test(u.protocol)) return null;
    if (VIDEO_SITES.test(u.hostname.toLowerCase())) {
      // only real video pages, not the home page
      return u.pathname.length > 1 || u.search.length > 1 ? 'video' : null;
    }
    if (FILE_EXT.test(u.pathname)) return 'file';
  } catch {
    return null;
  }
  return null;
}
