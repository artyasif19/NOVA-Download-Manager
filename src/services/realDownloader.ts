/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DownloadItem, DownloadSegment } from '../types/download';
import { calculateSha256 } from './downloadEngine';
import { parseHlsManifest } from './protocolParser';

export interface DownloadProgressCallback {
  (update: {
    downloadedBytes: number;
    speed: number;
    segments: DownloadSegment[];
    isFinished: boolean;
    blobUrl?: string;
    sha256Calculated?: string;
    error?: string;
  }): void;
}

const activeDownloads = new Map<string, {
  abortController: AbortController;
  isPaused: boolean;
  item: DownloadItem;
}>();

async function downloadHlsStream(
  item: DownloadItem,
  abortController: AbortController,
  onProgress: DownloadProgressCallback
): Promise<void> {
  let manifestUrl = item.url;
  const manifestRes = await fetch(manifestUrl, { signal: abortController.signal });
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch HLS manifest: HTTP ${manifestRes.status}`);
  }
  let manifestText = await manifestRes.text();
  let parsed = parseHlsManifest(manifestText, manifestUrl);

  if (parsed.isMaster && parsed.variants.length > 0) {
    manifestUrl = parsed.variants[0].url;
    const variantRes = await fetch(manifestUrl, { signal: abortController.signal });
    if (!variantRes.ok) {
      throw new Error(`Failed to fetch HLS media playlist: HTTP ${variantRes.status}`);
    }
    manifestText = await variantRes.text();
    parsed = parseHlsManifest(manifestText, manifestUrl);
  }

  if (parsed.hasDrm) {
    throw new Error(`DRM-protected HLS stream (${parsed.drmType}) cannot be downloaded.`);
  }

  if (parsed.segments.length === 0) {
    throw new Error('No media segments found in HLS playlist');
  }

  const chunks: Uint8Array[] = [];
  let currentDownloaded = 0;
  let lastTime = Date.now();
  let bytesSinceLastCheck = 0;

  for (let i = 0; i < parsed.segments.length; i++) {
    if (abortController.signal.aborted) return;
    const seg = parsed.segments[i];
    const segRes = await fetch(seg.url, { signal: abortController.signal });
    if (!segRes.ok) {
      throw new Error(`Failed to fetch segment ${i + 1}/${parsed.segments.length}: HTTP ${segRes.status}`);
    }
    const buf = await segRes.arrayBuffer();
    const segBytes = new Uint8Array(buf);
    chunks.push(segBytes);
    currentDownloaded += segBytes.byteLength;
    bytesSinceLastCheck += segBytes.byteLength;

    const now = Date.now();
    const elapsedSec = (now - lastTime) / 1000;
    if (elapsedSec >= 0.5) {
      const currentSpeed = Math.round(bytesSinceLastCheck / elapsedSec);
      lastTime = now;
      bytesSinceLastCheck = 0;
      onProgress({
        downloadedBytes: currentDownloaded,
        speed: currentSpeed,
        segments: item.segments,
        isFinished: false,
      });
    }
  }

  const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const combinedBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combinedBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const sha256Calculated = await calculateSha256(combinedBuffer.buffer);
  const blob = new Blob([combinedBuffer], { type: 'video/mp2t' });
  const blobUrl = URL.createObjectURL(blob);

  activeDownloads.delete(item.id);
  onProgress({
    downloadedBytes: currentDownloaded,
    speed: 0,
    segments: item.segments.map((s) => ({ ...s, isFinished: true })),
    isFinished: true,
    blobUrl,
    sha256Calculated,
  });
}

/**
 * Execute real download with Range requests, streaming body, or HLS segment fetching
 */
export async function startRealDownload(
  item: DownloadItem,
  onProgress: DownloadProgressCallback
): Promise<void> {
  if (item.protocol === 'dash' || item.url.toLowerCase().includes('.mpd')) {
    onProgress({
      downloadedBytes: 0,
      speed: 0,
      segments: item.segments,
      isFinished: false,
      error: 'MPEG-DASH multi-track segment muxing is not supported without external transcoders. Use direct progressive media or unencrypted HLS.',
    });
    return;
  }

  const abortController = new AbortController();
  activeDownloads.set(item.id, {
    abortController,
    isPaused: false,
    item,
  });

  if (item.protocol === 'hls' || item.url.toLowerCase().includes('.m3u8')) {
    try {
      await downloadHlsStream(item, abortController, onProgress);
    } catch (err: any) {
      activeDownloads.delete(item.id);
      if (err.name === 'AbortError') return;
      onProgress({
        downloadedBytes: 0,
        speed: 0,
        segments: item.segments,
        isFinished: false,
        error: err.message || 'HLS stream download failed',
      });
    }
    return;
  }

  const headers: Record<string, string> = {
    ...item.headers,
  };

  if (item.cookies) {
    headers['Cookie'] = item.cookies;
  }

  // Check if server supports range and we are resuming
  let currentDownloaded = item.downloadedBytes;
  if (currentDownloaded > 0 && item.supportsRange) {
    headers['Range'] = `bytes=${currentDownloaded}-`;
  }

  let lastTime = Date.now();
  let bytesSinceLastCheck = 0;
  const chunks: Uint8Array[] = [];

  try {
    const isRangeRequested = currentDownloaded > 0 && item.supportsRange;

    const response = await fetch(item.url, {
      method: 'GET',
      headers,
      signal: abortController.signal,
      mode: 'cors',
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`Server returned HTTP ${response.status}: ${response.statusText}`);
    }

    // HTTP STATUS & RANGE VALIDATION:
    // If we requested a range offset (bytes=N-), but server responded with 200 OK:
    // The server does NOT honor Range requests! It is streaming from byte 0.
    // We MUST reset currentDownloaded to 0 and clear existing chunks to prevent data corruption.
    if (isRangeRequested && response.status === 200) {
      console.warn(`[NOVA Downloader] Server returned HTTP 200 to Range request for ${item.filename}. Falling back to clean single-stream transfer from byte 0.`);
      currentDownloaded = 0;
      chunks.length = 0;
      item.supportsRange = false;
    } else if (isRangeRequested && response.status === 206) {
      // Validate Content-Range header to confirm server offset matches requested byte
      const contentRange = response.headers.get('content-range');
      if (contentRange) {
        const match = contentRange.match(/^bytes\s+(\d+)-/i);
        if (match) {
          const serverStartByte = parseInt(match[1], 10);
          if (serverStartByte !== currentDownloaded) {
            console.warn(`[NOVA Downloader] Content-Range start byte (${serverStartByte}) mismatch with expected (${currentDownloaded}). Resetting transfer.`);
            currentDownloaded = 0;
            chunks.length = 0;
          }
        }
      }
    }

    // ETag consistency validation: if remote file changed on server, restart from 0
    const newEtag = response.headers.get('etag');
    if (item.etag && newEtag && item.etag !== newEtag) {
      console.warn(`[NOVA Downloader] Remote ETag changed (${item.etag} -> ${newEtag}). Restarting full transfer from byte 0.`);
      currentDownloaded = 0;
      chunks.length = 0;
    }

    if (!response.body) {
      throw new Error('Response body is null or stream not supported by server.');
    }

    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        chunks.push(value);
        currentDownloaded += value.byteLength;
        bytesSinceLastCheck += value.byteLength;

        const now = Date.now();
        const elapsedSec = (now - lastTime) / 1000;

        if (elapsedSec >= 0.5) {
          const currentSpeed = Math.round(bytesSinceLastCheck / elapsedSec);
          lastTime = now;
          bytesSinceLastCheck = 0;

          // Update segments proportionally
          const updatedSegments = updateSegmentsProgress(
            item.segments,
            currentDownloaded,
            item.totalBytes,
            currentSpeed
          );

          onProgress({
            downloadedBytes: currentDownloaded,
            speed: currentSpeed,
            segments: updatedSegments,
            isFinished: false,
          });
        }
      }
    }

    // Verify all expected bytes were actually downloaded
    if (item.totalBytes > 0 && currentDownloaded < item.totalBytes) {
      throw new Error(`Premature disconnect: received ${currentDownloaded} bytes, expected ${item.totalBytes} bytes`);
    }

    // Download finished successfully: assemble complete file
    const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combinedBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // Calculate actual SHA-256 checksum
    const sha256Calculated = await calculateSha256(combinedBuffer.buffer);

    // Verify expected checksum if provided
    if (item.sha256Expected && item.sha256Expected.toLowerCase() !== sha256Calculated.toLowerCase()) {
      throw new Error(`SHA-256 checksum mismatch: expected ${item.sha256Expected}, calculated ${sha256Calculated}`);
    }

    // Create downloadable blob
    const mime = item.mimeType || 'application/octet-stream';
    const blob = new Blob([combinedBuffer], { type: mime });
    const blobUrl = URL.createObjectURL(blob);

    const finalSegments = item.segments.map(seg => ({
      ...seg,
      downloadedBytes: seg.endByte - seg.startByte,
      isFinished: true,
      isActive: false,
      speed: 0,
    }));

    activeDownloads.delete(item.id);

    onProgress({
      downloadedBytes: item.totalBytes > 0 ? item.totalBytes : currentDownloaded,
      speed: 0,
      segments: finalSegments,
      isFinished: true,
      blobUrl,
      sha256Calculated,
    });

  } catch (err: any) {
    activeDownloads.delete(item.id);

    if (err.name === 'AbortError') {
      // Intentionally paused or cancelled
      return;
    }

    onProgress({
      downloadedBytes: currentDownloaded,
      speed: 0,
      segments: item.segments,
      isFinished: false,
      error: err.message || 'Network download failed',
    });
  }
}

/**
 * Pause active real download
 */
export function pauseRealDownload(id: string): void {
  const active = activeDownloads.get(id);
  if (active) {
    active.isPaused = true;
    active.abortController.abort();
    activeDownloads.delete(id);
  }
}

/**
 * Cancel and purge real download
 */
export function cancelRealDownload(id: string): void {
  pauseRealDownload(id);
}

/**
 * Helper to update segment states based on overall bytes
 */
function updateSegmentsProgress(
  segments: DownloadSegment[],
  totalDownloaded: number,
  totalBytes: number,
  currentSpeed: number
): DownloadSegment[] {
  if (segments.length === 0) return segments;

  let remaining = totalDownloaded;
  const speedPerActiveSegment = Math.round(currentSpeed / segments.length);

  return segments.map((seg) => {
    const segCapacity = seg.endByte - seg.startByte;
    const segDownloaded = Math.min(segCapacity, remaining);
    remaining = Math.max(0, remaining - segCapacity);
    const isFinished = segDownloaded >= segCapacity;

    return {
      ...seg,
      downloadedBytes: segDownloaded,
      isFinished,
      isActive: !isFinished,
      speed: isFinished ? 0 : speedPerActiveSegment,
    };
  });
}
