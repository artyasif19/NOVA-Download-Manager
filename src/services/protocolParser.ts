/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DownloadProtocol, ProtocolCredentials, StreamInfo } from '../types/download';

export interface ParsedFtpDetails {
  protocol: 'ftp' | 'ftps' | 'sftp';
  host: string;
  port: number;
  path: string;
  filename: string;
  username?: string;
  password?: string;
  isAnonymous: boolean;
}

export interface ParsedHlsStream {
  isMaster: boolean;
  isLive: boolean;
  hasDrm: boolean;
  drmType: 'Widevine' | 'PlayReady' | 'FairPlay' | 'AES-128' | 'None';
  drmMessage?: string;
  variants: Array<{
    bandwidth: number;
    resolution?: string;
    codecs?: string;
    url: string;
    qualityLabel: string;
  }>;
  segments: Array<{
    url: string;
    duration: number;
  }>;
  totalDurationSeconds: number;
}

export interface ParsedDashStream {
  isLive: boolean;
  hasDrm: boolean;
  drmType: 'Widevine' | 'PlayReady' | 'FairPlay' | 'AES-128' | 'None';
  drmMessage?: string;
  representations: Array<{
    id: string;
    mimeType: string;
    codecs?: string;
    width?: number;
    height?: number;
    bandwidth: number;
    qualityLabel: string;
    baseUrl?: string;
  }>;
  minBufferTime?: string;
  mediaPresentationDuration?: string;
}

/**
 * Detect protocol from URL string or query parameters
 */
export function detectProtocol(url: string): DownloadProtocol {
  const clean = url.trim().toLowerCase();
  if (clean.startsWith('sftp://')) return 'sftp';
  if (clean.startsWith('ftps://')) return 'ftps';
  if (clean.startsWith('ftp://')) return 'ftp';

  // Check URL pathname for streaming playlists
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith('.m3u8') || parsed.search.includes('.m3u8')) return 'hls';
    if (pathname.endsWith('.mpd') || parsed.search.includes('.mpd')) return 'dash';
  } catch {
    if (clean.endsWith('.m3u8')) return 'hls';
    if (clean.endsWith('.mpd')) return 'dash';
  }

  if (clean.startsWith('https://')) return 'https';
  return 'http';
}

/**
 * Parse FTP, FTPS, or SFTP URL and extract credentials & paths
 */
export function parseFtpUrl(rawUrl: string, customCredentials?: ProtocolCredentials): ParsedFtpDetails {
  let urlStr = rawUrl.trim();
  let proto: 'ftp' | 'ftps' | 'sftp' = 'ftp';

  if (urlStr.startsWith('sftp://')) proto = 'sftp';
  else if (urlStr.startsWith('ftps://')) proto = 'ftps';
  else if (urlStr.startsWith('ftp://')) proto = 'ftp';
  else {
    urlStr = `ftp://${urlStr}`;
  }

  try {
    const parsed = new URL(urlStr);
    const defaultPort = proto === 'sftp' ? 22 : 21;
    const port = customCredentials?.port || (parsed.port ? parseInt(parsed.port, 10) : defaultPort);
    
    let username = customCredentials?.username || (parsed.username ? decodeURIComponent(parsed.username) : undefined);
    let password = customCredentials?.password || (parsed.password ? decodeURIComponent(parsed.password) : undefined);
    const isAnonymous = !username || username.toLowerCase() === 'anonymous';

    if (isAnonymous) {
      username = 'anonymous';
      password = password || 'nova-user@novadownloader.com';
    }

    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const filename = pathSegments.length > 0 
      ? decodeURIComponent(pathSegments[pathSegments.length - 1]) 
      : 'ftp_download.dat';

    return {
      protocol: proto,
      host: parsed.hostname,
      port,
      path: parsed.pathname || '/',
      filename,
      username,
      password,
      isAnonymous,
    };
  } catch (err) {
    return {
      protocol: proto,
      host: 'localhost',
      port: proto === 'sftp' ? 22 : 21,
      path: '/',
      filename: 'file.dat',
      username: customCredentials?.username || 'anonymous',
      password: customCredentials?.password || 'anonymous@novadownloader.com',
      isAnonymous: !customCredentials?.username || customCredentials.username === 'anonymous',
    };
  }
}

/**
 * Extract filename from Content-Disposition header with support for RFC 5987 / RFC 6266 UTF-8 encoded parameters
 */
export function extractContentDispositionFilename(disposition: string | null | undefined): string | null {
  if (!disposition) return null;

  // 1. Try filename*=UTF-8''encoded_name (RFC 5987 / RFC 6266 standard)
  const utf8Match = disposition.match(/filename\*\s*=\s*UTF-8''([^;\r\n]+)/i);
  if (utf8Match && utf8Match[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  // 2. Try quoted filename="name"
  const quotedMatch = disposition.match(/filename\s*=\s*"([^"]+)"/i);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1].trim();
  }

  // 3. Try unquoted filename=name
  const unquotedMatch = disposition.match(/filename\s*=\s*([^;\r\n]+)/i);
  if (unquotedMatch && unquotedMatch[1]) {
    return unquotedMatch[1].trim();
  }

  return null;
}

/**
 * Resolve a relative URL against a base URL
 */
export function resolveRelativeUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute, baseUrl).toString();
  } catch {
    return relativeOrAbsolute;
  }
}

/**
 * Parse an HLS (.m3u8) playlist and check for DRM protection
 */
export function parseHlsManifest(content: string, manifestUrl: string): ParsedHlsStream {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  
  let isMaster = false;
  let isLive = true;
  let hasDrm = false;
  let drmType: 'Widevine' | 'PlayReady' | 'FairPlay' | 'AES-128' | 'None' = 'None';
  let drmMessage: string | undefined;

  const variants: ParsedHlsStream['variants'] = [];
  const segments: ParsedHlsStream['segments'] = [];
  let totalDurationSeconds = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for DRM and Encryption keys
    if (line.startsWith('#EXT-X-KEY:')) {
      const keyLine = line.toUpperCase();
      if (keyLine.includes('METHOD=SAMPLE-AES')) {
        hasDrm = true;
        if (keyLine.includes('KEYFORMAT="COM.APPLE.STREAMINGKEYDELIVERY"')) {
          drmType = 'FairPlay';
          drmMessage = 'Apple FairPlay DRM encryption detected. Protected stream cannot be saved.';
        } else if (keyLine.includes('KEYFORMAT="URN:UUID:EDEF8BA9-79D6-4ACE-A3C8-27DCD51D21ED"')) {
          drmType = 'Widevine';
          drmMessage = 'Google Widevine DRM encryption detected. Protected stream cannot be saved.';
        } else {
          drmType = 'FairPlay';
          drmMessage = 'Encrypted SAMPLE-AES DRM stream detected. Content protection is active.';
        }
      } else if (keyLine.includes('METHOD=AES-128')) {
        drmType = 'AES-128';
        // Note: Standard AES-128 with accessible URI key may be decryptable if key is accessible,
        // but if key points to protected KMS, report as encrypted.
        drmMessage = 'AES-128 segment encryption detected. Requires accessible decryption key URI.';
      }
    }

    // Check if stream is VOD (completed)
    if (line === '#EXT-X-ENDLIST') {
      isLive = false;
    }

    // Master Playlist Variants
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      isMaster = true;
      const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
      const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
      const codeMatch = line.match(/CODECS="([^"]+)"/i);
      const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
      const resolution = resMatch ? resMatch[1] : undefined;
      const codecs = codeMatch ? codeMatch[1] : undefined;

      // Next non-comment line is stream URI
      if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
        const streamUri = lines[i + 1];
        const fullUrl = resolveRelativeUrl(streamUri, manifestUrl);
        const qualityLabel = resolution 
          ? `${resolution} (${Math.round(bandwidth / 1000)} kbps)` 
          : `${Math.round(bandwidth / 1000)} kbps`;

        variants.push({
          bandwidth,
          resolution,
          codecs,
          url: fullUrl,
          qualityLabel,
        });
      }
    }

    // Media Playlist Segment
    if (line.startsWith('#EXTINF:')) {
      const durMatch = line.match(/#EXTINF:([0-9.]+)/i);
      const duration = durMatch ? parseFloat(durMatch[1]) : 0;

      // Find next line with segment URI
      let j = i + 1;
      while (j < lines.length && lines[j].startsWith('#')) {
        j++;
      }

      if (j < lines.length) {
        const segUri = lines[j];
        const segFullUrl = resolveRelativeUrl(segUri, manifestUrl);
        segments.push({
          url: segFullUrl,
          duration,
        });
        totalDurationSeconds += duration;
      }
    }
  }

  // Sort variants highest bandwidth first
  variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return {
    isMaster,
    isLive,
    hasDrm,
    drmType,
    drmMessage,
    variants,
    segments,
    totalDurationSeconds,
  };
}

/**
 * Parse an MPEG-DASH (.mpd) XML manifest and check for DRM protection
 */
export function parseDashManifest(xmlContent: string, manifestUrl: string): ParsedDashStream {
  let isLive = xmlContent.includes('type="dynamic"');
  let hasDrm = false;
  let drmType: 'Widevine' | 'PlayReady' | 'FairPlay' | 'AES-128' | 'None' = 'None';
  let drmMessage: string | undefined;

  // Check for ContentProtection tags
  const widevineUuid = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
  const playreadyUuid = '9a04f079-9840-4286-ab92-e65be0885f95';
  const fairplayUuid = '94ce86fb-07ff-4f43-adb8-93d2fa968ca2';

  const lowerXml = xmlContent.toLowerCase();

  if (lowerXml.includes(widevineUuid)) {
    hasDrm = true;
    drmType = 'Widevine';
    drmMessage = 'Google Widevine DRM ContentProtection detected. Protected media cannot be downloaded.';
  } else if (lowerXml.includes(playreadyUuid)) {
    hasDrm = true;
    drmType = 'PlayReady';
    drmMessage = 'Microsoft PlayReady DRM ContentProtection detected. Protected media cannot be downloaded.';
  } else if (lowerXml.includes(fairplayUuid)) {
    hasDrm = true;
    drmType = 'FairPlay';
    drmMessage = 'Apple FairPlay DRM ContentProtection detected. Protected media cannot be downloaded.';
  } else if (lowerXml.includes('<contentprotection')) {
    hasDrm = true;
    drmType = 'Widevine';
    drmMessage = 'DRM encryption scheme detected in DASH manifest. Protected content cannot be bypassed.';
  }

  // Parse Representations
  const representations: ParsedDashStream['representations'] = [];
  const repRegex = /<Representation\s+([^>]+)>/gi;
  let match;

  while ((match = repRegex.exec(xmlContent)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/\bid="([^"]+)"/i);
    const bwMatch = attrs.match(/\bbandwidth="(\d+)"/i);
    const widthMatch = attrs.match(/\bwidth="(\d+)"/i);
    const heightMatch = attrs.match(/\bheight="(\d+)"/i);
    const codecsMatch = attrs.match(/\bcodecs="([^"]+)"/i);
    const mimeMatch = attrs.match(/\bmimeType="([^"]+)"/i);

    const id = idMatch ? idMatch[1] : `rep-${representations.length + 1}`;
    const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;
    const width = widthMatch ? parseInt(widthMatch[1], 10) : undefined;
    const height = heightMatch ? parseInt(heightMatch[1], 10) : undefined;
    const codecs = codecsMatch ? codecsMatch[1] : undefined;
    const mimeType = mimeMatch ? mimeMatch[1] : (width ? 'video/mp4' : 'audio/mp4');

    const qualityLabel = width && height 
      ? `${width}x${height} (${Math.round(bandwidth / 1000)} kbps)` 
      : `${mimeType} (${Math.round(bandwidth / 1000)} kbps)`;

    representations.push({
      id,
      bandwidth,
      width,
      height,
      codecs,
      mimeType,
      qualityLabel,
    });
  }

  representations.sort((a, b) => b.bandwidth - a.bandwidth);

  return {
    isLive,
    hasDrm,
    drmType,
    drmMessage,
    representations,
  };
}

/**
 * Sanitize destination paths to protect against directory traversal and Windows illegal characters
 */
export function sanitizeFilePath(filepath: string, defaultFolder: string = 'C:\\Downloads'): {
  isValid: boolean;
  sanitizedPath: string;
  error?: string;
} {
  if (!filepath || typeof filepath !== 'string') {
    return { isValid: false, sanitizedPath: defaultFolder, error: 'Empty file path' };
  }

  // Check for dangerous traversal attempts
  if (filepath.includes('../') || filepath.includes('..\\')) {
    return { 
      isValid: false, 
      sanitizedPath: defaultFolder, 
      error: 'Security alert: Path traversal attempt detected (".."). Action blocked.' 
    };
  }

  // Check for illegal Windows filename characters
  const filename = filepath.split(/[\/\\]/).pop() || '';
  const illegalChars = /[<>:"|?*]/;
  if (illegalChars.test(filename)) {
    const cleanFilename = filename.replace(/[<>:"|?*]/g, '_');
    const dir = filepath.substring(0, filepath.length - filename.length);
    return {
      isValid: true,
      sanitizedPath: `${dir}${cleanFilename}`,
      error: 'Filename contained illegal characters; automatically sanitized.'
    };
  }

  return { isValid: true, sanitizedPath: filepath };
}
