const enabledEl = document.getElementById("enabled");
const highlightColorEl = document.getElementById("highlightColor");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text || "";
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => resolve(resp));
  });
}

async function load() {
  setStatus("加载中...");
  try {
    const resp = await sendMessage({ type: "GET_SETTINGS" });
    if (resp?.ok && resp.settings) {
      enabledEl.checked = !!resp.settings.enabled;
      highlightColorEl.value = resp.settings.highlightColor || "#00ff88";
      setStatus("");
    } else {
      setStatus("读取失败");
    }
  } catch {
    setStatus("读取失败");
  }
}

function normalizeHexColor(input) {
  const v = String(input || "").trim();
  // 简单校验：允许 #RGB / #RRGGBB
  if (/^#([0-9a-fA-F]{3})$/.test(v) || /^#([0-9a-fA-F]{6})$/.test(v)) return v;
  return null;
}

async function save() {
  setStatus("保存中...");
  try {
    const enabled = !!enabledEl.checked;
    const color = normalizeHexColor(highlightColorEl.value) || "#00ff88";

    const resp = await sendMessage({
      type: "SET_SETTINGS",
      settings: { enabled, highlightColor: color }
    });

    if (!resp?.ok) throw new Error(resp?.error || "save failed");
    setStatus("已保存");
  } catch (e) {
    setStatus(`保存失败: ${String(e?.message || e)}`);
  }
}

saveBtn.addEventListener("click", save);
load();

