/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert';
import { 
  detectProtocol, 
  parseFtpUrl, 
  extractContentDispositionFilename, 
  parseHlsManifest, 
  parseDashManifest, 
  sanitizeFilePath 
} from '../src/services/protocolParser.ts';
import { generateSegments } from '../src/services/downloadEngine.ts';

test('Protocol Detection: accurately identifies URLs and streams', () => {
  assert.strictEqual(detectProtocol('http://example.com/file.zip'), 'http');
  assert.strictEqual(detectProtocol('https://example.com/file.iso'), 'https');
  assert.strictEqual(detectProtocol('ftp://ftp.debian.org/debian/file.gz'), 'ftp');
  assert.strictEqual(detectProtocol('ftps://secure.ftp.org/archive.tar'), 'ftps');
  assert.strictEqual(detectProtocol('sftp://backup.server.com/disk.img'), 'sftp');
  assert.strictEqual(detectProtocol('https://live.mux.com/stream/index.m3u8'), 'hls');
  assert.strictEqual(detectProtocol('https://vod.cdn.net/manifest.mpd'), 'dash');
});

test('FTP/SFTP URL Parser: extracts host, port, credentials, and paths', () => {
  // Anonymous FTP
  const anon = parseFtpUrl('ftp://ftp.gnu.org/gnu/gcc/gcc-14.tar.gz');
  assert.strictEqual(anon.protocol, 'ftp');
  assert.strictEqual(anon.host, 'ftp.gnu.org');
  assert.strictEqual(anon.port, 21);
  assert.strictEqual(anon.filename, 'gcc-14.tar.gz');
  assert.strictEqual(anon.isAnonymous, true);
  assert.strictEqual(anon.username, 'anonymous');

  // Authenticated FTPS
  const authFtps = parseFtpUrl('ftps://user1:secretpass@ftp.corp.net:2121/reports/q4.pdf');
  assert.strictEqual(authFtps.protocol, 'ftps');
  assert.strictEqual(authFtps.host, 'ftp.corp.net');
  assert.strictEqual(authFtps.port, 2121);
  assert.strictEqual(authFtps.username, 'user1');
  assert.strictEqual(authFtps.password, 'secretpass');
  assert.strictEqual(authFtps.filename, 'q4.pdf');
  assert.strictEqual(authFtps.isAnonymous, false);

  // SFTP SSH with default port 22
  const sftp = parseFtpUrl('sftp://deployer@ssh.prod.com/var/backups/db.sql');
  assert.strictEqual(sftp.protocol, 'sftp');
  assert.strictEqual(sftp.port, 22);
  assert.strictEqual(sftp.username, 'deployer');
  assert.strictEqual(sftp.filename, 'db.sql');
});

test('Content-Disposition RFC 5987 / 6266 filename parser', () => {
  // Standard quoted
  const std = extractContentDispositionFilename('attachment; filename="setup-x64.exe"');
  assert.strictEqual(std, 'setup-x64.exe');

  // RFC 5987 UTF-8 encoded
  const rfc5987 = extractContentDispositionFilename("attachment; filename*=UTF-8''NOVA%20Installer%20v2.4.msi");
  assert.strictEqual(rfc5987, 'NOVA Installer v2.4.msi');

  // Fallback when null
  assert.strictEqual(extractContentDispositionFilename(null), null);
});

test('HLS Stream Parser: extracts variants, segments, and detects FairPlay/Widevine DRM', () => {
  const masterHls = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,CODECS="avc1.64002a,mp4a.40.2"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2200000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p/index.m3u8
  `;

  const parsed = parseHlsManifest(masterHls, 'https://cdn.example.com/master.m3u8');
  assert.strictEqual(parsed.isMaster, true);
  assert.strictEqual(parsed.hasDrm, false);
  assert.strictEqual(parsed.variants.length, 2);
  assert.strictEqual(parsed.variants[0].resolution, '1920x1080');
  assert.strictEqual(parsed.variants[0].url, 'https://cdn.example.com/1080p/index.m3u8');

  // Media playlist with DRM FairPlay / Sample-AES
  const drmHls = `
#EXTM3U
#EXT-X-VERSION:5
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://drm.key",KEYFORMAT="com.apple.streamingkeydelivery"
#EXTINF:6.0,
segment0.ts
#EXTINF:6.0,
segment1.ts
#EXT-X-ENDLIST
  `;

  const drmParsed = parseHlsManifest(drmHls, 'https://cdn.example.com/drm.m3u8');
  assert.strictEqual(drmParsed.hasDrm, true);
  assert.strictEqual(drmParsed.drmType, 'FairPlay');
  assert.strictEqual(drmParsed.isLive, false);
  assert.strictEqual(drmParsed.segments.length, 2);
});

test('MPEG-DASH Manifest Parser: detects Widevine & PlayReady DRM ContentProtection', () => {
  const widevineDASH = `
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" minBufferTime="PT1.5S">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
      <Representation id="v1080" bandwidth="4000000" width="1920" height="1080"/>
    </AdaptationSet>
  </Period>
</MPD>
  `;

  const parsed = parseDashManifest(widevineDASH, 'https://cdn.example.com/manifest.mpd');
  assert.strictEqual(parsed.hasDrm, true);
  assert.strictEqual(parsed.drmType, 'Widevine');
  assert.strictEqual(parsed.representations.length, 1);
  assert.strictEqual(parsed.representations[0].width, 1920);
});

test('Segment Generation: guarantees contiguous, non-overlapping byte ranges', () => {
  const total = 1000000;
  const segmentsCount = 8;
  const segments = generateSegments(total, segmentsCount);

  assert.strictEqual(segments.length, segmentsCount);
  assert.strictEqual(segments[0].startByte, 0);
  assert.strictEqual(segments[segments.length - 1].endByte, total - 1);

  // Check no gaps and no overlaps
  for (let i = 0; i < segments.length - 1; i++) {
    assert.strictEqual(segments[i].endByte + 1, segments[i + 1].startByte);
  }
});

test('Security & Path Sanitization: blocks path traversal sequences', () => {
  const attack1 = sanitizeFilePath('../../Windows/System32/evil.dll');
  assert.strictEqual(attack1.isValid, false);
  assert.match(attack1.error || '', /traversal/i);

  const clean = sanitizeFilePath('C:\\Users\\Downloads\\setup.exe');
  assert.strictEqual(clean.isValid, true);
  assert.strictEqual(clean.sanitizedPath, 'C:\\Users\\Downloads\\setup.exe');

  const illegalChars = sanitizeFilePath('C:\\Users\\Downloads\\bad:file*name?.iso');
  assert.strictEqual(illegalChars.isValid, true);
  assert.strictEqual(illegalChars.sanitizedPath, 'C:\\Users\\Downloads\\bad_file_name_.iso');
});
