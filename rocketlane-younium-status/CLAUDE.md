# Rocketlane Younium Status — technical reference

Deep technical notes for `rocketlane-younium-status/rocketlane-younium-status.user.js`, a single IIFE.
Current `@version`: **1.0.5**. Grants: `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue`.
Repo-wide rules (version bumping, commit/push, line endings) live in the **root `CLAUDE.md`** and are not
repeated here. The folder `README.md` is user-facing; when it disagrees with this reference, trust the
userscript.

---

## 1. What it is / where it runs

The script adds a Younium status pill after Rocketlane's **All files** project tab. It computes a verdict
in the background, colors the pill, and opens a read-only order/subscription detail modal on click.

- `@match https://kiona.rocketlane.com/*`
- `@match https://eu.younium.com/*`
- `@match https://us.younium.com/*`
- `@match https://app.younium.com/*`
- `@run-at document-idle`

There are two mutually exclusive runtime contexts:

1. On any hostname ending in `younium.com`, the script optionally records the region and immediately
   returns. Only exact `eu.younium.com` / `us.younium.com` hosts produce a region; `app.younium.com`
   matches the userscript but only takes the return path.
2. The UI code runs only when `location.hostname === "kiona.rocketlane.com"`. `ensure()` narrows this
   further to paths matching `^/projects/\d+`; non-project Rocketlane pages get no button.

The project name comes first from `document.title` after removing a trailing Kiona suffix, then from a
broad `h1, h2, h3, a, span, div` scan. A valid plant prefix is **2–7 digits**, followed by a hyphen or
en dash and whitespace: `^(\d{2,7})\s*[-–]\s+`.

---

## 2. Two-side architecture and authentication

### Younium side: region capture only

The exact EU/US hostname is stored as `ynRegion`; `ynRegionCapturedAt` is updated only when the region
changes. No token is read from page JavaScript. If no region was captured, `ynRegion()` defaults to
`eu`.

### Rocketlane side: token minting and API calls

`gmYouniumRefreshToken(forceRefresh)` POSTs `{}` to:

`https://auth.<region>.younium.com/frontegg/identity/resources/auth/v1/user/token/refresh`

`GM_xmlhttpRequest` runs with `anonymous: false`, so the browser's HttpOnly refresh cookie accompanies
the request. The access token and calculated expiry are saved in GM storage. Important timing:

- auth and API requests each time out after **20,000 ms**;
- `ynRefreshInFlight` coalesces concurrent refreshes;
- passive refresh attempts have a **30,000 ms** cooldown and may return the cached token;
- token TTL is clamped to at least **60,000 ms**;
- `gmYouniumRequest` treats the token as expiring **60,000 ms** before its saved expiry;
- an API 401 forces one refresh and one retry.

`gmYouniumRequest()` constructs relative requests under `https://api.younium.com` and then verifies the
parsed origin is exactly that origin before adding `Authorization: Bearer ...`. This guard is
load-bearing: an absolute URL to any other origin is rejected before the token is attached.

API endpoints:

| Purpose | Method and path |
|---|---|
| Search current order versions | `POST /api/data/query/order` |
| Hydrate an order | `GET /api/order/{id}` |
| Invoice history | `POST /api/order/invoicesForHistory` with `{ orderNumber }` |
| Order audit events | `GET /api/eventlog/order/id/{id}` |

Searches use `isLastVersion = true`; plant searches also use exact `plant_id`. The all-orders search asks
for at most **50** rows.

---

## 3. Discovery pipeline and verdict data shape

`computeYouniumStatusByPlantId(plantId, projectName)` owns the end-to-end calculation:

1. `youniumFindAllOrdersByPlantId` retrieves the plant's current order summaries. A search failure is
   deliberately converted to `[]`.
2. Summaries are sorted descending by `modified`, falling back to `created`. The first is the primary
   **Order / offer** and is hydrated with `ynGetOrderById`.
3. `findIwmacSubscriptionItem` searches eight possible line-item arrays (`bookings`, `products`,
   `charges`, `orderProducts`, `subscriptions`, `subscriptionProducts`, `lineItems`, `items`) and
   several name fields. Only `IWMAC_SUBSCRIPTION_NAME_PATTERN` —
   `/\bIWMAC\s*(?:Abonnement|Subscription)\b/i` — counts as subscription evidence.
4. If the primary order has no matching product, `youniumFindSubscriptionByPlantId` repeats the plant
   search, hydrates candidates sequentially, and returns the first order with a matching product.
5. Audit events are fetched for the primary and, when separate, subscription orders. Earliest and latest
   events are selected by `timeStamp` first, with defensive timestamp fallbacks. Event failures are
   non-fatal.
6. Primary-order invoice history is fetched; a failure becomes `[]`, which is therefore interpreted as
   no posted invoices.

The returned `out` object begins with:

`{ color, label, kind, orderStatus, deliveryStatus, subscriptionStatus, orderNumber, links,
lastCheckedAt, problems, raw, relatedOrders }`

It is augmented with `subscriptionProduct`, `hasSubscriptionProduct`, `subscriptionOrder`,
`subscriptionOrderIsSeparate`, and normalized audit events. `raw` holds the hydrated order, invoices,
event logs, and a separate subscription order when applicable.

---

## 4. Status and verdict rules — exact current precedence

### Invoice buckets

- **Posted**: `status === 2`, `status === 3`, or truthy `posted`.
- **Issued**: truthy `posted` or numeric `status >= 1`.
- **Paid**: `status === 3` or truthy `paymentDate`.

Primary `orderStatus` is assigned in this order:

1. cancellation date reached → `Cancelled`;
2. raw status `5` → `Draft`;
3. raw status `1` → `Created (not finalized)`;
4. raw status `10` → `Partially paid`;
5. every issued invoice paid → `Paid`;
6. some invoice paid → `Partially paid`;
7. any posted invoice → `Invoiced`;
8. future effective start → `Order (pending start)`;
9. current version → `Order (not invoiced)`;
10. otherwise → `Draft (outdated version)`.

Separately, raw order status `7` maps to `Partially delivered` and `8` to `Delivered` in
`deliveryStatus`; this displayed status can override `orderStatus` in the modal.

Subscription state is derived from the selected subscription order, or from the primary order when no
subscription order was found. Cancellation wins, then draft signals (`status === 5` **or** missing/
`Draft...` order number), expiry, future start, current-version-plus-start-date (`Active`), current
version without a start (`Order`), then `Unknown`.

Final `color`/`label` precedence is:

1. cancelled → red `Younium: ✗ Cancelled`;
2. expired, non-renewing primary → red `Younium: ✗ Expired`;
3. draft/outdated primary → red activation action;
4. created primary → red finalize action;
5. **zero posted invoices** → yellow `Younium: ⏳ Awaiting first invoice`;
6. a subscription product whose state is not `Active` → red subscription action/state;
7. active subscription → green `Younium: ✓ All good`;
8. `Order — not active yet` → yellow start-date label;
9. no subscription product plus a posted invoice → green `Younium: ✓ Invoiced (one-time)`;
10. otherwise → yellow uncertain.

Finally, `youniumApplyPartialDeliveryDowngrade` changes an otherwise-green status-7 order to yellow
`Younium: ⚠ Partially delivered` and adds a warning. Initial missing/no-plant and no-orders results are
gray; primary hydration failure is yellow `Younium: Error`.

---

## 5. Relationship to Project Progress Tracker

This is a **copied/ported engine, not a runtime shared module**. The userscript's copy is the block from
`extractPlantIdFromProjectName` through `computeYouniumStatusByPlantId` (currently lines 248–618).
The corresponding source lives in the separate repository at:

- `Project-Progress-Tracker/Project Progress Tracker.html`, starting around
  `IWMAC_SUBSCRIPTION_NAME_PATTERN` / `findIwmacSubscriptionItem` (line 11791), status helpers
  (around 12047), and `computeYouniumStatus` (line 12149);
- `Project-Progress-Tracker/index.html`, which is currently byte-identical to the named HTML file.

The tracker has saved-link, quote-conversion, stale-version, and bridge-specific paths that do not
belong wholesale in this plant-ID-only userscript. Synchronize the common subscription matcher, invoice
predicate, delivery/payment labels, partial-state downgrades, order/subscription derivation, and verdict
priority deliberately.

> ⚠️ **The copies are already not identical.** The tracker currently maps order statuses `10` and `11`
> in `youniumDeliveryStatusLabel` and downgrades an otherwise-green `Partially paid` verdict; this
> userscript's helper maps only `7`/`8` (although its primary order derivation separately handles status
> `10`). A future verdict change must be checked in both repositories rather than assuming the “ported”
> comment guarantees parity.

---

## 6. Session cache, stale-result protection, and SPA lifecycle

Four in-memory mechanisms prevent redundant or incorrect rendering:

- `verdictCache`: plant ID → verdict for the lifetime of this page session;
- `inflightPlants`: plant ID → Promise, deduplicating concurrent modal/background requests;
- `ynRenderGen`: monotonic generation checked after modal refresh/open and related async rendering;
- `ynSessionUnavailable`: suppresses further automatic calls after a recognized session error.

The button also stores the plant in `btn.dataset.plantId`; `applyVerdictToButton` discards a result when
the user has navigated to another plant. An explicit modal open clears `ynSessionUnavailable`; the modal
**Refresh status** action additionally deletes that plant's cached/in-flight entries.

Rocketlane is an SPA. A `MutationObserver` only schedules reinjection while the button is absent
(`scheduleEnsure`, **300 ms** debounce). Wrapped `history.pushState` / `replaceState` plus `popstate`
schedule checks after **60, 350, and 900 ms**. Startup also polls every **500 ms** until the button is
found or `tries > 40`. Nav discovery prefers `[class*="TabsWrapperDefault-"]`, then finds an All files /
Alle filer link or `[class*="TabWrapper-"]` cell.

---

## 7. Modal rendering and security boundaries

`ensureDialog` creates one native `<dialog>` with summary, warning, Order / offer, Subscription, and
Other orders sections. Other-order summaries are lazy: expanding a row hydrates that order and fetches
invoice history plus events in parallel. Rows initially labelled `Active` receive a separate background
invoice lookup and may become `Invoiced` or `Not invoiced`; the modal body generation prevents an older
lookup from rewriting a newer render.

Dynamic values go through `escHtml`. `renderKV` emits raw HTML only for objects created locally through
`RAW()`, and link targets pass through `toHttpUrl`, which accepts only HTTP(S). Order links use the saved
EU/US region. The remote Younium logo has an error handler that simply hides the image.

The diagnostic surface is intentionally small: `window.__ynStatus.token()`, `.api(...)`, `.search(pid)`,
plus `window.closeYouniumModal()`.

---

## 8. Gotchas

1. **“Shared engine” means duplicated maintenance.** There is no import from Project Progress Tracker;
   use the sync points in §5.
2. **Verdict branch order is behavior.** “No posted invoice” wins before a broken subscription, so a
   Draft subscription can still present `Awaiting first invoice` until an invoice exists.
3. **Two apparently useful subscription branches are effectively shadowed.**
   `subIsRawDraft` includes every draft-looking order number, so the later
   `subIsRawCreated = status === 1 && subOrderNumberLooksDraft` branch cannot win. Likewise a real
   subscription in `Order — not active yet` is caught first by “subscription not Active” and rendered
   red; the later yellow start-date branch is reachable only without `hasSubscriptionProduct`.
4. The yellow start-date label uses the **primary** `order.effectiveStartDate`, not
   `subscriptionOrder.effectiveStartDate`.
5. `isExpired` changes the final verdict to red, but the current `orderStatus` derivation never assigns
   the literal `Expired`; renderer branches that test `orderStatus === "Expired"` are therefore not fed
   by this calculator.
6. **A failed invoice call becomes an empty list.** That is indistinguishable from a real “no invoices”
   result and produces `Awaiting first invoice`.
7. `verdictCache` has no time expiry. Only explicit modal refresh or a full page session restart fetches
   fresh data for an already-seen plant.
8. The button cache key is plant ID, not Rocketlane project ID/name. Projects sharing a plant ID share
   one session verdict.
9. `app.younium.com` does not establish a region. Visit the exact EU or US hublet; otherwise auth
   defaults to EU.
10. New auth/API hosts require matching `@connect` entries. Keep the exact-origin check in
    `gmYouniumRequest` when changing request construction.

> ⚠️ **Never remove the API origin guard or interpolate unescaped response data into modal HTML.** Those
> two controls keep the bearer token on `api.younium.com` and Younium data out of executable markup.

---

## 9. Constants & storage keys quick-ref

- `UI_LOCALE = "nb-NO"`
- `YOUNIUM_API = "https://api.younium.com"`
- `IWMAC_SUBSCRIPTION_NAME_PATTERN = /\bIWMAC\s*(?:Abonnement|Subscription)\b/i`
- `YOUNIUM_LOGO_URL`: Younium-hosted icon URL
- GM keys: `ynRegion`, `ynRegionCapturedAt`, `ynAccessToken`, `ynAccessTokenExpiresAt`,
  `ynAccessTokenCapturedAt`
- In-memory only: `ynRefreshInFlight`, `ynLastRefreshAttempt`, `verdictCache`, `inflightPlants`,
  `ynRenderGen`, `ynSessionUnavailable`
- Timing: auth/API **20,000 ms**; passive refresh cooldown **30,000 ms**; expiry margin/minimum TTL
  **60,000 ms**; observer debounce **300 ms**; route checks **60/350/900 ms**; boot poll **500 ms**.

## 10. Key functions — where to find things

`ynRegion` / `ynOrderUrl` (region-aware links) · `gmYouniumRefreshToken` / `gmYouniumRequest`
(auth and origin-scoped API transport) · `ynSearchOrders` / `ynGetOrderById` /
`ynGetInvoicesForOrder` / `ynGetOrderEventLog` (API surface) · `extractPlantIdFromProjectName` /
`readProjectName` / `getPlantContext` (Rocketlane identity) · `findIwmacSubscriptionItem` /
`youniumFindAllOrdersByPlantId` / `youniumFindSubscriptionByPlantId` (discovery) ·
`youniumInvoiceIsPosted` / `youniumDeliveryStatusLabel` /
`youniumApplyPartialDeliveryDowngrade` / `youniumRelatedOrderStatusLabel` (shared-rule helpers) ·
`computeYouniumStatusByPlantId` (verdict engine) · `computeForPlant` /
`applyVerdictToButton` / `refreshButtonForCurrentProject` (cache and background status) ·
`ensureDialog` / `renderYouniumStatusModalBody` / `openYouniumStatusModal` (modal) ·
`escHtml` / `toHttpUrl` (output safety) · `getNavRow` / `getAllFilesCell` / `buildNavButton` / `ensure` /
`scheduleEnsure` / `onRouteChange` (SPA injection).
