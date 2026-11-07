/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Plus, 
  Play, 
  Pause, 
  Square, 
  Trash2, 
  Gauge, 
  Layers, 
  Video, 
  Chrome, 
  Settings, 
  ListFilter,
  CheckSquare,
  FileCheck2,
  FolderDown,
  Calendar
} from 'lucide-react';
import { AppSettings } from '../types/download';

interface TopToolbarProps {
  onAddClick: () => void;
  onResumeSelected: () => void;
  onPauseSelected: () => void;
  onStopSelected: () => void;
  onScheduleSelected?: () => void;
  onClearCompleted: () => void;
  selectedCount: number;
  totalCount: number;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onOpenSettings: () => void;
  onOpenBrowserHub: () => void;
  onOpenVideoSniffer: () => void;
  onOpenBatch: () => void;
  activeView: 'downloads' | 'video_sniffer' | 'browser_hub' | 'speed_test';
  setActiveView: (view: 'downloads' | 'video_sniffer' | 'browser_hub' | 'speed_test') => void;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  onAddClick,
  onResumeSelected,
  onPauseSelected,
  onStopSelected,
  onScheduleSelected,
  onClearCompleted,
  selectedCount,
  settings,
  onUpdateSettings,
  onOpenSettings,
  onOpenBatch,
  activeView,
  setActiveView,
  accentClasses,
}) => {
  const [showSpeedPopover, setShowSpeedPopover] = useState(false);

  return (
    <div className="h-12 bg-[#101319] border-b border-white/[0.07] px-3 flex items-center justify-between shrink-0 gap-3">
      {/* Primary Actions Group */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onAddClick}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md ${accentClasses.bg} text-slate-950 font-semibold text-xs shadow-sm hover:brightness-110 active:scale-[0.98] transition-all`}
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Add URL</span>
        </button>

        <div className="h-4 w-px bg-white/[0.1] mx-1" />

        <button
          onClick={onResumeSelected}
          disabled={selectedCount === 0}
          title={selectedCount > 0 ? `Resume ${selectedCount} selected` : 'Select items to resume'}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent rounded-md transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Resume</span>
        </button>

        <button
          onClick={onPauseSelected}
          disabled={selectedCount === 0}
          title={selectedCount > 0 ? `Pause ${selectedCount} selected` : 'Select items to pause'}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent rounded-md transition-colors"
        >
          <Pause className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Pause</span>
        </button>

        <button
          onClick={onStopSelected}
          disabled={selectedCount === 0}
          title={selectedCount > 0 ? `Stop ${selectedCount} selected` : 'Select items to stop'}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-rose-400 hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent rounded-md transition-colors"
        >
          <Square className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Stop</span>
        </button>

        {onScheduleSelected && (
          <button
            onClick={onScheduleSelected}
            disabled={selectedCount !== 1}
            title={selectedCount === 1 ? 'Schedule selected download' : 'Select exactly 1 download to schedule'}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-amber-300 hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent rounded-md transition-colors"
          >
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Schedule</span>
          </button>
        )}

        <button
          onClick={onOpenBatch}
          title="Add many downloads at once (link pattern or list of links)"
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
        >
          <Layers className="w-3.5 h-3.5 text-slate-400" />
          <span className="hidden md:inline">Batch</span>
        </button>

        <select
          value={settings.afterDownloads}
          onChange={(e) => onUpdateSettings({ afterDownloads: e.target.value as AppSettings['afterDownloads'] })}
          title="What NOVA does when every download has finished"
          className="bg-transparent border border-white/[0.1] rounded-md px-1.5 py-1 text-[11px] text-slate-300 cursor-pointer"
        >
          <option value="none">When done: nothing</option>
          <option value="exit">When done: exit NOVA</option>
          <option value="sleep">When done: sleep PC</option>
          <option value="shutdown">When done: shut down PC</option>
        </select>

        <button
          onClick={onClearCompleted}
          title="Clear all completed downloads from history"
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5 text-slate-400" />
          <span className="hidden md:inline">Clean Up</span>
        </button>
      </div>

      {/* Secondary Controls & View Switcher */}
      <div className="flex items-center gap-2">
        {/* View Switcher: Downloads vs Video Sniffer vs Browser Extension */}
        <div className="flex items-center p-0.5 bg-[#141820] border border-white/[0.06] rounded-lg">
          <button
            onClick={() => setActiveView('downloads')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              activeView === 'downloads'
                ? 'bg-white/[0.1] text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FolderDown className="w-3 h-3" />
            <span>Downloads</span>
          </button>

          <button
            onClick={() => setActiveView('video_sniffer')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              activeView === 'video_sniffer'
                ? 'bg-white/[0.1] text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Video className="w-3 h-3" />
            <span>Media Grabber</span>
          </button>

          <button
            onClick={() => setActiveView('browser_hub')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              activeView === 'browser_hub'
                ? 'bg-white/[0.1] text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Chrome className="w-3 h-3" />
            <span>Browser Bridge</span>
          </button>

          <button
            onClick={() => setActiveView('speed_test')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              activeView === 'speed_test'
                ? 'bg-white/[0.1] text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Gauge className="w-3 h-3" />
            <span>Speed Test</span>
          </button>
        </div>

        {/* Speed Limiter Popover */}
        <div className="relative">
          <button
            onClick={() => setShowSpeedPopover(!showSpeedPopover)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors ${
              settings.speedLimitEnabled
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>
              {settings.speedLimitEnabled ? `${settings.speedLimitKBps / 1024} MB/s` : 'Max Speed'}
            </span>
          </button>

          {showSpeedPopover && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-[#161a22] border border-white/[0.12] rounded-lg shadow-xl p-3 z-50 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-200">Bandwidth Throttle</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.speedLimitEnabled}
                    onChange={(e) => onUpdateSettings({ speedLimitEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                Restrict global download bandwidth to avoid saturating your network connection.
              </p>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono tabular-nums text-slate-300">
                  <span>Limit:</span>
                  <span>{(settings.speedLimitKBps / 1024).toFixed(1)} MB/s ({settings.speedLimitKBps} KB/s)</span>
                </div>
                <input
                  type="range"
                  min="256"
                  max="51200"
                  step="256"
                  disabled={!settings.speedLimitEnabled}
                  value={settings.speedLimitKBps}
                  onChange={(e) => onUpdateSettings({ speedLimitKBps: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-40"
                />
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>256 KB/s</span>
                  <span>10 MB/s</span>
                  <span>50 MB/s</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Density Mode */}
        <button
          onClick={() => onUpdateSettings({ 
            density: settings.density === 'compact' ? 'comfortable' : 'compact' 
          })}
          title={`Switch to ${settings.density === 'compact' ? 'Comfortable' : 'Compact'} Density`}
          className="p-1.5 rounded-md border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
        >
          <Layers className="w-3.5 h-3.5" />
        </button>

        {/* Settings Shortcut */}
        <button
          onClick={onOpenSettings}
          title="Manager Settings"
          className="p-1.5 rounded-md border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
