// ==UserScript==
// @name         Rocketlane improvements
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.4.2
// @description  Rocketlane improvements in one script: Younium order + subscription and Oneflow signing status chips with detail modals on project pages (same verdict engines as the Project Progress Tracker), the "Delivery to service" handover wizard on the Handover to service task card, a hideable Gantt calendar with a toggle button, a floating two-conversation chat panel on the timeline, and a writable Note column on the Projects list (toolbox SQL persistence, clickable links — off by default since v1.4.2).
// @author       hapnes-dev
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-younium-status/rocketlane-younium-status.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-younium-status/rocketlane-younium-status.user.js
// @match        https://kiona.rocketlane.com/*
// @match        https://eu.younium.com/*
// @match        https://us.younium.com/*
// @match        https://app.younium.com/*
// @match        https://iwmac.zendesk.com/*
// @connect      auth.eu.younium.com
// @connect      auth.us.younium.com
// @connect      api.younium.com
// @connect      app.oneflow.com
// @connect      kiona.api.rocketlane.com
// @connect      iwmac.zendesk.com
// @connect      toolbox.iwmac.local
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

/*
 * Rocketlane improvements
 * ───────────────────────
 * One userscript, four independent modules on kiona.rocketlane.com:
 *
 *  1. Younium status (sections 1–5 below; formerly "Rocketlane Younium Status").
 *     On younium.com pages it only captures the hublet region (eu/us) into GM
 *     storage. On Rocketlane project pages it injects a Younium chip into the
 *     project nav (right after "All files"), reads the plant ID from the project
 *     name, queries Younium directly (CORS-bypassed via GM_xmlhttpRequest using
 *     the Frontegg refresh cookie in the browser jar), computes the order +
 *     subscription verdict and shows it in a styled modal — the same verdict
 *     engine and look as the Project Progress Tracker. No tokens are stored in
 *     the page; the Bearer JWT is minted on demand and held only in GM storage
 *     with an expiry. Read-only: the modal never writes to Younium.
 *  1b. Oneflow signing status (section 5b), ported from the tracker's Oneflow
 *     status checker: an "Oneflow: …" chip right of the Younium chip and an
 *     "Oneflow status details" modal. The documents come from the links the
 *     tracker stores on the Rocketlane project (Hubspot Deal Description /
 *     Delivery status update message custom fields, read with the api-key the
 *     Rocketlane SPA keeps in localStorage) or, failing that, from an Oneflow
 *     search for the plant ID. Oneflow is called with the browser's own
 *     session cookie through GM_xmlhttpRequest. Read-only.
 *  1c. Delivery to service (section 8), ported from the tracker's handover
 *     wizard. A "Delivery to service" button on the "Handover to service" task
 *     card (right of the assignee avatar) plus a nav chip for projects that
 *     don't have the task. It walks the 16 questions of the delivery
 *     checklist, pre-filling from the project's Oneflow/Younium state, and
 *     ends by copying the macro-shaped HTML or creating the Zendesk handover
 *     ticket outright. On finish it can set the task to Completed through the
 *     Rocketlane API. On iwmac.zendesk.com pages the script only captures the
 *     CSRF token, mirroring the younium.com region capture.
 *  2. Gantt calendar + floating chat panel (section 6; formerly "Rocketlane
 *     Enhancer" v2.0). Hides the timeline half of project-plan pages behind a
 *     toggle button and mounts a two-conversation chat panel on the timeline
 *     route. Runs at document-start so the calendar never flashes.
 *  3. Project Notes column (section 7; formerly "Rocketlane Project Notes
 *     Column" v1.10.0). A writable Note column on the Projects list, persisted
 *     to the toolbox SQL API with a local fallback. Starts once the DOM is
 *     ready, as it did under its old @run-at document-idle. DISABLED since
 *     v1.4.2 — RL_NOTES_COLUMN_ENABLED gates the call; the section itself and
 *     the notes stored in the SQL table are untouched.
 *
 * The modules share nothing but the page: each keeps its own storage keys,
 * styles and observers, exactly as in the scripts they came from.
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

  // ──────────────────────────────────────────────────────────────────────────
  // Side A2 — On Zendesk: capture the CSRF token from the meta tag.
  // The session cookie rides along automatically, but state-changing requests
  // (the handover ticket POST in section 8) also need the token in an
  // X-CSRF-Token header. Same shape as the chat bridge's capture, and the same
  // deal as the Younium region above: nothing else of this script runs here.
  // ──────────────────────────────────────────────────────────────────────────
  if (/(?:^|\.)iwmac\.zendesk\.com$/i.test(location.hostname)) {
    const captureZendeskCsrf = () => {
      try {
        const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
        if (token && token !== GM_getValue("zdCsrfToken", "")) {
          GM_setValue("zdCsrfToken", token);
          GM_setValue("zdCsrfCapturedAt", Date.now());
        }
      } catch (_) {}
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", captureZendeskCsrf, { once: true });
    else captureZendeskCsrf();
    // The token rotates when Zendesk renews the session; re-reading a meta tag
    // once a minute is free.
    setInterval(captureZendeskCsrf, 60 * 1000);
    return; // never run the Rocketlane UI on Zendesk pages
  }

  // Everything below only runs on the Rocketlane tenant.
  if (location.hostname !== "kiona.rocketlane.com") return;

  // Run a callback once the DOM exists. The script now starts at
  // document-start (the Gantt module needs that); the modules that scan or
  // observe the DOM keep their old document-idle timing through this guard.
  function rlWhenDomReady(fn) {
    if (document.readyState !== "loading" && document.body) { fn(); return; }
    document.addEventListener("DOMContentLoaded", () => { try { fn(); } catch (e) { console.warn("[Rocketlane improvements]", e); } }, { once: true });
  }

  // Module 2 — Gantt calendar + floating chat panel (section 6). Immediate: it
  // installs its hide-CSS before first paint and defers its own DOM work.
  try { rlEnhancerModule(); } catch (e) { console.warn("[Rocketlane improvements] enhancer module failed", e); }
  // Module 3 — Project Notes column (section 7). Needs document.body.
  // Turned off on 2026-09-09: the "Note" column on the Projects list isn't
  // wanted. Only the invocation is gated — section 7 is left intact, and
  // nothing is removed from the toolbox SQL table, so the notes already saved
  // there are still on the server. Flip this to true to bring the column back.
  const RL_NOTES_COLUMN_ENABLED = false;
  if (RL_NOTES_COLUMN_ENABLED) {
    rlWhenDomReady(() => { try { rlProjectNotesModule(); } catch (e) { console.warn("[Rocketlane improvements] notes module failed", e); } });
  }

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
  // Younium's UI calls an order "Draft" until it assigns a real O-###### number,
  // and the status FIELD can stay 1 ("Created") after activation — so "created
  // but not finalized" is only trusted while the number still looks like a draft
  // (verified live on O-015444 / plant 10113: API status 1, UI badge "Active").
  function youniumOrderNumberLooksDraft(orderNumber) {
    const s = String(orderNumber || "").trim();
    return !s || /^draft\b/i.test(s);
  }
  // Younium's NATIVE order-header status badge, beyond the invoice-workflow
  // "Invoiced": the delivery dimension (7/8) and the payment dimension (10/11).
  // 10 = "Partially paid" verified live on O-014603; 11 = "Paid" is inferred.
  function youniumDeliveryStatusLabel(status) {
    if (status === 7)  return "Partially delivered";
    if (status === 8)  return "Delivered";
    if (status === 10) return "Partially paid";
    if (status === 11) return "Paid";
    return null;
  }
  // "Partially delivered" (7) and "Partially paid" (10) are not finished states,
  // so an otherwise-green verdict must not read "All good" — downgrade to yellow.
  // The partial-payment warning line is added by buildYouniumExtraWarnings so it
  // shows even when the verdict is red for a worse reason (e.g. a Draft sub).
  function youniumApplyPartialDeliveryDowngrade(out) {
    if (out && out.color === "green" && out.deliveryStatus === "Partially delivered") {
      out.color = "yellow";
      out.label = "Younium: ⚠ Partially delivered";
      (out.problems = out.problems || []).push(
        "Order is only Partially delivered in Younium — not fully delivered yet.",
      );
    }
    if (out && out.color === "green" && out.deliveryStatus === "Partially paid") {
      out.color = "yellow";
      out.label = "Younium: — Partially paid";
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
    // status 1 = Created ONLY while the number still looks like a draft;
    // an activated order keeps status 1 with a real O-###### number.
    if (o?.status === 1 && youniumOrderNumberLooksDraft(o?.orderNumber)) return "Created";
    const delivered = youniumDeliveryStatusLabel(o?.status); // 7/8/10/11 — Younium's header badge
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
      case "Paid":
      case "Active": return "youniumSubBadge-green";
      case "Cancelled":
      case "Draft":
      case "Outdated": return "youniumSubBadge-red";
      case "Not invoiced":
      case "Pending start":
      case "Partially delivered":
      case "Partially paid":
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

    // Promote the most-recently-modified order as the project's Order/offer —
    // but PREFER a non-subscription document for that slot. Subscription
    // agreements are named "… Abonnementsavtale" in this tenant and belong in
    // the Subscription section below, not on top. Without this, a freshly
    // activated Abonnementsavtale (newest modified) hijacked the Order/offer
    // section while the real store order sat under "Other orders" (seen on
    // plant 10113). Fall back to the newest order when the plant only has the
    // subscription agreement.
    const sorted = allOrders.slice().sort((a, b) => {
      const ta = Date.parse(a?.modified || a?.created || 0) || 0;
      const tb = Date.parse(b?.modified || b?.created || 0) || 0;
      return tb - ta;
    });
    const looksLikeSubscriptionAgreement = (o) =>
      /\babonnementsavtale\b|\bsubscription agreement\b|\bsubscription\b/i.test(String(o?.description || ""));
    const primarySummary = sorted.find((o) => !looksLikeSubscriptionAgreement(o)) || sorted[0];
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
    const subOrderNumberLooksDraft = youniumOrderNumberLooksDraft(subOrder.orderNumber);
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
    // Distinguish ISSUED (posted, real) invoices from fully-PAID ones (status 3
    // or a paymentDate) so the order can read "Paid" / "Partially paid" /
    // "Invoiced" the way Younium does — not just "Invoiced" for anything posted.
    const issuedInvoices = (invoices || []).filter((i) => i && (i.posted || i.status >= 1));
    const paidInvoices = (invoices || []).filter((i) => i && (i.status === 3 || i.paymentDate));
    out.raw.invoices = invoices;

    // ── Order status ──
    // Younium order.status enum: 1=Created, 5=Draft, 9=Active, 7/8=delivery,
    // 10=Partially paid (verified live on O-014603). Prefer Younium's own
    // payment status, then fall back to the invoice-derived paid/partial state.
    const isRawDraft = order.status === 5;
    // status 1 means "not finalized" ONLY while the order number still looks
    // like a draft. Once activated, Younium assigns a real number (O-######)
    // but the status FIELD stays 1 while the UI badge reads "Active".
    const isRawCreated = order.status === 1 && youniumOrderNumberLooksDraft(order.orderNumber);
    if (isCancelled) out.orderStatus = "Cancelled";
    else if (isRawDraft) out.orderStatus = "Draft";
    else if (isRawCreated) out.orderStatus = "Created (not finalized)";
    else if (order.status === 10) out.orderStatus = "Partially paid";
    else if (issuedInvoices.length > 0 && paidInvoices.length >= issuedInvoices.length) out.orderStatus = "Paid";
    else if (paidInvoices.length > 0) out.orderStatus = "Partially paid";
    else if (postedInvoices.length > 0) out.orderStatus = "Invoiced";
    else if (startsInFuture) out.orderStatus = "Order (pending start)";
    // Reached only by an ACTIVATED order (real number, started, latest version,
    // nothing invoiced yet) — Younium's badge calls this "Active", so mirror it.
    else if (order.isLastVersion) out.orderStatus = "Active";
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
        --accent: #7dd3fc; --accent-soft: rgba(125,211,252,0.14); --accent-stroke: rgba(125,211,252,0.36);
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
          --accent: #0284c7; --accent-soft: rgba(2,132,199,0.10); --accent-stroke: rgba(2,132,199,0.30);
        }
      }

      /* ── Nav button (sits on Rocketlane's own header) ──
         The same chip as the tracker's project-header Younium chip
         (.btn.youniumStatusBtn): padding 5px 12px · font-size 11.5px · gap 7px
         · pill radius · soft tint + matching text color, no hard border.
         Colors here are FIXED, not driven by prefers-color-scheme: the button
         lives on Rocketlane's surface, whose light/dark theme is independent of
         the OS setting (Rocketlane's header is white even when the OS is in dark
         mode). The default is the tracker's LIGHT-theme chip; .yn-on-dark
         (toggled at runtime from the detected header luminance) switches to its
         dark-theme chip. The verdict tints use the brand colors, which read on
         both. */
      .ynNavBtnCell { display: inline-flex; align-items: center; padding: 0 6px; }
      .ynNavBtn {
        display: inline-flex; align-items: center; gap: 7px;
        height: auto; min-height: 24px; padding: 5px 12px;
        font-size: 11.5px; font-weight: 500; line-height: 1.35; letter-spacing: 0.005em;
        border-radius: 999px; border: 1px solid transparent;
        background: rgba(15, 23, 42, 0.05); color: rgba(15, 23, 42, 0.66);
        white-space: nowrap; cursor: pointer; user-select: none; font-family: inherit;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
      }
      .ynNavBtn.yn-on-dark { background: rgba(255, 255, 255, 0.07); color: rgba(255, 255, 255, 0.66); }
      .ynNavBtnLogo { width: 14px; height: 14px; border-radius: 3px; display: block; flex: 0 0 auto; object-fit: contain; }
      .ynNavBtnSpinner { display: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid rgba(128, 130, 140, 0.3); border-top-color: currentColor; flex: 0 0 auto; animation: ynSpin 0.7s linear infinite; }
      .ynNavBtn.yn-loading .ynNavBtnSpinner { display: inline-block; }
      .ynNavBtn.yn-loading .ynNavBtnLabel { opacity: 0.85; }
      @keyframes ynSpin { to { transform: rotate(360deg); } }
      /* Verdict tints — soft fill + matching text color, no aggressive border
         (the tracker's .tag.good / .tag.warn / .tag.bad pattern). */
      .ynNavBtn.yn-green  { background: var(--good-soft); color: var(--good); border-color: transparent; }
      .ynNavBtn.yn-yellow { background: var(--warn-soft); color: var(--warn); border-color: transparent; }
      .ynNavBtn.yn-red    { background: var(--bad-soft);  color: var(--bad);  border-color: transparent; }
      .ynNavBtn.yn-gray   { /* chip defaults above */ }
      /* Hover lifts the chip the way the tracker's does: a brightness bump and
         a neutral fill over the tint (declared after the tints on purpose). */
      .ynNavBtn:hover { filter: brightness(1.15); background: rgba(15, 23, 42, 0.09); }
      .ynNavBtn.yn-on-dark:hover { background: rgba(255, 255, 255, 0.10); }
      .ynNavBtn.yn-gray:hover { border-color: rgba(15, 23, 42, 0.12); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
      .ynNavBtn.yn-gray.yn-on-dark:hover { border-color: rgba(255, 255, 255, 0.10); }
      .ynNavBtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

      /* ── Younium status modal (ported from the Project Progress Tracker) ── */
      dialog.dlgYouniumStatus[open] {
        margin: auto; width: min(900px, 92vw); max-height: 88vh; padding: 0;
        border: 1px solid var(--hairline-strong); border-radius: 14px;
        background: #0f1424; color: var(--text);
        box-shadow: var(--shadow-lg);
        display: flex; flex-direction: column; overflow: hidden;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
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
      .dlgYouniumStatusXBtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      @media (prefers-color-scheme: light) {
        .dlgYouniumStatusXBtn:hover { background: rgba(15,23,42,0.06); }
        .dlgYouniumStatusXBtn:active { background: rgba(15,23,42,0.12); }
      }
      .dlgYouniumStatusHd {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 16px 20px; border-bottom: 1px solid var(--hairline);
      }
      .dlgYouniumStatusHd strong { font-size: 14px; font-weight: 600; }
      .dlgYouniumStatusBody {
        padding: 16px 18px; overflow-y: auto; flex: 1 1 auto; min-height: 0;
        display: grid; gap: 14px;
      }
      .dlgYouniumStatusFooter {
        padding: 12px 18px; border-top: 1px solid var(--hairline);
        display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      }
      /* Footer actions — the tracker's .btn base (unified 34px height, subtle
         hover lift, soft focus ring), scoped so Rocketlane's own buttons are
         untouched. */
      .dlgYouniumStatusFooter .ynBtn {
        position: relative; display: inline-flex; align-items: center; gap: 6px;
        height: 34px; padding: 7px 14px; border-radius: 10px;
        font-family: inherit; font-size: 13px; font-weight: 500; line-height: 1.2; letter-spacing: 0.005em;
        white-space: nowrap; cursor: pointer; user-select: none; text-decoration: none;
        border: 1px solid var(--hairline-strong); background: var(--surface-2); color: var(--text);
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 100ms ease;
      }
      .dlgYouniumStatusFooter .ynBtn:hover { background: var(--surface-3); border-color: var(--hairline-strong); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
      .dlgYouniumStatusFooter .ynBtn:active { transform: translateY(0.5px); box-shadow: none; }
      .dlgYouniumStatusFooter .ynBtn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); border-color: var(--accent-stroke); }
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
      .youniumSummary small { display: block; font-weight: 400; font-size: 11.5px; margin-top: 4px; color: var(--muted); }
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
        '<a class="ynBtn" id="btnYouniumStatusOpenOrder" target="_blank" rel="noopener noreferrer" style="display:none;">Open Younium order</a>' +
        '<a class="ynBtn" id="btnYouniumStatusOpenYouniumSub" target="_blank" rel="noopener noreferrer" style="display:none;">Open Younium subscription</a>' +
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
        (v.problems && v.problems.length ? "Issues:\n  - " + v.problems.join("\n  - ") : ""),
      ].filter(Boolean);
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
  function setButtonState(color, label, loading, problems) {
    const btn = document.getElementById("ynNavBtn");
    if (!btn) return;
    btn.classList.remove("yn-green", "yn-yellow", "yn-red", "yn-gray");
    btn.classList.add("yn-" + (color || "gray"));
    btn.classList.toggle("yn-loading", !!loading);
    const el = btn.querySelector(".ynNavBtnLabel");
    if (el) el.textContent = label || "Younium";
    if (loading) { btn.title = "Fetching latest Younium status…"; return; }
    // Tooltip (same format as the tracker's chip): the verdict on the first
    // line, then each problem on its own line, so hovering explains WHY the
    // chip is yellow/red without opening the modal.
    const lines = [label && label !== "Younium" ? label : "Younium status"];
    if (Array.isArray(problems) && problems.length) {
      lines.push("");
      for (const p of problems) lines.push("• " + p);
    }
    lines.push("", "Click for details.");
    btn.title = lines.join("\n");
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
    setButtonState(verdict?.color || "gray", verdict?.label || "Younium", false, verdict?.problems);
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

  // Warnings beyond what the verdict engine records in `problems`. "Partially
  // paid" lives here (not only in the green→yellow downgrade) so it is visible
  // even when the verdict is red for a worse reason — e.g. an invoiced +
  // partially-paid order whose subscription is still Draft.
  function buildYouniumExtraWarnings(verdict) {
    const out = [];
    if (verdict?.deliveryStatus === "Partially paid") {
      out.push("Order is only partially paid in Younium — full payment is still outstanding.");
    }
    return out;
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
    const allWarnings = [...(verdict.problems || []), ...buildYouniumExtraWarnings(verdict)];

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
    } else if (verdict.color === "yellow" && verdict.deliveryStatus === "Partially paid") {
      summaryText = "Partially paid — the order is invoiced but not fully paid in Younium yet (subscription otherwise fine).";
    } else if (verdict.color === "yellow" && verdict.orderStatus === "Invoiced") {
      summaryText = "Pending — Order is Invoiced, waiting for Subscription to become Active.";
    } else if (verdict.color === "yellow" && (verdict.orderStatus === "Active" || verdict.orderStatus === "Order (not invoiced)")) {
      summaryText = "Pending — Order is Active in Younium, awaiting the first posted invoice.";
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
    // "Partially …" (paid / delivered) is an in-progress state, not done — it
    // reads yellow with a leading em-dash, never the green ✓. The complete
    // states "Paid" / "Delivered" / "Invoiced" and an activated "Active" order
    // stay green ✓.
    const orderIsPartial = displayOrderStatus.startsWith("Partially");
    const orderIsGood = ["Invoiced", "Delivered", "Paid", "Active"].includes(displayOrderStatus);
    const orderIsBad = ["Cancelled", "Expired"].includes(displayOrderStatus) || displayOrderStatus.startsWith("Draft") || displayOrderStatus.startsWith("Created");
    const orderStatusColor = orderIsGood ? "var(--good)" : (orderIsBad ? "var(--bad)" : "var(--warn)");
    const orderStatusPrefix = orderIsGood ? "✓ " : (orderIsPartial ? "— " : "");
    // Invoice payment rollup — how many issued invoices are actually paid, so the
    // row reads "Paid" / "Partly paid — X of N paid (Y outstanding)" / "awaiting".
    const issuedInvoiceCount = invoices.filter((i) => i && (i.posted || i.status >= 1)).length;
    const paidInvoiceCount = invoices.filter((i) => i && (i.status === 3 || i.paymentDate)).length;
    const invoiceLabel = issuedInvoiceCount === 0
      ? "No invoices yet"
      : (paidInvoiceCount >= issuedInvoiceCount ? "✓ Paid (" + issuedInvoiceCount + ")"
        : paidInvoiceCount > 0 ? "Partly paid — " + paidInvoiceCount + " of " + issuedInvoiceCount + " invoices paid (" + (issuedInvoiceCount - paidInvoiceCount) + " outstanding)"
        : "Posted, awaiting payment (" + issuedInvoiceCount + ")");
    const invoiceStatusColor = issuedInvoiceCount === 0
      ? "var(--bad)"
      : (paidInvoiceCount >= issuedInvoiceCount ? "var(--good)" : "var(--warn)");
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
      ["Order status", RAW('<strong style="color: ' + orderStatusColor + ';">' + orderStatusPrefix + escHtml(displayOrderStatus) + '</strong>')],
      ["Invoice status", orderIsBad ? null : RAW('<strong style="color: ' + invoiceStatusColor + ';">' + escHtml(invoiceLabel) + '</strong>')],
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
      const issuedInv = inv.filter((i) => i && (i.posted || i.status >= 1));
      const paidInv = inv.filter((i) => i && (i.status === 3 || i.paymentDate));
      const isRawDraft = o.status === 5;
      // status 1 = "not finalized" only while the number looks like a draft
      // (activated orders keep status 1 with a real O-###### number).
      const isRawCreated = o.status === 1 && youniumOrderNumberLooksDraft(o.orderNumber);
      let statusLbl;
      if (isCancelled) statusLbl = "Cancelled";
      else if (isExpired) statusLbl = "Expired";
      else if (isRawDraft) statusLbl = "Draft";
      else if (isRawCreated) statusLbl = "Created (not finalized)";
      else if (o.status === 10) statusLbl = "Partially paid";
      else if (issuedInv.length > 0 && paidInv.length >= issuedInv.length) statusLbl = "Paid";
      else if (paidInv.length > 0) statusLbl = "Partially paid";
      else if (postedInvoices.length) statusLbl = "Invoiced";
      else if (startsInFuture) statusLbl = "Order (pending start)";
      else if (o.isLastVersion) statusLbl = "Active"; // activated + started, not invoiced yet — Younium's badge
      else statusLbl = "Draft (outdated version)";
      const isPartial = statusLbl.startsWith("Partially");
      const isGood = ["Invoiced", "Paid", "Active"].includes(statusLbl);
      const isBad = ["Cancelled", "Expired"].includes(statusLbl) || statusLbl.startsWith("Draft") || statusLbl.startsWith("Created");
      const statusColor = isGood ? "var(--good)" : (isBad ? "var(--bad)" : "var(--warn)");
      const statusPrefix = isGood ? "✓ " : (isPartial ? "— " : "");
      const relInvoiceLabel = issuedInv.length === 0
        ? "No invoices yet"
        : (paidInv.length >= issuedInv.length ? "✓ Paid (" + issuedInv.length + ")"
          : paidInv.length > 0 ? "Partly paid — " + paidInv.length + " of " + issuedInv.length + " invoices paid (" + (issuedInv.length - paidInv.length) + " outstanding)"
          : "Posted, awaiting payment (" + issuedInv.length + ")");
      const relInvoiceColor = issuedInv.length === 0 ? "var(--bad)" : (paidInv.length >= issuedInv.length ? "var(--good)" : "var(--warn)");
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
        ["Order status", RAW('<strong style="color: ' + statusColor + ';">' + statusPrefix + escHtml(statusLbl) + '</strong>')],
        ["Invoice status", isBad ? null : RAW('<strong style="color: ' + relInvoiceColor + ';">' + escHtml(relInvoiceLabel) + '</strong>')],
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

  // Detect the actual header background behind the button (Rocketlane's theme is
  // independent of the OS dark/light setting) and flag a dark surface so the
  // button's neutral/loading colors stay readable instead of going white-on-white.
  function ynParseRgb(str) {
    const m = String(str || "").match(/(\d+(?:\.\d+)?)/g);
    if (!m || m.length < 3) return null;
    return { r: Number(m[0]), g: Number(m[1]), b: Number(m[2]), a: m.length >= 4 ? Number(m[3]) : 1 };
  }
  function ynEffectiveBg(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const c = ynParseRgb(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.2) return c;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 }; // assume a light header
  }
  function applyButtonSurface() {
    for (const id of ["ynNavBtn", "ofNavBtn", "dtsNavBtn"]) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      const c = ynEffectiveBg(btn.parentElement || btn);
      const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
      btn.classList.toggle("yn-on-dark", lum < 0.5);
    }
  }

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
    // The Oneflow chip sits immediately to the right of the Younium chip.
    if (!document.getElementById("ofNavBtn")) {
      const ynCell = document.getElementById("ynNavBtn")?.closest(".ynNavBtnCell");
      if (ynCell && ynCell.parentElement) ynCell.parentElement.insertBefore(buildOneflowNavButton(), ynCell.nextSibling);
    }
    // Delivery to service sits right of the Oneflow chip (section 8).
    if (!document.getElementById("dtsNavBtn")) {
      const ofCell = document.getElementById("ofNavBtn")?.closest(".ynNavBtnCell");
      if (ofCell && ofCell.parentElement) ofCell.parentElement.insertBefore(buildDeliveryNavButton(), ofCell.nextSibling);
    }
    applyButtonSurface();
    refreshButtonForCurrentProject();
    refreshOneflowButtonForCurrentProject();
    try { dtsEnsureCardButtons(); } catch (_) {}
  }

  let ensureTimer = null;
  function scheduleEnsure() {
    // The card button can't rely on the nav-chip early-out below — the board
    // keeps mounting and unmounting card footers long after the chips settle.
    dtsScheduleCardPass();
    // Steady-state early-out: once the button is present + connected there's
    // nothing for the mutation observer to do (route changes are handled by the
    // history hooks below), so we never schedule work on the SPA's hot path.
    const btn = document.getElementById("ynNavBtn");
    const ofBtn = document.getElementById("ofNavBtn");
    const dtsBtn = document.getElementById("dtsNavBtn");
    if (btn && btn.isConnected && ofBtn && ofBtn.isConnected && dtsBtn && dtsBtn.isConnected) return;
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

  // ════════════════════════════════════════════════════════════════════════
  // 5b. Oneflow signing status — ported from the Project Progress Tracker's
  //     Oneflow status checker: an "Oneflow: …" chip right of the Younium chip
  //     and an "Oneflow status details" modal that reuses the Younium dialog's
  //     look. The tracker reads the document links saved on its project; here
  //     they come from the Rocketlane project's own custom fields (the
  //     "Links:" block the tracker writes into Hubspot Deal Description, the
  //     Delivery status update message, or an Oneflow agreement-id field) and,
  //     when nothing is stored, from an Oneflow search for the plant ID.
  //     Read-only: nothing is written to Oneflow or Rocketlane.
  // ════════════════════════════════════════════════════════════════════════

  const ONEFLOW_HOST = "https://app.oneflow.com";
  const ONEFLOW_API = ONEFLOW_HOST + "/api";
  const ROCKETLANE_API_ORIGIN = "https://kiona.api.rocketlane.com";
  const ROCKETLANE_API = ROCKETLANE_API_ORIGIN + "/api/v1";
  const ONEFLOW_LOGO_URL = "https://www.google.com/s2/favicons?domain=oneflow.com&sz=32";
  const ONEFLOW_STATE_LABEL = { 0: "Draft", 1: "Pending", 2: "Overdue", 3: "Declined", 4: "Signed", 5: "Cancelled" };

  // ── Oneflow transport (ported from the chat bridge's OneflowBridge) ──
  // Oneflow's session cookie is HttpOnly and travels with GM_xmlhttpRequest's
  // cookie jar (anonymous: false). This module only reads, so the XSRF token
  // Oneflow wants on writes is never needed. On 401/403 one warm-up GET to
  // /positions/me is tried before giving up with an "open Oneflow" message.
  function gmOneflowSendRaw(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: { accept: "application/json" },
        timeout: 20000,
        anonymous: false,
        onload: (res) => {
          const text = res.responseText || "";
          let json = null;
          if (text) { try { json = JSON.parse(text); } catch (_) { /* non-JSON */ } }
          resolve({ status: res.status, json, text });
        },
        onerror: () => reject(new Error("Network error reaching Oneflow API")),
        ontimeout: () => reject(new Error("Oneflow API timed out")),
      });
    });
  }
  let ofRenewInFlight = null;
  let ofLastRenewAttempt = 0;
  function oneflowRenewSession() {
    if (ofRenewInFlight) return ofRenewInFlight;
    const now = Date.now();
    if (now - ofLastRenewAttempt < 5000) return Promise.resolve(false);
    ofLastRenewAttempt = now;
    ofRenewInFlight = (async () => {
      try {
        const res = await gmOneflowSendRaw(ONEFLOW_API + "/positions/me");
        return res.status >= 200 && res.status < 300;
      } catch (_) {
        return false;
      } finally {
        setTimeout(() => { ofRenewInFlight = null; }, 0);
      }
    })();
    return ofRenewInFlight;
  }
  async function gmOneflowRequest(path) {
    const url = /^https?:/i.test(path) ? path : (ONEFLOW_API + path);
    // SECURITY: the Oneflow session cookie only ever goes to the Oneflow origin.
    let origin = "";
    try { origin = new URL(url).origin; } catch (_) {}
    if (origin !== ONEFLOW_HOST) throw new Error("Refusing to send Oneflow credentials to non-Oneflow origin: " + (origin || url));
    let res = await gmOneflowSendRaw(url);
    if (res.status === 401 || res.status === 403) {
      if (await oneflowRenewSession()) res = await gmOneflowSendRaw(url);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("HTTP " + res.status + ": Oneflow session expired or missing. Open https://app.oneflow.com once while logged in, then try again.");
    }
    if (res.status < 200 || res.status >= 300) throw new Error("HTTP " + res.status + ": " + (res.text || "").slice(0, 300));
    return res.json;
  }

  // ── Rocketlane API (read-only) — the api-key the Rocketlane SPA keeps in this
  //    page's localStorage, read the same way the chat bridge captures it. ──
  function rlReadApiKey() {
    try {
      const raw = window.localStorage.getItem("__api_key");
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return "";
      return parsed.find((v) => typeof v === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) || "";
    } catch (_) { return ""; }
  }
  // One transport for every Rocketlane call. GET is the only verb sections 5b
  // and 8's lookups use; section 8's "tick the task complete" is the single
  // writer (PUT /tasks/{id}), which is why `body` exists at all.
  function gmRocketlaneRequest(method, path, query, body) {
    return new Promise((resolve, reject) => {
      const apiKey = rlReadApiKey();
      if (!apiKey) { reject(new Error("No Rocketlane api-key in this page yet — reload the page once you are logged in.")); return; }
      let url;
      try {
        url = new URL(ROCKETLANE_API + path);
        for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
      } catch (_) { reject(new Error("Bad Rocketlane API path: " + path)); return; }
      // SECURITY: the api-key only ever goes to the Rocketlane API origin.
      if (url.origin !== ROCKETLANE_API_ORIGIN) { reject(new Error("Refusing to send the Rocketlane api-key to " + url.origin)); return; }
      const headers = { "api-key": apiKey, accept: "application/json" };
      const init = {
        method: String(method || "GET").toUpperCase(),
        url: url.toString(),
        headers,
        timeout: 20000,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) { reject(new Error("HTTP " + res.status + ": " + (res.responseText || "").slice(0, 300))); return; }
          if (!res.responseText) { resolve(null); return; }
          try { resolve(JSON.parse(res.responseText)); } catch (_) { resolve(null); }
        },
        onerror: () => reject(new Error("Network error reaching Rocketlane API")),
        ontimeout: () => reject(new Error("Rocketlane API timed out")),
      };
      if (body !== undefined && body !== null) {
        headers["content-type"] = "application/json";
        init.data = typeof body === "string" ? body : JSON.stringify(body);
      }
      GM_xmlhttpRequest(init);
    });
  }
  function gmRocketlaneGet(path, query) { return gmRocketlaneRequest("GET", path, query); }

  // ── Document discovery ──
  function ofExtractAgreementId(url) {
    const s = String(url ?? "").trim();
    if (!s) return "";
    const m = s.match(/\/(?:documents|agreements)\/(\d+)/i);
    if (m) return m[1];
    if (/^\d+$/.test(s)) return s;
    return "";
  }
  function ofDocumentUrl(id) {
    const s = String(id ?? "").trim();
    return s ? ONEFLOW_HOST + "/documents/" + encodeURIComponent(s) : "";
  }
  function ofIsOneflowUrl(href) {
    try { return /(?:^|\.)oneflow\.com$/i.test(new URL(href).hostname); } catch (_) { return false; }
  }
  // "Subscription" wins when both could match — "Subscription order" is more
  // likely a subscription agreement than a sales order (tracker rule).
  function ofKindByLabel(label) {
    const l = String(label || "").toLowerCase();
    if (/\babonnement|\bsubscription/.test(l)) return "subscription";
    if (/\b(?:order|offer|tilbud|ordre)\b/.test(l)) return "order";
    return "unknown";
  }
  // Subscriptions in this tenant carry "Abonnementsavtale" in the document name.
  function ofKindByName(name) {
    const n = String(name ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return /\babonnementsavtale\b|\bsubscription agreement\b|\bsubscription\b/i.test(n) ? "subscription" : "order";
  }
  // Slot the Oneflow links found in one rich-text field. Walks every <li>/<p>/
  // <div>/<tr> holding an <a href> (the tracker writes "Oneflow (Order): <a>"
  // lines), classifies by URL shape, then by the surrounding label for order vs
  // subscription. Bare URLs in plain text count too, as unknown-kind links;
  // unknown links fill the order slot first, then the subscription slot.
  function ofParseLinksFromHtml(html) {
    const out = { order: "", subscription: "", ambiguous: [] };
    const text = String(html || "");
    if (!text) return out;
    const put = (href, kind, labelText) => {
      if (!ofIsOneflowUrl(href) || !ofExtractAgreementId(href)) return;
      if (out.order === href || out.subscription === href) return;
      if (kind === "subscription" && !out.subscription) out.subscription = href;
      else if (kind === "order" && !out.order) out.order = href;
      else if (kind === "unknown") {
        if (!out.order) { out.order = href; out.ambiguous.push({ href, labelText }); }
        else if (!out.subscription) { out.subscription = href; out.ambiguous.push({ href, labelText }); }
      }
    };
    try {
      const doc = new DOMParser().parseFromString(text, "text/html");
      for (const c of doc.body.querySelectorAll("li, p, div, tr")) {
        const a = c.querySelector("a[href]");
        if (!a) continue;
        const href = (a.getAttribute("href") || "").trim();
        if (!/^https?:/i.test(href)) continue;
        const labelText = (c.textContent || "").replace(/\s+/g, " ").trim();
        put(href, ofKindByLabel(labelText), labelText);
      }
    } catch (_) {}
    const re = /https?:\/\/[^\s<>"']+/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const href = m[0].replace(/[).,;]+$/, "");
      const ctx = text.slice(Math.max(0, m.index - 40), m.index);
      put(href, ofKindByLabel(ctx), ctx.trim());
    }
    return out;
  }
  // Rocketlane's /projects payload stores custom-field values under `fieldValue`.
  function rlReadField(fields, prefix) {
    const want = String(prefix).toLowerCase().replace(/\s+/g, "");
    const f = (fields || []).find((x) => String(x?.fieldName ?? "").toLowerCase().replace(/\s+/g, "").startsWith(want));
    if (!f) return "";
    const v = (f.fieldValue !== undefined && f.fieldValue !== null) ? f.fieldValue : f.value;
    if (v == null) return "";
    if (Array.isArray(v)) {
      return v.map((x) => (typeof x === "object" ? x?.label || x?.value : x))
        .filter((x) => x != null && x !== "").map(String).join(" ");
    }
    if (typeof v === "object") return v.value != null ? String(v.value).trim() : "";
    return String(v).trim();
  }
  // Oneflow links stored on the Rocketlane project: Hubspot Deal Description
  // first (the tracker writes "Oneflow (Order): …" / "Oneflow (Subscription): …"
  // lines there), then the Delivery status update message, then a bare Oneflow
  // agreement-id field. An empty slot falls through to the next source.
  async function ofLinksFromRocketlaneProject(rlProjectId) {
    const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(rlProjectId), { includeAllFields: true });
    const project = json?.data ?? json;
    const fields = Array.isArray(project?.fields) ? project.fields : [];
    const links = { order: "", subscription: "", ambiguous: [], sources: [] };
    const merge = (parsed, sourceName) => {
      let used = false;
      if (!links.order && parsed.order) { links.order = parsed.order; used = true; }
      if (!links.subscription && parsed.subscription) { links.subscription = parsed.subscription; used = true; }
      if (used) links.sources.push(sourceName);
      links.ambiguous.push(...parsed.ambiguous);
    };
    merge(ofParseLinksFromHtml(rlReadField(fields, "hubspotdealdescription") || rlReadField(fields, "dealdescription")), "Hubspot Deal Description");
    merge(ofParseLinksFromHtml(rlReadField(fields, "hubspotdeliverystatusupdatemessage") || rlReadField(fields, "deliverystatusupdatemessage") || rlReadField(fields, "hubspotdeliverystatus")), "Delivery status update message");
    const fk = ofExtractAgreementId(rlReadField(fields, "oneflowagreementid") || rlReadField(fields, "oneflowid"));
    if (fk && !links.order && !links.subscription) { links.order = ofDocumentUrl(fk); links.sources.push("Oneflow agreement id field"); }
    return links;
  }
  function ofPlantIdFromDataFields(a) {
    const fields = Array.isArray(a?.data_fields) ? a.data_fields : (Array.isArray(a?.dataFields) ? a.dataFields : []);
    const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    for (const f of fields) {
      const value = String(f?.value ?? "").trim();
      if (!value) continue;
      // Exact "plantid" only — not "Plant ID-Invoice Account CM".
      if (norm(f?.name) === "plantid" || norm(f?.custom_id ?? f?.customId) === "plantid") return value.replace(/\D+/g, "") || value;
    }
    return "";
  }
  // No link stored on the project: search Oneflow for the plant ID, hydrate the
  // first candidates (search rows may omit data_fields), keep the ones whose
  // Plant ID custom field equals the plant — or, without custom fields, whose
  // name starts with it — and take the best document per kind: Signed first,
  // then Pending/Overdue, then Draft, newest first within a tier.
  async function ofSearchByPlantId(plantId) {
    const pid = String(plantId || "").trim();
    const out = { order: null, subscription: null, candidates: [] };
    if (!pid) return out;
    const json = await gmOneflowRequest("/agreements/?q=" + encodeURIComponent(pid) + "&limit=20");
    const list = Array.isArray(json?.collection) ? json.collection : [];
    const hydrated = await Promise.all(list.slice(0, 10).map(async (a) => {
      if (!a?.id) return a;
      try { return (await gmOneflowRequest("/agreements/" + encodeURIComponent(a.id))) || a; } catch (_) { return a; }
    }));
    const startsWithPid = new RegExp("^\\s*" + pid + "\\b");
    const matches = hydrated.filter((a) => {
      const df = ofPlantIdFromDataFields(a);
      return df ? df === pid : startsWithPid.test(String(a?.name || ""));
    });
    out.candidates = matches;
    const rank = (a) => (a?.state === 4 ? 3 : (a?.state === 1 || a?.state === 2) ? 2 : (a?.state === 0 ? 1 : 0));
    const ts = (a) => Date.parse(a?.updated_time || a?.created_time || 0) || 0;
    const best = (kind) => matches.filter((a) => ofKindByName(a?.name) === kind)
      .sort((a, b) => (rank(b) - rank(a)) || (ts(b) - ts(a)))[0] || null;
    out.order = best("order");
    out.subscription = best("subscription");
    return out;
  }

  // ── Verdict ──
  // Map an Oneflow lifecycle state to a verdict colour + labels (tracker rules).
  function ofStateVerdict(stateNum) {
    switch (stateNum) {
      case 4:  return { color: "green",  short: "Signed",    summary: "Signed — all parties have signed the document in Oneflow." };
      case 1:  return { color: "yellow", short: "Pending",   summary: "Pending — the document was sent for signing but not all parties have signed yet." };
      case 2:  return { color: "yellow", short: "Overdue",   summary: "Overdue — sent for signing, but the signing period has lapsed." };
      case 0:  return { color: "red",    short: "Draft",     summary: "Draft — the document has not been sent for signing yet." };
      case 3:  return { color: "red",    short: "Declined",  summary: "Declined — a party declined to sign the document." };
      case 5:  return { color: "red",    short: "Cancelled", summary: "Cancelled — the document was cancelled." };
      default: return { color: "gray",   short: (ONEFLOW_STATE_LABEL[stateNum] || ("state " + stateNum)), summary: "Unknown Oneflow document state." };
    }
  }
  async function ofFetchAgreementByUrl(url) {
    const id = ofExtractAgreementId(url);
    if (!id) return { id: "", agreement: null, error: String(url || "").trim() ? "Couldn't read an Oneflow document id from the stored link." : "" };
    try {
      const agreement = await gmOneflowRequest("/agreements/" + encodeURIComponent(id));
      return { id, agreement, error: "" };
    } catch (e) {
      return { id, agreement: null, error: "Couldn't fetch Oneflow document " + id + ": " + (e?.message ?? e) };
    }
  }
  /**
   * Compute the Oneflow signing verdict for the open project. Same shape and
   * rules as the tracker's computeOneflowStatus:
   *   { color, label, signed, problems[], lastCheckedAt, order:{id,agreement,error},
   *     sub:{id,agreement,error}, documentUrl, subDocumentUrl, source, notConnected }
   * The verdict follows the ORDER document; without one it falls back to the
   * subscription agreement.
   */
  async function computeOneflowStatusForProject(rlProjectId, plantId) {
    const dbg = (...a) => { try { if (window.__matchDebug !== false) console.log("[Oneflow status]", ...a); } catch (_) {} };
    const empty = () => ({ id: "", agreement: null, error: "" });
    const out = {
      color: "gray", label: "Oneflow: Missing", signed: null, problems: [], lastCheckedAt: Date.now(),
      order: empty(), sub: empty(), documentUrl: "", subDocumentUrl: "", source: "", notConnected: false,
    };
    dbg("compute for", { rlProjectId, plantId });
    let links = null;
    try {
      links = await ofLinksFromRocketlaneProject(rlProjectId);
      if (links.order || links.subscription) out.source = "Links stored on the Rocketlane project (" + links.sources.join(", ") + ")";
      for (const amb of links.ambiguous) dbg("stored Oneflow link without an order/subscription label — slotted by position", amb);
    } catch (e) {
      out.problems.push("Couldn't read the Rocketlane project's link fields: " + (e?.message ?? e));
    }
    if (links && (links.order || links.subscription)) {
      const [order, sub] = await Promise.all([
        links.order ? ofFetchAgreementByUrl(links.order) : Promise.resolve(empty()),
        links.subscription ? ofFetchAgreementByUrl(links.subscription) : Promise.resolve(empty()),
      ]);
      out.order = order;
      out.sub = sub;
    } else if (plantId) {
      try {
        const found = await ofSearchByPlantId(plantId);
        if (found.order) out.order = { id: String(found.order.id), agreement: found.order, error: "" };
        if (found.subscription) out.sub = { id: String(found.subscription.id), agreement: found.subscription, error: "" };
        if (found.order || found.subscription) out.source = "Found by searching Oneflow for plant " + plantId + " — no link is stored on the Rocketlane project";
      } catch (e) {
        out.problems.push("Oneflow search for plant " + plantId + " failed: " + (e?.message ?? e));
      }
    }
    if (out.order.error) out.problems.push(out.order.error);
    if (out.sub.error) out.problems.push(out.sub.error);
    out.notConnected = out.problems.some((p) => /Oneflow session expired|session missing|open https:\/\/app\.oneflow\.com/i.test(String(p)));

    const primary = out.order.agreement || out.sub.agreement || null;
    if (primary) {
      const v = ofStateVerdict(primary.state);
      out.color = v.color;
      out.signed = primary.state === 4;
      const glyph = v.color === "green" ? "✓ " : (v.color === "yellow" ? "⏳ " : (v.color === "red" ? "✗ " : ""));
      out.label = "Oneflow: " + glyph + v.short;
      if (v.color !== "green") out.problems.unshift(v.summary);
    } else if (out.notConnected) {
      out.label = "Oneflow: Not connected";
    } else if (out.order.id || out.sub.id) {
      out.label = "Oneflow: Error";
    } else if (!out.problems.length) {
      out.problems.push("No Oneflow document found — nothing is stored on the Rocketlane project" +
        (plantId ? " and no Oneflow document carries plant ID " + plantId : "") + ".");
    }
    out.documentUrl = out.order.id ? ofDocumentUrl(out.order.id) : "";
    out.subDocumentUrl = out.sub.id ? ofDocumentUrl(out.sub.id) : "";
    dbg("verdict", { color: out.color, label: out.label, source: out.source });
    return out;
  }

  // ── Chip state, session cache and modal (mirrors the Younium module) ──
  const ofVerdictCache = new Map(); // Rocketlane project id -> verdict
  const ofInflight = new Map();
  let ofRenderGen = 0;
  let ofSessionUnavailable = false;
  let currentOneflowStatusProject = null;
  let currentOneflowStatusVerdict = null;

  function getOneflowContext() {
    const m = location.pathname.match(/^\/projects\/(\d+)/);
    const name = readProjectName();
    return { rlProjectId: m ? m[1] : "", name, plantId: extractPlantIdFromProjectName(name) };
  }
  function setOneflowButtonState(color, label, loading, problems) {
    const btn = document.getElementById("ofNavBtn");
    if (!btn) return;
    btn.classList.remove("yn-green", "yn-yellow", "yn-red", "yn-gray");
    btn.classList.add("yn-" + (color || "gray"));
    btn.classList.toggle("yn-loading", !!loading);
    const el = btn.querySelector(".ynNavBtnLabel");
    if (el) el.textContent = label || "Oneflow";
    if (loading) { btn.title = "Fetching latest Oneflow signing status…"; return; }
    const lines = [label && label !== "Oneflow" ? label : "Oneflow signing status"];
    if (Array.isArray(problems) && problems.length) {
      lines.push("");
      for (const p of problems) lines.push("• " + p);
    }
    lines.push("", "Click for details.");
    btn.title = lines.join("\n");
  }
  // A "not connected" verdict is never cached, so logging in to Oneflow and
  // revisiting the project is enough to get a real answer.
  function computeOneflowForProject(rlProjectId, plantId) {
    if (ofVerdictCache.has(rlProjectId)) return Promise.resolve(ofVerdictCache.get(rlProjectId));
    if (ofInflight.has(rlProjectId)) return ofInflight.get(rlProjectId);
    const pr = computeOneflowStatusForProject(rlProjectId, plantId)
      .then((v) => { if (!v.notConnected) ofVerdictCache.set(rlProjectId, v); ofInflight.delete(rlProjectId); return v; })
      .catch((e) => { ofInflight.delete(rlProjectId); throw e; });
    ofInflight.set(rlProjectId, pr);
    return pr;
  }
  function applyOneflowVerdictToButton(rlProjectId, verdict) {
    const btn = document.getElementById("ofNavBtn");
    if (!btn || btn.dataset.rlProjectId !== rlProjectId) return;
    setOneflowButtonState(verdict?.color || "gray", verdict?.label || "Oneflow", false, verdict?.problems);
  }
  function refreshOneflowButtonForCurrentProject() {
    const btn = document.getElementById("ofNavBtn");
    if (!btn) return;
    const { rlProjectId, plantId } = getOneflowContext();
    if (btn.dataset.rlProjectId === (rlProjectId || "")) return; // already reflecting this project
    btn.dataset.rlProjectId = rlProjectId || "";

    if (!rlProjectId) { setOneflowButtonState("gray", "Oneflow"); btn.title = "No Rocketlane project id in the URL"; return; }
    if (ofVerdictCache.has(rlProjectId)) { applyOneflowVerdictToButton(rlProjectId, ofVerdictCache.get(rlProjectId)); return; }
    if (ofSessionUnavailable) { setOneflowButtonState("gray", "Oneflow"); btn.title = "Oneflow not connected — open app.oneflow.com once while logged in, then reload"; return; }

    setOneflowButtonState("gray", "Oneflow", true);
    computeOneflowForProject(rlProjectId, plantId).then((v) => {
      if (v.notConnected) ofSessionUnavailable = true;
      applyOneflowVerdictToButton(rlProjectId, v);
    }).catch((e) => {
      const b = document.getElementById("ofNavBtn");
      if (b && b.dataset.rlProjectId === rlProjectId) {
        setOneflowButtonState("gray", "Oneflow");
        b.title = "Oneflow status unavailable — " + (e?.message || e) + " (click to retry)";
      }
    });
  }
  function buildOneflowNavButton() {
    const wrap = document.createElement("div");
    wrap.className = "ynNavBtnCell";
    const btn = document.createElement("button");
    btn.id = "ofNavBtn";
    btn.type = "button";
    btn.className = "ynNavBtn yn-gray";
    btn.title = "Oneflow signing status — click for details";
    const logo = document.createElement("img");
    logo.className = "ynNavBtnLogo";
    logo.src = ONEFLOW_LOGO_URL;
    logo.alt = "Oneflow";
    logo.decoding = "async";
    logo.addEventListener("error", () => { logo.style.display = "none"; });
    const label = document.createElement("span");
    label.className = "ynNavBtnLabel";
    label.textContent = "Oneflow";
    const spinner = document.createElement("span");
    spinner.className = "ynNavBtnSpinner";
    spinner.setAttribute("aria-hidden", "true");
    btn.appendChild(logo);
    btn.appendChild(label);
    btn.appendChild(spinner);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (els.dlgOneflowStatus?.open) forceCloseOneflowDialog();
      else openOneflowStatusModal();
    });
    wrap.appendChild(btn);
    return wrap;
  }

  // The dialog reuses the Younium dialog's classes so both modals look identical;
  // only the ids differ (same trick the tracker uses).
  function ensureOneflowDialog() {
    if (document.getElementById("dlgOneflowStatus")) return;
    injectStyles();
    const dlg = document.createElement("dialog");
    dlg.id = "dlgOneflowStatus";
    dlg.className = "dlgYouniumStatus";
    dlg.setAttribute("aria-labelledby", "dlgOneflowStatusTitle");
    dlg.innerHTML =
      '<div class="dlgYouniumStatusHd">' +
        '<strong id="dlgOneflowStatusTitle">Oneflow status details</strong>' +
        '<span class="dlgYouniumStatusXBtn" id="closeOneflowHintTop" role="button" tabindex="0" aria-label="Close" title="Close">✕</span>' +
      '</div>' +
      '<div class="dlgYouniumStatusBody" id="dlgOneflowStatusBody"></div>' +
      '<div class="dlgYouniumStatusFooter" id="dlgOneflowStatusFooter">' +
        '<button class="ynBtn" type="button" id="btnOneflowStatusRefresh">Refresh status</button>' +
        '<button class="ynBtn" type="button" id="btnOneflowStatusCopy">Copy summary</button>' +
        '<a class="ynBtn" id="btnOneflowStatusOpenDoc" target="_blank" rel="noopener noreferrer" style="display:none;">Open Oneflow document</a>' +
        '<a class="ynBtn" id="btnOneflowStatusOpenSub" target="_blank" rel="noopener noreferrer" style="display:none;">Open subscription agreement</a>' +
      '</div>';
    document.body.appendChild(dlg);

    els.dlgOneflowStatus = dlg;
    els.dlgOneflowStatusBody = dlg.querySelector("#dlgOneflowStatusBody");
    els.dlgOneflowStatusTitle = dlg.querySelector("#dlgOneflowStatusTitle");
    els.btnOneflowStatusRefresh = dlg.querySelector("#btnOneflowStatusRefresh");
    els.btnOneflowStatusCopy = dlg.querySelector("#btnOneflowStatusCopy");
    els.btnOneflowStatusOpenDoc = dlg.querySelector("#btnOneflowStatusOpenDoc");
    els.btnOneflowStatusOpenSub = dlg.querySelector("#btnOneflowStatusOpenSub");

    // ── Close handlers ──
    dlg.querySelector("#closeOneflowHintTop").addEventListener("click", () => forceCloseOneflowDialog());
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest("#closeOneflowHintTop") && dlg.open) forceCloseOneflowDialog();
    }, true);
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg && dlg.open) forceCloseOneflowDialog(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && dlg.open) forceCloseOneflowDialog(); }, true);

    // ── Refresh ──
    els.btnOneflowStatusRefresh.addEventListener("click", async () => {
      const p = currentOneflowStatusProject;
      if (!p || !p.rlProjectId) return;
      ofVerdictCache.delete(p.rlProjectId);
      ofInflight.delete(p.rlProjectId);
      ofSessionUnavailable = false;
      const gen = ++ofRenderGen;
      setOneflowButtonState("gray", "Oneflow", true);
      els.dlgOneflowStatusBody.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-style:italic;">Refreshing…</div>';
      try {
        const fresh = await computeOneflowForProject(p.rlProjectId, p.plantId);
        if (gen !== ofRenderGen || !els.dlgOneflowStatus.open) return;
        renderOneflowStatusModalBody(fresh, gen);
      } catch (e) {
        if (gen !== ofRenderGen) return;
        els.dlgOneflowStatusBody.innerHTML = '<div class="youniumWarnings">Refresh failed: ' + escHtml(e?.message ?? e) + '</div>';
        setOneflowButtonState("gray", "Oneflow");
      }
    });

    // ── Copy summary (plain text for Slack / e-mail) ──
    els.btnOneflowStatusCopy.addEventListener("click", async () => {
      const p = currentOneflowStatusProject, v = currentOneflowStatusVerdict;
      if (!p || !v) return;
      const oa = v.order?.agreement, sa = v.sub?.agreement;
      const line = (lbl, a) => a
        ? (lbl + ": " + ofStateVerdict(a.state).short + " — " + (a.name || "") +
           (a.sign_time ? " (signed " + new Date(a.sign_time).toLocaleDateString(UI_LOCALE) + ")" : ""))
        : (lbl + ": (no document)");
      const lines = [
        "Oneflow status — " + p.name,
        "Verdict: " + (v.label || "?"),
        line("Order / offer", oa),
        line("Subscription", sa),
        "Oneflow URL: " + (v.documentUrl || v.subDocumentUrl || "(none)"),
        v.source ? "Source: " + v.source : "",
        (v.problems && v.problems.length ? "Issues:\n  - " + v.problems.join("\n  - ") : ""),
      ].filter(Boolean);
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        els.btnOneflowStatusCopy.textContent = "Copied ✓";
        setTimeout(() => { els.btnOneflowStatusCopy.textContent = "Copy summary"; }, 1500);
      } catch (_) {}
    });

    try {
      window.closeOneflowModal = function closeOneflowModal() {
        const d = document.getElementById("dlgOneflowStatus");
        if (!d) return "Oneflow modal not found";
        if (!d.open) return "Already closed";
        d.close(); return "Closed";
      };
    } catch (_) {}
  }
  function forceCloseOneflowDialog() {
    const dlg = els.dlgOneflowStatus || document.getElementById("dlgOneflowStatus");
    if (!dlg) return;
    try { dlg.close(); } catch (_) {}
    try { dlg.removeAttribute("open"); } catch (_) {}
  }

  // Port of the tracker's renderOneflowStatusModalBody. Escape-by-default:
  // every value is HTML-escaped unless wrapped in the local RAW() marker.
  function renderOneflowStatusModalBody(verdict, gen) {
    const p = currentOneflowStatusProject;
    if (!p) return;
    currentOneflowStatusVerdict = verdict;
    if (p.rlProjectId) {
      if (!verdict.notConnected) ofVerdictCache.set(p.rlProjectId, verdict);
      applyOneflowVerdictToButton(p.rlProjectId, verdict);
    }
    if (typeof gen === "number") els.dlgOneflowStatusBody.dataset.gen = String(gen);

    const RAW = (h) => ({ __html: String(h) });
    const fmtDate = (iso) => iso ? new Date(iso).toLocaleString(UI_LOCALE) : "—";
    const fmtDateOnly = (iso) => iso ? new Date(iso).toLocaleDateString(UI_LOCALE) : "—";
    const renderKV = (rows) =>
      '<dl class="youniumKV">' +
      rows
        .filter(([, v]) => v !== "" && v !== null && v !== undefined)
        .map(([k, v]) => {
          const cell = (v && typeof v === "object" && "__html" in v) ? v.__html : escHtml(String(v));
          return '<dt>' + escHtml(k) + '</dt><dd>' + cell + '</dd>';
        })
        .join("") +
      '</dl>';

    // Party / participant list — ✓ green for signed (participant.state === 1),
    // • amber for not yet signed. A Signed (state 4) document is complete, so
    // every participant renders ✓ — a non-signing viewer keeps state 0 even on
    // a fully signed document.
    const renderParties = (agreement) => {
      const parties = Array.isArray(agreement?.parties) ? agreement.parties : [];
      if (!parties.length) return '<em style="color: var(--muted);">no parties</em>';
      const docSigned = agreement?.state === 4;
      return parties.map((pt) => {
        const nm = escHtml(String(pt?.name || "Party"));
        const parts = Array.isArray(pt?.participants) ? pt.participants : [];
        const who = parts.length
          ? parts.map((x) => {
              const signed = docSigned || x?.state === 1;
              const mark = signed
                ? '<span style="color: var(--good);">✓</span>'
                : '<span style="color: var(--warn);">•</span>';
              return mark + ' ' + escHtml(String(x?.email || x?.name || x?.fullname || "—"));
            }).join('<br>')
          : '<span style="color: var(--muted);">—</span>';
        return '<div style="margin-bottom: 4px;"><strong>' + nm + '</strong><br>' + who + '</div>';
      }).join("");
    };

    const agreementKV = (res) => {
      const a = res?.agreement;
      if (!a) {
        return renderKV([[res?.id ? "Error" : "Note",
          res?.id ? (res.error || "Couldn't load this document.") : "No document found for this slot."]]);
      }
      const v = ofStateVerdict(a.state);
      const statusColor = v.color === "green" ? "var(--good)"
        : (v.color === "red" ? "var(--bad)" : (v.color === "yellow" ? "var(--warn)" : "var(--muted)"));
      const link = a.id ? ofDocumentUrl(a.id) : "";
      return renderKV([
        ["Oneflow link",     RAW(link
          ? '<a href="' + escHtml(toHttpUrl(link) || "#") + '" target="_blank" rel="noopener noreferrer">' + escHtml(link) + '</a>'
          : '<em style="color: var(--muted);">none</em>')],
        ["Document ID",      a.id || "—"],
        ["Name",             a.name || "—"],
        ["Kind",             ofKindByName(a.name) === "subscription" ? "Subscription agreement" : "Order / offer"],
        ["Signed?",          RAW('<strong style="color: ' + statusColor + ';">' +
                             (v.color === "green" ? "✓ " : (v.color === "red" ? "✗ " : "")) + escHtml(v.short) + '</strong>')],
        ["Sent for signing", fmtDate(a.publish_time)],
        ["Signed date",      a.sign_time ? fmtDate(a.sign_time) : null],
        ["Declined date",    a.decline_time ? fmtDate(a.decline_time) : null],
        ["Cancelled date",   a.cancel_time ? fmtDate(a.cancel_time) : null],
        ["Expires",          a.expire_date ? fmtDateOnly(a.expire_date) : null],
        ["Created",          fmtDate(a.created_time)],
        ["Updated",          fmtDate(a.updated_time)],
        ["Parties",          RAW(renderParties(a))],
      ]);
    };
    const sectionFor = (title, res) => {
      const a = res?.agreement;
      let badge;
      if (a) {
        const v = ofStateVerdict(a.state);
        const cls = v.color === "green" ? "youniumSubBadge-green"
          : (v.color === "red" ? "youniumSubBadge-red" : (v.color === "yellow" ? "youniumSubBadge-yellow" : "youniumSubBadge-gray"));
        badge = '<span class="youniumSubBadge ' + cls + '">' + escHtml(v.short) + '</span>';
      } else {
        badge = '<span class="youniumSubBadge youniumSubBadge-gray">' + (res?.id ? "error" : "none") + '</span>';
      }
      return '<div class="youniumSection">' +
        '<div class="youniumSectionTitle">' + escHtml(title) + ' ' + badge + '</div>' +
        agreementKV(res) +
        '</div>';
    };

    let summaryText;
    if (verdict.color === "green") summaryText = "Signed — the Oneflow document is fully signed by all parties.";
    else if (verdict.color === "yellow") summaryText = (verdict.problems && verdict.problems[0]) || "Pending — waiting for signatures in Oneflow.";
    else if (verdict.color === "red") summaryText = (verdict.problems && verdict.problems[0]) || "Not signed — the Oneflow document isn't signed.";
    else summaryText = (verdict.problems && verdict.problems[0]) || "No Oneflow document found for this project.";

    const warnings = verdict.problems || [];
    els.dlgOneflowStatusBody.innerHTML =
      '<div class="youniumSummary youniumStatus-' + verdict.color + '">' +
        escHtml(summaryText) +
        (verdict.source ? '<small>' + escHtml(verdict.source) + '</small>' : "") +
      '</div>' +
      (warnings.length
        ? '<div class="youniumWarnings"><strong>Warnings</strong><ul>' +
          warnings.map((w) => '<li>' + escHtml(w) + '</li>').join("") + '</ul></div>'
        : "") +
      sectionFor("Document / order", verdict.order) +
      sectionFor("Subscription agreement", verdict.sub);

    if (verdict.documentUrl) {
      els.btnOneflowStatusOpenDoc.href = toHttpUrl(verdict.documentUrl) || "#";
      els.btnOneflowStatusOpenDoc.style.display = "";
    } else {
      els.btnOneflowStatusOpenDoc.style.display = "none";
    }
    if (verdict.subDocumentUrl) {
      els.btnOneflowStatusOpenSub.href = toHttpUrl(verdict.subDocumentUrl) || "#";
      els.btnOneflowStatusOpenSub.style.display = "";
    } else {
      els.btnOneflowStatusOpenSub.style.display = "none";
    }
    if (els.dlgOneflowStatusTitle) els.dlgOneflowStatusTitle.textContent = "Oneflow status details · " + p.name;
  }

  async function openOneflowStatusModal() {
    ensureOneflowDialog();
    ofSessionUnavailable = false; // the user asked explicitly — retry even after a failed auto-check
    const { rlProjectId, name, plantId } = getOneflowContext();
    currentOneflowStatusProject = { rlProjectId, name: name || "(unknown project)", plantId };
    currentOneflowStatusVerdict = null;
    const gen = ++ofRenderGen;

    els.btnOneflowStatusOpenDoc.style.display = "none";
    els.btnOneflowStatusOpenSub.style.display = "none";
    els.dlgOneflowStatusTitle.textContent = "Oneflow status details · " + currentOneflowStatusProject.name;
    els.dlgOneflowStatus.showModal();

    if (!rlProjectId) {
      els.dlgOneflowStatusBody.innerHTML =
        '<div class="youniumWarnings"><strong>Warnings</strong><ul><li>Couldn\'t read a Rocketlane project id from the URL (' +
        escHtml(location.pathname) + '). Open a project page like /projects/12345/… and try again.</li></ul></div>';
      return;
    }
    if (ofVerdictCache.has(rlProjectId)) { renderOneflowStatusModalBody(ofVerdictCache.get(rlProjectId), gen); return; }
    els.dlgOneflowStatusBody.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-style:italic;">Checking Oneflow…</div>';
    setOneflowButtonState("gray", "Oneflow", true);
    try {
      const verdict = await computeOneflowForProject(rlProjectId, plantId);
      if (gen !== ofRenderGen || !els.dlgOneflowStatus.open) return; // superseded by a newer open/refresh
      renderOneflowStatusModalBody(verdict, gen);
    } catch (e) {
      if (gen !== ofRenderGen) return;
      els.dlgOneflowStatusBody.innerHTML = '<div class="youniumWarnings">Error checking Oneflow status: ' + escHtml(e?.message ?? e) + '</div>';
      setOneflowButtonState("gray", "Oneflow");
    }
  }

  // Initial attempts (covers the case where the nav is already present). Waits
  // for the DOM: the script starts at document-start, but this section keeps
  // its old document-idle timing.
  rlWhenDomReady(() => {
    ensure();
    let tries = 0;
    const boot = setInterval(() => { tries += 1; ensure(); if (document.getElementById("ynNavBtn") || tries > 40) clearInterval(boot); }, 500);
    // Section 8's card button: scrolling a lane is what remounts a card footer,
    // and it doesn't always arrive as a mutation the observer above sees in
    // time. Scroll is captured (the board scrolls an inner container, not the
    // window) and a 1s tick covers everything else, including the first paint
    // of a lane that hydrated while the tab was in the background.
    window.addEventListener("scroll", dtsScheduleCardPass, { passive: true, capture: true });
    setInterval(() => {
      if (/^\/projects\/\d+/.test(location.pathname)) dtsScheduleCardPass();
    }, 1000);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. Delivery to service — the Project Progress Tracker's handover wizard.
  //
  //    The tracker owns the canonical checklist (its `deliveryWizardSteps` /
  //    `buildOverleveringHtml`). The Norwegian question text and the emitted
  //    markup below are copied from it VERBATIM, because their job is to
  //    reproduce the Zendesk macro "Sjekkliste Overlevering IWMAC Kulde til
  //    Service" (macro 1900005365194) when pasted into the composer. Reword
  //    anything here without rewording it in the tracker and the two diverge.
  //
  //    Two entry points: a button on the "Handover to service" task card, right
  //    of the assignee avatar, and a nav chip beside the Oneflow chip for the
  //    projects that don't carry that task.
  // ════════════════════════════════════════════════════════════════════════

  const ZENDESK_HOST = "https://iwmac.zendesk.com";
  const ZENDESK_API = ZENDESK_HOST + "/api/v2";
  const ZENDESK_AGENT_TICKET_URL = ZENDESK_HOST + "/agent/tickets/";
  // Re-read from the macro at call time so an edit in Zendesk carries over;
  // these are the values as of 2026-09 and are only the fallback.
  const ZENDESK_HANDOVER_MACRO_ID = "1900005365194";
  const ZENDESK_HANDOVER_GROUP_ID = 24854481;   // IWMAC Support
  const ZENDESK_HANDOVER_TAGS = ["aktivering_basic"];

  function gmZendeskSendRaw(method, url, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      const headers = Object.assign({ accept: "application/json" }, extraHeaders || {});
      const init = {
        method,
        url,
        headers,
        timeout: 20000,
        anonymous: false, // include the browser's Zendesk session cookie
        onload: (res) => {
          const text = res.responseText || "";
          let json = null;
          if (text) { try { json = JSON.parse(text); } catch (_) {} }
          resolve({ status: res.status, json, text });
        },
        onerror: () => reject(new Error("Network error reaching Zendesk API")),
        ontimeout: () => reject(new Error("Zendesk API timed out")),
      };
      if (body !== undefined && body !== null) {
        headers["content-type"] = "application/json";
        init.data = typeof body === "string" ? body : JSON.stringify(body);
      }
      GM_xmlhttpRequest(init);
    });
  }
  // A 401 on a SAML session usually means the cookie lapsed while the identity
  // behind it is still good — /users/me.json with the renew header refreshes it.
  let zdRenewInFlight = null;
  let zdLastRenewAt = 0;
  function zendeskRenewSession() {
    if (zdRenewInFlight) return zdRenewInFlight;
    if (Date.now() - zdLastRenewAt < 5000) return Promise.resolve(false); // don't hammer
    zdLastRenewAt = Date.now();
    zdRenewInFlight = (async () => {
      try {
        const res = await gmZendeskSendRaw("GET", ZENDESK_API + "/users/me.json", null, { "X-Zendesk-Renew-Session": "true" });
        return res.status >= 200 && res.status < 300;
      } catch (_) { return false; }
      finally { setTimeout(() => { zdRenewInFlight = null; }, 0); }
    })();
    return zdRenewInFlight;
  }
  async function zendeskApiRequest(method, path, body) {
    const url = /^https?:/i.test(path) ? path : (ZENDESK_API + path);
    // SECURITY: the session cookie + CSRF token only ever go to Zendesk. A
    // caller-supplied absolute URL to another @connect host must not get them
    // (same pin as the Rocketlane api-key and the Younium bearer).
    let origin = "";
    try { origin = new URL(url).origin; } catch (_) {}
    if (origin !== ZENDESK_HOST) throw new Error("Refusing to send Zendesk credentials to " + (origin || url));
    const upper = String(method || "GET").toUpperCase();
    const extra = {};
    if (upper !== "GET" && upper !== "HEAD") {
      const csrf = GM_getValue("zdCsrfToken", "");
      if (!csrf) throw new Error("Zendesk CSRF token not captured yet. Open " + ZENDESK_HOST + " once while logged in, then retry.");
      extra["X-CSRF-Token"] = csrf;
    }
    let res = await gmZendeskSendRaw(upper, url, body, extra);
    if (res.status === 401 && await zendeskRenewSession()) {
      res = await gmZendeskSendRaw(upper, url, body, Object.assign({}, extra, { "X-Zendesk-Renew-Session": "true" }));
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("HTTP " + res.status + ": Zendesk session expired or missing. Open " + ZENDESK_HOST + " once while logged in, then try again.");
    }
    if (res.status < 200 || res.status >= 300) throw new Error("HTTP " + res.status + ": " + (res.text || "").slice(0, 300));
    return res.json;
  }
  async function zendeskCreateHandoverTicket(subject, html) {
    let groupId = ZENDESK_HANDOVER_GROUP_ID;
    let tags = ZENDESK_HANDOVER_TAGS.slice();
    try {
      const m = await zendeskApiRequest("GET", "/macros/" + ZENDESK_HANDOVER_MACRO_ID + ".json");
      const actions = m?.macro?.actions ?? [];
      const g = Number(actions.find((x) => x?.field === "group_id")?.value);
      const t = String(actions.find((x) => x?.field === "current_tags")?.value ?? "").trim();
      if (Number.isFinite(g) && g > 0) groupId = g;
      if (t) tags = t.split(/[\s,]+/).filter(Boolean);
    } catch (e) {
      // Macro unreadable (logged out, macro moved) — the constants still route
      // the ticket to the right group.
      console.warn("[Delivery to service] handover macro lookup failed, using defaults:", e?.message ?? e);
    }
    // Public reply, per the delivery team's workflow — the checklist IS the
    // handover, not a side note.
    const res = await zendeskApiRequest("POST", "/tickets.json", {
      ticket: {
        subject: String(subject || "").trim() || "Avblokkering og Overlevering",
        comment: { html_body: String(html || ""), public: true },
        group_id: groupId,
        tags,
        status: "open",
      },
    });
    return res?.ticket ?? null;
  }

  // ── The "Handover to service" task, and ticking it complete ──
  // "Handover from sales to delivery" lives in the same tenant, so the match is
  // anchored on the whole phrase rather than the word "handover".
  function dtsIsHandoverTaskName(name) {
    const s = String(name ?? "").trim();
    return /^handover\s+to\s+service$/i.test(s) || /\bhandover\s+to\s+service\b/i.test(s);
  }
  async function dtsFindHandoverTask(rlProjectId) {
    const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(rlProjectId) + "/tasks");
    const list = Array.isArray(json) ? json : (json?.data ?? []);
    const exact = list.find((t) => /^handover\s+to\s+service$/i.test(String(t?.taskName ?? "").trim()));
    return exact || list.find((t) => dtsIsHandoverTaskName(t?.taskName)) || null;
  }
  // Status is a SINGLE_SELECT custom field on the task: 1 To do, 2 In progress,
  // 3 Completed, 4 Blocked. The field id is per-tenant (230397 here), so it's
  // read off the task itself rather than hardcoded, and the write is verified by
  // re-reading — a PUT that Rocketlane accepts but ignores would otherwise look
  // like success.
  const DTS_STATUS_COMPLETED = 3;
  function dtsTaskStatusField(task) {
    const fields = Array.isArray(task?.fields) ? task.fields : [];
    return fields.find((f) => f?.fieldColumnName === "status" || (f?.fieldName === "Status" && f?.fieldId)) || null;
  }
  async function dtsCompleteTask(taskId) {
    const id = String(taskId ?? "").trim();
    if (!id) throw new Error("Missing Rocketlane taskId.");
    const before = await gmRocketlaneGet("/tasks/" + encodeURIComponent(id));
    const field = dtsTaskStatusField(before);
    if (!field?.fieldId) throw new Error("Couldn't find the Status field on task " + id + ".");
    if (Number(field.fieldValue) === DTS_STATUS_COMPLETED) return { alreadyDone: true };
    await gmRocketlaneRequest("PUT", "/tasks/" + encodeURIComponent(id), null, {
      fields: [{ fieldId: field.fieldId, fieldValue: DTS_STATUS_COMPLETED }],
    });
    const after = await gmRocketlaneGet("/tasks/" + encodeURIComponent(id));
    const now = Number(dtsTaskStatusField(after)?.fieldValue);
    if (now !== DTS_STATUS_COMPLETED) {
      throw new Error("Rocketlane accepted the update but the task is still status " + now + ".");
    }
    return { alreadyDone: false };
  }

  // ── Project facts the wizard pre-fills from ──
  // Everything here is already cached by the Younium and Oneflow chips, so
  // opening the wizard on a project you've been looking at costs no requests.
  function dtsPlantId(p) { return extractPlantIdFromProjectName(p?.name) || "XXXX"; }
  function dtsPlantName(p) {
    // "2581 - Meny Løren: MQTT aftermarked" → "Meny Løren"
    let s = String(p?.name || "").trim();
    s = s.replace(/^\s*\d{3,6}\s*[-–—]?\s*/, "");
    s = s.replace(/\s*:\s*[^:]*$/, "");
    return s.trim() || "Anleggsnavn";
  }
  // Q14 asks whether the number of systems on the order still matches the
  // original sales order, which means checking AM Counter against the project's
  // Younium subscription — so the hint carries both links rather than making you
  // go find the subscription yourself.
  function dtsYouniumHint(p) {
    const base = "Bruk AM Counter: http://toolbox.iwmac.local/am_counter/ for å sjekke om det stemmer med posisjonene i Younium.";
    const sub = String(p?.youniumSubscriptionUrl ?? "").trim();
    const order = String(p?.youniumUrl ?? "").trim();
    if (sub) return base + " Younium-abonnement: " + sub;
    if (order) return base + " Ingen abonnementslenke funnet — Younium-ordre: " + order;
    return base + " Ingen Younium-lenke funnet for dette anlegget.";
  }
  async function dtsBuildProject(ctx) {
    const p = {
      rlProjectId: ctx.rlProjectId,
      name: ctx.name || "",
      client: "",
      ownerName: "",
      oneflowSigned: null,
      oneflowUrl: "",
      oneflowSubscriptionUrl: "",
      youniumUrl: "",
      youniumSubscriptionUrl: "",
    };
    // Rocketlane project — partner (customer) and project owner seed step 16.
    try {
      const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(ctx.rlProjectId), { includeAllFields: true });
      const proj = json?.data ?? json;
      if (proj?.projectName) p.name = proj.projectName;
      p.client = String(proj?.customer?.companyName ?? "").trim();
      const o = proj?.projectOwner;
      p.ownerName = [o?.firstName, o?.lastName].filter(Boolean).join(" ").trim();
    } catch (e) {
      console.warn("[Delivery to service] project lookup failed:", e?.message ?? e);
    }
    // Oneflow — same verdict the chip shows.
    try {
      const v = await computeOneflowForProject(ctx.rlProjectId, ctx.plantId);
      p.oneflowSigned = v?.signed ?? null;
      p.oneflowUrl = String(v?.documentUrl ?? "");
      p.oneflowSubscriptionUrl = String(v?.subDocumentUrl ?? "");
    } catch (e) {
      console.warn("[Delivery to service] Oneflow lookup failed:", e?.message ?? e);
    }
    // Younium — same verdict the chip shows.
    if (ctx.plantId) {
      try {
        const v = await computeForPlant(ctx.plantId, p.name);
        p.youniumUrl = String(v?.links?.saved ?? "");
        const subId = v?.subscriptionOrder?.id;
        if (subId) p.youniumSubscriptionUrl = ynOrderUrl(subId);
      } catch (e) {
        console.warn("[Delivery to service] Younium lookup failed:", e?.message ?? e);
      }
    }
    return p;
  }

  const JA_NEI = ["Ja", "Nei"];
  function dtsSteps(p, a) {
    const whenNo5 = () => a.q5 === "Nei";
    return [
      { key: "title", type: "text", label: "Tittel på Zendesk-saken",
        hint: "PlantID - Anleggsnavn - Avblokkering og Overlevering (rediger ved behov)",
        def: dtsPlantId(p) + " - " + dtsPlantName(p) + " - Avblokkering og Overlevering" },
      { key: "q1", type: "choice", options: ["Ja", "Nei", "ANEO"],
        label: "1. Er abonnementsavtalen signert?",
        def: p.oneflowSigned === true ? "Ja" : undefined,
        hint: p.oneflowSigned === true ? "Oneflow-sjekken sier dokumentet er signert — forhåndsvalgt Ja." : "" },
      { key: "q2", type: "choice", options: JA_NEI, label: "2. Er det oppgitt anleggs administrator i abonnementsavtalen?" },
      { key: "q3", type: "fields", label: "3. Legg ved linker til Oneflow",
        fields: [
          { k: "ordre", label: "Ordre tilbudet", def: String(p.oneflowUrl || "") },
          { k: "abm",   label: "Abonnementsavtalen", def: String(p.oneflowSubscriptionUrl || "") },
        ] },
      { key: "q4", type: "choice", options: JA_NEI, label: "4. Er nøkkelinformasjon og link til Zendesk-overlevering lagt til i PANG-notater?" },
      { key: "q5", type: "choice", options: JA_NEI, label: "5. Er leveransen komplett i henhold til ordren?" },
      { key: "q6", type: "textarea", when: whenNo5, label: "6. Hva gjenstår etter overlevering?" },
      { key: "q7", type: "textarea", when: whenNo5, label: "7. Hvem er ansvarlig for å løse disse manglene?" },
      { key: "q8", type: "choice", options: JA_NEI, label: "8. Skal kuldefirma stå på vaktliste?" },
      { key: "q9", type: "choice", options: ["Ja", "Nei", "ANEO alarm senter"], label: "9. Skal anlegget inn i Alarmsenteret vårt?" },
      { key: "q9b", type: "choice", options: JA_NEI, when: () => a.q9 === "Ja", label: "9b. Har vi etterspurt ringeliste?" },
      { key: "q10", type: "choice", options: JA_NEI, label: "10. Er det lagt inn IK-mat?" },
      { key: "q11", type: "choice", options: JA_NEI, label: "11. Er remote access satt opp?",
        hint: "Gjerne bekreft ved å sjekke om du får tilgang via remote access." },
      { key: "q12", type: "choice", options: JA_NEI, label: "12. Integrert i energinett?" },
      { key: "q13", type: "choice", options: JA_NEI, label: "13. Er det lagt inn tidsstyring på ventilasjonen?",
        hint: "Hvis det er standard ventilasjon, skal dette alltid legges inn dersom ventilasjon er inkludert i ordren." },
      { key: "q14", type: "choice", options: JA_NEI,
        label: "14. Er det gjort endringer av antall systemer på ordre iht opprinnelig salgsordre — i så fall, er dette oppdatert i abm.ordre?",
        hint: dtsYouniumHint(p) },
      { key: "q15", type: "choice", options: JA_NEI, label: "15. Har du lagret all dokumentasjon i anleggsmappe: 99-underlag fra kunde?" },
      { key: "q16", type: "fields", label: "16. Tilleggsinformasjon",
        fields: [
          { k: "internt",   label: "Hvem har gjort leveransen internt", def: String(p.ownerName || "") },
          // Bestiller = the project's partner (Rocketlane's customer company).
          { k: "bestiller", label: "Hvem er bestiller", def: String(p.client || "") },
          { k: "g4",        label: "Er det brukt 4G", def: "" },
          { k: "annet",     label: "Annen relevant informasjon", def: "" },
        ] },
      { key: "review", type: "review", label: "Ferdig — /overlevering-macroen er fylt ut" },
    ].filter((s) => !s.when || s.when());
  }

  function dtsBuildText(p, a) {
    const cb = (on) => (on ? "[x]" : "[ ]");
    const c = (q, opt) => cb(a[q] === opt);
    const t = (v) => String(v ?? "").trim();
    // Zendesk's rich-text composer auto-converts lines starting with "N. " into
    // an <ol>. A NO-BREAK space after the dot (and "•" instead of "* ") defeats
    // the auto-list detection while looking identical when pasted.
    const NB = " ";
    const BULLET = "•" + NB;
    const SUB = "   " + BULLET;
    const L = [];
    L.push(t(a.title) || (dtsPlantId(p) + " - " + dtsPlantName(p) + " - Avblokkering og Overlevering"));
    L.push("");
    L.push("Leveranseavdelingens Sjekkliste til Support");
    L.push("Vennligst besvar følgende spørsmål i forbindelse med leveranse:");
    L.push("");
    L.push("1." + NB + "Er abonnementsavtalen signert?");
    L.push(c("q1", "Ja") + " Ja"); L.push(c("q1", "Nei") + " Nei"); L.push(c("q1", "ANEO") + " ANEO");
    L.push("");
    L.push("2." + NB + "Er det oppgitt anleggs administrator i abonnementsavtalen?");
    L.push(c("q2", "Ja") + " Ja"); L.push(c("q2", "Nei") + " Nei");
    L.push("");
    L.push("3." + NB + "Legg ved linker til Oneflow:");
    L.push("ordre tilbudet: " + t(a.q3_ordre));
    L.push("abonnementsavtalen: " + t(a.q3_abm));
    L.push("");
    L.push("4." + NB + "Er nøkkelinformasjon og link til Zendesk-overlevering lagt til i PANG-notater?");
    L.push(c("q4", "Ja") + " Ja"); L.push(c("q4", "Nei") + " Nei");
    L.push("");
    L.push("5." + NB + "Er leveransen komplett i henhold til ordren?");
    L.push(c("q5", "Ja") + " Ja"); L.push(c("q5", "Nei") + " Nei");
    L.push("");
    L.push("6." + NB + "Hvis nei: Hva gjenstår etter overlevering?");
    L.push("Svar: " + (a.q5 === "Nei" ? t(a.q6) : ""));
    L.push("");
    L.push("7." + NB + "Hvis nei: Hvem er ansvarlig for å løse disse manglene?");
    L.push("Svar: " + (a.q5 === "Nei" ? t(a.q7) : ""));
    L.push("");
    L.push("8." + NB + "Skal kuldefirma stå på vaktliste");
    L.push(c("q8", "Ja") + " Ja"); L.push(c("q8", "Nei") + " Nei");
    L.push("");
    L.push("9." + NB + "Skal anlegget inn i Alarmsenteret vårt?");
    L.push(c("q9", "Ja") + " Ja"); L.push(c("q9", "Nei") + " Nei"); L.push(c("q9", "ANEO alarm senter") + " ANEO alarm senter");
    L.push("Hvis ja:");
    L.push(SUB + "Har vi etterspurt ringeliste?");
    L.push(cb(a.q9 === "Ja" && a.q9b === "Ja") + " Ja");
    L.push(cb(a.q9 === "Ja" && a.q9b === "Nei") + " Nei");
    L.push("");
    L.push("10." + NB + "Er det lagt inn IK-mat?");
    L.push(c("q10", "Ja") + " Ja"); L.push(c("q10", "Nei") + " Nei");
    L.push("");
    L.push("11." + NB + "Er remote access satt opp? (Gjerne bekreft ved å sjekke om du får tilgang via remote access)");
    L.push(c("q11", "Ja") + " Ja"); L.push(c("q11", "Nei") + " Nei");
    L.push("");
    L.push("12." + NB + "Integrert i energinett?");
    L.push(c("q12", "Ja") + " Ja"); L.push(c("q12", "Nei") + " Nei");
    L.push("");
    L.push("13." + NB + "Er det lagt inn tidsstyring på ventilasjonen? (Hvis det er standard ventilasjon, skal dette alltid legges inn dersom ventilasjon er inkludert i ordren.)");
    L.push(c("q13", "Ja") + " Ja"); L.push(c("q13", "Nei") + " Nei");
    L.push("");
    L.push("14." + NB + "Er det gjort endringer av antall systemer på ordre iht opprinnelig salgsordre, i såfall; er dette oppdatert i abm.ordre");
    L.push(c("q14", "Ja") + " Ja"); L.push(c("q14", "Nei") + " Nei");
    L.push("(Bruk AM Counter: http://toolbox.iwmac.local/am_counter/ for å sjekke om det stemmer med posisjonene i Younium)");
    L.push("");
    L.push("15." + NB + "Har du lagret all dokumentasjon i anleggs mappe : 99-underlag fra kunde?");
    L.push(c("q15", "Ja") + " Ja"); L.push(c("q15", "Nei") + " Nei");
    L.push("");
    L.push("16." + NB + "Tilleggsinformasjon:");
    L.push("");
    L.push(BULLET + "Hvem har gjort leveransen internt: " + t(a.q16_internt));
    L.push(BULLET + "Hvem er bestiller: " + t(a.q16_bestiller));
    L.push(BULLET + "Er det brukt 4G: " + t(a.q16_g4));
    L.push(BULLET + "Annen relevant informasjon: " + t(a.q16_annet));
    L.push("");
    L.push("");
    L.push("DEL 2,");
    L.push("Følges opp Service");
    L.push("Sjekkliste for Service oppfølging");
    L.push("Vennligst besvar og gjennomfør følgende ved oppfølging av sak:");
    L.push("");
    L.push(BULLET + "Avblokker anlegg");
    L.push("[ ] Fullført");
    L.push("");
    L.push(BULLET + "Avklar med kunde:");
    L.push(SUB + "Repetering og kopi av alarmer");
    L.push("[ ] Ja");
    L.push("[ ] Nei");
    L.push(SUB + "Tilgangsliste / Brukerliste");
    L.push("[ ] Bekreftet med kunde");
    L.push(SUB + "[ ] Tildelt Firm_admin til korrekt bruker");
    L.push(SUB + "[ ] Ta bort partner / installatør fra vaktliste med mindre kunde bekrefter at de skal stå der.");
    L.push("");
    L.push(BULLET + "Send lenke med opplæring til kunde");
    L.push(SUB + "Lenke: Kom i gang med IWMAC — https://iwmac.zendesk.com/hc/no/articles/7301141845660-Kom-i-gang-med-IWMAC (bruk macro - opplæring IWMAC)");
    L.push("[ ] Sendt");
    L.push(SUB + "Avklar om mer opplæring trengs");
    L.push("[ ] Kunde ønsker opplæring");
    L.push("[ ] Ønsker ikke videre opplæring");
    L.push("");
    L.push(BULLET + "Sjekk om anlegg skal inn i Alarmsenter");
    L.push("[ ] Ja");
    L.push("[ ] Nei");
    L.push("");
    L.push(BULLET + "NB! Sjekk startdato om det er testperiode");
    L.push("[ ] Bekreftet testperiode");
    L.push("");
    L.push(BULLET + "Aktiver abonnent ordre i Younium");
    L.push("[ ] Fullført");
    L.push(SUB + "NB! Sett riktig oppstartdato");
    L.push("Oppstartdato:");
    L.push(SUB + "Younium ordre: " + String(p.youniumUrl || ""));
    L.push("");
    L.push("Tilleggsinformasjon:");
    L.push("");
    L.push(BULLET + "NB! husk å legge til Kenneth Sjølstad - kenneth.sjolstad@bunnpris.no på alle nye bunnpris anlegg!");
    L.push(BULLET + "NB! husk å legge til Øystein Eng (oystein.eng@kjopmannshuset.no) og Kristoffer Kjelsberg (kristoffer.kjelsberg@joker.no) om det er Joker eller SPAR-butikker");
    L.push(BULLET + "NB! husk å legge til Erik Halstensen med firm_admin og service-tilgang på alle nye Meny butikker");
    return L.join("\n");
  }

  // The macro is HTML: an <h3>, a real <ol> for the 16 questions, nested <ul>s
  // for the sub-points. This reproduces that markup with the answers filled in
  // and goes on the clipboard as text/html, so pasting into the Zendesk
  // composer looks like the macro instead of hand-drawn "1." numbers.
  // Bold/plain per question follows the macro (11, 13, 14 and 15 are plain).
  function dtsBuildHtml(p, a) {
    const e = (v) => escHtml(String(v ?? "").trim());
    const box = (on) => (on ? "[x]" : "[]");
    const c = (q, opt) => box(a[q] === opt);
    // The macro ends every item with `<br>&nbsp;`, which CKEditor 5 strips from
    // a list item on paste — verified by pasting the macro's OWN html, whose
    // spacers vanish too. An empty <p> inside the <li> survives.
    const SP = "<p>&nbsp;</p>";
    const item = (inner) => "<li><p>" + inner + "</p>" + SP + "</li>";
    // A saved link is emitted as a real anchor; Zendesk otherwise auto-links a
    // bare URL and eats the text that follows it on the next line.
    const link = (v) => {
      const u = String(v ?? "").trim();
      if (!/^https?:\/\//i.test(u)) return e(u);
      return '<a href="' + escHtml(u) + '">' + escHtml(u) + "</a>";
    };
    const q = (text, bold) => (bold === false ? e(text) : "<strong>" + e(text) + "</strong>");
    const opts = (key, list) => list.map((o) => "<br>" + c(key, o) + " " + e(o)).join("");
    const JA = ["Ja", "Nei"];
    const H = [];

    H.push("<h3><strong>Leveranseavdelingens Sjekkliste til Support</strong></h3>");
    H.push("<p>Vennligst besvar følgende spørsmål i forbindelse med leveranse:</p>");
    H.push("<ol>");
    H.push(item(q("Er abonnementsavtalen signert?") + opts("q1", ["Ja", "Nei", "ANEO"])));
    H.push(item(q("Er det oppgitt anleggs administrator i abonnementsavtalen?") + opts("q2", JA)));
    H.push(item(q("Legg ved linker til Oneflow:") +
      "<br>ordre tilbudet: " + link(a.q3_ordre) +
      "<br>abonnementsavtalen: " + link(a.q3_abm)));
    H.push(item(q("Er nøkkelinformasjon og link til Zendesk-overlevering lagt til i PANG-notater?") + opts("q4", JA)));
    H.push(item(q("Er leveransen komplett i henhold til ordren?") + opts("q5", JA)));
    H.push(item(q("Hvis nei: Hva gjenstår etter overlevering?") +
      "<br>Svar:&nbsp;" + (a.q5 === "Nei" ? e(a.q6) : "")));
    H.push(item(q("Hvis nei: Hvem er ansvarlig for å løse disse manglene?") +
      "<br>Svar:&nbsp;" + (a.q5 === "Nei" ? e(a.q7) : "")));
    H.push(item(q("Skal kuldefirma stå på vaktliste") + opts("q8", JA)));
    H.push("<li><p>" + q("Skal anlegget inn i Alarmsenteret vårt?") +
      opts("q9", ["Ja", "Nei", "ANEO alarm senter"]) +
      "<br><i>Hvis ja:</i></p><ul>" +
      item(q("Har vi etterspurt ringeliste?") +
        "<br>" + box(a.q9 === "Ja" && a.q9b === "Ja") + " Ja" +
        "<br>" + box(a.q9 === "Ja" && a.q9b === "Nei") + " Nei") +
      "</ul></li>");
    H.push(item(q("Er det lagt inn IK-mat?") + opts("q10", JA)));
    H.push(item(q("Er remote access satt opp? (Gjerne bekreft ved å sjekke om du får tilgang via remote access)", false) + opts("q11", JA)));
    H.push(item(q("Integrert i energinett?") + opts("q12", JA)));
    H.push(item(q("Er det lagt inn tidsstyring på ventilasjonen? (Hvis det er standard ventilasjon, skal dette alltid legges inn dersom ventilasjon er inkludert i ordren.)", false) + opts("q13", JA)));
    H.push(item(q("Er det gjort endringer av antall systemer på ordre iht opprinnelig salgsordre, i såfall; er dette oppdatert i abm.ordre", false) +
      opts("q14", JA) +
      '<br>(Bruk AM Counter: <a href="http://toolbox.iwmac.local/am_counter/">http://toolbox.iwmac.local/am_counter/</a> for å sjekke om det stemmer med posisjonene i Younium)'));
    H.push(item(q("Har du lagret all dokumentasjon i anleggs mappe : 99-underlag fra kunde?", false) + opts("q15", JA)));
    H.push("<li><p>" + q("Tilleggsinformasjon:") + "</p></li>");
    H.push("</ol>");
    H.push("<ul>" +
      "<li>Hvem har gjort leveransen internt: " + e(a.q16_internt) + "</li>" +
      "<li>Hvem er bestiller: " + e(a.q16_bestiller) + "</li>" +
      "<li>Er det brukt 4G: " + e(a.q16_g4) + "</li>" +
      "<li>Annen relevant informasjon: " + e(a.q16_annet) + "</li>" +
      "</ul>");

    H.push("<hr><p>&nbsp;</p>");
    H.push("<p>DEL 2,</p>");
    H.push("<p><strong>Følges opp Service</strong></p>");
    H.push("<h3><strong>Sjekkliste for Service oppfølging</strong></h3>");
    H.push("<p>Vennligst besvar og gjennomfør følgende ved oppfølging av sak:</p>");
    H.push("<ul>");
    H.push(item("<strong>Avblokker anlegg</strong><br>[] Fullført"));
    H.push("<li><p><strong>Avklar med kunde:</strong></p><ul>" +
      "<li><p><strong>Repetering og kopi av alarmer</strong><br>[] Ja<br>[] Nei</p></li>" +
      "<li><p><strong>Tilgangsliste / Brukerliste</strong><br>[] Bekreftet med kunde</p></li>" +
      "<li><p>[] Tildelt Firm_admin til korrekt bruker</p></li>" +
      item("[] Ta bort partner / installatør fra vaktliste med mindre kunde bekrefter at de skal stå der.") +
      "</ul></li>");
    H.push("<li><p><strong>Send lenke med opplæring til kunde</strong></p><ul>" +
      '<li><p>Lenke: <a href="https://iwmac.zendesk.com/hc/no/articles/7301141845660-Kom-i-gang-med-IWMAC">Kom i gang med IWMAC</a> (bruk macro - opplæring IWMAC)<br>[] Sendt</p></li>' +
      item("<strong>Avklar om mer opplæring trengs</strong><br>[] Kunde ønsker opplæring<br>[] Ønsker ikke videre opplæring") +
      "</ul></li>");
    H.push(item("<strong>Sjekk om anlegg skal inn i Alarmsenter</strong><br>[] Ja<br>[] Nei"));
    H.push(item("<strong>NB! Sjekk startdato om det er testperiode</strong><br>[] Bekreftet testperiode"));
    H.push("<li><p><strong>Aktiver abonnent ordre i Younium</strong><br>[] Fullført</p><ul>" +
      "<li><p><strong>NB! Sett riktig oppstartdato</strong><br>Oppstartdato:</p></li>" +
      "<li><p>Younium ordre: " + link(p.youniumUrl) + "</p></li>" +
      "</ul></li>");
    H.push("</ul>");
    H.push("<p><strong>Tilleggsinformasjon:</strong></p>");
    H.push("<ul>" +
      '<li><strong>NB!</strong> husk å legge til Kenneth Sjølstad - <a href="mailto:kenneth.sjolstad@bunnpris.no">kenneth.sjolstad@bunnpris.no</a> på alle nye bunnpris anlegg!</li>' +
      '<li><strong>NB!</strong> husk å legge til Øystein Eng (<a href="mailto:oystein.eng@kjopmannshuset.no">oystein.eng@kjopmannshuset.no</a>) og Kristoffer Kjelsberg (<a href="mailto:kristoffer.kjelsberg@joker.no">kristoffer.kjelsberg@joker.no</a>) om det er Joker eller SPAR-butikker</li>' +
      "<li><strong>NB!</strong> husk å legge til Erik Halstensen med firm_admin og service-tilgang på alle nye Meny butikker</li>" +
      "</ul>");
    return H.join("");
  }

  // ── Wizard state, persisted per project ──
  // The tracker keeps answers on the project object in localStorage; here they
  // live in GM storage, so a half-finished checklist survives a reload and the
  // SPA's route changes.
  let dtsProject = null;
  let dtsTaskId = "";
  let dtsStepIdx = 0;
  let dtsMarkComplete = true;
  function dtsAnswersKey(pid) { return "dtsAnswers:" + String(pid || ""); }
  function dtsLoadAnswers(pid) {
    try { return JSON.parse(GM_getValue(dtsAnswersKey(pid), "") || "{}") || {}; } catch (_) { return {}; }
  }
  function dtsSaveAnswers() {
    if (!dtsProject) return;
    try { GM_setValue(dtsAnswersKey(dtsProject.rlProjectId), JSON.stringify(dtsProject.answers || {})); } catch (_) {}
  }
  function dtsToast(msg) {
    let el = document.getElementById("dtsToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "dtsToast";
      el.className = "dtsToast";
      document.body.appendChild(el);
    }
    el.textContent = String(msg || "");
    el.classList.add("dtsToastOn");
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.classList.remove("dtsToastOn"), 6000);
  }

  function ensureDeliveryWizardDialog() {
    if (document.getElementById("dlgDeliveryWizard")) return;
    injectStyles();
    dtsInjectStyles();
    const dlg = document.createElement("dialog");
    dlg.id = "dlgDeliveryWizard";
    dlg.className = "dlgYouniumStatus";
    dlg.setAttribute("aria-labelledby", "dlgDeliveryWizardTitle");
    dlg.innerHTML =
      '<div class="dlgYouniumStatusHd">' +
        '<strong id="dlgDeliveryWizardTitle">Delivery to service</strong>' +
        '<span class="dlgYouniumStatusXBtn" id="closeDeliveryWizardTop" role="button" tabindex="0" aria-label="Close" title="Close">✕</span>' +
      '</div>' +
      '<div class="dlgYouniumStatusBody" id="dlgDeliveryWizardBody"></div>' +
      '<div class="dlgYouniumStatusFooter" id="dlgDeliveryWizardFooter">' +
        '<span id="deliveryWizardProgress" style="align-self:center; color:var(--muted2); font-size:12px; margin-right:auto;"></span>' +
        '<button class="ynBtn" type="button" id="btnDeliveryWizardBack">← Back</button>' +
        '<button class="ynBtn" type="button" id="btnDeliveryWizardCreateTicket" style="display:none;">📨 Opprett Zendesk-sak</button>' +
        '<button class="ynBtn" type="button" id="btnDeliveryWizardNext">Next →</button>' +
      '</div>';
    document.body.appendChild(dlg);

    const close = () => closeDeliveryWizard();
    dlg.querySelector("#closeDeliveryWizardTop").addEventListener("click", close);
    // Capture phase as well — this environment swallows some in-dialog clicks.
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest("#closeDeliveryWizardTop") && dlg.open) close();
    }, true);
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg && dlg.open) close(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && dlg.open) close(); }, true);

    dlg.querySelector("#btnDeliveryWizardBack").addEventListener("click", () => {
      if (dtsStepIdx > 0) { dtsStepIdx -= 1; renderDeliveryWizardStep(); }
    });
    dlg.querySelector("#btnDeliveryWizardNext").addEventListener("click", onDeliveryWizardNext);
    dlg.querySelector("#btnDeliveryWizardCreateTicket").addEventListener("click", onDeliveryWizardCreateTicket);
  }

  function renderDeliveryWizardStep() {
    const p = dtsProject;
    if (!p) return;
    const a = (p.answers = p.answers || {});
    const steps = dtsSteps(p, a);
    if (dtsStepIdx >= steps.length) dtsStepIdx = steps.length - 1;
    const step = steps[dtsStepIdx];
    const body = document.getElementById("dlgDeliveryWizardBody");
    const progress = document.getElementById("deliveryWizardProgress");
    const btnBack = document.getElementById("btnDeliveryWizardBack");
    const btnNext = document.getElementById("btnDeliveryWizardNext");
    const btnTicket = document.getElementById("btnDeliveryWizardCreateTicket");
    if (!body || !step) return;
    progress.textContent = "Steg " + (dtsStepIdx + 1) + " av " + steps.length;
    btnBack.style.visibility = dtsStepIdx === 0 ? "hidden" : "visible";
    btnNext.textContent = step.type === "review" ? "📋 Copy & close" : "Next →";
    if (btnTicket) btnTicket.style.display = step.type === "review" ? "" : "none";
    body.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.style.cssText = "max-width:640px; margin:0 auto; padding:12px 4px; display:grid; gap:12px;";
    const q = document.createElement("div");
    q.style.cssText = "font-size:16px; font-weight:600;";
    q.textContent = step.label;
    wrap.appendChild(q);
    if (step.hint) {
      const h = document.createElement("div");
      h.style.cssText = "color:var(--muted2); font-size:12px;";
      // Linkify http(s) URLs in the hint (the AM Counter link on Q14) —
      // DOM-built anchors, scheme fixed by the regex, so no injection.
      for (const part of String(step.hint).split(/(https?:\/\/[^\s]+)/g)) {
        if (/^https?:\/\//.test(part)) {
          const link = document.createElement("a");
          link.href = part;
          link.textContent = part;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.style.color = "var(--accent)";
          h.appendChild(link);
        } else if (part) {
          h.appendChild(document.createTextNode(part));
        }
      }
      wrap.appendChild(h);
    }
    if (step.type === "choice") {
      if (a[step.key] === undefined && step.def !== undefined) a[step.key] = step.def;
      const row = document.createElement("div");
      row.style.cssText = "display:flex; gap:10px; flex-wrap:wrap;";
      for (const opt of step.options) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dtsChoice" + (a[step.key] === opt ? " dtsChoiceOn" : "");
        b.textContent = (a[step.key] === opt ? "☑ " : "") + opt;
        b.addEventListener("click", () => {
          a[step.key] = opt;
          dtsSaveAnswers();
          dtsStepIdx += 1; // auto-advance on choice
          renderDeliveryWizardStep();
        });
        row.appendChild(b);
      }
      wrap.appendChild(row);
    } else if (step.type === "text") {
      const inp = document.createElement("input");
      inp.className = "dtsInput";
      inp.value = a[step.key] !== undefined ? a[step.key] : (step.def || "");
      if (a[step.key] === undefined && step.def) a[step.key] = step.def;
      inp.addEventListener("input", () => { a[step.key] = inp.value; });
      wrap.appendChild(inp);
      setTimeout(() => inp.focus(), 50);
    } else if (step.type === "textarea") {
      const ta = document.createElement("textarea");
      ta.className = "dtsInput";
      ta.style.cssText = "min-height:110px; resize:vertical;";
      ta.value = a[step.key] || "";
      ta.addEventListener("input", () => { a[step.key] = ta.value; });
      wrap.appendChild(ta);
      setTimeout(() => ta.focus(), 50);
    } else if (step.type === "fields") {
      for (const f of step.fields) {
        const lbl = document.createElement("label");
        lbl.className = "dtsLabel";
        lbl.textContent = f.label;
        const inp = document.createElement("input");
        inp.className = "dtsInput";
        const ak = step.key + "_" + f.k;
        inp.value = a[ak] !== undefined ? a[ak] : (f.def || "");
        if (a[ak] === undefined && f.def) a[ak] = f.def;
        inp.addEventListener("input", () => { a[ak] = inp.value; });
        wrap.appendChild(lbl);
        wrap.appendChild(inp);
      }
    } else if (step.type === "review") {
      const info = document.createElement("div");
      info.style.cssText = "color:var(--muted); font-size:12.5px;";
      info.textContent = 'Sjekk teksten under (redigerbar). "Copy & close" kopierer den som formatert tekst — lim inn i Zendesk-saken, så ser den ut som macroen. DEL 2 følger med utfylt tomt til service.';
      wrap.appendChild(info);
      // Ticking the Rocketlane task is a write to the project, so it is shown
      // as a checkbox rather than done silently — and it is only offered when
      // the "Handover to service" task was actually found.
      if (dtsTaskId) {
        const lab = document.createElement("label");
        lab.className = "dtsCheckRow";
        const cbx = document.createElement("input");
        cbx.type = "checkbox";
        cbx.checked = dtsMarkComplete;
        cbx.addEventListener("change", () => { dtsMarkComplete = cbx.checked; });
        lab.appendChild(cbx);
        lab.appendChild(document.createTextNode('Merk «Handover to service» som Completed i Rocketlane når jeg er ferdig'));
        wrap.appendChild(lab);
      } else {
        const none = document.createElement("div");
        none.style.cssText = "color:var(--muted2); font-size:12px;";
        none.textContent = "Fant ingen «Handover to service»-oppgave i dette prosjektet — ingenting blir merket fullført.";
        wrap.appendChild(none);
      }
      // Rich preview, not a textarea: the clipboard gets this element's HTML,
      // so what you see is what lands in the Zendesk composer. Still editable.
      const ed = document.createElement("div");
      ed.id = "deliveryWizardReviewHtml";
      ed.contentEditable = "true";
      ed.className = "dtsInput dtsReview";
      ed.innerHTML = dtsBuildHtml(p, a);
      wrap.appendChild(ed);
    }
    body.appendChild(wrap);
  }

  // Set the task to Completed if the reviewer left the box ticked. Never throws
  // — a failed tick must not lose the checklist the user just filled in.
  async function dtsMaybeCompleteTask() {
    if (!dtsMarkComplete || !dtsTaskId) return "";
    try {
      const r = await dtsCompleteTask(dtsTaskId);
      return r.alreadyDone ? " Oppgaven var allerede Completed." : " «Handover to service» er merket Completed.";
    } catch (e) {
      return " MEN oppgaven ble ikke merket fullført: " + (e?.message ?? e);
    }
  }

  async function onDeliveryWizardNext() {
    const p = dtsProject;
    if (!p) return;
    const a = p.answers || {};
    const steps = dtsSteps(p, a);
    const step = steps[dtsStepIdx];
    if (step?.type === "review") {
      const ed = document.getElementById("deliveryWizardReviewHtml");
      const html = ed ? ed.innerHTML : dtsBuildHtml(p, a);
      // Plain-text flavour comes from the same element, so a target that can't
      // take HTML still gets the edited content, not a stale copy.
      const text = ed ? ed.innerText : dtsBuildText(p, a);
      let copied = false;
      try {
        if (window.ClipboardItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/html": new Blob([html], { type: "text/html" }),
              "text/plain": new Blob([text], { type: "text/plain" }),
            }),
          ]);
          copied = true;
        }
      } catch (_) { /* fall through to the plain-text write below */ }
      if (!copied) {
        try { await navigator.clipboard.writeText(text); copied = true; } catch (_) {}
      }
      // Only tick the task once the checklist is actually out of the wizard —
      // a failed copy leaves you with nothing to paste, so the handover isn't
      // done and the dialog stays open with the text still selectable.
      if (!copied) {
        dtsToast("Kunne ikke kopiere til utklippstavlen — marker teksten under og kopier manuelt. Oppgaven er ikke merket fullført.");
        return;
      }
      const tick = await dtsMaybeCompleteTask();
      dtsToast("Overlevering-teksten er kopiert som formatert tekst — lim inn i Zendesk." + tick);
      closeDeliveryWizard();
      return;
    }
    dtsSaveAnswers();
    dtsStepIdx += 1;
    renderDeliveryWizardStep();
  }

  async function onDeliveryWizardCreateTicket(ev) {
    const btn = ev.currentTarget;
    const p = dtsProject;
    if (!p) return;
    const a = p.answers || {};
    const ed = document.getElementById("deliveryWizardReviewHtml");
    const html = ed ? ed.innerHTML : dtsBuildHtml(p, a);
    const subject = String(a.title || "").trim() ||
      (dtsPlantId(p) + " - " + dtsPlantName(p) + " - Avblokkering og Overlevering");
    // Creating a ticket is outward-facing and can't be undone from here, so it
    // always asks first and names what it is about to do.
    const already = String(a.zendeskTicketId ?? "").trim();
    if (!confirm(
      "Opprette Zendesk-sak?\n\n" + subject +
      "\n\nGruppe: IWMAC Support · Status: Open\nSjekklisten legges inn som offentlig svar." +
      (dtsMarkComplete && dtsTaskId ? "\n«Handover to service» merkes Completed i Rocketlane." : "") +
      (already ? "\n\nOBS: denne overleveringen har allerede sak #" + already + " — dette blir en NY sak." : "")
    )) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Oppretter…";
    try {
      const ticket = await zendeskCreateHandoverTicket(subject, html);
      const id = String(ticket?.id ?? "").trim();
      if (!id) throw new Error("Zendesk returnerte ingen sak-id.");
      // Remember it on the project so the wizard doesn't silently create a
      // second ticket for the same handover.
      a.zendeskTicketId = id;
      dtsSaveAnswers();
      const tick = await dtsMaybeCompleteTask();
      dtsToast("Zendesk-sak #" + id + " opprettet (IWMAC Support, open)." + tick);
      try { window.open(ZENDESK_AGENT_TICKET_URL + encodeURIComponent(id), "_blank", "noopener"); } catch (_) {}
      closeDeliveryWizard();
    } catch (e) {
      const msg = e instanceof TypeError ? "Nettverks-/CORS-feil." : String(e?.message ?? e);
      dtsToast("Kunne ikke opprette Zendesk-sak: " + msg);
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function closeDeliveryWizard() {
    const dlg = document.getElementById("dlgDeliveryWizard");
    if (!dlg) return;
    dtsSaveAnswers();
    try { dlg.close(); } catch (_) {}
    try { dlg.removeAttribute("open"); } catch (_) {}
  }

  // `taskId` is passed by the card button; the nav chip resolves it itself so
  // the tick still happens when the wizard is opened from the chip on a project
  // that does have the task.
  async function openDeliveryToServiceWizard(taskId) {
    const ctx = getOneflowContext(); // { rlProjectId, name, plantId }
    if (!ctx.rlProjectId) { dtsToast("Åpne et prosjekt først."); return; }
    ensureDeliveryWizardDialog();
    const dlg = document.getElementById("dlgDeliveryWizard");
    const title = document.getElementById("dlgDeliveryWizardTitle");
    const body = document.getElementById("dlgDeliveryWizardBody");
    if (title) title.textContent = "Delivery to service · " + (ctx.name || "");
    if (body) body.innerHTML = '<div style="padding:28px; text-align:center; color:var(--muted);">Henter prosjektdata fra Rocketlane, Oneflow og Younium…</div>';
    try { dlg.showModal(); } catch (_) {}
    dtsStepIdx = 0;
    dtsMarkComplete = true;
    dtsTaskId = String(taskId || "");
    try {
      const p = await dtsBuildProject(ctx);
      p.answers = dtsLoadAnswers(ctx.rlProjectId);
      dtsProject = p;
      if (!dtsTaskId) {
        try { dtsTaskId = String((await dtsFindHandoverTask(ctx.rlProjectId))?.taskId ?? ""); } catch (_) {}
      }
      if (!dlg.open) return; // closed while we were loading
      renderDeliveryWizardStep();
    } catch (e) {
      if (body) body.innerHTML = '<div class="youniumWarnings">Kunne ikke åpne veiviseren: ' + escHtml(e?.message ?? e) + "</div>";
    }
  }

  // ── Styles (own id, so section 5's injectStyles stays untouched) ──
  function dtsInjectStyles() {
    if (document.getElementById("dtsStyles")) return;
    const style = document.createElement("style");
    style.id = "dtsStyles";
    style.textContent = `
      .dtsCardBtn {
        margin-right: auto; margin-left: 6px;
        display: inline-flex; align-items: center; gap: 4px;
        height: 24px; padding: 0 8px;
        font-family: inherit; font-size: 11.5px; font-weight: 600; line-height: 1;
        white-space: nowrap; cursor: pointer;
        border-radius: 6px; border: 1px solid #c7d2fe;
        background: #eef2ff; color: #3730a3;
        transition: background 120ms ease, border-color 120ms ease;
      }
      .dtsCardBtn:hover { background: #e0e7ff; border-color: #a5b4fc; }
      .dtsCardBtn:active { transform: translateY(0.5px); }
      .dtsCardBtn:disabled { opacity: 0.6; cursor: default; }
      dialog.dlgYouniumStatus .dtsInput {
        width: 100%; box-sizing: border-box;
        padding: 9px 11px; border-radius: 9px;
        font-family: inherit; font-size: 13px; line-height: 1.45; text-align: left;
        border: 1px solid var(--hairline-strong); background: var(--surface-1); color: var(--text);
      }
      dialog.dlgYouniumStatus .dtsInput:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-soft); border-color: var(--accent-stroke); }
      dialog.dlgYouniumStatus .dtsReview { min-height: 380px; max-height: 55vh; overflow: auto; resize: vertical; }
      dialog.dlgYouniumStatus .dtsLabel { font-size: 12px; color: var(--muted); }
      dialog.dlgYouniumStatus .dtsCheckRow {
        display: flex; align-items: center; gap: 8px;
        font-size: 12.5px; color: var(--text); cursor: pointer;
      }
      dialog.dlgYouniumStatus .dtsChoice {
        min-width: 90px; padding: 10px 16px; border-radius: 10px;
        font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
        border: 1px solid var(--hairline-strong); background: var(--surface-2); color: var(--text);
      }
      dialog.dlgYouniumStatus .dtsChoice:hover { background: var(--surface-3); }
      dialog.dlgYouniumStatus .dtsChoiceOn {
        background: var(--accent); color: #06251d; border-color: transparent; font-weight: 700;
      }
      .dtsToast {
        position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 16px);
        z-index: 2147483647; max-width: min(720px, 92vw);
        padding: 11px 16px; border-radius: 10px;
        font: 500 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #1e293b; color: #f8fafc; box-shadow: 0 12px 32px rgba(0,0,0,0.24);
        opacity: 0; pointer-events: none; transition: opacity 160ms ease, transform 160ms ease;
      }
      .dtsToast.dtsToastOn { opacity: 1; transform: translate(-50%, 0); }
    `;
    document.head.appendChild(style);
  }

  // ── Entry point 1: the button on the "Handover to service" task card ──
  // The project-plan board is virtualised, and the failure mode that matters is
  // subtler than "cards get rebuilt": an OFF-SCREEN card keeps its shell and its
  // data-cy but drops the whole card footer, which is what the button anchors
  // to. The footer is remounted when the card scrolls back into view. Driving
  // the pass from DOM mutations alone loses that race often enough that the
  // button looked like it needed a second page load, so the pass is also driven
  // by scroll and by a slow interval (see the boot block below). Each run is one
  // attribute-selector query, and re-attaching is idempotent.
  // The pending-timer handle hangs off the function object rather than a `let`
  // in this scope: `ensure()` runs synchronously when Tampermonkey injects into
  // an already-parsed document, which would otherwise reach this pass while a
  // block-scoped binding declared further down is still in its dead zone.
  function dtsScheduleCardPass() {
    if (dtsScheduleCardPass.pending) return;
    dtsScheduleCardPass.pending = setTimeout(() => {
      dtsScheduleCardPass.pending = null;
      try { dtsEnsureCardButtons(); } catch (_) {}
    }, 150);
  }
  function dtsEnsureCardButtons() {
    if (!/^\/projects\/\d+/.test(location.pathname)) return;
    const cards = document.querySelectorAll('[data-cy][class*="task-cardstyles__Card"]');
    for (const card of cards) {
      if (!dtsIsHandoverTaskName(card.getAttribute("data-cy"))) continue;
      const footer = card.querySelector('[class*="CardFooter"]');
      if (!footer || footer.querySelector(".dtsCardBtn")) continue;
      const anchor = footer.querySelector(".assignee-picker");
      if (!anchor) continue;
      dtsInjectStyles();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dtsCardBtn";
      btn.title = "Åpne overleveringsveiviseren for dette prosjektet";
      btn.innerHTML = '<span aria-hidden="true">📋</span><span>Delivery to service</span>';
      // The card is a click target for opening the task drawer, so the button
      // has to keep its click to itself.
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        btn.disabled = true;
        try {
          const ctx = getOneflowContext();
          let taskId = "";
          try { taskId = String((await dtsFindHandoverTask(ctx.rlProjectId))?.taskId ?? ""); } catch (_) {}
          await openDeliveryToServiceWizard(taskId);
        } finally { btn.disabled = false; }
      });
      // margin-right:auto on this button makes the footer's space-between pack
      // it next to the assignee avatar and leave the responsible avatar right.
      anchor.insertAdjacentElement("afterend", btn);
    }
  }

  // ── Entry point 2: the nav chip, for projects without the task ──
  function buildDeliveryNavButton() {
    const wrap = document.createElement("div");
    wrap.className = "ynNavBtnCell";
    const btn = document.createElement("button");
    btn.id = "dtsNavBtn";
    btn.type = "button";
    btn.className = "ynNavBtn yn-gray";
    btn.title = "Delivery to service — overleveringsveiviseren";
    const icon = document.createElement("span");
    icon.textContent = "📋";
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "ynNavBtnLabel";
    label.textContent = "Delivery to service";
    btn.appendChild(icon);
    btn.appendChild(label);
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const dlg = document.getElementById("dlgDeliveryWizard");
      if (dlg?.open) closeDeliveryWizard();
      else openDeliveryToServiceWizard("");
    });
    wrap.appendChild(btn);
    return wrap;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 6. Gantt calendar + floating chat panel — formerly "Rocketlane Enhancer"
  //    v2.0 (rocketlane-enhancer/rocketlane-enhancer.user.js, merged
  //    2026-09-08). The body is the original script's IIFE, unchanged; it keeps
  //    its localStorage keys (rl-calendar-hidden, rl-floating-chat-*), so
  //    settings made under the old script carry over. Called at document-start.
  // ════════════════════════════════════════════════════════════════════════
  function rlEnhancerModule() {
    'use strict';

    // =========================================================================
    // Feature 1: Hide the Gantt calendar/timeline on project pages
    // =========================================================================

    // Only run the hiding logic when we're on a specific project page
    // (URL has /projects/<number>/...), not the project list page (/projects alone).
    const PROJECT_URL_PATTERN = /^\/projects\/\d+(\/|$)/;

    const STYLE_ID = 'hide-rocketlane-calendar-style';

    const HIDE_CSS = `
        /* 1. Hide timeline body (gantt bars area) and its header (months/weeks row) */
        .b-grid-subgrid-normal,
        .b-grid-header-scroller-normal,
        #b-gantt-5-normalSubgrid-footer,
        .b-grid-footer-scroller-normal {
            display: none !important;
        }

        /* 2. Hide the splitter (draggable divider with collapse/expand buttons)
              in the header, body, footer, and virtual scroller rows */
        .b-grid-header-container > .b-grid-splitter,
        .b-grid-vertical-scroller > .b-grid-splitter,
        .b-grid-footer-container > .b-grid-splitter,
        .b-virtual-scrollers > .b-grid-splitter {
            display: none !important;
        }

        /* 3. Hide the gantt toolbar row (Baseline / Shift dates / zoom / etc.) */
        .toolbar__FilterBarWrapper-kUPJEs {
            display: none !important;
        }

        /* 4. Make the task list (left side) fill the full width */
        .b-grid-subgrid-locked {
            width: 100% !important;
            flex-basis: 100% !important;
            max-width: 100% !important;
        }
        .b-grid-header-scroller-locked,
        #b-gantt-5-lockedSubgrid-header,
        #b-gantt-5-lockedSubgrid-footer {
            width: 100% !important;
        }
    `;

    function applyStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = HIDE_CSS;
        document.head.appendChild(style);
    }

    function removeStyle() {
        const el = document.getElementById(STYLE_ID);
        if (el) el.remove();
    }

    const LS_CALENDAR_HIDDEN = 'rl-calendar-hidden';
    const TOGGLE_BTN_ID = 'rl-calendar-toggle-btn';

    function isCalendarHidden() {
        return localStorage.getItem(LS_CALENDAR_HIDDEN) !== '0';
    }

    function syncHideStyleForCurrentUrl() {
        if (PROJECT_URL_PATTERN.test(location.pathname)) {
            if (isCalendarHidden()) {
                if (document.head) applyStyle();
                else document.addEventListener('DOMContentLoaded', applyStyle, { once: true });
            } else {
                removeStyle();
            }
            if (document.body) injectToggleButton();
            else document.addEventListener('DOMContentLoaded', injectToggleButton, { once: true });
        } else {
            removeStyle();
            const btn = document.getElementById(TOGGLE_BTN_ID);
            if (btn) btn.remove();
        }
    }

    function updateToggleButton() {
        const btn = document.getElementById(TOGGLE_BTN_ID);
        if (!btn) return;
        const hidden = isCalendarHidden();
        btn.title = hidden ? 'Show calendar' : 'Hide calendar';
        btn.style.background = hidden ? 'var(--scarlet-gray-100, #e0e0e0)' : 'transparent';
    }

    function injectToggleButton() {
        if (document.getElementById(TOGGLE_BTN_ID)) { updateToggleButton(); return; }

        const presentBtn = document.querySelector('[data-cy="present_phase.exit"]');
        const container = presentBtn
            ? presentBtn.closest('.fullscreen__Action-fhhebC') || presentBtn.parentElement
            : null;
        if (!container) {
            setTimeout(injectToggleButton, 500);
            return;
        }

        const btn = document.createElement('button');
        btn.id = TOGGLE_BTN_ID;
        btn.type = 'button';
        btn.className = presentBtn.className;
        btn.innerHTML = `<span class="flex items-center rl-left-icon"><svg focusable="false" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="16" height="16" viewBox="0 0 32 32" aria-hidden="true"><path d="M26,4h-4V2h-2v2h-8V2h-2v2H6C4.9,4,4,4.9,4,6v20c0,1.1,0.9,2,2,2h20c1.1,0,2-0.9,2-2V6C28,4.9,27.1,4,26,4z M26,26H6V12h20V26z M26,10H6V6h4v2h2V6h8v2h2V6h4V10z"/></svg></span>`;

        btn.addEventListener('click', () => {
            const wasHidden = isCalendarHidden();
            localStorage.setItem(LS_CALENDAR_HIDDEN, wasHidden ? '0' : '1');
            if (wasHidden) removeStyle(); else applyStyle();
            updateToggleButton();
        });

        container.appendChild(btn);
        updateToggleButton();
    }

    // =========================================================================
    // Feature 2: Floating chat panel on the timeline page
    // =========================================================================

    // Two conversations the user can toggle between.
    // 12287338 = Private chat, 12287339 = General chat (Rocketlane default ordering).
    // If the IDs differ for other projects, update them here.
    const CONVERSATIONS = [
        { key: 'private', label: 'Private', id: 12287338 },
        { key: 'general', label: 'General', id: 12287339 },
    ];

    // Only show the floating chat on the timeline page:
    //   /projects/<projectId>/plan/timeline
    const TIMELINE_URL_PATTERN = /^\/projects\/(\d+)\/plan\/timeline(\/|$)/;

    // LocalStorage keys for remembering panel size, collapsed state, active convo
    const LS_COLLAPSED    = 'rl-floating-chat-collapsed';
    const LS_WIDTH        = 'rl-floating-chat-width';
    const LS_HEIGHT       = 'rl-floating-chat-height';
    const LS_ACTIVE_CONVO = 'rl-floating-chat-active-convo';

    const PANEL_ID = 'rl-floating-chat-panel';

    function getProjectIdFromTimelineUrl() {
        const m = location.pathname.match(TIMELINE_URL_PATTERN);
        return m ? m[1] : null;
    }

    function getActiveConversation() {
        const saved = localStorage.getItem(LS_ACTIVE_CONVO);
        return CONVERSATIONS.find(c => c.key === saved) || CONVERSATIONS[0];
    }

    function chatUrlFor(projectId, conversationId) {
        return `/projects/${projectId}/chat/${conversationId}`;
    }

    // Inject CSS into an iframe to show only the message list + composer.
    // Shared by every conversation iframe so the hiding stays consistent.
    function injectIframeStyles(frame) {
        try {
            const doc = frame.contentDocument;
            if (!doc) return;
            if (doc.getElementById('rl-chat-embed-style')) return; // already injected
            const style = doc.createElement('style');
            style.id = 'rl-chat-embed-style';
            style.textContent = `
                /* -- Hide app-level chrome (left nav, top bar) -- */
                aside,
                nav,
                header,
                [class*="SideNav"],
                [class*="TopBar"],
                [class*="AppHeader"],
                [class*="PageHeader"],
                [class*="Breadcrumb"],
                [class*="Navbar"] {
                    display: none !important;
                }

                /* -- Hide the chat page's own conversation-list sidebar,
                      the conversation title bar, and the draggable handle.
                      IMPORTANT: the sidebar is wrapped in an outer
                      .resizable__Wrapper / .resizable-wrapper that reserves
                      ~253px horizontally even when its contents are hidden,
                      so we have to kill the wrapper itself, not just its
                      children. -- */
                .resizable-wrapper,
                [class*="resizable__Wrapper"],
                [data-test-id="projects.conversations.sidebar"],
                [class*="project-spacesstyles__Sider"],
                [class*="new-conversation-action__Wrapper"],
                [class*="styles__Conversations-"],
                [class*="styles__ConversationList-"],
                [class*="ConversationList"],
                [class*="ChatSidebar"],
                [class*="ChatList"],
                [class*="ChannelList"],
                [class*="ChatHeader"],
                [class*="ConversationHeader"],
                [class*="resizable__DraggableHandle"],
                [class*="DraggableHandle"] {
                    display: none !important;
                    width: 0 !important;
                    min-width: 0 !important;
                    max-width: 0 !important;
                    flex: 0 0 0 !important;
                }

                /* -- Let the main chat pane fill the full iframe -- */
                html, body, #root, main,
                [class*="MainContent"],
                [class*="ChatContainer"],
                [class*="ChatPage"],
                [class*="ConversationView"] {
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    height: 100% !important;
                    overflow: hidden !important;
                }

                /* -- Hide the conversation details banner (title, "created this
                      conversation" blurb, Add people / Copy link buttons) to
                      give more vertical space to the actual messages -- */
                [class*="ChannelDetailsWrapper"] {
                    display: none !important;
                }

                /* -- Keep: message list + composer (action bar) -- */
                [class*="MessageList"],
                [class*="MessagesList"],
                [class*="ConversationBody"],
                [class*="action-bar"] {
                    display: flex !important;
                }
            `;
            doc.head.appendChild(style);
        } catch (e) {
            console.warn('[rl-floating-chat] could not style iframe:', e);
        }
    }

    function buildPanel(projectId) {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;

        const collapsed = localStorage.getItem(LS_COLLAPSED) === '1';
        const width  = localStorage.getItem(LS_WIDTH)  || '420px';
        const height = localStorage.getItem(LS_HEIGHT) || '560px';

        panel.style.cssText = `
            position: fixed;
            right: 16px;
            bottom: 16px;
            width: ${width};
            height: ${collapsed ? '40px' : height};
            min-width: 280px;
            min-height: 40px;
            max-width: 90vw;
            max-height: 90vh;
            z-index: 2147483000;
            background: #fff;
            border: 1px solid #d0d7de;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,.18);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            resize: both;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        `;

        // Header bar (drag + collapse/close buttons)
        const header = document.createElement('div');
        header.style.cssText = `
            flex: 0 0 40px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 10px;
            background: #f6f8fa;
            border-bottom: 1px solid #d0d7de;
            cursor: move;
            user-select: none;
            font-size: 13px;
            font-weight: 600;
            color: #24292f;
        `;
        const activeConvo = getActiveConversation();
        const tabButtonsHtml = CONVERSATIONS.map(c => `
            <button type="button"
                data-role="convo-tab"
                data-convo-key="${c.key}"
                style="
                    border: 1px solid #d0d7de;
                    background: ${c.key === activeConvo.key ? '#0969da' : '#fff'};
                    color:      ${c.key === activeConvo.key ? '#fff'    : '#24292f'};
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                    padding: 4px 10px;
                    border-radius: 6px;
                    margin-right: 4px;
                ">${c.label}</button>
        `).join('');

        header.innerHTML = `
            <span style="display:flex;align-items:center;gap:6px;">
                <span>💬</span>
                ${tabButtonsHtml}
            </span>
            <span>
                <button type="button" data-role="collapse"
                    style="border:none;background:transparent;cursor:pointer;font-size:16px;padding:4px 8px;">
                    ${collapsed ? '▲' : '▼'}
                </button>
                <button type="button" data-role="close"
                    style="border:none;background:transparent;cursor:pointer;font-size:16px;padding:4px 8px;">
                    ✕
                </button>
            </span>
        `;

        // Container that holds one iframe per conversation. We mount them
        // all at once and just toggle visibility on tab-switch, so the
        // switch feels instant (no reload flash, no re-login, CKEditor
        // state in the other tab is preserved).
        const iframeContainer = document.createElement('div');
        iframeContainer.style.cssText = `
            flex: 1 1 auto;
            position: relative;
            width: 100%;
            display: ${collapsed ? 'none' : 'block'};
            background: #fff;
        `;

        const iframesByKey = {};
        CONVERSATIONS.forEach(c => {
            const frame = document.createElement('iframe');
            frame.src = chatUrlFor(projectId, c.id);
            frame.dataset.convoKey = c.key;
            const isActive = c.key === activeConvo.key;
            frame.style.cssText = `
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                border: 0;
                background: #fff;
                opacity: ${isActive ? '1' : '0'};
                pointer-events: ${isActive ? 'auto' : 'none'};
                transition: opacity 120ms ease;
            `;
            frame.addEventListener('load', () => injectIframeStyles(frame));
            iframesByKey[c.key] = frame;
            iframeContainer.appendChild(frame);
        });

        panel.appendChild(header);
        panel.appendChild(iframeContainer);

        // --- Interactions ---
        header.querySelector('[data-role="collapse"]').addEventListener('click', () => {
            const isCollapsed = iframeContainer.style.display === 'none';
            if (isCollapsed) {
                iframeContainer.style.display = 'block';
                panel.style.height = localStorage.getItem(LS_HEIGHT) || '560px';
                header.querySelector('[data-role="collapse"]').textContent = '▼';
                localStorage.setItem(LS_COLLAPSED, '0');
            } else {
                // Remember current height before collapsing
                localStorage.setItem(LS_HEIGHT, panel.style.height || '560px');
                iframeContainer.style.display = 'none';
                panel.style.height = '40px';
                header.querySelector('[data-role="collapse"]').textContent = '▲';
                localStorage.setItem(LS_COLLAPSED, '1');
            }
        });

        header.querySelector('[data-role="close"]').addEventListener('click', () => {
            panel.remove();
        });

        // Conversation tab switching — instant fade between preloaded iframes.
        header.querySelectorAll('[data-role="convo-tab"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.getAttribute('data-convo-key');
                const convo = CONVERSATIONS.find(c => c.key === key);
                if (!convo) return;
                localStorage.setItem(LS_ACTIVE_CONVO, convo.key);

                // Update button styles
                header.querySelectorAll('[data-role="convo-tab"]').forEach(b => {
                    const isActive = b.getAttribute('data-convo-key') === convo.key;
                    b.style.background = isActive ? '#0969da' : '#fff';
                    b.style.color      = isActive ? '#fff'    : '#24292f';
                });

                // Cross-fade: show the chosen iframe, hide the others. Both
                // are already loaded so there's no network round-trip.
                Object.entries(iframesByKey).forEach(([k, frame]) => {
                    const isActive = k === convo.key;
                    frame.style.opacity = isActive ? '1' : '0';
                    frame.style.pointerEvents = isActive ? 'auto' : 'none';
                });
            });
        });

        // Block ALL iframes on the page during drag/resize so mouseup
        // is never swallowed by an iframe.
        let iframeOverlay = null;
        function blockIframes() {
            if (iframeOverlay) return;
            iframeOverlay = document.createElement('div');
            iframeOverlay.style.cssText =
                'position:fixed;inset:0;z-index:2147483001;cursor:inherit;';
            document.body.appendChild(iframeOverlay);
        }
        function unblockIframes() {
            if (iframeOverlay) { iframeOverlay.remove(); iframeOverlay = null; }
        }

        // --- Drag to move ---
        let dragging = false, startX = 0, startY = 0, startRight = 0, startBottom = 0;
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startRight  = window.innerWidth  - rect.right;
            startBottom = window.innerHeight - rect.bottom;
            blockIframes();
            e.preventDefault();
        });

        // --- Edge & corner resize handles ---
        const edges = [
            { name: 'top',          cursor: 'ns-resize',   css: 'top:0;left:6px;right:6px;height:6px;' },
            { name: 'bottom',       cursor: 'ns-resize',   css: 'bottom:0;left:6px;right:6px;height:6px;' },
            { name: 'left',         cursor: 'ew-resize',   css: 'left:0;top:6px;bottom:6px;width:6px;' },
            { name: 'right',        cursor: 'ew-resize',   css: 'right:0;top:6px;bottom:6px;width:6px;' },
            { name: 'top-left',     cursor: 'nwse-resize', css: 'top:0;left:0;width:10px;height:10px;' },
            { name: 'top-right',    cursor: 'nesw-resize', css: 'top:0;right:0;width:10px;height:10px;' },
            { name: 'bottom-left',  cursor: 'nesw-resize', css: 'bottom:0;left:0;width:10px;height:10px;' },
            { name: 'bottom-right', cursor: 'nwse-resize', css: 'bottom:0;right:0;width:10px;height:10px;' },
        ];
        edges.forEach(({ name, cursor, css }) => {
            const h = document.createElement('div');
            h.dataset.resize = name;
            h.style.cssText = `position:absolute;${css}cursor:${cursor};z-index:10;`;
            panel.appendChild(h);
        });

        let resizing = false, resizeEdge = '', rStartX = 0, rStartY = 0;
        let rStartW = 0, rStartH = 0, rStartRight = 0, rStartBottom = 0;

        panel.addEventListener('mousedown', (e) => {
            const handle = e.target.closest('[data-resize]');
            if (!handle) return;
            resizing = true;
            resizeEdge = handle.dataset.resize;
            rStartX = e.clientX;
            rStartY = e.clientY;
            const rect = panel.getBoundingClientRect();
            rStartW = rect.width;
            rStartH = rect.height;
            rStartRight  = parseFloat(panel.style.right)  || 0;
            rStartBottom = parseFloat(panel.style.bottom) || 0;
            blockIframes();
            e.preventDefault();
            e.stopPropagation();
        });

        // --- Shared mousemove / mouseup on window ---
        window.addEventListener('mousemove', (e) => {
            if (dragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                panel.style.right  = Math.max(0, startRight  - dx) + 'px';
                panel.style.bottom = Math.max(0, startBottom - dy) + 'px';
                return;
            }
            if (resizing) {
                const dx = e.clientX - rStartX;
                const dy = e.clientY - rStartY;
                const minW = 280, minH = 200;

                if (resizeEdge.includes('left')) {
                    panel.style.width = Math.max(minW, rStartW - dx) + 'px';
                }
                if (resizeEdge.includes('right')) {
                    const newW = Math.max(minW, rStartW + dx);
                    panel.style.width = newW + 'px';
                    panel.style.right = (rStartRight - (newW - rStartW)) + 'px';
                }
                if (resizeEdge.includes('top')) {
                    panel.style.height = Math.max(minH, rStartH - dy) + 'px';
                }
                if (resizeEdge.includes('bottom')) {
                    const newH = Math.max(minH, rStartH + dy);
                    panel.style.height = newH + 'px';
                    panel.style.bottom = (rStartBottom - (newH - rStartH)) + 'px';
                }
            }
        });

        function stopAll() {
            if (dragging || resizing) {
                dragging = false;
                resizing = false;
                unblockIframes();
                localStorage.setItem(LS_WIDTH,  panel.style.width);
                localStorage.setItem(LS_HEIGHT, panel.style.height);
            }
        }
        window.addEventListener('mouseup', stopAll);
        document.addEventListener('mouseup', stopAll);
        window.addEventListener('blur', stopAll);

        return panel;
    }

    function mountPanel() {
        if (document.getElementById(PANEL_ID)) return; // already mounted
        const projectId = getProjectIdFromTimelineUrl();
        if (!projectId) return;
        document.body.appendChild(buildPanel(projectId));
    }

    function unmountPanel() {
        const el = document.getElementById(PANEL_ID);
        if (el) el.remove();
    }

    function syncChatPanelForCurrentUrl() {
        if (TIMELINE_URL_PATTERN.test(location.pathname)) {
            if (document.body) mountPanel();
            else document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
        } else {
            unmountPanel();
        }
    }

    // =========================================================================
    // SPA navigation: run both features on every client-side nav
    // =========================================================================

    function syncAll() {
        syncHideStyleForCurrentUrl();
        syncChatPanelForCurrentUrl();
    }

    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
        origPush.apply(this, arguments);
        syncAll();
    };
    history.replaceState = function () {
        origReplace.apply(this, arguments);
        syncAll();
    };
    window.addEventListener('popstate', syncAll);

    syncAll();
  }

  // ════════════════════════════════════════════════════════════════════════
  // 7. Project Notes column — formerly "Rocketlane Project Notes Column"
  //    v1.10.0 (rocketlane-project-notes/rocketlane-project-notes.user.js,
  //    merged 2026-09-08). The body is the original script's IIFE, unchanged;
  //    its GM storage keys (tm_project_notes_v1, tm_project_notes_width_v1,
  //    tm_pn_sql_api_url_v1) now live in this script's storage, so the column
  //    width and a custom SQL API URL start from their defaults and the notes
  //    themselves come back from the toolbox SQL table. Called once the DOM
  //    is ready (its old @run-at was document-idle).
  // ════════════════════════════════════════════════════════════════════════
  function rlProjectNotesModule() {
  "use strict";

  const STORAGE_KEY = "tm_project_notes_v1";
  const WIDTH_KEY = "tm_project_notes_width_v1";
  const SQL_API_URL_KEY = "tm_pn_sql_api_url_v1";
  const SQL_API_URL_DEFAULT = "http://toolbox.iwmac.local:8505/toolbox-sql";
  const SQL_TABLE = "team_status.iw_project_notes";
  const MIN_WIDTH = 80;
  const MAX_WIDTH = 800;
  const PINNED_LEFT_BASE = 400;
  const REMOTE_REFRESH_MS = 60000;
  const SAVE_STATUS_HOLD_MS = 1400;
  const SAVE_STATUS_FADE_MS = 600;

  let sqlApiUrl = GM_getValue(SQL_API_URL_KEY, SQL_API_URL_DEFAULT);
  let lastRemoteSyncMs = 0;

  let NOTE_WIDTH = readWidth();
  function readWidth() {
    const v = parseInt(GM_getValue(WIDTH_KEY, "220"), 10);
    if (isNaN(v)) return 220;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
  }
  function saveWidth(w) { GM_setValue(WIDTH_KEY, String(w)); }

  let observer = null;
  let notesCache = readLocalNotes();
  let headerStatus = null;
  let headerStatusFadeTimer = 0;
  let headerStatusRemoveTimer = 0;
  let nextSaveSeq = 0;
  const latestSaveSeqByProject = {};
  let lastFailedSave = null;

  function readLocalNotes() {
    try {
      const raw = GM_getValue(STORAGE_KEY, "{}");
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch (_e) {
      return {};
    }
  }

  function writeLocalNotes(obj) {
    notesCache = obj;
    GM_setValue(STORAGE_KEY, JSON.stringify(obj, null, 2));
  }

  function getNote(projectId) {
    return notesCache[projectId] || "";
  }

  function clearHeaderStatusTimers() {
    if (headerStatusFadeTimer) {
      window.clearTimeout(headerStatusFadeTimer);
      headerStatusFadeTimer = 0;
    }
    if (headerStatusRemoveTimer) {
      window.clearTimeout(headerStatusRemoveTimer);
      headerStatusRemoveTimer = 0;
    }
  }

  function renderHeaderStatus() {
    document.querySelectorAll(".tm-pn-header").forEach((header) => {
      let statusEl = header.querySelector(".tm-pn-status");
      if (!headerStatus) {
        if (statusEl) statusEl.remove();
        return;
      }

      if (!statusEl) {
        statusEl = document.createElement("span");
        statusEl.addEventListener("mousedown", (e) => e.stopPropagation());
        statusEl.addEventListener("click", onHeaderStatusClick);
        const cfgEl = header.querySelector(".tm-pn-cfg");
        if (cfgEl) header.insertBefore(statusEl, cfgEl);
        else header.appendChild(statusEl);
      }

      statusEl.className = "tm-pn-status";
      statusEl.title = headerStatus.title || "";
      statusEl.style.cursor = headerStatus.kind === "error" ? "pointer" : "default";

      if (headerStatus.kind === "saving") {
        statusEl.classList.add("tm-pn-saving");
        statusEl.textContent = "…";
        return;
      }
      if (headerStatus.kind === "saved") {
        statusEl.classList.add("tm-pn-saved");
        if (headerStatus.fade) statusEl.classList.add("tm-pn-fade");
        statusEl.textContent = "✓";
        return;
      }
      if (headerStatus.kind === "error") {
        statusEl.classList.add("tm-pn-error");
        statusEl.textContent = "!";
        return;
      }
      statusEl.remove();
    });
  }

  function onHeaderStatusClick(e) {
    e.stopPropagation();
    if (!headerStatus || headerStatus.kind !== "error") return;

    const fail = lastFailedSave;
    const details = headerStatus.title || "SQL save failed.";
    const lines = [details];
    lines.push("", `SQL API URL: ${sqlApiUrl || "(not set)"}`);
    if (fail) {
      const preview = (fail.text || "").slice(0, 120);
      lines.push(
        "",
        `Last failed note for project ${fail.projectId}:`,
        preview || "(empty — delete)"
      );
    }
    lines.push("", "Click OK to retry the last failed save, Cancel to dismiss.");

    const retry = window.confirm(lines.join("\n"));
    if (!retry || !fail) {
      if (!retry) setHeaderStatus(null);
      return;
    }
    setNote(fail.projectId, fail.text);
  }

  function setHeaderStatus(kind, title) {
    clearHeaderStatusTimers();
    if (!kind) {
      headerStatus = null;
      renderHeaderStatus();
      return;
    }

    headerStatus = { kind, title: title || "", fade: false };
    renderHeaderStatus();

    if (kind === "saved") {
      headerStatusFadeTimer = window.setTimeout(() => {
        if (!headerStatus || headerStatus.kind !== "saved") return;
        headerStatus.fade = true;
        renderHeaderStatus();
        headerStatusRemoveTimer = window.setTimeout(() => {
          if (!headerStatus || headerStatus.kind !== "saved") return;
          headerStatus = null;
          renderHeaderStatus();
        }, SAVE_STATUS_FADE_MS);
      }, SAVE_STATUS_HOLD_MS);
    }
  }

  function clearAllSyncStates() {
    clearHeaderStatusTimers();
    headerStatus = null;
    renderHeaderStatus();
  }

  function isSqlEnabled() {
    return typeof sqlApiUrl === "string" && sqlApiUrl.length > 0;
  }

  function escapeSqlString(str) {
    return String(str).replace(/\\/g, "\\\\").replace(/'/g, "''");
  }

  function nowIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }

  function sqlApiPost(sqlCommand) {
    return new Promise((resolve, reject) => {
      const formData = `sql_command=${encodeURIComponent(sqlCommand)}`;
      GM_xmlhttpRequest({
        method: "POST",
        url: sqlApiUrl,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        data: formData,
        timeout: 15000,
        onload: (res) => {
          try {
            const data = JSON.parse(res.responseText || "{}");
            const reqId = data.request_id ? ` [${data.request_id}]` : "";
            if (res.status >= 400) {
              reject(new Error((data.error || `HTTP ${res.status}`) + reqId));
              return;
            }
            if (data.success && data.results) {
              resolve(data);
              return;
            }
            reject(new Error((data.error || "API error") + reqId));
          } catch (_e) {
            reject(new Error("Invalid API response"));
          }
        },
        onerror: () => reject(new Error("Network error")),
        ontimeout: () => reject(new Error("Timeout")),
      });
    });
  }

  async function sqlReadAll() {
    const sql = `SELECT project_id, note FROM ${SQL_TABLE}`;
    const res = await sqlApiPost(sql);
    const rows = res.results && res.results[0] && res.results[0].data ? res.results[0].data : [];
    const out = {};
    for (const row of rows) {
      const pid = String(row.project_id);
      const note = row.note || "";
      if (pid && note) out[pid] = note;
    }
    return out;
  }

  async function sqlUpsertNote(projectId, note) {
    const pidEsc = escapeSqlString(projectId);
    const noteEsc = escapeSqlString(note);
    const ts = escapeSqlString(nowIso());
    const updateSql = `UPDATE ${SQL_TABLE} SET note='${noteEsc}', updated_at='${ts}' WHERE project_id='${pidEsc}'`;
    const res = await sqlApiPost(updateSql);
    const updated = res.results && res.results[0] && res.results[0].affected_rows > 0;
    if (!updated) {
      const checkRes = await sqlApiPost(`SELECT 1 FROM ${SQL_TABLE} WHERE project_id='${pidEsc}' LIMIT 1`);
      const exists = checkRes.results && checkRes.results[0] && checkRes.results[0].data && checkRes.results[0].data.length > 0;
      if (!exists) {
        const insertSql = `INSERT INTO ${SQL_TABLE} (project_id, note, updated_at) VALUES ('${pidEsc}', '${noteEsc}', '${ts}')`;
        await sqlApiPost(insertSql);
      }
    }
  }

  async function sqlDeleteNote(projectId) {
    const pidEsc = escapeSqlString(projectId);
    await sqlApiPost(`DELETE FROM ${SQL_TABLE} WHERE project_id='${pidEsc}'`);
  }

  function sqlHealthCheck() {
    return new Promise((resolve) => {
      const base = (sqlApiUrl || "").replace(/\/+$/, "");
      if (!base) {
        resolve({ ok: false, message: "No SQL API URL configured." });
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: base + "/health",
        timeout: 8000,
        onload: (res) => {
          if (res.status === 200) {
            resolve({ ok: true, message: `OK (HTTP 200) — ${base}/health` });
          } else if (res.status === 503) {
            resolve({ ok: false, message: `MariaDB down (HTTP 503) — ${base}/health` });
          } else {
            resolve({ ok: false, message: `Unexpected HTTP ${res.status} — ${base}/health` });
          }
        },
        onerror: () =>
          resolve({
            ok: false,
            message:
              `Network error reaching ${base}/health. ` +
              "Host not reachable from the browser (VPN off, DNS, firewall, or service down).",
          }),
        ontimeout: () =>
          resolve({ ok: false, message: `Timed out after 8s reaching ${base}/health` }),
      });
    });
  }

  async function testConnectionInteractive() {
    const base = sqlApiUrl || "(not set)";
    setHeaderStatus("saving", `Testing ${base}/health ...`);
    const result = await sqlHealthCheck();
    if (result.ok) {
      lastFailedSave = null;
      setHeaderStatus("saved", result.message);
      refreshFromSql(true);
    } else {
      try {
        console.warn("[Rocketlane Notes] Health check failed →", base, result.message);
      } catch (_ignored) {}
      setHeaderStatus(
        "error",
        `Toolbox SQL health check failed: ${result.message}. Click the ! for details.`
      );
    }
  }

  async function refreshFromSql(force) {
    if (!isSqlEnabled()) return;
    const now = Date.now();
    if (!force && now - lastRemoteSyncMs < REMOTE_REFRESH_MS && lastRemoteSyncMs > 0) return;
    try {
      const remote = await sqlReadAll();
      lastRemoteSyncMs = Date.now();
      writeLocalNotes(remote);
      document.querySelectorAll(".tm-pn-cell").forEach((cell) => {
        const pid = cell.getAttribute("data-project-id");
        if (pid && !cell.querySelector("textarea")) {
          renderCellText(cell, getNote(pid));
        }
      });
    } catch (_err) {
      // keep local cache silently
    }
  }

  async function setNote(projectId, text) {
    const trimmed = text && text.trim() ? text : "";
    const existing = notesCache[projectId] || "";
    if (trimmed === existing) return;

    const next = { ...notesCache };
    if (trimmed) next[projectId] = trimmed; else delete next[projectId];
    writeLocalNotes(next);

    const saveSeq = ++nextSaveSeq;
    latestSaveSeqByProject[projectId] = saveSeq;

    if (!isSqlEnabled()) {
      setHeaderStatus(null);
      return;
    }

    setHeaderStatus(
      "saving",
      trimmed ? "Saving note to SQL..." : "Removing note from SQL..."
    );

    try {
      if (trimmed) await sqlUpsertNote(projectId, trimmed);
      else await sqlDeleteNote(projectId);
      if (latestSaveSeqByProject[projectId] !== saveSeq) return;
      lastRemoteSyncMs = Date.now();
      lastFailedSave = null;
      setHeaderStatus(
        "saved",
        trimmed ? "Saved to SQL" : "Removed from SQL"
      );
    } catch (err) {
      if (latestSaveSeqByProject[projectId] !== saveSeq) return;
      const message = err && err.message ? err.message : "Unknown error";
      lastFailedSave = { projectId, text };
      try {
        console.warn(
          "[Rocketlane Notes] SQL save failed for project",
          projectId,
          "→",
          sqlApiUrl,
          err
        );
      } catch (_ignored) {}
      setHeaderStatus(
        "error",
        trimmed
          ? `Saved locally only. SQL save failed: ${message}. Click the ! for details.`
          : `Removed locally only. SQL delete failed: ${message}. Click the ! for details.`
      );
    }
  }

  function configureSqlInteractive() {
    const current = sqlApiUrl || SQL_API_URL_DEFAULT;
    const url = window.prompt("Toolbox SQL API URL (blank = local-only)", current);
    if (url === null) return;
    sqlApiUrl = url.trim();
    GM_setValue(SQL_API_URL_KEY, sqlApiUrl);
    clearAllSyncStates();
    lastRemoteSyncMs = 0;
    if (isSqlEnabled()) testConnectionInteractive();
    else refreshFromSql(true);
  }

  function isProjectsPage() {
    return /\/projects(\b|\/|\?)/.test(location.pathname + location.search);
  }

  function applyWidthStyles() {
    const total = PINNED_LEFT_BASE + NOTE_WIDTH;
    let s = document.getElementById("tm-pn-width-style");
    if (!s) {
      s = document.createElement("style");
      s.id = "tm-pn-width-style";
      document.head.appendChild(s);
    }
    s.textContent = `
      .ag-pinned-left-cols-container,
      .ag-pinned-left-header,
      .ag-horizontal-left-spacer {
        width: ${total}px !important;
        min-width: ${total}px !important;
        max-width: ${total}px !important;
      }
    `;
    document.querySelectorAll(".tm-pn-cell, .tm-pn-header").forEach((el) => {
      el.style.width = NOTE_WIDTH + "px";
    });
  }

  function ensureStyles() {
    applyWidthStyles();
    if (document.getElementById("tm-pn-style")) return;
    const css = `
      .tm-pn-cell {
        position: absolute;
        top: 0;
        display: flex;
        align-items: center;
        padding: 0 12px;
        height: 100%;
        box-sizing: border-box;
        font: inherit;
        color: inherit;
        border-right: 1px solid var(--table-border-color, #e0e0e0);
        cursor: default;
        overflow: hidden;
        z-index: 2;
        background: inherit;
      }
      .tm-pn-cell:hover {
        background: rgba(15, 98, 254, 0.04);
      }
      .tm-pn-text {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 13px;
        line-height: 1.3;
      }
      .tm-pn-link {
        color: #0f62fe;
        text-decoration: underline;
        cursor: pointer;
      }
      .tm-pn-link:hover {
        color: #0043ce;
        text-decoration: underline;
      }
      .tm-pn-text.tm-pn-empty {
        color: #9aa4b2;
        font-style: italic;
      }
      .tm-pn-textarea {
        flex: 1;
        width: 100%;
        height: 80%;
        padding: 4px 6px;
        border: 1px solid var(--brand-color, #0f62fe);
        border-radius: 4px;
        font: inherit;
        font-size: 13px;
        resize: none;
        outline: none;
        background: white;
        color: #161616;
        white-space: pre-wrap;
        overflow: auto;
        word-break: break-word;
      }
      .tm-pn-editor {
        white-space: pre-wrap;
        word-break: break-word;
      }
      .tm-pn-editor:focus {
        outline: none;
      }
      .tm-pn-editor a {
        color: #0f62fe;
        text-decoration: underline;
        cursor: pointer;
      }
      .tm-pn-editor a:hover {
        color: #0043ce;
      }
      .tm-pn-btn {
        flex: 0 0 auto;
        margin-left: 6px;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        border: 1px solid transparent;
        color: #525252;
        background: rgba(255, 255, 255, 0.6);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.1s ease, background 0.1s ease, border-color 0.1s ease, color 0.1s ease;
        font-size: 16px;
        line-height: 1;
        user-select: none;
      }
      .tm-pn-cell:hover .tm-pn-btn,
      .tm-pn-btn:focus-visible {
        opacity: 1;
      }
      .tm-pn-btn:hover {
        background: rgba(15, 98, 254, 0.12);
        border-color: rgba(15, 98, 254, 0.3);
        color: #0f62fe;
      }
      .tm-pn-btn:active {
        background: rgba(15, 98, 254, 0.2);
      }
      .tm-pn-popover {
        position: fixed;
        z-index: 99999;
        background: white;
        border: 1px solid #c6c6c6;
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        padding: 10px;
        width: min(720px, 70vw);
        height: min(480px, 70vh);
        min-width: 320px;
        min-height: 260px;
        max-width: 95vw;
        max-height: 95vh;
        resize: both;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .tm-pn-popover.tm-pn-popover-maximized {
        resize: none;
      }
      .tm-pn-popover-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: -4px -4px 0 0;
        gap: 8px;
      }
      .tm-pn-popover-hint {
        font-size: 11px;
        color: #9aa4b2;
        user-select: none;
      }
      .tm-pn-popover-max {
        padding: 0 6px !important;
        height: 20px;
        line-height: 18px;
        border: 1px solid transparent !important;
        background: transparent !important;
        color: #525252 !important;
        font-size: 13px !important;
      }
      .tm-pn-popover-max:hover {
        background: rgba(15, 98, 254, 0.1) !important;
        color: #0f62fe !important;
      }
      .tm-pn-popover .tm-pn-editor {
        width: 100%;
        flex: 1 1 auto;
        min-height: 200px;
        box-sizing: border-box;
        padding: 8px;
        border: 1px solid #c6c6c6;
        border-radius: 4px;
        font: inherit;
        font-size: 13px;
        line-height: 1.4;
        outline: none;
        color: #161616;
        background: white;
        overflow: auto;
      }
      .tm-pn-popover .tm-pn-editor:focus {
        border-color: #0f62fe;
      }
      .tm-pn-popover-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
      }
      .tm-pn-popover button {
        padding: 4px 10px;
        border-radius: 4px;
        border: 1px solid #c6c6c6;
        background: white;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        color: #161616;
      }
      .tm-pn-popover button.tm-pn-primary {
        background: #0f62fe;
        border-color: #0f62fe;
        color: white;
      }
      .tm-pn-popover button:hover {
        filter: brightness(0.95);
      }
      .tm-pn-status {
        flex: 0 0 auto;
        margin-left: 6px;
        width: 14px;
        height: 14px;
        display: none;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        line-height: 1;
        border-radius: 50%;
        font-weight: 700;
      }
      .tm-pn-status.tm-pn-saving {
        display: inline-flex;
        background: #e0e0e0;
        color: #525252;
        animation: tm-pn-pulse 1s infinite;
      }
      .tm-pn-status.tm-pn-saved {
        display: inline-flex;
        background: #24a148;
        color: white;
        transition: opacity 0.6s ease;
      }
      .tm-pn-status.tm-pn-saved.tm-pn-fade { opacity: 0; }
      .tm-pn-status.tm-pn-error {
        display: inline-flex;
        background: #da1e28;
        color: white;
      }
      @keyframes tm-pn-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      .tm-pn-cfg {
        margin-left: 6px;
        cursor: pointer;
        color: #9aa4b2;
        font-size: 13px;
        opacity: 0.5;
        user-select: none;
      }
      .tm-pn-cfg:hover { opacity: 1; color: #0f62fe; }
      .tm-pn-resizer {
        position: absolute;
        top: 0;
        right: -3px;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        z-index: 5;
      }
      .tm-pn-resizer:hover,
      .tm-pn-resizing .tm-pn-resizer {
        background: rgba(15, 98, 254, 0.35);
      }
      body.tm-pn-resizing,
      body.tm-pn-resizing * {
        cursor: col-resize !important;
        user-select: none !important;
      }
      .tm-pn-header {
        position: absolute;
        top: 0;
        height: 100%;
        display: flex;
        align-items: center;
        padding: 0 12px;
        box-sizing: border-box;
        font-weight: 600;
        font-size: 12px;
        color: var(--text-secondary, #525252);
        border-right: 1px solid var(--table-border-color, #e0e0e0);
        z-index: 2;
        background: inherit;
      }
    `;
    const style = document.createElement("style");
    style.id = "tm-pn-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function getProjectIdFromRow(row) {
    const id = row.getAttribute("row-id");
    if (id) return id;
    const link = row.querySelector('a[href*="/projects/"]');
    if (link) {
      const m = link.getAttribute("href").match(/\/projects\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function getProjectNameCell(row) {
    return (
      row.querySelector('[col-id="projectName"]') ||
      row.querySelector('[col-id="project_name"]') ||
      row.querySelector('[col-id="name"]')
    );
  }

  function getCellRight(cell) {
    const left = parseFloat(cell.style.left) || 0;
    const width = parseFloat(cell.style.width) || cell.offsetWidth || 0;
    return left + width;
  }

  function shiftSiblingsAfter(parent, fromLeft) {
    const cells = parent.querySelectorAll(':scope > [col-id]');
    cells.forEach((c) => {
      if (c.classList.contains("tm-pn-cell")) return;
      const left = parseFloat(c.style.left);
      if (!isNaN(left) && left >= fromLeft) {
        if (!c.hasAttribute("data-tm-orig-left")) {
          c.setAttribute("data-tm-orig-left", String(left));
        }
        const orig = parseFloat(c.getAttribute("data-tm-orig-left"));
        c.style.left = orig + NOTE_WIDTH + "px";
      }
    });
  }

  function widenContainer(container) {
    if (!container) return;
    const w = parseFloat(container.style.width);
    if (!isNaN(w)) {
      if (!container.hasAttribute("data-tm-orig-width")) {
        container.setAttribute("data-tm-orig-width", String(w));
      }
      const orig = parseFloat(container.getAttribute("data-tm-orig-width"));
      container.style.width = orig + NOTE_WIDTH + "px";
    }
  }

  function startEdit(cellEl, projectId) {
    if (cellEl.querySelector(".tm-pn-editor")) return;
    const current = getNote(projectId);
    cellEl.innerHTML = "";
    const ed = createNoteEditor(current);
    ed.classList.add("tm-pn-textarea");
    cellEl.appendChild(ed);
    ed.focus();
    const selAll = document.createRange();
    selAll.selectNodeContents(ed);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(selAll);

    let cancelled = false;

    ed.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        ed.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelled = true;
        ed.blur();
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        document.execCommand("insertLineBreak");
      }
      e.stopPropagation();
    });

    ed.addEventListener("click", (e) => e.stopPropagation());

    ed.addEventListener("blur", () => {
      const val = cancelled ? current : getEditorText(ed);
      if (!cancelled) setNote(projectId, val);
      renderCellText(cellEl, val);
    });
  }

  function appendTextWithLinks(container, text, opts) {
    const options = opts || {};
    const re = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index))
        );
      }

      let raw = match[0];
      let trailing = "";
      while (raw.length && /[).,;:!?\]]/.test(raw[raw.length - 1])) {
        trailing = raw[raw.length - 1] + trailing;
        raw = raw.slice(0, -1);
      }
      if (!raw) {
        container.appendChild(document.createTextNode(match[0]));
        lastIndex = re.lastIndex;
        continue;
      }

      const href = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = raw;
      a.className = "tm-pn-link";
      a.title = href;
      if (options.editor) {
        a.addEventListener("click", (e) => {
          if (e.altKey) return;
          e.preventDefault();
          e.stopPropagation();
          window.open(href, "_blank", "noopener,noreferrer");
        });
      } else {
        a.addEventListener("mousedown", (e) => e.stopPropagation());
        a.addEventListener("click", (e) => e.stopPropagation());
      }
      container.appendChild(a);

      if (trailing) container.appendChild(document.createTextNode(trailing));
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function getEditorText(root) {
    let out = "";
    function walk(node) {
      if (node.nodeType === 3) {
        out += node.nodeValue;
      } else if (node.nodeName === "BR") {
        out += "\n";
      } else if (node.nodeType === 1) {
        const isBlock =
          node.nodeName === "DIV" ||
          node.nodeName === "P" ||
          node.nodeName === "LI";
        if (isBlock && out.length && !out.endsWith("\n")) out += "\n";
        for (const c of node.childNodes) walk(c);
      }
    }
    for (const c of root.childNodes) walk(c);
    return out;
  }

  function getEditorCaretOffset(root) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (range.endContainer !== root && !root.contains(range.endContainer)) return null;
    let offset = 0;
    let done = false;
    function countAll(node) {
      if (node.nodeType === 3) offset += node.nodeValue.length;
      else if (node.nodeName === "BR") offset += 1;
      else if (node.nodeType === 1) for (const c of node.childNodes) countAll(c);
    }
    function walk(node) {
      if (done) return;
      if (node === range.endContainer) {
        if (node.nodeType === 3) {
          offset += range.endOffset;
        } else {
          for (let i = 0; i < range.endOffset && i < node.childNodes.length; i++) {
            countAll(node.childNodes[i]);
          }
        }
        done = true;
        return;
      }
      if (node.nodeType === 3) offset += node.nodeValue.length;
      else if (node.nodeName === "BR") offset += 1;
      else if (node.nodeType === 1) {
        for (const c of node.childNodes) {
          walk(c);
          if (done) return;
        }
      }
    }
    walk(root);
    return done ? offset : null;
  }

  function setEditorCaretOffset(root, offset) {
    let remaining = offset;
    let targetNode = null;
    let targetOffset = 0;
    function walk(node) {
      if (targetNode) return;
      if (node.nodeType === 3) {
        const len = node.nodeValue.length;
        if (remaining <= len) {
          targetNode = node;
          targetOffset = remaining;
          return;
        }
        remaining -= len;
      } else if (node.nodeName === "BR") {
        if (remaining === 0) {
          const parent = node.parentNode;
          targetNode = parent;
          targetOffset = Array.prototype.indexOf.call(parent.childNodes, node);
          return;
        }
        remaining -= 1;
      } else if (node.nodeType === 1) {
        for (const c of node.childNodes) {
          walk(c);
          if (targetNode) return;
        }
      }
    }
    walk(root);
    if (!targetNode) {
      targetNode = root;
      targetOffset = root.childNodes.length;
    }
    try {
      const range = document.createRange();
      range.setStart(targetNode, targetOffset);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_e) {}
  }

  function renderEditorContent(root, text) {
    root.innerHTML = "";
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) root.appendChild(document.createElement("br"));
      appendTextWithLinks(root, line, { editor: true });
    });
  }

  function createNoteEditor(initialText) {
    const ed = document.createElement("div");
    ed.className = "tm-pn-editor";
    ed.setAttribute("contenteditable", "true");
    ed.setAttribute("spellcheck", "false");
    ed.setAttribute(
      "title",
      "Click a URL to open it in a new tab. Hold Alt/Option to place the caret inside the URL instead."
    );
    renderEditorContent(ed, initialText || "");

    ed.addEventListener("paste", (e) => {
      e.preventDefault();
      const data =
        (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
      document.execCommand("insertText", false, data);
    });

    ed.addEventListener("drop", (e) => {
      e.preventDefault();
      const data =
        (e.dataTransfer && e.dataTransfer.getData("text/plain")) || "";
      if (data) document.execCommand("insertText", false, data);
    });

    let rerendering = false;
    let scheduled = false;
    const scheduleRerender = () => {
      if (rerendering || scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        const text = getEditorText(ed);
        const caret = getEditorCaretOffset(ed);
        rerendering = true;
        renderEditorContent(ed, text);
        rerendering = false;
        if (caret != null) setEditorCaretOffset(ed, caret);
      });
    };
    ed.addEventListener("input", scheduleRerender);

    return ed;
  }

  function renderCellText(cellEl, text) {
    cellEl.innerHTML = "";
    const span = document.createElement("span");
    if (text && text.trim()) {
      span.className = "tm-pn-text";
      appendTextWithLinks(span, text);
    } else {
      span.className = "tm-pn-text tm-pn-empty";
      span.textContent = "Add note…";
    }
    cellEl.appendChild(span);

    const edit = document.createElement("span");
    edit.className = "tm-pn-btn tm-pn-edit";
    edit.title = "Edit note";
    edit.textContent = "✎";
    edit.addEventListener("mousedown", (e) => e.stopPropagation());
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      const projectId = cellEl.getAttribute("data-project-id");
      startEdit(cellEl, projectId);
    });
    cellEl.appendChild(edit);

    const expand = document.createElement("span");
    expand.className = "tm-pn-btn tm-pn-expand";
    expand.title = "Expand";
    expand.textContent = "⤢";
    expand.addEventListener("mousedown", (e) => e.stopPropagation());
    expand.addEventListener("click", (e) => {
      e.stopPropagation();
      const projectId = cellEl.getAttribute("data-project-id");
      openPopover(cellEl, projectId);
    });
    cellEl.appendChild(expand);
  }

  let activePopover = null;
  function closePopover(save) {
    if (!activePopover) return;
    const { el, projectId, cellEl, ed, originalText } = activePopover;
    const val = save ? getEditorText(ed) : originalText;
    if (save) setNote(projectId, val);
    el.remove();
    document.removeEventListener("mousedown", activePopover.outsideHandler, true);
    activePopover = null;
    renderCellText(cellEl, save ? val : getNote(projectId));
  }

  function openPopover(cellEl, projectId) {
    if (activePopover) closePopover(false);
    const rect = cellEl.getBoundingClientRect();
    const current = getNote(projectId);

    const el = document.createElement("div");
    el.className = "tm-pn-popover";

    const toolbar = document.createElement("div");
    toolbar.className = "tm-pn-popover-toolbar";

    const hint = document.createElement("span");
    hint.className = "tm-pn-popover-hint";
    hint.textContent = "Click URLs to open • Alt+click to edit";
    toolbar.appendChild(hint);

    const maximize = document.createElement("button");
    maximize.type = "button";
    maximize.className = "tm-pn-popover-max";
    maximize.title = "Maximize / restore (Alt+Enter)";
    maximize.textContent = "⤢";
    toolbar.appendChild(maximize);
    el.appendChild(toolbar);

    const ed = createNoteEditor(current);
    el.appendChild(ed);

    const actions = document.createElement("div");
    actions.className = "tm-pn-popover-actions";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      closePopover(false);
    });
    const save = document.createElement("button");
    save.className = "tm-pn-primary";
    save.textContent = "Save";
    save.addEventListener("click", (e) => {
      e.stopPropagation();
      closePopover(true);
    });
    actions.appendChild(cancel);
    actions.appendChild(save);
    el.appendChild(actions);

    document.body.appendChild(el);

    let isMaximized = false;
    const position = () => {
      const popW = el.offsetWidth;
      const popH = el.offsetHeight;
      let left = rect.left;
      let top = rect.bottom + 4;
      if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
      if (top + popH > window.innerHeight - 8) top = rect.top - popH - 4;
      if (left < 8) left = 8;
      if (top < 8) top = 8;
      el.style.left = left + "px";
      el.style.top = top + "px";
    };

    const toggleMaximize = () => {
      isMaximized = !isMaximized;
      if (isMaximized) {
        el.classList.add("tm-pn-popover-maximized");
        const w = Math.min(1200, Math.floor(window.innerWidth * 0.9));
        const h = Math.floor(window.innerHeight * 0.85);
        el.style.width = w + "px";
        el.style.height = h + "px";
        el.style.left = Math.floor((window.innerWidth - w) / 2) + "px";
        el.style.top = Math.floor((window.innerHeight - h) / 2) + "px";
        maximize.textContent = "⤡";
        maximize.title = "Restore (Alt+Enter)";
      } else {
        el.classList.remove("tm-pn-popover-maximized");
        el.style.width = "";
        el.style.height = "";
        position();
        maximize.textContent = "⤢";
        maximize.title = "Maximize (Alt+Enter)";
      }
      ed.focus();
    };

    maximize.addEventListener("mousedown", (e) => e.stopPropagation());
    maximize.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMaximize();
    });

    position();

    ed.focus();
    setEditorCaretOffset(ed, current.length);

    ed.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover(false);
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        closePopover(true);
      } else if (e.key === "Enter" && e.altKey) {
        e.preventDefault();
        toggleMaximize();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        document.execCommand("insertLineBreak");
      }
      e.stopPropagation();
    });

    const outsideHandler = (e) => {
      if (!el.contains(e.target)) closePopover(true);
    };
    document.addEventListener("mousedown", outsideHandler, true);

    activePopover = { el, projectId, cellEl, ed, originalText: current, outsideHandler };
  }

  function injectCellIntoRow(row) {
    if (row.querySelector(".tm-pn-cell")) return;
    const nameCell = getProjectNameCell(row);
    if (!nameCell) return;
    const projectId = getProjectIdFromRow(row);
    if (!projectId) return;

    const insertLeft = getCellRight(nameCell);
    shiftSiblingsAfter(nameCell.parentElement, insertLeft);

    const cell = document.createElement("div");
    cell.className = "tm-pn-cell";
    cell.setAttribute("data-tm-note", "1");
    cell.setAttribute("data-project-id", projectId);
    cell.style.left = insertLeft + "px";
    cell.style.width = NOTE_WIDTH + "px";
    cell.style.height = nameCell.style.height || "100%";

    renderCellText(cell, getNote(projectId));

    nameCell.parentElement.appendChild(cell);
  }

  function injectHeaderInto(headerRow) {
    if (!headerRow) return;
    if (headerRow.querySelector(".tm-pn-header")) return;
    const nameHeader =
      headerRow.querySelector('[col-id="projectName"]') ||
      headerRow.querySelector('[col-id="project_name"]') ||
      headerRow.querySelector('[col-id="name"]');
    if (!nameHeader) return;

    const insertLeft = getCellRight(nameHeader);
    shiftSiblingsAfter(headerRow, insertLeft);

    const h = document.createElement("div");
    h.className = "tm-pn-header";
    h.setAttribute("data-tm-note-header", "1");
    h.style.left = insertLeft + "px";
    h.style.width = NOTE_WIDTH + "px";
    h.style.height = nameHeader.style.height || "100%";

    const label = document.createElement("span");
    label.className = "tm-pn-label";
    label.textContent = "Note";
    h.appendChild(label);

    const test = document.createElement("span");
    test.className = "tm-pn-cfg";
    test.title = "Test SQL connection (/health)";
    test.textContent = "⚡";
    test.addEventListener("mousedown", (e) => e.stopPropagation());
    test.addEventListener("click", (e) => {
      e.stopPropagation();
      testConnectionInteractive();
    });
    h.appendChild(test);

    const cfg = document.createElement("span");
    cfg.className = "tm-pn-cfg";
    cfg.title = "Configure SQL backend";
    cfg.textContent = "⚙";
    cfg.addEventListener("mousedown", (e) => e.stopPropagation());
    cfg.addEventListener("click", (e) => {
      e.stopPropagation();
      configureSqlInteractive();
    });
    h.appendChild(cfg);

    const resizer = document.createElement("div");
    resizer.className = "tm-pn-resizer";
    resizer.title = "Drag to resize";
    resizer.addEventListener("mousedown", startResize);
    h.appendChild(resizer);

    headerRow.appendChild(h);
    renderHeaderStatus();
  }

  function startResize(e) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = NOTE_WIDTH;
    document.body.classList.add("tm-pn-resizing");

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + dx));
      NOTE_WIDTH = next;
      applyWidthStyles();
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      document.body.classList.remove("tm-pn-resizing");
      saveWidth(NOTE_WIDTH);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  }

  function applyToGrid() {
    if (!isProjectsPage()) return;
    const grid = document.querySelector(".ag-root-wrapper");
    if (!grid) return;

    ensureStyles();

    const headerRows = document.querySelectorAll(
      ".ag-header-row-column, .ag-header-row"
    );
    headerRows.forEach(injectHeaderInto);

    const rows = document.querySelectorAll('.ag-row, [role="row"][row-id]');
    rows.forEach(injectCellIntoRow);

    const containers = document.querySelectorAll(
      ".ag-center-cols-container, .ag-center-cols-viewport > .ag-center-cols-container, .ag-pinned-left-cols-container, .ag-header-container, .ag-pinned-left-header"
    );
    containers.forEach((c) => {
      if (c.querySelector(".tm-pn-cell, .tm-pn-header")) widenContainer(c);
    });
  }

  function startObserver() {
    if (observer) return;
    let pending = false;
    const queue = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        applyToGrid();
      });
    };
    observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", queue);
    window.addEventListener("hashchange", queue);
  }

  applyToGrid();
  startObserver();
  refreshFromSql(true);
  }
})();
