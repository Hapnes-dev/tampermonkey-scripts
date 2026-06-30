# Rocketlane Younium Status

Adds a **Younium** button (with the Younium logo) to the Rocketlane project navigation (right after **All files**). It **computes the plant's Younium status automatically when you open the project** and shows the colored verdict right on the button — no click needed. Clicking it opens the full **Younium order + subscription status** modal — the same verdict engine and look as the [Project Progress Tracker](https://github.com/Hapnes-dev/Project-Progress-Tracker).

## Install

👉 [**Install Rocketlane Younium Status**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-younium-status/rocketlane-younium-status.user.js)

Requires the [Tampermonkey](https://www.tampermonkey.net/) browser extension. After installing, **visit `https://eu.younium.com` once while logged in** (so the Frontegg session cookie is in the browser and the bridge can mint API tokens). Then open any Rocketlane project — the button appears in the nav.

## What it does

On a Rocketlane project page (`https://kiona.rocketlane.com/projects/<id>/…`):

1. Injects a branded pill button (Younium logo + label) into the project tab bar, immediately after **All files**.
2. Extracts the plant ID from the project name (`"10112 - Bunnpris Betna: Ny Butikk"` → `10112`).
3. **On project open** (and on every in-app navigation to another project), it queries Younium directly (CORS-bypassed via `GM_xmlhttpRequest`) for that plant's orders, promotes the most-recently-modified order as the **Order / offer**, finds the **IWMAC subscription** order (via the `plant_id` custom field), fetches invoice history + the audit event log, computes a verdict, and **tints the button + shows the verdict label** (e.g. `Younium: ✓ All good`) — no click required. Results are cached per plant for the session, and concurrent/stale computes are discarded so the button never shows the wrong plant's status.
4. **Clicking** the button opens a fullscreen-centered modal titled **"Younium status details · &lt;project name&gt;"** (instant from the cached verdict) with:
   - a colored **summary** one-liner (action-oriented),
   - a **Warnings** panel (when problems exist),
   - an **Order / offer** section (link, IDs, status, invoice status, totals, dates, *Created by* / *Last updated by* from the event log),
   - a **Subscription** section (the IWMAC subscription order's status + dates + attribution, or a "none" note for one-time sales),
   - an **Other orders for this plant** section (click-to-expand sibling orders).
5. The nav button is tinted by the verdict (🟢 green / 🟡 yellow / 🔴 red / ⚪ gray).

**Read-only** — the modal never writes to Younium.

## Verdict labels

| Color | Label | When |
|---|---|---|
| 🟢 Green | `✓ All good` | Order Invoiced **and** IWMAC subscription Active |
| 🟢 Green | `✓ Invoiced (one-time)` | Order Invoiced, no IWMAC subscription product |
| 🟡 Yellow | `⏳ Awaiting first invoice` | Order present, no posted invoices yet |
| 🟡 Yellow | `⏳ Subscription starts <date>` | Subscription start date is in the future |
| 🟡 Yellow | `⚠ Partially delivered` | Younium order is only partially delivered |
| 🔴 Red | `⚠ Activate order in Younium` | Order is Draft (status 5) — needs activation |
| 🔴 Red | `⚠ Finalize order in Younium` | Order is Created but not finalized |
| 🔴 Red | `⚠ Activate subscription in Younium` | IWMAC subscription order is Draft |
| 🔴 Red | `✗ Cancelled` / `✗ Expired` | Terminal — can't recover |
| ⚪ Gray | `No orders found` / `no plant ID` | Nothing to show for this plant |

## How it works

### Two run contexts (`@match`)

- **`*.younium.com`** — captures only the hublet **region** (`eu`/`us`) into `GM_setValue("ynRegion")`, then returns. No token is captured here.
- **`kiona.rocketlane.com`** — runs the nav button + modal. All other hosts are ignored.

### Younium auth (no token stored in the page)

The Younium API uses Frontegg JWT auth. The script mints a fresh access token on demand by POSTing to `https://auth.<region>.younium.com/frontegg/.../token/refresh` with the **HttpOnly refresh cookie** already in the browser jar (sent automatically by `GM_xmlhttpRequest`). The minted token is cached in GM storage with its expiry and used as a `Bearer` against `api.younium.com`. On a 401 it refreshes once and retries. The Bearer token is **never** attached to a non-`api.younium.com` origin. This auth core is ported verbatim from the `rocketlane-chat-bridge` `YouniumBridge`.

### Younium endpoints used

| Call | Endpoint |
|---|---|
| Search a plant's orders | `POST /api/data/query/order` (filter `plant_id` + `isLastVersion`) |
| Hydrate one order | `GET /api/order/{id}` |
| Invoice history | `POST /api/order/invoicesForHistory` `{ orderNumber }` |
| Audit event log | `GET /api/eventlog/order/id/{id}` |

### Subscription detection

An order is treated as the IWMAC subscription only when a product line matches the strict pattern `/\bIWMAC\s*(?:Abonnement|Subscription)\b/i` — i.e. literally `IWMAC Subscription` / `IWMAC Abonnement`. `IWMAC Modul: …` / `IWMAC Product: …` line items are one-time deliverables, not subscription evidence.

## Security

- **No secrets in the page.** The Younium token lives only in Tampermonkey GM storage; the Frontegg refresh cookie stays in the browser jar.
- The Bearer token is origin-scoped — `gmYouniumRequest` refuses to send it to any origin other than `https://api.younium.com`.
- All Younium response data interpolated into the modal is **HTML-escaped by default** (`renderKV` only emits verbatim HTML for code-built `RAW()` values). Every link `href` passes through `toHttpUrl()` (strips non-`http(s)` schemes).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Button doesn't appear | Make sure you're on a `…/projects/<id>/…` page; the script injects after the nav renders. |
| Modal says "Younium session expired" | Visit `https://eu.younium.com` once while logged in, then retry. |
| "Couldn't read a plant ID" | The project name must start with the plant number, e.g. `10112 - …`. |
| "No Younium orders found" | No order in Younium carries that `plant_id`, or you're in the wrong region. |

Diagnostics in DevTools: `window.__ynStatus.token()` (token/region status), `window.__ynStatus.search("<plantId>")` (raw order search), `window.closeYouniumModal()` (force-close the modal).
