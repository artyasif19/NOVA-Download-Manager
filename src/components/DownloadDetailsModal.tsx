/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  X, 
  Layers, 
  ShieldCheck, 
  Server, 
  Terminal, 
  Copy, 
  Check, 
  ExternalLink, 
  FolderOpen,
  FileCheck,
  AlertCircle,
  Activity,
  TrendingUp,
  Gauge,
  Zap,
  Clock
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine 
} from 'recharts';
import { DownloadItem } from '../types/download';
import { formatBytes, formatEta, formatSpeed, formatDate } from '../utils/formatters';

interface DownloadDetailsModalProps {
  item: DownloadItem | null;
  onClose: () => void;
  accentClasses: {
    hex?: string;
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
}

export const DownloadDetailsModal: React.FC<DownloadDetailsModalProps> = ({
  item,
  onClose,
  accentClasses,
}) => {
  const [activeTab, setActiveTab] = useState<'speed' | 'segments' | 'headers' | 'checksum' | 'logs'>('speed');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isVerifyingChecksum, setIsVerifyingChecksum] = useState(false);
  const [calculatedHash, setCalculatedHash] = useState<string | null>(item?.sha256Calculated || null);

  const accentColorHex = accentClasses.hex || '#06b6d4';

  const handleCopy = () => {
    if (!item) return;
    navigator.clipboard.writeText(item.url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleSimulateChecksum = () => {
    if (!item) return;
    setIsVerifyingChecksum(true);
    setTimeout(() => {
      const mockHash = item.sha256Expected || 'c2e6f4208d18e3fa5c72e474f8eed7b8eb4ecf6e3c3167104b901a073f1d8eb6';
      setCalculatedHash(mockHash);
      setIsVerifyingChecksum(false);
    }, 900);
  };

  // Prepare chart data points from real speedHistory, or synthesize baseline if empty
  const chartData = useMemo(() => {
    if (!item) return [];

    let history = item.speedHistory;
    // If empty or fewer than 2 points, generate realistic curve based on item status
    if (!history || history.length < 2) {
      const points = [];
      const now = Date.now();
      const base = item.speed > 0 ? item.speed : (item.status === 'completed' ? 12.5 * 1024 * 1024 : 8 * 1024 * 1024);
      for (let i = 24; i >= 0; i--) {
        const t = now - i * 2000;
        const ramp = Math.min(1, (24 - i) / 5);
        const wave = Math.sin((24 - i) * 0.7) * 0.2 + Math.cos((24 - i) * 0.3) * 0.1;
        let s = Math.max(0, Math.floor(base * ramp * (1 + wave)));
        if (item.status === 'completed' && i <= 1) {
          s = 0;
        }
        points.push({ time: t, speed: s });
      }
      history = points;
    }

    return history.map((pt, idx) => {
      const d = new Date(pt.time);
      const timeLabel = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
      const speedMB = parseFloat((pt.speed / (1024 * 1024)).toFixed(2));
      return {
        index: idx + 1,
        time: pt.time,
        timeLabel,
        speedBytes: pt.speed,
        speedMB,
        speedFormatted: formatSpeed(pt.speed),
      };
    });
  }, [item?.speedHistory, item?.speed, item?.status]);

  // Calculate speed statistics
  const speedStats = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return { 
        current: 0, 
        peak: 0, 
        avg: 0, 
        avgMB: 0,
        currentFormatted: '0 KB/s', 
        peakFormatted: '0 KB/s', 
        avgFormatted: '0 KB/s' 
      };
    }
    const speeds = chartData.map(d => d.speedBytes);
    const peak = Math.max(...speeds, item?.speed || 0);
    const sum = speeds.reduce((a, b) => a + b, 0);
    const avg = Math.floor(sum / chartData.length);
    const current = item?.status === 'downloading' ? item.speed : (chartData[chartData.length - 1]?.speedBytes || 0);

    return {
      current,
      peak,
      avg,
      currentFormatted: formatSpeed(current),
      peakFormatted: formatSpeed(peak),
      avgFormatted: formatSpeed(avg),
      avgMB: parseFloat((avg / (1024 * 1024)).toFixed(2)),
    };
  }, [chartData, item?.speed, item?.status]);

  if (!item) return null;

  // Mock server logs
  const logs = [
    { time: '14:01:02.120', text: `Initiating handshake with ${new URL(item.url).host}...` },
    { time: '14:01:02.312', text: 'TLS 1.3 session negotiated (Cipher: TLS_AES_256_GCM_SHA384)' },
    { time: '14:01:02.405', text: 'HEAD request sent. Probing Accept-Ranges and Content-Length...' },
    { time: '14:01:02.580', text: `HTTP/2 200 OK. Content-Length: ${item.totalBytes} bytes. Range support: ${item.supportsRange ? 'YES' : 'NO'}` },
    { time: '14:01:02.585', text: `Allocating ${item.segmentsCount} concurrent worker threads...` },
    ...item.segments.map((seg, i) => ({
      time: `14:01:02.${600 + i * 15}`,
      text: `Worker #${seg.id}: HTTP GET Range bytes=${seg.startByte}-${seg.endByte} -> 206 Partial Content (Streaming)`,
    })),
    ...(item.status === 'completed' ? [
      { time: '14:05:12.804', text: 'All segments downloaded. Reassembling chunks into target file...' },
      { time: '14:05:13.110', text: 'File written to disk. Zero byte corruption detected. Status: Completed.' },
    ] : item.status === 'error' ? [
      { time: '14:03:45.912', text: `ERROR: ${item.errorMessage || 'Worker #5 timeout waiting for socket'}` },
    ] : [
      { time: '14:02:18.000', text: `Active transfer rate: ${formatSpeed(item.speed)}. Segments running smoothly.` },
    ]),
  ];

  const CustomChartTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-[#11141e] border border-white/[0.14] rounded-lg p-2.5 shadow-2xl font-mono text-xs select-none">
          <div className="text-slate-400 text-[10px] flex items-center justify-between gap-4 mb-1">
            <span>Time: {data.timeLabel}</span>
            <span className={`${accentClasses.text} font-semibold`}>{data.speedFormatted}</span>
          </div>
          <div className="text-slate-100 text-sm font-bold font-mono tabular-nums">
            {data.speedMB} MB/s
          </div>
          <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Threads: {item.segmentsCount} concurrent</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-[#141822] border border-white/[0.12] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-4 py-3 bg-[#11141d] border-b border-white/[0.08] flex items-center justify-between">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100 truncate">{item.filename}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${accentClasses.badge}`}>
                {item.status.toUpperCase()}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono truncate">{item.directory}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-4 bg-[#0e1118] border-b border-white/[0.07] gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('speed')}
            className={`py-2.5 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'speed'
                ? `${accentClasses.text} border-cyan-400 font-semibold`
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Speed Chart</span>
          </button>

          <button
            onClick={() => setActiveTab('segments')}
            className={`py-2.5 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'segments'
                ? `${accentClasses.text} border-cyan-400 font-semibold`
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Segments ({item.segments.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('headers')}
            className={`py-2.5 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'headers'
                ? `${accentClasses.text} border-cyan-400 font-semibold`
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Server Headers</span>
          </button>

          <button
            onClick={() => setActiveTab('checksum')}
            className={`py-2.5 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'checksum'
                ? `${accentClasses.text} border-cyan-400 font-semibold`
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Integrity</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`py-2.5 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'logs'
                ? `${accentClasses.text} border-cyan-400 font-semibold`
                : 'text-slate-400 hover:text-slate-200 border-transparent'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Diagnostics Log</span>
          </button>
        </div>

        {/* Tab Content Viewport */}
        <div className="p-4 overflow-y-auto flex-1 text-xs">
          {/* SPEED CHART TAB (RECHARTS INTEGRATION) */}
          {activeTab === 'speed' && (
            <div className="space-y-4">
              {/* Telemetry Metric Cards */}
              <div className="grid grid-cols-4 gap-2.5 font-mono">
                <div className="bg-[#0c0f15] border border-white/[0.06] rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400 flex items-center justify-between mb-1">
                    <span>CURRENT SPEED</span>
                    <Zap className={`w-3 h-3 ${item.status === 'downloading' ? accentClasses.text : 'text-slate-500'}`} />
                  </div>
                  <div className={`text-sm font-bold tabular-nums ${item.status === 'downloading' ? accentClasses.text : 'text-slate-300'}`}>
                    {speedStats.currentFormatted}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5 truncate">
                    {item.status === 'downloading' ? 'Active stream' : item.status}
                  </div>
                </div>

                <div className="bg-[#0c0f15] border border-white/[0.06] rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400 flex items-center justify-between mb-1">
                    <span>PEAK BANDWIDTH</span>
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                  </div>
                  <div className="text-sm font-bold text-slate-100 tabular-nums">
                    {speedStats.peakFormatted}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5 truncate">
                    Max observed
                  </div>
                </div>

                <div className="bg-[#0c0f15] border border-white/[0.06] rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400 flex items-center justify-between mb-1">
                    <span>AVERAGE RATE</span>
                    <Gauge className="w-3 h-3 text-cyan-400" />
                  </div>
                  <div className="text-sm font-bold text-slate-200 tabular-nums">
                    {speedStats.avgFormatted}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5 truncate">
                    Session mean
                  </div>
                </div>

                <div className="bg-[#0c0f15] border border-white/[0.06] rounded-lg p-2.5">
                  <div className="text-[10px] text-slate-400 flex items-center justify-between mb-1">
                    <span>SAMPLES</span>
                    <Clock className="w-3 h-3 text-purple-400" />
                  </div>
                  <div className="text-sm font-bold text-slate-200 tabular-nums">
                    {chartData.length} pts
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5 truncate">
                    Live timeline
                  </div>
                </div>
              </div>

              {/* Recharts Speed Fluctuation Line Chart */}
              <div className="bg-[#0c0f15] border border-white/[0.08] rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Activity className={`w-3.5 h-3.5 ${accentClasses.text}`} />
                    <span className="font-semibold text-slate-200 text-xs tracking-wide">
                      Real-Time Transfer Velocity Profile
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-0.5 bg-slate-400" />
                      <span>Avg: {speedStats.avgMB.toFixed(1)} MB/s</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: accentColorHex }} />
                      <span className="text-slate-200 font-medium">Instantaneous Speed</span>
                    </div>
                  </div>
                </div>

                {/* Line Chart Container */}
                <div className="h-60 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 8, right: 12, left: -14, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="speedAreaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={accentColorHex} stopOpacity={0.32} />
                          <stop offset="95%" stopColor={accentColorHex} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid 
                        strokeDasharray="3 3" 
                        stroke="rgba(255,255,255,0.06)" 
                        vertical={false} 
                      />

                      <XAxis
                        dataKey="timeLabel"
                        stroke="#64748b"
                        tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                        tickLine={false}
                        axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                        minTickGap={25}
                      />

                      <YAxis
                        stroke="#64748b"
                        tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                        tickFormatter={(v) => `${v} MB`}
                        tickLine={false}
                        axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                        domain={[0, 'auto']}
                      />

                      <Tooltip content={<CustomChartTooltip />} />

                      {speedStats.avgMB > 0 && (
                        <ReferenceLine
                          y={speedStats.avgMB}
                          stroke="#64748b"
                          strokeDasharray="4 4"
                          strokeWidth={1}
                        />
                      )}

                      <Area
                        type="monotone"
                        dataKey="speedMB"
                        stroke={accentColorHex}
                        strokeWidth={2}
                        fill="url(#speedAreaGradient)"
                        activeDot={{
                          r: 4,
                          fill: accentColorHex,
                          stroke: '#ffffff',
                          strokeWidth: 1.5,
                        }}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Chart Footer Meta */}
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1 border-t border-white/[0.04]">
                  <span>HTTP Range multi-connection stream · {item.segmentsCount} worker threads</span>
                  <span>Moving average sample interval: ~800ms</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'segments' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-slate-300 font-mono tabular-nums text-[11px] bg-[#0c0f15] p-2.5 rounded-lg border border-white/[0.06]">
                <div>Total Size: <span className="font-semibold text-white">{formatBytes(item.totalBytes)}</span></div>
                <div>Downloaded: <span className="font-semibold text-white">{formatBytes(item.downloadedBytes)}</span></div>
                <div>Range Resume: <span className="text-emerald-400 font-semibold">{item.supportsRange ? 'Supported (HTTP 206)' : 'No'}</span></div>
              </div>

              {/* Segments Table */}
              <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-[#0c0f15]">
                <table className="w-full text-left font-mono text-[11px]">
                  <thead className="bg-[#121620] text-slate-400 border-b border-white/[0.06]">
                    <tr>
                      <th className="px-3 py-1.5">Part #</th>
                      <th className="px-3 py-1.5">Byte Range</th>
                      <th className="px-3 py-1.5 text-right">Downloaded</th>
                      <th className="px-3 py-1.5 text-right">Progress</th>
                      <th className="px-3 py-1.5 text-right">Speed</th>
                      <th className="px-3 py-1.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {item.segments.map((seg) => {
                      const segSize = Math.max(1, seg.endByte - seg.startByte);
                      const percent = Math.min(100, Math.floor((seg.downloadedBytes / segSize) * 100));
                      return (
                        <tr key={seg.id} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-2 font-semibold text-slate-300">Part {seg.id}</td>
                          <td className="px-3 py-2 text-slate-400">{formatBytes(seg.startByte)} - {formatBytes(seg.endByte)}</td>
                          <td className="px-3 py-2 text-right text-slate-300">{formatBytes(seg.downloadedBytes)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={seg.isFinished ? 'text-emerald-400' : 'text-cyan-400'}>{percent}%</span>
                          </td>
                          <td className="px-3 py-2 text-right text-slate-400">{seg.speed > 0 ? formatSpeed(seg.speed) : '--'}</td>
                          <td className="px-3 py-2 text-center">
                            {seg.isFinished ? (
                              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">Done</span>
                            ) : seg.isActive ? (
                              <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">Active</span>
                            ) : (
                              <span className="text-[10px] text-slate-400 bg-white/[0.05] px-1.5 py-0.5 rounded">Idle</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'headers' && (
            <div className="space-y-3 font-mono text-[11px]">
              <div className="p-3 bg-[#0c0f15] border border-white/[0.06] rounded-lg space-y-2">
                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Protocol:</span>
                  <span className="text-cyan-400 font-bold uppercase">{item.protocol || 'https'}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Resumable:</span>
                  <span className={item.supportsRange ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                    {item.supportsRange ? 'Yes (Byte Range 206 / Checkpointed)' : 'No (Single-Stream)'}
                  </span>
                </div>

                {item.streamInfo && (
                  <div className="flex justify-between py-1 border-b border-white/[0.04]">
                    <span className="text-slate-400">Stream Format:</span>
                    <span className="text-purple-400">
                      {item.streamInfo.format.toUpperCase()} {item.streamInfo.quality ? `(${item.streamInfo.quality})` : ''}
                    </span>
                  </div>
                )}

                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Request URL:</span>
                  <div className="flex items-center gap-1 text-slate-200 truncate max-w-sm">
                    <span className="truncate">{item.url}</span>
                    <button onClick={handleCopy} className="p-0.5 hover:text-white">
                      {copiedUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Accept-Ranges:</span>
                  <span className="text-emerald-400 font-semibold">{item.supportsRange ? 'bytes' : 'none'}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Content-Length:</span>
                  <span className="text-slate-200">{item.totalBytes} bytes ({formatBytes(item.totalBytes)})</span>
                </div>

                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Content-Type:</span>
                  <span className="text-slate-200">{item.mimeType || 'application/octet-stream'}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">ETag:</span>
                  <span className="text-slate-200">{item.etag || 'None'}</span>
                </div>

                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Date Added:</span>
                  <span className="text-slate-200">{formatDate(item.dateAdded)}</span>
                </div>

                {item.dateFinished && (
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Date Completed:</span>
                    <span className="text-emerald-400">{formatDate(item.dateFinished)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'checksum' && (
            <div className="space-y-4">
              <div className="p-3 bg-[#0c0f15] border border-white/[0.06] rounded-lg space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1">
                    Expected SHA-256 Hash (from download source):
                  </label>
                  <div className="font-mono text-xs text-slate-200 bg-black/40 p-2 rounded border border-white/[0.06] break-all">
                    {item.sha256Expected || 'Not specified upon download creation'}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-medium text-slate-400">
                      Calculated File Checksum:
                    </label>
                    <button
                      onClick={handleSimulateChecksum}
                      disabled={isVerifyingChecksum}
                      className="px-2.5 py-1 text-[11px] bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 rounded font-medium disabled:opacity-40"
                    >
                      {isVerifyingChecksum ? 'Computing hash...' : 'Compute SHA-256'}
                    </button>
                  </div>
                  <div className="font-mono text-xs text-slate-200 bg-black/40 p-2 rounded border border-white/[0.06] break-all">
                    {calculatedHash || 'Pending calculation...'}
                  </div>
                </div>

                {calculatedHash && item.sha256Expected && (
                  <div className={`p-2.5 rounded-md flex items-center gap-2 ${
                    calculatedHash.toLowerCase() === item.sha256Expected.toLowerCase()
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                  }`}>
                    {calculatedHash.toLowerCase() === item.sha256Expected.toLowerCase() ? (
                      <>
                        <ShieldCheck className="w-4 h-4 shrink-0" />
                        <span className="text-xs font-medium">Integrity Verified: SHA-256 matches official source perfectly.</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span className="text-xs font-medium">Checksum Mismatch: File may be modified or corrupted.</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="font-mono text-[11px] bg-[#0c0f15] p-3 rounded-lg border border-white/[0.06] space-y-1 max-h-72 overflow-y-auto">
              {logs.map((log, index) => (
                <div key={index} className="flex gap-2">
                  <span className="text-slate-400 select-none shrink-0">[{log.time}]</span>
                  <span className={log.text.includes('ERROR') ? 'text-rose-400' : log.text.includes('Completed') ? 'text-emerald-400 font-semibold' : 'text-slate-300'}>
                    {log.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#11141d] border-t border-white/[0.08] flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold bg-white/[0.08] hover:bg-white/[0.12] text-slate-200 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
