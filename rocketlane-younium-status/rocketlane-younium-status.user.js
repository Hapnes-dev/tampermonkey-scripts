// ==UserScript==
// @name         Rocketlane Younium Status
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.0.1
// @description  Adds a "☄️ Younium" button to the Rocketlane project nav (next to "All files") that opens a Younium order + subscription status modal for the plant — same verdict engine + styling as the Project Progress Tracker.
// @author       hapnes-dev
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-younium-status/rocketlane-younium-status.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-younium-status/rocketlane-younium-status.user.js
// @match        https://kiona.rocketlane.com/*
// @match        https://eu.younium.com/*
// @match        https://us.younium.com/*
// @match        https://app.younium.com/*
// @connect      auth.eu.younium.com
// @connect      auth.us.younium.com
// @connect      api.younium.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

/*
 * Rocketlane Younium Status
 * ─────────────────────────
 * A standalone port of the Project Progress Tracker's Younium status feature.
 *
 *  • On younium.com pages: captures the hublet region (eu/us) into GM storage so
 *    the bridge knows which Frontegg auth host to mint tokens against.
 *  • On kiona.rocketlane.com project pages: injects a "☄️ Younium" button into
 *    the project nav (right after "All files"). Clicking it reads the plant ID
 *    from the project name, queries Younium directly (CORS-bypassed via
 *    GM_xmlhttpRequest using the Frontegg refresh cookie in the browser jar),
 *    computes the order + subscription verdict, and shows it in a styled modal.
 *
 * No tokens are stored in the page. The Younium Bearer JWT is minted on demand
 * from the HttpOnly refresh cookie and held only in GM storage with an expiry.
 * Read-only: the modal never writes to Younium.
 */

(function () {
  "use strict";

  // ──────────────────────────────────────────────────────────────────────────
  // Side A — On Younium: remember the hublet region (eu / us).
  // Younium's API host is api.younium.com (global) but the AUTH host is
  // region-specific (auth.eu.younium.com vs auth.us.younium.com). No token is
  // captured here — the bridge mints one on demand from the HttpOnly refresh
  // cookie when it needs to call api.younium.com.
  // ──────────────────────────────────────────────────────────────────────────
  if (/(?:^|\.)younium\.com$/i.test(location.hostname)) {
    try {
      const m = location.hostname.match(/^(eu|us)\.younium\.com$/i);
      if (m) {
        const region = m[1].toLowerCase();
        if (region !== GM_getValue("ynRegion", "")) {
          GM_setValue("ynRegion", region);
          GM_setValue("ynRegionCapturedAt", Date.now());
        }
      }
    } catch (_) {}
    return; // never run the Rocketlane UI on Younium pages
  }

  // Everything below only runs on the Rocketlane tenant.
  if (location.hostname !== "kiona.rocketlane.com") return;

  const UI_LOCALE = "nb-NO";
  const YOUNIUM_API = "https://api.younium.com";

  function ynRegion() { return GM_getValue("ynRegion", "eu") || "eu"; }
  function ynOrderUrl(id) { return "https://" + ynRegion() + ".younium.com/orders/" + encodeURIComponent(String(id || "")); }

  // ════════════════════════════════════════════════════════════════════════
  // 1. Younium auth core (CORS-bypassing GM_xmlhttpRequest — ported verbatim
  //    from rocketlane-chat-bridge so behaviour stays identical).
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Mint a fresh Younium access token by calling the Frontegg refresh endpoint
   * with the HttpOnly refresh cookie. Caches the token (+ expiry) in GM storage.
   * Passive refreshes honour a 30s cooldown; a 401-driven forceRefresh bypasses
   * it (the cached token was just rejected, so handing it back would loop).
   */
  let ynRefreshInFlight = null;
  let ynLastRefreshAttempt = 0;
  function gmYouniumRefreshToken(forceRefresh) {
    if (ynRefreshInFlight) return ynRefreshInFlight;
    const now = Date.now();
    if (!forceRefresh && now - ynLastRefreshAttempt < 30 * 1000) {
      const cached = GM_getValue("ynAccessToken", "");
      if (cached) return Promise.resolve(cached);
    }
    ynLastRefreshAttempt = now;
    const region = GM_getValue("ynRegion", "eu"); // default to EU
    const authHost = "https://auth." + region + ".younium.com";
    ynRefreshInFlight = new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: authHost + "/frontegg/identity/resources/auth/v1/user/token/refresh",
        headers: { "content-type": "application/json", accept: "application/json" },
        data: "{}",
        timeout: 20000,
        anonymous: false,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(
              "HTTP " + res.status +
              ": Younium session expired or missing. Open https://" + region +
              ".younium.com once while logged in, then try again.",
            ));
            return;
          }
          try {
            const j = JSON.parse(res.responseText || "{}");
            const token = String(j?.accessToken ?? "").trim();
            if (!token) { reject(new Error("Younium refresh returned no accessToken.")); return; }
            const ttlMs = Math.max(60_000, Number(j.expiresIn || 0) * 1000);
            const expiresAt = Date.now() + ttlMs;
            GM_setValue("ynAccessToken", token);
            GM_setValue("ynAccessTokenExpiresAt", expiresAt);
            GM_setValue("ynAccessTokenCapturedAt", Date.now());
            resolve(token);
          } catch (e) {
            reject(new Error("Younium refresh parse failed: " + (e?.message ?? e)));
          }
        },
        onerror: () => reject(new Error("Network error reaching Younium auth")),
        ontimeout: () => reject(new Error("Younium auth timed out")),
      });
    }).finally(() => { setTimeout(() => { ynRefreshInFlight = null; }, 0); });
    return ynRefreshInFlight;
  }

  /**
   * Generic CORS-bypassing HTTP call to the Younium API. Ensures a fresh access
   * token, sends Authorization: Bearer against api.younium.com. On 401, refreshes
   * once and retries. SECURITY: never attaches the JWT to a non-Younium origin.
   */
  async function gmYouniumRequest(method, path, body) {
    const url = /^https?:/i.test(path) ? path : (YOUNIUM_API + (path.startsWith("/") ? path : "/" + path));
    let __ynOrigin = "";
    try { __ynOrigin = new URL(url).origin; } catch (_) {}
    if (__ynOrigin !== "https://api.younium.com") {
      throw new Error("Refusing to send Younium token to non-Younium origin: " + (__ynOrigin || url));
    }

    let token = GM_getValue("ynAccessToken", "");
    const expiresAt = Number(GM_getValue("ynAccessTokenExpiresAt", 0));
    const expiringSoon = !expiresAt || (Date.now() > expiresAt - 60_000);
    if (!token || expiringSoon) token = await gmYouniumRefreshToken();

    const send = (t) => new Promise((resolve, reject) => {
      const headers = {
        accept: "application/json",
        Authorization: "Bearer " + t,
        "X-Younium-Origin": "frontend",
      };
      const init = {
        method: String(method ?? "GET").toUpperCase(),
        url,
        headers,
        timeout: 20000,
        anonymous: false,
        onload: (res) => resolve({ status: res.status, text: res.responseText || "" }),
        onerror: () => reject(new Error("Network error reaching Younium API")),
        ontimeout: () => reject(new Error("Younium API timed out")),
      };
      if (body !== undefined && body !== null) {
        headers["content-type"] = "application/json";
        init.data = typeof body === "string" ? body : JSON.stringify(body);
      }
      GM_xmlhttpRequest(init);
    });

    let res = await send(token);
    if (res.status === 401) {
      try { token = await gmYouniumRefreshToken(true); res = await send(token); } catch (_) {}
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "HTTP " + res.status +
        ": Younium session expired. Open https://" + GM_getValue("ynRegion", "eu") +
        ".younium.com once while logged in to refresh, then try again.",
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error("HTTP " + res.status + ": " + (res.text || "").slice(0, 300));
    }
    if (!res.text) return null;
    try { return JSON.parse(res.text); } catch { return null; }
  }

  // ── Thin Younium API methods (mirror the bridge's YouniumBridge surface) ──
  function ynSearchOrders(query, opts) {
    const body = {
      entity: "order",
      filter: String(query ?? ""),
      pageNumber: 0,
      pageSize: opts?.pageSize ?? 20,
      sortField: opts?.sortField ?? "effectiveStartDate",
      sortDirection: opts?.sortDirection ?? "desc",
      displayFields: opts?.displayFields ?? [
        "orderNumber", "plant_id", "plant_name",
        "accountname", "status", "orderType",
        "effectiveStartDate", "id",
      ],
      conditions: opts?.conditions ?? [{ fieldName: "isLastVersion", value: true, operator: 0 }],
      conditionLogic: opts?.conditionLogic ?? "",
    };
    return gmYouniumRequest("POST", "/api/data/query/order", body);
  }
  function ynGetOrderById(id) {
    const safe = encodeURIComponent(String(id || "").trim());
    if (!safe) throw new Error("getOrderById: id is required");
    return gmYouniumRequest("GET", "/api/order/" + safe, null);
  }
  async function ynGetInvoicesForOrder(orderNumber) {
    const n = String(orderNumber || "").trim();
    if (!n) return [];
    const result = await gmYouniumRequest("POST", "/api/order/invoicesForHistory", { orderNumber: n });
    return Array.isArray(result) ? result : (result?.result ?? []);
  }
  async function ynGetOrderEventLog(id) {
    const safe = encodeURIComponent(String(id || "").trim());
    if (!safe) throw new Error("getOrderEventLog: id is required");
    const result = await gmYouniumRequest("GET", "/api/eventlog/order/id/" + safe, null);
    return Array.isArray(result) ? result : (result?.result ?? []);
  }

  // Diagnostics on window (parity with the tracker's __yn helper).
  try {
    window.__ynStatus = {
      token: () => ({
        hasToken: !!GM_getValue("ynAccessToken", ""),
        region: GM_getValue("ynRegion", "") || null,
        expiresAt: GM_getValue("ynAccessTokenExpiresAt", 0) || null,
      }),
      api: (m, p, b) => gmYouniumRequest(m, p, b),
      search: (pid) => ynSearchOrders("", { pageSize: 50, conditions: [{ fieldName: "plant_id", value: String(pid), operator: 0 }, { fieldName: "isLastVersion", value: true, operator: 0 }] }),
    };
  } catch (_) {}

  // ════════════════════════════════════════════════════════════════════════
  // 2. Verdict engine (ported from the Project Progress Tracker).
  // ════════════════════════════════════════════════════════════════════════

  function extractPlantIdFromProjectName(name) {
    if (!name) return null;
    const m = String(name).trim().match(/^(\d{2,7})\s*[-–]\s+/);
    return m ? m[1] : null;
  }

  // ONLY products literally named "IWMAC Subscription" / "IWMAC Abonnement"
  // qualify an order as the IWMAC subscription. Other IWMAC-branded products
  // (Modul, Product, License) are one-time items, not subscription evidence.
  const IWMAC_SUBSCRIPTION_NAME_PATTERN = /\bIWMAC\s*(?:Abonnement|Subscription)\b/i;
  function findIwmacSubscriptionItem(order) {
    if (!order || typeof order !== "object") return null;
    const candidateArrays = [
      order.bookings, order.products, order.charges, order.orderProducts,
      order.subscriptions, order.subscriptionProducts, order.lineItems, order.items,
    ];
    for (const arr of candidateArrays) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const nameFields = [
          item.productName, item.name, item.subscriptionName,
          item.product?.name, item.product?.productName,
          item.subscriptionProduct?.name, item.subscriptionProduct?.productName,
          item.subscription_product_name,
        ].filter(Boolean);
        for (const n of nameFields) {
          if (IWMAC_SUBSCRIPTION_NAME_PATTERN.test(String(n))) {
            return { item, productName: String(n) };
          }
        }
      }
    }
    return null;
  }

  async function youniumFetchOrderDetails(id) { return await ynGetOrderById(id); }

  async function youniumFindAllOrdersByPlantId(plantId) {
    const pid = String(plantId || "").trim();
    if (!pid) return [];
    try {
      const result = await ynSearchOrders("", {
        pageSize: 50,
        displayFields: [
          "orderNumber", "description", "plant_id", "plant_name",
          "accountname", "accountId", "status", "orderType",
          "effectiveStartDate", "effectiveEndDate",
          "cancellationDate", "created", "modified",
          "isLastVersion", "isAutoRenewed", "id",
        ],
        conditions: [
          { fieldName: "plant_id", value: pid, operator: 0 },
          { fieldName: "isLastVersion", value: true, operator: 0 },
        ],
      });
      return result?.result || [];
    } catch (e) {
      console.warn("[Younium status] plant_id all-orders search failed", e);
      return [];
    }
  }

  async function youniumFindSubscriptionByPlantId(plantId) {
    const pid = String(plantId || "").trim();
    if (!pid) return null;
    try {
      const result = await ynSearchOrders("", {
        pageSize: 50,
        conditions: [
          { fieldName: "plant_id", value: pid, operator: 0 },
          { fieldName: "isLastVersion", value: true, operator: 0 },
        ],
      });
      const summaries = result?.result || [];
      for (const summary of summaries) {
        if (!summary?.id) continue;
        try {
          const full = await ynGetOrderById(summary.id);
          const match = findIwmacSubscriptionItem(full);
          if (match) return { order: full, productName: match.productName };
        } catch (e) {
          console.warn("[Younium status] failed to hydrate order " + summary.id, e);
        }
      }
      return null;
    } catch (e) {
      console.warn("[Younium status] subscription-by-plant_id search failed", e);
      return null;
    }
  }

  async function youniumFetchInvoicesForOrder(orderNumber) {
    try { return await ynGetInvoicesForOrder(orderNumber); }
    catch (e) { console.warn("[Younium status] invoice history failed:", e); return []; }
  }
  async function youniumFetchOrderEventLog(id) {
    try { return await ynGetOrderEventLog(id); }
    catch (e) { console.warn("[Younium status] eventlog fetch failed:", e); return []; }
  }

  // Younium eventlog uses `timeStamp` (capital S) + `action`.
  function pickEventTs(e) {
    return Date.parse(e?.timeStamp || e?.timestamp || e?.createdDate || e?.eventDate ||
                      e?.created || e?.when || e?.date || "") || 0;
  }
  function normalizeEvent(top) {
    if (!top) return null;
    return {
      timestamp: top.timeStamp || top.timestamp || top.createdDate || top.eventDate ||
                 top.created || top.when || top.date || null,
      user: top.userEmail || top.email || top.userDisplayName ||
            top.userName || top.user || top.modifiedByUserDisplayName ||
            top.modifiedBy || top.createdByUserDisplayName || top.createdBy || null,
      description: top.action || top.description || top.message || top.event ||
                   top.type || top.eventType || null,
      raw: top,
    };
  }
  function extractLatestEvent(events) {
    if (!Array.isArray(events) || events.length === 0) return null;
    return normalizeEvent(events.slice().sort((a, b) => pickEventTs(b) - pickEventTs(a))[0]);
  }
  function extractFirstEvent(events) {
    if (!Array.isArray(events) || events.length === 0) return null;
    return normalizeEvent(events.slice().sort((a, b) => pickEventTs(a) - pickEventTs(b))[0]);
  }

  function youniumInvoiceIsPosted(inv) {
    return !!(inv && (inv.status === 3 || inv.status === 2 || inv.posted));
  }
  function youniumDeliveryStatusLabel(status) {
    if (status === 7) return "Partially delivered";
    if (status === 8) return "Delivered";
    return null;
  }
  function youniumApplyPartialDeliveryDowngrade(out) {
    if (out && out.color === "green" && out.deliveryStatus === "Partially delivered") {
      out.color = "yellow";
      out.label = "Younium: ⚠ Partially delivered";
      (out.problems = out.problems || []).push(
        "Order is only Partially delivered in Younium — not fully delivered yet.",
      );
    }
    return out;
  }
  function youniumRelatedOrderStatusLabel(o, postedInvoiceCount) {
    const now = Date.now();
    const tsStart = o?.effectiveStartDate ? Date.parse(o.effectiveStartDate) : NaN;
    const tsCancelled = o?.cancellationDate ? Date.parse(o.cancellationDate) : NaN;
    const invoicesKnown = typeof postedInvoiceCount === "number";
    if (Number.isFinite(tsCancelled) && tsCancelled <= now) return "Cancelled";
    if (o?.status === 5 || o?.status === 0) return "Draft";
    if (o?.status === 1) return "Created";
    const delivered = youniumDeliveryStatusLabel(o?.status);
    if (delivered) return delivered;
    if (invoicesKnown && postedInvoiceCount > 0) return "Invoiced";
    if (Number.isFinite(tsStart) && tsStart > now) return "Pending start";
    if (!invoicesKnown) return "Active";
    if (o?.isLastVersion) return "Not invoiced";
    return "Outdated";
  }
  function youniumRelatedOrderBadgeClass(label) {
    switch (label) {
      case "Invoiced":
      case "Delivered":
      case "Active": return "youniumSubBadge-green";
      case "Cancelled":
      case "Draft":
      case "Outdated": return "youniumSubBadge-red";
      case "Not invoiced":
      case "Pending start":
      case "Partially delivered":
      case "Created": return "youniumSubBadge-yellow";
      default: return "youniumSubBadge-gray";
    }
  }

  /**
   * Compute the Younium verdict for a plant, driven entirely by the plant ID
   * (this tool has no saved Younium link to start from). Discovers the plant's
   * orders, promotes the most-recently-modified one as the Order/offer, finds
   * the IWMAC subscription via plant_id, then runs the same status derivation +
   * verdict as the tracker's saved-URL order path. Returns the `out` shape the
   * modal renderer expects.
   */
  async function computeYouniumStatusByPlantId(plantId, projectName) {
    const dbg = (...a) => { try { if (window.__matchDebug !== false) console.log("[Younium status]", ...a); } catch (_) {} };
    const out = {
      color: "gray", label: "Younium: Missing", kind: null,
      orderStatus: "Unknown", deliveryStatus: null, subscriptionStatus: "Unknown",
      orderNumber: null, links: {}, lastCheckedAt: new Date().toISOString(),
      problems: [], raw: null, relatedOrders: [],
    };
    const pid = String(plantId || "").trim();
    dbg("compute for", { plantId: pid, projectName });
    if (!pid) { out.problems.push("No plant ID found in the project name."); return out; }

    const allOrders = await youniumFindAllOrdersByPlantId(pid);
    out.relatedOrders = allOrders;
    if (!allOrders.length) {
      out.color = "gray";
      out.label = "Younium: No orders found";
      out.problems.push("No Younium orders found for plant " + pid + ".");
      return out;
    }

    // Promote the most-recently-modified order as the project's Order/offer.
    const sorted = allOrders.slice().sort((a, b) => {
      const ta = Date.parse(a?.modified || a?.created || 0) || 0;
      const tb = Date.parse(b?.modified || b?.created || 0) || 0;
      return tb - ta;
    });
    const primarySummary = sorted[0];
    let order;
    try { order = await youniumFetchOrderDetails(primarySummary.id); }
    catch (e) {
      dbg("primary hydrate failed", e);
      out.color = "yellow"; out.label = "Younium: Error";
      out.problems.push("Couldn't fetch the plant's primary order: " + (e?.message ?? e));
      return out;
    }
    if (!order) { out.problems.push("Primary order fetch returned null."); return out; }

    out.raw = { order };
    out.orderNumber = order.orderNumber || primarySummary.id;
    out.links.saved = ynOrderUrl(order.id);

    // ── Subscription detection: (1) IWMAC product on the primary order,
    //    (2) plant_id-wide search for a separate subscription order.
    let subMatch = null, subscriptionOrder = null, subscriptionOrderIsSeparate = false;
    const onOrder = findIwmacSubscriptionItem(order);
    if (onOrder) { subMatch = onOrder; subscriptionOrder = order; }
    if (!subMatch) {
      const found = await youniumFindSubscriptionByPlantId(pid);
      if (found) {
        subMatch = { item: null, productName: found.productName };
        subscriptionOrder = found.order;
        subscriptionOrderIsSeparate = true;
        out.raw.subscriptionOrder = found.order;
      }
    }
    out.subscriptionProduct = subMatch ? { productName: subMatch.productName, item: subMatch.item } : null;
    out.hasSubscriptionProduct = !!subMatch;
    out.subscriptionOrder = subscriptionOrder;
    out.subscriptionOrderIsSeparate = subscriptionOrderIsSeparate;

    // ── Eventlogs for Created by / Last updated by (non-fatal) ──
    try {
      const ev = await youniumFetchOrderEventLog(order.id);
      out.raw.orderEventLog = ev;
      out.orderLatestEvent = extractLatestEvent(ev);
      out.orderCreatedEvent = extractFirstEvent(ev);
    } catch (e) { dbg("primary eventlog failed", e); }
    if (subscriptionOrder?.id && subscriptionOrder.id !== order.id) {
      try {
        const ev = await youniumFetchOrderEventLog(subscriptionOrder.id);
        out.raw.subscriptionEventLog = ev;
        out.subscriptionLatestEvent = extractLatestEvent(ev);
        out.subscriptionCreatedEvent = extractFirstEvent(ev);
      } catch (e) { dbg("sub eventlog failed", e); }
    } else if (subscriptionOrder?.id) {
      out.subscriptionLatestEvent = out.orderLatestEvent;
      out.subscriptionCreatedEvent = out.orderCreatedEvent;
    }

    const now = Date.now();
    const tsStart = order.effectiveStartDate ? Date.parse(order.effectiveStartDate) : NaN;
    const tsEnd = order.effectiveEndDate ? Date.parse(order.effectiveEndDate) : NaN;
    const tsCancelled = order.cancellationDate ? Date.parse(order.cancellationDate) : NaN;
    const isCancelled = Number.isFinite(tsCancelled) && tsCancelled <= now;
    const isExpired = Number.isFinite(tsEnd) && tsEnd <= now && !order.isAutoRenewed && !order.isRenewed;
    const startsInFuture = Number.isFinite(tsStart) && tsStart > now;

    // ── Subscription status derivation ──
    const subOrder = subscriptionOrder || order;
    const subOrderNumberStr = String(subOrder.orderNumber || "").trim();
    const subOrderNumberLooksDraft =
      !subOrderNumberStr || subOrderNumberStr.toLowerCase() === "draft" || /^draft\b/i.test(subOrderNumberStr);
    const subIsRawDraft = subOrder.status === 5 || subOrderNumberLooksDraft;
    const subIsRawCreated = subOrder.status === 1 && subOrderNumberLooksDraft;
    const subTsStart = subOrder.effectiveStartDate ? Date.parse(subOrder.effectiveStartDate) : NaN;
    const subTsEnd = subOrder.effectiveEndDate ? Date.parse(subOrder.effectiveEndDate) : NaN;
    const subTsCancelled = subOrder.cancellationDate ? Date.parse(subOrder.cancellationDate) : NaN;
    const subIsCancelled = Number.isFinite(subTsCancelled) && subTsCancelled <= now;
    const subIsExpired = Number.isFinite(subTsEnd) && subTsEnd <= now && !subOrder.isAutoRenewed && !subOrder.isRenewed;
    const subStartsInFuture = Number.isFinite(subTsStart) && subTsStart > now;
    if (subIsCancelled) out.subscriptionStatus = "Cancelled";
    else if (subIsRawDraft) out.subscriptionStatus = "Draft (not activated)";
    else if (subIsRawCreated) out.subscriptionStatus = "Created (not finalized)";
    else if (subIsExpired) out.subscriptionStatus = "Inactive";
    else if (subStartsInFuture) out.subscriptionStatus = "Order — not active yet";
    else if (subOrder.isLastVersion && Number.isFinite(subTsStart)) out.subscriptionStatus = "Active";
    else if (subOrder.isLastVersion) out.subscriptionStatus = "Order";
    else out.subscriptionStatus = "Unknown";

    // ── Invoice check ──
    const invoices = await youniumFetchInvoicesForOrder(out.orderNumber);
    const postedInvoices = (invoices || []).filter(youniumInvoiceIsPosted);
    out.raw.invoices = invoices;

    // ── Order status ──
    const isRawDraft = order.status === 5;
    const isRawCreated = order.status === 1;
    if (isCancelled) out.orderStatus = "Cancelled";
    else if (isRawDraft) out.orderStatus = "Draft";
    else if (isRawCreated) out.orderStatus = "Created (not finalized)";
    else if (postedInvoices.length > 0) out.orderStatus = "Invoiced";
    else if (startsInFuture) out.orderStatus = "Order (pending start)";
    else if (order.isLastVersion) out.orderStatus = "Order (not invoiced)";
    else out.orderStatus = "Draft (outdated version)";
    out.deliveryStatus = youniumDeliveryStatusLabel(order.status);

    // ── Verdict color + label (mirrors the tracker's order path) ──
    if (isCancelled) {
      out.color = "red"; out.label = "Younium: ✗ Cancelled";
      out.problems.push("Order was cancelled on " + (order.cancellationDate || "").slice(0, 10));
    } else if (isExpired) {
      out.color = "red"; out.label = "Younium: ✗ Expired";
      out.problems.push("Order ended " + (order.effectiveEndDate || "").slice(0, 10) + " and is not auto-renewing");
    } else if (isRawDraft || out.orderStatus.startsWith("Draft")) {
      out.color = "red"; out.label = "Younium: ⚠ Activate order in Younium";
      out.problems.push("Order is in Draft state — needs to be activated and invoiced");
    } else if (isRawCreated) {
      out.color = "red"; out.label = "Younium: ⚠ Finalize order in Younium";
      out.problems.push("Order is Created but not yet finalized — should be activated and invoiced");
    } else if (postedInvoices.length === 0) {
      out.color = "yellow"; out.label = "Younium: ⏳ Awaiting first invoice";
      out.problems.push("Order has no posted invoices yet — should be invoiced");
    } else if (out.hasSubscriptionProduct && out.subscriptionStatus !== "Active") {
      out.color = "red";
      if (out.subscriptionStatus.startsWith("Draft")) {
        out.label = "Younium: ⚠ Activate subscription in Younium";
        out.problems.push("Subscription is Draft — needs to be activated in Younium.");
      } else if (out.subscriptionStatus.startsWith("Created")) {
        out.label = "Younium: ⚠ Finalize subscription in Younium";
        out.problems.push("Subscription is not finalized — needs to be activated in Younium.");
      } else {
        out.label = "Younium: ⚠ Subscription " + out.subscriptionStatus.toLowerCase();
        out.problems.push("Subscription is " + out.subscriptionStatus + " — should be Active.");
      }
    } else if (out.subscriptionStatus === "Active") {
      out.color = "green"; out.label = "Younium: ✓ All good";
    } else if (out.subscriptionStatus === "Order — not active yet") {
      out.color = "yellow"; out.label = "Younium: ⏳ Subscription starts " + (order.effectiveStartDate || "").slice(0, 10);
      out.problems.push("Subscription starts " + (order.effectiveStartDate || "").slice(0, 10));
    } else if (!out.hasSubscriptionProduct && postedInvoices.length > 0) {
      out.color = "green"; out.label = "Younium: ✓ Invoiced (one-time)";
    } else {
      out.color = "yellow"; out.label = "Younium: ⚠ Status uncertain";
      out.problems.push("Could not determine subscription state confidently");
    }

    youniumApplyPartialDeliveryDowngrade(out);
    dbg("verdict", { color: out.color, label: out.label, orderStatus: out.orderStatus, subscriptionStatus: out.subscriptionStatus });
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. Shared helpers (escaping + URL scheme guard).
  // ════════════════════════════════════════════════════════════════════════

  function escHtml(s) {
    return String(s ?? "").replace(/[<>&"']/g, (c) =>
      c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" :
      c === '"' ? "&quot;" : "&#39;");
  }
  function toHttpUrl(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : "https://" + s;
    return /^https?:\/\//i.test(withScheme) ? withScheme : "";
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. Modal + nav button UI.
  // ════════════════════════════════════════════════════════════════════════

  const YOUNIUM_LOGO_URL = "https://www.younium.com/hubfs/Younium%20Logo%20Icon%20(1)-1.png";
  let currentYouniumStatusProject = null;
  let currentYouniumStatusVerdict = null;
  const els = {};

  // Per-session verdict cache (plantId -> verdict) so the nav chip + modal show
  // instantly on revisit; an in-flight map to dedupe concurrent computes; a
  // monotonic render generation to discard stale (out-of-order) results; and a
  // session flag so a missing Younium session doesn't spam auto-computes.
  const verdictCache = new Map();
  const inflightPlants = new Map();
  let ynRenderGen = 0;
  let ynSessionUnavailable = false;

  function injectStyles() {
    if (document.getElementById("ynStatusStyles")) return;
    const style = document.createElement("style");
    style.id = "ynStatusStyles";
    style.textContent = `
      /* Scoped design tokens (dark default, light via media query) so the
         modal + button match the PPT look without leaking onto Rocketlane. */
      .ynNavBtn, dialog.dlgYouniumStatus {
        --surface-1: rgba(255,255,255,0.025);
        --surface-2: rgba(255,255,255,0.045);
        --surface-3: rgba(255,255,255,0.07);
        --hairline: rgba(255,255,255,0.06);
        --hairline-strong: rgba(255,255,255,0.10);
        --text: rgba(255,255,255,0.94);
        --muted: rgba(255,255,255,0.66);
        --muted2: rgba(255,255,255,0.46);
        --accent: #7dd3fc;
        --good: #34d399;  --good-soft: rgba(52,211,153,0.13);
        --warn: #fbbf24;  --warn-soft: rgba(251,191,36,0.13);
        --bad: #fb7185;   --bad-soft: rgba(251,113,133,0.13);
        --shadow-lg: 0 12px 32px rgba(0,0,0,0.24);
      }
      @media (prefers-color-scheme: light) {
        .ynNavBtn, dialog.dlgYouniumStatus {
          --surface-1: rgba(255,255,255,0.92);
          --surface-2: rgba(255,255,255,1);
          --surface-3: rgba(15,23,42,0.04);
          --hairline: rgba(15,23,42,0.07);
          --hairline-strong: rgba(15,23,42,0.12);
          --text: rgba(15,23,42,0.94);
          --muted: rgba(15,23,42,0.64);
          --muted2: rgba(15,23,42,0.44);
          --accent: #0284c7;
        }
      }

      /* ── Nav button (sits next to "All files") ── */
      .ynNavBtnCell { display: inline-flex; align-items: center; padding: 0 6px; }
      .ynNavBtn {
        display: inline-flex; align-items: center; gap: 6px;
        height: 30px; padding: 0 12px;
        font-size: 13px; font-weight: 500; line-height: 1;
        border-radius: 999px; cursor: pointer; white-space: nowrap;
        border: 1px solid var(--hairline-strong);
        background: var(--surface-3); color: var(--muted);
        font-family: inherit;
        transition: filter .15s, background .15s, color .15s, border-color .15s;
      }
      .ynNavBtn:hover { filter: brightness(1.08); color: var(--text); }
      .ynNavBtnLogo { width: 15px; height: 15px; border-radius: 3px; display: block; flex: 0 0 auto; object-fit: contain; }
      .ynNavBtnSpinner { display: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--hairline-strong); border-top-color: currentColor; flex: 0 0 auto; animation: ynSpin 0.7s linear infinite; }
      .ynNavBtn.yn-loading .ynNavBtnSpinner { display: inline-block; }
      .ynNavBtn.yn-loading .ynNavBtnLabel { opacity: 0.8; }
      @keyframes ynSpin { to { transform: rotate(360deg); } }
      .ynNavBtn.yn-green  { background: var(--good-soft); color: var(--good); border-color: transparent; }
      .ynNavBtn.yn-yellow { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
      .ynNavBtn.yn-red    { background: var(--bad-soft);  color: var(--bad);  border-color: transparent; }
      .ynNavBtn.yn-gray   { }

      /* ── Younium status modal (ported from the Project Progress Tracker) ── */
      dialog.dlgYouniumStatus[open] {
        margin: auto; width: min(900px, 92vw); max-height: 88vh; padding: 0;
        border: 1px solid var(--hairline-strong); border-radius: 14px;
        background: #0f1424; color: var(--text);
        box-shadow: var(--shadow-lg);
        display: flex; flex-direction: column; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      dialog.dlgYouniumStatus::backdrop { background: rgba(0,0,0,0.6); }
      @media (prefers-color-scheme: light) { dialog.dlgYouniumStatus[open] { background: #ffffff; } }
      dialog.dlgYouniumStatus[open] .youniumSection { background: rgba(255,255,255,0.035); }
      @media (prefers-color-scheme: light) { dialog.dlgYouniumStatus[open] .youniumSection { background: rgba(15,23,42,0.035); } }
      .dlgYouniumStatusXBtn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; margin-left: 12px; border-radius: 8px;
        cursor: pointer; user-select: none; font-size: 18px; line-height: 1;
        color: var(--muted); background: transparent; border: 1px solid transparent;
        transition: background .15s, color .15s, border-color .15s; flex-shrink: 0;
      }
      .dlgYouniumStatusXBtn:hover { background: rgba(255,255,255,0.08); color: var(--text); border-color: var(--hairline); }
      .dlgYouniumStatusXBtn:active { background: rgba(255,255,255,0.14); }
      @media (prefers-color-scheme: light) {
        .dlgYouniumStatusXBtn:hover { background: rgba(15,23,42,0.06); }
        .dlgYouniumStatusXBtn:active { background: rgba(15,23,42,0.12); }
      }
      .dlgYouniumStatusHd {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px; border-bottom: 1px solid var(--hairline);
      }
      .dlgYouniumStatusHd strong { font-size: 15px; font-weight: 600; }
      .dlgYouniumStatusBody {
        padding: 16px 18px; overflow-y: auto; flex: 1 1 auto; min-height: 0;
        display: grid; gap: 14px;
      }
      .dlgYouniumStatusFooter {
        padding: 12px 18px; border-top: 1px solid var(--hairline);
        display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      }
      .dlgYouniumStatusFooter .ynBtn {
        font-family: inherit; font-size: 12.5px; padding: 7px 12px;
        border-radius: 8px; cursor: pointer; text-decoration: none;
        border: 1px solid var(--hairline-strong); background: var(--surface-3);
        color: var(--text); display: inline-flex; align-items: center;
      }
      .dlgYouniumStatusFooter .ynBtn:hover { filter: brightness(1.1); }
      .youniumSummary {
        padding: 12px 14px 12px 15px; border-radius: 8px;
        font-size: 13.5px; font-weight: 500;
        background: var(--surface-1); border: 1px solid var(--hairline);
        border-left-width: 3px; color: var(--text);
      }
      .youniumSummary.youniumStatus-green  { border-left-color: var(--good); }
      .youniumSummary.youniumStatus-yellow { border-left-color: var(--warn); }
      .youniumSummary.youniumStatus-red    { border-left-color: var(--bad); }
      .youniumSummary.youniumStatus-gray   { border-left-color: var(--muted2); }
      .youniumSection {
        border: 1px solid var(--hairline); border-radius: 10px;
        padding: 12px 14px; background: var(--surface-1);
      }
      .youniumSectionTitle {
        font-size: 12px; font-weight: 700; color: var(--muted);
        text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px;
      }
      .youniumKV {
        display: grid; grid-template-columns: 180px 1fr; gap: 4px 14px;
        font-size: 12.5px; line-height: 1.5; margin: 0;
      }
      @media (max-width: 600px) {
        .youniumKV { grid-template-columns: 1fr; }
        .youniumKV dt { color: var(--muted); margin-top: 6px; }
      }
      .youniumKV dt { color: var(--muted); }
      .youniumKV dd { margin: 0; color: var(--text); word-break: break-word; }
      .youniumKV dd a { color: var(--accent); }
      .youniumKV dd a:hover { text-decoration: underline; }
      .youniumWarnings {
        padding: 10px 14px 10px 15px; border-radius: 8px;
        background: var(--surface-1); border: 1px solid var(--hairline);
        border-left: 3px solid var(--bad); color: var(--text); font-size: 12.5px;
      }
      .youniumWarnings strong {
        color: var(--bad); font-weight: 600; font-size: 11px;
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      .youniumWarnings ul { margin: 6px 0 0; padding-left: 18px; }
      .youniumWarnings li { margin-bottom: 3px; color: var(--text); }
      .youniumWarnings li::marker { color: var(--bad); }
      .youniumRelatedRow {
        padding: 8px 10px; margin-top: 6px; border: 1px solid var(--hairline);
        border-radius: 8px; font-size: 12.5px; line-height: 1.4;
      }
      .youniumRelatedRow:first-of-type { margin-top: 4px; }
      .youniumRelatedRow a { color: var(--accent); font-weight: 600; text-decoration: none; }
      .youniumRelatedRow a:hover { text-decoration: underline; }
      .youniumRelatedMeta { color: var(--muted2); font-size: 11px; margin-top: 3px; }
      .youniumRelatedHead {
        display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px;
        cursor: pointer; user-select: none;
      }
      .youniumRelatedToggle {
        appearance: none; background: none; border: none; color: var(--muted2);
        cursor: pointer; font-size: 11px; line-height: 1; padding: 0; width: 12px;
        flex: 0 0 auto; transition: transform .12s ease;
      }
      .youniumRelatedRow[data-expanded="1"] .youniumRelatedToggle { transform: rotate(90deg); }
      .youniumRelatedHead:hover .youniumRelatedToggle { color: var(--text); }
      .youniumRelatedDetail { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--hairline); }
      .youniumRelatedDetail .youniumKV { margin: 0; }
      .youniumRelatedLoading, .youniumRelatedError { font-size: 11.5px; color: var(--muted2); padding: 2px 0; }
      .youniumRelatedError { color: var(--bad); }
      .youniumSubBadge {
        display: inline-flex; align-items: center; gap: 6px; margin-left: 8px;
        padding: 2px 8px 2px 7px; border-radius: 4px; font-size: 10.5px;
        font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
        vertical-align: middle; background: var(--surface-2);
        border: 1px solid var(--hairline); color: var(--muted); --badge-dot: var(--muted2);
      }
      .youniumSubBadge::before {
        content: ""; width: 6px; height: 6px; border-radius: 50%;
        background: var(--badge-dot); flex-shrink: 0;
      }
      .youniumSubBadge-green  { --badge-dot: var(--good); }
      .youniumSubBadge-red    { --badge-dot: var(--bad); }
      .youniumSubBadge-yellow { --badge-dot: var(--warn); }
      .youniumSubBadge-gray   { --badge-dot: var(--muted2); }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureDialog() {
    if (document.getElementById("dlgYouniumStatus")) return;
    injectStyles();
    const dlg = document.createElement("dialog");
    dlg.id = "dlgYouniumStatus";
    dlg.className = "dlgYouniumStatus";
    dlg.setAttribute("aria-labelledby", "dlgYouniumStatusTitle");
    dlg.innerHTML =
      '<div class="dlgYouniumStatusHd">' +
        '<strong id="dlgYouniumStatusTitle">Younium status details</strong>' +
        '<span class="dlgYouniumStatusXBtn" id="closeYouniumHintTop" role="button" tabindex="0" aria-label="Close" title="Close">✕</span>' +
      '</div>' +
      '<div class="dlgYouniumStatusBody" id="dlgYouniumStatusBody"></div>' +
      '<div class="dlgYouniumStatusFooter" id="dlgYouniumStatusFooter">' +
        '<button class="ynBtn" type="button" id="btnYouniumStatusRefresh">Refresh status</button>' +
        '<button class="ynBtn" type="button" id="btnYouniumStatusCopy">Copy summary</button>' +
        '<a class="ynBtn" id="btnYouniumStatusOpenOrder" target="_blank" rel="noopener noreferrer" style="display:none;">Open Younium order ↗</a>' +
        '<a class="ynBtn" id="btnYouniumStatusOpenYouniumSub" target="_blank" rel="noopener noreferrer" style="display:none;">Open Younium subscription ↗</a>' +
      '</div>';
    document.body.appendChild(dlg);

    els.dlgYouniumStatus = dlg;
    els.dlgYouniumStatusBody = dlg.querySelector("#dlgYouniumStatusBody");
    els.dlgYouniumStatusTitle = dlg.querySelector("#dlgYouniumStatusTitle");
    els.btnYouniumStatusRefresh = dlg.querySelector("#btnYouniumStatusRefresh");
    els.btnYouniumStatusCopy = dlg.querySelector("#btnYouniumStatusCopy");
    els.btnYouniumStatusOpenOrder = dlg.querySelector("#btnYouniumStatusOpenOrder");
    els.btnYouniumStatusOpenYouniumSub = dlg.querySelector("#btnYouniumStatusOpenYouniumSub");

    // ── Close handlers ──
    dlg.querySelector("#closeYouniumHintTop").addEventListener("click", () => forceCloseYouniumDialog());
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest("#closeYouniumHintTop") && dlg.open) forceCloseYouniumDialog();
    }, true);
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg && dlg.open) forceCloseYouniumDialog(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && dlg.open) forceCloseYouniumDialog(); }, true);

    // ── Refresh ──
    els.btnYouniumStatusRefresh.addEventListener("click", async () => {
      const p = currentYouniumStatusProject;
      if (!p || !p.plantId) return;
      verdictCache.delete(p.plantId);
      inflightPlants.delete(p.plantId);
      ynSessionUnavailable = false;
      const gen = ++ynRenderGen;
      setButtonState("gray", "Younium", true);
      els.dlgYouniumStatusBody.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-style:italic;">Refreshing…</div>';
      try {
        const fresh = await computeForPlant(p.plantId, p.name);
        if (gen !== ynRenderGen || !els.dlgYouniumStatus.open) return;
        renderYouniumStatusModalBody(fresh, gen);
      } catch (e) {
        if (gen !== ynRenderGen) return;
        els.dlgYouniumStatusBody.innerHTML = '<div class="youniumWarnings">Refresh failed: ' + escHtml(e?.message ?? e) + '</div>';
        setButtonState("gray", "Younium");
      }
    });

    // ── Copy summary ──
    els.btnYouniumStatusCopy.addEventListener("click", async () => {
      const p = currentYouniumStatusProject, v = currentYouniumStatusVerdict;
      if (!p || !v) return;
      const lines = [
        "Younium status — " + p.name,
        "Verdict: " + (v.label || "?"),
        "Order / offer: " + (v.orderStatus || "?"),
        "Subscription: " + (v.subscriptionStatus || "?"),
        "Order number: " + (v.orderNumber || "?"),
        "Last checked: " + (v.lastCheckedAt ? new Date(v.lastCheckedAt).toLocaleString(UI_LOCALE) : "?"),
        "Younium URL: " + (v.links?.saved || "(none)"),
      ];
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        els.btnYouniumStatusCopy.textContent = "Copied ✓";
        setTimeout(() => { els.btnYouniumStatusCopy.textContent = "Copy summary"; }, 1500);
      } catch (_) {}
    });

    // Emergency console escape hatch.
    try {
      window.closeYouniumModal = function closeYouniumModal() {
        const d = document.getElementById("dlgYouniumStatus");
        if (!d) return "Younium modal not found";
        if (!d.open) return "Already closed";
        d.close(); return "Closed";
      };
    } catch (_) {}
  }

  function forceCloseYouniumDialog() {
    const dlg = els.dlgYouniumStatus || document.getElementById("dlgYouniumStatus");
    if (!dlg) return;
    try { dlg.close(); } catch (_) {}
    try { dlg.removeAttribute("open"); } catch (_) {}
  }

  // Set the nav button's color tint + label text (the logo stays put).
  function setButtonState(color, label, loading) {
    const btn = document.getElementById("ynNavBtn");
    if (!btn) return;
    btn.classList.remove("yn-green", "yn-yellow", "yn-red", "yn-gray");
    btn.classList.add("yn-" + (color || "gray"));
    btn.classList.toggle("yn-loading", !!loading);
    const el = btn.querySelector(".ynNavBtnLabel");
    if (el) el.textContent = label || "Younium";
    btn.title = loading
      ? "Checking Younium status…"
      : ((label && label !== "Younium" ? label : "Younium status") + " — click for details");
  }

  // Read the current project's name + plant ID from the page.
  function getPlantContext() {
    const name = readProjectName();
    return { name, plantId: extractPlantIdFromProjectName(name) };
  }

  // Compute (or reuse) the verdict for a plant, deduping concurrent calls and
  // caching the result for the session.
  function computeForPlant(plantId, name) {
    if (verdictCache.has(plantId)) return Promise.resolve(verdictCache.get(plantId));
    if (inflightPlants.has(plantId)) return inflightPlants.get(plantId);
    const pr = computeYouniumStatusByPlantId(plantId, name)
      .then((v) => { verdictCache.set(plantId, v); inflightPlants.delete(plantId); return v; })
      .catch((e) => { inflightPlants.delete(plantId); throw e; });
    inflightPlants.set(plantId, pr);
    return pr;
  }

  // Paint a computed verdict onto the nav button — but only if the button still
  // reflects this plant (guards against a stale compute from a previous project).
  function applyVerdictToButton(plantId, verdict) {
    const btn = document.getElementById("ynNavBtn");
    if (!btn || btn.dataset.plantId !== plantId) return;
    setButtonState(verdict?.color || "gray", verdict?.label || "Younium");
  }

  // Keep the nav button in sync with whichever project is open. Called on
  // injection and on SPA route changes. Auto-computes the verdict in the
  // background (once per plant per session) so the status shows without a click.
  function refreshButtonForCurrentProject() {
    const btn = document.getElementById("ynNavBtn");
    if (!btn) return;
    const { name, plantId } = getPlantContext();
    if (btn.dataset.plantId === (plantId || "")) return; // already reflecting this plant
    btn.dataset.plantId = plantId || "";

    if (!plantId) { setButtonState("gray", "Younium"); btn.title = "No plant ID in the project name"; return; }
    if (verdictCache.has(plantId)) { applyVerdictToButton(plantId, verdictCache.get(plantId)); return; }
    if (ynSessionUnavailable) { setButtonState("gray", "Younium"); btn.title = "Younium not connected — open younium.com once while logged in, then reload"; return; }

    setButtonState("gray", "Younium", true);
    computeForPlant(plantId, name).then((v) => {
      applyVerdictToButton(plantId, v);
    }).catch((e) => {
      const b = document.getElementById("ynNavBtn");
      if (b && b.dataset.plantId === plantId) {
        setButtonState("gray", "Younium");
        b.title = "Younium status unavailable — open younium.com once while logged in, then reload (or click to retry)";
      }
      if (/session expired|session is missing|Younium session/i.test(String(e?.message || ""))) ynSessionUnavailable = true;
    });
  }

  function renderYouniumStatusModalBody(verdict, gen) {
    const p = currentYouniumStatusProject;
    if (!p) return;
    currentYouniumStatusVerdict = verdict;
    if (p.plantId) { verdictCache.set(p.plantId, verdict); applyVerdictToButton(p.plantId, verdict); }
    if (typeof gen === "number") els.dlgYouniumStatusBody.dataset.gen = String(gen);

    const order = verdict?.raw?.order || null;
    const invoices = verdict?.raw?.invoices || [];
    const quote = verdict?.raw?.quote || null;
    const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(UI_LOCALE) : "—";
    const fmtDateOnly = (iso) => iso ? new Date(iso).toLocaleDateString(UI_LOCALE) : "—";

    const orderLink = p.youniumUrl || (verdict.links && verdict.links.saved) || "";
    const allWarnings = [...(verdict.problems || [])];

    // ── Summary header text ──
    let summaryText;
    const subStatus = verdict.subscriptionStatus || "";
    if (verdict.color === "green" && verdict.hasSubscriptionProduct) {
      summaryText = "All good — Order is Invoiced and Subscription is Active.";
    } else if (verdict.color === "green") {
      summaryText = "All good — Order is Invoiced (one-time sale, no subscription).";
    } else if (verdict.color === "red" && verdict.hasSubscriptionProduct && subStatus.startsWith("Draft")) {
      summaryText = "Action needed: Subscription is in Draft state. Activate it in Younium to start invoicing.";
    } else if (verdict.color === "red" && verdict.hasSubscriptionProduct && subStatus.startsWith("Created")) {
      summaryText = "Action needed: Subscription is not finalized. Finalize and activate it in Younium.";
    } else if (verdict.color === "red" && verdict.orderStatus.startsWith("Draft")) {
      summaryText = "Action needed: Order is in Draft state. Activate it in Younium.";
    } else if (verdict.color === "red" && verdict.orderStatus === "Created (not finalized)") {
      summaryText = "Action needed: Order is not finalized in Younium.";
    } else if (verdict.color === "red" && verdict.orderStatus === "Cancelled") {
      summaryText = "Cancelled — Order was cancelled on " + (order?.cancellationDate || "").slice(0, 10) + ".";
    } else if (verdict.color === "red" && verdict.orderStatus === "Expired") {
      summaryText = "Expired — Order ended " + (order?.effectiveEndDate || "").slice(0, 10) + " and is not auto-renewing.";
    } else if (verdict.color === "red" && verdict.hasSubscriptionProduct) {
      summaryText = "Action needed: Subscription is " + subStatus + " — should be Active.";
    } else if (verdict.color === "red") {
      summaryText = "Action needed: " + (verdict.label?.replace(/^Younium:\s*[✗⚠✓]?\s*/, "") || "Younium needs attention.");
    } else if (verdict.color === "yellow" && verdict.deliveryStatus === "Partially delivered") {
      summaryText = "Partially delivered — the order isn't fully delivered in Younium yet (invoice + subscription otherwise fine).";
    } else if (verdict.color === "yellow" && verdict.orderStatus === "Invoiced") {
      summaryText = "Pending — Order is Invoiced, waiting for Subscription to become Active.";
    } else if (verdict.color === "yellow" && verdict.orderStatus === "Order (not invoiced)") {
      summaryText = "Pending — Order hasn't been invoiced yet.";
    } else if (verdict.color === "yellow" && verdict.orderStatus === "Order (pending start)") {
      summaryText = "Pending — Subscription starts " + (order?.effectiveStartDate || "").slice(0, 10) + ".";
    } else if (verdict.color === "yellow") {
      summaryText = "Pending — " + (verdict.label?.replace(/^Younium:\s*[✗⚠✓]?\s*/, "") || "status uncertain.");
    } else {
      summaryText = "No Younium order was found for this plant.";
    }

    const orderTotal = order ? (order.tcv?.amount || order.acv?.amount || order.fmrr?.amount || "—") : "—";
    const orderCurrency = order ? (order.tcv?.currencyCode || order.acv?.currencyCode || order.fmrr?.currencyCode || order.currency || "—") : "—";
    const orderName = order ? (order.description || order.orderNumber || verdict.orderNumber || "—") : (quote?.description || quote?.number || "—");

    const displayOrderStatus = verdict.deliveryStatus || verdict.orderStatus;
    const orderIsGood = displayOrderStatus === "Invoiced" || displayOrderStatus === "Delivered";
    const orderIsBad = ["Cancelled", "Expired"].includes(displayOrderStatus) || displayOrderStatus.startsWith("Draft") || displayOrderStatus.startsWith("Created");
    const orderStatusColor = orderIsGood ? "var(--good)" : (orderIsBad ? "var(--bad)" : "var(--warn)");
    const orderHasPostedInvoices = invoices.length > 0 && invoices.some(i => i.status === 3 || i.posted);
    const invoiceStatusColor = orderHasPostedInvoices ? "var(--good)" : (invoices.length === 0 ? "var(--bad)" : "var(--warn)");
    const orderBadgeClass = orderIsGood ? "youniumSubBadge-green" : (orderIsBad ? "youniumSubBadge-red" : "youniumSubBadge-yellow");

    const RAW = (h) => ({ __html: String(h) });

    const renderEvent = (ev) => {
      if (!ev || !ev.user) return null;
      let val = escHtml(String(ev.user));
      if (ev.timestamp) {
        val += ' <span style="color: var(--muted2); font-size: 11px; font-style: italic;">on ' +
               escHtml(new Date(ev.timestamp).toLocaleString(UI_LOCALE)) + '</span>';
      }
      if (ev.description) {
        val += '<br><span style="color: var(--muted); font-size: 11px;">' + escHtml(String(ev.description)) + '</span>';
      }
      return RAW(val);
    };

    const orderKV = [
      ["Younium link", RAW(orderLink
        ? '<a href="' + escHtml(toHttpUrl(orderLink) || "#") + '" target="_blank" rel="noopener noreferrer">' + escHtml(orderLink) + "</a>"
        : '<em style="color: var(--muted);">none</em>')],
      ["Order ID", order?.id || quote?.id || "—"],
      ["Order number", verdict.orderNumber],
      ["Order name", orderName],
      ["Order status", RAW('<strong style="color: ' + orderStatusColor + ';">' + (orderIsGood ? "✓ " : "") + escHtml(displayOrderStatus) + '</strong>')],
      ["Invoice status", orderIsBad ? null : RAW(invoices.length
        ? '<strong style="color: ' + invoiceStatusColor + ';">' + (orderHasPostedInvoices ? "✓ " : "") +
          (orderHasPostedInvoices ? "Posted/paid (" + invoices.length + ")" : "Drafted (" + invoices.length + ")") + '</strong>'
        : '<strong style="color: ' + invoiceStatusColor + ';">No invoices yet</strong>')],
      ["Total amount", orderTotal !== "—" ? orderTotal + " " + orderCurrency : "—"],
      ["Currency", orderCurrency],
      ["Created date", fmtDate(order?.created)],
      ["Updated date", fmtDate(order?.modified || order?.modifiedWithDependencies)],
      ["Created by", renderEvent(verdict.orderCreatedEvent)],
      ["Last updated by", renderEvent(verdict.orderLatestEvent)],
    ];

    const subOrder = verdict.subscriptionOrder || null;
    const subActive = verdict.subscriptionStatus === "Active";
    const subStatusBadgeColor = subActive ? "var(--good)" : "var(--bad)";
    const subOrderLink = subOrder?.id ? ynOrderUrl(subOrder.id) : null;
    const subscriptionKV = verdict.hasSubscriptionProduct
      ? [
          ["Younium link", RAW(subOrderLink
            ? '<a href="' + escHtml(toHttpUrl(subOrderLink) || "#") + '" target="_blank" rel="noopener noreferrer">' + escHtml(subOrderLink) + '</a>'
            : '<em style="color: var(--muted);">none</em>')],
          ["Order ID", subOrder?.id || "—"],
          ["Order number", RAW(subOrder?.orderNumber
            ? escHtml(String(subOrder.orderNumber))
            : '<strong style="color: var(--bad);">— (no number assigned → Draft)</strong>')],
          ["Subscription status", RAW('<strong style="color: ' + subStatusBadgeColor + ';">' + escHtml(verdict.subscriptionStatus) + '</strong>')],
          ["Start date", fmtDateOnly(subOrder?.effectiveStartDate)],
          ["End date", fmtDateOnly(subOrder?.effectiveEndDate)],
          ["Cancellation date", subOrder?.cancellationDate ? fmtDateOnly(subOrder.cancellationDate) : "—"],
          ["Auto-renew", subOrder?.isAutoRenewed ? "Yes" : "No"],
          ["Renewed", subOrder?.isRenewed ? "Yes" : "No"],
          ["Latest version", subOrder?.isLastVersion ? "Yes" : "No"],
          ["Term (months)", subOrder?.term ?? "—"],
          ["Created date", fmtDate(subOrder?.created)],
          ["Updated date", fmtDate(subOrder?.modified || subOrder?.modifiedWithDependencies)],
          ["Created by", renderEvent(verdict.subscriptionCreatedEvent)],
          ["Last updated by", renderEvent(verdict.subscriptionLatestEvent)],
        ]
      : [
          ["Note", "No order with IWMAC Abonnement / Subscription product found for this plant_id. This may be a one-time sale, or the plant_id custom field isn't set on the subscription order in Younium."],
        ];

    const renderKV = (rows) =>
      '<dl class="youniumKV">' +
      rows
        .filter(([k, v]) => v !== "" && v !== null && v !== undefined)
        .map(([k, v]) => {
          const cell = (v && typeof v === "object" && "__html" in v) ? v.__html : escHtml(String(v));
          return '<dt>' + escHtml(k) + '</dt><dd>' + cell + '</dd>';
        })
        .join("") +
      '</dl>';

    const renderRelatedDetail = (o, invoices2, events) => {
      const inv = Array.isArray(invoices2) ? invoices2 : [];
      const postedInvoices = inv.filter((i) => i && (i.status === 3 || i.status === 2 || i.posted));
      const now = Date.now();
      const tsStart = o.effectiveStartDate ? Date.parse(o.effectiveStartDate) : NaN;
      const tsEnd = o.effectiveEndDate ? Date.parse(o.effectiveEndDate) : NaN;
      const tsCancelled = o.cancellationDate ? Date.parse(o.cancellationDate) : NaN;
      const isCancelled = Number.isFinite(tsCancelled) && tsCancelled <= now;
      const isExpired = Number.isFinite(tsEnd) && tsEnd <= now && !o.isAutoRenewed && !o.isRenewed;
      const startsInFuture = Number.isFinite(tsStart) && tsStart > now;
      const isRawDraft = o.status === 5;
      const isRawCreated = o.status === 1;
      let statusLbl;
      if (isCancelled) statusLbl = "Cancelled";
      else if (isExpired) statusLbl = "Expired";
      else if (isRawDraft) statusLbl = "Draft";
      else if (isRawCreated) statusLbl = "Created (not finalized)";
      else if (postedInvoices.length) statusLbl = "Invoiced";
      else if (startsInFuture) statusLbl = "Order (pending start)";
      else if (o.isLastVersion) statusLbl = "Order (not invoiced)";
      else statusLbl = "Draft (outdated version)";
      const isInvoiced = statusLbl === "Invoiced";
      const isBad = ["Cancelled", "Expired"].includes(statusLbl) || statusLbl.startsWith("Draft") || statusLbl.startsWith("Created");
      const statusColor = isInvoiced ? "var(--good)" : (isBad ? "var(--bad)" : "var(--warn)");
      const total = o?.tcv?.amount ?? o?.acv?.amount ?? o?.fmrr?.amount ?? null;
      const ccy = o?.tcv?.currencyCode || o?.acv?.currencyCode || o?.fmrr?.currencyCode || o?.currency || "—";
      const orderName2 = o.description || o.orderNumber || "—";
      const link = o.id ? ynOrderUrl(o.id) : "";
      return renderKV([
        ["Younium link", RAW(link
          ? '<a href="' + escHtml(toHttpUrl(link) || "#") + '" target="_blank" rel="noopener noreferrer">' + escHtml(link) + '</a>'
          : '<em style="color: var(--muted);">none</em>')],
        ["Order ID", o.id || "—"],
        ["Order number", o.orderNumber || "Draft"],
        ["Order name", orderName2],
        ["Order status", RAW('<strong style="color: ' + statusColor + ';">' + (isInvoiced ? "✓ " : "") + escHtml(statusLbl) + '</strong>')],
        ["Invoice status", isBad ? null : RAW(inv.length
          ? '<strong style="color: ' + (postedInvoices.length ? "var(--good)" : "var(--warn)") + ';">' +
            (postedInvoices.length ? "✓ Posted/paid (" + inv.length + ")" : "Drafted (" + inv.length + ")") + '</strong>'
          : '<strong style="color: var(--bad);">No invoices yet</strong>')],
        ["Total amount", (total != null && total !== "") ? total + " " + ccy : "—"],
        ["Currency", ccy],
        ["Created date", fmtDate(o?.created)],
        ["Updated date", fmtDate(o?.modified || o?.modifiedWithDependencies)],
        ["Created by", renderEvent(extractFirstEvent(events))],
        ["Last updated by", renderEvent(extractLatestEvent(events))],
      ]);
    };

    const toggleRelatedRow = async (rowEl) => {
      const detail = rowEl.querySelector(".youniumRelatedDetail");
      const toggle = rowEl.querySelector(".youniumRelatedToggle");
      if (!detail) return;
      const opening = detail.hidden;
      detail.hidden = !opening;
      rowEl.setAttribute("data-expanded", opening ? "1" : "0");
      if (toggle) toggle.setAttribute("aria-expanded", String(opening));
      if (!opening || detail.dataset.loaded === "1") return;
      const id = rowEl.getAttribute("data-order-id");
      const orderNumber = rowEl.getAttribute("data-order-number");
      if (!id) { detail.innerHTML = '<div class="youniumRelatedError">No order id available.</div>'; return; }
      detail.innerHTML = '<div class="youniumRelatedLoading">Loading order details…</div>';
      try {
        const full = await youniumFetchOrderDetails(id);
        const onum = orderNumber || (full && full.orderNumber) || "";
        const [inv, events] = await Promise.all([
          onum ? youniumFetchInvoicesForOrder(onum).catch(() => []) : Promise.resolve([]),
          youniumFetchOrderEventLog(id).catch(() => []),
        ]);
        detail.innerHTML = renderRelatedDetail(full || {}, inv, events);
        detail.dataset.loaded = "1";
      } catch (e) {
        detail.innerHTML = '<div class="youniumRelatedError">Could not load details: ' + escHtml(String(e?.message ?? e)) + '</div>';
      }
    };

    els.dlgYouniumStatusBody.innerHTML =
      '<div class="youniumSummary youniumStatus-' + verdict.color + '">' + escHtml(summaryText) + '</div>' +
      (allWarnings.length
        ? '<div class="youniumWarnings"><strong>Warnings</strong><ul>' + allWarnings.map((w) => '<li>' + escHtml(w) + '</li>').join("") + '</ul></div>'
        : "") +
      '<div class="youniumSection">' +
        '<div class="youniumSectionTitle">Order / offer' +
          ' <span class="youniumSubBadge ' + orderBadgeClass + '">' + escHtml(displayOrderStatus) + '</span>' +
        '</div>' + renderKV(orderKV) +
      '</div>' +
      '<div class="youniumSection youniumSubSection">' +
        '<div class="youniumSectionTitle">Subscription' +
          (verdict.hasSubscriptionProduct
            ? ' <span class="youniumSubBadge youniumSubBadge-' + (subActive ? "green" : "red") + '">' + escHtml(verdict.subscriptionStatus) + '</span>'
            : ' <span class="youniumSubBadge youniumSubBadge-gray">none</span>') +
        '</div>' + renderKV(subscriptionKV) +
      '</div>' +
      (function () {
        const all = verdict.relatedOrders || [];
        if (!all.length) return "";
        const primaryId = order?.id;
        const subId = verdict.subscriptionOrder?.id;
        const primaryNum = String(order?.orderNumber || "").trim();
        const subNum = String(verdict.subscriptionOrder?.orderNumber || "").trim();
        const others = all.filter((o) => {
          if (o.id === primaryId || o.id === subId) return false;
          const num = String(o.orderNumber || "").trim();
          if (num && (num === primaryNum || num === subNum)) return false;
          return true;
        });
        if (!others.length) return "";
        others.sort((a, b) => {
          const ta = Date.parse(a.effectiveStartDate || a.created || "") || 0;
          const tb = Date.parse(b.effectiveStartDate || b.created || "") || 0;
          return tb - ta;
        });
        const rows = others.map((o) => {
          const num = o.orderNumber || "Draft";
          const desc = o.description ? " — " + escHtml(o.description) : "";
          const start = o.effectiveStartDate ? fmtDateOnly(o.effectiveStartDate) : "—";
          const end = o.effectiveEndDate ? fmtDateOnly(o.effectiveEndDate) : "—";
          const statusText = youniumRelatedOrderStatusLabel(o, null);
          const needsInvoiceCheck = statusText === "Active";
          const url = ynOrderUrl(o.id);
          return '<div class="youniumRelatedRow" data-order-id="' + escHtml(String(o.id || "")) + '" data-order-number="' + escHtml(String(o.orderNumber || "")) + '"' + (needsInvoiceCheck ? ' data-needs-invoice-check="1"' : "") + '>' +
            '<div class="youniumRelatedHead" title="Click for full order details">' +
              '<button type="button" class="youniumRelatedToggle" aria-label="Toggle order details" aria-expanded="false">▸</button>' +
              '<a href="' + escHtml(toHttpUrl(url) || "#") + '" target="_blank" rel="noopener noreferrer">' + escHtml(num) + '</a>' +
              ' <span class="youniumSubBadge ' + youniumRelatedOrderBadgeClass(statusText) + '">' + escHtml(statusText) + '</span>' + desc +
            '</div>' +
            '<div class="youniumRelatedMeta">Start ' + escHtml(start) + ' · End ' + escHtml(end) + '</div>' +
            '<div class="youniumRelatedDetail" hidden></div>' +
          '</div>';
        }).join("");
        return '<div class="youniumSection">' +
          '<div class="youniumSectionTitle">Other orders for this plant ' +
            '<span class="youniumSubBadge youniumSubBadge-gray">' + others.length + '</span>' +
          '</div>' + rows +
        '</div>';
      })();

    // Wire click-to-expand on each "Other orders" row.
    els.dlgYouniumStatusBody.querySelectorAll(".youniumRelatedRow[data-order-id]").forEach((rowEl) => {
      const head = rowEl.querySelector(".youniumRelatedHead");
      const link = rowEl.querySelector(".youniumRelatedHead a");
      if (link) link.addEventListener("click", (ev) => ev.stopPropagation());
      if (head) head.addEventListener("click", () => { void toggleRelatedRow(rowEl); });
    });

    // Refine "Other orders" badges from lifecycle state to real invoice status.
    const refineGen = els.dlgYouniumStatusBody.dataset.gen;
    els.dlgYouniumStatusBody.querySelectorAll('.youniumRelatedRow[data-needs-invoice-check="1"]').forEach(async (rowEl) => {
      const id = rowEl.getAttribute("data-order-id");
      const num = rowEl.getAttribute("data-order-number");
      const o = (verdict.relatedOrders || []).find((x) => String(x.id || "") === id);
      const badge = rowEl.querySelector(".youniumSubBadge");
      if (!o || !num || !badge) return;
      try {
        const inv = await youniumFetchInvoicesForOrder(num);
        if (els.dlgYouniumStatusBody.dataset.gen !== refineGen) return; // a newer render replaced the body
        const posted = (inv || []).filter(youniumInvoiceIsPosted).length;
        const label = youniumRelatedOrderStatusLabel(o, posted);
        badge.textContent = label;
        badge.className = "youniumSubBadge " + youniumRelatedOrderBadgeClass(label);
        rowEl.removeAttribute("data-needs-invoice-check");
      } catch (_) {}
    });

    // Footer action buttons.
    if (orderLink) {
      els.btnYouniumStatusOpenOrder.href = toHttpUrl(orderLink) || "#";
      els.btnYouniumStatusOpenOrder.style.display = "";
    } else {
      els.btnYouniumStatusOpenOrder.style.display = "none";
    }
    if (els.btnYouniumStatusOpenYouniumSub) {
      if (subOrderLink && verdict.subscriptionOrderIsSeparate) {
        els.btnYouniumStatusOpenYouniumSub.href = toHttpUrl(subOrderLink) || "#";
        els.btnYouniumStatusOpenYouniumSub.style.display = "";
      } else {
        els.btnYouniumStatusOpenYouniumSub.style.display = "none";
      }
    }
    if (els.dlgYouniumStatusTitle) els.dlgYouniumStatusTitle.textContent = "Younium status details · " + p.name;
  }

  // Read the current project's name → "10112 - Bunnpris Betna: Ny Butikk".
  function readProjectName() {
    let t = (document.title || "").trim().replace(/\s*[-–|]\s*Kiona\s*$/i, "").trim();
    if (/^\d{2,7}\s*[-–]\s+/.test(t)) return t;
    // Fallback: scan the DOM for a node whose text matches the plant pattern.
    const nodes = document.querySelectorAll("h1, h2, h3, a, span, div");
    for (const el of nodes) {
      const txt = (el.textContent || "").trim();
      if (/^\d{2,7}\s*[-–]\s+\S/.test(txt) && txt.length < 100) return txt;
    }
    return t || null;
  }

  async function openYouniumStatusModal() {
    ensureDialog();
    ynSessionUnavailable = false; // user explicitly asked — retry even if a prior auto-compute failed
    const { name, plantId } = getPlantContext();
    currentYouniumStatusProject = { name: name || "(unknown project)", plantId, youniumUrl: "", oneflowSubscriptionUrl: "" };
    currentYouniumStatusVerdict = null;
    const gen = ++ynRenderGen;

    els.btnYouniumStatusOpenOrder.style.display = "none";
    els.btnYouniumStatusOpenYouniumSub.style.display = "none";
    els.dlgYouniumStatusTitle.textContent = "Younium status details · " + currentYouniumStatusProject.name;
    els.dlgYouniumStatus.showModal();

    if (!plantId) {
      els.dlgYouniumStatusBody.innerHTML =
        '<div class="youniumWarnings"><strong>Warnings</strong><ul><li>Couldn\'t read a plant ID from the project name (' +
        escHtml(currentYouniumStatusProject.name) + '). Younium lookups need a project named like "10112 - …".</li></ul></div>';
      return;
    }

    // Instant render from the session cache (the background auto-compute usually
    // already ran on page load); otherwise show a spinner and compute.
    if (verdictCache.has(plantId)) { renderYouniumStatusModalBody(verdictCache.get(plantId), gen); return; }
    els.dlgYouniumStatusBody.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-style:italic;">Checking Younium…</div>';
    setButtonState("gray", "Younium", true);
    try {
      const verdict = await computeForPlant(plantId, name);
      if (gen !== ynRenderGen || !els.dlgYouniumStatus.open) return; // superseded by a newer open/refresh
      renderYouniumStatusModalBody(verdict, gen);
    } catch (e) {
      if (gen !== ynRenderGen) return;
      els.dlgYouniumStatusBody.innerHTML = '<div class="youniumWarnings">Error checking Younium status: ' + escHtml(e?.message ?? e) + '</div>';
      setButtonState("gray", "Younium");
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. Nav-button injection.
  // ════════════════════════════════════════════════════════════════════════

  function getNavRow() {
    const direct = document.querySelector('[class*="TabsWrapperDefault-"]');
    if (direct) return direct;
    // Fallback if Rocketlane rehashes that class: find the "All files" tab/link
    // and walk up to the row that holds the sibling tab cells.
    const anchor =
      Array.from(document.querySelectorAll('a[href*="/projects/"][href$="/files"]'))[0] ||
      Array.from(document.querySelectorAll('[class*="TabWrapper-"]')).find((c) => {
        const t = (c.textContent || "").trim();
        return t === "All files" || t === "Alle filer";
      });
    if (!anchor) return null;
    const cell = anchor.closest('[class*="TabWrapper-"]') || anchor;
    const parent = cell.parentElement;
    if (parent && parent.querySelectorAll('[class*="TabWrapper-"]').length >= 2) return parent;
    return parent || null;
  }
  function getAllFilesCell(row) {
    const cells = Array.from(row.querySelectorAll(':scope > [class*="TabWrapper-"]'));
    return cells.find((c) => {
      const t = (c.textContent || "").trim();
      if (t === "All files" || t === "Alle filer") return true;
      return !!c.querySelector('a[href$="/files"]');
    }) || null;
  }
  function buildNavButton() {
    const wrap = document.createElement("div");
    wrap.className = "ynNavBtnCell";
    const btn = document.createElement("button");
    btn.id = "ynNavBtn";
    btn.type = "button";
    btn.className = "ynNavBtn yn-gray";
    btn.title = "Younium status — click for details";
    const logo = document.createElement("img");
    logo.className = "ynNavBtnLogo";
    logo.src = YOUNIUM_LOGO_URL;
    logo.alt = "Younium";
    logo.decoding = "async";
    logo.addEventListener("error", () => { logo.style.display = "none"; }); // graceful fallback if the asset is unreachable
    const label = document.createElement("span");
    label.className = "ynNavBtnLabel";
    label.textContent = "Younium";
    const spinner = document.createElement("span");
    spinner.className = "ynNavBtnSpinner";
    spinner.setAttribute("aria-hidden", "true");
    btn.appendChild(logo);
    btn.appendChild(label);
    btn.appendChild(spinner);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (els.dlgYouniumStatus?.open) forceCloseYouniumDialog();
      else openYouniumStatusModal();
    });
    wrap.appendChild(btn);
    return wrap;
  }
  // Inject the button if missing, then sync it to the current project. Idempotent.
  function ensure() {
    if (!/^\/projects\/\d+/.test(location.pathname)) return; // only on project pages
    injectStyles();
    if (!document.getElementById("ynNavBtn")) {
      const row = getNavRow();
      if (!row) return;
      const cell = buildNavButton();
      const allFiles = getAllFilesCell(row);
      row.insertBefore(cell, allFiles ? allFiles.nextSibling : null);
    }
    refreshButtonForCurrentProject();
  }

  let ensureTimer = null;
  function scheduleEnsure() {
    // Steady-state early-out: once the button is present + connected there's
    // nothing for the mutation observer to do (route changes are handled by the
    // history hooks below), so we never schedule work on the SPA's hot path.
    const btn = document.getElementById("ynNavBtn");
    if (btn && btn.isConnected) return;
    if (ensureTimer) return;
    ensureTimer = setTimeout(() => { ensureTimer = null; try { ensure(); } catch (_) {} }, 300);
  }

  // Observe the DOM only to (re-)inject the button when it's missing — the
  // early-out above stops it from doing work once the button is in place.
  const obs = new MutationObserver(scheduleEnsure);
  try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}

  // Rocketlane is a client-routed SPA — re-evaluate on every navigation so the
  // button re-injects (if the nav was rebuilt) and re-points at the new project.
  function onRouteChange() { [60, 350, 900].forEach((d) => setTimeout(() => { try { ensure(); } catch (_) {} }, d)); }
  (function hookHistory() {
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m];
      if (typeof orig !== "function") continue;
      history[m] = function () { const r = orig.apply(this, arguments); try { onRouteChange(); } catch (_) {} return r; };
    }
    window.addEventListener("popstate", onRouteChange);
  })();

  // Initial attempts (covers the case where the nav is already present).
  ensure();
  let tries = 0;
  const boot = setInterval(() => { tries += 1; ensure(); if (document.getElementById("ynNavBtn") || tries > 40) clearInterval(boot); }, 500);
})();
