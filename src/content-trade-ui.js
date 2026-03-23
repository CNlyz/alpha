/**
 * 交易面板 UI 与自动交易循环（拖动、缩放、日志、买卖方向、限制校验）。
 * 依赖 manifest：content-common → content-ws → content-trade-buy → content-trade-sell → 本文件。
 * 与 content.js 通过 AlphaExtTradeRuntime 共享面板与 WS 句柄。
 */
var AlphaExtTradeRuntime = {
  buyUIEl: null,
  pendingBuyUIEnabled: false,
  contractPriceFeedControl: null,
  stopLoopWhenPanelDisabled: null,
  buyUILogAppend: null,
  /** @type {((alpha: string) => void) | null} 页面标题解析出新的 Alpha 时更新面板并重置会话累计（保留操作日志） */
  applyAlphaFromTitle: null
};

function createTradeUI(alpha) {
  const C = AlphaExtCommon.CONST;
  const existing = document.getElementById(C.BUY_UI_ID);
  if (existing) return existing;

  const container = document.createElement("div");
  container.id = C.BUY_UI_ID;
  container.style.cssText = [
    "position: fixed",
    "top: 12px",
    "left: 12px",
    "z-index: 2147483647",
    "display: none",
    "box-sizing: border-box",
    "width: " + `${C.BUYUI_DEFAULT_WIDTH}px`,
    "min-width: " + `${C.BUYUI_MIN_WIDTH}px`,
    "min-height: " + `${C.BUYUI_MIN_HEIGHT}px`,
    "overflow: hidden",
    "background: rgba(255, 255, 255, 0.96)",
    "backdrop-filter: blur(6px)",
    "border: 1px solid rgba(0,0,0,0.08)",
    "border-radius: 12px",
    "padding: 0",
    "box-shadow: 0 10px 30px rgba(0,0,0,0.12)",
    "font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    "pointer-events: auto"
  ].join(";");

  function defaultPanelHeightPx() {
    return Math.round(Math.min(520, window.innerHeight * 0.55));
  }

  try {
    const savedSize = sessionStorage.getItem(C.BUYUI_SIZE_KEY);
    if (savedSize) {
      const sz = JSON.parse(savedSize);
      if (typeof sz.width === "number") {
        container.style.width = `${Math.min(C.BUYUI_MAX_WIDTH, Math.max(C.BUYUI_MIN_WIDTH, sz.width))}px`;
      }
      if (typeof sz.height === "number") {
        container.style.height = `${Math.max(C.BUYUI_MIN_HEIGHT, sz.height)}px`;
      }
    }
    if (!container.style.height) {
      container.style.height = `${defaultPanelHeightPx()}px`;
    }
  } catch {
    if (!container.style.height) {
      container.style.height = `${defaultPanelHeightPx()}px`;
    }
  }

  /** 红色预警（整面板红闪）：恢复时取消下面块注释，并恢复 trigger/clear 内对 classList 的操作 */
  /*
  (function injectPanelAlertStyle() {
    const sid = "alpha-trade-panel-alert-style";
    if (document.getElementById(sid)) return;
    const style = document.createElement("style");
    style.id = sid;
    style.textContent =
      "@keyframes alpha-panel-alert-pulse{0%,100%{box-shadow:0 0 0 3px rgba(220,38,38,.55),0 10px 30px rgba(0,0,0,.12);border-color:rgba(220,38,38,.88)}50%{box-shadow:0 0 0 10px rgba(248,113,113,.28),0 10px 32px rgba(220,38,38,.32);border-color:rgba(248,113,113,1)}}" +
      `#${C.BUY_UI_ID}.alpha-trade-panel-alert{animation:alpha-panel-alert-pulse .85s ease-in-out infinite}`;
    document.documentElement.appendChild(style);
  })();

  function triggerPanelAlert() {
    container.classList.add("alpha-trade-panel-alert");
  }

  function clearPanelAlert() {
    container.classList.remove("alpha-trade-panel-alert");
  }
  */

  function triggerPanelAlert() {}

  function clearPanelAlert() {}

  const panelBody = document.createElement("div");
  panelBody.setAttribute("data-alpha-panel-body", "1");
  panelBody.style.cssText = [
    "display: flex",
    "flex-direction: column",
    "flex: 1 1 auto",
    "min-height: 0",
    "overflow: hidden",
    "padding: 0 14px 16px 14px",
    "box-sizing: border-box"
  ].join(";");

  /** 表单区：可纵向滚动；与下方日志区 flex 分配剩余高度 */
  const panelMain = document.createElement("div");
  panelMain.setAttribute("data-alpha-panel-main", "1");
  panelMain.style.cssText = [
    "flex: 0 1 auto",
    "min-height: 0",
    "overflow-x: hidden",
    "overflow-y: auto"
  ].join(";");

  const dragHandle = document.createElement("div");
  dragHandle.setAttribute("data-alpha-drag-handle", "1");
  dragHandle.textContent = "下单面板 · 拖动移动 · 右下角调整大小";
  dragHandle.style.cssText = [
    "flex-shrink: 0",
    "cursor: grab",
    "user-select: none",
    "-webkit-user-select: none",
    "padding: 10px 14px",
    "margin: 0",
    "border-radius: 12px 12px 0 0",
    "background: rgba(0,0,0,0.06)",
    "font-size: 14px",
    "color: #555",
    "text-align: center",
    "border-bottom: 1px solid rgba(0,0,0,0.06)"
  ].join(";");

  try {
    const saved = sessionStorage.getItem(C.BUYUI_DRAG_KEY);
    if (saved) {
      const pos = JSON.parse(saved);
      if (typeof pos.left === "number" && typeof pos.top === "number") {
        container.style.left = `${pos.left}px`;
        container.style.top = `${pos.top}px`;
      }
    }
  } catch {
    /* ignore */
  }

  const dragState = { active: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 };
  function clampPanelPosition() {
    const rect = container.getBoundingClientRect();
    const margin = 8;
    const maxL = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxT = Math.max(margin, window.innerHeight - rect.height - margin);
    let l = parseFloat(container.style.left) || rect.left;
    let t = parseFloat(container.style.top) || rect.top;
    l = Math.min(maxL, Math.max(margin, l));
    t = Math.min(maxT, Math.max(margin, t));
    container.style.left = `${l}px`;
    container.style.top = `${t}px`;
    try {
      sessionStorage.setItem(C.BUYUI_DRAG_KEY, JSON.stringify({ left: l, top: t }));
    } catch {
      /* ignore */
    }
  }
  function onDragMove(e) {
    if (!dragState.active) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    container.style.left = `${dragState.origLeft + dx}px`;
    container.style.top = `${dragState.origTop + dy}px`;
  }
  function onDragEnd() {
    if (!dragState.active) return;
    dragState.active = false;
    dragHandle.style.cursor = "grab";
    window.removeEventListener("mousemove", onDragMove);
    window.removeEventListener("mouseup", onDragEnd);
    clampPanelPosition();
  }
  dragHandle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const rect = container.getBoundingClientRect();
    dragState.active = true;
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    dragState.origLeft = rect.left;
    dragState.origTop = rect.top;
    dragHandle.style.cursor = "grabbing";
    e.preventDefault();
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
  });

  function persistPanelSize() {
    try {
      const w = parseFloat(container.style.width) || container.getBoundingClientRect().width;
      const h = parseFloat(container.style.height) || container.getBoundingClientRect().height;
      if (Number.isFinite(w) && Number.isFinite(h)) {
        sessionStorage.setItem(C.BUYUI_SIZE_KEY, JSON.stringify({ width: w, height: h }));
      }
    } catch {
      /* ignore */
    }
  }

  function clampPanelSize() {
    const margin = 8;
    const rect = container.getBoundingClientRect();
    let w = parseFloat(container.style.width) || rect.width;
    let h = parseFloat(container.style.height) || rect.height;
    const maxW = Math.min(C.BUYUI_MAX_WIDTH, window.innerWidth - margin * 2);
    const maxH = Math.max(C.BUYUI_MIN_HEIGHT, window.innerHeight - margin * 2);
    w = Math.min(maxW, Math.max(C.BUYUI_MIN_WIDTH, w));
    h = Math.min(maxH, Math.max(C.BUYUI_MIN_HEIGHT, h));
    container.style.width = `${w}px`;
    container.style.height = `${h}px`;
    persistPanelSize();
  }

  const resizeState = { active: false, startX: 0, startY: 0, origW: 0, origH: 0 };
  function onResizeMove(e) {
    if (!resizeState.active) return;
    const dw = e.clientX - resizeState.startX;
    const dh = e.clientY - resizeState.startY;
    const margin = 8;
    const maxW = Math.min(C.BUYUI_MAX_WIDTH, window.innerWidth - margin * 2);
    const maxH = Math.max(C.BUYUI_MIN_HEIGHT, window.innerHeight - margin * 2);
    let w = resizeState.origW + dw;
    let h = resizeState.origH + dh;
    w = Math.min(maxW, Math.max(C.BUYUI_MIN_WIDTH, w));
    h = Math.min(maxH, Math.max(C.BUYUI_MIN_HEIGHT, h));
    container.style.width = `${w}px`;
    container.style.height = `${h}px`;
  }
  function onResizeEnd() {
    if (!resizeState.active) return;
    resizeState.active = false;
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
    clampPanelSize();
    clampPanelPosition();
  }

  const resizeHandle = document.createElement("div");
  resizeHandle.setAttribute("data-alpha-resize-handle", "1");
  resizeHandle.title = "拖动调整大小";
  resizeHandle.style.cssText = [
    "position: absolute",
    "right: 0",
    "bottom: 0",
    "width: 16px",
    "height: 16px",
    "cursor: nwse-resize",
    "z-index: 2",
    "border-radius: 0 0 10px 0",
    "background: linear-gradient(135deg, transparent 52%, rgba(0,0,0,0.1) 52%)",
    "box-sizing: border-box"
  ].join(";");

  resizeHandle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = container.getBoundingClientRect();
    resizeState.active = true;
    resizeState.startX = e.clientX;
    resizeState.startY = e.clientY;
    resizeState.origW = rect.width;
    resizeState.origH = rect.height;
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
  });

  window.addEventListener("resize", () => {
    clampPanelSize();
    clampPanelPosition();
  });

  function normalizeAlphaTicker(s) {
    return String(s || "").trim().toUpperCase();
  }

  let contractSymbol = AlphaExtCommon.toFuturesContractSymbol(alpha);
  let alphaSpot = AlphaExtCommon.toAlphaSpotDisplayName(alpha);
  let currentAlphaTicker = normalizeAlphaTicker(alpha);
  const contractPriceRowStyle = [
    "margin-bottom: 10px",
    "padding: 8px 10px",
    "border-radius: 8px",
    "background: rgba(0,0,0,0.04)",
    "font-size: 14px",
    "color: #333",
    "word-break: break-all"
  ].join(";");

  const contractPriceRowMark = document.createElement("div");
  contractPriceRowMark.style.cssText = contractPriceRowStyle;
  contractPriceRowMark.textContent = `标记价格 (${contractSymbol}): …`;

  const contractPriceRowTrade = document.createElement("div");
  contractPriceRowTrade.style.cssText = `${contractPriceRowStyle};margin-top: 10px`;
  contractPriceRowTrade.textContent = `合约最新成交价 (${contractSymbol}): …`;

  let lastMarkDisp = "…";
  let lastTradeDisp = "…";

  function mountContractPriceFeed() {
    if (AlphaExtTradeRuntime.contractPriceFeedControl) {
      AlphaExtTradeRuntime.contractPriceFeedControl.stop();
    }
    AlphaExtTradeRuntime.contractPriceFeedControl = AlphaExtWs.createContractPriceFeed({
      symbol: contractSymbol,
      onUpdate: (u) => {
        if (u.markPrice != null) lastMarkDisp = AlphaExtCommon.formatContractPriceDisplayString(u.markPrice);
        if (u.lastPrice != null) lastTradeDisp = AlphaExtCommon.formatContractPriceDisplayString(u.lastPrice);
        contractPriceRowMark.textContent = `标记价格 (${contractSymbol}): ${lastMarkDisp}`;
        contractPriceRowTrade.textContent = `合约最新成交价 (${contractSymbol}): ${lastTradeDisp}`;
        contractPriceRowMark.style.color = "#222";
        contractPriceRowTrade.style.color = "#222";
      },
      onError: (e) => {
        const msg = String(e?.message || e);
        contractPriceRowMark.textContent = `标记价格 (${contractSymbol}): — · ${msg}`;
        contractPriceRowTrade.textContent = `合约最新成交价 (${contractSymbol}): — · ${msg}`;
        contractPriceRowMark.style.color = "#b00020";
        contractPriceRowTrade.style.color = "#b00020";
      }
    });
  }

  mountContractPriceFeed();

  const fieldInputStyle = [
    "width: 100%",
    "box-sizing: border-box",
    "padding: 10px 12px",
    "border-radius: 10px",
    "border: 1px solid rgba(0,0,0,0.18)",
    "outline: none",
    "font-size: 14px"
  ].join(";");
  const fieldLabelStyle = ["margin-top: 12px", "margin-bottom: 8px", "color: rgba(0,0,0,0.65)", "font-size: 14px"].join(";");

  const modeRow = document.createElement("div");
  modeRow.style.cssText = "margin-top: 12px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;";
  const modeTitle = document.createElement("span");
  modeTitle.textContent = "交易方向";
  modeTitle.style.cssText = "font-size: 14px; color: rgba(0,0,0,0.65);";
  const modeSelectStyle = [
    "flex: 0 1 auto",
    "min-width: 140px",
    "padding: 8px 10px",
    "border-radius: 10px",
    "border: 1px solid rgba(0,0,0,0.18)",
    "background: #fff",
    "font-size: 14px",
    "color: #333",
    "outline: none"
  ].join(";");
  const modeSelect = document.createElement("select");
  modeSelect.setAttribute("aria-label", "交易方向");
  modeSelect.style.cssText = modeSelectStyle;
  const optDirPlaceholder = document.createElement("option");
  optDirPlaceholder.value = "";
  optDirPlaceholder.textContent = "请选择";
  const optDirBuy = document.createElement("option");
  optDirBuy.value = "buy";
  optDirBuy.textContent = "买入";
  const optDirSell = document.createElement("option");
  optDirSell.value = "sell";
  optDirSell.textContent = "卖出";
  modeSelect.appendChild(optDirPlaceholder);
  modeSelect.appendChild(optDirBuy);
  modeSelect.appendChild(optDirSell);
  modeRow.appendChild(modeTitle);
  modeRow.appendChild(modeSelect);

  const patternRow = document.createElement("div");
  patternRow.style.cssText =
    "margin-top: 16px; margin-bottom: 22px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;";
  const patternTitle = document.createElement("span");
  patternTitle.textContent = "交易模式";
  patternTitle.style.cssText = "font-size: 14px; color: rgba(0,0,0,0.65);";
  const patternTargetLabel = document.createElement("label");
  patternTargetLabel.style.cssText =
    "display: inline-flex; align-items: center; gap: 4px; cursor: pointer; font-size: 14px;";
  const radioPatternTarget = document.createElement("input");
  radioPatternTarget.type = "radio";
  radioPatternTarget.name = "alpha-ext-automation-pattern";
  radioPatternTarget.value = "target";
  radioPatternTarget.checked = true;
  patternTargetLabel.appendChild(radioPatternTarget);
  patternTargetLabel.appendChild(document.createTextNode("目标价交易模式"));
  const patternStrategyLabel = document.createElement("label");
  patternStrategyLabel.style.cssText =
    "display: inline-flex; align-items: center; gap: 4px; cursor: not-allowed; font-size: 14px; color: rgba(0,0,0,0.45);";
  const radioPatternStrategy = document.createElement("input");
  radioPatternStrategy.type = "radio";
  radioPatternStrategy.name = "alpha-ext-automation-pattern";
  radioPatternStrategy.value = "strategy";
  radioPatternStrategy.disabled = true;
  patternStrategyLabel.title = "待实现";
  patternStrategyLabel.appendChild(radioPatternStrategy);
  patternStrategyLabel.appendChild(document.createTextNode("策略交易模式（待实现）"));
  patternRow.appendChild(patternTitle);
  patternRow.appendChild(patternTargetLabel);
  patternRow.appendChild(patternStrategyLabel);

  const label = document.createElement("div");
  label.style.cssText = "margin-bottom: 14px; color: rgba(0,0,0,0.75); font-size: 14px;";
  label.textContent = `请输入${alphaSpot}的目标价（须先选择交易方向）`;

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.placeholder = `目标价（${alphaSpot}）`;
  input.style.cssText = fieldInputStyle;

  const selectUnitStyle = [
    "flex: 0 0 auto",
    "padding: 8px 10px",
    "border-radius: 10px",
    "border: 1px solid rgba(0,0,0,0.18)",
    "background: #fff",
    "font-size: 14px",
    "color: #333",
    "outline: none",
    "max-width: 96px"
  ].join(";");

  const totalLimitLabel = document.createElement("div");
  totalLimitLabel.style.cssText = fieldLabelStyle;
  totalLimitLabel.textContent = "总限制（选填）";

  const totalLimitRow = document.createElement("div");
  totalLimitRow.style.cssText = "display: flex; gap: 10px; align-items: center; width: 100%";
  const totalLimitInput = document.createElement("input");
  totalLimitInput.type = "text";
  totalLimitInput.inputMode = "decimal";
  totalLimitInput.placeholder = `上限（选填）`;
  totalLimitInput.style.cssText = [
    "flex: 1 1 auto",
    "min-width: 0",
    "box-sizing: border-box",
    "padding: 10px 12px",
    "border-radius: 10px",
    "border: 1px solid rgba(0,0,0,0.18)",
    "outline: none",
    "font-size: 14px"
  ].join(";");
  const totalLimitUnit = document.createElement("select");
  totalLimitUnit.setAttribute("aria-label", "总限制单位");
  totalLimitUnit.style.cssText = selectUnitStyle;
  const optTotalAmt = document.createElement("option");
  optTotalAmt.value = "amount";
  optTotalAmt.textContent = C.AMOUNT_LIMIT_CURRENCY;
  const optTotalQty = document.createElement("option");
  optTotalQty.value = "qty";
  optTotalQty.textContent = "数量";
  totalLimitUnit.appendChild(optTotalAmt);
  totalLimitUnit.appendChild(optTotalQty);
  totalLimitRow.appendChild(totalLimitInput);
  totalLimitRow.appendChild(totalLimitUnit);

  const perTradeLimitLabel = document.createElement("div");
  perTradeLimitLabel.style.cssText = fieldLabelStyle;
  perTradeLimitLabel.textContent = "单次限制（选填）";

  const perTradeLimitRow = document.createElement("div");
  perTradeLimitRow.style.cssText = "display: flex; gap: 10px; align-items: center; width: 100%";
  const perTradeLimitInput = document.createElement("input");
  perTradeLimitInput.type = "text";
  perTradeLimitInput.inputMode = "decimal";
  perTradeLimitInput.placeholder = `上限（选填）`;
  perTradeLimitInput.style.cssText = [
    "flex: 1 1 auto",
    "min-width: 0",
    "box-sizing: border-box",
    "padding: 10px 12px",
    "border-radius: 10px",
    "border: 1px solid rgba(0,0,0,0.18)",
    "outline: none",
    "font-size: 14px"
  ].join(";");
  const perTradeLimitUnit = document.createElement("select");
  perTradeLimitUnit.setAttribute("aria-label", "单次限制单位");
  perTradeLimitUnit.style.cssText = selectUnitStyle;
  const optPerAmt = document.createElement("option");
  optPerAmt.value = "amount";
  optPerAmt.textContent = C.AMOUNT_LIMIT_CURRENCY;
  const optPerQty = document.createElement("option");
  optPerQty.value = "qty";
  optPerQty.textContent = "数量";
  perTradeLimitUnit.appendChild(optPerAmt);
  perTradeLimitUnit.appendChild(optPerQty);
  perTradeLimitRow.appendChild(perTradeLimitInput);
  perTradeLimitRow.appendChild(perTradeLimitUnit);

  const perTradeRestingLabel = document.createElement("label");
  perTradeRestingLabel.style.cssText =
    "display: flex; align-items: center; gap: 10px; margin-top: 10px; margin-bottom: 6px; font-size: 14px; color: rgba(0,0,0,0.6); cursor: pointer; user-select: none; line-height: 1.35;";
  const perTradeAllowRestingCheckbox = document.createElement("input");
  perTradeAllowRestingCheckbox.type = "checkbox";
  perTradeAllowRestingCheckbox.checked = false;
  perTradeAllowRestingCheckbox.style.cssText = "flex-shrink: 0; margin: 0; vertical-align: middle;";
  const perTradeRestingText = document.createElement("span");
  function syncPerTradeRestingLabel() {
    const on = perTradeAllowRestingCheckbox.checked;
    const msg = on ? "允许产生委托单" : "不产生委托单";
    perTradeRestingText.textContent = msg;
    perTradeAllowRestingCheckbox.setAttribute("aria-label", msg);
  }
  perTradeRestingLabel.appendChild(perTradeAllowRestingCheckbox);
  perTradeRestingLabel.appendChild(perTradeRestingText);
  perTradeAllowRestingCheckbox.addEventListener("change", syncPerTradeRestingLabel);
  syncPerTradeRestingLabel();

  /** 上一笔确认完成后至下一次尝试的默认等待（秒）；输入框可改，留空则无额外等待 */
  const DEFAULT_TRADE_INTERVAL_SEC = 5;

  const tradeIntervalLabel = document.createElement("div");
  tradeIntervalLabel.style.cssText = fieldLabelStyle;
  tradeIntervalLabel.textContent = `交易时间间隔（秒，选填，默认 ${DEFAULT_TRADE_INTERVAL_SEC}；上一笔确认完成后至下一次尝试，不填则无额外等待）`;

  const tradeIntervalInput = document.createElement("input");
  tradeIntervalInput.type = "text";
  tradeIntervalInput.inputMode = "decimal";
  tradeIntervalInput.placeholder = `默认 ${DEFAULT_TRADE_INTERVAL_SEC} 秒；留空则无额外等待`;
  tradeIntervalInput.value = String(DEFAULT_TRADE_INTERVAL_SEC);
  tradeIntervalInput.setAttribute("aria-label", "交易时间间隔（秒）");
  tradeIntervalInput.style.cssText = fieldInputStyle;

  function syncLimitPlaceholders() {
    totalLimitInput.placeholder =
      totalLimitUnit.value === "amount"
        ? `累计 / ${C.AMOUNT_LIMIT_CURRENCY}（选填）`
        : `累计数量（选填）`;
    perTradeLimitInput.placeholder =
      perTradeLimitUnit.value === "amount"
        ? `单笔 / ${C.AMOUNT_LIMIT_CURRENCY}（选填）`
        : `单笔数量（选填）`;
  }
  totalLimitUnit.addEventListener("change", syncLimitPlaceholders);
  perTradeLimitUnit.addEventListener("change", syncLimitPlaceholders);
  syncLimitPlaceholders();

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "自动买入";
  button.disabled = true;
  button.style.cssText = [
    "flex: 1 1 0",
    "min-width: 0",
    "margin-top: 0",
    "padding: 9px 10px",
    "border-radius: 10px",
    "border-width: 1px",
    "border-style: solid",
    "font-weight: 500",
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "box-sizing: border-box"
  ].join(";");

  const stopButton = document.createElement("button");
  stopButton.type = "button";
  stopButton.textContent = "停止";
  stopButton.disabled = true;
  stopButton.style.cssText = [
    "flex: 1 1 0",
    "min-width: 0",
    "margin-top: 0",
    "padding: 9px 10px",
    "border-radius: 10px",
    "border-width: 1px",
    "border-style: solid",
    "font-weight: 500",
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "box-sizing: border-box"
  ].join(";");

  const buttonRow = document.createElement("div");
  buttonRow.setAttribute("data-alpha-auto-stop-row", "1");
  buttonRow.style.cssText = [
    "display: flex",
    "flex-direction: row",
    "align-items: stretch",
    "gap: 10px",
    "margin-top: 14px",
    "width: 100%",
    "box-sizing: border-box"
  ].join(";");
  buttonRow.appendChild(button);
  buttonRow.appendChild(stopButton);

  const status = document.createElement("div");
  status.id = C.BUY_UI_STATUS_ID;
  status.style.cssText = ["margin-top: 12px", "color: #666", "font-size: 14px", "min-height: 1.2em"].join(";");

  const logTitle = document.createElement("div");
  logTitle.textContent = "操作日志";
  logTitle.style.cssText =
    "flex-shrink: 0; margin-top: 14px; font-size: 14px; color: rgba(0,0,0,0.5); font-weight: 600;";

  const logPanel = document.createElement("div");
  logPanel.id = C.BUY_UI_LOG_ID;
  logPanel.style.cssText = [
    "flex: 1 1 0",
    "min-height: 48px",
    "margin-top: 8px",
    "overflow-y: auto",
    "overflow-x: hidden",
    "padding: 8px 10px",
    "border-radius: 8px",
    "background: rgba(0,0,0,0.04)",
    "font-size: 14px",
    "color: #444",
    "line-height: 1.35"
  ].join(";");

  function formatLogTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function appendLogLine(text) {
    const t = String(text ?? "").trim();
    if (!t) return;
    const line = document.createElement("div");
    line.style.margin = "2px 0";
    line.style.wordBreak = "break-word";
    line.textContent = `[${formatLogTimestamp()}] ${t}`;
    logPanel.appendChild(line);
    logPanel.scrollTop = logPanel.scrollHeight;
  }

  /** 周期性刷新的同类状态（如等待盘口）只向日志写一次；status 仍每次刷新 */
  let lastStatusLogDedupeKey = null;

  function dedupeKeyForStatusMessage(t) {
    const s = String(t || "").trim();
    if (!s) return null;
    if (s.startsWith("等待卖一价")) return "wait:lowest_ask";
    if (s.startsWith("等待最高买一价")) return "wait:best_bid";
    if (s === "请先切换到订单簿") return "wait:orderbook";
    if (s === "目标价须为大于 0 的有效数字，请修改后重试") return "wait:invalid_target";
    /** 弹窗「继续」可能多轮 tick 仍可见，状态文案相同则只记一条日志 */
    if (s.includes("已点击确认继续")) return "confirm:clicked_continue";
    return null;
  }

  function setStatus(text) {
    const t = String(text ?? "");
    status.textContent = t;
    const trimmed = t.trim();
    if (!trimmed) return;
    const dKey = dedupeKeyForStatusMessage(trimmed);
    if (dKey !== null) {
      if (dKey === lastStatusLogDedupeKey) return;
      lastStatusLogDedupeKey = dKey;
    } else {
      lastStatusLogDedupeKey = null;
    }
    appendLogLine(trimmed);
  }

  /** @type {'buy' | 'sell' | null} */
  let tradeMode = null;

  /** @type {'target' | 'strategy'} 目标价交易模式为默认；策略交易模式待接入 */
  let automationPattern = "target";

  // 自动控制状态（在同一个页面的 content script 生命周期内生效）
  let autoRunning = false;
  let autoLoopToken = 0;
  let totalTradeAmount = 0;
  let totalTradeQty = 0;
  let tradeCount = 0;

  /** 本段自动任务累计（本地估算，仅计入「确认完成」的笔）；买入/卖出停止或自然结束时写入 status 与日志 */
  function formatTradeSessionSummary() {
    const cur = C.AMOUNT_LIMIT_CURRENCY;
    const amt = Number.isFinite(totalTradeAmount) ? totalTradeAmount : 0;
    const qty = Number.isFinite(totalTradeQty) ? totalTradeQty : 0;
    if (amt <= 0 && qty <= 0) {
      return `本次无成交（交易总金额 0 ${cur}，总数量 0）`;
    }
    const avg = qty > 0 ? amt / qty : null;
    const avgStr =
      avg !== null && Number.isFinite(avg)
        ? `平均价 ${avg.toFixed(6)} ${cur}`
        : `平均价 —`;
    return `交易总金额 ${amt.toFixed(6)} ${cur}，总数量 ${qty.toFixed(8)}，${avgStr}`;
  }

  /** 切换交易方向或重置符号时清空累计与单笔/总限制，避免跨方向污染 */
  function resetSessionTradeTotalsAndLimits() {
    totalTradeAmount = 0;
    totalTradeQty = 0;
    tradeCount = 0;
    lastStatusLogDedupeKey = null;
    status.textContent = "";
    totalLimitInput.value = "";
    perTradeLimitInput.value = "";
    perTradeAllowRestingCheckbox.checked = false;
    syncPerTradeRestingLabel();
  }

  function getAutoIdleText() {
    return tradeMode === "sell" ? "自动卖出" : "自动买入";
  }
  function getAutoWorkText() {
    return tradeMode === "sell" ? "自动卖出中..." : "自动买入中...";
  }
  function autoTaskLabel() {
    return tradeMode === "sell" ? "自动卖出" : "自动买入";
  }

  /** 未运行：播放；运行中：暂停（fill=currentColor，随主按钮黑字/灰字） */
  const ICON_PLAY =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_PAUSE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>';

  function autoButtonHtml(running) {
    const icon = running ? ICON_PAUSE : ICON_PLAY;
    const label = running ? getAutoWorkText() : getAutoIdleText();
    return (
      `<span style="display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%">` +
      `<span style="display:inline-flex;line-height:0;flex-shrink:0">${icon}</span>` +
      `<span>${label}</span></span>`
    );
  }

  function stopButtonHtml(stopActive) {
    const fill = stopActive ? "#ffffff" : "rgba(255,255,255,0.82)";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="${fill}" d="M6 6h12v12H6z"/></svg>`;
    return (
      `<span style="display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%">` +
      `${svg}` +
      `<span>停止</span></span>`
    );
  }

  /** 主按钮：绿底 + 黑字/图标；禁用态仍为绿色系，仅弱化对比 */
  function applyMainButtonVisualState(state) {
    if (state === "runningDisabled") {
      button.style.background = "#4ade80";
      button.style.color = "rgba(0,0,0,0.42)";
      button.style.borderColor = "rgba(22,101,52,0.35)";
      button.style.cursor = "not-allowed";
      button.style.opacity = "1";
      button.style.boxShadow = "inset 0 1px 3px rgba(0,0,0,0.12)";
      button.style.filter = "saturate(0.92)";
    } else if (state === "idleEnabled") {
      button.style.background = "#22c55e";
      button.style.color = "#111111";
      button.style.borderColor = "#15803d";
      button.style.cursor = "pointer";
      button.style.opacity = "1";
      button.style.boxShadow = "0 1px 3px rgba(22,101,52,0.35)";
      button.style.filter = "none";
    } else {
      button.style.background = "#86efac";
      button.style.color = "rgba(0,0,0,0.4)";
      button.style.borderColor = "rgba(22,101,52,0.28)";
      button.style.cursor = "not-allowed";
      button.style.opacity = "1";
      button.style.boxShadow = "inset 0 1px 2px rgba(0,0,0,0.06)";
      button.style.filter = "saturate(0.88)";
    }
  }

  /** 停止：红底 + 白字/白图标；禁用态仍为红色系，仅弱化 */
  function applyStopButtonVisualState(enabled) {
    if (enabled) {
      stopButton.style.background = "#dc2626";
      stopButton.style.color = "#ffffff";
      stopButton.style.borderColor = "#b91c1c";
      stopButton.style.cursor = "pointer";
      stopButton.style.opacity = "1";
      stopButton.style.boxShadow = "0 1px 3px rgba(185,28,28,0.45)";
      stopButton.style.filter = "none";
    } else {
      stopButton.style.background = "#fca5a5";
      stopButton.style.color = "rgba(255,255,255,0.88)";
      stopButton.style.borderColor = "#f87171";
      stopButton.style.cursor = "not-allowed";
      stopButton.style.opacity = "1";
      stopButton.style.boxShadow = "inset 0 1px 2px rgba(0,0,0,0.06)";
      stopButton.style.filter = "saturate(0.85)";
    }
  }

  function updateTargetLabels() {
    if (tradeMode === "buy") {
      label.textContent = `请输入${alphaSpot}的买入目标价`;
      input.placeholder = `请输入${alphaSpot}的买入目标价`;
    } else if (tradeMode === "sell") {
      label.textContent = `请输入${alphaSpot}的卖出目标价`;
      input.placeholder = `请输入${alphaSpot}的卖出目标价`;
    } else {
      label.textContent = `请输入${alphaSpot}的目标价（须先选择交易方向）`;
      input.placeholder = `目标价（${alphaSpot}）`;
    }
  }

  function updateLimitLabels() {
    const side = tradeMode === "sell" ? "卖出" : tradeMode === "buy" ? "买入" : "交易";
    totalLimitLabel.textContent = `总${side}限制（选填；右侧选单位：${C.AMOUNT_LIMIT_CURRENCY} 或 数量）`;
    perTradeLimitLabel.textContent = `单次${side}限制（选填；右侧选单位：${C.AMOUNT_LIMIT_CURRENCY} 或 数量）`;
    syncLimitPlaceholders();
  }

  function onTradeModeChange() {
    const v = modeSelect.value;
    tradeMode = v === "buy" ? "buy" : v === "sell" ? "sell" : null;
    resetSessionTradeTotalsAndLimits();
    if (tradeMode === "buy" || tradeMode === "sell") {
      appendLogLine(`已切换交易方向 → ${tradeMode === "buy" ? "买入" : "卖出"}`);
    }
    if (tradeMode === "buy") AlphaExtBuy.ensureTab();
    else if (tradeMode === "sell") AlphaExtSell.ensureTab();
    updateTargetLabels();
    updateLimitLabels();
    refreshButtonState();
  }
  modeSelect.addEventListener("change", onTradeModeChange);
  updateLimitLabels();

  function syncAutomationPatternFromRadios() {
    automationPattern = radioPatternStrategy.checked ? "strategy" : "target";
  }

  function onAutomationPatternChange() {
    syncAutomationPatternFromRadios();
    refreshButtonState();
  }
  radioPatternTarget.addEventListener("change", onAutomationPatternChange);
  radioPatternStrategy.addEventListener("change", onAutomationPatternChange);

  function setRunningUI(running) {
    autoRunning = running;
    modeSelect.disabled = running;
    input.disabled = running;
    input.title = running ? "自动任务运行中，请先点「停止」后再修改目标价" : "";
    totalLimitInput.disabled = running;
    totalLimitUnit.disabled = running;
    perTradeLimitInput.disabled = running;
    perTradeLimitUnit.disabled = running;
    perTradeAllowRestingCheckbox.disabled = running;
    tradeIntervalInput.disabled = running;
    const limitTitle = running ? "自动任务运行中，请先点「停止」后再修改限制" : "";
    totalLimitInput.title = limitTitle;
    totalLimitUnit.title = limitTitle;
    perTradeLimitInput.title = limitTitle;
    perTradeLimitUnit.title = limitTitle;
    perTradeAllowRestingCheckbox.title = running
      ? "自动任务运行中，请先点「停止」后再修改"
      : "";
    tradeIntervalInput.title = running ? "自动任务运行中，请先点「停止」后再修改间隔" : "";
    if (autoRunning) {
      button.disabled = true;
      button.innerHTML = autoButtonHtml(true);
      applyMainButtonVisualState("runningDisabled");
      stopButton.disabled = false;
      stopButton.innerHTML = stopButtonHtml(true);
      applyStopButtonVisualState(true);
    } else {
      syncAutomationPatternFromRadios();
      refreshButtonState();
      stopButton.disabled = true;
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 须在点击订单簿并 applyPerTradeLimitToOrderInputs 之后调用。
   * 余额解析见 AlphaExtCommon.readBalanceForFundCheck；买卖校验见 AlphaExtBuy / AlphaExtSell 的 checkFundVsMinOrder。
   * @param {number} edgePrice 本档盘口价
   */
  function checkFundVsMinOrder(edgePrice) {
    const amtSel = String(C.ORDER_AMOUNT_SELECTOR || "").trim();
    const qtySel = String(C.ORDER_QUANTITY_SELECTOR || "").trim();
    if (!amtSel && !qtySel) return { ok: true, skipped: true };

    const edgePx =
      typeof edgePrice === "number" && Number.isFinite(edgePrice) ? edgePrice : null;

    const balRes = AlphaExtCommon.readBalanceForFundCheck(tradeMode);
    if (balRes.type === "skip") return { ok: true, skipped: true };
    if (balRes.type === "fail") return { ok: false, message: balRes.message };

    if (tradeMode === "sell") {
      return AlphaExtSell.checkFundVsMinOrder(edgePx, balRes.balance);
    }
    return AlphaExtBuy.checkFundVsMinOrder(edgePx, balRes.balance);
  }

  function refreshButtonState() {
    if (autoRunning) return;

    syncAutomationPatternFromRadios();
    const validPrice = readTargetPrice() !== null;
    const canStart = tradeMode !== null && validPrice && automationPattern === "target";
    button.innerHTML = autoButtonHtml(false);
    button.disabled = !canStart;
    applyMainButtonVisualState(button.disabled ? "idleDisabled" : "idleEnabled");
    stopButton.innerHTML = stopButtonHtml(false);
    applyStopButtonVisualState(false);
  }

  input.addEventListener("input", () => {
    refreshButtonState();
  });
  refreshButtonState();

  /** 买入目标价：须为有限数字且 **> 0** */
  function readTargetPrice() {
    const n = AlphaExtCommon.parseNumber(input.value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  /** 选填数字：空为 null，非法为 NaN */
  function readOptionalLimitField(inputEl) {
    const raw = String(inputEl.value || "").trim();
    if (!raw) return null;
    const n = AlphaExtCommon.parseNumber(raw);
    if (!Number.isFinite(n)) return NaN;
    return n;
  }

  /** 选填：空为 null；填了则须为 ≥0.01 的有限数字（秒） */
  function readOptionalTradeIntervalSeconds() {
    const raw = String(tradeIntervalInput.value || "").trim();
    if (!raw) return null;
    const n = AlphaExtCommon.parseNumber(raw);
    if (!Number.isFinite(n) || n < 0.01) return NaN;
    return n;
  }

  async function waitForOrderButton(selector, timeoutMs, token) {
    const startAt = Date.now();
    while (Date.now() - startAt < timeoutMs) {
      if (!autoRunning || autoLoopToken !== token) return null;
      const btn = document.querySelector(selector);
      if (btn) return btn;
      await delay(200);
    }
    return null;
  }

  /**
   * 等待真实下单/确认流程结束：出现弹窗则点击「继续」；点击过且确认按钮已消失则视为本笔完成。
   * @param {number} attemptIndex 本笔序号（从 1 起；未确认前勿递增 tradeCount，故由调用方传入 tradeCount+1）
   * @returns {Promise<{ completed: boolean, reason?: 'stopped' | 'timeout' }>}
   */
  function waitUntilOrderComplete(token, attemptIndex) {
    setStatus(`第 ${attemptIndex} 笔：等待确认弹窗…`);
    const maxWaitMs = Number(C.ORDER_CONFIRM_MAX_WAIT_MS) || 120000;
    const startAt = Date.now();
    return new Promise((resolve) => {
      let hasClickedConfirm = false;

      function tick() {
        if (!autoRunning || autoLoopToken !== token) {
          resolve({ completed: false, reason: "stopped" });
          return;
        }

        if (Date.now() - startAt >= maxWaitMs) {
          setStatus(
            `第 ${attemptIndex} 笔：等待确认超时（${Math.round(maxWaitMs / 1000)} 秒内未完成确认流程）`
          );
          resolve({ completed: false, reason: "timeout" });
          return;
        }

        const confirmBtn = document.querySelector(C.ORDERBOOK_ASK_CONFIRM_CONTINUE_BUTTON_SELECTOR);
        if (confirmBtn) {
          confirmBtn.click();
          hasClickedConfirm = true;
          setStatus(`第 ${attemptIndex} 笔：已点击确认继续…`);
          setTimeout(tick, C.ORDER_COMPLETE_POLL_MS);
          return;
        }

        if (hasClickedConfirm) {
          setStatus(`第 ${attemptIndex} 笔：已确认完成`);
          resolve({ completed: true });
          return;
        }

        setTimeout(tick, C.ORDER_COMPLETE_POLL_MS);
      }

      tick();
    });
  }

  /**
   * 买卖共用的金额/数量限制校验；通过返回 null，否则返回 { didTrade: false, stop?: true }。
   * 仅「总限制」会与累计成交比较并在超限时 stop；「单次限制」只用于写入下单框（见 applyPerTradeLimitToOrderInputs），此处不拦截。
   */
  function validateTradeLimitsForAttempt(o) {
    const Cc = o.CONST;
    const setStatus = o.setStatus;
    const readOptionalLimitField = o.readOptionalLimitField;
    const totalLimitInput = o.totalLimitInput;
    const perTradeLimitInput = o.perTradeLimitInput;
    const totalLimitUnit = o.totalLimitUnit;
    const totalTradeAmount = o.totalTradeAmount;
    const totalTradeQty = o.totalTradeQty;
    const tradeAmount = o.tradeAmount;
    const qtyPerTrade = o.qtyPerTrade;

    const rawTotal = readOptionalLimitField(totalLimitInput);
    const rawPer = readOptionalLimitField(perTradeLimitInput);
    let totalAmtLimit = null;
    let totalQtyLimit = null;

    if (rawTotal !== null) {
      if (!Number.isFinite(rawTotal)) {
        setStatus("总限制数值格式错误");
        return { didTrade: false, stop: true, panelAlert: true };
      }
      if (totalLimitUnit.value === "amount") totalAmtLimit = rawTotal;
      else totalQtyLimit = rawTotal;
    }
    if (rawPer !== null && !Number.isFinite(rawPer)) {
      setStatus("单次限制数值格式错误");
      return { didTrade: false, stop: true, panelAlert: true };
    }

    const needAmt = totalAmtLimit !== null;
    if (needAmt && (tradeAmount === null || !Number.isFinite(tradeAmount))) {
      setStatus(`无法计算本次名义金额（价×量，${Cc.AMOUNT_LIMIT_CURRENCY}），无法校验总金额限制`);
      return { didTrade: false, stop: true, panelAlert: true };
    }

    const needQty = totalQtyLimit !== null;
    if (needQty && !Number.isFinite(qtyPerTrade)) {
      setStatus("无法解析本档数量，无法校验总数量限制");
      return { didTrade: false, stop: true, panelAlert: true };
    }

    const sideWord = tradeMode === "sell" ? "卖出" : "买入";
    const usdtDone = Number.isFinite(totalTradeAmount) ? totalTradeAmount.toFixed(6) : String(totalTradeAmount);
    const usdtThis = Number.isFinite(tradeAmount) ? tradeAmount.toFixed(6) : String(tradeAmount);

    if (totalAmtLimit !== null) {
      if (totalTradeAmount >= totalAmtLimit) {
        setStatus(
          `已达到总${sideWord}金额限制（${Cc.AMOUNT_LIMIT_CURRENCY}）：累计名义 ${usdtDone} ${Cc.AMOUNT_LIMIT_CURRENCY}，上限 ${totalAmtLimit}，停止`
        );
        return { didTrade: false, stop: true };
      }
      if (totalTradeAmount + tradeAmount > totalAmtLimit) {
        setStatus(
          `即将超出总${sideWord}金额限制（${Cc.AMOUNT_LIMIT_CURRENCY}）：已成交名义 ${usdtDone} ${Cc.AMOUNT_LIMIT_CURRENCY}，本次约 ${usdtThis} ${Cc.AMOUNT_LIMIT_CURRENCY}，将超出上限 ${totalAmtLimit}，停止`
        );
        return { didTrade: false, stop: true };
      }
    }

    if (totalQtyLimit !== null) {
      if (totalTradeQty >= totalQtyLimit) {
        setStatus(
          `已达到总数量限制：累计 ${totalTradeQty} >= 上限 ${totalQtyLimit}，停止 · ${sideWord}累计名义金额约 ${usdtDone} ${Cc.AMOUNT_LIMIT_CURRENCY}`
        );
        return { didTrade: false, stop: true };
      }
      if (totalTradeQty + qtyPerTrade > totalQtyLimit) {
        setStatus(
          `即将超出总数量限制：累计 ${totalTradeQty} + 本次 ${qtyPerTrade} > 上限 ${totalQtyLimit}，停止 · ${sideWord}已成交名义 ${usdtDone} ${Cc.AMOUNT_LIMIT_CURRENCY}，本次数量对应名义约 ${usdtThis} ${Cc.AMOUNT_LIMIT_CURRENCY}`
        );
        return { didTrade: false, stop: true };
      }
    }

    return null;
  }

  function makeTradeAttemptCtx() {
    return {
      CONST: C,
      common: AlphaExtCommon,
      setStatus,
      readTargetPrice,
      readOptionalLimitField,
      totalLimitInput,
      perTradeLimitInput,
      totalLimitUnit,
      perTradeLimitUnit,
      get allowPerTradeRestingOrder() {
        return perTradeAllowRestingCheckbox.checked;
      },
      get totalTradeAmount() {
        return totalTradeAmount;
      },
      get totalTradeQty() {
        return totalTradeQty;
      },
      validateTradeLimits: validateTradeLimitsForAttempt,
      waitForOrderButton: (sel, ms) => waitForOrderButton(sel, ms, autoLoopToken),
      checkFundVsMinOrder,
      readBalanceForFundCheck: () => AlphaExtCommon.readBalanceForFundCheck(tradeMode),
      delay
    };
  }

  async function doOneTradeAttempt() {
    const ctx = makeTradeAttemptCtx();
    if (tradeMode === "buy") return AlphaExtBuy.doOneTradeAttempt(ctx);
    return AlphaExtSell.doOneTradeAttempt(ctx);
  }

  function stopAutoLoop(fromRestart = false) {
    autoLoopToken += 1;
    autoRunning = false;
    setRunningUI(false);
    refreshButtonState();
    if (!fromRestart) {
      clearPanelAlert();
      const summary = formatTradeSessionSummary();
      setStatus(`已停止${autoTaskLabel()} · ${summary}`);
    }
  }

  async function autoLoop(token) {
    autoRunning = true;
    totalTradeAmount = 0;
    totalTradeQty = 0;
    tradeCount = 0;
    setRunningUI(true);
    const loopStartMsg = `${autoTaskLabel()}循环启动中...`;
    setStatus(loopStartMsg);

    try {
      while (autoRunning && token === autoLoopToken) {
        const targetPrice = readTargetPrice();
        if (targetPrice === null) {
          setStatus("目标价须为大于 0 的有效数字，请修改后重试");
          await delay(800);
          continue;
        }

        const result = await doOneTradeAttempt();

        if (!result || !result.didTrade) {
          if (result && result.stop) {
            if (result.panelAlert) triggerPanelAlert();
            break;
          }
          if (result && result.panelAlert) {
            triggerPanelAlert();
            stopAutoLoop(true);
            break;
          }

          if (result && typeof result.lowestPrice === "number") {
            const waitSide = tradeMode === "buy" ? AlphaExtBuy : AlphaExtSell;
            setStatus(waitSide.waitStatusText(result.lowestPrice, result.targetPrice));
          } else {
            setStatus("请先切换到订单簿");
          }
          await delay(500);
          continue;
        }

        const addAmt =
          typeof result.tradeAmount === "number" && Number.isFinite(result.tradeAmount)
            ? result.tradeAmount
            : (result.lowestPrice || 0) * (result.qtyPerTrade || 0);
        const nextAttemptIndex = tradeCount + 1;
        const sideWord = tradeMode === "sell" ? "卖出" : "买入";
        const amtStr = Number.isFinite(addAmt) ? addAmt.toFixed(6) : String(addAmt);
        setStatus(
          `已触发${sideWord} #${nextAttemptIndex}（本笔约 ${amtStr} ${C.AMOUNT_LIMIT_CURRENCY}，待确认）`
        );

        const orderWait = await waitUntilOrderComplete(token, nextAttemptIndex);
        if (!orderWait.completed) {
          if (orderWait.reason === "timeout") {
            triggerPanelAlert();
            stopAutoLoop(true);
          }
          continue;
        }

        tradeCount += 1;
        totalTradeAmount += addAmt;
        if (Number.isFinite(result.qtyPerTrade)) totalTradeQty += result.qtyPerTrade;

        setStatus(
          `已确认${sideWord} #${tradeCount}，累计名义金额（本地估算 / ${C.AMOUNT_LIMIT_CURRENCY}）= ${totalTradeAmount.toFixed(6)}`
        );

        const intervalSec = readOptionalTradeIntervalSeconds();
        if (intervalSec !== null && Number.isFinite(intervalSec) && intervalSec > 0) {
          await delay(Math.round(intervalSec * 1000));
        }
      }
    } finally {
      if (token === autoLoopToken) {
        autoRunning = false;
        setRunningUI(false);
        refreshButtonState();
        const summary = formatTradeSessionSummary();
        const lab = autoTaskLabel();
        const prev = String(status.textContent || "").trim();
        if (prev === loopStartMsg) {
          setStatus(`${lab}循环结束 · ${summary}`);
        } else if (prev) {
          setStatus(`${prev} · ${summary}`);
        } else {
          setStatus(summary);
        }
      }
    }
  }

  function startAutoLoop() {
    if (autoRunning) return;
    syncAutomationPatternFromRadios();
    if (automationPattern !== "target") {
      setStatus("策略交易模式待实现，请使用「目标价交易模式」");
      return;
    }
    if (tradeMode === null) {
      setStatus("请先选择交易方向（买入或卖出）");
      return;
    }
    if (readTargetPrice() === null) {
      setStatus(
        String(input.value || "").trim() ? "目标价须为大于 0 的有效数字" : "请填写目标价"
      );
      return;
    }
    const intervalSecStart = readOptionalTradeIntervalSeconds();
    if (intervalSecStart !== null && !Number.isFinite(intervalSecStart)) {
      setStatus("交易时间间隔须为空或 ≥ 0.01 秒的有效数字");
      return;
    }

    clearPanelAlert();
    autoLoopToken += 1;
    const token = autoLoopToken;
    autoLoop(token).catch((e) => {
      triggerPanelAlert();
      const summary = formatTradeSessionSummary();
      setStatus(`${autoTaskLabel()}出错: ${String(e?.message || e)} · ${summary}`);
      stopAutoLoop(true);
    });
  }

  button.addEventListener("click", () => {
    startAutoLoop();
  });

  stopButton.addEventListener("click", () => {
    stopAutoLoop();
  });

  function applyAlphaFromTitle(newAlpha) {
    const next = normalizeAlphaTicker(newAlpha);
    if (!next || next === currentAlphaTicker) return;
    currentAlphaTicker = next;
    contractSymbol = AlphaExtCommon.toFuturesContractSymbol(newAlpha);
    alphaSpot = AlphaExtCommon.toAlphaSpotDisplayName(newAlpha);

    if (autoRunning) stopAutoLoop(true);
    clearPanelAlert();
    resetSessionTradeTotalsAndLimits();
    input.value = "";
    tradeIntervalInput.value = String(DEFAULT_TRADE_INTERVAL_SEC);

    lastMarkDisp = "…";
    lastTradeDisp = "…";
    contractPriceRowMark.textContent = `标记价格 (${contractSymbol}): …`;
    contractPriceRowTrade.textContent = `合约最新成交价 (${contractSymbol}): …`;
    contractPriceRowMark.style.color = "#222";
    contractPriceRowTrade.style.color = "#222";

    mountContractPriceFeed();
    if (AlphaExtTradeRuntime.pendingBuyUIEnabled && AlphaExtTradeRuntime.contractPriceFeedControl) {
      AlphaExtTradeRuntime.contractPriceFeedControl.start();
    }

    updateTargetLabels();
    updateLimitLabels();
    syncLimitPlaceholders();
    refreshButtonState();
    if (tradeMode === "buy") AlphaExtBuy.ensureTab();
    else if (tradeMode === "sell") AlphaExtSell.ensureTab();

    appendLogLine(`已切换币种 → ${alphaSpot}`);
  }

  container.appendChild(dragHandle);
  panelMain.appendChild(contractPriceRowTrade);
  panelMain.appendChild(contractPriceRowMark);
  panelMain.appendChild(modeRow);
  panelMain.appendChild(patternRow);
  panelMain.appendChild(label);
  panelMain.appendChild(input);
  panelMain.appendChild(totalLimitLabel);
  panelMain.appendChild(totalLimitRow);
  panelMain.appendChild(perTradeLimitLabel);
  panelMain.appendChild(perTradeLimitRow);
  panelMain.appendChild(perTradeRestingLabel);
  panelMain.appendChild(tradeIntervalLabel);
  panelMain.appendChild(tradeIntervalInput);
  panelMain.appendChild(buttonRow);
  panelMain.appendChild(status);
  panelBody.appendChild(panelMain);
  panelBody.appendChild(logTitle);
  panelBody.appendChild(logPanel);
  container.appendChild(panelBody);
  container.appendChild(resizeHandle);
  document.documentElement.appendChild(container);
  clampPanelSize();
  clampPanelPosition();

  AlphaExtTradeRuntime.stopLoopWhenPanelDisabled = () => {
    if (!autoRunning) return;
    const summary = formatTradeSessionSummary();
    stopAutoLoop(true);
    refreshButtonState();
    appendLogLine(`关闭下单面板 · ${summary}`);
  };

  AlphaExtTradeRuntime.buyUILogAppend = appendLogLine;
  AlphaExtTradeRuntime.applyAlphaFromTitle = applyAlphaFromTitle;

  if (AlphaExtTradeRuntime.pendingBuyUIEnabled && AlphaExtTradeRuntime.contractPriceFeedControl) {
    AlphaExtTradeRuntime.contractPriceFeedControl.start();
  }

  AlphaExtTradeRuntime.buyUIEl = container;
  return container;
}
