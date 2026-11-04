/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DownloadStatus = 
  | 'downloading' 
  | 'paused' 
  | 'queued' 
  | 'completed' 
  | 'error' 
  | 'scheduled';

export type CategoryType = 
  | 'all'
  | 'downloading'
  | 'scheduled'
  | 'queued'
  | 'completed'
  | 'failed'
  | 'video_audio'
  | 'documents'
  | 'compressed'
  | 'applications'
  | 'custom';

export interface DownloadSegment {
  id: number;
  startByte: number;
  endByte: number;
  downloadedBytes: number;
  speed: number; // bytes/sec
  isFinished: boolean;
  isActive: boolean;
}

export type DownloadProtocol = 'http' | 'https' | 'ftp' | 'ftps' | 'sftp' | 'hls' | 'dash' | 'video';

export interface ProtocolCredentials {
  username?: string;
  password?: string;
  port?: number;
  passiveMode?: boolean;
  privateKey?: string;
}

export interface StreamInfo {
  format: 'hls' | 'dash' | 'progressive';
  isLive?: boolean;
  hasDrm?: boolean;
  drmType?: 'Widevine' | 'PlayReady' | 'FairPlay' | 'AES-128' | 'None';
  segmentCount?: number;
  quality?: string;
  codecs?: string;
  masterUrl?: string;
}

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  directory: string;
  totalBytes: number;
  downloadedBytes: number;
  speed: number; // bytes per second
  status: DownloadStatus;
  category: 'video_audio' | 'documents' | 'compressed' | 'applications' | 'custom';
  customCategoryName?: string;
  segmentsCount: number;
  segments: DownloadSegment[];
  supportsRange: boolean;
  isResumable?: boolean;
  protocol?: DownloadProtocol;
  credentials?: ProtocolCredentials;
  streamInfo?: StreamInfo;
  etag?: string;
  mimeType?: string;
  dateAdded: number;
  dateFinished?: number;
  errorMessage?: string;
  sha256Expected?: string;
  sha256Calculated?: string;
  headers?: Record<string, string>;
  cookies?: string;
  priority: 'low' | 'normal' | 'high';
  scheduledTime?: number;
  blobUrl?: string;
  isRealDownload?: boolean;
  speedHistory?: SpeedHistoryPoint[];
  videoQuality?: string; // video-site downloads: best | 1080 | 720 | 480 | audio
  etaSeconds?: number; // seconds remaining reported by the engine (video downloads)
}

export interface CustomCategory {
  id: string;
  name: string;
  extensions: string[];
  subfolder: string;
}

export interface AppSettings {
  defaultFolder: string;
  maxConcurrentDownloads: number;
  maxConnectionsPerDownload: number;
  speedLimitEnabled: boolean;
  speedLimitKBps: number;
  soundNotification: boolean;
  startWithWindows: boolean;
  minimizeToTray: boolean;
  autoCategorize: boolean;
  accentColor: 'cyan' | 'emerald' | 'violet' | 'amber' | 'crimson' | 'slate';
  theme: 'dark' | 'light' | 'glass-dark' | 'glass-light';
  density: 'compact' | 'comfortable';
  userAgent: string;
  autoStartNewDownloads: boolean;
  allowedExtensionIds: string[];
  enableFloatingSniffer: boolean;
  floatingSnifferMinVideoDuration: number;
  excludedDomains: string[];
}

export interface SpeedHistoryPoint {
  time: number;
  speed: number;
}
