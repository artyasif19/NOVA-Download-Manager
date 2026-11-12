/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { classifyLink, invokeCommand, isTauriEnvironment, pickFolder, pickTorrentFile, probeVideo, resolutionName, VideoInfo } from '../services/tauriBridge';
import { detectProtocol } from '../services/protocolParser';
import { 
  X, 
  Download, 
  Globe, 
  Folder, 
  Zap, 
  Layers, 
  Calendar, 
  ShieldCheck, 
  Sparkles,
  ChevronDown,
  Loader2,
  CheckCircle2,
  Clock,
  Server,
  Lock,
  Key,
  Video,
  AlertTriangle,
  FileCheck
} from 'lucide-react';
import { 
  DownloadItem, 
  AppSettings, 
  DownloadProtocol, 
  ProtocolCredentials, 
  StreamInfo 
} from '../types/download';
import { probeUrl, generateSegments, ProbeResult } from '../services/downloadEngine';
import { 
  formatBytes, 
  categorizeExtension, 
  getFileExtension, 
  formatCountdown, 
  formatScheduledDateTime 
} from '../utils/formatters';

interface AddDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddDownload: (item: DownloadItem, startImmediately: boolean) => void;
  settings: AppSettings;
  /** Set by the browser extension: open on the Video Sites tab with this link */
  prefill?: { url: string; quality?: string; nonce: number } | null;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
}

export const AddDownloadModal: React.FC<AddDownloadModalProps> = ({
  isOpen,
  onClose,
  onAddDownload,
  settings,
  prefill,
  accentClasses,
}) => {
  const [protocol, setProtocol] = useState<DownloadProtocol>('https');
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [directory, setDirectory] = useState(settings.defaultFolder);
  const [category, setCategory] = useState<'video_audio' | 'documents' | 'compressed' | 'applications' | 'custom'>('documents');
  const [segmentsCount, setSegmentsCount] = useState(settings.maxConnectionsPerDownload);
  const [totalBytes, setTotalBytes] = useState(0);
  const [supportsRange, setSupportsRange] = useState(true);
  const [isResumable, setIsResumable] = useState(true);
  const [etag, setEtag] = useState('');
  const [sha256Expected, setSha256Expected] = useState('');
  const [startMode, setStartMode] = useState<'immediate' | 'queue' | 'schedule'>('immediate');
  const [scheduleTime, setScheduleTime] = useState('');
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customUserAgent, setCustomUserAgent] = useState('');
  const [customCookies, setCustomCookies] = useState('');

  // FTP / SFTP specific state
  const [ftpUsername, setFtpUsername] = useState('anonymous');
  const [ftpPassword, setFtpPassword] = useState('nova-user@novadownloader.com');
  const [ftpPort, setFtpPort] = useState(21);
  const [passiveMode, setPassiveMode] = useState(true);

  // Always start from the current default folder when the dialog is opened
  useEffect(() => {
    if (isOpen) setDirectory(settings.defaultFolder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, settings.defaultFolder]);

  const [videoQuality, setVideoQuality] = useState<string>('best');
  const isSpecial = protocol === 'video' || protocol === 'torrent';
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [videoProbing, setVideoProbing] = useState(false);
  const [videoError, setVideoError] = useState('');

  // Opened by the browser extension's "Download this video" button
  useEffect(() => {
    if (isOpen && prefill && prefill.url === 'magnet:') {
      setUrl('');
      setProtocol('torrent');
      setVideoInfo(null);
      return;
    }
    if (isOpen && prefill && prefill.url) {
      setUrl(prefill.url);
      const kind = classifyLink(prefill.url);
      if (kind === 'magnet' || /\.torrent(\?|$)/i.test(prefill.url)) {
        setProtocol('torrent');
      } else if (kind === 'video' || prefill.quality) {
        setProtocol('video');
        setVideoQuality(prefill.quality && prefill.quality !== 'best' ? prefill.quality : 'best');
      } else {
        setProtocol(detectProtocol(prefill.url));
      }
      setVideoInfo(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce, isOpen]);

  // Read the list of available resolutions as soon as a video link is present
  useEffect(() => {
    if (!isOpen || protocol !== 'video') return;
    const link = url.trim();
    if (!/^https?:\/\//i.test(link)) {
      setVideoInfo(null);
      setVideoError('');
      return;
    }
    if (!isTauriEnvironment()) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setVideoProbing(true);
      setVideoError('');
      try {
        const info = await probeVideo(link);
        if (cancelled) return;
        setVideoInfo(info);
        // keep an exact choice only if it still exists
        setVideoQuality((q) => (q.startsWith('fmt:') && !info.formats.some((f) => 'fmt:' + f.id === q) ? 'best' : q));
      } catch (e: any) {
        if (cancelled) return;
        setVideoInfo(null);
        setVideoError(String(e?.message || e));
      } finally {
        if (!cancelled) setVideoProbing(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [url, protocol, isOpen]);

  // Pages (not direct files) from well-known video sites are handled by the video downloader
  const isVideoSiteUrl = (u: string) => {
    try {
      const h = new URL(u.trim()).hostname.toLowerCase();
      return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|soundcloud\.com|bilibili\.com)$/.test(h);
    } catch {
      return false;
    }
  };

  const handleBrowse = async () => {
    const picked = await pickFolder('Select download folder');
    if (picked) setDirectory(picked);
  };

  // Auto-probe when URL looks complete
  const handleProbe = async (targetUrl = url) => {
    if (!targetUrl || targetUrl.length < 5) return;
    if (isVideoSiteUrl(targetUrl)) {
      setProtocol('video');
      return;
    }
    setIsProbing(true);
    setProbeResult(null);

    // Desktop app: probe through the native Rust engine (no browser CORS limits)
    if (isTauriEnvironment()) {
      try {
        const info = await invokeCommand<any>('probe_target_url', { url: targetUrl });
        setFilename(info.filename || targetUrl.split('/').pop()?.split('?')[0] || 'download.dat');
        setTotalBytes(info.total_bytes || 0);
        setSupportsRange(Boolean(info.supports_range));
        setIsResumable(Boolean(info.is_resumable));
        if (info.etag) setEtag(info.etag);
      } catch (e: any) {
        alert(`Could not reach this URL: ${e?.message || e}`);
      } finally {
        setIsProbing(false);
      }
      return;
    }

    const creds: ProtocolCredentials = {
      username: ftpUsername,
      password: ftpPassword,
      port: ftpPort,
      passiveMode,
    };

    try {
      // First try backend probe to bypass browser CORS restrictions
      let backendSuccess = false;
      try {
        const res = await fetch('/api/engine/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: targetUrl,
            headers: customUserAgent ? { 'User-Agent': customUserAgent } : undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const cleanFname = targetUrl.split('/').pop()?.split('?')[0] || 'download.dat';
          setFilename(cleanFname);
          setTotalBytes(data.totalBytes || 0);
          setSupportsRange(Boolean(data.supportsRange));
          setIsResumable(Boolean(data.isResumable));
          if (data.etag) setEtag(data.etag);
          backendSuccess = true;
        }
      } catch {
        // Fall back to client probe
      }

      if (!backendSuccess) {
        const result = await probeUrl(targetUrl, customUserAgent ? { 'User-Agent': customUserAgent } : undefined, creds);
        setProbeResult(result);
        setFilename(result.filename);
        setTotalBytes(result.totalBytes);
        setSupportsRange(result.supportsRange);
        setIsResumable(result.isResumable);
        setProtocol(result.protocol);
        if (result.etag) setEtag(result.etag);
        setCategory(result.category);
      }
    } catch (e) {
      console.warn('Probe error:', e);
    } finally {
      setIsProbing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    if (protocol === 'torrent') {
      const torrentItem: DownloadItem = {
        id: `dl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        url: url.trim(),
        filename: 'Fetching torrent info...',
        directory,
        totalBytes: 0,
        downloadedBytes: 0,
        speed: 0,
        status: 'downloading',
        category: 'custom',
        protocol: 'torrent',
        segmentsCount: 1,
        segments: [],
        supportsRange: true,
        dateAdded: Date.now(),
        priority: 'normal',
      };
      onAddDownload(torrentItem, true);
      onClose();
      return;
    }

    if (protocol === 'video') {
      const videoItem: DownloadItem = {
        id: `dl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        url: url.trim(),
        filename: 'Fetching video info...',
        directory,
        totalBytes: 0,
        downloadedBytes: 0,
        speed: 0,
        status: 'downloading',
        category: 'video_audio',
        protocol: 'video',
        segmentsCount: 1,
        segments: [],
        supportsRange: true,
        dateAdded: Date.now(),
        priority: 'normal',
        videoQuality,
      };
      onAddDownload(videoItem, true);
      onClose();
      return;
    }

    // Check if DRM is present
    if (probeResult?.streamInfo?.hasDrm) {
      alert(`Download restricted: ${probeResult.streamInfo.drmType || 'DRM'} encryption detected. NOVA strictly complies with DRM and intellectual property standards and does not bypass content protection.`);
      return;
    }

    const finalFilename = filename.trim() || 'download_' + Date.now();
    const finalBytes = totalBytes > 0 ? totalBytes : 150 * 1024 * 1024;
    const finalSegments = generateSegments(finalBytes, supportsRange ? segmentsCount : 1);

    const creds: ProtocolCredentials | undefined = (protocol === 'ftp' || protocol === 'ftps' || protocol === 'sftp') ? {
      username: ftpUsername,
      password: ftpPassword,
      port: ftpPort,
      passiveMode,
    } : undefined;

    const newItem: DownloadItem = {
      id: `dl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      url: url.trim(),
      filename: finalFilename,
      directory,
      totalBytes: finalBytes,
      downloadedBytes: 0,
      speed: 0,
      status: startMode === 'immediate' ? 'downloading' : startMode === 'schedule' ? 'scheduled' : 'queued',
      category,
      protocol,
      segmentsCount: supportsRange ? segmentsCount : 1,
      segments: finalSegments,
      supportsRange,
      isResumable,
      credentials: creds,
      streamInfo: probeResult?.streamInfo,
      etag: etag || undefined,
      dateAdded: Date.now(),
      priority: 'normal',
      sha256Expected: sha256Expected.trim() || undefined,
      scheduledTime: startMode === 'schedule' && scheduleTime ? new Date(scheduleTime).getTime() : undefined,
      headers: customUserAgent || customCookies ? {
        ...(customUserAgent ? { 'User-Agent': customUserAgent } : {}),
        ...(customCookies ? { 'Cookie': customCookies } : {}),
      } : undefined,
    };

    onAddDownload(newItem, startMode === 'immediate');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-[#141821] border border-white/[0.12] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-[#11141c] border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${accentClasses.bg} text-slate-950`}>
              <Download className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Add Download</h3>
              <p className="text-[11px] text-slate-400">Multi-protocol engine: HTTP, HTTPS, FTP, FTPS, SFTP, and Video Streams</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Protocol Selection Tabs */}
          <div className="flex items-center gap-2 p-1 bg-[#0c0e14] rounded-lg border border-white/[0.06]">
            {[
              { id: 'https', label: 'HTTP / HTTPS' },
              { id: 'video', label: 'Video Sites' },
              { id: 'torrent', label: 'Torrent / Magnet' },
              { id: 'ftp', label: 'FTP / FTPS' },
              { id: 'sftp', label: 'SFTP (SSH)' },
              { id: 'hls', label: 'HLS / DASH Stream' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setProtocol(tab.id as any);
                  if (tab.id === 'sftp') setFtpPort(22);
                  else if (tab.id === 'ftp') setFtpPort(21);
                }}
                className={`flex-1 py-1 px-2 rounded text-[11px] font-medium transition-colors ${
                  protocol === tab.id || (tab.id === 'hls' && (protocol === 'hls' || protocol === 'dash')) || (tab.id === 'https' && (protocol === 'http' || protocol === 'https'))
                    ? `${accentClasses.bg} text-slate-950 font-bold shadow-xs`
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* URL Input with Probe */}
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">
              {protocol === 'ftp' || protocol === 'ftps' 
                ? 'FTP Server URL (e.g. ftp://host/path/file.iso)'
                : protocol === 'sftp'
                ? 'SFTP Path (e.g. sftp://user@host:22/remote/path.zip)'
                : protocol === 'torrent'
                ? 'Magnet link, .torrent link, or .torrent file'
                : protocol === 'video'
                ? 'Video page link (YouTube, Vimeo, X, TikTok, Instagram, Facebook...)'
                : 'Download or Stream URL'}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder={protocol === 'ftp' ? 'ftp://ftp.example.com/pub/file.tar.gz' : protocol === 'torrent' ? 'magnet:?xt=urn:btih:...' : protocol === 'video' ? 'https://www.youtube.com/watch?v=...' : 'https://example.com/files/archive.zip'}
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setProbeResult(null);
                    if (/^magnet:/i.test(e.target.value.trim())) setProtocol('torrent');
                    else if (isVideoSiteUrl(e.target.value)) setProtocol('video');
                  }}
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded pl-8 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-white/30 font-mono"
                />
              </div>
              {protocol === 'torrent' && isTauriEnvironment() && (
                <button
                  type="button"
                  onClick={async () => {
                    const f = await pickTorrentFile();
                    if (f) setUrl(f);
                  }}
                  className="px-3.5 py-2 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded text-slate-200 font-medium shrink-0 transition-colors"
                >
                  Choose .torrent file
                </button>
              )}
              {!isSpecial && (<button
                type="button"
                onClick={() => handleProbe()}
                disabled={!url || isProbing}
                className="px-3.5 py-2 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] rounded text-slate-200 font-medium flex items-center gap-1.5 shrink-0 disabled:opacity-40 transition-colors"
              >
                {isProbing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                ) : probeResult ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                )}
                <span>Verify & Probe</span>
              </button>)}
            </div>
          </div>

          {/* Protocol Credentials (shown for FTP / FTPS / SFTP) */}
          {(protocol === 'ftp' || protocol === 'ftps' || protocol === 'sftp') && (
            <div className="p-3 bg-[#0d1017] border border-white/[0.08] rounded-lg space-y-3">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-1.5">
                <span className="font-semibold text-slate-200 text-[11px] flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{protocol.toUpperCase()} Authentication & Transfer Mode</span>
                </span>
                <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={passiveMode}
                    onChange={(e) => setPassiveMode(e.target.checked)}
                    className="rounded bg-black/40 border-white/20"
                  />
                  <span>Passive Mode (PASV)</span>
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Port</label>
                  <input
                    type="number"
                    value={ftpPort}
                    onChange={(e) => setFtpPort(parseInt(e.target.value, 10))}
                    className="w-full bg-[#121620] border border-white/[0.1] rounded px-2.5 py-1 text-xs text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Username</label>
                  <input
                    type="text"
                    value={ftpUsername}
                    onChange={(e) => setFtpUsername(e.target.value)}
                    placeholder="anonymous"
                    className="w-full bg-[#121620] border border-white/[0.1] rounded px-2.5 py-1 text-xs text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Password</label>
                  <input
                    type="password"
                    value={ftpPassword}
                    onChange={(e) => setFtpPassword(e.target.value)}
                    placeholder="password"
                    className="w-full bg-[#121620] border border-white/[0.1] rounded px-2.5 py-1 text-xs text-slate-100 font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Probe Capability Diagnostic Banner */}
          {probeResult && (
            <div className={`p-2.5 rounded-lg border text-[11px] space-y-1 ${
              probeResult.streamInfo?.hasDrm 
                ? 'bg-rose-950/30 border-rose-500/40 text-rose-200' 
                : 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
            }`}>
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5">
                  {probeResult.streamInfo?.hasDrm ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>
                    {probeResult.streamInfo?.hasDrm 
                      ? `DRM Protection Detected (${probeResult.streamInfo.drmType})`
                      : `Server Capability Verified: ${probeResult.isResumable ? 'Resumable Range 206 Supported' : 'Single Stream (No Range)'}`}
                  </span>
                </span>
                <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/40">
                  {probeResult.protocol}
                </span>
              </div>
              <p className="text-[10px] text-slate-300">
                {probeResult.warning || `File size: ${formatBytes(probeResult.totalBytes)} · MIME: ${probeResult.mimeType || 'binary'}`}
              </p>
            </div>
          )}

          {/* File Name & Estimated Size */}
          {!isSpecial && (<>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-slate-300 block mb-1">
                File Name
              </label>
              <input
                type="text"
                required
                placeholder="filename.ext"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  const ext = getFileExtension(e.target.value);
                  setCategory(categorizeExtension(ext));
                }}
                className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-300 block mb-1">
                File Size
              </label>
              <div className="bg-[#0d1016] border border-white/[0.1] rounded px-3 py-2 text-xs text-slate-300 font-mono tabular-nums">
                {totalBytes > 0 ? formatBytes(totalBytes) : 'Unknown'}
              </div>
            </div>
          </div>

          </>)}

          {/* Destination Folder & Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-300 block mb-1">
                Save Destination
              </label>
              <div className="relative">
                <Folder className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded pl-8 pr-20 py-2 text-xs text-slate-200 focus:outline-none focus:border-white/30 font-mono text-[11px]"
                />
                {isTauriEnvironment() && (
                  <button
                    type="button"
                    onClick={handleBrowse}
                    className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] rounded bg-white/[0.08] hover:bg-white/[0.15] text-slate-200"
                  >
                    Browse…
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-300 block mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-white/30 cursor-pointer"
              >
                <option value="video_audio">Video & Audio</option>
                <option value="documents">Documents</option>
                <option value="compressed">Compressed Files</option>
                <option value="applications">Applications / Programs</option>
                <option value="custom">Custom / General</option>
              </select>
            </div>
          </div>

          {protocol === 'torrent' && (
            <div className="bg-[#0d1016] border border-white/[0.08] rounded-lg p-3 space-y-1.5 text-slate-300">
              <div className="font-semibold text-slate-200 text-xs">Torrent / magnet download</div>
              <p className="text-[11px] text-slate-400">
                Paste a magnet link, a link to a .torrent file, or choose a .torrent file from your PC. NOVA finds the
                files, downloads them, and shows speed and time left. Seeding after the download is off by default.
              </p>
              <p className="text-[11px] text-slate-400">Only download content you have the right to share and save.</p>
            </div>
          )}

          {protocol === 'video' && (
            <div className="bg-[#0d1016] border border-white/[0.08] rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-slate-200 text-xs">Video quality</div>
                {videoProbing && (
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Reading available resolutions...</span>
                  </div>
                )}
              </div>

              {videoInfo && (
                <div className="flex items-center gap-2.5 p-2 rounded-md bg-white/[0.04] border border-white/[0.06]">
                  {videoInfo.thumbnail && (
                    <img src={videoInfo.thumbnail} alt="" className="w-20 h-12 object-cover rounded" />
                  )}
                  <div className="min-w-0">
                    <div className="text-slate-200 font-medium truncate">{videoInfo.title}</div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {videoInfo.uploader}
                      {videoInfo.duration > 0 && ` · ${Math.floor(videoInfo.duration / 60)}:${String(videoInfo.duration % 60).padStart(2, '0')}`}
                    </div>
                  </div>
                </div>
              )}

              {videoError && (
                <div className="text-[11px] text-rose-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{videoError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                {[
                  ['best', 'Best available (highest resolution)'],
                  ['audio', 'Audio only (MP3)'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setVideoQuality(id)}
                    className={`py-1.5 rounded text-[11px] border transition-colors ${
                      videoQuality === id
                        ? `${accentClasses.bg} text-slate-950 font-bold border-transparent`
                        : 'bg-[#141821] text-slate-300 border-white/[0.08] hover:bg-white/[0.06]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {videoInfo && videoInfo.formats.length > 0 && (
                <div className="max-h-44 overflow-y-auto rounded-md border border-white/[0.06] divide-y divide-white/[0.04]">
                  {videoInfo.formats.map((f) => {
                    const id = 'fmt:' + f.id;
                    const total = f.size > 0 ? f.size + (f.has_audio ? 0 : videoInfo.best_audio_size) : 0;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setVideoQuality(id)}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors ${
                          videoQuality === id ? 'bg-white/[0.1] text-white' : 'text-slate-300 hover:bg-white/[0.05]'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="font-bold w-14 shrink-0">{resolutionName(f.height)}</span>
                          <span className="font-mono">
                            {f.height}p{f.fps > 30 ? ` ${f.fps}fps` : ''}
                          </span>
                          {f.hdr && (
                            <span className="px-1 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">HDR</span>
                          )}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono shrink-0">
                          {f.ext.toUpperCase()} · {f.vcodec}
                          {total > 0 ? ` · ${f.size_estimated || (!f.has_audio && videoInfo.best_audio_size > 0) ? '~' : ''}${formatBytes(total)}` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="text-[11px] text-slate-400">
                Single videos only (playlists are skipped). Only download content you have the right to save.
                Protected (DRM) videos are not supported.
              </p>
            </div>
          )}

          {!isSpecial && (<>
          {/* Connection Segmentation & Thread Allocation */}
          <div className="bg-[#0d1016] border border-white/[0.08] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span className="font-semibold text-slate-200 text-xs">Segmented Threads</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-cyan-400 font-semibold">
                {supportsRange ? `${segmentsCount} connections` : '1 connection (Non-resumable)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {supportsRange 
                ? 'Splits the file into parallel HTTP Range segments to maximize bandwidth saturation.'
                : 'Server does not support HTTP Range requests; single sequential connection will be used.'}
            </p>
            {supportsRange && (
              <div className="flex items-center gap-1.5 pt-1">
                {[1, 2, 4, 8, 16, 32].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setSegmentsCount(num)}
                    className={`flex-1 py-1 text-xs font-mono rounded border transition-colors ${
                      segmentsCount === num
                        ? `${accentClasses.bg} text-slate-950 font-bold border-transparent`
                        : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:bg-white/[0.08]'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Start Mode: Immediate vs Queued vs Scheduled */}
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">
              Execution Strategy
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setStartMode('immediate')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded border text-xs font-medium transition-colors ${
                  startMode === 'immediate'
                    ? 'bg-white/[0.1] border-white/20 text-white'
                    : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span>Start Now</span>
              </button>

              <button
                type="button"
                onClick={() => setStartMode('queue')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded border text-xs font-medium transition-colors ${
                  startMode === 'queue'
                    ? 'bg-white/[0.1] border-white/20 text-white'
                    : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-blue-400" />
                <span>Queue</span>
              </button>

              <button
                type="button"
                onClick={() => setStartMode('schedule')}
                className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded border text-xs font-medium transition-colors ${
                  startMode === 'schedule'
                    ? 'bg-white/[0.1] border-white/20 text-white'
                    : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200'
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-amber-400" />
                <span>Schedule</span>
              </button>
            </div>

            {startMode === 'schedule' && (
              <div className="mt-2 space-y-2 p-2.5 bg-[#0c0f15] border border-white/[0.08] rounded-lg">
                <input
                  type="datetime-local"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full bg-[#11141d] border border-white/[0.1] rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none font-mono"
                />
                {scheduleTime && (
                  <div className="text-[11px] text-amber-300 flex items-center justify-between font-mono pt-0.5">
                    <span>Will start {formatScheduledDateTime(new Date(scheduleTime).getTime())}</span>
                    <span>({formatCountdown(new Date(scheduleTime).getTime())})</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Advanced Accordion: Checksum & Custom Headers */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              <span>Advanced Options (SHA-256 Checksum & Custom Headers)</span>
            </button>

            {showAdvanced && (
              <div className="mt-2 space-y-3 p-3 bg-[#0e1117] border border-white/[0.06] rounded-lg">
                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    Expected SHA-256 Checksum (for file integrity verification)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. c2e6f4208d18e3fa5c72e474f8eed7b8..."
                    value={sha256Expected}
                    onChange={(e) => setSha256Expected(e.target.value)}
                    className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-3 py-1.5 text-xs text-slate-200 font-mono text-[11px]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    Custom User-Agent
                  </label>
                  <input
                    type="text"
                    placeholder="Leave empty for default"
                    value={customUserAgent}
                    onChange={(e) => setCustomUserAgent(e.target.value)}
                    className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-3 py-1.5 text-xs text-slate-200 font-mono text-[11px]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-medium text-slate-300 block mb-1">
                    Custom Cookie Header (for authenticated sessions)
                  </label>
                  <input
                    type="text"
                    placeholder="session_id=...; auth_token=..."
                    value={customCookies}
                    onChange={(e) => setCustomCookies(e.target.value)}
                    className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-3 py-1.5 text-xs text-slate-200 font-mono text-[11px]"
                  />
                </div>
              </div>
            )}
          </div>

          </>)}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-300 hover:text-white rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={probeResult?.streamInfo?.hasDrm}
              className={`px-5 py-2 text-xs font-semibold ${
                probeResult?.streamInfo?.hasDrm 
                  ? 'bg-rose-900/50 text-rose-300 cursor-not-allowed'
                  : `${accentClasses.bg} text-slate-950 hover:brightness-110 shadow-sm`
              } rounded-lg transition-all`}
            >
              {probeResult?.streamInfo?.hasDrm 
                ? 'DRM Protected (Blocked)'
                : startMode === 'immediate' ? 'Start Download' : startMode === 'queue' ? 'Add to Queue' : 'Schedule Download'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
