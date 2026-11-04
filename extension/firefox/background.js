/**
 * NOVA Download Manager - Firefox WebExtension Background Script
 * Handles download interception, context menu, and native messaging bridge
 */

const NATIVE_HOST_NAME = "com.nova.downloadmanager";
const DUP_TIMEOUT_MS = 4000;
const RECENT_DOWNLOADS_CACHE = new Map();

// Context Menu Setup
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "nova-download-link",
    title: "Download with NOVA",
    contexts: ["link", "image", "video", "audio"]
  });

  browser.contextMenus.create({
    id: "nova-download-all",
    title: "Download all links with NOVA",
    contexts: ["page"]
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "nova-download-link") {
    const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl;
    if (targetUrl) {
      sendDownloadToNova({
        url: targetUrl,
        referrer: tab ? tab.url : undefined
      });
    }
  } else if (info.menuItemId === "nova-download-all") {
    if (!tab || !tab.id) return;
    browser.tabs.sendMessage(tab.id, { action: "gather_all_page_links" }).then((response) => {
      if (response && response.links && response.links.length > 0) {
        response.links.forEach(linkUrl => {
          sendDownloadToNova({ url: linkUrl, referrer: tab.url });
        });
      }
    }).catch(() => {});
  }
});

// Safe protocol allowlist for download interception
const SUPPORTED_PROTOCOLS = new Set(["http:", "https:", "ftp:", "ftps:", "sftp:"]);

// Intercept browser downloads ONLY if user explicitly enabled automatic interception AND handoff verification has passed
browser.downloads.onCreated.addListener(async (downloadItem) => {
  const settings = await browser.storage.local.get(["autoIntercept", "handoffVerified"]);
  if (settings.autoIntercept !== true || settings.handoffVerified !== true) return;

  const url = downloadItem.url;
  if (!url) return;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return;
  }

  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) {
    return;
  }

  const { excludedDomains } = await browser.storage.local.get("excludedDomains");
  if (excludedDomains && excludedDomains.some(d => parsedUrl.hostname.includes(d))) {
    return;
  }

  const now = Date.now();
  if (RECENT_DOWNLOADS_CACHE.has(url)) {
    const prev = RECENT_DOWNLOADS_CACHE.get(url);
    if (now - prev < DUP_TIMEOUT_MS) return;
  }

  RECENT_DOWNLOADS_CACHE.set(url, now);

  const handoffPayload = {
    action: "can_handle",
    url: downloadItem.url,
    filename: downloadItem.filename || extractFilename(downloadItem.url),
    referrer: downloadItem.referrer || parsedUrl.origin,
    totalBytes: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : undefined,
    mimeType: downloadItem.mime,
    client: "firefox-extension",
    timestamp: now
  };

  try {
    const port = browser.runtime.connectNative(NATIVE_HOST_NAME);
    let resolved = false;

    port.onMessage.addListener(async (response) => {
      resolved = true;
      try {
        if (response && response.accepted === true && response.durable === true) {
          await browser.downloads.cancel(downloadItem.id);
        }
      } catch {}
      port.disconnect();
    });

    port.onDisconnect.addListener(() => {
      if (!resolved) {
        // Native host disconnected or offline: leave browser download alone!
      }
    });

    port.postMessage(handoffPayload);
  } catch {
    // Port open error: leave browser download alone
  }
});

// Runtime messages from content scripts
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "send_to_nova") {
    sendDownloadToNova({
      url: request.url,
      filename: request.filename,
      referrer: sender.tab ? sender.tab.url : undefined
    }).then(res => sendResponse(res));
    return true;
  }
  if (request.action === "send_video_page") {
    sendToHost({
      action: "can_handle",
      url: request.url,
      video: true,
      quality: request.quality || "best",
      client: "firefox-extension"
    }).then(res => sendResponse(res));
    return true;
  }
});

async function sendToHost(payload) {
  return new Promise((resolve) => {
    try {
      const port = browser.runtime.connectNative(NATIVE_HOST_NAME);
      let answered = false;
      port.onMessage.addListener((response) => {
        answered = true;
        resolve(response);
        port.disconnect();
      });
      port.onDisconnect.addListener(() => {
        if (!answered) resolve({ status: "error", error: "Host disconnected" });
      });
      port.postMessage({ ...payload, timestamp: Date.now() });
    } catch (e) {
      resolve({ status: "error", error: e.message });
    }
  });
}

async function sendDownloadToNova(payload) {
  return new Promise((resolve) => {
    try {
      const port = browser.runtime.connectNative(NATIVE_HOST_NAME);
      let answered = false;

      port.onMessage.addListener((response) => {
        answered = true;
        resolve(response);
        port.disconnect();
      });

      port.onDisconnect.addListener(() => {
        if (!answered) resolve({ success: false, error: "Host disconnected" });
      });

      port.postMessage({
        action: "add_download",
        ...payload,
        timestamp: Date.now()
      });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

function extractFilename(urlStr) {
  try {
    const u = new URL(urlStr);
    const p = u.pathname.split("/").filter(Boolean).pop();
    return p ? decodeURIComponent(p) : "download.bin";
  } catch {
    return "download.bin";
  }
}
