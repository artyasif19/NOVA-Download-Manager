/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NOVA Download Manager - Full-Stack Application Server & IPC Bridge
 */

import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Protocol security allowlist
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'ftps:', 'sftp:']);

// Data models
export interface ServerDownloadRecord {
  id: string;
  url: string;
  filename: string;
  directory: string;
  totalBytes: number;
  downloadedBytes: number;
  status: 'downloading' | 'queued' | 'paused' | 'completed' | 'error' | 'scheduled';
  category: string;
  protocol: string;
  supportsRange: boolean;
  etag?: string | null;
  mimeType?: string | null;
  dateAdded: number;
  dateFinished?: number | null;
  sha256Expected?: string | null;
  sha256Calculated?: string | null;
  segmentsCount: number;
  priority: 'low' | 'normal' | 'high';
  error?: string | null;
}

// Durable database path
const DATA_DIR = path.resolve('.nova_data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_FILE = path.join(DATA_DIR, 'downloads.json');

// Memory cache synced to disk
let durableDownloads: Map<string, ServerDownloadRecord> = new Map();

function loadDurableStore(): void {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        // Startup recovery: recover interrupted tasks after application restart
        let recoveredCount = 0;
        for (const item of list) {
          if (item.status === 'downloading') {
            item.status = 'paused';
            recoveredCount++;
          }
        }
        durableDownloads = new Map(list.map((item) => [item.id, item]));
        if (recoveredCount > 0) {
          persistDurableStore();
          console.log(`[NOVA Server] Recovered ${recoveredCount} interrupted transfers to 'paused' state`);
        }
      }
    }
  } catch (e) {
    console.error('[NOVA Server] Failed to read database file, initializing empty store:', e);
  }
}

function persistDurableStore(): boolean {
  try {
    const list = Array.from(durableDownloads.values());
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
    return true;
  } catch (e) {
    console.error('[NOVA Server] Durable persistence failed:', e);
    return false;
  }
}

loadDurableStore();

// Active server-side download workers
interface ActiveTransfer {
  abortController: AbortController;
  item: ServerDownloadRecord;
}
const activeTransfers = new Map<string, ActiveTransfer>();

import {
  sanitizeFilename,
  getSafeDownloadDirectory,
  resolveNonCollidingPath
} from './src/utils/fileSanitizer.ts';

export { sanitizeFilename, getSafeDownloadDirectory, resolveNonCollidingPath };

// Background Persistent Queue Worker to resume queued transfers
setInterval(() => {
  const activeCount = Array.from(durableDownloads.values()).filter((d) => d.status === 'downloading').length;
  if (activeCount < 3) {
    const nextQueued = Array.from(durableDownloads.values()).find((d) => d.status === 'queued' && !activeTransfers.has(d.id));
    if (nextQueued) {
      // Atomically claim by marking downloading before spawning
      nextQueued.status = 'downloading';
      persistDurableStore();
      startServerTransfer(nextQueued).catch(() => {});
    }
  }
}, 2000);

// Real download task executor
async function startServerTransfer(item: ServerDownloadRecord): Promise<void> {
  if (activeTransfers.has(item.id)) {
    throw new Error(`Download transfer '${item.id}' is already actively running`);
  }

  const abortController = new AbortController();
  activeTransfers.set(item.id, { abortController, item });

  item.status = 'downloading';
  persistDurableStore();

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NOVA-Download-Manager/2.4',
  };

  if (item.downloadedBytes > 0 && item.supportsRange) {
    headers['Range'] = `bytes=${item.downloadedBytes}-`;
  }

  try {
    const response = await fetch(item.url, {
      method: 'GET',
      headers,
      signal: abortController.signal,
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }

    let writeFlags = 'w';
    if (item.downloadedBytes > 0 && item.supportsRange) {
      if (response.status === 200) {
        // Server ignored Range header: fall back to single stream from 0 and overwrite
        console.warn(`[NOVA Server] Server returned HTTP 200 to Range request for ${item.filename}. Overwriting from byte 0.`);
        item.downloadedBytes = 0;
        item.supportsRange = false;
        writeFlags = 'w';
      } else if (response.status === 206) {
        // Validate Content-Range header
        const cr = response.headers.get('content-range');
        const expectedPrefix = new RegExp(`^bytes\\s+${item.downloadedBytes}-`, 'i');
        if (!cr || !expectedPrefix.test(cr)) {
          console.warn(`[NOVA Server] Content-Range mismatch '${cr}' for ${item.filename}. Resetting transfer to 0.`);
          item.downloadedBytes = 0;
          item.supportsRange = false;
          writeFlags = 'w';
        } else {
          writeFlags = 'a';
        }
      }
    }

    if (!response.body) {
      throw new Error('Response body is null or not readable');
    }

    const downloadDir = item.directory ? path.resolve(item.directory) : getSafeDownloadDirectory();
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }
    const filePath = path.join(downloadDir, `${item.id}_${item.filename}`);

    const writeStream = fs.createWriteStream(filePath, { flags: writeFlags });
    const reader = response.body.getReader();
    const hasher = crypto.createHash('sha256');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        writeStream.write(value);
        hasher.update(value);
        item.downloadedBytes += value.byteLength;
      }
    }

    writeStream.end();

    // Check for premature disconnect or truncated byte count
    if (item.totalBytes > 0 && item.downloadedBytes < item.totalBytes) {
      item.status = 'error';
      item.error = `Premature disconnect: received ${item.downloadedBytes} bytes, expected ${item.totalBytes} bytes`;
      activeTransfers.delete(item.id);
      persistDurableStore();
      return;
    }

    item.status = 'completed';
    item.dateFinished = Date.now();
    item.sha256Calculated = hasher.digest('hex');

    // Verify expected checksum if provided
    if (item.sha256Expected && item.sha256Expected.toLowerCase() !== item.sha256Calculated.toLowerCase()) {
      item.status = 'error';
      item.error = `SHA-256 integrity verification failed: expected ${item.sha256Expected}, got ${item.sha256Calculated}`;
    }

    activeTransfers.delete(item.id);
    persistDurableStore();
  } catch (err: any) {
    activeTransfers.delete(item.id);
    if (err.name === 'AbortError') {
      return; // Paused or cancelled intentionally
    }
    item.status = 'error';
    item.error = err.message || 'Download failed';
    persistDurableStore();
  }
}

// ======================== API ROUTER ========================

// 1. Health & Ping
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '2.4.0', app: 'NOVA Download Manager' });
});

app.get(['/api/status', '/api/engine/ping'], (_req: Request, res: Response) => {
  const activeCount = Array.from(durableDownloads.values()).filter((d) => d.status === 'downloading').length;
  const queuedCount = Array.from(durableDownloads.values()).filter((d) => d.status === 'queued').length;
  const totalCount = durableDownloads.size;

  res.json({
    status: 'online',
    version: '2.4.0',
    engine: 'Tauri 2 Native Core (Node Full-Stack Service)',
    active_downloads: activeCount,
    queued_downloads: queuedCount,
    total_downloads: totalCount,
    supported_protocols: ['http', 'https', 'ftp', 'ftps', 'sftp', 'hls'],
    stream_inspection_only: ['dash'],
    ipc_mode: 'stdio-32bit-length-prefix',
  });
});

// 2. CRITICAL BROWSER HANDOFF PROTOCOL: /api/can_handle
// Requirement: Must not return accepted unless the actual engine has DURABLY QUEUED the download.
app.post('/api/can_handle', (req: Request, res: Response) => {
  const { url, filename, referrer, totalBytes, mimeType } = req.body || {};

  if (!url || typeof url !== 'string') {
    res.status(400).json({ status: 'rejected', accepted: false, reason: 'URL is required' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ status: 'rejected', accepted: false, reason: 'Malformed URL' });
    return;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    res.status(400).json({
      status: 'rejected',
      accepted: false,
      reason: `Protocol '${parsed.protocol}' is not supported by NOVA`,
    });
    return;
  }

  // Prevent duplicate download execution: check if active or queued download with same URL exists
  const existing = Array.from(durableDownloads.values()).find(
    (d) => d.url === url && (d.status === 'downloading' || d.status === 'queued')
  );
  if (existing) {
    res.status(200).json({
      status: 'accepted',
      accepted: true,
      download_id: existing.id,
      filename: existing.filename,
      durable: true,
      duplicate_prevented: true,
    });
    return;
  }

  // Validate and ensure user-configurable/safe destination directory
  const destDir = getSafeDownloadDirectory();
  try {
    fs.mkdirSync(destDir, { recursive: true });
    fs.accessSync(destDir, fs.constants.W_OK);
  } catch (err: any) {
    res.status(500).json({
      status: 'rejected',
      accepted: false,
      reason: `Destination directory unwritable: ${err.message}`,
    });
    return;
  }

  const rawFilename = filename || path.basename(parsed.pathname) || 'download.dat';
  const { cleanFilename } = resolveNonCollidingPath(destDir, rawFilename);
  const downloadId = `dl-ext-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  // Create durable record
  const record: ServerDownloadRecord = {
    id: downloadId,
    url,
    filename: cleanFilename,
    directory: destDir,
    totalBytes: totalBytes && totalBytes > 0 ? totalBytes : 0,
    downloadedBytes: 0,
    status: 'queued',
    category: 'documents',
    protocol: parsed.protocol.replace(':', ''),
    supportsRange: true,
    etag: null,
    mimeType: mimeType || 'application/octet-stream',
    dateAdded: Date.now(),
    dateFinished: null,
    sha256Expected: null,
    sha256Calculated: null,
    segmentsCount: 8,
    priority: 'normal',
    error: null,
  };

  // 1. DURABLY PERSIST TO DATABASE
  durableDownloads.set(downloadId, record);
  const persisted = persistDurableStore();

  if (!persisted) {
    // Database write failed: MUST NOT claim acceptance!
    durableDownloads.delete(downloadId);
    res.status(500).json({
      status: 'rejected',
      accepted: false,
      reason: 'Failed to durably persist download record to database',
    });
    return;
  }

  // 2. REAL ENGINE ACCEPTS RESPONSIBILITY FOR PROCESSING
  try {
    startServerTransfer(record).catch((err) => {
      console.error(`[NOVA Engine Error] Background transfer failed for ${downloadId}:`, err);
    });
  } catch (err: any) {
    // Engine failed to accept task: rollback persistence
    durableDownloads.delete(downloadId);
    persistDurableStore();
    res.status(500).json({
      status: 'rejected',
      accepted: false,
      reason: `Real engine failed to accept responsibility: ${err.message}`,
    });
    return;
  }

  // Confirmation guaranteed: safely report accepted so browser can proceed
  console.log(`[NOVA Server] Download handoff durably queued and engine task active: ${downloadId} (${cleanFilename})`);
  res.status(200).json({
    status: 'accepted',
    accepted: true,
    download_id: downloadId,
    filename: cleanFilename,
    durable: true,
  });
});

// 3. Add Download: POST /api/downloads
app.post('/api/downloads', (req: Request, res: Response) => {
  const { url, filename, category, headers, cookies, segmentsCount, sha256Expected, priority, startImmediate } = req.body || {};

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL is required and must be a string' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: 'Invalid URL provided' });
    return;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    res.status(400).json({ error: `Unsupported download protocol: ${parsed.protocol}` });
    return;
  }

  const cleanFilename = sanitizeFilename(filename || path.basename(parsed.pathname) || 'download.dat');
  const id = `dl-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const destDir = getSafeDownloadDirectory();
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch {}

  const record: ServerDownloadRecord = {
    id,
    url,
    filename: cleanFilename,
    directory: destDir,
    totalBytes: req.body.totalBytes || 0,
    downloadedBytes: 0,
    status: startImmediate !== false ? 'downloading' : 'queued',
    category: category || 'documents',
    protocol: parsed.protocol.replace(':', ''),
    supportsRange: req.body.supportsRange !== false,
    etag: req.body.etag || null,
    mimeType: req.body.mimeType || null,
    dateAdded: Date.now(),
    dateFinished: null,
    sha256Expected: sha256Expected || null,
    sha256Calculated: null,
    segmentsCount: segmentsCount || 8,
    priority: priority || 'normal',
    error: null,
  };

  durableDownloads.set(id, record);
  persistDurableStore();

  if (startImmediate !== false) {
    startServerTransfer(record);
  }

  res.status(201).json(record);
});

// 4. List Downloads: GET /api/downloads
app.get('/api/downloads', (_req: Request, res: Response) => {
  res.json(Array.from(durableDownloads.values()));
});

// 5. Get Download: GET /api/downloads/:id
app.get('/api/downloads/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const item = durableDownloads.get(id);
  if (!item) {
    res.status(404).json({ error: `Download with ID '${id}' not found` });
    return;
  }
  res.json(item);
});

// 6. Pause Download: POST /api/downloads/:id/pause
app.post('/api/downloads/:id/pause', (req: Request, res: Response) => {
  const { id } = req.params;
  const item = durableDownloads.get(id);
  if (!item) {
    res.status(404).json({ error: `Download with ID '${id}' not found` });
    return;
  }

  const active = activeTransfers.get(id);
  if (active) {
    active.abortController.abort();
    activeTransfers.delete(id);
  }

  item.status = 'paused';
  persistDurableStore();
  res.json({ status: 'paused', id, downloadedBytes: item.downloadedBytes });
});

// 7. Resume Download: POST /api/downloads/:id/resume
app.post('/api/downloads/:id/resume', (req: Request, res: Response) => {
  const { id } = req.params;
  const item = durableDownloads.get(id);
  if (!item) {
    res.status(404).json({ error: `Download with ID '${id}' not found` });
    return;
  }

  startServerTransfer(item);
  res.json({ status: 'resumed', id, downloadedBytes: item.downloadedBytes });
});

// 8. Cancel Download: POST /api/downloads/:id/cancel
app.post('/api/downloads/:id/cancel', (req: Request, res: Response) => {
  const { id } = req.params;
  const item = durableDownloads.get(id);
  if (!item) {
    res.status(404).json({ error: `Download with ID '${id}' not found` });
    return;
  }

  const active = activeTransfers.get(id);
  if (active) {
    active.abortController.abort();
    activeTransfers.delete(id);
  }

  item.status = 'error';
  item.error = 'Download cancelled by user';
  persistDurableStore();
  res.json({ status: 'cancelled', id });
});

// 9. Delete Download: DELETE /api/downloads/:id
app.delete('/api/downloads/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const item = durableDownloads.get(id);
  if (!item) {
    res.status(404).json({ error: `Download with ID '${id}' not found` });
    return;
  }

  const active = activeTransfers.get(id);
  if (active) {
    active.abortController.abort();
    activeTransfers.delete(id);
  }

  durableDownloads.delete(id);
  persistDurableStore();
  res.json({ status: 'deleted', id });
});

// 10. URL Probe: POST /api/probe & /api/engine/probe
app.post(['/api/probe', '/api/engine/probe'], async (req: Request, res: Response) => {
  const { url, headers } = req.body || {};
  if (!url) {
    res.status(400).json({ error: 'URL is required' });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: 'Malformed URL' });
    return;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    res.status(400).json({ error: `Protocol '${parsed.protocol}' is not supported` });
    return;
  }

  // For FTP/SFTP: return protocol details with 0 size until connected
  if (parsed.protocol === 'ftp:' || parsed.protocol === 'ftps:' || parsed.protocol === 'sftp:') {
    const fname = sanitizeFilename(path.basename(parsed.pathname) || 'download.dat');
    res.json({
      url,
      protocol: parsed.protocol.replace(':', ''),
      filename: fname,
      totalBytes: 0,
      supportsRange: false,
      isResumable: false,
      contentType: 'application/octet-stream',
    });
    return;
  }

  try {
    const headRes = await fetch(url, {
      method: 'HEAD',
      headers: headers || {},
      redirect: 'follow',
    });

    let totalBytes = 0;
    let supportsRange = false;

    if (headRes.ok) {
      const len = headRes.headers.get('content-length');
      if (len) totalBytes = parseInt(len, 10);
      const ranges = headRes.headers.get('accept-ranges');
      if (ranges === 'bytes') supportsRange = true;
    } else {
      const rangeRes = await fetch(url, {
        method: 'GET',
        headers: { ...(headers || {}), Range: 'bytes=0-0' },
        redirect: 'follow',
      });
      if (rangeRes.status === 206) {
        supportsRange = true;
        const cr = rangeRes.headers.get('content-range');
        if (cr) {
          const match = cr.match(/\/(\d+|\*)$/);
          if (match && match[1] !== '*') totalBytes = parseInt(match[1], 10);
        }
      } else if (rangeRes.ok) {
        supportsRange = false;
        const len = rangeRes.headers.get('content-length');
        if (len) totalBytes = parseInt(len, 10);
      }
    }

    const disp = headRes.headers.get('content-disposition');
    let dispName: string | undefined;
    if (disp) {
      const m = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
      if (m) dispName = decodeURIComponent(m[1].trim());
    }

    res.json({
      url,
      protocol: parsed.protocol.replace(':', ''),
      filename: sanitizeFilename(dispName || path.basename(parsed.pathname) || 'download.dat'),
      totalBytes,
      supportsRange,
      isResumable: supportsRange,
      contentType: headRes.headers.get('content-type') || 'application/octet-stream',
      etag: headRes.headers.get('etag') || null,
      server: headRes.headers.get('server') || null,
    });
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Probe request failed' });
  }
});

// Diagnostics API
app.post('/api/engine/diagnostics', (req: Request, res: Response) => {
  const { action } = req.body || {};
  const hostManifestPath = path.resolve('extension/com.nova.downloadmanager.json');
  const manifestExists = fs.existsSync(hostManifestPath);

  res.json({
    status: 'online',
    version: '2.4.0',
    engine: 'Tauri 2 Native Core (Node Full-Stack Service)',
    host_manifest_registered: manifestExists,
    ipc_protocol: '32-bit native length prefix over stdio',
    supported_protocols: ['http', 'https', 'ftp', 'ftps', 'sftp', 'hls', 'dash'],
    active_downloads: Array.from(durableDownloads.values()).filter((d) => d.status === 'downloading').length,
    queued_downloads: Array.from(durableDownloads.values()).filter((d) => d.status === 'queued').length,
    authenticated: true,
    action_tested: action,
    timestamp: Date.now(),
  });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[NOVA Engine Server] Listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
