/**
 * Content 入口：扩展设置、标题就绪后创建交易面板、消息监听。
 * 依赖 manifest：content-common → content-ws → content-trade-buy → content-trade-sell → content-trade-ui → 本文件。
 * 面板实现见 content-trade-ui.js（createTradeUI、AlphaExtTradeRuntime）。
 */

function applyExtensionSettings(settings) {
  const enabled = !!settings?.enabled;
  AlphaExtTradeRuntime.pendingBuyUIEnabled = enabled;
  if (!enabled && typeof AlphaExtTradeRuntime.stopLoopWhenPanelDisabled === "function") {
    AlphaExtTradeRuntime.stopLoopWhenPanelDisabled();
  }
  if (!enabled && AlphaExtTradeRuntime.contractPriceFeedControl) {
    AlphaExtTradeRuntime.contractPriceFeedControl.stop();
  }
  if (enabled && AlphaExtTradeRuntime.contractPriceFeedControl) {
    AlphaExtTradeRuntime.contractPriceFeedControl.start();
  }
  if (AlphaExtTradeRuntime.buyUIEl) {
    const wasHidden = AlphaExtTradeRuntime.buyUIEl.style.display === "none";
    if (enabled) {
      AlphaExtTradeRuntime.buyUIEl.style.display = "flex";
      AlphaExtTradeRuntime.buyUIEl.style.flexDirection = "column";
    } else {
      AlphaExtTradeRuntime.buyUIEl.style.display = "none";
    }
    const nowHidden = AlphaExtTradeRuntime.buyUIEl.style.display === "none";
    if (typeof AlphaExtTradeRuntime.buyUILogAppend === "function") {
      if (wasHidden && !nowHidden) AlphaExtTradeRuntime.buyUILogAppend("打开下单面板");
      else if (!wasHidden && nowHidden) AlphaExtTradeRuntime.buyUILogAppend("关闭下单面板");
    }
  }
}

function sendMessageToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp) => resolve(resp));
  });
}

async function loadAndApplySettings() {
  try {
    const resp = await sendMessageToBackground({ type: "GET_SETTINGS" });
    if (resp?.ok && resp.settings) applyExtensionSettings(resp.settings);
  } catch {
    // 忽略
  }
}

/** 标题中 Alpha 变化时同步面板（币种、合约价 WS、会话累计；保留操作日志） */
function startTitleAlphaWatch() {
  let lastNorm = null;
  setInterval(() => {
    if (!AlphaExtTradeRuntime.buyUIEl) return;
    const a = AlphaExtCommon.parseAlphaFromTitle(document.title);
    if (!a) return;
    const norm = String(a).trim().toUpperCase();
    if (lastNorm === null) {
      lastNorm = norm;
      return;
    }
    if (norm === lastNorm) return;
    lastNorm = norm;
    if (typeof AlphaExtTradeRuntime.applyAlphaFromTitle === "function") {
      AlphaExtTradeRuntime.applyAlphaFromTitle(a);
    }
  }, 500);
}

function startInitTradeUIWhenTitleReady() {
  const tryCreate = () => {
    if (AlphaExtTradeRuntime.buyUIEl) return true;
    const alpha = AlphaExtCommon.parseAlphaFromTitle(document.title);
    if (!alpha) return false;
    createTradeUI(alpha);
    if (AlphaExtTradeRuntime.buyUIEl) {
      const wasHidden = AlphaExtTradeRuntime.buyUIEl.style.display === "none";
      if (AlphaExtTradeRuntime.pendingBuyUIEnabled) {
        AlphaExtTradeRuntime.buyUIEl.style.display = "flex";
        AlphaExtTradeRuntime.buyUIEl.style.flexDirection = "column";
      } else {
        AlphaExtTradeRuntime.buyUIEl.style.display = "none";
      }
      const nowHidden = AlphaExtTradeRuntime.buyUIEl.style.display === "none";
      if (typeof AlphaExtTradeRuntime.buyUILogAppend === "function" && wasHidden && !nowHidden) {
        AlphaExtTradeRuntime.buyUILogAppend("打开下单面板");
      }
    }
    return true;
  };

  if (tryCreate()) return;

  const onLoad = () => {
    tryCreate();
  };
  if (document.readyState === "complete") onLoad();
  else window.addEventListener("load", onLoad, { once: true });

  const startedAt = Date.now();
  const maxWaitMs = 15000;
  const timer = setInterval(() => {
    if (tryCreate()) clearInterval(timer);
    if (Date.now() - startedAt >= maxWaitMs) clearInterval(timer);
  }, 500);
}

if (window.top === window.self) {
  startInitTradeUIWhenTitleReady();
  startTitleAlphaWatch();
}

loadAndApplySettings();

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "SETTINGS_UPDATED") {
    applyExtensionSettings(message.settings || {});
  }
});
