/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { generateSegments } from '../src/services/downloadEngine.ts';

// Helper to simulate segmented download validator
interface RangeValidationResult {
  accepted: boolean;
  shouldFallbackToSingleStream: boolean;
  restartFromZero: boolean;
  error?: string;
}

function validateSegmentResponse(params: {
  status: number;
  isRangeRequested: boolean;
  requestedStart: number;
  requestedEnd: number;
  contentRangeHeader?: string | null;
  etagHeader?: string | null;
  expectedEtag?: string | null;
}): RangeValidationResult {
  const {
    status,
    isRangeRequested,
    requestedStart,
    requestedEnd,
    contentRangeHeader,
    etagHeader,
    expectedEtag,
  } = params;

  // 1. If Range was requested, server returning 200 means NO Range support
  if (isRangeRequested && status === 200) {
    return {
      accepted: true,
      shouldFallbackToSingleStream: true,
      restartFromZero: true,
    };
  }

  // 2. If Range was requested, status must be 206 Partial Content
  if (isRangeRequested && status !== 206) {
    return {
      accepted: false,
      shouldFallbackToSingleStream: false,
      restartFromZero: false,
      error: `Expected HTTP 206 Partial Content for byte range, got HTTP ${status}`,
    };
  }

  // 3. Validate Content-Range header when 206 is returned
  if (isRangeRequested && status === 206) {
    if (!contentRangeHeader) {
      return {
        accepted: false,
        shouldFallbackToSingleStream: true,
        restartFromZero: true,
        error: 'Missing Content-Range header in HTTP 206 response',
      };
    }

    const match = contentRangeHeader.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
    if (!match) {
      return {
        accepted: false,
        shouldFallbackToSingleStream: true,
        restartFromZero: true,
        error: `Malformed Content-Range header: ${contentRangeHeader}`,
      };
    }

    const serverStart = parseInt(match[1], 10);
    const serverEnd = parseInt(match[2], 10);

    if (serverStart !== requestedStart) {
      return {
        accepted: false,
        shouldFallbackToSingleStream: true,
        restartFromZero: true,
        error: `Content-Range start byte mismatch: expected ${requestedStart}, got ${serverStart}`,
      };
    }
  }

  // 4. ETag consistency check
  if (expectedEtag && etagHeader && expectedEtag !== etagHeader) {
    return {
      accepted: false,
      shouldFallbackToSingleStream: true,
      restartFromZero: true,
      error: `ETag mismatch: remote file modified (${expectedEtag} !== ${etagHeader})`,
    };
  }

  return {
    accepted: true,
    shouldFallbackToSingleStream: false,
    restartFromZero: false,
  };
}

test('Segmented Download: Valid HTTP 206 with correct Content-Range is accepted', () => {
  const result = validateSegmentResponse({
    status: 206,
    isRangeRequested: true,
    requestedStart: 1024,
    requestedEnd: 2047,
    contentRangeHeader: 'bytes 1024-2047/50000',
    etagHeader: '"hash-abc"',
    expectedEtag: '"hash-abc"',
  });

  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.shouldFallbackToSingleStream, false);
  assert.strictEqual(result.restartFromZero, false);
});

test('Segmented Download: Server returning HTTP 200 triggers single-stream fallback from byte 0', () => {
  const result = validateSegmentResponse({
    status: 200,
    isRangeRequested: true,
    requestedStart: 5000,
    requestedEnd: 9999,
  });

  assert.strictEqual(result.accepted, true);
  assert.strictEqual(result.shouldFallbackToSingleStream, true);
  assert.strictEqual(result.restartFromZero, true, 'Must restart from byte 0 to avoid partial slice corruption');
});

test('Segmented Download: Mismatched Content-Range start byte is rejected', () => {
  const result = validateSegmentResponse({
    status: 206,
    isRangeRequested: true,
    requestedStart: 5000,
    requestedEnd: 9999,
    contentRangeHeader: 'bytes 0-4999/50000', // Server returned wrong slice!
  });

  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.restartFromZero, true);
  assert.ok(result.error?.includes('start byte mismatch'));
});

test('Segmented Download: Remote file modification mid-transfer (ETag mismatch) triggers clean restart', () => {
  const result = validateSegmentResponse({
    status: 206,
    isRangeRequested: true,
    requestedStart: 1000,
    requestedEnd: 1999,
    contentRangeHeader: 'bytes 1000-1999/50000',
    etagHeader: '"file-version-2"',
    expectedEtag: '"file-version-1"',
  });

  assert.strictEqual(result.accepted, false);
  assert.strictEqual(result.restartFromZero, true);
  assert.ok(result.error?.includes('ETag mismatch'));
});

test('Segment Generation: Strict non-overlapping byte bounds across thread counts', () => {
  const fileSizes = [1000, 1048576, 5974000000];
  const threadCounts = [1, 2, 4, 8, 16, 32];

  for (const size of fileSizes) {
    for (const count of threadCounts) {
      const segments = generateSegments(size, count);
      assert.strictEqual(segments.length, count);

      // Verify segment 0 starts at 0
      assert.strictEqual(segments[0].startByte, 0);

      // Verify last segment ends at size - 1
      assert.strictEqual(segments[segments.length - 1].endByte, size - 1);

      // Verify no gaps and no overlapping bytes between consecutive segments
      for (let i = 0; i < segments.length - 1; i++) {
        assert.strictEqual(
          segments[i].endByte + 1,
          segments[i + 1].startByte,
          `Gap or overlap detected between segment ${i} and ${i + 1} for size ${size} count ${count}`
        );
      }

      // Sum of capacities must exactly equal total file size
      const totalSpan = segments.reduce((acc, s) => acc + (s.endByte - s.startByte + 1), 0);
      assert.strictEqual(totalSpan, size);
    }
  }
});

test('Integrity Verification: SHA-256 verification of assembled segments', () => {
  const testPayload = Buffer.from('NOVA-Download-Manager-Segmented-Verification-Test-Payload-123456');
  const expectedHash = crypto.createHash('sha256').update(testPayload).digest('hex');

  // Split into 4 chunks
  const chunkSize = Math.floor(testPayload.length / 4);
  const chunks: Buffer[] = [];
  for (let i = 0; i < 4; i++) {
    const start = i * chunkSize;
    const end = i === 3 ? testPayload.length : (i + 1) * chunkSize;
    chunks.push(testPayload.subarray(start, end));
  }

  // Reassemble
  const assembled = Buffer.concat(chunks);
  const calculatedHash = crypto.createHash('sha256').update(assembled).digest('hex');

  assert.strictEqual(calculatedHash, expectedHash);
});
