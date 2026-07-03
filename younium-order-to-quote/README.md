# Younium Order to Quote

Adds a **Copy from order** button to the Younium **quote** page toolbar — immediately left of **Preview & Send**, styled identically to Younium's own toolbar buttons (the button is a live clone of *Preview & Send* with a `content_copy` icon, so it inherits the exact pill shape, colors, and hover). Click it, type an existing order number (e.g. `O-015091`), and it copies every product from that order onto the current quote, carrying over each charge's **ordered quantity** and **discount %**. Prices come from the quote's current price list; only quantity and discount are copied.

## Install

👉 [**Install Younium Order to Quote**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/younium-order-to-quote/younium-order-to-quote.user.js)

Requires the [Tampermonkey](https://www.tampermonkey.net/) browser extension. After installing, **visit `https://eu.younium.com` once while logged in** (so the Frontegg session cookie is in the browser and the script can mint API tokens). Then open any quote — the button appears in the header bar.

## What it does

On a Younium quote page (`https://<region>.younium.com/quotes/…`):

1. Injects **Copy from order** into the toolbar, immediately left of **Preview & Send**. The button is built by cloning the native *Preview & Send* button (Material classes + Angular scope attributes) and swapping the icon (`data-icon` → `content_copy`) and label — so it always matches Younium's own look; if Younium's button structure ever changes, a self-styled fallback pill is used instead.
2. Clicking it opens a small dialog. Type an order number (any of `O-015091`, `15091`, `o 15091` — it's normalized to `O-015091`) and press **Fetch**.
3. The script resolves the current quote (from the URL UUID, or the `Q-…` number in the header), looks up the order, and shows a confirmation: order number, description, account, and product count.
4. On **Add N products**, for each product on the order it:
   - creates the quote product (`POST /api/quote/product/create` with the order line's `productId` + `chargePlanId`), which seeds the charge-plan charges at list price;
   - matches each created quote charge to the order charge (by catalog `chargeId`, falling back to charge name) and applies the order's **ordered quantity** + **discount %**, letting Younium's `calculateQuoteChargePrices` recompute every derived amount server-side;
   - saves the batch (`PUT /api/quote/products/charges`), refreshes KPIs, and reloads the page.
5. A live log shows each charge as it's applied, plus any warnings (e.g. an order charge that doesn't exist on the current charge plan and must be added manually). **A product that can't be added doesn't abort the copy** — it's logged as a warning and the rest continue; the summary line reports `added X of Y product(s)`. If *nothing* could be added (e.g. a pure subscription order copied onto a sales quote), the run ends with a clear error instead of a success message.

### Verified charge coverage

Tested live against real tenant data (2026-07): quantity charges (model 1, incl. qty 105 lines), flat fees (model 0), tiered (model 2, up to 8 tiers), volume (model 3), one-off (type 0) and recurring (type 1) — quantities and discount % copy exactly; prices always re-price from the quote's current price list. Charges that exist on the quote's charge plan but not on the source order keep their plan defaults (typically qty 0, contributing nothing) and are logged.

**What is copied:** ordered quantity + discount % per charge.
**What is *not* copied:** unit/list prices — those always follow the quote's current price list, so the quote reflects up-to-date catalog pricing.

## How it works

### Run context (`@match`)

Runs on `eu.younium.com` / `us.younium.com` (also `app.younium.com` inherited from the region default). The button only injects on `/quotes/…` paths; it's removed on other pages. A `MutationObserver` + href poll re-injects across the SPA's client-side navigations.

### Younium auth (no token stored in the page)

The Younium API uses Frontegg JWT auth. The script mints a fresh access token on demand by POSTing to `https://auth.<region>.younium.com/frontegg/identity/resources/auth/v1/user/token/refresh` with the **HttpOnly refresh cookie** already in the browser jar (sent automatically by `GM_xmlhttpRequest`). The token is cached in GM storage with its expiry and sent as a `Bearer` against `api.younium.com`, refreshed 60 s before expiry and force-refreshed once on a 401. The Bearer is **origin-pinned** — `gmYouniumRequest` refuses to attach it to any origin other than `https://api.younium.com`. This auth core is ported from the `rocketlane-younium-status` script / the `rocketlane-chat-bridge` `YouniumBridge`.

### Younium endpoints used

| Call | Endpoint |
|---|---|
| Resolve a quote by number | `POST /api/data/query/quote` (filter `number`) |
| Hydrate the quote | `GET /api/quote/{id}` |
| Find an order by number | `POST /api/data/query/order` (filter `orderNumber` + `isLastVersion`) |
| Hydrate the order (products + charges + quantities + discounts) | `GET /api/order/{id}` |
| Add a product to the quote | `POST /api/quote/product/create` `{ quoteId, productId, chargePlanId, currencyCode }` |
| Recompute a charge's prices | `POST /api/quote/calculateQuoteChargePrices/` |
| Save the charge batch | `PUT /api/quote/products/charges` |
| Refresh quote KPIs | `PUT /api/quote/{id}/calculateKPIs` |

### Order → quote charge matching

An order product line carries `chargePlan.productId` + `chargePlanId`; the quote-product create uses those so the same charge plan (hence the same catalog charges) is seeded. Each order charge exposes `orderedQuantity` (fallback `quantity`) and `discountPercentage`. Created quote charges are matched to order charges by **catalog `chargeId`** first, then by normalized charge **name**, so quantity and discount land on the right line even when a plan has several similarly-named charges.

## Security

- **No secrets in the page.** The Younium token lives only in Tampermonkey GM storage; the Frontegg refresh cookie stays in the browser jar.
- The Bearer token is origin-scoped — `gmYouniumRequest` refuses to send it to any origin other than `https://api.younium.com`.
- All order/quote data interpolated into the confirmation dialog is HTML-escaped (`escHtml`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Button doesn't appear | Make sure you're on a `…/quotes/<id>` page; the script injects after the toolbar renders. |
| "Younium session expired" | Visit `https://eu.younium.com` once while logged in, then retry. |
| "No order found for O-…" | The order number doesn't exist in this region/tenant, or isn't the last version. |
| "… not on the current charge plan, add manually" | The order used a charge the product's current charge plan no longer has — add that charge line by hand. |
| "⚠ … Younium won't allow this product on this quote type" | Subscription products (e.g. `IWMAC Subscription: Basic`) can only go on quotes whose order type allows them — Younium rejects them on a SalesOrder-type quote (`HTTP 400: Product doesn't support OrderType "SalesOrder"`). Copy subscription orders onto a subscription-type quote instead; the other products still copy fine. |
| "✖ No products could be added to this quote" | Every product on the order was rejected (typically a pure subscription order → sales quote). Nothing was written. |

Diagnostics in DevTools: `window.__ynO2q.token()` (token/region status), `window.__ynO2q.findOrder("O-015091")` (raw order lookup).
