/**
 * NOVA Download Manager - Chrome / Edge / Brave Manifest V3 Service Worker
 * Handles download interception, context menu and the connection to the NOVA desktop app.
 *
 * Connection: the extension talks directly to NOVA on this PC (127.0.0.1:9654). No extra
 * helper program or registry entry is needed. Native messaging is only kept as a fallback.
 */

const NATIVE_HOST_NAME = "com.nova.downloadmanager";
const RECENT_DOWNLOADS_CACHE = new Map(); // url -> timestamp (prevent duplicate loops)
const DUP_TIMEOUT_MS = 10000;

const NOVA_PORT_FIRST = 9654;
const NOVA_PORT_LAST = 9674;
let novaPortCache = null;

const ENDPOINTS = {
  ping: "ping",
  can_handle: "can_handle",
  video_info: "video_info",
  add_download: "downloads"
};

async function pingPort(port, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/api/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ping" }),
      signal: ctl.signal
    });
    return res.ok ? port : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** NOVA uses the first free port from 9654 upwards; find the one it is listening on. */
async function findNovaPort() {
  if (novaPortCache) {
    const ok = await pingPort(novaPortCache, 1000);
    if (ok) return ok;
    novaPortCache = null;
  }
  const ports = [];
  for (let p = NOVA_PORT_FIRST; p <= NOVA_PORT_LAST; p++) ports.push(p);
  const found = (await Promise.all(ports.map((p) => pingPort(p, 1200)))).find((p) => p);
  novaPortCache = found || null;
  return novaPortCache;
}

async function novaHttp(message, timeoutMs) {
  const port = await findNovaPort();
  if (!port) return { reachable: false, error: "NOVA is not listening on any local port" };
  const ep = ENDPOINTS[message.action] || message.action;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/api/" + ep, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: ctl.signal
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { reachable: true, httpOk: res.ok, data };
  } catch (e) {
    novaPortCache = null;
    return { reachable: false, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Sends a message to NOVA and always resolves with a host-style response object. */
async function novaSend(message, timeoutMs = 6000) {
  const r = await novaHttp(message, timeoutMs);
  if (!r.reachable) {
    return { status: "offline", accepted: false, error: "NOVA_ENGINE_NOT_RUNNING", detail: r.error };
  }
  const d = r.data || {};
  if (message.action === "ping") {
    return { status: "online", accepted: true, data: d, error: null };
  }
  if (message.action === "video_info") {
    return { status: r.httpOk ? "success" : "error", accepted: r.httpOk, data: d, error: d.error || null };
  }
  const accepted = d.accepted === true;
  return {
    status: accepted ? "accepted" : "rejected",
    accepted,
    data: d,
    error: accepted ? null : (d.reason || d.error || "NOVA declined this download")
  };
}

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

// Intercept browser downloads (on by default, can be switched off in the extension popup)
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  const { autoIntercept } = await chrome.storage.local.get(["autoIntercept"]);
  if (autoIntercept === false) return;

  const url = downloadItem.url;
  if (!url) return;

  // Never intercept internal, blob, data or file schemes
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return;
  }
  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) return;

  const { excludedDomains } = await chrome.storage.local.get("excludedDomains");
  if (excludedDomains && excludedDomains.some(d => parsedUrl.hostname.includes(d))) return;

  // Duplicate prevention (avoids loops for downloads started by NOVA itself)
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
    client: "chromium-extension",
    timestamp: now
  };

  // The browser download is only cancelled AFTER NOVA has accepted it, so nothing is ever lost.
  const response = await novaSend(handoffPayload);
  if (response && (response.accepted === true || response.status === "accepted")) {
    chrome.downloads.cancel(downloadItem.id, () => {
      if (!chrome.runtime.lastError) {
        chrome.downloads.erase({ id: downloadItem.id });
      }
    });
  } else {
    console.log("[NOVA Extension] NOVA did not take this download, keeping the browser download:", response);
  }
});

// Messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "send_to_nova") {
    sendDownloadToNova({
      url: message.url,
      filename: message.filename,
      referrer: sender.tab?.url,
      category: "video_audio",
      headers: message.headers,
    }, (result) => sendResponse(result));
    return true;
  } else if (message.action === "send_video_page") {
    // A page link from a video site (YouTube etc.): NOVA's video downloader takes over
    novaSend({
      action: "can_handle",
      url: message.url,
      video: true,
      quality: message.quality || "best",
      client: "chromium-extension",
      timestamp: Date.now()
    }).then(sendResponse);
    return true;
  } else if (message.action === "send_magnet") {
    novaSend({
      action: "can_handle",
      url: message.url,
      client: "chromium-extension",
      timestamp: Date.now()
    }).then(sendResponse);
    return true;
  } else if (message.action === "video_info") {
    // Resolution list (size, codec, fps, HDR) for the floating button's menu
    novaSend({ action: "video_info", url: message.url }, 90000).then(sendResponse);
    return true;
  } else if (message.action === "check_native_status") {
    novaSend({ action: "ping" }, 3000).then((r) => {
      sendResponse({ status: { connected: r && r.accepted === true, response: r, error: r && r.error } });
    });
    return true;
  }
});

function sendDownloadToNova(details, callback) {
  const message = {
    action: "can_handle",
    url: details.url,
    filename: details.filename || extractFilename(details.url),
    referrer: details.referrer,
    headers: details.referrer ? { "Referer": details.referrer, ...(details.headers || {}) } : details.headers,
    category: details.category || "documents",
    client: "chromium-extension",
    timestamp: Date.now()
  };
  novaSend(message).then((response) => {
    if (callback) callback(response);
  });
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
