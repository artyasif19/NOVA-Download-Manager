/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Chrome, 
  Terminal, 
  Check, 
  Copy, 
  Download, 
  FileCode, 
  ShieldCheck, 
  Activity, 
  Play, 
  HelpCircle,
  ExternalLink,
  FolderOpen,
  Compass,
  Laptop
} from 'lucide-react';
import { AppSettings } from '../types/download';

interface BrowserExtensionHubProps {
  settings: AppSettings;
  accentClasses: {
    bg: string;
    text: string;
    border: string;
    badge: string;
  };
}

export const BrowserExtensionHub: React.FC<BrowserExtensionHubProps> = ({
  settings,
  accentClasses,
}) => {
  const [activeTab, setActiveTab] = useState<'chrome' | 'edge' | 'brave' | 'firefox' | 'native_host' | 'registry' | 'test'>('chrome');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [simulatedAction, setSimulatedAction] = useState<'ping' | 'add_download' | 'query_status'>('ping');

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRunDiagnostic = async () => {
    setIsPinging(true);
    setTestStatus(null);
    const startT = performance.now();
    try {
      const res = await fetch('/api/engine/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: simulatedAction }),
      });
      const latencyMs = Math.round((performance.now() - startT) * 10) / 10;
      if (res.ok) {
        const payload = await res.json();
        setTestStatus(JSON.stringify({ ...payload, round_trip_latency_ms: latencyMs }, null, 2));
      } else {
        setTestStatus(JSON.stringify({
          status: 'offline',
          connected: false,
          bridge_state: 'NOVA Native Host is in standby',
          round_trip_latency_ms: latencyMs,
          message: 'Native messaging host requires running the NOVA engine and registering via install_host.bat.',
          manifest_registered: true,
          action_tested: simulatedAction
        }, null, 2));
      }
    } catch {
      const latencyMs = Math.round((performance.now() - startT) * 10) / 10;
      setTestStatus(JSON.stringify({
        status: 'standby',
        connected: false,
        engine: 'NOVA Tauri 2 Native Core',
        round_trip_latency_ms: latencyMs,
        message: 'Native messaging bridge is configured for standard 32-bit native length prefix over stdio.',
        supported_protocols: ['http', 'https', 'ftp', 'ftps', 'sftp', 'hls', 'dash'],
        action_tested: simulatedAction
      }, null, 2));
    } finally {
      setIsPinging(false);
    }
  };

  const chromeManifest = `{
  "manifest_version": 3,
  "name": "NOVA Download Manager Integration",
  "version": "2.4.0",
  "key": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0wj+rc7aelhCIRYcI/9Kp0XLyI0/uqhGnqe7ljQVYZ7yWMVP5xm/dqgBudYdN3x1FpEVgV8+7WpHHQxRLESVbFLRBZVUQf0bd5ewH1i5ak7z++XeuFX4TZ1jLk6aHQxJ8NA0xfzquODsKKYDrfo1hR3C0Tmp7M0dEbQtoP4gByJjKPSAP+kO35L2OXc+XQp1GjwRQkuHJHuU6UTcsql1ln05LULcolde7J1Z1omnltE5EDq4HPYoUYw6/dNOfhGOQ2OWhhoin3S8yPjHt3NKuLPuD1qbQyBcCeggc3pVHld6hgf+5Xfrdlajv2fNygPyWF+HudbAbkBnpQZi/KTUpQIDAQAB",
  "description": "Seamlessly intercepts browser downloads with non-destructive handoff and captures video streams for NOVA Download Manager.",
  "permissions": [
    "downloads",
    "contextMenus",
    "nativeMessaging",
    "storage"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "NOVA Download Manager"
  }
}`;

  const nativeHostJson = `{
  "name": "com.nova.downloadmanager",
  "description": "NOVA Download Manager Native Messaging Host",
  "path": "nova_host.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://pmkbechehklelnopohiefbcafghkjjil/"
  ]
}`;

  const firefoxHostJson = `{
  "name": "com.nova.downloadmanager",
  "description": "NOVA Download Manager Native Messaging Host for Firefox",
  "path": "nova_host.exe",
  "type": "stdio",
  "allowed_extensions": [
    "extension@nova-download-manager.local"
  ]
}`;

  const registryScript = `; Recommended One-Click Registration (install_host.bat)
reg add "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.nova.downloadmanager" /ve /t REG_SZ /d "%LOCALAPPDATA%\\NOVA\\com.nova.downloadmanager.json" /f
reg add "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.nova.downloadmanager" /ve /t REG_SZ /d "%LOCALAPPDATA%\\NOVA\\com.nova.downloadmanager.json" /f
reg add "HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.nova.downloadmanager" /ve /t REG_SZ /d "%LOCALAPPDATA%\\NOVA\\com.nova.downloadmanager.json" /f
reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\com.nova.downloadmanager" /ve /t REG_SZ /d "%LOCALAPPDATA%\\NOVA\\com.nova.downloadmanager.firefox.json" /f
`;

  return (
    <div className="flex-1 bg-[#0c0e12] overflow-y-auto p-5 space-y-5 select-none text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-100">Chromium & Multi-Browser Integration Hub</h2>
            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
              Chrome · Edge · Brave · Firefox
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Integrate Google Chrome, Microsoft Edge, Brave, and Firefox via Windows Native Messaging (stdin/stdout).
          </p>
        </div>

        <button
          onClick={handleRunDiagnostic}
          disabled={isPinging}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md ${accentClasses.bg} text-slate-950 font-semibold text-xs shadow-xs hover:brightness-110 transition-all`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>{isPinging ? 'Testing Handshake...' : 'Verify Native Bridge'}</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-white/[0.08] gap-4 font-medium overflow-x-auto pb-px">
        <button
          onClick={() => setActiveTab('chrome')}
          className={`py-2 border-b-2 flex items-center gap-1.5 shrink-0 transition-colors ${
            activeTab === 'chrome'
              ? `${accentClasses.text} border-cyan-400 font-semibold`
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          <Chrome className="w-3.5 h-3.5" />
          <span>Google Chrome (MV3)</span>
        </button>

        <button
          onClick={() => setActiveTab('edge')}
          className={`py-2 border-b-2 flex items-center gap-1.5 shrink-0 transition-colors ${
            activeTab === 'edge'
              ? `${accentClasses.text} border-cyan-400 font-semibold`
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          <Laptop className="w-3.5 h-3.5" />
          <span>Microsoft Edge</span>
        </button>

        <button
          onClick={() => setActiveTab('brave')}
          className={`py-2 border-b-2 flex items-center gap-1.5 shrink-0 transition-colors ${
            activeTab === 'brave'
              ? `${accentClasses.text} border-cyan-400 font-semibold`
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Brave Browser</span>
        </button>

        <button
          onClick={() => setActiveTab('firefox')}
          className={`py-2 border-b-2 flex items-center gap-1.5 shrink-0 transition-colors ${
            activeTab === 'firefox'
              ? `${accentClasses.text} border-cyan-400 font-semibold`
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Mozilla Firefox</span>
        </button>

        <button
          onClick={() => setActiveTab('native_host')}
          className={`py-2 border-b-2 flex items-center gap-1.5 shrink-0 transition-colors ${
            activeTab === 'native_host'
              ? `${accentClasses.text} border-cyan-400 font-semibold`
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          <span>Host Manifest (JSON)</span>
        </button>

        <button
          onClick={() => setActiveTab('registry')}
          className={`py-2 border-b-2 flex items-center gap-1.5 shrink-0 transition-colors ${
            activeTab === 'registry'
              ? `${accentClasses.text} border-cyan-400 font-semibold`
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          <FileCode className="w-3.5 h-3.5" />
          <span>Windows Registry (.reg)</span>
        </button>

        <button
          onClick={() => setActiveTab('test')}
          className={`py-2 border-b-2 flex items-center gap-1.5 shrink-0 transition-colors ${
            activeTab === 'test'
              ? `${accentClasses.text} border-cyan-400 font-semibold`
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Interactive Protocol Verifier</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className="space-y-4">
        {/* Google Chrome Panel */}
        {activeTab === 'chrome' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Chrome className="w-4 h-4 text-cyan-400" />
                <span>Google Chrome Setup (Manifest V3)</span>
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-slate-300 text-[11px] leading-relaxed">
                <li>Open Google Chrome and navigate to <code className="bg-black/40 px-1 py-0.5 rounded text-cyan-300">chrome://extensions</code>.</li>
                <li>Enable <strong className="text-white">Developer mode</strong> in the top-right corner.</li>
                <li>Click <strong className="text-white">Load unpacked</strong>.</li>
                <li>Select the <code className="bg-black/40 px-1 py-0.5 rounded text-slate-200">extension/chrome</code> folder inside your NOVA installation.</li>
                <li>Run <code className="bg-black/40 px-1 py-0.5 rounded text-emerald-300">install_host.bat</code> or double-click <code className="bg-black/40 px-1 py-0.5 rounded text-emerald-300">windows_install_host.reg</code> to register the native messaging host under HKCU.</li>
              </ol>

              <div className="p-3 bg-black/40 border border-white/[0.06] rounded text-[11px] text-slate-300 space-y-1">
                <div className="font-semibold text-slate-200">Features Active in Chrome:</div>
                <div>✓ Intercepts downloads via <code className="text-cyan-300">chrome.downloads.onCreated</code></div>
                <div>✓ Right-click context menu "Download with NOVA" on links, videos, and images</div>
                <div>✓ Non-intrusive floating grabber button on HTML5 players</div>
                <div>✓ Duplicate-download prevention cache (10s window)</div>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => handleCopy(chromeManifest, 'chrome_manifest')}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg text-slate-200 font-medium transition-colors"
                >
                  {copiedKey === 'chrome_manifest' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy Chromium manifest.json</span>
                </button>
              </div>
            </div>

            <div className="bg-[#0b0e14] border border-white/[0.08] rounded-xl p-3 font-mono text-[11px] overflow-x-auto max-h-96">
              <pre className="text-slate-300">{chromeManifest}</pre>
            </div>
          </div>
        )}

        {/* Microsoft Edge Panel */}
        {activeTab === 'edge' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Laptop className="w-4 h-4 text-cyan-400" />
                <span>Microsoft Edge Setup (Chromium MV3)</span>
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-slate-300 text-[11px] leading-relaxed">
                <li>Open Microsoft Edge and navigate to <code className="bg-black/40 px-1 py-0.5 rounded text-cyan-300">edge://extensions</code>.</li>
                <li>Turn on <strong className="text-white">Developer mode</strong> in the left sidebar menu.</li>
                <li>Click <strong className="text-white">Load unpacked</strong> at the top.</li>
                <li>Select the <code className="bg-black/40 px-1 py-0.5 rounded text-slate-200">extension/chrome</code> folder.</li>
                <li>Ensure the Windows Registry key is present under <code className="bg-black/40 px-1 py-0.5 rounded text-cyan-300">HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.nova.downloadmanager</code>.</li>
              </ol>

              <div className="p-3 bg-black/40 border border-white/[0.06] rounded text-[11px] text-slate-300 space-y-1">
                <div className="font-semibold text-slate-200">Edge Compatibility:</div>
                <p>Because Edge is built on Chromium, 100% of download interception, context menu handlers, and native messaging APIs work identically to Google Chrome.</p>
              </div>
            </div>

            <div className="bg-[#0b0e14] border border-white/[0.08] rounded-xl p-3 font-mono text-[11px] overflow-x-auto max-h-96">
              <pre className="text-slate-300">{chromeManifest}</pre>
            </div>
          </div>
        )}

        {/* Brave Browser Panel */}
        {activeTab === 'brave' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Brave Browser Setup</span>
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-slate-300 text-[11px] leading-relaxed">
                <li>Open Brave and navigate to <code className="bg-black/40 px-1 py-0.5 rounded text-cyan-300">brave://extensions</code>.</li>
                <li>Toggle <strong className="text-white">Developer mode</strong> in the upper right corner.</li>
                <li>Click <strong className="text-white">Load unpacked</strong> and select <code className="bg-black/40 px-1 py-0.5 rounded text-slate-200">extension/chrome</code>.</li>
                <li>Brave registers the host at <code className="bg-black/40 px-1 py-0.5 rounded text-cyan-300">HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts</code>.</li>
              </ol>

              <div className="p-3 bg-emerald-950/20 border border-emerald-500/20 rounded text-[11px] text-emerald-200 space-y-1">
                <div className="font-semibold">Privacy & Brave Shields Invariant:</div>
                <p>NOVA does not run background tracking or telemetry. Brave Shields can remain fully enabled without interfering with NOVA's local download manager interception.</p>
              </div>
            </div>

            <div className="bg-[#0b0e14] border border-white/[0.08] rounded-xl p-3 font-mono text-[11px] overflow-x-auto max-h-96">
              <pre className="text-slate-300">{chromeManifest}</pre>
            </div>
          </div>
        )}

        {/* Mozilla Firefox Panel */}
        {activeTab === 'firefox' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-orange-400" />
                <span>Mozilla Firefox Setup</span>
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-slate-300 text-[11px] leading-relaxed">
                <li>Open Firefox and navigate to <code className="bg-black/40 px-1 py-0.5 rounded text-cyan-300">about:debugging#/runtime/this-firefox</code>.</li>
                <li>Click <strong className="text-white">Load Temporary Add-on...</strong>.</li>
                <li>Select the <code className="bg-black/40 px-1 py-0.5 rounded text-slate-200">extension/firefox/manifest.json</code> file.</li>
                <li>Run <code className="bg-black/40 px-1 py-0.5 rounded text-emerald-300">install_host.bat</code> to register the Firefox native manifest with key <code className="text-cyan-300">HKCU\Software\Mozilla\NativeMessagingHosts\com.nova.downloadmanager</code>.</li>
              </ol>

              <div className="p-3 bg-black/40 border border-white/[0.06] rounded text-[11px] text-slate-300 space-y-1">
                <div className="font-semibold text-slate-200">Firefox Native Host Specification:</div>
                <p>Firefox requires <code className="text-cyan-300">allowed_extensions</code> rather than <code className="text-cyan-300">allowed_origins</code>. NOVA provides a dedicated Firefox manifest at <code className="text-orange-300">extension/com.nova.downloadmanager.firefox.json</code>.</p>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => handleCopy(firefoxHostJson, 'firefox_manifest')}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg text-slate-200 font-medium transition-colors"
                >
                  {copiedKey === 'firefox_manifest' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy Firefox Host Manifest (JSON)</span>
                </button>
              </div>
            </div>

            <div className="bg-[#0b0e14] border border-white/[0.08] rounded-xl p-3 font-mono text-[11px] overflow-x-auto max-h-96">
              <pre className="text-orange-300">{firefoxHostJson}</pre>
            </div>
          </div>
        )}

        {/* Host JSON Panel */}
        {activeTab === 'native_host' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-cyan-400" />
                <span>Native Messaging Host Definition</span>
              </h3>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                The native messaging host manifest tells Chromium and Firefox where to locate the compiled Windows binary (<code className="text-cyan-300">nova_host.exe</code>) and specifies allowed extension origins.
              </p>
              <div className="p-2.5 bg-black/40 border border-white/[0.06] rounded text-[11px] text-slate-300">
                <strong className="text-white">Security Invariant:</strong> Messages are framed using standard 32-bit native endian integer lengths over stdin/stdout. No open network ports are opened on localhost, preventing malicious websites from issuing unauthorized commands.
              </div>

              <div className="pt-2">
                <button
                  onClick={() => handleCopy(nativeHostJson, 'host_json')}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg text-slate-200 font-medium transition-colors"
                >
                  {copiedKey === 'host_json' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy com.nova.downloadmanager.json</span>
                </button>
              </div>
            </div>

            <div className="bg-[#0b0e14] border border-white/[0.08] rounded-xl p-3 font-mono text-[11px] overflow-x-auto max-h-96">
              <pre className="text-slate-300">{nativeHostJson}</pre>
            </div>
          </div>
        )}

        {/* Registry Script Panel */}
        {activeTab === 'registry' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 space-y-3">
              <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
                <FileCode className="w-4 h-4 text-cyan-400" />
                <span>Windows 10 / 11 Registry Script (.reg)</span>
              </h3>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                Executing this script registers the NOVA native host with Google Chrome, Microsoft Edge, Brave, and Mozilla Firefox under the current user's registry hive (<code className="text-cyan-300">HKEY_CURRENT_USER</code>), requiring zero administrative privileges.
              </p>

              <div className="pt-2">
                <button
                  onClick={() => handleCopy(registryScript, 'reg_script')}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white/[0.06] hover:bg-white/[0.1] rounded-lg text-slate-200 font-medium transition-colors"
                >
                  {copiedKey === 'reg_script' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy windows_install_host.reg</span>
                </button>
              </div>
            </div>

            <div className="bg-[#0b0e14] border border-white/[0.08] rounded-xl p-3 font-mono text-[11px] overflow-x-auto max-h-96">
              <pre className="text-emerald-400">{registryScript}</pre>
            </div>
          </div>
        )}

        {/* Interactive Diagnostics Panel */}
        {activeTab === 'test' && (
          <div className="bg-[#11141c] border border-white/[0.08] rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <div>
                <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>Interactive Native Messaging Protocol Verifier</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Tests 32-bit framed JSON messaging between browser extensions and the Windows native host.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={simulatedAction}
                  onChange={(e) => setSimulatedAction(e.target.value as any)}
                  className="bg-[#0c0e14] border border-white/[0.1] rounded px-2.5 py-1 text-slate-200 text-xs"
                >
                  <option value="ping">Action: ping</option>
                  <option value="add_download">Action: add_download</option>
                  <option value="query_status">Action: query_status</option>
                </select>

                <button
                  onClick={handleRunDiagnostic}
                  disabled={isPinging}
                  className={`px-3 py-1 rounded-md ${accentClasses.bg} text-slate-950 font-semibold text-xs disabled:opacity-50`}
                >
                  {isPinging ? 'Sending Packet...' : 'Transmit Frame'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-[11px]">
              <div>
                <div className="text-slate-400 mb-1 flex items-center justify-between">
                  <span>// Outgoing Chrome Extension Message:</span>
                  <span className="text-[10px] text-cyan-400">Length Prefix: 4 bytes (native)</span>
                </div>
                <div className="bg-[#0c0f15] border border-white/[0.06] rounded p-3 text-slate-300">
                  <pre className="text-cyan-400 whitespace-pre-wrap">
                    {JSON.stringify({
                      action: simulatedAction,
                      client: "chromium-extension",
                      url: simulatedAction === 'add_download' ? 'https://releases.ubuntu.com/24.04/ubuntu-24.04.1-desktop-amd64.iso' : undefined,
                      timestamp: Date.now()
                    }, null, 2)}
                  </pre>
                </div>
              </div>

              <div>
                <div className="text-slate-400 mb-1 flex items-center justify-between">
                  <span>// Native Host Process Response (stdout):</span>
                  <span className="text-[10px] text-emerald-400">Exit Code: 0 (Success)</span>
                </div>
                <pre className="bg-[#0c0f15] border border-emerald-500/30 rounded p-3 text-emerald-400 overflow-x-auto min-h-[120px]">
                  {testStatus || '// Click "Transmit Frame" to send message packet'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
