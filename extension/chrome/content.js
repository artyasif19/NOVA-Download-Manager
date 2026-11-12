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
        .menu { padding: 5px; border-radius: 16px; flex-direction: column; align-items: stretch; gap: 1px; min-width: 300px; max-height: 340px; overflow-y: auto; }
        .menu button { justify-content: space-between; gap: 14px; }
        .menu .head { font-size: 10px; opacity: .75; padding: 5px 10px 2px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
        .menu .meta { font-size: 10px; opacity: .85; font-weight: 500; white-space: nowrap; }
        .menu .busy { padding: 6px 10px; font-size: 11px; opacity: .85; font-weight: 500; }
        .hdr { margin-left: 5px; padding: 0 4px; border-radius: 4px; background: rgba(251,191,36,.35); font-size: 9px; }
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
    // ---- resolution list (read through NOVA's video engine) ----
    const resName = (h) => (h >= 4320 ? "8K" : h >= 2160 ? "4K" : h >= 1440 ? "2K" : h >= 1080 ? "Full HD" : h >= 720 ? "HD" : "SD");
    const fmtSize = (n, est) => {
      if (!n || n <= 0) return "";
      const txt = n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + " MB";
      return (est ? "~" : "") + txt;
    };
    let cache = { url: "", info: null, loading: false, error: "" };
    function loadInfo() {
      if (!isVideoSitePage() || !/^https?:/i.test(location.href)) return;
      if (cache.url === location.href && (cache.info || cache.loading)) return;
      cache = { url: location.href, info: null, loading: true, error: "" };
      chrome.runtime.sendMessage({ action: "video_info", url: location.href }, (res) => {
        cache.loading = false;
        if (chrome.runtime.lastError || !res) cache.error = "NOVA is not running. Open NOVA and try again.";
        else if (res.status === "success" && res.data && res.data.formats) cache.info = res.data;
        else if (res.error === "NOVA_ENGINE_NOT_RUNNING") cache.error = "NOVA is not running. Open NOVA and try again.";
        else cache.error = (res.data && res.data.error) || res.error || "Could not read the available resolutions.";
        if (state.menuOpen) renderMenu();
      });
    }
    function addItem(label, meta, selected, onPick, hdr) {
      const b = document.createElement("button");
      const l = document.createElement("span");
      l.textContent = label;
      if (hdr) { const h = document.createElement("span"); h.className = "hdr"; h.textContent = "HDR"; l.appendChild(h); }
      b.appendChild(l);
      if (meta) { const m = document.createElement("span"); m.className = "meta"; m.textContent = meta; b.appendChild(m); }
      if (selected) b.className = "sel";
      b.addEventListener("click", (e) => { e.stopPropagation(); onPick(); });
      menu.appendChild(b);
    }
    function addHead(text) { const d = document.createElement("div"); d.className = "head"; d.textContent = text; menu.appendChild(d); }
    function renderMenu() {
      menu.innerHTML = "";
      QUALITIES.forEach(([id, label]) => {
        addItem(label, "", id === state.quality, () => {
          state.quality = id;
          chrome.storage.local.set({ novaGrabberQuality: id });
          closeMenu();
          send();
        });
      });
      if (!isVideoSitePage()) return;
      addHead("All resolutions (lowest to highest)");
      if (cache.loading) {
        const d = document.createElement("div"); d.className = "busy"; d.textContent = "Reading available resolutions..."; menu.appendChild(d);
      } else if (cache.error) {
        const d = document.createElement("div"); d.className = "busy"; d.textContent = cache.error; menu.appendChild(d);
      } else if (cache.info) {
        const audio = cache.info.best_audio_size || 0;
        cache.info.formats.forEach((f) => {
          const total = f.size > 0 ? f.size + (f.has_audio ? 0 : audio) : 0;
          const label = resName(f.height) + "  " + f.height + "p" + (f.fps > 30 ? " " + f.fps + "fps" : "");
          const meta = (f.ext || "").toUpperCase() + " · " + f.vcodec + (total ? " · " + fmtSize(total, f.size_estimated) : "");
          const id = "fmt:" + f.id;
          addItem(label, meta, state.quality === id, () => {
            state.quality = id; // exact choice, only used for this download
            closeMenu();
            send();
          }, f.hdr);
        });
      }
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
      if (state.menuOpen) { loadInfo(); renderMenu(); menu.classList.remove("hidden"); } else closeMenu();
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
      if (ok) say("Sent to NOVA - confirm the download in the NOVA window");
      else if (res.error === "NOVA_ENGINE_NOT_RUNNING") say("NOVA is not running. Open NOVA and try again.", true);
      else say("NOVA could not start this download" + (res.error ? " (" + String(res.error).slice(0, 90) + ")" : "."), true);
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

// ---- Magnet links: open them in NOVA (like a torrent client would) ----
(function () {
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href^="magnet:"]') : null;
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: "send_magnet", url: href }, function (res) {
      if (chrome.runtime.lastError || !res || res.error === "NOVA_ENGINE_NOT_RUNNING") {
        // NOVA is not running: let Windows handle the magnet link as usual
        window.location.href = href;
      }
    });
  }, true);
})();
