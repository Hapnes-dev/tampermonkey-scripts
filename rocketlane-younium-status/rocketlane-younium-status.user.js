// ==UserScript==
// @name         Rocketlane improvements
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.14.20
// @description  Rocketlane improvements in one script (v1.14.0: home PROJECTS — two panels under Overdue: Project Owner grouped by owner for on-project rows, In progress member-not-owner; except Completed): Younium order + subscription and Oneflow signing status chips with detail modals on project pages (same verdict engines as the Project Progress Tracker), PPT-style project action buttons (Files pill opens a project-files popover), and a Fetch URLs control left of Present, the "Delivery to service" handover wizard on the Handover to service task card, a hideable Gantt calendar with a toggle button, a floating two-conversation chat panel on the timeline, and a writable Note column on the Projects list (toolbox SQL persistence, clickable links — off by default since v1.4.2).
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
// @connect      s3.us-east-1.amazonaws.com
// @connect      s3.amazonaws.com
// @connect      amazonaws.com
// @connect      assets.rocketlane.com
// @connect      d1vtr0p8bkmfca.cloudfront.net
// @connect      *
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
 *  1c. Project action buttons (section 5c), ported from the tracker's project
 *     header link row. Dark/light pills left of Rocketlane's Responsible
 *     filter: Zendesk, Oneflow (Order/Subscription), Younium (Order/Subscription),
 *     HubSpot, Rocketlane, Files, Order info, Add category (order-info / presets / native templates), PANG, BAF. Also a PPT Find-style
 *     "🔎 Fetch URLs" button left of Present that opens a PPT-style URL chooser
 *     (scored Find with signal chips + match %, then select/save), then saves
 *     clickable Attach-links anchors into the IQC task
 *     description. Edit/Remove stay
 *     tracker-only and are not ported. Mount target is the plan/tasks
 *     action-bar Secondary row (label text is "Responsible").
 *  1e. Zendesk cases (v1.10.4): renames native Project updates tab + settings
 *     list labels, mounts #rlZendeskCasesPanel with full PPT Zendesk-tasks UI
 *     (search/hydrate/
 *     thread/reply) via zendeskApiRequest — no window.ZendeskBridge.
 *  1d. Delivery to service (section 8), ported from the tracker's handover
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
      /* Action chip (Delivery to service). The verdict tints above all mean
         "this is the status we found", and the gray default means "unknown" —
         borrowing it for a button rendered 66%-opacity slate on near-white,
         which sat at roughly 4:1 and looked disabled next to the saturated
         status chips. This is a deliberate action colour instead: same indigo
         as the button on the task card, so both entry points read as one thing,
         and heavier text because it is clickable rather than informational. */
      .ynNavBtn.yn-action {
        background: rgba(99, 102, 241, 0.12); color: #3730a3;
        border-color: rgba(99, 102, 241, 0.35); font-weight: 600;
      }
      .ynNavBtn.yn-action.yn-on-dark {
        background: rgba(129, 140, 248, 0.18); color: #c7d2fe;
        border-color: rgba(129, 140, 248, 0.40);
      }
      /* Hover lifts the chip the way the tracker's does: a brightness bump and
         a neutral fill over the tint (declared after the tints on purpose). */
      .ynNavBtn:hover { filter: brightness(1.15); background: rgba(15, 23, 42, 0.09); }
      .ynNavBtn.yn-on-dark:hover { background: rgba(255, 255, 255, 0.10); }
      .ynNavBtn.yn-gray:hover { border-color: rgba(15, 23, 42, 0.12); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
      .ynNavBtn.yn-gray.yn-on-dark:hover { border-color: rgba(255, 255, 255, 0.10); }
      /* Declared after the generic hover so the action chip keeps its own fill
         instead of flattening to the neutral one. */
      .ynNavBtn.yn-action:hover {
        filter: none; background: rgba(99, 102, 241, 0.20);
        border-color: rgba(99, 102, 241, 0.55); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.10);
        color: #3730a3;
      }
      .ynNavBtn.yn-action.yn-on-dark:hover {
        background: rgba(129, 140, 248, 0.28); border-color: rgba(129, 140, 248, 0.60);
        color: #e0e7ff;
      }
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

  /** Rocketlane page luminance — independent of OS prefers-color-scheme. */
  function rlPageLooksDark() {
    try {
      const c = ynEffectiveBg(document.body || document.documentElement);
      const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
      return lum < 0.5;
    } catch (_) {
      return false;
    }
  }

  function rlApplyPopoverSurface(el) {
    if (!el) return;
    el.classList.toggle("rlPopoverOnDark", rlPageLooksDark());
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
    if (rlHpIsHomePath(location.pathname)) {
      try { rlHpEnsureHomePanel(); } catch (_) {}
      return;
    }
    try { rlHpTeardownHomePanel(); } catch (_) {}
    if (!/^\/projects\/\d+/.test(location.pathname)) return; // only on project pages
    injectStyles();
    // Action bar only needs the plan/tasks Responsible row — do not wait for the
    // tab chips / All-files row, or a slow nav paint blocks the pills for seconds.
    try { rlEnsureProjectActionBar(); } catch (_) {}
    try { rlEnsureAutoFetchButton(); } catch (_) {}
    try { rlZdEnsureTabAndPanel(); } catch (_) {}
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
    try { refreshDeliveryChipForCurrentProject(); } catch (_) {}
    try { dtsEnsureCardButtons(); } catch (_) {}
  }

  let ensureTimer = null;
  function scheduleEnsure() {
    // The card button can't rely on the nav-chip early-out below — the board
    // keeps mounting and unmounting card footers long after the chips settle.
    dtsScheduleCardPass();
    // Home panel: keep ensuring until under Overdue (early MAIN park is not done).
    if (rlHpIsHomePath(location.pathname)) {
      if (!rlHpHomePanelNeedsRemount()) return;
      if (ensureTimer) return;
      ensureTimer = setTimeout(() => { ensureTimer = null; try { ensure(); } catch (_) {} }, 120);
      return;
    }
    // Steady-state early-out: once the button is present + connected there's
    // nothing for the mutation observer to do (route changes are handled by the
    // history hooks below), so we never schedule work on the SPA's hot path.
    const btn = document.getElementById("ynNavBtn");
    const ofBtn = document.getElementById("ofNavBtn");
    const dtsBtn = document.getElementById("dtsNavBtn");
    const actionBar = document.getElementById("rlProjectActionBar");
    // Never treat "mount not found yet" as done — Responsible row often hydrates
    // after the nav chips, and a no-mount early-out stalled the pills for 1.5s+.
    if (btn && btn.isConnected && ofBtn && ofBtn.isConnected && dtsBtn && dtsBtn.isConnected &&
        actionBar && actionBar.isConnected) {
      // Do NOT call rlZdEnsureTabAndPanel here — it used to rewrite a <style>
      // tag (and re-hide nodes) on every SPA mutation → infinite observer loop /
      // frozen Rocketlane. Zendesk cases is driven by route change + tab click.
      return;
    }
    if (ensureTimer) return;
    ensureTimer = setTimeout(() => { ensureTimer = null; try { ensure(); } catch (_) {} }, 120);
  }

  // Observe the DOM only to (re-)inject the button when it's missing — the
  // early-out above stops it from doing work once the button is in place.
  const obs = new MutationObserver(scheduleEnsure);
  try { obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}

  // Rocketlane is a client-routed SPA — re-evaluate on every navigation so the
  // button re-injects (if the nav was rebuilt) and re-points at the new project.
  function onRouteChange() {
    try {
      rlProjectLinksCache.clear();
      delete document.documentElement.dataset.rlPabNoMount;
      rlFilesClosePopover();
      rlOrderInfoClosePopover();
      // Only tear down Zendesk panel when leaving status-updates. Tearing down on
      // the way *in* raced the SPA paint and forced a second tab click.
      if (!/\/projects\/\d+\/(?:[^/]+\/)?(?:status-)?(?:project-)?updates(?:\/|$)/i.test(location.pathname) &&
          !/\/projects\/\d+\/.*updates/i.test(location.pathname)) {
        rlZdTeardownPanel();
      }
    } catch (_) {}
    // Kick action bar + chips immediately; Responsible row often paints within ~100ms.
    [0, 50, 150, 400, 900].forEach((d) => setTimeout(() => { try { ensure(); } catch (_) {} }, d));
    try {
      const m = location.pathname.match(/^\/projects\/(\d+)/);
      if (m) void rlLoadProjectLinks(m[1]);
    } catch (_) {}
  }
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

  // ── Attachment transport (Files popover v1.9.0) — no window.RocketlaneBridge ──
  async function gmRocketlaneFetchAttachment(attachmentId) {
    const id = encodeURIComponent(attachmentId);
    const candidates = [
      "/attachments/" + id,
      "/attachments/" + id + "/download",
      "/attachments/" + id + "/url",
    ];
    let lastErr = null;
    for (const path of candidates) {
      try {
        const data = await gmRocketlaneGet(path);
        const att = data?.attachment ?? data?.data?.attachment ?? data;
        if (att && (att.downloadUrl || att.location || att.url)) {
          if (!att.downloadUrl && att.url) att.downloadUrl = att.url;
          return att;
        }
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("No attachment endpoint returned a usable URL");
  }

  /** Blob download: fresh signed URL first, then GM GET without api-key. */
  function gmRocketlaneDownloadAttachmentBlob(attachmentId) {
    return (async () => {
      const att = await gmRocketlaneFetchAttachment(attachmentId);
      const url = String(att?.downloadUrl ?? att?.location ?? "").trim();
      if (!url) throw new Error("Attachment has no downloadUrl/location.");
      const fileName = String(att?.name ?? "download.bin");
      const mimeType = String(att?.mimeType ?? att?.contentType ?? "application/octet-stream");
      // SECURITY: never attach api-key to the signed CDN/S3 URL host.
      return await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          responseType: "blob",
          timeout: 120000,
          onload: (res) => {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error("Download failed HTTP " + res.status));
              return;
            }
            resolve({ blob: res.response, fileName, mimeType });
          },
          onerror: () => reject(new Error("Network error while downloading attachment")),
          ontimeout: () => reject(new Error("Attachment download timed out")),
        });
      });
    })();
  }

  function gmRocketlaneUploadAttachment(projectId, file, opts) {
    return new Promise((resolve, reject) => {
      const apiKey = rlReadApiKey();
      if (!apiKey) {
        reject(new Error("No Rocketlane api-key in this page yet — reload once logged in."));
        return;
      }
      const fileName = (file && (file.name || file.fileName)) || "upload.bin";
      const folderId = opts && opts.folderId != null ? Number(opts.folderId) : null;
      if (folderId == null || !Number.isFinite(folderId)) {
        reject(new Error("Upload blocked: General Shared Files folder id missing (refusing orphan attachment)."));
        return;
      }
      const publicVisibility = opts && typeof opts.publicVisibility === "boolean"
        ? opts.publicVisibility
        : false;
      const attachmentReq = {
        name: fileName,
        publicVisibility: publicVisibility,
        projectId: Number(projectId),
        sourceType: "FOLDER",
        sourceId: folderId,
      };
      const requestPayload = { attachment: attachmentReq };
      const fd = new FormData();
      fd.append("file", file, fileName);
      fd.append("request", new Blob([JSON.stringify(requestPayload)], { type: "application/json" }));

      GM_xmlhttpRequest({
        method: "POST",
        url: ROCKETLANE_API + "/attachments",
        // Do NOT set Content-Type — Tampermonkey sets multipart boundary.
        headers: { "api-key": apiKey, accept: "application/json" },
        data: fd,
        timeout: 60000,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error("Upload failed HTTP " + res.status + ": " + (res.responseText || "").slice(0, 200)));
            return;
          }
          let att;
          try {
            const j = JSON.parse(res.responseText || "{}");
            att = j?.attachment ?? j?.data?.attachment ?? j;
            if (!att?.attachmentId) {
              reject(new Error("Upload succeeded but no attachmentId in response"));
              return;
            }
          } catch (e) {
            reject(new Error("Could not parse upload response: " + (e && e.message ? e.message : e)));
            return;
          }
          GM_xmlhttpRequest({
            method: "POST",
            url: ROCKETLANE_API + "/projects/" + encodeURIComponent(projectId) +
              "/folders/" + encodeURIComponent(folderId) + "/attachments/link",
            headers: { "api-key": apiKey, accept: "application/json", "content-type": "application/json" },
            data: JSON.stringify([att.attachmentId]),
            timeout: 30000,
            onload: (lres) => {
              if (lres.status < 200 || lres.status >= 300) {
                reject(new Error("Folder link failed HTTP " + lres.status + ": " + (lres.responseText || "").slice(0, 200)));
                return;
              }
              resolve(att);
            },
            onerror: () => reject(new Error("Network error during folder link")),
            ontimeout: () => reject(new Error("Folder link timed out")),
          });
        },
        onerror: () => reject(new Error("Network error during attachment upload")),
        ontimeout: () => reject(new Error("Attachment upload timed out")),
      });
    });
  }

  async function gmRocketlaneFetchProjectAttachments(projectId) {
    const data = await gmRocketlaneGet("/attachments/project/" + encodeURIComponent(projectId));
    const list = Array.isArray(data) ? data : Object.values(data || {}).filter((v) => v && typeof v === "object");
    return list
      .filter((entry) => entry && entry.attachment)
      .map((entry) => ({
        ...entry.attachment,
        _source: entry.source ?? null,
        _link: entry.link ?? null,
      }));
  }

  async function gmRocketlaneFetchProjectFolders(projectId) {
    const data = await gmRocketlaneGet("/projects/" + encodeURIComponent(projectId) + "/folders");
    const folders = Array.isArray(data?.value) ? data.value
      : Array.isArray(data) ? data
      : [];
    const out = [];
    for (const f of folders) {
      const folderName = String(f?.folderName ?? "Files").trim();
      const isPrivate = !!f?.isPrivate;
      const atts = Array.isArray(f?.attachments) ? f.attachments : [];
      for (const a of atts) {
        out.push({
          ...a,
          _folder: folderName,
          _isPrivate: isPrivate,
          _source: folderName,
          _link: null,
        });
      }
    }
    return { folders, attachments: out };
  }


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
    const boot = setInterval(() => {
      tries += 1;
      ensure();
      if ((document.getElementById("ynNavBtn") && document.getElementById("rlProjectActionBar")) ||
          (rlHpIsHomePath(location.pathname) && !rlHpHomePanelNeedsRemount()) ||
          tries > 80) clearInterval(boot);
    }, 150);
    // Prefetch project links as soon as the URL has an id — pills patch in when
    // the Responsible row appears instead of waiting on the API then.
    try {
      const m = location.pathname.match(/^\/projects\/(\d+)/);
      if (m) void rlLoadProjectLinks(m[1]);
    } catch (_) {}
    window.addEventListener("scroll", dtsScheduleCardPass, { passive: true, capture: true });
    setInterval(() => {
      if (/^\/projects\/\d+/.test(location.pathname)) dtsScheduleCardPass();
    }, 1000);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5c. Project action buttons — PPT header link row, left of Responsibility.
  //     Edit / Remove stay tracker-only and are intentionally not ported.
  // ════════════════════════════════════════════════════════════════════════

  const RL_PANG_ICON =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAYAAAByDd+UAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAATRSURBVEhLtc97bFNlGAZw1EDPOXQX2dZdupWuO73Tde0udK2wURwDZYMxicxFHEZGWLhm0RgzNg0xYiAocSASY0IMGNRoDBBjwlAkEjH8AwznDXo9Pd06WLe169adnscMssR9KDe3X9I0eZ/3e96cWbP+h77Guix+TdVKcj5jPOXGNzmbvpOczwjvvh1U0KwM+0rUB8lsRngcpm0oVMBbqjlMZtOO69hI+0xKf1yfA4+VPUbm085XptseM+RhUJ8Dr5U9Seb3xC23b7llM+wKVds1ZPZv+NZGxqNWBgYWpyOyWAaPge0id+4p4DCn81b24ohJgUCh8qe+hbq28Ap7Mbk3yV2ib42yeRjemYRYbTrcOvYiuXNf3Z+3z/YXqbpglCNqkKPXqIBfq+oOWPT7Q5UWp7hvBzW561Ur+bBdhvFOCiNr0uDWsFentj0gV3u7JGBhz0S1cnBWGSIr0xErzsFNjQI+Vun2GjWHfGb1kf78XAxuSobw4RxEG1LhUatcZNcET+3T2QA5JXAdHTRfxJ6L6uQYaErB2F4Kw1uTMLx6HmKOLAywueBKZYi/TyPxJYVoUzJcrJKfeNu3qDqLs5tqb5Wq94dKtZe4anvt/e7d1t3SMjdYyJ6PqOQIv5wC4eM5EI5LMLafQmSnFJGtUghfMMAFGsPNUtzIyYt5zapLXJl8KGbMBYqU8JbpWsjeewpt2CANmgrO908c3ZiCxCkK4mUa4vcUhM8oJH5mIF6gEHl1Lm41pkJslSJcmYZ+nWLAY7fUkH0PJPj2NllAUxDg5DkYbE6C8LUEYg8FsYeGeI1G4iKD+Cc0xt+TYKApGbwyGz616s9gkW0pzuIJsu8/8dUOQ6hEvS9gnH+9t1I2PrQ5GbG3aMQPUUj8wkC8QkO8zEDsZm7/C98wGPuIRrSDQeSlFIxUZSNoUfUEdYVtXv2yArL/LsHl5c4+q/orzpDHDy7OQeLFNAxtT8LoXgbCdzTEX5k7vysMhDMMEmdpiGcoJE5IIByWYPwDCbCbAZqfRL9TNh4sUZ7iFxqf969aOo+8NcUfpw/M6S222X060wGuIA/RbdI75b9PHGEg/jYX458yGNqUhP66VAjr0pBYlwFhbSZi9ZkI18nQWyVD0JKLgDl/MGQznORrK58h79zFVWqrjpTlYmwPDfEqjcRpGqPtDITjNMRzFIa3JMGtUAgeQ+GeG+oFzR596Vq3ptzpzrNZPAVLVHxdXQbf2sqI9fUU31jFkP13cWn1R4RlGRCOUUh00Yi8xiBcnIWx+nmIH5RgvFOCWEU23GZLI/n2kbgKVD1j61MhHJVgZDeNiDUTLpb91q1hfxCcWRDfoRBvSYa7QHGju719Nvn+ofhXr1B79fMTo29IMfoujTFHFvxq9sfJ3GcofD1UqojglWTESrLhtZlfmNrwkFwWS9OoIwexPTRGl2SC07BXPZsbUqfsFFdogxbNSVjk8Bcqr/0ze2geg/ZovCYDozVp4FmVz79qWS65MylgM6y/aVUNcYse8SuBE4+7FuT/FTNlotcwP3zdudBE7pDcNYuU3ApHA9raHiOz+3LXOvX9xjzcNCjiroriCjKfdt5i7RYU5cPzlOk5MpsRXqumy23V7CLnMyLc8Gwqv7R8AzmfDn8DSod92BfeIbEAAAAASUVORK5CYII=";

  const rlProjectLinksCache = new Map(); // rlProjectId -> links object
  const rlProjectLinksInflight = new Map();
  let rlActionBarGen = 0;

  function rlFavicon(domain) {
    return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=32";
  }

  function rlClassifyLinkUrl(raw) {
    const s = String(raw || "").trim();
    if (!s || !/^https?:\/\//i.test(s)) return null;
    let u;
    try { u = new URL(s); } catch (_) { return null; }
    const host = u.hostname.toLowerCase();
    const path = u.pathname || "";
    if (/(?:^|\.)oneflow\.com$/i.test(host)) {
      let m = path.match(/\/(?:documents|agreements)\/(\d+)/i);
      if (m) return { platform: "oneflow", recordId: m[1], recordType: "agreement", url: s };
      m = path.match(/\/(?:c\/\d+\/)?documents?\/(\d+)/i);
      if (m) return { platform: "oneflow", recordId: m[1], recordType: "agreement", url: s };
      return { platform: "oneflow", recordId: "", recordType: "unknown", url: s };
    }
    if (/(?:^|\.)hubspot\.com$/i.test(host)) {
      let m = path.match(/\/record\/0-3\/(\d+)/i);
      if (m) return { platform: "hubspot", recordId: m[1], recordType: "deal", url: s };
      m = path.match(/\/deal\/(\d+)/i);
      if (m) return { platform: "hubspot", recordId: m[1], recordType: "deal", url: s };
      return { platform: "hubspot", recordId: "", recordType: "unknown", url: s };
    }
    if (/(?:^|\.)younium\.com$/i.test(host)) {
      let m = path.match(/\/orders\/([\w-]+)/i);
      if (m) return { platform: "younium", recordId: m[1], recordType: "order", url: s };
      m = path.match(/\/quotes\/([\w-]+)/i);
      if (m) return { platform: "younium", recordId: m[1], recordType: "quote", url: s };
      return { platform: "younium", recordId: "", recordType: "unknown", url: s };
    }
    if (/(?:^|\.)zendesk\.com$/i.test(host)) {
      const m = path.match(/\/(?:agent\/)?tickets\/(\d+)/i);
      if (m) return { platform: "zendesk", recordId: m[1], recordType: "ticket", url: s };
      return { platform: "zendesk", recordId: "", recordType: "unknown", url: s };
    }
    if (/(?:^|\.)rocketlane\.com$/i.test(host)) {
      const m = path.match(/\/projects\/(\d+)/i);
      if (m) return { platform: "rocketlane", recordId: m[1], recordType: "project", url: s };
      return { platform: "rocketlane", recordId: "", recordType: "unknown", url: s };
    }
    return { platform: "unknown", recordId: "", recordType: "unknown", url: s };
  }

  function rlEmptyProjectLinks() {
    return {
      zendesk: "", oneflowOrder: "", oneflowSubscription: "",
      younium: "", youniumSubscription: "", hubspot: "", rocketlane: "",
    };
  }

  function rlParseProjectLinksFromHtml(html) {
    const result = rlEmptyProjectLinks();
    if (!html) return result;
    try {
      const doc = new DOMParser().parseFromString(String(html), "text/html");
      for (const c of doc.body.querySelectorAll("li, p, div, tr")) {
        const a = c.querySelector("a[href]");
        if (!a) continue;
        const href = (a.getAttribute("href") || "").trim();
        if (!/^https?:/i.test(href)) continue;
        const cls = rlClassifyLinkUrl(href);
        if (!cls) continue;
        const labelText = (c.textContent || "").replace(/\s+/g, " ").trim();
        const kind = ofKindByLabel(labelText);
        switch (cls.platform) {
          case "zendesk":
            if (!result.zendesk) result.zendesk = href;
            break;
          case "hubspot":
            if (!result.hubspot) result.hubspot = href;
            break;
          case "rocketlane":
            if (!result.rocketlane) result.rocketlane = href;
            break;
          case "younium":
            if (kind === "subscription" && !result.youniumSubscription) result.youniumSubscription = href;
            else if (kind === "order" && !result.younium) result.younium = href;
            else if (kind === "unknown") {
              if (!result.younium) result.younium = href;
              else if (!result.youniumSubscription) result.youniumSubscription = href;
            }
            break;
          case "oneflow":
            if (kind === "subscription" && !result.oneflowSubscription) result.oneflowSubscription = href;
            else if (kind === "order" && !result.oneflowOrder) result.oneflowOrder = href;
            else if (kind === "unknown") {
              if (!result.oneflowOrder) result.oneflowOrder = href;
              else if (!result.oneflowSubscription) result.oneflowSubscription = href;
            }
            break;
        }
      }
    } catch (_) {}
    const re = /https?:\/\/[^\s<>"']+/gi;
    let m;
    const text = String(html || "");
    while ((m = re.exec(text)) !== null) {
      const href = m[0].replace(/[).,;]+$/, "");
      const cls = rlClassifyLinkUrl(href);
      if (!cls || cls.platform === "unknown") continue;
      const ctx = text.slice(Math.max(0, m.index - 40), m.index);
      const kind = ofKindByLabel(ctx);
      if (cls.platform === "zendesk" && !result.zendesk) result.zendesk = href;
      else if (cls.platform === "hubspot" && !result.hubspot) result.hubspot = href;
      else if (cls.platform === "rocketlane" && !result.rocketlane) result.rocketlane = href;
      else if (cls.platform === "younium") {
        if (kind === "subscription" && !result.youniumSubscription) result.youniumSubscription = href;
        else if (!result.younium) result.younium = href;
        else if (!result.youniumSubscription) result.youniumSubscription = href;
      } else if (cls.platform === "oneflow") {
        if (kind === "subscription" && !result.oneflowSubscription) result.oneflowSubscription = href;
        else if (!result.oneflowOrder) result.oneflowOrder = href;
        else if (!result.oneflowSubscription) result.oneflowSubscription = href;
      }
    }
    return result;
  }

  function rlMergeLinksByPriority(iqcLinks, dealDescLinks, deliveryStatusLinks) {
    const slots = [
      "zendesk", "oneflowOrder", "oneflowSubscription",
      "younium", "youniumSubscription", "hubspot", "rocketlane",
    ];
    const ranked = [
      { name: "iqc", links: iqcLinks },
      { name: "dealDescription", links: dealDescLinks },
      { name: "deliveryStatus", links: deliveryStatusLinks },
    ];
    const merged = rlEmptyProjectLinks();
    for (const k of slots) {
      for (const src of ranked) {
        const v = String(src.links?.[k] || "").trim();
        if (v) { merged[k] = v; break; }
      }
    }
    return merged;
  }

  // @@rlUrlPickerHelpers:start
  // Pure Attach-links helpers + PPT match scorer (extracted by url-picker.test.js).
  function rlEscapeHtmlAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function rlNormalizeHttpUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    try {
      const u = new URL(s);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.href;
    } catch (_) {
      return "";
    }
  }

  function rlIqcAttachLinkSlots() {
    return [
      { key: "oneflowOrder", label: "Oneflow - Order / offer", find: true },
      { key: "oneflowSubscription", label: "Oneflow - Subscription agreement", find: true },
      { key: "hubspot", label: "Hubspot", find: true },
      { key: "younium", label: "Younium link (Order / offer)", find: true },
      { key: "youniumSubscription", label: "Younium link (Subscription)", find: true },
      { key: "zendesk", label: "Zendesk", find: false },
    ];
  }

  function rlBuildAttachLinksListHtml(links) {
    const items = rlIqcAttachLinkSlots().map(({ key, label }) => {
      const url = rlNormalizeHttpUrl(links?.[key]);
      if (url) {
        const esc = rlEscapeHtmlAttr(url);
        return "<li>" + label + ': <a target="_blank" rel="noopener noreferrer" href="' + esc + '">' + esc + "</a></li>";
      }
      return "<li>" + label + ":</li>";
    });
    return "<ul>\n" + items.join("\n") + "\n</ul>";
  }

  function rlUpsertAttachLinksHtml(existingHtml, links) {
    const html = String(existingHtml || "");
    const listHtml = rlBuildAttachLinksListHtml(links);
    const reP = /(<p[^>]*>\s*Attach\s+links:\s*<\/p>\s*)(<ul\b[\s\S]*?<\/ul>)/i;
    if (reP.test(html)) return html.replace(reP, "$1" + listHtml);
    const reBare = /(Attach\s+links:\s*)(<ul\b[\s\S]*?<\/ul>)/i;
    if (reBare.test(html)) return html.replace(reBare, "$1" + listHtml);
    const suffix = "<p>Attach links:</p>\n" + listHtml;
    if (!html.trim()) return suffix;
    return html.replace(/\s*$/, "") + "\n" + suffix;
  }

  // ── PPT match helpers (pure; Node-testable) ──
  function matchNormalize(s) {
    return String(s ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Leading plant ID — userscript contract is 2–7 digits (not PPT's 2–6). */
  function matchExtractPlantId(text) {
    const m = String(text ?? "").match(/^\s*(\d{2,7})\b/);
    return m ? m[1] : "";
  }

  function matchExtractOrgNumber(text) {
    const s = String(text ?? "").replace(/[ .–-]/g, "");
    const m = s.match(/\b(\d{9})\b/);
    return m ? m[1] : "";
  }

  function matchExtractMoneyAmount(input) {
    if (typeof input === "number" && Number.isFinite(input)) return input;
    const s = String(input ?? "").trim();
    if (!s) return NaN;
    const cleaned = s
      .replace(/[A-Za-zÀ-ÿ\s]+$/g, "")
      .replace(/\s+/g, "")
      .replace(/(\d)\.(\d{3}\b)/g, "$1$2")
      .replace(/,/g, ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function matchMoneyCloseness(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return 0;
    const pctDiff = Math.abs(a - b) / Math.max(a, b);
    if (pctDiff >= 0.5) return 0;
    return 1 - pctDiff * 2;
  }

  function matchExtractEmailDomain(text) {
    const s = String(text ?? "");
    const m = s.match(/[\w.+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
    return m ? m[1].toLowerCase() : "";
  }

  function matchTokenize(s) {
    return new Set(
      matchNormalize(s)
        .replace(/^\s*\d+\s*[-–:]?\s*/, "")
        .replace(/[^a-z0-9æøå\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t && t.length > 1),
    );
  }

  function matchTokenOverlap(setA, setB) {
    if (!setA?.size || !setB?.size) return 0;
    let intersect = 0;
    for (const t of setA) if (setB.has(t)) intersect += 1;
    return intersect / Math.max(setA.size, setB.size);
  }

  const MATCH_DEAD_STATUSES = new Set([
    "cancelled", "canceled", "declined", "closed", "lost",
    "void", "voided", "expired", "rejected", "overdue",
  ]);

  /**
   * Score one candidate against project match context.
   * Returns { score, percent, signals }. Percent is clamped 0..100.
   */
  function scoreMatchCandidate(candidate, ctx, opts) {
    const signals = [];
    let raw = 0;
    const platform = String(candidate.platform || "").toLowerCase();
    const fkKey =
      platform === "hubspot"  ? "hubspotDealId" :
      platform === "oneflow"  ? "oneflowAgreementId" :
      platform === "younium"  ? "youniumOrderId" : null;
    const fkExpected = fkKey ? String(ctx.foreignKeys?.[fkKey] || "").trim() : "";
    if (fkExpected && String(candidate.id) === fkExpected) {
      signals.push({ label: "Foreign-key ID match (" + fkExpected + ")", points: 35 });
      raw += 35;
    }

    const projHsDeal = String(ctx.foreignKeys?.hubspotDealId || "").trim();
    if (projHsDeal && candidate.hubspotDealId &&
        String(candidate.hubspotDealId).trim() === projHsDeal) {
      signals.push({ label: "HubSpot Deal ID cross-link (" + projHsDeal + ")", points: 35 });
      raw += 35;
    }
    if (candidate.zendeskTicketId && Array.isArray(ctx.zendeskTicketIds) &&
        ctx.zendeskTicketIds.includes(String(candidate.zendeskTicketId).trim())) {
      signals.push({ label: "Zendesk ticket cross-link (" + candidate.zendeskTicketId + ")", points: 20 });
      raw += 20;
    }

    if (ctx.plantId) {
      const candidatePlantExact = candidate.plantId &&
        String(candidate.plantId).trim() === ctx.plantId;
      const primaryStartsWithPlant = !candidatePlantExact &&
        matchExtractPlantId(candidate.primaryText) === ctx.plantId;
      if (candidatePlantExact) {
        signals.push({ label: "Plant ID exact native (" + ctx.plantId + ")", points: 35 });
        raw += 35;
      } else if (primaryStartsWithPlant) {
        signals.push({ label: "Plant ID at start of name (" + ctx.plantId + ")", points: 30 });
        raw += 30;
      } else {
        const re = new RegExp("\\b" + ctx.plantId + "\\b");
        const anywhere = (candidate.matchableTexts || []).some((t) => re.test(String(t ?? "")));
        if (anywhere) {
          signals.push({ label: "Plant ID in text (" + ctx.plantId + ")", points: 18 });
          raw += 18;
        }
      }
    }

    if ((ctx.customerOrgNumber || ctx.partnerOrgNumber) && Array.isArray(candidate.orgNumbers)) {
      const want = new Set([ctx.customerOrgNumber, ctx.partnerOrgNumber].filter(Boolean));
      const hit = candidate.orgNumbers.find((n) => want.has(matchExtractOrgNumber(n)));
      if (hit) {
        signals.push({ label: "Org number exact (" + matchExtractOrgNumber(hit) + ")", points: 20 });
        raw += 20;
      }
    }

    if (ctx.nameTokens && ctx.nameTokens.size) {
      const candTokens = new Set();
      for (const t of candidate.matchableTexts || []) {
        for (const tok of matchTokenize(t)) candTokens.add(tok);
      }
      const ratio = matchTokenOverlap(candTokens, ctx.nameTokens);
      const pts = Math.round(ratio * 15);
      if (pts > 0) {
        signals.push({
          label: "Name similarity " + Math.round(ratio * 100) + "%",
          points: pts,
        });
        raw += pts;
      }
    }

    if (ctx.partner && Array.isArray(candidate.partyNames) && candidate.partyNames.length) {
      const wantNorm = ctx.partnerNormalized;
      let bestRatio = 0;
      let bestParty = "";
      for (const party of candidate.partyNames) {
        const partyNorm = matchNormalize(party);
        if (!partyNorm) continue;
        if (partyNorm === wantNorm) { bestRatio = 1; bestParty = party; break; }
        if (partyNorm.includes(wantNorm) || wantNorm.includes(partyNorm)) {
          if (bestRatio < 0.85) { bestRatio = 0.85; bestParty = party; }
          continue;
        }
        const r = matchTokenOverlap(matchTokenize(party), ctx.partnerTokens);
        if (r > bestRatio) { bestRatio = r; bestParty = party; }
      }
      const pts = Math.round(bestRatio * 10);
      if (pts > 0) {
        signals.push({ label: "Partner match (" + bestParty + ")", points: pts });
        raw += pts;
      }
    }

    if (platform === "hubspot" && ctx.hubspotMirror && candidate.hsFields) {
      const m = ctx.hubspotMirror;
      const h = candidate.hsFields;
      const same = (a, b) => {
        const an = matchNormalize(a);
        const bn = matchNormalize(b);
        return an && bn && an === bn;
      };
      if (m.dealName && same(m.dealName, h.dealName)) {
        signals.push({ label: "Deal name matches RL mirror", points: 8 });
        raw += 8;
      }
      if (m.plantName && same(m.plantName, h.plantName)) {
        signals.push({ label: "Plant name matches", points: 5 });
        raw += 5;
      }
      if (m.department && same(m.department, h.department)) {
        signals.push({ label: "Department: " + h.department, points: 3 });
        raw += 3;
      }
      if (m.dealType && same(m.dealType, h.dealType)) {
        signals.push({ label: "Deal type: " + h.dealType, points: 3 });
        raw += 3;
      }
      if (m.orderType && same(m.orderType, h.orderType)) {
        signals.push({ label: "Order type: " + h.orderType, points: 3 });
        raw += 3;
      }
      if (m.dealStage && same(m.dealStage, h.dealStage)) {
        signals.push({ label: "Deal stage: " + h.dealStage, points: 2 });
        raw += 2;
      }
      if (m.productTypeSet && m.productTypeSet.size && h.productTypes) {
        const candTypes = String(h.productTypes).split(/[,;|]/).map(matchNormalize).filter(Boolean);
        const overlap = candTypes.filter((t) => m.productTypeSet.has(t));
        if (overlap.length) {
          signals.push({ label: "Product type: " + overlap.join(", "), points: 4 });
          raw += 4;
        }
      }
    }

    if (ctx.contactEmail && Array.isArray(candidate.contactEmails)) {
      const lc = ctx.contactEmail;
      const hit = candidate.contactEmails.find((e) => String(e).toLowerCase() === lc);
      if (hit) {
        signals.push({ label: "Contact email exact (" + hit + ")", points: 8 });
        raw += 8;
      } else if (ctx.contactEmailDomain) {
        const dom = ctx.contactEmailDomain;
        const dh = candidate.contactEmails.find((e) => matchExtractEmailDomain(e) === dom);
        if (dh) {
          signals.push({ label: "Contact domain (" + dom + ")", points: 2 });
          raw += 2;
        }
      }
    }
    if (ctx.contactPhone && Array.isArray(candidate.contactPhones)) {
      const wantDigits = ctx.contactPhone.replace(/\D+/g, "");
      const suffix = wantDigits.slice(-8);
      const hit = candidate.contactPhones.find((p) => {
        const d = String(p).replace(/\D+/g, "");
        return d === wantDigits || (suffix && d.endsWith(suffix));
      });
      if (hit) {
        signals.push({ label: "Contact phone match (" + hit + ")", points: 6 });
        raw += 6;
      }
    }

    if (Array.isArray(ctx.embeddedLinks) && ctx.embeddedLinks.length) {
      const matchingLink = ctx.embeddedLinks.find((l) =>
        l && l.platform === platform &&
        l.recordId && String(l.recordId) === String(candidate.id)
      );
      if (matchingLink) {
        const preferKind = opts && opts.preferLinkKind;
        if (preferKind && matchingLink.linkKind && matchingLink.linkKind !== preferKind) {
          signals.push({
            label: "Curated link is the " + matchingLink.linkKind + " one — skipped here",
            points: 0,
          });
        } else {
          signals.push({
            label: "Linked from RL description (" + String(matchingLink.url).slice(0, 40) + "…)",
            points: 25,
          });
          raw += 25;
        }
      }
    }

    if (platform === "younium" && ctx.youniumOrderNumber && candidate.orderNumber) {
      if (String(candidate.orderNumber).trim() === String(ctx.youniumOrderNumber).trim()) {
        signals.push({ label: "Younium order # matches RL (" + ctx.youniumOrderNumber + ")", points: 30 });
        raw += 30;
      }
    }

    if (Number.isFinite(ctx.projectFee) && Number.isFinite(candidate.amount)) {
      const ratio = matchMoneyCloseness(ctx.projectFee, candidate.amount);
      const pts = Math.round(ratio * 8);
      if (pts > 0) {
        const cur = candidate.currency || "";
        const diffPct = Math.round(Math.abs(ctx.projectFee - candidate.amount) / Math.max(ctx.projectFee, candidate.amount) * 100);
        signals.push({
          label: "Money within " + diffPct + "% (" +
            Math.round(candidate.amount).toLocaleString() + (cur ? " " + cur : "") + ")",
          points: pts,
        });
        raw += pts;
      }
    }

    if (ctx.ownerEmail && Array.isArray(candidate.contactEmails) && candidate.contactEmails.length) {
      const wantFull = ctx.ownerEmail;
      const wantDomain = ctx.ownerEmailDomain;
      let exactHit = "";
      let domainHit = "";
      for (const e of candidate.contactEmails) {
        const en = String(e).toLowerCase().trim();
        if (!en) continue;
        if (en === wantFull) { exactHit = en; break; }
        if (wantDomain && matchExtractEmailDomain(en) === wantDomain) {
          if (!domainHit) domainHit = en;
        }
      }
      if (exactHit) {
        signals.push({ label: "Owner email exact (" + exactHit + ")", points: 5 });
        raw += 5;
      } else if (domainHit) {
        signals.push({ label: "Same domain (" + matchExtractEmailDomain(domainHit) + ")", points: 3 });
        raw += 3;
      }
    }

    if (ctx.owner && Array.isArray(candidate.contactNames) && candidate.contactNames.length) {
      const wantNorm = ctx.ownerNormalized;
      let hit = "";
      for (const c of candidate.contactNames) {
        const cn = matchNormalize(c);
        if (!cn) continue;
        if (cn === wantNorm || cn.includes(wantNorm) || wantNorm.includes(cn)) {
          hit = c; break;
        }
      }
      if (hit) {
        signals.push({ label: "Owner name match (" + hit + ")", points: 4 });
        raw += 4;
      }
    }

    if (candidate.date) {
      const candTs = Date.parse(String(candidate.date));
      if (Number.isFinite(candTs)) {
        const targets = [ctx.dueTimestamp, ctx.startTimestamp].filter(Number.isFinite);
        if (targets.length) {
          const minDays = Math.min(
            ...targets.map((t) => Math.abs(candTs - t) / (1000 * 60 * 60 * 24))
          );
          let pts = 0;
          if (minDays <= 7) pts = 4;
          else if (minDays <= 14) pts = 3;
          else if (minDays <= 30) pts = 2;
          if (pts > 0) {
            signals.push({
              label: "Date within " + Math.round(minDays) + " days",
              points: pts,
            });
            raw += pts;
          }
        }
      }
    }

    if (candidate.status) {
      const sNorm = matchNormalize(candidate.status);
      if (!MATCH_DEAD_STATUSES.has(sNorm)) {
        signals.push({ label: "Active status (" + candidate.status + ")", points: 3 });
        raw += 3;
      } else {
        signals.push({ label: "Dead status (" + candidate.status + ")", points: -20 });
        raw -= 20;
      }
    }

    const percent = Math.min(100, Math.max(0, Math.round(raw)));
    return { score: raw, percent, signals };
  }

  /**
   * Auto-fill when best percent ≥ minPct (default 85) AND raw lead ≥ minLead
   * (default 15). Sole candidate still needs ≥ minPct. Lead uses raw score,
   * not clamped percent.
   */
  function decideMatchOutcome(scored, options) {
    const minPct = options?.autoFillMinPercent ?? 85;
    const minLead = options?.autoFillMinLeadPercent ?? 15;
    const best = scored[0];
    const second = scored[1];
    if (!best) return { kind: "none" };
    const lead = second ? (best.score - second.score) : Infinity;
    const beats = lead >= minLead;
    if (best.percent >= minPct && beats) {
      return {
        kind: "auto",
        entry: best,
        reason: second
          ? "best " + best.percent + "% (raw " + Math.round(best.score) + ") beats #2 raw " + Math.round(second.score) + " by ≥" + minLead
          : "best " + best.percent + "% (only candidate ≥" + minPct + "%)",
      };
    }
    if (!best || best.percent === 0) return { kind: "none" };
    return {
      kind: "picker",
      entries: scored,
      reason:
        best.percent < minPct
          ? "best " + best.percent + "% < " + minPct + "% auto-fill threshold"
          : "best raw " + Math.round(best.score) + " only " + Math.round(lead) + " ahead of #2 — too close to call",
    };
  }

  // @@rlUrlPickerHelpers:end

  // @@rlFilesHelpers:start
  // Pure Files-popover helpers (extracted by files-popover.test.js).
  function rlFilesMergeAttachments(taskAtts, folderAtts) {
    const seen = new Set();
    const merged = [];
    for (const a of [...(taskAtts || []), ...(folderAtts || [])]) {
      const id = a?.attachmentId;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      merged.push(a);
    }
    return merged;
  }

  function rlFilesPickGeneralSharedFolder(folders) {
    const list = Array.isArray(folders) ? folders : [];
    const gsf = list.find((f) => f && f.isDefault && !f.isPrivate)
      || list.find((f) => /general shared/i.test(String(f?.folderName || "")));
    if (!gsf) return null;
    const id = gsf.folderId ?? gsf.id;
    if (id == null || id === "") return null;
    return { folderId: id, folderName: String(gsf.folderName || "General Shared Files") };
  }

  function rlFilesSanitizeFileName(raw) {
    let s = String(raw || "").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/, "");
    if (s.length > 200) s = s.slice(0, 200);
    return s || "download.bin";
  }

  function rlFilesSanitizeFolderName(raw) {
    let s = String(raw || "").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/, "");
    if (s.length > 200) s = s.slice(0, 200);
    return s || "Project Files";
  }

  function rlFilesIsTrustedAttachmentHost(hostname) {
    const h = String(hostname || "").toLowerCase();
    if (!h) return false;
    if (h === "assets.rocketlane.com" || h.endsWith(".assets.rocketlane.com")) return true;
    if (h === "d1vtr0p8bkmfca.cloudfront.net") return true;
    if (h.endsWith(".cloudfront.net")) return true;
    if (h === "s3.amazonaws.com") return true;
    if (/\.s3[.-]/i.test(h)) return true;
    if (h.endsWith(".amazonaws.com")) return true;
    // Rocketlane / tenant CDNs occasionally rotate hostnames; signed HTTPS
    // URLs from the API are still acceptable for preview/download.
    if (h.endsWith(".rocketlane.com")) return true;
    return false;
  }

  function rlFilesIsTrustedAttachmentUrl(raw) {
    try {
      const u = new URL(String(raw || "").trim());
      if (u.protocol !== "http:" && u.protocol !== "https:") return false;
      if (rlFilesIsTrustedAttachmentHost(u.hostname)) return true;
      // Rocketlane signed URLs sometimes land on rotating CDN hostnames; HTTPS
      // from the attachment API is still acceptable for preview/download.
      return u.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  function rlFilesFormatSize(bytes) {
    const n = Number(bytes) || 0;
    if (!n) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)) + " " + units[i];
  }

  function rlFilesUniqueName(fileName, usedNames) {
    let candidate = fileName;
    let n = 1;
    while (usedNames.has(candidate)) {
      const dot = fileName.lastIndexOf(".");
      if (dot > 0) {
        candidate = fileName.slice(0, dot) + " (" + n + ")" + fileName.slice(dot);
      } else {
        candidate = fileName + " (" + n + ")";
      }
      n++;
    }
    usedNames.add(candidate);
    return candidate;
  }
  // @@rlFilesHelpers:end

  // @@rlZendeskCasesHelpers:start
  /** Leading plant number from project title (PPT: /^\s*(\d+)\b/). */
  function rlZdExtractPlantId(name) {
    const m = String(name ?? "").match(/^\s*(\d+)\b/);
    return m ? m[1] : "";
  }

  /** Store/plant descriptive name after plant id (PPT strip + split). */
  function rlZdExtractPlantName(name) {
    return String(name ?? "")
      .replace(/^\s*\d+\s*[-–—]\s*/, "")
      .split(/:|\s[-–—]\s/)[0]
      .trim();
  }

  /**
   * Zendesk search queries (v1.14.17). A bare "type:ticket 4531" searched every
   * field — comments, requester, phone numbers, order numbers — and pulled in
   * cases that only mention the number in passing. Now the ticket must carry the
   * plant in a place that means it: the Plant ID ticket field, the subject
   * or the subject (emne); the plant name is Zendesk's own phrase search. A
   * description-only mention (v1.14.17/18) pulled in 42 passing mentions for
   * plant 8013, so it is gone (v1.14.19).
   */
  function rlZdBuildSearchQueries(plantId, plantName, plantFieldId) {
    const pid = String(plantId ?? "").trim();
    if (!pid) return [];
    // { query, trusted }: a trusted query's hits are kept as they are — the
    // plant-name phrase search is exactly what an agent types into Zendesk
    // ("COOP EXTRA Verdal"), and Zendesk already matched the phrase somewhere
    // in the ticket. Number queries are gated again client-side.
    const queries = [];
    if (plantFieldId) queries.push({ query: "type:ticket custom_field_" + plantFieldId + ":" + pid, trusted: false });
    queries.push({ query: "type:ticket subject:" + pid, trusted: false });
    const pname = String(plantName ?? "").trim();
    if (pname && pname.length >= 4) {
      queries.push({ query: 'type:ticket "' + pname.replace(/"/g, "") + '"', trusted: true });
    }
    return queries;
  }

  function rlZdNormText(s) {
    return String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  }
  /** Whole-number match: 4531 in "4531 - Bunnpris" yes, in "14531" or "O-014531" no. */
  function rlZdHasPlantNumber(text, pid) {
    const s = String(text ?? "");
    if (!s || !pid) return false;
    return new RegExp("(^|[^0-9])" + pid + "([^0-9]|$)").test(s);
  }
  /**
   * Keep a search hit only when the plant is really referenced: the Plant ID
   * ticket field equals it, or the subject / description carries the plant
   * number as a whole number or the plant name. Zendesk's search is fuzzy
   * around numbers, so this is the strict gate the user sees.
   */
  function rlZdTicketMatchesPlant(t, pid, pname, plantFieldId) {
    if (plantFieldId && Array.isArray(t?.custom_fields)) {
      const f = t.custom_fields.find((x) => String(x?.id) === String(plantFieldId));
      if (f && rlZdHasPlantNumber(String(f.value ?? ""), pid) && String(f.value).trim() === pid) return true;
    }
    const subject = String(t?.subject ?? t?.raw_subject ?? "");
    if (rlZdHasPlantNumber(subject, pid)) return true;
    const n = rlZdNormText(pname);
    if (n && n.length >= 4 && rlZdNormText(subject).includes(n)) return true;
    return false;
  }

  /** The Zendesk ticket field titled "Plant ID" — looked up once, cached in GM storage. */
  const RL_ZD_GM_PLANT_FIELD = "rlZdPlantIdFieldId";
  let rlZdPlantFieldLookup = null;
  async function rlZdGetPlantFieldId() {
    const cached = GM_getValue(RL_ZD_GM_PLANT_FIELD, null);
    if (cached !== null && cached !== undefined) return Number(cached) || 0;
    if (rlZdPlantFieldLookup) return rlZdPlantFieldLookup;
    rlZdPlantFieldLookup = (async () => {
      try {
        const json = await zendeskApiRequest("GET", "/ticket_fields.json?per_page=100");
        const fields = Array.isArray(json?.ticket_fields) ? json.ticket_fields : [];
        const f = fields.find((x) => /^\s*plant\s*id\s*\*?\s*$/i.test(String(x?.title ?? "")) || /^\s*plant\s*id\s*\*?\s*$/i.test(String(x?.title_in_portal ?? "")))
          || fields.find((x) => /plant\s*id/i.test(String(x?.title ?? "")));
        const id = f && f.id ? Number(f.id) : 0;
        GM_setValue(RL_ZD_GM_PLANT_FIELD, id);
        return id;
      } catch (e) {
        console.debug("[rlZd] ticket_fields lookup failed:", e?.message ?? e);
        return 0;
      } finally {
        setTimeout(() => { rlZdPlantFieldLookup = null; }, 0);
      }
    })();
    return rlZdPlantFieldLookup;
  }

  /** Merge search result arrays; keep first ticket per id (dedupe). */
  function rlZdMergeSearchResults(resultLists) {
    const byId = new Map();
    for (const list of resultLists || []) {
      for (const r of Array.isArray(list) ? list : []) {
        if (r?.result_type === "ticket" && r.id != null && !byId.has(r.id)) {
          byId.set(r.id, r);
        }
      }
    }
    return Array.from(byId.values());
  }

  function rlZdStatusClass(status) {
    const s = String(status ?? "").toLowerCase();
    if (s === "new") return "zd-new";
    if (s === "open") return "zd-open";
    if (s === "pending") return "zd-pending";
    if (s === "hold") return "zd-hold";
    if (s === "solved") return "zd-solved";
    if (s === "closed") return "zd-closed";
    return "zd-open";
  }

  /** Newest public comment created_at, or null. */
  function rlZdPickLastPublicReplyAt(comments) {
    const list = Array.isArray(comments) ? comments : [];
    const sorted = list.slice().sort((a, b) => {
      const at = Date.parse(String(a?.created_at ?? "")) || 0;
      const bt = Date.parse(String(b?.created_at ?? "")) || 0;
      return bt - at;
    });
    for (const c of sorted) {
      if (c?.public === true) {
        const iso = String(c.created_at ?? "");
        return iso || null;
      }
    }
    return null;
  }

  function rlZdFormatRelativeTimeShort(isoText) {
    const ts = Date.parse(String(isoText ?? ""));
    if (!Number.isFinite(ts)) return "";
    const deltaMs = Math.max(0, Date.now() - ts);
    const s = Math.round(deltaMs / 1000);
    if (s < 15) return "just now";
    if (s < 60) return s + "s ago";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.round(h / 24);
    return d + "d ago";
  }

  function rlZdFormatBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "";
    if (v < 1024) return v + " B";
    if (v < 1024 * 1024) return Math.round(v / 1024) + " KB";
    return (v / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function rlZdMapWithConcurrency(items, limit, fn) {
    const arr = Array.isArray(items) ? items : [];
    const out = new Array(arr.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, arr.length) || 0 }, async () => {
      while (true) {
        const i = next++;
        if (i >= arr.length) return;
        out[i] = await fn(arr[i], i);
      }
    });
    await Promise.all(workers);
    return out;
  }
  // @@rlZendeskCasesHelpers:end

  // @@rlCategoryHelpers:start
  // PPT category / order-info helpers (pure; extracted by category-import.test.js).

  const RL_CATEGORY_PRESETS = [
    { key: "refrigeration_freezing", label: "Refrigeration and freezing systems", integrationTask: "Integration: Refrigeration", designTask: "Design: Refrigeration" },
    { key: "ventilation", label: "Ventilation", integrationTask: "Integration: Ventilation", designTask: "Design: Ventilation" },
    { key: "heating_system", label: "Heating system / VGV", integrationTask: "Integration: Heat System / VGV", designTask: "Design: Heat System / VGV" },
    { key: "energy", label: "Energy", integrationTask: "Integration: Energi", designTask: "Design: Energi" },
    { key: "machine_room", label: "Machine Room", integrationTask: "Integration: Machine Room", designTask: "Design: Machine Room" },
    { key: "wireless", label: "Wireless", integrationTask: "Integration: Wireless overview", designTask: "Design: Wireless overview" },
    { key: "smart_function", label: "Smart Function" },
  ];

  const RL_ORDER_INFO_MODULE_MAP = [
    { re: /IWMAC\s*Modul:\s*Refrigeration/i, key: "refrigeration_freezing" },
    { re: /IWMAC\s*Modul:\s*Ventilation/i, key: "ventilation" },
    { re: /IWMAC\s*Modul:\s*Energy/i, key: "energy" },
    { re: /IWMAC\s*Modul:\s*Wireless/i, key: "wireless" },
    { re: /IWMAC\s*Modul:\s*(Heating|VGV)/i, key: "heating_system" },
    { re: /IWMAC\s*Modul:\s*Machine\s*Room/i, key: "machine_room" },
    { re: /IWMAC\s*Modul:\s*Smart\s*Function/i, key: "smart_function" },
  ];

  const RL_ORDER_INFO_PROMOTE_RULES = [
    { re: /maskin|machine/i, presetKey: "machine_room" },
    { re: /integration gateway/i, presetKey: "refrigeration_freezing" },
    { re: /aftermarket.*refrigeration/i, presetKey: "refrigeration_freezing" },
  ];

  const RL_ORDER_INFO_HEADER_PROMOTE_RULES = [
    { re: /IWMAC\s*Modul:\s*Add[\s-]*on/i, presetKey: "machine_room" },
    { re: /IWMAC\s*Product:\s*Images?\b/i, presetKey: "machine_room" },
  ];

  const RL_ORDER_INFO_SUB_PROMOTE_RULES = [
    { re: /oversiktsbilde/i, presetKey: "refrigeration_freezing" },
  ];

  const RL_ORDER_INFO_FLAT_CLASSIFY = [
    { re: /smart\s*function/i, key: "smart_function" },
    { re: /maskin|machine|machinery/i, key: "machine_room" },
    { re: /refrigerat|freez|kjøl|kjol|frys/i, key: "refrigeration_freezing" },
    { re: /ventilat/i, key: "ventilation" },
    { re: /energy|energi/i, key: "energy" },
    { re: /heating|varme|\bvgv\b/i, key: "heating_system" },
    { re: /wireless|trådløs|tradlos/i, key: "wireless" },
  ];

  /** Dialog choice order: order-info first, then template, custom, then presets. */
  function rlCatDialogChoices() {
    return [
      { value: "__orderinfo__", label: "From order info / HubSpot line items", kind: "orderinfo" },
      { value: "__template__", label: "Choose a project template…", kind: "template" },
      { value: "", label: "— Custom —", kind: "custom" },
      ...RL_CATEGORY_PRESETS.map((pr, i) => ({
        value: String(i),
        label: pr.label,
        kind: "preset",
        preset: pr,
      })),
    ];
  }

  function rlCatTaskDisplayText(text) {
    return String(text ?? "")
      .replace(/^(?:->|\u21B3)\s*/, "")
      .replace(/^\[[^\]]*\]\s*/, "")
      .trim();
  }

  function rlCatNormText(s) {
    return rlCatTaskDisplayText(s)
      .toLowerCase()
      .replace(/[–—−]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function rlCatPromoteRuleFor(text) {
    const t = String(text || "");
    return RL_ORDER_INFO_PROMOTE_RULES.find((r) => r.re.test(t)) || null;
  }

  function rlCatHeaderPromoteFor(headerText) {
    const t = String(headerText || "");
    return RL_ORDER_INFO_HEADER_PROMOTE_RULES.find((r) => r.re.test(t)) || null;
  }

  function rlCatClassifyDiscipline(text) {
    const t = String(text || "");
    return (RL_ORDER_INFO_FLAT_CLASSIFY.find((r) => r.re.test(t)) || {}).key || null;
  }

  function rlCatIsLicenseItem(text) {
    return /^\s*IWMAC\s*License\b/i.test(String(text || ""));
  }

  function rlCatSkipAsLicense(item) {
    return rlCatIsLicenseItem(item?.text) && !((item?.subs || []).length);
  }

  function rlCatExtractSubPromotes(item, destKey, promotedByPreset) {
    const subs = (item && item.subs) || [];
    if (!subs.length) return;
    const keep = [];
    for (const s of subs) {
      const rule = RL_ORDER_INFO_SUB_PROMOTE_RULES.find((r) => r.re.test(String(s || "")));
      if (rule && rule.presetKey !== destKey) {
        if (!promotedByPreset.has(rule.presetKey)) promotedByPreset.set(rule.presetKey, []);
        promotedByPreset.get(rule.presetKey).push({ text: s, subs: [] });
      } else {
        keep.push(s);
      }
    }
    item.subs = keep;
  }

  function rlCatPresetByKey(key) {
    return RL_CATEGORY_PRESETS.find((pr) => pr.key === key) || null;
  }

  /** Collapse desired tasks by normalized text; merge unique subs. */
  function rlCatDedupeDesired(rawDesired) {
    const desired = [];
    const desiredByNorm = new Map();
    for (const d of rawDesired || []) {
      const dk = rlCatNormText(d.text);
      if (!dk) continue;
      let agg = desiredByNorm.get(dk);
      if (!agg) {
        agg = { text: d.text, subs: [] };
        desiredByNorm.set(dk, agg);
        desired.push(agg);
      }
      const seenSub = new Set(agg.subs.map(rlCatNormText));
      for (const s of d.subs || []) {
        const sk = rlCatNormText(s);
        if (sk && !seenSub.has(sk)) {
          agg.subs.push(s);
          seenSub.add(sk);
        }
      }
    }
    return desired;
  }

  /**
   * From parsed modules → plan [{ preset, desired:[{text,subs}] }].
   * Mutates module item lists the same way PPT createCategoriesFromOrderInfo does.
   */
  function rlCatBuildDesiredPlan(modulesIn) {
    const modules = (modulesIn || []).map((m) => ({
      headerText: m.headerText,
      flat: !!m.flat,
      items: (m.items || []).map((it) => ({
        text: it.text,
        subs: Array.isArray(it.subs) ? it.subs.slice() : [],
      })),
    }));
    const promotedByPreset = new Map();

    for (const pm of modules) {
      if (pm.flat) {
        for (const item of pm.items || []) {
          if (rlCatSkipAsLicense(item)) continue;
          const key = rlCatClassifyDiscipline(item.text);
          rlCatExtractSubPromotes(item, key, promotedByPreset);
          if (!key) continue;
          if (!promotedByPreset.has(key)) promotedByPreset.set(key, []);
          promotedByPreset.get(key).push(item);
        }
        pm.items = [];
        continue;
      }
      const headerRule = rlCatHeaderPromoteFor(pm.headerText);
      if (headerRule) {
        for (const item of pm.items || []) {
          if (rlCatSkipAsLicense(item)) continue;
          const key = (rlCatPromoteRuleFor(item.text) || headerRule).presetKey;
          rlCatExtractSubPromotes(item, key, promotedByPreset);
          if (!promotedByPreset.has(key)) promotedByPreset.set(key, []);
          promotedByPreset.get(key).push(item);
        }
        pm.items = [];
        continue;
      }
      const moduleKey = (RL_ORDER_INFO_MODULE_MAP.find((m) => m.re.test(pm.headerText)) || {}).key || null;
      const keep = [];
      for (const item of pm.items || []) {
        if (rlCatSkipAsLicense(item)) continue;
        const rule = rlCatPromoteRuleFor(item.text);
        rlCatExtractSubPromotes(item, rule ? rule.presetKey : moduleKey, promotedByPreset);
        if (rule) {
          if (!promotedByPreset.has(rule.presetKey)) promotedByPreset.set(rule.presetKey, []);
          promotedByPreset.get(rule.presetKey).push(item);
        } else {
          keep.push(item);
        }
      }
      pm.items = keep;
    }

    const plan = [];
    const seen = new Set();
    for (const pm of modules) {
      const map = RL_ORDER_INFO_MODULE_MAP.find((m) => m.re.test(pm.headerText));
      if (!map || seen.has(map.key)) continue;
      const preset = rlCatPresetByKey(map.key);
      if (!preset) continue;
      seen.add(map.key);
      plan.push({ preset, items: pm.items });
    }
    for (const presetKey of promotedByPreset.keys()) {
      if (seen.has(presetKey)) continue;
      const preset = rlCatPresetByKey(presetKey);
      if (!preset) continue;
      seen.add(presetKey);
      plan.push({ preset, items: [] });
    }

    return plan.map((entry) => {
      const rawDesired = [];
      for (const gt of [entry.preset.integrationTask, entry.preset.designTask]) {
        if (gt) rawDesired.push({ text: gt, subs: [] });
      }
      const lineItems = [...(entry.items || []), ...(promotedByPreset.get(entry.preset.key) || [])];
      for (const item of lineItems) {
        rawDesired.push({ text: item.text, subs: (item.subs || []).slice() });
      }
      return { preset: entry.preset, desired: rlCatDedupeDesired(rawDesired) };
    });
  }

  /**
   * Parse order-info HTML → modules. Uses DOMParser when available; otherwise a
   * minimal HTML subset walker (Node helper tests).
   */
  function rlCatParseOrderInfoModules(html) {
    const out = [];
    const src = String(html || "");
    if (!src.trim()) return out;

    const stripDash = (s) => String(s || "").replace(/^[-–—]\s*/, "").trim();

    if (typeof DOMParser !== "undefined") {
      let doc;
      try {
        doc = new DOMParser().parseFromString(src, "text/html");
      } catch (_) {
        return out;
      }
      const liOwnText = (li) => {
        let s = "";
        for (const n of Array.from(li.childNodes)) {
          if (n.nodeType === 1) {
            const nt = String(n.tagName || "").toLowerCase();
            if (nt === "ul" || nt === "ol") continue;
            s += n.textContent || "";
          } else if (n.nodeType === 3) {
            s += n.nodeValue || "";
          }
        }
        return s.replace(/\s+/g, " ").trim();
      };
      const parseListInto = (ulNode, mod) => {
        let lastTop = null;
        for (const li of Array.from(ulNode.children)) {
          if (String(li.tagName || "").toLowerCase() !== "li") continue;
          const own = liOwnText(li);
          if (own && /^[-–—]\s*/.test(own)) {
            const sub = stripDash(own);
            if (sub) {
              if (lastTop) lastTop.subs.push(sub);
              else mod.items.push({ text: sub, subs: [] });
            }
            continue;
          }
          if (own) {
            lastTop = { text: own, subs: [] };
            mod.items.push(lastTop);
          }
          let nested = null;
          for (const c of Array.from(li.children)) {
            const ct = String(c.tagName || "").toLowerCase();
            if (ct === "ul" || ct === "ol") {
              nested = c;
              break;
            }
          }
          if (nested) {
            const target = lastTop || (mod.items.length ? mod.items[mod.items.length - 1] : null);
            for (const subLi of Array.from(nested.children)) {
              if (String(subLi.tagName || "").toLowerCase() !== "li") continue;
              const subText = stripDash(liOwnText(subLi));
              if (!subText) continue;
              if (target) target.subs.push(subText);
              else mod.items.push({ text: subText, subs: [] });
            }
          }
        }
      };
      let current = null;
      for (const node of Array.from(doc.body.children)) {
        const tag = String(node.tagName || "").toLowerCase();
        const txt = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (tag === "p" && /IWMAC\s*(Modul|Product)\s*:/i.test(txt)) {
          current = { headerText: txt, items: [] };
          out.push(current);
        } else if ((tag === "ul" || tag === "ol") && current) {
          parseListInto(node, current);
        }
      }
      if (out.length === 0) {
        const flat = { headerText: "__FLAT_LINE_ITEMS__", items: [], flat: true };
        for (const ul of Array.from(doc.querySelectorAll("ul, ol"))) {
          if (ul.closest("li")) continue;
          parseListInto(ul, flat);
        }
        if (flat.items.length) out.push(flat);
      }
      return out;
    }

    // Node fallback: lightweight tag walker for p/ul/ol/li only.
    return rlCatParseOrderInfoModulesFallback(src);
  }

  function rlCatParseOrderInfoModulesFallback(html) {
    const out = [];
    const stripDash = (s) => String(s || "").replace(/^[-–—]\s*/, "").trim();
    const decode = (s) =>
      String(s || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");

    // Minimal HTML tree for p/ul/ol/li/#text — enough for order-info shapes in Node tests.
    function parseFragment(src) {
      const root = { tag: "#root", children: [], text: "" };
      const stack = [root];
      const re = /<\/?([a-zA-Z0-9]+)[^>]*>|([^<]+)/g;
      let m;
      while ((m = re.exec(src))) {
        if (m[1]) {
          const raw = m[0];
          const tag = m[1].toLowerCase();
          const closing = raw.startsWith("</");
          if (closing) {
            for (let i = stack.length - 1; i >= 1; i--) {
              if (stack[i].tag === tag) {
                stack.length = i;
                break;
              }
            }
            continue;
          }
          if (["br", "hr", "img", "meta", "link"].includes(tag)) continue;
          const node = { tag, children: [], text: "" };
          stack[stack.length - 1].children.push(node);
          if (["p", "ul", "ol", "li", "strong", "b", "em", "span", "div"].includes(tag)) {
            stack.push(node);
          }
        } else if (m[2]) {
          stack[stack.length - 1].children.push({ tag: "#text", text: decode(m[2]), children: [] });
        }
      }
      return root;
    }

    function directText(node) {
      let s = "";
      for (const c of node.children || []) {
        if (c.tag === "#text") s += c.text || "";
        else if (c.tag !== "ul" && c.tag !== "ol") s += directText(c);
      }
      return s.replace(/\s+/g, " ").trim();
    }

    function parseListInto(ulNode, mod) {
      let lastTop = null;
      for (const li of ulNode.children || []) {
        if (li.tag !== "li") continue;
        const own = directText(li);
        if (own && /^[-–—]\s*/.test(own)) {
          const sub = stripDash(own);
          if (sub) {
            if (lastTop) lastTop.subs.push(sub);
            else mod.items.push({ text: sub, subs: [] });
          }
          continue;
        }
        if (own) {
          lastTop = { text: own, subs: [] };
          mod.items.push(lastTop);
        }
        const nested = (li.children || []).find((c) => c.tag === "ul" || c.tag === "ol");
        if (nested) {
          const target = lastTop || (mod.items.length ? mod.items[mod.items.length - 1] : null);
          for (const subLi of nested.children || []) {
            if (subLi.tag !== "li") continue;
            const subText = stripDash(directText(subLi));
            if (!subText) continue;
            if (target) target.subs.push(subText);
            else mod.items.push({ text: subText, subs: [] });
          }
        }
      }
    }

    const tree = parseFragment(String(html || ""));
    let current = null;
    for (const node of tree.children) {
      if (node.tag === "p") {
        const txt = directText(node);
        if (/IWMAC\s*(Modul|Product)\s*:/i.test(txt)) {
          current = { headerText: txt, items: [] };
          out.push(current);
        }
      } else if ((node.tag === "ul" || node.tag === "ol") && current) {
        parseListInto(node, current);
      }
    }
    if (out.length === 0) {
      const flat = { headerText: "__FLAT_LINE_ITEMS__", items: [], flat: true };
      for (const n of tree.children) {
        if (n.tag === "ul" || n.tag === "ol") parseListInto(n, flat);
      }
      if (flat.items.length) out.push(flat);
    }
    return out;
  }

  // ── Rocketlane field accessors (pure) ──
  function rlCatPhaseId(phase) {
    const v =
      phase?.projectPhaseId ??
      phase?.phaseId ??
      phase?.phaseID ??
      phase?.id ??
      phase?.phase_id ??
      phase?.projectPhaseID ??
      phase?.phaseId?.value ??
      phase?.phaseID?.value ??
      phase?.value ??
      "";
    return String(v ?? "").trim();
  }

  function rlCatPhaseName(phase) {
    return String(
      phase?.projectPhaseName ??
        phase?.phaseName ??
        phase?.name ??
        phase?.phase_name ??
        phase ??
        ""
    ).trim();
  }

  function rlCatCoerceId(v) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
    return s;
  }

  function rlCatTaskId(task) {
    return String(task?.taskId ?? task?.id ?? "").trim();
  }

  function rlCatTaskName(task) {
    return String(task?.taskName ?? task?.name ?? "").trim();
  }

  function rlCatTaskPhaseName(task) {
    const raw =
      task?.projectPhase?.projectPhaseName ??
      task?.projectPhase?.phaseName ??
      task?.projectPhase?.name ??
      task?.projectPhaseName ??
      task?.phase?.phaseName ??
      task?.phase?.name ??
      task?.phaseName ??
      task?.phase_name ??
      "";
    if (raw && typeof raw === "object") return "";
    return String(raw ?? "").trim();
  }

  function rlCatTaskParentTaskId(task) {
    const pt = task?.parentTask;
    const ptPrimitive = typeof pt === "number" || typeof pt === "string" ? pt : null;
    return String(
      task?.parentTaskId ??
        ptPrimitive ??
        task?.parentTask?.taskId ??
        task?.parentTask?.id ??
        task?.parentTaskObject?.taskId ??
        task?.parentTaskObject?.id ??
        task?.parent?.taskId ??
        task?.parent?.id ??
        ""
    ).trim();
  }

  function rlCatUnwrapList(json) {
    const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    return { data, pagination: json?.pagination };
  }

  function rlCatPaginationNextToken(pagination) {
    const tok = String(pagination?.nextPageToken ?? "").trim();
    if (tok) return tok;
    const next = String(pagination?.nextPage ?? "").trim();
    if (!next) return "";
    try {
      const u = new URL(next);
      return String(u.searchParams.get("pageToken") ?? "").trim();
    } catch (_) {
      return "";
    }
  }

  /**
   * Given existing RL tasks for a phase + desired list, return jobItems that still
   * need create (parents / missing subs). Idempotent backfill planner.
   * existingTasks: full project task list (or phase-filtered).
   */
  function rlCatPlanBackfillJobs(phaseName, desired, existingTasks) {
    const phaseNorm = rlCatNormText(phaseName);
    const rlTopByName = new Map();
    const rlSubByKey = new Map();
    for (const rt of existingTasks || []) {
      const rid = rlCatTaskId(rt);
      if (!rid) continue;
      const par = rlCatTaskParentTaskId(rt);
      if (par) {
        rlSubByKey.set(par + "\0" + rlCatNormText(rlCatTaskName(rt)), rid);
      } else if (rlCatNormText(rlCatTaskPhaseName(rt)) === phaseNorm) {
        rlTopByName.set(rlCatNormText(rlCatTaskName(rt)), rid);
      }
    }
    const jobs = [];
    for (const d of desired || []) {
      const parentId = rlTopByName.get(rlCatNormText(d.text)) || "";
      const missingSubs = [];
      for (const subText of d.subs || []) {
        if (!parentId) {
          missingSubs.push(subText);
          continue;
        }
        const sk = parentId + "\0" + rlCatNormText(subText);
        if (!rlSubByKey.has(sk)) missingSubs.push(subText);
      }
      if (!parentId) {
        jobs.push({ text: d.text, subs: (d.subs || []).slice(), parentExists: false, parentRlId: "" });
      } else if (missingSubs.length) {
        jobs.push({ text: d.text, subs: missingSubs, parentExists: true, parentRlId: parentId });
      }
    }
    return jobs;
  }

  async function rlCatRunWithConcurrency(items, limit, worker) {
    const list = Array.from(items || []);
    if (!list.length) return;
    let cursor = 0;
    const runners = Array.from({ length: Math.min(Math.max(1, limit), list.length) }, async () => {
      while (cursor < list.length) {
        const i = cursor++;
        await worker(list[i], i);
      }
    });
    await Promise.all(runners);
  }
  // @@rlCategoryHelpers:end

  // @@rlHomeProjectsHelpers:start
  // Pure home PROJECTS helpers (extracted by home-projects.test.js).
  // Progress buckets from lightV1 progressStatus: 1=To do, 2=In progress, 3=Completed, 4=Blocked.

  const RL_HP_WORKLOAD_SYNC_NAME = "[Tracker] Workload Sync";
  const RL_HP_PROGRESS_TODO = 1;
  const RL_HP_PROGRESS_IN_PROGRESS = 2;
  const RL_HP_PROGRESS_COMPLETED = 3;
  const RL_HP_PROGRESS_BLOCKED = 4;

  function rlHpClamp(n, lo, hi) {
    const x = Number(n);
    if (!Number.isFinite(x)) return lo;
    return Math.min(hi, Math.max(lo, x));
  }

  /** Parse Rocketlane `__api_key` localStorage JSON: ["api_key", uuid, userId, accountId]. */
  function rlHpParseApiKeyBundle(raw) {
    let parsed = raw;
    if (typeof raw === "string") {
      try { parsed = JSON.parse(raw); } catch (_) { return { key: "", userId: "", accountId: "" }; }
    }
    if (!Array.isArray(parsed)) return { key: "", userId: "", accountId: "" };
    const key = parsed.find((v) => typeof v === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) || "";
    const userId = parsed.find((v) => (typeof v === "number" && Number.isInteger(v) && v > 0) ||
      (typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0));
    const ints = parsed.filter((v) => (typeof v === "number" && Number.isInteger(v) && v > 0) ||
      (typeof v === "string" && /^\d+$/.test(v) && Number(v) > 0));
    const accountId = ints.length >= 2 ? String(ints[1]) : "";
    return {
      key: String(key || ""),
      userId: userId != null ? String(userId) : "",
      accountId,
    };
  }

  function rlHpPersonDisplayName(person) {
    const first = String(person?.firstName ?? "").trim();
    const last = String(person?.lastName ?? "").trim();
    const full = (first + " " + last).trim();
    if (full) return full;
    const email = String(person?.emailId ?? person?.email ?? "").trim();
    if (email) return email;
    const uid = person?.userId ?? person?.id;
    return uid != null && String(uid).trim() ? ("User #" + String(uid).trim()) : "";
  }

  function rlHpNormalizeOwnerKey(name) {
    return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function rlHpIsUserOnProject(raw, userId) {
    const uid = String(userId ?? "").trim();
    if (!uid) return false;
    if (rlHpIsUserProjectOwner(raw, uid)) return true;
    const members = Array.isArray(raw?.teamMembers) ? raw.teamMembers : [];
    for (const m of members) {
      const mid = String(m?.userId ?? m?.id ?? m?.memberId ?? "").trim();
      if (mid && mid === uid) return true;
    }
    return false;
  }

  /** True when current user is the Rocketlane projectOwner (crown), not mere team member. */
  function rlHpIsUserProjectOwner(raw, userId) {
    const uid = String(userId ?? "").trim();
    if (!uid) return false;
    const ownerUid = String(raw?.projectOwner?.userId ?? raw?.projectOwner?.id ?? "").trim();
    return !!(ownerUid && ownerUid === uid);
  }

  function rlHpIsExcludedMetaProject(raw) {
    const name = String(raw?.projectName ?? raw?.name ?? "").trim();
    return name === RL_HP_WORKLOAD_SYNC_NAME;
  }

  /**
   * Home "Project Owner" panel: any project current user is on (owner or member)
   * so multi-owner headers list every project-owner person you work with.
   */
  function rlHpShouldKeepOwnerProject(raw, userId) {
    if (!raw || rlHpIsExcludedMetaProject(raw)) return false;
    return rlHpIsUserOnProject(raw, userId);
  }

  /** Home "In progress" panel: on project as member, not crown owner. */
  function rlHpShouldKeepMemberProject(raw, userId) {
    if (!raw || rlHpIsExcludedMetaProject(raw)) return false;
    if (rlHpIsUserProjectOwner(raw, userId)) return false;
    return rlHpIsUserOnProject(raw, userId);
  }

  /** @deprecated Prefer rlHpShouldKeepOwnerProject — on-project alias for owner panel. */
  function rlHpShouldKeepProject(raw, userId) {
    return rlHpShouldKeepOwnerProject(raw, userId);
  }

  /** True when overdue → first → second are consecutive siblings (twin-panel remount gate). */
  function rlHpTwinPanelsFollowAnchor(anchor, first, second) {
    return !!(anchor && first && second &&
      anchor.isConnected && first.isConnected && second.isConnected &&
      anchor.nextElementSibling === first &&
      first.nextElementSibling === second);
  }

  /** Early MAIN/host park: panel is direct child of host (not yet under Overdue). */
  function rlHpPanelParkedOnHost(panel, host) {
    return !!(host && panel && panel.parentElement === host);
  }

  const RL_HP_PANEL_OWNER_ID = "rlHomeProjectsPanelOwner";
  const RL_HP_PANEL_MEMBER_ID = "rlHomeProjectsPanelMember";
  const RL_HP_PANEL_ROOTS = ["#" + RL_HP_PANEL_OWNER_ID, "#" + RL_HP_PANEL_MEMBER_ID];

  /**
   * Selector list covering both twin panels. A descendant combinator binds only to
   * the last selector of a comma list, so the suffix has to be repeated per root:
   * "#owner,#member .rlhpBar" would style the owner panel itself, not its bar.
   */
  function rlHpPanelSelector(suffix, roots) {
    const list = Array.isArray(roots) && roots.length ? roots : RL_HP_PANEL_ROOTS;
    const tail = String(suffix == null ? "" : suffix);
    return list.map((root) => root + tail).join(",");
  }

  /** Home panel lists every status except Completed. */
  function rlHpIsHomeListStatus(statusKey) {
    return String(statusKey || "") !== "completed";
  }

  function rlHpStatusLabelFromFields(fields) {
    const list = Array.isArray(fields) ? fields : [];
    for (const f of list) {
      const name = String(f?.fieldName ?? "").trim().toLowerCase();
      const col = String(f?.fieldColumnName ?? "").trim().toLowerCase();
      if (name !== "status" && col !== "status") continue;
      const meta = f?.metaFieldValue;
      if (meta && typeof meta === "object") {
        const fromMeta = String(meta.label ?? meta.value ?? "").trim();
        if (fromMeta) return fromMeta;
      }
      const fv = f?.fieldValue;
      if (fv != null && typeof fv === "object") {
        const fromObj = String(fv.label ?? fv.value ?? "").trim();
        if (fromObj) return fromObj;
      }
      return String(fv ?? "").trim();
    }
    return "";
  }

  function rlHpStatusKeyFromLabel(label) {
    const n = String(label || "").trim().toLowerCase().replace(/\s+/g, "");
    if (n === "proposed") return "proposed";
    if (n === "inplanning") return "in_planning";
    if (n === "tobestaffed") return "to_be_staffed";
    if (n === "inprogress") return "in_progress";
    if (n === "onhold") return "on_hold";
    if (n === "blocked") return "blocked";
    if (n === "completed") return "completed";
    if (n === "cancelled" || n === "canceled") return "cancelled";
    return "proposed";
  }

  function rlHpStatusTag(statusKey) {
    const status = String(statusKey || "proposed");
    if (status === "completed") return { cls: "good", text: "Completed" };
    if (status === "cancelled") return { cls: "bad", text: "Cancelled" };
    if (status === "blocked") return { cls: "bad", text: "Blocked" };
    if (status === "on_hold") return { cls: "hold", text: "On Hold" };
    if (status === "in_progress") return { cls: "warn", text: "In progress" };
    if (status === "to_be_staffed") return { cls: "normal", text: "To be Staffed" };
    if (status === "in_planning") return { cls: "normal", text: "In Planning" };
    return { cls: "normal", text: "Proposed" };
  }

  function rlHpProgressBucketCount(progressStatus, group) {
    const want = Number(group);
    const rows = Array.isArray(progressStatus) ? progressStatus : [];
    for (const row of rows) {
      if (Number(row?.group) === want) {
        const n = Number(row?.count);
        return Number.isFinite(n) && n > 0 ? n : 0;
      }
    }
    return 0;
  }

  /** completed / (todo + inprogress + completed + blocked); 0 when empty. */
  function rlHpComputeProgressPercent(progressStatus) {
    const todo = rlHpProgressBucketCount(progressStatus, RL_HP_PROGRESS_TODO);
    const inProg = rlHpProgressBucketCount(progressStatus, RL_HP_PROGRESS_IN_PROGRESS);
    const done = rlHpProgressBucketCount(progressStatus, RL_HP_PROGRESS_COMPLETED);
    const blocked = rlHpProgressBucketCount(progressStatus, RL_HP_PROGRESS_BLOCKED);
    const total = todo + inProg + done + blocked;
    if (total <= 0) return 0;
    return Math.round((done / total) * 100);
  }

  function rlHpNormalizeDueDate(dueDate) {
    if (dueDate == null || dueDate === "") return "";
    if (typeof dueDate === "number" && Number.isFinite(dueDate)) {
      const d = new Date(dueDate);
      if (Number.isNaN(d.getTime())) return "";
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + day;
    }
    const s = String(dueDate).trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + mo + "-" + day;
  }

  function rlHpFmtDueDate(dateStr, locale) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(d.getTime())) return dateStr;
    try {
      return d.toLocaleDateString(locale || "en-GB", { year: "numeric", month: "short", day: "2-digit" });
    } catch (_) {
      return dateStr;
    }
  }

  /** @param {string} due YYYY-MM-DD @param {number|Date} [now] */
  // The card shows the START date (requested over the due/overdue pill); the
  // due date stays available in the card tooltip. "Starts" for a future date,
  // "Started" for a past one.
  function rlHpStartText(start, now) {
    if (!start) return "";
    const d = new Date(start + "T00:00:00");
    if (Number.isNaN(d.getTime())) return "Start " + start;
    const today = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const future = d.getTime() > t0.getTime();
    return (future ? "Starts " : "Started ") + rlHpFmtDueDate(start);
  }
  function rlHpDueTag(due, now) {
    if (!due) return null;
    const dueDate = new Date(due + "T00:00:00");
    if (Number.isNaN(dueDate.getTime())) return { cls: "", text: "Due: " + due };
    const today = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const d0 = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const diffDays = Math.round((d0.getTime() - t0.getTime()) / (1000 * 60 * 60 * 24));
    const formatted = rlHpFmtDueDate(due);
    if (diffDays < 0) return { cls: "bad", text: "Overdue (" + formatted + ")" };
    if (diffDays === 0) return { cls: "warn", text: "Due today" };
    if (diffDays <= 7) return { cls: "warn", text: "Due in " + diffDays + "d" };
    return { cls: "", text: "Due: " + formatted };
  }

  function rlHpNormalizeLightProject(raw) {
    const id = String(raw?.projectId ?? raw?.id ?? "").trim();
    const name = String(raw?.projectName ?? raw?.name ?? "").trim() || ("Project " + id);
    const owner = rlHpPersonDisplayName(raw?.projectOwner);
    const statusLabel = rlHpStatusLabelFromFields(raw?.fields);
    const status = rlHpStatusKeyFromLabel(statusLabel);
    const due = rlHpNormalizeDueDate(raw?.dueDate ?? raw?.endDate ?? raw?.targetDate);
    const start = rlHpNormalizeDueDate(raw?.startDate ?? raw?.startDateActual);
    const progress = rlHpComputeProgressPercent(raw?.progressStatus);
    return {
      id,
      name,
      owner,
      ownerKey: rlHpNormalizeOwnerKey(owner) || "no owner",
      status,
      statusLabel,
      due,
      start,
      progress,
      href: id ? ("/projects/" + encodeURIComponent(id) + "/plan") : "/projects",
    };
  }

  function rlHpFilterNormalizeBucket(rows, userId, keepFn) {
    const list = Array.isArray(rows) ? rows : [];
    const out = [];
    const seen = new Set();
    const keep = typeof keepFn === "function" ? keepFn : rlHpShouldKeepOwnerProject;
    for (const raw of list) {
      if (!keep(raw, userId)) continue;
      const p = rlHpNormalizeLightProject(raw);
      if (!p.id || seen.has(p.id)) continue;
      // Home list = all statuses except Completed.
      if (!rlHpIsHomeListStatus(p.status)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }

  /** Split lightV1 rows into owner-panel (on-project) vs member-not-owner (both except Completed). */
  function rlHpFilterAndNormalizeProjects(rows, userId) {
    return {
      ownerProjects: rlHpFilterNormalizeBucket(rows, userId, rlHpShouldKeepOwnerProject),
      memberProjects: rlHpFilterNormalizeBucket(rows, userId, rlHpShouldKeepMemberProject),
    };
  }

  function rlHpSortProjects(projects, mode) {
    const list = Array.isArray(projects) ? projects.slice() : [];
    const m = String(mode || "due_asc");
    if (m === "name_asc") {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return list;
    }
    if (m === "progress_desc") {
      list.sort((a, b) => (b.progress - a.progress) || String(a.name).localeCompare(String(b.name)));
      return list;
    }
    if (m === "progress_asc") {
      list.sort((a, b) => (a.progress - b.progress) || String(a.name).localeCompare(String(b.name)));
      return list;
    }
    if (m === "due_desc") {
      list.sort((a, b) => {
        const ad = a.due ? new Date(a.due + "T00:00:00").getTime() : Number.NEGATIVE_INFINITY;
        const bd = b.due ? new Date(b.due + "T00:00:00").getTime() : Number.NEGATIVE_INFINITY;
        return (bd - ad) || String(a.name).localeCompare(String(b.name));
      });
      return list;
    }
    // due_asc default — missing due last
    list.sort((a, b) => {
      const ad = a.due ? new Date(a.due + "T00:00:00").getTime() : Number.POSITIVE_INFINITY;
      const bd = b.due ? new Date(b.due + "T00:00:00").getTime() : Number.POSITIVE_INFINITY;
      return (ad - bd) || String(a.name).localeCompare(String(b.name));
    });
    return list;
  }

  function rlHpGroupProjectsByOwner(projects) {
    const grouped = Object.create(null);
    for (const p of Array.isArray(projects) ? projects : []) {
      const key = p.owner || "No owner";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(p);
    }
    return grouped;
  }

  function rlHpOrderOwnerKeys(ownerKeys, pinnedKey) {
    const keys = Array.isArray(ownerKeys) ? ownerKeys.slice() : [];
    const pin = rlHpNormalizeOwnerKey(pinnedKey);
    keys.sort((a, b) => {
      const aMine = !!pin && rlHpNormalizeOwnerKey(a) === pin;
      const bMine = !!pin && rlHpNormalizeOwnerKey(b) === pin;
      if (aMine !== bMine) return aMine ? -1 : 1;
      if (a === "No owner") return 1;
      if (b === "No owner") return -1;
      return a.localeCompare(b);
    });
    return keys;
  }

  /** First click → desc, second → asc, third → desc. */
  function rlHpNextSortMode(current, modeAsc, modeDesc) {
    if (current === modeDesc) return modeAsc;
    if (current === modeAsc) return modeDesc;
    return modeDesc;
  }
  // @@rlHomeProjectsHelpers:end

  // ── Home PROJECTS twin panels (v1.14.0) — Project Owner + In progress under Overdue ──

  const RL_HP_CACHE_MS = 5 * 60 * 1000;
  // A home visit always revalidates in the background — the cache is only the
  // instant first paint. This guard stops the SPA's route bouncing (ensure runs
  // at 60/350/900 ms after a navigation) from fetching several times in a row.
  const RL_HP_REVALIDATE_MIN_MS = 15 * 1000;
  // The last result also lives in Tampermonkey storage so the panels paint at
  // once on the next page load and only revalidate in the background.
  const RL_HP_GM_CACHE = "rlHpProjectsCache";
  const RL_HP_PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const RL_HP_PAGE_SIZE = 200;
  const RL_HP_MAX_PAGES = 50;
  // The tenant has 1000+ projects, i.e. 5-6 pages after the first; once the
  // first page reveals the count, the rest go out in a single parallel round.
  const RL_HP_FETCH_CONCURRENCY = 6;
  const RL_HP_GM_PINNED = "rlHpPinnedOwner";
  const RL_HP_GM_COLLAPSED = "rlHpCollapsedOwners";
  const RL_HP_GM_SORT = "rlHpSortMode";
  const RL_HP_PANEL_SEL = rlHpPanelSelector("");

  let rlHpCache = { at: 0, userId: "", ownerProjects: null, memberProjects: null };
  let rlHpInflight = null;
  let rlHpInflightUserId = "";
  let rlHpGen = 0;
  let rlHpUi = {
    sort: "due_asc",
    pinnedOwner: "",
    collapsed: new Set(),
    syncing: false,
    error: "",
    cachedAt: 0,
    ownerProjects: [],
    memberProjects: [],
  };

  function rlHpReadPersistedCache(userId) {
    try {
      const raw = GM_getValue(RL_HP_GM_CACHE, "");
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (!j || String(j.userId) !== String(userId)) return null;
      if (!Array.isArray(j.ownerProjects) || !Array.isArray(j.memberProjects)) return null;
      const at = Number(j.at || 0);
      if (!(Date.now() - at < RL_HP_PERSIST_MAX_AGE_MS)) return null;
      return { at, userId, ownerProjects: j.ownerProjects, memberProjects: j.memberProjects };
    } catch (_) { return null; }
  }
  function rlHpWritePersistedCache(cache) {
    try {
      GM_setValue(RL_HP_GM_CACHE, JSON.stringify({
        v: 1, at: cache.at, userId: cache.userId,
        ownerProjects: cache.ownerProjects, memberProjects: cache.memberProjects,
      }));
    } catch (_) {}
  }
  // The best result we have without touching the network — this session's, or
  // the persisted one from an earlier page load — whatever its age. Null when
  // there is none for the current user.
  function rlHpPeekCache() {
    const userId = rlHpReadCurrentUserId();
    if (!userId) return null;
    if (!rlHpCache.ownerProjects || rlHpCache.userId !== userId) {
      const persisted = rlHpReadPersistedCache(userId);
      if (persisted) rlHpCache = persisted;
    }
    return (rlHpCache.ownerProjects && rlHpCache.memberProjects && rlHpCache.userId === userId) ? rlHpCache : null;
  }
  function rlHpFmtClock(ts) {
    try { return new Date(ts).toLocaleTimeString(UI_LOCALE, { hour: "2-digit", minute: "2-digit" }); }
    catch (_) { return ""; }
  }

  function rlHpIsHomePath(pathname) {
    const p = String(pathname == null ? location.pathname : pathname);
    return p === "/" || p === "";
  }

  function rlHpReadCurrentUserId() {
    try {
      return rlHpParseApiKeyBundle(window.localStorage.getItem("__api_key")).userId;
    } catch (_) {
      return "";
    }
  }

  function rlHpLoadUiPrefs() {
    try {
      rlHpUi.pinnedOwner = String(GM_getValue(RL_HP_GM_PINNED, "") || "");
    } catch (_) { rlHpUi.pinnedOwner = ""; }
    try {
      const raw = GM_getValue(RL_HP_GM_COLLAPSED, "[]");
      const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      rlHpUi.collapsed = new Set(Array.isArray(arr) ? arr.map((s) => rlHpNormalizeOwnerKey(s)).filter(Boolean) : []);
    } catch (_) { rlHpUi.collapsed = new Set(); }
    try {
      const sort = String(GM_getValue(RL_HP_GM_SORT, "due_asc") || "due_asc");
      rlHpUi.sort = /^(due_asc|due_desc|progress_asc|progress_desc|name_asc)$/.test(sort) ? sort : "due_asc";
    } catch (_) { rlHpUi.sort = "due_asc"; }
  }

  function rlHpSaveCollapsed() {
    try { GM_setValue(RL_HP_GM_COLLAPSED, JSON.stringify([...rlHpUi.collapsed])); } catch (_) {}
  }

  function rlHpSavePinned(ownerKey) {
    rlHpUi.pinnedOwner = String(ownerKey || "");
    try { GM_setValue(RL_HP_GM_PINNED, rlHpUi.pinnedOwner); } catch (_) {}
  }

  function rlHpSaveSort(mode) {
    rlHpUi.sort = String(mode || "due_asc");
    try { GM_setValue(RL_HP_GM_SORT, rlHpUi.sort); } catch (_) {}
  }

  // Rocketlane's own Projects grid narrows lightV1 server-side with a `filter`
  // body (nativeFields / customFields / match / nestedFilter — the same object
  // the grid keeps in its `criteria` URL param). Verified live 2026-09-10:
  // `teamMembers oneOf <me>` returned 66 of 872 projects in one 1.4 MB page
  // (~1 s) where the unfiltered scan pages 5 × 3.7 MB. Owners are always team
  // members here (the owner clause matched 36, all inside the 66), but the
  // owner clause stays in as an "any" so an owner-only project is never lost.
  // An unknown field name is ignored by the API (count stays 872), so a
  // renamed field degrades to the slow full scan, not to an error.
  function rlHpBuildMineFilter(userId) {
    const me = String(userId || "").trim();
    if (!me) return null;
    return {
      nativeFields: [
        { name: "teamMembers", operation: "oneOf", value: me, sourceType: "project" },
        { name: "projectOwner", operation: "oneOf", value: me, sourceType: "project" },
      ],
      customFields: [],
      match: "any",
      nestedFilter: [],
    };
  }

  async function rlHpFetchLightPage(offset, limit, filter) {
    const body = { sortModel: [], filterModel: {} };
    if (filter) body.filter = filter;
    return gmRocketlaneRequest(
      "POST",
      "/projects/lightV1",
      { offset: String(offset), limit: String(limit) },
      body,
    );
  }

  async function rlHpFetchAllLightProjects(userId) {
    const filter = rlHpBuildMineFilter(userId);
    let first;
    try {
      first = await rlHpFetchLightPage(0, RL_HP_PAGE_SIZE, filter);
    } catch (e) {
      if (!filter) throw e;
      // The filtered call is the new path; if Rocketlane ever rejects it, fall
      // back to the full scan the panels always worked with.
      console.warn("[Rocketlane improvements] filtered lightV1 failed, falling back to the full scan:", e?.message || e);
      return rlHpFetchAllLightProjectsUnfiltered();
    }
    if (filter && typeof first?.count === "number" && first.count > 400) {
      console.warn("[Rocketlane improvements] lightV1 ignored the member filter (count " + first.count + ") — check the nativeFields names.");
    }
    return rlHpCollectLightPages(first, filter);
  }

  async function rlHpFetchAllLightProjectsUnfiltered() {
    const first = await rlHpFetchLightPage(0, RL_HP_PAGE_SIZE, null);
    return rlHpCollectLightPages(first, null);
  }

  async function rlHpCollectLightPages(first, filter) {
    const all = Array.isArray(first?.data) ? first.data.slice() : [];
    const total = typeof first?.count === "number" ? first.count : undefined;
    if (all.length < RL_HP_PAGE_SIZE || (total != null && all.length >= total)) return all;

    const offsets = [];
    let offset = RL_HP_PAGE_SIZE;
    let page = 1;
    while (page < RL_HP_MAX_PAGES) {
      if (total != null && offset >= total) break;
      offsets.push(offset);
      offset += RL_HP_PAGE_SIZE;
      page += 1;
      if (total == null) break;
    }

    if (total != null && offsets.length) {
      let cursor = 0;
      const workers = Array.from({ length: Math.min(RL_HP_FETCH_CONCURRENCY, offsets.length) }, async () => {
        while (cursor < offsets.length) {
          const off = offsets[cursor++];
          const json = await rlHpFetchLightPage(off, RL_HP_PAGE_SIZE, filter);
          const batch = Array.isArray(json?.data) ? json.data : [];
          if (batch.length) all.push(...batch);
        }
      });
      await Promise.all(workers);
      return all;
    }

    while (page < RL_HP_MAX_PAGES) {
      const json = await rlHpFetchLightPage(offset, RL_HP_PAGE_SIZE, filter);
      const batch = Array.isArray(json?.data) ? json.data : [];
      if (!batch.length) break;
      all.push(...batch);
      if (batch.length < RL_HP_PAGE_SIZE) break;
      offset += RL_HP_PAGE_SIZE;
      page += 1;
    }
    return all;
  }

  async function rlHpLoadProjects(opts) {
    const force = !!(opts && opts.force);
    const userId = rlHpReadCurrentUserId();
    if (!userId) throw new Error("No Rocketlane user id in __api_key yet — reload once logged in.");

    const now = Date.now();
    const cached = rlHpPeekCache();
    // revalidate: a page visit — refetch unless a fetch just completed.
    const maxAge = (opts && opts.revalidate) ? RL_HP_REVALIDATE_MIN_MS : RL_HP_CACHE_MS;
    if (!force && cached && (now - cached.at) < maxAge) {
      return { ownerProjects: cached.ownerProjects, memberProjects: cached.memberProjects };
    }
    // Join a fetch already running for this user (the document-start prefetch
    // and the panel's own refresh must not page lightV1 twice).
    if (!force && rlHpInflight && rlHpInflightUserId === userId) return rlHpInflight;

    const gen = ++rlHpGen;
    const promise = (async () => {
      const rows = await rlHpFetchAllLightProjects(userId);
      if (gen !== rlHpGen) {
        return {
          ownerProjects: rlHpCache.ownerProjects || [],
          memberProjects: rlHpCache.memberProjects || [],
        };
      }
      const buckets = rlHpFilterAndNormalizeProjects(rows, userId);
      rlHpCache = {
        at: Date.now(),
        userId,
        ownerProjects: buckets.ownerProjects,
        memberProjects: buckets.memberProjects,
      };
      rlHpWritePersistedCache(rlHpCache);
      return buckets;
    })();

    rlHpInflight = promise;
    rlHpInflightUserId = userId;
    try {
      return await promise;
    } finally {
      if (rlHpInflight === promise) { rlHpInflight = null; rlHpInflightUserId = ""; }
    }
  }

  const RL_HP_STYLE_READY = "1.14.11";

  function rlHpInjectStyles() {
    let style = document.getElementById("rlHomeProjectsStyles");
    // Version pin so a TM bump refreshes CSS once (same pattern as rlZdReady).
    if (style && style.dataset.rlHpReady === RL_HP_STYLE_READY) return;
    if (!style) {
      style = document.createElement("style");
      style.id = "rlHomeProjectsStyles";
      (document.head || document.documentElement).appendChild(style);
    }
    const sel = rlHpPanelSelector;
    const root = sel("");
    style.textContent = [
      root + "{",
      /* Light Rocketlane home chrome — soft translucent panel, not PPT dark shell. */
      "--rlhp-bg:rgba(255,255,255,0.78);--rlhp-border:rgba(15,23,42,0.10);--rlhp-muted:rgba(15,23,42,0.74);",
      "--rlhp-text:rgba(15,23,42,0.90);--rlhp-good:#059669;--rlhp-warn:#b45309;--rlhp-bad:#e11d48;",
      "--rlhp-accent:#0369a1;--rlhp-surface-2:rgba(255,255,255,0.72);--rlhp-radius:12px;",
      "box-sizing:border-box;width:100%;margin:16px 0 20px;padding:14px 16px 16px;",
      "border:1px solid var(--rlhp-border);border-radius:16px;background:var(--rlhp-bg);",
      "box-shadow:0 1px 2px rgba(15,23,42,0.04),0 8px 24px rgba(15,23,42,0.06);",
      "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);",
      "color:var(--rlhp-text);font-family:Segoe UI,system-ui,sans-serif;font-size:13px;line-height:1.35}",
      sel(" *") + "{box-sizing:border-box}",
      sel(" .rlhpHd") + "{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}",
      sel(" .rlhpTitle") + "{font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(15,23,42,0.82);margin:0}",
      sel(" .rlhpActions") + "{display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
      sel(" .rlhpBtn") + "{appearance:none;border:1px solid var(--rlhp-border);background:var(--rlhp-surface-2);color:var(--rlhp-text);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}",
      sel(" .rlhpBtn:hover") + "{background:rgba(255,255,255,0.92);border-color:rgba(15,23,42,0.16)}",
      sel(" .rlhpBtn:disabled") + "{opacity:0.55;cursor:default}",
      sel(" .rlhpBtnPrimary") + "{border-color:rgba(3,105,161,0.35);background:linear-gradient(180deg,rgba(3,105,161,0.10),rgba(255,255,255,0.65));color:var(--rlhp-accent)}",
      sel(" .rlhpStatusLine") + "{color:rgba(15,23,42,0.76);font-size:12.5px;margin:0 0 10px}",
      sel(" .rlhpStatusLine.rlhpErr") + "{color:var(--rlhp-bad)}",
      sel(" .rlhpEmpty") + "{color:var(--rlhp-muted);font-size:12px;padding:4px 2px}",
      sel(" .rlhpList") + "{max-height:min(50vh,520px);overflow:auto;display:grid;gap:10px;padding-right:2px}",
      sel(" .rlhpOwnerHd") + "{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;height:40px;padding:0 4px;box-sizing:border-box;cursor:pointer;border-radius:8px;user-select:none}",
      sel(" .rlhpOwnerHd:hover") + "{background:rgba(15,23,42,0.04)}",
      sel(" .rlhpOwnerLeft") + "{display:flex;gap:8px;align-items:center;min-width:0}",
      sel(" .rlhpOwnerName") + "{font-weight:650;color:var(--rlhp-text)}",
      sel(" .rlhpOwnerCount") + "{color:rgba(15,23,42,0.70);font-size:12px}",
      sel(" .rlhpOwnerCollapse") + "{color:var(--rlhp-muted);width:1em;display:inline-block}",
      sel(" .rlhpPinBtn") + "," + sel(" .rlhpSortBtn") + "{appearance:none;border:1px solid transparent;background:transparent;color:var(--rlhp-muted);border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer}",
      sel(" .rlhpPinBtn") + "{opacity:0.55;filter:grayscale(1)}",
      sel(" .rlhpPinBtn.pinned") + "{opacity:1;filter:none}",
      sel(" .rlhpSortCluster") + "{display:flex;gap:4px}",
      sel(" .rlhpSortBtn.active") + "{color:var(--rlhp-accent);border-color:rgba(3,105,161,0.28);background:rgba(3,105,161,0.08)}",
      sel(" .rlhpCard") + "{border:1px solid rgba(15,23,42,0.08);background:rgba(255,255,255,0.78);border-radius:var(--rlhp-radius);padding:14px;box-sizing:border-box;height:90px;display:grid;grid-template-rows:16px 22px 8px;align-content:start;gap:8px;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,0.04);transition:transform 120ms ease,background 120ms ease,border-color 120ms ease,box-shadow 120ms ease}",
      sel(" .rlhpCard:hover") + "{transform:translateY(-1px);background:rgba(255,255,255,0.92);border-color:rgba(15,23,42,0.14);box-shadow:0 4px 12px rgba(15,23,42,0.08)}",
      sel(" .rlhpCard:focus-visible") + "{outline:2px solid rgba(3,105,161,0.45);outline-offset:2px}",
      sel(" .rlhpRow") + "{display:flex;gap:10px;align-items:center;justify-content:space-between}",
      sel(" .rlhpName") + "{font-weight:650;font-size:13px;line-height:16px;height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rlhp-text)}",
      sel(" .rlhpPct") + "{display:inline-flex;align-items:center;font-size:11px;line-height:16px;height:16px;font-variant-numeric:tabular-nums;color:var(--rlhp-muted);font-weight:500;white-space:nowrap;padding:0}",
      sel(" .rlhpMeta") + "{display:flex;flex-wrap:nowrap;gap:12px;align-items:center;height:22px;overflow:hidden}",
      /* Status chip: hairline outline, neutral text, a small coloured dot carries the state — no tinted button look. */
      sel(" .rlhpTag") + "{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:500;line-height:1.2;color:var(--rlhp-muted);background:transparent;border:1px solid rgba(15,23,42,0.12);border-radius:999px;height:22px;box-sizing:border-box;padding:0 9px 0 8px;--rlhp-dot:rgba(100,116,139,0.9)}",
      sel(" .rlhpTag::before") + "{content:'';width:6px;height:6px;border-radius:50%;background:var(--rlhp-dot);flex:0 0 auto}",
      sel(" .rlhpTag.good") + "{--rlhp-dot:var(--rlhp-good)}",
      sel(" .rlhpTag.warn") + "{--rlhp-dot:var(--rlhp-warn)}",
      sel(" .rlhpTag.bad") + "{--rlhp-dot:var(--rlhp-bad)}",
      sel(" .rlhpTag.normal") + "{--rlhp-dot:var(--rlhp-accent)}",
      sel(" .rlhpTag.hold") + "{--rlhp-dot:rgba(148,163,184,0.95)}",
      sel(" .rlhpDate") + "{font-size:11px;line-height:22px;color:var(--rlhp-muted);letter-spacing:0.01em;white-space:nowrap}",
      sel(" .rlhpProgress") + "{height:8px;width:100%;border-radius:999px;background:rgba(15,23,42,0.22);box-shadow:inset 0 0 0 1px rgba(15,23,42,0.06);overflow:hidden}",
      sel(" .rlhpBar") + "{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#7dd3fc,#34d399);transition:width 400ms ease}",
      "@media (max-width:720px){" + root + "{margin:12px 0 16px;padding:12px}" + sel(" .rlhpList") + "{max-height:min(70vh,560px)}}",
    ].join("");
    style.dataset.rlHpReady = RL_HP_STYLE_READY;
  }

  function rlHpIsOverdueClimbStop(node) {
    if (!node || node === document.body || node === document.documentElement) return true;
    if (node.id === "root" || node.id === "page") return true;
    if (node.tagName === "MAIN") return true;
    const role = node.getAttribute && node.getAttribute("role");
    if (role === "main") return true;
    const cn = String(node.className || "");
    if (/\bant-row\b/i.test(cn)) return true;
    if (/router-shell__/i.test(cn)) return true;
    return false;
  }

  function rlHpNodeHasTaskGrid(node) {
    return !!(node && node.querySelector &&
      node.querySelector('[role="treegrid"], [role="grid"], .ag-root, .ag-theme-balham'));
  }

  function rlHpIsInsideHomeProjectsPanel(el) {
    return !!(el && el.closest && el.closest(RL_HP_PANEL_SEL));
  }

  function rlHpIsExactOverdueLabel(el) {
    if (!el || !el.isConnected) return false;
    if (rlHpIsInsideHomeProjectsPanel(el)) return false;
    const t = String(el.textContent || "").replace(/\s+/g, " ").trim();
    return t === "Overdue";
  }

  function rlHpClimbOverdueSectionRoot(labelEl) {
    if (!labelEl) return null;
    let node = labelEl;
    for (let i = 0; i < 10 && node && !rlHpIsOverdueClimbStop(node); i++) {
      // Tightest ancestor that wraps Overdue header + task grid (the white card).
      if (node !== labelEl && rlHpNodeHasTaskGrid(node)) return node;
      node = node.parentElement;
    }
    // Fallback: nearest sizable block under the climb-stop ceiling.
    let block = labelEl.parentElement;
    for (let i = 0; i < 5 && block && !rlHpIsOverdueClimbStop(block); i++) {
      if ((block.children && block.children.length >= 2) || (block.offsetHeight || 0) > 80) return block;
      block = block.parentElement;
    }
    const parent = labelEl.parentElement;
    return parent && !rlHpIsOverdueClimbStop(parent) ? parent : labelEl;
  }

  function rlHpFindOverdueSection() {
    // Prefer Rocketlane panel header title (exact "Overdue" text).
    const preferred = document.querySelectorAll(
      '[class*="StyledPanelHeaderTitle"], [class*="PanelHeaderTitle"]'
    );
    for (const el of preferred) {
      if (!rlHpIsExactOverdueLabel(el)) continue;
      const root = rlHpClimbOverdueSectionRoot(el);
      if (root) return root;
    }
    const nodes = document.querySelectorAll("p, h1, h2, h3, h4, h5, strong, span, div");
    for (const el of nodes) {
      if (!rlHpIsExactOverdueLabel(el)) continue;
      const root = rlHpClimbOverdueSectionRoot(el);
      if (root) return root;
    }
    return null;
  }

  function rlHpPanelFollowsOverdue(panel, overdue) {
    return !!(panel && overdue && overdue.isConnected && panel.isConnected &&
      overdue.nextElementSibling === panel);
  }

  // The panel elements, also while they are detached (waiting for the Overdue
  // card). Looking them up by id alone found nothing then, so the data render
  // drew into nothing and the shells were placed empty until Refresh.
  const rlHpPanelEls = {};

  function rlHpGetOwnerPanel() {
    return document.getElementById(RL_HP_PANEL_OWNER_ID) || rlHpPanelEls[RL_HP_PANEL_OWNER_ID] || null;
  }

  function rlHpGetMemberPanel() {
    return document.getElementById(RL_HP_PANEL_MEMBER_ID) || rlHpPanelEls[RL_HP_PANEL_MEMBER_ID] || null;
  }

  function rlHpHomePanelNeedsRemount() {
    if (!rlHpIsHomePath(location.pathname)) return false;
    const owner = rlHpGetOwnerPanel();
    const member = rlHpGetMemberPanel();
    if (!owner || !member || !owner.isConnected || !member.isConnected) return true;
    const overdue = rlHpFindOverdueSection();
    if (overdue) return !rlHpTwinPanelsFollowAnchor(overdue, owner, member);
    // Overdue not painted yet: keep retrying while either panel parked on MAIN/host.
    const host = rlHpFindMountHost();
    return rlHpPanelParkedOnHost(owner, host) || rlHpPanelParkedOnHost(member, host);
  }

  function rlHpFindGreetingAnchor() {
    const re = /^\s*Good\s+(morning|afternoon|evening)\b/i;
    const candidates = document.querySelectorAll("h1,h2,h3,p,div,span");
    for (const el of candidates) {
      if (!el || !el.isConnected) continue;
      if (rlHpIsInsideHomeProjectsPanel(el)) continue;
      const text = (el.childNodes && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
        ? String(el.textContent || "")
        : (el.childElementCount === 0 ? String(el.textContent || "") : "");
      if (!re.test(text)) continue;
      let node = el;
      for (let i = 0; i < 4 && node.parentElement; i++) {
        const parent = node.parentElement;
        if (parent === document.body || parent === document.documentElement) break;
        const kids = parent.children ? parent.children.length : 0;
        if (kids >= 2 && kids <= 12) return parent;
        node = parent;
      }
      return el;
    }
    return null;
  }

  function rlHpFindMountHost() {
    return document.querySelector("[role='main']") || document.querySelector("main") || document.body;
  }

  function rlHpPlaceAfter(anchor, panel) {
    if (!anchor || !panel) return;
    if (anchor.nextElementSibling !== panel) {
      anchor.insertAdjacentElement("afterend", panel);
    }
  }

  // How long to wait for the Overdue card before parking the panels elsewhere.
  // The card renders after its own data fetch; mounting at the top of MAIN in
  // the meantime and then moving under Overdue made the panels visibly jump.
  const RL_HP_ANCHOR_WAIT_MS = 10 * 1000;
  let rlHpFirstPlaceAttemptAt = 0;
  let rlHpRefreshKicked = false;
  let rlHpRenderedAfterPlace = false;

  function rlHpPlacePanels(ownerPanel, memberPanel) {
    // Prefer Overdue → Project Owner → In progress.
    const overdue = rlHpFindOverdueSection();
    if (overdue) {
      rlHpPlaceAfter(overdue, ownerPanel);
      rlHpPlaceAfter(ownerPanel, memberPanel);
      return;
    }
    // Overdue not painted yet: stay detached and let the ensure loop retry
    // (a detached panel counts as "needs remount"). Only after the wait —
    // a home without an Overdue card — fall back to the greeting or MAIN.
    if (!rlHpFirstPlaceAttemptAt) rlHpFirstPlaceAttemptAt = Date.now();
    if (Date.now() - rlHpFirstPlaceAttemptAt < RL_HP_ANCHOR_WAIT_MS) {
      if (!ownerPanel.isConnected && !memberPanel.isConnected) {
        rlHpScheduleAnchorRetry();
        return;
      }
      // Already parked by an earlier fallback: leave it, the remount check
      // moves it under Overdue as soon as the card appears.
      return;
    }
    const greeting = rlHpFindGreetingAnchor();
    if (greeting && greeting.parentElement) {
      rlHpPlaceAfter(greeting, ownerPanel);
      rlHpPlaceAfter(ownerPanel, memberPanel);
      return;
    }
    const host = rlHpFindMountHost();
    if (!host) return;
    if (ownerPanel.parentElement !== host) {
      host.insertBefore(ownerPanel, host.firstChild);
    }
    rlHpPlaceAfter(ownerPanel, memberPanel);
  }

  // The mutation observer only fires on DOM changes; if the page goes quiet
  // before Overdue paints (or never paints it), this timer still re-runs the
  // placement so the wait can expire and the fallback park can happen.
  let rlHpAnchorRetryTimer = null;
  function rlHpScheduleAnchorRetry() {
    if (rlHpAnchorRetryTimer) return;
    rlHpAnchorRetryTimer = setTimeout(() => {
      rlHpAnchorRetryTimer = null;
      if (!rlHpIsHomePath(location.pathname)) return;
      try { rlHpEnsureHomePanel(); } catch (_) {}
    }, 500);
  }

  function rlHpTeardownHomePanel() {
    const legacy = document.getElementById("rlHomeProjectsPanel");
    if (legacy) legacy.remove();
    const owner = rlHpGetOwnerPanel();
    if (owner) owner.remove();
    const member = rlHpGetMemberPanel();
    if (member) member.remove();
    rlHpPanelEls[RL_HP_PANEL_OWNER_ID] = null;
    rlHpPanelEls[RL_HP_PANEL_MEMBER_ID] = null;
    rlHpFirstPlaceAttemptAt = 0;
    rlHpRefreshKicked = false;
    rlHpRenderedAfterPlace = false;
    if (rlHpAnchorRetryTimer) { clearTimeout(rlHpAnchorRetryTimer); rlHpAnchorRetryTimer = null; }
  }

  function rlHpOpenProject(href) {
    const url = String(href || "/projects");
    try {
      history.pushState({}, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (_) {
      location.assign(url);
    }
  }

  function rlHpRenderProjectCard(p) {
    const card = document.createElement("div");
    card.className = "rlhpCard";
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", "Open project " + p.name);

    const top = document.createElement("div");
    top.className = "rlhpRow";
    const nm = document.createElement("div");
    nm.className = "rlhpName";
    nm.textContent = p.name;
    const pct = document.createElement("div");
    pct.className = "rlhpPct";
    pct.textContent = p.progress + "%";
    top.appendChild(nm);
    top.appendChild(pct);

    const meta = document.createElement("div");
    meta.className = "rlhpMeta";
    const st = rlHpStatusTag(p.status);
    const stEl = document.createElement("span");
    stEl.className = "rlhpTag " + st.cls;
    stEl.textContent = st.text;
    meta.appendChild(stEl);
    const startText = rlHpStartText(p.start);
    if (startText) {
      const sd = document.createElement("span");
      sd.className = "rlhpDate";
      sd.textContent = startText;
      meta.appendChild(sd);
    }
    const due = rlHpDueTag(p.due);
    const tip = [p.statusLabel || st.text, startText, due ? due.text.replace(/^Due: /, "Due ") : ""].filter(Boolean).join(" · ");
    card.title = tip;

    const prog = document.createElement("div");
    prog.className = "rlhpProgress";
    const bar = document.createElement("div");
    bar.className = "rlhpBar";
    bar.style.width = rlHpClamp(p.progress, 0, 100) + "%";
    prog.appendChild(bar);

    card.appendChild(top);
    card.appendChild(meta);
    card.appendChild(prog);

    const open = () => rlHpOpenProject(p.href);
    card.addEventListener("click", (e) => { e.preventDefault(); open(); });
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      open();
    });
    return card;
  }

  function rlHpCollapseKey(sectionId, ownerKey) {
    return String(sectionId || "") + ":" + rlHpNormalizeOwnerKey(ownerKey);
  }

  function rlHpRenderOwnerGroups(listEl, projects, sectionId) {
    const sorted = rlHpSortProjects(projects, rlHpUi.sort);
    const grouped = rlHpGroupProjectsByOwner(sorted);

    if (!rlHpUi.pinnedOwner && sectionId === "owner") {
      let best = "";
      let bestCount = 0;
      for (const [k, arr] of Object.entries(grouped)) {
        if (k === "No owner") continue;
        if (arr.length > bestCount) { best = k; bestCount = arr.length; }
      }
      if (best) rlHpSavePinned(rlHpNormalizeOwnerKey(best));
    }

    const ownerKeys = rlHpOrderOwnerKeys(Object.keys(grouped), rlHpUi.pinnedOwner);

    for (const ownerKey of ownerKeys) {
      const ownerProjects = grouped[ownerKey] || [];
      const ownerNorm = rlHpNormalizeOwnerKey(ownerKey);
      const collapseKey = rlHpCollapseKey(sectionId, ownerKey);
      const collapsed = rlHpUi.collapsed.has(collapseKey) || rlHpUi.collapsed.has(ownerNorm);

      const ownerHd = document.createElement("div");
      ownerHd.className = "rlhpOwnerHd";
      ownerHd.setAttribute("role", "button");
      ownerHd.tabIndex = 0;
      ownerHd.setAttribute("aria-expanded", collapsed ? "false" : "true");

      const left = document.createElement("div");
      left.className = "rlhpOwnerLeft";
      const chev = document.createElement("span");
      chev.className = "rlhpOwnerCollapse";
      chev.textContent = collapsed ? ">" : "v";
      const name = document.createElement("span");
      name.className = "rlhpOwnerName";
      name.textContent = ownerKey;
      const count = document.createElement("span");
      count.className = "rlhpOwnerCount";
      count.textContent = "(" + ownerProjects.length + ")";
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "rlhpPinBtn" + (ownerNorm === rlHpNormalizeOwnerKey(rlHpUi.pinnedOwner) ? " pinned" : "");
      pin.textContent = "📌";
      pin.title = ownerNorm === rlHpNormalizeOwnerKey(rlHpUi.pinnedOwner)
        ? "Your group — listed first. Click to unpin."
        : 'List "' + ownerKey + '" first';
      pin.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isMine = ownerNorm === rlHpNormalizeOwnerKey(rlHpUi.pinnedOwner);
        rlHpSavePinned(isMine ? "" : ownerNorm);
        rlHpRenderPanels();
      });
      left.appendChild(chev);
      left.appendChild(name);
      left.appendChild(count);
      left.appendChild(pin);

      const sortCluster = document.createElement("div");
      sortCluster.className = "rlhpSortCluster";
      const makeSortBtn = (modeAsc, modeDesc, label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rlhpSortBtn";
        const isAsc = rlHpUi.sort === modeAsc;
        const isDesc = rlHpUi.sort === modeDesc;
        if (isAsc || isDesc) btn.classList.add("active");
        btn.textContent = label + (isAsc ? " ▲" : isDesc ? " ▼" : "");
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          rlHpSaveSort(rlHpNextSortMode(rlHpUi.sort, modeAsc, modeDesc));
          rlHpRenderPanels();
        });
        return btn;
      };
      sortCluster.appendChild(makeSortBtn("due_asc", "due_desc", "Due"));
      sortCluster.appendChild(makeSortBtn("progress_asc", "progress_desc", "Progress"));

      ownerHd.appendChild(left);
      ownerHd.appendChild(sortCluster);

      const toggle = () => {
        if (rlHpUi.collapsed.has(collapseKey)) rlHpUi.collapsed.delete(collapseKey);
        else rlHpUi.collapsed.add(collapseKey);
        // Drop legacy unscoped key if present so both panels stay independent.
        rlHpUi.collapsed.delete(ownerNorm);
        rlHpSaveCollapsed();
        rlHpRenderPanels();
      };
      ownerHd.addEventListener("click", (e) => {
        if (e.target && e.target.closest && e.target.closest("button")) return;
        toggle();
      });
      ownerHd.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        toggle();
      });

      listEl.appendChild(ownerHd);
      if (collapsed) continue;

      for (const p of ownerProjects) {
        listEl.appendChild(rlHpRenderProjectCard(p));
      }
    }
  }

  function rlHpEnsurePanelShell(panelId, titleText, titleHint, listKind) {
    let panel = document.getElementById(panelId) || rlHpPanelEls[panelId] || null;
    if (!panel) {
      panel = document.createElement("section");
      panel.id = panelId;
    }
    rlHpPanelEls[panelId] = panel;
    panel.setAttribute("aria-label", titleText);
    panel.setAttribute("data-rlhp-kind", listKind);

    let hd = panel.querySelector(".rlhpHd");
    if (!hd) {
      panel.textContent = "";
      hd = document.createElement("div");
      hd.className = "rlhpHd";
      const title = document.createElement("h2");
      title.className = "rlhpTitle";
      title.textContent = titleText;
      title.title = titleHint || titleText;
      const actions = document.createElement("div");
      actions.className = "rlhpActions";
      if (listKind === "owner") {
        const add = document.createElement("a");
        add.className = "rlhpBtn rlhpBtnPrimary";
        add.href = "/projects";
        add.textContent = "+ RL Project";
        add.addEventListener("click", (e) => {
          e.preventDefault();
          rlHpOpenProject("/projects");
        });
        actions.appendChild(add);
      }
      const sync = document.createElement("button");
      sync.type = "button";
      sync.className = "rlhpBtn rlhpSyncBtn";
      sync.textContent = "Refresh";
      sync.addEventListener("click", (e) => {
        e.preventDefault();
        void rlHpRefresh({ force: true });
      });
      actions.appendChild(sync);
      hd.appendChild(title);
      hd.appendChild(actions);
      panel.appendChild(hd);

      const status = document.createElement("p");
      status.className = "rlhpStatusLine";
      status.setAttribute("data-rlhp-status", listKind);
      panel.appendChild(status);

      const list = document.createElement("div");
      list.className = "rlhpList";
      list.setAttribute("data-rlhp-list", listKind);
      panel.appendChild(list);
    }
    return panel;
  }

  function rlHpRenderOnePanel(panel, projects, listKind, emptyMsg, countLabel) {
    if (!panel) return;
    const count = Array.isArray(projects) ? projects.length : 0;

    const syncBtn = panel.querySelector(".rlhpSyncBtn");
    if (syncBtn) {
      syncBtn.disabled = !!rlHpUi.syncing;
      syncBtn.textContent = rlHpUi.syncing ? "Syncing…" : "Refresh";
    }

    const statusEl = panel.querySelector("[data-rlhp-status]");
    if (statusEl) {
      statusEl.classList.toggle("rlhpErr", !!rlHpUi.error);
      if (rlHpUi.error) statusEl.textContent = rlHpUi.error;
      else if (rlHpUi.syncing && !count) statusEl.textContent = "Loading projects…";
      else if (!count) statusEl.textContent = emptyMsg;
      else {
        let line = count + " " + countLabel;
        if (rlHpUi.syncing) line += " · refreshing…";
        else if (rlHpUi.cachedAt) line += " · updated " + rlHpFmtClock(rlHpUi.cachedAt);
        statusEl.textContent = line;
      }
    }

    const list = panel.querySelector('[data-rlhp-list="' + listKind + '"]');
    if (!list) return;
    list.textContent = "";
    if (!count && !rlHpUi.syncing) {
      const empty = document.createElement("div");
      empty.className = "rlhpEmpty";
      empty.textContent = "Nothing here.";
      list.appendChild(empty);
      return;
    }
    rlHpRenderOwnerGroups(list, projects, listKind);
  }

  function rlHpRenderPanels() {
    const owner = rlHpGetOwnerPanel();
    const member = rlHpGetMemberPanel();
    rlHpRenderOnePanel(
      owner,
      rlHpUi.ownerProjects,
      "owner",
      "No projects you are on (except Completed).",
      "project" + ((rlHpUi.ownerProjects || []).length === 1 ? "" : "s") + " · by owner",
    );
    rlHpRenderOnePanel(
      member,
      rlHpUi.memberProjects,
      "member",
      "No member projects (except Completed).",
      "project" + ((rlHpUi.memberProjects || []).length === 1 ? "" : "s") + " you joined",
    );
  }

  async function rlHpRefresh(opts) {
    // Stale-while-revalidate: paint the last result at once (this session's or
    // the persisted one), then let rlHpLoadProjects decide whether the network
    // is needed. A forced refresh keeps the list on screen too — only the
    // status line changes until the fresh result lands.
    const cached = rlHpPeekCache();
    if (cached) {
      rlHpUi.ownerProjects = cached.ownerProjects;
      rlHpUi.memberProjects = cached.memberProjects;
      rlHpUi.cachedAt = cached.at;
    }
    rlHpUi.syncing = true;
    rlHpUi.error = "";
    rlHpRenderPanels();
    try {
      const buckets = await rlHpLoadProjects(opts);
      rlHpUi.ownerProjects = Array.isArray(buckets?.ownerProjects) ? buckets.ownerProjects : [];
      rlHpUi.memberProjects = Array.isArray(buckets?.memberProjects) ? buckets.memberProjects : [];
      rlHpUi.cachedAt = rlHpCache.at || Date.now();
    } catch (e) {
      rlHpUi.error = String(e?.message || e || "Failed to load projects");
    } finally {
      rlHpUi.syncing = false;
      rlHpRenderPanels();
    }
  }

  function rlHpEnsureHomePanel() {
    if (!rlHpIsHomePath()) {
      rlHpTeardownHomePanel();
      return;
    }
    rlHpInjectStyles();
    rlHpLoadUiPrefs();
    // Drop legacy single-shell panel from ≤1.13.x.
    const legacy = document.getElementById("rlHomeProjectsPanel");
    if (legacy) legacy.remove();

    const ownerPanel = rlHpEnsurePanelShell(
      RL_HP_PANEL_OWNER_ID,
      "Project Owner",
      "People who own projects you are on (all statuses except Completed)",
      "owner",
    );
    const memberPanel = rlHpEnsurePanelShell(
      RL_HP_PANEL_MEMBER_ID,
      "In progress",
      "Projects you were added to as a team member (not owner); all statuses except Completed",
      "member",
    );
    rlHpPlacePanels(ownerPanel, memberPanel);
    // Kick the data load once per home visit — the panels may still be
    // detached (waiting for Overdue), which is fine: the result is rendered
    // into the shells and shows the moment they are placed.
    if (!rlHpRefreshKicked) {
      rlHpRefreshKicked = true;
      rlHpRenderPanels();
      void rlHpRefresh({ force: false, revalidate: true });
    }
    // First time both shells are in the document: draw the current state into
    // them (cached list, "Loading projects…", or the result that arrived while
    // they were detached).
    const placed = ownerPanel.isConnected && memberPanel.isConnected;
    if (placed && !rlHpRenderedAfterPlace) {
      rlHpRenderedAfterPlace = true;
      rlHpRenderPanels();
    } else if (!placed) {
      rlHpRenderedAfterPlace = false;
    }
  }

  // Prefetch: on the home path start paging lightV1 at document-start, so the
  // network round trips overlap the SPA's own load instead of starting when
  // the panels mount under Overdue. The api-key is already in localStorage;
  // a fresh persisted result short-circuits without a request, and the
  // panel's later refresh joins this fetch through rlHpInflight.
  if (rlHpIsHomePath(location.pathname)) {
    try { void rlHpLoadProjects({ force: false, revalidate: true }).catch(() => {}); } catch (_) {}
  }



  // ── Category / order-info engine (v1.11.0) — uses @@rlCategoryHelpers + gmRocketlaneRequest ──

  const rlCatPhaseByNameCache = new Map();
  const rlCatTaskSampleCache = new Map();
  const rlCatTaskSampleInFlight = new Map();
  let rlCatOrderInfoImportBusy = false;

  function rlCatClearCaches(projectId) {
    const pid = String(projectId ?? "").trim();
    if (!pid) {
      rlCatPhaseByNameCache.clear();
      rlCatTaskSampleCache.clear();
      return;
    }
    rlCatTaskSampleCache.delete(pid);
    const prefix = pid + "\0";
    for (const k of [...rlCatPhaseByNameCache.keys()]) {
      if (k.startsWith(prefix)) rlCatPhaseByNameCache.delete(k);
    }
  }

  async function rlCatFetchPhases(projectId) {
    const pid = String(projectId ?? "").trim();
    if (!pid) return [];
    try {
      const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(pid) + "/phases");
      const items = Array.isArray(json) ? json : (json?.data ?? []);
      const list = [];
      const seen = new Set();
      for (const ph of items) {
        const id = rlCatPhaseId(ph);
        if (id && !seen.has(id)) {
          seen.add(id);
          list.push(ph);
        }
      }
      return list;
    } catch (e) {
      console.warn("[rlCat] project phases failed, trying /phases", e?.message ?? e);
    }
    const filterKeys = ["projectId.eq", "projectID.eq", "project.eq", "projectId", "projectID", "project"];
    let lastErr = null;
    for (const key of filterKeys) {
      try {
        const list = [];
        const seen = new Set();
        let pageToken = "";
        let pages = 0;
        do {
          const q = { pageSize: 100 };
          q[key] = pid;
          if (pageToken) q.pageToken = pageToken;
          const json = await gmRocketlaneGet("/phases", q);
          const { data, pagination } = rlCatUnwrapList(json);
          for (const ph of data || []) {
            const id = rlCatPhaseId(ph);
            if (id && !seen.has(id)) {
              seen.add(id);
              list.push(ph);
            }
          }
          pageToken = rlCatPaginationNextToken(pagination) || "";
          pages += 1;
          if (pages >= 20 || !pageToken) break;
        } while (true);
        return list;
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) throw lastErr;
    return [];
  }

  async function rlCatCreatePhase(projectId, phaseName, opts) {
    const pid = String(projectId ?? "").trim();
    const name = String(phaseName ?? "").trim();
    if (!pid || !name) throw new Error("Project id and phase name required.");
    const today = new Date().toISOString().slice(0, 10);
    const phaseStart = String((opts && opts.startDate) || "").slice(0, 10) || today;
    let phaseDue = String((opts && opts.dueDate) || "").slice(0, 10) || phaseStart;
    if (phaseDue < phaseStart) phaseDue = phaseStart;
    const pidV = rlCatCoerceId(pid);
    try {
      const json = await gmRocketlaneRequest(
        "POST",
        "/projects/" + encodeURIComponent(pid) + "/phases",
        null,
        {
          projectPhaseName: name,
          startDate: phaseStart,
          dueDate: phaseDue,
          private: !!(opts && opts.private),
          phaseDescription: String((opts && opts.description) || ""),
        }
      );
      const phase = json?.data ?? json;
      if (phase && rlCatPhaseId(phase)) return phase;
    } catch (e) {
      console.warn("[rlCat] project-scoped phase create failed", e?.message ?? e);
    }
    const nextYear = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const bodies = [
      { phaseName: name, project: { projectId: pidV }, startDate: today, dueDate: nextYear },
      { phaseName: name, projectId: pidV, startDate: today, dueDate: nextYear },
    ];
    let lastErr = null;
    for (const body of bodies) {
      try {
        const json = await gmRocketlaneRequest("POST", "/phases", null, body);
        const phase = json?.data ?? json;
        if (phase) return phase;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Failed to create phase.");
  }

  async function rlCatGetOrCreatePhase(projectId, phaseName, opts) {
    const name = String(phaseName ?? "").trim();
    if (!name) throw new Error("Phase name required.");
    const pid = String(projectId ?? "").trim();
    const cacheKey = pid + "\0" + name.toLowerCase();
    const cached = rlCatPhaseByNameCache.get(cacheKey);
    if (cached) return cached;
    const phases = await rlCatFetchPhases(pid);
    const low = name.toLowerCase();
    const found = phases.find((ph) => rlCatPhaseName(ph).toLowerCase() === low);
    if (found) {
      rlCatPhaseByNameCache.set(cacheKey, found);
      return found;
    }
    const created = await rlCatCreatePhase(pid, name, opts);
    if (created) rlCatPhaseByNameCache.set(cacheKey, created);
    return created;
  }

  async function rlCatFetchTasks(projectId) {
    const pid = String(projectId ?? "").trim();
    if (!pid) return [];
    const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(pid) + "/tasks");
    const { data } = rlCatUnwrapList(json);
    return Array.isArray(data) ? data : [];
  }

  async function rlCatFetchTaskSample(projectId) {
    const pid = String(projectId ?? "").trim();
    if (!pid) return null;
    if (rlCatTaskSampleCache.has(pid)) return rlCatTaskSampleCache.get(pid);
    const pending = rlCatTaskSampleInFlight.get(pid);
    if (pending) return pending;
    const job = (async () => {
      try {
        const tasks = await rlCatFetchTasks(pid);
        const sample = tasks.length ? tasks[0] : null;
        rlCatTaskSampleCache.set(pid, sample);
        return sample;
      } catch (_) {
        rlCatTaskSampleCache.set(pid, null);
        return null;
      } finally {
        rlCatTaskSampleInFlight.delete(pid);
      }
    })();
    rlCatTaskSampleInFlight.set(pid, job);
    return job;
  }

  async function rlCatGetTaskById(taskId) {
    const id = String(taskId ?? "").trim();
    if (!id) throw new Error("Missing task id");
    const json = await gmRocketlaneGet("/tasks/" + encodeURIComponent(id), { includeAllFields: true });
    return json?.data ?? json;
  }

  function rlCatTaskAssignees(task) {
    const raw = task?.assignees ?? task?.assignee ?? null;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return [raw];
    return [];
  }

  async function rlCatCreateTask(projectId, phase, taskName, parentTaskId, opts) {
    const pid = String(projectId ?? "").trim();
    const name = String(taskName ?? "").trim();
    if (!pid || !name) throw new Error("Project id and task name required.");
    const parentTaskIdRaw = String(parentTaskId ?? "").trim();
    const phaseIdRaw = rlCatPhaseId(phase);
    if (!phaseIdRaw && !parentTaskIdRaw) throw new Error("Phase id required to create task.");

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startDateRaw = String(phase?.startDate ?? "").trim();
    const dueDateRaw = String(phase?.dueDate ?? "").trim();
    const startDate = startDateRaw || today;
    let dueDate = dueDateRaw || tomorrow;
    if (dueDate < startDate) dueDate = startDate;
    const pidV = rlCatCoerceId(pid);
    const phaseIdV = rlCatCoerceId(phaseIdRaw);
    const parentTaskIdV = parentTaskIdRaw ? rlCatCoerceId(parentTaskIdRaw) : "";

    const sample = await rlCatFetchTaskSample(pid).catch(() => null);
    const sampleAssignees = sample ? rlCatTaskAssignees(sample) : [];
    const assigneesMin = sampleAssignees
      .map((a) => {
        const userId = String(a?.userId ?? a?.id ?? "").trim();
        const emailId = String(a?.emailId ?? a?.email ?? "").trim();
        if (userId) return { userId };
        if (emailId) return { emailId };
        return null;
      })
      .filter(Boolean);

    let bodies = [];
    if (parentTaskIdRaw) {
      if (phaseIdRaw) {
        bodies.push(
          { taskName: name, project: { projectId: pidV }, projectPhase: { projectPhaseId: phaseIdV }, startDate, dueDate, type: "TASK", parentTask: parentTaskIdV },
          { taskName: name, project: { projectId: pidV }, projectPhase: { projectPhaseId: phaseIdV }, startDate, dueDate, type: "Task", parentTask: parentTaskIdV }
        );
      } else {
        bodies.push(
          { taskName: name, project: { projectId: pidV }, type: "TASK", parentTask: parentTaskIdV },
          { taskName: name, project: { projectId: pidV }, startDate, dueDate, type: "TASK", parentTask: parentTaskIdV }
        );
      }
    } else {
      bodies.push(
        { taskName: name, project: { projectId: pidV }, projectPhase: { projectPhaseId: phaseIdV }, startDate, dueDate, type: "Task" },
        { taskName: name, project: { projectId: pidV }, projectPhase: { projectPhaseId: phaseIdV }, startDate, dueDate }
      );
      if (assigneesMin.length) {
        bodies.unshift({
          taskName: name,
          project: { projectId: pidV },
          projectPhase: { projectPhaseId: phaseIdV },
          startDate,
          dueDate,
          type: "Task",
          assignees: assigneesMin,
        });
      }
    }
    if (opts && typeof opts.private === "boolean") {
      bodies = bodies.map((b) => ({ ...b, private: opts.private }));
    }

    let lastErr = null;
    for (const body of bodies) {
      try {
        const json = await gmRocketlaneRequest("POST", "/tasks", null, body);
        const task = json?.data ?? json;
        if (!task) continue;
        if (parentTaskIdRaw) {
          const createdTaskId = rlCatTaskId(task);
          if (createdTaskId) {
            let linkedParentId = String(rlCatTaskParentTaskId(task) ?? "").trim();
            let parentLinked = linkedParentId === parentTaskIdRaw;
            let verifyThrew = false;
            for (let attempt = 0; attempt < 2 && !parentLinked; attempt++) {
              try {
                if (attempt > 0) await new Promise((r) => setTimeout(r, 700));
                const full = await rlCatGetTaskById(createdTaskId);
                linkedParentId = String(rlCatTaskParentTaskId(full) ?? "").trim();
                parentLinked = linkedParentId === parentTaskIdRaw;
              } catch (e) {
                verifyThrew = true;
                break;
              }
            }
            if (!parentLinked && !verifyThrew && linkedParentId && linkedParentId !== parentTaskIdRaw) {
              try {
                await gmRocketlaneRequest("DELETE", "/tasks/" + encodeURIComponent(createdTaskId), null, null);
              } catch (_) {}
              lastErr = new Error("Created task linked to wrong parent (" + linkedParentId + ").");
              continue;
            }
          }
        }
        return task;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message ?? e);
        if (!/HTTP (400|404|422)/.test(msg)) throw e;
      }
    }
    throw lastErr || new Error("Failed to create task.");
  }

  async function rlCatFetchOrderHtml(projectId) {
    const pid = String(projectId ?? "").trim();
    if (!pid) throw new Error("Missing project id");
    const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(pid), { includeAllFields: true });
    const project = json?.data ?? json;
    const fields = Array.isArray(project?.fields) ? project.fields : [];
    const match = fields.find((f) => {
      const n = String(f?.fieldName ?? "").toLowerCase().replace(/\s+/g, "");
      return n.startsWith("hubspotdeliverystatus") || n.startsWith("deliverystatus");
    });
    return match ? String(match.fieldValue ?? "") : "";
  }

  function rlCatToast(msg) {
    try {
      let el = document.getElementById("rlCatToast");
      if (!el) {
        el = document.createElement("div");
        el.id = "rlCatToast";
        el.setAttribute("role", "status");
        document.body.appendChild(el);
      }
      el.textContent = String(msg || "");
      el.classList.add("show");
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove("show"), 4500);
    } catch (_) {
      console.log("[rlCat]", msg);
    }
  }

  async function rlCatSyncCategoryJobs(projectId, label, jobs, opts, allTasks) {
    const phase = await rlCatGetOrCreatePhase(projectId, label, opts);
    const phaseName = rlCatPhaseName(phase);
    const existing = Array.isArray(allTasks) ? allTasks : await rlCatFetchTasks(projectId);
    const planned = jobs || rlCatPlanBackfillJobs(phaseName, [], existing);
    // If caller passed explicit jobs from desired list, still dedupe against RL.
    const nrm = rlCatNormText;
    const phaseNorm = nrm(phaseName);
    const rlTopByName = new Map();
    const rlSubByKey = new Map();
    for (const rt of existing) {
      const rid = rlCatTaskId(rt);
      if (!rid) continue;
      const par = rlCatTaskParentTaskId(rt);
      if (par) rlSubByKey.set(par + "\0" + nrm(rlCatTaskName(rt)), rid);
      else if (nrm(rlCatTaskPhaseName(rt)) === phaseNorm) rlTopByName.set(nrm(rlCatTaskName(rt)), rid);
    }

    const taskOpts = { private: !!(opts && opts.private) };
    let okTasks = 0;
    let failTasks = 0;

    await rlCatRunWithConcurrency(planned, 4, async (it) => {
      let parentRlId = String(it.parentRlId || "").trim();
      if (!it.parentExists) {
        const dupe = rlTopByName.get(nrm(it.text));
        if (dupe) {
          parentRlId = dupe;
        } else {
          try {
            const created = await rlCatCreateTask(projectId, phase, it.text, undefined, taskOpts);
            parentRlId = rlCatTaskId(created);
            if (parentRlId) {
              rlTopByName.set(nrm(it.text), parentRlId);
              okTasks++;
            } else failTasks++;
          } catch (e) {
            failTasks++;
            console.warn("[rlCat] task create failed:", it.text, e);
          }
        }
      }
      for (const subText of it.subs || []) {
        const dupKey = parentRlId + "\0" + nrm(subText);
        if (parentRlId && rlSubByKey.has(dupKey)) continue;
        try {
          const createdSub = await rlCatCreateTask(projectId, phase, subText, parentRlId || undefined, taskOpts);
          const subRlId = rlCatTaskId(createdSub);
          if (subRlId) {
            if (parentRlId) rlSubByKey.set(dupKey, subRlId);
            okTasks++;
          } else failTasks++;
        } catch (e) {
          failTasks++;
          console.warn("[rlCat] subtask create failed:", subText, e);
        }
      }
    });
    return { okTasks, failTasks, phase };
  }

  async function rlCatImportFromOrderInfo(projectId, opts) {
    if (rlCatOrderInfoImportBusy) {
      rlCatToast("Order-info import already running — wait a moment.");
      return;
    }
    rlCatOrderInfoImportBusy = true;
    try {
      const pid = String(projectId ?? "").trim();
      if (!pid) {
        rlCatToast("No Rocketlane project id.");
        return;
      }
      rlCatToast("Reading order info…");
      let html = "";
      try {
        html = await rlCatFetchOrderHtml(pid);
      } catch (e) {
        rlCatToast("Couldn't read order info: " + (e?.message ?? e));
        return;
      }
      if (!String(html || "").trim()) {
        rlCatToast("No order info found on this project.");
        return;
      }
      const modules = rlCatParseOrderInfoModules(html);
      const plan = rlCatBuildDesiredPlan(modules);
      if (!plan.length) {
        rlCatToast("No IWMAC modules found in the order info.");
        return;
      }

      let allTasks = [];
      try {
        allTasks = await rlCatFetchTasks(pid);
      } catch (_) {
        allTasks = [];
      }
      let phases = [];
      try {
        phases = await rlCatFetchPhases(pid);
      } catch (_) {
        phases = [];
      }
      const phaseNormSet = new Set(phases.map((ph) => rlCatNormText(rlCatPhaseName(ph))));

      const syncBatch = [];
      let created = 0;
      let backfilled = 0;
      for (const entry of plan) {
        const phaseName = entry.preset.label;
        const jobs = rlCatPlanBackfillJobs(phaseName, entry.desired, allTasks);
        const phaseExists = phaseNormSet.has(rlCatNormText(phaseName));
        if (!phaseExists) {
          syncBatch.push({ label: phaseName, desired: entry.desired });
          created++;
        } else if (jobs.length) {
          syncBatch.push({ label: phaseName, desired: entry.desired });
          backfilled += jobs.reduce((n, j) => n + (j.parentExists ? 0 : 1) + (j.subs || []).length, 0);
        }
      }

      if (!syncBatch.length) {
        rlCatToast("Everything from the order info is already on this project.");
        return;
      }
      const parts = [];
      if (created) parts.push("creating " + created + " categor" + (created > 1 ? "ies" : "y"));
      if (backfilled) parts.push("backfilling " + backfilled + " missing task(s)");
      rlCatToast("Order info: " + parts.join("; ") + " — syncing…");

      const phaseOpts = {
        private: !!(opts && opts.private),
        startDate: opts && opts.startDate,
        dueDate: opts && opts.dueDate,
      };
      let okTasks = 0;
      let failTasks = 0;
      await rlCatRunWithConcurrency(syncBatch, 2, async (b) => {
        let tasksNow = allTasks;
        try {
          tasksNow = await rlCatFetchTasks(pid);
          allTasks = tasksNow;
        } catch (_) {}
        const jobs = rlCatPlanBackfillJobs(b.label, b.desired, tasksNow);
        if (!jobs.length) {
          await rlCatGetOrCreatePhase(pid, b.label, phaseOpts);
          return;
        }
        const r = await rlCatSyncCategoryJobs(pid, b.label, jobs, phaseOpts, tasksNow);
        if (r) {
          okTasks += r.okTasks;
          failTasks += r.failTasks;
        }
      });
      rlCatToast(
        failTasks > 0
          ? "Rocketlane: " + okTasks + " task(s) synced, " + failTasks + " failed."
          : "Rocketlane: all " + okTasks + " task(s) synced."
      );
      rlCatClearCaches(pid);
    } finally {
      rlCatOrderInfoImportBusy = false;
    }
  }

  async function rlCatCreateCustomOrPreset(projectId, label, preset, opts) {
    const pid = String(projectId ?? "").trim();
    const name = String(label || "").trim();
    if (!pid || !name) throw new Error("Project id and category name required.");
    const desired = [];
    if (preset) {
      for (const gt of [preset.integrationTask, preset.designTask]) {
        if (gt) desired.push({ text: gt, subs: [] });
      }
    }
    let allTasks = [];
    try {
      allTasks = await rlCatFetchTasks(pid);
    } catch (_) {}
    const jobs = rlCatPlanBackfillJobs(name, desired, allTasks);
    if (!jobs.length && !desired.length) {
      await rlCatGetOrCreatePhase(pid, name, opts);
      rlCatToast('Category "' + name + '" created in Rocketlane.');
      return;
    }
    if (!jobs.length) {
      rlCatToast('Category "' + name + '" already exists — nothing new to add.');
      return;
    }
    rlCatToast('Creating "' + name + '"…');
    const r = await rlCatSyncCategoryJobs(pid, name, jobs, opts, allTasks);
    rlCatToast(
      r.failTasks
        ? 'Category "' + name + '": ' + r.okTasks + " ok, " + r.failTasks + " failed."
        : 'Category "' + name + '": ' + r.okTasks + " task(s) synced."
    );
  }

  /** Open Rocketlane native Import templates → Choose a project template flow. */
  function rlCatOpenNativeTemplateChooser() {
    const clickEl = (el) => {
      if (!el) return false;
      try {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      } catch (_) {
        try {
          el.click();
          return true;
        } catch (_) {
          return false;
        }
      }
    };
    const findByText = (root, re) => {
      const nodes = root.querySelectorAll("button, a, [role='menuitem'], [role='option'], li, div, span");
      for (const n of nodes) {
        const t = String(n.textContent || "").replace(/\s+/g, " ").trim();
        if (re.test(t) && t.length < 80) return n;
      }
      return null;
    };
    // Prefer visible + menu first.
    let plus =
      document.querySelector('[data-cy*="add"][data-cy*="phase"], [data-cy*="import"][data-cy*="template"]') ||
      findByText(document, /^\+$/) ||
      findByText(document, /^Add$/i);
    // Common Rocketlane plan toolbar +
    if (!plus) {
      const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
      plus = candidates.find((b) => {
        const t = String(b.textContent || "").trim();
        const aria = String(b.getAttribute("aria-label") || "");
        return t === "+" || /add|create/i.test(aria);
      }) || null;
    }
    if (plus) clickEl(plus);
    const tryImport = () => {
      const importBtn = findByText(document, /Import templates?/i);
      if (importBtn) {
        clickEl(importBtn);
        setTimeout(() => {
          const choose = findByText(document, /Choose a project template/i) || findByText(document, /project template/i);
          if (choose) clickEl(choose);
        }, 200);
        return true;
      }
      return false;
    };
    if (!tryImport()) {
      setTimeout(() => {
        if (!tryImport()) rlCatToast("Open the plan + menu → Import templates to pick a template.");
      }, 250);
    }
  }

  function rlCatInjectStyles() {
    if (document.getElementById("rlCatStyles")) return;
    const s = document.createElement("style");
    s.id = "rlCatStyles";
    s.textContent = `
      #rlCatToast {
        position: fixed; z-index: 2147483000; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(20px);
        background: #0f1424; color: #f3f5fb; padding: 10px 16px; border-radius: 8px; font: 13px/1.35 system-ui,sans-serif;
        opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; max-width: min(520px, 92vw);
        box-shadow: 0 8px 28px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08);
      }
      #rlCatToast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
      #rlCatOverlay {
        position: fixed; inset: 0; z-index: 2147482900; background: rgba(15,20,36,.45);
        display: flex; align-items: center; justify-content: center; padding: 16px;
      }
      #rlCatOverlay .rlCatCard {
        background: #fff; color: #1a1f2e; width: min(440px, 96vw); border-radius: 12px; padding: 18px 18px 14px;
        box-shadow: 0 16px 48px rgba(0,0,0,.28); font: 13px/1.4 system-ui,sans-serif;
      }
      #rlCatOverlay .rlCatTitle { font-size: 16px; font-weight: 650; margin: 0 0 12px; }
      #rlCatOverlay .rlCatField { margin: 0 0 12px; }
      #rlCatOverlay .rlCatLabel { display: block; font-size: 12px; font-weight: 600; color: #4b5568; margin-bottom: 4px; }
      #rlCatOverlay .rlCatInput, #rlCatOverlay select.rlCatInput, #rlCatOverlay textarea.rlCatInput {
        width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 10px; font: inherit;
      }
      #rlCatOverlay .rlCatTypeRow { display: flex; gap: 8px; }
      #rlCatOverlay .rlCatTypeBtn {
        flex: 1; border: 1px solid #d1d5db; background: #f9fafb; border-radius: 8px; padding: 8px; cursor: pointer; font: inherit;
      }
      #rlCatOverlay .rlCatTypeBtn.active { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; font-weight: 600; }
      #rlCatOverlay .rlCatBtnRow { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
      #rlCatOverlay .rlCatBtn { border: 1px solid #d1d5db; background: #fff; border-radius: 8px; padding: 8px 14px; cursor: pointer; font: inherit; }
      #rlCatOverlay .rlCatBtn.primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
      [data-rl-cat-menu="1"] { font-weight: 600; }
    `;
    document.documentElement.appendChild(s);
  }

  function rlCatCloseDialog() {
    document.getElementById("rlCatOverlay")?.remove();
    document.removeEventListener("keydown", rlCatDialogOnKey);
  }

  function rlCatDialogOnKey(e) {
    if (e.key === "Escape") rlCatCloseDialog();
  }

  function rlCatOpenAddCategoryDialog(projectId) {
    rlCatInjectStyles();
    rlCatCloseDialog();
    const pid = String(projectId || getOneflowContext()?.rlProjectId || "").trim();
    if (!pid) {
      rlCatToast("Open a Rocketlane project first.");
      return;
    }
    const overlay = document.createElement("div");
    overlay.id = "rlCatOverlay";
    const card = document.createElement("div");
    card.className = "rlCatCard";
    card.addEventListener("click", (e) => e.stopPropagation());

    const title = document.createElement("div");
    title.className = "rlCatTitle";
    title.textContent = "Add category";
    card.appendChild(title);

    const mkField = (labelText) => {
      const wrap = document.createElement("div");
      wrap.className = "rlCatField";
      const lab = document.createElement("span");
      lab.className = "rlCatLabel";
      lab.textContent = labelText;
      wrap.appendChild(lab);
      return wrap;
    };

    const presetField = mkField("Preset (optional)");
    const presetSel = document.createElement("select");
    presetSel.className = "rlCatInput";
    for (const c of rlCatDialogChoices()) {
      const o = document.createElement("option");
      o.value = c.value;
      o.textContent = c.label;
      presetSel.appendChild(o);
    }
    // Default: order info on top is first option — select it.
    presetSel.value = "__orderinfo__";
    presetField.appendChild(presetSel);
    card.appendChild(presetField);

    const nameField = mkField("Category name");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "rlCatInput";
    nameInput.placeholder = "Category name";
    nameField.appendChild(nameInput);
    card.appendChild(nameField);

    const todayStr = new Date().toISOString().slice(0, 10);
    const dateField = mkField("Date (start → due)");
    const dateRow = document.createElement("div");
    dateRow.className = "rlCatTypeRow";
    const startInput = document.createElement("input");
    startInput.type = "date";
    startInput.className = "rlCatInput";
    startInput.value = todayStr;
    const dueInput = document.createElement("input");
    dueInput.type = "date";
    dueInput.className = "rlCatInput";
    dueInput.value = todayStr;
    startInput.addEventListener("change", () => {
      if (dueInput.value && dueInput.value < startInput.value) dueInput.value = startInput.value;
    });
    dateRow.appendChild(startInput);
    dateRow.appendChild(dueInput);
    dateField.appendChild(dateRow);
    card.appendChild(dateField);

    const typeField = mkField("Type");
    const typeRow = document.createElement("div");
    typeRow.className = "rlCatTypeRow";
    let isPrivate = false;
    const sharedBtn = document.createElement("button");
    sharedBtn.type = "button";
    sharedBtn.className = "rlCatTypeBtn active";
    sharedBtn.textContent = "Shared";
    const privateBtn = document.createElement("button");
    privateBtn.type = "button";
    privateBtn.className = "rlCatTypeBtn";
    privateBtn.textContent = "Private";
    const setType = (priv) => {
      isPrivate = priv;
      sharedBtn.classList.toggle("active", !priv);
      privateBtn.classList.toggle("active", priv);
    };
    sharedBtn.addEventListener("click", () => setType(false));
    privateBtn.addEventListener("click", () => setType(true));
    typeRow.appendChild(sharedBtn);
    typeRow.appendChild(privateBtn);
    typeField.appendChild(typeRow);
    card.appendChild(typeField);

    const descField = mkField("Description (optional)");
    const descTa = document.createElement("textarea");
    descTa.className = "rlCatInput";
    descTa.rows = 3;
    descField.appendChild(descTa);
    card.appendChild(descField);

    const btnRow = document.createElement("div");
    btnRow.className = "rlCatBtnRow";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "rlCatBtn";
    cancelBtn.textContent = "Cancel";
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "rlCatBtn primary";
    createBtn.textContent = "Create from order info";
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(createBtn);
    card.appendChild(btnRow);

    const updatePresetMode = () => {
      const v = presetSel.value;
      const orderMode = v === "__orderinfo__";
      const templateMode = v === "__template__";
      nameField.style.display = orderMode || templateMode ? "none" : "";
      descField.style.display = orderMode || templateMode ? "none" : "";
      dateField.style.display = templateMode ? "none" : "";
      typeField.style.display = templateMode ? "none" : "";
      if (orderMode) createBtn.textContent = "Create from order info";
      else if (templateMode) createBtn.textContent = "Open template chooser";
      else createBtn.textContent = "Create";
      const i = parseInt(v, 10);
      if (!orderMode && !templateMode && Number.isFinite(i) && RL_CATEGORY_PRESETS[i]) {
        nameInput.value = RL_CATEGORY_PRESETS[i].label;
      }
    };
    presetSel.addEventListener("change", updatePresetMode);
    updatePresetMode();

    cancelBtn.addEventListener("click", rlCatCloseDialog);
    overlay.addEventListener("click", rlCatCloseDialog);
    document.addEventListener("keydown", rlCatDialogOnKey);

    const doCreate = () => {
      const sd = startInput.value || todayStr;
      const dd = dueInput.value && dueInput.value >= sd ? dueInput.value : sd;
      const catOpts = {
        private: isPrivate,
        description: String(descTa.value || "").trim(),
        startDate: sd,
        dueDate: dd,
      };
      if (presetSel.value === "__orderinfo__") {
        rlCatCloseDialog();
        void rlCatImportFromOrderInfo(pid, catOpts);
        return;
      }
      if (presetSel.value === "__template__") {
        rlCatCloseDialog();
        rlCatOpenNativeTemplateChooser();
        return;
      }
      const label = String(nameInput.value || "").trim();
      if (!label) {
        nameInput.focus();
        return;
      }
      const presetIdx = parseInt(presetSel.value, 10);
      const preset = Number.isFinite(presetIdx) && RL_CATEGORY_PRESETS[presetIdx] ? RL_CATEGORY_PRESETS[presetIdx] : null;
      rlCatCloseDialog();
      void rlCatCreateCustomOrPreset(pid, label, preset, catOpts).catch((e) =>
        rlCatToast("Create failed: " + (e?.message ?? e))
      );
    };
    createBtn.addEventListener("click", doCreate);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doCreate();
      }
    });

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(() => {
      if (presetSel.value === "__orderinfo__") createBtn.focus();
      else nameInput.focus();
    }, 30);
  }

  /** Inject "Add category / order info" as first item above native Import templates. */
  function rlCatMaybeInjectNativeMenu() {
    const menus = document.querySelectorAll('[role="menu"], [class*="Menu"], [class*="Popover"], [class*="Dropdown"]');
    for (const menu of menus) {
      if (menu.querySelector('[data-rl-cat-menu="1"]')) continue;
      const importItem = Array.from(menu.querySelectorAll("button, a, [role='menuitem'], li, div")).find((n) =>
        /^Import templates?$/i.test(String(n.textContent || "").replace(/\s+/g, " ").trim())
      );
      if (!importItem) continue;
      const row = document.createElement("button");
      row.type = "button";
      row.setAttribute("data-rl-cat-menu", "1");
      row.setAttribute("role", "menuitem");
      row.textContent = "Add category / order info";
      row.style.cssText =
        "display:flex;width:100%;align-items:center;gap:8px;padding:8px 12px;border:0;background:transparent;cursor:pointer;font:inherit;text-align:left;";
      row.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const pid = String(getOneflowContext()?.rlProjectId || "").trim();
        rlCatOpenAddCategoryDialog(pid);
      });
      const host = importItem.closest("li, [role='menuitem'], button, a, div") || importItem;
      if (host.parentNode) host.parentNode.insertBefore(row, host);
      else menu.insertBefore(row, menu.firstChild);
    }
  }

  function rlCatCloseChooseTemplatesDialog() {
    const dlg = Array.from(document.querySelectorAll('[role="dialog"], dialog')).find((d) =>
      /Choose templates/i.test(String(d.textContent || ""))
    );
    if (!dlg) return;
    const close =
      dlg.querySelector('button[aria-label="Close"], button[aria-label*="Close" i]') ||
      Array.from(dlg.querySelectorAll("button")).find((b) =>
        /^Cancel$/i.test(String(b.textContent || "").replace(/\s+/g, " ").trim())
      );
    try {
      close?.click();
    } catch (_) {}
  }

  function rlCatRunOrderInfoFromChooser(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === "function") ev.stopImmediatePropagation();
    }
    rlCatCloseChooseTemplatesDialog();
    const pid = String(getOneflowContext()?.rlProjectId || "").trim();
    setTimeout(() => {
      void rlCatImportFromOrderInfo(pid, {});
    }, 120);
  }

  /**
   * Native "Choose templates" → project-template ozone-select listbox.
   * Put "From order info / HubSpot line items" as the first option.
   */
  function rlCatMaybeInjectTemplateListbox() {
    const listboxes = document.querySelectorAll('[role="listbox"]');
    for (const lb of listboxes) {
      if (lb.querySelector('[data-rl-cat-orderinfo="1"]')) continue;
      const looksLikeTemplates =
        lb.classList.contains("ozone-select__menu-list") ||
        !!lb.querySelector('[data-cy^="template.option."], [data-cy^="select-option-"]');
      if (!looksLikeTemplates) continue;
      const dlgOpen = Array.from(document.querySelectorAll('[role="dialog"], dialog')).some((d) =>
        /Choose templates|Choose a project template/i.test(String(d.textContent || ""))
      );
      if (!dlgOpen && !lb.querySelector('[data-cy^="template.option."]')) continue;

      const first = lb.querySelector('[role="option"]');
      const row = document.createElement("div");
      row.setAttribute("role", "option");
      row.setAttribute("data-rl-cat-orderinfo", "1");
      row.setAttribute("aria-selected", "false");
      row.setAttribute("aria-disabled", "false");
      row.setAttribute("tabindex", "-1");
      row.setAttribute("id", "rl-cat-orderinfo-option");
      row.setAttribute("data-cy", "select-option-From order info / HubSpot line items");
      // Match ozone-select option chrome so it sits flush with RL templates.
      row.className =
        "!flex items-center !text-14 px-03 rounded-4 cursor-pointer body-short-01 text-text-primary shrink-0 break-words min-h-[var(--height-medium)] py-[6px] ozone-select__option";
      row.style.cssText = "font-weight:600;gap:8px;color:#1d4ed8;order:-1;";
      const span = document.createElement("span");
      span.setAttribute("data-cy", "template.option.From order info / HubSpot line items");
      span.textContent = "From order info / HubSpot line items";
      row.appendChild(span);
      // mousedown+capture: react-select otherwise steals the click.
      row.addEventListener("mousedown", rlCatRunOrderInfoFromChooser, true);
      row.addEventListener("click", rlCatRunOrderInfoFromChooser, true);
      if (first) lb.insertBefore(row, first);
      else lb.appendChild(row);
      try {
        lb.scrollTop = 0;
      } catch (_) {}
    }
  }

  /** Empty plan CTA: put order-info action above "Choose a template". */
  function rlCatMaybeInjectEmptyPlanCta() {
    if (document.querySelector('[data-rl-cat-empty-cta="1"]')) return;
    const chooseBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      /^Choose a template$/i.test(String(b.textContent || "").replace(/\s+/g, " ").trim())
    );
    if (!chooseBtn || !chooseBtn.parentNode) return;
    let section = chooseBtn.parentElement;
    let found = false;
    for (let i = 0; i < 8 && section; i++) {
      if (/Create a plan from template/i.test(String(section.textContent || ""))) {
        found = true;
        break;
      }
      section = section.parentElement;
    }
    if (!found) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-rl-cat-empty-cta", "1");
    btn.textContent = "From order info / HubSpot line items";
    btn.title = "Create categories and tasks from HubSpot / order line items";
    btn.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;gap:6px;" +
      "margin:0 0 10px;padding:8px 14px;border-radius:8px;border:1px solid #1d4ed8;" +
      "background:#eff6ff;color:#1d4ed8;font:600 13px/1.3 system-ui,sans-serif;cursor:pointer;width:100%;box-sizing:border-box;";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const pid = String(getOneflowContext()?.rlProjectId || "").trim();
      void rlCatImportFromOrderInfo(pid, {});
    });
    chooseBtn.parentNode.insertBefore(btn, chooseBtn);
  }

  let rlCatMenuObserver = null;
  let rlCatMenuHookPending = null;
  function rlCatEnsureMenuHook() {
    rlCatInjectStyles();
    if (rlCatMenuObserver) return;
    const run = () => {
      rlCatMenuHookPending = null;
      try {
        rlCatMaybeInjectNativeMenu();
        rlCatMaybeInjectTemplateListbox();
        rlCatMaybeInjectEmptyPlanCta();
      } catch (_) {}
    };
    rlCatMenuObserver = new MutationObserver(() => {
      if (rlCatMenuHookPending) return;
      rlCatMenuHookPending = setTimeout(run, 40);
    });
    rlCatMenuObserver.observe(document.documentElement, { childList: true, subtree: true });
    run();
  }




  // @@rlMatchRuntime:start
  // Match-field reader keeps MULTI_SELECT as string[] (rlReadField flattens arrays to a joined string).
  function rlReadMatchField(fields, prefix) {
    const want = String(prefix).toLowerCase().replace(/\s+/g, "");
    const f = (fields || []).find((x) =>
      String(x?.fieldName ?? "").toLowerCase().replace(/\s+/g, "").startsWith(want)
    );
    if (!f) return "";
    const v = (f.fieldValue !== undefined && f.fieldValue !== null) ? f.fieldValue : f.value;
    if (v == null) return "";
    if (Array.isArray(v)) {
      return v
        .map((x) => (typeof x === "object" ? x?.label || x?.value : x))
        .filter((x) => x != null && x !== "")
        .map(String);
    }
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object" && v.value != null) return String(v.value).trim();
    return "";
  }

  function rlExtractRocketlaneCustomFields(projectObject) {
    const fields = Array.isArray(projectObject?.fields) ? projectObject.fields : [];
    const read = (prefix) => rlReadMatchField(fields, prefix);
    const productRaw = read("hubspotproducttypes");
    return {
      hubspotDealId:           String(read("hubspotdealid") || ""),
      youniumOrderNumber:      String(read("youniumordernumber") || ""),
      oneflowAgreementId:      String(read("oneflowagreementid") || read("oneflowid") || ""),
      newExistingPlantId:      String(read("newexistingplantid") || ""),
      hubspotPlantId:          String(read("hubspotplantid") || ""),
      hubspotPlantName:        String(read("hubspotplantname") || ""),
      hubspotDealName:         String(read("hubspotdealname") || ""),
      hubspotDealOwner:        String(read("hubspotdealowner") || ""),
      hubspotDealContact:      String(read("hubspotdealcontact") || ""),
      hubspotDealContactEmail: String(read("hubspotdealcontactemail") || ""),
      hubspotDealContactPhone: String(read("hubspotdealcontactphone") || ""),
      hubspotDealPartner:      String(read("hubspotdealpartner") || ""),
      hubspotCertifiedPartner: String(read("hubspotcertifiedpartner") || ""),
      hubspotDealStage:        String(read("hubspotdealstage") || ""),
      hubspotDepartment:       String(read("hubspotdepartment") || ""),
      hubspotDealType:         String(read("hubspotdealtype") || read("hubspotdealtypechoice") || ""),
      hubspotOrderType:        String(read("hubspotordertype") || ""),
      hubspotProductTypes:     Array.isArray(productRaw)
        ? productRaw
        : (productRaw ? [String(productRaw)] : []),
      hubspotBuildingType:     String(read("hubspotbuildingtype") || ""),
      hubspotPlantStreetAddr:  String(read("hubspotplantstreetaddress") || ""),
      hubspotFrameAgreementCo: String(read("hubspotframeagreementcompanyname") || ""),
      hubspotCreateDate:       String(read("hubspotcreatedate") || ""),
      hubspotDateSigned:       String(read("hubspotdatesigned") || ""),
      hubspotEstHWDelivery:    String(read("hubspotestimatedhwdelivery") || ""),
      hubspotMonthlyRevenue:   String(read("hubspotmonthlyreccuringrevenue") || ""),
      hubspotDealDescription:  String(read("hubspotdealdescription") || ""),
      hubspotDeliveryStatus:   String(
        read("hubspotdeliverystatusupdatemessage") ||
        read("deliverystatusupdatemessage") ||
        read("hubspotdeliverystatus") || ""
      ),
      hubspotLegalEntity:      String(read("hubspotlegalentity") || ""),
    };
  }

  function rlExtractLinksFromHtml(html) {
    const text = String(html || "");
    if (!text) return [];
    const out = [];
    const seen = new Set();
    const patterns = [
      /href\s*=\s*["']([^"']+)["']/gi,
      /https?:\/\/[^\s<>"']+/gi,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text)) !== null) {
        const url = (m[1] || m[0]).replace(/[).,;]+$/, "");
        if (seen.has(url)) continue;
        seen.add(url);
        const classified = rlClassifyLinkUrl(url);
        if (!classified) continue;
        const ctxStart = Math.max(0, m.index - 30);
        const ctxSlice = text.slice(ctxStart, m.index);
        const labelMatch = ctxSlice.match(/\b(Oneflow|Younium|HubSpot|Zendesk)\s*:?\s*$/i);
        if (labelMatch) classified.label = labelMatch[1];
        out.push(classified);
      }
    }
    return out;
  }

  function rlBuildProjectMatchContext(sourceObject) {
    const name = String(sourceObject?.name ?? "").trim();
    const partner = String(sourceObject?.client ?? "").trim();
    const owner = String(sourceObject?.owner ?? "").trim();
    const due = String(sourceObject?.due ?? sourceObject?.dueDate ?? "").trim();
    const start = String(sourceObject?.startDate ?? "").trim();
    const ofUrl = String(sourceObject?.oneflowUrl ?? "").trim();
    const hsUrl = String(sourceObject?.hubspotUrl ?? "").trim();
    const ynUrl = String(sourceObject?.youniumUrl ?? "").trim();
    const plantIdFromName = matchExtractPlantId(name) ||
      (extractPlantIdFromProjectName(name) || "");

    const fee = Number(sourceObject?.projectFee);
    const ownerEmail = String(sourceObject?.projectOwner?.emailId ?? "").toLowerCase().trim();
    const customerOrg = matchExtractOrgNumber(sourceObject?.customer?.organisationNumber || "");
    const partnerOrg = matchExtractOrgNumber(sourceObject?.partner?.organisationNumber || "");
    const cf = sourceObject?.fields ? rlExtractRocketlaneCustomFields(sourceObject) : {};
    const fks = {
      hubspotDealId: cf.hubspotDealId || "",
      oneflowAgreementId: cf.oneflowAgreementId || "",
      youniumOrderId: cf.youniumOrderNumber || "",
    };
    const finalPlantId =
      plantIdFromName ||
      matchExtractPlantId(cf.newExistingPlantId || "") ||
      matchExtractPlantId(cf.hubspotPlantId || "") ||
      String(cf.newExistingPlantId || cf.hubspotPlantId || "").replace(/\D+/g, "");

    const contactEmail = String(cf.hubspotDealContactEmail || "").toLowerCase().trim();
    const contactPhone = String(cf.hubspotDealContactPhone || "").replace(/[^\d+]/g, "");
    const embeddedLinks = [
      ...rlExtractLinksFromHtml(cf.hubspotDealDescription || ""),
      ...rlExtractLinksFromHtml(cf.hubspotDeliveryStatus || ""),
    ];
    const dedupeByUrl = (arr) => {
      const seen = new Set();
      const out = [];
      for (const x of arr) {
        const k = x?.url || "";
        if (k && !seen.has(k)) { seen.add(k); out.push(x); }
      }
      return out;
    };
    const allEmbedded = dedupeByUrl(embeddedLinks);
    try {
      const slotHtml = (cf.hubspotDealDescription || "") + "\n" + (cf.hubspotDeliveryStatus || "");
      if (slotHtml.trim()) {
        const slots = rlParseProjectLinksFromHtml(slotHtml);
        const kindByKey = {};
        const tagSlot = (url, kind) => {
          const c = url ? rlClassifyLinkUrl(url) : null;
          if (c && c.recordId) kindByKey[c.platform + ":" + String(c.recordId)] = kind;
        };
        tagSlot(slots.oneflowOrder, "order");
        tagSlot(slots.oneflowSubscription, "subscription");
        tagSlot(slots.younium, "order");
        tagSlot(slots.youniumSubscription, "subscription");
        for (const l of allEmbedded) {
          const k = kindByKey[l.platform + ":" + String(l.recordId)];
          if (k) l.linkKind = k;
        }
      }
    } catch (_) {}

    const zendeskTicketIds = allEmbedded
      .filter((l) => l && l.platform === "zendesk" && l.recordId)
      .map((l) => String(l.recordId));
    const productTypes = Array.isArray(cf.hubspotProductTypes) ? cf.hubspotProductTypes : [];
    const productTypeSet = new Set(productTypes.map(matchNormalize));

    return Object.freeze({
      name,
      nameNormalized: matchNormalize(name),
      nameTokens: matchTokenize(name),
      plantId: finalPlantId,
      partner,
      partnerNormalized: matchNormalize(partner),
      partnerTokens: matchTokenize(partner),
      owner,
      ownerNormalized: matchNormalize(owner),
      ownerTokens: matchTokenize(owner),
      ownerEmail,
      ownerEmailDomain: matchExtractEmailDomain(ownerEmail),
      due,
      dueTimestamp: due ? Date.parse(due) : NaN,
      startDate: start,
      startTimestamp: start ? Date.parse(start) : NaN,
      projectFee: Number.isFinite(fee) && fee > 0 ? fee : NaN,
      customerOrgNumber: customerOrg,
      partnerOrgNumber: partnerOrg,
      foreignKeys: fks,
      hubspotMirror: {
        dealId: cf.hubspotDealId || "",
        dealName: cf.hubspotDealName || "",
        plantName: cf.hubspotPlantName || "",
        dealOwner: cf.hubspotDealOwner || "",
        dealContact: cf.hubspotDealContact || "",
        dealPartner: cf.hubspotDealPartner || "",
        certifiedPartner: cf.hubspotCertifiedPartner || "",
        dealStage: cf.hubspotDealStage || "",
        department: cf.hubspotDepartment || "",
        dealType: cf.hubspotDealType || "",
        orderType: cf.hubspotOrderType || "",
        productTypes,
        productTypeSet,
        buildingType: cf.hubspotBuildingType || "",
        plantStreetAddr: cf.hubspotPlantStreetAddr || "",
        frameAgreementCo: cf.hubspotFrameAgreementCo || "",
        createDate: cf.hubspotCreateDate || "",
        dateSigned: cf.hubspotDateSigned || "",
        estHWDelivery: cf.hubspotEstHWDelivery || "",
        monthlyRevenue: cf.hubspotMonthlyRevenue || "",
        dealDescription: cf.hubspotDealDescription || "",
        deliveryStatus: cf.hubspotDeliveryStatus || "",
        legalEntity: cf.hubspotLegalEntity || "",
      },
      contactEmail,
      contactEmailDomain: matchExtractEmailDomain(contactEmail),
      contactPhone,
      youniumOrderNumber: cf.youniumOrderNumber || "",
      embeddedLinks: allEmbedded,
      zendeskTicketIds,
      existingLinks: { oneflow: ofUrl, hubspot: hsUrl, younium: ynUrl },
      existingLinksClassified: {
        oneflow: ofUrl ? rlClassifyLinkUrl(ofUrl) : null,
        hubspot: hsUrl ? rlClassifyLinkUrl(hsUrl) : null,
        younium: ynUrl ? rlClassifyLinkUrl(ynUrl) : null,
      },
    });
  }

  const rlMatchCtxCache = new Map();

  async function rlBuildEnrichedProjectMatchContext(rlProjectId) {
    const pid = String(rlProjectId || "").trim();
    const pageName = readProjectName() || "";
    if (!/^\d+$/.test(pid)) {
      return rlBuildProjectMatchContext({ name: pageName });
    }
    try {
      const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(pid), { includeAllFields: true });
      const proj = json?.data ?? json;
      const ownerFirst = proj?.projectOwner?.firstName || "";
      const ownerLast = proj?.projectOwner?.lastName || "";
      const sourceObject = {
        ...proj,
        name: pageName || proj?.projectName || "",
        client: proj?.customer?.companyName || "",
        owner: (ownerFirst + " " + ownerLast).trim(),
        due: proj?.dueDate,
        startDate: proj?.startDate,
        customer: proj?.customer,
        partner: Array.isArray(proj?.partners) ? proj.partners[0] : null,
        projectOwner: proj?.projectOwner,
        projectFee: proj?.projectFee,
        fields: proj?.fields,
      };
      return rlBuildProjectMatchContext(sourceObject);
    } catch (_) {
      return rlBuildProjectMatchContext({ name: pageName });
    }
  }

  function rlGetMatchContextCached(rlProjectId, gen) {
    const key = String(rlProjectId || "") + ":" + String(gen || 0);
    if (rlMatchCtxCache.has(key)) return rlMatchCtxCache.get(key);
    const pr = rlBuildEnrichedProjectMatchContext(rlProjectId);
    rlMatchCtxCache.set(key, pr);
    return pr;
  }

  function rlExtractOneflowDataFields(a) {
    const out = {
      plantId: "", plantName: "", hubspotDealId: "", zendeskTicketId: "",
      dealPartner: "", customerContact: "", dealContactEmail: "",
      dealContactPhone: "", yourReference: "", description: "",
    };
    const fields = Array.isArray(a?.data_fields) ? a.data_fields
                 : Array.isArray(a?.dataFields) ? a.dataFields : [];
    const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    for (const f of fields) {
      const value = String(f?.value ?? "").trim();
      if (!value) continue;
      const key = norm(f?.name);
      const cid = norm(f?.custom_id ?? f?.customId);
      const has = (n) => key.includes(n) || cid.includes(n);
      const eq = (n) => key === n || cid === n;
      if (!out.hubspotDealId && has("hubspotdealid")) {
        const d = value.replace(/\D+/g, "");
        if (d) out.hubspotDealId = d;
      } else if (!out.plantId && (eq("plantid") || cid === "plantid")) {
        out.plantId = value.replace(/\D+/g, "") || value;
      } else if (!out.plantName && has("plantname")) {
        out.plantName = value;
      } else if (has("zendeskticket")) {
        const d = value.replace(/\D+/g, "");
        if (d && !out.zendeskTicketId) out.zendeskTicketId = d;
      } else if (!out.dealPartner && has("dealpartner")) {
        out.dealPartner = value;
      } else if (!out.customerContact && has("customercontact")) {
        out.customerContact = value;
      } else if (!out.dealContactEmail && has("dealcontactemail")) {
        out.dealContactEmail = value.toLowerCase();
      } else if (!out.dealContactPhone && has("dealcontactphone")) {
        out.dealContactPhone = value;
      } else if (!out.yourReference && has("yourreference")) {
        out.yourReference = value;
      }
    }
    if (!out.description) out.description = String(a?.description ?? "").trim();
    return out;
  }

  const RL_YOUNIUM_MATCH_STATUS = {
    0: "Draft", 1: "Created", 5: "Draft", 7: "Partially delivered",
    8: "Delivered", 9: "Active", 10: "Partially paid", 11: "Paid",
  };

  function rlOneflowToMatchCandidate(a) {
    const stateLabel = ONEFLOW_STATE_LABEL[a?.state] ?? ("state " + a?.state);
    const parties = Array.isArray(a?.parties) ? a.parties : [];
    const partyNames = parties.map((p) => String(p?.name ?? "").trim()).filter(Boolean);
    const contactEmails = [];
    const contactNames = [];
    const orgNumbers = [];
    const contactPhones = [];
    for (const p of parties) {
      if (p?.email) contactEmails.push(String(p.email).toLowerCase());
      if (p?.phone_number) contactPhones.push(String(p.phone_number));
      const onr = p?.orgnr ?? p?.identification_number?.value ?? "";
      if (onr) orgNumbers.push(String(onr));
      if (Array.isArray(p?.participants)) {
        for (const part of p.participants) {
          if (part?.email) contactEmails.push(String(part.email).toLowerCase());
          if (part?.name) contactNames.push(String(part.name));
          if (part?.phone_number) contactPhones.push(String(part.phone_number));
        }
      }
    }
    const df = rlExtractOneflowDataFields(a);
    if (df.dealContactEmail) contactEmails.push(df.dealContactEmail);
    if (df.customerContact) contactNames.push(df.customerContact);
    if (df.dealContactPhone) contactPhones.push(df.dealContactPhone);
    if (df.dealPartner && !partyNames.some((n) => matchNormalize(n) === matchNormalize(df.dealPartner))) {
      partyNames.push(df.dealPartner);
    }
    const amount = Number(a?.agreement_value?.amount);
    const currency = String(a?.agreement_value?.currency ?? "");
    const date = a?.sign_time ?? a?.start_time ?? a?.created_time ?? a?.updated_time ?? null;
    const kind = ofKindByName(a?.name);
    const kindBadge = kind === "subscription" ? "Subscription · " : "Order · ";
    return {
      id: a?.id,
      platform: "oneflow",
      url: ofDocumentUrl(a?.id),
      primaryText: kindBadge + (String(a?.name ?? "").trim() || "(no name)"),
      secondaryText: stateLabel + (partyNames.length ? " · " + partyNames.join(", ") : ""),
      matchableTexts: [a?.name, ...partyNames, df.plantName, df.yourReference, df.description].filter(Boolean),
      partyNames,
      contactNames,
      contactEmails,
      contactPhones,
      orgNumbers,
      plantId: matchExtractPlantId(a?.name ?? "") || df.plantId || "",
      hubspotDealId: df.hubspotDealId || "",
      zendeskTicketId: df.zendeskTicketId || "",
      status: stateLabel,
      date,
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      currency,
      oneflowKind: kind,
      raw: a,
    };
  }

  function rlYouniumToMatchCandidate(o, productName) {
    const statusLabel = RL_YOUNIUM_MATCH_STATUS[o?.status] ?? ("status " + o?.status);
    const cf = {};
    for (const c of (Array.isArray(o?.customFields) ? o.customFields : [])) {
      if (c && c.name != null && c.value != null && c.value !== "") cf[String(c.name)] = String(c.value);
    }
    const description = String(o?.description ?? "").trim();
    let plantId = String(o?.plant_id ?? cf.plant_id ?? "").trim();
    if (!plantId && description) plantId = String(matchExtractPlantId(description) || "");
    const plantName = String(o?.plant_name ?? cf.plant_name ?? "").trim();
    const accountName = String(o?.accountname ?? o?._account?.name ?? "").trim();
    const partyNames = [accountName].filter(Boolean);
    const dateRaw = o?.effectiveStartDate ?? o?.effectiveEndDate ?? o?.orderDate ?? null;
    const dateDisplay = dateRaw ? String(dateRaw).slice(0, 10) : "";
    const moneyOf = (m) => matchExtractMoneyAmount(m && typeof m === "object" ? m.amount : m);
    const tcv = moneyOf(o?.tcv ?? o?.totalContractValue);
    const acv = moneyOf(o?.acv ?? o?.annualContractValue ?? o?.arr);
    const cmrr = moneyOf(o?.cmrr ?? o?.mrr);
    const bestAmount =
      Number.isFinite(tcv) && tcv > 0 ? tcv :
      Number.isFinite(acv) && acv > 0 ? acv :
      Number.isFinite(cmrr) && cmrr > 0 ? cmrr : null;
    const currency = String(o?.currency?.code ?? o?.currency ?? o?.currencyCode ?? "").trim();
    const dealContact = String(cf.deal_contact ?? "").trim();
    const hubspotDealId = String(cf.integrationHubspotHubspotDealId ?? "").trim();
    const orgNumbers = [o?._account?.organizationNumber, o?._account?.organisationNumber]
      .filter(Boolean).map(String);
    const primaryExtra = productName || plantName;
    return {
      id: o?.id,
      platform: "younium",
      url: ynOrderUrl(o?.id),
      primaryText: (o?.orderNumber ?? "(no number)") + (primaryExtra ? " — " + primaryExtra : ""),
      secondaryText:
        statusLabel +
        (accountName ? " · " + accountName : "") +
        (dateDisplay ? " · " + dateDisplay : ""),
      matchableTexts: [
        o?.orderNumber, plantName, accountName, description, productName,
        cf.iwmac_deal_invoice_reference_project,
      ].filter(Boolean).map(String),
      partyNames,
      contactNames: dealContact ? [dealContact] : [],
      contactEmails: o?._account?.domain ? ["x@" + String(o._account.domain).trim().toLowerCase()] : [],
      contactPhones: [],
      orgNumbers,
      plantId,
      hubspotDealId: hubspotDealId || undefined,
      status: statusLabel,
      date: dateRaw,
      amount: bestAmount,
      currency,
      orderNumber: String(o?.orderNumber || "").trim(),
      recordType: "order",
      raw: o,
    };
  }

  function rlHubspotUrlToMatchCandidate(url) {
    const cls = rlClassifyLinkUrl(url) || { platform: "hubspot", recordId: "", url };
    return {
      id: cls.recordId || url,
      platform: "hubspot",
      url: rlNormalizeHttpUrl(url) || url,
      primaryText: cls.recordId
        ? ("HubSpot deal " + cls.recordId)
        : "HubSpot (from project fields)",
      secondaryText: url,
      matchableTexts: [url, cls.recordId].filter(Boolean),
      partyNames: [],
      contactNames: [],
      contactEmails: [],
      contactPhones: [],
      orgNumbers: [],
      plantId: "",
      status: "",
      date: null,
      amount: null,
      currency: "",
      raw: { url },
    };
  }

  function rlScoreWithKindBonus(candidate, ctx, wantKind) {
    const prefer = wantKind === "subscription" ? "subscription" : "order";
    const { score, percent, signals } = scoreMatchCandidate(candidate, ctx, { preferLinkKind: prefer });
    if (!wantKind || candidate.platform !== "oneflow") {
      return { candidate, score, percent, signals };
    }
    const kindMatch = candidate.oneflowKind === prefer;
    const adjustedSignals = signals.slice();
    let adjustedScore = score;
    if (kindMatch) {
      adjustedSignals.push({ label: "Matches requested kind (" + prefer + ")", points: 6 });
      adjustedScore += 6;
    } else {
      adjustedSignals.push({
        label: "Wrong document kind (got " + candidate.oneflowKind + ", want " + prefer + ")",
        points: -25,
      });
      adjustedScore -= 25;
    }
    return {
      candidate,
      score: adjustedScore,
      percent: Math.min(100, Math.max(0, Math.round(adjustedScore))),
      signals: adjustedSignals,
    };
  }

  async function youniumFindAllSubscriptionsByPlantId(plantId) {
    const pid = String(plantId || "").trim();
    if (!pid) return [];
    const summaries = await youniumFindAllOrdersByPlantId(pid);
    const out = [];
    for (const summary of summaries) {
      if (!summary?.id) continue;
      try {
        const full = await ynGetOrderById(summary.id);
        const merged = { ...full, ...summary };
        const match = findIwmacSubscriptionItem(merged);
        if (match) out.push({ order: merged, productName: match.productName });
      } catch (e) {
        console.warn("[Younium status] failed to hydrate order " + summary.id, e);
      }
    }
    return out;
  }
  // @@rlMatchRuntime:end


  async function rlFetchIqcTask(rlProjectId) {
    const empty = {
      found: false, taskId: "", taskName: "", descriptionHtml: "", links: rlEmptyProjectLinks(),
    };
    const pid = String(rlProjectId || "").trim();
    if (!pid) return empty;
    const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(pid) + "/tasks");
    const list = Array.isArray(json) ? json : (json?.data || []);
    const qc = list.find((t) => /\binternal\s+(?:quality\s+control|qc)\b/i.test(String(t?.taskName || t?.name || "").trim()));
    if (!qc) return empty;
    const taskId = String(qc.taskId || qc.id || "").trim();
    if (!taskId) return empty;
    const detail = await gmRocketlaneGet("/tasks/" + encodeURIComponent(taskId));
    const descriptionHtml = String(detail?.taskDescription || detail?.description || "");
    return {
      found: true,
      taskId,
      taskName: String(qc.taskName || qc.name || ""),
      descriptionHtml,
      links: rlParseProjectLinksFromHtml(descriptionHtml),
    };
  }

  async function rlFetchIqcTaskLinks(rlProjectId) {
    return (await rlFetchIqcTask(rlProjectId)).links;
  }

  async function rlSaveIqcAttachLinks(rlProjectId, links) {
    const pid = String(rlProjectId || "").trim();
    if (!pid) throw new Error("Missing Rocketlane project id.");
    const fresh = await rlFetchIqcTask(pid);
    if (!fresh.found || !fresh.taskId) throw new Error('No "Internal Quality control and notes" task on this project.');
    const nextHtml = rlUpsertAttachLinksHtml(fresh.descriptionHtml, links);
    await gmRocketlaneRequest("PUT", "/tasks/" + encodeURIComponent(fresh.taskId), null, {
      taskDescription: nextHtml,
    });
    const verify = await rlFetchIqcTask(pid);
    if (!verify.found) throw new Error("IQC task vanished after save.");
    rlProjectLinksCache.delete(pid);
    rlProjectLinksInflight.delete(pid);
    return verify;
  }
  async function rlLoadProjectLinks(rlProjectId, opts) {
    const pid = String(rlProjectId || "").trim();
    if (!pid) return rlEmptyProjectLinks();
    const force = !!(opts && opts.force);
    if (force) {
      rlProjectLinksCache.delete(pid);
      // Drop a stale in-flight result so a manual Fetch always hits the API.
      rlProjectLinksInflight.delete(pid);
    } else {
      if (rlProjectLinksCache.has(pid)) return rlProjectLinksCache.get(pid);
      if (rlProjectLinksInflight.has(pid)) return rlProjectLinksInflight.get(pid);
    }
    const pr = (async () => {
      let iqc = rlEmptyProjectLinks();
      let deal = rlEmptyProjectLinks();
      let delivery = rlEmptyProjectLinks();
      try {
        const [iqcRes, projRes] = await Promise.allSettled([
          rlFetchIqcTaskLinks(pid),
          gmRocketlaneGet("/projects/" + encodeURIComponent(pid), { includeAllFields: true }),
        ]);
        if (iqcRes.status === "fulfilled") iqc = iqcRes.value;
        if (projRes.status === "fulfilled") {
          const project = projRes.value?.data ?? projRes.value;
          const fields = Array.isArray(project?.fields) ? project.fields : [];
          deal = rlParseProjectLinksFromHtml(
            rlReadField(fields, "hubspotdealdescription") || rlReadField(fields, "dealdescription")
          );
          delivery = rlParseProjectLinksFromHtml(
            rlReadField(fields, "hubspotdeliverystatusupdatemessage") ||
            rlReadField(fields, "deliverystatusupdatemessage") ||
            rlReadField(fields, "hubspotdeliverystatus")
          );
        }
      } catch (_) {}
      const merged = rlMergeLinksByPriority(iqc, deal, delivery);
      try {
        if (!merged.oneflowOrder && !merged.oneflowSubscription) {
          const of = await ofLinksFromRocketlaneProject(pid);
          if (of.order) merged.oneflowOrder = of.order;
          if (of.subscription) merged.oneflowSubscription = of.subscription;
        }
      } catch (_) {}
      rlProjectLinksCache.set(pid, merged);
      return merged;
    })();
    rlProjectLinksInflight.set(pid, pr);
    try { return await pr; }
    finally { rlProjectLinksInflight.delete(pid); }
  }

  function rlInjectActionBarStyles() {
    let style = document.getElementById("rlProjectActionBarStyles");
    if (!style) {
      style = document.createElement("style");
      style.id = "rlProjectActionBarStyles";
      document.documentElement.appendChild(style);
    }
    // Always refresh CSS so a Tampermonkey version bump picks up style tweaks
    // without requiring a full extension reload of a sticky <style> node.
    style.textContent = `
      #rlProjectActionBar {
        display: inline-flex; align-items: center; flex-wrap: nowrap; gap: 4px;
        margin-right: 8px; vertical-align: middle; flex: 0 0 auto;
        max-width: none; overflow: visible;
      }
      #rlProjectActionBar .rlPabBtn {
        display: inline-flex; align-items: center; gap: 5px;
        height: 24px; padding: 3px 9px; border-radius: 999px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        background: transparent; color: rgba(15, 23, 42, 0.78);
        font: 600 11.5px/1.2 inherit; letter-spacing: 0.01em;
        white-space: nowrap; text-decoration: none !important;
        cursor: pointer; user-select: none; flex: 0 0 auto;
        box-sizing: border-box;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
      }
      #rlProjectActionBar .rlPabBtn:hover {
        background: rgba(15, 23, 42, 0.05);
        border-color: rgba(15, 23, 42, 0.22);
        color: rgba(15, 23, 42, 0.92);
        transform: translateY(-1px);
      }
      #rlProjectActionBar .rlPabBtn:focus-visible {
        outline: 2px solid #0284c7; outline-offset: 2px;
      }
      #rlProjectActionBar .rlPabBtn[hidden] { display: none !important; }
      #rlProjectActionBar .rlPabIcon {
        width: 14px; height: 14px; display: block; object-fit: contain;
        border-radius: 3px; background: transparent; padding: 0; flex: 0 0 auto;
        box-sizing: border-box;
      }
      #rlProjectActionBar .rlPabIcon.rlPabIconBare {
        background: transparent; padding: 0; border-radius: 0;
      }
      #rlProjectActionBar .rlPabEmoji {
        font-size: 12px; line-height: 1; width: 14px; text-align: center;
        flex: 0 0 auto;
      }
      /* PPT Find-style control — sibling of Present inside Secondary flex row */
      #rlAutoFetchUrlsBtn {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        height: 32px; min-height: 32px; padding: 6px 14px 6px 12px; margin: 0 8px 0 0;
        border-radius: 8px; border: 1px solid rgba(15, 23, 42, 0.14);
        background: rgba(15, 23, 42, 0.05); color: rgba(15, 23, 42, 0.86);
        font: 500 12px/1.2 inherit; letter-spacing: 0.01em;
        white-space: nowrap; cursor: pointer; user-select: none;
        box-sizing: border-box; flex: 0 0 auto; align-self: center;
        vertical-align: middle;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
      }
      #rlAutoFetchUrlsBtn:hover {
        background: rgba(15, 23, 42, 0.09);
        border-color: rgba(15, 23, 42, 0.22);
        color: rgba(15, 23, 42, 0.96);
      }
      #rlAutoFetchUrlsBtn:focus-visible {
        outline: 2px solid #0284c7; outline-offset: 2px;
      }
      #rlAutoFetchUrlsBtn:disabled {
        opacity: 0.65; cursor: wait;
      }
      #rlAutoFetchUrlsBtn .rlFetchIcon {
        font-size: 14px; line-height: 1; flex: 0 0 auto;
        display: inline-flex; align-items: center; justify-content: center;
        width: 1.1em; margin: 0;
      }
      #rlAutoFetchUrlsBtn .rlFetchLabel {
        flex: 0 0 auto; line-height: 1.2; padding: 0;
      }

      dialog.rlUrlPickerDlg {
        border: none; border-radius: 12px; padding: 0; width: min(640px, 94vw);
        background: #111; color: rgba(255,255,255,0.92);
        box-shadow: 0 16px 40px rgba(0,0,0,0.35);
      }
      dialog.rlUrlPickerDlg::backdrop { background: rgba(0,0,0,0.45); }
      dialog.rlUrlPickerDlg .rlUpHead {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.08);
        font-weight: 600;
      }
      dialog.rlUrlPickerDlg .rlUpBody {
        padding: 12px 16px 16px; max-height: min(70vh, 640px); overflow: auto;
        font-size: 13px; line-height: 1.4; color: rgba(255,255,255,0.86);
      }
      dialog.rlUrlPickerDlg .rlUpMeta {
        margin: 0 0 12px; font-size: 12px; color: rgba(255,255,255,0.62);
      }
      dialog.rlUrlPickerDlg .rlUpRow {
        margin: 0 0 12px; padding: 10px 10px 8px;
        border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
        background: rgba(255,255,255,0.03);
      }
      dialog.rlUrlPickerDlg .rlUpLabel {
        display: block; margin: 0 0 6px; font-size: 12px; font-weight: 600;
        color: rgba(255,255,255,0.78);
      }
      dialog.rlUrlPickerDlg .rlUpFindRow {
        display: flex; gap: 8px; align-items: stretch;
      }
      dialog.rlUrlPickerDlg .rlUpFindRow input {
        flex: 1 1 auto; min-width: 0;
        height: 32px; padding: 0 10px; border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.16);
        background: rgba(0,0,0,0.35); color: inherit; font: inherit;
      }
      dialog.rlUrlPickerDlg .rlUpFindBtn,
      dialog.rlUrlPickerDlg .rlUpClose,
      dialog.rlUrlPickerDlg .rlUpCancel,
      dialog.rlUrlPickerDlg .rlUpSave {
        appearance: none; border: 1px solid rgba(255,255,255,0.16);
        background: rgba(255,255,255,0.06); color: inherit;
        border-radius: 8px; padding: 0 10px; cursor: pointer;
        font: 500 12px/1 inherit; white-space: nowrap; height: 32px;
      }
      dialog.rlUrlPickerDlg .rlUpSave {
        background: #0284c7; border-color: #0284c7; color: #fff; font-weight: 600;
      }
      dialog.rlUrlPickerDlg .rlUpSave:disabled,
      dialog.rlUrlPickerDlg .rlUpFindBtn:disabled { opacity: 0.55; cursor: wait; }
      dialog.rlUrlPickerDlg .rlUpStatus {
        margin: 6px 0 0; min-height: 1.2em; font-size: 11.5px;
        color: rgba(255,255,255,0.58);
      }
      dialog.rlUrlPickerDlg .rlUpStatus.good { color: #86efac; }
      dialog.rlUrlPickerDlg .rlUpStatus.warn { color: #fde68a; }
      dialog.rlUrlPickerDlg .rlUpStatus.error { color: #fca5a5; }
      dialog.rlUrlPickerDlg .rlUpPicker {
        margin-top: 8px;
        max-height: 240px;
        overflow-y: auto;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 8px;
        background: rgba(0,0,0,0.18);
        display: grid;
        gap: 4px;
        padding: 4px;
      }
      dialog.rlUrlPickerDlg .rlUpPickItem {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: start;
        text-align: left;
        width: 100%;
        appearance: none;
        border: 1px solid transparent;
        background: rgba(255,255,255,0.04);
        color: inherit;
        border-radius: 6px;
        padding: 8px 10px;
        cursor: pointer;
        font-size: 12px;
      }
      dialog.rlUrlPickerDlg .rlUpPickItem:hover {
        background: rgba(255,255,255,0.08);
        border-color: rgba(255,255,255,0.18);
      }
      dialog.rlUrlPickerDlg .rlUpPickName {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-weight: 600; font-size: 12.5px;
      }
      dialog.rlUrlPickerDlg .rlUpPickMeta {
        margin-top: 2px; font-size: 10.5px; color: rgba(255,255,255,0.55);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      dialog.rlUrlPickerDlg .rlUpPickSignals {
        margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 5px;
      }
      dialog.rlUrlPickerDlg .rlUpPickSignal {
        display: inline-flex; align-items: baseline; gap: 5px;
        font-size: 10.5px; line-height: 1.5; padding: 1px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.10);
        color: rgba(255,255,255,0.62);
        white-space: nowrap;
      }
      dialog.rlUrlPickerDlg .rlUpPickSignal .sigPts {
        font-weight: 700; font-variant-numeric: tabular-nums; color: #34d399;
      }
      dialog.rlUrlPickerDlg .rlUpPickSignal.neg {
        background: rgba(248,113,113,0.10);
        border-color: rgba(248,113,113,0.30);
      }
      dialog.rlUrlPickerDlg .rlUpPickSignal.neg .sigPts { color: #f87171; }
      dialog.rlUrlPickerDlg .rlUpPickScore {
        font-size: 11px; font-weight: 600; white-space: nowrap;
        padding: 3px 8px; border-radius: 999px;
        background: rgba(148,163,184,0.16);
        color: rgba(148,163,184,0.95);
        border: 1px solid transparent;
      }
      dialog.rlUrlPickerDlg .rlUpPickScore.highConfidence {
        background: rgba(52,211,153,0.16);
        color: rgba(52,211,153,0.95);
        border-color: rgba(52,211,153,0.32);
      }
      dialog.rlUrlPickerDlg .rlUpPickScore.medConfidence {
        background: rgba(251,191,36,0.16);
        color: rgba(251,191,36,0.95);
        border-color: rgba(251,191,36,0.32);
      }
      dialog.rlUrlPickerDlg .rlUpPickScore.lowConfidence {
        background: rgba(148,163,184,0.12);
        color: rgba(148,163,184,0.85);
        border-color: rgba(148,163,184,0.24);
      }
      dialog.rlUrlPickerDlg .rlUpFoot {
        display: flex; justify-content: flex-end; gap: 8px;
        padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.08);
      }
      /* ── Order info + Files popovers — same colour pattern as dlgYouniumStatus
         (dark #0f1424 default, light via prefers-color-scheme; .rlPopoverOnDark
         forces dark when the Rocketlane page itself is dark). */
      #rlOrderInfoPopover, #rlFilesPopover {
        --rlPop-surface-1: rgba(255,255,255,0.025);
        --rlPop-surface-2: rgba(255,255,255,0.045);
        --rlPop-surface-3: rgba(255,255,255,0.07);
        --rlPop-hairline: rgba(255,255,255,0.06);
        --rlPop-hairline-strong: rgba(255,255,255,0.10);
        --rlPop-text: rgba(255,255,255,0.94);
        --rlPop-muted: rgba(255,255,255,0.66);
        --rlPop-muted2: rgba(255,255,255,0.46);
        --rlPop-accent: #7dd3fc;
        --rlPop-accent-soft: rgba(125,211,252,0.14);
        --rlPop-accent-stroke: rgba(125,211,252,0.36);
        --rlPop-shadow: 0 12px 32px rgba(0,0,0,0.24);
        --rlOi-surface-1: #0f1424;
        --rlOi-surface-2: var(--rlPop-surface-2);
        --rlOi-hairline: var(--rlPop-hairline);
        --rlOi-text: var(--rlPop-text);
        --rlOi-muted: var(--rlPop-muted);
        --rlOi-accent: var(--rlPop-accent);
        --rlFiles-surface-1: #0f1424;
        --rlFiles-surface-2: var(--rlPop-surface-2);
        --rlFiles-surface-3: var(--rlPop-surface-3);
        --rlFiles-hairline: var(--rlPop-hairline);
        --rlFiles-hairline-strong: var(--rlPop-hairline-strong);
        --rlFiles-text: var(--rlPop-text);
        --rlFiles-muted: var(--rlPop-muted);
        --rlFiles-muted2: var(--rlPop-muted2);
        --rlFiles-accent: var(--rlPop-accent);
        --rlFiles-accent-soft: var(--rlPop-accent-soft);
      }
      @media (prefers-color-scheme: light) {
        #rlOrderInfoPopover:not(.rlPopoverOnDark),
        #rlFilesPopover:not(.rlPopoverOnDark) {
          --rlPop-surface-1: rgba(255,255,255,0.92);
          --rlPop-surface-2: rgba(255,255,255,1);
          --rlPop-surface-3: rgba(15,23,42,0.04);
          --rlPop-hairline: rgba(15,23,42,0.07);
          --rlPop-hairline-strong: rgba(15,23,42,0.12);
          --rlPop-text: rgba(15,23,42,0.94);
          --rlPop-muted: rgba(15,23,42,0.64);
          --rlPop-muted2: rgba(15,23,42,0.44);
          --rlPop-accent: #0284c7;
          --rlPop-accent-soft: rgba(2,132,199,0.10);
          --rlPop-accent-stroke: rgba(2,132,199,0.30);
          --rlPop-shadow: 0 12px 32px rgba(15,23,42,0.14);
          --rlOi-surface-1: #ffffff;
          --rlOi-surface-2: var(--rlPop-surface-3);
          --rlOi-hairline: var(--rlPop-hairline);
          --rlOi-text: var(--rlPop-text);
          --rlOi-muted: var(--rlPop-muted);
          --rlOi-accent: var(--rlPop-accent);
          --rlFiles-surface-1: #ffffff;
          --rlFiles-surface-2: var(--rlPop-surface-3);
          --rlFiles-surface-3: rgba(15,23,42,0.055);
          --rlFiles-hairline: var(--rlPop-hairline);
          --rlFiles-hairline-strong: var(--rlPop-hairline-strong);
          --rlFiles-text: var(--rlPop-text);
          --rlFiles-muted: var(--rlPop-muted);
          --rlFiles-muted2: var(--rlPop-muted2);
          --rlFiles-accent: var(--rlPop-accent);
          --rlFiles-accent-soft: var(--rlPop-accent-soft);
        }
      }
      #rlOrderInfoPopover {
        position: fixed; z-index: 10050;
        width: min(820px, calc(100vw - 32px));
        max-height: calc(100vh - 80px);
        background: var(--rlOi-surface-1);
        color: var(--rlOi-text);
        border: 1px solid var(--rlPop-hairline-strong);
        border-radius: 14px;
        box-shadow: var(--rlPop-shadow);
        overflow: hidden;
        display: flex; flex-direction: column;
        animation: rlOiIn 120ms ease-out;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      }
      #rlOrderInfoPopover.rlPopoverOnDark {
        --rlOi-surface-1: #0f1424;
        --rlOi-surface-2: rgba(255,255,255,0.045);
        --rlOi-hairline: rgba(255,255,255,0.06);
        --rlOi-text: rgba(255,255,255,0.94);
        --rlOi-muted: rgba(255,255,255,0.66);
        --rlOi-accent: #7dd3fc;
        --rlPop-hairline-strong: rgba(255,255,255,0.10);
        --rlPop-shadow: 0 12px 32px rgba(0,0,0,0.24);
      }
      @keyframes rlOiIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      #rlOrderInfoPopover .rlOiHead {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding: 16px 20px;
        border-bottom: 1px solid var(--rlOi-hairline);
        font-weight: 600; font-size: 14px; flex: 0 0 auto;
        color: var(--rlOi-text);
      }
      #rlOrderInfoPopover .rlOiClose {
        display: inline-flex; align-items: center; justify-content: center;
        appearance: none; border: 1px solid transparent;
        background: transparent; color: var(--rlOi-muted);
        width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
        font-size: 18px; line-height: 1;
        transition: background .15s, color .15s, border-color .15s;
      }
      #rlOrderInfoPopover .rlOiClose:hover {
        background: rgba(255,255,255,0.08); color: var(--rlOi-text);
        border-color: var(--rlOi-hairline);
      }
      @media (prefers-color-scheme: light) {
        #rlOrderInfoPopover:not(.rlPopoverOnDark) .rlOiClose:hover {
          background: rgba(15,23,42,0.06);
        }
      }
      #rlOrderInfoPopover .rlOiBody {
        padding: 16px 18px; overflow: auto; flex: 1 1 auto; min-height: 0;
        font-size: 13px; line-height: 1.55; color: var(--rlOi-text);
        max-height: min(70vh, 640px);
        display: grid; gap: 14px;
        background: transparent;
      }
      /* Same “light white inside” card as .youniumSection on dark #0f1424. */
      #rlOrderInfoPopover .rlOiSection {
        border: 1px solid var(--rlOi-hairline);
        border-radius: 10px;
        padding: 12px 14px;
        background: rgba(255,255,255,0.035);
        color: var(--rlOi-text);
      }
      @media (prefers-color-scheme: light) {
        #rlOrderInfoPopover:not(.rlPopoverOnDark) .rlOiSection {
          background: rgba(15,23,42,0.035);
        }
      }
      #rlOrderInfoPopover.rlPopoverOnDark .rlOiSection {
        background: rgba(255,255,255,0.035);
      }
      #rlOrderInfoPopover .rlOiBody a { color: var(--rlOi-accent); }
      #rlOrderInfoPopover .rlOiBody p { margin: 0 0 8px; }
      #rlOrderInfoPopover .rlOiBody p:last-child { margin-bottom: 0; }
      /* HubSpot/field HTML often ships light-gray inline colors — force readable ink. */
      #rlOrderInfoPopover .rlOiBody :where(p, li, span, div, td, th, strong, b, em, ul, ol, font) {
        color: inherit;
      }
      #rlOrderInfoPopover .rlOiSection :where(p, li, span, div, td, th, strong, b, em, ul, ol, font) {
        color: var(--rlOi-text);
      }
      #rlOrderInfoPopover .rlOiBody a { color: var(--rlOi-accent) !important; }
      #rlOrderInfoPopover .rlOiEmpty,
      #rlOrderInfoPopover .rlOiError { color: var(--rlOi-muted); padding: 8px 2px; }
      #rlOrderInfoPopover .rlOiError { color: #fb7185; }
      @media (prefers-color-scheme: light) {
        #rlOrderInfoPopover:not(.rlPopoverOnDark) .rlOiError { color: #e11d48; }
      }

      /* ── Files popover — shared Younium colour tokens above ── */
      #rlFilesPopover {
        position: fixed; z-index: 10050;
        width: min(960px, calc(100vw - 32px));
        background: var(--rlFiles-surface-1);
        color: var(--rlFiles-text);
        border: 1px solid var(--rlFiles-hairline-strong);
        border-radius: 14px;
        box-shadow: var(--rlPop-shadow);
        overflow: hidden;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      }
      #rlFilesPopover.rlPopoverOnDark {
        --rlFiles-surface-1: #0f1424;
        --rlFiles-surface-2: rgba(255,255,255,0.045);
        --rlFiles-surface-3: rgba(255,255,255,0.07);
        --rlFiles-hairline: rgba(255,255,255,0.06);
        --rlFiles-hairline-strong: rgba(255,255,255,0.10);
        --rlFiles-text: rgba(255,255,255,0.94);
        --rlFiles-muted: rgba(255,255,255,0.66);
        --rlFiles-muted2: rgba(255,255,255,0.46);
        --rlFiles-accent: #7dd3fc;
        --rlFiles-accent-soft: rgba(125,211,252,0.14);
        --rlPop-shadow: 0 12px 32px rgba(0,0,0,0.24);
      }
      #rlFilesPopover.rlFilesDropActive {
        outline: 2px dashed var(--rlFiles-accent);
        outline-offset: -6px;
        background: var(--rlFiles-accent-soft);
      }
      #rlFilesPopover .rlFilesHead {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; padding: 16px 20px;
        border-bottom: 1px solid var(--rlFiles-hairline);
        font-weight: 600; font-size: 14px;
      }
      #rlFilesPopover .rlFilesActions {
        display: flex; align-items: center; gap: 6px;
      }
      #rlFilesPopover .rlFilesBtn {
        font-size: 12px; padding: 7px 12px;
        background: var(--rlFiles-surface-2);
        border: 1px solid var(--rlFiles-hairline-strong);
        color: var(--rlFiles-text);
        border-radius: 10px; cursor: pointer; white-space: nowrap;
        font-weight: 500;
      }
      #rlFilesPopover .rlFilesBtn:hover:not(:disabled) {
        background: var(--rlFiles-surface-3);
        border-color: var(--rlFiles-hairline-strong);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
      }
      #rlFilesPopover .rlFilesBtn:disabled { opacity: 0.7; cursor: wait; }
      #rlFilesPopover .rlFilesClose {
        display: inline-flex; align-items: center; justify-content: center;
        appearance: none; border: 1px solid transparent;
        background: transparent; color: var(--rlFiles-muted);
        width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
        font-size: 18px; line-height: 1;
        transition: background .15s, color .15s, border-color .15s;
      }
      #rlFilesPopover .rlFilesClose:hover {
        background: rgba(255,255,255,0.08); color: var(--rlFiles-text);
        border-color: var(--rlFiles-hairline);
      }
      @media (prefers-color-scheme: light) {
        #rlFilesPopover:not(.rlPopoverOnDark) .rlFilesClose:hover {
          background: rgba(15,23,42,0.06);
        }
      }
      #rlFilesPopover .rlFilesBody {
        padding: 16px 18px; max-height: min(70vh, 640px); overflow: auto;
        font-size: 13px; color: var(--rlFiles-text);
        display: grid; gap: 14px;
      }
      #rlFilesPopover .rlFilesError { color: #fb7185; }
      @media (prefers-color-scheme: light) {
        #rlFilesPopover:not(.rlPopoverOnDark) .rlFilesError { color: #e11d48; }
      }
      #rlFilesPopover .rlFilesEmpty { color: var(--rlFiles-muted2); padding: 8px 2px; }
      /* Inner panel = same translucent white card as Younium .youniumSection. */
      #rlFilesPopover .rlFilesList {
        display: flex; flex-direction: column; max-height: 65vh; overflow-y: auto;
        border: 1px solid var(--rlFiles-hairline); border-radius: 10px;
        background: rgba(255,255,255,0.035);
        color: var(--rlFiles-text);
      }
      @media (prefers-color-scheme: light) {
        #rlFilesPopover:not(.rlPopoverOnDark) .rlFilesList {
          background: rgba(15,23,42,0.035);
        }
      }
      #rlFilesPopover.rlPopoverOnDark .rlFilesList {
        background: rgba(255,255,255,0.035);
      }
      #rlFilesPopover .rlFilesListHead,
      #rlFilesPopover .rlFilesListRow {
        display: grid;
        grid-template-columns: 44px minmax(0, 2.5fr) minmax(0, 1.4fr) 80px minmax(0, 1.4fr);
        gap: 12px; align-items: center; padding: 8px 12px; min-width: 0;
      }
      #rlFilesPopover .rlFilesListHead {
        font-size: 10.5px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.06em; color: var(--rlFiles-muted);
        background: var(--rlFiles-surface-3);
        border-bottom: 1px solid var(--rlFiles-hairline);
        position: sticky; top: 0; z-index: 1;
      }
      #rlFilesPopover .rlFilesSortBtn {
        appearance: none; background: transparent; border: none; padding: 0; margin: 0;
        font: inherit; color: inherit; text-align: left; cursor: pointer;
        display: inline-flex; align-items: center; gap: 4px; width: 100%;
        text-transform: inherit; letter-spacing: inherit; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; min-width: 0;
      }
      #rlFilesPopover .rlFilesSortBtn:hover { color: var(--rlFiles-text); }
      #rlFilesPopover .rlFilesSortBtn.active { color: var(--rlFiles-accent); }
      #rlFilesPopover .rlFilesSortArrow { font-size: 9px; opacity: 0.5; }
      #rlFilesPopover .rlFilesSortBtn.active .rlFilesSortArrow { opacity: 1; }
      #rlFilesPopover .rlFilesListHead > div:nth-child(4) .rlFilesSortBtn { justify-content: flex-end; }
      #rlFilesPopover .rlFilesListRow {
        border-bottom: 1px solid var(--rlFiles-hairline);
        text-decoration: none !important; color: var(--rlFiles-text) !important;
        transition: background 100ms ease;
      }
      #rlFilesPopover .rlFilesListRow:last-child { border-bottom: none; }
      #rlFilesPopover .rlFilesListRow:hover { background: var(--rlFiles-surface-3); }
      #rlFilesPopover .rlFilesListIcon {
        width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
        background: var(--rlFiles-surface-3); border-radius: 6px; overflow: hidden; flex-shrink: 0;
      }
      #rlFilesPopover .rlFilesListIcon img {
        width: 100%; height: 100%; object-fit: cover; cursor: zoom-in;
      }
      #rlFilesPopover .rlFilesListIcon .rlFilesSvg { width: 70%; height: 70%; }
      #rlFilesPopover .rlFilesListName {
        font-size: 13px; font-weight: 600; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; min-width: 0;
      }
      #rlFilesPopover .rlFilesListDate,
      #rlFilesPopover .rlFilesListSize,
      #rlFilesPopover .rlFilesListLoc {
        font-size: 12px; color: var(--rlFiles-muted); white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis; min-width: 0;
      }
      #rlFilesPopover .rlFilesListSize {
        font-variant-numeric: tabular-nums; text-align: right;
      }
      #rlFilesPopover .rlFilesListLoc { color: var(--rlFiles-muted2); }
      #rlFilesPopover .rlFilesLocBadge {
        display: inline-block; padding: 1px 6px; font-size: 10.5px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 0.04em;
        background: var(--rlFiles-surface-3); border: 1px solid var(--rlFiles-hairline);
        border-radius: 999px; margin-right: 6px; color: var(--rlFiles-muted);
      }
      .rlFilesLightbox {
        position: fixed; inset: 0; z-index: 10060;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.85); backdrop-filter: blur(4px); cursor: zoom-out;
      }
      .rlFilesLightbox img {
        max-width: 92vw; max-height: 92vh; border-radius: 10px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5); object-fit: contain;
      }
      .rlFilesLightbox iframe {
        width: 92vw; height: 92vh; border: none; border-radius: 10px;
        background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      }
      .rlFilesLightboxClose {
        position: absolute; top: 20px; right: 24px; appearance: none;
        background: rgba(255,255,255,0.1); color: #fff;
        border: 1px solid rgba(255,255,255,0.2);
        width: 36px; height: 36px; border-radius: 999px; font-size: 20px;
        cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      }
    `;
  }

  function rlIsResponsibleLabel(s) {
    return /^(Responsible|Responsibility|Ansvarlig|Ansvar)$/i.test(String(s || "").trim());
  }

  function rlIsEffectivelyHidden(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      try {
        const st = getComputedStyle(n);
        if (st.display === "none" || st.visibility === "hidden") return true;
      } catch (_) {}
      n = n.parentElement;
    }
    return false;
  }

  function rlFindResponsibilityMount() {
    // Plan/tasks filter row: ActionBar > Primary ("View:…") + Secondary
    // ("Responsible" is a bare text node inside Secondary — not its own element).
    // Insert as the first child of Secondary so pills sit immediately left of
    // "Responsible" (Secondary is margin-pushed to the right; inserting as a
    // sibling before Secondary would leave the pills next to "View:" instead).
    const actionBars = document.querySelectorAll(
      '[class*="action-bar__ActionBar"], [class*="FilterBarComponent"], [class*="filter-bar__FilterBar"]'
    );
    for (const ab of actionBars) {
      if (!ab || rlIsEffectivelyHidden(ab)) continue;
      const secondary = Array.from(ab.children).find((el) => {
        const cls = String(el.className || "");
        if (!/Secondary/i.test(cls)) return false;
        // No spaces between label and tags ("ResponsibleAAll…"), so avoid \b after the word.
        return /Responsible|Responsibility|Ansvar(?:lig)?/i.test(el.textContent || "");
      });
      if (secondary) return { parent: secondary, before: secondary.firstChild };
    }

    // Fallback: walk text nodes (Responsible is often not wrapped in a tag).
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (!rlIsResponsibleLabel(textNode.nodeValue)) continue;
      const el = textNode.parentElement;
      if (!el || !el.isConnected || el.closest("#rlProjectActionBar")) continue;
      if (rlIsEffectivelyHidden(el)) continue;
      const secondary = el.closest('[class*="Secondary"]');
      if (secondary) return { parent: secondary, before: secondary.firstChild };
      return { parent: el, before: textNode };
    }

    // Last resort: labelled controls (other locales / older Rocketlane builds).
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], span, div, label, a, p"));
    for (const el of candidates) {
      if (!el || !el.isConnected || el.closest("#rlProjectActionBar")) continue;
      const aria = (el.getAttribute("aria-label") || "").trim();
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!rlIsResponsibleLabel(text) && !rlIsResponsibleLabel(aria)) continue;
      if (text.length > 24 && !rlIsResponsibleLabel(aria)) continue;
      if (rlIsEffectivelyHidden(el)) continue;
      if (!el.parentElement) continue;
      return { parent: el.parentElement, before: el };
    }
    return null;
  }

  function rlMakeLinkBtn({ id, href, label, iconSrc, iconBare, emoji, title, asButton }) {
    const a = document.createElement(asButton ? "button" : "a");
    a.className = "rlPabBtn";
    a.id = id;
    if (asButton) {
      a.type = "button";
    } else {
      if (href && href !== "#") a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    if (title) a.title = title;
    if (iconSrc) {
      const img = document.createElement("img");
      img.className = "rlPabIcon" + (iconBare ? " rlPabIconBare" : "");
      img.src = iconSrc;
      img.alt = "";
      img.width = 14;
      img.height = 14;
      img.decoding = "async";
      img.addEventListener("error", () => { img.style.display = "none"; });
      a.appendChild(img);
    } else if (emoji) {
      const span = document.createElement("span");
      span.className = "rlPabEmoji";
      span.setAttribute("aria-hidden", "true");
      span.textContent = emoji;
      a.appendChild(span);
    }
    const lbl = document.createElement("span");
    lbl.textContent = label;
    a.appendChild(lbl);
    return a;
  }

  function rlSanitizeOrderHtml(html) {
    try {
      const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
      doc.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((n) => n.remove());
      doc.querySelectorAll("*").forEach((el) => {
        for (const attr of Array.from(el.attributes)) {
          const n = attr.name.toLowerCase();
          if (n.startsWith("on") || n === "srcdoc") el.removeAttribute(attr.name);
          if ((n === "href" || n === "src") && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
        }
        // Drop light-gray / low-contrast ink from HubSpot field HTML so text
        // inherits the popover's readable color.
        if (el.hasAttribute("color")) el.removeAttribute("color");
        if (el.hasAttribute("style")) {
          let s = el.getAttribute("style") || "";
          s = s
            .replace(/(?:^|;)\s*color\s*:[^;]*/gi, "")
            .replace(/(?:^|;)\s*opacity\s*:[^;]*/gi, "")
            .replace(/^;+|;+$/g, "")
            .trim();
          if (s) el.setAttribute("style", s);
          else el.removeAttribute("style");
        }
      });
      return doc.body.innerHTML;
    } catch (_) {
      return escHtml(html);
    }
  }

  let rlOrderInfoPopoverEl = null;
  let rlOrderInfoPopoverGen = 0;
  let rlOrderInfoPopoverProjectId = "";

  function rlOrderInfoClosePopover() {
    if (rlOrderInfoPopoverEl && rlOrderInfoPopoverEl.parentNode) {
      rlOrderInfoPopoverEl.parentNode.removeChild(rlOrderInfoPopoverEl);
    }
    rlOrderInfoPopoverEl = null;
    rlOrderInfoPopoverProjectId = "";
    document.removeEventListener("click", rlOrderInfoOutsideClick, true);
    document.removeEventListener("keydown", rlOrderInfoEscKey, true);
  }

  function rlOrderInfoOutsideClick(e) {
    if (!rlOrderInfoPopoverEl) return;
    const t = e.target;
    const btn = document.getElementById("rlPabOrderInfo");
    if (rlOrderInfoPopoverEl.contains(t) || (btn && btn.contains(t))) return;
    rlOrderInfoClosePopover();
  }

  function rlOrderInfoEscKey(e) {
    if (e.key !== "Escape") return;
    rlOrderInfoClosePopover();
  }

  function rlOrderInfoGuard(gen, projectId) {
    if (gen !== rlOrderInfoPopoverGen) return false;
    if (!rlOrderInfoPopoverEl) return false;
    if (rlOrderInfoPopoverProjectId !== projectId) return false;
    const ctx = getOneflowContext();
    if (!ctx.rlProjectId || ctx.rlProjectId !== projectId) return false;
    return true;
  }

  async function rlOrderInfoTogglePopover(anchorBtn) {
    if (rlOrderInfoPopoverEl) { rlOrderInfoClosePopover(); return; }
    const ctx = getOneflowContext();
    const rlPid = String(ctx.rlProjectId || anchorBtn?.closest?.("#rlProjectActionBar")?.dataset?.rlProjectId || "").trim();
    if (!rlPid || !anchorBtn) return;

    try { rlFilesClosePopover(); } catch (_) {}
    rlInjectActionBarStyles();
    const gen = ++rlOrderInfoPopoverGen;
    rlOrderInfoPopoverProjectId = rlPid;

    rlOrderInfoPopoverEl = document.createElement("div");
    rlOrderInfoPopoverEl.id = "rlOrderInfoPopover";
    rlOrderInfoPopoverEl.setAttribute("role", "dialog");
    rlOrderInfoPopoverEl.setAttribute("aria-label", "Order info");
    const head = document.createElement("div");
    head.className = "rlOiHead";
    const title = document.createElement("span");
    title.textContent = "\uD83D\uDCE6 Order info";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "rlOiClose";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "\u00D7";
    closeBtn.addEventListener("click", rlOrderInfoClosePopover);
    head.appendChild(title);
    head.appendChild(closeBtn);
    const body = document.createElement("div");
    body.className = "rlOiBody";
    body.innerHTML = '<div class="rlOiSection rlOiEmpty">Loading\u2026</div>';
    rlOrderInfoPopoverEl.appendChild(head);
    rlOrderInfoPopoverEl.appendChild(body);
    document.body.appendChild(rlOrderInfoPopoverEl);
    rlApplyPopoverSurface(rlOrderInfoPopoverEl);

    const rect = anchorBtn.getBoundingClientRect();
    const popW = Math.min(820, window.innerWidth - 32);
    const margin = 16;
    let rightPx = window.innerWidth - rect.right;
    rightPx = Math.min(Math.max(rightPx, margin), Math.max(margin, window.innerWidth - popW - margin));
    rlOrderInfoPopoverEl.style.top = (rect.bottom + 8) + "px";
    rlOrderInfoPopoverEl.style.right = rightPx + "px";
    rlOrderInfoPopoverEl.style.width = popW + "px";

    setTimeout(() => {
      if (!rlOrderInfoPopoverEl || gen !== rlOrderInfoPopoverGen) return;
      document.addEventListener("click", rlOrderInfoOutsideClick, true);
      document.addEventListener("keydown", rlOrderInfoEscKey, true);
    }, 0);

    try {
      const json = await gmRocketlaneGet("/projects/" + encodeURIComponent(rlPid), { includeAllFields: true });
      if (!rlOrderInfoGuard(gen, rlPid)) return;
      const project = json?.data ?? json;
      const fields = Array.isArray(project?.fields) ? project.fields : [];
      const match = fields.find((f) => {
        const n = String(f?.fieldName ?? "").toLowerCase().replace(/\s+/g, "");
        return n.startsWith("hubspotdeliverystatus") || n.startsWith("deliverystatus");
      });
      const html = match ? String(match.fieldValue ?? "") : "";
      body.textContent = "";
      if (!html.trim()) {
        const empty = document.createElement("div");
        empty.className = "rlOiSection rlOiEmpty";
        empty.textContent = "No HubSpot delivery / order status field found on this project.";
        body.appendChild(empty);
        return;
      }
      const section = document.createElement("div");
      section.className = "rlOiSection";
      section.innerHTML = rlSanitizeOrderHtml(html);
      body.appendChild(section);
    } catch (e) {
      if (!rlOrderInfoGuard(gen, rlPid)) return;
      body.textContent = "";
      const err = document.createElement("div");
      err.className = "rlOiSection rlOiError";
      err.textContent = "Couldn't load order info: " + (e?.message ?? e);
      body.appendChild(err);
    }
  }

  function rlBuildActionBarShell() {
    const bar = document.createElement("div");
    bar.id = "rlProjectActionBar";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Project links");
    const defs = [
      { id: "rlPabZendesk", key: "zendesk", label: "Zendesk", icon: rlFavicon("zendesk.com") },
      { id: "rlPabOneflowOrder", key: "oneflowOrder", label: "Oneflow (Order)", icon: rlFavicon("oneflow.com") },
      { id: "rlPabOneflowSub", key: "oneflowSubscription", label: "Oneflow (Subscription)", icon: rlFavicon("oneflow.com") },
      // Official Younium mark (same as nav chip) — bare, no white pad (matches PANG).
      { id: "rlPabYouniumOrder", key: "younium", label: "Younium (Order)", icon: YOUNIUM_LOGO_URL, iconBare: true },
      { id: "rlPabYouniumSub", key: "youniumSubscription", label: "Younium (Subscription)", icon: YOUNIUM_LOGO_URL, iconBare: true },
      { id: "rlPabHubspot", key: "hubspot", label: "HubSpot", icon: rlFavicon("hubspot.com") },
      { id: "rlPabFiles", key: "files", label: "Files", emoji: "\uD83D\uDCC1", always: "files" },
      { id: "rlPabOrderInfo", key: "orderInfo", label: "Order info", emoji: "\uD83D\uDCE6", always: "orderInfo" },
      { id: "rlPabPang", key: "pang", label: "PANG", icon: RL_PANG_ICON, iconBare: true, always: "pang" },
      { id: "rlPabBaf", key: "baf", label: "BAF", emoji: "\uD83D\uDC65", always: "baf" },
    ];
    for (const d of defs) {
      const btn = rlMakeLinkBtn({
        id: d.id,
        href: "",
        label: d.label,
        iconSrc: d.icon,
        iconBare: d.iconBare,
        emoji: d.emoji,
        title: d.label,
        asButton: d.always === "orderInfo" || d.always === "files",
      });
      btn.hidden = !d.always;
      btn.dataset.rlSlot = d.key;
      if (d.always === "orderInfo") {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void rlOrderInfoTogglePopover(btn);
        });
      }
      if (d.always === "files") {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          void rlFilesTogglePopover(btn);
        });
      }
      bar.appendChild(btn);
    }
    return bar;
  }

  function rlPatchActionBar(bar, links, ctx) {
    const setLink = (id, href, title) => {
      const el = bar.querySelector("#" + id);
      if (!el) return;
      const url = toHttpUrl(href);
      if (!url) {
        el.hidden = true;
        if (el.tagName === "A") el.removeAttribute("href");
        return;
      }
      el.hidden = false;
      if (el.tagName === "A") {
        el.href = url;
        el.target = "_blank";
        el.rel = "noopener noreferrer";
      }
      el.title = title || url;
    };

    setLink("rlPabZendesk", links.zendesk, links.zendesk);
    setLink("rlPabOneflowOrder", links.oneflowOrder, links.oneflowOrder);
    setLink("rlPabOneflowSub", links.oneflowSubscription, links.oneflowSubscription);
    setLink("rlPabYouniumOrder", links.younium, links.younium);
    setLink("rlPabYouniumSub", links.youniumSubscription, links.youniumSubscription);
    setLink("rlPabHubspot", links.hubspot, links.hubspot);

    const filesBtn = bar.querySelector("#rlPabFiles");
    if (filesBtn) {
      filesBtn.hidden = false;
      filesBtn.title = "Project files — list, preview, download, upload";
      if (filesBtn.tagName === "A") filesBtn.removeAttribute("href");
    }

    const orderBtn = bar.querySelector("#rlPabOrderInfo");
    if (orderBtn) {
      orderBtn.hidden = false;
      orderBtn.title = "Show HubSpot order / delivery status";
    }

    const plantId = ctx.plantId || "";
    const pang = bar.querySelector("#rlPabPang");
    const baf = bar.querySelector("#rlPabBaf");
    if (pang) {
      if (plantId) {
        pang.hidden = false;
        pang.href = "http://pang.iwmac.local/pang.qxs?plant_id=" + encodeURIComponent(plantId);
        pang.title = "Open plant " + plantId + " in Pang";
      } else {
        pang.hidden = true;
      }
    }
    if (baf) {
      if (plantId) {
        baf.hidden = false;
        baf.href = "http://internal.iwmac.local/baf.qxs?search=" + encodeURIComponent(plantId);
        baf.title = "Search plant " + plantId + " in BAF";
      } else {
        baf.hidden = true;
      }
    }
  }

  function rlCountFilledLinks(links) {
    if (!links) return 0;
    return ["zendesk", "oneflowOrder", "oneflowSubscription", "younium", "youniumSubscription", "hubspot"]
      .filter((k) => String(links[k] || "").trim()).length;
  }

  function rlFindPresentButton() {
    return document.querySelector('[data-cy="present_phase.enter"], [data-cy="present_phase.exit"]');
  }

  /** Present lives inside a 32px display:block wrapper — never mount siblings there. */
  function rlPresentSecondaryAnchor(presentBtn) {
    if (!presentBtn) return null;
    const secondary = presentBtn.closest('[class*="action-bar__Secondary"]');
    if (!secondary) return null;
    let anchor = presentBtn;
    while (anchor.parentElement && anchor.parentElement !== secondary) {
      anchor = anchor.parentElement;
    }
    if (anchor.parentElement !== secondary) return null;
    return { secondary, anchor };
  }

  let rlUrlPickerGen = 0;

  function rlUrlPickerCollectLinks(dlg) {
    const out = rlEmptyProjectLinks();
    if (!dlg) return out;
    for (const { key } of rlIqcAttachLinkSlots()) {
      const input = dlg.querySelector('input[data-rl-slot="' + key + '"]');
      out[key] = rlNormalizeHttpUrl(input?.value);
    }
    // Keep rocketlane project URL if we already know it; not an Attach-links row.
    return out;
  }

  function rlUrlPickerSetStatus(el, text, tone) {
    if (!el) return;
    el.textContent = text || "";
    el.className = "rlUpStatus" + (tone ? (" " + tone) : "");
  }

  function rlUrlPickerClearPicker(row) {
    row?.querySelector(".rlUpPicker")?.remove();
  }

  function rlUrlPickerCandidateUrl(entry) {
    return rlNormalizeHttpUrl(entry?.candidate?.url) ||
      rlNormalizeHttpUrl(entry?.url) ||
      "";
  }

  function rlUrlPickerApplyScored(row, input, statusEl, scored, gen, projectId) {
    rlUrlPickerClearPicker(row);
    if (!scored.length) {
      rlUrlPickerSetStatus(statusEl, "No candidates.", "warn");
      return;
    }
    const decision = decideMatchOutcome(scored);
    const existing = rlNormalizeHttpUrl(input.value);
    if (decision.kind === "auto") {
      const url = rlUrlPickerCandidateUrl(decision.entry);
      if (!url) {
        rlUrlPickerSetStatus(statusEl, "Best match has no URL.", "warn");
        return;
      }
      if (!existing) {
        input.value = url;
        rlUrlPickerSetStatus(
          statusEl,
          "Auto-filled (" + decision.entry.percent + "%): " + (decision.entry.candidate.primaryText || url),
          "good"
        );
        return;
      }
      if (existing === url) {
        rlUrlPickerSetStatus(statusEl, "Already matches best candidate (" + decision.entry.percent + "%).", "good");
        return;
      }
      // Never overwrite a nonempty input — fall through to picker.
    }
    if (decision.kind === "none") {
      rlUrlPickerSetStatus(statusEl, "No usable match signals.", "warn");
      return;
    }
    const host = document.createElement("div");
    host.className = "rlUpPicker";
    for (const entry of scored.slice(0, 8)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rlUpPickItem";
      const left = document.createElement("div");
      const name = document.createElement("div");
      name.className = "rlUpPickName";
      name.textContent = entry.candidate.primaryText || "(no name)";
      const meta = document.createElement("div");
      meta.className = "rlUpPickMeta";
      meta.textContent = entry.candidate.secondaryText || entry.candidate.url || "";
      left.appendChild(name);
      left.appendChild(meta);
      if (entry.signals && entry.signals.length) {
        const breakdown = document.createElement("div");
        breakdown.className = "rlUpPickSignals";
        for (const s of entry.signals) {
          const chip = document.createElement("span");
          chip.className = "rlUpPickSignal" + (s.points < 0 ? " neg" : "");
          const pts = document.createElement("span");
          pts.className = "sigPts";
          pts.textContent = (s.points < 0 ? "\u2212" : "+") + Math.abs(s.points);
          const lbl = document.createElement("span");
          lbl.textContent = s.label;
          chip.appendChild(pts);
          chip.appendChild(lbl);
          breakdown.appendChild(chip);
        }
        left.appendChild(breakdown);
      }
      const right = document.createElement("div");
      right.className = "rlUpPickScore";
      if (entry.percent >= 80) right.classList.add("highConfidence");
      else if (entry.percent >= 60) right.classList.add("medConfidence");
      else right.classList.add("lowConfidence");
      right.textContent = entry.percent + "% match";
      const tooltipLines = entry.signals && entry.signals.length
        ? entry.signals.map((s) => (s.points < 0 ? "\u2212" : "+") + Math.abs(s.points) + "  " + s.label)
        : ["(no matching signals)"];
      btn.title = tooltipLines.join("\n");
      btn.appendChild(left);
      btn.appendChild(right);
      btn.addEventListener("click", () => {
        if (gen !== rlUrlPickerGen) return;
        if (String(dlgProjectId(row)) !== String(projectId)) return;
        const url = rlUrlPickerCandidateUrl(entry);
        if (!url) return;
        input.value = url;
        rlUrlPickerClearPicker(row);
        rlUrlPickerSetStatus(statusEl, "Selected (" + entry.percent + "%).", "good");
      });
      host.appendChild(btn);
    }
    row.appendChild(host);
    const reason = decision.reason || "";
    rlUrlPickerSetStatus(
      statusEl,
      (existing ? "Existing value kept — " : "") +
        scored.length + " candidate(s) — pick one" +
        (reason ? " (" + reason + ")" : "") + ".",
      "warn"
    );
  }

  function rlUrlPickerShowCandidates(row, input, statusEl, candidates, gen, projectId) {
    const scored = (candidates || []).map((c) => ({
      candidate: c,
      score: c.percent ?? c.score ?? 0,
      percent: c.percent ?? Math.min(100, Math.max(0, Math.round(c.score || 0))),
      signals: c.signals || [],
      url: c.url,
    }));
    rlUrlPickerApplyScored(row, input, statusEl, scored, gen, projectId);
  }

  function dlgProjectId(fromEl) {
    const dlg = fromEl?.closest?.("dialog.rlUrlPickerDlg") || document.getElementById("rlUrlPickerDlg");
    return dlg?.dataset?.rlProjectId || "";
  }

  async function rlUrlPickerFindSlot(key, row, input, statusEl, projectId, plantId, gen) {
    rlUrlPickerClearPicker(row);
    rlUrlPickerSetStatus(statusEl, "Searching…", "");
    try {
      if (gen !== rlUrlPickerGen || dlgProjectId(row) !== String(projectId)) return;
      const matchCtx = await rlGetMatchContextCached(projectId, gen);
      if (gen !== rlUrlPickerGen || dlgProjectId(row) !== String(projectId)) return;
      const effectivePlantId = plantId || matchCtx.plantId || "";

      if (key === "oneflowOrder" || key === "oneflowSubscription") {
        if (!effectivePlantId) {
          rlUrlPickerSetStatus(statusEl, "Project name needs a plant ID prefix.", "warn");
          return;
        }
        const found = await ofSearchByPlantId(effectivePlantId);
        if (gen !== rlUrlPickerGen || dlgProjectId(row) !== String(projectId)) return;
        const want = key === "oneflowOrder" ? "order" : "subscription";
        const scored = (found.candidates || [])
          .filter((a) => a?.id)
          .map((a) => rlScoreWithKindBonus(rlOneflowToMatchCandidate(a), matchCtx, want))
          .sort((x, y) => y.percent - x.percent || y.score - x.score);
        rlUrlPickerApplyScored(row, input, statusEl, scored, gen, projectId);
        return;
      }
      if (key === "younium") {
        if (!effectivePlantId) {
          rlUrlPickerSetStatus(statusEl, "Project name needs a plant ID prefix.", "warn");
          return;
        }
        const all = await youniumFindAllOrdersByPlantId(effectivePlantId);
        if (gen !== rlUrlPickerGen || dlgProjectId(row) !== String(projectId)) return;
        const orders = (all || [])
          .filter((o) => String(o?.plant_id ?? "").trim() === String(effectivePlantId) && o?.id)
          .filter((o) => ofKindByName(o?.description || o?.orderNumber || "") !== "subscription");
        const hydrated = await Promise.all(orders.map(async (o) => {
          try {
            const full = await ynGetOrderById(o.id);
            return full?.id ? { ...full, ...o } : o;
          } catch (_) { return o; }
        }));
        if (gen !== rlUrlPickerGen || dlgProjectId(row) !== String(projectId)) return;
        const scored = hydrated
          .map((o) => {
            const candidate = rlYouniumToMatchCandidate(o);
            const { score, percent, signals } = scoreMatchCandidate(candidate, matchCtx, { preferLinkKind: "order" });
            return { candidate, score, percent, signals };
          })
          .sort((x, y) => y.percent - x.percent || y.score - x.score);
        rlUrlPickerApplyScored(row, input, statusEl, scored, gen, projectId);
        return;
      }
      if (key === "youniumSubscription") {
        if (!effectivePlantId) {
          rlUrlPickerSetStatus(statusEl, "Project name needs a plant ID prefix.", "warn");
          return;
        }
        const foundList = await youniumFindAllSubscriptionsByPlantId(effectivePlantId);
        if (gen !== rlUrlPickerGen || dlgProjectId(row) !== String(projectId)) return;
        if (!foundList.length) {
          rlUrlPickerSetStatus(statusEl, "No IWMAC subscription order for plant " + effectivePlantId + ".", "warn");
          return;
        }
        const scored = foundList
          .map(({ order, productName }) => {
            const candidate = rlYouniumToMatchCandidate(order, productName);
            const { score, percent, signals } = scoreMatchCandidate(candidate, matchCtx, { preferLinkKind: "subscription" });
            return { candidate, score, percent, signals };
          })
          .sort((x, y) => y.percent - x.percent || y.score - x.score);
        rlUrlPickerApplyScored(row, input, statusEl, scored, gen, projectId);
        return;
      }
      if (key === "hubspot") {
        // Fields-only: score URLs recovered from IQC / Deal / Delivery. No HubSpot API.
        const merged = await rlLoadProjectLinks(projectId, { force: true });
        if (gen !== rlUrlPickerGen || dlgProjectId(row) !== String(projectId)) return;
        const urls = [];
        const seen = new Set();
        const pushUrl = (u) => {
          const n = rlNormalizeHttpUrl(u);
          if (!n || seen.has(n)) return;
          const cls = rlClassifyLinkUrl(n);
          if (!cls || cls.platform !== "hubspot") return;
          seen.add(n);
          urls.push(n);
        };
        pushUrl(merged.hubspot);
        for (const l of matchCtx.embeddedLinks || []) {
          if (l?.platform === "hubspot" && l.url) pushUrl(l.url);
        }
        if (!urls.length) {
          rlUrlPickerSetStatus(statusEl, "No HubSpot URL in Deal Description / Delivery / IQC. Paste manually.", "warn");
          return;
        }
        const scored = urls
          .map((u) => {
            const candidate = rlHubspotUrlToMatchCandidate(u);
            const { score, percent, signals } = scoreMatchCandidate(candidate, matchCtx);
            return { candidate, score, percent, signals };
          })
          .sort((x, y) => y.percent - x.percent || y.score - x.score);
        rlUrlPickerApplyScored(row, input, statusEl, scored, gen, projectId);
        return;
      }
      rlUrlPickerSetStatus(statusEl, "No Find action for this slot.", "warn");
    } catch (e) {
      if (gen !== rlUrlPickerGen) return;
      rlUrlPickerSetStatus(statusEl, "Find failed: " + (e?.message ?? e), "error");
    }
  }

  function rlEnsureUrlPickerDialog() {
    let dlg = document.getElementById("rlUrlPickerDlg");
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.id = "rlUrlPickerDlg";
    dlg.className = "rlUrlPickerDlg";
    dlg.innerHTML =
      '<form method="dialog" class="rlUpForm">' +
        '<div class="rlUpHead"><span>Fetch / choose project URLs</span>' +
          '<button type="button" class="rlUpClose" value="cancel" aria-label="Close">Close</button></div>' +
        '<div class="rlUpBody">' +
          '<p class="rlUpMeta" data-rl-up-meta></p>' +
          '<div data-rl-up-rows></div>' +
        '</div>' +
        '<div class="rlUpFoot">' +
          '<button type="button" class="rlUpCancel">Cancel</button>' +
          '<button type="button" class="rlUpSave">Save URLs</button>' +
        '</div>' +
      '</form>';
    const rowsHost = dlg.querySelector("[data-rl-up-rows]");
    for (const slot of rlIqcAttachLinkSlots()) {
      const row = document.createElement("div");
      row.className = "rlUpRow";
      row.dataset.rlSlot = slot.key;
      const lab = document.createElement("label");
      lab.className = "rlUpLabel";
      lab.textContent = slot.label;
      const findRow = document.createElement("div");
      findRow.className = "rlUpFindRow";
      const input = document.createElement("input");
      input.type = "url";
      input.inputMode = "url";
      input.placeholder = "https://…";
      input.dataset.rlSlot = slot.key;
      findRow.appendChild(input);
      if (slot.find) {
        const findBtn = document.createElement("button");
        findBtn.type = "button";
        findBtn.className = "rlUpFindBtn";
        findBtn.textContent = "\uD83D\uDD0E Find";
        findBtn.dataset.rlFind = slot.key;
        findRow.appendChild(findBtn);
      }
      const status = document.createElement("div");
      status.className = "rlUpStatus";
      status.dataset.rlStatus = slot.key;
      row.appendChild(lab);
      row.appendChild(findRow);
      row.appendChild(status);
      rowsHost.appendChild(row);
    }
    const close = () => {
      try { dlg.close(); } catch (_) {}
    };
    dlg.querySelector(".rlUpClose").addEventListener("click", close);
    dlg.querySelector(".rlUpCancel").addEventListener("click", close);
    dlg.addEventListener("click", (ev) => {
      const findBtn = ev.target.closest?.("[data-rl-find]");
      if (!findBtn || !dlg.contains(findBtn)) return;
      ev.preventDefault();
      const key = findBtn.getAttribute("data-rl-find");
      const row = dlg.querySelector('.rlUpRow[data-rl-slot="' + key + '"]');
      const input = row?.querySelector("input");
      const statusEl = row?.querySelector("[data-rl-status]");
      const projectId = dlg.dataset.rlProjectId || "";
      const plantId = dlg.dataset.rlPlantId || "";
      const gen = Number(dlg.dataset.rlGen || "0");
      if (!row || !input) return;
      findBtn.disabled = true;
      void rlUrlPickerFindSlot(key, row, input, statusEl, projectId, plantId, gen)
        .finally(() => { findBtn.disabled = false; });
    });
    dlg.querySelector(".rlUpSave").addEventListener("click", () => {
      void rlUrlPickerSave(dlg);
    });
    document.documentElement.appendChild(dlg);
    return dlg;
  }

  async function rlUrlPickerSave(dlg) {
    const saveBtn = dlg.querySelector(".rlUpSave");
    const meta = dlg.querySelector("[data-rl-up-meta]");
    const projectId = dlg.dataset.rlProjectId || "";
    const gen = Number(dlg.dataset.rlGen || "0");
    if (!projectId) return;
    const links = rlUrlPickerCollectLinks(dlg);
    if (saveBtn) saveBtn.disabled = true;
    if (meta) meta.textContent = "Saving into Internal Quality control and notes…";
    try {
      const verify = await rlSaveIqcAttachLinks(projectId, links);
      if (gen !== rlUrlPickerGen || dlg.dataset.rlProjectId !== projectId) return;
      const refreshed = await rlLoadProjectLinks(projectId, { force: true });
      const bar = document.getElementById("rlProjectActionBar");
      const ctx = getOneflowContext();
      if (bar && ctx.rlProjectId === projectId) {
        bar.dataset.rlProjectId = projectId;
        rlPatchActionBar(bar, refreshed, ctx);
      }
      if (meta) {
        meta.textContent = "Saved on “" + (verify.taskName || "IQC") + "” · task " + verify.taskId + ".";
      }
      try { dlg.close(); } catch (_) {}
    } catch (e) {
      if (meta) meta.textContent = "Save failed: " + (e?.message ?? e);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function rlOpenUrlPickerDialog() {
    const btn = document.getElementById("rlAutoFetchUrlsBtn");
    const ctx = getOneflowContext();
    if (!ctx.rlProjectId) {
      if (btn) btn.title = "No Rocketlane project id in this URL.";
      return;
    }
    rlInjectActionBarStyles();
    const dlg = rlEnsureUrlPickerDialog();
    const gen = ++rlUrlPickerGen;
    dlg.dataset.rlGen = String(gen);
    dlg.dataset.rlProjectId = ctx.rlProjectId;
    dlg.dataset.rlPlantId = extractPlantIdFromProjectName(readProjectName()) || "";
    for (const k of [...rlMatchCtxCache.keys()]) {
      if (!k.endsWith(":" + gen)) rlMatchCtxCache.delete(k);
    }
    void rlGetMatchContextCached(ctx.rlProjectId, gen);
    const meta = dlg.querySelector("[data-rl-up-meta]");
    if (meta) meta.textContent = "Loading links from IQC / Deal Description / Delivery…";
    for (const row of dlg.querySelectorAll(".rlUpRow")) {
      const input = row.querySelector("input");
      const statusEl = row.querySelector("[data-rl-status]");
      if (input) input.value = "";
      rlUrlPickerClearPicker(row);
      rlUrlPickerSetStatus(statusEl, "", "");
    }
    if (btn) {
      btn.disabled = true;
      btn.dataset.rlBusy = "1";
      const label = btn.querySelector(".rlFetchLabel");
      if (label) label.textContent = "Fetching…";
    }
    try {
      if (!dlg.open) dlg.showModal();
      const [merged, iqc] = await Promise.all([
        rlLoadProjectLinks(ctx.rlProjectId, { force: true }),
        rlFetchIqcTask(ctx.rlProjectId).catch(() => ({ found: false, taskId: "", taskName: "", links: rlEmptyProjectLinks() })),
      ]);
      if (gen !== rlUrlPickerGen || dlg.dataset.rlProjectId !== ctx.rlProjectId) return;
      const bar = document.getElementById("rlProjectActionBar");
      if (bar) {
        bar.dataset.rlProjectId = ctx.rlProjectId;
        rlPatchActionBar(bar, merged, ctx);
      } else {
        try { rlEnsureProjectActionBar(); } catch (_) {}
      }
      for (const { key } of rlIqcAttachLinkSlots()) {
        const input = dlg.querySelector('input[data-rl-slot="' + key + '"]');
        if (!input) continue;
        // Prefer currently saved IQC value; fill empty slots from discovery.
        const saved = rlNormalizeHttpUrl(iqc.links?.[key]);
        const discovered = rlNormalizeHttpUrl(merged[key]);
        input.value = saved || discovered || "";
      }
      const n = rlCountFilledLinks(merged);
      if (meta) {
        meta.textContent = (iqc.found
          ? ("IQC task “" + (iqc.taskName || "Internal QC") + "” · id " + iqc.taskId + ". ")
          : "No IQC task found yet — Save will fail until it exists. ") +
          "Prefill: " + n + " discovered link(s). Find never overwrites a filled slot unless you pick.";
      }
      if (btn) {
        btn.title = n
          ? ("Chooser open — " + n + " link(s) discovered. Save writes Attach links on the IQC task.")
          : "Chooser open — no links discovered yet. Use Find or paste, then Save.";
      }
    } catch (e) {
      if (meta) meta.textContent = "Load failed: " + (e?.message ?? e);
      if (btn) btn.title = "Fetch failed: " + (e?.message ?? e);
    } finally {
      if (btn) {
        btn.disabled = false;
        delete btn.dataset.rlBusy;
        const label = btn.querySelector(".rlFetchLabel");
        if (label) label.textContent = "Fetch URLs";
      }
    }
  }

  async function rlRunAutoFetchUrls() {
    await rlOpenUrlPickerDialog();
  }


  // ── Files popover (PPT port) ──
  let rlFilesPopoverEl = null;
  let rlFilesPopoverGen = 0;
  let rlFilesPopoverProjectId = "";
  /** Pre-warmed Download-all startIn (handle or "downloads"). Never await IDB before pick. */
  let rlFilesDlStartIn = "downloads";

  const RL_FILES_DL_IDB = "rl-files-fs-handles";
  const RL_FILES_DL_STORE = "handles";
  const RL_FILES_DL_KEY = "downloads-parent-dir";

  function rlFilesIdbOpen() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(RL_FILES_DL_IDB, 1); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RL_FILES_DL_STORE)) db.createObjectStore(RL_FILES_DL_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function rlFilesIdbGetDir() {
    try {
      const db = await rlFilesIdbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(RL_FILES_DL_STORE, "readonly");
        const r = tx.objectStore(RL_FILES_DL_STORE).get(RL_FILES_DL_KEY);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
    } catch (_) { return null; }
  }

  async function rlFilesIdbSaveDir(handle) {
    try {
      const db = await rlFilesIdbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(RL_FILES_DL_STORE, "readwrite");
        const r = tx.objectStore(RL_FILES_DL_STORE).put(handle, RL_FILES_DL_KEY);
        r.onsuccess = () => resolve();
        r.onerror = () => reject(r.error);
      });
    } catch (_) {}
  }

  /** Prompt every Download-all; cache handle only as next picker's startIn.
   *  Do NOT await IndexedDB before showDirectoryPicker — Chrome drops user activation. */
  async function rlFilesGetOrPickDownloadParentDir() {
    if (typeof window.showDirectoryPicker !== "function") return null;
    const startIn = rlFilesDlStartIn || "downloads";
    const pick = (start) => window.showDirectoryPicker({ mode: "readwrite", startIn: start, id: "rl-files-downloads" });
    try {
      const picked = await pick(startIn);
      rlFilesDlStartIn = picked;
      void rlFilesIdbSaveDir(picked);
      return picked;
    } catch (e) {
      if (e?.name === "AbortError") return null;
      if (startIn !== "downloads") {
        try {
          const picked = await pick("downloads");
          rlFilesDlStartIn = picked;
          void rlFilesIdbSaveDir(picked);
          return picked;
        } catch (e2) {
          if (e2?.name === "AbortError") return null;
          throw e2;
        }
      }
      throw e;
    }
  }

  function rlFilesBuildTypeIcon(mimeType, fileName) {
    const m = String(mimeType || "").toLowerCase();
    const ext = (String(fileName || "").match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
    let color = "#64748b";
    let label = (ext || "FILE").toUpperCase().slice(0, 4);
    if (m === "application/pdf" || ext === "pdf") { color = "#dc2626"; label = "PDF"; }
    else if (/^(docx?|odt|rtf|pages)$/.test(ext) || /word|officedocument\.word/.test(m)) { color = "#2563eb"; label = ext.toUpperCase(); }
    else if (/^(xlsx?|csv|ods|numbers)$/.test(ext) || /excel|sheet|csv/.test(m)) { color = "#16a34a"; label = ext.toUpperCase(); }
    else if (/^(pptx?|odp|key)$/.test(ext) || /powerpoint|presentation/.test(m)) { color = "#ea580c"; label = ext.toUpperCase(); }
    else if (ext === "ai") { color = "#f59e0b"; label = "AI"; }
    else if (ext === "psd") { color = "#0ea5e9"; label = "PSD"; }
    else if (/^(zip|rar|7z|tar|gz|tgz)$/.test(ext) || /zip|compressed|archive|x-tar|gzip/.test(m)) { color = "#a16207"; label = ext.toUpperCase(); }
    else if (/^(mp3|wav|ogg|m4a|flac|aac)$/.test(ext) || m.startsWith("audio/")) { color = "#0891b2"; label = ext.toUpperCase() || "AUDIO"; }
    else if (/^(mp4|mov|avi|mkv|webm|wmv)$/.test(ext) || m.startsWith("video/")) { color = "#7c3aed"; label = ext.toUpperCase() || "VIDEO"; }
    else if (/^(js|ts|jsx|tsx|json|xml|html|css|sql|py|rb|go|rs|java|c|cpp|cs|sh)$/.test(ext)) { color = "#0d9488"; label = ext.toUpperCase(); }
    else if (/^(txt|md|log)$/.test(ext) || m === "text/plain" || m === "text/markdown") { color = "#475569"; label = ext.toUpperCase(); }
    else if (m.startsWith("image/") || /^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext)) { color = "#0ea5e9"; label = ext.toUpperCase(); }
    const fontSize = label.length <= 3 ? 22 : label.length === 4 ? 18 : 14;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 80 96");
    svg.setAttribute("class", "rlFilesSvg");
    svg.setAttribute("aria-hidden", "true");
    const doc = document.createElementNS(NS, "path");
    doc.setAttribute("d", "M8 4 H56 L72 20 V88 a4 4 0 0 1 -4 4 H12 a4 4 0 0 1 -4 -4 V8 a4 4 0 0 1 4 -4 z");
    doc.setAttribute("fill", "#ffffff");
    doc.setAttribute("stroke", "#cbd5e1");
    doc.setAttribute("stroke-width", "1.5");
    svg.appendChild(doc);
    const fold = document.createElementNS(NS, "path");
    fold.setAttribute("d", "M56 4 V20 H72 z");
    fold.setAttribute("fill", "#e2e8f0");
    svg.appendChild(fold);
    const ribbon = document.createElementNS(NS, "rect");
    ribbon.setAttribute("x", "4"); ribbon.setAttribute("y", "54");
    ribbon.setAttribute("width", "60"); ribbon.setAttribute("height", "22");
    ribbon.setAttribute("rx", "3"); ribbon.setAttribute("fill", color);
    svg.appendChild(ribbon);
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", "34"); text.setAttribute("y", "65");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("fill", "#ffffff");
    text.setAttribute("font-family", "ui-sans-serif, system-ui, sans-serif");
    text.setAttribute("font-weight", "800");
    text.setAttribute("font-size", String(fontSize));
    text.setAttribute("letter-spacing", "0.5");
    text.textContent = label;
    svg.appendChild(text);
    return svg;
  }

  function rlFilesClosePopover() {
    if (rlFilesPopoverEl && rlFilesPopoverEl.parentNode) {
      rlFilesPopoverEl.parentNode.removeChild(rlFilesPopoverEl);
    }
    rlFilesPopoverEl = null;
    rlFilesPopoverProjectId = "";
    document.removeEventListener("click", rlFilesOutsideClick, true);
    document.removeEventListener("keydown", rlFilesEscKey, true);
  }

  function rlFilesOutsideClick(e) {
    if (!rlFilesPopoverEl) return;
    const t = e.target;
    const btn = document.getElementById("rlPabFiles");
    if (rlFilesPopoverEl.contains(t) || (btn && btn.contains(t))) return;
    const lb = document.querySelector(".rlFilesLightbox");
    if (lb && lb.contains(t)) return;
    rlFilesClosePopover();
  }

  function rlFilesEscKey(e) {
    if (e.key !== "Escape") return;
    if (document.querySelector(".rlFilesLightbox")) return;
    rlFilesClosePopover();
  }

  function rlFilesOpenMediaLightbox(fullSrc, kind) {
    if (!fullSrc || !rlFilesIsTrustedAttachmentUrl(fullSrc)) return;
    const overlay = document.createElement("div");
    overlay.className = "rlFilesLightbox";
    const inner = kind === "pdf" ? document.createElement("iframe") : document.createElement("img");
    inner.src = fullSrc;
    if (kind === "pdf") {
      inner.setAttribute("title", "PDF preview");
      inner.setAttribute("loading", "eager");
    }
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "rlFilesLightboxClose";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "\u00D7";
    overlay.appendChild(inner);
    overlay.appendChild(closeBtn);
    const dismiss = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); dismiss(); } };
    overlay.addEventListener("click", (ev) => {
      if (ev.target === inner) return;
      dismiss();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  }

  function rlFilesGuardOrClose(gen, projectId) {
    if (gen !== rlFilesPopoverGen) return false;
    if (!rlFilesPopoverEl) return false;
    if (rlFilesPopoverProjectId !== projectId) return false;
    const ctx = getOneflowContext();
    if (!ctx.rlProjectId || ctx.rlProjectId !== projectId) return false;
    return true;
  }

  async function rlFilesTogglePopover(anchorBtn) {
    if (rlFilesPopoverEl) { rlFilesClosePopover(); return; }
    try { rlOrderInfoClosePopover(); } catch (_) {}
    const ctx = getOneflowContext();
    const rlPid = String(ctx.rlProjectId || "").trim();
    if (!rlPid || !anchorBtn) return;

    rlInjectActionBarStyles();
    const gen = ++rlFilesPopoverGen;
    rlFilesPopoverProjectId = rlPid;

    rlFilesPopoverEl = document.createElement("div");
    rlFilesPopoverEl.id = "rlFilesPopover";
    rlFilesPopoverEl.setAttribute("role", "dialog");
    rlFilesPopoverEl.setAttribute("aria-label", "Project files");
    const head = document.createElement("div");
    head.className = "rlFilesHead";
    const title = document.createElement("span");
    title.textContent = "\uD83D\uDCC1 Project files";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "rlFilesClose";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "\u00D7";
    closeBtn.addEventListener("click", rlFilesClosePopover);
    head.appendChild(title);
    const body = document.createElement("div");
    body.className = "rlFilesBody";
    body.textContent = "Loading\u2026";
    rlFilesPopoverEl.appendChild(head);
    rlFilesPopoverEl.appendChild(body);
    document.body.appendChild(rlFilesPopoverEl);
    rlApplyPopoverSurface(rlFilesPopoverEl);

    const rect = anchorBtn.getBoundingClientRect();
    // position:fixed — use viewport coords (no scrollY). Set both axes now so the
    // popover never flashes at left:0 while waiting on rAF.
    const popW = Math.min(960, window.innerWidth - 32);
    const margin = 16;
    let rightPx = window.innerWidth - rect.right;
    const minRight = margin;
    const maxRight = Math.max(margin, window.innerWidth - popW - margin);
    rightPx = Math.min(Math.max(rightPx, minRight), maxRight);
    rlFilesPopoverEl.style.top = (rect.bottom + 8) + "px";
    rlFilesPopoverEl.style.right = rightPx + "px";
    rlFilesPopoverEl.style.width = popW + "px";

    // Defer outside-click so the opening click cannot immediately dismiss.
    setTimeout(() => {
      if (!rlFilesPopoverEl || gen !== rlFilesPopoverGen) return;
      document.addEventListener("click", rlFilesOutsideClick, true);
      document.addEventListener("keydown", rlFilesEscKey, true);
    }, 0);

    // Pre-warm Download-all startIn off the click path (safe to await here).
    void rlFilesIdbGetDir().then((h) => { if (h) rlFilesDlStartIn = h; }).catch(() => {});

    const getFreshUrls = async (attachmentId) => {
      if (!attachmentId) return { full: "", thumb: "" };
      try {
        const a = await gmRocketlaneFetchAttachment(attachmentId);
        return {
          full: String(a?.downloadUrl ?? a?.location ?? "").trim(),
          thumb: String(a?.thumbLocation ?? "").trim(),
        };
      } catch (_) {}
      try {
        const [taskAtts, folderPack] = await Promise.all([
          gmRocketlaneFetchProjectAttachments(rlPid),
          gmRocketlaneFetchProjectFolders(rlPid).catch(() => ({ folders: [], attachments: [] })),
        ]);
        const fresh = rlFilesMergeAttachments(taskAtts, folderPack.attachments);
        const a = fresh.find((x) => x.attachmentId === attachmentId);
        return {
          full: String(a?.downloadUrl ?? a?.location ?? "").trim(),
          thumb: String(a?.thumbLocation ?? "").trim(),
        };
      } catch (_) {
        return { full: "", thumb: "" };
      }
    };

    let attsRef = [];

    try {
      const [taskAtts, folderPack] = await Promise.all([
        gmRocketlaneFetchProjectAttachments(rlPid),
        gmRocketlaneFetchProjectFolders(rlPid).catch((e) => {
          console.warn("[rlFiles] folder fetch failed:", e);
          return { folders: [], attachments: [] };
        }),
      ]);
      if (!rlFilesGuardOrClose(gen, rlPid)) return;
      const atts = rlFilesMergeAttachments(taskAtts, folderPack.attachments);
      attsRef = atts;
      body.textContent = "";

      const uploadBtn = document.createElement("button");
      uploadBtn.type = "button";
      uploadBtn.className = "rlFilesBtn";
      const uploadBtnIdleText = "\u2B06 Upload";
      uploadBtn.textContent = uploadBtnIdleText;
      uploadBtn.title = "Upload files to this project's General Shared Files — or drag & drop them on this popover";
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.multiple = true;
      fileInput.style.display = "none";
      rlFilesPopoverEl.appendChild(fileInput);

      let uploading = false;
      const uploadFiles = async (fileList) => {
        const list = Array.from(fileList || []).filter((f) => f && typeof f.name === "string");
        if (!list.length || uploading) return;
        uploading = true;
        uploadBtn.disabled = true;
        let sharedFolderId = null;
        try {
          const pack = await gmRocketlaneFetchProjectFolders(rlPid);
          const picked = rlFilesPickGeneralSharedFolder(pack.folders);
          sharedFolderId = picked ? picked.folderId : null;
        } catch (e) {
          console.warn("[rlFiles] couldn't resolve General Shared Files folder:", e);
        }
        if (sharedFolderId == null) {
          alert("Couldn't find this project's General Shared Files folder. Upload blocked — refusing to create an orphan attachment.");
          uploading = false;
          uploadBtn.disabled = false;
          uploadBtn.textContent = uploadBtnIdleText;
          return;
        }
        let done = 0, failed = 0;
        for (const f of list) {
          done++;
          uploadBtn.textContent = "Uploading " + done + "/" + list.length + "\u2026";
          try {
            await gmRocketlaneUploadAttachment(rlPid, f, { folderId: sharedFolderId, publicVisibility: false });
          } catch (e) {
            failed++;
            console.warn("[rlFiles] upload failed for " + (f && f.name) + ":", e);
          }
        }
        uploadBtn.textContent = failed ? "Done — " + failed + " failed" : "Uploaded \u2713";
        uploading = false;
        setTimeout(() => {
          if (!rlFilesPopoverEl || !rlFilesGuardOrClose(gen, rlPid)) return;
          rlFilesClosePopover();
          const btn = document.getElementById("rlPabFiles");
          if (btn) void rlFilesTogglePopover(btn);
        }, failed ? 1800 : 700);
      };
      uploadBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        fileInput.click();
      });
      fileInput.addEventListener("change", () => {
        const fs = Array.from(fileInput.files || []);
        fileInput.value = "";
        void uploadFiles(fs);
      });

      let dragDepth = 0;
      const hasFilesDrag = (e) => {
        const types = e && e.dataTransfer && e.dataTransfer.types;
        return !!types && Array.from(types).includes("Files");
      };
      rlFilesPopoverEl.addEventListener("dragenter", (e) => {
        if (!hasFilesDrag(e)) return;
        e.preventDefault();
        dragDepth++;
        rlFilesPopoverEl.classList.add("rlFilesDropActive");
      });
      rlFilesPopoverEl.addEventListener("dragover", (e) => {
        if (!hasFilesDrag(e)) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = "copy"; } catch (_) {}
      });
      rlFilesPopoverEl.addEventListener("dragleave", () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) rlFilesPopoverEl.classList.remove("rlFilesDropActive");
      });
      rlFilesPopoverEl.addEventListener("drop", (e) => {
        if (!hasFilesDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        dragDepth = 0;
        rlFilesPopoverEl.classList.remove("rlFilesDropActive");
        void uploadFiles(e.dataTransfer.files);
      });

      const filesActions = document.createElement("div");
      filesActions.className = "rlFilesActions";
      filesActions.appendChild(uploadBtn);
      filesActions.appendChild(closeBtn);
      head.appendChild(filesActions);

      if (!atts.length) {
        const empty = document.createElement("div");
        empty.className = "rlFilesEmpty";
        empty.textContent = "No files uploaded to this project yet. Drag & drop files here (or click \u2B06 Upload) to add them to General Shared Files.";
        body.appendChild(empty);
        return;
      }

      const downloadAllBtn = document.createElement("button");
      downloadAllBtn.type = "button";
      downloadAllBtn.className = "rlFilesBtn";
      downloadAllBtn.title = "Download every file in this list to your computer";
      const downloadAllBtnIdleText = "\u2B07 Download all (" + atts.length + ")";
      downloadAllBtn.textContent = downloadAllBtnIdleText;
      downloadAllBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!attsRef.length) return;
        let dirHandle = null;
        if (typeof window.showDirectoryPicker === "function") {
          try {
            // Must run in the same user-gesture turn — no awaits above this call.
            const parentDir = await rlFilesGetOrPickDownloadParentDir();
            if (!parentDir) return; // cancelled
            const dlStamp = (() => {
              const d = new Date();
              return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
            })();
            const destFolderName = rlFilesSanitizeFolderName((readProjectName() || ("Project " + rlPid)) + " " + dlStamp);
            try {
              dirHandle = await parentDir.getDirectoryHandle(destFolderName, { create: true });
            } catch (subErr) {
              console.warn("[rlFiles] could not create subfolder, writing into picked parent:", subErr);
              dirHandle = parentDir;
            }
          } catch (e) {
            console.warn("[rlFiles] download dir setup failed:", e);
            downloadAllBtn.textContent = "Folder picker blocked";
            setTimeout(() => { downloadAllBtn.textContent = downloadAllBtnIdleText; }, 2500);
            return;
          }
        }
        downloadAllBtn.disabled = true;
        let current = 0;
        let failed = 0;
        const usedNames = new Set();
        for (const att of attsRef) {
          const attId = att?.attachmentId;
          const fileName = rlFilesSanitizeFileName(String(att?.name ?? "Attachment").trim());
          current++;
          downloadAllBtn.textContent = "Downloading " + current + "/" + attsRef.length + "\u2026";
          if (!attId) { failed++; continue; }
          try {
            const { blob } = await gmRocketlaneDownloadAttachmentBlob(attId);
            if (dirHandle) {
              const safeName = rlFilesUniqueName(fileName, usedNames);
              const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(blob);
              await writable.close();
            } else {
              const objUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = objUrl;
              a.download = fileName;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
              await new Promise((r) => setTimeout(r, 250));
            }
          } catch (e) {
            console.warn("[rlFiles] Download failed for " + fileName + ":", e);
            failed++;
          }
        }
        downloadAllBtn.textContent = failed ? "Done — " + failed + " failed" : "Done \u2713";
        setTimeout(() => {
          downloadAllBtn.textContent = downloadAllBtnIdleText;
          downloadAllBtn.disabled = false;
        }, 2500);
      });
      filesActions.insertBefore(downloadAllBtn, uploadBtn);

      const describeLocation = (att) => {
        const link = att?._link;
        if (!link) return "";
        if (typeof link === "string") return link;
        if (typeof link === "object") {
          return String(
            link.title ?? link.name ?? link.label ??
            link.taskTitle ?? link.spaceTitle ?? link.conversationName ?? ""
          ).trim();
        }
        return "";
      };
      const fmtDate = (ms) => {
        const n = Number(ms);
        if (!n) return "";
        const d = new Date(n);
        if (isNaN(d.getTime())) return "";
        return d.toLocaleString("nb-NO", {
          year: "numeric", month: "short", day: "2-digit",
          hour: "2-digit", minute: "2-digit",
          hour12: false,
          timeZone: "Europe/Oslo",
        });
      };
      const sortState = { key: "date", dir: "desc" };
      const comparators = {
        name: (a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? ""), undefined, { sensitivity: "base", numeric: true }),
        date: (a, b) => (Number(a?.createdAt ?? 0) - Number(b?.createdAt ?? 0)),
        size: (a, b) => (Number(a?.sizeInBytes ?? 0) - Number(b?.sizeInBytes ?? 0)),
        location: (a, b) => {
          const al = (String(a?._source ?? "") + " " + describeLocation(a)).toLowerCase();
          const bl = (String(b?._source ?? "") + " " + describeLocation(b)).toLowerCase();
          return al.localeCompare(bl, undefined, { sensitivity: "base", numeric: true });
        },
      };

      const list = document.createElement("div");
      list.className = "rlFilesList";
      const header = document.createElement("div");
      header.className = "rlFilesListHead";
      const COLUMNS = [
        { label: "", key: null },
        { label: "Name", key: "name", defaultDir: "asc" },
        { label: "Modified", key: "date", defaultDir: "desc" },
        { label: "Size", key: "size", defaultDir: "desc" },
        { label: "Location", key: "location", defaultDir: "asc" },
      ];
      const sortButtons = new Map();
      for (const col of COLUMNS) {
        const cell = document.createElement("div");
        if (col.key) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "rlFilesSortBtn";
          const labelSpan = document.createElement("span");
          labelSpan.textContent = col.label;
          const arrow = document.createElement("span");
          arrow.className = "rlFilesSortArrow";
          btn.appendChild(labelSpan);
          btn.appendChild(arrow);
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (sortState.key === col.key) {
              sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
            } else {
              sortState.key = col.key;
              sortState.dir = col.defaultDir || "asc";
            }
            renderRows();
          });
          cell.appendChild(btn);
          sortButtons.set(col.key, { btn, arrow });
        }
        header.appendChild(cell);
      }
      list.appendChild(header);
      const rowsContainer = document.createElement("div");
      list.appendChild(rowsContainer);

      const renderRows = () => {
        for (const [k, ui] of sortButtons) {
          const isActive = k === sortState.key;
          ui.btn.classList.toggle("active", isActive);
          ui.arrow.textContent = isActive ? (sortState.dir === "asc" ? "\u25B2" : "\u25BC") : "";
        }
        const cmp = comparators[sortState.key] || comparators.date;
        const dirMul = sortState.dir === "asc" ? 1 : -1;
        const sorted = atts.slice().sort((a, b) => cmp(a, b) * dirMul);
        rowsContainer.textContent = "";
        for (const att of sorted) {
          const fullUrl = String(att?.downloadUrl ?? att?.location ?? "").trim();
          const thumbUrl = String(att?.thumbLocation ?? "").trim();
          const fileName = String(att?.name ?? "Attachment").trim();
          const mime = String(att?.mimeType ?? att?.contentType ?? "").toLowerCase();
          const sizeBytes = Number(att?.sizeInBytes ?? 0) || 0;
          const isImage =
            /^image\//.test(mime) ||
            /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName);
          const attId = att?.attachmentId;
          const row = document.createElement("a");
          row.className = "rlFilesListRow";
          const safeHref = toHttpUrl(fullUrl || thumbUrl);
          row.href = (safeHref && rlFilesIsTrustedAttachmentUrl(safeHref)) ? safeHref : "#";
          row.target = "_blank";
          row.rel = "noopener noreferrer";
          row.title = fileName;

          const ext = (fileName.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
          const isImageType =
            /^image\//.test(mime) ||
            /^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext);
          const isPdfType = mime === "application/pdf" || ext === "pdf";
          const isLightboxType = isImageType || isPdfType;
          const isNewTabType =
            /^text\//.test(mime) ||
            /^(txt|md|log|html|css|js|json|xml|csv)$/.test(ext) ||
            /^audio\//.test(mime) ||
            /^video\//.test(mime) ||
            /^(mp3|wav|ogg|m4a|mp4|webm|mov)$/.test(ext);

          row.addEventListener("click", async (ev) => {
            if (!attId) return;
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();

            if (isLightboxType) {
              let dest = "";
              try {
                const { full, thumb } = await getFreshUrls(attId);
                dest = full || thumb;
              } catch (e) {
                console.warn("[rlFiles] URL refresh failed:", e);
              }
              if (!dest) dest = fullUrl || thumbUrl;
              if (dest) rlFilesOpenMediaLightbox(dest, isPdfType ? "pdf" : "image");
              return;
            }

            if (isNewTabType) {
              const placeholder = window.open("about:blank", "_blank");
              let dest = "";
              try {
                const { full, thumb } = await getFreshUrls(attId);
                dest = full || thumb;
              } catch (e) {
                console.warn("[rlFiles] URL refresh failed:", e);
              }
              if (!dest) dest = fullUrl || thumbUrl;
              const httpDest = toHttpUrl(dest);
              if (placeholder && httpDest && rlFilesIsTrustedAttachmentUrl(httpDest)) {
                try { placeholder.opener = null; } catch (_) {}
                placeholder.location.href = httpDest;
              } else if (placeholder) {
                placeholder.document.body.innerText = "No trusted download URL available for this file.";
              }
              return;
            }

            const prevTitle = row.title;
            row.title = "Downloading " + fileName + "\u2026";
            row.style.opacity = "0.6";
            try {
              const { blob } = await gmRocketlaneDownloadAttachmentBlob(attId);
              const objUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = objUrl;
              a.download = rlFilesSanitizeFileName(fileName);
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
            } catch (e) {
              console.warn("[rlFiles] Download failed:", e);
              alert("Download failed: " + (e && e.message ? e.message : e));
            } finally {
              row.title = prevTitle;
              row.style.opacity = "";
            }
          });

          const iconCell = document.createElement("div");
          iconCell.className = "rlFilesListIcon";
          const thumbCandidate = toHttpUrl(fullUrl || thumbUrl);
          if (isImage && thumbCandidate && rlFilesIsTrustedAttachmentUrl(thumbCandidate)) {
            const img = document.createElement("img");
            img.src = thumbCandidate;
            img.alt = fileName;
            img.loading = "lazy";
            img.addEventListener("error", () => {
              iconCell.textContent = "";
              iconCell.appendChild(rlFilesBuildTypeIcon(mime, fileName));
            }, { once: true });
            img.addEventListener("click", async (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              try {
                const { full, thumb } = await getFreshUrls(attId);
                rlFilesOpenMediaLightbox(full || thumb || fullUrl || thumbUrl, "image");
              } catch (_) {
                rlFilesOpenMediaLightbox(fullUrl || thumbUrl, "image");
              }
            });
            iconCell.appendChild(img);
          } else {
            iconCell.appendChild(rlFilesBuildTypeIcon(mime, fileName));
          }
          row.appendChild(iconCell);

          const nameCell = document.createElement("div");
          nameCell.className = "rlFilesListName";
          nameCell.textContent = fileName;
          row.appendChild(nameCell);

          const dateCell = document.createElement("div");
          dateCell.className = "rlFilesListDate";
          dateCell.textContent = fmtDate(att?.createdAt);
          row.appendChild(dateCell);

          const sizeCell = document.createElement("div");
          sizeCell.className = "rlFilesListSize";
          sizeCell.textContent = sizeBytes ? rlFilesFormatSize(sizeBytes) : "\u2014";
          row.appendChild(sizeCell);

          const locCell = document.createElement("div");
          locCell.className = "rlFilesListLoc";
          const sourceLabel = att?._source ? String(att._source).toLowerCase().replace(/_/g, " ") : "";
          if (sourceLabel) {
            const badge = document.createElement("span");
            badge.className = "rlFilesLocBadge";
            badge.textContent = sourceLabel;
            locCell.appendChild(badge);
          }
          const linkText = describeLocation(att);
          if (linkText) locCell.appendChild(document.createTextNode(linkText));
          locCell.title = (sourceLabel ? sourceLabel + " — " : "") + linkText;
          row.appendChild(locCell);

          rowsContainer.appendChild(row);
        }
      };

      renderRows();
      body.appendChild(list);
    } catch (err) {
      if (!rlFilesGuardOrClose(gen, rlPid)) return;
      body.textContent = "";
      const errEl = document.createElement("div");
      errEl.className = "rlFilesError";
      errEl.textContent = "Couldn't load files: " + (err && err.message ? err.message : String(err));
      body.appendChild(errEl);
    }
  }

  function rlEnsureAutoFetchButton() {
    if (!/^\/projects\/\d+/.test(location.pathname)) {
      document.getElementById("rlAutoFetchUrlsBtn")?.remove();
      return;
    }
    rlInjectActionBarStyles();
    const presentBtn = rlFindPresentButton();
    const mount = rlPresentSecondaryAnchor(presentBtn);
    if (!mount) return;

    let btn = document.getElementById("rlAutoFetchUrlsBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "rlAutoFetchUrlsBtn";
      btn.type = "button";
      btn.title = "Open URL chooser: fetch IQC / Deal Description / Delivery links, Find candidates (Oneflow / Younium / HubSpot-from-fields), and Save clickable Attach links into Internal Quality control and notes.";
      const icon = document.createElement("span");
      icon.className = "rlFetchIcon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "\uD83D\uDD0E"; // 🔎
      const label = document.createElement("span");
      label.className = "rlFetchLabel";
      label.textContent = "Fetch URLs";
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (btn.dataset.rlBusy) return;
        void rlRunAutoFetchUrls();
      });
    }
    // Left of Present's top-level Secondary sibling (not inside the 32px Action wrapper).
    if (btn.parentElement !== mount.secondary || btn.nextSibling !== mount.anchor) {
      mount.secondary.insertBefore(btn, mount.anchor);
    }
  }

  function rlEnsureProjectActionBar() {
    if (!/^\/projects\/\d+/.test(location.pathname)) {
      document.getElementById("rlProjectActionBar")?.remove();
      rlFilesClosePopover();
      rlOrderInfoClosePopover();
      return;
    }
    rlInjectActionBarStyles();
    rlCatEnsureMenuHook();
    const ctx = getOneflowContext();
    if (!ctx.rlProjectId) return;

    // Warm the link cache in parallel with waiting for the toolbar.
    void rlLoadProjectLinks(ctx.rlProjectId);

    const mount = rlFindResponsibilityMount();
    if (!mount?.parent) return;

    let bar = document.getElementById("rlProjectActionBar");
    if (!bar) bar = rlBuildActionBarShell();
    if (bar.parentElement !== mount.parent || bar.nextSibling !== mount.before) {
      mount.parent.insertBefore(bar, mount.before);
    }
    if (rlFilesPopoverProjectId && rlFilesPopoverProjectId !== ctx.rlProjectId) {
      rlFilesClosePopover();
    }
    if (rlOrderInfoPopoverProjectId && rlOrderInfoPopoverProjectId !== ctx.rlProjectId) {
      rlOrderInfoClosePopover();
    }
    bar.dataset.rlProjectId = ctx.rlProjectId;

    const gen = ++rlActionBarGen;
    rlPatchActionBar(bar, rlProjectLinksCache.get(ctx.rlProjectId) || rlEmptyProjectLinks(), ctx);
    void rlLoadProjectLinks(ctx.rlProjectId).then((links) => {
      if (gen !== rlActionBarGen) return;
      const live = document.getElementById("rlProjectActionBar");
      if (!live || live.dataset.rlProjectId !== ctx.rlProjectId) return;
      rlPatchActionBar(live, links, ctx);
    });
  }

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

  async function zendeskPostTicketReply(ticketId, body, isPublic) {
    const id = String(ticketId ?? "").trim();
    if (!id) throw new Error("Missing Zendesk ticket id.");
    const textBody = String(body ?? "").trim();
    if (!textBody) throw new Error("Reply cannot be empty.");
    const res = await zendeskApiRequest("PUT", "/tickets/" + encodeURIComponent(id) + ".json", {
      ticket: {
        comment: {
          body: textBody,
          public: !!isPublic,
        },
      },
    });
    return res?.ticket ?? null;
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5d. Zendesk cases — repurpose native "Project updates" tab (v1.10.0).
  //     Full PPT Zendesk-tasks port: search merge, last-public-reply hydrate,
  //     expand / sanitize / attachments / fullscreen / reply. Transport via
  //     zendeskApiRequest + zendeskPostTicketReply (no window.ZendeskBridge).
  // ════════════════════════════════════════════════════════════════════════

  const RL_ZD_TAB_LABELS = [
    "project updates",
    "prosjektoppdateringer",
    "prosjekt oppdateringer",
    "oppdateringer",
    "updates",
  ];

  const RL_ZD_IMG_HOST_RE = [
    /(?:^|\.)zendesk\.com$/i,
    /(?:^|\.)zdusercontent\.com$/i,
    /(?:^|\.)zdassets\.com$/i,
    /(?:^|\.)cloudfront\.net$/i,
    /(?:^|\.)amazonaws\.com$/i,
  ];

  const RL_ZD_ICON_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">' +
    '<path d="M8 0a2.15 2.15 0 0 1 1.52 3.67L8 5.19 6.48 3.67A2.15 2.15 0 0 1 8 0zm0 10.81l1.52 1.52a2.15 2.15 0 1 1-3.04 0L8 10.81zM0 8a2.15 2.15 0 0 1 3.67-1.52L5.19 8 3.67 9.52A2.15 2.15 0 0 1 0 8zm10.81 0l1.52-1.52a2.15 2.15 0 1 1 0 3.04L10.81 8z"/>' +
    "</svg>";

  let rlZdPanelGen = 0;
  let rlZdPanelProjectId = "";
  let rlZdPanelEl = null;
  let rlZdHiddenNative = [];

  function rlZdInjectStyles() {
    let style = document.getElementById("rlZendeskCasesStyles");
    // Version pin so a TM bump refreshes CSS once without rewriting every ensure tick.
    if (style && style.dataset.rlZdReady === "1.14.16") return;
    if (!style) {
      style = document.createElement("style");
      style.id = "rlZendeskCasesStyles";
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = `
      /* Hide native status-updates body without JS DOM writes (avoids observer loops). */
      body.rlZdCasesActive #page > [class*="content__Content-"] > *:not(#rlZendeskCasesPanel) {
        display: none !important;
      }
      /* Same light shell as the home Project Owner / In progress panels (v1.14.14):
         translucent white panel, hairline borders, white cards, muted uppercase title,
         outlined status chips with a coloured dot. */
      #rlZendeskCasesPanel {
        --rlZd-shell: rgba(255,255,255,0.78);
        --rlZd-surface-1: rgba(255,255,255,0.72);
        --rlZd-surface-2: rgba(255,255,255,0.85);
        --rlZd-surface-3: rgba(15,23,42,0.05);
        --rlZd-hairline: rgba(15,23,42,0.08);
        --rlZd-hairline-strong: rgba(15,23,42,0.14);
        --rlZd-border: rgba(15,23,42,0.10);
        --rlZd-text: rgba(15,23,42,0.90);
        --rlZd-muted: rgba(15,23,42,0.74);
        --rlZd-muted2: rgba(15,23,42,0.58);
        --rlZd-accent: #0369a1;
        --rlZd-accent-soft: rgba(3,105,161,0.08);
        --rlZd-accent-stroke: rgba(3,105,161,0.28);
        --rlZd-good: #059669;
        --rlZd-warn: #b45309;
        --rlZd-bad: #e11d48;
        box-sizing: border-box;
        width: 100%;
        max-width: 1100px;
        margin: 48px auto 16px;
        padding: 14px 16px 16px;
        color: var(--rlZd-text) !important;
        background: var(--rlZd-shell);
        border: 1px solid var(--rlZd-border);
        border-radius: 16px;
        font: 13px/1.35 "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif;
        box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 8px 24px rgba(15,23,42,0.06);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      }
      [data-rl-zd-tab="1"] svg { width: 14px; height: 14px; }
      #rlZendeskCasesPanel .rlZdHead {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; margin-bottom: 12px;
      }
      #rlZendeskCasesPanel .rlZdHeadActions { display: flex; gap: 8px; align-items: center; }
      /* Floating mode (v1.14.15): a fixed window you drag by the header and resize
         from the bottom-right corner; size and position persist in GM storage. */
      #rlZendeskCasesPanel.rlZdFloating {
        position: fixed; z-index: 11000; margin: 0; max-width: none;
        min-width: 420px; min-height: 280px; max-height: 94vh;
        display: flex; flex-direction: column;
        overflow: hidden;
        box-shadow: 0 2px 6px rgba(15,23,42,0.08), 0 18px 48px rgba(15,23,42,0.18);
        background: rgba(255,255,255,0.96);
      }
      #rlZendeskCasesPanel.rlZdFloating .rlZdHead { cursor: move; user-select: none; flex: 0 0 auto; }
      #rlZendeskCasesPanel.rlZdFloating .rlZdBody { flex: 1 1 auto; min-height: 0; overflow: auto; }
      #rlZendeskCasesPanel.rlZdFloating .rlZdTaskList { max-height: none; }
      #rlZendeskCasesPanel.rlZdFloating::after {
        content: ''; position: absolute; right: 4px; bottom: 4px; width: 10px; height: 10px;
        border-right: 2px solid rgba(15,23,42,0.28); border-bottom: 2px solid rgba(15,23,42,0.28);
        border-radius: 0 0 3px 0; pointer-events: none;
      }
      /* Invisible grab zones on every edge and corner; only shown while floating. */
      #rlZendeskCasesPanel .rlZdResize { display: none; position: absolute; z-index: 5; }
      #rlZendeskCasesPanel.rlZdFloating .rlZdResize { display: block; }
      #rlZendeskCasesPanel .rlZdResize[data-resize="right"]  { top: 10px; bottom: 10px; right: 0; width: 8px; cursor: ew-resize; }
      #rlZendeskCasesPanel .rlZdResize[data-resize="left"]   { top: 10px; bottom: 10px; left: 0; width: 8px; cursor: ew-resize; }
      #rlZendeskCasesPanel .rlZdResize[data-resize="bottom"] { left: 10px; right: 10px; bottom: 0; height: 8px; cursor: ns-resize; }
      #rlZendeskCasesPanel .rlZdResize[data-resize="top"]    { left: 10px; right: 10px; top: 0; height: 8px; cursor: ns-resize; }
      #rlZendeskCasesPanel .rlZdResize[data-resize="top-left"]     { top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }
      #rlZendeskCasesPanel .rlZdResize[data-resize="top-right"]    { top: 0; right: 0; width: 14px; height: 14px; cursor: nesw-resize; }
      #rlZendeskCasesPanel .rlZdResize[data-resize="bottom-left"]  { bottom: 0; left: 0; width: 14px; height: 14px; cursor: nesw-resize; }
      #rlZendeskCasesPanel .rlZdResize[data-resize="bottom-right"] { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; }
      body.rlZdDragging { user-select: none; cursor: move; }
      body.rlZdResizing { user-select: none; }
      #rlZendeskCasesPanel .rlZdTitle,
      #rlZendeskCasesPanel h2.rlZdTitle {
        margin: 0; font-size: 12px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase; color: rgba(15,23,42,0.82) !important;
      }
      #rlZendeskCasesPanel .rlZdRefresh {
        appearance: none; border: 1px solid var(--rlZd-border);
        background: var(--rlZd-surface-1); color: var(--rlZd-text) !important;
        border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12px; font-weight: 600;
        cursor: pointer; display: inline-flex; align-items: center;
      }
      #rlZendeskCasesPanel .rlZdRefresh:hover {
        background: rgba(255,255,255,0.92); border-color: rgba(15,23,42,0.16);
      }
      #rlZendeskCasesPanel .rlZdBody { min-height: 120px; color: var(--rlZd-text); }
      #rlZendeskCasesPanel .rlZdEmpty,
      #rlZendeskCasesPanel .rlZdLoading { color: var(--rlZd-muted); padding: 12px 2px; font-size: 12px; }
      #rlZendeskCasesPanel .rlZdError { color: var(--rlZd-bad); padding: 12px 2px; font-size: 12px; }
      /* List: plain stack of white cards, like the home project cards. */
      #rlZendeskCasesPanel .rlZdTaskList {
        display: grid; gap: 10px; max-height: min(70vh, 720px); overflow-y: auto;
        padding: 0 2px 0 0; border: none; background: transparent;
      }
      #rlZendeskCasesPanel .rlZdTaskRow {
        display: grid; grid-template-columns: auto 1fr auto auto; gap: 10px;
        align-items: center; padding: 12px 14px; border-radius: 12px;
        background: transparent; border: none;
        font-size: 13px; color: var(--rlZd-text) !important;
        cursor: pointer;
      }
      #rlZendeskCasesPanel .rlZdTaskCard {
        display: grid; gap: 0; background: rgba(255,255,255,0.78);
        border: 1px solid rgba(15,23,42,0.08); border-radius: 12px; overflow: hidden;
        box-shadow: 0 1px 2px rgba(15,23,42,0.04);
        transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }
      #rlZendeskCasesPanel .rlZdTaskCard:hover {
        transform: translateY(-1px); background: rgba(255,255,255,0.92);
        border-color: rgba(15,23,42,0.14); box-shadow: 0 4px 12px rgba(15,23,42,0.08);
      }
      #rlZendeskCasesPanel .rlZdTaskCard.expanded {
        transform: none; background: rgba(255,255,255,0.92); border-color: rgba(15,23,42,0.14);
      }
      /* Status chip — hairline outline, neutral text, coloured dot for the state. */
      #rlZendeskCasesPanel .rlZdTaskStatus {
        display: inline-flex; align-items: center; gap: 6px;
        height: 22px; box-sizing: border-box; padding: 0 9px 0 8px; border-radius: 999px;
        font-size: 11px; font-weight: 500; line-height: 1.2; text-transform: capitalize;
        letter-spacing: 0.01em; color: var(--rlZd-muted); background: transparent;
        border: 1px solid rgba(15,23,42,0.12); white-space: nowrap; --rlZd-dot: rgba(100,116,139,0.9);
      }
      #rlZendeskCasesPanel .rlZdTaskStatus::before {
        content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--rlZd-dot); flex: 0 0 auto;
      }
      #rlZendeskCasesPanel .rlZdTaskStatus.zd-new { --rlZd-dot: var(--rlZd-accent); }
      #rlZendeskCasesPanel .rlZdTaskStatus.zd-open { --rlZd-dot: var(--rlZd-warn); }
      #rlZendeskCasesPanel .rlZdTaskStatus.zd-pending { --rlZd-dot: #7c3aed; }
      #rlZendeskCasesPanel .rlZdTaskStatus.zd-hold { --rlZd-dot: var(--rlZd-bad); }
      #rlZendeskCasesPanel .rlZdTaskStatus.zd-solved { --rlZd-dot: var(--rlZd-good); }
      #rlZendeskCasesPanel .rlZdTaskStatus.zd-closed { --rlZd-dot: rgba(148,163,184,0.95); }
      #rlZendeskCasesPanel .rlZdTaskMiddle { display: flex; flex-direction: column; gap: 3px; min-width: 0; overflow: hidden; }
      #rlZendeskCasesPanel .rlZdTaskSubject {
        font-weight: 650; font-size: 13px; line-height: 16px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
        color: var(--rlZd-text) !important;
      }
      #rlZendeskCasesPanel .rlZdTaskWhen {
        color: var(--rlZd-muted) !important; font-size: 11px; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      #rlZendeskCasesPanel .rlZdTaskMetaLink {
        color: var(--rlZd-muted) !important; font-size: 11px; white-space: nowrap;
        text-decoration: none; padding: 3px 8px; border-radius: 999px;
        border: 1px solid transparent; font-variant-numeric: tabular-nums;
      }
      #rlZendeskCasesPanel .rlZdTaskMetaLink:hover {
        background: var(--rlZd-surface-2); border-color: var(--rlZd-hairline-strong);
        color: var(--rlZd-text) !important;
      }
      #rlZendeskCasesPanel .rlZdTaskCard > .rlZdTaskRow {
        background: transparent; border: none;
      }
      #rlZendeskCasesPanel .rlZdTaskDetail { padding: 0 14px 14px; display: grid; gap: 10px; }
      #rlZendeskCasesPanel .rlZdConvo {
        display: grid; gap: 8px; max-height: 220px; overflow-y: auto; padding: 10px;
        border-radius: 10px; background: rgba(15,23,42,0.03); border: 1px solid var(--rlZd-hairline);
      }
      #rlZendeskCasesPanel .rlZdConvoShowEarlier {
        align-self: stretch; background: transparent; color: var(--rlZd-accent);
        border: 1px dashed var(--rlZd-accent-stroke); border-radius: 8px;
        padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer; text-align: center;
      }
      #rlZendeskCasesPanel .rlZdConvoShowEarlier:hover { background: var(--rlZd-accent-soft); }
      #rlZendeskCasesPanel .rlZdCompose { display: grid; gap: 8px; padding: 10px; border-radius: 10px;
        background: rgba(15,23,42,0.03); border: 1px solid var(--rlZd-hairline); position: relative; }
      #rlZendeskCasesPanel .rlZdComposeHd {
        font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--rlZd-muted); margin-bottom: 2px;
      }
      #rlZendeskCasesPanel .rlZdMsg {
        padding: 8px 10px; border-radius: 8px; background: rgba(255,255,255,0.85);
        border: 1px solid var(--rlZd-hairline); font-size: 12px; line-height: 1.45;
        color: var(--rlZd-text) !important;
      }
      #rlZendeskCasesPanel .rlZdMsg.rlZdMsgInternal {
        background: rgba(180,83,9,0.06); border-color: rgba(180,83,9,0.25);
      }
      #rlZendeskCasesPanel .rlZdMsgHead {
        display: flex; gap: 8px; align-items: baseline; font-size: 11px; margin-bottom: 4px; flex-wrap: wrap;
      }
      #rlZendeskCasesPanel .rlZdMsgAuthor { font-weight: 700; color: var(--rlZd-text); }
      #rlZendeskCasesPanel .rlZdMsgWhen { color: var(--rlZd-muted2); }
      #rlZendeskCasesPanel .rlZdMsgInternalTag {
        color: var(--rlZd-warn); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
        font-size: 10px; padding: 1px 6px; border-radius: 999px;
        border: 1px solid rgba(180,83,9,0.35); background: rgba(180,83,9,0.08);
      }
      #rlZendeskCasesPanel .rlZdMsgBody { color: var(--rlZd-text); overflow-wrap: anywhere; }
      #rlZendeskCasesPanel .rlZdMsgBody [style*="color"]:not(a),
      #rlZendeskCasesPanel .rlZdMsgBody font { color: var(--rlZd-text) !important; }
      #rlZendeskCasesPanel .rlZdMsgBody [style*="background"]:not(pre):not(code) { background: transparent !important; }
      #rlZendeskCasesPanel .rlZdMsgBody p { margin: 0 0 6px; }
      #rlZendeskCasesPanel .rlZdMsgBody p:last-child { margin-bottom: 0; }
      #rlZendeskCasesPanel .rlZdMsgBody br + br { display: none; }
      #rlZendeskCasesPanel .rlZdMsgBody ul, #rlZendeskCasesPanel .rlZdMsgBody ol { margin: 4px 0 6px; padding-left: 20px; }
      #rlZendeskCasesPanel .rlZdMsgBody li { margin: 0 0 2px; }
      #rlZendeskCasesPanel .rlZdMsgBody h1,
      #rlZendeskCasesPanel .rlZdMsgBody h2,
      #rlZendeskCasesPanel .rlZdMsgBody h3,
      #rlZendeskCasesPanel .rlZdMsgBody h4 {
        margin: 8px 0 4px; font-size: 13px; font-weight: 700;
      }
      #rlZendeskCasesPanel .rlZdMsgBody blockquote {
        margin: 6px 0; padding: 0 0 0 12px; border-left: 2px solid var(--rlZd-hairline-strong);
        color: var(--rlZd-muted); background: none;
      }
      #rlZendeskCasesPanel .rlZdMsgBody blockquote blockquote {
        margin: 4px 0; padding-left: 0; border-left: none; background: none;
      }
      #rlZendeskCasesPanel .rlZdMsgBody blockquote:empty { display: none; }
      #rlZendeskCasesPanel .rlZdMsgBody blockquote + blockquote { margin-top: 0; }
      #rlZendeskCasesPanel .rlZdMsgBody a { color: var(--rlZd-accent); text-decoration: underline; }
      #rlZendeskCasesPanel .rlZdMsgBody code {
        font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px;
        background: var(--rlZd-surface-3); border-radius: 4px; padding: 1px 4px;
      }
      #rlZendeskCasesPanel .rlZdMsgBody pre {
        font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px;
        background: var(--rlZd-surface-3); border: 1px solid var(--rlZd-border);
        border-radius: 6px; padding: 8px 10px; margin: 4px 0; overflow-x: auto;
      }
      #rlZendeskCasesPanel .rlZdMsgBody hr {
        border: none; border-top: 1px dashed var(--rlZd-hairline-strong); margin: 8px 0;
      }
      #rlZendeskCasesPanel .rlZdMsgBody table { border-collapse: collapse; margin: 4px 0; border: none; }
      #rlZendeskCasesPanel .rlZdMsgBody th, #rlZendeskCasesPanel .rlZdMsgBody td {
        border: none; padding: 2px 6px 2px 0; font-size: 12px; vertical-align: top;
      }
      #rlZendeskCasesPanel .rlZdMsgBody table:has(thead) { border: 1px solid var(--rlZd-border); }
      #rlZendeskCasesPanel .rlZdMsgBody table:has(thead) th,
      #rlZendeskCasesPanel .rlZdMsgBody table:has(thead) td {
        border: 1px solid var(--rlZd-border); padding: 4px 8px; font-size: 11px;
      }
      #rlZendeskCasesPanel .rlZdMsgBody img.rlZdMsgInlineImg {
        max-width: 100%; max-height: 280px; border-radius: 6px; display: block;
        margin: 4px 0; border: 1px solid var(--rlZd-border);
      }
      #rlZendeskCasesPanel .rlZdMsgAttachments {
        display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; padding-top: 8px;
        border-top: 1px dashed var(--rlZd-hairline-strong);
      }
      #rlZendeskCasesPanel .rlZdMsgImgThumb {
        display: inline-block; line-height: 0; border-radius: 6px; overflow: hidden;
        border: 1px solid var(--rlZd-border); background: var(--rlZd-surface-3);
      }
      #rlZendeskCasesPanel .rlZdMsgImgThumb:hover { border-color: var(--rlZd-accent-stroke); }
      #rlZendeskCasesPanel .rlZdMsgImgThumb img { max-width: 200px; max-height: 140px; display: block; }
      #rlZendeskCasesPanel .rlZdMsgFile {
        display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px;
        border-radius: 999px; background: var(--rlZd-surface-1); border: 1px solid var(--rlZd-border);
        color: var(--rlZd-text); text-decoration: none; font-size: 11px; font-weight: 500;
        max-width: 280px; overflow: hidden;
      }
      #rlZendeskCasesPanel .rlZdMsgFile:hover {
        background: var(--rlZd-surface-2); border-color: var(--rlZd-hairline-strong);
      }
      #rlZendeskCasesPanel .rlZdMsgFileName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #rlZendeskCasesPanel .rlZdMsgFileSize { color: var(--rlZd-muted2); font-size: 10px; white-space: nowrap; }
      #rlZendeskCasesPanel .rlZdComposeClosed {
        padding: 12px 14px; border-radius: 10px; background: rgba(148,163,184,0.10);
        border: 1px dashed var(--rlZd-hairline-strong); color: var(--rlZd-muted);
        font-size: 12.5px; font-style: italic; text-align: center;
      }
      #rlZendeskCasesPanel .rlZdComposeToolbar { display: flex; gap: 12px; align-items: center; font-size: 12px; }
      #rlZendeskCasesPanel .rlZdReplyKind {
        position: relative; display: inline-grid; grid-template-columns: 1fr 1fr;
        background: var(--rlZd-surface-1); border: 1px solid var(--rlZd-border);
        border-radius: 999px; padding: 3px; user-select: none;
      }
      #rlZendeskCasesPanel .rlZdReplyKindThumb {
        position: absolute; top: 3px; left: 3px; width: calc(50% - 3px); height: calc(100% - 6px);
        border-radius: 999px; background: var(--rlZd-accent-soft);
        border: 1px solid var(--rlZd-accent-stroke);
        transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1), background 200ms ease, border-color 200ms ease;
        pointer-events: none;
      }
      #rlZendeskCasesPanel .rlZdReplyKind[data-active="internal"] .rlZdReplyKindThumb {
        transform: translateX(100%);
        background: rgba(180,83,9,0.10); border-color: rgba(180,83,9,0.35);
      }
      #rlZendeskCasesPanel .rlZdReplyKindBtn {
        position: relative; z-index: 1; appearance: none; background: transparent; border: none;
        color: var(--rlZd-muted); font-size: 12px; font-weight: 700; padding: 6px 16px;
        border-radius: 999px; cursor: pointer; letter-spacing: 0.02em; white-space: nowrap; text-align: center;
      }
      #rlZendeskCasesPanel .rlZdReplyKindBtn:hover { color: var(--rlZd-text); }
      #rlZendeskCasesPanel .rlZdReplyKind[data-active="public"] .rlZdReplyKindBtn.public { color: var(--rlZd-accent); }
      #rlZendeskCasesPanel .rlZdReplyKind[data-active="internal"] .rlZdReplyKindBtn.internal { color: var(--rlZd-warn); }
      #rlZendeskCasesPanel .rlZdComposeTextarea {
        width: 100%; min-height: 80px; resize: vertical; font: inherit; font-size: 12px; line-height: 1.45;
        color: var(--rlZd-text); background: rgba(255,255,255,0.9); border: 1px solid var(--rlZd-border);
        border-radius: 8px; padding: 8px 10px; box-sizing: border-box;
      }
      #rlZendeskCasesPanel .rlZdComposeRow { display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
      #rlZendeskCasesPanel .rlZdComposeStatus { flex: 1; font-size: 11px; color: var(--rlZd-muted2); }
      #rlZendeskCasesPanel .rlZdComposeStatus.error { color: var(--rlZd-bad); }
      #rlZendeskCasesPanel .rlZdComposeBtn {
        background: var(--rlZd-accent-soft); color: var(--rlZd-accent);
        border: 1px solid var(--rlZd-accent-stroke); border-radius: 999px;
        padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer;
      }
      #rlZendeskCasesPanel .rlZdComposeBtn:hover:not(:disabled) { background: rgba(3,105,161,0.14); }
      #rlZendeskCasesPanel .rlZdComposeBtn:disabled { opacity: 0.5; cursor: not-allowed; }
      .rlZdTaskCard.rlZdCardFullscreen {
        display: flex; flex-direction: column; position: fixed; inset: 0; z-index: 12000;
        background: rgba(0,0,0,0.45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        padding: 60px 20px 20px; gap: 8px; cursor: pointer; border-radius: 0; border: none;
      }
      .rlZdTaskCard.rlZdCardFullscreen > * { cursor: auto; }
      .rlZdTaskCard.rlZdCardFullscreen .rlZdTaskRow {
        order: 1; max-width: 1100px; width: 100%; align-self: center;
        background: #0f1424; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
        padding: 12px 14px; color: rgba(255,255,255,0.92);
      }
      @media (prefers-color-scheme: light) {
        .rlZdTaskCard.rlZdCardFullscreen:not(.rlZdFsDark) .rlZdTaskRow {
          background: #ffffff; border-color: rgba(15,23,42,0.12); color: rgba(15,23,42,0.92);
        }
      }
      .rlZdTaskCard.rlZdCardFullscreen .rlZdTaskDetail {
        order: 2; max-width: 1100px; width: 100%; align-self: center;
        display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 0; gap: 8px;
      }
      .rlZdTaskCard.rlZdCardFullscreen .rlZdConvo {
        flex: 1; min-height: 0; max-height: none;
        background: rgba(0,0,0,0.22); color: rgba(255,255,255,0.92);
        border: 1px solid rgba(255,255,255,0.10);
      }
      .rlZdTaskCard.rlZdCardFullscreen .rlZdCompose {
        background: rgba(255,255,255,0.035); color: rgba(255,255,255,0.92);
        border: 1px solid rgba(255,255,255,0.10);
      }
      .rlZdTaskCard.rlZdCardFullscreen .rlZdMsg {
        background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10);
      }
      @media (prefers-color-scheme: light) {
        .rlZdTaskCard.rlZdCardFullscreen:not(.rlZdFsDark) .rlZdConvo {
          background: rgba(15,23,42,0.04); color: rgba(15,23,42,0.92);
          border-color: rgba(15,23,42,0.10);
        }
        .rlZdTaskCard.rlZdCardFullscreen:not(.rlZdFsDark) .rlZdCompose {
          background: rgba(15,23,42,0.035); color: rgba(15,23,42,0.92);
          border-color: rgba(15,23,42,0.10);
        }
        .rlZdTaskCard.rlZdCardFullscreen:not(.rlZdFsDark) .rlZdMsg {
          background: rgba(15,23,42,0.03); border-color: rgba(15,23,42,0.10);
        }
      }
      .rlZdExpandBtn { display: none; }
      .rlZdTaskCard.rlZdCardFullscreen .rlZdExpandBtn {
        display: inline-flex; align-items: center; justify-content: center;
        position: fixed; top: 14px; right: 18px; z-index: 13000;
        width: 36px; height: 36px; font-size: 18px; line-height: 1; border-radius: 10px;
        background: #1a2238; border: 1px solid rgba(255,255,255,0.14);
        box-shadow: 0 4px 12px rgba(0,0,0,0.2); cursor: pointer; color: rgba(255,255,255,0.92);
      }
      @media (prefers-color-scheme: light) {
        .rlZdTaskCard.rlZdCardFullscreen:not(.rlZdFsDark) .rlZdExpandBtn {
          background: #ffffff; border-color: rgba(15,23,42,0.16); color: rgba(15,23,42,0.9);
        }
      }
      body.rlZdFullscreenOpen { overflow: hidden; }
      .rlZdTaskCard:not(.rlZdCardFullscreen) .rlZdMsg:not(:last-child) { display: none; }
      .rlZdTaskCard:not(.rlZdCardFullscreen) .rlZdConvoShowEarlier { display: none; }
      .rlZdTaskCard:not(.rlZdCardFullscreen) .rlZdCompose { display: none; }
      .rlZdInlineReplyHint {
        display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
        font-size: 11px; color: var(--rlZd-muted); padding: 4px 10px; margin-bottom: 4px;
        border: 1px dashed var(--rlZd-hairline); border-radius: 999px;
        background: var(--rlZd-surface-2); font-style: italic; cursor: help;
      }
      .rlZdTaskCard.rlZdCardFullscreen .rlZdInlineReplyHint { display: none; }
      .rlZdTaskCard:not(.rlZdCardFullscreen) .rlZdConvo { max-height: none; }
    `;
    style.dataset.rlZdReady = "1.14.16";
  }

  function rlZdSanitizeZendeskHtml(rawHtml) {
    const ALLOWED_TAGS = new Set([
      "p", "br", "div", "span",
      "b", "strong", "i", "em", "u", "s", "strike", "del",
      "ul", "ol", "li", "a", "img",
      "code", "pre", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "table", "thead", "tbody", "tr", "td", "th",
      "hr",
    ]);
    const ALLOWED_ATTRS = new Set([
      "href", "target", "rel", "src", "alt", "title",
      "width", "height", "class", "style",
      "colspan", "rowspan",
    ]);
    const STRIP_PRESENTATION_ATTRS = new Set([
      "border", "cellpadding", "cellspacing", "bgcolor", "color",
      "align", "valign",
    ]);
    const SAFE_URL = /^(?:https?:|mailto:|tel:)/i;
    const isAllowedImg = (raw) => {
      const s = String(raw || "").trim();
      if (!s) return false;
      if (s.startsWith("data:image/")) return true;
      try {
        const u = new URL(s, ZENDESK_HOST);
        if (!/^https?:$/i.test(u.protocol)) return false;
        return RL_ZD_IMG_HOST_RE.some((rx) => rx.test(u.host));
      } catch { return false; }
    };
    const SAFE_STYLE_PROPS = new Set([
      "font-weight", "font-style",
      "text-align", "text-decoration",
      "margin", "margin-left",
      "padding-left",
      "list-style-type",
    ]);
    const sanitizeStyle = (raw) => {
      return String(raw || "")
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean)
        .filter((p) => {
          const [k, v] = p.split(":").map((s) => s.trim().toLowerCase());
          if (!SAFE_STYLE_PROPS.has(k)) return false;
          if (/url\s*\(|expression\s*\(|javascript:/i.test(v)) return false;
          return true;
        })
        .join("; ");
    };
    const doc = new DOMParser().parseFromString(String(rawHtml ?? ""), "text/html");
    const clean = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== 1) continue;
        const tag = String(child.tagName || "").toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) {
          const text = doc.createTextNode(child.textContent || "");
          node.replaceChild(text, child);
          continue;
        }
        if (tag === "img") {
          const src = child.getAttribute("src") || "";
          if (!isAllowedImg(src)) { node.removeChild(child); continue; }
          child.classList.add("rlZdMsgInlineImg");
          child.setAttribute("loading", "lazy");
          child.setAttribute("referrerpolicy", "no-referrer");
        }
        for (const attr of Array.from(child.attributes)) {
          const name = String(attr.name || "").toLowerCase();
          if (STRIP_PRESENTATION_ATTRS.has(name)) { child.removeAttribute(attr.name); continue; }
          if (!ALLOWED_ATTRS.has(name)) { child.removeAttribute(attr.name); continue; }
          if (name === "href") {
            const v = String(attr.value || "").trim();
            if (!SAFE_URL.test(v)) child.removeAttribute("href");
            else if (tag === "a") {
              child.setAttribute("target", "_blank");
              child.setAttribute("rel", "noopener noreferrer");
            }
          }
          if (name === "style") {
            const cleaned = sanitizeStyle(attr.value);
            if (cleaned) child.setAttribute("style", cleaned);
            else child.removeAttribute("style");
          }
        }
        clean(child);
      }
    };
    clean(doc.body);
    return doc.body.innerHTML;
  }

  function rlZdNormTabText(s) {
    return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function rlZdFindUpdatesCell(row) {
    if (!row) return null;
    const cells = Array.from(row.querySelectorAll(':scope > [class*="TabWrapper-"]'));
    const byHref = cells.find((c) => !!c.querySelector('a[href*="updates"]'));
    if (byHref) return byHref;
    return cells.find((c) => {
      const t = rlZdNormTabText(c.textContent);
      if (c.querySelector("#ynNavBtn, #ofNavBtn, #dtsNavBtn")) return false;
      return RL_ZD_TAB_LABELS.some((lab) => t === lab || t.startsWith(lab + " "));
    }) || null;
  }

  function rlZdCellLooksActive(cell) {
    if (!cell) return false;
    if (cell.getAttribute("aria-selected") === "true") return true;
    const cls = String(cell.className || "");
    if (/active|selected|current/i.test(cls)) return true;
    const a = cell.querySelector("a");
    if (a && /active|selected|current/i.test(String(a.className || ""))) return true;
    return false;
  }

  function rlZdIsUpdatesRouteActive(row) {
    const path = String(location.pathname || "");
    // Live tenant uses /projects/{id}/status-updates (not bare "updates").
    if (/\/projects\/\d+\/status-updates(?:\/|$)/i.test(path)) return true;
    if (/\/projects\/\d+\/(?:[^/]+\/)?(?:project-)?updates(?:\/|$)/i.test(path)) return true;
    if (/\/projects\/\d+\/.*updates/i.test(path)) return true;
    const cell = row ? rlZdFindUpdatesCell(row) : null;
    if (cell && rlZdCellLooksActive(cell)) return true;
    const link = cell && cell.querySelector("a[href]");
    if (link) {
      try {
        const href = link.getAttribute("href") || "";
        if (href && location.pathname.indexOf(new URL(href, location.origin).pathname) === 0) return true;
      } catch (_) {}
    }
    return false;
  }

  function rlZdPatchUpdatesTab(row) {
    const cell = rlZdFindUpdatesCell(row);
    if (!cell) return null;
    if (cell.getAttribute("data-rl-zd-tab") === "1") {
      // Re-assert label in case SPA rewrote text.
      const labelEl =
        cell.querySelector('[class*="TabLabel"], [class*="tab-label"], span, a') || cell;
      const txt = rlZdNormTabText(labelEl.textContent);
      if (txt !== "zendesk cases" && !/zendesk cases/i.test(labelEl.textContent || "")) {
        rlZdSetTabLabel(cell, "Zendesk cases");
      }
      rlZdBindTabClick(cell);
      return cell;
    }
    rlZdSetTabLabel(cell, "Zendesk cases");
    rlZdReplaceTabIcon(cell);
    cell.setAttribute("data-rl-zd-tab", "1");
    rlZdBindTabClick(cell);
    return cell;
  }

  function rlZdSetTabLabel(cell, label) {
    const candidates = Array.from(cell.querySelectorAll("span, a, div, p")).filter((el) => {
      const t = rlZdNormTabText(el.textContent);
      if (!t || el.children.length > 2) return false;
      return (
        RL_ZD_TAB_LABELS.some((lab) => t === lab || t.startsWith(lab)) ||
        t === "zendesk cases" ||
        /project updates|prosjekt/i.test(t)
      );
    });
    const target = candidates.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (target) {
      // Prefer leaf text node rewrite so we keep structure.
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      let node;
      let best = null;
      while ((node = walker.nextNode())) {
        const t = rlZdNormTabText(node.nodeValue);
        if (!t) continue;
        if (
          RL_ZD_TAB_LABELS.some((lab) => t === lab || t.startsWith(lab)) ||
          t === "zendesk cases" ||
          /project updates|zendesk/i.test(t)
        ) {
          best = node;
          break;
        }
      }
      if (best) best.nodeValue = label;
      else target.textContent = label;
    } else {
      const a = cell.querySelector("a");
      if (a && !a.querySelector("svg, img")) a.textContent = label;
    }
  }

  function rlZdReplaceTabIcon(cell) {
    if (!cell) return;
    const svgs = Array.from(cell.querySelectorAll("svg"));
    if (svgs.length) {
      const host = document.createElement("span");
      host.innerHTML = RL_ZD_ICON_SVG;
      const neu = host.firstElementChild;
      if (neu) {
        const old = svgs[0];
        // Copy size-ish attrs if present.
        if (old.getAttribute("class")) neu.setAttribute("class", old.getAttribute("class"));
        old.replaceWith(neu);
      }
      return;
    }
    const imgs = cell.querySelectorAll("img");
    if (imgs.length) {
      const host = document.createElement("span");
      host.innerHTML = RL_ZD_ICON_SVG;
      const neu = host.firstElementChild;
      if (neu) imgs[0].replaceWith(neu);
    }
  }

  // Rename "Project updates" everywhere it still appears (nav tab + "Show tabs for
  // this project" settings list). Debounced; bails when the phrase is gone so it
  // cannot MutationObserver-loop the way style rewriting did in v1.10.2.
  function rlZdRenameProjectUpdatesLabels(root) {
    const scope = root && root.nodeType === 1 ? root : document.body;
    if (!scope || !scope.isConnected) return;
    let hay = "";
    try { hay = scope.textContent || ""; } catch (_) { return; }
    if (!/Project updates/i.test(hay)) return;

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node;
    const touchedParents = [];
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue;
      if (!raw || raw.length > 64 || !/Project updates/i.test(raw)) continue;
      // Skip script/style text nodes.
      const p = node.parentElement;
      if (p && /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/i.test(p.tagName)) continue;
      node.nodeValue = raw.replace(/Project updates/gi, "Zendesk cases");
      if (p) touchedParents.push(p);
    }
    for (const el of touchedParents) {
      const row =
        el.closest(
          '[class*="TabWrapper"], [class*="TabLabel"], [role="listitem"], [role="menuitem"], li, button, [class*="MenuItem"], [class*="ListItem"]',
        ) || el.parentElement;
      if (!row || row.getAttribute("data-rl-zd-icon") === "1") continue;
      rlZdReplaceTabIcon(row);
      row.setAttribute("data-rl-zd-icon", "1");
    }
  }

  let rlZdLabelRenameTimer = null;
  function rlZdScheduleLabelRename() {
    if (rlZdLabelRenameTimer) return;
    rlZdLabelRenameTimer = setTimeout(() => {
      rlZdLabelRenameTimer = null;
      try { rlZdRenameProjectUpdatesLabels(document.body); } catch (_) {}
    }, 180);
  }

  try {
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList" && m.addedNodes && m.addedNodes.length) {
          rlZdScheduleLabelRename();
          return;
        }
        if (m.type === "characterData") {
          const v = m.target && m.target.nodeValue;
          if (v && /Project updates/i.test(v)) {
            rlZdScheduleLabelRename();
            return;
          }
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  } catch (_) {}

  function rlZdRestoreNativeContent() {
    for (const el of rlZdHiddenNative) {
      try {
        if (el && el.isConnected) el.style.removeProperty("display");
        if (el) el.removeAttribute("data-rl-zd-native-hidden");
      } catch (_) {}
    }
    rlZdHiddenNative = [];
  }

  function rlZdTeardownPanel() {
    rlZdPanelGen++;
    rlZdRestoreNativeContent();
    try { document.body.classList.remove("rlZdCasesActive"); } catch (_) {}
    if (rlZdPanelEl && rlZdPanelEl.parentNode) {
      try { rlZdPanelEl.parentNode.removeChild(rlZdPanelEl); } catch (_) {}
    }
    rlZdPanelEl = null;
    rlZdPanelProjectId = "";
    try {
      document.querySelectorAll(".rlZdTaskCard.rlZdCardFullscreen").forEach((c) => {
        c.classList.remove("rlZdCardFullscreen");
        try { c.remove(); } catch (_) {}
      });
      document.body.classList.remove("rlZdFullscreenOpen");
    } catch (_) {}
  }

  function rlZdFindContentPane() {
    const pageEl = document.getElementById("page");
    if (!pageEl) return null;
    // Never use #page_header — that is the project top bar (account + title).
    return (
      pageEl.querySelector(':scope > [class*="content__Content-"]') ||
      Array.from(pageEl.children).find((c) => c && c.id !== "page_header" && c.id !== "rlZendeskCasesPanel") ||
      null
    );
  }

  function rlZdCollectNativeStatusTargets() {
    // Prefer CSS (body.rlZdCasesActive). Keep this for one-shot mount only.
    const content = rlZdFindContentPane();
    if (!content) return [];
    const hideTargets = [];
    for (const c of Array.from(content.children)) {
      if (!c || c.id === "rlZendeskCasesPanel") continue;
      hideTargets.push(c);
    }
    return hideTargets;
  }

  function rlZdHideNativeStatusContent() {
    // CSS class does the hide without mutating remounted nodes every tick.
    try { document.body.classList.add("rlZdCasesActive"); } catch (_) {}
  }

  function rlZdFindMountContext(_navRow) {
    const content = rlZdFindContentPane();
    if (content) {
      return {
        mountParent: content,
        hideTargets: rlZdCollectNativeStatusTargets(),
        afterEl: null,
      };
    }
    return null;
  }

  function rlZdBindTabClick(cell) {
    if (!cell || cell.getAttribute("data-rl-zd-click") === "1") return;
    cell.setAttribute("data-rl-zd-click", "1");
    const kick = () => {
      [0, 30, 80, 160, 320, 600].forEach((d) => {
        setTimeout(() => { try { rlZdEnsureTabAndPanel(); } catch (_) {} }, d);
      });
    };
    cell.addEventListener("click", kick, true);
    const a = cell.querySelector("a");
    if (a) a.addEventListener("click", kick, true);
  }

  let rlZdEnsureLock = false;
  let rlZdEnsureQueued = false;

  function rlZdAbsTime(iso) {
    const ZD_TZ = "Europe/Oslo";
    const ZD_LOCALE = "nb-NO";
    const ts = Date.parse(String(iso ?? ""));
    if (!Number.isFinite(ts)) return "";
    const d = new Date(ts);
    const now = new Date();
    const zdDateKeyInTz = (x) =>
      x.toLocaleDateString(ZD_LOCALE, { timeZone: ZD_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
    const todayKey = zdDateKeyInTz(now);
    const dayKey = zdDateKeyInTz(d);
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const yesterdayKey = zdDateKeyInTz(yesterday);
    const sameYear =
      d.toLocaleDateString(ZD_LOCALE, { timeZone: ZD_TZ, year: "numeric" }) ===
      now.toLocaleDateString(ZD_LOCALE, { timeZone: ZD_TZ, year: "numeric" });
    const datePart = sameYear
      ? d.toLocaleDateString(ZD_LOCALE, { timeZone: ZD_TZ, day: "2-digit", month: "2-digit" })
      : d.toLocaleDateString(ZD_LOCALE, { timeZone: ZD_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
    const time = d.toLocaleTimeString(ZD_LOCALE, {
      timeZone: ZD_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
    });
    let context = "";
    if (dayKey === todayKey) context = " (i dag)";
    else if (dayKey === yesterdayKey) context = " (i går)";
    else if ((now.getTime() - ts) < 7 * 24 * 60 * 60 * 1000) {
      const weekday = d.toLocaleDateString(ZD_LOCALE, { timeZone: ZD_TZ, weekday: "short" });
      context = " (" + weekday + ")";
    }
    return datePart + " " + time + context;
  }

  function rlZdFullTime(iso) {
    const ts = Date.parse(String(iso ?? ""));
    if (!Number.isFinite(ts)) return "";
    try {
      return new Date(ts).toLocaleString("nb-NO", {
        timeZone: "Europe/Oslo",
        year: "numeric", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
      }) + " (Oslo)";
    } catch { return new Date(ts).toISOString(); }
  }

  function rlZdGuard(gen, projectId) {
    if (gen !== rlZdPanelGen) return false;
    if (!rlZdPanelEl || !rlZdPanelEl.isConnected) return false;
    if (rlZdPanelProjectId !== projectId) return false;
    const m = location.pathname.match(/^\/projects\/(\d+)/);
    if (!m || m[1] !== projectId) return false;
    return true;
  }

  async function rlZdFetchLastPublicReplyAt(ticketId) {
    try {
      const json = await zendeskApiRequest(
        "GET",
        "/tickets/" + encodeURIComponent(ticketId) + "/comments.json?sort_order=desc&per_page=20",
      );
      return rlZdPickLastPublicReplyAt(json?.comments);
    } catch (e) {
      console.debug("[rlZd] last-reply fetch failed for", ticketId, e?.message ?? e);
      return null;
    }
  }

  function rlZdBuildTicketCard(t, bodyEl, gen, projectId) {
    const card = document.createElement("div");
    card.className = "rlZdTaskCard";
    card.dataset.ticketId = String(t.id);

    const row = document.createElement("div");
    row.className = "rlZdTaskRow";
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.title = "Click to preview / reply";

    const statusEl = document.createElement("span");
    statusEl.className = "rlZdTaskStatus " + rlZdStatusClass(t.status);
    statusEl.textContent = String(t.status ?? "open");

    const middle = document.createElement("div");
    middle.className = "rlZdTaskMiddle";
    const subject = document.createElement("span");
    subject.className = "rlZdTaskSubject";
    subject.textContent = String(t.subject ?? "(no subject)");
    middle.appendChild(subject);
    const when = document.createElement("span");
    when.className = "rlZdTaskWhen";
    rlZdApplyWhen(when, t);
    middle.appendChild(when);

    const idLink = document.createElement("a");
    idLink.className = "rlZdTaskMetaLink";
    idLink.textContent = "#" + t.id + " ↗";
    idLink.href = ZENDESK_AGENT_TICKET_URL + encodeURIComponent(t.id);
    idLink.target = "_blank";
    idLink.rel = "noopener noreferrer";
    idLink.title = "Open ticket in Zendesk (new tab)";
    idLink.addEventListener("click", (e) => e.stopPropagation());

    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "rlZdExpandBtn";
    expandBtn.textContent = "⤢";
    expandBtn.title = "Expand to fullscreen (or right-click the card)";
    expandBtn.setAttribute("aria-label", "Expand ticket to fullscreen");

    row.appendChild(statusEl);
    row.appendChild(middle);
    row.appendChild(idLink);
    row.appendChild(expandBtn);

    const detail = document.createElement("div");
    detail.className = "rlZdTaskDetail";
    detail.style.display = "none";

    let detailLoaded = false;
    const toggle = async () => {
      if (!rlZdGuard(gen, projectId)) return;
      const willOpen = detail.style.display === "none";
      detail.style.display = willOpen ? "" : "none";
      card.classList.toggle("expanded", willOpen);
      if (willOpen && !detailLoaded) {
        detailLoaded = true;
        await rlZdLoadTicketDetail(t.id, detail, t.status, gen, projectId);
      }
    };
    row.addEventListener("click", (e) => {
      if (e.target?.closest?.(".rlZdExpandBtn")) return;
      toggle();
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });

    let isFullscreen = false;
    let portalOrigin = null;
    const exitOnEsc = (ev) => {
      if (ev.key === "Escape" && isFullscreen) {
        ev.preventDefault();
        toggleFullscreen();
      }
    };
    const exitOnMouseBack = (ev) => {
      if (!isFullscreen) return;
      if (ev.button === 3) {
        ev.preventDefault();
        ev.stopPropagation();
        toggleFullscreen();
      }
    };
    const exitOnPopstate = () => {
      if (isFullscreen) {
        isFullscreen = false;
        card.classList.remove("rlZdCardFullscreen", "rlZdFsDark");
        document.body.classList.remove("rlZdFullscreenOpen");
        expandBtn.textContent = "⤢";
        expandBtn.title = "Expand to fullscreen (or right-click the card)";
        if (portalOrigin && portalOrigin.parent) {
          try { portalOrigin.parent.insertBefore(card, portalOrigin.nextSibling); }
          catch (_) { try { card.remove(); } catch (_) {} }
        }
        portalOrigin = null;
        document.removeEventListener("keydown", exitOnEsc);
        document.removeEventListener("mousedown", exitOnMouseBack, true);
        document.removeEventListener("auxclick", exitOnMouseBack, true);
        card.removeEventListener("click", exitOnBackdropClick);
        window.removeEventListener("popstate", exitOnPopstate);
      }
    };
    const exitOnBackdropClick = (ev) => {
      if (!isFullscreen) return;
      if (ev.target === card) {
        ev.preventDefault();
        toggleFullscreen();
      }
    };
    const scrollConvoToBottom = () => {
      const convo = detail.querySelector(".rlZdConvo");
      if (!convo) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { convo.scrollTop = convo.scrollHeight; });
      });
    };
    const toggleFullscreen = () => {
      isFullscreen = !isFullscreen;
      document.body.classList.toggle("rlZdFullscreenOpen", isFullscreen);
      expandBtn.textContent = isFullscreen ? "⤡" : "⤢";
      expandBtn.title = isFullscreen ? "Exit fullscreen (or press Esc)" : "Expand to fullscreen (or right-click the card)";
      if (isFullscreen) {
        portalOrigin = { parent: card.parentNode, nextSibling: card.nextSibling };
        document.body.appendChild(card);
        card.classList.add("rlZdCardFullscreen");
        if (rlZdPanelEl && rlZdPanelEl.classList.contains("rlPopoverOnDark")) {
          card.classList.add("rlZdFsDark");
        }
        let pendingLoad = null;
        if (!detailLoaded || detail.style.display === "none") {
          detail.style.display = "";
          card.classList.add("expanded");
          if (!detailLoaded) {
            detailLoaded = true;
            pendingLoad = rlZdLoadTicketDetail(t.id, detail, t.status, gen, projectId);
          }
        }
        scrollConvoToBottom();
        if (pendingLoad && typeof pendingLoad.then === "function") {
          pendingLoad.then(scrollConvoToBottom, scrollConvoToBottom)
            .finally(() => setTimeout(scrollConvoToBottom, 250));
        } else {
          setTimeout(scrollConvoToBottom, 250);
        }
        document.addEventListener("keydown", exitOnEsc);
        document.addEventListener("mousedown", exitOnMouseBack, true);
        document.addEventListener("auxclick", exitOnMouseBack, true);
        card.addEventListener("click", exitOnBackdropClick);
        try { history.pushState({ rlZdFullscreen: true }, ""); } catch (_) {}
        window.addEventListener("popstate", exitOnPopstate);
      } else {
        card.classList.remove("rlZdCardFullscreen", "rlZdFsDark");
        if (portalOrigin && portalOrigin.parent) {
          try { portalOrigin.parent.insertBefore(card, portalOrigin.nextSibling); }
          catch (_) { try { card.remove(); } catch (_) {} }
        }
        portalOrigin = null;
        document.removeEventListener("keydown", exitOnEsc);
        document.removeEventListener("mousedown", exitOnMouseBack, true);
        document.removeEventListener("auxclick", exitOnMouseBack, true);
        card.removeEventListener("click", exitOnBackdropClick);
        window.removeEventListener("popstate", exitOnPopstate);
        try { if (history.state?.rlZdFullscreen) history.back(); } catch (_) {}
      }
    };
    expandBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });
    card.addEventListener("contextmenu", (e) => {
      const tgt = e.target;
      if (tgt?.closest?.("textarea, a, button, input, select, label")) return;
      e.preventDefault();
      toggleFullscreen();
    });

    card.appendChild(row);
    card.appendChild(detail);
    return card;
  }

  async function rlZdLoadTicketDetail(ticketId, container, ticketStatus, gen, projectId) {
    if (!rlZdGuard(gen, projectId)) return;
    container.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "rlZdLoading";
    loading.textContent = "Loading conversation…";
    container.appendChild(loading);

    let payload;
    try {
      payload = await zendeskApiRequest(
        "GET",
        "/tickets/" + encodeURIComponent(ticketId) + "/comments.json?include=users&sort_order=asc",
      );
    } catch (e) {
      if (!rlZdGuard(gen, projectId)) return;
      container.innerHTML = "";
      const err = document.createElement("div");
      err.className = "rlZdError";
      err.textContent = String(e?.message ?? e ?? "Failed to load conversation.");
      container.appendChild(err);
      return;
    }
    if (!rlZdGuard(gen, projectId)) return;

    const comments = Array.isArray(payload?.comments) ? payload.comments : [];
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const userById = {};
    for (const u of users) userById[u.id] = u;

    container.innerHTML = "";

    const replyHintTop = document.createElement("div");
    replyHintTop.className = "rlZdInlineReplyHint";
    replyHintTop.textContent = "Right-click to open fullscreen — read full thread & reply";
    replyHintTop.title = "Right-click anywhere on this card to enter fullscreen mode where you can read every comment and post a reply.";
    container.appendChild(replyHintTop);

    const SHOW_RECENT_COUNT = 3;

    const renderCommentBodyPlain = (text) => {
      const frag = document.createDocumentFragment();
      const src = String(text ?? "");
      const re = /!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g;
      let lastIdx = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        if (m.index > lastIdx) {
          frag.appendChild(document.createTextNode(src.slice(lastIdx, m.index)));
        }
        const img = document.createElement("img");
        img.className = "rlZdMsgInlineImg";
        img.src = m[2];
        img.alt = m[1] || "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        frag.appendChild(img);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < src.length) {
        frag.appendChild(document.createTextNode(src.slice(lastIdx)));
      }
      return frag;
    };

    const renderAttachments = (attachments) => {
      if (!Array.isArray(attachments) || attachments.length === 0) return null;
      const row = document.createElement("div");
      row.className = "rlZdMsgAttachments";
      for (const a of attachments) {
        const url = String(a?.content_url ?? "").trim();
        if (!url) continue;
        const mime = String(a?.content_type ?? "").toLowerCase();
        const fname = String(a?.file_name ?? "attachment");
        const isImage = mime.startsWith("image/");
        if (isImage) {
          const link = document.createElement("a");
          link.href = toHttpUrl(url) || "#";
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.className = "rlZdMsgImgThumb";
          link.title = fname + (a?.size ? " — " + rlZdFormatBytes(a.size) : "");
          const thumbUrl =
            (Array.isArray(a?.thumbnails) && a.thumbnails[0]?.content_url) || url;
          const img = document.createElement("img");
          img.src = thumbUrl;
          img.alt = fname;
          img.loading = "lazy";
          img.referrerPolicy = "no-referrer";
          link.appendChild(img);
          row.appendChild(link);
        } else {
          const link = document.createElement("a");
          link.href = toHttpUrl(url) || "#";
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.className = "rlZdMsgFile";
          link.title = fname;
          const icon = document.createElement("span");
          icon.textContent = "📎";
          icon.setAttribute("aria-hidden", "true");
          const name = document.createElement("span");
          name.className = "rlZdMsgFileName";
          name.textContent = fname;
          link.appendChild(icon);
          link.appendChild(name);
          if (a?.size) {
            const sz = document.createElement("span");
            sz.className = "rlZdMsgFileSize";
            sz.textContent = rlZdFormatBytes(a.size);
            link.appendChild(sz);
          }
          row.appendChild(link);
        }
      }
      return row.childNodes.length ? row : null;
    };

    const renderComment = (c) => {
      const author = userById[c?.author_id];
      const authorName = (author?.name || ("User #" + (c?.author_id ?? "?"))).trim();
      const isInternal = c?.public === false;
      const msg = document.createElement("div");
      msg.className = "rlZdMsg" + (isInternal ? " rlZdMsgInternal" : "");
      const head = document.createElement("div");
      head.className = "rlZdMsgHead";
      const a = document.createElement("span");
      a.className = "rlZdMsgAuthor";
      a.textContent = authorName;
      head.appendChild(a);
      if (c?.created_at) {
        const w = document.createElement("span");
        w.className = "rlZdMsgWhen";
        w.textContent = rlZdAbsTime(c.created_at);
        w.title = rlZdFullTime(c.created_at);
        head.appendChild(w);
      }
      if (isInternal) {
        const tag = document.createElement("span");
        tag.className = "rlZdMsgInternalTag";
        tag.textContent = "Internal note";
        head.appendChild(tag);
      }
      const body = document.createElement("div");
      body.className = "rlZdMsgBody";
      const htmlBody = String(c?.html_body ?? "").trim();
      if (htmlBody) {
        body.innerHTML = rlZdSanitizeZendeskHtml(htmlBody);
        for (const img of body.querySelectorAll("img")) {
          const hide = () => { img.style.display = "none"; };
          img.addEventListener("error", hide, { once: true });
          if (img.complete && img.naturalWidth === 0) hide();
        }
      } else {
        body.appendChild(renderCommentBodyPlain(c?.body));
      }
      msg.appendChild(head);
      msg.appendChild(body);
      const attRow = renderAttachments(c?.attachments);
      if (attRow) msg.appendChild(attRow);
      return msg;
    };

    const convo = document.createElement("div");
    convo.className = "rlZdConvo";
    if (comments.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rlZdEmpty";
      empty.textContent = "No comments on this ticket yet.";
      convo.appendChild(empty);
    } else if (comments.length <= SHOW_RECENT_COUNT) {
      for (const c of comments) convo.appendChild(renderComment(c));
    } else {
      const earlierCount = comments.length - SHOW_RECENT_COUNT;
      const recent = comments.slice(-SHOW_RECENT_COUNT);
      const earlier = comments.slice(0, earlierCount);
      const showBtn = document.createElement("button");
      showBtn.type = "button";
      showBtn.className = "rlZdConvoShowEarlier";
      showBtn.textContent = "Show " + earlierCount + " earlier " + (earlierCount === 1 ? "reply" : "replies") + " ↑";
      showBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showBtn.remove();
        const frag = document.createDocumentFragment();
        for (const c of earlier) frag.appendChild(renderComment(c));
        convo.insertBefore(frag, convo.firstChild);
      });
      convo.appendChild(showBtn);
      for (const c of recent) convo.appendChild(renderComment(c));
    }
    requestAnimationFrame(() => { convo.scrollTop = convo.scrollHeight; });
    container.appendChild(convo);

    const isTicketClosed = String(ticketStatus ?? "").toLowerCase() === "closed";
    if (isTicketClosed) {
      const closedNotice = document.createElement("div");
      closedNotice.className = "rlZdComposeClosed";
      closedNotice.textContent =
        "This ticket is closed and cannot receive new replies. Re-open it in Zendesk to reply.";
      container.appendChild(closedNotice);
      return;
    }

    const compose = document.createElement("div");
    compose.className = "rlZdCompose";

    const composeHd = document.createElement("div");
    composeHd.className = "rlZdComposeHd";
    composeHd.textContent = "Reply";
    compose.appendChild(composeHd);

    const toolbar = document.createElement("div");
    toolbar.className = "rlZdComposeToolbar";

    const replyKind = document.createElement("div");
    replyKind.className = "rlZdReplyKind";
    replyKind.dataset.active = "public";
    replyKind.setAttribute("role", "tablist");

    const thumb = document.createElement("div");
    thumb.className = "rlZdReplyKindThumb";
    thumb.setAttribute("aria-hidden", "true");
    replyKind.appendChild(thumb);

    const btnPublic = document.createElement("button");
    btnPublic.type = "button";
    btnPublic.className = "rlZdReplyKindBtn public";
    btnPublic.setAttribute("role", "tab");
    btnPublic.setAttribute("aria-selected", "true");
    btnPublic.title = "Customer-visible reply";
    btnPublic.textContent = "Public reply";

    const btnInternal = document.createElement("button");
    btnInternal.type = "button";
    btnInternal.className = "rlZdReplyKindBtn internal";
    btnInternal.setAttribute("role", "tab");
    btnInternal.setAttribute("aria-selected", "false");
    btnInternal.title = "Agents only — customer won't see this";
    btnInternal.textContent = "Internal note";

    const publicCheck = { checked: true };
    let updateSubmitLabel = () => {};
    const setKind = (isPublic) => {
      publicCheck.checked = isPublic;
      replyKind.dataset.active = isPublic ? "public" : "internal";
      btnPublic.setAttribute("aria-selected", isPublic ? "true" : "false");
      btnInternal.setAttribute("aria-selected", isPublic ? "false" : "true");
      updateSubmitLabel();
    };
    btnPublic.addEventListener("click", () => setKind(true));
    btnInternal.addEventListener("click", () => setKind(false));
    replyKind.appendChild(btnPublic);
    replyKind.appendChild(btnInternal);
    toolbar.appendChild(replyKind);

    const ta = document.createElement("textarea");
    ta.className = "rlZdComposeTextarea";
    ta.placeholder = "Type your reply…";

    const submitRow = document.createElement("div");
    submitRow.className = "rlZdComposeRow";
    const statusLine = document.createElement("span");
    statusLine.className = "rlZdComposeStatus";
    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "rlZdComposeBtn";
    updateSubmitLabel = () => {
      submitBtn.textContent = publicCheck.checked ? "Send public reply" : "Add internal note";
    };
    updateSubmitLabel();

    const doSubmit = async () => {
      const body = ta.value.trim();
      if (!body) { statusLine.textContent = "Reply cannot be empty."; statusLine.classList.add("error"); return; }
      submitBtn.disabled = true;
      ta.disabled = true;
      statusLine.classList.remove("error");
      statusLine.textContent = "Sending…";
      try {
        await zendeskPostTicketReply(ticketId, body, publicCheck.checked);
        ta.value = "";
        statusLine.textContent = "Sent.";
        await rlZdLoadTicketDetail(ticketId, container, ticketStatus, gen, projectId);
      } catch (e) {
        statusLine.textContent = "Failed: " + String(e?.message ?? e);
        statusLine.classList.add("error");
        submitBtn.disabled = false;
        ta.disabled = false;
      }
    };
    submitBtn.addEventListener("click", doSubmit);
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        doSubmit();
      }
    });

    submitRow.appendChild(statusLine);
    submitRow.appendChild(submitBtn);
    compose.appendChild(toolbar);
    compose.appendChild(ta);
    compose.appendChild(submitRow);
    container.appendChild(compose);
  }

  // ── Speed (v1.14.20) ──
  // The three searches run in parallel; the list is drawn as soon as they
  // return (stamped "Updated …" from the search row); the per-ticket
  // "Last reply …" lookups then run in the background, update each card in
  // place and reorder the list. A ticket's last public reply is remembered in
  // GM storage keyed by its updated_at, so unchanged tickets need no comments
  // request on later visits, and the last list per plant is kept for the
  // session so re-opening the tab paints instantly before refreshing.
  const RL_ZD_GM_REPLY_CACHE = "rlZdReplyAtCache";
  const RL_ZD_REPLY_CACHE_MAX = 600;
  const rlZdTicketsSessionCache = new Map(); // plantId -> { at, tickets }
  function rlZdReadReplyCache() {
    try {
      const j = JSON.parse(GM_getValue(RL_ZD_GM_REPLY_CACHE, "") || "{}");
      return j && typeof j === "object" && !Array.isArray(j) ? j : {};
    } catch (_) { return {}; }
  }
  function rlZdWriteReplyCache(map) {
    try {
      const keys = Object.keys(map);
      if (keys.length > RL_ZD_REPLY_CACHE_MAX) {
        keys.sort((a, b) => (Number(map[a]?.t) || 0) - (Number(map[b]?.t) || 0));
        for (const k of keys.slice(0, keys.length - RL_ZD_REPLY_CACHE_MAX)) delete map[k];
      }
      GM_setValue(RL_ZD_GM_REPLY_CACHE, JSON.stringify(map));
    } catch (_) {}
  }
  function rlZdStamp(t) {
    return String(t?.lastReplyAt ?? t?.updated_at ?? t?.created_at ?? "").trim();
  }
  function rlZdSortTickets(tickets) {
    return tickets.slice().sort((a, b) => (Date.parse(rlZdStamp(b)) || 0) - (Date.parse(rlZdStamp(a)) || 0));
  }
  function rlZdApplyWhen(el, t) {
    if (!el) return;
    const stampIso = rlZdStamp(t);
    if (!stampIso) { el.textContent = ""; el.title = ""; return; }
    const usingReply = !!t?.lastReplyAt;
    const abs = rlZdAbsTime(stampIso);
    const rel = rlZdFormatRelativeTimeShort(stampIso);
    el.textContent = (usingReply ? "Last reply " : "Updated ") + abs + (rel ? " · " + rel : "");
    el.title = (usingReply ? "Last public reply: " : "Last updated: ") + rlZdFullTime(stampIso);
  }
  function rlZdRenderTicketList(bodyEl, tickets, gen, projectId) {
    bodyEl.innerHTML = "";
    const list = document.createElement("div");
    list.className = "rlZdTaskList";
    const cards = new Map();
    for (const t of rlZdSortTickets(tickets)) {
      const card = rlZdBuildTicketCard(t, bodyEl, gen, projectId);
      cards.set(String(t.id), card);
      list.appendChild(card);
    }
    bodyEl.appendChild(list);
    return { list, cards };
  }

  async function rlZdLoadTickets(bodyEl, plantId, plantName, gen, projectId) {
    if (!rlZdGuard(gen, projectId)) return;
    const cached = rlZdTicketsSessionCache.get(String(plantId));
    if (cached && cached.tickets.length) {
      rlZdRenderTicketList(bodyEl, cached.tickets, gen, projectId);
    } else {
      bodyEl.innerHTML = "";
      const loading = document.createElement("div");
      loading.className = "rlZdLoading";
      loading.textContent = "Loading Zendesk cases…";
      bodyEl.appendChild(loading);
    }

    try {
      const plantFieldId = await rlZdGetPlantFieldId();
      if (!rlZdGuard(gen, projectId)) return;
      const queries = rlZdBuildSearchQueries(plantId, plantName, plantFieldId);
      const trustedIds = new Set();
      const resultLists = await Promise.all(queries.map(async ({ query, trusted }) => {
        const params = new URLSearchParams({ query, sort_by: "updated_at", sort_order: "desc", per_page: "100" });
        try {
          const json = await zendeskApiRequest("GET", "/search.json?" + params.toString());
          const results = Array.isArray(json?.results) ? json.results : [];
          if (trusted) for (const r of results) { if (r?.id != null) trustedIds.add(r.id); }
          return results;
        } catch (e) {
          console.debug("[rlZd] search failed:", query, e?.message ?? e);
          return [];
        }
      }));
      if (!rlZdGuard(gen, projectId)) return;
      const merged = rlZdMergeSearchResults(resultLists);
      const tickets = merged.filter((t) => trustedIds.has(t.id) || rlZdTicketMatchesPlant(t, plantId, plantName, plantFieldId));
      if (merged.length !== tickets.length) {
        console.debug("[rlZd] dropped " + (merged.length - tickets.length) + " search hits that only mention " + plantId + " in passing");
      }
      if (tickets.length === 0) {
        rlZdTicketsSessionCache.set(String(plantId), { at: Date.now(), tickets: [] });
        bodyEl.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "rlZdEmpty";
        empty.textContent = "No Zendesk cases found for this project.";
        bodyEl.appendChild(empty);
        return;
      }

      // Stamp from the reply cache when the ticket has not changed since; the
      // rest show "Updated …" until their comments arrive.
      const replyCache = rlZdReadReplyCache();
      const missing = [];
      for (const t of tickets) {
        const c = replyCache[String(t.id)];
        if (c && c.u === t.updated_at) t.lastReplyAt = c.r || t.updated_at || null;
        else { t.lastReplyAt = null; missing.push(t); }
      }
      const { list, cards } = rlZdRenderTicketList(bodyEl, tickets, gen, projectId);
      rlZdTicketsSessionCache.set(String(plantId), { at: Date.now(), tickets });
      if (!missing.length) return;

      await rlZdMapWithConcurrency(missing, 10, async (t) => {
        const replyAt = await rlZdFetchLastPublicReplyAt(t.id);
        if (!rlZdGuard(gen, projectId)) return;
        t.lastReplyAt = replyAt || t.updated_at || t.created_at || null;
        replyCache[String(t.id)] = { u: t.updated_at, r: replyAt || null, t: Date.now() };
        const card = cards.get(String(t.id));
        if (card) rlZdApplyWhen(card.querySelector(".rlZdTaskWhen"), t);
      });
      if (!rlZdGuard(gen, projectId)) return;
      rlZdWriteReplyCache(replyCache);
      // Reorder in place — the nodes move, so an expanded card stays expanded.
      for (const t of rlZdSortTickets(tickets)) {
        const card = cards.get(String(t.id));
        if (card && card.parentElement === list) list.appendChild(card);
      }
    } catch (e) {
      if (!rlZdGuard(gen, projectId)) return;
      bodyEl.innerHTML = "";
      const err = document.createElement("div");
      err.className = "rlZdError";
      err.textContent = String(e?.message ?? e ?? "Failed to load Zendesk cases.");
      bodyEl.appendChild(err);
    }
  }

  // ── Floating mode: drag by the header, resize from the corner, remembered. ──
  const RL_ZD_GM_FLOAT = "rlZdFloat";
  const RL_ZD_GM_FLOAT_GEOM = "rlZdFloatGeom";
  function rlZdReadFloatGeom() {
    try {
      const j = JSON.parse(GM_getValue(RL_ZD_GM_FLOAT_GEOM, "") || "null");
      if (j && Number.isFinite(j.left) && Number.isFinite(j.top) && Number.isFinite(j.width) && Number.isFinite(j.height)) return j;
    } catch (_) {}
    return null;
  }
  function rlZdSaveFloatGeom(panel) {
    try {
      const r = panel.getBoundingClientRect();
      GM_setValue(RL_ZD_GM_FLOAT_GEOM, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }));
    } catch (_) {}
  }
  function rlZdDefaultFloatGeom() {
    const width = Math.min(960, Math.round(window.innerWidth * 0.92));
    const height = Math.round(window.innerHeight * 0.72);
    return { left: Math.max(8, Math.round((window.innerWidth - width) / 2)), top: 80, width, height };
  }
  function rlZdClampGeom(g) {
    const width = Math.max(420, Math.min(g.width, window.innerWidth - 16));
    const height = Math.max(280, Math.min(g.height, window.innerHeight - 16));
    const left = Math.max(0, Math.min(g.left, window.innerWidth - width));
    const top = Math.max(0, Math.min(g.top, window.innerHeight - 60));
    return { left, top, width, height };
  }
  function rlZdApplyFloating(panel, head, floating) {
    panel.classList.toggle("rlZdFloating", !!floating);
    const btn = head.querySelector(".rlZdFloatBtn");
    if (btn) { btn.textContent = floating ? "Dock" : "Float"; btn.title = floating ? "Put the panel back in the page" : "Float the panel (drag by the header, resize from the corner)"; }
    if (!floating) { panel.style.left = panel.style.top = panel.style.width = panel.style.height = ""; return; }
    const g = rlZdClampGeom(rlZdReadFloatGeom() || rlZdDefaultFloatGeom());
    panel.style.left = g.left + "px";
    panel.style.top = g.top + "px";
    panel.style.width = g.width + "px";
    panel.style.height = g.height + "px";
  }
  function rlZdWireFloating(panel, head) {
    let floating = GM_getValue(RL_ZD_GM_FLOAT, true) !== false;
    rlZdApplyFloating(panel, head, floating);
    const btn = head.querySelector(".rlZdFloatBtn");
    if (btn) btn.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      floating = !floating;
      GM_setValue(RL_ZD_GM_FLOAT, floating);
      rlZdApplyFloating(panel, head, floating);
    });
    // Drag by the header (buttons excluded).
    let drag = null;
    head.addEventListener("mousedown", (e) => {
      if (!panel.classList.contains("rlZdFloating")) return;
      if (e.button !== 0 || (e.target && e.target.closest && e.target.closest("button, a"))) return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      document.body.classList.add("rlZdDragging");
      e.preventDefault();
    });
    const onMove = (e) => {
      if (!drag) return;
      const r = panel.getBoundingClientRect();
      const g = rlZdClampGeom({ left: e.clientX - drag.dx, top: e.clientY - drag.dy, width: r.width, height: r.height });
      panel.style.left = g.left + "px";
      panel.style.top = g.top + "px";
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      document.body.classList.remove("rlZdDragging");
      rlZdSaveFloatGeom(panel);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    // Resize from any edge or corner (v1.14.16): the grab zones are the
    // .rlZdResize strips; dragging the right edge grows the panel to the right,
    // the left edge moves the left side, and so on. Clamped to the viewport.
    for (const name of ["top", "right", "bottom", "left", "top-left", "top-right", "bottom-left", "bottom-right"]) {
      const h = document.createElement("div");
      h.className = "rlZdResize";
      h.dataset.resize = name;
      panel.appendChild(h);
    }
    let rs = null;
    panel.addEventListener("mousedown", (e) => {
      const handle = e.target && e.target.closest && e.target.closest(".rlZdResize");
      if (!handle || e.button !== 0 || !panel.classList.contains("rlZdFloating")) return;
      const r = panel.getBoundingClientRect();
      rs = { edge: handle.dataset.resize, x: e.clientX, y: e.clientY, left: r.left, top: r.top, width: r.width, height: r.height };
      document.body.classList.add("rlZdResizing");
      document.body.style.cursor = getComputedStyle(handle).cursor;
      e.preventDefault();
      e.stopPropagation();
    });
    const onResizeMove = (e) => {
      if (!rs) return;
      const dx = e.clientX - rs.x, dy = e.clientY - rs.y;
      let { left, top, width, height } = rs;
      const minW = 420, minH = 280;
      if (rs.edge.includes("right")) width = Math.max(minW, rs.width + dx);
      if (rs.edge.includes("left")) { width = Math.max(minW, rs.width - dx); left = rs.left + (rs.width - width); }
      if (rs.edge.includes("bottom")) height = Math.max(minH, rs.height + dy);
      if (rs.edge.includes("top")) { height = Math.max(minH, rs.height - dy); top = rs.top + (rs.height - height); }
      const g = rlZdClampGeom({ left, top, width, height });
      panel.style.left = g.left + "px";
      panel.style.top = g.top + "px";
      panel.style.width = g.width + "px";
      panel.style.height = g.height + "px";
    };
    const onResizeUp = () => {
      if (!rs) return;
      rs = null;
      document.body.classList.remove("rlZdResizing");
      document.body.style.cursor = "";
      rlZdSaveFloatGeom(panel);
    };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeUp);
    window.addEventListener("blur", onResizeUp);
  }

  function rlZdMountPanel(mountCtx, projectId) {
    if (!mountCtx || !mountCtx.mountParent) return false;
    rlZdTeardownPanel();
    const gen = ++rlZdPanelGen;
    rlZdPanelProjectId = projectId;

    const panel = document.createElement("div");
    panel.id = "rlZendeskCasesPanel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Zendesk cases");

    const head = document.createElement("div");
    head.className = "rlZdHead";
    const title = document.createElement("h2");
    title.className = "rlZdTitle";
    title.textContent = "Zendesk cases";
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "rlZdRefresh";
    refreshBtn.textContent = "Refresh";
    refreshBtn.title = "Refresh Zendesk cases";
    const floatBtn = document.createElement("button");
    floatBtn.type = "button";
    floatBtn.className = "rlZdRefresh rlZdFloatBtn";
    floatBtn.textContent = "Float";
    const actions = document.createElement("div");
    actions.className = "rlZdHeadActions";
    actions.appendChild(floatBtn);
    actions.appendChild(refreshBtn);
    head.appendChild(title);
    head.appendChild(actions);

    const body = document.createElement("div");
    body.className = "rlZdBody";

    panel.appendChild(head);
    panel.appendChild(body);

    const parent = mountCtx.mountParent;
    parent.appendChild(panel);
    rlZdPanelEl = panel;
    // Light shell like the home panels (v1.14.14); no dark-surface class.
    rlZdWireFloating(panel, head);
    // CSS body.rlZdCasesActive hides native siblings — no per-node display writes
    // on every ensure (that froze Rocketlane via MutationObserver).
    rlZdHideNativeStatusContent();

    const projectName = readProjectName() || "";
    const plantId = rlZdExtractPlantId(projectName);
    const plantName = rlZdExtractPlantName(projectName);

    if (!plantId) {
      body.innerHTML = "";
      const err = document.createElement("div");
      err.className = "rlZdError";
      err.textContent =
        'Need a leading plant number in the project name (e.g. "10112 - Store Name: …") to search Zendesk.';
      body.appendChild(err);
      return true;
    }

    const reload = () => { void rlZdLoadTickets(body, plantId, plantName, gen, projectId); };
    refreshBtn.addEventListener("click", (e) => {
      e.preventDefault();
      reload();
    });
    reload();
    return true;
  }

  function rlZdEnsureTabAndPanel() {
    // Serialize: concurrent route+click+ensure timers must not remount in a storm.
    if (rlZdEnsureLock) {
      rlZdEnsureQueued = true;
      return;
    }
    rlZdEnsureLock = true;
    try {
      rlZdEnsureTabAndPanelInner();
    } finally {
      rlZdEnsureLock = false;
      if (rlZdEnsureQueued) {
        rlZdEnsureQueued = false;
        setTimeout(() => { try { rlZdEnsureTabAndPanel(); } catch (_) {} }, 50);
      }
    }
  }

  function rlZdEnsureTabAndPanelInner() {
    if (!/^\/projects\/\d+/.test(location.pathname)) {
      rlZdTeardownPanel();
      return;
    }
    rlZdInjectStyles();
    const row = getNavRow();
    if (row) rlZdPatchUpdatesTab(row);
    try { rlZdRenameProjectUpdatesLabels(document.body); } catch (_) {}

    const m = location.pathname.match(/^\/projects\/(\d+)/);
    const projectId = m ? m[1] : "";
    const active = rlZdIsUpdatesRouteActive(row);

    if (!active) {
      if (rlZdPanelEl) rlZdTeardownPanel();
      else {
        try { document.body.classList.remove("rlZdCasesActive"); } catch (_) {}
        rlZdRestoreNativeContent();
      }
      return;
    }
    if (!projectId) return;

    const content = rlZdFindContentPane();
    const mountedOk =
      rlZdPanelEl &&
      rlZdPanelEl.isConnected &&
      rlZdPanelProjectId === projectId &&
      content &&
      content.contains(rlZdPanelEl);

    if (mountedOk) {
      rlZdHideNativeStatusContent();
      rlApplyPopoverSurface(rlZdPanelEl);
      return;
    }

    const mountCtx = rlZdFindMountContext(row || document.body);
    if (!mountCtx) return;
    rlZdMountPanel(mountCtx, projectId);
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

  // ── "Is this actually delivered?" ──
  // The Rocketlane checkbox alone is a claim, not proof: it gets ticked by hand
  // and it gets ticked early. The handover only really exists once support has a
  // ticket, so the verdict below reports both and calls out the mismatch.
  //
  // Matching is anchored on the macro's own subject convention plus its tag —
  // a bare plant-number search is far too loose (searching "3530" with the tag
  // returns an unrelated pc_change ticket named "Anlegg 3530"). The phrase and
  // tag do the narrowing; the plant id is then required as a standalone number
  // in the subject so "3214" can't be satisfied by "13214".
  const DTS_HANDOVER_SUBJECT = "Avblokkering og Overlevering";
  async function dtsFindHandoverTicket(plantId) {
    const pid = String(plantId ?? "").trim();
    if (!/^\d+$/.test(pid)) return null;
    const query = 'type:ticket tags:' + (ZENDESK_HANDOVER_TAGS[0] || "aktivering_basic") +
      ' subject:"' + DTS_HANDOVER_SUBJECT + '" ' + pid;
    const res = await zendeskApiRequest("GET", "/search.json?query=" + encodeURIComponent(query) + "&per_page=10");
    const list = Array.isArray(res?.results) ? res.results : [];
    const token = new RegExp("(?:^|\\D)" + pid + "(?!\\d)");
    // Newest first, so a re-delivered plant reports its current ticket.
    return list
      .filter((t) => token.test(String(t?.subject ?? "")))
      .sort((a, b) => (Date.parse(b?.created_at || 0) || 0) - (Date.parse(a?.created_at || 0) || 0))[0] || null;
  }

  const dtsVerdictCache = new Map(); // Rocketlane project id -> verdict
  const dtsVerdictInflight = new Map();
  async function computeDeliveryVerdict(ctx) {
    const out = {
      color: "action", label: "Delivery to service",
      taskId: "", taskDone: null, ticket: null, problems: [],
    };
    try {
      const task = await dtsFindHandoverTask(ctx.rlProjectId);
      if (task) {
        out.taskId = String(task.taskId ?? "");
        const f = dtsTaskStatusField(task);
        out.taskDone = f ? Number(f.fieldValue) === DTS_STATUS_COMPLETED : null;
      } else {
        out.problems.push("Ingen «Handover to service»-oppgave i dette prosjektet.");
      }
    } catch (e) {
      out.problems.push("Rocketlane: " + (e?.message ?? e));
    }
    if (!ctx.plantId) {
      out.problems.push("Fant ingen plant-ID i prosjektnavnet — kan ikke slå opp i Zendesk.");
    } else {
      try {
        out.ticket = await dtsFindHandoverTicket(ctx.plantId);
      } catch (e) {
        // Logged out of Zendesk is the common case and shouldn't read as "no
        // handover exists" — the verdict says "unknown" instead.
        out.ticketUnknown = true;
        out.problems.push("Zendesk: " + (e?.message ?? e));
      }
    }
    const done = out.taskDone === true;
    const tick = !!out.ticket;
    if (done && tick) {
      out.color = "green";
      out.label = "Delivery: ✓ Delivered";
    } else if (done && out.ticketUnknown) {
      out.color = "green";
      out.label = "Delivery: ✓ Delivered";
      out.problems.push("Zendesk-saken er ikke bekreftet.");
    } else if (done && !tick) {
      out.color = "yellow";
      out.label = "Delivery: fullført, ingen sak";
      out.problems.push("Oppgaven er merket Completed, men det finnes ingen Zendesk-sak med «" + DTS_HANDOVER_SUBJECT + "» for plant " + ctx.plantId + ".");
    } else if (!done && tick) {
      out.color = "yellow";
      out.label = "Delivery: sak #" + out.ticket.id + ", ikke fullført";
      out.problems.push("Zendesk-saken finnes, men «Handover to service» er ikke merket Completed.");
    }
    return out;
  }
  function computeDeliveryForProject(ctx) {
    const id = String(ctx.rlProjectId || "");
    if (dtsVerdictCache.has(id)) return Promise.resolve(dtsVerdictCache.get(id));
    if (dtsVerdictInflight.has(id)) return dtsVerdictInflight.get(id);
    const pr = computeDeliveryVerdict(ctx)
      .then((v) => { dtsVerdictCache.set(id, v); dtsVerdictInflight.delete(id); return v; })
      .catch((e) => { dtsVerdictInflight.delete(id); throw e; });
    dtsVerdictInflight.set(id, pr);
    return pr;
  }
  function applyDeliveryVerdictToChip(rlProjectId, verdict) {
    const btn = document.getElementById("dtsNavBtn");
    if (!btn || btn.dataset.rlProjectId !== String(rlProjectId)) return; // stale project
    btn.classList.remove("yn-green", "yn-yellow", "yn-red", "yn-gray", "yn-action");
    btn.classList.add("yn-" + (verdict?.color || "action"));
    const label = btn.querySelector(".ynNavBtnLabel");
    if (label) label.textContent = verdict?.label || "Delivery to service";
    const lines = [verdict?.label || "Delivery to service"];
    if (verdict?.ticket) lines.push("Zendesk: #" + verdict.ticket.id + " · " + verdict.ticket.status + " · " + String(verdict.ticket.subject || "").slice(0, 80));
    if (Array.isArray(verdict?.problems) && verdict.problems.length) {
      lines.push("");
      for (const p of verdict.problems) lines.push("• " + p);
    }
    lines.push("", "Klikk for å åpne veiviseren.");
    btn.title = lines.join("\n");
  }
  function refreshDeliveryChipForCurrentProject() {
    const btn = document.getElementById("dtsNavBtn");
    if (!btn) return;
    const ctx = getOneflowContext();
    if (!ctx.rlProjectId) return;
    if (btn.dataset.rlProjectId !== ctx.rlProjectId) {
      // New project — reset to the neutral action state before recomputing so a
      // stale "Delivered" never carries over from the previous one.
      btn.dataset.rlProjectId = ctx.rlProjectId;
      btn.classList.remove("yn-green", "yn-yellow", "yn-red", "yn-gray");
      btn.classList.add("yn-action");
      const label = btn.querySelector(".ynNavBtnLabel");
      if (label) label.textContent = "Delivery to service";
    }
    computeDeliveryForProject(ctx)
      .then((v) => applyDeliveryVerdictToChip(ctx.rlProjectId, v))
      .catch((e) => console.warn("[Delivery to service] verdict failed:", e?.message ?? e));
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
    // Same sources as Fetch URLs / PPT autoFetchProjectLinksOnce: IQC → Deal
    // Description → Delivery status. Curated links win; chip lookups only fill gaps.
    try {
      const links = await rlLoadProjectLinks(ctx.rlProjectId, { force: true });
      p.oneflowUrl = String(links.oneflowOrder || "").trim();
      p.oneflowSubscriptionUrl = String(links.oneflowSubscription || "").trim();
      p.youniumUrl = String(links.younium || "").trim();
      p.youniumSubscriptionUrl = String(links.youniumSubscription || "").trim();
      try {
        const bar = document.getElementById("rlProjectActionBar");
        if (bar && bar.dataset.rlProjectId === String(ctx.rlProjectId)) {
          rlPatchActionBar(bar, links, ctx);
        }
      } catch (_) {}
    } catch (e) {
      console.warn("[Delivery to service] link auto-fetch failed:", e?.message ?? e);
    }
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
    // Oneflow — signing verdict always; URLs only when still empty after auto-fetch.
    try {
      const v = await computeOneflowForProject(ctx.rlProjectId, ctx.plantId);
      p.oneflowSigned = v?.signed ?? null;
      if (!p.oneflowUrl) p.oneflowUrl = String(v?.documentUrl ?? "").trim();
      if (!p.oneflowSubscriptionUrl) p.oneflowSubscriptionUrl = String(v?.subDocumentUrl ?? "").trim();
    } catch (e) {
      console.warn("[Delivery to service] Oneflow lookup failed:", e?.message ?? e);
    }
    // Younium — fill gaps from the same plant verdict the chip uses.
    if (ctx.plantId) {
      try {
        const v = await computeForPlant(ctx.plantId, p.name);
        if (!p.youniumUrl) p.youniumUrl = String(v?.links?.saved ?? "").trim();
        if (!p.youniumSubscriptionUrl) {
          const subId = v?.subscriptionOrder?.id;
          if (subId) p.youniumSubscriptionUrl = ynOrderUrl(subId);
        }
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
        const on = a[step.key] === opt;
        b.className = "dtsChoice" + (on ? " dtsChoiceOn" : "");
        b.textContent = opt;
        b.setAttribute("aria-pressed", on ? "true" : "false");
        // Selecting an answer does NOT advance the step. Auto-advance made a
        // mis-click cost a Back press to see what you had just answered, and it
        // fought you on the questions where you want to change your mind after
        // reading the hint. Click to choose, then Next.
        b.addEventListener("click", () => {
          a[step.key] = opt;
          dtsSaveAnswers();
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
      // Flip the card to the green "Delivered" pill straight away instead of
      // waiting for Rocketlane to refetch and collapse the card itself.
      if (dtsProject?.rlProjectId) {
        dtsCompletedProjects.add(String(dtsProject.rlProjectId));
        dtsScheduleCardPass();
        // The cached verdict predates this write, and if a ticket was created
        // in the same run it predates that too — recompute rather than patch.
        dtsVerdictCache.delete(String(dtsProject.rlProjectId));
        try { refreshDeliveryChipForCurrentProject(); } catch (_) {}
      }
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
      // Drop the cached verdict before the tick: creating the ticket alone
      // changes it, and the tick is optional.
      if (p.rlProjectId) dtsVerdictCache.delete(String(p.rlProjectId));
      const tick = await dtsMaybeCompleteTask();
      try { refreshDeliveryChipForCurrentProject(); } catch (_) {}
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
    if (body) body.innerHTML = '<div style="padding:28px; text-align:center; color:var(--muted);">Henter lenker (IQC / Deal / Delivery) og prosjektdata fra Rocketlane, Oneflow og Younium…</div>';
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
    let style = document.getElementById("dtsStyles");
    if (style && style.dataset.rlDtsReady === "1.10.11") return;
    if (!style) {
      style = document.createElement("style");
      style.id = "dtsStyles";
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = `
      .dtsCardBtn {
        margin-right: auto; margin-left: 6px;
        display: inline-flex; align-items: center; gap: 4px;
        height: 24px; padding: 0 8px;
        font-family: inherit; font-size: 11.5px; font-weight: 600; line-height: 1;
        white-space: nowrap; cursor: pointer;
        border-radius: 6px; border: 1px solid #c7d2fe;
        background: #eef2ff; color: #3730a3;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
      }
      .dtsCardBtn:hover { background: #e0e7ff; border-color: #a5b4fc; color: #312e81; }
      .dtsCardBtn:active { transform: translateY(0.5px); }
      .dtsCardBtn:disabled { opacity: 0.6; cursor: default; }
      .dtsCardBtn.dtsDone { background: #dcfce7; border-color: #86efac; color: #166534; }
      .dtsCardBtn.dtsDone:hover { background: #bbf7d0; border-color: #4ade80; color: #14532d; }
      .dtsDoneRow { display: flex; padding: 0 12px 6px 38px; }
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
      /* Delivery wizard stays dark PPT shell — OS light scheme must not flip
         choice ink to slate (that is the black-on-dark hover/click bug). */
      #dlgDeliveryWizard.dlgYouniumStatus[open] {
        background: #0f1424 !important;
        color: rgba(255,255,255,0.94) !important;
      }
      /* Hardcoded ink — Rocketlane/OS button:hover|:active paint ButtonText (black)
         and beat var(--text)/var(--accent) on the dark #0f1424 dialog. */
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice,
      dialog#dlgDeliveryWizard button.dtsChoice {
        appearance: none; -webkit-appearance: none;
        min-width: 90px; padding: 10px 16px; border-radius: 10px;
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.045);
        color: rgba(255,255,255,0.94) !important;
        -webkit-text-fill-color: rgba(255,255,255,0.94) !important;
        forced-color-adjust: none;
      }
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice:hover,
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice:focus,
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice:focus-visible,
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice:active,
      dialog#dlgDeliveryWizard button.dtsChoice:hover,
      dialog#dlgDeliveryWizard button.dtsChoice:focus,
      dialog#dlgDeliveryWizard button.dtsChoice:focus-visible,
      dialog#dlgDeliveryWizard button.dtsChoice:active {
        background: rgba(255,255,255,0.09) !important;
        color: rgba(255,255,255,0.96) !important;
        -webkit-text-fill-color: rgba(255,255,255,0.96) !important;
        border-color: rgba(255,255,255,0.22) !important;
      }
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice.dtsChoiceOn,
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice.dtsChoiceOn:hover,
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice.dtsChoiceOn:focus,
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice.dtsChoiceOn:focus-visible,
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice.dtsChoiceOn:active,
      dialog#dlgDeliveryWizard button.dtsChoice.dtsChoiceOn,
      dialog#dlgDeliveryWizard button.dtsChoice.dtsChoiceOn:hover,
      dialog#dlgDeliveryWizard button.dtsChoice.dtsChoiceOn:focus,
      dialog#dlgDeliveryWizard button.dtsChoice.dtsChoiceOn:focus-visible,
      dialog#dlgDeliveryWizard button.dtsChoice.dtsChoiceOn:active {
        background: rgba(125,211,252,0.18) !important;
        color: #e0f2fe !important;
        -webkit-text-fill-color: #e0f2fe !important;
        border-color: rgba(125,211,252,0.45) !important;
        font-weight: 700;
      }
      #dlgDeliveryWizard.dlgYouniumStatus button.dtsChoice.dtsChoiceOn::before,
      dialog#dlgDeliveryWizard button.dtsChoice.dtsChoiceOn::before {
        content: "✓";
        font-weight: 700;
        color: #e0f2fe !important;
        -webkit-text-fill-color: #e0f2fe !important;
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
    style.dataset.rlDtsReady = "1.10.11";
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
  // Projects whose handover this session ticked complete. Rocketlane doesn't
  // know about our out-of-band API write until it refetches, so the card keeps
  // its full pre-completion layout for a while; without this the button would
  // sit there still saying "Delivery to service" right after you finished the
  // wizard. Cleared by a reload, by which point the card renders completed on
  // its own.
  const dtsCompletedProjects = new Set();

  // Rocketlane collapses a completed task card to a single 44px row — green
  // check, title, "…" menu — and drops the footer the action button anchors to.
  // So "done" can't just restyle the button in place; it needs its own anchor.
  function dtsCardIsCompleted(card) {
    return /CompletedCard|completed-task-card/i.test(String(card.className || ""));
  }
  function dtsBuildCardButton(done) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = done ? "dtsCardBtn dtsDone" : "dtsCardBtn";
    btn.title = done
      ? "Overleveringen er merket fullført — klikk for å åpne veiviseren igjen"
      : "Åpne overleveringsveiviseren for dette prosjektet";
    btn.innerHTML = done
      ? '<span aria-hidden="true">✓</span><span>Delivered</span>'
      : '<span aria-hidden="true">📋</span><span>Delivery to service</span>';
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
    return btn;
  }
  function dtsEnsureCardButtons() {
    const m = location.pathname.match(/^\/projects\/(\d+)/);
    if (!m) return;
    const tickedHere = dtsCompletedProjects.has(m[1]);
    const cards = document.querySelectorAll('[data-cy][class*="task-cardstyles__Card"]');
    for (const card of cards) {
      if (!dtsIsHandoverTaskName(card.getAttribute("data-cy"))) continue;
      const collapsed = dtsCardIsCompleted(card);
      const done = collapsed || tickedHere;
      const existing = card.querySelector(".dtsCardBtn");
      // A card that flipped state keeps the wrong control until it's replaced.
      if (existing && existing.classList.contains("dtsDone") !== done) {
        existing.closest(".dtsDoneRow")?.remove();
        existing.remove();
      } else if (existing) {
        continue;
      }
      dtsInjectStyles();
      if (collapsed) {
        // Compact layout: the title row has ~28px of slack next to the "…"
        // menu, so the badge goes on its own line under it rather than
        // squeezing the task name.
        const row = card.querySelector('[class*="CardContentContainer"]');
        const host = row?.parentElement;
        if (!host) continue;
        const line = document.createElement("div");
        line.className = "dtsDoneRow";
        line.appendChild(dtsBuildCardButton(true));
        host.appendChild(line);
      } else {
        const footer = card.querySelector('[class*="CardFooter"]');
        if (!footer) continue;
        const anchor = footer.querySelector(".assignee-picker");
        if (!anchor) continue;
        // margin-right:auto on this button makes the footer's space-between pack
        // it next to the assignee avatar and leave the responsible avatar right.
        anchor.insertAdjacentElement("afterend", dtsBuildCardButton(done));
      }
    }
  }

  // ── Entry point 2: the nav chip, for projects without the task ──
  function buildDeliveryNavButton() {
    const wrap = document.createElement("div");
    wrap.className = "ynNavBtnCell";
    const btn = document.createElement("button");
    btn.id = "dtsNavBtn";
    btn.type = "button";
    // yn-action, not yn-gray: this chip is a button, not a status verdict.
    btn.className = "ynNavBtn yn-action";
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

        const presentBtn = document.querySelector('[data-cy="present_phase.enter"], [data-cy="present_phase.exit"]');
        if (!presentBtn) {
            setTimeout(injectToggleButton, 500);
            return;
        }
        // Same Secondary flex row as Present — never nest inside fullscreen__Action
        // (that wrapper is display:block; height:32px and only fits the Present icon).
        const secondary = presentBtn.closest('[class*="action-bar__Secondary"]');
        let anchor = presentBtn;
        if (secondary) {
            while (anchor.parentElement && anchor.parentElement !== secondary) {
                anchor = anchor.parentElement;
            }
        }
        const container = secondary || presentBtn.closest('.fullscreen__Action-fhhebC') || presentBtn.parentElement;
        if (!container) {
            setTimeout(injectToggleButton, 500);
            return;
        }

        const btn = document.createElement('button');
        btn.id = TOGGLE_BTN_ID;
        btn.type = 'button';
        btn.className = presentBtn.className;
        btn.style.cssText = 'height:28px;width:28px;align-self:center;flex:0 0 auto;';
        btn.innerHTML = `<span class="flex items-center rl-left-icon"><svg focusable="false" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="16" height="16" viewBox="0 0 32 32" aria-hidden="true"><path d="M26,4h-4V2h-2v2h-8V2h-2v2H6C4.9,4,4,4.9,4,6v20c0,1.1,0.9,2,2,2h20c1.1,0,2-0.9,2-2V6C28,4.9,27.1,4,26,4z M26,26H6V12h20V26z M26,10H6V6h4v2h2V6h8v2h2V6h4V10z"/></svg></span>`;

        btn.addEventListener('click', () => {
            const wasHidden = isCalendarHidden();
            localStorage.setItem(LS_CALENDAR_HIDDEN, wasHidden ? '0' : '1');
            if (wasHidden) removeStyle(); else applyStyle();
            updateToggleButton();
        });

        if (secondary && anchor.parentElement === secondary) {
            if (anchor.nextSibling) secondary.insertBefore(btn, anchor.nextSibling);
            else secondary.appendChild(btn);
        } else if (presentBtn.nextSibling) {
            container.insertBefore(btn, presentBtn.nextSibling);
        } else {
            container.appendChild(btn);
        }
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
