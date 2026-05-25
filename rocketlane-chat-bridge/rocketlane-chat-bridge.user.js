// ==UserScript==
// @name         Rocketlane Chat Bridge
// @namespace    https://kiona.rocketlane.com/
// @version      1.9.4
// @description  Bridges Rocketlane + Zendesk + Oneflow + HubSpot APIs to the local Project Progress Tracker, bypassing CORS.
// @author       Thomas
// @homepageURL  https://github.com/Hapnes-dev/Project-Progress-Tracker
// @supportURL   https://github.com/Hapnes-dev/Project-Progress-Tracker/issues
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-chat-bridge/rocketlane-chat-bridge.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-chat-bridge/rocketlane-chat-bridge.user.js
// @match        https://kiona.rocketlane.com/*
// @match        https://iwmac.zendesk.com/*
// @match        https://app.oneflow.com/*
// @match        https://app.hubspot.com/*
// @match        https://app-eu1.hubspot.com/*
// @match        file:///*
// @match        https://hapnes-dev.github.io/Project-Progress-Tracker/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      kiona.api.rocketlane.com
// @connect      iwmac.zendesk.com
// @connect      app.oneflow.com
// @connect      app.hubspot.com
// @connect      app-eu1.hubspot.com
// @connect      s3.us-east-1.amazonaws.com
// @connect      s3.amazonaws.com
// @connect      amazonaws.com
// @connect      assets.rocketlane.com
// @connect      d1vtr0p8bkmfca.cloudfront.net
// @run-at       document-start
// ==/UserScript==

/* eslint-disable no-undef */
(function () {
  "use strict";

  const TENANT_API = "https://kiona.api.rocketlane.com/api/v1";
  // Zendesk lives at the subdomain root; the API is mounted at /api/v2
  // and authenticates via the user's session cookie (set when they're
  // logged into iwmac.zendesk.com in a normal browser tab). We don't
  // capture or store any token — GM_xmlhttpRequest automatically
  // includes cookies for the request URL's origin, so the same session
  // the user already has is reused for tracker calls.
  const ZENDESK_HOST = "https://iwmac.zendesk.com";
  const ZENDESK_API  = ZENDESK_HOST + "/api/v2";
  // Oneflow uses session cookies (HttpOnly) for auth and a NON-HttpOnly
  // `xsrf-token` cookie for CSRF on non-GET requests (Spring/Laravel
  // double-submit pattern). The userscript on app.oneflow.com pages
  // reads the cookie value into GM storage; the bridge attaches it as
  // X-XSRF-Token automatically on writes.
  const ONEFLOW_HOST = "https://app.oneflow.com";
  const ONEFLOW_API  = ONEFLOW_HOST + "/api";
  // HubSpot has two regional hublets — US (app.hubspot.com) and EU
  // (app-eu1.hubspot.com). The captured host below tracks which one the
  // user is logged into so the bridge calls the right region.
  // Every API call requires portalId in the query string + csrf header
  // from the `hubspotapi-csrf` cookie. CSRF + portal are captured on
  // hubspot pages and stored in GM storage.

  // ──────────────────────────────────────────────────────────────────────────
  // Side A — On Rocketlane: capture the api-key from localStorage.
  // ──────────────────────────────────────────────────────────────────────────
  if (location.hostname.endsWith("kiona.rocketlane.com")) {
    function captureNow() {
      try {
        const raw = window.localStorage.getItem("__api_key");
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return false;
        const uuid = parsed.find(
          (v) =>
            typeof v === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v),
        );
        // The userId is the first integer in the array (used when posting comments).
        const userId = parsed.find((v) => typeof v === "number" && v > 0 && Number.isInteger(v));
        if (uuid) {
          GM_setValue("rlApiKey", uuid);
          GM_setValue("rlApiKeyCapturedAt", Date.now());
          if (userId) GM_setValue("rlUserId", userId);
          return true;
        }
      } catch (_) {}
      return false;
    }

    // Initial wait until localStorage has the key (after login), then capture.
    let attempts = 0;
    const tick = setInterval(() => {
      attempts += 1;
      if (captureNow() || attempts > 60) clearInterval(tick);
    }, 1000);

    // Refresh every 5 minutes in case the api-key rotates while the tab is open.
    setInterval(captureNow, 5 * 60 * 1000);
    return; // don't run the bridge side
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Side A2 — On Zendesk: capture the CSRF token from the meta tag.
  // The session cookie is sent automatically by the browser, but state-
  // changing requests (POST/PUT/PATCH/DELETE) also require the CSRF token
  // in the X-CSRF-Token header. We grab it from the meta tag and store it
  // in GM storage so the bridge can attach it on the tracker side.
  // ──────────────────────────────────────────────────────────────────────────
  if (location.hostname.endsWith("iwmac.zendesk.com")) {
    function captureZendeskCsrf() {
      try {
        const meta = document.querySelector('meta[name="csrf-token"]');
        const token = meta && meta.getAttribute("content");
        if (token && token !== GM_getValue("zdCsrfToken", "")) {
          GM_setValue("zdCsrfToken", token);
          GM_setValue("zdCsrfCapturedAt", Date.now());
          return true;
        }
      } catch (_) {}
      return false;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", captureZendeskCsrf);
    } else {
      captureZendeskCsrf();
    }
    // Refresh every minute — the token can rotate when Zendesk renews
    // the session. Cheap to read a meta tag.
    setInterval(captureZendeskCsrf, 60 * 1000);
    return; // don't run the bridge side here either
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Side A3 — On Oneflow: capture the xsrf-token cookie value.
  // The session cookie is HttpOnly (browser handles it) but Oneflow uses
  // the double-submit-cookie CSRF pattern: a NON-HttpOnly `xsrf-token`
  // cookie whose value must be echoed as the `X-XSRF-Token` header on
  // POST/PUT/PATCH/DELETE. We read the value via document.cookie and
  // stash it for the bridge to attach.
  // ──────────────────────────────────────────────────────────────────────────
  if (location.hostname === "app.oneflow.com") {
    function captureOneflowXsrf() {
      try {
        const raw = document.cookie || "";
        const entry = raw.split(";").map((s) => s.trim()).find((s) => s.startsWith("xsrf-token="));
        if (!entry) return false;
        const value = decodeURIComponent(entry.slice("xsrf-token=".length));
        if (value && value !== GM_getValue("ofXsrfToken", "")) {
          GM_setValue("ofXsrfToken", value);
          GM_setValue("ofXsrfCapturedAt", Date.now());
          return true;
        }
      } catch (_) {}
      return false;
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", captureOneflowXsrf);
    } else {
      captureOneflowXsrf();
    }
    // Refresh every 60s — Oneflow rotates the token periodically and
    // we want the bridge to have a fresh value when writes happen.
    setInterval(captureOneflowXsrf, 60 * 1000);
    return; // don't run the bridge side here
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Side A4 — On HubSpot: capture the hublet host + portal ID + CSRF token.
  // HubSpot has TWO regional hublets (app.hubspot.com / app-eu1.hubspot.com)
  // and every internal API call needs:
  //   • The right hublet host (so requests reach the user's region)
  //   • portalId query param (extracted from the URL — most paths embed it)
  //   • hubspotapi-csrf cookie value, echoed as X-HubSpot-CSRF-hubspotapi
  // The session cookie is HttpOnly so the browser handles it.
  // ──────────────────────────────────────────────────────────────────────────
  if (location.hostname === "app.hubspot.com" || location.hostname === "app-eu1.hubspot.com") {
    function captureHubSpotState() {
      try {
        // Hublet host (us vs eu) is just the page's origin.
        const host = location.origin; // e.g. "https://app-eu1.hubspot.com"
        if (host !== GM_getValue("hsHost", "")) GM_setValue("hsHost", host);

        // Portal ID: scrape any /<digits>/ segment from the URL path.
        // Examples: /global-home/8805657, /contacts/8805657/objects/0-1/...
        const portalMatch = location.pathname.match(/\/(\d{6,10})(?:\/|$)/);
        if (portalMatch) {
          const portalId = portalMatch[1];
          if (portalId !== GM_getValue("hsPortalId", "")) GM_setValue("hsPortalId", portalId);
        }

        // CSRF cookie — NOT HttpOnly, readable via document.cookie.
        const raw = document.cookie || "";
        const entry = raw.split(";").map((s) => s.trim()).find((s) => s.startsWith("hubspotapi-csrf="));
        if (entry) {
          const value = decodeURIComponent(entry.slice("hubspotapi-csrf=".length));
          if (value && value !== GM_getValue("hsCsrfToken", "")) {
            GM_setValue("hsCsrfToken", value);
            GM_setValue("hsCsrfCapturedAt", Date.now());
          }
        }
      } catch (_) {}
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", captureHubSpotState);
    } else {
      captureHubSpotState();
    }
    setInterval(captureHubSpotState, 60 * 1000);
    return; // don't run the bridge side here
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Side B — On a file:// page (the tracker): expose window.RocketlaneBridge.
  // ──────────────────────────────────────────────────────────────────────────

  // Startup beacon — visible in the page console so users can confirm the
  // script actually loaded. If you don't see this log when the tracker
  // page opens, Tampermonkey isn't injecting the script (URL @match miss,
  // toggle off, etc.) and no amount of bridge code will help.
  try {
    console.log("[Rocketlane Chat Bridge] loaded on", location.href, "@ ", new Date().toISOString());
  } catch (_) {}

  // Pick the page's real window — unsafeWindow when Tampermonkey is
  // running the script in an isolated world (the normal case with
  // @grant unsafeWindow), or plain window when it isn't.
  const target = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  // SECURITY: gate the bridge expose to specifically the tracker page.
  //
  // The @match list above includes `file:///*` so the bridge works when
  // the user runs the tracker as a local file. Without this in-page
  // check, ANY local HTML file would receive `window.RocketlaneBridge`
  // and could call `apiRequest(...)` against the user's Rocketlane
  // tenant using the captured api-key.
  //
  // We require the page to declare itself as the tracker via a
  // dedicated meta tag — anything else gets nothing.
  //
  // GitHub Pages and any other https-served tracker copies match by
  // @match URL alone (already narrowly scoped). file:// must opt-in.
  if (location.protocol === "file:") {
    const marker = document.querySelector(
      'meta[name="rocketlane-tracker"][content="hapnes-dev/Project-Progress-Tracker"]'
    );
    if (!marker) {
      // Not the tracker — silently bail. Doesn't break anything for
      // the user; they just won't see RocketlaneBridge on this page.
      return;
    }
  }

  // Don't double-install if the script ran on a frame or got injected twice.
  if (target.RocketlaneBridge) return;

  /**
   * Generic CORS-bypassing HTTP call to the Rocketlane tenant API.
   * Used by both the named helpers (gmFetch / gmPost) below AND exposed
   * directly on the bridge as `apiRequest(method, path, body)` so the
   * tracker can call any endpoint without us needing to add a wrapper
   * for each one. The tracker prefers this over its own fetch() because
   * tenant endpoints don't whitelist github.io / file:// origins.
   *
   * @param {string} method    "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
   * @param {string} path      Either an absolute URL or a path; if a path,
   *                           it's resolved against the tenant base.
   * @param {object} [body]    Parsed-JSON body for POST/PUT/PATCH.
   * @returns {Promise<any>}   Parsed JSON response (null if empty body).
   */
  function gmRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      const apiKey = GM_getValue("rlApiKey", "");
      if (!apiKey) {
        reject(new Error("No Rocketlane api-key captured yet. Open https://kiona.rocketlane.com once while logged in."));
        return;
      }
      const url = /^https?:/i.test(path) ? path : (TENANT_API + path);
      const headers = { "api-key": apiKey, accept: "application/json" };
      const init = { method, url, headers, timeout: 20000,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error("HTTP " + res.status + ": " + (res.responseText || "").slice(0, 300)));
            return;
          }
          if (!res.responseText) { resolve(null); return; }
          try { resolve(JSON.parse(res.responseText)); }
          catch { resolve(null); } // some endpoints return non-JSON success
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

  /**
   * Single-shot Zendesk API call. Does NOT auto-retry on 401; the
   * caller (gmZendeskRequest) handles the retry policy so we can layer
   * a renew-session warm-up before the second attempt.
   *
   * @param {string} method
   * @param {string} url      Fully-resolved URL.
   * @param {object|string|null} [body]
   * @param {Record<string,string>} [extraHeaders]
   * @returns {Promise<{status:number, json:any, text:string}>}
   */
  function gmZendeskSendRaw(method, url, body, extraHeaders) {
    return new Promise((resolve, reject) => {
      const headers = Object.assign({ accept: "application/json" }, extraHeaders || {});
      const init = {
        method,
        url,
        headers,
        timeout: 20000,
        // anonymous: false → include cookies for the target origin.
        anonymous: false,
        onload: (res) => {
          const status = res.status;
          const text = res.responseText || "";
          let json = null;
          if (text) { try { json = JSON.parse(text); } catch { /* non-JSON */ } }
          resolve({ status, json, text });
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

  // Coalesce concurrent renew attempts so a burst of N failed API calls
  // doesn't trigger N parallel /users/me.json renews.
  /** @type {Promise<boolean> | null} */
  let zendeskRenewInFlight = null;
  let zendeskLastRenewAttempt = 0;
  const ZENDESK_RENEW_COOLDOWN_MS = 5000; // don't renew more than once per 5s

  /**
   * Force-refresh the Zendesk session cookie by hitting /users/me.json
   * with the documented X-Zendesk-Renew-Session: true header. Zendesk
   * responds with refreshed session/CSRF cookies if the underlying
   * authentication is still valid (e.g. SAML session still active even
   * though the cookie expired). Resolves with `true` if renew worked,
   * `false` otherwise.
   */
  function zendeskRenewSession() {
    if (zendeskRenewInFlight) return zendeskRenewInFlight;
    const now = Date.now();
    if (now - zendeskLastRenewAttempt < ZENDESK_RENEW_COOLDOWN_MS) {
      // Recent renew failed; don't hammer.
      return Promise.resolve(false);
    }
    zendeskLastRenewAttempt = now;
    zendeskRenewInFlight = (async () => {
      try {
        const res = await gmZendeskSendRaw(
          "GET",
          ZENDESK_API + "/users/me.json",
          null,
          { "X-Zendesk-Renew-Session": "true" },
        );
        return res.status >= 200 && res.status < 300;
      } catch (_) {
        return false;
      } finally {
        // Allow another renew attempt later (after cooldown).
        setTimeout(() => { zendeskRenewInFlight = null; }, 0);
      }
    })();
    return zendeskRenewInFlight;
  }

  /**
   * Generic CORS-bypassing HTTP call to the Zendesk API with automatic
   * session renewal on 401. Uses the SAME session cookie the user
   * already has from being logged in at https://iwmac.zendesk.com.
   * No tokens captured, no storage.
   *
   * Retry policy:
   *  1. First attempt — plain request, cookies attached.
   *  2. If response is 401 (and this isn't already a retry), fire a
   *     renew-session warm-up request, then retry the original call
   *     once with `X-Zendesk-Renew-Session: true` on the actual call
   *     as well. This handles SAML / SSO sessions where the underlying
   *     identity is valid but the session cookie expired.
   *  3. If still 401 after retry, surface a clear "open Zendesk while
   *     logged in" error message.
   *
   *   await ZendeskBridge.apiRequest("GET", "/tickets/196389.json");
   *   await ZendeskBridge.apiRequest("PUT", "/tickets/196389.json", { ticket: { status: "solved" } });
   *
   * @param {string} method
   * @param {string} path   Relative to /api/v2, OR an absolute URL.
   * @param {object} [body] JSON body for non-GET requests.
   * @returns {Promise<any>}
   */
  async function gmZendeskRequest(method, path, body) {
    const url = /^https?:/i.test(path) ? path : (ZENDESK_API + path);
    // For state-changing requests, Zendesk requires the CSRF token. We
    // get it from GM storage where the Zendesk-side capture wrote it.
    // GET requests don't need CSRF — only the session cookie.
    const upper = String(method ?? "GET").toUpperCase();
    const extraHeaders = {};
    if (upper !== "GET" && upper !== "HEAD") {
      const csrf = GM_getValue("zdCsrfToken", "");
      if (csrf) {
        extraHeaders["X-CSRF-Token"] = csrf;
      } else {
        throw new Error(
          "Zendesk CSRF token not captured yet. Open https://iwmac.zendesk.com once while logged in (any page), then retry."
        );
      }
    }
    // First attempt
    let res = await gmZendeskSendRaw(method, url, body, extraHeaders);
    if (res.status === 401) {
      // Try to renew; this hits /users/me.json with renew-session header.
      const renewed = await zendeskRenewSession();
      if (renewed) {
        // Retry the original call with renew-session header for good
        // measure (Zendesk sometimes ignores fresh cookies on the very
        // next call without the explicit header). CSRF token is included
        // again — if the renew rotated it, the next non-GET will fail
        // and the user re-loads the Zendesk tab once.
        res = await gmZendeskSendRaw(method, url, body, {
          ...extraHeaders,
          "X-Zendesk-Renew-Session": "true",
        });
      }
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "HTTP " + res.status +
        ": Zendesk session expired or missing. Open https://iwmac.zendesk.com once while logged in to refresh, then try again.",
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error("HTTP " + res.status + ": " + (res.text || "").slice(0, 300));
    }
    return res.json; // may be null for empty bodies
  }

  /**
   * Generic CORS-bypassing HTTP call to the Oneflow API.
   *
   * Auth mechanics:
   *   • Session cookie (HttpOnly) — browser auto-attaches via GM_xmlhttpRequest.
   *   • For non-GET methods, X-XSRF-Token header is required. We pull the
   *     value from GM storage (set by the Oneflow-side capture above).
   *
   *   await OneflowBridge.apiRequest("GET", "/positions/me");
   *   await OneflowBridge.apiRequest("GET", "/collections/?limit=10");
   *
   * @param {string} method
   * @param {string} path   Relative to /api, OR an absolute URL.
   * @param {object} [body] JSON body for non-GET requests.
   */
  async function gmOneflowRequest(method, path, body) {
    const url = /^https?:/i.test(path) ? path : (ONEFLOW_API + path);
    const upper = String(method ?? "GET").toUpperCase();
    const extraHeaders = {};
    if (upper !== "GET" && upper !== "HEAD") {
      const xsrf = GM_getValue("ofXsrfToken", "");
      if (xsrf) {
        // Oneflow accepts both X-XSRF-Token (Spring-style) and xsrf-token
        // header names. We send X-XSRF-Token which is the more common
        // convention; if Oneflow ever rejects it, switch to the lowercase
        // variant.
        extraHeaders["X-XSRF-Token"] = xsrf;
      } else {
        throw new Error(
          "Oneflow CSRF token not captured yet. Open https://app.oneflow.com once while logged in (any page), then retry.",
        );
      }
    }
    return new Promise((resolve, reject) => {
      const headers = Object.assign({ accept: "application/json" }, extraHeaders);
      const init = {
        method: upper,
        url,
        headers,
        timeout: 20000,
        anonymous: false, // include cookies
        onload: (res) => {
          const status = res.status;
          const text = res.responseText || "";
          if (status === 401 || status === 403) {
            reject(new Error(
              "HTTP " + status +
              ": Oneflow session expired or missing. Open https://app.oneflow.com once while logged in, then try again.",
            ));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new Error("HTTP " + status + ": " + text.slice(0, 300)));
            return;
          }
          if (!text) { resolve(null); return; }
          try { resolve(JSON.parse(text)); } catch { resolve(null); }
        },
        onerror: () => reject(new Error("Network error reaching Oneflow API")),
        ontimeout: () => reject(new Error("Oneflow API timed out")),
      };
      if (body !== undefined && body !== null) {
        headers["content-type"] = "application/json";
        init.data = typeof body === "string" ? body : JSON.stringify(body);
      }
      GM_xmlhttpRequest(init);
    });
  }

  /**
   * Generic CORS-bypassing HTTP call to the HubSpot internal API.
   *
   * Auth mechanics:
   *   • Session cookie (HttpOnly) — browser auto-attaches via GM_xmlhttpRequest.
   *   • Per-call CSRF: X-HubSpot-CSRF-hubspotapi header echoes the
   *     `hubspotapi-csrf` cookie value.
   *   • Every call needs portalId in the query string. The bridge auto-
   *     injects it if not already present.
   *
   *   await HubSpotBridge.apiRequest("GET", "/properties/v4/groups/0-1/properties");
   *
   * @param {string} method
   * @param {string} path   Relative to /api, OR an absolute URL.
   * @param {object} [body] JSON body for non-GET requests.
   */
  async function gmHubSpotRequest(method, path, body) {
    const host = GM_getValue("hsHost", "");
    const portalId = GM_getValue("hsPortalId", "");
    const csrf = GM_getValue("hsCsrfToken", "");
    if (!host || !portalId) {
      throw new Error(
        "HubSpot state not captured yet. Open https://app.hubspot.com (or app-eu1.hubspot.com) once while logged in, then retry.",
      );
    }
    // Build the full URL. Inject portalId as query param if missing.
    let url;
    if (/^https?:/i.test(path)) {
      url = path;
    } else {
      const prefix = path.startsWith("/api") ? "" : "/api";
      url = host + prefix + path;
    }
    if (!/[?&]portalId=/i.test(url)) {
      url += (url.includes("?") ? "&" : "?") + "portalId=" + encodeURIComponent(portalId);
    }

    const upper = String(method ?? "GET").toUpperCase();
    const extraHeaders = {};
    if (upper !== "GET" && upper !== "HEAD") {
      if (csrf) {
        extraHeaders["X-HubSpot-CSRF-hubspotapi"] = csrf;
      } else {
        throw new Error(
          "HubSpot CSRF token not captured. Visit any HubSpot page while logged in to refresh.",
        );
      }
    }

    return new Promise((resolve, reject) => {
      const headers = Object.assign({ accept: "application/json" }, extraHeaders);
      const init = {
        method: upper,
        url,
        headers,
        timeout: 20000,
        anonymous: false, // include cookies
        onload: (res) => {
          const status = res.status;
          const text = res.responseText || "";
          if (status === 401 || status === 403) {
            reject(new Error(
              "HTTP " + status +
              ": HubSpot session expired or missing. Open https://app" +
              (host.includes("eu1") ? "-eu1" : "") +
              ".hubspot.com once while logged in, then try again.",
            ));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new Error("HTTP " + status + ": " + text.slice(0, 300)));
            return;
          }
          if (!text) { resolve(null); return; }
          try { resolve(JSON.parse(text)); } catch { resolve(null); }
        },
        onerror: () => reject(new Error("Network error reaching HubSpot API")),
        ontimeout: () => reject(new Error("HubSpot API timed out")),
      };
      if (body !== undefined && body !== null) {
        headers["content-type"] = "application/json";
        init.data = typeof body === "string" ? body : JSON.stringify(body);
      }
      GM_xmlhttpRequest(init);
    });
  }

  function gmFetch(url) {
    return new Promise((resolve, reject) => {
      const apiKey = GM_getValue("rlApiKey", "");
      if (!apiKey) {
        reject(
          new Error(
            "No Rocketlane api-key captured yet. Open https://kiona.rocketlane.com once while logged in.",
          ),
        );
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        headers: { "api-key": apiKey, accept: "application/json" },
        timeout: 20000,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error("HTTP " + res.status + ": " + (res.responseText || "").slice(0, 200)));
            return;
          }
          try {
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(new Error("Invalid JSON from Rocketlane: " + e.message));
          }
        },
        onerror: () => reject(new Error("Network error reaching Rocketlane API")),
        ontimeout: () => reject(new Error("Rocketlane API timed out")),
      });
    });
  }

  function gmPost(url, jsonBody) {
    return new Promise((resolve, reject) => {
      const apiKey = GM_getValue("rlApiKey", "");
      if (!apiKey) {
        reject(new Error("No Rocketlane api-key captured yet. Open https://kiona.rocketlane.com once while logged in."));
        return;
      }
      GM_xmlhttpRequest({
        method: "POST",
        url: url,
        headers: {
          "api-key": apiKey,
          accept: "application/json",
          "content-type": "application/json",
        },
        data: JSON.stringify(jsonBody),
        timeout: 20000,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error("HTTP " + res.status + ": " + (res.responseText || "").slice(0, 200)));
            return;
          }
          try {
            resolve(res.responseText ? JSON.parse(res.responseText) : null);
          } catch (e) {
            // Some POST endpoints return non-JSON on success; treat as OK.
            resolve(null);
          }
        },
        onerror: () => reject(new Error("Network error reaching Rocketlane API")),
        ontimeout: () => reject(new Error("Rocketlane API timed out")),
      });
    });
  }

  /**
   * Upload a file to Rocketlane as an attachment.
   * Format discovered by sniffing the Rocketlane web UI's own request:
   *   POST https://kiona.api.rocketlane.com/api/v1/attachments
   *   Content-Type: multipart/form-data
   *   Parts:
   *     - "file": <File>
   *     - "request": application/json blob with shape
   *         { "attachment": { "name", "publicVisibility", "projectId" } }
   * Response: 201 Created with body { "attachment": { ...full attachment incl. attachmentId... } }
   *
   * @param {number|string} projectId
   * @param {File|Blob} file — must have .name and .type (or `fileName`/`fileType`)
   * @param {{publicVisibility?: boolean}} [opts]
   * @returns {Promise<any>} the `attachment` object from the response
   */
  function gmUploadAttachment(projectId, file, opts) {
    return new Promise((resolve, reject) => {
      const apiKey = GM_getValue("rlApiKey", "");
      if (!apiKey) {
        reject(new Error("No Rocketlane api-key captured yet. Open https://kiona.rocketlane.com once while logged in."));
        return;
      }
      const fileName = (file && (file.name || file.fileName)) || "upload.bin";
      const publicVisibility = !!(opts && opts.publicVisibility !== false);
      const requestPayload = {
        attachment: {
          name: fileName,
          publicVisibility: publicVisibility,
          projectId: Number(projectId),
        },
      };
      const fd = new FormData();
      fd.append("file", file, fileName);
      fd.append("request", new Blob([JSON.stringify(requestPayload)], { type: "application/json" }));

      GM_xmlhttpRequest({
        method: "POST",
        url: TENANT_API + "/attachments",
        // NOTE: do NOT set Content-Type ourselves — the browser/Tampermonkey
        // will set `multipart/form-data; boundary=...` automatically.
        headers: { "api-key": apiKey, accept: "application/json" },
        data: fd,
        timeout: 60000,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error("Upload failed HTTP " + res.status + ": " + (res.responseText || "").slice(0, 200)));
            return;
          }
          try {
            const j = JSON.parse(res.responseText || "{}");
            const att = j?.attachment ?? j?.data?.attachment ?? j;
            if (!att?.attachmentId) {
              reject(new Error("Upload succeeded but no attachmentId in response"));
              return;
            }
            resolve(att);
          } catch (e) {
            reject(new Error("Could not parse upload response: " + e.message));
          }
        },
        onerror: () => reject(new Error("Network error during attachment upload")),
        ontimeout: () => reject(new Error("Attachment upload timed out")),
      });
    });
  }

  function plainTextToHtml(text) {
    // Escape HTML, then wrap paragraphs by double-newline and <br> by single-newline.
    const esc = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return String(text)
      .split(/\n{2,}/)
      .map((para) => "<p>" + esc(para).replace(/\n/g, "<br>") + "</p>")
      .join("");
  }

  target.RocketlaneBridge = {
    isAvailable: true,
    version: "1.0.0-tampermonkey",

    // Synchronous accessors — the tracker reads these at chat-panel
    // render time to avoid the async race where mentions get composed
    // before getApiKey() resolves. GM_getValue is itself synchronous so
    // there's no I/O penalty.
    get userId() { return GM_getValue("rlUserId", null); },
    get apiKey() { return GM_getValue("rlApiKey", "") || null; },

    /**
     * Generic Rocketlane API call routed through GM_xmlhttpRequest so it
     * bypasses CORS. The tracker uses this for ANY tenant-API endpoint
     * (task create, phase list, task delete, project update, …) because
     * its own fetch() can't reach kiona.api.rocketlane.com from
     * github.io / file:// origins.
     *
     *   await bridge.apiRequest("POST", "/tasks", { taskName: "x", … });
     *   await bridge.apiRequest("GET",  "/projects/123/phases");
     *   await bridge.apiRequest("DELETE", "/tasks/456");
     *
     * @param {string} method
     * @param {string} path   Path relative to /api/v1, or full URL.
     * @param {object} [body] JSON body for non-GET requests.
     */
    async apiRequest(method, path, body) {
      return await gmRequest(method, path, body);
    },

    async getStatus() {
      const hasKey = !!GM_getValue("rlApiKey", "");
      const capturedAt = GM_getValue("rlApiKeyCapturedAt", null);
      return { hasKey, capturedAt };
    },

    /**
     * Return the captured Rocketlane api-key so the tracker page can save it
     * locally (e.g. for non-bridge API calls). Only callable from pages where
     * the userscript injected the bridge — i.e. local file:// pages, which is
     * the same origin scope as the tracker.
     */
    async getApiKey() {
      const apiKey = GM_getValue("rlApiKey", "");
      const capturedAt = GM_getValue("rlApiKeyCapturedAt", null);
      const userId = GM_getValue("rlUserId", null);
      return apiKey ? { apiKey, capturedAt, userId } : null;
    },

    async listProjectConversations(projectId) {
      const data = await gmFetch(
        TENANT_API +
          "/projects/" +
          encodeURIComponent(projectId) +
          "/project-conversations?pageSize=20",
      );
      // Rocketlane sometimes returns numeric-keyed objects; normalize to array.
      return Array.isArray(data)
        ? data
        : Object.values(data || {}).filter((v) => v && typeof v === "object");
    },

    async uploadAttachment(projectId, file, opts) {
      return await gmUploadAttachment(projectId, file, opts);
    },

    /**
     * List all attachments uploaded to a project (across chat, tasks, spaces).
     * Response is an array where each entry has { attachment, source, link }.
     * Returns a normalized array of attachment objects with an extra
     * `_source` field describing where it came from.
     */
    /**
     * Fetch a single attachment by id. Rocketlane regenerates the
     * presigned downloadUrl on this endpoint, so it's the right call
     * to make right before opening/downloading a file.
     *
     * Tries several known endpoint shapes — Rocketlane has used different
     * paths over time and we don't have a public spec to anchor on.
     */
    async fetchAttachment(attachmentId) {
      const candidates = [
        TENANT_API + "/attachments/" + encodeURIComponent(attachmentId),
        TENANT_API + "/attachments/" + encodeURIComponent(attachmentId) + "/download",
        TENANT_API + "/attachments/" + encodeURIComponent(attachmentId) + "/url",
      ];
      let lastErr = null;
      for (const url of candidates) {
        try {
          const data = await gmFetch(url);
          // Different endpoints return different shapes — normalize.
          const att = data?.attachment ?? data?.data?.attachment ?? data;
          if (att && (att.downloadUrl || att.location || att.url)) {
            // Normalize a `url` field into `downloadUrl` for downstream code
            if (!att.downloadUrl && att.url) att.downloadUrl = att.url;
            return att;
          }
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error("No attachment endpoint returned a usable URL");
    },

    /**
     * Download an attachment as a Blob via GM_xmlhttpRequest, so the tracker
     * can save it locally even though the file lives on S3 (which doesn't
     * send Content-Disposition headers that would let a plain <a download>
     * trigger a save from a cross-origin link).
     *
     * Always fetches a fresh presigned URL first (per-attachment endpoint).
     * Returns { blob, fileName, mimeType }.
     */
    async downloadAttachmentBlob(attachmentId) {
      const apiKey = GM_getValue("rlApiKey", "");
      if (!apiKey) throw new Error("No Rocketlane api-key captured yet.");
      // 1) Get a freshly-signed download URL via the per-attachment endpoint.
      const att = await this.fetchAttachment(attachmentId);
      const url = String(att?.downloadUrl ?? att?.location ?? "").trim();
      if (!url) throw new Error("Attachment has no downloadUrl/location.");
      const fileName = String(att?.name ?? "download.bin");
      const mimeType = String(att?.mimeType ?? att?.contentType ?? "application/octet-stream");
      // 2) Stream the bytes through GM_xmlhttpRequest so CORS doesn't bite.
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
    },

    /**
     * Fetch the user's notification groups. The response is an array of
     *   { key, task, notifications: [...] }
     * where each notification has timestamp, systemRuleIdentifier, meta, etc.
     *
     * Earlier versions called the endpoint with no params, which made the
     * server return a default subset that quietly excluded chat-mention
     * events. Capture from Rocketlane's own UI shows the call passes
     * status/count/groupSize/filter/exclusions explicitly — we now do too.
     *
     * @param {object} [opts]
     * @param {"All"|"AssignedToMe"|"Mentions"|"Team"} [opts.filter="All"]
     * @param {"New"|"Read"} [opts.status="New"]
     * @param {number} [opts.count=20]      Max groups to return
     * @param {number} [opts.groupSize=8]   Max notifications per group
     * @param {number} [opts.start]         Cursor (epoch micros) for pagination
     * @param {string} [opts.exclusions=""] CSV of rule IDs to exclude
     */
    async fetchNotificationGroups(opts) {
      const o = opts || {};
      const params = new URLSearchParams();
      params.set("status",     String(o.status     ?? "New"));
      params.set("count",      String(o.count      ?? 20));
      params.set("groupSize",  String(o.groupSize  ?? 8));
      params.set("filter",     String(o.filter     ?? "All"));
      params.set("exclusions", String(o.exclusions ?? ""));
      if (o.start != null) params.set("start", String(o.start));
      const data = await gmFetch(TENANT_API + "/notifications/groups?" + params.toString());
      return Array.isArray(data) ? data : Object.values(data || {});
    },

    /** Returns { lastSeenAt: ISO string } — the "everything before this is read" cursor. */
    async getNotificationLastSeen() {
      return await gmFetch(TENANT_API + "/notifications/last-seen-at");
    },

    /** Mark all notifications as read by pushing the cursor forward to now. */
    async markNotificationsSeen() {
      const apiKey = GM_getValue("rlApiKey", "");
      if (!apiKey) throw new Error("No Rocketlane api-key captured yet.");
      return await new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "POST",
          url: TENANT_API + "/notifications/last-seen-at",
          headers: { "api-key": apiKey, accept: "application/json", "content-type": "application/json" },
          data: "{}",
          timeout: 15000,
          onload: (res) => {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error("HTTP " + res.status + ": " + (res.responseText || "").slice(0, 200)));
              return;
            }
            try { resolve(res.responseText ? JSON.parse(res.responseText) : null); }
            catch { resolve(null); }
          },
          onerror: () => reject(new Error("Network error marking notifications seen")),
          ontimeout: () => reject(new Error("Marking notifications seen timed out")),
        });
      });
    },

    /**
     * Fetch the project's "Shared Files" / "Private Files" folders.
     * Returns a flat array of attachment objects with an extra
     * `_folder` field (folder name) and `_isPrivate` flag.
     * Complements fetchProjectAttachments() which only covers
     * task/conversation attachments — folder files live elsewhere.
     */
    async fetchProjectFolders(projectId) {
      const data = await gmFetch(
        TENANT_API + "/projects/" + encodeURIComponent(projectId) + "/folders"
      );
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
      return out;
    },

    /**
     * Fetch the list of users + teams that are members of a Rocketlane
     * project. Used by the chat compose box's @-mention picker so only
     * actual project members appear in the dropdown.
     * Returns the response shape:
     *   { userList: [...], teamList: [...], members: [...], ... }
     */
    async fetchProjectMembers(projectId) {
      return await gmFetch(
        TENANT_API + "/projects/" + encodeURIComponent(projectId) + "/members"
      );
    },

    async fetchProjectAttachments(projectId) {
      const data = await gmFetch(
        TENANT_API + "/attachments/project/" + encodeURIComponent(projectId)
      );
      const list = Array.isArray(data) ? data : Object.values(data || {}).filter((v) => v && typeof v === "object");
      // Normalize: flatten { attachment, source, link } into a plain object
      return list
        .filter((entry) => entry && entry.attachment)
        .map((entry) => ({
          ...entry.attachment,
          _source: entry.source ?? null,
          _link: entry.link ?? null,
        }));
    },

    async postChatComment(projectId, conversationId, plainText, opts) {
      const text = String(plainText || "").trim();
      const linkedAtt = (opts && Array.isArray(opts.linkedAttachments)) ? opts.linkedAttachments : [];
      // Callers can pass pre-rendered HTML (used by @-mention support so
      // the <span class="mention">...</span> markup isn't escaped). If
      // provided, it's used verbatim and overrides the plainText path.
      const contentHtml = opts && typeof opts.contentHtml === "string" ? opts.contentHtml : null;
      if (!text && !linkedAtt.length && !contentHtml) throw new Error("Empty message (no text and no attachments)");
      const isPrivate = !!(opts && opts.private);
      const userId = GM_getValue("rlUserId", 0);
      if (!userId) {
        throw new Error("No userId captured yet. Visit kiona.rocketlane.com once while logged in.");
      }
      const commentMeta = {};
      if (linkedAtt.length) {
        // Each entry should be the full attachment object from uploadAttachment().
        // Rocketlane uses `linkedAttachments` to link uploaded files to a comment.
        commentMeta.linkedAttachments = linkedAtt;
      }
      const finalContent = contentHtml != null
        ? contentHtml
        : (text ? plainTextToHtml(text) : "");
      // Extract Rocketlane native @mention markers so we can attach a
      // mentions.userMentions array. The server appears to read both the
      // HTML and the explicit array, but in-app notifications rely on
      // this array being present.
      const userMentions = [];
      try {
        const re = /<a[^>]*\bclass="[^"]*rl__mention[^"]*"[^>]*>/g;
        let m;
        while ((m = re.exec(finalContent)) !== null) {
          const tag = m[0];
          const objId = (tag.match(/data-rocketlane-mention-object-id="(\d+)"/) || [])[1];
          const uuid = (tag.match(/data-rocketlane-mention-identifier="([^"]+)"/) || [])[1];
          if (objId && uuid) {
            userMentions.push({
              mentionedObjectId: Number(objId),
              mentionedObjectType: "USER",
              mentionUuid: uuid,
              projectId: Number(projectId),
              sourceUserId: Number(userId),
            });
          }
        }
      } catch (_) {}
      const body = {
        comment: {
          messageType: "USER_MESSAGE",
          content: finalContent,
          private: isPrivate,
          commentMeta,
          user: { userId: Number(userId), userType: "NATIVE" },
        },
      };
      if (userMentions.length) {
        body.comment.mentions = { userMentions, taskMentions: [], documentMentions: [], spaceTabMentions: [], teamMentions: [] };
      }
      const url = TENANT_API +
        "/projects/" + encodeURIComponent(projectId) +
        "/project-conversations/" + encodeURIComponent(conversationId) +
        "/comments";
      return await gmPost(url, body);
    },

    async fetchChatComments(projectId, conversationId) {
      const data = await gmFetch(
        TENANT_API +
          "/projects/" +
          encodeURIComponent(projectId) +
          "/project-conversations/" +
          encodeURIComponent(conversationId) +
          "/conversations",
      );
      return Array.isArray(data && data.comments) ? data.comments : [];
    },
  };

  // ──────────────────────────────────────────────────────────────────────────
  // ZendeskBridge — separate object, separate API surface. Lives next to
  // RocketlaneBridge so existing tracker code doesn't see breaking changes.
  //
  // No token storage: GM_xmlhttpRequest re-uses the user's existing
  // iwmac.zendesk.com session cookie. If the user is logged out, calls
  // fail with HTTP 401 and the bridge surfaces a clear error message.
  // ──────────────────────────────────────────────────────────────────────────
  target.ZendeskBridge = {
    isAvailable: true,
    version: "1.0.0-tampermonkey",
    /**
     * Generic CORS-bypassing Zendesk API call.
     * @param {string} method
     * @param {string} path   Relative to /api/v2, or an absolute URL.
     * @param {object} [body] JSON body for non-GET requests.
     */
    async apiRequest(method, path, body) {
      return await gmZendeskRequest(method, path, body);
    },
    /**
     * Convenience: fetch one ticket by ID. Returns the parsed ticket
     * object, or null on 404.
     * @param {number|string} ticketId
     */
    async getTicket(ticketId) {
      const id = String(ticketId ?? "").trim();
      if (!id) throw new Error("getTicket requires a ticketId");
      try {
        const json = await gmZendeskRequest("GET", "/tickets/" + encodeURIComponent(id) + ".json");
        return json?.ticket ?? null;
      } catch (e) {
        if (String(e?.message ?? "").includes("HTTP 404")) return null;
        throw e;
      }
    },
    /**
     * Convenience: return the currently-logged-in Zendesk user.
     * Useful for the tracker to confirm session is valid before
     * showing Zendesk-dependent UI.
     */
    async getCurrentUser() {
      const json = await gmZendeskRequest("GET", "/users/me.json");
      return json?.user ?? null;
    },
    /**
     * Get all comments for a ticket with author user data sideloaded.
     * Returns { comments: [...], users: [...] } so the tracker can show
     * author names without an extra round-trip per comment.
     */
    async getTicketComments(ticketId) {
      const id = String(ticketId ?? "").trim();
      if (!id) throw new Error("getTicketComments requires a ticketId");
      return await gmZendeskRequest(
        "GET",
        "/tickets/" + encodeURIComponent(id) + "/comments.json?include=users&sort_order=asc",
      );
    },
    /**
     * Post a reply to a ticket. `body` is plain text. `isPublic=true`
     * → customer-visible; false → internal note (agents only).
     * Requires CSRF token captured from an iwmac.zendesk.com session.
     * Returns the updated ticket object.
     */
    async postTicketReply(ticketId, body, isPublic) {
      const id = String(ticketId ?? "").trim();
      if (!id) throw new Error("postTicketReply requires a ticketId");
      const trimmed = String(body ?? "").trim();
      if (!trimmed) throw new Error("Reply body cannot be empty");
      const json = await gmZendeskRequest(
        "PUT",
        "/tickets/" + encodeURIComponent(id) + ".json",
        { ticket: { comment: { body: trimmed, public: !!isPublic } } },
      );
      return json?.ticket ?? null;
    },
    /** Diagnostic: returns whether a CSRF token has been captured + age. */
    async getCsrfStatus() {
      const token = GM_getValue("zdCsrfToken", "");
      const capturedAt = GM_getValue("zdCsrfCapturedAt", 0);
      return {
        hasToken: !!token,
        capturedAt: capturedAt || null,
        ageMs: capturedAt ? (Date.now() - capturedAt) : null,
      };
    },
  };

  // ──────────────────────────────────────────────────────────────────────────
  // OneflowBridge — parallel to RocketlaneBridge / ZendeskBridge.
  // Session-cookie auth + xsrf-token CSRF; no API key captured here, just
  // routes calls through GM_xmlhttpRequest so the user's existing Oneflow
  // session works from the tracker's github.io / file:// origin.
  // ──────────────────────────────────────────────────────────────────────────
  target.OneflowBridge = {
    isAvailable: true,
    version: "1.0.0-tampermonkey",
    /**
     * Generic CORS-bypassing Oneflow API call.
     * @param {string} method
     * @param {string} path   Relative to /api, or an absolute URL.
     * @param {object} [body] JSON body for non-GET requests.
     */
    async apiRequest(method, path, body) {
      return await gmOneflowRequest(method, path, body);
    },
    /**
     * Currently logged-in Oneflow user — useful for confirming session
     * is valid before showing Oneflow-dependent UI in the tracker.
     */
    async getCurrentUser() {
      return await gmOneflowRequest("GET", "/positions/me");
    },
    /** Diagnostic: whether an xsrf-token was captured + how old it is. */
    async getCsrfStatus() {
      const token = GM_getValue("ofXsrfToken", "");
      const capturedAt = GM_getValue("ofXsrfCapturedAt", 0);
      return {
        hasToken: !!token,
        capturedAt: capturedAt || null,
        ageMs: capturedAt ? (Date.now() - capturedAt) : null,
      };
    },
  };

  // ──────────────────────────────────────────────────────────────────────────
  // HubSpotBridge — session-cookie + per-call CSRF. Portal ID + hublet
  // host are captured separately because HubSpot has US and EU regions
  // and every API call needs them in the URL.
  // ──────────────────────────────────────────────────────────────────────────
  target.HubSpotBridge = {
    isAvailable: true,
    version: "1.0.0-tampermonkey",
    /**
     * Generic CORS-bypassing HubSpot API call.
     * @param {string} method
     * @param {string} path   Relative to /api, or an absolute URL.
     * @param {object} [body] JSON body for non-GET requests.
     */
    async apiRequest(method, path, body) {
      return await gmHubSpotRequest(method, path, body);
    },
    /**
     * Currently logged-in HubSpot user context. The Login UI's
     * /api/login-requirements endpoint works without portal scope so
     * we use it here as a session-validity probe.
     */
    async getCurrentUser() {
      const portalId = GM_getValue("hsPortalId", "");
      const host = GM_getValue("hsHost", "");
      if (!host || !portalId) {
        throw new Error("HubSpot state not captured. Open a HubSpot page once.");
      }
      // The login-requirements endpoint takes user/portal in the path.
      // We don't know the userId from outside, so fall back to a generic
      // hub-user-info call that the web app uses on bootstrap.
      return await gmHubSpotRequest("GET", "/login-verify/hub-user-info?early=true");
    },
    /** Diagnostic: state-capture status. */
    async getCsrfStatus() {
      const token = GM_getValue("hsCsrfToken", "");
      const capturedAt = GM_getValue("hsCsrfCapturedAt", 0);
      return {
        hasToken: !!token,
        host: GM_getValue("hsHost", "") || null,
        portalId: GM_getValue("hsPortalId", "") || null,
        capturedAt: capturedAt || null,
        ageMs: capturedAt ? (Date.now() - capturedAt) : null,
      };
    },
  };

  // Notify the tracker page in case it's listening
  try {
    target.dispatchEvent(new CustomEvent("rocketlane-bridge-ready"));
    target.dispatchEvent(new CustomEvent("zendesk-bridge-ready"));
    target.dispatchEvent(new CustomEvent("oneflow-bridge-ready"));
    target.dispatchEvent(new CustomEvent("hubspot-bridge-ready"));
  } catch (_) {}

  // Verify the assignment actually landed on the page's real window
  // (not the userscript's isolated world). If it didn't — which can
  // happen on some Tampermonkey/browser combos where the unsafeWindow
  // reference returns the sandbox window — fall back to an injected
  // <script> tag that runs in the page world and forwards calls back to
  // the userscript via window-level events.
  function bridgeIsVisibleOnPage() {
    try {
      // Probe the page world with a synthetic script that reports back.
      const probeKey = "__rlBridgeProbe_" + Date.now();
      const s = document.createElement("script");
      s.textContent =
        "window['" + probeKey + "'] = typeof window.RocketlaneBridge !== 'undefined';";
      (document.head || document.documentElement).appendChild(s);
      s.remove();
      const ok = !!(typeof unsafeWindow !== "undefined" ? unsafeWindow : window)[probeKey];
      return ok;
    } catch (_) { return false; }
  }

  // Schedule the visibility check after a microtask so the assignment
  // has been committed first.
  Promise.resolve().then(() => {
    if (bridgeIsVisibleOnPage()) {
      try { console.log("[Rocketlane Chat Bridge] published on page window ✓"); } catch (_) {}
      return;
    }
    try { console.warn("[Rocketlane Chat Bridge] not visible on page window — installing <script>-tag forwarder"); } catch (_) {}
    // Inject a tiny shim into the page world that:
    //   1. Defines window.RocketlaneBridge with the same surface
    //   2. For each async method, dispatches a CustomEvent to a
    //      userscript-side listener, which performs the actual work
    //      and dispatches back the result.
    const reqEvt  = "rocketlaneBridgeReq";
    const respEvt = "rocketlaneBridgeResp";
    const shim = document.createElement("script");
    const methodList = Object.keys(target.RocketlaneBridge).filter((k) =>
      typeof target.RocketlaneBridge[k] === "function",
    );
    const props = {
      version: target.RocketlaneBridge.version,
      isAvailable: true,
    };
    shim.textContent = `
      (function () {
        if (window.RocketlaneBridge) return;
        const methods = ${JSON.stringify(methodList)};
        const props   = ${JSON.stringify(props)};
        const reqEvt  = ${JSON.stringify(reqEvt)};
        const respEvt = ${JSON.stringify(respEvt)};
        const pending = new Map();
        let seq = 0;
        window.addEventListener(respEvt, (e) => {
          const d = e.detail || {};
          const p = pending.get(d.id);
          if (!p) return;
          pending.delete(d.id);
          if (d.error) p.reject(new Error(d.error));
          else p.resolve(d.value);
        });
        const bridge = { ...props };
        for (const m of methods) {
          bridge[m] = function (...args) {
            return new Promise((resolve, reject) => {
              const id = ++seq;
              pending.set(id, { resolve, reject });
              window.dispatchEvent(new CustomEvent(reqEvt, { detail: { id, method: m, args } }));
            });
          };
        }
        window.RocketlaneBridge = bridge;
      })();
    `;
    (document.head || document.documentElement).appendChild(shim);
    shim.remove();

    // Userscript-side listener — runs the actual GM_xmlhttpRequest etc.
    target.addEventListener(reqEvt, async (e) => {
      const { id, method, args } = e.detail || {};
      try {
        const fn = target.RocketlaneBridge[method];
        const value = typeof fn === "function" ? await fn.apply(target.RocketlaneBridge, args || []) : null;
        target.dispatchEvent(new CustomEvent(respEvt, { detail: { id, value } }));
      } catch (err) {
        target.dispatchEvent(new CustomEvent(respEvt, { detail: { id, error: String(err?.message ?? err) } }));
      }
    });

    // Parallel forwarder for ZendeskBridge — same isolated-world fallback.
    const zReqEvt  = "zendeskBridgeReq";
    const zRespEvt = "zendeskBridgeResp";
    const zShim = document.createElement("script");
    const zMethodList = Object.keys(target.ZendeskBridge || {}).filter(
      (k) => typeof target.ZendeskBridge[k] === "function",
    );
    const zProps = {
      version: target.ZendeskBridge?.version,
      isAvailable: !!target.ZendeskBridge?.isAvailable,
    };
    zShim.textContent = `
      (function () {
        if (window.ZendeskBridge) return;
        const methods = ${JSON.stringify(zMethodList)};
        const props   = ${JSON.stringify(zProps)};
        const reqEvt  = ${JSON.stringify(zReqEvt)};
        const respEvt = ${JSON.stringify(zRespEvt)};
        const pending = new Map();
        let seq = 0;
        window.addEventListener(respEvt, (e) => {
          const d = e.detail || {};
          const p = pending.get(d.id);
          if (!p) return;
          pending.delete(d.id);
          if (d.error) p.reject(new Error(d.error));
          else p.resolve(d.value);
        });
        const bridge = { ...props };
        for (const m of methods) {
          bridge[m] = function (...args) {
            return new Promise((resolve, reject) => {
              const id = ++seq;
              pending.set(id, { resolve, reject });
              window.dispatchEvent(new CustomEvent(reqEvt, { detail: { id, method: m, args } }));
            });
          };
        }
        window.ZendeskBridge = bridge;
      })();
    `;
    (document.head || document.documentElement).appendChild(zShim);
    zShim.remove();

    target.addEventListener(zReqEvt, async (e) => {
      const { id, method, args } = e.detail || {};
      try {
        const fn = target.ZendeskBridge[method];
        const value = typeof fn === "function" ? await fn.apply(target.ZendeskBridge, args || []) : null;
        target.dispatchEvent(new CustomEvent(zRespEvt, { detail: { id, value } }));
      } catch (err) {
        target.dispatchEvent(new CustomEvent(zRespEvt, { detail: { id, error: String(err?.message ?? err) } }));
      }
    });

    // Parallel forwarder for OneflowBridge — same isolated-world fallback.
    const oReqEvt  = "oneflowBridgeReq";
    const oRespEvt = "oneflowBridgeResp";
    const oShim = document.createElement("script");
    const oMethodList = Object.keys(target.OneflowBridge || {}).filter(
      (k) => typeof target.OneflowBridge[k] === "function",
    );
    const oProps = {
      version: target.OneflowBridge?.version,
      isAvailable: !!target.OneflowBridge?.isAvailable,
    };
    oShim.textContent = `
      (function () {
        if (window.OneflowBridge) return;
        const methods = ${JSON.stringify(oMethodList)};
        const props   = ${JSON.stringify(oProps)};
        const reqEvt  = ${JSON.stringify(oReqEvt)};
        const respEvt = ${JSON.stringify(oRespEvt)};
        const pending = new Map();
        let seq = 0;
        window.addEventListener(respEvt, (e) => {
          const d = e.detail || {};
          const p = pending.get(d.id);
          if (!p) return;
          pending.delete(d.id);
          if (d.error) p.reject(new Error(d.error));
          else p.resolve(d.value);
        });
        const bridge = { ...props };
        for (const m of methods) {
          bridge[m] = function (...args) {
            return new Promise((resolve, reject) => {
              const id = ++seq;
              pending.set(id, { resolve, reject });
              window.dispatchEvent(new CustomEvent(reqEvt, { detail: { id, method: m, args } }));
            });
          };
        }
        window.OneflowBridge = bridge;
      })();
    `;
    (document.head || document.documentElement).appendChild(oShim);
    oShim.remove();

    target.addEventListener(oReqEvt, async (e) => {
      const { id, method, args } = e.detail || {};
      try {
        const fn = target.OneflowBridge[method];
        const value = typeof fn === "function" ? await fn.apply(target.OneflowBridge, args || []) : null;
        target.dispatchEvent(new CustomEvent(oRespEvt, { detail: { id, value } }));
      } catch (err) {
        target.dispatchEvent(new CustomEvent(oRespEvt, { detail: { id, error: String(err?.message ?? err) } }));
      }
    });

    // Parallel forwarder for HubSpotBridge — same isolated-world fallback.
    const hReqEvt  = "hubspotBridgeReq";
    const hRespEvt = "hubspotBridgeResp";
    const hShim = document.createElement("script");
    const hMethodList = Object.keys(target.HubSpotBridge || {}).filter(
      (k) => typeof target.HubSpotBridge[k] === "function",
    );
    const hProps = {
      version: target.HubSpotBridge?.version,
      isAvailable: !!target.HubSpotBridge?.isAvailable,
    };
    hShim.textContent = `
      (function () {
        if (window.HubSpotBridge) return;
        const methods = ${JSON.stringify(hMethodList)};
        const props   = ${JSON.stringify(hProps)};
        const reqEvt  = ${JSON.stringify(hReqEvt)};
        const respEvt = ${JSON.stringify(hRespEvt)};
        const pending = new Map();
        let seq = 0;
        window.addEventListener(respEvt, (e) => {
          const d = e.detail || {};
          const p = pending.get(d.id);
          if (!p) return;
          pending.delete(d.id);
          if (d.error) p.reject(new Error(d.error));
          else p.resolve(d.value);
        });
        const bridge = { ...props };
        for (const m of methods) {
          bridge[m] = function (...args) {
            return new Promise((resolve, reject) => {
              const id = ++seq;
              pending.set(id, { resolve, reject });
              window.dispatchEvent(new CustomEvent(reqEvt, { detail: { id, method: m, args } }));
            });
          };
        }
        window.HubSpotBridge = bridge;
      })();
    `;
    (document.head || document.documentElement).appendChild(hShim);
    hShim.remove();

    target.addEventListener(hReqEvt, async (e) => {
      const { id, method, args } = e.detail || {};
      try {
        const fn = target.HubSpotBridge[method];
        const value = typeof fn === "function" ? await fn.apply(target.HubSpotBridge, args || []) : null;
        target.dispatchEvent(new CustomEvent(hRespEvt, { detail: { id, value } }));
      } catch (err) {
        target.dispatchEvent(new CustomEvent(hRespEvt, { detail: { id, error: String(err?.message ?? err) } }));
      }
    });
  });
})();
