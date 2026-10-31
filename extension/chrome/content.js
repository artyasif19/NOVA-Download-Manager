/**
 * NOVA Download Manager - Browser Content Script
 * Floating Media Sniffer for HTML5 <video> and <audio> elements
 * with DRM Protection Awareness & Stream Detection
 */

(function () {
  const PROCESSED_ATTR = "data-nova-grabber-attached";

  // Check if current domain is excluded or sniffer is disabled
  chrome.storage.local.get(["enableFloatingSniffer", "excludedDomains", "minDuration"], (settings) => {
    if (settings.enableFloatingSniffer === false) return;

    const currentHost = window.location.hostname;
    if (settings.excludedDomains && settings.excludedDomains.includes(currentHost)) {
      return;
    }

    const minDuration = settings.minDuration || 5;
    initMediaObserver(minDuration);
  });

  // Listen for background requests (e.g. gather all links)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "gather_all_page_links") {
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map(a => a.href)
        .filter(href => href.startsWith("http://") || href.startsWith("https://") || href.startsWith("ftp://"));
      
      const uniqueLinks = Array.from(new Set(links));
      sendResponse({ links: uniqueLinks });
    }
  });

  function initMediaObserver(minDuration) {
    scanMediaElements(minDuration);

    const observer = new MutationObserver(() => {
      scanMediaElements(minDuration);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function scanMediaElements(minDuration) {
    const mediaElements = document.querySelectorAll("video, audio");
    mediaElements.forEach(el => attachGrabberToMedia(el, minDuration));
  }

  function attachGrabberToMedia(mediaEl, minDuration) {
    if (mediaEl.hasAttribute(PROCESSED_ATTR)) return;
    mediaEl.setAttribute(PROCESSED_ATTR, "true");

    const checkAndMount = () => {
      if (mediaEl.duration && mediaEl.duration < minDuration) return;
      mountOverlayButton(mediaEl);
    };

    if (mediaEl.readyState >= 1) {
      checkAndMount();
    } else {
      mediaEl.addEventListener("loadedmetadata", checkAndMount, { once: true });
    }
  }

  function mountOverlayButton(mediaEl) {
    const rect = mediaEl.getBoundingClientRect();
    if (rect.width < 140 || rect.height < 90) return; // Ignore microscopic elements

    // Check if media is DRM encrypted via HTMLMediaElement.mediaKeys
    const isDrmProtected = Boolean(mediaEl.mediaKeys || (mediaEl.getAttribute && mediaEl.getAttribute("data-drm")));

    const wrapper = document.createElement("div");
    wrapper.className = "nova-floating-grabber-wrapper";
    wrapper.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 2147483647;
      pointer-events: auto;
    `;

    const button = document.createElement("div");
    button.style.cssText = `
      background: rgba(14, 18, 25, 0.94);
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid ${isDrmProtected ? 'rgba(244, 63, 94, 0.5)' : 'rgba(6, 182, 212, 0.4)'};
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      transition: all 0.2s ease;
    `;

    button.innerHTML = isDrmProtected ? `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <span style="color: #fca5a5;">DRM Protected</span>
    ` : `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Download ${mediaEl.tagName.toLowerCase() === 'video' ? 'Video' : 'Audio'}</span>
    `;

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (isDrmProtected) {
        showTemporaryNotice(wrapper, "This stream uses Encrypted Media DRM (Widevine / PlayReady). Protected streams cannot be downloaded.", true);
        return;
      }

      // Detect source URL from currentSrc, src attribute, or nested <source>
      let mediaSrc = mediaEl.currentSrc || mediaEl.src;
      if (!mediaSrc) {
        const sourceChild = mediaEl.querySelector("source");
        if (sourceChild) mediaSrc = sourceChild.src;
      }

      if (!mediaSrc || mediaSrc.startsWith("blob:") && !isHlsOrDash(mediaSrc)) {
        showTemporaryNotice(wrapper, "Direct media stream URL is inaccessible or hidden behind proprietary player.", false);
        return;
      }

      // Send to background service worker
      chrome.runtime.sendMessage({
        action: "send_to_nova",
        url: mediaSrc,
        filename: document.title ? `${document.title.replace(/[<>:"/\\|?*]/g, '_')}.mp4` : "video.mp4"
      }, (res) => {
        showTemporaryNotice(wrapper, "Sent to NOVA Download Manager!", false);
      });
    });

    wrapper.appendChild(button);

    // Mount relative to parent or positioning context
    const parent = mediaEl.parentElement;
    if (parent) {
      const parentPos = window.getComputedStyle(parent).position;
      if (parentPos === "static") {
        parent.style.position = "relative";
      }
      parent.appendChild(wrapper);
    }
  }

  function isHlsOrDash(url) {
    const lower = url.toLowerCase();
    return lower.includes(".m3u8") || lower.includes(".mpd");
  }

  function showTemporaryNotice(container, message, isError) {
    const notice = document.createElement("div");
    notice.style.cssText = `
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      width: 200px;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 10px;
      background: ${isError ? 'rgba(30, 10, 15, 0.95)' : 'rgba(10, 25, 20, 0.95)'};
      border: 1px solid ${isError ? 'rgba(244, 63, 94, 0.4)' : 'rgba(16, 185, 129, 0.4)'};
      color: ${isError ? '#fca5a5' : '#6ee7b7'};
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      z-index: 2147483647;
      animation: fadeIn 0.2s ease;
    `;
    notice.textContent = message;
    container.appendChild(notice);
    setTimeout(() => notice.remove(), 3500);
  }
})();
