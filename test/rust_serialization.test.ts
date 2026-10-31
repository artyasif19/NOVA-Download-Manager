import { test } from 'node:test';
import assert from 'node:assert';
import { mapDownloadItemToRustRequest, buildDestinationPath } from '../src/services/tauriAdapter';
import { DownloadItem } from '../src/types/download';

test('Rust Request Serialization: buildDestinationPath handles directory separators', () => {
  // Windows paths with backslashes
  const winPath = buildDestinationPath('C:\\Downloads\\NOVA', 'installer.exe');
  assert.strictEqual(winPath, 'C:\\Downloads\\NOVA\\installer.exe');

  // Trailing backslash
  const winTrailing = buildDestinationPath('C:\\Downloads\\NOVA\\', 'installer.exe');
  assert.strictEqual(winTrailing, 'C:\\Downloads\\NOVA\\installer.exe');

  // POSIX paths
  const posixPath = buildDestinationPath('/home/user/downloads', 'archive.tar.gz');
  assert.strictEqual(posixPath, '/home/user/downloads/archive.tar.gz');

  // Empty directory fallback
  const emptyDir = buildDestinationPath('', 'file.dat');
  assert.strictEqual(emptyDir, 'file.dat');
});

test('Rust Request Serialization: maps camelCase DownloadItem to exact snake_case Rust DownloadRequest', () => {
  const item: DownloadItem = {
    id: 'dl-test-1234',
    url: 'https://cdn.example.com/software/setup.exe',
    filename: 'setup.exe',
    directory: 'D:\\Downloads',
    totalBytes: 52428800, // 50 MB
    downloadedBytes: 10485760, // 10 MB
    speed: 1048576,
    status: 'downloading',
    category: 'applications',
    segmentsCount: 16,
    segments: [],
    supportsRange: true,
    etag: '"abc-12345"',
    mimeType: 'application/octet-stream',
    dateAdded: 1714464000000,
    dateFinished: undefined,
    sha256Expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    sha256Calculated: undefined,
    priority: 'high',
    credentials: {
      username: 'testuser',
      password: 'supersecretpassword',
    },
    headers: {
      'User-Agent': 'CustomUA/1.0',
      'X-API-Key': 'key-98765',
    },
    cookies: 'session=xyz123; tracking=no',
  };

  const rustPayload = mapDownloadItemToRustRequest(item);

  // Exact property names and values expected by Rust DownloadRequest
  assert.strictEqual(rustPayload.id, 'dl-test-1234');
  assert.strictEqual(rustPayload.url, 'https://cdn.example.com/software/setup.exe');
  assert.strictEqual(rustPayload.destination_path, 'D:\\Downloads\\setup.exe');
  assert.strictEqual(rustPayload.total_bytes, 52428800);
  assert.strictEqual(rustPayload.segments_count, 16);
  assert.strictEqual(rustPayload.expected_sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.deepStrictEqual(rustPayload.headers, {
    'User-Agent': 'CustomUA/1.0',
    'X-API-Key': 'key-98765',
  });
  assert.strictEqual(rustPayload.cookies, 'session=xyz123; tracking=no');
  assert.strictEqual(rustPayload.username, 'testuser');
  assert.strictEqual(rustPayload.password, 'supersecretpassword');

  // Verify that frontend camelCase keys are NOT passed in place of snake_case
  assert.strictEqual((rustPayload as any).destinationPath, undefined);
  assert.strictEqual((rustPayload as any).totalBytes, undefined);
  assert.strictEqual((rustPayload as any).segmentsCount, undefined);
  assert.strictEqual((rustPayload as any).expectedSha256, undefined);
});

test('Rust Request Serialization: null defaults for optional fields', () => {
  const minimalItem: DownloadItem = {
    id: 'dl-min-001',
    url: 'https://example.com/data.bin',
    filename: 'data.bin',
    directory: 'C:\\Users\\User\\Downloads',
    totalBytes: 0,
    downloadedBytes: 0,
    speed: 0,
    status: 'queued',
    category: 'documents',
    segmentsCount: 8,
    segments: [],
    supportsRange: true,
    dateAdded: Date.now(),
    priority: 'normal',
  };

  const rustPayload = mapDownloadItemToRustRequest(minimalItem);

  assert.strictEqual(rustPayload.id, 'dl-min-001');
  assert.strictEqual(rustPayload.destination_path, 'C:\\Users\\User\\Downloads\\data.bin');
  assert.strictEqual(rustPayload.total_bytes, 0);
  assert.strictEqual(rustPayload.segments_count, 8);
  assert.strictEqual(rustPayload.expected_sha256, null);
  assert.strictEqual(rustPayload.headers, null);
  assert.strictEqual(rustPayload.cookies, null);
  assert.strictEqual(rustPayload.username, null);
  assert.strictEqual(rustPayload.password, null);
});
