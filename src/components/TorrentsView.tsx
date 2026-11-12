/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Play, Square, Trash2, Search, FolderOpen, Copy, Settings2 } from 'lucide-react';
import { AppSettings, DownloadItem } from '../types/download';
import { invokeCommand, isTauriEnvironment } from '../services/tauriBridge';
import { formatBytes, formatEta, formatSpeed } from '../utils/formatters';

interface TorrentsViewProps {
  downloads: DownloadItem[];
  settings: AppSettings;
  accentClasses: { bg: string; text: string; border: string; badge: string };
  onAdd: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string, deleteFiles: boolean) => void;
}

interface Live {
  id: string;
  aria_status: string;
  seeding: boolean;
  total_bytes: number;
  completed_bytes: number;
  uploaded_bytes: number;
  ratio: number;
  down_speed: number;
  up_speed: number;
  seeders: number;
  connections: number;
  eta: number;
}

interface Details extends Live {
  name: string;
  pieces: number;
  piece_length: number;
  info_hash: string;
  comment: string;
  creation_date: number;
  dir: string;
  trackers: string[][];
  files: Array<{ path: string; length: number; completed: number; selected: boolean }>;
  peers: Array<{ ip: string; port: string; down_speed: number; up_speed: number; seeder: boolean }>;
}

type Filter = 'all' | 'downloading' | 'seeding' | 'completed' | 'stopped' | 'errored';

function statusOf(item: DownloadItem, live?: Live): { key: Filter; label: string; color: string } {
  if (item.status === 'error') return { key: 'errored', label: 'Errored', color: 'text-rose-400' };
  if (live?.seeding) return { key: 'seeding', label: 'Seeding', color: 'text-emerald-400' };
  if (item.status === 'completed') return { key: 'completed', label: 'Completed', color: 'text-sky-400' };
  if (item.status === 'paused') return { key: 'stopped', label: 'Stopped', color: 'text-slate-400' };
  if (item.status === 'queued') return { key: 'stopped', label: 'Queued', color: 'text-amber-300' };
  return {
    key: 'downloading',
    label: item.downloadedBytes === 0 && item.totalBytes === 0 ? 'Fetching metadata' : 'Downloading',
    color: 'text-cyan-300',
  };
}

export const TorrentsView: React.FC<TorrentsViewProps> = ({
  downloads,
  settings,
  accentClasses,
  onAdd,
  onPause,
  onResume,
  onRemove,
}) => {
  const torrents = useMemo(() => downloads.filter((d) => d.protocol === 'torrent'), [downloads]);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'general' | 'trackers' | 'peers' | 'content'>('general');
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  const [limits, setLimits] = useState({ down: 0, up: 0, ratio: 0 });
  const [globalStat, setGlobalStat] = useState({ down: 0, up: 0 });
  const [copied, setCopied] = useState('');
  const startedAt = useRef<Record<string, number>>({});

  // live numbers for the table
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let stop = false;
    const tick = async () => {
      try {
        const list = await invokeCommand<Live[]>('torrent_overview');
        if (stop || !Array.isArray(list)) return;
        const map: Record<string, Live> = {};
        let d = 0;
        let u = 0;
        list.forEach((l) => {
          map[l.id] = l;
          d += l.down_speed;
          u += l.up_speed;
          if (!startedAt.current[l.id]) startedAt.current[l.id] = Date.now();
        });
        setLive(map);
        setGlobalStat({ down: d, up: u });
      } catch {
        /* engine not running yet */
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // details of the selected torrent
  useEffect(() => {
    setDetails(null);
    if (!selectedId || !isTauriEnvironment()) return;
    let stop = false;
    const tick = async () => {
      try {
        const d = await invokeCommand<Details>('torrent_details', { id: selectedId });
        if (!stop) setDetails(d);
      } catch {
        if (!stop) setDetails(null);
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [selectedId]);

  // close context menu on any click
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, []);

  const rows = useMemo(() => {
    return torrents
      .map((t) => ({ item: t, live: live[t.id], st: statusOf(t, live[t.id]) }))
      .filter((r) => (filter === 'all' ? true : r.st.key === filter))
      .filter((r) => r.item.filename.toLowerCase().includes(query.trim().toLowerCase()));
  }, [torrents, live, filter, query]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: torrents.length, downloading: 0, seeding: 0, completed: 0, stopped: 0, errored: 0 };
    torrents.forEach((t) => {
      c[statusOf(t, live[t.id]).key]++;
    });
    return c;
  }, [torrents, live]);

  const selected = torrents.find((t) => t.id === selectedId) || null;

  const fullPath = (t: DownloadItem) => `${t.directory.replace(/[\\/]+$/, '')}\\${t.filename}`;

  const copyText = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* ignore */
    }
  };

  const magnetFor = async (t: DownloadItem): Promise<string> => {
    if (t.url.startsWith('magnet:')) return t.url;
    try {
      const d = await invokeCommand<Details>('torrent_details', { id: t.id });
      if (d?.info_hash) return `magnet:?xt=urn:btih:${d.info_hash}&dn=${encodeURIComponent(t.filename)}`;
    } catch {
      /* not active */
    }
    return '';
  };

  const openOptions = (id: string) => {
    setLimits({ down: 0, up: 0, ratio: settings.torrentSeedRatio || 0 });
    setOptionsFor(id);
  };

  const saveOptions = async () => {
    if (!optionsFor) return;
    try {
      await invokeCommand('torrent_set_options', {
        id: optionsFor,
        downKib: Math.max(0, Math.floor(limits.down)),
        upKib: Math.max(0, Math.floor(limits.up)),
        seedRatio: Math.max(0, limits.ratio),
      });
    } catch {
      alert('This torrent is not active right now. Start it first, then change its options.');
    }
    setOptionsFor(null);
  };

  const filters: Array<[Filter, string]> = [
    ['all', 'All'],
    ['downloading', 'Downloading'],
    ['seeding', 'Seeding'],
    ['completed', 'Completed'],
    ['stopped', 'Stopped / Queued'],
    ['errored', 'Errored'],
  ];

  const th = 'px-2 py-1.5 text-left font-semibold text-slate-400 whitespace-nowrap';

  const info = (label: string, value: React.ReactNode) => (
    <div className="flex gap-2 py-0.5">
      <div className="w-32 shrink-0 text-right text-slate-400">{label}:</div>
      <div className="text-slate-100 font-mono break-all">{value}</div>
    </div>
  );

  const activeFor = details && selected ? details : null;
  const active = selected ? Date.now() - (startedAt.current[selected.id] || Date.now()) : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs" onContextMenu={(e) => e.preventDefault()}>
      {/* toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.08]">
        <button onClick={onAdd} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold text-slate-950 ${accentClasses.bg}`}>
          <Plus className="w-3.5 h-3.5" /> Add torrent / magnet
        </button>
        <button
          disabled={!selected}
          onClick={() => selected && onResume(selected.id)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400" /> Start
        </button>
        <button
          disabled={!selected}
          onClick={() => selected && onPause(selected.id)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
        >
          <Square className="w-3.5 h-3.5 text-amber-400" /> Stop
        </button>
        <button
          disabled={!selected}
          onClick={() => selected && onRemove(selected.id, false)}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-slate-200 hover:bg-white/[0.08] disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-400" /> Remove
        </button>
        <div className="flex-1" />
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter torrents..."
            className="w-56 bg-[#0d1016] border border-white/[0.1] rounded-md pl-7 pr-2 py-1.5 text-slate-200"
          />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* status filters */}
        <div className="w-44 shrink-0 border-r border-white/[0.08] p-2 space-y-0.5">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Status</div>
          {filters.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md ${
                filter === k ? 'bg-white/[0.1] text-white' : 'text-slate-300 hover:bg-white/[0.05]'
              }`}
            >
              <span>{label}</span>
              <span className="text-slate-500">{counts[k]}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* table */}
          <div className="flex-1 min-h-[120px] overflow-auto border-b border-white/[0.08]">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-[#0d1016] z-10">
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Size</th>
                  <th className={th + ' w-40'}>Progress</th>
                  <th className={th}>Status</th>
                  <th className={th}>Seeds</th>
                  <th className={th}>Peers</th>
                  <th className={th}>Down</th>
                  <th className={th}>Up</th>
                  <th className={th}>ETA</th>
                  <th className={th}>Ratio</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, live: l, st }) => {
                  const total = l?.total_bytes || item.totalBytes;
                  const done = l?.completed_bytes ?? item.downloadedBytes;
                  const pct = item.status === 'completed' ? 100 : total > 0 ? Math.min(100, (done / total) * 100) : 0;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelectedId(item.id);
                        setMenu({ x: e.clientX, y: e.clientY, id: item.id });
                      }}
                      className={`cursor-default border-t border-white/[0.04] ${
                        selectedId === item.id ? 'bg-white/[0.1]' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <td className="px-2 py-1.5 max-w-[320px] truncate text-slate-100" title={item.filename}>
                        {item.filename}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-mono">{total > 0 ? formatBytes(total) : '-'}</td>
                      <td className="px-2 py-1.5">
                        <div className="relative h-4 rounded bg-white/[0.08] overflow-hidden">
                          <div className={`absolute inset-y-0 left-0 ${accentClasses.bg} opacity-70`} style={{ width: `${pct}%` }} />
                          <div className="relative text-center text-[10px] leading-4 font-mono text-white">{pct.toFixed(1)}%</div>
                        </div>
                      </td>
                      <td className={`px-2 py-1.5 whitespace-nowrap ${st.color}`}>{st.label}</td>
                      <td className="px-2 py-1.5 font-mono">{l ? l.seeders : '-'}</td>
                      <td className="px-2 py-1.5 font-mono">{l ? l.connections : '-'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-mono">{l && l.down_speed > 0 ? formatSpeed(l.down_speed) : '0 B/s'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-mono">{l && l.up_speed > 0 ? formatSpeed(l.up_speed) : '0 B/s'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-mono">{l && l.eta > 0 ? formatEta(l.eta) : '∞'}</td>
                      <td className="px-2 py-1.5 font-mono">{l ? l.ratio.toFixed(2) : '-'}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-500">
                      No torrents here yet. Click "Add torrent / magnet", or copy a magnet link.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* details */}
          <div className="h-[42%] min-h-[170px] flex flex-col">
            <div className="flex items-center gap-1 px-2 pt-1.5">
              {([
                ['general', 'General'],
                ['trackers', 'Trackers'],
                ['peers', 'Peers'],
                ['content', 'Content'],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-3 py-1 rounded-t-md border border-b-0 border-white/[0.1] ${
                    tab === k ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
              {copied && <span className="ml-3 text-emerald-400">Copied {copied}</span>}
            </div>
            <div className="flex-1 overflow-auto border-t border-white/[0.1] p-3">
              {!selected ? (
                <div className="text-slate-500">Select a torrent to see its details.</div>
              ) : tab === 'general' ? (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6">
                  <div>
                    <div className="font-semibold text-slate-300 mb-1">Transfer</div>
                    {info('Time active', active > 0 ? formatEta(Math.floor(active / 1000)) : '-')}
                    {info('Downloaded', formatBytes(activeFor?.completed_bytes ?? selected.downloadedBytes))}
                    {info('Uploaded', formatBytes(activeFor?.uploaded_bytes ?? 0))}
                    {info('Share ratio', (activeFor?.ratio ?? 0).toFixed(2))}
                    {info('Download speed', formatSpeed(activeFor?.down_speed ?? 0))}
                    {info('Upload speed', formatSpeed(activeFor?.up_speed ?? 0))}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-300 mb-1">Connections</div>
                    {info('Seeds', activeFor?.seeders ?? 0)}
                    {info('Connections', activeFor?.connections ?? 0)}
                    {info('Pieces', activeFor ? `${activeFor.pieces} x ${formatBytes(activeFor.piece_length)}` : '-')}
                    {info('ETA', activeFor && activeFor.eta > 0 ? formatEta(activeFor.eta) : '∞')}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-300 mb-1">Information</div>
                    {info('Total size', formatBytes(activeFor?.total_bytes || selected.totalBytes))}
                    {info('Save path', selected.directory)}
                    {info('Info hash', activeFor?.info_hash || '-')}
                    {info('Added on', new Date(selected.dateAdded).toLocaleString())}
                    {activeFor?.creation_date ? info('Created on', new Date(activeFor.creation_date * 1000).toLocaleString()) : null}
                    {activeFor?.comment ? info('Comment', activeFor.comment) : null}
                    {!activeFor && <div className="text-slate-500 mt-2">Live details appear while the torrent is active.</div>}
                  </div>
                </div>
              ) : tab === 'trackers' ? (
                <div className="space-y-1 font-mono">
                  {(activeFor?.trackers || []).flat().length === 0 && <div className="text-slate-500">No trackers listed (DHT / peer exchange are used).</div>}
                  {(activeFor?.trackers || []).flat().map((u, i) => (
                    <div key={i} className="text-slate-200 break-all">
                      {u}
                    </div>
                  ))}
                </div>
              ) : tab === 'peers' ? (
                <table className="w-full">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left pr-3">IP</th>
                      <th className="text-left pr-3">Port</th>
                      <th className="text-left pr-3">Type</th>
                      <th className="text-left pr-3">Down</th>
                      <th className="text-left">Up</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {(activeFor?.peers || []).map((p, i) => (
                      <tr key={i} className="border-t border-white/[0.04]">
                        <td className="pr-3">{p.ip}</td>
                        <td className="pr-3">{p.port}</td>
                        <td className="pr-3">{p.seeder ? 'Seed' : 'Peer'}</td>
                        <td className="pr-3">{formatSpeed(p.down_speed)}</td>
                        <td>{formatSpeed(p.up_speed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="space-y-1">
                  {(activeFor?.files || []).map((f, i) => {
                    const name = f.path.split(/[\\/]/).pop() || f.path;
                    const pct = f.length > 0 ? Math.min(100, (f.completed / f.length) * 100) : 0;
                    return (
                      <div
                        key={i}
                        onDoubleClick={() => invokeCommand('open_file', { path: f.path }).catch(() => {})}
                        title="Double-click to open"
                        className="flex items-center gap-3 py-1 border-t border-white/[0.04] cursor-default"
                      >
                        <div className="flex-1 min-w-0 truncate text-slate-100" title={f.path}>
                          {name}
                        </div>
                        <div className="w-24 text-right font-mono text-slate-300">{formatBytes(f.length)}</div>
                        <div className="w-28 relative h-3.5 rounded bg-white/[0.08] overflow-hidden">
                          <div className={`absolute inset-y-0 left-0 ${accentClasses.bg} opacity-70`} style={{ width: `${pct}%` }} />
                          <div className="relative text-center text-[10px] leading-3.5 font-mono text-white">{pct.toFixed(0)}%</div>
                        </div>
                      </div>
                    );
                  })}
                  {!activeFor && <div className="text-slate-500">The file list appears while the torrent is active.</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* status bar */}
      <div className="px-3 py-1.5 border-t border-white/[0.08] flex items-center justify-end gap-6 text-slate-300 font-mono">
        <span>
          ↓ {formatSpeed(globalStat.down)} {settings.torrentDownLimit > 0 ? `(limit ${settings.torrentDownLimit} KiB/s)` : ''}
        </span>
        <span>
          ↑ {formatSpeed(globalStat.up)} {settings.torrentUpLimit > 0 ? `(limit ${settings.torrentUpLimit} KiB/s)` : ''}
        </span>
      </div>

      {/* context menu */}
      {menu &&
        (() => {
          const t = torrents.find((x) => x.id === menu.id);
          if (!t) return null;
          const item = (label: string, onClick: () => void, icon?: React.ReactNode, danger?: boolean) => (
            <button
              key={label}
              onClick={(e) => {
                e.stopPropagation();
                setMenu(null);
                onClick();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-white/[0.1] ${danger ? 'text-rose-300' : 'text-slate-100'}`}
            >
              <span className="w-4 h-4 flex items-center justify-center">{icon}</span>
              {label}
            </button>
          );
          const sep = (k: string) => <div key={k} className="my-1 border-t border-white/[0.1]" />;
          return (
            <div
              className="fixed z-[90] w-64 py-1 rounded-lg border border-white/[0.15] bg-[#141821] shadow-2xl text-xs"
              style={{ left: Math.min(menu.x, window.innerWidth - 270), top: Math.min(menu.y, window.innerHeight - 330) }}
              onClick={(e) => e.stopPropagation()}
            >
              {item('Start', () => onResume(t.id), <Play className="w-3.5 h-3.5 text-emerald-400" />)}
              {item('Stop', () => onPause(t.id), <Square className="w-3.5 h-3.5 text-amber-400" />)}
              {item('Force Start', () => onResume(t.id), <Play className="w-3.5 h-3.5 text-emerald-300" />)}
              {sep('a')}
              {item('Remove', () => onRemove(t.id, false), <Trash2 className="w-3.5 h-3.5 text-rose-400" />)}
              {item('Remove and delete files', () => onRemove(t.id, true), <Trash2 className="w-3.5 h-3.5 text-rose-400" />, true)}
              {sep('b')}
              {item('Torrent options (speed limits, seeding)...', () => openOptions(t.id), <Settings2 className="w-3.5 h-3.5 text-sky-400" />)}
              {item('Open file / preview', () => invokeCommand('open_file', { path: fullPath(t) }).catch(() => {}), <Play className="w-3.5 h-3.5 text-sky-400" />)}
              {item('Open destination folder', () => invokeCommand('reveal_file', { path: fullPath(t) }).catch(() => {}), <FolderOpen className="w-3.5 h-3.5 text-sky-400" />)}
              {sep('c')}
              {item('Copy name', () => copyText(t.filename, 'name'), <Copy className="w-3.5 h-3.5 text-sky-400" />)}
              {item('Copy info hash', async () => {
                try {
                  const d = await invokeCommand<Details>('torrent_details', { id: t.id });
                  if (d?.info_hash) copyText(d.info_hash, 'hash');
                } catch {
                  alert('The info hash is available while the torrent is active.');
                }
              }, <Copy className="w-3.5 h-3.5 text-sky-400" />)}
              {item('Copy magnet link', async () => {
                const m = await magnetFor(t);
                if (m) copyText(m, 'magnet link');
                else alert('The magnet link is available while the torrent is active.');
              }, <Copy className="w-3.5 h-3.5 text-sky-400" />)}
            </div>
          );
        })()}

      {/* torrent options */}
      {optionsFor && (
        <div className="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-4" onClick={() => setOptionsFor(null)}>
          <div className="w-96 bg-[#141821] border border-white/[0.15] rounded-xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-100">Torrent options</div>
            {([
              ['Download limit (KiB/s, 0 = unlimited)', 'down'],
              ['Upload limit (KiB/s, 0 = unlimited)', 'up'],
              ['Stop seeding at share ratio (0 = default)', 'ratio'],
            ] as const).map(([label, key]) => (
              <label key={key} className="block text-slate-300">
                {label}
                <input
                  type="number"
                  min={0}
                  step={key === 'ratio' ? 0.1 : 1}
                  value={limits[key]}
                  onChange={(e) => setLimits((l) => ({ ...l, [key]: Number(e.target.value) }))}
                  className="mt-1 w-full bg-[#0c0f15] border border-white/[0.12] rounded px-2.5 py-1.5 text-slate-100"
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setOptionsFor(null)} className="px-3 py-1.5 rounded-md border border-white/[0.15] text-slate-300">
                Cancel
              </button>
              <button onClick={saveOptions} className={`px-4 py-1.5 rounded-md font-bold text-slate-950 ${accentClasses.bg}`}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
