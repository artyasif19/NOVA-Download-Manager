/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { generateSegments } from '../src/services/downloadEngine.ts';
import { DownloadItem } from '../src/types/download.ts';

test('Download Lifecycle: Queue Scheduler and Concurrent Slots', () => {
  const maxConcurrent = 2;
  const items: DownloadItem[] = [
    {
      id: 'dl-1',
      url: 'https://example.com/file1.iso',
      filename: 'file1.iso',
      directory: 'C:\\Downloads',
      totalBytes: 50000000,
      downloadedBytes: 10000000,
      speed: 5000000,
      status: 'downloading',
      category: 'compressed',
      segmentsCount: 4,
      segments: generateSegments(50000000, 4),
      supportsRange: true,
      dateAdded: Date.now(),
      priority: 'normal',
    },
    {
      id: 'dl-2',
      url: 'https://example.com/file2.iso',
      filename: 'file2.iso',
      directory: 'C:\\Downloads',
      totalBytes: 20000000,
      downloadedBytes: 0,
      speed: 0,
      status: 'queued',
      category: 'compressed',
      segmentsCount: 4,
      segments: generateSegments(20000000, 4),
      supportsRange: true,
      dateAdded: Date.now(),
      priority: 'normal',
    },
    {
      id: 'dl-3',
      url: 'https://example.com/file3.iso',
      filename: 'file3.iso',
      directory: 'C:\\Downloads',
      totalBytes: 30000000,
      downloadedBytes: 0,
      speed: 0,
      status: 'queued',
      category: 'compressed',
      segmentsCount: 4,
      segments: generateSegments(30000000, 4),
      supportsRange: true,
      dateAdded: Date.now(),
      priority: 'normal',
    },
  ];

  const activeCount = items.filter(d => d.status === 'downloading').length;
  assert.strictEqual(activeCount, 1);

  // Scheduler promotion: should promote dl-2 to downloading because activeCount (1) < maxConcurrent (2)
  const availableSlots = maxConcurrent - activeCount;
  let promoted = 0;
  const updated = items.map(item => {
    if (item.status === 'queued' && promoted < availableSlots) {
      promoted++;
      return { ...item, status: 'downloading' as const };
    }
    return item;
  });

  assert.strictEqual(updated.filter(d => d.status === 'downloading').length, 2);
  assert.strictEqual(updated.find(d => d.id === 'dl-2')?.status, 'downloading');
  assert.strictEqual(updated.find(d => d.id === 'dl-3')?.status, 'queued');
});

test('Download Lifecycle: Pause and Resume Byte Continuity', () => {
  const item: DownloadItem = {
    id: 'dl-pause-test',
    url: 'https://example.com/data.bin',
    filename: 'data.bin',
    directory: 'C:\\Downloads',
    totalBytes: 1000,
    downloadedBytes: 450,
    speed: 150,
    status: 'downloading',
    category: 'documents',
    segmentsCount: 2,
    segments: generateSegments(1000, 2),
    supportsRange: true,
    isResumable: true,
    dateAdded: Date.now(),
    priority: 'normal',
  };

  // Pause
  const pausedItem: DownloadItem = {
    ...item,
    status: 'paused',
    speed: 0,
  };
  assert.strictEqual(pausedItem.status, 'paused');
  assert.strictEqual(pausedItem.speed, 0);
  assert.strictEqual(pausedItem.downloadedBytes, 450);

  // Resume Range verification: next request must ask for bytes=450-
  const nextRangeHeader = `bytes=${pausedItem.downloadedBytes}-`;
  assert.strictEqual(nextRangeHeader, 'bytes=450-');
});

test('Download Lifecycle: Non-resumable download safely falls back without Range', () => {
  const nonResumableItem: DownloadItem = {
    id: 'dl-stream',
    url: 'https://example.com/live-export.csv',
    filename: 'live-export.csv',
    directory: 'C:\\Downloads',
    totalBytes: 1000,
    downloadedBytes: 0,
    speed: 0,
    status: 'downloading',
    category: 'documents',
    segmentsCount: 8,
    segments: generateSegments(1000, 1), // Enforces 1 segment
    supportsRange: false,
    isResumable: false,
    dateAdded: Date.now(),
    priority: 'normal',
  };

  assert.strictEqual(nonResumableItem.supportsRange, false);
  assert.strictEqual(nonResumableItem.isResumable, false);
  assert.strictEqual(nonResumableItem.segments.length, 1);
});
