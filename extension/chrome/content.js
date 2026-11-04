/**
 * NOVA Download Manager - floating "Download this video" button (liquid-glass style).
 * Works in Chrome, Edge, Brave, Opera, Vivaldi and Firefox.
 *
 *  - Shows a small glass pill on top of the largest visible video.
 *  - The "-" button shrinks it to a tiny round icon (remembered across pages).
 *  - On YouTube, Vimeo, TikTok, X, Instagram... the page link is sent to NOVA's video downloader.
 *  - On sites with a plain video file / HLS / DASH link the real media link is sent instead.
 */
(function () {
  if (window.__novaGrabberLoaded) return;
  window.__novaGrabberLoaded = true;

  const VIDEO_SITES = [
    "youtube.com", "youtu.be", "youtube-nocookie.com", "vimeo.com", "dailymotion.com",
    "twitch.tv", "tiktok.com", "instagram.com", "facebook.com", "fb.watch",
    "twitter.com", "x.com", "reddit.com", "soundcloud.com", "bilibili.com"
  ];
  const QUALITIES = [
    ["best", "Best quality"],
    ["1080", "1080p"],
    ["720", "720p"],
    ["480", "480p"],
    ["audio", "Audio only (MP3)"]
  ];

  const state = {
    enabled: true,
    minimized: false,
    quality: "best",
    excluded: [],
    minDuration: 5,
    menuOpen: false,
    target: null
  };

  chrome.storage.local.get(
    ["enableFloatingSniffer", "excludedDomains", "minDuration", "novaGrabberMinimized", "novaGrabberQuality"],
    (s) => {
      s = s || {};
      if (s.enableFloatingSniffer === false) return;
      state.excluded = s.excludedDomains || [];
      if (state.excluded.some((d) => location.hostname.includes(d))) return;
      state.minDuration = s.minDuration || 5;
      state.minimized = s.novaGrabberMinimized === true;
      state.quality = s.novaGrabberQuality || "best";
      start();
    }
  );

  // Answer "collect all links" requests from the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "gather_all_page_links") {
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.href)
        .filter((h) => /^(https?|ftp):\/\//i.test(h));
      sendResponse({ links: Array.from(new Set(links)) });
    }
  });

  function isVideoSitePage() {
    const h = location.hostname.toLowerCase();
    return VIDEO_SITES.some((d) => h === d || h.endsWith("." + d));
  }

  function start() {
    const host = document.createElement("div");
    host.id = "nova-grabber-host";
    host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .wrap { position: fixed; display: none; align-items: flex-start; gap: 6px; flex-direction: column; opacity: 0; transition: opacity .2s ease; pointer-events: none; }
        .wrap.show { display: flex; opacity: 1; pointer-events: auto; }
        .glass {
          display: flex; align-items: center; gap: 2px; padding: 3px;
          border-radius: 999px; color: #fff; font-size: 12px; font-weight: 600; user-select: none;
          background: linear-gradient(135deg, rgba(255,255,255,.30), rgba(255,255,255,.10));
          backdrop-filter: blur(18px) saturate(180%); -webkit-backdrop-filter: blur(18px) saturate(180%);
          border: 1px solid rgba(255,255,255,.38);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.55), inset 0 -1px 0 rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.35);
          text-shadow: 0 1px 2px rgba(0,0,0,.45);
        }
        button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 999px; color: inherit; font: inherit; }
        button:hover { background: rgba(255,255,255,.22); }
        .icon-btn { padding: 6px 8px; }
        .mini { width: 34px; height: 34px; padding: 0; justify-content: center; }
        .menu { padding: 5px; border-radius: 16px; flex-direction: column; align-items: stretch; gap: 1px; min-width: 150px; }
        .menu button { border-radius: 11px; font-weight: 500; }
        .menu button.sel { background: rgba(255,255,255,.28); }
        .note { padding: 6px 12px; border-radius: 12px; font-size: 11px; font-weight: 500; max-width: 230px; }
        .note.err { background: linear-gradient(135deg, rgba(244,63,94,.55), rgba(244,63,94,.3)); }
        svg { width: 14px; height: 14px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
        .hidden { display: none !important; }
      </style>
      <div class="wrap" id="wrap">
        <div class="glass" id="bar">
          <button id="main" title="Download this video with NOVA">
            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download</span>
          </button>
          <button id="qual" class="icon-btn" title="Choose quality"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>
          <button id="min" class="icon-btn" title="Minimize"><svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
        </div>
        <div class="glass mini hidden" id="mini" title="NOVA - click to expand">
          <button class="mini" id="expand"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
        </div>
        <div class="glass menu hidden" id="menu"></div>
        <div class="glass note hidden" id="note"></div>
      </div>`;
    (document.documentElement || document.body).appendChild(host);

    const $ = (id) => root.getElementById(id);
    const wrap = $("wrap"), bar = $("bar"), mini = $("mini"), menu = $("menu"), note = $("note");
    let noteTimer = null;

    function renderMode() {
      bar.classList.toggle("hidden", state.minimized);
      mini.classList.toggle("hidden", !state.minimized);
      if (state.minimized) closeMenu();
    }
    function closeMenu() { state.menuOpen = false; menu.classList.add("hidden"); }
    function say(text, isErr) {
      note.textContent = text;
      note.classList.toggle("err", !!isErr);
      note.classList.remove("hidden");
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => note.classList.add("hidden"), 3500);
    }
    function renderMenu() {
      menu.innerHTML = "";
      QUALITIES.forEach(([id, label]) => {
        const b = document.createElement("button");
        b.textContent = label;
        if (id === state.quality) b.className = "sel";
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          state.quality = id;
          chrome.storage.local.set({ novaGrabberQuality: id });
          closeMenu();
          send();
        });
        menu.appendChild(b);
      });
    }

    $("min").addEventListener("click", () => {
      state.minimized = true;
      chrome.storage.local.set({ novaGrabberMinimized: true });
      renderMode();
    });
    $("expand").addEventListener("click", () => {
      state.minimized = false;
      chrome.storage.local.set({ novaGrabberMinimized: false });
      renderMode();
    });
    $("qual").addEventListener("click", () => {
      state.menuOpen = !state.menuOpen;
      if (state.menuOpen) { renderMenu(); menu.classList.remove("hidden"); } else closeMenu();
    });
    $("main").addEventListener("click", () => send());

    function mediaSource(v) {
      let src = v.currentSrc || v.src || "";
      if (!src) {
        const s = v.querySelector("source");
        if (s) src = s.src;
      }
      return src;
    }

    function send() {
      const v = state.target;
      if (!v) return;
      if (v.mediaKeys) {
        say("This video uses DRM protection and cannot be downloaded.", true);
        return;
      }
      const src = mediaSource(v);
      const direct = /^https?:/i.test(src) && !/^blob:/i.test(src);
      const title = (document.title || "video").replace(/[<>:"\/\\|?*]+/g, "_").trim() || "video";

      if (isVideoSitePage() || !direct) {
        // Page link -> NOVA video downloader (handles YouTube etc.)
        if (!/^https?:/i.test(location.href)) { say("Cannot download this page.", true); return; }
        chrome.runtime.sendMessage({ action: "send_video_page", url: location.href, quality: state.quality }, onReply);
      } else {
        chrome.runtime.sendMessage({ action: "send_to_nova", url: src, filename: /\.(mp4|webm|mkv|mov|m4v|mp3|m4a|ogg)(\?|$)/i.test(src) ? undefined : title + ".mp4" }, onReply);
      }
    }
    function onReply(res) {
      if (chrome.runtime.lastError || !res) { say("NOVA is not running. Open NOVA and try again.", true); return; }
      const ok = res.accepted === true || res.status === "accepted" || res.status === "success";
      if (ok) say("Sent to NOVA Download Manager");
      else say(res.error === "NOVA_ENGINE_NOT_RUNNING" ? "NOVA is not running. Open NOVA and try again." : "NOVA could not start this download.", true);
    }

    // ---- choose the video to attach to and keep the widget positioned over it ----
    function visibleArea(v) {
      const r = v.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      return w * h;
    }
    function pickTarget() {
      let best = null, bestScore = 0;
      document.querySelectorAll("video").forEach((v) => {
        const r = v.getBoundingClientRect();
        if (r.width < 200 || r.height < 120) return;
        if (isFinite(v.duration) && v.duration > 0 && v.duration < state.minDuration) return;
        const area = visibleArea(v);
        if (area < 30000) return;
        const score = area * (v.paused ? 1 : 2);
        if (score > bestScore) { best = v; bestScore = score; }
      });
      return best;
    }
    function place() {
      const v = pickTarget();
      state.target = v;
      const fs = document.fullscreenElement;
      if (fs && host.parentElement !== fs && fs.nodeType === 1 && !(fs.tagName === "VIDEO")) fs.appendChild(host);
      else if (!fs && host.parentElement !== document.documentElement) document.documentElement.appendChild(host);
      if (!v) { wrap.classList.remove("show"); closeMenu(); return; }
      const r = v.getBoundingClientRect();
      const w = wrap.offsetWidth || 160;
      const left = Math.min(Math.max(8, r.right - w - 12), innerWidth - w - 8);
      const top = Math.min(Math.max(8, r.top + 12), innerHeight - 50);
      wrap.style.left = left + "px";
      wrap.style.top = top + "px";
      wrap.classList.add("show");
    }

    renderMode();
    setInterval(place, 400);
    addEventListener("scroll", place, { passive: true });
    addEventListener("resize", place);
    place();
  }
})();
