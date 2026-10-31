# NOVA Download Manager (v2.4.0)

A high-performance, privacy-first Windows download manager inspired by the functional power of Internet Download Manager (IDM). Designed with modern Windows 11 aesthetics, multi-part HTTP Range segmented acceleration, multi-protocol support (HTTP, HTTPS, FTP, FTPS, SFTP, HLS, DASH), browser extensions for Chromium (Google Chrome, Microsoft Edge, Brave) and Firefox, and a local-first SQLite persistence engine.

---

## 1. Architectural Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        NOVA Download Manager                           │
├───────────────────────────────┬────────────────────────────────────────┤
│     Desktop UI Layer          │            Rust Core Engine            │
│  - React 19 + TypeScript      │  - Tauri 2 Native Runtime              │
│  - Vite + Tailwind CSS v4     │  - tokio Async I/O Runtime             │
│  - Recharts Speed Telemetry   │  - reqwest HTTP/2 & Range Segmenter    │
│  - Real-Time Segment Visuals  │  - Multi-Protocol: FTP/FTPS/SFTP/HLS   │
│  - Interactive Sniffer Lab    │  - sha2 Checksum Verification          │
│  - Scheduled Downloads Modal  │  - SQLite with WAL Mode (Local-First)  │
└───────────────▲───────────────┴───────────────────▲────────────────────┘
                │ IPC (JSON RPC)                    │ Stdin/Stdout Pipe (32-bit)
┌───────────────┴───────────────────────────────────┴────────────────────┐
│                    Browser Integration Layer                           │
│  - Chrome / Edge / Brave: Manifest V3 Extension (MV3)                  │
│  - Mozilla Firefox: Gecko WebExtensions Add-on                         │
│  - Content Script: Non-Intrusive Floating HTML5 Media Grabber          │
│  - Duplicate Prevention Cache (10-second sliding window)               │
│  - Windows Native Messaging Host Binary (`nova_host.exe`)              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Protocol Engine & Capabilities

| Protocol | Features & Implementation | Status |
| :--- | :--- | :--- |
| **HTTP / HTTPS** | Multi-part Range requests (`bytes=start-end`), contiguous segment allocation, redirect handling (limited to 10), HEAD fallback to Range `bytes=0-0`, RFC 5987 / 6266 UTF-8 encoded Content-Disposition filename extraction, custom headers & cookies. | **Implemented & Tested** |
| **FTP** | Anonymous and authenticated login, passive mode (`PASV`), binary mode (`TYPE I`), directory parsing, and resume via `REST` command. | **Implemented & Tested** |
| **FTPS** | Explicit and implicit TLS certificate verification for secure FTP transfers. | **Implemented & Tested** |
| **SFTP (SSH)** | Remote file transfers via secure shell subsystem with offset seek and resume. | **Implemented & Tested** |
| **HLS (.m3u8)** | Master and media playlist parsing, adaptive bitrate variant selection, non-DRM transport segment sequence assembly, and DRM detection (`#EXT-X-KEY`). | **Implemented & Tested** |
| **MPEG-DASH (.mpd)** | XML manifest parser, representation selection, and DRM `<ContentProtection>` inspection. Multi-track segment muxing is unsupported without transcoders; not downloaded directly. | **Manifest & DRM Inspection Only** |

### DRM & Copyright Invariant
NOVA strictly adheres to intellectual property standards and content protection boundaries:
- Automatically detects Google Widevine (`urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed`), Microsoft PlayReady (`urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95`), and Apple FairPlay (`#EXT-X-KEY:METHOD=SAMPLE-AES`).
- Displays clear, non-intrusive messages informing users that DRM-protected or encrypted streams cannot be captured.
- Never tampers with encrypted paywalls or bypasses hardware-protected media decryption.

---

## 3. Browser Extension Integration

The browser extension is a unified Chromium Manifest V3 extension compatible with **Google Chrome**, **Microsoft Edge**, and **Brave Browser**.

### Capabilities:
1. **Download Interception**: Listens to `chrome.downloads.onCreated` and redirects eligible downloads to NOVA with a 10-second duplicate-prevention cache to prevent infinite loops.
2. **Context Menus**: Right-click "Download with NOVA" on links, videos, audio, images, and text selections.
3. **Floating Media Grabber**: Automatically attaches a non-intrusive badge to HTML5 `<video>` and `<audio>` elements with duration > 5 seconds.
4. **Native Messaging**: Communicates via standard 32-bit native length-prefixed stdin/stdout framing with `nova_host.exe`. Zero open network ports on `localhost`.

### Installation Steps:
#### Google Chrome
1. Go to `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/chrome` folder.
3. Run `extension/install_host.bat` (or double-click `extension/windows_install_host.reg`).

#### Microsoft Edge
1. Go to `edge://extensions` and enable **Developer mode** in the sidebar.
2. Click **Load unpacked** and select `extension/chrome`.

#### Brave Browser
1. Go to `brave://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select `extension/chrome`.
3. Brave Shields can remain fully enabled; no remote tracking is executed.

---

## 4. Local Development & Automated Tests

### Prerequisites
- Node.js v20+ / v22+
- Rust toolchain (`stable-x86_64-pc-windows-msvc`) with Tauri CLI (`cargo install tauri-cli`)

### Running the Test Suite
NOVA includes an automated test suite verifying protocols, byte math, stream parsers, DRM detection, and browser messaging:
```bash
npm test
```
Or directly via Node test runner:
```bash
npx tsx --test test/*.test.ts
```

### Running the Desktop Application
```bash
# Start frontend preview dev server
npm run dev

# Or launch Tauri desktop app
cargo tauri dev
```

### Building Release Binaries
```bash
cargo tauri build
```
Generates:
- `nova-download-manager.exe` (Main Desktop App)
- `nova_host.exe` (Native Messaging Host Binary)
- Windows Setup Installer (.msi / .exe) in `src-tauri/target/release/bundle/`

---

## 5. Security & Threat Model

1. **Zero Open Ports**: Unlike download managers that open an unauthenticated HTTP server on `localhost`, NOVA uses standard Windows Native Messaging via stdin/stdout. Malicious websites cannot trigger downloads.
2. **Path Traversal Protection**: All save directories and filenames are sanitized against `../` path traversal and illegal Windows filename characters (`<>:"/\\|?*`).
3. **Local-First SQLite**: History and queue states are stored exclusively on your device in `%APPDATA%\NOVA\nova_downloads.sqlite`. Zero telemetry, zero analytics, zero external network requests for user data.

---

## 6. About the Developer

**NOVA Download Manager** was designed and developed by **Asif**, a 26-year-old software developer and technology enthusiast from Bangladesh.

- **Education**: Bachelor of Business Studies (BBS), Class of 2023, Chandpur Government College.
- **Philosophy**: Passionate about software craftsmanship, clean UI/UX design, performance optimization, and building useful tools without advertisements or telemetry.
- **Instagram**: [@artyasif19](https://www.instagram.com/artyasif19/)
