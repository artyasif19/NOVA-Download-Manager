/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
}

const PRESETS = [
  {
    name: 'Ubuntu 24.04 ISO (HTTPS)',
    url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04.1-desktop-amd64.iso',
    protocol: 'https' as const,
    size: 5974000000,
    category: 'compressed' as const,
    resumable: true,
  },
  {
    name: 'Big Buck Bunny 4K (MP4)',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    protocol: 'https' as const,
    size: 158008374,
    category: 'video_audio' as const,
    resumable: true,
  },
  {
    name: 'Debian CD Image (FTP)',
    url: 'ftp://ftp.debian.org/debian/dists/stable/main/Contents-amd64.gz',
    protocol: 'ftp' as const,
    size: 44200000,
    category: 'compressed' as const,
    resumable: true,
  },
  {
    name: 'HLS Live/VOD Stream (.m3u8)',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    protocol: 'hls' as const,
    size: 65000000,
    category: 'video_audio' as const,
    resumable: true,
  },
  {
    name: 'Node.js LTS MSI (HTTPS)',
    url: 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi',
    protocol: 'https' as const,
    size: 34185216,
    category: 'applications' as const,
    resumable: true,
  },
  {
    name: 'Widevine DRM Demo (.mpd)',
    url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd',
    protocol: 'dash' as const,
    size: 92000000,
    category: 'video_audio' as const,
    resumable: false,
    hasDrm: true,
  },
];

export const AddDownloadModal: React.FC<AddDownloadModalProps> = ({
  isOpen,
  onClose,
  onAddDownload,
  settings,
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

  // Auto-probe when URL looks complete
  const handleProbe = async (targetUrl = url) => {
    if (!targetUrl || targetUrl.length < 5) return;
    setIsProbing(true);
    setProbeResult(null);

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

  const handleApplyPreset = (preset: typeof PRESETS[0]) => {
    setUrl(preset.url);
    setProtocol(preset.protocol);
    const parts = preset.url.split('/');
    let fname = parts[parts.length - 1];
    if (fname.includes('?')) fname = fname.split('?')[0];
    if (preset.protocol === 'hls' && fname.endsWith('.m3u8')) fname = fname.replace(/\.m3u8$/i, '.mp4');
    if (preset.protocol === 'dash' && fname.endsWith('.mpd')) fname = fname.replace(/\.mpd$/i, '.mp4');
    
    setFilename(fname || 'download.dat');
    setTotalBytes(preset.size);
    setCategory(preset.category);
    setSupportsRange(preset.resumable);
    setIsResumable(preset.resumable);

    // Auto-probe preset to show verified capabilities
    handleProbe(preset.url);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

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
          {/* Quick Presets */}
          <div>
            <div className="text-[11px] text-slate-400 font-medium mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              <span>Multi-Protocol Presets & Test Links:</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => handleApplyPreset(p)}
                  className="px-2 py-1.5 bg-[#0e1117] hover:bg-white/[0.05] border border-white/[0.06] rounded text-left truncate transition-colors group"
                >
                  <div className="font-medium text-slate-200 truncate group-hover:text-cyan-300">{p.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono flex items-center justify-between mt-0.5">
                    <span>{formatBytes(p.size)}</span>
                    <span className="uppercase text-[9px] px-1 rounded bg-white/[0.04] text-slate-300">{p.protocol}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Protocol Selection Tabs */}
          <div className="flex items-center gap-2 p-1 bg-[#0c0e14] rounded-lg border border-white/[0.06]">
            {[
              { id: 'https', label: 'HTTP / HTTPS' },
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
                : 'Download or Stream URL'}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder={protocol === 'ftp' ? 'ftp://ftp.example.com/pub/file.tar.gz' : 'https://example.com/files/archive.zip'}
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setProbeResult(null);
                  }}
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded pl-8 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-white/30 font-mono"
                />
              </div>
              <button
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
              </button>
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
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded pl-8 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-white/30 font-mono text-[11px]"
                />
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
