/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { parseFtpUrl, detectProtocol } from '../src/services/protocolParser.ts';
import { probeUrl } from '../src/services/downloadEngine.ts';

// Mirror Rust path sanitization function to test Windows path constraints
function validateAndSanitizePath(inputPath: string): { valid: boolean; error?: string } {
  if (inputPath.includes('..')) {
    return { valid: false, error: "Security error: Path traversal sequence ('..') detected" };
  }

  if (inputPath.includes('\0')) {
    return { valid: false, error: 'Security error: Null byte in path is prohibited' };
  }

  const parts = inputPath.replace(/\\/g, '/').split('/');
  const filename = parts[parts.length - 1];
  const stem = filename.split('.')[0].toLowerCase();

  const reserved = [
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
  ];

  if (reserved.includes(stem)) {
    return { valid: false, error: `Security error: '${filename}' is a Windows reserved device name` };
  }

  return { valid: true };
}

// Mirror credential masking function
function maskUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '********';
      return parsed.toString();
    }
  } catch {
    // Malformed
  }
  return url;
}

test('Protocols: FTP URL Parser extracts host, port, credentials, and paths', () => {
  const url = 'ftp://admin:secretPass123@files.company.com:2121/backups/db_backup.sql.gz';
  const parsed = parseFtpUrl(url);

  assert.strictEqual(parsed.host, 'files.company.com');
  assert.strictEqual(parsed.port, 2121);
  assert.strictEqual(parsed.username, 'admin');
  assert.strictEqual(parsed.password, 'secretPass123');
  assert.strictEqual(parsed.filename, 'db_backup.sql.gz');
  assert.strictEqual(parsed.isAnonymous, false);
});

test('Protocols: SFTP URL Parser uses default port 22 when unspecified', () => {
  const url = 'sftp://deployer:sshKeyPass@server.internal/srv/release.tar.xz';
  const parsed = parseFtpUrl(url);

  assert.strictEqual(parsed.host, 'server.internal');
  assert.strictEqual(parsed.port, 22);
  assert.strictEqual(parsed.username, 'deployer');
  assert.strictEqual(parsed.filename, 'release.tar.xz');
});

test('Security & Privacy: Password redaction in URLs', () => {
  const rawUrl = 'ftp://administrator:superSecretP@ssw0rd!@192.168.1.100:21/archive.zip';
  const masked = maskUrlCredentials(rawUrl);

  assert.ok(!masked.includes('superSecretP@ssw0rd!'), 'Plaintext password must never be exposed');
  assert.ok(masked.includes('********'), 'Password must be masked with asterisks');
  assert.ok(masked.includes('administrator'), 'Username remains visible');
  assert.ok(masked.includes('192.168.1.100'), 'Host remains visible');
});

test('Protocol Probe: Does NOT invent fake sizes for FTP/SFTP when size is unknown', async () => {
  const result = await probeUrl('ftp://ftp.gnu.org/gnu/emacs/emacs-29.4.tar.gz');

  // Verify that probeUrl does NOT return hardcoded 100MB or 250MB
  assert.notStrictEqual(result.totalBytes, 250 * 1024 * 1024, 'Must not invent fake 250MB size');
  assert.notStrictEqual(result.totalBytes, 100 * 1024 * 1024, 'Must not invent fake 100MB size');
  assert.strictEqual(result.totalBytes, 0, 'Unknown sizes must be reported as 0');
  assert.strictEqual(result.supportsRange, false, 'Must not claim Range support until server confirms');
});

test('Security: Directory traversal and Windows reserved filenames blocked', () => {
  // Directory traversal attacks
  assert.strictEqual(validateAndSanitizePath('C:\\Downloads\\..\\Windows\\System32\\cmd.exe').valid, false);
  assert.strictEqual(validateAndSanitizePath('/var/downloads/../../etc/passwd').valid, false);

  // Null byte attacks
  assert.strictEqual(validateAndSanitizePath('C:\\Downloads\\file.txt\0.exe').valid, false);

  // Windows reserved device names
  const reservedNames = ['CON.txt', 'PRN.pdf', 'AUX.dat', 'NUL', 'COM1.bin', 'LPT1.iso'];
  for (const name of reservedNames) {
    const res = validateAndSanitizePath(`C:\\Downloads\\${name}`);
    assert.strictEqual(res.valid, false, `Must reject Windows reserved name: ${name}`);
  }

  // Valid paths
  assert.strictEqual(validateAndSanitizePath('C:\\Users\\User\\Downloads\\NOVA\\ubuntu.iso').valid, true);
  assert.strictEqual(validateAndSanitizePath('D:\\Data\\Project_2025.zip').valid, true);
});

test('Security: Browser filename sanitization strips traversal, prefixes reserved names, and prevents collisions', async () => {
  const { sanitizeFilename, resolveNonCollidingPath } = await import('../src/utils/fileSanitizer.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Traversal and absolute path stripping
  assert.strictEqual(sanitizeFilename('../../Windows/System32/cmd.exe'), 'cmd.exe');
  assert.strictEqual(sanitizeFilename('C:\\Windows\\explorer.exe'), 'explorer.exe');
  assert.strictEqual(sanitizeFilename('/etc/shadow'), 'shadow');

  // Reserved Windows device names
  assert.strictEqual(sanitizeFilename('CON.txt'), 'nova_CON.txt');
  assert.strictEqual(sanitizeFilename('aux.bin'), 'nova_aux.bin');
  assert.strictEqual(sanitizeFilename('NUL'), 'nova_NUL');

  // Illegal characters
  assert.strictEqual(sanitizeFilename('my<strange>?file*name:.pdf'), 'my_strange__file_name_.pdf');

  // Collision prevention
  const tempDir = path.resolve('.nova_data/test_collision');
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    const file1 = path.join(tempDir, 'sample.txt');
    fs.writeFileSync(file1, 'hello');

    const res = resolveNonCollidingPath(tempDir, 'sample.txt');
    assert.strictEqual(res.cleanFilename, 'sample (1).txt');

    const file2 = path.join(tempDir, 'sample (1).txt');
    fs.writeFileSync(file2, 'world');

    const res2 = resolveNonCollidingPath(tempDir, 'sample.txt');
    assert.strictEqual(res2.cleanFilename, 'sample (2).txt');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('DRM Boundary Enforcement: FairPlay and Widevine manifests flagged with DRM warnings', async () => {
  const widevineMpd = `<?xml version="1.0"?>
  <MPD xmlns="urn:mpeg:dash:schema:mpd:2011" minBufferTime="PT1.5S">
    <Period>
      <AdaptationSet mimeType="video/mp4">
        <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
        <Representation id="v1" bandwidth="4000000" width="1920" height="1080"/>
      </AdaptationSet>
    </Period>
  </MPD>`;

  const { parseDashManifest } = await import('../src/services/protocolParser.ts');
  const dashInfo = parseDashManifest(widevineMpd, 'https://example.com/manifest.mpd');

  assert.strictEqual(dashInfo.hasDrm, true, 'Must detect Widevine DRM');
  assert.strictEqual(dashInfo.drmType?.toLowerCase(), 'widevine');
  assert.ok(dashInfo.drmMessage?.includes('Protected media') || dashInfo.drmMessage?.includes('Widevine'), 'Must provide clear warning without bypassing DRM');
});
