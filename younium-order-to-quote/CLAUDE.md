# Younium Order to Quote — technical reference

Technical notes for `younium-order-to-quote/younium-order-to-quote.user.js`, a single IIFE. Current
`@version`: **1.2**. Grants: `GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`. Repo-wide rules for
version bumps, commits, pushes, and Tampermonkey releases live in the **root `CLAUDE.md`** and are not
repeated here. The header has both `@updateURL` and `@downloadURL` pointing at this file on
`raw.githubusercontent.com`.

---

## 1. What it is / where it runs

Adds **Copy from order** immediately before Younium's **Preview & Send** quote-toolbar button. The
dialog resolves an order, confirms its products, creates those products on the current quote, and
copies each matched charge's quantity and discount percentage. Catalog prices are deliberately taken
from the quote's current charge plan.

- Exact matches: `https://eu.younium.com/*` and `https://us.younium.com/*`.
- `@run-at document-idle`.
- `onQuotePage()` further requires `location.pathname` to match `/^\/quotes\/[^/]+/`. `injectButton()`
  removes a stale `#ynO2qBtn` after SPA navigation to any other path.
- `region()` reads `eu` or `us` from the exact hostname; its fallback is
  `GM_getValue("ynRegion", "eu")`. This script never writes `ynRegion`.

> ⚠️ The README says `app.younium.com` is inherited from the region default, but the userscript has no
> `@match` for that host. Tampermonkey will not run this script there.

## 2. Authentication and the API wrapper

`gmYouniumRefreshToken(forceRefresh)` POSTs `{}` to
`https://auth.<region>.younium.com/frontegg/identity/resources/auth/v1/user/token/refresh` through
`GM_xmlhttpRequest` with `anonymous: false`, allowing the browser's HttpOnly refresh cookie to be sent.
The request timeout is **20000 ms**. The returned `accessToken` is stored with an expiry; `expiresIn`
is clamped to at least **60000 ms**.

`gmYouniumRequest(method, path, body)` is the only general API path:

- Relative paths are joined to `YOUNIUM_API = "https://api.younium.com"`.
- Before attaching the Bearer, the computed origin must equal exactly `https://api.younium.com`.
- A missing token, missing expiry, or expiry within **60000 ms** triggers a refresh. Concurrent refreshes
  share `ynRefreshInFlight`; within **30000 ms** of a non-forced attempt, an existing cached token wins.
- API calls use **30000 ms**, `anonymous: false`, `accept: application/json`,
  `X-Younium-Origin: frontend`, and JSON content type when a body exists.
- One `401` causes one forced refresh and retry. A final `401`/`403` becomes a session-expired error;
  other non-2xx responses include at most the first **300** response characters.
- An empty or non-JSON successful body becomes `null`.

Header `@connect` entries cover `auth.eu.younium.com`, `auth.us.younium.com`, and `api.younium.com`.

## 3. Resolving the source order and destination quote

`normalizeOrderNumber()` strips all non-digits, uppercases first, pads to six digits, and returns
`O-<digits>` (`15091`, `o 15091` → `O-015091`). Empty/no-digit input returns `null`.

`findOrderByNumber()` POSTs `/api/data/query/order`, page 0 / size 5, sorted by `modified desc`, with
exact conditions for `orderNumber` and `isLastVersion: true`; it returns the first result. The quote is
resolved by `resolveCurrentQuote()`:

1. Prefer a UUID in `/quotes/<uuid>`.
2. Otherwise scan `h1`–`h5` text for `Q-` plus at least three digits and resolve its ID through
   `POST /api/data/query/quote` (page size 5, `number desc`).
3. Hydrate the destination with `GET /api/quote/{id}` and require an `id`.

The Fetch stage also hydrates `GET /api/order/{id}` to count non-deleted, non-added-charge products.
After confirmation, `copyOrderToQuote()` hydrates the order again and performs the copy from that
second payload.

## 4. Copy and charge-recalculation flow

`copyOrderToQuote(order, quote, log)` filters `orderFull.orderProducts` to entries where both
`!isDeleted` and `!isAddedCharge`. It processes products sequentially:

1. Read `productId` from `p.chargePlan.productId`; read `chargePlanId` from `p.chargePlanId`, falling
   back to `p.chargePlan.id`. Missing references produce a warning and skip that product.
2. `POST /api/quote/product/create` with `{ quoteId, productId, chargePlanId, currencyCode }`.
   Currency falls back from `quote.currencyCode` to `orderFull.currency` to `"NOK"`. Product-create
   errors are warnings and do not stop later products; the known `doesn't support OrderType` response
   is rewritten into a subscription-product/sales-quote explanation.
3. For every returned `quoteProductCharge`, find one unused, non-deleted order charge by exact
   `chargeId`; if none matches, fall back to exact `normName()` equality (lowercase, collapsed
   whitespace, trimmed). `usedOrderChargeIds` makes matching one-to-one.
4. `recalcChargeLikeOrder()` deep-clones the quote charge, sets top-level `quantity`, and applies
   `lineDiscountPercent` to every `quoteProductChargeDetails` row. When a finite
   `listPrice.amount` exists, it updates the row's existing `price` and `lineDiscountAmount` objects,
   if present, with values rounded by `round2()`. It then POSTs the whole charge to
   `/api/quote/calculateQuoteChargePrices/`; that server response, not the local intermediate object,
   goes into `chargeBatch`.
5. After all products, save a non-empty batch with `PUT /api/quote/products/charges`. If any product
   was created, attempt `PUT /api/quote/{id}/calculateKPIs`.

Quantity is `orderedQuantity` only when it parses greater than zero, otherwise `quantity`; invalid
numbers become 0 through `num()`. Discount comes from `discountPercentage`, with invalid values also 0.
The result shape is `{ productCount, createdCount, chargeCount, warnings }`.

## 5. UI and SPA lifecycle

`findPreviewSendButton()` scans buttons and picks the first whose whitespace-normalized text ends in
`Preview & Send`. `buildClonedButton()` clones it, assigns `#ynO2qBtn`, removes descendant IDs, swaps the
Material icon's class/`data-icon` to `content_copy`, replaces the label, and relies on `cloneNode(true)`
not copying the original event listeners. If the expected label structure is absent, `injectButton()`
uses a self-styled `ynO2qFallback` button instead.

`openDialog()` creates `#ynO2qOverlay`. It restores `ynO2qLastOrder`, supports Fetch by button or Enter,
and permits Escape/backdrop/close-button dismissal only while `busy` is false. Order, account, quote,
and description values inserted into confirmation HTML pass through `escHtml()`. Progress lines use
`textContent`. A successful run with at least one created product reloads after **1600 ms**.

SPA survival uses both a **600 ms** href poll and a subtree `MutationObserver` on
`document.documentElement`; the element-ID guards make repeated `injectButton()` calls cheap. DevTools
diagnostics expose `window.__ynO2q.token()` (presence/expiry/region only) and
`window.__ynO2q.findOrder()`.

## 6. Gotchas

> ⚠️ The copy is not transactional. Each `/api/quote/product/create` mutates the quote immediately,
> before the final charge-batch PUT. A later fatal batch-save/API failure can leave already-created
> products on the quote; there is no rollback or duplicate detection on retry.

> ⚠️ Do not copy order prices. The load-bearing contract is **quantity + discount only**. New quote
> products are seeded from the current catalog, and `/api/quote/calculateQuoteChargePrices/` computes
> derived money fields server-side.

- A quote-plan charge absent from the order is left at the plan default and only logged. An order charge
  absent from the current plan produces a manual-add warning. Name fallback is normalized equality, not
  fuzzy matching.
- Product creation and per-charge recalculation errors are deliberately isolated so later products and
  charges continue. In contrast, the final charge-batch PUT is not caught inside `copyOrderToQuote()`.
- KPI recalculation errors are silently swallowed. Product/charge writes may be correct even if KPI
  refresh failed, and the UI gives no specific KPI warning.
- `createdCount` increments before checking whether the create response has charges. A product returned
  with no charges still counts as added and can lead to a success/reload with zero updated charges.
- The order is fetched once for confirmation count and again after confirmation. Removing the second GET
  changes which snapshot is copied.
- The UUID URL parser is strict. Non-UUID quote routes depend on finding a visible `Q-\d{3,}` in an
  `h1`–`h5` element and then on the query endpoint.
- The token is not placed in page DOM or diagnostics, but it **is** persisted in Tampermonkey GM storage.
  Keep the exact-origin guard in front of the Authorization header.
- The global subtree observer is intentionally noisy; `#ynO2qBtn` and `#ynO2qStyle` existence checks
  prevent duplicate injection.

## 7. Constants & storage keys quick-ref

| Identifier / key | Value / purpose |
|---|---|
| `YOUNIUM_API` | `https://api.younium.com` |
| `ynAccessToken` | cached Frontegg JWT |
| `ynAccessTokenExpiresAt` | absolute expiry timestamp used for the 60 s early-refresh test |
| `ynAccessTokenCapturedAt` | capture timestamp; written but not read by this script |
| `ynRegion` | `region()` fallback; read but not written here |
| `ynO2qLastOrder` | last successfully resolved normalized order number |
| `ynRefreshInFlight` | in-memory shared refresh promise |
| `ynLastRefreshAttempt` | in-memory 30 s refresh-throttle timestamp |
| `#ynO2qBtn` / `#ynO2qStyle` | injected toolbar button / stylesheet guards |
| `#ynO2qOverlay` | one-dialog-at-a-time guard |

Timeouts: auth **20000 ms**, API **30000 ms**, href poll **600 ms**, post-success reload **1600 ms**.

## 8. Key functions — where to find things

`region` (host/region fallback) · `gmYouniumRefreshToken` (cookie-backed JWT mint/cache) ·
`gmYouniumRequest` (origin-pinned API wrapper and 401 retry) · `normalizeOrderNumber` (canonical `O-` form) ·
`findOrderByNumber` / `findQuoteIdByNumber` / `resolveCurrentQuote` (entity resolution) · `num` / `round2` /
`normName` (charge helpers) · `recalcChargeLikeOrder` (quantity/discount payload + server repricing) ·
`copyOrderToQuote` (main mutation pipeline) · `escHtml` (confirmation escaping) · `ensureStyle` (UI CSS) ·
`onQuotePage` / `findPreviewSendButton` / `buildClonedButton` / `injectButton` (toolbar lifecycle) ·
`openDialog` (fetch/confirm/copy UI and nested `fetchOrder`/`log`).
