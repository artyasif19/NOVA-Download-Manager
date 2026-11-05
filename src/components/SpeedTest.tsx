/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { Gauge, Play, Square, ArrowDown, ArrowUp, Activity, Wifi } from 'lucide-react';

interface SpeedTestProps {
  accentClasses: { bg: string; text: string; border: string; badge: string };
}

type Phase = 'idle' | 'ping' | 'download' | 'upload' | 'done';

interface Result {
  ping: number;
  jitter: number;
  download: number;
  upload: number;
  time: number;
}

const DOWN_URL = 'https://speed.cloudflare.com/__down?bytes=';
const UP_URL = 'https://speed.cloudflare.com/__up';
const GAUGE_MAX = 1000; // Mbps (needle caps here)

function mbps(bytes: number, seconds: number): number {
  return seconds > 0 ? (bytes * 8) / seconds / 1e6 : 0;
}

export const SpeedTest: React.FC<SpeedTestProps> = ({ accentClasses }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [live, setLive] = useState(0);
  const [ping, setPing] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number | null>(null);
  const [down, setDown] = useState<number | null>(null);
  const [up, setUp] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Result[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const stop = () => {
    abortRef.current?.abort();
  };

  const run = async () => {
    const ctl = new AbortController();
    abortRef.current = ctl;
    const { signal } = ctl;
    setError('');
    setPing(null);
    setJitter(null);
    setDown(null);
    setUp(null);
    setLive(0);

    let pingMs = 0;
    let jitterMs = 0;
    let downMbps = 0;
    let upMbps = 0;

    try {
      // ---------- Ping ----------
      setPhase('ping');
      const rtts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const t0 = performance.now();
        await fetch(`${DOWN_URL}0&r=${Math.random()}`, { cache: 'no-store', signal });
        rtts.push(performance.now() - t0);
      }
      rtts.sort((a, b) => a - b);
      pingMs = rtts[Math.floor(rtts.length / 2)];
      const diffs = rtts.slice(1).map((r, i) => Math.abs(r - rtts[i]));
      jitterMs = diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length);
      setPing(pingMs);
      setJitter(jitterMs);

      // ---------- Download ----------
      setPhase('download');
      {
        const DURATION = 10000;
        const start = performance.now();
        let total = 0;
        const worker = async () => {
          while (performance.now() - start < DURATION && !signal.aborted) {
            const res = await fetch(`${DOWN_URL}50000000&r=${Math.random()}`, { cache: 'no-store', signal });
            const reader = res.body?.getReader();
            if (!reader) return;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              total += value.byteLength;
              const secs = (performance.now() - start) / 1000;
              if (secs > 0.5) setLive(mbps(total, secs));
              if (performance.now() - start >= DURATION) {
                reader.cancel().catch(() => {});
                break;
              }
            }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
        downMbps = mbps(total, (performance.now() - start) / 1000);
        setDown(downMbps);
      }

      // ---------- Upload ----------
      setPhase('upload');
      setLive(0);
      {
        const DURATION = 8000;
        const chunk = new Uint8Array(4 * 1024 * 1024);
        for (let i = 0; i < chunk.length; i += 65536) {
          crypto.getRandomValues(chunk.subarray(i, Math.min(i + 65536, chunk.length)));
        }
        const blob = new Blob([chunk]);
        const start = performance.now();
        let total = 0;
        const worker = async () => {
          while (performance.now() - start < DURATION && !signal.aborted) {
            await fetch(UP_URL, { method: 'POST', body: blob, cache: 'no-store', signal });
            total += blob.size;
            setLive(mbps(total, (performance.now() - start) / 1000));
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        upMbps = mbps(total, (performance.now() - start) / 1000);
        setUp(upMbps);
      }

      setPhase('done');
      setLive(0);
      setHistory((h) => [{ ping: pingMs, jitter: jitterMs, download: downMbps, upload: upMbps, time: Date.now() }, ...h].slice(0, 8));
    } catch (e: any) {
      if (signal.aborted) {
        setPhase('idle');
        setError('Test stopped.');
      } else {
        setPhase('idle');
        setError('The speed test servers could not be reached. Check your internet connection and try again.');
      }
      setLive(0);
    }
  };

  const running = phase === 'ping' || phase === 'download' || phase === 'upload';
  const value = phase === 'ping' ? 0 : live;
  const angle = -90 + Math.min(1, Math.sqrt(value / GAUGE_MAX)) * 180;

  const label =
    phase === 'ping' ? 'Testing latency...' : phase === 'download' ? 'Testing download...' : phase === 'upload' ? 'Testing upload...' : phase === 'done' ? 'Test complete' : 'Ready';

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Internet Speed Test</h2>
        <p className="text-slate-400 mt-0.5">
          Measures your real download speed, upload speed, ping and jitter using Cloudflare's global speed servers.
        </p>
      </div>

      <div className="bg-[#0d1016] border border-white/[0.08] rounded-xl p-5 flex flex-col items-center gap-4">
        {/* Gauge */}
        <div className="relative w-72 h-40">
          <svg viewBox="0 0 200 110" className="w-full h-full">
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="12" strokeLinecap="round" />
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="url(#spd)"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${Math.min(1, Math.sqrt(value / GAUGE_MAX)) * 251} 251`}
              style={{ transition: 'stroke-dasharray 0.25s ease' }}
            />
            <defs>
              <linearGradient id="spd" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="60%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#f43f5e" />
              </linearGradient>
            </defs>
            <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 100px', transition: 'transform 0.25s ease' }}>
              <line x1="100" y1="100" x2="100" y2="38" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
              <circle cx="100" cy="100" r="6" fill="#e2e8f0" />
            </g>
          </svg>
          <div className="absolute inset-x-0 bottom-0 text-center">
            <div className="text-3xl font-bold text-slate-100 font-mono">{value.toFixed(1)}</div>
            <div className="text-[11px] text-slate-400">Mbps</div>
          </div>
        </div>

        <div className="text-slate-300 font-medium">{label}</div>

        <div className="flex items-center gap-2">
          {!running ? (
            <button onClick={run} className={`px-8 py-2.5 rounded-full font-bold text-slate-950 ${accentClasses.bg} flex items-center gap-2`}>
              <Play className="w-4 h-4" />
              {phase === 'done' ? 'Test again' : 'Start test'}
            </button>
          ) : (
            <button onClick={stop} className="px-8 py-2.5 rounded-full font-bold bg-rose-500 text-white flex items-center gap-2">
              <Square className="w-4 h-4" />
              Stop
            </button>
          )}
        </div>

        {error && <div className="text-rose-400">{error}</div>}
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: ArrowDown, name: 'Download', value: down, unit: 'Mbps', dec: 1 },
          { icon: ArrowUp, name: 'Upload', value: up, unit: 'Mbps', dec: 1 },
          { icon: Activity, name: 'Ping', value: ping, unit: 'ms', dec: 0 },
          { icon: Wifi, name: 'Jitter', value: jitter, unit: 'ms', dec: 1 },
        ].map((r) => (
          <div key={r.name} className="bg-[#0d1016] border border-white/[0.08] rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-slate-400 mb-1.5">
              <r.icon className={`w-3.5 h-3.5 ${accentClasses.text}`} />
              <span>{r.name}</span>
            </div>
            <div className="text-2xl font-bold text-slate-100 font-mono">
              {r.value === null ? '--' : r.value.toFixed(r.dec)}
              <span className="text-xs text-slate-400 font-normal ml-1">{r.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div className="bg-[#0d1016] border border-white/[0.08] rounded-xl overflow-hidden">
          <div className="px-4 py-2 text-slate-300 font-semibold border-b border-white/[0.06] flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5" /> Recent tests
          </div>
          <div className="divide-y divide-white/[0.04] font-mono">
            {history.map((h) => (
              <div key={h.time} className="px-4 py-1.5 flex items-center justify-between text-slate-300">
                <span className="text-slate-500">{new Date(h.time).toLocaleTimeString()}</span>
                <span>↓ {h.download.toFixed(1)} Mbps</span>
                <span>↑ {h.upload.toFixed(1)} Mbps</span>
                <span>{h.ping.toFixed(0)} ms</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Results come from Cloudflare's speed servers, not Ookla, so numbers can differ slightly from speedtest.net. Fiber or
        wired connections give the most accurate results.
      </p>
    </div>
  );
};
