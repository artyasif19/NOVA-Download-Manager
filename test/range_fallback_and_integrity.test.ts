/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NOVA Download Manager - Integration Tests:
 * 1. Servers that ignore Range headers (HTTP 200 fallback)
 * 2. Servers that return incorrect or malformed Content-Range values
 * 3. Servers that disconnect mid-transfer (socket abort)
 * 4. Servers that return fewer bytes than expected (truncated payload)
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { startRealDownload } from '../src/services/realDownloader.ts';
import { probeUrl } from '../src/services/downloadEngine.ts';
import { DownloadItem } from '../src/types/download.ts';

// Helper to create and start a test HTTP server on random available port
function createTestServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

test('Integration: Server that ignores Range headers triggers clean single-stream fallback from byte 0', async () => {
  const fullPayload = Buffer.from('NOVA_INTEGRATION_TEST_DATA_IGNORE_RANGE_HEADER_FULL_CONTENT_1234567890');
  const fullSha256 = crypto.createHash('sha256').update(fullPayload).digest('hex');

  let rangeHeaderReceived: string | undefined;

  const serverInfo = await createTestServer((req, res) => {
    rangeHeaderReceived = req.headers['range'];
    // Server ignores Range header and returns 200 OK with full file
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fullPayload.length.toString(),
      'ETag': '"mock-etag-1"',
    });
    res.end(fullPayload);
  });

  try {
    // 1. Probe the server
    const probe = await probeUrl(`${serverInfo.url}/file.dat`);
    assert.strictEqual(probe.supportsRange, false, 'Probe must detect server returns 200 to Range, indicating no Range support');

    // 2. Execute download where client had previous downloaded bytes
    const item: DownloadItem = {
      id: 'test-ignore-range',
      url: `${serverInfo.url}/file.dat`,
      filename: 'file.dat',
      directory: '.nova_data/test_downloads',
      totalBytes: fullPayload.length,
      downloadedBytes: 15, // Simulate resuming
      status: 'downloading',
      category: 'documents',
      protocol: 'http',
      supportsRange: true, // Client thought it had range support
      segmentsCount: 1,
      segments: [],
      dateAdded: Date.now(),
      priority: 'normal',
      speed: 0,
      sha256Expected: fullSha256,
    };

    let finishedUpdate: any = null;
    await startRealDownload(item, (update) => {
      if (update.isFinished || update.error) {
        finishedUpdate = update;
      }
    });

    assert.ok(finishedUpdate, 'Download progress callback must be invoked');
    assert.strictEqual(finishedUpdate.isFinished, true, 'Download must complete successfully via fallback');
    assert.strictEqual(finishedUpdate.sha256Calculated, fullSha256, 'Calculated hash must match full payload hash');
    assert.strictEqual(finishedUpdate.downloadedBytes, fullPayload.length, 'Must download all bytes from byte 0');
    assert.strictEqual(item.supportsRange, false, 'Range support must be demoted to false');
  } finally {
    await serverInfo.close();
  }
});

test('Integration: Server that returns incorrect or missing Content-Range values is safely handled', async () => {
  const payload = Buffer.from('TEST_PAYLOAD_FOR_CONTENT_RANGE_VALIDATION');

  // Server returns 206 but with missing Content-Range header
  const missingRangeServer = await createTestServer((_req, res) => {
    res.writeHead(206, {
      'Content-Type': 'application/octet-stream',
      // Missing Content-Range!
    });
    res.end(payload);
  });

  try {
    const item: DownloadItem = {
      id: 'test-missing-cr',
      url: `${missingRangeServer.url}/data.bin`,
      filename: 'data.bin',
      directory: '.nova_data/test_downloads',
      totalBytes: payload.length,
      downloadedBytes: 10,
      status: 'downloading',
      category: 'documents',
      protocol: 'http',
      supportsRange: true,
      segmentsCount: 1,
      segments: [],
      dateAdded: Date.now(),
      priority: 'normal',
      speed: 0,
    };

    let finishedUpdate: any = null;
    await startRealDownload(item, (update) => {
      if (update.isFinished || update.error) {
        finishedUpdate = update;
      }
    });

    assert.ok(finishedUpdate);
    assert.strictEqual(finishedUpdate.isFinished, true);
    assert.strictEqual(finishedUpdate.downloadedBytes, payload.length);
  } finally {
    await missingRangeServer.close();
  }

  // Server returns 206 with mismatched start byte
  const mismatchedRangeServer = await createTestServer((_req, res) => {
    res.writeHead(206, {
      'Content-Type': 'application/octet-stream',
      'Content-Range': 'bytes 0-10/100', // Mismatched: requested offset was 50!
    });
    res.end(payload);
  });

  try {
    const item: DownloadItem = {
      id: 'test-mismatched-cr',
      url: `${mismatchedRangeServer.url}/data.bin`,
      filename: 'data.bin',
      directory: '.nova_data/test_downloads',
      totalBytes: payload.length,
      downloadedBytes: 50, // Requested range bytes=50-
      status: 'downloading',
      category: 'documents',
      protocol: 'http',
      supportsRange: true,
      segmentsCount: 1,
      segments: [],
      dateAdded: Date.now(),
      priority: 'normal',
      speed: 0,
    };

    let finishedUpdate: any = null;
    await startRealDownload(item, (update) => {
      if (update.isFinished || update.error) {
        finishedUpdate = update;
      }
    });

    assert.ok(finishedUpdate);
    assert.strictEqual(finishedUpdate.isFinished, true);
    assert.strictEqual(finishedUpdate.downloadedBytes, payload.length);
  } finally {
    await mismatchedRangeServer.close();
  }
});

test('Integration: Server that disconnects mid-transfer fails gracefully without reporting completed', async () => {
  const serverInfo = await createTestServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '10000',
    });
    res.write(Buffer.from('Partial data chunk before sudden connection termination...'));
    // Abruptly destroy socket
    res.socket?.destroy();
  });

  try {
    const item: DownloadItem = {
      id: 'test-disconnect',
      url: `${serverInfo.url}/abort.bin`,
      filename: 'abort.bin',
      directory: '.nova_data/test_downloads',
      totalBytes: 10000,
      downloadedBytes: 0,
      status: 'downloading',
      category: 'documents',
      protocol: 'http',
      supportsRange: false,
      segmentsCount: 1,
      segments: [],
      dateAdded: Date.now(),
      priority: 'normal',
      speed: 0,
    };

    let progressUpdate: any = null;
    await startRealDownload(item, (update) => {
      if (update.error || update.isFinished) {
        progressUpdate = update;
      }
    });

    assert.ok(progressUpdate, 'Must receive terminal update');
    assert.strictEqual(progressUpdate.isFinished, false, 'Must NOT report finished when socket disconnected mid-transfer');
    assert.ok(progressUpdate.error, 'Must report an error on abrupt connection disconnect');
  } finally {
    await serverInfo.close();
  }
});

test('Integration: Server that returns fewer bytes than expected is rejected as premature disconnect', async () => {
  const shortPayload = Buffer.from('SHORT_PAYLOAD_ONLY_50_BYTES_HERE_1234567890123456');

  const serverInfo = await createTestServer((_req, res) => {
    // Advertise 5000 bytes via Content-Length, but send only 50 bytes and cleanly end
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '5000',
    });
    res.end(shortPayload);
  });

  try {
    const item: DownloadItem = {
      id: 'test-truncated',
      url: `${serverInfo.url}/short.bin`,
      filename: 'short.bin',
      directory: '.nova_data/test_downloads',
      totalBytes: 5000, // Expected 5000 bytes
      downloadedBytes: 0,
      status: 'downloading',
      category: 'documents',
      protocol: 'http',
      supportsRange: false,
      segmentsCount: 1,
      segments: [],
      dateAdded: Date.now(),
      priority: 'normal',
      speed: 0,
    };

    let terminalUpdate: any = null;
    await startRealDownload(item, (update) => {
      if (update.error || update.isFinished) {
        terminalUpdate = update;
      }
    });

    assert.ok(terminalUpdate, 'Must receive progress callback update');
    assert.strictEqual(terminalUpdate.isFinished, false, 'Must NOT report completed when received bytes are fewer than totalBytes');
    assert.ok(terminalUpdate.error, 'Must report error for truncated download');
    assert.ok(
      terminalUpdate.error.includes('Premature disconnect') ||
      terminalUpdate.error.includes('received') ||
      terminalUpdate.error.includes('terminated') ||
      terminalUpdate.error.includes('fetch failed'),
      `Unexpected error message: ${terminalUpdate.error}`
    );
  } finally {
    await serverInfo.close();
  }
});
