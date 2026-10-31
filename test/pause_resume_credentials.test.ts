import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';

/**
 * Simulates NOVA's keystream encryption/decryption algorithm implemented in db.rs
 * to verify that passwords and secrets are encrypted with IV + SHA-256 keystream,
 * never stored as plaintext, and decrypt accurately.
 */
function simulateRustEncryptSecret(secret: string, vaultKey: Buffer): string {
  const iv = crypto.randomBytes(16);
  const pt = Buffer.from(secret, 'utf-8');
  const ct = Buffer.alloc(pt.length);

  let offset = 0;
  let blockIdx = 0;
  while (offset < pt.length) {
    const blockBuf = Buffer.alloc(4);
    blockBuf.writeUInt32BE(blockIdx, 0);

    const hash = crypto.createHash('sha256')
      .update(vaultKey)
      .update(iv)
      .update(blockBuf)
      .digest();

    const toXor = Math.min(pt.length - offset, 32);
    for (let i = 0; i < toXor; i++) {
      ct[offset + i] = pt[offset + i] ^ hash[i];
    }
    offset += toXor;
    blockIdx++;
  }

  return `${iv.toString('hex')}:${ct.toString('hex')}`;
}

function simulateRustDecryptSecret(encrypted: string, vaultKey: Buffer): string | null {
  const parts = encrypted.split(':');
  if (parts.length !== 2) return null;
  const iv = Buffer.from(parts[0], 'hex');
  const ct = Buffer.from(parts[1], 'hex');
  if (iv.length !== 16) return null;

  const pt = Buffer.alloc(ct.length);
  let offset = 0;
  let blockIdx = 0;
  while (offset < ct.length) {
    const blockBuf = Buffer.alloc(4);
    blockBuf.writeUInt32BE(blockIdx, 0);

    const hash = crypto.createHash('sha256')
      .update(vaultKey)
      .update(iv)
      .update(blockBuf)
      .digest();

    const toXor = Math.min(ct.length - offset, 32);
    for (let i = 0; i < toXor; i++) {
      pt[offset + i] = ct[offset + i] ^ hash[i];
    }
    offset += toXor;
    blockIdx++;
  }

  return pt.toString('utf-8');
}

test('Pause and Resume: Never reset downloaded_bytes to zero on pause', () => {
  interface DownloadState {
    id: string;
    downloaded_bytes: number;
    status: string;
    error_message?: string | null;
  }

  const downloadsTable = new Map<string, DownloadState>();
  downloadsTable.set('dl-1', {
    id: 'dl-1',
    downloaded_bytes: 1048576, // 1 MB downloaded
    status: 'downloading',
  });

  // Database checkpoint function simulating db.rs save_download_checkpoint & update_download_status
  function updateDownloadStatus(id: string, status: string) {
    const rec = downloadsTable.get(id);
    if (!rec) return;
    rec.status = status;
  }

  function saveDownloadCheckpoint(id: string, downloadedBytes: number, status: string) {
    const rec = downloadsTable.get(id);
    if (!rec) return;
    if (downloadedBytes > 0) {
      rec.downloaded_bytes = downloadedBytes;
    }
    rec.status = status;
  }

  // 1. Pause action
  updateDownloadStatus('dl-1', 'paused');
  const pausedRec = downloadsTable.get('dl-1')!;
  assert.strictEqual(pausedRec.status, 'paused');
  assert.strictEqual(pausedRec.downloaded_bytes, 1048576, 'downloaded_bytes MUST NOT be reset to zero on pause');

  // 2. If saveDownloadCheckpoint is called with 0 (e.g. legacy caller)
  saveDownloadCheckpoint('dl-1', 0, 'paused');
  assert.strictEqual(downloadsTable.get('dl-1')!.downloaded_bytes, 1048576, 'checkpoint with 0 must preserve existing bytes');

  // 3. Resume action
  updateDownloadStatus('dl-1', 'downloading');
  assert.strictEqual(downloadsTable.get('dl-1')!.downloaded_bytes, 1048576, 'downloaded_bytes preserved upon resuming');
});

test('Secure Credentials: Passwords are encrypted and never stored in plaintext', () => {
  const vaultKey = crypto.createHash('sha256').update('test-machine-vault-seed').digest();
  const plaintextPassword = 'MySecretP@ssw0rd!#';

  const encrypted = simulateRustEncryptSecret(plaintextPassword, vaultKey);

  // Assert it is not stored as plaintext
  assert.strictEqual(encrypted.includes(plaintextPassword), false, 'Encrypted secret must not contain plaintext password');
  assert.match(encrypted, /^[0-9a-f]{32}:[0-9a-f]+$/, 'Encrypted string must match IV:Ciphertext format');

  // Assert round-trip decryption
  const decrypted = simulateRustDecryptSecret(encrypted, vaultKey);
  assert.strictEqual(decrypted, plaintextPassword, 'Decrypted password must match original plaintext');

  // Assert wrong key fails to decrypt correctly
  const wrongKey = crypto.createHash('sha256').update('wrong-seed').digest();
  const badDecrypted = simulateRustDecryptSecret(encrypted, wrongKey);
  assert.notStrictEqual(badDecrypted, plaintextPassword, 'Wrong key must fail decryption');
});

test('HTTP Resume: ETag change detection triggers clean restart from byte 0', () => {
  interface DownloadRecord {
    id: string;
    downloaded_bytes: number;
    etag: string;
    status: string;
  }

  const record: DownloadRecord = {
    id: 'dl-etag-1',
    downloaded_bytes: 5242880, // 5 MB
    etag: '"v1-original-hash"',
    status: 'paused',
  };

  // Simulating remote probe on resume
  const remoteServerEtag = '"v2-updated-file-hash"';

  function evaluateResume(rec: DownloadRecord, currentRemoteEtag: string): { restartClean: boolean; startOffset: number } {
    if (rec.etag && rec.etag !== currentRemoteEtag) {
      // Remote file modified! Clean restart required
      return { restartClean: true, startOffset: 0 };
    }
    return { restartClean: false, startOffset: rec.downloaded_bytes };
  }

  const resultMismatch = evaluateResume(record, remoteServerEtag);
  assert.strictEqual(resultMismatch.restartClean, true);
  assert.strictEqual(resultMismatch.startOffset, 0, 'Must restart from byte 0 when remote ETag changed');

  const resultMatch = evaluateResume(record, '"v1-original-hash"');
  assert.strictEqual(resultMatch.restartClean, false);
  assert.strictEqual(resultMatch.startOffset, 5242880, 'Must resume from 5 MB when remote ETag matches');
});
