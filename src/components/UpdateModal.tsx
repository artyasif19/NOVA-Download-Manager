/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { X, Download, RefreshCw } from 'lucide-react';
import { UpdateInfo, downloadUpdate, installUpdate, openUrl } from '../services/tauriBridge';
import { formatBytes, formatSpeed } from '../utils/formatters';

interface UpdateModalProps {
  info: UpdateInfo | null;
  accentClasses: { bg: string; text: string; border: string; badge: string };
  onClose: () => void;
  onSkip: (version: string) => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ info, accentClasses, onClose, onSkip }) => {
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'installing' | 'error'>('idle');
  const [progress, setProgress] = useState({ downloaded: 0, total: 0, speed: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    setPhase('idle');
    setError('');
    setProgress({ downloaded: 0, total: 0, speed: 0 });
  }, [info?.latest]);

  useEffect(() => {
    let off: (() => void) | null = null;
    let disposed = false;
    listen<{ downloaded: number; total: number; speed: number }>('update-progress', (e) => setProgress(e.payload)).then((u) => {
      if (disposed) u();
      else off = u;
    });
    return () => {
      disposed = true;
      if (off) off();
    };
  }, []);

  if (!info) return null;

  const pct = progress.total > 0 ? Math.min(100, (progress.downloaded / progress.total) * 100) : 0;

  const update = async () => {
    setError('');
    setPhase('downloading');
    try {
      const path = await downloadUpdate(info);
      setPhase('installing');
      await installUpdate(path); // NOVA closes and the installer takes over
    } catch (e: any) {
      setError(String(e?.message || e));
      setPhase('error');
    }
  };

  const busy = phase === 'downloading' || phase === 'installing';

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-[85] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#141821] border border-white/[0.15] rounded-xl shadow-2xl overflow-hidden text-xs">
        <div className="px-4 py-3 bg-[#11141c] border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${accentClasses.bg} text-slate-950`}>
              <RefreshCw className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">NOVA {info.latest} is available</div>
              <div className="text-[11px] text-slate-400">You have version {info.current}</div>
            </div>
          </div>
          {!busy && (
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          {info.notes && (
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-white/[0.04] border border-white/[0.06] p-3 text-slate-300">
              {info.notes}
            </div>
          )}
          {!info.asset_url && (
            <div className="text-amber-300">
              This release has no Windows installer attached. Open the release page to download it by hand.
            </div>
          )}

          {phase === 'downloading' && (
            <div className="space-y-1.5">
              <div className="h-3 rounded bg-white/[0.1] overflow-hidden">
                <div className={`h-full ${accentClasses.bg} transition-all`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between text-slate-300 font-mono">
                <span>
                  {formatBytes(progress.downloaded)}
                  {progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}
                </span>
                <span>{progress.speed > 0 ? formatSpeed(progress.speed) : ''}</span>
              </div>
            </div>
          )}
          {phase === 'installing' && (
            <div className="text-emerald-300">Download finished. NOVA will close and the installer will update it...</div>
          )}
          {phase === 'error' && <div className="text-rose-400">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-white/[0.08] bg-[#11141c] flex items-center justify-between">
          <button
            disabled={busy}
            onClick={() => openUrl(info.page_url)}
            className="px-3 py-1.5 rounded-md border border-white/[0.15] text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"
          >
            View on GitHub
          </button>
          <div className="flex items-center gap-2">
            <button
              disabled={busy}
              onClick={() => onSkip(info.latest)}
              className="px-3 py-1.5 rounded-md text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              Skip this version
            </button>
            <button
              disabled={busy}
              onClick={onClose}
              className="px-3 py-1.5 rounded-md border border-white/[0.15] text-slate-200 hover:bg-white/[0.06] disabled:opacity-50"
            >
              Later
            </button>
            <button
              disabled={busy || !info.asset_url}
              onClick={update}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md font-bold text-slate-950 ${accentClasses.bg} disabled:opacity-50`}
            >
              <Download className="w-3.5 h-3.5" />
              {phase === 'error' ? 'Try again' : 'Update now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
