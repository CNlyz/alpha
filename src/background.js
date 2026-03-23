const DEFAULT_SETTINGS = {
  enabled: true,
  highlightColor: "#00ff88"
};

function normalizeSettings(maybeSettings) {
  return {
    enabled: typeof maybeSettings?.enabled === "boolean" ? maybeSettings.enabled : DEFAULT_SETTINGS.enabled,
    highlightColor:
      typeof maybeSettings?.highlightColor === "string" && maybeSettings.highlightColor.trim()
        ? maybeSettings.highlightColor.trim()
        : DEFAULT_SETTINGS.highlightColor
  };
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(["enabled", "highlightColor"]);
  return normalizeSettings(stored);
}

async function setSettings(nextSettings) {
  const current = await getSettings();
  const normalized = normalizeSettings({ ...current, ...(nextSettings || {}) });
  await chrome.storage.sync.set(normalized);
  return normalized;
}

chrome.runtime.onInstalled.addListener(async () => {
  // 初始化默认配置（如果用户从未保存过）。
  const stored = await chrome.storage.sync.get(["enabled", "highlightColor"]);
  const hasAny = stored && (Object.prototype.hasOwnProperty.call(stored, "enabled") || Object.prototype.hasOwnProperty.call(stored, "highlightColor"));
  if (!hasAny) {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 约定消息格式：{ type: string, ...payload }
  if (!message || typeof message.type !== "string") return;

  if (message.type === "PING") {
    sendResponse({ ok: true, now: Date.now() });
    return;
  }

  if (message.type === "GET_SETTINGS") {
    (async () => {
      try {
        const settings = await getSettings();
        sendResponse({ ok: true, settings });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // 异步 sendResponse
  }

  if (message.type === "SET_SETTINGS") {
    (async () => {
      try {
        const settings = await setSettings(message.settings || {});
        sendResponse({ ok: true, settings });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  return;
});

