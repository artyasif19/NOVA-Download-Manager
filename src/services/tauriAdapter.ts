/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NOVA Download Manager - TypeScript to Rust Tauri Request Adapter
 * Maps camelCase frontend DownloadItem objects to snake_case Rust DownloadRequest payloads
 */

import { DownloadItem } from '../types/download';

export interface RustDownloadRequest {
  id: string;
  url: string;
  destination_path: string;
  total_bytes: number;
  segments_count: number;
  expected_sha256: string | null;
  headers: Record<string, string> | null;
  cookies: string | null;
  username: string | null;
  password: string | null;
}

/**
 * Resolves a normalized absolute destination path from directory and filename,
 * respecting Windows drive/separator conventions and stripping trailing slashes.
 */
export function buildDestinationPath(directory: string, filename: string): string {
  const cleanDir = (directory || '').trim().replace(/[\\/]+$/, '');
  const cleanFilename = (filename || 'download.dat').trim().replace(/^[\\/]+/, '');

  if (!cleanDir) {
    return cleanFilename;
  }

  // Preserve Windows drive syntax (C:\...) or backslash convention
  const isWindows = cleanDir.includes('\\') || /^[a-zA-Z]:/.test(cleanDir);
  const sep = isWindows ? '\\' : '/';
  return `${cleanDir}${sep}${cleanFilename}`;
}

/**
 * Explicit TypeScript-to-Rust request adapter.
 * Ensures all required fields are correctly mapped from camelCase DownloadItem
 * to the exact snake_case fields expected by Rust's DownloadRequest struct.
 */
export function mapDownloadItemToRustRequest(item: DownloadItem): RustDownloadRequest {
  const destinationPath = buildDestinationPath(item.directory, item.filename);

  return {
    id: item.id,
    url: item.url,
    destination_path: destinationPath,
    total_bytes: typeof item.totalBytes === 'number' && item.totalBytes >= 0 ? item.totalBytes : 0,
    segments_count: typeof item.segmentsCount === 'number' && item.segmentsCount > 0 ? item.segmentsCount : 8,
    expected_sha256: item.sha256Expected && item.sha256Expected.trim().length > 0 ? item.sha256Expected.trim() : null,
    headers: item.headers && Object.keys(item.headers).length > 0 ? { ...item.headers } : null,
    cookies: item.cookies && item.cookies.trim().length > 0 ? item.cookies.trim() : null,
    username: item.credentials?.username && item.credentials.username.trim().length > 0 ? item.credentials.username.trim() : null,
    password: item.credentials?.password && item.credentials.password.length > 0 ? item.credentials.password : null,
  };
}
