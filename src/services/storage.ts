/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DownloadItem, AppSettings, CustomCategory } from '../types/download';

export function getDefaultDownloadDirectory(): string {
  if (typeof process !== 'undefined' && process.env) {
    const userProfile = process.env.USERPROFILE || process.env.HOME;
    if (userProfile) {
      return `${userProfile}\\Downloads\\NOVA`;
    }
  }
  return 'C:\\Downloads\\NOVA';
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultFolder: getDefaultDownloadDirectory(),
  maxConcurrentDownloads: 3,
  maxConnectionsPerDownload: 8,
  speedLimitEnabled: false,
  speedLimitKBps: 5120, // 5 MB/s
  soundNotification: true,
  startWithWindows: true,
  clipboardMonitor: true,
  autoAddMagnets: false,
  torrentSeedRatio: 0,
  torrentDownLimit: 0,
  torrentUpLimit: 0,
  afterDownloads: 'none',
  proxyMode: 'none',
  proxyHost: '',
  proxyPort: 8080,
  proxyUser: '',
  proxyPass: '',
  minimizeToTray: true,
  autoCategorize: true,
  accentColor: 'cyan',
  theme: 'dark',
  glassStyle: 'default',
  customColors: ['#06b6d4', '#8b5cf6', '#f43f5e'],
  customBgImage: '',
  density: 'comfortable',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  autoStartNewDownloads: true,
  allowedExtensionIds: [
    'com.nova.downloadmanager.chrome',
    'com.nova.downloadmanager.edge',
    'com.nova.downloadmanager.firefox'
  ],
  enableFloatingSniffer: true,
  floatingSnifferMinVideoDuration: 5,
  excludedDomains: ['localhost', '127.0.0.1'],
};

export const DEFAULT_CUSTOM_CATEGORIES: CustomCategory[] = [
  { id: 'cat-iso', name: 'Disk Images', extensions: ['iso', 'img', 'vhd'], subfolder: 'DiskImages' },
  { id: 'cat-code', name: 'Development', extensions: ['tar.gz', 'whl', 'npm', 'rs'], subfolder: 'Dev' },
];

function createSampleSegments(totalBytes: number, downloadedBytes: number, count = 8, isDownloading = false) {
  const chunkSize = Math.floor(totalBytes / count);
  const segments = [];
  const percentDone = downloadedBytes / totalBytes;

  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? totalBytes : (i + 1) * chunkSize;
    const segTotal = end - start;
    
    // Distribute downloaded bytes across chunks
    let segDownloaded = Math.min(segTotal, Math.floor(segTotal * percentDone * (1 + (Math.sin(i) * 0.15))));
    if (downloadedBytes >= totalBytes) {
      segDownloaded = segTotal;
    }

    segments.push({
      id: i + 1,
      startByte: start,
      endByte: end,
      downloadedBytes: segDownloaded,
      speed: isDownloading ? Math.floor(1.2 * 1024 * 1024 + (Math.cos(i) * 300 * 1024)) : 0,
      isFinished: segDownloaded >= segTotal,
      isActive: isDownloading && segDownloaded < segTotal,
    });
  }
  return segments;
}

export function createSampleSpeedHistory(baseSpeed: number, pointsCount = 25, isDownloading = false) {
  const points = [];
  const now = Date.now();
  const stepMs = 2000;
  for (let i = pointsCount - 1; i >= 0; i--) {
    const time = now - i * stepMs;
    const ramp = Math.min(1, (pointsCount - i) / 5);
    const wave = Math.sin((pointsCount - i) * 0.7) * 0.22 + Math.cos((pointsCount - i) * 0.3) * 0.12;
    let speed = Math.max(150 * 1024, Math.floor(baseSpeed * ramp * (1 + wave)));
    if (!isDownloading && i <= 2) {
      speed = 0;
    }
    points.push({ time, speed });
  }
  return points;
}

export const INITIAL_DOWNLOADS: DownloadItem[] = [
  {
    id: 'dl-1',
    url: 'https://releases.ubuntu.com/24.04/ubuntu-24.04.1-desktop-amd64.iso',
    filename: 'ubuntu-24.04.1-desktop-amd64.iso',
    directory: 'C:\\Users\\Administrator\\Downloads\\NOVA\\Compressed',
    totalBytes: 5974000000,
    downloadedBytes: 4241540000,
    speed: 12450000,
    status: 'downloading',
    category: 'compressed',
    segmentsCount: 8,
    segments: createSampleSegments(5974000000, 4241540000, 8, true),
    supportsRange: true,
    etag: '"9e8f-6218d6bfa3bc0"',
    mimeType: 'application/x-iso9660-image',
    dateAdded: Date.now() - 1000 * 60 * 14,
    priority: 'high',
    sha256Expected: 'c2e6f4208d18e3fa5c72e474f8eed7b8eb4ecf6e3c3167104b901a073f1d8eb6',
    speedHistory: createSampleSpeedHistory(12450000, 30, true),
  },
  {
    id: 'dl-2',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    filename: 'BigBuckBunny_4K_UltraHD.mp4',
    directory: 'C:\\Users\\Administrator\\Downloads\\NOVA\\Video',
    totalBytes: 158008374,
    downloadedBytes: 158008374,
    speed: 0,
    status: 'completed',
    category: 'video_audio',
    segmentsCount: 8,
    segments: createSampleSegments(158008374, 158008374, 8, false),
    supportsRange: true,
    etag: '"59be90b6-96ad6a6"',
    mimeType: 'video/mp4',
    dateAdded: Date.now() - 1000 * 60 * 45,
    dateFinished: Date.now() - 1000 * 60 * 41,
    priority: 'normal',
    sha256Calculated: 'a8b792ef1c8d7634f31920ac34e56b823901aef92138bc12984a9c8e1903ba41',
    speedHistory: createSampleSpeedHistory(15800000, 24, false),
  },
  {
    id: 'dl-3',
    url: 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi',
    filename: 'node-v22.14.0-x64.msi',
    directory: 'C:\\Users\\Administrator\\Downloads\\NOVA\\Applications',
    totalBytes: 34185216,
    downloadedBytes: 34185216,
    speed: 0,
    status: 'completed',
    category: 'applications',
    segmentsCount: 4,
    segments: createSampleSegments(34185216, 34185216, 4, false),
    supportsRange: true,
    etag: '"67b5f102-209a000"',
    mimeType: 'application/x-msi',
    dateAdded: Date.now() - 1000 * 60 * 120,
    dateFinished: Date.now() - 1000 * 60 * 118,
    priority: 'normal',
    sha256Calculated: '7f9901ad39401bf578c7283401faec2981bc5982e091ac891b2c45ea0149021a',
  },
  {
    id: 'dl-4',
    url: 'https://static.rust-lang.org/dist/rust-1.84.0-x86_64-pc-windows-msvc.zip',
    filename: 'rust-1.84.0-x86_64-pc-windows-msvc.zip',
    directory: 'C:\\Users\\Administrator\\Downloads\\NOVA\\Compressed',
    totalBytes: 285490200,
    downloadedBytes: 114196080,
    speed: 0,
    status: 'paused',
    category: 'compressed',
    segmentsCount: 8,
    segments: createSampleSegments(285490200, 114196080, 8, false),
    supportsRange: true,
    etag: '"110438-5183910"',
    mimeType: 'application/zip',
    dateAdded: Date.now() - 1000 * 60 * 60,
    priority: 'normal',
  },
  {
    id: 'dl-5',
    url: 'https://get.enterprisedb.com/postgresql/postgresql-17.2-1-windows-x64.exe',
    filename: 'postgresql-17.2-1-windows-x64.exe',
    directory: 'C:\\Users\\Administrator\\Downloads\\NOVA\\Applications',
    totalBytes: 412589300,
    downloadedBytes: 0,
    speed: 0,
    status: 'scheduled',
    scheduledTime: Date.now() + 1000 * 60 * 45, // starts in 45 minutes
    category: 'applications',
    segmentsCount: 8,
    segments: createSampleSegments(412589300, 0, 8, false),
    supportsRange: true,
    dateAdded: Date.now() - 1000 * 60 * 5,
    priority: 'normal',
  },
  {
    id: 'dl-6',
    url: 'https://arxiv.org/pdf/2401.12345v2.pdf',
    filename: 'Fast_Segmented_Parallel_IO_Architecture.pdf',
    directory: 'C:\\Users\\Administrator\\Downloads\\NOVA\\Documents',
    totalBytes: 4892150,
    downloadedBytes: 4892150,
    speed: 0,
    status: 'completed',
    category: 'documents',
    segmentsCount: 2,
    segments: createSampleSegments(4892150, 4892150, 2, false),
    supportsRange: true,
    mimeType: 'application/pdf',
    dateAdded: Date.now() - 1000 * 60 * 180,
    dateFinished: Date.now() - 1000 * 60 * 179,
    priority: 'low',
    sha256Calculated: '3b4c9103e582910fa893b18471920ac394857b2938471923058bca8192039481',
  },
  {
    id: 'dl-7',
    url: 'https://mirror.archlinux.org/iso/latest/archlinux-x86_64.iso',
    filename: 'archlinux-2026.10.01-x86_64.iso',
    directory: 'C:\\Users\\Administrator\\Downloads\\NOVA\\Compressed',
    totalBytes: 1120000000,
    downloadedBytes: 560000000,
    speed: 0,
    status: 'error',
    errorMessage: 'Connection reset by peer (HTTP Range chunk 5 aborted by server)',
    category: 'compressed',
    segmentsCount: 8,
    segments: createSampleSegments(1120000000, 560000000, 8, false),
    supportsRange: true,
    dateAdded: Date.now() - 1000 * 60 * 90,
    priority: 'normal',
  },
];

const STORAGE_KEY_DOWNLOADS = 'nova_downloads_v3';
const STORAGE_KEY_SETTINGS = 'nova_settings_v2';
const STORAGE_KEY_CUSTOM_CATS = 'nova_custom_categories_v2';

export function loadStoredDownloads(): DownloadItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DOWNLOADS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load downloads from storage', e);
    return [];
  }
}

export function saveStoredDownloads(items: DownloadItem[]): void {
  try {
    // Avoid serializing blobUrl to prevent storage quota crash
    const sanitized = items.map(item => ({
      ...item,
      blobUrl: undefined,
    }));
    localStorage.setItem(STORAGE_KEY_DOWNLOADS, JSON.stringify(sanitized));
  } catch (e) {
    console.warn('Storage save error:', e);
  }
}

export function loadStoredSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveStoredSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings', e);
  }
}

export function loadStoredCustomCategories(): CustomCategory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_CATS);
    if (!raw) return DEFAULT_CUSTOM_CATEGORIES;
    return JSON.parse(raw);
  } catch {
    return DEFAULT_CUSTOM_CATEGORIES;
  }
}

export function saveStoredCustomCategories(cats: CustomCategory[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM_CATS, JSON.stringify(cats));
  } catch (e) {
    console.error('Failed to save custom categories', e);
  }
}
