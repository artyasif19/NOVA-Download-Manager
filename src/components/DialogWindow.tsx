/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Small stand-alone pop-up windows, like IDM's:
 *  - "confirm":  Download File Info (URL, category, save location, Download Later / Start / Cancel)
 *  - "progress": live download window (status, speed, time left, connections, Pause / Cancel)
 * They run in their own window, so downloads can be confirmed and watched without the main app.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DownloadItem, AppSettings } from '../types/download';
import { loadStoredSettings } from '../services/storage';
import { applyThemeToDocument } from '../utils/theme';
import { generateSegments } from '../services/downloadEngine';
import { detectProtocol } from '../services/protocolParser';
import {
  fetchAllDownloads,
  getNativeDefaultFolder,
  invokeCommand,
  pickFolder,
  probeVideo,
  resolutionName,
  VideoInfo,
} from '../services/tauriBridge';
import {
  categorizeExtension,
  formatBytes,
  formatEta,
  formatSpeed,
  getAccentClasses,
  getFileExtension,
} from '../utils/formatters';

type ConfirmData = {
  url: string;
  filename?: string;
  totalBytes?: number;
  mimeType?: string;
  referrer?: string;
  video?: boolean;
  torrent?: boolean;
  quality?: string;
};

const CATEGORIES: Array<{ id: DownloadItem['category']; label: string }> = [
  { id: 'video_audio', label: 'Video & Audio' },
  { id: 'documents', label: 'Documents' },
  { id: 'compressed', label: 'Compressed' },
  { id: 'applications', label: 'Programs' },
  { id: 'custom', label: 'General' },
];

function nameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
  } catch {
    return '';
  }
}

async function closeSelf() {
  try {
    await getCurrentWindow().close();
  } catch {
    window.close();
  }
}

// ---------------------------------------------------------------------------
// Download File Info
// ---------------------------------------------------------------------------

const ConfirmView: React.FC<{ data: ConfirmData; settings: AppSettings }> = ({ data, settings }) => {
  const accent = getAccentClasses(settings.accentColor);
  const isVideo = Boolean(data.video);
  const isTorrent = Boolean(data.torrent);

  const magnetName = (() => {
    if (!isTorrent) return '';
    try {
      const dn = new URLSearchParams(data.url.replace(/^magnet:\?/i, '')).get('dn');
      return dn || '';
    } catch {
      return '';
    }
  })();
  const [filename, setFilename] = useState(
    isTorrent ? magnetName || 'Torrent (name is read after it starts)' : data.filename || nameFromUrl(data.url) || (isVideo ? 'Reading video...' : 'download.dat')
  );
  const [directory, setDirectory] = useState(settings.defaultFolder);
  const [category, setCategory] = useState<DownloadItem['category']>(
    isTorrent ? 'custom' : isVideo ? 'video_audio' : categorizeExtension(getFileExtension(data.filename || nameFromUrl(data.url)))
  );
  const [description, setDescription] = useState('');
  const [totalBytes, setTotalBytes] = useState(data.totalBytes || 0);
  const [supportsRange, setSupportsRange] = useState(true);
  const [etag, setEtag] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [quality, setQuality] = useState(data.quality && data.quality !== '' ? data.quality : 'best');

  useEffect(() => {
    if (settings.defaultFolder === 'C:\\Downloads\\NOVA') {
      getNativeDefaultFolder().then((d) => d && setDirectory(d));
    }
  }, [settings.defaultFolder]);

  // Read the real name / size (and every resolution for video links)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (isTorrent) {
          return;
        } else if (isVideo) {
          const info = await probeVideo(data.url);
          if (cancelled) return;
          setVideoInfo(info);
          setFilename(info.title || 'video');
          setQuality((q) => (q.startsWith('fmt:') && !info.formats.some((f) => 'fmt:' + f.id === q) ? 'best' : q));
        } else {
          const info: any = await invokeCommand('probe_target_url', { url: data.url });
          if (cancelled || !info) return;
          if (info.filename && !data.filename) {
            setFilename(info.filename);
            setCategory(categorizeExtension(getFileExtension(info.filename)));
          }
          if (info.total_bytes) setTotalBytes(info.total_bytes);
          setSupportsRange(Boolean(info.supports_range));
          if (info.etag) setEtag(info.etag);
        }
      } catch (e: any) {
        if (!cancelled && isVideo) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedFormat = videoInfo?.formats.find((f) => 'fmt:' + f.id === quality);
  const shownSize = isVideo
    ? selectedFormat
      ? selectedFormat.size + (selectedFormat.has_audio ? 0 : videoInfo?.best_audio_size || 0)
      : 0
    : totalBytes;

  const buildItem = (status: DownloadItem['status']): DownloadItem => {
    const id = `dl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    if (isTorrent) {
      return {
        id,
        url: data.url,
        filename: magnetName || 'Fetching torrent info...',
        directory,
        totalBytes: 0,
        downloadedBytes: 0,
        speed: 0,
        status,
        category: 'custom',
        protocol: 'torrent',
        segmentsCount: 1,
        segments: [],
        supportsRange: true,
        dateAdded: Date.now(),
        priority: 'normal',
      };
    }
    if (isVideo) {
      return {
        id,
        url: data.url,
        filename: videoInfo?.title || 'Fetching video info...',
        directory,
        totalBytes: 0,
        downloadedBytes: 0,
        speed: 0,
        status,
        category: 'video_audio',
        protocol: 'video',
        segmentsCount: 1,
        segments: [],
        supportsRange: true,
        dateAdded: Date.now(),
        priority: 'normal',
        videoQuality: quality,
      };
    }
    const bytes = totalBytes > 0 ? totalBytes : 150 * 1024 * 1024;
    const segs = supportsRange ? settings.maxConnectionsPerDownload : 1;
    return {
      id,
      url: data.url,
      filename: filename.trim() || 'download_' + Date.now(),
      directory,
      totalBytes: bytes,
      downloadedBytes: 0,
      speed: 0,
      status,
      category,
      protocol: detectProtocol(data.url),
      segmentsCount: segs,
      segments: generateSegments(bytes, segs),
      supportsRange,
      isResumable: supportsRange,
      etag: etag || undefined,
      dateAdded: Date.now(),
      priority: 'normal',
      headers: data.referrer ? { Referer: data.referrer } : undefined,
    };
  };

  const go = async (later: boolean) => {
    setError('');
    setBusy(true);
    try {
      const item = buildItem(later ? 'queued' : 'downloading');
      if (later) {
        await invokeCommand('queue_download', {
          request: {
            id: item.id,
            url: item.url,
            filename: item.filename,
            directory: item.directory,
            category: item.category,
            protocol: item.protocol,
            total_bytes: item.totalBytes,
            segments_count: item.segmentsCount,
            quality: item.videoQuality,
          },
        });
      } else if (isTorrent) {
        await invokeCommand('start_torrent', { request: { id: item.id, url: item.url, directory: item.directory } });
      } else if (isVideo) {
        await invokeCommand('start_video_download', {
          request: { id: item.id, url: item.url, directory: item.directory, quality: item.videoQuality || 'best' },
        });
      } else {
        await invokeCommand('start_download', { request: item });
      }
      await emit('dialog-download-started', item);
      if (!later) {
        await invokeCommand('open_dialog', { kind: 'progress', data: { id: item.id } });
      }
      await closeSelf();
    } catch (e: any) {
      setError(String(e?.message || e));
      setBusy(false);
    }
  };

  const browse = async () => {
    const picked = await pickFolder('Select where to save this file');
    if (picked) setDirectory(picked);
  };

  return (
    <div className="h-screen flex flex-col text-xs text-slate-200 select-none">
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 space-y-2.5">
            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-slate-300">URL</label>
              <input readOnly value={data.url} title={data.url} className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.14] rounded px-2 py-1.5 font-mono text-[11px] text-slate-300" />
            </div>

            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-slate-300">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as DownloadItem['category'])}
                className="flex-1 bg-[#0c0f15] border border-white/[0.14] rounded px-2 py-1.5 text-slate-200"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {isVideo && (
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-slate-300">Quality</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.14] rounded px-2 py-1.5 text-slate-200"
                >
                  <option value="best">Best available (highest resolution)</option>
                  <option value="audio">Audio only (MP3)</option>
                  {videoInfo?.formats
                    .slice()
                    .reverse()
                    .map((f) => {
                      const total = f.size > 0 ? f.size + (f.has_audio ? 0 : videoInfo.best_audio_size) : 0;
                      return (
                        <option key={f.id} value={'fmt:' + f.id}>
                          {resolutionName(f.height)} {f.height}p{f.fps > 30 ? ` ${f.fps}fps` : ''}
                          {f.hdr ? ' HDR' : ''} - {f.ext.toUpperCase()} {f.vcodec}
                          {total > 0 ? ` - ${f.size_estimated || !f.has_audio ? '~' : ''}${formatBytes(total)}` : ''}
                        </option>
                      );
                    })}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-slate-300">Save As</label>
              <input
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.14] rounded px-2 py-1.5 font-mono text-[11px] text-slate-200"
              />
              <button onClick={browse} title="Choose folder" className="px-2.5 py-1.5 rounded bg-white/[0.08] hover:bg-white/[0.16] text-slate-100">
                ...
              </button>
            </div>

            {!isVideo && !isTorrent && (
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-slate-300">File name</label>
                <input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.14] rounded px-2 py-1.5 font-mono text-[11px] text-slate-200"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="w-20 shrink-0 text-slate-300">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.14] rounded px-2 py-1.5 text-slate-200"
              />
            </div>
          </div>

          <div className="w-24 shrink-0 text-center pt-1">
            <div className="mx-auto w-12 h-14 rounded bg-white/[0.08] border border-white/[0.12] flex items-center justify-center text-[10px] font-bold text-slate-300">
              {isTorrent ? 'TORRENT' : (getFileExtension(filename) || (isVideo ? 'video' : 'file')).slice(0, 5).toUpperCase()}
            </div>
            <div className="mt-1.5 font-mono text-sm text-slate-100">
              {isTorrent ? 'Magnet' : busy && shownSize === 0 ? '...' : shownSize > 0 ? `${isVideo ? '~' : ''}${formatBytes(shownSize)}` : 'Unknown'}
            </div>
          </div>
        </div>

        {isVideo && videoInfo && (
          <div className="text-[11px] text-slate-400 truncate" title={videoInfo.title}>
            {videoInfo.title}
          </div>
        )}
        {error && <div className="text-rose-400 text-[11px]">{error}</div>}
      </div>

      <div className="px-4 py-3 border-t border-white/[0.1] flex items-center justify-center gap-3">
        <button
          onClick={() => go(true)}
          disabled={busy && !error}
          className="px-5 py-1.5 rounded-md border border-white/[0.18] text-slate-100 hover:bg-white/[0.08] disabled:opacity-50"
        >
          Download Later
        </button>
        <button
          onClick={() => go(false)}
          disabled={busy && !error}
          className={`px-6 py-1.5 rounded-md font-bold text-slate-950 ${accent.bg} disabled:opacity-60`}
        >
          Start Download
        </button>
        <button onClick={() => closeSelf()} className="px-5 py-1.5 rounded-md border border-white/[0.18] text-slate-100 hover:bg-white/[0.08]">
          Cancel
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Live download window
// ---------------------------------------------------------------------------

interface Seg {
  id: number;
  downloaded_bytes: number;
  speed_bytes_sec: number;
  is_finished: boolean;
}

const ProgressView: React.FC<{ id: string; settings: AppSettings }> = ({ id, settings }) => {
  const accent = getAccentClasses(settings.accentColor);
  const [item, setItem] = useState<DownloadItem | null>(null);
  const [status, setStatus] = useState('downloading');
  const [filename, setFilename] = useState('');
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [eta, setEta] = useState(0);
  const [segments, setSegments] = useState<Seg[]>([]);
  const [error, setError] = useState('');
  const [finalPath, setFinalPath] = useState('');
  const [showDetails, setShowDetails] = useState(true);
  const [tab, setTab] = useState<'status' | 'options'>('status');
  const [afterDone, setAfterDone] = useState<'nothing' | 'open_file' | 'open_folder' | 'close'>('nothing');
  const afterDoneRef = useRef(afterDone);
  afterDoneRef.current = afterDone;
  const finalPathRef = useRef('');

  // load the record (it may take a moment to appear)
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const all = await fetchAllDownloads();
        const found = all.find((d) => d.id === id);
        if (found && !stopped) {
          setItem(found);
          setFilename((f) => f || found.filename);
          setTotal((t) => t || found.totalBytes);
          setDownloaded((d) => d || found.downloadedBytes);
          setStatus((s) => (s === 'downloading' || s === 'queued' ? found.status : s));
          return true;
        }
      } catch {
        /* retry */
      }
      return false;
    };
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const ok = await load();
      if (ok || tries > 15) clearInterval(timer);
    }, 700);
    load();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [id]);

  // live events from the engine
  useEffect(() => {
    const offs: Array<() => void> = [];
    let disposed = false;
    (async () => {
      const a = await listen<any>('download-progress', (e) => {
        const p = e.payload;
        if (p.id !== id) return;
        setStatus('downloading');
        setDownloaded(p.downloaded_bytes);
        if (p.total_bytes > 0) setTotal(p.total_bytes);
        setSpeed(p.speed_bytes_sec || 0);
        setEta(p.eta_seconds && p.eta_seconds > 0 ? p.eta_seconds : 0);
        if (p.filename) setFilename(p.filename);
        if (Array.isArray(p.segments)) setSegments(p.segments);
      });
      const b = await listen<any>('download-status-changed', (e) => {
        if (e.payload.id === id) {
          setStatus(e.payload.status);
          if (e.payload.status !== 'downloading') setSpeed(0);
        }
      });
      const c = await listen<any>('download-completed', async (e) => {
        const p = e.payload;
        if (p.id !== id) return;
        setStatus('completed');
        setSpeed(0);
        if (p.total_bytes > 0) {
          setTotal(p.total_bytes);
          setDownloaded(p.total_bytes);
        }
        if (p.filename) setFilename(p.filename);
        const path = p.destination_path || p.file_path || '';
        setFinalPath(path);
        finalPathRef.current = path;
        const action = afterDoneRef.current;
        if (action === 'open_file' && path) invokeCommand('open_file', { path }).catch(() => {});
        else if (action === 'open_folder' && path) invokeCommand('reveal_file', { path }).catch(() => {});
        else if (action === 'close') closeSelf();
      });
      const d = await listen<any>('download-error', (e) => {
        if (e.payload.id !== id) return;
        setStatus('error');
        setSpeed(0);
        setError(e.payload.error || 'The download failed');
      });
      if (disposed) {
        a();
        b();
        c();
        d();
      } else {
        offs.push(a, b, c, d);
      }
    })();
    return () => {
      disposed = true;
      offs.forEach((o) => o());
    };
  }, [id]);

  const pct = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0;
  const remaining = eta > 0 ? eta : speed > 0 && total > downloaded ? Math.ceil((total - downloaded) / speed) : 0;

  useEffect(() => {
    const title = status === 'completed' ? `Done - ${filename}` : `${Math.floor(pct)}% ${filename}`;
    getCurrentWindow().setTitle(title.trim() || 'NOVA - Download').catch(() => {});
  }, [pct, filename, status]);

  const statusText =
    status === 'downloading'
      ? 'Receiving data...'
      : status === 'paused'
      ? 'Paused'
      : status === 'completed'
      ? 'Download complete'
      : status === 'error'
      ? 'Error'
      : status === 'queued'
      ? 'Waiting in queue'
      : status;

  const pauseOrResume = async () => {
    try {
      if (status === 'downloading') await invokeCommand('pause_download', { id });
      else await invokeCommand('resume_download', { id });
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  const cancel = async () => {
    if (status !== 'completed') {
      try {
        await invokeCommand('cancel_download', { id });
      } catch {
        /* ignore */
      }
    }
    closeSelf();
  };

  const dirPath = item?.directory || '';
  const fullPath = finalPath || (dirPath && filename ? `${dirPath.replace(/[\\/]+$/, '')}\\${filename}` : '');

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex">
      <div className="w-32 shrink-0 text-slate-400">{label}</div>
      <div className="text-slate-100 font-mono">{value}</div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col text-xs text-slate-200 select-none">
      <div className="flex items-end gap-1 px-3 pt-3">
        {([
          ['status', 'Download status'],
          ['options', 'Options on completion'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1 rounded-t-md border border-b-0 border-white/[0.14] ${
              tab === k ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mx-3 p-3 border border-white/[0.14] rounded-b-md rounded-tr-md space-y-1.5 bg-white/[0.04]">
        {tab === 'status' ? (
          <>
            <div className="font-mono text-[11px] text-slate-300 truncate" title={item?.url}>
              {item?.url || '...'}
            </div>
            <div className="text-slate-100 font-semibold truncate" title={filename}>
              {filename || 'Fetching file information...'}
            </div>
            {row('Status', statusText)}
            {row('File size', total > 0 ? formatBytes(total) : 'Unknown')}
            {row('Downloaded', `${formatBytes(downloaded)}${total > 0 ? ` ( ${pct.toFixed(2)} % )` : ''}`)}
            {row('Transfer rate', speed > 0 ? formatSpeed(speed) : '-')}
            {row('Time left', remaining > 0 ? formatEta(remaining) : status === 'completed' ? '0 sec' : '-')}
            {row('Resume capability', item?.supportsRange === false ? 'No' : 'Yes')}
            {error && <div className="text-rose-400 pt-1">{error}</div>}
          </>
        ) : (
          <div className="space-y-2 py-1">
            <div className="text-slate-300">When this download finishes:</div>
            {([
              ['nothing', 'Only show "Download complete"'],
              ['open_file', 'Open the file'],
              ['open_folder', 'Show the file in its folder'],
              ['close', 'Close this window'],
            ] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="after" checked={afterDone === k} onChange={() => setAfterDone(k)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mx-3 mt-3">
        <div className="h-5 rounded bg-white/[0.1] border border-white/[0.12] overflow-hidden">
          <div
            className={`h-full ${status === 'error' ? 'bg-rose-500' : status === 'completed' ? 'bg-emerald-500' : accent.bg} transition-all duration-300`}
            style={{ width: `${status === 'completed' ? 100 : pct}%` }}
          />
        </div>
      </div>

      <div className="mx-3 mt-3 flex items-center justify-between">
        <button
          onClick={() => setShowDetails((s) => !s)}
          className="px-4 py-1.5 rounded-md border border-white/[0.18] text-slate-100 hover:bg-white/[0.08]"
        >
          {showDetails ? '<< Hide details' : 'Show details >>'}
        </button>
        <div className="flex items-center gap-2">
          {status === 'completed' ? (
            <>
              <button
                onClick={() => fullPath && invokeCommand('open_file', { path: fullPath }).catch(() => {})}
                className={`px-5 py-1.5 rounded-md font-bold text-slate-950 ${accent.bg}`}
              >
                Open
              </button>
              <button
                onClick={() => fullPath && invokeCommand('reveal_file', { path: fullPath }).catch(() => {})}
                className="px-4 py-1.5 rounded-md border border-white/[0.18] text-slate-100 hover:bg-white/[0.08]"
              >
                Open folder
              </button>
              <button onClick={() => closeSelf()} className="px-4 py-1.5 rounded-md border border-white/[0.18] text-slate-100 hover:bg-white/[0.08]">
                Close
              </button>
            </>
          ) : (
            <>
              <button
                onClick={pauseOrResume}
                className="px-5 py-1.5 rounded-md border border-white/[0.18] text-slate-100 hover:bg-white/[0.08]"
              >
                {status === 'downloading' ? 'Pause' : 'Start'}
              </button>
              <button onClick={cancel} className="px-5 py-1.5 rounded-md border border-white/[0.18] text-slate-100 hover:bg-white/[0.08]">
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {showDetails && segments.length > 0 && (
        <div className="mx-3 mt-3 mb-3 flex-1 min-h-0 border border-white/[0.14] rounded-md overflow-y-auto">
          <div className="grid grid-cols-[40px_1fr_1fr] px-2 py-1 bg-white/[0.08] text-slate-300 font-semibold sticky top-0">
            <div>N.</div>
            <div>Downloaded</div>
            <div>Info</div>
          </div>
          {segments.map((s) => (
            <div key={s.id} className="grid grid-cols-[40px_1fr_1fr] px-2 py-1 border-t border-white/[0.06] font-mono">
              <div>{s.id + 1}</div>
              <div>{formatBytes(s.downloaded_bytes)}</div>
              <div className="text-slate-400">
                {s.is_finished ? 'Finished' : status === 'downloading' ? 'Receiving data...' : 'Disconnect.'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Entry point for pop-up windows
// ---------------------------------------------------------------------------

export const DialogWindow: React.FC<{ kind: string; rawData: string }> = ({ kind, rawData }) => {
  const settings = useMemo(() => loadStoredSettings(), []);
  const data = useMemo(() => {
    try {
      return JSON.parse(rawData || '{}');
    } catch {
      return {};
    }
  }, [rawData]);

  useEffect(() => {
    applyThemeToDocument(settings);
  }, [settings]);

  if (kind === 'confirm') return <ConfirmView data={data as ConfirmData} settings={settings} />;
  if (kind === 'progress') return <ProgressView id={String(data.id || '')} settings={settings} />;
  return <div className="p-4 text-slate-300">Unknown window.</div>;
};
