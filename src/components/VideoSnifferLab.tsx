/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  Play,
  Pause,
  Rewind,
  FastForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize2,
  PictureInPicture2,
  Loader2,
  Link2,
  AlertTriangle,
  Expand,
  Shrink,
  FolderOpen,
} from 'lucide-react';
import { AppSettings, DownloadItem } from '../types/download';
import { isTauriEnvironment, pickFolder, probeVideo, resolutionName, VideoInfo } from '../services/tauriBridge';
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

const SPEEDS = [0.25, 0.5, 1, 1.25, 1.5, 2, 4, 8, 10, 16];

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export const VideoSnifferLab: React.FC<VideoSnifferLabProps> = ({ settings, onAddDownload, accentClasses }) => {
  const [link, setLink] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [quality, setQuality] = useState('best');
  const [directory, setDirectory] = useState(settings.defaultFolder);
  const [sentMsg, setSentMsg] = useState('');

  // player state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerBoxRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [bigScreen, setBigScreen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    setDirectory(settings.defaultFolder);
  }, [settings.defaultFolder]);

  const load = async () => {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('Paste a full video link that starts with http:// or https://');
      return;
    }
    setLoading(true);
    setError('');
    setInfo(null);
    setSentMsg('');
    setQuality('best');
    try {
      const result = await probeVideo(url);
      setInfo(result);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const startDownload = () => {
    if (!info) return;
    const item: DownloadItem = {
      id: `dl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      url: link.trim(),
      filename: info.title || 'Fetching video info...',
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
      videoQuality: quality,
    };
    onAddDownload(item, true);
    setSentMsg('Download started. You can follow it in the Downloads tab.');
  };

  const browse = async () => {
    const picked = await pickFolder('Select download folder');
    if (picked) setDirectory(picked);
  };

  // ---- player helpers ----
  const v = () => videoRef.current;
  const togglePlay = () => {
    const el = v();
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };
  const skip = (delta: number) => {
    const el = v();
    if (el) el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
  };
  const changeRate = (r: number) => {
    setRate(r);
    const el = v();
    if (el) el.playbackRate = r;
  };
  const fullscreen = () => {
    const box = playerBoxRef.current;
    if (!box) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else box.requestFullscreen().catch(() => {});
  };
  const pip = () => {
    const el = v() as any;
    if (el && el.requestPictureInPicture) el.requestPictureInPicture().catch(() => {});
  };

  const desktop = isTauriEnvironment();

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Media Grabber</h2>
        <p className="text-slate-400 mt-0.5">
          Paste a video link (YouTube, Vimeo, X, TikTok, Instagram, Facebook and more). Preview it, pick the exact
          resolution, then download.
        </p>
      </div>

      {!desktop && (
        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300">
          The video tools only work inside the NOVA desktop app.
        </div>
      )}

      {/* Link bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Link2 className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') load();
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            className="w-full bg-[#0d1016] border border-white/[0.1] rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-white/30"
          />
        </div>
        <button
          onClick={load}
          disabled={loading || !desktop}
          className={`px-5 py-2.5 rounded-lg font-bold text-slate-950 ${accentClasses.bg} disabled:opacity-50 flex items-center gap-2`}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'Reading...' : 'Load video'}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {info && (
        <div className={`grid gap-4 ${bigScreen ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]'}`}>
          {/* ---------------- Player ---------------- */}
          <div className="bg-[#0d1016] border border-white/[0.08] rounded-xl overflow-hidden">
            <div className="px-3 py-2 flex items-center justify-between border-b border-white/[0.06]">
              <div className="min-w-0">
                <div className="text-slate-100 font-semibold truncate">{info.title}</div>
                <div className="text-[11px] text-slate-400 truncate">
                  {info.uploader}
                  {info.duration > 0 && ` · ${fmtTime(info.duration)}`}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setBigScreen((b) => !b)}
                  title={bigScreen ? 'Normal size' : 'Big screen'}
                  className="p-1.5 rounded text-slate-300 hover:bg-white/[0.08]"
                >
                  {bigScreen ? <Shrink className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setMinimized((m) => !m)}
                  title={minimized ? 'Show player' : 'Minimize player'}
                  className="p-1.5 rounded text-slate-300 hover:bg-white/[0.08]"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {!minimized && (
              <div ref={playerBoxRef} className="bg-black">
                {info.preview_url ? (
                  <>
                    <video
                      ref={videoRef}
                      src={info.preview_url}
                      poster={info.thumbnail || undefined}
                      className="w-full max-h-[62vh] bg-black"
                      onClick={togglePlay}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onTimeUpdate={(e) => setTime((e.target as HTMLVideoElement).currentTime)}
                      onLoadedMetadata={(e) => {
                        const el = e.target as HTMLVideoElement;
                        setDuration(el.duration);
                        el.playbackRate = rate;
                        el.volume = volume;
                      }}
                    />
                    {/* Controls */}
                    <div className="px-3 py-2 space-y-1.5 bg-[#0b0e14]">
                      <input
                        type="range"
                        min={0}
                        max={duration || 0}
                        step={0.1}
                        value={time}
                        onChange={(e) => {
                          const el = v();
                          if (el) el.currentTime = Number(e.target.value);
                        }}
                        className="w-full accent-cyan-400"
                        title="Seek"
                      />
                      <div className="flex items-center justify-between gap-2 text-slate-200">
                        <div className="flex items-center gap-1">
                          <button onClick={() => skip(-10)} title="Back 10 seconds" className="p-1.5 rounded hover:bg-white/[0.1]">
                            <Rewind className="w-4 h-4" />
                          </button>
                          <button onClick={togglePlay} title="Play / Pause" className="p-1.5 rounded hover:bg-white/[0.1]">
                            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          </button>
                          <button onClick={() => skip(10)} title="Forward 10 seconds" className="p-1.5 rounded hover:bg-white/[0.1]">
                            <FastForward className="w-4 h-4" />
                          </button>
                          <span className="font-mono text-[11px] ml-1.5 text-slate-300">
                            {fmtTime(time)} / {fmtTime(duration)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-[11px] text-slate-400" title="Playback speed (fast forward)">
                            Speed
                            <select
                              value={rate}
                              onChange={(e) => changeRate(Number(e.target.value))}
                              className="bg-[#141821] border border-white/[0.1] rounded px-1 py-0.5 text-slate-200"
                            >
                              {SPEEDS.map((s) => (
                                <option key={s} value={s}>
                                  {s}x
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            onClick={() => {
                              setMuted((m) => !m);
                              const el = v();
                              if (el) el.muted = !muted;
                            }}
                            title="Mute"
                            className="p-1.5 rounded hover:bg-white/[0.1]"
                          >
                            {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                          </button>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={muted ? 0 : volume}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setVolume(val);
                              setMuted(false);
                              const el = v();
                              if (el) {
                                el.volume = val;
                                el.muted = false;
                              }
                            }}
                            className="w-20 accent-cyan-400"
                            title="Volume"
                          />
                          <button onClick={pip} title="Picture in picture" className="p-1.5 rounded hover:bg-white/[0.1]">
                            <PictureInPicture2 className="w-4 h-4" />
                          </button>
                          <button onClick={fullscreen} title="Full screen" className="p-1.5 rounded hover:bg-white/[0.1]">
                            <Maximize className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="relative">
                    {info.thumbnail && <img src={info.thumbnail} alt="" className="w-full max-h-[50vh] object-cover opacity-60" />}
                    <div className="absolute inset-0 flex items-center justify-center text-slate-200 text-center px-6">
                      No in-app preview is available for this video, but you can still download it in any resolution.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ---------------- Resolutions + download ---------------- */}
          <div className="bg-[#0d1016] border border-white/[0.08] rounded-xl p-3 space-y-3 self-start">
            <div className="font-semibold text-slate-200 text-sm">Choose resolution</div>

            <div className="grid grid-cols-2 gap-2">
              {[
                ['best', 'Best available'],
                ['audio', 'Audio only (MP3)'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setQuality(id)}
                  className={`py-1.5 rounded text-[11px] border transition-colors ${
                    quality === id
                      ? `${accentClasses.bg} text-slate-950 font-bold border-transparent`
                      : 'bg-[#141821] text-slate-300 border-white/[0.08] hover:bg-white/[0.06]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="max-h-72 overflow-y-auto rounded-md border border-white/[0.06] divide-y divide-white/[0.04]">
              {info.formats.map((f) => {
                const id = 'fmt:' + f.id;
                const total = f.size > 0 ? f.size + (f.has_audio ? 0 : info.best_audio_size) : 0;
                return (
                  <button
                    key={f.id}
                    onClick={() => setQuality(id)}
                    className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left transition-colors ${
                      quality === id ? 'bg-white/[0.1] text-white' : 'text-slate-300 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-bold w-14 shrink-0">{resolutionName(f.height)}</span>
                      <span className="font-mono">
                        {f.height}p{f.fps > 30 ? ` ${f.fps}fps` : ''}
                      </span>
                      {f.hdr && <span className="px-1 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">HDR</span>}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono shrink-0">
                      {f.ext.toUpperCase()} · {f.vcodec}
                      {total > 0 ? ` · ${formatBytes(total)}` : ''}
                    </span>
                  </button>
                );
              })}
              {info.formats.length === 0 && (
                <div className="p-3 text-slate-400">No separate resolutions were reported. Use "Best available".</div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono text-[11px] text-slate-200"
              />
              <button onClick={browse} title="Choose folder" className="p-1.5 rounded bg-white/[0.08] hover:bg-white/[0.15] text-slate-200">
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              onClick={startDownload}
              className={`w-full py-2.5 rounded-lg font-bold text-slate-950 ${accentClasses.bg} flex items-center justify-center gap-2`}
            >
              <Download className="w-4 h-4" />
              Download
            </button>
            {sentMsg && <div className="text-emerald-400 text-[11px]">{sentMsg}</div>}
            <p className="text-[11px] text-slate-400">
              Only download content you have the right to save. Protected (DRM) videos are not supported.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
