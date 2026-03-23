/**
 * Alpha Extension — 公共常量与 DOM/解析工具（订单簿、数字解析等）。
 * 依赖：无。被 ws / trade-buy / trade-sell / content 使用。
 */
var AlphaExtCommon = (function () {
  var CONST = {
    BUYUI_DRAG_KEY: "alpha-extension-buy-ui-pos",
    BUYUI_SIZE_KEY: "alpha-extension-buy-ui-size",
    BUYUI_DEFAULT_WIDTH: 380,
    BUYUI_MIN_WIDTH: 260,
    BUYUI_MIN_HEIGHT: 180,
    BUYUI_MAX_WIDTH: 720,
    BUY_UI_ID: "alpha-extension-buy-ui",
    BUY_UI_STATUS_ID: "alpha-extension-buy-ui-status",
    BUY_UI_LOG_ID: "alpha-extension-buy-ui-log",
    ORDERBOOK_ASK_SELECTOR_PRIMARY: ".orderbook-list.orderbook-ask",
    ORDERBOOK_ASK_SELECTOR_FALLBACK: ".orderbook-list .orderbook-ask",
    ORDERBOOK_BID_SELECTOR_PRIMARY: ".orderbook-list.orderbook-bid",
    ORDERBOOK_BID_SELECTOR_FALLBACK: ".orderbook-list .orderbook-bid",
    ORDERBOOK_ASK_QTY_SPAN_SELECTOR: ".text.emit-price > span",
    ORDERBOOK_ASK_PRICE_SPAN_SELECTOR: ".ask-light.emit-price > span",
    ORDERBOOK_BID_PRICE_SPAN_SELECTOR: ".bid-light.emit-price > span",
    ORDERBOOK_ASK_BUY_BUTTON_SELECTOR: ".bn-button__buy",
    ORDERBOOK_BID_SELL_BUTTON_SELECTOR: ".bn-button__sell",
    ORDERBOOK_ASK_CONFIRM_CONTINUE_BUTTON_SELECTOR: ".bn-modal-wrap .bn-button__primary",
    ORDERBOOK_BUY_SELL_TAB_LIST_SELECTOR: ".bn-tab-list__buySell",
    ORDER_COMPLETE_POLL_MS: 100,
    /** 自动任务等待确认弹窗/流程的最长时间（ms），超出则视为超时并触发面板预警 */
    ORDER_CONFIRM_MAX_WAIT_MS: 120000,
    /** 点击订单簿数量后，再写入单次限制前的等待（ms），让页面先完成盘口带出，减少与 React 竞态 */
    ORDERBOOK_CLICK_TO_LIMIT_OVERRIDE_MS: 20,
    AMOUNT_LIMIT_CURRENCY: "USDT",
    /**
     * 买入：名义须 ≤ 可用 USDT − 该值。
     * 卖出：等价为数量须 ≤ 可用数量 − (该值 ÷ 盘口价)，与买入同一 USDT 宽限。
     */
    ORDER_FUND_BUFFER_USDT: 0.1,
    /**
     * 低于该值（USDT 口径）则不再尝试下单：宽限 ORDER_FUND_BUFFER_USDT + 常见最小名义约 0.1 USDT。
     * 买入：比较 USDT 可用；卖出：比较「可用标的数量 × 本档价」折算名义。
     */
    MIN_TRADEABLE_AVAILABLE_USDT: 0.2,
    /**
     * 非空：全局 querySelector 读可用余额。
     * 为空：readAvailableBalanceNearOrderButton — 以买入/卖单按钮为锚（同 ORDERBOOK_*_BUTTON_SELECTOR），
     * 再按 AVAILABLE_BALANCE_ANCHOR_* 相对路径取文案。
     */
    AVAILABLE_BALANCE_SELECTOR: "",
    /** 相对订单按钮前兄弟节点：.t-caption1 → .bn-flex → children[0].children[1] */
    AVAILABLE_BALANCE_ANCHOR_TCAPTION: ".t-caption1",
    AVAILABLE_BALANCE_ANCHOR_BN_FLEX: ".bn-flex",
    /** 订单金额输入（如合约下单面板上的金额/总额） */
    ORDER_AMOUNT_SELECTOR: "#limitTotal",
    /** 订单数量输入 */
    ORDER_QUANTITY_SELECTOR: "#limitAmount",
    CONTRACT_PRICE_DISPLAY_DECIMALS: 5
  };

  function parseAlphaFromTitle(title) {
    var split = " | ";
    var safeTitle = String(title || "");
    var second = safeTitle.split(split)[1] || "";
    if (!second) return null;
    var firstToken = (second.split(" ")[0] || "").trim();
    return firstToken || null;
  }

  function toFuturesContractSymbol(alpha) {
    var s = String(alpha || "").trim().toUpperCase();
    if (!s) return s;
    if (s.endsWith("USDT")) return s;
    return s + "USDT";
  }

  function toAlphaSpotDisplayName(alpha) {
    var s = String(alpha || "").trim().toUpperCase();
    if (!s) return s;
    if (s.endsWith("USDT")) return s.slice(0, -4);
    return s;
  }

  function toFuturesStreamSymbol(symbol) {
    return String(symbol || "").trim().toLowerCase();
  }

  /**
   * 合约价展示：固定小数位，截断；不足补 0。
   */
  function formatContractPriceDisplayString(value) {
    var raw = String(value ?? "").trim();
    if (!raw) return raw;
    var neg = raw.startsWith("-");
    var abs = neg ? raw.slice(1) : raw;
    var dot = abs.indexOf(".");
    var intPart;
    var fracPart;
    if (dot === -1) {
      intPart = abs || "0";
      fracPart = "";
    } else {
      intPart = abs.slice(0, dot) || "0";
      fracPart = abs.slice(dot + 1);
    }
    var d = CONST.CONTRACT_PRICE_DISPLAY_DECIMALS;
    var fracTrunc = fracPart.slice(0, d).padEnd(d, "0");
    var out = intPart + "." + fracTrunc;
    return neg ? "-" + out : out;
  }

  function parseNumber(text) {
    var s = String(text || "").trim();
    if (!s) return NaN;
    var normalized = s.replace(/,/g, "").trim();
    /** 去掉尾部币种代码（如 USDT、SIREN）；≥2 字母，避免误伤 1.5K 里的 K */
    normalized = normalized.replace(/\s+[A-Za-z]{2,}\s*$/i, "").trim();
    if (!normalized) return NaN;
    var m = normalized.match(/^(-?\d+(?:\.\d+)?)([KMB])$/i);
    if (m) {
      var base = Number(m[1]);
      var suffix = m[2].toUpperCase();
      var mul = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : 1e9;
      return base * mul;
    }
    var n = Number(normalized);
    if (Number.isFinite(n)) return n;
    var lead = normalized.match(/-?\d+(?:\.\d+)?/);
    if (lead) {
      var n2 = Number(lead[0]);
      if (Number.isFinite(n2)) return n2;
    }
    return NaN;
  }

  function readTextFromSelector(selector) {
    var sel = String(selector || "").trim();
    if (!sel) return null;
    var el = document.querySelector(sel);
    if (!el) return null;
    if (typeof el.value === "string") return el.value.trim();
    return (el.textContent || "").trim();
  }

  function getPreviousElementSibling(el) {
    var n = el && el.previousSibling;
    while (n && n.nodeType !== 1) n = n.previousSibling;
    return n;
  }

  /**
   * 可用余额：与买入/卖出按钮同 ORDERBOOK_ASK_BUY_BUTTON_SELECTOR / ORDERBOOK_BID_SELL_BUTTON_SELECTOR；
   * 路径：按钮的前一个元素兄弟 → .t-caption1 → .bn-flex → children[0].children[1]（与页面结构一致时可读到余额文案）。
   * @param {boolean} isBuy
   * @returns {string|null}
   */
  function readAvailableBalanceNearOrderButton(isBuy) {
    var btnSel = isBuy
      ? CONST.ORDERBOOK_ASK_BUY_BUTTON_SELECTOR
      : CONST.ORDERBOOK_BID_SELL_BUTTON_SELECTOR;
    var list = document.querySelectorAll(btnSel);
    if (!list || !list.length) return null;
    var btn = list[0];
    var prev = btn.previousElementSibling || getPreviousElementSibling(btn);
    if (!prev || !prev.querySelector) return null;
    var capSel = String(CONST.AVAILABLE_BALANCE_ANCHOR_TCAPTION || "").trim();
    var flexSel = String(CONST.AVAILABLE_BALANCE_ANCHOR_BN_FLEX || "").trim();
    if (!capSel || !flexSel) return null;
    var cap = prev.querySelector(capSel);
    if (!cap) return null;
    var flex = cap.querySelector(flexSel);
    if (!flex) return null;
    var row0 = flex.children[0];
    if (!row0 || !row0.children || row0.children.length < 2) return null;
    var node = row0.children[1];
    var t = (node.textContent || "").trim();
    return t || null;
  }

  /**
   * 读取可用余额文案并解析为数字（供买卖资金校验共用）。
   * @param {'buy'|'sell'|null|undefined} tradeMode
   * @returns {{ type: 'skip' } | { type: 'fail', message: string } | { type: 'ok', balance: number }}
   */
  function readBalanceForFundCheck(tradeMode) {
    var balSel = String(CONST.AVAILABLE_BALANCE_SELECTOR || "").trim();
    var rawBal = null;
    if (balSel) {
      rawBal = readTextFromSelector(balSel);
    } else {
      if (tradeMode !== "buy" && tradeMode !== "sell") return { type: "skip" };
      rawBal = readAvailableBalanceNearOrderButton(tradeMode === "buy");
    }

    if (rawBal === null) {
      if (!balSel) return { type: "skip" };
      return {
        type: "fail",
        message: "无法读取可用余额（节点不存在或未加载，请检查选择器）"
      };
    }

    var balance = parseNumber(rawBal);
    if (!Number.isFinite(balance)) {
      return {
        type: "fail",
        message: "可用余额无法解析为数字（请检查页面展示格式）"
      };
    }
    return { type: "ok", balance: balance };
  }

  /**
   * 写入 input/textarea 的值并派发 input/change，便于 React 等受控组件同步。
   */
  function setNativeInputValue(el, value) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
    var str = String(value ?? "");
    var proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, str);
    else el.value = str;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setInputValueBySelector(selector, value) {
    var sel = String(selector || "").trim();
    if (!sel) return false;
    var el = document.querySelector(sel);
    return setNativeInputValue(el, value);
  }

  /** 写入下单框用的数字字符串，避免科学计数法 */
  function formatOrderInputNumberForDom(n) {
    if (!Number.isFinite(n)) return "";
    var t = n.toFixed(12);
    return t.replace(/\.?0+$/, "");
  }

  /**
   * 在已点击订单簿该档数量（带出价格等）之后调用：单次限制为「金额」时写入 ORDER_AMOUNT_SELECTOR；
   * 为「数量」时写入 ORDER_QUANTITY_SELECTOR。未填单次限制则直接返回。
   * 若传入 eff（与 resolveEffectiveTradeSizesForLimits 结果一致），则写入截断后的数值，否则写入输入框原文。
   * 调用方应在 click() 之后先 await delay(CONST.ORDERBOOK_CLICK_TO_LIMIT_OVERRIDE_MS)，再调用本函数。
   * ctx：CONST、readOptionalLimitField、perTradeLimitInput、perTradeLimitUnit。
   * @param {*} ctx
   * @param {{ tradeAmount: number|null, qtyPerTrade: number|null }} [eff]
   */
  function applyPerTradeLimitToOrderInputs(ctx, eff) {
    var Cc = ctx.CONST;
    var amtSel = String(Cc.ORDER_AMOUNT_SELECTOR || "").trim();
    var qtySel = String(Cc.ORDER_QUANTITY_SELECTOR || "").trim();
    var rawPer = ctx.readOptionalLimitField(ctx.perTradeLimitInput);
    if (rawPer === null || !Number.isFinite(rawPer)) return;
    var unit = ctx.perTradeLimitUnit.value;
    var str;
    if (
      eff &&
      (eff.tradeAmount != null || eff.qtyPerTrade != null) &&
      (Number.isFinite(eff.tradeAmount) || Number.isFinite(eff.qtyPerTrade))
    ) {
      if (unit === "amount") {
        if (eff.tradeAmount == null || !Number.isFinite(eff.tradeAmount)) return;
        str = formatOrderInputNumberForDom(eff.tradeAmount);
      } else {
        if (eff.qtyPerTrade == null || !Number.isFinite(eff.qtyPerTrade)) return;
        str = formatOrderInputNumberForDom(eff.qtyPerTrade);
      }
    } else {
      var displayStr = String(ctx.perTradeLimitInput.value || "").trim();
      if (!displayStr) displayStr = String(rawPer);
      str = displayStr;
    }
    if (unit === "amount") {
      if (amtSel) setInputValueBySelector(amtSel, str);
    } else {
      if (qtySel) setInputValueBySelector(qtySel, str);
    }
  }

  /**
   * 总限制 / 累计用：未填单次限制时用订单簿该档；填了则用单次金额或数量结合盘口价推导本次名义金额与数量。
   * ctx.allowPerTradeRestingOrder 为 false 时：单笔取 min(单次限制, 盘口该档)，避免超出该档产生挂单（依赖盘口解析成功）。
   * @param {*} ctx readOptionalLimitField、perTradeLimitInput、perTradeLimitUnit、allowPerTradeRestingOrder（可选）
   * @param {number} edgePrice 该档价格
   * @param {number|null} qtyFromBook 该档数量（订单簿解析）
   * @returns {{ tradeAmount: number|null, qtyPerTrade: number|null }}
   */
  function resolveEffectiveTradeSizesForLimits(ctx, edgePrice, qtyFromBook) {
    var rawPer = ctx.readOptionalLimitField(ctx.perTradeLimitInput);
    var bookQty = Number.isFinite(qtyFromBook) ? qtyFromBook : null;
    var bookAmt =
      Number.isFinite(edgePrice) && bookQty !== null ? edgePrice * bookQty : null;

    if (rawPer === null || !Number.isFinite(rawPer)) {
      return { tradeAmount: bookAmt, qtyPerTrade: bookQty };
    }

    var allowExcess = ctx.allowPerTradeRestingOrder !== false;
    var unit = ctx.perTradeLimitUnit.value;
    var amt;
    var qty;
    if (unit === "amount") {
      amt = rawPer;
      qty =
        Number.isFinite(edgePrice) && edgePrice !== 0 ? amt / edgePrice : null;
    } else {
      qty = rawPer;
      amt = Number.isFinite(edgePrice) && Number.isFinite(qty) ? edgePrice * qty : null;
    }

    if (
      !allowExcess &&
      bookAmt !== null &&
      bookQty !== null &&
      Number.isFinite(bookAmt) &&
      Number.isFinite(bookQty) &&
      bookAmt > 0 &&
      bookQty > 0
    ) {
      if (unit === "amount") {
        if (amt > bookAmt) {
          amt = bookAmt;
          qty =
            Number.isFinite(edgePrice) && edgePrice !== 0 ? amt / edgePrice : bookQty;
        }
      } else {
        if (qty > bookQty) {
          qty = bookQty;
          amt = Number.isFinite(edgePrice) && Number.isFinite(qty) ? edgePrice * qty : bookAmt;
        }
      }
    }

    return { tradeAmount: amt, qtyPerTrade: qty };
  }

  /**
   * 将 eff 裁剪到「可用余额 − ORDER_FUND_BUFFER_USDT（卖出侧数量按价折算）」以内；不修改 DOM。
   * @param {boolean} isBuy true=买入 USDT，false=卖出标的数量
   * @returns {{ ok: true, eff: { tradeAmount, qtyPerTrade } } | { ok: false, message: string }}
   */
  function clampEffToBalance(Cc, eff, edgePx, balance, isBuy) {
    var fundBuf =
      typeof Cc.ORDER_FUND_BUFFER_USDT === "number" && Number.isFinite(Cc.ORDER_FUND_BUFFER_USDT)
        ? Cc.ORDER_FUND_BUFFER_USDT
        : 0.1;
    var minAvail =
      typeof Cc.MIN_TRADEABLE_AVAILABLE_USDT === "number" && Number.isFinite(Cc.MIN_TRADEABLE_AVAILABLE_USDT)
        ? Cc.MIN_TRADEABLE_AVAILABLE_USDT
        : 0.2;
    var amt = eff.tradeAmount;
    var qty = eff.qtyPerTrade;
    var cur = Cc.AMOUNT_LIMIT_CURRENCY;

    if (isBuy) {
      if (Number.isFinite(balance) && balance < minAvail) {
        return {
          ok: false,
          message:
            "可用 USDT 低于 " +
            minAvail +
            "（含 " +
            fundBuf +
            " " +
            cur +
            " 宽限与约 0.1 " +
            cur +
            " 最小名义），无法下单，已自动结束任务"
        };
      }
      var maxNotional = balance - fundBuf;
      if (!Number.isFinite(maxNotional) || maxNotional <= 0) {
        return {
          ok: false,
          message:
            "可用 " +
            cur +
            " 扣除 " +
            fundBuf +
            " " +
            cur +
            " 宽限后不足以本次下单，已自动结束任务"
        };
      }
      var notional = NaN;
      if (Number.isFinite(amt) && amt > 0) notional = amt;
      else if (Number.isFinite(qty) && qty > 0 && Number.isFinite(edgePx) && edgePx > 0) notional = qty * edgePx;
      if (!Number.isFinite(notional) || notional <= 0) {
        return { ok: false, message: "无法计算本次下单名义金额（价×量），请重试" };
      }
      if (notional <= maxNotional) return { ok: true, eff: eff };
      var newAmt = maxNotional;
      var newQty = edgePx > 0 ? maxNotional / edgePx : qty;
      return { ok: true, eff: { tradeAmount: newAmt, qtyPerTrade: newQty } };
    }

    if (
      Number.isFinite(balance) &&
      Number.isFinite(edgePx) &&
      edgePx > 0 &&
      balance * edgePx < minAvail
    ) {
      return {
        ok: false,
        message:
          "可用标的按本档价折算名义低于 " +
          minAvail +
          " " +
          cur +
          "（含 " +
          fundBuf +
          " " +
          cur +
          " 宽限与约 0.1 " +
          cur +
          " 最小名义），无法下单，已自动结束任务"
      };
    }

    var bufferQty = Number.isFinite(edgePx) && edgePx > 0 ? fundBuf / edgePx : 0;
    var maxQty = balance - bufferQty;
    if (!Number.isFinite(maxQty) || maxQty <= 0) {
      return {
        ok: false,
        message: "可用标的数量扣除宽限后不足以本次下单，已自动结束任务"
      };
    }
    var orderQty = NaN;
    if (Number.isFinite(qty) && qty > 0) orderQty = qty;
    else if (Number.isFinite(amt) && amt > 0 && Number.isFinite(edgePx) && edgePx > 0) orderQty = amt / edgePx;
    if (!Number.isFinite(orderQty) || orderQty <= 0) {
      return { ok: false, message: "无法计算本次下单数量，请重试" };
    }
    if (orderQty <= maxQty) return { ok: true, eff: eff };
    var nq = maxQty;
    var na = Number.isFinite(edgePx) && edgePx > 0 ? nq * edgePx : amt;
    return { ok: true, eff: { tradeAmount: na, qtyPerTrade: nq } };
  }

  /**
   * 同时写入金额与数量，与 eff、盘口价一致（写入后便于页面与资金校验读 DOM）。
   * ctx：CONST；eff：含 tradeAmount、qtyPerTrade；edgePx：本档价。
   */
  function applyOrderAmountAndQtyFromEff(ctx, eff, edgePx) {
    var Cc = ctx.CONST;
    var amtSel = String(Cc.ORDER_AMOUNT_SELECTOR || "").trim();
    var qtySel = String(Cc.ORDER_QUANTITY_SELECTOR || "").trim();
    if (!amtSel || !qtySel) return;
    if (!Number.isFinite(edgePx) || edgePx <= 0) return;
    var ta = eff.tradeAmount;
    var tq = eff.qtyPerTrade;
    if (Number.isFinite(ta) && ta > 0 && (!Number.isFinite(tq) || tq <= 0)) tq = ta / edgePx;
    if (Number.isFinite(tq) && tq > 0 && (!Number.isFinite(ta) || ta <= 0)) ta = tq * edgePx;
    if (!Number.isFinite(ta) || !Number.isFinite(tq) || ta <= 0 || tq <= 0) return;
    setInputValueBySelector(amtSel, formatOrderInputNumberForDom(ta));
    setInputValueBySelector(qtySel, formatOrderInputNumberForDom(tq));
  }

  function ensureBuyTabSelected() {
    var tabList = document.querySelector(CONST.ORDERBOOK_BUY_SELL_TAB_LIST_SELECTOR);
    if (!tabList) return;
    var buyEl = tabList.firstElementChild;
    if (!buyEl || typeof buyEl.click !== "function") return;
    buyEl.click();
  }

  function ensureSellTabSelected() {
    var tabList = document.querySelector(CONST.ORDERBOOK_BUY_SELL_TAB_LIST_SELECTOR);
    if (!tabList) return;
    var sellEl = tabList.children[1];
    if (!sellEl || typeof sellEl.click !== "function") return;
    sellEl.click();
  }

  function queryAskNodes() {
    var primary = document.querySelectorAll(CONST.ORDERBOOK_ASK_SELECTOR_PRIMARY);
    if (primary && primary.length) return primary;
    var fallback = document.querySelectorAll(CONST.ORDERBOOK_ASK_SELECTOR_FALLBACK);
    if (fallback && fallback.length) return fallback;
    return null;
  }

  function queryBidNodes() {
    var primary = document.querySelectorAll(CONST.ORDERBOOK_BID_SELECTOR_PRIMARY);
    if (primary && primary.length) return primary;
    var fallback = document.querySelectorAll(CONST.ORDERBOOK_BID_SELECTOR_FALLBACK);
    if (fallback && fallback.length) return fallback;
    return null;
  }

  function getAskRootOnce() {
    var nodes = queryAskNodes();
    return nodes && nodes.length ? nodes[0] : null;
  }

  function getBidRootOnce() {
    var nodes = queryBidNodes();
    return nodes && nodes.length ? nodes[0] : null;
  }

  function getQtyInSameRowAsPriceSpan(priceSpan) {
    var row =
      priceSpan && typeof priceSpan.closest === "function"
        ? priceSpan.closest(".orderbook-progress")
        : null;
    if (!row) return { qtyPerTrade: null, qtyPerTradeSpan: null };
    var qtyPerTradeSpan = row.querySelector(CONST.ORDERBOOK_ASK_QTY_SPAN_SELECTOR);
    if (!qtyPerTradeSpan) return { qtyPerTrade: null, qtyPerTradeSpan: null };
    var qty = parseNumber(qtyPerTradeSpan.textContent);
    return {
      qtyPerTrade: Number.isFinite(qty) ? qty : null,
      qtyPerTradeSpan: qtyPerTradeSpan
    };
  }

  return {
    CONST: CONST,
    parseAlphaFromTitle: parseAlphaFromTitle,
    toFuturesContractSymbol: toFuturesContractSymbol,
    toAlphaSpotDisplayName: toAlphaSpotDisplayName,
    toFuturesStreamSymbol: toFuturesStreamSymbol,
    formatContractPriceDisplayString: formatContractPriceDisplayString,
    parseNumber: parseNumber,
    readTextFromSelector: readTextFromSelector,
    readAvailableBalanceNearOrderButton: readAvailableBalanceNearOrderButton,
    readBalanceForFundCheck: readBalanceForFundCheck,
    setInputValueBySelector: setInputValueBySelector,
    applyPerTradeLimitToOrderInputs: applyPerTradeLimitToOrderInputs,
    applyOrderAmountAndQtyFromEff: applyOrderAmountAndQtyFromEff,
    clampEffToBalance: clampEffToBalance,
    formatOrderInputNumberForDom: formatOrderInputNumberForDom,
    resolveEffectiveTradeSizesForLimits: resolveEffectiveTradeSizesForLimits,
    ensureBuyTabSelected: ensureBuyTabSelected,
    ensureSellTabSelected: ensureSellTabSelected,
    queryAskNodes: queryAskNodes,
    queryBidNodes: queryBidNodes,
    getAskRootOnce: getAskRootOnce,
    getBidRootOnce: getBidRootOnce,
    getQtyInSameRowAsPriceSpan: getQtyInSameRowAsPriceSpan
  };
})();
