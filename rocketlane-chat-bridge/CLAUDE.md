# Rocketlane Chat Bridge — technical reference

Deep technical notes for `rocketlane-chat-bridge/rocketlane-chat-bridge.user.js`, a single IIFE that captures five products' browser-session state and publishes privileged CORS-bypassing bridges to the Project Progress Tracker. Current `@version`: **1.15.0**. Grants: `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`, `unsafeWindow`, `GM_notification`, and `GM_registerMenuCommand`. Repo-wide rules (version bumping, commit/push, line endings) live in the root `CLAUDE.md` and are not repeated here.

The folder `README.md` is user-facing. This document describes the source as it executes; where comments or the README disagree with the code, the code wins.

---

## 1. What it is / where it runs

The script has two roles:

1. On product pages, capture session material into userscript-global GM storage and return without exposing a bridge.
2. On a marker-bearing Project Progress Tracker page, expose `RocketlaneBridge`, `ZendeskBridge`, `OneflowBridge`, `HubSpotBridge`, and `YouniumBridge` on the page window. Their requests use `GM_xmlhttpRequest`, so a `file://` or GitHub Pages tracker can call APIs that do not allow that page origin through CORS.

Exact `@match` patterns:

- `https://kiona.rocketlane.com/*`
- `https://iwmac.zendesk.com/*`
- `https://app.oneflow.com/*`
- `https://app.hubspot.com/*`
- `https://app-eu1.hubspot.com/*`
- `https://eu.younium.com/*`
- `https://us.younium.com/*`
- `https://app.younium.com/*`
- `file:///*`
- `http://127.0.0.1:8102/*`
- `http://localhost:8102/*`
- `https://hapnes-dev.github.io/Project-Progress-Tracker/*`

It runs at **`document-start`**.

Context routing is ordered and terminating:

- Rocketlane: `location.hostname.endsWith("kiona.rocketlane.com")` → capture `localStorage.__api_key`, start capture timers, then `return`.
- Zendesk: `endsWith("iwmac.zendesk.com")` → capture the CSRF meta tag, start a 60-second refresh timer, then `return`.
- Oneflow: exact host `app.oneflow.com` → capture the readable XSRF cookie, start a 60-second refresh timer, then `return`.
- Younium: `/(?:^|\.)younium\.com$/i` → remember `eu`/`us` when present, then `return`.
- HubSpot: exact US/EU app host → capture hublet, portal ID, and CSRF cookie, start a 60-second refresh timer, then `return`.
- Remaining matched pages enter bridge setup.

Bridge exposure is allowed only when the origin is `file:`, `127.0.0.1`, `localhost`, or `hapnes-dev.github.io`, and the document contains exactly:

```html
<meta name="rocketlane-tracker" content="hapnes-dev/Project-Progress-Tracker">
```

The metadata limits localhost matches to port `8102`; the in-page host test itself does not inspect the port. `file:///*` is deliberately broad, so the meta marker is the actual authorization boundary.

## 2. Architecture: capture side, bridge side, page-world publication

### Capture side

All captured state is written with `GM_setValue`, which is shared across this userscript's matched origins and tabs. Product pages never receive any `window.*Bridge` object because every capture branch returns.

- Rocketlane polls once per second for at most **61 ticks** (`attempts > 60` is checked after increment), then refreshes every **5 minutes**.
- Zendesk, Oneflow, and HubSpot capture at DOM ready and every **60 seconds**.
- Younium records the region once per page execution; `app.younium.com` matches the branch but yields no region and still returns.

### Bridge side

`target` is `unsafeWindow` when available, otherwise `window`. The script aborts all setup if `target.RocketlaneBridge` is already truthy. It then builds five bridge objects, dispatches five `*-bridge-ready` events, and publishes the userscript version from `GM_info.script.version` as `target.IWMAC_BRIDGE_VERSION` plus each bridge's `userscriptVersion`.

Every bridge declares `isAvailable: true` and an internal `version: "1.0.0-tampermonkey"`; this is separate from userscript version **1.15.0**.

### Isolated-world fallback

`bridgeIsVisibleOnPage()` injects a probe `<script>` to test whether page-world code can see `window.RocketlaneBridge`. If not, a second set of injected shims forwards method calls over paired `CustomEvent`s:

- `rocketlaneBridgeReq` / `rocketlaneBridgeResp`
- `zendeskBridgeReq` / `zendeskBridgeResp`
- `oneflowBridgeReq` / `oneflowBridgeResp`
- `hubspotBridgeReq` / `hubspotBridgeResp`
- `youniumBridgeReq` / `youniumBridgeResp`

Each shim keeps a `pending` map keyed by a monotonically increasing request ID. The userscript listener looks up the named method, invokes it with the original bridge as `this`, and returns either `value` or a stringified error message.

Only enumerable **functions** are forwarded. Rocketlane's synchronous `apiKey` and `userId` getters are not reproduced by the shim. The ready events are dispatched before the visibility probe and are not dispatched again after fallback installation.

## 3. Security boundary and network surface

### Exposure gate

The meta marker check at lines 288–302 is load-bearing. Page-world code can call generic API methods and, on the direct-publication path, read Rocketlane's captured key via the `apiKey` getter or `getApiKey()`. Removing or broadening the marker check would make any matching local/GitHub page a credentialed API client.

The script logs only load/presence/status diagnostics; it does not intentionally log credential values. No hardcoded credential was found in this source.

### All `@connect` hosts

The metadata contains **13**, not 12, `@connect` entries:

| Host | Request surface served |
|---|---|
| `kiona.api.rocketlane.com` | Rocketlane tenant API under `/api/v1`: generic calls, chat, notifications, projects, attachments, and uploads. |
| `iwmac.zendesk.com` | Zendesk session API under `/api/v2`, including session renewal and ticket notification polling. |
| `app.oneflow.com` | Oneflow session API under `/api`, including the `/positions/me` renewal warm-up. |
| `app.hubspot.com` | US HubSpot internal APIs and login/session warm-up. |
| `app-eu1.hubspot.com` | EU1 HubSpot internal APIs and login/session warm-up. |
| `auth.eu.younium.com` | EU Frontegg refresh endpoint that mints a Younium access token from the browser's refresh cookie. |
| `auth.us.younium.com` | US equivalent of the Frontegg refresh endpoint. |
| `api.younium.com` | Younium business API (`/api/user`, `/api/data/query`, orders, quotes, invoices, event log). |
| `s3.us-east-1.amazonaws.com` | Allowlisted Rocketlane attachment-download destination; the exact URL comes from Rocketlane. |
| `s3.amazonaws.com` | Allowlisted Rocketlane attachment-download destination. |
| `amazonaws.com` | Broader AWS attachment-download allowance. No dedicated literal request target uses it in this file. |
| `assets.rocketlane.com` | Legacy Rocketlane asset/attachment host allowance. No dedicated literal request target uses it in this file. |
| `d1vtr0p8bkmfca.cloudfront.net` | Rocketlane CDN allowance; the README labels it avatar/company-logo CDN. No dedicated literal request target uses it in this file. |

The last five hosts are not API bases in the script. The actual cross-origin blob request is `downloadAttachmentBlob()`, which uses a fresh download URL returned by Rocketlane and sends **no Rocketlane API key** to that URL.

### Credential acquisition and attachment

| Product | Acquisition | GM storage | Where attached |
|---|---|---|---|
| Rocketlane | `captureNow()` parses `localStorage.__api_key`, selects the first UUID-shaped string and first positive integer. | `rlApiKey`, `rlApiKeyCapturedAt`, `rlUserId` | `api-key` header on Rocketlane API requests. `rlUserId` is embedded in posted comment/mention bodies. |
| Zendesk | `captureZendeskCsrf()` reads `<meta name="csrf-token">`. The login/session cookie remains HttpOnly and is sent by `GM_xmlhttpRequest` with `anonymous: false`. | `zdCsrfToken`, `zdCsrfCapturedAt` | `X-CSRF-Token` only for methods other than GET/HEAD; session cookie on the Zendesk origin. |
| Oneflow | `captureOneflowXsrf()` reads and URL-decodes the non-HttpOnly `xsrf-token` cookie. The session cookie remains browser-managed. | `ofXsrfToken`, `ofXsrfCapturedAt` | `X-XSRF-Token` only for methods other than GET/HEAD; session cookie on the Oneflow origin. Missing XSRF does not fail before the request—it generally becomes a 401/403 path. |
| HubSpot | `captureHubSpotState()` records `location.origin`, extracts a 6–10 digit portal segment from the path, and reads/decodes `hubspotapi-csrf`. | `hsHost`, `hsPortalId`, `hsCsrfToken`, `hsCsrfCapturedAt` | `portalId` query parameter on every request; `X-HubSpot-CSRF-hubspotapi` on non-GET/HEAD; browser session cookie. Missing CSRF does not fail before the request. |
| Younium | `gmYouniumRefreshToken()` POSTs `{}` to the region-specific Frontegg refresh endpoint with `anonymous: false`, using the HttpOnly refresh cookie. It parses `accessToken` and `expiresIn`. | `ynRegion`, `ynRegionCapturedAt`, `ynAccessToken`, `ynAccessTokenExpiresAt`, `ynAccessTokenCapturedAt` | `Authorization: Bearer <stored token>` plus `X-Younium-Origin: frontend` on `api.younium.com`. The public `refreshToken()` returns status/expiry, never the raw JWT. |

The comment at lines 50–55 saying Zendesk captures/stores no token is stale: the code at lines 127–133 does capture and store the **CSRF token**. It still does not copy the HttpOnly session cookie into GM storage.

### Origin pinning (v1.15.0)

Every public generic API entry accepts a relative path or caller-supplied absolute URL. The credentialed wrapper resolves the URL, computes `new URL(url).origin`, and rejects a non-approved origin before constructing credential headers or calling the raw sender. Some helpers read GM state needed for setup before this check, but no credential is attached to a request before the check:

- Rocketlane: `gmRequest()` requires exactly `https://kiona.api.rocketlane.com` before creating the `api-key` headers.
- Zendesk: `gmZendeskRequest()` requires `ZENDESK_HOST` (`https://iwmac.zendesk.com`) before reading `zdCsrfToken` or calling `gmZendeskSendRaw()`.
- Oneflow: `gmOneflowRequest()` requires `ONEFLOW_HOST` (`https://app.oneflow.com`) before `buildHeaders()` reads `ofXsrfToken` or `gmOneflowSendRaw()` runs.
- HubSpot: `gmHubSpotRequest()` accepts only `https://app.hubspot.com` or `https://app-eu1.hubspot.com` before `buildHeaders()` reads `hsCsrfToken` or `gmHubSpotSendRaw()` runs. It appends `portalId` to the URL before validating, but no request is sent before validation. The pin is to either known hublet, not specifically to the currently captured `hsHost`.
- Younium: `gmYouniumRequest()` requires exactly `https://api.younium.com` before reading/refreshing `ynAccessToken` and before `send()` adds the Bearer header.

Relative paths are joined to hardcoded/captured API bases. Invalid URLs produce an empty origin and are rejected.

### Remaining URL-bearing paths

The caller-controlled URL surface remains intentionally present through all five exposed `apiRequest(method, path, body)` methods; absolute URLs still reach their corresponding wrapper, but the origin checks above stop them before credentials or network are handed to a different `@connect` host.

Two older Rocketlane helpers, `gmFetch(url)` and `gmPost(url, jsonBody)`, attach `rlApiKey` without their own origin check. They are **not exposed** and every current call site constructs its URL from `TENANT_API` plus encoded IDs or fixed suffixes. Preserve that invariant, or route new generic use through pinned `gmRequest()`.

`downloadAttachmentBlob()` sends a server-supplied presigned URL directly to `GM_xmlhttpRequest`, but attaches no API key. The page caller supplies only `attachmentId`; `fetchAttachment()` obtains the URL from one of three fixed Rocketlane API endpoints.

## 4. Request and retry mechanics

- Rocketlane JSON: `gmRequest`, `gmFetch`, and `gmPost` use **20,000 ms** timeouts. `gmRequest` treats an empty/non-JSON 2xx response as `null`; `gmFetch` rejects invalid JSON; `gmPost` treats non-JSON 2xx as `null`.
- Zendesk: `gmZendeskSendRaw` returns `{status,json,text}` even on 4xx. On 401, `gmZendeskRequest` coalesces a `/users/me.json` renewal with `X-Zendesk-Renew-Session: true`, then retries once with the same header. Renewal attempts have a **5,000 ms** cooldown.
- Oneflow: on 401/403, warm up `GET /api/positions/me`, wait **800 ms**, rebuild the XSRF header from GM storage, and retry once. Concurrent renewals coalesce; cooldown is **5,000 ms**.
- HubSpot: on 401/403, warm up `/api/login-verify/v1/info?portalId=...`, wait **800 ms**, rebuild the CSRF header, and retry once. Concurrent renewals coalesce; cooldown is **5,000 ms**.
- Younium: refresh when the token is missing or within **60,000 ms** of expiry. Passive refreshes within **30,000 ms** reuse the cached token; a 401 forces refresh regardless of cooldown, then retries once. `expiresIn` is converted to milliseconds with a minimum TTL of **60,000 ms**.
- Upload: attachment create **60,000 ms**; optional folder-link step **30,000 ms**.
- Blob download: **120,000 ms**.
- Rocketlane mark-seen: **15,000 ms**.

All product raw senders use `anonymous: false` where browser cookies are required. Error bodies are truncated to 200 or 300 characters depending on helper.

## 5. Rocketlane bridge behavior

`RocketlaneBridge.apiRequest()` is the generic pinned `/api/v1` surface. The named helpers add normalization and workflow logic:

- Conversations/comments: `listProjectConversations()` normalizes arrays or numeric-keyed objects; `fetchChatComments()` returns `data.comments` or `[]`.
- Posting: `postChatComment()` accepts text, private flag, linked attachments, and optional `contentHtml`. `contentHtml` is used verbatim. Otherwise `plainTextToHtml()` escapes `&`, `<`, and `>` and makes paragraphs/`<br>`.
- Mentions: scans final HTML for `<a>` tags with class `rl__mention`, extracts `data-rocketlane-mention-object-id` and `data-rocketlane-mention-identifier`, and builds `comment.mentions.userMentions` with project/source-user metadata.
- Upload: `gmUploadAttachment()` builds multipart `file` + JSON `request` parts and deliberately leaves `Content-Type` unset so Tampermonkey supplies the boundary. A folder upload adds `sourceType: "FOLDER"`/`sourceId` and performs a required second `/attachments/link` POST; without it the upload is orphaned from the folder.
- Attachment lookup: `fetchAttachment()` tries `/attachments/{id}`, `/download`, then `/url`, accepting `downloadUrl`, `location`, or `url` and normalizing `url` to `downloadUrl`.
- Folder/file listing: `fetchProjectFolders()` flattens folder attachments and annotates `_folder`, `_isPrivate`, `_source`, `_link`; `fetchProjectAttachments()` flattens `{attachment,source,link}` records.
- Notifications: `fetchNotificationGroups()` explicitly supplies `status`, `count`, `groupSize`, `filter`, `exclusions`, and optional `start`; defaults are `New`, `20`, `8`, `All`, and empty exclusions.
- Diagnostics: `getStatus()` reports only key presence/time. `getApiKey()` and the synchronous `apiKey` getter expose the actual Rocketlane key to the authorized tracker page; `userId` is also a synchronous getter on the direct path.

## 6. Zendesk, Oneflow, HubSpot, and Younium bridge surfaces

### `ZendeskBridge`

- `apiRequest(method,path,body)` — generic pinned `/api/v2` call.
- `getTicket(ticketId)` — returns `ticket`, maps a message containing `HTTP 404` to `null`.
- `getCurrentUser()` — `/users/me.json`.
- `getTicketComments(ticketId)` — ascending comments with `include=users`.
- `postTicketReply(ticketId,body,isPublic)` — PUTs a public reply or internal note.
- `getCsrfStatus()` — presence, capture time, and age only.

### `OneflowBridge`

- `apiRequest(method,path,body)` — generic pinned `/api` call.
- `getCurrentUser()` — `/positions/me`.
- `getCsrfStatus()` — presence, capture time, and age only.

### `HubSpotBridge`

- `apiRequest(method,path,body)` — generic internal-API call with portal injection.
- `getCurrentUser()` — `/login-verify/hub-user-info?early=true`.
- `searchCrm(objectTypeId,query,opts)` — POST `/crm-search/search`; passes selected properties and optional `includeAllProperties`.
- `searchDeals(query,opts)` — object type `0-3`, default count 10 and `includeAllProperties: true`.
- `getCsrfStatus()` — token presence plus host/portal/capture age.

### `YouniumBridge`

- `apiRequest(method,path,body)`, `refreshToken()`, `getCurrentUser()`.
- `searchOrders()` and `searchQuotes()` mirror `/api/data/query/*` request bodies with overridable page/sort/display/conditions fields.
- `getOrderById()`, `getInvoicesForOrder()`, `getQuoteById()`, `getOrderEventLog()`.
- `getTokenStatus()` returns presence, region, timestamps, and milliseconds to expiry—never the token.

## 7. Desktop notification subsystem

`setupDesktopNotifier()` starts only if `GM_notification` is a function. It registers a menu toggle and schedules `pollOnce()` after **8,000 ms**, then every **60,000 ms**.

Cross-tab behavior:

- `claimPollSlot()` refuses a poll if the shared last-poll timestamp is newer than `POLL_MS - 5000` (**55 seconds**).
- Seen identifiers are JSON in GM storage and truncated to the newest **400** entries on save.
- The first successful collection primes all current items as seen and emits no notifications.
- `GM_notification` stays for **15,000 ms** and opens the item URL in a new `noopener` tab.

Rocketlane collection requests 20 new groups, retains only `meta.eventType === "MessageCreated"`, removes messages authored by `rlUserId`, and emits one item for the newest qualifying message in each group. It caches missing project names under `notif_pname_<projectId>`. Deep links use `/projects/<projectId>/chat/<conversationId>` with `g.key.uri` only as a fallback.

Zendesk collection caches the current user's ID, searches tickets assigned to that user and updated in the last three calendar days, inspects at most **12** search results, skips `solved`/`closed`, finds the latest public comment, and notifies only when its author is not the current user.

> ⚠️ Despite the README and notifier comments saying notifications can run from any matched product tab without the tracker, the executed routing returns from every Rocketlane/Zendesk/Oneflow/HubSpot/Younium capture branch before `setupDesktopNotifier()`. In v1.15.0 the notifier is therefore reached only on an authorized tracker page that passes the meta-marker gate.

## 8. Gotchas

1. > ⚠️ **There are 13 `@connect` grants.** The “12 hosts” description is stale. Count from metadata when auditing the network surface.

2. > ⚠️ **The tracker meta marker protects direct key access, not just API calls.** `RocketlaneBridge.apiKey` and `getApiKey()` return the captured key. Never remove the marker gate or publish these objects on capture pages.

3. > ⚠️ **New generic Rocketlane URLs must use `gmRequest()`.** Legacy `gmFetch`/`gmPost` have no origin pin; safety currently depends on every call site constructing a `TENANT_API` URL.

4. > ⚠️ **The desktop notifier does not currently run from platform tabs.** Moving it above the capture returns would materially change behavior and security/session timing; document and test that intentionally if desired.

5. The top Zendesk auth comment is stale: a CSRF token is captured in GM storage. Only the session cookie remains uncaptured/HttpOnly.

6. Oneflow and HubSpot renewal comments overstate the **800 ms** wait. Their capture loops run every 60 seconds and there is no direct call that forces the other tab's capture function. A rotated cookie reaches GM storage during that wait only if an independent capture tick happens to occur.

7. HubSpot's origin pin allows either known hublet, not only captured `hsHost`. This prevents leakage to unrelated `@connect` hosts but does not enforce same-hublet binding for caller-supplied absolute URLs.

8. The fallback shim forwards functions only. Rocketlane's synchronous `apiKey`/`userId` getters disappear, and the already-fired ready events are not replayed. Code relying on those getters must tolerate the isolated-world fallback.

9. The double-install guard checks only `target.RocketlaneBridge`. A pre-existing Rocketlane bridge causes an early return even if one or more of the other four bridges is absent.

10. Capture timers are page-local but GM storage is cross-tab. The last active HubSpot hublet/portal and Younium region wins globally for the installation.

11. Oneflow/HubSpot non-GET calls do not throw immediately when the CSRF value is absent; they send no CSRF header, then enter the 401/403 renewal/error path. Zendesk differs and throws before sending a state-changing request if `zdCsrfToken` is absent.

12. Younium's **API** Bearer pin is explicit, but `gmYouniumRefreshToken()` constructs the Frontegg auth origin from GM key `ynRegion` without a second `new URL(...).origin` check. Normal capture can write only `eu` or `us` and the default is `eu`; the exact `@connect` grants are the remaining enforcement if GM storage is manually altered.

13. `document-start` means the exposure gate queries the marker synchronously very early. The code has no wait/retry for a marker that is not yet present.

14. Public `contentHtml` in `postChatComment()` is intentionally unescaped so Rocketlane mention markup survives. Callers own the validity/safety of that HTML sent to Rocketlane.

## 9. Constants & storage keys quick-ref

### API bases and timing

- `TENANT_API = "https://kiona.api.rocketlane.com/api/v1"`
- `ZENDESK_HOST = "https://iwmac.zendesk.com"`; `ZENDESK_API = ZENDESK_HOST + "/api/v2"`
- `ONEFLOW_HOST = "https://app.oneflow.com"`; `ONEFLOW_API = ONEFLOW_HOST + "/api"`
- `YOUNIUM_API = "https://api.younium.com"`
- `ZENDESK_RENEW_COOLDOWN_MS = 5000`
- `ONEFLOW_RENEW_COOLDOWN_MS = 5000`
- `HUBSPOT_RENEW_COOLDOWN_MS = 5000`
- notifier `POLL_MS = 60 * 1000`; first poll delay `8000`; throttle threshold `55000`

### GM storage

| Key | Meaning |
|---|---|
| `rlApiKey` | Captured Rocketlane API key. |
| `rlApiKeyCapturedAt` | Capture timestamp. |
| `rlUserId` | Rocketlane positive integer user ID. |
| `zdCsrfToken`, `zdCsrfCapturedAt` | Zendesk CSRF value and capture timestamp. |
| `ofXsrfToken`, `ofXsrfCapturedAt` | Oneflow XSRF value and capture timestamp. |
| `hsHost`, `hsPortalId` | Last captured HubSpot hublet origin and portal ID. |
| `hsCsrfToken`, `hsCsrfCapturedAt` | HubSpot CSRF value and timestamp. |
| `ynRegion`, `ynRegionCapturedAt` | `eu`/`us` auth region and timestamp. |
| `ynAccessToken` | Cached Younium access JWT. Never expose its value in logs/docs/page APIs. |
| `ynAccessTokenExpiresAt`, `ynAccessTokenCapturedAt` | Younium token expiry/capture timestamps. |
| `notif_desktop_enabled_v1` | Notification toggle; defaults enabled unless exactly `false`. |
| `notif_desktop_seen_v1` | JSON array of seen notification keys, capped at 400 on save. |
| `notif_desktop_lastpoll_v1` | Shared poll-claim timestamp. |
| `notif_desktop_primed_v1` | Whether existing backlog has been silently primed. |
| `notif_desktop_zendesk_uid` | Cached current Zendesk user ID. |
| `notif_pname_<projectId>` | Persistently cached Rocketlane project display name. |

## 10. Key functions — where to find things

- `captureNow` (line 84) — Rocketlane localStorage parse/capture; `captureZendeskCsrf` (127), `captureOneflowXsrf` (159), `captureHubSpotState` (218) — product-side capture.
- `gmRequest` (321) — pinned generic Rocketlane request; `gmFetch` (995) / `gmPost` (1028) — fixed-call-site legacy helpers; `gmUploadAttachment` (1081) — multipart + folder link.
- `gmZendeskSendRaw` (373), `zendeskRenewSession` (416), `gmZendeskRequest` (467) — raw envelope, renewal, pinned/retrying Zendesk layer.
- `gmOneflowSendRaw` (527), `oneflowRenewSession` (578), `gmOneflowRequest` (631) — Oneflow layer.
- `gmHubSpotSendRaw` (681), `hubspotRenewSession` (725), `gmHubSpotRequest` (782) — HubSpot layer and portal injection.
- `gmYouniumRefreshToken` (854), `gmYouniumRequest` (925) — Frontegg refresh, cache/expiry, pinned Bearer request.
- `plainTextToHtml` (1161) — safe plain-text conversion.
- `target.RocketlaneBridge` (1174) — generic API plus chat/attachment/project/notification helpers.
- `target.ZendeskBridge` (1520), `target.OneflowBridge` (1606), `target.HubSpotBridge` (1642), `target.YouniumBridge` (1744) — remaining exposed surfaces.
- `bridgeIsVisibleOnPage` (1956) and fallback block (1972–2261) — page-world probe and event shims.
- `claimPollSlot` (2292), `pop` (2300), `rlAuthorName` (2314), `rlProjectName` (2325), `collectRocketlane` (2340), `zendeskUid` (2381), `collectZendesk` (2388), `pollOnce` (2420) — desktop notifier.
