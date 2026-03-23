const enabledEl = document.getElementById("enabled");
const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text || "";
}

async function getCurrentTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => resolve(resp));
  });
}

async function load() {
  setStatus("加载中…");
  try {
    const resp = await sendMessage({ type: "GET_SETTINGS" });
    if (resp?.ok && resp.settings) {
      enabledEl.checked = !!resp.settings.enabled;
      setStatus("");
    } else {
      setStatus("读取失败");
    }
  } catch {
    setStatus("读取失败");
  }
}

async function syncEnabledFromStorage(enabled) {
  try {
    const resp = await sendMessage({ type: "SET_SETTINGS", settings: { enabled } });
    if (!resp?.ok) throw new Error(resp?.error || "sync failed");

    const tabId = await getCurrentTabId();
    if (typeof tabId === "number") {
      chrome.tabs.sendMessage(tabId, { type: "SETTINGS_UPDATED", settings: resp.settings }).catch(() => {});
    }
    if (enabled) {
      setStatus("");
    } else {
      setStatus("已停止自动买入（下单面板已关闭）");
    }
  } catch (e) {
    setStatus(String(e?.message || e));
  }
}

enabledEl.addEventListener("change", () => {
  void syncEnabledFromStorage(!!enabledEl.checked);
});

load();
