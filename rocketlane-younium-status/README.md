# Rocketlane improvements

One Tampermonkey userscript with eight independent improvements for `kiona.rocketlane.com`:

1. **Younium status** — a status chip in the project nav plus a full **Younium status details** modal (formerly *Rocketlane Younium Status*).
2. **Gantt calendar + floating chat panel** — hide the timeline half of project-plan pages behind a toggle, and chat from the timeline (formerly *Rocketlane Enhancer* v2.0, merged in v1.2.0).
3. **Project Notes column** — a writable Note column on the Projects list with toolbox SQL persistence (formerly *Rocketlane Project Notes Column* v1.10.0, merged in v1.2.0). **Off by default since v1.4.2.**
4. **Oneflow signing status** — an "Oneflow: …" chip right of the Younium chip plus an **Oneflow status details** modal (ported from the tracker's Oneflow checker in v1.3.0).
5. **Delivery to service** — the tracker's handover wizard on the **Handover to service** task card, which can create the Zendesk handover ticket and tick the task complete (ported in v1.4.0).
6. **Project action buttons** (v1.10.6) — **Files** and **Order info** popovers match **Younium status details**: dark `#0f1424` shell, translucent white inner cards (`.youniumSection` / `.rlOiSection`), off-white body text. Fetch / Delivery unchanged. **v1.11.1:** **Add category** pill + plan `+` menu entry; **From order info / HubSpot line items** is first in the native **Choose templates** dropdown (and above **Choose a template** on empty plans).
7. **Zendesk cases** (v1.10.9) — PPT dark `#0f1424` shell + faded-white rows; title forced light for contrast; panel sits ~20px below tabs. Renames **Project updates** → **Zendesk cases**. Needs leading plant number + logged-in Zendesk session.
8. **Home PROJECTS panel** (v1.12.0) — on `https://kiona.rocketlane.com/` (`pathname === "/"`), a PPT-style dark **PROJECTS** panel below the greeting (native Incomplete/Overdue widgets stay). Cards show %, status/due pills, cyan progress bar; owner groups with pin + Due/Progress sort. Data from `POST /projects/lightV1` (owner/member filter, exclude `[Tracker] Workload Sync`); progress = completed / (todo+inprogress+completed+blocked). `+ RL Project` → `/projects`.

The folder, file and install link kept the old `rocketlane-younium-status` path, so a copy installed under the old name keeps auto-updating.

## Install

👉 [**Install Rocketlane improvements**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-younium-status/rocketlane-younium-status.user.js)

Requires the [Tampermonkey](https://www.tampermonkey.net/) browser extension.

- For the Younium status: **visit `https://eu.younium.com` once while logged in** (so the Frontegg session cookie is in the browser and the script can mint API tokens). Then open any Rocketlane project — the chip appears in the nav.
- **If you had *Rocketlane Enhancer* or *Rocketlane Project Notes Column* installed, uninstall them in Tampermonkey** after installing this script. Their features live here now; the old scripts no longer receive updates.
- Notes: the column width and a custom SQL API URL start from their defaults after the merge (the old script's settings are in its own Tampermonkey storage). The notes themselves are read back from the toolbox SQL table.
- For the Oneflow status: be logged in to `https://app.oneflow.com` in the same browser — the script uses your Oneflow session cookie, read-only.
- For Delivery to service: **open `https://iwmac.zendesk.com` once while logged in**, so the script can capture the CSRF token it needs to create the handover ticket. Copy-to-clipboard works without it.

---

## 1. Younium status

On a Rocketlane project page (`https://kiona.rocketlane.com/projects/<id>/…`):

1. Injects a pill chip (Younium logo + label, the same chip style as the [Project Progress Tracker](https://github.com/Hapnes-dev/Project-Progress-Tracker)'s project-header Younium status chip) into the project tab bar, immediately after **All files**.
2. Extracts the plant ID from the project name (`"10112 - Bunnpris Betna: Ny Butikk"` → `10112`).
3. **On project open** (and on every in-app navigation to another project), it queries Younium directly (CORS-bypassed via `GM_xmlhttpRequest`) for that plant's orders, promotes the most-recently-modified order that is not the subscription agreement (an "… Abonnementsavtale") as the **Order / offer**, finds the **IWMAC subscription** order (via the `plant_id` custom field), fetches invoice history + the audit event log, computes a verdict, and **tints the chip + shows the verdict label** (e.g. `Younium: ✓ All good`) — no click required. Results are cached per plant for the session, and concurrent/stale computes are discarded so the chip never shows the wrong plant's status.
4. **Clicking** the chip opens a fullscreen-centered modal titled **"Younium status details · &lt;project name&gt;"** (instant from the cached verdict) with:
   - a colored **summary** one-liner (action-oriented),
   - a **Warnings** panel (when problems exist),
   - an **Order / offer** section (link, IDs, status, invoice status, totals, dates, *Created by* / *Last updated by* from the event log),
   - a **Subscription** section (the IWMAC subscription order's status + dates + attribution, or a "none" note for one-time sales),
   - an **Other orders for this plant** section (click-to-expand sibling orders).
5. The chip is tinted by the verdict (🟢 green / 🟡 yellow / 🔴 red / ⚪ gray), and its hover tooltip lists the problems behind a yellow/red verdict.

**Read-only** — the modal never writes to Younium.

### Verdict labels

| Color | Label | When |
|---|---|---|
| 🟢 Green | `✓ All good` | Order Invoiced **and** IWMAC subscription Active |
| 🟢 Green | `✓ Invoiced (one-time)` | Order Invoiced, no IWMAC subscription product |
| 🟡 Yellow | `⏳ Awaiting first invoice` | Order present (an activated order reads *Active*), no posted invoices yet |
| 🟡 Yellow | `⏳ Subscription starts <date>` | Subscription start date is in the future |
| 🟡 Yellow | `⚠ Partially delivered` | Younium order is only partially delivered |
| 🟡 Yellow | `— Partially paid` | Younium order is invoiced but not fully paid (status 10) |
| 🔴 Red | `⚠ Activate order in Younium` | Order is Draft (status 5) — needs activation |
| 🔴 Red | `⚠ Finalize order in Younium` | Order is Created but not finalized (status 1 with a draft-looking number) |
| 🔴 Red | `⚠ Activate subscription in Younium` | IWMAC subscription order is Draft |
| 🔴 Red | `✗ Cancelled` / `✗ Expired` | Terminal — can't recover |
| ⚪ Gray | `No orders found` / `no plant ID` | Nothing to show for this plant |

### How it works

**Two run contexts (`@match`)**

- **`*.younium.com`** — captures only the hublet **region** (`eu`/`us`) into `GM_setValue("ynRegion")`, then returns. No token is captured here.
- **`kiona.rocketlane.com`** — runs the chip + modal (and the two other modules below). All other hosts are ignored.

**Younium auth (no token stored in the page)**

The Younium API uses Frontegg JWT auth. The script mints a fresh access token on demand by POSTing to `https://auth.<region>.younium.com/frontegg/.../token/refresh` with the **HttpOnly refresh cookie** already in the browser jar (sent automatically by `GM_xmlhttpRequest`). The minted token is cached in GM storage with its expiry and used as a `Bearer` against `api.younium.com`. On a 401 it refreshes once and retries. The Bearer token is **never** attached to a non-`api.younium.com` origin. This auth core is ported verbatim from the `rocketlane-chat-bridge` `YouniumBridge`.

**Younium endpoints used**

| Call | Endpoint |
|---|---|
| Search a plant's orders | `POST /api/data/query/order` (filter `plant_id` + `isLastVersion`) |
| Hydrate one order | `GET /api/order/{id}` |
| Invoice history | `POST /api/order/invoicesForHistory` `{ orderNumber }` |
| Audit event log | `GET /api/eventlog/order/id/{id}` |

**Subscription detection**

An order is treated as the IWMAC subscription only when a product line matches the strict pattern `/\bIWMAC\s*(?:Abonnement|Subscription)\b/i` — i.e. literally `IWMAC Subscription` / `IWMAC Abonnement`. `IWMAC Modul: …` / `IWMAC Product: …` line items are one-time deliverables, not subscription evidence.

### Security

- **No secrets in the page.** The Younium token lives only in Tampermonkey GM storage; the Frontegg refresh cookie stays in the browser jar.
- The Bearer token is origin-scoped — `gmYouniumRequest` refuses to send it to any origin other than `https://api.younium.com`.
- All Younium response data interpolated into the modal is **HTML-escaped by default** (`renderKV` only emits verbatim HTML for code-built `RAW()` values). Every link `href` passes through `toHttpUrl()` (strips non-`http(s)` schemes).

### Troubleshooting

| Symptom | Fix |
|---|---|
| Chip doesn't appear | Make sure you're on a `…/projects/<id>/…` page; the script injects after the nav renders. |
| Modal says "Younium session expired" | Visit `https://eu.younium.com` once while logged in, then retry. |
| "Couldn't read a plant ID" | The project name must start with the plant number, e.g. `10112 - …`. |
| "No Younium orders found" | No order in Younium carries that `plant_id`, or you're in the wrong region. |

---

## 2. Gantt calendar + floating chat panel

Formerly *Rocketlane Enhancer* (v2.0). Runs at `document-start` so the calendar never flashes before it is hidden.

### Hide the Gantt calendar

- On any project page (`/projects/<id>/…`) the right-side Gantt chart is hidden — timeline bars, month/week headers, the splitter divider and the toolbar row — and the task list on the left expands to fill the full width.
- A **calendar toggle button** (calendar icon) is injected next to the **Present** button. Click it to show or hide the calendar; the preference persists in `localStorage` (`rl-calendar-hidden`, hidden by default).

### Floating chat panel

- Appears on the timeline page (`/projects/<id>/plan/timeline`) and loads the project's chat conversations in iframes so you can chat without leaving the timeline.

| Capability | Detail |
|---|---|
| Conversation tabs | Private and General — instant switch (both iframes preloaded) |
| Draggable | Grab the header bar to move the panel |
| Resizable | Drag any edge or corner (8 resize handles) |
| Collapsible | Arrow button collapses to the header bar only |
| Closable | X button removes the panel until the next navigation |
| Persistent | Size, collapsed state and active tab saved to `localStorage` (`rl-floating-chat-*`) |

The two conversation IDs are hardcoded near the top of the module (`CONVERSATIONS`: `12287338` Private, `12287339` General). Find IDs in the URL when opening a chat (`/chat/<id>`) and update them there if your project uses different conversations. The panel injects CSS into each chat iframe to hide the app chrome and the conversation sidebar so only the message list and the composer remain.

---

## 3. Project Notes column

> **Disabled since v1.4.2.** The `Note` column no longer appears on the Projects list. Only the module's invocation is gated — the code below is unchanged and **nothing was deleted from `team_status.iw_project_notes`**, so every note already saved is still on the server. To bring the column back, set `RL_NOTES_COLUMN_ENABLED = true` near the top of the userscript (search for "Module 3").

Formerly *Rocketlane Project Notes Column* (v1.10.0). Adds a writable **Note** column after the project name on the Rocketlane Projects list (AG Grid). Notes persist to the Toolbox SQL API (`team_status.iw_project_notes`) with a local Tampermonkey-storage fallback; the header shows the live SQL save status and offers a `/health` connection test.

### Features

- Empty cells show an `Add note…` placeholder. Each cell has two hover buttons: `✎` **Edit** (inline editor in the cell) and `⤢` **Expand** (a roomy popover editor, resizable, Alt+Enter maximizes, Ctrl/Cmd+Enter saves, Esc cancels).
- URLs render as blue links **while you type** (the editors are `contenteditable`, not textareas) and in the display cell. Click a link to open it in a new tab; hold **Alt** while clicking to place the caret inside the URL.
- Inline editor: Enter saves, Shift+Enter inserts a newline. Popover: Enter inserts a newline, Ctrl/Cmd+Enter saves. Paste and drop are forced to plain text.
- The header is resizable (drag handle; width saved to GM storage) and shows the SQL status:

| Icon | Meaning |
|---|---|
| `…` | Pulsing gray — SQL request in flight |
| `✓` | Green — last save/delete succeeded (auto-fades) |
| `!` | Red — SQL call failed, note saved locally only. Click for details and retry. |
| `⚡` | Run `GET <api>/health` and report the result |
| `⚙` | Configure the SQL API URL (prompt; runs the health check afterwards) |

### SQL API contract

POST form-encoded `sql_command=<SQL>` to `http://toolbox.iwmac.local:8505/toolbox-sql` (configurable via `⚙`). The API only allows `SELECT/INSERT/UPDATE/DELETE` and returns JSON `{success, results: [{data|affected_rows, ...}], request_id, error}`.

| Operation | SQL |
|---|---|
| Read all | `SELECT project_id, note FROM team_status.iw_project_notes` (on load and every 60 s) |
| Upsert | `UPDATE … SET note='…', updated_at='…' WHERE project_id='…'`; if no row was affected, `INSERT INTO … (project_id, note, updated_at) VALUES (…)` |
| Delete | `DELETE FROM team_status.iw_project_notes WHERE project_id='…'` |
| Health | `GET /toolbox-sql/health` — `200` OK, `503` MariaDB down |

Create the schema once on the MariaDB host (the Toolbox SQL API blocks DDL):

```sql
CREATE DATABASE IF NOT EXISTS team_status
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_status.iw_project_notes (
  project_id  VARCHAR(64)   NOT NULL,
  note        TEXT          NOT NULL,
  updated_at  DATETIME(3)   NULL,
  PRIMARY KEY (project_id),
  KEY idx_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## 4. Oneflow signing status

Ported from the Project Progress Tracker's Oneflow status checker in v1.3.0. A second chip, **immediately right of the Younium chip**, shows whether the project's Oneflow document is signed, and opens an **Oneflow status details** modal in the same style.

### Where the documents come from

1. **Links stored on the Rocketlane project.** The tracker writes a `Links:` block into the project's *Hubspot Deal Description* custom field (`Oneflow (Order): …`, `Oneflow (Subscription): …`); the *Delivery status update message* field and an *Oneflow agreement id* field are read as fallbacks. The script reads the project through the Rocketlane API with the api-key the Rocketlane page keeps in `localStorage` — nothing is written.
2. **Oneflow search by plant ID** when no link is stored: `GET /api/agreements/?q=<plant id>`, the first candidates are hydrated so their *Plant ID* custom field can be checked (a document without custom fields counts when its name starts with the plant ID), and the best document per kind wins — Signed first, then Pending / Overdue, then Draft, newest first. Kind is decided by name: an *Abonnementsavtale* / *Subscription agreement* is the subscription, everything else the order / offer.

The modal's summary says which of the two found the documents.

### Verdict labels

The verdict follows the order document and falls back to the subscription agreement.

| Color | Label | Oneflow state |
|---|---|---|
| 🟢 Green | `✓ Signed` | 4 Signed |
| 🟡 Yellow | `⏳ Pending` / `⏳ Overdue` | 1 Pending / 2 Overdue |
| 🔴 Red | `✗ Draft` / `✗ Declined` / `✗ Cancelled` | 0 Draft / 3 Declined / 5 Cancelled |
| ⚪ Gray | `Missing` / `Error` / `Not connected` | nothing found / fetch failed / no Oneflow session |

### The modal

- A colored **summary** line plus the source of the documents, and a **Warnings** panel when something needs attention.
- **Document / order** and **Subscription agreement** sections: link, document id, name, kind, Signed?, sent-for-signing / signed / declined / cancelled dates, expiry, created / updated, and the **parties** with a ✓ per participant who has signed (every participant reads ✓ on a Signed document — a non-signing viewer keeps state 0 even then).
- Footer: **Refresh status**, **Copy summary**, **Open Oneflow document**, **Open subscription agreement**.

Verdicts are cached per Rocketlane project for the session; a "Not connected" verdict is never cached, so logging in to Oneflow and reopening the project is enough.

### Security

- The Rocketlane api-key is only ever sent to `https://kiona.api.rocketlane.com`; the Oneflow session cookie only travels to `https://app.oneflow.com` (both origins are pinned before the request is made).
- Everything rendered in the modal is HTML-escaped by default; links pass through `toHttpUrl()`.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `Oneflow: Not connected` | Open `https://app.oneflow.com` once while logged in, then reopen the project. |
| `Oneflow: Missing` | No Oneflow link is stored on the Rocketlane project and no Oneflow document carries the plant ID in its *Plant ID* custom field or name. Save the link via the tracker (Edit → 🔎 Find Oneflow). |
| Warning about the Rocketlane link fields | The Rocketlane api-key was not in the page yet — reload once logged in. The plant-ID search still runs. |

---

## 5. Delivery to service

The Project Progress Tracker's handover wizard, on the Rocketlane page where the handover actually happens. Added in v1.4.0.

### Where the button is

- On the **Handover to service** task card in the project plan, immediately right of the assignee avatar. The board is virtualised, so the button is re-attached whenever a lane re-renders.
- Once the task is **Completed** the pill turns green and reads **✓ Delivered**, so the card answers "is this handed over?" without opening anything. Rocketlane collapses a completed card to a single row and drops the footer, so there the badge sits on its own line under the task name. It stays clickable — useful for re-copying the checklist or opening the ticket flow again. Ticking it from the wizard flips the pill immediately rather than waiting for Rocketlane to refetch.
- Also as a **Delivery to service** chip in the project nav, right of the Oneflow chip — the fallback for projects that don't carry the task, and the place the delivery verdict is reported.

### Is it actually delivered?

The Rocketlane checkbox on its own is a claim, not proof — it gets ticked by hand and it gets ticked early. So the nav chip checks **both** the task status and whether support actually has the handover ticket, and says so when they disagree:

| Chip | Meaning |
|---|---|
| `Delivery to service` (indigo) | Not handed over yet — click to start the wizard. |
| `Delivery: ✓ Delivered` (green) | Task is Completed **and** a Zendesk handover ticket exists. |
| `Delivery: sak #NNN, ikke fullført` (amber) | The ticket exists but nobody ticked the task. |
| `Delivery: fullført, ingen sak` (amber) | The task is ticked but no handover ticket was found. |

The ticket lookup is anchored on the macro's own subject (`Avblokkering og Overlevering`) plus its `aktivering_basic` tag, and the plant ID is then required as a standalone number in the subject. A bare plant-number search is far too loose — searching `3530` with only the tag returns an unrelated `pc_change` ticket called "Anlegg 3530", and without the digit boundary `3214` would also match `13214`. The tooltip carries the ticket number, its status and its subject.

Being logged out of Zendesk reads as *unverified*, never as "no handover exists": a Completed task still shows green, with the tooltip noting the ticket wasn't confirmed. The verdict is cached per project for the session and recomputed as soon as the wizard creates a ticket or ticks the task.

The card match is anchored on the whole phrase, so the unrelated *Handover from sales to delivery* task never gets a button.

### What it does

Walks the 16 questions of *Leveranseavdelingens Sjekkliste til Support*, pre-filling what the page already knows:

| Step | Pre-filled from |
|---|---|
| Ticket title | `<plant ID> - <plant name> - Avblokkering og Overlevering` |
| 1. Abonnementsavtalen signert | **Ja** when the Oneflow verdict says the document is signed |
| 3. Oneflow-linker | The order + subscription documents the Oneflow module resolved |
| 14. AM Counter hint | The project's Younium subscription link, else the order link |
| 16. Leveransen internt / bestiller | Rocketlane's project owner and customer company |

Answers are saved per project in `GM` storage as you go, so a half-finished checklist survives a reload. Picking an answer does **not** jump to the next question — click the option, then **Next →** — so a mis-click costs nothing and you can change your mind after reading the hint.

The last step is an **editable rich preview** of exactly what will be sent. From there:

- **📋 Copy & close** puts it on the clipboard as `text/html` *and* `text/plain`, so pasting into the Zendesk composer reproduces the macro — numbered list, sub-bullets and links included.
- **📨 Opprett Zendesk-sak** creates the ticket outright: group *IWMAC Support*, tag `aktivering_basic`, status open, checklist as a **public reply**. It always confirms first, and remembers the ticket id so a second run warns before creating a duplicate.

Either finish can tick the **Handover to service** task to **Completed** in Rocketlane. That's a checkbox on the review step (on by default), and it only appears when the task was actually found. The write is verified by re-reading the task, so a PUT that Rocketlane accepts but ignores is reported as a failure rather than as success.

The checklist wording and the emitted HTML are copied **verbatim** from the tracker, because they have to reproduce Zendesk macro `1900005365194`. Change them here without changing them in the tracker and the two diverge.

### Security

- The Rocketlane api-key only ever goes to `https://kiona.api.rocketlane.com`, the Zendesk session cookie + CSRF token only to `https://iwmac.zendesk.com` — both origins are pinned before the request is made.
- On `iwmac.zendesk.com` the script does nothing but read the `csrf-token` meta tag into `GM` storage; none of the Rocketlane UI runs there.
- The only write to Rocketlane is the task status; the only write to Zendesk is the ticket you confirm.

### Troubleshooting

| Symptom | Fix |
|---|---|
| "Zendesk CSRF token not captured yet" | Open `https://iwmac.zendesk.com` once while logged in, then retry. |
| "Zendesk session expired or missing" | Same — the script retries a session renew once before saying this. |
| No button on the card | The lane may not have hydrated yet; scroll it into view. Otherwise the task isn't named *Handover to service* — use the nav chip. |
| "Fant ingen «Handover to service»-oppgave" | The project has no such task, so nothing is marked complete. The checklist still works. |

---

## 6. Add category / order info (v1.11.1)

On a project **plan** page:

1. Click **Add category** on the project action bar (right of Order info), **or** open the native plan **+** menu and pick **Add category / order info** (injected above **Import templates**).
2. Dialog preset order: **From order info / HubSpot line items** (default) → **Choose a project template…** → Custom → PPT discipline presets.
3. Order-info create reads the HubSpot delivery-status field, builds categories/tasks/subtasks (same promotion/license rules as the Project Progress Tracker), and writes phases/tasks through the Rocketlane API. Re-runs backfill only missing items (no duplicates).
4. **Choose a project template…** / empty-plan **Choose a template** opens Rocketlane’s native chooser; **From order info / HubSpot line items** is injected as the **first** option in that dropdown (above `#2A IWMAC…`). Empty plans also get a blue order-info button above **Choose a template**.

---

## Metadata

| Field | Value |
|---|---|
| `@match` | `https://kiona.rocketlane.com/*`, `https://eu.younium.com/*`, `https://us.younium.com/*`, `https://app.younium.com/*`, `https://iwmac.zendesk.com/*` |
| `@connect` | `auth.eu.younium.com`, `auth.us.younium.com`, `api.younium.com`, `app.oneflow.com`, `kiona.api.rocketlane.com`, `iwmac.zendesk.com`, `toolbox.iwmac.local`, plus attachment CDN hosts (`s3.us-east-1.amazonaws.com`, `s3.amazonaws.com`, `amazonaws.com`, `assets.rocketlane.com`, `d1vtr0p8bkmfca.cloudfront.net`) for Files popover blob downloads |
| `@grant` | `GM_xmlhttpRequest`, `GM_setValue`, `GM_getValue` |
| `@run-at` | `document-start` — the Gantt module needs it; the Younium chip and the Notes column wait for the DOM |

The five modules share nothing but the page: each keeps its own storage keys, styles and observers, exactly as in the scripts they came from.
