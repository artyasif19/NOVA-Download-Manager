/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { 
  Download, 
  Minus, 
  Square, 
  X, 
  Search, 
  Activity, 
  SlidersHorizontal,
  FolderOpen,
  User
} from 'lucide-react';
import { formatSpeed } from '../utils/formatters';
import { AppSettings } from '../types/download';
import { isTauriEnvironment } from '../services/tauriBridge';

async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!isTauriEnvironment()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (action === 'minimize') await win.minimize();
    else if (action === 'toggleMaximize') await win.toggleMaximize();
    else await win.close();
  } catch (err) {
    console.error('Window control failed:', err);
  }
}

interface TitleBarProps {
  totalSpeed: number;
  activeCount: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  settings: AppSettings;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
  onOpenSettings: () => void;
  onOpenAbout?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  totalSpeed,
  activeCount,
  searchQuery,
  onSearchChange,
  settings,
  accentClasses,
  onOpenSettings,
  onOpenAbout,
}) => {
  return (
    <header data-tauri-drag-region className="h-10 bg-[#0c0e12] border-b border-white/[0.07] flex items-center justify-between px-3 select-none shrink-0 z-50">
      {/* App Branding & Window Identifier */}
      <div className="flex items-center gap-2.5 min-w-[240px]">
        <div className={`w-6 h-6 rounded-md ${accentClasses.bg} flex items-center justify-center shadow-sm shadow-black/40`}>
          <Download className="w-3.5 h-3.5 text-slate-950 stroke-[2.5]" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-slate-100">
            NOVA
          </span>
          <span className="text-[11px] font-medium text-slate-400">
            Download Manager
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            v2.4
          </span>
        </div>
      </div>

      {/* Global Status & Search Box */}
      <div className="flex items-center gap-4 flex-1 max-w-xl mx-4">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search downloads by name, URL, or hash..."
            className="w-full bg-[#141820] text-xs text-slate-200 placeholder:text-slate-400 pl-8 pr-3 py-1 rounded-md border border-white/[0.06] focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>

        {/* Global speed indicator */}
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#141820] border border-white/[0.06] shrink-0">
          <Activity className={`w-3.5 h-3.5 ${activeCount > 0 ? accentClasses.text : 'text-slate-400'}`} />
          <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
            <span className={activeCount > 0 ? 'text-slate-200 font-medium' : 'text-slate-400'}>
              {formatSpeed(totalSpeed)}
            </span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-400">
              {activeCount} active
            </span>
          </div>
        </div>
      </div>

      {/* Right Controls & Windows Frame Buttons */}
      <div className="flex items-center gap-1.5">
        {onOpenAbout && (
          <button
            onClick={onOpenAbout}
            title="About the Developer (Asif)"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded transition-colors"
          >
            <User className="w-3.5 h-3.5" />
          </button>
        )}

        <button
          onClick={onOpenSettings}
          title="Open Settings"
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded transition-colors"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>

        {/* Windows Frame Window Buttons */}
        <div className="flex items-center ml-2 border-l border-white/[0.08] pl-2 -mr-1">
          <button
            title="Minimize"
            onClick={() => windowAction('minimize')}
            className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] rounded transition-colors"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            title="Maximize"
            onClick={() => windowAction('toggleMaximize')}
            className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] rounded transition-colors"
          >
            <Square className="w-2.5 h-2.5" />
          </button>
          <button
            title="Close"
            onClick={() => windowAction('close')}
            className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
