/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, index)).toFixed(dm))} ${sizes[index]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 KB/s';
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--';
  if (seconds > 86400 * 30) return '> 30d';
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCountdown(targetTimestamp: number): string {
  const now = Date.now();
  const diff = targetTimestamp - now;
  if (diff <= 0) return 'Triggering...';

  const totalSecs = Math.floor(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export function formatScheduledDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `Today at ${timeStr}`;
  }
  if (isTomorrow) {
    return `Tomorrow at ${timeStr}`;
  }
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length <= 1) return '';
  return parts.pop()?.toLowerCase() || '';
}

export function categorizeExtension(ext: string): 'video_audio' | 'documents' | 'compressed' | 'applications' | 'custom' {
  const videoAudio = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg'];
  const documents = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'txt', 'csv', 'md'];
  const compressed = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img', 'dmg'];
  const applications = ['exe', 'msi', 'apk', 'appimage', 'deb', 'rpm', 'bat', 'sh'];

  if (videoAudio.includes(ext)) return 'video_audio';
  if (documents.includes(ext)) return 'documents';
  if (compressed.includes(ext)) return 'compressed';
  if (applications.includes(ext)) return 'applications';
  return 'documents';
}

export function getAccentClasses(accent: string) {
  switch (accent) {
    case 'emerald':
      return {
        hex: '#10b981',
        bg: 'bg-emerald-500',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
        ring: 'focus:ring-emerald-500',
        hoverBg: 'hover:bg-emerald-600',
        badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        gradient: 'from-emerald-500 to-teal-400',
      };
    case 'violet':
      return {
        hex: '#8b5cf6',
        bg: 'bg-violet-500',
        text: 'text-violet-400',
        border: 'border-violet-500/30',
        ring: 'focus:ring-violet-500',
        hoverBg: 'hover:bg-violet-600',
        badge: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
        gradient: 'from-violet-500 to-purple-400',
      };
    case 'amber':
      return {
        hex: '#f59e0b',
        bg: 'bg-amber-500',
        text: 'text-amber-400',
        border: 'border-amber-500/30',
        ring: 'focus:ring-amber-500',
        hoverBg: 'hover:bg-amber-600',
        badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        gradient: 'from-amber-500 to-yellow-400',
      };
    case 'crimson':
      return {
        hex: '#f43f5e',
        bg: 'bg-rose-500',
        text: 'text-rose-400',
        border: 'border-rose-500/30',
        ring: 'focus:ring-rose-500',
        hoverBg: 'hover:bg-rose-600',
        badge: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        gradient: 'from-rose-500 to-pink-400',
      };
    case 'slate':
      return {
        hex: '#94a3b8',
        bg: 'bg-slate-300',
        text: 'text-slate-200',
        border: 'border-slate-500/30',
        ring: 'focus:ring-slate-400',
        hoverBg: 'hover:bg-slate-400',
        badge: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
        gradient: 'from-slate-300 to-slate-400',
      };
    case 'cyan':
    default:
      return {
        hex: '#06b6d4',
        bg: 'bg-cyan-500',
        text: 'text-cyan-400',
        border: 'border-cyan-500/30',
        ring: 'focus:ring-cyan-500',
        hoverBg: 'hover:bg-cyan-600',
        badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
        gradient: 'from-cyan-500 to-blue-500',
      };
  }
}
