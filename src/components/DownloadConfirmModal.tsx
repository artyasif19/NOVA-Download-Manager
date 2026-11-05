/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { X, FolderOpen, FileText, Download, Clock, Loader2 } from 'lucide-react';
import { AppSettings, DownloadItem } from '../types/download';
import { generateSegments } from '../services/downloadEngine';
import { detectProtocol } from '../services/protocolParser';
import { invokeCommand, isTauriEnvironment, pickFolder } from '../services/tauriBridge';
import { categorizeExtension, formatBytes, getFileExtension } from '../utils/formatters';

export interface ExtensionDownloadRequest {
  url: string;
  filename: string;
  totalBytes: number;
  mimeType: string;
  referrer: string;
  nonce: number;
}

interface DownloadConfirmModalProps {
  request: ExtensionDownloadRequest | null;
  settings: AppSettings;
  onClose: () => void;
  onAddDownload: (item: DownloadItem, startImmediately: boolean) => void;
  accentClasses: { bg: string; text: string; border: string; badge: string };
}

const CATEGORIES: Array<{ id: DownloadItem['category']; label: string }> = [
  { id: 'video_audio', label: 'Video & Audio' },
  { id: 'documents', label: 'Documents' },
  { id: 'compressed', label: 'Compressed' },
  { id: 'applications', label: 'Programs' },
  { id: 'custom', label: 'General' },
];

function nameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
  } catch {
    return '';
  }
}

export const DownloadConfirmModal: React.FC<DownloadConfirmModalProps> = ({
  request,
  settings,
  onClose,
  onAddDownload,
  accentClasses,
}) => {
  const [filename, setFilename] = useState('');
  const [directory, setDirectory] = useState(settings.defaultFolder);
  const [category, setCategory] = useState<DownloadItem['category']>('documents');
  const [description, setDescription] = useState('');
  const [totalBytes, setTotalBytes] = useState(0);
  const [supportsRange, setSupportsRange] = useState(true);
  const [etag, setEtag] = useState('');
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (!request) return;
    const initialName = request.filename || nameFromUrl(request.url) || 'download.dat';
    setFilename(initialName);
    setTotalBytes(request.totalBytes || 0);
    setCategory(categorizeExtension(getFileExtension(initialName)));
    setDirectory(settings.defaultFolder);
    setDescription('');
    setSupportsRange(true);
    setEtag('');

    // Ask the engine for the real name and size
    if (isTauriEnvironment()) {
      let cancelled = false;
      setProbing(true);
      invokeCommand<any>('probe_target_url', { url: request.url })
        .then((info) => {
          if (cancelled || !info) return;
          if (info.filename && !request.filename) {
            setFilename(info.filename);
            setCategory(categorizeExtension(getFileExtension(info.filename)));
          }
          if (info.total_bytes) setTotalBytes(info.total_bytes);
          setSupportsRange(Boolean(info.supports_range));
          if (info.etag) setEtag(info.etag);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setProbing(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!request) return null;

  const build = (status: DownloadItem['status']): DownloadItem => {
    const finalName = filename.trim() || 'download_' + Date.now();
    const bytes = totalBytes > 0 ? totalBytes : 150 * 1024 * 1024;
    const segs = supportsRange ? settings.maxConnectionsPerDownload : 1;
    return {
      id: `dl-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      url: request.url,
      filename: finalName,
      directory,
      totalBytes: bytes,
      downloadedBytes: 0,
      speed: 0,
      status,
      category,
      protocol: detectProtocol(request.url),
      segmentsCount: segs,
      segments: generateSegments(bytes, segs),
      supportsRange,
      isResumable: supportsRange,
      etag: etag || undefined,
      dateAdded: Date.now(),
      priority: 'normal',
      headers: request.referrer ? { Referer: request.referrer } : undefined,
    };
  };

  const browse = async () => {
    const picked = await pickFolder('Select where to save this file');
    if (picked) setDirectory(picked);
  };

  const fullPath = `${directory.replace(/[\\/]+$/, '')}\\${filename}`;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs flex items-center justify-center z-[60] p-4">
      <div className="bg-[#141821] border border-white/[0.12] rounded-xl w-full max-w-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-2.5 bg-[#11141c] border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${accentClasses.bg} text-slate-950`}>
              <Download className="w-4 h-4 stroke-[2.5]" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100">Download File Info</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] rounded"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-3 min-w-0">
              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-slate-300 font-medium">URL</label>
                <input
                  readOnly
                  value={request.url}
                  title={request.url}
                  className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono text-[11px] text-slate-300"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-slate-300 font-medium">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as DownloadItem['category'])}
                  className="flex-1 bg-[#0c0f15] border border-white/[0.1] rounded px-2.5 py-1.5 text-slate-200"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-slate-300 font-medium">Save As</label>
                <input
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                  className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono text-[11px] text-slate-200"
                />
                {isTauriEnvironment() && (
                  <button
                    type="button"
                    onClick={browse}
                    title="Choose folder"
                    className="p-1.5 rounded bg-white/[0.08] hover:bg-white/[0.15] text-slate-200"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-slate-300 font-medium">File name</label>
                <input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.1] rounded px-2.5 py-1.5 font-mono text-[11px] text-slate-200"
                />
              </div>

              <div className="flex items-center gap-2">
                <label className="w-20 shrink-0 text-slate-300 font-medium">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="flex-1 min-w-0 bg-[#0c0f15] border border-white/[0.1] rounded px-2.5 py-1.5 text-slate-200"
                />
              </div>
            </div>

            <div className="w-24 shrink-0 flex flex-col items-center gap-1.5 pt-1 text-center">
              <div className="p-3 rounded-lg bg-white/[0.06] border border-white/[0.08]">
                <FileText className={`w-8 h-8 ${accentClasses.text}`} />
              </div>
              <div className="font-mono text-slate-200 text-sm">
                {probing ? <Loader2 className="w-4 h-4 animate-spin inline" /> : totalBytes > 0 ? formatBytes(totalBytes) : 'Unknown'}
              </div>
              <div className="text-[10px] text-slate-400">{supportsRange ? 'Resumable' : 'No resume'}</div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 font-mono truncate" title={fullPath}>
            {fullPath}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/[0.08] bg-[#11141c] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              onAddDownload(build('queued'), false);
              onClose();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.12] text-slate-200 hover:bg-white/[0.06]"
          >
            <Clock className="w-3.5 h-3.5" />
            Download Later
          </button>
          <button
            type="button"
            onClick={() => {
              onAddDownload(build('downloading'), true);
              onClose();
            }}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md font-bold text-slate-950 ${accentClasses.bg}`}
          >
            <Download className="w-3.5 h-3.5" />
            Start Download
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-white/[0.12] text-slate-300 hover:bg-white/[0.06]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
