/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { X, Layers, FolderOpen, Download } from 'lucide-react';
import { AppSettings, DownloadItem } from '../types/download';
import { generateSegments } from '../services/downloadEngine';
import { detectProtocol } from '../services/protocolParser';
import { isTauriEnvironment, pickFolder } from '../services/tauriBridge';
import { categorizeExtension, getFileExtension } from '../utils/formatters';

interface BatchDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onAddDownload: (item: DownloadItem, startImmediately: boolean) => void;
  accentClasses: { bg: string; text: string; border: string; badge: string };
}

const MAX_LINKS = 2000;

/**
 * Expands a link pattern into many links.
 *   https://site.com/img[001-020].jpg   -> img001.jpg ... img020.jpg  (zero padding is kept)
 *   https://site.com/part[a-e].zip      -> parta.zip ... parte.zip
 * Several [..] groups are combined.
 */
export function expandPattern(pattern: string): string[] {
  const groups = /\[(\d+)-(\d+)\]|\[([a-zA-Z])-([a-zA-Z])\]/g;
  let results: string[] = [''];
  let last = 0;
  let m: RegExpExecArray | null;
  const text = pattern.trim();
  while ((m = groups.exec(text)) !== null) {
    const literal = text.slice(last, m.index);
    let values: string[] = [];
    if (m[1] !== undefined) {
      const width = m[1].length;
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const step = a <= b ? 1 : -1;
      for (let n = a; step > 0 ? n <= b : n >= b; n += step) {
        values.push(String(n).padStart(width, '0'));
        if (values.length > MAX_LINKS) break;
      }
    } else {
      const a = m[3].charCodeAt(0);
      const b = m[4].charCodeAt(0);
      const step = a <= b ? 1 : -1;
      for (let c = a; step > 0 ? c <= b : c >= b; c += step) values.push(String.fromCharCode(c));
    }
    const next: string[] = [];
    for (const prefix of results) {
      for (const v of values) {
        next.push(prefix + literal + v);
        if (next.length >= MAX_LINKS) break;
      }
      if (next.length >= MAX_LINKS) break;
    }
    results = next;
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  return results.map((r) => r + tail);
}

function nameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : 'download.dat';
  } catch {
    return 'download.dat';
  }
}

export const BatchDownloadModal: React.FC<BatchDownloadModalProps> = ({
  isOpen,
  onClose,
  settings,
  onAddDownload,
  accentClasses,
}) => {
  const [mode, setMode] = useState<'pattern' | 'list'>('pattern');
  const [pattern, setPattern] = useState('');
  const [listText, setListText] = useState('');
  const [directory, setDirectory] = useState(settings.defaultFolder);
  const [startNow, setStartNow] = useState(false);

  useEffect(() => {
    if (isOpen) setDirectory(settings.defaultFolder);
  }, [isOpen, settings.defaultFolder]);

  const links = useMemo(() => {
    const raw =
      mode === 'pattern'
        ? expandPattern(pattern)
        : listText
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
    const seen = new Set<string>();
    return raw.filter((l) => {
      if (!/^(https?|ftp|sftp|ftps):\/\//i.test(l) || seen.has(l)) return false;
      seen.add(l);
      return true;
    });
  }, [mode, pattern, listText]);

  if (!isOpen) return null;

  const browse = async () => {
    const picked = await pickFolder('Select download folder');
    if (picked) setDirectory(picked);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (links.length === 0) return;
    const segs = settings.maxConnectionsPerDownload;
    links.forEach((link, i) => {
      const filename = nameFromUrl(link);
      const bytes = 150 * 1024 * 1024;
      const item: DownloadItem = {
        id: `dl-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
        url: link,
        filename,
        directory,
        totalBytes: bytes,
        downloadedBytes: 0,
        speed: 0,
        status: startNow ? 'downloading' : 'queued',
        category: categorizeExtension(getFileExtension(filename)),
        protocol: detectProtocol(link),
        segmentsCount: segs,
        segments: generateSegments(bytes, segs),
        supportsRange: true,
        dateAdded: Date.now() + i,
        priority: 'normal',
      };
      onAddDownload(item, startNow);
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <form
        onSubmit={submit}
        className="bg-[#141821] border border-white/[0.12] rounded-xl w-full max-w-xl shadow-2xl overflow-hidden text-xs"
      >
        <div className="px-4 py-3 bg-[#11141c] border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${accentClasses.bg} text-slate-950`}>
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Batch Download</h3>
              <p className="text-[11px] text-slate-400">Add many files at once</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-200 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 p-1 bg-[#0c0e14] rounded-lg border border-white/[0.06]">
            {([
              ['pattern', 'Link pattern'],
              ['list', 'List of links'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors ${
                  mode === id ? `${accentClasses.bg} text-slate-950 font-bold` : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'pattern' ? (
            <div className="space-y-1.5">
              <input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="https://example.com/photos/img[001-050].jpg"
                className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-3 py-2 font-mono text-[11px] text-slate-100 focus:outline-none focus:border-white/30"
              />
              <p className="text-[11px] text-slate-400">
                Use <span className="font-mono text-slate-300">[1-20]</span> for numbers (keep leading zeros like{' '}
                <span className="font-mono text-slate-300">[001-020]</span>) or{' '}
                <span className="font-mono text-slate-300">[a-e]</span> for letters. You can use more than one.
              </p>
            </div>
          ) : (
            <textarea
              rows={7}
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              placeholder={'Paste one link per line\nhttps://example.com/file1.zip\nhttps://example.com/file2.zip'}
              className="w-full bg-[#0d1016] border border-white/[0.1] rounded px-3 py-2 font-mono text-[11px] text-slate-100 focus:outline-none focus:border-white/30"
            />
          )}

          <div className="p-2.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-slate-300">
            <div className="font-semibold">{links.length} link{links.length === 1 ? '' : 's'} ready</div>
            {links.length > 0 && (
              <div className="font-mono text-[11px] text-slate-400 truncate mt-0.5">
                {links[0]}
                {links.length > 1 && ` ... ${links[links.length - 1]}`}
              </div>
            )}
            {links.length >= MAX_LINKS && <div className="text-amber-300 mt-0.5">Limited to {MAX_LINKS} links.</div>}
          </div>

          <div className="flex items-center gap-2">
            <label className="w-16 text-slate-300 font-medium">Save to</label>
            <input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono text-[11px] text-slate-200"
            />
            {isTauriEnvironment() && (
              <button
                type="button"
                onClick={browse}
                className="p-1.5 rounded bg-white/[0.08] hover:bg-white/[0.15] text-slate-200"
                title="Choose folder"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {([
              [false, 'Add to queue', `Runs ${settings.maxConcurrentDownloads} at a time`],
              [true, 'Start all now', 'All at once'],
            ] as const).map(([val, label, note]) => (
              <button
                key={label}
                type="button"
                onClick={() => setStartNow(val)}
                className={`p-2 rounded-md border text-left transition-colors ${
                  startNow === val ? 'bg-white/[0.1] border-white/30 text-white' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.05]'
                }`}
              >
                <div className="font-semibold text-[11px]">{label}</div>
                <div className="text-[10px] opacity-80">{note}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/[0.08] bg-[#11141c] flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md border border-white/[0.12] text-slate-300 hover:bg-white/[0.06]">
            Cancel
          </button>
          <button
            type="submit"
            disabled={links.length === 0}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md font-bold text-slate-950 ${accentClasses.bg} disabled:opacity-40`}
          >
            <Download className="w-3.5 h-3.5" />
            Add {links.length || ''} download{links.length === 1 ? '' : 's'}
          </button>
        </div>
      </form>
    </div>
  );
};
