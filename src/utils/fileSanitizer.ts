/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * NOVA Download Manager - Path and Filename Sanitization & Non-Colliding Resolution
 */

import path from 'path';
import fs from 'fs';

// Path sanitization helper: strips traversal, directories, illegal chars, and Windows reserved device names
export function sanitizeFilename(filename: string): string {
  if (!filename) return 'download.dat';
  // 1. Strip directory traversal, drive letters, and parent paths first
  const base = path.basename(filename.replace(/\\/g, '/')).trim();
  // 2. Remove illegal characters and null bytes
  const clean = base.replace(/[/\\?%*:|"<>]/g, '_').replace(/[\0-\x1f\x7f]/g, '').trim();
  const reserved = [
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
  ];
  const stem = clean.split('.')[0].toLowerCase();
  if (reserved.includes(stem)) {
    return `nova_${clean}`;
  }
  return clean || 'download.dat';
}

export function getSafeDownloadDirectory(customDataDir = '.nova_data'): string {
  if (process.env.USERPROFILE) {
    return path.join(process.env.USERPROFILE, 'Downloads', 'NOVA');
  }
  if (process.env.HOME) {
    return path.join(process.env.HOME, 'Downloads', 'NOVA');
  }
  return path.resolve(customDataDir, 'downloads');
}

export function resolveNonCollidingPath(targetDir: string, filename: string): { fullPath: string; cleanFilename: string } {
  const cleanName = sanitizeFilename(filename);
  let candidate = path.join(targetDir, cleanName);
  if (!fs.existsSync(candidate)) {
    return { fullPath: candidate, cleanFilename: cleanName };
  }

  const ext = path.extname(cleanName);
  const stem = path.basename(cleanName, ext);
  let counter = 1;
  while (fs.existsSync(candidate) && counter <= 10000) {
    const nextName = `${stem} (${counter})${ext}`;
    candidate = path.join(targetDir, nextName);
    if (!fs.existsSync(candidate)) {
      return { fullPath: candidate, cleanFilename: nextName };
    }
    counter++;
  }
  return { fullPath: candidate, cleanFilename: path.basename(candidate) };
}
