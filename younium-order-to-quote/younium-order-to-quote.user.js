// ==UserScript==
// @name         Younium Order to Quote
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.1
// @description  Adds a "Copy from order" button on Younium quote pages (left of Preview & Send, styled identically to Younium's own toolbar buttons) — enter an order number (e.g. O-015091) and it copies the order's products onto the quote with each charge's ordered quantity and discount %, letting Younium recompute prices.
// @author       hapnes-dev
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/younium-order-to-quote/younium-order-to-quote.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/younium-order-to-quote/younium-order-to-quote.user.js
// @match        https://eu.younium.com/*
// @match        https://us.younium.com/*
// @connect      auth.eu.younium.com
// @connect      auth.us.younium.com
// @connect      api.younium.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

/*
 * Younium Order to Quote
 *
 * On https://<region>.younium.com/quotes/… pages this injects a "Copy from
 * order" button into the header bar, immediately left of "Preview & Send".
 * Clicking it opens a small dialog: type an order number (O-015091), it
 * resolves the order, shows what it found, and on confirm:
 *
 *   1. POST /api/quote/product/create for every product on the order
 *      ({quoteId, productId, chargePlanId, currencyCode}) — Younium creates
 *      the quote product with its charge-plan charges at list price.
 *   2. For each created charge, finds the matching order charge by catalog
 *      chargeId (fallback: normalized name) and applies the order's
 *      quantity + discount %, letting POST /api/quote/calculateQuoteChargePrices/
 *      recompute every derived money field server-side (same as the UI).
 *   3. PUT /api/quote/products/charges with the recomputed batch, then
 *      PUT /api/quote/{id}/calculateKPIs, then reloads the page.
 *
 * Prices deliberately stay at the quote's CURRENT catalog list price — only
 * quantity and discount % are copied from the order.
 *
 * Auth: same Frontegg pattern as rocketlane-younium-status — a JWT is minted
 * on demand from the HttpOnly refresh cookie (POST …/token/refresh), cached
 * in GM storage, force-refreshed once on 401. The Bearer is origin-pinned to
 * https://api.younium.com and never logged.
 */

(function () {
  "use strict";

  var YOUNIUM_API = "https://api.younium.com";

  function region() {
    var m = location.hostname.match(/^(eu|us)\.younium\.com$/i);
    return m ? m[1].toLowerCase() : (GM_getValue("ynRegion", "eu") || "eu");
  }

  // ══════════════════════════════════════════════════════════════════════
  // Younium auth core (ported from rocketlane-younium-status / chat-bridge)
  // ══════════════════════════════════════════════════════════════════════

  var ynRefreshInFlight = null;
  var ynLastRefreshAttempt = 0;
  function gmYouniumRefreshToken(forceRefresh) {
    if (ynRefreshInFlight) return ynRefreshInFlight;
    var now = Date.now();
    if (!forceRefresh && now - ynLastRefreshAttempt < 30 * 1000) {
      var cached = GM_getValue("ynAccessToken", "");
      if (cached) return Promise.resolve(cached);
    }
    ynLastRefreshAttempt = now;
    var authHost = "https://auth." + region() + ".younium.com";
    ynRefreshInFlight = new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: "POST",
        url: authHost + "/frontegg/identity/resources/auth/v1/user/token/refresh",
        headers: { "content-type": "application/json", accept: "application/json" },
        data: "{}",
        timeout: 20000,
        anonymous: false,
        onload: function (res) {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error("HTTP " + res.status + ": Younium session expired. Log in to " + location.hostname + " and try again."));
            return;
          }
          try {
            var j = JSON.parse(res.responseText || "{}");
            var token = String(j && j.accessToken || "").trim();
            if (!token) { reject(new Error("Younium refresh returned no accessToken.")); return; }
            var ttlMs = Math.max(60000, Number(j.expiresIn || 0) * 1000);
            GM_setValue("ynAccessToken", token);
            GM_setValue("ynAccessTokenExpiresAt", Date.now() + ttlMs);
            GM_setValue("ynAccessTokenCapturedAt", Date.now());
            resolve(token);
          } catch (e) {
            reject(new Error("Younium refresh parse failed: " + (e && e.message || e)));
          }
        },
        onerror: function () { reject(new Error("Network error reaching Younium auth")); },
        ontimeout: function () { reject(new Error("Younium auth timed out")); },
      });
    });
    ynRefreshInFlight.finally(function () { setTimeout(function () { ynRefreshInFlight = null; }, 0); });
    return ynRefreshInFlight;
  }

  async function gmYouniumRequest(method, path, body) {
    var url = /^https?:/i.test(path) ? path : (YOUNIUM_API + (path.charAt(0) === "/" ? path : "/" + path));
    var origin = "";
    try { origin = new URL(url).origin; } catch (_) {}
    if (origin !== "https://api.younium.com") {
      throw new Error("Refusing to send Younium token to non-Younium origin: " + (origin || url));
    }
    var token = GM_getValue("ynAccessToken", "");
    var expiresAt = Number(GM_getValue("ynAccessTokenExpiresAt", 0));
    if (!token || !expiresAt || Date.now() > expiresAt - 60000) token = await gmYouniumRefreshToken();

    var send = function (t) {
      return new Promise(function (resolve, reject) {
        var headers = {
          accept: "application/json",
          Authorization: "Bearer " + t,
          "X-Younium-Origin": "frontend",
        };
        var init = {
          method: String(method || "GET").toUpperCase(),
          url: url,
          headers: headers,
          timeout: 30000,
          anonymous: false,
          onload: function (res) { resolve({ status: res.status, text: res.responseText || "" }); },
          onerror: function () { reject(new Error("Network error reaching Younium API")); },
          ontimeout: function () { reject(new Error("Younium API timed out")); },
        };
        if (body !== undefined && body !== null) {
          headers["content-type"] = "application/json";
          init.data = typeof body === "string" ? body : JSON.stringify(body);
        }
        GM_xmlhttpRequest(init);
      });
    };

    var res = await send(token);
    if (res.status === 401) {
      try { token = await gmYouniumRefreshToken(true); res = await send(token); } catch (_) {}
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("HTTP " + res.status + ": Younium session expired. Log in to " + location.hostname + " and try again.");
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error("HTTP " + res.status + ": " + (res.text || "").slice(0, 300));
    }
    if (!res.text) return null;
    try { return JSON.parse(res.text); } catch (_) { return null; }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Younium API helpers
  // ══════════════════════════════════════════════════════════════════════

  function normalizeOrderNumber(input) {
    var raw = String(input || "").trim().toUpperCase();
    if (!raw) return null;
    var digits = raw.replace(/\D+/g, "");
    if (!digits) return null;
    return "O-" + digits.padStart(6, "0");
  }

  async function findOrderByNumber(orderNumber) {
    var body = {
      entity: "order",
      filter: "",
      pageNumber: 0,
      pageSize: 5,
      sortField: "modified",
      sortDirection: "desc",
      displayFields: ["orderNumber", "description", "accountname", "status", "isLastVersion", "id"],
      conditions: [
        { fieldName: "orderNumber", value: orderNumber, operator: 0 },
        { fieldName: "isLastVersion", value: true, operator: 0 },
      ],
      conditionLogic: "",
    };
    var j = await gmYouniumRequest("POST", "/api/data/query/order", body);
    return (j && j.result && j.result[0]) || null;
  }

  async function findQuoteIdByNumber(quoteNumber) {
    var body = {
      entity: "quote",
      filter: "",
      pageNumber: 0,
      pageSize: 5,
      sortField: "number",
      sortDirection: "desc",
      displayFields: ["number", "accountName", "description", "status", "currencyCode", "id"],
      conditions: [{ fieldName: "number", value: quoteNumber, operator: 0 }],
      conditionLogic: "",
    };
    var j = await gmYouniumRequest("POST", "/api/data/query/quote", body);
    var rows = (j && j.result) || [];
    return rows.length ? rows[0].id : null;
  }

  /** Resolve the quote open on this page: URL uuid, else the Q-number in the header. */
  async function resolveCurrentQuote() {
    var m = location.pathname.match(/\/quotes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    var quoteId = m ? m[1] : null;
    if (!quoteId) {
      var qnum = null;
      var heads = document.querySelectorAll("h1,h2,h3,h4,h5");
      for (var i = 0; i < heads.length; i++) {
        var t = (heads[i].textContent || "").match(/\bQ-\d{3,}\b/);
        if (t) { qnum = t[0]; break; }
      }
      if (!qnum) throw new Error("Couldn't find the quote number on this page. Save the quote first, then retry.");
      quoteId = await findQuoteIdByNumber(qnum);
      if (!quoteId) throw new Error("No Younium quote found for " + qnum + ".");
    }
    var quote = await gmYouniumRequest("GET", "/api/quote/" + encodeURIComponent(quoteId), null);
    if (!quote || !quote.id) throw new Error("Couldn't load quote " + quoteId + ".");
    return quote;
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function normName(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

  /**
   * Apply one order charge's quantity + discount % onto a freshly created
   * quote charge, mirroring the UI: set top-level quantity, per-detail
   * lineDiscountPercent + discounted price, then let
   * calculateQuoteChargePrices recompute every derived amount.
   */
  async function recalcChargeLikeOrder(quoteCharge, orderCharge) {
    var qty = num(orderCharge.orderedQuantity);
    if (!(qty > 0)) qty = num(orderCharge.quantity);
    var disc = num(orderCharge.discountPercentage);

    var payload = JSON.parse(JSON.stringify(quoteCharge));
    payload.quantity = qty;
    var details = Array.isArray(payload.quoteProductChargeDetails) ? payload.quoteProductChargeDetails : [];
    for (var i = 0; i < details.length; i++) {
      var d = details[i];
      d.lineDiscountPercent = disc;
      var list = d.listPrice && num(d.listPrice.amount);
      if (isFinite(list)) {
        var discounted = round2(list * (1 - disc / 100));
        if (d.price) d.price.amount = discounted;
        if (d.lineDiscountAmount) d.lineDiscountAmount.amount = round2(list - discounted);
      }
    }
    var recomputed = await gmYouniumRequest("POST", "/api/quote/calculateQuoteChargePrices/", payload);
    return { recomputed: recomputed, qty: qty, disc: disc };
  }

  // ══════════════════════════════════════════════════════════════════════
  // The copy flow
  // ══════════════════════════════════════════════════════════════════════

  async function copyOrderToQuote(order, quote, log) {
    var orderFull = await gmYouniumRequest("GET", "/api/order/" + encodeURIComponent(order.id), null);
    if (!orderFull || !Array.isArray(orderFull.orderProducts)) throw new Error("Order payload had no products.");

    var products = orderFull.orderProducts.filter(function (p) { return p && !p.isDeleted && !p.isAddedCharge; });
    if (!products.length) throw new Error("Order " + order.orderNumber + " has no products to copy.");

    var chargeBatch = [];
    var warnings = [];

    for (var pi = 0; pi < products.length; pi++) {
      var p = products[pi];
      var productId = p.chargePlan && p.chargePlan.productId;
      var chargePlanId = p.chargePlanId || (p.chargePlan && p.chargePlan.id);
      if (!productId || !chargePlanId) {
        warnings.push("Skipped “" + p.name + "” — no product/charge-plan reference on the order line.");
        log("warn", "⚠ " + p.name + " — skipped (no charge-plan reference)");
        continue;
      }

      log("info", "Adding " + p.name + "…");
      var created = await gmYouniumRequest("POST", "/api/quote/product/create", {
        quoteId: quote.id,
        productId: productId,
        chargePlanId: chargePlanId,
        currencyCode: quote.currencyCode || orderFull.currency || "NOK",
      });
      var qCharges = (created && created.quoteProductCharges) || [];
      if (!qCharges.length) {
        warnings.push("“" + p.name + "” was added but came back with no charges.");
        log("warn", "⚠ " + p.name + " — added, but no charges returned");
        continue;
      }

      var orderCharges = Array.isArray(p.charges) ? p.charges.filter(function (c) { return c && !c.isDeleted; }) : [];
      var usedOrderChargeIds = {};

      for (var ci = 0; ci < qCharges.length; ci++) {
        var qc = qCharges[ci];
        var oc = null;
        for (var oi = 0; oi < orderCharges.length; oi++) {
          var cand = orderCharges[oi];
          if (usedOrderChargeIds[cand.id]) continue;
          if (cand.chargeId && qc.chargeId && cand.chargeId === qc.chargeId) { oc = cand; break; }
        }
        if (!oc) {
          for (var oj = 0; oj < orderCharges.length; oj++) {
            var cand2 = orderCharges[oj];
            if (usedOrderChargeIds[cand2.id]) continue;
            if (normName(cand2.name) === normName(qc.name)) { oc = cand2; break; }
          }
        }
        if (!oc) {
          log("warn", "⚠ " + p.name + " › " + qc.name + " — not on the order, left at defaults");
          continue;
        }
        usedOrderChargeIds[oc.id] = true;

        try {
          var r = await recalcChargeLikeOrder(qc, oc);
          if (r.recomputed && r.recomputed.id) {
            chargeBatch.push(r.recomputed);
            log("ok", "✓ " + p.name + " › " + qc.name + " — qty " + r.qty + ", discount " + r.disc + "%");
          } else {
            warnings.push("Price recalculation returned nothing for “" + qc.name + "”.");
            log("warn", "⚠ " + p.name + " › " + qc.name + " — recalculation failed, left at defaults");
          }
        } catch (e) {
          warnings.push("“" + qc.name + "”: " + (e && e.message || e));
          log("warn", "⚠ " + p.name + " › " + qc.name + " — " + (e && e.message || e));
        }
      }

      for (var ok2 = 0; ok2 < orderCharges.length; ok2++) {
        if (!usedOrderChargeIds[orderCharges[ok2].id]) {
          warnings.push("Order charge “" + orderCharges[ok2].name + "” (" + p.name + ") has no counterpart on the current charge plan — add it manually.");
          log("warn", "⚠ " + p.name + " › " + orderCharges[ok2].name + " — not on the current charge plan, add manually");
        }
      }
    }

    if (chargeBatch.length) {
      log("info", "Saving " + chargeBatch.length + " charge(s)…");
      await gmYouniumRequest("PUT", "/api/quote/products/charges", chargeBatch);
    }
    try { await gmYouniumRequest("PUT", "/api/quote/" + encodeURIComponent(quote.id) + "/calculateKPIs", null); } catch (_) {}

    return { productCount: products.length, chargeCount: chargeBatch.length, warnings: warnings };
  }

  // ══════════════════════════════════════════════════════════════════════
  // UI — header button + dialog
  // ══════════════════════════════════════════════════════════════════════

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var STYLE = "" +
    "#ynO2qBtn{margin-right:8px;cursor:pointer}" +
    "#ynO2qBtn.ynO2qFallback{display:inline-flex;align-items:center;gap:6px;padding:7px 16px;" +
    "border:1px solid rgba(255,255,255,.35);border-radius:20px;background:transparent;color:#fff;" +
    "font:inherit;font-size:13px;white-space:nowrap;line-height:1.4}" +
    "#ynO2qBtn.ynO2qFallback:hover{background:rgba(255,255,255,.12)}" +
    "#ynO2qOverlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}" +
    "#ynO2qCard{width:560px;max-width:92vw;max-height:82vh;display:flex;flex-direction:column;background:#1e1e1e;color:#eee;" +
    "border:1px solid #444;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.6);font-size:13px}" +
    "#ynO2qCard header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #383838;font-weight:600;font-size:14px}" +
    "#ynO2qClose{background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:0 4px}" +
    "#ynO2qClose:hover{color:#fff}" +
    "#ynO2qBody{padding:14px 16px;overflow:auto}" +
    "#ynO2qRow{display:flex;gap:8px}" +
    "#ynO2qInput{flex:1;padding:8px 10px;border:1px solid #555;border-radius:6px;background:#121212;color:#eee;font:inherit}" +
    "#ynO2qInput:focus{outline:none;border-color:#4da3ff}" +
    "#ynO2qGo{padding:8px 18px;border:none;border-radius:6px;background:#1976d2;color:#fff;font:inherit;cursor:pointer}" +
    "#ynO2qGo:hover{background:#2b86e0}#ynO2qGo:disabled{opacity:.5;cursor:default}" +
    "#ynO2qHint{color:#999;font-size:12px;margin:6px 2px 0}" +
    "#ynO2qLog{margin-top:12px;display:none;flex-direction:column;gap:3px;font-size:12.5px;line-height:1.5}" +
    ".ynO2qL-info{color:#bbb}.ynO2qL-ok{color:#7fd18a}.ynO2qL-warn{color:#e6c25a}.ynO2qL-err{color:#f28b82;font-weight:600}" +
    "#ynO2qConfirm{margin-top:12px;display:none;padding:10px 12px;border:1px solid #3a4a5a;border-radius:8px;background:#20262d}" +
    "#ynO2qConfirm b{color:#fff}" +
    "#ynO2qConfirmBtns{margin-top:10px;display:flex;gap:8px}" +
    ".ynO2qSmall{padding:6px 14px;border:none;border-radius:6px;font:inherit;cursor:pointer}" +
    "#ynO2qYes{background:#2e7d32;color:#fff}#ynO2qYes:hover{background:#388e3c}" +
    "#ynO2qNo{background:#333;color:#ddd}#ynO2qNo:hover{background:#3f3f3f}";

  function ensureStyle() {
    if (document.getElementById("ynO2qStyle")) return;
    var st = document.createElement("style");
    st.id = "ynO2qStyle";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }

  function onQuotePage() { return /^\/quotes\/[^/]+/.test(location.pathname); }

  function findPreviewSendButton() {
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || "").replace(/\s+/g, " ").trim();
      if (/Preview & Send$/i.test(t)) return btns[i];
    }
    return null;
  }

  /**
   * Clone the native "Preview & Send" button so ours inherits Younium's exact
   * classes + Angular scope attributes (identical background, radius, hover,
   * icon colour — and it tracks theme changes). cloneNode copies no event
   * listeners, so the clone is inert until we wire our own click handler.
   * The Material icon ligature "visibility" becomes "content_copy" and the
   * label becomes "Copy from order". Returns null if the structure ever
   * changes, in which case the caller builds the styled fallback button.
   */
  function buildClonedButton(anchor) {
    try {
      var btn = anchor.cloneNode(true);
      btn.id = "ynO2qBtn";
      btn.type = "button";
      btn.removeAttribute("disabled");
      btn.setAttribute("aria-label", "Copy products from an order");
      var withIds = btn.querySelectorAll("[id]");
      for (var i = 0; i < withIds.length; i++) withIds[i].removeAttribute("id");
      // Younium renders button icons as an empty span whose glyph comes from
      // CSS: .material-symbols-sharp.<name>::before { content: "<name>" }
      // (ligature font). Swap the class token + data-icon to change the glyph.
      var replacedIcon = false, replacedLabel = false;
      var icon = btn.querySelector("[data-icon]");
      if (icon) {
        var prevIcon = icon.getAttribute("data-icon");
        if (prevIcon) icon.classList.remove(prevIcon);
        icon.classList.add("content_copy");
        icon.setAttribute("data-icon", "content_copy");
        replacedIcon = true;
      }
      var walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var t = (node.nodeValue || "").trim();
        if (!t) continue;
        if (!replacedIcon && t === "visibility") {
          node.nodeValue = "content_copy";
          replacedIcon = true;
        } else if (!replacedLabel && /Preview & Send/i.test(node.nodeValue)) {
          node.nodeValue = node.nodeValue.replace(/Preview & Send/i, "Copy from order");
          replacedLabel = true;
        }
      }
      return replacedLabel ? btn : null;
    } catch (_) { return null; }
  }

  function injectButton() {
    if (!onQuotePage()) {
      var stale = document.getElementById("ynO2qBtn");
      if (stale) stale.remove();
      return;
    }
    if (document.getElementById("ynO2qBtn")) return;
    var anchor = findPreviewSendButton();
    if (!anchor || !anchor.parentElement) return;
    ensureStyle();
    var btn = buildClonedButton(anchor);
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "ynO2qBtn";
      btn.type = "button";
      btn.className = "ynO2qFallback";
      btn.innerHTML = "📦 Copy from order";
    }
    btn.addEventListener("click", openDialog);
    anchor.parentElement.insertBefore(btn, anchor);
  }

  function openDialog() {
    if (document.getElementById("ynO2qOverlay")) return;
    ensureStyle();
    var overlay = document.createElement("div");
    overlay.id = "ynO2qOverlay";
    overlay.innerHTML =
      '<div id="ynO2qCard" role="dialog" aria-label="Copy products from order">' +
      "<header><span>📦 Copy products from a Younium order</span>" +
      '<button id="ynO2qClose" title="Close">✕</button></header>' +
      '<div id="ynO2qBody">' +
      '<div id="ynO2qRow"><input id="ynO2qInput" type="text" placeholder="Order number, e.g. O-015091" spellcheck="false">' +
      '<button id="ynO2qGo">Fetch</button></div>' +
      '<div id="ynO2qHint">Copies every product from the order onto this quote with its ordered quantity and discount %. Prices use the current price list.</div>' +
      '<div id="ynO2qConfirm"></div>' +
      '<div id="ynO2qLog"></div>' +
      "</div></div>";
    document.body.appendChild(overlay);

    var input = overlay.querySelector("#ynO2qInput");
    var goBtn = overlay.querySelector("#ynO2qGo");
    var logBox = overlay.querySelector("#ynO2qLog");
    var confirmBox = overlay.querySelector("#ynO2qConfirm");
    var busy = false;

    input.value = GM_getValue("ynO2qLastOrder", "");
    input.focus();
    input.select();

    function close() {
      if (busy) return;
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
    }
    function onKey(e) {
      if (e.key === "Escape") { close(); }
      if (e.key === "Enter" && document.activeElement === input && !busy) { fetchOrder(); }
    }
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) close(); });
    overlay.querySelector("#ynO2qClose").addEventListener("click", close);

    function log(kind, text) {
      logBox.style.display = "flex";
      var line = document.createElement("div");
      line.className = "ynO2qL-" + kind;
      line.textContent = text;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    }

    async function fetchOrder() {
      var orderNumber = normalizeOrderNumber(input.value);
      if (!orderNumber) { log("err", "Type an order number first (e.g. O-015091)."); return; }
      busy = true;
      goBtn.disabled = true;
      input.disabled = true;
      confirmBox.style.display = "none";
      logBox.innerHTML = "";
      try {
        log("info", "Resolving this quote…");
        var quote = await resolveCurrentQuote();
        log("info", "Quote " + (quote.number || quote.id) + " · " + (quote.currencyCode || ""));
        log("info", "Looking up " + orderNumber + "…");
        var order = await findOrderByNumber(orderNumber);
        if (!order) throw new Error("No order found for " + orderNumber + " (is it the right region/tenant?).");
        GM_setValue("ynO2qLastOrder", orderNumber);

        var orderFull = await gmYouniumRequest("GET", "/api/order/" + encodeURIComponent(order.id), null);
        var prodCount = ((orderFull && orderFull.orderProducts) || []).filter(function (p) { return p && !p.isDeleted && !p.isAddedCharge; }).length;

        confirmBox.innerHTML =
          "Found <b>" + escHtml(order.orderNumber) + "</b> — " + escHtml(order.description || "(no description)") +
          "<br>Account: <b>" + escHtml(order.accountname || "?") + "</b> · Products: <b>" + prodCount + "</b>" +
          "<br>Add these to quote <b>" + escHtml(quote.number || "") + "</b>?" +
          '<div id="ynO2qConfirmBtns"><button id="ynO2qYes" class="ynO2qSmall">Add ' + prodCount + " products</button>" +
          '<button id="ynO2qNo" class="ynO2qSmall">Cancel</button></div>';
        confirmBox.style.display = "block";

        confirmBox.querySelector("#ynO2qNo").addEventListener("click", function () {
          confirmBox.style.display = "none";
          busy = false;
          goBtn.disabled = false;
          input.disabled = false;
        });
        confirmBox.querySelector("#ynO2qYes").addEventListener("click", async function () {
          confirmBox.style.display = "none";
          try {
            var result = await copyOrderToQuote(order, quote, log);
            log("ok", "✅ Done — " + result.chargeCount + " charge(s) updated across " + result.productCount + " product(s)." +
              (result.warnings.length ? " " + result.warnings.length + " warning(s) above." : ""));
            log("info", "Reloading to show the new lines…");
            setTimeout(function () { location.reload(); }, 1600);
          } catch (e) {
            log("err", "✖ " + (e && e.message || e));
            busy = false;
            goBtn.disabled = false;
            input.disabled = false;
          }
        });
      } catch (e) {
        log("err", "✖ " + (e && e.message || e));
        busy = false;
        goBtn.disabled = false;
        input.disabled = false;
      }
    }

    goBtn.addEventListener("click", fetchOrder);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SPA navigation — keep the button present on quote pages
  // ══════════════════════════════════════════════════════════════════════

  var lastHref = "";
  setInterval(function () {
    if (location.href !== lastHref) { lastHref = location.href; injectButton(); }
  }, 600);
  new MutationObserver(function () { injectButton(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  injectButton();

  // Diagnostics (no secrets — token status only)
  try {
    window.__ynO2q = {
      token: function () {
        return {
          hasToken: !!GM_getValue("ynAccessToken", ""),
          expiresAt: GM_getValue("ynAccessTokenExpiresAt", 0) || null,
          region: region(),
        };
      },
      findOrder: findOrderByNumber,
    };
  } catch (_) {}
})();
