/**
 * Alpha Extension — 卖出侧：订单簿 DOM、价格条件、限价通过后点击下单。
 * 依赖：AlphaExtCommon
 */
var AlphaExtSell = (function (C) {
  var Sel = C.CONST;
  return {
    pickPriceSpan: function (priceSpans) {
      if (!priceSpans || !priceSpans.length) return null;
      return priceSpans[0];
    },
    priceNotReady: function (edgePrice, targetPrice) {
      return edgePrice < targetPrice;
    },
    waitStatusText: function (lowestPrice, targetPrice) {
      return (
        "等待最高买一价 >= 目标价（当前 " + lowestPrice + " < " + targetPrice + "）"
      );
    },
    orderButtonSelector: function () {
      return Sel.ORDERBOOK_BID_SELL_BUTTON_SELECTOR;
    },
    priceSpanSelector: function () {
      return Sel.ORDERBOOK_BID_PRICE_SPAN_SELECTOR;
    },
    ensureTab: C.ensureSellTabSelected,

    /**
     * 卖出资金校验：标的币种可用数量 vs 本次下单数量（#limitAmount 优先；仅有 USDT 名义时用 名义/价）。
     * @param {number|null} edgePx 本档买一价
     * @param {number} balance 已解析的标的数量余额
     * @returns {{ ok: true } | { ok: false, message: string }}
     */
    checkFundVsMinOrder: function (edgePx, balance) {
      var amtSel = String(Sel.ORDER_AMOUNT_SELECTOR || "").trim();
      var qtySel = String(Sel.ORDER_QUANTITY_SELECTOR || "").trim();
      var orderQty = NaN;
      if (qtySel) {
        var rawQty = C.readTextFromSelector(qtySel);
        if (rawQty != null && String(rawQty).trim()) {
          orderQty = C.parseNumber(rawQty);
        }
      }
      if (
        (!Number.isFinite(orderQty) || orderQty <= 0) &&
        amtSel &&
        edgePx !== null &&
        edgePx > 0
      ) {
        var rawAmt = C.readTextFromSelector(amtSel);
        if (rawAmt != null && String(rawAmt).trim()) {
          var amt = C.parseNumber(rawAmt);
          if (Number.isFinite(amt) && amt > 0) orderQty = amt / edgePx;
        }
      }

      if (!Number.isFinite(orderQty) || orderQty <= 0) {
        return {
          ok: false,
          message: "无法读取本次下单数量（下单区可能尚未同步），请重试"
        };
      }
      return { ok: true };
    },

    /**
     * 先点订单簿该档数量（bbn 用其带出价格等）；若填了单次限制，再覆盖写入订单金额/数量输入框，最后点卖出按钮。
     * @param {*} ctx 由 content-trade-ui 注入
     */
    doOneTradeAttempt: async function (ctx) {
      var Com = ctx.common;
      var root = Com.getBidRootOnce();
      if (!root) return { didTrade: false };

      var priceSel = Sel.ORDERBOOK_BID_PRICE_SPAN_SELECTOR;
      var priceSpans = root.querySelectorAll(priceSel);
      if (!priceSpans || !priceSpans.length) return { didTrade: false };

      var priceSpan = priceSpans[0];
      var edgePrice = Com.parseNumber(priceSpan.textContent);
      if (!Number.isFinite(edgePrice)) return { didTrade: false };

      var targetPrice = ctx.readTargetPrice();
      if (targetPrice === null) return { didTrade: false };

      if (edgePrice < targetPrice) {
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

      // 交互：点击买盘该档数量，由页面把该档价格与数量带入下单区；稍等再写入单次限制，避免与盘口带出竞态
      qtyPerTradeSpan.click();
      /** 点击订单簿数量后，再写入单次限制前的等待（ms），让页面先完成盘口带出，减少与 React 竞态 */
      await ctx.delay(ctx.CONST.ORDERBOOK_CLICK_TO_LIMIT_OVERRIDE_MS);

      var balRes = ctx.readBalanceForFundCheck();
      if (balRes.type === "fail") {
        ctx.setStatus(balRes.message);
        return { didTrade: false, stop: true, panelAlert: true };
      }
      if (balRes.type === "ok") {
        var clampRes = Com.clampEffToBalance(ctx.CONST, eff, edgePrice, balRes.balance, false);
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

      var orderBtnSel = Sel.ORDERBOOK_BID_SELL_BUTTON_SELECTOR;
      var orderBtn = await ctx.waitForOrderButton(orderBtnSel, 2000);
      if (!orderBtn) {
        ctx.setStatus("未找到卖出按钮（等待超时），请确认当前为订单簿下单区且页面未改版");
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
