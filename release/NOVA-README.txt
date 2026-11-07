==============================================================
  NOVA DOWNLOAD MANAGER  -  Installation Guide
==============================================================

Made by Asif  |  GitHub: https://github.com/artyasif19
Project page:   https://github.com/artyasif19/NOVA-Download-Manager

--------------------------------------------------------------
 1. INSTALL THE APP
--------------------------------------------------------------
 1. Double-click  NOVA Download Manager ... setup.exe
 2. If Windows shows "Windows protected your PC":
      click "More info", then "Run anyway".
    (The installer is not code-signed yet, so Windows asks once.)
 3. Follow the wizard and click Finish. NOVA starts automatically.

 NOVA also starts (minimized) when Windows starts. You can switch
 this off in Settings.

--------------------------------------------------------------
 2. ADD THE BROWSER EXTENSION (one time, about 1 minute)
--------------------------------------------------------------
 The extension adds IDM-style features: it catches browser
 downloads and shows a "Download this video" button on videos.
 NOVA already copied the extension to:

     %LOCALAPPDATA%\NOVA\extension\chrome      (Chrome / Edge / Brave)
     %LOCALAPPDATA%\NOVA\extension\firefox     (Firefox)

 EASY WAY: open NOVA, click the "Browser Bridge" tab and use the
 buttons in "Quick setup". They open your browser's extensions
 page and the extension folder for you.

 CHROME / EDGE / BRAVE
   1. Open  chrome://extensions   (Edge: edge://extensions,
                                   Brave: brave://extensions)
   2. Turn on "Developer mode" (top-right switch).
   3. Click "Load unpacked".
   4. Choose the folder:  %LOCALAPPDATA%\NOVA\extension\chrome
      (paste that path into the folder box and press Enter)
   5. Done. Pin the NOVA icon from the puzzle-piece menu if you like.

 FIREFOX
   1. Open  about:debugging#/runtime/this-firefox
   2. Click "Load Temporary Add-on..."
   3. Choose the file  manifest.json  inside
      %LOCALAPPDATA%\NOVA\extension\firefox
   Note: Firefox removes temporary add-ons when it closes, so repeat
   this after restarting Firefox. A permanent Firefox version needs
   publishing on the Firefox Add-ons site.

 IMPORTANT: NOVA must be running (it is, after install) for the
 extension to hand downloads over. The extension talks to NOVA
 directly on your own PC; nothing is sent over the internet.

--------------------------------------------------------------
 3. HOW TO USE
--------------------------------------------------------------
 * Click any download link in your browser: NOVA shows a
   "Download File Info" window (like IDM). Choose Start Download,
   Download Later or Cancel.
 * On YouTube and other video sites a "Download" button appears on
   the video. Click the small arrow to pick any resolution
   (4K, 2K, Full HD, HD, SD) with codec and file size.
 * In NOVA:  Add URL > "Video Sites" tab  or  the "Media Grabber"
   tab to paste a video link, preview it and pick a resolution.
 * Speed Test tab: check your internet speed.
 * Torrents: Add URL > "Torrent / Magnet" tab. Paste a magnet link,
   a .torrent link, or choose a .torrent file. Clicking a magnet
   link in your browser can open NOVA too (Windows may ask you to
   choose NOVA once under "Open with").
 * Batch: the "Batch" button adds many files at once, from a link
   pattern like  https://site.com/img[001-050].jpg  or a pasted
   list of links. Batches use the queue and obey "Max concurrent
   downloads" in Settings.
 * Clipboard: copy a download, video or magnet link and NOVA offers
   to download it (turn off in Settings > General).
 * When done: the toolbar menu can exit NOVA, put the PC to sleep or
   shut it down after the last download (20 second warning).
 * Tray: closing the window keeps NOVA running in the system tray
   (right-click the tray icon > Exit NOVA to quit).
 * Proxy: Settings > Connections (HTTP or SOCKS5, with login).
 * Settings > Appearance: Dark, Light and Liquid Glass themes,
   gradient styles, custom colors and your own background picture.

--------------------------------------------------------------
 4. TROUBLESHOOTING
--------------------------------------------------------------
 * "NOVA is not running" in the browser: open NOVA from the Start
   menu, then try again.
 * Button does not appear on a video: reload the page; make sure
   the extension is enabled and "Floating Video Sniffer" is on in
   the extension popup.
 * A browser download should NOT be caught: click the extension
   icon and switch off "Intercept Browser Downloads".
 * Videos with DRM protection (Netflix, etc.) cannot be downloaded.

--------------------------------------------------------------
 5. UNINSTALL
--------------------------------------------------------------
 Windows Settings > Apps > NOVA Download Manager > Uninstall.
 Remove the extension from your browser's extensions page.

--------------------------------------------------------------
 LEGAL
--------------------------------------------------------------
 Only download content you own or have permission to save.
 NOVA bundles yt-dlp (Unlicense), FFmpeg (LGPL) and aria2 (GPL v2).
 Thank you to those projects.

 Questions, bugs or ideas?  https://github.com/artyasif19
==============================================================
