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

  // Test native connection
  try {
    chrome.runtime.sendNativeMessage("com.nova.downloadmanager", { action: "ping" }, (response) => {
      if (chrome.runtime.lastError) {
        hostStatusEl.textContent = "Offline";
        hostStatusEl.style.color = "#f43f5e";
        hostStatusEl.style.borderColor = "rgba(244, 63, 94, 0.3)";
        hostStatusEl.style.background = "rgba(244, 63, 94, 0.15)";
      } else {
        hostStatusEl.textContent = "Active";
      }
    });
  } catch {
    hostStatusEl.textContent = "Standby";
  }
});
