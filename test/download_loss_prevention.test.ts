/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';

// Mock Chrome Extension API simulation environment
function createMockChromeEnvironment() {
  let cancelledIds: number[] = [];
  let erasedIds: number[] = [];
  let nativeMessagesSent: any[] = [];
  let nativeResponseConfig: {
    lastError?: { message: string };
    response?: any;
  } = {};

  const mockStorage: Record<string, any> = {
    autoIntercept: true,
    handoffVerified: true,
    excludedDomains: ['internal.local', 'bank.com'],
  };

  const chromeMock = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          if (typeof keys === 'string') {
            return { [keys]: mockStorage[keys] };
          }
          const res: Record<string, any> = {};
          for (const k of keys) {
            res[k] = mockStorage[k];
          }
          return res;
        },
      },
    },
    runtime: {
      lastError: undefined as { message: string } | undefined,
      sendNativeMessage: (hostName: string, message: any, callback: (resp: any) => void) => {
        nativeMessagesSent.push({ hostName, message });
        chromeMock.runtime.lastError = nativeResponseConfig.lastError;
        setTimeout(() => {
          callback(nativeResponseConfig.response);
        }, 1);
      },
    },
    downloads: {
      cancel: (id: number, callback?: () => void) => {
        cancelledIds.push(id);
        if (callback) callback();
      },
      erase: (query: { id: number }) => {
        erasedIds.push(query.id);
      },
    },
  };

  return {
    chromeMock,
    getCancelledIds: () => cancelledIds,
    getErasedIds: () => erasedIds,
    getNativeMessagesSent: () => nativeMessagesSent,
    setNativeResponse: (config: { lastError?: { message: string }; response?: any }) => {
      nativeResponseConfig = config;
    },
    reset: () => {
      cancelledIds = [];
      erasedIds = [];
      nativeMessagesSent = [];
      chromeMock.runtime.lastError = undefined;
    },
  };
}

// Handshake processor mirroring background.js logic
async function processDownloadItem(downloadItem: any, env: any, recentCache: Map<string, number>): Promise<boolean> {
  const { chromeMock } = env;
  const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'ftps:', 'sftp:']);
  const DUP_TIMEOUT_MS = 10000;

  const { autoIntercept, handoffVerified } = await chromeMock.storage.local.get(['autoIntercept', 'handoffVerified']);
  if (autoIntercept !== true || handoffVerified !== true) return false;

  const url = downloadItem.url;
  if (!url) return false;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
    return false;
  }

  const { excludedDomains } = await chromeMock.storage.local.get('excludedDomains');
  if (excludedDomains && excludedDomains.some((d: string) => parsedUrl.hostname.includes(d))) {
    return false;
  }

  const now = Date.now();
  if (recentCache.has(url)) {
    const prev = recentCache.get(url)!;
    if (now - prev < DUP_TIMEOUT_MS) {
      return false;
    }
  }

  recentCache.set(url, now);

  return new Promise((resolve) => {
    chromeMock.runtime.sendNativeMessage(
      'com.nova.downloadmanager',
      {
        action: 'can_handle',
        url: downloadItem.url,
        filename: downloadItem.filename,
        client: 'chromium-extension',
      },
      (response: any) => {
        if (chromeMock.runtime.lastError) {
          // Native host unavailable: PRESERVE BROWSER DOWNLOAD
          resolve(false);
          return;
        }

        if (response && (response.accepted === true || response.status === 'accepted')) {
          chromeMock.downloads.cancel(downloadItem.id, () => {
            chromeMock.downloads.erase({ id: downloadItem.id });
            resolve(true);
          });
        } else {
          // Host rejected or declined: PRESERVE BROWSER DOWNLOAD
          resolve(false);
        }
      }
    );
  });
}

test('Download Loss Prevention: Host offline / lastError leaves browser download untouched', async () => {
  const env = createMockChromeEnvironment();
  const cache = new Map<string, number>();

  // Configure native host to be offline
  env.setNativeResponse({
    lastError: { message: 'Specified native messaging host not found.' },
  });

  const downloadItem = {
    id: 101,
    url: 'https://example.com/important_document.pdf',
    filename: 'important_document.pdf',
    totalBytes: 5242880,
  };

  const handoffAccepted = await processDownloadItem(downloadItem, env, cache);

  assert.strictEqual(handoffAccepted, false, 'Handoff must report not accepted');
  assert.strictEqual(env.getCancelledIds().length, 0, 'Browser download must NEVER be cancelled when host is offline');
  assert.strictEqual(env.getErasedIds().length, 0, 'Browser download must NEVER be erased when host is offline');
  assert.strictEqual(env.getNativeMessagesSent().length, 1, 'Native message must be sent to check host');
});

test('Download Loss Prevention: Host rejection leaves browser download untouched', async () => {
  const env = createMockChromeEnvironment();
  const cache = new Map<string, number>();

  // Host is running but declines (e.g. disk full, queue paused)
  env.setNativeResponse({
    response: {
      status: 'rejected',
      accepted: false,
      reason: 'Insufficient disk storage for download',
    },
  });

  const downloadItem = {
    id: 102,
    url: 'https://example.com/big_iso.iso',
    filename: 'big_iso.iso',
    totalBytes: 8000000000,
  };

  const handoffAccepted = await processDownloadItem(downloadItem, env, cache);

  assert.strictEqual(handoffAccepted, false);
  assert.strictEqual(env.getCancelledIds().length, 0, 'Browser download must NOT be cancelled on host rejection');
});

test('Download Loss Prevention: Host acceptance cleanly cancels browser download after confirmation', async () => {
  const env = createMockChromeEnvironment();
  const cache = new Map<string, number>();

  // Host confirms acceptance
  env.setNativeResponse({
    response: {
      status: 'accepted',
      accepted: true,
      download_id: 'dl-test-7788',
    },
  });

  const downloadItem = {
    id: 103,
    url: 'https://example.com/installer.exe',
    filename: 'installer.exe',
    totalBytes: 45000000,
  };

  const handoffAccepted = await processDownloadItem(downloadItem, env, cache);

  assert.strictEqual(handoffAccepted, true);
  assert.deepStrictEqual(env.getCancelledIds(), [103], 'Browser download must be cancelled ONLY after host accepts');
  assert.deepStrictEqual(env.getErasedIds(), [103], 'Browser download must be erased from download shelf');
});

test('Download Loss Prevention: Prohibited / Internal protocols are ignored', async () => {
  const env = createMockChromeEnvironment();
  const cache = new Map<string, number>();

  env.setNativeResponse({ response: { accepted: true } });

  const prohibitedUrls = [
    'blob:https://example.com/abc-123',
    'data:image/png;base64,iVBORw0KGgo...',
    'chrome://settings/downloads',
    'edge://extensions',
    'file:///C:/Users/Admin/Secret.txt',
    'javascript:void(0)',
  ];

  for (const pUrl of prohibitedUrls) {
    const item = { id: 200, url: pUrl, filename: 'item' };
    const accepted = await processDownloadItem(item, env, cache);
    assert.strictEqual(accepted, false, `Must reject prohibited protocol: ${pUrl}`);
  }

  assert.strictEqual(env.getCancelledIds().length, 0);
  assert.strictEqual(env.getNativeMessagesSent().length, 0);
});

test('Download Loss Prevention: Excluded domains are not intercepted', async () => {
  const env = createMockChromeEnvironment();
  const cache = new Map<string, number>();

  const item = {
    id: 301,
    url: 'https://bank.com/statements/march.pdf',
    filename: 'march.pdf',
  };

  const accepted = await processDownloadItem(item, env, cache);
  assert.strictEqual(accepted, false, 'Must not intercept excluded domain');
  assert.strictEqual(env.getCancelledIds().length, 0);
});

test('Download Loss Prevention: Automatic interception is disabled by default until handoff is verified', async () => {
  const env = createMockChromeEnvironment();
  const cache = new Map<string, number>();

  // Simulate default browser state where user hasn't explicitly opted in or verified handoff
  const unverifiedEnv = {
    ...env,
    chromeMock: {
      ...env.chromeMock,
      storage: {
        local: {
          get: async () => ({ autoIntercept: false, handoffVerified: false }),
        },
      },
    },
  };

  const item = {
    id: 401,
    url: 'https://example.com/standard-download.zip',
    filename: 'standard-download.zip',
  };

  const accepted = await processDownloadItem(item, unverifiedEnv, cache);
  assert.strictEqual(accepted, false, 'Must not intercept when autoIntercept/handoffVerified is false');
  assert.strictEqual(env.getCancelledIds().length, 0, 'Browser download must remain completely untouched');
  assert.strictEqual(env.getNativeMessagesSent().length, 0, 'No native messaging calls when disabled');
});

