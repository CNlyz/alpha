/**
 * Alpha Extension — 合约行情 WebSocket（bbn fstream market stream）。
 * 依赖：AlphaExtCommon（toFuturesStreamSymbol）。
 */
var AlphaExtWs = (function (C) {
  var FSTREAM_WS_MARKET_STREAM_URL = "wss://fstream.binance.com/market/stream";
  var CONTRACT_PRICE_WS_RECONNECT_MS = 2500;

  function randomWsRequestId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "");
    }
    return Date.now() + "-" + Math.random().toString(36).slice(2, 12);
  }

  function parseMarkPriceUpdatePayload(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    if (
      Object.prototype.hasOwnProperty.call(parsed, "result") &&
      Object.prototype.hasOwnProperty.call(parsed, "id")
    ) {
      return null;
    }
    var inner = parsed.data !== undefined ? parsed.data : parsed;
    if (typeof inner === "string") {
      try {
        inner = JSON.parse(inner);
      } catch {
        return null;
      }
    }
    if (!inner || typeof inner !== "object" || inner.e !== "markPriceUpdate") return null;
    var pick = function (k) {
      return inner[k] != null ? String(inner[k]).trim() : "";
    };
    return {
      p: pick("p"),
      ap: pick("ap"),
      P: pick("P"),
      i: pick("i"),
      r: pick("r"),
      s: inner.s != null ? String(inner.s) : ""
    };
  }

  function parseAggTradePayload(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    if (
      Object.prototype.hasOwnProperty.call(parsed, "result") &&
      Object.prototype.hasOwnProperty.call(parsed, "id")
    ) {
      return null;
    }
    var inner = parsed.data !== undefined ? parsed.data : parsed;
    if (typeof inner === "string") {
      try {
        inner = JSON.parse(inner);
      } catch {
        return null;
      }
    }
    if (!inner || typeof inner !== "object" || inner.e !== "aggTrade") return null;
    var p = inner.p != null ? String(inner.p).trim() : "";
    return p ? { p: p } : null;
  }

  /**
   * @param {{ symbol: string, onUpdate: function(Object), onError?: function(*) }} opts
   */
  function createContractPriceFeed(opts) {
    var symbol = opts.symbol;
    var onUpdate = opts.onUpdate;
    var onError = opts.onError;
    var streamSym = C.toFuturesStreamSymbol(symbol);
    var streamNameMark = streamSym + "@markPrice@1s";
    var streamNameAgg = streamSym + "@aggTrade";

    var ws = null;
    var stopped = false;
    var reconnectTimer = null;

    function clearReconnect() {
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect() {
      clearReconnect();
      if (stopped) return;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        if (!stopped) connect();
      }, CONTRACT_PRICE_WS_RECONNECT_MS);
    }

    function connect() {
      if (stopped) return;
      try {
        ws = new WebSocket(FSTREAM_WS_MARKET_STREAM_URL);
      } catch (e) {
        if (onError) onError(e);
        scheduleReconnect();
        return;
      }

      ws.onopen = function () {
        if (stopped) return;
        var sub = {
          id: randomWsRequestId(),
          method: "SUBSCRIBE",
          params: [streamNameMark, streamNameAgg]
        };
        try {
          ws.send(JSON.stringify(sub));
        } catch (e) {
          if (onError) onError(e);
        }
      };

      ws.onmessage = function (ev) {
        if (stopped) return;
        var parsed = null;
        try {
          parsed = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (parsed && typeof parsed.ping !== "undefined" && ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ pong: parsed.ping }));
          } catch {
            /* ignore */
          }
          return;
        }
        var mark = parseMarkPriceUpdatePayload(parsed);
        if (mark && mark.p) {
          onUpdate({
            markPrice: mark.p,
            mark: mark
          });
          return;
        }
        var agg = parseAggTradePayload(parsed);
        if (agg) {
          onUpdate({
            lastPrice: agg.p
          });
        }
      };

      ws.onerror = function () {
        if (stopped) return;
        if (onError) onError(new Error("WebSocket 连接错误"));
      };

      ws.onclose = function () {
        ws = null;
        if (stopped) return;
        scheduleReconnect();
      };
    }

    return {
      start: function () {
        stopped = false;
        clearReconnect();
        if (ws && ws.readyState === WebSocket.OPEN) return;
        if (ws) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          ws = null;
        }
        connect();
      },
      stop: function () {
        stopped = true;
        clearReconnect();
        if (ws) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          ws = null;
        }
      }
    };
  }

  return {
    createContractPriceFeed: createContractPriceFeed
  };
})(AlphaExtCommon);
