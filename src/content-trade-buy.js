/**
 * Alpha Extension — 买入侧：订单簿 DOM、价格条件、限价通过后点击下单。
 * 依赖：AlphaExtCommon
 */
var AlphaExtBuy = (function (C) {
  var Sel = C.CONST;
  return {
    pickPriceSpan: function (priceSpans) {
      if (!priceSpans || !priceSpans.length) return null;
      return priceSpans[priceSpans.length - 1];
    },
    priceNotReady: function (edgePrice, targetPrice) {
      return edgePrice > targetPrice;
    },
    waitStatusText: function (lowestPrice, targetPrice) {
      return (
        "等待卖一价 <= 目标价（当前 " + lowestPrice + " > " + targetPrice + "）"
      );
    },
    orderButtonSelector: function () {
      return Sel.ORDERBOOK_ASK_BUY_BUTTON_SELECTOR;
    },
    priceSpanSelector: function () {
      return Sel.ORDERBOOK_ASK_PRICE_SPAN_SELECTOR;
    },
    ensureTab: C.ensureBuyTabSelected,

    /**
     * 买入资金校验：USDT 可用余额 vs 本次名义 USDT（#limitTotal 优先，否则 #limitAmount×价）。
     * @param {number|null} edgePx 本档卖一价
     * @param {number} balance 已解析的 USDT 余额
     * @returns {{ ok: true } | { ok: false, message: string }}
     */
    checkFundVsMinOrder: function (edgePx, balance) {
      var amtSel = String(Sel.ORDER_AMOUNT_SELECTOR || "").trim();
      var qtySel = String(Sel.ORDER_QUANTITY_SELECTOR || "").trim();
      var orderNotional = NaN;
      if (amtSel) {
        var rawAmt = C.readTextFromSelector(amtSel);
        if (rawAmt != null && String(rawAmt).trim()) {
          orderNotional = C.parseNumber(rawAmt);
        }
      }
      if (
        (!Number.isFinite(orderNotional) || orderNotional <= 0) &&
        qtySel &&
        edgePx !== null &&
        edgePx > 0
      ) {
        var rawQty = C.readTextFromSelector(qtySel);
        if (rawQty != null && String(rawQty).trim()) {
          var q = C.parseNumber(rawQty);
          if (Number.isFinite(q) && q > 0) orderNotional = edgePx * q;
        }
      }

      if (!Number.isFinite(orderNotional) || orderNotional <= 0) {
        return {
          ok: false,
          message: "无法读取本次下单金额或数量（下单区可能尚未同步），请重试"
        };
      }
      return { ok: true };
    },

    /**
     * 先点订单簿该档数量（bbn 用其带出价格等）；若填了单次限制，再覆盖写入订单金额/数量输入框，最后点买入按钮。
     * @param {*} ctx 由 content-trade-ui 注入（common、CONST、setStatus、validateTradeLimits、waitForOrderButton 等）
     */
    doOneTradeAttempt: async function (ctx) {
      var Com = ctx.common;
      var root = Com.getAskRootOnce();
      if (!root) return { didTrade: false };

      var priceSel = Sel.ORDERBOOK_ASK_PRICE_SPAN_SELECTOR;
      var priceSpans = root.querySelectorAll(priceSel);
      if (!priceSpans || !priceSpans.length) return { didTrade: false };

      var priceSpan = priceSpans[priceSpans.length - 1];
      var edgePrice = Com.parseNumber(priceSpan.textContent);
      if (!Number.isFinite(edgePrice)) return { didTrade: false };

      var targetPrice = ctx.readTargetPrice();
      if (targetPrice === null) return { didTrade: false };

      if (edgePrice > targetPrice) {
        return { didTrade: false, lowestPrice: edgePrice, targetPrice: targetPrice };
      }

      var rowQty = Com.getQtyInSameRowAsPriceSpan(priceSpan);
      var qtyPerTradeSpan = rowQty.qtyPerTradeSpan;
      if (!qtyPerTradeSpan) return { didTrade: false };

      var qtyPerTradeBook = rowQty.qtyPerTrade;
      var eff = Com.resolveEffectiveTradeSizesForLimits(ctx, edgePrice, qtyPerTradeBook);
      var tradeAmount = eff.tradeAmount;
      var qtyPerTrade = eff.qtyPerTrade;

      var limitBlock = ctx.validateTradeLimits({
        CONST: ctx.CONST,
        setStatus: ctx.setStatus,
        readOptionalLimitField: ctx.readOptionalLimitField,
        totalLimitInput: ctx.totalLimitInput,
        perTradeLimitInput: ctx.perTradeLimitInput,
        totalLimitUnit: ctx.totalLimitUnit,
        perTradeLimitUnit: ctx.perTradeLimitUnit,
        totalTradeAmount: ctx.totalTradeAmount,
        totalTradeQty: ctx.totalTradeQty,
        tradeAmount: tradeAmount,
        qtyPerTrade: qtyPerTrade
      });
      if (limitBlock) return limitBlock;

      // 交互：点击卖盘该档数量，由页面把该档价格与数量带入下单区；稍等再写入单次限制，避免与盘口带出竞态
      qtyPerTradeSpan.click();
      /** 点击订单簿数量后，再写入单次限制前的等待（ms），让页面先完成盘口带出，减少与 React 竞态 */
      await ctx.delay(ctx.CONST.ORDERBOOK_CLICK_TO_LIMIT_OVERRIDE_MS);

      var balRes = ctx.readBalanceForFundCheck();
      if (balRes.type === "fail") {
        ctx.setStatus(balRes.message);
        return { didTrade: false, stop: true, panelAlert: true };
      }
      if (balRes.type === "ok") {
        var clampRes = Com.clampEffToBalance(ctx.CONST, eff, edgePrice, balRes.balance, true);
        if (!clampRes.ok) {
          ctx.setStatus(clampRes.message);
          return { didTrade: false, stop: true, panelAlert: true };
        }
        eff = clampRes.eff;
        tradeAmount = eff.tradeAmount;
        qtyPerTrade = eff.qtyPerTrade;
      }
      Com.applyOrderAmountAndQtyFromEff(ctx, eff, edgePrice);

      var fundCheck = ctx.checkFundVsMinOrder(edgePrice);
      if (!fundCheck.ok) {
        ctx.setStatus(fundCheck.message);
        return { didTrade: false, stop: true, panelAlert: true };
      }

      var orderBtnSel = Sel.ORDERBOOK_ASK_BUY_BUTTON_SELECTOR;
      var orderBtn = await ctx.waitForOrderButton(orderBtnSel, 2000);
      if (!orderBtn) {
        ctx.setStatus("未找到买入按钮（等待超时），请确认当前为订单簿下单区且页面未改版");
        return { didTrade: false, panelAlert: true, stop: true };
      }

      orderBtn.click();

      return {
        didTrade: true,
        lowestPrice: edgePrice,
        targetPrice: targetPrice,
        qtyPerTrade: eff.qtyPerTrade,
        qtyPerTradeSpan: qtyPerTradeSpan,
        tradeAmount:
          eff.tradeAmount != null
            ? eff.tradeAmount
            : Number.isFinite(edgePrice) && Number.isFinite(eff.qtyPerTrade)
              ? edgePrice * eff.qtyPerTrade
              : null
      };
    }
  };
})(AlphaExtCommon);
