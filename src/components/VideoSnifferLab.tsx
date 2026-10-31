/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  Video, 
  Download, 
  Settings2, 
  Check, 
  ExternalLink, 
  ShieldCheck, 
  Play, 
  Pause, 
  Volume2, 
  Sliders, 
  Sparkles, 
  Info, 
  ChevronDown,
  Lock,
  AlertTriangle,
  Radio
} from 'lucide-react';
import { AppSettings, DownloadItem } from '../types/download';
import { generateSegments } from '../services/downloadEngine';
import { formatBytes } from '../utils/formatters';

interface VideoSnifferLabProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onAddDownload: (item: DownloadItem, startImmediately: boolean) => void;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
}

const SAMPLE_MEDIA_STREAMS = [
  {
    id: 'stream-1080p',
    label: '1080p Full HD (MP4 Progressive)',
    format: 'progressive',
    resolution: '1920x1080',
    codec: 'H.264 / AAC',
    approxBytes: 158008374,
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    filename: 'BigBuckBunny_1080p_60fps.mp4',
    hasDrm: false,
  },
  {
    id: 'stream-720p',
    label: '720p HD (MP4 Progressive)',
    format: 'progressive',
    resolution: '1280x720',
    codec: 'H.264 / AAC',
    approxBytes: 84200000,
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    filename: 'ElephantsDream_720p.mp4',
    hasDrm: false,
  },
  {
    id: 'stream-hls',
    label: 'HLS Master Playlist (.m3u8)',
    format: 'hls',
    resolution: '1080p Adaptive Multi-bitrate',
    codec: 'AVC1 / MP4A',
    approxBytes: 65400000,
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    filename: 'Mux_Adaptive_Stream.mp4',
    hasDrm: false,
  },
  {
    id: 'stream-audio',
    label: 'Audio Track (M4A / 320kbps)',
    format: 'progressive',
    resolution: 'Audio Only',
    codec: 'AAC-LC High Profile',
    approxBytes: 14200000,
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    filename: 'ElephantsDream_Soundtrack.m4a',
    hasDrm: false,
  },
  {
    id: 'stream-drm-widevine',
    label: 'Widevine DRM Encrypted (DASH .mpd)',
    format: 'dash',
    resolution: '1080p Widevine Protected',
    codec: 'CENC / CBCS',
    approxBytes: 94000000,
    url: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-widevine/dash.mpd',
    filename: 'Protected_Widevine_Stream.mp4',
    hasDrm: true,
    drmType: 'Google Widevine DRM (Level 1/3)',
  },
];

export const VideoSnifferLab: React.FC<VideoSnifferLabProps> = ({
  settings,
  onUpdateSettings,
  onAddDownload,
  accentClasses,
}) => {
  const [selectedStreamId, setSelectedStreamId] = useState('stream-1080p');
  const [showDropdown, setShowDropdown] = useState(false);
  const [lastSentStream, setLastSentStream] = useState<string | null>(null);
  const [overlayPosition, setOverlayPosition] = useState<'top-right' | 'top-left' | 'bottom-right'>('top-right');
  const [simulatedDomain, setSimulatedDomain] = useState('streaming-service.example.com');
  const [drmWarning, setDrmWarning] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const currentStream = SAMPLE_MEDIA_STREAMS.find(s => s.id === selectedStreamId) || SAMPLE_MEDIA_STREAMS[0];
  const isDomainExcluded = settings.excludedDomains.includes(simulatedDomain);

  const handleToggleDomainExclusion = () => {
    if (isDomainExcluded) {
      onUpdateSettings({
        excludedDomains: settings.excludedDomains.filter(d => d !== simulatedDomain),
      });
    } else {
      onUpdateSettings({
        excludedDomains: [...settings.excludedDomains, simulatedDomain],
      });
    }
  };

  const handleDownloadStream = (stream: typeof SAMPLE_MEDIA_STREAMS[0]) => {
    if (stream.hasDrm) {
      setDrmWarning(`DRM Protection Active (${stream.drmType}): Stream is hardware-encrypted via Encrypted Media Extensions (EME). NOVA strictly adheres to DRM security and does not bypass copyright mechanisms.`);
      setTimeout(() => setDrmWarning(null), 5000);
      setShowDropdown(false);
      return;
    }

    const segments = generateSegments(stream.approxBytes, settings.maxConnectionsPerDownload);
    const newItem: DownloadItem = {
      id: `dl-video-${Date.now()}`,
      url: stream.url,
      filename: stream.filename,
      directory: `${settings.defaultFolder}\\Video`,
      totalBytes: stream.approxBytes,
      downloadedBytes: 0,
      speed: 0,
      status: 'downloading',
      category: 'video_audio',
      protocol: stream.format === 'hls' ? 'hls' : stream.format === 'dash' ? 'dash' : 'https',
      segmentsCount: settings.maxConnectionsPerDownload,
      segments,
      supportsRange: stream.format === 'progressive',
      isResumable: true,
      mimeType: stream.label.includes('Audio') ? 'audio/mp4' : 'video/mp4',
      dateAdded: Date.now(),
      priority: 'high',
      streamInfo: {
        format: stream.format as any,
        hasDrm: stream.hasDrm,
        quality: stream.resolution,
        codecs: stream.codec,
      },
    };

    onAddDownload(newItem, true);
    setLastSentStream(stream.label);
    setShowDropdown(false);
    setTimeout(() => setLastSentStream(null), 3500);
  };

  return (
    <div className="flex-1 bg-[#0c0e12] overflow-y-auto p-5 space-y-5 select-none text-xs">
      {/* Top Banner / Explanation */}
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-100">Floating Media Sniffer & DRM Inspector</h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">
              WebExtensions Content Script + DRM Analysis
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Simulates the browser extension floating grabber on HTML5 video players, inspecting MP4, HLS, DASH, and DRM status.
          </p>
        </div>

        {/* Global Sniffer Switch */}
        <div className="flex items-center gap-3 bg-[#13161f] border border-white/[0.08] px-3 py-1.5 rounded-lg">
          <span className="text-xs text-slate-300 font-medium">Extension Sniffer:</span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableFloatingSniffer}
              onChange={(e) => onUpdateSettings({ enableFloatingSniffer: e.target.checked })}
              className="sr-only peer"
            />
            <div className={`w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all ${accentClasses.bg}`}></div>
          </label>
        </div>
      </div>

      {/* Main Split: Simulated Web Page & Video Player on Left, Controls on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column: Simulated Browser Viewport with HTML5 Video */}
        <div className="lg:col-span-2 space-y-3">
          {/* Simulated Browser Address Bar */}
          <div className="bg-[#141822] border border-white/[0.08] rounded-t-xl p-2.5 flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-400">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
            </div>

            <div className="flex-1 bg-[#0c0e13] px-3 py-1 rounded border border-white/[0.06] text-slate-300 font-mono text-[11px] flex items-center justify-between">
              <span>https://{simulatedDomain}/media/{currentStream.id}</span>
              <button
                onClick={handleToggleDomainExclusion}
                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                  isDomainExcluded
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'bg-white/[0.06] text-slate-400 hover:text-slate-200'
                }`}
              >
                {isDomainExcluded ? 'Domain Excluded' : 'Exclude Domain'}
              </button>
            </div>
          </div>

          {/* Video Container with NOVA Floating Download Badge */}
          <div className="relative bg-black rounded-b-xl overflow-hidden border border-white/[0.08] aspect-video group">
            <video
              ref={videoRef}
              src={currentStream.url}
              controls
              playsInline
              className="w-full h-full object-cover"
            />

            {/* THE FLOATING NOVA SNIFFER BUTTON */}
            {settings.enableFloatingSniffer && !isDomainExcluded && (
              <div
                className={`absolute z-30 transition-all ${
                  overlayPosition === 'top-right'
                    ? 'top-3 right-3'
                    : overlayPosition === 'top-left'
                    ? 'top-3 left-3'
                    : 'bottom-16 right-3'
                }`}
              >
                <div className="relative">
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 backdrop-blur-md rounded-md shadow-lg shadow-black/60 transition-all text-xs font-semibold ${
                      currentStream.hasDrm
                        ? 'bg-[#181115]/95 border border-rose-500/50 text-rose-200 hover:border-rose-400'
                        : 'bg-[#0e1219]/90 hover:bg-[#141924] border border-cyan-500/40 hover:border-cyan-400 text-slate-100'
                    }`}
                  >
                    {currentStream.hasDrm ? (
                      <Lock className="w-3.5 h-3.5 text-rose-400 stroke-[2.5]" />
                    ) : (
                      <Download className="w-3.5 h-3.5 text-cyan-400 stroke-[2.5]" />
                    )}
                    <span>{currentStream.hasDrm ? 'DRM Protected' : 'Download Video'}</span>
                    <ChevronDown className="w-3 h-3 text-slate-400" />
                  </button>

                  {/* Dropdown with Real Stream Formats */}
                  {showDropdown && (
                    <div className="absolute right-0 top-full mt-1.5 w-72 bg-[#141822] border border-white/[0.12] rounded-lg shadow-2xl p-1 z-40 text-xs animate-in fade-in zoom-in-95">
                      <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-white/[0.06] mb-1 flex items-center justify-between">
                        <span>Detected Streams ({SAMPLE_MEDIA_STREAMS.length})</span>
                        <span className="text-cyan-400 font-mono">Auto-Sniffer</span>
                      </div>

                      {SAMPLE_MEDIA_STREAMS.map((stream) => (
                        <button
                          key={stream.id}
                          onClick={() => handleDownloadStream(stream)}
                          className="w-full p-2 hover:bg-white/[0.06] rounded flex flex-col text-left transition-colors group/item"
                        >
                          <div className="flex items-center justify-between text-slate-200 font-medium">
                            <span className="flex items-center gap-1.5">
                              {stream.hasDrm && <Lock className="w-3 h-3 text-rose-400 shrink-0" />}
                              <span className={stream.hasDrm ? 'text-rose-200' : ''}>{stream.label}</span>
                            </span>
                            <span className={`text-[10px] font-mono tabular-nums ${stream.hasDrm ? 'text-rose-400' : 'text-cyan-400'}`}>
                              {stream.hasDrm ? 'Encrypted' : formatBytes(stream.approxBytes)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono">
                            <span>{stream.resolution}</span>
                            <span>·</span>
                            <span>{stream.codec}</span>
                          </div>
                        </button>
                      ))}

                      <div className="border-t border-white/[0.06] mt-1 pt-1.5 px-2 py-1 text-[10px] text-slate-400 flex items-center justify-between">
                        <span>Preserve Auth Tokens</span>
                        <span className="text-emerald-400 font-mono">Enabled</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* DRM Warning banner */}
            {drmWarning && (
              <div className="absolute bottom-4 left-4 right-4 bg-rose-950/95 border border-rose-500/50 text-rose-200 p-3 rounded-lg shadow-xl text-xs flex items-start gap-2.5 z-40 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-rose-100">Content Protection Notice</div>
                  <p className="text-[11px] text-rose-200/90 mt-0.5 leading-relaxed">{drmWarning}</p>
                </div>
                <button
                  onClick={() => setDrmWarning(null)}
                  className="text-rose-400 hover:text-rose-200 text-sm font-bold"
                >
                  ×
                </button>
              </div>
            )}

            {/* Notification when stream sent */}
            {lastSentStream && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-500/95 text-slate-950 font-semibold px-3 py-1 rounded shadow-lg text-xs flex items-center gap-1.5 z-40">
                <Check className="w-3.5 h-3.5 stroke-[3]" />
                <span>Queued {lastSentStream} in NOVA Download Manager!</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Player Stream Selector & Sniffer Configuration */}
        <div className="space-y-4">
          <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 space-y-3 text-xs">
            <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <h3 className="font-semibold text-slate-100">Live Player Media Selector</h3>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Select Stream Loaded in Player:
              </label>
              {SAMPLE_MEDIA_STREAMS.map(stream => (
                <button
                  key={stream.id}
                  onClick={() => {
                    setSelectedStreamId(stream.id);
                    if (videoRef.current) {
                      videoRef.current.src = stream.url;
                      videoRef.current.load();
                    }
                  }}
                  className={`w-full text-left p-2 rounded border transition-colors flex items-center justify-between ${
                    selectedStreamId === stream.id
                      ? 'bg-white/[0.08] border-cyan-500/40 text-slate-100'
                      : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="truncate">
                    <div className="font-medium text-slate-200 flex items-center gap-1.5">
                      {stream.hasDrm && <Lock className="w-3 h-3 text-rose-400 shrink-0" />}
                      <span className="truncate">{stream.label}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">{stream.resolution}</div>
                  </div>
                  <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                    stream.hasDrm ? 'bg-rose-950/40 text-rose-400 border border-rose-500/30' : 'bg-cyan-950/40 text-cyan-400 border border-cyan-500/30'
                  }`}>
                    {stream.format}
                  </span>
                </button>
              ))}
            </div>

            {/* Button Position */}
            <div className="pt-2 border-t border-white/[0.06]">
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Button Position on Player:
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['top-right', 'top-left', 'bottom-right'] as const).map((pos) => (
                  <button
                    key={pos}
                    onClick={() => setOverlayPosition(pos)}
                    className={`py-1 px-2 rounded border text-[11px] font-medium transition-colors ${
                      overlayPosition === pos
                        ? 'bg-white/[0.1] border-cyan-500/40 text-cyan-300'
                        : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {pos === 'top-right' ? 'Top Right' : pos === 'top-left' ? 'Top Left' : 'Bottom Right'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Privacy & Legal Compliance Note */}
          <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 text-xs space-y-2">
            <div className="flex items-center gap-1.5 text-slate-300 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Compliant & Privacy-First Architecture</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              NOVA detects ordinary HTML5 progressive media and accessible streams. It does not bypass DRM (Widevine, FairPlay, PlayReady), tamper with encrypted paywalls, or transmit browsing history to any remote server.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
