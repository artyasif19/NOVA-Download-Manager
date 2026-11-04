/**
 * NOVA Download Manager - Chrome / Edge / Brave Manifest V3 Service Worker
 * Handles download interception, context menu, and native messaging bridge
 */

const NATIVE_HOST_NAME = "com.nova.downloadmanager";
const RECENT_DOWNLOADS_CACHE = new Map(); // url -> timestamp (prevent duplicate loops)
const DUP_TIMEOUT_MS = 10000;

// Create context menus upon installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "nova-download-link",
      title: "Download with NOVA",
      contexts: ["link", "video", "audio", "image", "selection"]
    });

    chrome.contextMenus.create({
      id: "nova-download-all-links",
      title: "Download All Links on Page with NOVA",
      contexts: ["page"]
    });
  });
});

// Context menu click listener
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "nova-download-link") {
    let targetUrl = info.linkUrl || info.srcUrl;
    if (!targetUrl && info.selectionText) {
      const match = info.selectionText.match(/https?:\/\/[^\s]+/i);
      if (match) targetUrl = match[0];
    }

    if (targetUrl) {
      sendDownloadToNova({
        url: targetUrl,
        referrer: tab?.url,
        category: info.mediaType === "video" || info.mediaType === "audio" ? "video_audio" : undefined,
      });
    }
  } else if (info.menuItemId === "nova-download-all-links" && tab?.id) {
    // Send message to content script to gather all links
    chrome.tabs.sendMessage(tab.id, { action: "gather_all_page_links" }, (response) => {
      if (response && response.links && response.links.length > 0) {
        response.links.forEach(linkUrl => {
          sendDownloadToNova({ url: linkUrl, referrer: tab.url });
        });
      }
    });
  }
});

// Safe protocol allowlist for download interception
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:", "ftp:", "ftps:", "sftp:"]);

// Intercept browser downloads ONLY if user explicitly enabled automatic interception AND handoff verification has passed
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  const { autoIntercept, handoffVerified } = await chrome.storage.local.get(["autoIntercept", "handoffVerified"]);
  // Disabled by default: require explicit user opt-in and verified handoff test
  if (autoIntercept !== true || handoffVerified !== true) return;

  const url = downloadItem.url;
  if (!url) return;

  // Validate protocol: never intercept internal, blob, data, or file schemes
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return;
  }

  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
    return;
  }

  // Check exclusion list
  const { excludedDomains } = await chrome.storage.local.get("excludedDomains");
  if (excludedDomains && excludedDomains.some(d => parsedUrl.hostname.includes(d))) {
    return;
  }

  // Duplicate prevention check (avoids intercepting downloads triggered by NOVA itself)
  const now = Date.now();
  if (RECENT_DOWNLOADS_CACHE.has(url)) {
    const prev = RECENT_DOWNLOADS_CACHE.get(url);
    if (now - prev < DUP_TIMEOUT_MS) {
      return;
    }
  }

  // IMPORTANT: CRITICAL HANDOFF PROTOCOL TO PREVENT DOWNLOAD LOSS
  // Do NOT cancel the browser download here!
  // First, verify that the NOVA native host is running and explicitly ACCEPTS the download.
  // If the host is unavailable, encounters an error, or declines, leave the browser download untouched.
  RECENT_DOWNLOADS_CACHE.set(url, now);

  const handoffPayload = {
    action: "can_handle",
    url: downloadItem.url,
    filename: downloadItem.filename || extractFilename(downloadItem.url),
    referrer: downloadItem.referrer || parsedUrl.origin,
    totalBytes: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : undefined,
    mimeType: downloadItem.mime,
    client: "chromium-extension",
    timestamp: now
  };

  try {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, handoffPayload, (response) => {
      if (chrome.runtime.lastError) {
        // Native host is not running, not registered, or disconnected.
        // PRESERVE BROWSER DOWNLOAD: Do NOT cancel the browser download!
        console.warn(
          "[NOVA Extension] Native host unavailable (" + chrome.runtime.lastError.message +
          "). Allowing browser download to proceed safely without loss."
        );
        return;
      }

      // Check if NOVA explicitly accepted the download
      if (response && (response.accepted === true || response.status === "accepted")) {
        console.log("[NOVA Extension] Download accepted by NOVA host. Cancelling browser download:", downloadItem.id);
        // Only cancel browser download AFTER confirmation that NOVA has queued it
        chrome.downloads.cancel(downloadItem.id, () => {
          if (!chrome.runtime.lastError) {
            chrome.downloads.erase({ id: downloadItem.id });
          }
        });
      } else {
        // NOVA host responded but declined or could not accept
        console.log("[NOVA Extension] Host rejected or deferred handoff. Preserving browser download:", response);
      }
    });
  } catch (err) {
    console.warn("[NOVA Extension] Failed to send native message. Preserving browser download:", err);
  }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "send_to_nova") {
    sendDownloadToNova({
      url: message.url,
      filename: message.filename,
      referrer: sender.tab?.url,
      category: "video_audio",
      headers: message.headers,
    }, (result) => {
      sendResponse(result);
    });
    return true; // Keep message channel open for async response
  } else if (message.action === "send_video_page") {
    // A page link from a video site (YouTube etc.): NOVA's video downloader takes over
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
        action: "can_handle",
        url: message.url,
        video: true,
        quality: message.quality || "best",
        client: "chromium-extension",
        timestamp: Date.now()
      }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ status: "error", error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    } catch (err) {
      sendResponse({ status: "error", error: String(err) });
    }
    return true;
  } else if (message.action === "check_native_status") {
    pingNativeHost((status) => {
      sendResponse({ status });
    });
    return true; // async sendResponse
  }
});

// Send message to Windows Native Messaging Host with callback
function sendDownloadToNova(details, callback) {
  const message = {
    action: "add_download",
    url: details.url,
    filename: details.filename || extractFilename(details.url),
    headers: details.referrer ? { "Referer": details.referrer, ...(details.headers || {}) } : details.headers,
    category: details.category || "documents",
    client: "chromium-extension",
    timestamp: Date.now()
  };

  try {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[NOVA Extension] Native Host error:", chrome.runtime.lastError.message);
        if (callback) callback({ status: "error", error: chrome.runtime.lastError.message });
      } else {
        console.log("[NOVA Extension] NOVA host response:", response);
        if (callback) callback(response);
      }
    });
  } catch (err) {
    console.error("[NOVA Extension] Connection failure:", err);
    if (callback) callback({ status: "error", error: String(err) });
  }
}

function pingNativeHost(callback) {
  try {
    chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, { action: "ping" }, (response) => {
      if (chrome.runtime.lastError) {
        callback({ connected: false, error: chrome.runtime.lastError.message });
      } else {
        callback({ connected: true, response });
      }
    });
  } catch (e) {
    callback({ connected: false, error: String(e) });
  }
}

function extractFilename(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    return parts.length > 0 ? decodeURIComponent(parts[parts.length - 1]) : "download.dat";
  } catch {
    return "download.dat";
  }
}
