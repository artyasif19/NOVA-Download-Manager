/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  Trash2, 
  ExternalLink, 
  FolderOpen, 
  Info, 
  Copy, 
  Check, 
  AlertTriangle, 
  Film, 
  FileText, 
  Archive, 
  AppWindow, 
  FileCode, 
  File, 
  ArrowUpDown, 
  ShieldCheck, 
  RotateCcw,
  Sparkles,
  Calendar,
  Clock,
  Timer
} from 'lucide-react';
import { DownloadItem, DownloadStatus } from '../types/download';
import { 
  formatBytes, 
  formatEta, 
  formatSpeed, 
  formatDate, 
  getFileExtension, 
  formatCountdown, 
  formatScheduledDateTime 
} from '../utils/formatters';
import { SegmentVisualizer } from './SegmentVisualizer';

export type SortField = 'filename' | 'totalBytes' | 'progress' | 'speed' | 'status' | 'dateAdded';
export type SortDirection = 'asc' | 'desc';

interface DownloadTableProps {
  downloads: DownloadItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onSelectAll: () => void;
  onResume: (id: string) => void;
  onPause: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenSchedule: (item: DownloadItem) => void;
  onOpenDetails: (item: DownloadItem) => void;
  onOpenFile: (item: DownloadItem) => void;
  onOpenFolder: (item: DownloadItem) => void;
  density: 'compact' | 'comfortable';
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
  onAddClick: () => void;
}

export const DownloadTable: React.FC<DownloadTableProps> = ({
  downloads,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onResume,
  onPause,
  onStop,
  onDelete,
  onRetry,
  onOpenSchedule,
  onOpenDetails,
  onOpenFile,
  onOpenFolder,
  density,
  accentClasses,
  onAddClick,
}) => {
  const [sortField, setSortField] = useState<SortField>('dateAdded');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    item: DownloadItem;
  } | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedDownloads = [...downloads].sort((a, b) => {
    let comparison = 0;
    if (sortField === 'filename') {
      comparison = a.filename.localeCompare(b.filename);
    } else if (sortField === 'totalBytes') {
      comparison = a.totalBytes - b.totalBytes;
    } else if (sortField === 'progress') {
      const progA = a.totalBytes > 0 ? a.downloadedBytes / a.totalBytes : 0;
      const progB = b.totalBytes > 0 ? b.downloadedBytes / b.totalBytes : 0;
      comparison = progA - progB;
    } else if (sortField === 'speed') {
      comparison = a.speed - b.speed;
    } else if (sortField === 'status') {
      comparison = a.status.localeCompare(b.status);
    } else if (sortField === 'dateAdded') {
      comparison = a.dateAdded - b.dateAdded;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const getFileIcon = (filename: string, category: string) => {
    const ext = getFileExtension(filename);
    if (['mp4', 'mkv', 'webm', 'mov', 'avi', 'mp3', 'flac'].includes(ext)) {
      return <Film className="w-4 h-4 text-purple-400 shrink-0" />;
    }
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'].includes(ext)) {
      return <FileText className="w-4 h-4 text-blue-400 shrink-0" />;
    }
    if (['zip', 'rar', '7z', 'iso', 'tar', 'gz'].includes(ext)) {
      return <Archive className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    if (['exe', 'msi', 'apk', 'dmg'].includes(ext)) {
      return <AppWindow className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    return <File className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  const getStatusBadge = (item: DownloadItem) => {
    switch (item.status) {
      case 'downloading':
        return (
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${accentClasses.badge}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>Downloading</span>
          </span>
        );
      case 'scheduled':
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenSchedule(item);
            }}
            title={item.scheduledTime ? `Scheduled for ${formatScheduledDateTime(item.scheduledTime)}` : 'Click to schedule'}
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition-colors cursor-pointer"
          >
            <Calendar className="w-3 h-3 text-amber-400" />
            <span>Scheduled</span>
          </button>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Check className="w-3 h-3" />
            <span>Finished</span>
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Pause className="w-3 h-3" />
            <span>Paused</span>
          </span>
        );
      case 'queued':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <span>Queued</span>
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <AlertTriangle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
    }
  };

  const handleCopyLink = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleContextMenu = (e: React.MouseEvent, item: DownloadItem) => {
    e.preventDefault();
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 260),
      item,
    });
  };

  const isAllSelected = downloads.length > 0 && selectedIds.size === downloads.length;

  return (
    <div 
      className="flex-1 flex flex-col bg-[#0c0e12] overflow-hidden relative"
      onClick={() => setContextMenu(null)}
    >
      {/* Table Container */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left select-none text-xs">
          {/* Header Row */}
          <thead className="bg-[#12161f] border-b border-white/[0.08] sticky top-0 z-20">
            <tr>
              <th className="w-9 px-3 py-2 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={onSelectAll}
                  className="rounded border-white/20 bg-slate-800 text-cyan-500 focus:ring-0 cursor-pointer"
                />
              </th>
              
              <th 
                onClick={() => handleSort('filename')}
                className="px-3 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <div className="flex items-center gap-1">
                  <span>File Name</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>

              <th 
                onClick={() => handleSort('totalBytes')}
                className="w-28 px-3 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer text-right"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Size</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>

              <th 
                onClick={() => handleSort('progress')}
                className="w-64 px-3 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <div className="flex items-center gap-1">
                  <span>Progress & Segments</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>

              <th 
                onClick={() => handleSort('speed')}
                className="w-24 px-3 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer text-right"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Speed</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>

              <th className="w-20 px-3 py-2 text-[11px] font-medium text-slate-400 text-right">
                <span>ETA</span>
              </th>

              <th 
                onClick={() => handleSort('status')}
                className="w-28 px-3 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer text-center"
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Status</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>

              <th className="w-24 px-3 py-2 text-[11px] font-medium text-slate-400 text-center">
                <span>Actions</span>
              </th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-white/[0.04]">
            {sortedDownloads.map((item) => {
              const isSelected = selectedIds.has(item.id);
              const percent = item.totalBytes > 0 
                ? Math.min(100, Math.floor((item.downloadedBytes / item.totalBytes) * 100))
                : 0;
              const remainingBytes = Math.max(0, item.totalBytes - item.downloadedBytes);
              const etaSeconds = item.speed > 0 ? Math.ceil(remainingBytes / item.speed) : 0;

              return (
                <tr
                  key={item.id}
                  onContextMenu={(e) => handleContextMenu(e, item)}
                  className={`group transition-colors ${
                    isSelected
                      ? 'bg-white/[0.07] text-white'
                      : 'hover:bg-white/[0.03] text-slate-300'
                  }`}
                >
                  {/* Checkbox */}
                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => onToggleSelect(item.id, (e.nativeEvent as any).shiftKey)}
                      className="rounded border-white/20 bg-slate-800 text-cyan-500 focus:ring-0 cursor-pointer"
                    />
                  </td>

                  {/* File Name & Domain */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {getFileIcon(item.filename, item.category)}
                      <div className="truncate">
                        <div 
                          className="font-medium text-slate-200 hover:underline cursor-pointer truncate"
                          onClick={() => onOpenDetails(item)}
                          title={item.filename}
                        >
                          {item.filename}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate flex items-center gap-1.5 font-mono">
                          <span className="uppercase text-[9px] px-1 py-0.2 rounded bg-white/[0.06] text-slate-300 font-semibold">
                            {item.protocol || 'http'}
                          </span>
                          <span>·</span>
                          <span title={item.url} className="text-slate-400 hover:text-slate-300 cursor-pointer truncate max-w-[200px]">
                            {(() => {
                              try {
                                return new URL(item.url).hostname || 'Direct';
                              } catch {
                                return item.url.slice(0, 30);
                              }
                            })()}
                          </span>
                          <span>·</span>
                          <span className="truncate">{item.directory}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* File Size */}
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                    <div className="text-slate-200">
                      {formatBytes(item.totalBytes)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {formatBytes(item.downloadedBytes)}
                    </div>
                  </td>

                  {/* Progress & Segments */}
                  <td className="px-3 py-2.5">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                        <span className="text-slate-300 font-semibold">{percent}%</span>
                        <span className="text-slate-400">
                          {item.segmentsCount} parts {item.supportsRange ? '· Range OK' : ''}
                        </span>
                      </div>
                      
                      {/* Segment Visualizer */}
                      <SegmentVisualizer 
                        segments={item.segments} 
                        totalBytes={item.totalBytes}
                        accentClasses={accentClasses}
                        compact={density === 'compact'}
                      />
                    </div>
                  </td>

                  {/* Transfer Speed */}
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                    <div className={item.status === 'downloading' ? `${accentClasses.text} font-medium` : 'text-slate-400'}>
                      {item.status === 'downloading' ? formatSpeed(item.speed) : '--'}
                    </div>
                  </td>

                  {/* ETA / Countdown */}
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                    {item.status === 'downloading' ? (
                      <span className="text-slate-400">{formatEta(etaSeconds)}</span>
                    ) : item.status === 'scheduled' && item.scheduledTime ? (
                      <span 
                        className="text-amber-400 font-semibold cursor-pointer hover:underline"
                        title={`Scheduled to begin ${formatScheduledDateTime(item.scheduledTime)}`}
                        onClick={() => onOpenSchedule(item)}
                      >
                        {formatCountdown(item.scheduledTime)}
                      </span>
                    ) : (
                      <span className="text-slate-400">--</span>
                    )}
                  </td>

                  {/* Status Badge */}
                  <td className="px-3 py-2.5 text-center whitespace-nowrap">
                    {getStatusBadge(item)}
                  </td>

                  {/* Row Hover Actions */}
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      {item.status === 'downloading' ? (
                        <button
                          onClick={() => onPause(item.id)}
                          title="Pause Download"
                          className="p-1 hover:text-amber-400 hover:bg-white/[0.08] rounded transition-colors"
                        >
                          <Pause className="w-3.5 h-3.5" />
                        </button>
                      ) : item.status === 'completed' ? (
                        <button
                          onClick={() => onOpenFile(item)}
                          title="Open File"
                          className="p-1 hover:text-emerald-400 hover:bg-white/[0.08] rounded transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      ) : item.status === 'error' ? (
                        <button
                          onClick={() => onRetry(item.id)}
                          title="Retry Download"
                          className="p-1 hover:text-cyan-400 hover:bg-white/[0.08] rounded transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => onResume(item.id)}
                          title="Resume Download"
                          className="p-1 hover:text-cyan-400 hover:bg-white/[0.08] rounded transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Schedule Button */}
                      <button
                        onClick={() => onOpenSchedule(item)}
                        title={item.status === 'scheduled' && item.scheduledTime ? `Scheduled for ${formatScheduledDateTime(item.scheduledTime)} - Click to adjust` : "Schedule Download"}
                        className={`p-1 rounded transition-colors ${
                          item.status === 'scheduled' 
                            ? 'text-amber-400 hover:bg-amber-500/20' 
                            : 'hover:text-amber-300 hover:bg-white/[0.08] text-slate-400'
                        }`}
                      >
                        <Calendar className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => onOpenFolder(item)}
                        title="Open Containing Folder"
                        className="p-1 hover:text-slate-200 hover:bg-white/[0.08] rounded transition-colors"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
                      </button>

                      <button
                        onClick={() => onOpenDetails(item)}
                        title="Download Properties & Logs"
                        className="p-1 hover:text-slate-200 hover:bg-white/[0.08] rounded transition-colors"
                      >
                        <Info className="w-3.5 h-3.5 text-slate-400" />
                      </button>

                      <button
                        onClick={() => onDelete(item.id)}
                        title="Remove from list"
                        className="p-1 hover:text-rose-400 hover:bg-white/[0.08] rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Empty State */}
        {sortedDownloads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-slate-400" />
            </div>
            <h4 className="text-sm font-semibold text-slate-200 mb-1">
              No downloads in this view
            </h4>
            <p className="text-xs text-slate-400 max-w-sm mb-4">
              Add a direct URL, test sample ranges, or capture video downloads with the browser extension.
            </p>
            <button
              onClick={onAddClick}
              className={`px-3.5 py-1.5 text-xs font-semibold ${accentClasses.bg} text-slate-950 rounded-md shadow-xs hover:brightness-110 transition-all`}
            >
              Add New Download
            </button>
          </div>
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed w-52 bg-[#171b24] border border-white/[0.12] rounded-lg shadow-2xl py-1 z-50 text-xs animate-in fade-in zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-white/[0.08] truncate">
            {contextMenu.item.filename}
          </div>

          {contextMenu.item.status === 'downloading' ? (
            <button
              onClick={() => {
                onPause(contextMenu.item.id);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-200 hover:bg-white/[0.08] text-left"
            >
              <Pause className="w-3.5 h-3.5 text-amber-400" />
              <span>Pause Transfer</span>
            </button>
          ) : (
            <button
              onClick={() => {
                onResume(contextMenu.item.id);
                setContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-200 hover:bg-white/[0.08] text-left"
            >
              <Play className="w-3.5 h-3.5 text-cyan-400" />
              <span>Resume Transfer</span>
            </button>
          )}

          <button
            onClick={() => {
              onOpenFile(contextMenu.item);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-200 hover:bg-white/[0.08] text-left"
          >
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            <span>Open File</span>
          </button>

          <button
            onClick={() => {
              onOpenFolder(contextMenu.item);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-200 hover:bg-white/[0.08] text-left"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>Open Containing Folder</span>
          </button>

          <button
            onClick={() => {
              handleCopyLink(contextMenu.item.id, contextMenu.item.url);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-200 hover:bg-white/[0.08] text-left"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            <span>Copy Download Link</span>
          </button>

          <button
            onClick={() => {
              onOpenSchedule(contextMenu.item);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-200 hover:bg-white/[0.08] text-left"
          >
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            <span>{contextMenu.item.status === 'scheduled' ? 'Adjust Schedule...' : 'Schedule Download...'}</span>
          </button>

          <div className="h-px bg-white/[0.08] my-1" />

          <button
            onClick={() => {
              onOpenDetails(contextMenu.item);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-200 hover:bg-white/[0.08] text-left"
          >
            <Info className="w-3.5 h-3.5 text-slate-400" />
            <span>Properties & Checksum</span>
          </button>

          <div className="h-px bg-white/[0.08] my-1" />

          <button
            onClick={() => {
              onDelete(contextMenu.item.id);
              setContextMenu(null);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-rose-500/10 text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Remove from List</span>
          </button>
        </div>
      )}
    </div>
  );
};
