/**
 * NOVA Download Manager - Extension Popup Controller
 */

document.addEventListener("DOMContentLoaded", () => {
  const autoInterceptEl = document.getElementById("autoIntercept");
  const floatingSnifferEl = document.getElementById("floatingSniffer");
  const hostStatusEl = document.getElementById("hostStatus");

  // Load stored preferences
  chrome.storage.local.get(["autoIntercept", "enableFloatingSniffer"], (res) => {
    autoInterceptEl.checked = res.autoIntercept !== false;
    floatingSnifferEl.checked = res.enableFloatingSniffer !== false;
  });

  autoInterceptEl.addEventListener("change", (e) => {
    chrome.storage.local.set({ autoIntercept: e.target.checked });
  });

  floatingSnifferEl.addEventListener("change", (e) => {
    chrome.storage.local.set({ enableFloatingSniffer: e.target.checked });
  });

  // Check the connection to the NOVA desktop app
  chrome.runtime.sendMessage({ action: "check_native_status" }, (res) => {
    const connected = !chrome.runtime.lastError && res && res.status && res.status.connected;
    if (connected) {
      hostStatusEl.textContent = "Connected";
    } else {
      hostStatusEl.textContent = "NOVA not running";
      hostStatusEl.style.color = "#f43f5e";
      hostStatusEl.style.borderColor = "rgba(244, 63, 94, 0.3)";
      hostStatusEl.style.background = "rgba(244, 63, 94, 0.15)";
    }
  });
});
