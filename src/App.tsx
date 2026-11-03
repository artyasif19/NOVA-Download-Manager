/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { TitleBar } from './components/TitleBar';
import { TopToolbar } from './components/TopToolbar';
import { Sidebar } from './components/Sidebar';
import { DownloadTable } from './components/DownloadTable';
import { AddDownloadModal } from './components/AddDownloadModal';
import { DownloadDetailsModal } from './components/DownloadDetailsModal';
import { VideoSnifferLab } from './components/VideoSnifferLab';
import { BrowserExtensionHub } from './components/BrowserExtensionHub';
import { SettingsModal } from './components/SettingsModal';
import { ScheduleModal } from './components/ScheduleModal';
import { AboutModal } from './components/AboutModal';
import { 
  DownloadItem, 
  CategoryType, 
  CustomCategory, 
  AppSettings 
} from './types/download';
import { 
  loadStoredDownloads, 
  saveStoredDownloads, 
  loadStoredSettings, 
  saveStoredSettings,
  loadStoredCustomCategories,
  saveStoredCustomCategories
} from './services/storage';
import { getAccentClasses, formatScheduledDateTime } from './utils/formatters';
import { startRealDownload, pauseRealDownload, cancelRealDownload } from './services/realDownloader';
import { fetchAllDownloads, getNativeDefaultFolder, invokeCommand, isTauriEnvironment, setupNativeDownloadListeners } from './services/tauriBridge';

export default function App() {
  const [downloads, setDownloads] = useState<DownloadItem[]>(loadStoredDownloads);
  const [settings, setSettings] = useState<AppSettings>(loadStoredSettings);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(loadStoredCustomCategories);

  const [selectedCategory, setSelectedCategory] = useState<CategoryType>('all');
  const [selectedCustomCategory, setSelectedCustomCategory] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [activeView, setActiveView] = useState<'downloads' | 'video_sniffer' | 'browser_hub'>('downloads');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [scheduledItem, setScheduledItem] = useState<DownloadItem | null>(null);
  const [detailedItem, setDetailedItem] = useState<DownloadItem | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const accentClasses = getAccentClasses(settings.accentColor);

  // Desktop app: replace the placeholder download folder with the real Windows Downloads\NOVA folder
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    if (settings.defaultFolder !== 'C:\\Downloads\\NOVA') return;
    getNativeDefaultFolder().then((dir) => {
      if (dir) setSettings((prev) => ({ ...prev, defaultFolder: dir }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync state to storage
  useEffect(() => {
    saveStoredDownloads(downloads);
  }, [downloads]);

  useEffect(() => {
    saveStoredSettings(settings);
  }, [settings]);

  useEffect(() => {
    saveStoredCustomCategories(customCategories);
  }, [customCategories]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Play audio chime on completion if enabled
  const playChime = () => {
    if (!settings.soundNotification) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch {
      // AudioContext muted/unsupported
    }
  };

  // Tracks active in-flight real stream tasks to prevent duplicate downloads
  const activeTransfersRef = useRef<Set<string>>(new Set());

  // 1. WEB PREVIEW DOWNLOAD WORKER: (Only runs in dev/browser preview; in native desktop, Rust engine executes transfers)
  useEffect(() => {
    if (isTauriEnvironment()) {
      return;
    }

    downloads.forEach((item) => {
      if (item.status === 'downloading' && !activeTransfersRef.current.has(item.id)) {
        activeTransfersRef.current.add(item.id);

        startRealDownload(item, (update) => {
          setDownloads((prev) =>
            prev.map((d) => {
              if (d.id !== item.id) return d;

              const now = Date.now();
              const newSpeed = update.speed || 0;
              const currentHistory = d.speedHistory || [];
              const updatedHistory = [
                ...currentHistory.slice(-50),
                { time: now, speed: update.isFinished ? 0 : newSpeed },
              ];

              if (update.isFinished) {
                activeTransfersRef.current.delete(item.id);
                playChime();
                showToast(`Download Complete: ${item.filename}`);

                return {
                  ...d,
                  downloadedBytes: update.downloadedBytes,
                  speed: 0,
                  status: 'completed',
                  dateFinished: now,
                  segments: update.segments,
                  speedHistory: updatedHistory,
                  sha256Calculated: update.sha256Calculated || d.sha256Calculated,
                  blobUrl: update.blobUrl || d.blobUrl,
                };
              }

              if (update.error) {
                activeTransfersRef.current.delete(item.id);
                showToast(`Download Error: ${update.error}`);
                return {
                  ...d,
                  speed: 0,
                  status: 'error',
                  errorMessage: update.error,
                };
              }

              // Real byte progress delivered by network reader
              return {
                ...d,
                downloadedBytes: update.downloadedBytes,
                speed: newSpeed,
                segments: update.segments,
                speedHistory: updatedHistory,
              };
            })
          );
        }).catch((err) => {
          activeTransfersRef.current.delete(item.id);
          setDownloads((prev) =>
            prev.map((d) => (d.id === item.id ? { ...d, status: 'error', errorMessage: err.message, speed: 0 } : d))
          );
        });
      }
    });
  }, [downloads]);

  // 2. SCHEDULER & QUEUE ORCHESTRATION (No fake byte generation)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      setDownloads((prevDownloads) => {
        let hasChanges = false;
        const triggeredNames: string[] = [];

        // Check scheduled downloads whose time has arrived
        let updated = prevDownloads.map((item) => {
          if (item.status === 'scheduled' && item.scheduledTime && now >= item.scheduledTime) {
            hasChanges = true;
            triggeredNames.push(item.filename);
            return {
              ...item,
              status: 'downloading' as const,
              scheduledTime: undefined,
              dateAdded: now,
            };
          }
          return item;
        });

        if (triggeredNames.length > 0) {
          playChime();
          showToast(`Scheduled timer triggered: ${triggeredNames.join(', ')}`);
        }

        // Queue scheduler promotion
        const downloadingCount = updated.filter((d) => d.status === 'downloading').length;
        if (downloadingCount < settings.maxConcurrentDownloads) {
          const slots = settings.maxConcurrentDownloads - downloadingCount;
          let promoted = 0;
          updated = updated.map((item) => {
            if (item.status === 'queued' && promoted < slots) {
              promoted++;
              hasChanges = true;
              return { ...item, status: 'downloading' as const };
            }
            return item;
          });
        }

        return hasChanges ? updated : prevDownloads;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [settings.maxConcurrentDownloads]);

  // 3. BACKEND SYNC: Synchronize actual engine state and downloads queued via extension
  useEffect(() => {
    let isSubscribed = true;
    const syncWithBackend = async () => {
      try {
        const backendItems = await fetchAllDownloads();
        if (!isSubscribed || !backendItems) return;

        setDownloads((prev) => {
          const backendMap = new Map(backendItems.map((b) => [b.id, b]));

          // Update existing downloads with actual native engine state
          const updated = prev.map((item) => {
            const b = backendMap.get(item.id);
            if (!b) return item;
            return {
              ...item,
              filename: item.protocol === 'video' && b.filename ? b.filename : item.filename,
              directory: item.protocol === 'video' && b.directory ? b.directory : item.directory,
              downloadedBytes: b.downloadedBytes,
              totalBytes: b.totalBytes || item.totalBytes,
              status: b.status,
              speed: b.speed || (b.status === 'downloading' ? item.speed : 0),
              dateFinished: b.dateFinished || item.dateFinished,
              errorMessage: b.errorMessage || item.errorMessage,
            };
          });

          // Add new items from native backend / extension
          const existingIds = new Set(prev.map((d) => d.id));
          const newItems = backendItems.filter((b) => !existingIds.has(b.id));
          if (newItems.length > 0) {
            showToast(`Received ${newItems.length} download(s) from native engine`);
            return [...newItems, ...updated];
          }
          return updated;
        });
      } catch {
        // Standby
      }
    };

    const syncInterval = setInterval(syncWithBackend, 2500);
    return () => {
      isSubscribed = false;
      clearInterval(syncInterval);
    };
  }, []);

  // 4. LIVE TAURI EVENTS: Real-time progress, speed, segments, completion, and errors
  useEffect(() => {
    if (!isTauriEnvironment()) return;

    let cleanupFn: (() => void) | undefined;
    setupNativeDownloadListeners({
      onProgress: (payload) => {
        setDownloads((prev) =>
          prev.map((d) => {
            if (d.id !== payload.id) return d;
            const now = Date.now();
            const currentHistory = d.speedHistory || [];
            const updatedHistory = [
              ...currentHistory.slice(-50),
              { time: now, speed: payload.speed_bytes_sec },
            ];
            const mappedSegments = payload.segments.map((s) => ({
              id: s.id,
              startByte: s.start_byte,
              endByte: s.end_byte,
              downloadedBytes: s.downloaded_bytes,
              speed: s.speed_bytes_sec,
              isFinished: s.is_finished,
              isActive: !s.is_finished,
            }));

            return {
              ...d,
              filename: payload.filename ? payload.filename : d.filename,
              etaSeconds: payload.eta_seconds,
              downloadedBytes: payload.downloaded_bytes,
              totalBytes: payload.total_bytes > 0 ? payload.total_bytes : d.totalBytes,
              speed: payload.speed_bytes_sec,
              status: 'downloading',
              segments: mappedSegments.length > 0 ? mappedSegments : d.segments,
              speedHistory: updatedHistory,
            };
          })
        );
      },
      onCompleted: (payload) => {
        playChime();
        setDownloads((prev) =>
          prev.map((d) => {
            if (d.id !== payload.id) return d;
            return {
              ...d,
              filename: payload.filename ? payload.filename : d.filename,
              etaSeconds: 0,
              downloadedBytes: payload.total_bytes > 0 ? payload.total_bytes : d.totalBytes,
              totalBytes: payload.total_bytes > 0 ? payload.total_bytes : d.totalBytes,
              speed: 0,
              status: 'completed',
              dateFinished: Date.now(),
              sha256Calculated: payload.sha256_calculated || d.sha256Calculated,
            };
          })
        );
        showToast(`Download Complete: ${payload.filename || payload.id}`);
      },
      onError: (payload) => {
        setDownloads((prev) =>
          prev.map((d) => {
            if (d.id !== payload.id) return d;
            return {
              ...d,
              speed: 0,
              status: 'error',
              errorMessage: payload.error,
            };
          })
        );
        showToast(`Download Error: ${payload.error}`);
      },
      onStatusChanged: (payload) => {
        setDownloads((prev) =>
          prev.map((d) => {
            if (d.id !== payload.id) return d;
            return {
              ...d,
              status: payload.status as any,
              speed: payload.status === 'downloading' ? d.speed : 0,
            };
          })
        );
      },
    }).then((unlisten) => {
      cleanupFn = unlisten;
    });

    return () => {
      if (cleanupFn) cleanupFn();
    };
  }, []);

  // Global aggregate download speed
  const totalSpeed = downloads
    .filter(d => d.status === 'downloading')
    .reduce((acc, curr) => acc + curr.speed, 0);

  const activeCount = downloads.filter(d => d.status === 'downloading').length;

  // Filter downloads
  const filteredDownloads = downloads.filter(item => {
    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.filename.toLowerCase().includes(q);
      const matchUrl = item.url.toLowerCase().includes(q);
      const matchHash = item.sha256Calculated?.toLowerCase().includes(q) || item.sha256Expected?.toLowerCase().includes(q);
      if (!matchName && !matchUrl && !matchHash) return false;
    }

    // Custom category filter
    if (selectedCustomCategory) {
      const cat = customCategories.find(c => c.id === selectedCustomCategory);
      if (cat) {
        const ext = item.filename.split('.').pop()?.toLowerCase() || '';
        return cat.extensions.includes(ext) || item.customCategoryName === cat.name;
      }
    }

    // Main category filter
    switch (selectedCategory) {
      case 'downloading':
        return item.status === 'downloading';
      case 'scheduled':
        return item.status === 'scheduled';
      case 'queued':
        return item.status === 'queued';
      case 'completed':
        return item.status === 'completed';
      case 'failed':
        return item.status === 'error' || item.status === 'paused';
      case 'video_audio':
        return item.category === 'video_audio';
      case 'documents':
        return item.category === 'documents';
      case 'compressed':
        return item.category === 'compressed';
      case 'applications':
        return item.category === 'applications';
      case 'all':
      default:
        return true;
    }
  });

  // Action Handlers
  const handleToggleSelect = (id: string, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredDownloads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDownloads.map(d => d.id)));
    }
  };

  const handleResume = async (id: string) => {
    activeTransfersRef.current.delete(id);
    try {
      await invokeCommand('resume_download', { id });
      setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'downloading', scheduledTime: undefined, errorMessage: undefined } : d));
      showToast('Download resumed');
    } catch (err: any) {
      setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'error', errorMessage: err.message } : d));
      showToast(`Resume failed: ${err.message}`);
    }
  };

  const handlePause = async (id: string) => {
    activeTransfersRef.current.delete(id);
    pauseRealDownload(id);
    try {
      await invokeCommand('pause_download', { id });
      setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'paused', speed: 0 } : d));
      showToast('Download paused');
    } catch (err: any) {
      showToast(`Pause failed: ${err.message}`);
    }
  };

  const handleStop = async (id: string) => {
    activeTransfersRef.current.delete(id);
    pauseRealDownload(id);
    try {
      await invokeCommand('cancel_download', { id });
      setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'paused', speed: 0 } : d));
      showToast('Download stopped');
    } catch (err: any) {
      showToast(`Stop failed: ${err.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    activeTransfersRef.current.delete(id);
    cancelRealDownload(id);
    try {
      await invokeCommand('delete_download_item', { id });
      setDownloads(prev => prev.filter(d => d.id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showToast('Removed from download list');
    } catch (err: any) {
      showToast(`Delete failed: ${err.message}`);
    }
  };

  // Video-site links go to the video downloader; everything else to the normal engine
  const startNativeDownload = (item: DownloadItem) =>
    item.protocol === 'video'
      ? invokeCommand('start_video_download', {
          request: {
            id: item.id,
            url: item.url,
            directory: item.directory,
            quality: item.videoQuality || 'best',
          },
        })
      : invokeCommand('start_download', { request: item });

  const handleRetry = async (id: string) => {
    activeTransfersRef.current.delete(id);
    const item = downloads.find(d => d.id === id);
    if (!item) return;
    try {
      await startNativeDownload(item);
      setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'downloading', errorMessage: undefined } : d));
      showToast('Retrying transfer');
    } catch (err: any) {
      setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'error', errorMessage: err.message } : d));
      showToast(`Retry failed: ${err.message}`);
    }
  };

  const handleResumeSelected = async () => {
    let successCount = 0;
    let failCount = 0;
    for (const id of Array.from(selectedIds)) {
      activeTransfersRef.current.delete(id);
      try {
        await invokeCommand('resume_download', { id });
        successCount++;
        setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'downloading', scheduledTime: undefined } : d));
      } catch {
        failCount++;
      }
    }
    if (failCount > 0) {
      showToast(`Resumed ${successCount} downloads (${failCount} failed)`);
    } else {
      showToast(`Resumed ${successCount} downloads`);
    }
  };

  const handlePauseSelected = async () => {
    for (const id of Array.from(selectedIds)) {
      activeTransfersRef.current.delete(id);
      pauseRealDownload(id);
      try {
        await invokeCommand('pause_download', { id });
        setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'paused', speed: 0 } : d));
      } catch {}
    }
    showToast(`Paused selected downloads`);
  };

  const handleStopSelected = async () => {
    for (const id of Array.from(selectedIds)) {
      activeTransfersRef.current.delete(id);
      pauseRealDownload(id);
      try {
        await invokeCommand('cancel_download', { id });
        setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'paused', speed: 0 } : d));
      } catch {}
    }
    showToast(`Stopped selected downloads`);
  };

  const handleClearCompleted = () => {
    setDownloads(prev => prev.filter(d => d.status !== 'completed'));
    setSelectedIds(new Set());
    showToast('Cleaned completed downloads');
  };

  const handleAddDownload = async (item: DownloadItem, startImmediately: boolean) => {
    try {
      if (startImmediately) {
        await startNativeDownload(item);
        showToast(`Started: ${item.filename}`);
      } else {
        showToast(`Queued: ${item.filename}`);
      }
      setDownloads(prev => [item, ...prev]);
    } catch (err: any) {
      showToast(`Failed to add download: ${err.message}`);
      setDownloads(prev => [{ ...item, status: 'error', errorMessage: err.message }, ...prev]);
    }
  };

  const handleOpenFile = (item: DownloadItem) => {
    showToast(`Opening file: ${item.filename}`);
  };

  const handleOpenFolder = (item: DownloadItem) => {
    showToast(`Opening directory in Explorer: ${item.directory}`);
  };

  const handleOpenSchedule = (item: DownloadItem) => {
    setScheduledItem(item);
    setIsScheduleModalOpen(true);
  };

  const handleSaveSchedule = (id: string, targetTimestamp: number, customSpeedLimit?: number) => {
    setDownloads(prev => prev.map(d => {
      if (d.id === id) {
        return {
          ...d,
          status: 'scheduled' as const,
          scheduledTime: targetTimestamp,
          speed: 0,
        };
      }
      return d;
    }));
    const target = downloads.find(d => d.id === id);
    showToast(`Scheduled "${target?.filename || 'download'}" for ${formatScheduledDateTime(targetTimestamp)}`);
  };

  const handleCancelSchedule = (id: string) => {
    setDownloads(prev => prev.map(d => {
      if (d.id === id) {
        return {
          ...d,
          status: 'paused' as const,
          scheduledTime: undefined,
        };
      }
      return d;
    }));
    showToast('Cancelled download schedule');
  };

  const handleScheduleSelected = () => {
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      const item = downloads.find(d => d.id === id);
      if (item) {
        handleOpenSchedule(item);
      }
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0c0e12] text-slate-100 select-none overflow-hidden">
      {/* Windows 11 Fluent TitleBar */}
      <TitleBar
        totalSpeed={totalSpeed}
        activeCount={activeCount}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        settings={settings}
        accentClasses={accentClasses}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onOpenAbout={() => setIsAboutModalOpen(true)}
      />

      {/* IDM-Style Elevated Power Toolbar */}
      <TopToolbar
        onAddClick={() => setIsAddModalOpen(true)}
        onResumeSelected={handleResumeSelected}
        onPauseSelected={handlePauseSelected}
        onStopSelected={handleStopSelected}
        onScheduleSelected={handleScheduleSelected}
        onClearCompleted={handleClearCompleted}
        selectedCount={selectedIds.size}
        totalCount={downloads.length}
        settings={settings}
        onUpdateSettings={(newSet) => setSettings(prev => ({ ...prev, ...newSet }))}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onOpenBrowserHub={() => setActiveView('browser_hub')}
        onOpenVideoSniffer={() => setActiveView('video_sniffer')}
        activeView={activeView}
        setActiveView={setActiveView}
        accentClasses={accentClasses}
      />

      {/* Main App Body Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar
          selectedCategory={selectedCategory}
          onSelectCategory={(cat) => {
            setSelectedCategory(cat);
            setSelectedCustomCategory(undefined);
            setActiveView('downloads');
          }}
          selectedCustomCategory={selectedCustomCategory}
          onSelectCustomCategory={(catId) => {
            setSelectedCustomCategory(catId);
            setActiveView('downloads');
          }}
          downloads={downloads}
          customCategories={customCategories}
          onAddCustomCategory={(cat) => setCustomCategories(prev => [...prev, cat])}
          onDeleteCustomCategory={(id) => setCustomCategories(prev => prev.filter(c => c.id !== id))}
          accentClasses={accentClasses}
          onOpenBrowserHub={() => setActiveView('browser_hub')}
          onOpenAbout={() => setIsAboutModalOpen(true)}
        />

        {/* View Switcher Viewport */}
        {activeView === 'downloads' && (
          <DownloadTable
            downloads={filteredDownloads}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onResume={handleResume}
            onPause={handlePause}
            onStop={handleStop}
            onDelete={handleDelete}
            onRetry={handleRetry}
            onOpenSchedule={handleOpenSchedule}
            onOpenDetails={(item) => setDetailedItem(item)}
            onOpenFile={handleOpenFile}
            onOpenFolder={handleOpenFolder}
            density={settings.density}
            accentClasses={accentClasses}
            onAddClick={() => setIsAddModalOpen(true)}
          />
        )}

        {activeView === 'video_sniffer' && (
          <VideoSnifferLab
            settings={settings}
            onUpdateSettings={(newSet) => setSettings(prev => ({ ...prev, ...newSet }))}
            onAddDownload={handleAddDownload}
            accentClasses={accentClasses}
          />
        )}

        {activeView === 'browser_hub' && (
          <BrowserExtensionHub
            settings={settings}
            accentClasses={accentClasses}
          />
        )}
      </div>

      {/* Modals */}
      <AddDownloadModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddDownload={handleAddDownload}
        settings={settings}
        accentClasses={accentClasses}
      />

      <ScheduleModal
        isOpen={isScheduleModalOpen}
        item={scheduledItem}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setScheduledItem(null);
        }}
        onSaveSchedule={handleSaveSchedule}
        onCancelSchedule={handleCancelSchedule}
        onStartNow={(id) => {
          handleResume(id);
          setIsScheduleModalOpen(false);
          setScheduledItem(null);
        }}
        accentClasses={accentClasses}
      />

      <DownloadDetailsModal
        item={detailedItem ? (downloads.find(d => d.id === detailedItem.id) || detailedItem) : null}
        onClose={() => setDetailedItem(null)}
        accentClasses={accentClasses}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={(newSet) => setSettings(prev => ({ ...prev, ...newSet }))}
        accentClasses={accentClasses}
        onClearHistory={() => setDownloads([])}
        totalDownloadsCount={downloads.length}
      />

      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={() => setIsAboutModalOpen(false)}
        accentClasses={accentClasses}
      />

      {/* Global Windows Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#161a24] border border-white/[0.15] text-slate-100 text-xs px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in">
          <div className={`w-2 h-2 rounded-full ${accentClasses.bg}`} />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
