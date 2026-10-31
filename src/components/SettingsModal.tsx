/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  X, 
  Settings, 
  DownloadCloud, 
  Layers, 
  Globe, 
  Palette, 
  Bell, 
  ShieldCheck, 
  HardDrive, 
  Trash2, 
  Check, 
  RefreshCw,
  FolderOpen,
  User,
  ExternalLink,
  MapPin,
  GraduationCap
} from 'lucide-react';
import { AppSettings, DownloadItem } from '../types/download';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
  onClearHistory: () => void;
  totalDownloadsCount: number;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  accentClasses,
  onClearHistory,
  totalDownloadsCount,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'downloads' | 'connections' | 'appearance' | 'privacy' | 'about'>('general');
  const [clearedNotice, setClearedNotice] = useState(false);

  if (!isOpen) return null;

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear your local download history? (Downloaded files on disk will not be deleted).')) {
      onClearHistory();
      setClearedNotice(true);
      setTimeout(() => setClearedNotice(false), 2500);
    }
  };

  const accentColors = [
    { id: 'cyan', name: 'Electric Cyan', color: '#06b6d4' },
    { id: 'emerald', name: 'Cyber Emerald', color: '#10b981' },
    { id: 'violet', name: 'Hyper Violet', color: '#8b5cf6' },
    { id: 'amber', name: 'Amber Core', color: '#f59e0b' },
    { id: 'crimson', name: 'Crimson Red', color: '#f43f5e' },
    { id: 'slate', name: 'Monochrome Slate', color: '#94a3b8' },
  ] as const;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#141822] border border-white/[0.12] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#11141d] border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-md ${accentClasses.bg} text-slate-950`}>
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">NOVA Settings</h3>
              <p className="text-[11px] text-slate-400">Configure engine behavior, segmentation, appearance, and local storage</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body with Sidebar Tabs */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tabs Nav */}
          <div className="w-44 bg-[#0e1118] border-r border-white/[0.07] p-2 space-y-1 text-xs shrink-0 font-medium">
            <button
              onClick={() => setActiveTab('general')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                activeTab === 'general'
                  ? 'bg-white/[0.1] text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>General</span>
            </button>

            <button
              onClick={() => setActiveTab('downloads')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                activeTab === 'downloads'
                  ? 'bg-white/[0.1] text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              <span>Downloads</span>
            </button>

            <button
              onClick={() => setActiveTab('connections')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                activeTab === 'connections'
                  ? 'bg-white/[0.1] text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Connections</span>
            </button>

            <button
              onClick={() => setActiveTab('appearance')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                activeTab === 'appearance'
                  ? 'bg-white/[0.1] text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>Appearance</span>
            </button>

            <button
              onClick={() => setActiveTab('privacy')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                activeTab === 'privacy'
                  ? 'bg-white/[0.1] text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privacy & Storage</span>
            </button>

            <div className="pt-2 my-1 border-t border-white/[0.06]" />

            <button
              onClick={() => setActiveTab('about')}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${
                activeTab === 'about'
                  ? 'bg-white/[0.1] text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>About Developer</span>
            </button>
          </div>

          {/* Tab Content Panel */}
          <div className="flex-1 p-5 overflow-y-auto text-xs space-y-4">
            {activeTab === 'general' && (
              <div className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                    <div>
                      <div className="font-medium text-slate-200">Start with Windows</div>
                      <div className="text-[11px] text-slate-400">Launch NOVA minimized in system tray upon Windows boot</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.startWithWindows}
                      onChange={(e) => onUpdateSettings({ startWithWindows: e.target.checked })}
                      className="rounded border-white/20 bg-slate-800 text-cyan-500 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                    <div>
                      <div className="font-medium text-slate-200">Minimize to System Tray</div>
                      <div className="text-[11px] text-slate-400">Closing window leaves background engine active</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.minimizeToTray}
                      onChange={(e) => onUpdateSettings({ minimizeToTray: e.target.checked })}
                      className="rounded border-white/20 bg-slate-800 text-cyan-500 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                    <div>
                      <div className="font-medium text-slate-200">Sound Notifications</div>
                      <div className="text-[11px] text-slate-400">Play subtle sound chime when download completes or errors</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.soundNotification}
                      onChange={(e) => onUpdateSettings({ soundNotification: e.target.checked })}
                      className="rounded border-white/20 bg-slate-800 text-cyan-500 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'downloads' && (
              <div className="space-y-4">
                <div>
                  <label className="font-medium text-slate-200 block mb-1">
                    Default Download Directory
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={settings.defaultFolder}
                      onChange={(e) => onUpdateSettings({ defaultFolder: e.target.value })}
                      className="flex-1 bg-[#0c0f15] border border-white/[0.1] rounded px-3 py-1.5 font-mono text-slate-200 text-xs"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Files will be organized into Video, Documents, Compressed, and Programs subfolders when auto-categorize is active.
                  </p>
                </div>

                <div className="pt-2 border-t border-white/[0.06] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-slate-200">Maximum Simultaneous Downloads</div>
                      <div className="text-[11px] text-slate-400">Remaining items stay queued until active slots free up</div>
                    </div>
                    <span className="font-mono text-cyan-400 font-semibold">{settings.maxConcurrentDownloads} active</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={settings.maxConcurrentDownloads}
                    onChange={(e) => onUpdateSettings({ maxConcurrentDownloads: parseInt(e.target.value, 10) })}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                  <div>
                    <div className="font-medium text-slate-200">Auto-Categorize Files</div>
                    <div className="text-[11px] text-slate-400">Sort by MIME and extension into dedicated subfolders</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.autoCategorize}
                    onChange={(e) => onUpdateSettings({ autoCategorize: e.target.checked })}
                    className="rounded border-white/20 bg-slate-800 text-cyan-500 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {activeTab === 'connections' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-slate-200">Default Concurrent Segments (Threads)</div>
                      <div className="text-[11px] text-slate-400">HTTP Range segments created per download</div>
                    </div>
                    <span className="font-mono text-cyan-400 font-semibold">{settings.maxConnectionsPerDownload} connections</span>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5 pt-1">
                    {[1, 2, 4, 8, 16, 32].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => onUpdateSettings({ maxConnectionsPerDownload: num })}
                        className={`py-1.5 text-xs font-mono rounded border transition-colors ${
                          settings.maxConnectionsPerDownload === num
                            ? `${accentClasses.bg} text-slate-950 font-bold border-transparent`
                            : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:bg-white/[0.08]'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-white/[0.06]">
                  <label className="font-medium text-slate-200 block mb-1">
                    User-Agent Identification Header
                  </label>
                  <textarea
                    rows={2}
                    value={settings.userAgent}
                    onChange={(e) => onUpdateSettings({ userAgent: e.target.value })}
                    className="w-full bg-[#0c0f15] border border-white/[0.1] rounded p-2 font-mono text-[11px] text-slate-300 focus:outline-none"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Matches standard Windows 11 Chrome/Edge browser signature to ensure seamless server compatibility.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'appearance' && (
              <div className="space-y-4">
                <div>
                  <label className="font-medium text-slate-200 block mb-2">
                    System Accent Color Theme
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {accentColors.map((color) => (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => onUpdateSettings({ accentColor: color.id })}
                        className={`flex items-center gap-2.5 p-2 rounded-lg border text-left transition-all ${
                          settings.accentColor === color.id
                            ? 'bg-white/[0.08] border-white/30 text-white'
                            : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                        }`}
                      >
                        <div
                          className="w-3.5 h-3.5 rounded-full shadow-xs"
                          style={{ backgroundColor: color.color }}
                        />
                        <span className="text-xs font-medium">{color.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-white/[0.06]">
                  <label className="font-medium text-slate-200 block mb-2">
                    Table Display Density
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ density: 'compact' })}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        settings.density === 'compact'
                          ? 'bg-white/[0.08] border-white/30 text-white'
                          : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-semibold text-xs">Compact Grid</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">High information density, slim rows</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ density: 'comfortable' })}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        settings.density === 'comfortable'
                          ? 'bg-white/[0.08] border-white/30 text-white'
                          : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-semibold text-xs">Comfortable (IDM Style)</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">Displays multi-segment chunk thread bars</div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'privacy' && (
              <div className="space-y-4">
                <div className="p-3 bg-[#0c0f15] border border-white/[0.08] rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Zero Telemetry & Local-First Invariants</span>
                  </div>
                  <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-1">
                    <li>No analytics, crash trackers, or phone-home requests.</li>
                    <li>No user accounts, external cloud syncing, or advertising ID.</li>
                    <li>Database stored locally at <code className="text-cyan-300 font-mono">%APPDATA%\NOVA\downloads.sqlite</code>.</li>
                  </ul>
                </div>

                <div className="pt-2 border-t border-white/[0.06] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-slate-200">Local Download History</div>
                      <div className="text-[11px] text-slate-400">{totalDownloadsCount} records stored in local database</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearHistory}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear History</span>
                    </button>
                  </div>

                  {clearedNotice && (
                    <div className="p-2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px]">
                      Download history cleared from local storage.
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="space-y-4">
                {/* Developer Profile Header */}
                <div className="flex items-center gap-3.5 pb-3 border-b border-white/[0.08]">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full bg-[#1b2230] border border-white/[0.12] flex items-center justify-center text-slate-100 font-bold text-base shadow-inner">
                      A
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ${accentClasses.bg} border-2 border-[#141822] flex items-center justify-center`}>
                      <span className="w-1 h-1 rounded-full bg-slate-950" />
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-slate-100">Asif</h4>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <span>Developer</span>
                      <span className="text-slate-400">·</span>
                      <span>26 years old</span>
                      <span className="text-slate-400">·</span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-2.5 h-2.5 text-slate-400" />
                        <span>Bangladesh</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bio text */}
                <div className="space-y-3 leading-relaxed text-[12px] text-slate-300">
                  <p>
                    Hi, I'm Asif, a 26-year-old developer and technology enthusiast from Bangladesh. I graduated in 2023 with a Bachelor of Business Studies (BBS) from Chandpur Government College. I'm passionate about technology, software development, digital creativity, and building useful applications with clean design and a great user experience.
                  </p>
                  <p className="text-slate-400">
                    I created this application to provide a simple, efficient, and ad-free experience without unnecessary bloatware.
                  </p>
                </div>

                {/* Education & Info card */}
                <div className="p-3 bg-[#0d1016] border border-white/[0.06] rounded-lg space-y-2 text-[11px] font-mono text-slate-400">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Education:</span>
                    <span className="text-slate-200">BBS (2023) · Chandpur Govt. College</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Philosophy:</span>
                    <span className="text-slate-200">Zero bloatware · Local-first privacy</span>
                  </div>
                </div>

                {/* Social Connect */}
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Connect & Follow:</span>
                  <a
                    href="https://www.instagram.com/artyasif19/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20 text-slate-200 hover:text-white transition-all text-xs font-medium"
                  >
                    <svg className="w-3.5 h-3.5 text-pink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
                    </svg>
                    <span>@artyasif19</span>
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#11141d] border-t border-white/[0.08] flex items-center justify-end">
          <button
            onClick={onClose}
            className={`px-4 py-1.5 text-xs font-semibold ${accentClasses.bg} text-slate-950 rounded-md shadow-xs hover:brightness-110 transition-all`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
