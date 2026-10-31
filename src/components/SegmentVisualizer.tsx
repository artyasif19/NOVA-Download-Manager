/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DownloadSegment } from '../types/download';
import { formatBytes, formatSpeed } from '../utils/formatters';

interface SegmentVisualizerProps {
  segments: DownloadSegment[];
  totalBytes: number;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
  compact?: boolean;
}

export const SegmentVisualizer: React.FC<SegmentVisualizerProps> = ({
  segments,
  accentClasses,
  compact = false,
}) => {
  if (!segments || segments.length === 0) return null;

  return (
    <div className="w-full space-y-1">
      {/* Visual Chunk Bar: Segments aligned in a grid */}
      <div className="flex w-full h-2 rounded bg-black/40 overflow-hidden border border-white/[0.08] gap-0.5 p-0.5">
        {segments.map((seg) => {
          const segSize = Math.max(1, seg.endByte - seg.startByte);
          const percent = Math.min(100, Math.floor((seg.downloadedBytes / segSize) * 100));
          return (
            <div
              key={seg.id}
              className="h-full flex-1 bg-white/[0.05] rounded-xs relative overflow-hidden"
              title={`Part ${seg.id}: ${percent}% (${formatBytes(seg.downloadedBytes)} / ${formatBytes(segSize)}) - ${formatSpeed(seg.speed)}`}
            >
              <div
                className={`h-full ${seg.isFinished ? 'bg-emerald-500' : seg.isActive ? accentClasses.bg : 'bg-slate-500'} transition-all duration-300`}
                style={{ width: `${percent}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Optional Detailed Legend for Comfortable View */}
      {!compact && (
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono tabular-nums px-0.5">
          <div className="flex items-center gap-2">
            <span>{segments.length} threads</span>
            <span>·</span>
            <span>{segments.filter(s => s.isFinished).length} completed</span>
            <span>·</span>
            <span>{segments.filter(s => s.isActive && !s.isFinished).length} active</span>
          </div>
          <span>Range: 0 - {formatBytes(segments[segments.length - 1]?.endByte || 0)}</span>
        </div>
      )}
    </div>
  );
};
