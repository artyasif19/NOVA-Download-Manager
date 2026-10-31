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
