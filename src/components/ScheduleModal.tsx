/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  X, 
  Calendar, 
  Clock, 
  Sparkles, 
  Zap, 
  AlertCircle, 
  Gauge, 
  Check, 
  Trash2,
  Timer
} from 'lucide-react';
import { DownloadItem } from '../types/download';
import { formatBytes, formatCountdown, formatScheduledDateTime } from '../utils/formatters';

interface ScheduleModalProps {
  isOpen: boolean;
  item: DownloadItem | null;
  onClose: () => void;
  onSaveSchedule: (id: string, targetTimestamp: number, customSpeedLimit?: number) => void;
  onCancelSchedule: (id: string) => void;
  onStartNow: (id: string) => void;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
}

export const ScheduleModal: React.FC<ScheduleModalProps> = ({
  isOpen,
  item,
  onClose,
  onSaveSchedule,
  onCancelSchedule,
  onStartNow,
  accentClasses,
}) => {
  // Default target time: 1 hour in the future, or existing scheduledTime
  const getInitialDateTime = () => {
    const base = item?.scheduledTime && item.scheduledTime > Date.now() 
      ? new Date(item.scheduledTime)
      : new Date(Date.now() + 60 * 60 * 1000); // 1 hr from now
    
    // Format YYYY-MM-DD and HH:MM in local time
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
    const timeStr = `${pad(base.getHours())}:${pad(base.getMinutes())}`;
    return { dateStr, timeStr };
  };

  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [customSpeedEnabled, setCustomSpeedEnabled] = useState(false);
  const [customSpeedKBps, setCustomSpeedKBps] = useState(4096);
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    if (isOpen && item) {
      const { dateStr, timeStr } = getInitialDateTime();
      setDate(dateStr);
      setTime(timeStr);
    }
  }, [isOpen, item]);

  // Update current time tick for live countdown preview
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen || !item) return null;

  // Calculate parsed timestamp from date and time
  const getSelectedTimestamp = (): number => {
    if (!date || !time) return Date.now();
    const [year, month, day] = date.split('-').map(Number);
    const [hours, minutes] = time.split(':').map(Number);
    const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
    return d.getTime();
  };

  const targetTimestamp = getSelectedTimestamp();
  const isPast = targetTimestamp <= currentTime;
  const diffMs = Math.max(0, targetTimestamp - currentTime);

  const applyPreset = (minutesToAdd: number) => {
    const target = new Date(Date.now() + minutesToAdd * 60 * 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    setDate(`${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`);
    setTime(`${pad(target.getHours())}:${pad(target.getMinutes())}`);
  };

  const applyMidnightPreset = () => {
    const target = new Date();
    target.setHours(24, 0, 0, 0); // Tonight at midnight
    const pad = (n: number) => n.toString().padStart(2, '0');
    setDate(`${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`);
    setTime('00:00');
  };

  const applyMorningPreset = () => {
    const target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(8, 0, 0, 0); // Tomorrow at 8 AM
    const pad = (n: number) => n.toString().padStart(2, '0');
    setDate(`${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`);
    setTime('08:00');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isPast) return;
    onSaveSchedule(item.id, targetTimestamp, customSpeedEnabled ? customSpeedKBps : undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none">
      <div className="bg-[#141822] border border-white/[0.12] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#11141d] border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${accentClasses.bg} text-slate-950 shadow-xs`}>
              <Timer className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Schedule Download Execution</h3>
              <p className="text-[11px] text-slate-400">Set specific initiation date, hour, and queue behavior</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 text-xs">
          {/* Target Item Card */}
          <div className="bg-[#0c0f15] border border-white/[0.06] rounded-lg p-3">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              Target Download
            </div>
            <div className="font-medium text-slate-100 truncate text-xs">{item.filename}</div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-1">
              <span>{formatBytes(item.totalBytes)}</span>
              <span>·</span>
              <span className="capitalize">{item.status}</span>
              {item.scheduledTime && (
                <>
                  <span>·</span>
                  <span className="text-amber-400">Currently scheduled for {formatScheduledDateTime(item.scheduledTime)}</span>
                </>
              )}
            </div>
          </div>

          {/* Quick Presets */}
          <div>
            <div className="text-[11px] font-medium text-slate-400 mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Quick Initiation Presets:</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => applyPreset(15)}
                className="py-1.5 px-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded text-slate-300 text-center transition-colors"
              >
                In 15 mins
              </button>
              <button
                type="button"
                onClick={() => applyPreset(60)}
                className="py-1.5 px-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded text-slate-300 text-center transition-colors"
              >
                In 1 hour
              </button>
              <button
                type="button"
                onClick={() => applyPreset(180)}
                className="py-1.5 px-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded text-slate-300 text-center transition-colors"
              >
                In 3 hours
              </button>
              <button
                type="button"
                onClick={applyMidnightPreset}
                className="py-1.5 px-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded text-slate-300 text-center transition-colors"
              >
                Tonight at 00:00
              </button>
              <button
                type="button"
                onClick={applyMorningPreset}
                className="py-1.5 px-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded text-slate-300 text-center transition-colors"
              >
                Tomorrow 08:00
              </button>
              <button
                type="button"
                onClick={() => applyPreset(1440)}
                className="py-1.5 px-2 bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] rounded text-slate-300 text-center transition-colors"
              >
                In 24 hours
              </button>
            </div>
          </div>

          {/* Date & Time Pickers */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-300 block mb-1">
                Execution Date
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-white/30 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-300 block mb-1">
                Execution Time (24h)
              </label>
              <div className="relative">
                <Clock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full bg-[#0d1016] border border-white/[0.1] rounded pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-white/30 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Dynamic Countdown & Timing Indicator */}
          <div className={`p-3 rounded-lg border flex items-center justify-between ${
            isPast 
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' 
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 shrink-0" />
              <div>
                <div className="font-semibold text-xs">
                  {isPast ? 'Selected time is in the past' : `Starts ${formatScheduledDateTime(targetTimestamp)}`}
                </div>
                <div className="text-[11px] opacity-80 font-mono tabular-nums">
                  {isPast ? 'Please pick a future time' : `Countdown: ${formatCountdown(targetTimestamp)}`}
                </div>
              </div>
            </div>
            {!isPast && (
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-black/30 border border-amber-500/30">
                Scheduled
              </span>
            )}
          </div>

          {/* Speed Limit option for night/scheduled download */}
          <div className="bg-[#0d1016] border border-white/[0.06] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={customSpeedEnabled}
                  onChange={(e) => setCustomSpeedEnabled(e.target.checked)}
                  className="rounded border-white/20 bg-slate-800 text-amber-500 focus:ring-0 cursor-pointer"
                />
                <span className="text-[11px] font-medium text-slate-300">
                  Bandwidth Throttle during this run
                </span>
              </label>
              {customSpeedEnabled && (
                <span className="text-[11px] font-mono text-amber-400 font-semibold">
                  {(customSpeedKBps / 1024).toFixed(1)} MB/s
                </span>
              )}
            </div>

            {customSpeedEnabled && (
              <div className="pt-1">
                <input
                  type="range"
                  min="512"
                  max="20480"
                  step="512"
                  value={customSpeedKBps}
                  onChange={(e) => setCustomSpeedKBps(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
            )}
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
            <div>
              {item.status === 'scheduled' ? (
                <button
                  type="button"
                  onClick={() => {
                    onCancelSchedule(item.id);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Cancel Schedule</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onStartNow(item.id);
                    onClose();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-white/[0.06] rounded transition-colors"
                >
                  <Zap className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Start Now Instead</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded transition-colors"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={isPast}
                className={`px-4 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-slate-950 rounded-lg shadow-sm transition-all`}
              >
                Set Schedule
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
