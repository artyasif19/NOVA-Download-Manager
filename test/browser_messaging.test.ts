/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

test('Browser Extension: Manifest V3 Schema & Permissions Validation', () => {
  const manifestPath = path.resolve('extension/chrome/manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'extension/chrome/manifest.json must exist');

  const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(content.manifest_version, 3, 'Must be Manifest V3');
  assert.strictEqual(content.name, 'NOVA Download Manager Integration');
  assert.ok(content.permissions.includes('downloads'), 'Must have downloads permission for interception');
  assert.ok(content.permissions.includes('contextMenus'), 'Must have contextMenus permission');
  assert.ok(content.permissions.includes('nativeMessaging'), 'Must have nativeMessaging permission');
  assert.ok(content.key, 'Must declare deterministic public key for stable extension ID');
  assert.ok(content.background.service_worker, 'Must declare service_worker for MV3 background');
  assert.ok(content.content_scripts.length > 0, 'Must declare content_scripts for video grabber');
});

test('Native Messaging Host Manifest Schema & Windows Registry verification', () => {
  const hostManifestPath = path.resolve('extension/com.nova.downloadmanager.json');
  assert.ok(fs.existsSync(hostManifestPath), 'Host manifest JSON must exist');

  const hostJson = JSON.parse(fs.readFileSync(hostManifestPath, 'utf-8'));
  assert.strictEqual(hostJson.name, 'com.nova.downloadmanager');
  assert.strictEqual(hostJson.type, 'stdio');
  assert.ok(hostJson.allowed_origins.includes('chrome-extension://pmkbechehklelnopohiefbcafghkjjil/'), 'Must match deterministic extension ID origin');

  const regPath = path.resolve('extension/windows_install_host.reg');
  assert.ok(fs.existsSync(regPath), 'windows_install_host.reg must exist');
  const regContent = fs.readFileSync(regPath, 'utf-8');
  assert.ok(regContent.includes('Google\\Chrome\\NativeMessagingHosts'), 'Must register for Chrome');
  assert.ok(regContent.includes('Microsoft\\Edge\\NativeMessagingHosts'), 'Must register for Edge');
  assert.ok(regContent.includes('BraveSoftware\\Brave-Browser\\NativeMessagingHosts'), 'Must register for Brave');
});

test('Native Messaging 32-bit Native Length Framing Buffer Math', () => {
  const payload = { action: 'ping', client: 'test' };
  const jsonStr = JSON.stringify(payload);
  const payloadBytes = Buffer.from(jsonStr, 'utf-8');

  // Pack 32-bit length header
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payloadBytes.length, 0);

  const fullPacket = Buffer.concat([header, payloadBytes]);
  assert.strictEqual(fullPacket.length, 4 + payloadBytes.length);

  // Unpack
  const readLen = fullPacket.readUInt32LE(0);
  assert.strictEqual(readLen, payloadBytes.length);
  const readJson = JSON.parse(fullPacket.subarray(4, 4 + readLen).toString('utf-8'));
  assert.deepStrictEqual(readJson, payload);
});
