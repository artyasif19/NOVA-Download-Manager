import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * End-to-End Integration Test:
 * Proves that an accepted browser handoff via /api/can_handle:
 * 1. Is durably persisted.
 * 2. Real engine task accepts responsibility.
 * 3. Results in an actual downloaded file on disk with verified byte integrity and SHA-256.
 */

test('E2E Integration: Accepted browser handoff results in actual downloaded file on disk', async () => {
  // 1. Generate 64 KB test binary payload with predictable bytes
  const testPayload = crypto.randomBytes(65536);
  const expectedHash = crypto.createHash('sha256').update(testPayload).digest('hex');

  // Spin up local HTTP server to serve the test payload
  const sourceServer = http.createServer((req, res) => {
    if (req.url === '/test-artifact.bin') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': testPayload.length.toString(),
        'Accept-Ranges': 'bytes',
      });
      res.end(testPayload);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const sourcePort = 9888;
  await new Promise<void>((resolve) => sourceServer.listen(sourcePort, '127.0.0.1', resolve));

  const testDir = path.resolve('.nova_data/e2e_test_downloads');
  fs.mkdirSync(testDir, { recursive: true });

  try {
    const testFilename = `e2e_handoff_test_${Date.now()}.bin`;
    const targetUrl = `http://127.0.0.1:${sourcePort}/test-artifact.bin`;

    // 2. Perform real browser handoff to /api/can_handle
    const handoffPayload = {
      action: 'can_handle',
      url: targetUrl,
      filename: testFilename,
      totalBytes: testPayload.length,
      mimeType: 'application/octet-stream',
      client: 'e2e-test-runner',
      timestamp: Date.now(),
    };

    const res = await fetch('http://127.0.0.1:3000/api/can_handle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(handoffPayload),
    });

    assert.strictEqual(res.status, 200, 'Endpoint should return HTTP 200 OK');
    const decision = await res.json() as {
      status: string;
      accepted: boolean;
      download_id: string;
      filename: string;
      durable: boolean;
    };

    // Verify invariants
    assert.strictEqual(decision.accepted, true, 'Download handoff must be accepted');
    assert.strictEqual(decision.durable, true, 'Download record must be durably stored');
    assert.ok(decision.download_id, 'Download ID must be assigned');

    // 3. Wait for real engine to complete streaming and write actual file to disk
    const maxWaitMs = 8000;
    const startTime = Date.now();
    let isCompleted = false;
    let finalRecord: any = null;

    while (Date.now() - startTime < maxWaitMs) {
      const statusRes = await fetch(`http://127.0.0.1:3000/api/downloads/${decision.download_id}`);
      if (statusRes.ok) {
        const item = await statusRes.json();
        if (item.status === 'completed') {
          isCompleted = true;
          finalRecord = item;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.strictEqual(isCompleted, true, 'Engine must complete the transfer within reasonable time');
    assert.strictEqual(finalRecord.downloadedBytes, testPayload.length, 'Engine must download exact bytes');

    // 4. Verify the actual file on disk
    const destDir = finalRecord.directory || path.resolve('.nova_data/downloads');
    const downloadedFilePath = path.join(destDir, `${decision.download_id}_${testFilename}`);

    assert.ok(fs.existsSync(downloadedFilePath), `Downloaded file must physically exist at ${downloadedFilePath}`);

    const fileContent = fs.readFileSync(downloadedFilePath);
    assert.strictEqual(fileContent.length, testPayload.length, 'File size on disk must match expected byte count');

    const calculatedFileHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    assert.strictEqual(calculatedFileHash, expectedHash, 'Downloaded file on disk must match expected SHA-256');

    // Clean up test file
    fs.unlinkSync(downloadedFilePath);
  } finally {
    sourceServer.close();
    try {
      if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
});
