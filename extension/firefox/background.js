/**
 * NOVA Download Manager - Firefox WebExtension Background Script
 * Handles download interception, context menu and the connection to the NOVA desktop app.
 *
 * Connection: the extension talks directly to NOVA on this PC (127.0.0.1:9654). No extra
 * helper program or registry entry is needed. Native messaging is only kept as a fallback.
 */

const NATIVE_HOST_NAME = "com.nova.downloadmanager";
const NOVA_PORT = 9654;
const DUP_TIMEOUT_MS = 4000;
const RECENT_DOWNLOADS_CACHE = new Map();

const ENDPOINTS = {
  ping: "ping",
  can_handle: "can_handle",
  video_info: "video_info",
  add_download: "downloads"
};

async function novaHttp(message, timeoutMs) {
  const ep = ENDPOINTS[message.action] || message.action;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch("http://127.0.0.1:" + NOVA_PORT + "/api/" + ep, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: ctl.signal
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { reachable: true, httpOk: res.ok, data };
  } catch (e) {
    return { reachable: false, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Sends a message to NOVA and always resolves with a host-style response object. */
async function novaSend(message, timeoutMs = 6000) {
  const r = await novaHttp(message, timeoutMs);
  if (r.reachable) {
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
  // NOVA not reachable over HTTP: try the native messaging helper as a fallback
  try {
    const response = await browser.runtime.sendNativeMessage(NATIVE_HOST_NAME, message);
    if (response) return response;
  } catch (e) { /* ignore */ }
  return { status: "offline", accepted: false, error: "NOVA_ENGINE_NOT_RUNNING", detail: r.error };
}

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
      sendDownloadToNova({ url: targetUrl, referrer: tab ? tab.url : undefined });
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

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:", "ftp:", "ftps:", "sftp:"]);

// Intercept browser downloads (on by default, can be switched off in the extension settings)
browser.downloads.onCreated.addListener(async (downloadItem) => {
  const settings = await browser.storage.local.get(["autoIntercept"]);
  if (settings.autoIntercept === false) return;

  const url = downloadItem.url;
  if (!url) return;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return;
  }
  if (!SUPPORTED_PROTOCOLS.has(parsedUrl.protocol)) return;

  const { excludedDomains } = await browser.storage.local.get("excludedDomains");
  if (excludedDomains && excludedDomains.some(d => parsedUrl.hostname.includes(d))) return;

  const now = Date.now();
  if (RECENT_DOWNLOADS_CACHE.has(url)) {
    const prev = RECENT_DOWNLOADS_CACHE.get(url);
    if (now - prev < DUP_TIMEOUT_MS) return;
  }
  RECENT_DOWNLOADS_CACHE.set(url, now);

  const response = await novaSend({
    action: "can_handle",
    url: downloadItem.url,
    filename: downloadItem.filename || extractFilename(downloadItem.url),
    referrer: downloadItem.referrer || parsedUrl.origin,
    totalBytes: downloadItem.totalBytes > 0 ? downloadItem.totalBytes : undefined,
    mimeType: downloadItem.mime,
    client: "firefox-extension",
    timestamp: now
  });

  // Only cancel the browser download AFTER NOVA has accepted it
  if (response && (response.accepted === true || response.status === "accepted")) {
    try {
      await browser.downloads.cancel(downloadItem.id);
      await browser.downloads.erase({ id: downloadItem.id });
    } catch (e) { /* ignore */ }
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
    novaSend({
      action: "can_handle",
      url: request.url,
      video: true,
      quality: request.quality || "best",
      client: "firefox-extension",
      timestamp: Date.now()
    }).then(res => sendResponse(res));
    return true;
  }
  if (request.action === "video_info") {
    novaSend({ action: "video_info", url: request.url }, 90000).then(res => sendResponse(res));
    return true;
  }
  if (request.action === "check_native_status") {
    novaSend({ action: "ping" }, 3000).then((r) => {
      sendResponse({ status: { connected: r && r.accepted === true, response: r, error: r && r.error } });
    });
    return true;
  }
});

async function sendDownloadToNova(payload) {
  return novaSend({
    action: "can_handle",
    url: payload.url,
    filename: payload.filename || extractFilename(payload.url),
    referrer: payload.referrer,
    client: "firefox-extension",
    timestamp: Date.now()
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
