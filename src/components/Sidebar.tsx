/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  DownloadCloud, 
  ArrowDownCircle, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Film, 
  FileText, 
  Archive, 
  AppWindow, 
  FolderPlus, 
  Folder, 
  HardDrive, 
  ShieldCheck, 
  Plus, 
  X,
  Radio,
  Calendar,
  User
} from 'lucide-react';
import { CategoryType, CustomCategory, DownloadItem } from '../types/download';

interface SidebarProps {
  selectedCategory: CategoryType;
  onSelectCategory: (cat: CategoryType) => void;
  selectedCustomCategory?: string;
  onSelectCustomCategory: (catId: string) => void;
  downloads: DownloadItem[];
  customCategories: CustomCategory[];
  onAddCustomCategory: (cat: CustomCategory) => void;
  onDeleteCustomCategory: (id: string) => void;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
  onOpenBrowserHub: () => void;
  onOpenAbout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedCategory,
  onSelectCategory,
  selectedCustomCategory,
  onSelectCustomCategory,
  downloads,
  customCategories,
  onAddCustomCategory,
  onDeleteCustomCategory,
  accentClasses,
  onOpenBrowserHub,
  onOpenAbout,
}) => {
  const [showAddCustomModal, setShowAddCustomModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatExts, setNewCatExts] = useState('');
  const [newCatFolder, setNewCatFolder] = useState('');

  // Calculate counts for categories
  const counts = {
    all: downloads.length,
    downloading: downloads.filter(d => d.status === 'downloading').length,
    scheduled: downloads.filter(d => d.status === 'scheduled').length,
    queued: downloads.filter(d => d.status === 'queued').length,
    completed: downloads.filter(d => d.status === 'completed').length,
    failed: downloads.filter(d => d.status === 'error' || d.status === 'paused').length,
    video_audio: downloads.filter(d => d.category === 'video_audio').length,
    documents: downloads.filter(d => d.category === 'documents').length,
    compressed: downloads.filter(d => d.category === 'compressed').length,
    applications: downloads.filter(d => d.category === 'applications').length,
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    const extensions = newCatExts
      .split(',')
      .map(s => s.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean);

    const newCat: CustomCategory = {
      id: `cat-${Date.now()}`,
      name: newCatName.trim(),
      extensions: extensions.length > 0 ? extensions : ['custom'],
      subfolder: newCatFolder.trim() || newCatName.trim(),
    };

    onAddCustomCategory(newCat);
    setNewCatName('');
    setNewCatExts('');
    setNewCatFolder('');
    setShowAddCustomModal(false);
  };

  return (
    <aside className="w-56 bg-[#0e1117] border-r border-white/[0.07] flex flex-col justify-between shrink-0 select-none overflow-y-auto">
      <div className="p-2.5 space-y-4">
        {/* State Queues Navigation */}
        <div>
          <div className="px-2 pb-1.5 text-[10px] font-semibold text-slate-400 tracking-wider uppercase">
            Queues
          </div>
          <nav className="space-y-0.5">
            <button
              onClick={() => onSelectCategory('all')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'all' && !selectedCustomCategory
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <DownloadCloud className="w-3.5 h-3.5" />
                <span>All Downloads</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{counts.all}</span>
            </button>

            <button
              onClick={() => onSelectCategory('downloading')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'downloading'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <ArrowDownCircle className={`w-3.5 h-3.5 ${counts.downloading > 0 ? accentClasses.text : ''}`} />
                <span>Downloading</span>
              </div>
              <span className={`text-[11px] font-mono tabular-nums ${counts.downloading > 0 ? accentClasses.text + ' font-semibold' : 'text-slate-400'}`}>
                {counts.downloading}
              </span>
            </button>

            <button
              onClick={() => onSelectCategory('scheduled')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'scheduled'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Calendar className={`w-3.5 h-3.5 ${counts.scheduled > 0 ? 'text-amber-400' : ''}`} />
                <span>Scheduled</span>
              </div>
              <span className={`text-[11px] font-mono tabular-nums ${counts.scheduled > 0 ? 'text-amber-400 font-semibold' : 'text-slate-400'}`}>
                {counts.scheduled}
              </span>
            </button>

            <button
              onClick={() => onSelectCategory('queued')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'queued'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                <span>Queued</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{counts.queued}</span>
            </button>

            <button
              onClick={() => onSelectCategory('completed')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'completed'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/80" />
                <span>Completed</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{counts.completed}</span>
            </button>

            <button
              onClick={() => onSelectCategory('failed')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'failed'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-rose-500/80" />
                <span>Paused / Failed</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{counts.failed}</span>
            </button>
          </nav>
        </div>

        {/* File Formats / Categories */}
        <div>
          <div className="px-2 pb-1.5 text-[10px] font-semibold text-slate-400 tracking-wider uppercase">
            File Categories
          </div>
          <nav className="space-y-0.5">
            <button
              onClick={() => onSelectCategory('video_audio')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'video_audio'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Film className="w-3.5 h-3.5 text-purple-400" />
                <span>Video & Audio</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{counts.video_audio}</span>
            </button>

            <button
              onClick={() => onSelectCategory('documents')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'documents'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                <span>Documents</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{counts.documents}</span>
            </button>

            <button
              onClick={() => onSelectCategory('compressed')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'compressed'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Archive className="w-3.5 h-3.5 text-amber-400" />
                <span>Compressed</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{counts.compressed}</span>
            </button>

            <button
              onClick={() => onSelectCategory('applications')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors ${
                selectedCategory === 'applications'
                  ? 'bg-white/[0.08] text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <AppWindow className="w-3.5 h-3.5 text-emerald-400" />
                <span>Applications</span>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">{counts.applications}</span>
            </button>
          </nav>
        </div>

        {/* Custom Categories */}
        <div>
          <div className="px-2 pb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase">
              Custom Rules
            </span>
            <button
              onClick={() => setShowAddCustomModal(true)}
              title="Add Custom Category Rule"
              className="p-0.5 text-slate-400 hover:text-slate-200 rounded transition-colors"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <nav className="space-y-0.5">
            {customCategories.map((cat) => (
              <div
                key={cat.id}
                className={`group flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                  selectedCustomCategory === cat.id
                    ? 'bg-white/[0.08] text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                }`}
                onClick={() => onSelectCustomCategory(cat.id)}
              >
                <div className="flex items-center gap-2 truncate">
                  <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{cat.name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-400 font-mono">.{cat.extensions[0]}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCustomCategory(cat.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-rose-400 rounded transition-all"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            ))}
          </nav>
        </div>
      </div>

      {/* Footer System Status: Disk Space & Native Messaging Status */}
      <div className="p-3 border-t border-white/[0.07] bg-[#0a0d11] space-y-2.5 text-xs">
        {/* Drive Info */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <HardDrive className="w-3 h-3 text-slate-400" />
              <span>Drive C:\</span>
            </div>
            <span className="font-mono tabular-nums text-slate-300">412.4 GB Free</span>
          </div>
          {/* Subtle disk capacity meter */}
          <div className="h-1 bg-white/[0.08] rounded-full overflow-hidden">
            <div className="h-full bg-slate-500 rounded-full" style={{ width: '42%' }} />
          </div>
        </div>

        {/* Browser Native Bridge Status */}
        <button
          onClick={onOpenBrowserHub}
          className="w-full flex items-center justify-between p-1.5 rounded-md bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.05] text-[11px] text-left transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-xs shadow-emerald-500/50" />
            <span className="text-slate-300 font-medium">Native Bridge</span>
          </div>
          <span className="text-[10px] text-emerald-400 font-mono">Listening</span>
        </button>

        {/* Developer Info Button */}
        {onOpenAbout && (
          <button
            onClick={onOpenAbout}
            className="w-full flex items-center justify-between p-1.5 rounded-md hover:bg-white/[0.05] text-[11px] text-left transition-colors text-slate-400 hover:text-slate-200"
          >
            <div className="flex items-center gap-2">
              <User className="w-3 h-3 text-slate-400" />
              <span>About Developer</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">Asif</span>
          </button>
        )}
      </div>

      {/* Add Custom Category Dialog */}
      {showAddCustomModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#151922] border border-white/[0.1] rounded-lg w-full max-w-sm p-4 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">Add Category Rule</h3>
              <button
                onClick={() => setShowAddCustomModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCategory} className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">
                  Category Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 3D Assets"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">
                  File Extensions (comma separated)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. fbx, obj, blend, gltf"
                  value={newCatExts}
                  onChange={(e) => setNewCatExts(e.target.value)}
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-white/30"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-400 block mb-1">
                  Target Subfolder
                </label>
                <input
                  type="text"
                  placeholder="e.g. 3D_Models"
                  value={newCatFolder}
                  onChange={(e) => setNewCatFolder(e.target.value)}
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-white/30"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCustomModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`px-3 py-1.5 text-xs font-semibold ${accentClasses.bg} text-slate-950 rounded shadow-xs`}
                >
                  Create Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
};
