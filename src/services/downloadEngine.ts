/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { 
  DownloadItem, 
  DownloadSegment, 
  DownloadProtocol, 
  ProtocolCredentials, 
  StreamInfo 
} from '../types/download';
import { categorizeExtension, getFileExtension } from '../utils/formatters';
import { 
  detectProtocol, 
  parseFtpUrl, 
  extractContentDispositionFilename, 
  parseHlsManifest, 
  parseDashManifest,
  ParsedFtpDetails
} from './protocolParser';

export interface ProbeResult {
  url: string;
  protocol: DownloadProtocol;
  filename: string;
  totalBytes: number;
  supportsRange: boolean;
  isResumable: boolean;
  etag?: string;
  mimeType?: string;
  category: 'video_audio' | 'documents' | 'compressed' | 'applications' | 'custom';
  ftpDetails?: ParsedFtpDetails;
  streamInfo?: StreamInfo;
  serverSoftware?: string;
  warning?: string;
}

// Extract filename with full fallback hierarchy
export function extractFilename(url: string, disposition?: string | null): string {
  const fromDisposition = extractContentDispositionFilename(disposition);
  if (fromDisposition) {
    return fromDisposition;
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const last = parts[parts.length - 1];
      if (last.includes('.')) {
        return decodeURIComponent(last);
      }
    }
  } catch {
    // fallback to generic
  }

  return 'download_' + Date.now().toString(36);
}

/**
 * Comprehensive probe that detects protocol, inspects headers, Range support,
 * streaming manifests (HLS/DASH), and FTP/SFTP configurations.
 */
export async function probeUrl(
  url: string, 
  customHeaders?: Record<string, string>,
  credentials?: ProtocolCredentials
): Promise<ProbeResult> {
  const protocol = detectProtocol(url);
  const headers = { ...customHeaders };
  let filename = extractFilename(url);
  let totalBytes = 0;
  let supportsRange = false;
  let isResumable = false;
  let etag: string | undefined;
  let mimeType: string | undefined;
  let serverSoftware: string | undefined;
  let ftpDetails: ParsedFtpDetails | undefined;
  let streamInfo: StreamInfo | undefined;
  let warning: string | undefined;

  // 1. Handle FTP, FTPS, SFTP
  if (protocol === 'ftp' || protocol === 'ftps' || protocol === 'sftp') {
    ftpDetails = parseFtpUrl(url, credentials);
    filename = ftpDetails.filename;
    // Resumability depends on server support verified during transfer; default to false until validated
    supportsRange = false;
    isResumable = false;
    totalBytes = 0; // Size unknown until probed via SIZE or STAT commands
    mimeType = 'application/octet-stream';

    const ext = getFileExtension(filename);
    const category = categorizeExtension(ext);

    return {
      url,
      protocol,
      filename,
      totalBytes,
      supportsRange,
      isResumable,
      category,
      ftpDetails,
      warning: ftpDetails.isAnonymous ? 'Connecting via anonymous FTP' : `Authenticated as ${ftpDetails.username}`,
    };
  }

  // 2. Handle HTTP/HTTPS and Streaming Manifests
  try {
    // Check if this is an HLS or DASH stream URL
    if (protocol === 'hls' || url.toLowerCase().includes('.m3u8')) {
      try {
        const manifestRes = await fetch(url, { headers, mode: 'cors' });
        if (manifestRes.ok) {
          const text = await manifestRes.text();
          const parsed = parseHlsManifest(text, url);
          mimeType = 'application/x-mpegURL';
          filename = filename.endsWith('.m3u8') ? filename.replace(/\.m3u8$/i, '.mp4') : `${filename}.mp4`;
          streamInfo = {
            format: 'hls',
            isLive: parsed.isLive,
            hasDrm: parsed.hasDrm,
            drmType: parsed.drmType,
            segmentCount: parsed.segments.length,
            quality: parsed.variants[0]?.qualityLabel || 'Adaptive Bitrate',
            masterUrl: url,
          };
          if (parsed.hasDrm) {
            warning = parsed.drmMessage || 'DRM encryption detected';
          }
          // Segmented streaming manifests have indeterminate byte length until fetched
          totalBytes = 0;
          supportsRange = false;
          isResumable = !parsed.isLive;

          return {
            url,
            protocol: 'hls',
            filename,
            totalBytes,
            supportsRange,
            isResumable,
            mimeType,
            category: 'video_audio',
            streamInfo,
            warning,
          };
        }
      } catch {
        // Fall back to standard probe
      }
    } else if (protocol === 'dash' || url.toLowerCase().includes('.mpd')) {
      try {
        const manifestRes = await fetch(url, { headers, mode: 'cors' });
        if (manifestRes.ok) {
          const text = await manifestRes.text();
          const parsed = parseDashManifest(text, url);
          mimeType = 'application/dash+xml';
          filename = filename.endsWith('.mpd') ? filename.replace(/\.mpd$/i, '.mp4') : `${filename}.mp4`;
          streamInfo = {
            format: 'dash',
            isLive: parsed.isLive,
            hasDrm: parsed.hasDrm,
            drmType: parsed.drmType,
            quality: parsed.representations[0]?.qualityLabel || 'Adaptive Bitrate',
            masterUrl: url,
          };
          if (parsed.hasDrm) {
            warning = parsed.drmMessage || 'Widevine / PlayReady DRM encryption detected';
          }
          totalBytes = 0;
          supportsRange = false;
          isResumable = !parsed.isLive;

          return {
            url,
            protocol: 'dash',
            filename,
            totalBytes,
            supportsRange,
            isResumable,
            mimeType,
            category: 'video_audio',
            streamInfo,
            warning,
          };
        }
      } catch {
        // Fall back
      }
    }

    // Try HEAD request first for standard HTTP / HTTPS
    const headRes = await fetch(url, {
      method: 'HEAD',
      headers,
      mode: 'cors',
    });

    serverSoftware = headRes.headers.get('server') || undefined;

    if (headRes.ok) {
      const len = headRes.headers.get('content-length');
      if (len) totalBytes = parseInt(len, 10);

      const acceptRanges = headRes.headers.get('accept-ranges');
      if (acceptRanges === 'bytes') {
        supportsRange = true;
        isResumable = true;
      }

      etag = headRes.headers.get('etag') || undefined;
      mimeType = headRes.headers.get('content-type') || undefined;
      filename = extractFilename(url, headRes.headers.get('content-disposition'));
    }
  } catch {
    // If HEAD fails (e.g. servers rejecting HEAD, CORS restriction, or 405 Method Not Allowed),
    // probe with a lightweight Range GET request for the first byte: bytes=0-0
    try {
      const rangeRes = await fetch(url, {
        method: 'GET',
        headers: { ...headers, Range: 'bytes=0-0' },
        mode: 'cors',
      });

      serverSoftware = rangeRes.headers.get('server') || undefined;

      if (rangeRes.status === 206) {
        supportsRange = true;
        isResumable = true;
        const cr = rangeRes.headers.get('content-range');
        if (cr) {
          const match = cr.match(/\/(\d+|\*)$/);
          if (match && match[1] !== '*') {
            totalBytes = parseInt(match[1], 10);
          }
        }
      } else if (rangeRes.ok) {
        // Server returned 200 instead of 206: it does not support Range requests!
        supportsRange = false;
        isResumable = false;
        const len = rangeRes.headers.get('content-length');
        if (len) totalBytes = parseInt(len, 10);
      }

      etag = rangeRes.headers.get('etag') || undefined;
      mimeType = rangeRes.headers.get('content-type') || undefined;
      filename = extractFilename(url, rangeRes.headers.get('content-disposition'));
    } catch {
      // Offline fallback or strict CORS sandbox: do NOT claim Range or resumability without verification
      supportsRange = false;
      isResumable = false;
      totalBytes = 0;
    }
  }

  const ext = getFileExtension(filename);
  const category = categorizeExtension(ext);

  return {
    url,
    protocol,
    filename,
    totalBytes: totalBytes > 0 ? totalBytes : 0,
    supportsRange,
    isResumable,
    etag,
    mimeType,
    category,
    serverSoftware,
    streamInfo,
    warning,
  };
}

/**
 * Generate segments for segmented download with strict byte validation
 * (guarantees contiguous, non-overlapping segments covering 0 .. totalBytes - 1)
 */
export function generateSegments(totalBytes: number, segmentsCount: number): DownloadSegment[] {
  const count = Math.max(1, segmentsCount);
  if (totalBytes <= 0) {
    return [{
      id: 1,
      startByte: 0,
      endByte: 0,
      downloadedBytes: 0,
      speed: 0,
      isFinished: false,
      isActive: true,
    }];
  }

  const chunkSize = Math.floor(totalBytes / count);
  const segments: DownloadSegment[] = [];

  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? totalBytes - 1 : ((i + 1) * chunkSize) - 1;
    segments.push({
      id: i + 1,
      startByte: start,
      endByte: end,
      downloadedBytes: 0,
      speed: 0,
      isFinished: false,
      isActive: true,
    });
  }

  return segments;
}

// Controller map for active real downloads
const activeAbortControllers = new Map<string, AbortController>();

export function cancelDownloadOperation(id: string) {
  const controller = activeAbortControllers.get(id);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(id);
  }
}

export function registerDownloadController(id: string, controller: AbortController) {
  activeAbortControllers.set(id, controller);
}

// Calculate SHA256 of ArrayBuffer
export async function calculateSha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
