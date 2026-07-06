# Rocketlane Day Recap — technical reference

Deep technical notes for this one script, so work can be resumed cold on any machine. For repo-wide
rules (version bumping, commit/push, line endings) see the **root `CLAUDE.md`**. User-facing usage is
in this folder's **`README.md`**. This file is the *how it actually works* doc.

> Single file: `rocketlane-day-recap/Rocketlane-Day-Recap.user.js` — one big IIFE, `@grant GM_*`.
> Current version: **4.63**. Always bump `@version` + commit + push (Tampermonkey auto-updates).

---

## 1. What it is / where it runs

A Tampermonkey userscript that adds a 🏭 **Plants visited** panel to Rocketlane's **My Timesheet**.
Pick a date → it lists every IWMAC plant you worked on that day, the actions you performed, an
estimated time split, and (per plant) a 🔧 badge that expands to show *what config changed* during
your visit. At the top, a 📋 **Day by category** roll-up maps the day's plant time onto your Rocketlane
task categories (Integration / Drawing & Design / Setup / Support), copy-ready for the timesheet, and each
plant row shows its own category split (see §6).

It runs on **three** kinds of page (see the dispatch at the bottom of the file, `host === …`):
- `kiona.rocketlane.com/timesheets/*` → `initRocketlane()` — builds the button + panel (the main UI).
- `tools.iwmac.local` (pang) → `syncFromPang()` — harvests recent plants, login, the plant inventory,
  and records which origin (http/https) pang was served from.
- `*.plants.iwmac.local` → `recordPlantName()` — captures plant_id→name from a plant page.

All the data comes from **pang / IWMAC** on `tools.iwmac.local` (resolves to 192.168.119.2),
reachable from the office network with **no session cookie** (network-authed). The panel calls those
APIs cross-origin via `GM_xmlhttpRequest`.

---

## 2. Data sources (pang APIs)

All are JSON-RPC over POST, support **array batching** (send `[{...},{...}]` → get `[{...},{...}]`;
a 1-element batch returns a single object — handle both), and have **no server-side date filter**
(every call returns the entity's *entire* history; filter client-side).

| Endpoint | Method | Returns |
|---|---|---|
| `/services/pang/actions.php` | `get_history {plant_id}` | `[{date, user, action}]` — the click/visit log |
| `/services/changes/commits.php` | `get_commits {plant_id}` | `[{id, date, username, address}]` — config snapshots |
| `/services/changes/tables.php` | `get_tables_patch {commit}` | `{ <table>: {mode, struct, content} }` — what a commit touched |
| `/services/changes/data.php` | `get_two_versions {table_name, commit}` | `{old, new}` table content (before/after) |

- **`get_history`** `date` = `"YYYY-MM-DD HH:MM:SS"` local (Europe/Oslo). `user` format is **not uniform**:
  SSO logins record the full email (`eivind.slordal@kiona.com`), others a bare username
  (`thomas.kvalvag`). `normalizeUser` (lowercase + strip `@domain`) reconciles matching. `action` is a
  pang tool code (see §5).
- **`get_commits`** `username` is **always `:system:`** — commits are *automatic* config snapshots
  (partly scheduled, e.g. nightly ~03:00 / daily ~08:31; partly change-triggered). **No human author
  is ever recorded** — you cannot say *who* changed a plant. `isScheduledCommit(c)` (reads minute/hour
  from the **raw date string**, so it's timezone-stable) splits them: **scheduled** = hourly `:00/:01`
  (95/173 commits on plant 2701), nightly `00:00–00:05`, daily `08:30–08:32`; everything off-the-hour =
  **change-triggered** = real config work. Only change-triggered commits drive the 🔧 badge and the time
  estimate; scheduled snapshots are filtered out as noise.
- **`get_tables_patch`** `mode`: `""` = unchanged (≈95–100 of ~101 tables), `"mod:content"`,
  `"mod:struct:content"`, `"add"` (old absent), `"del"` (new absent). This is the **cheap pre-filter** —
  only fetch `get_two_versions` for tables where `mode !== ""`.
- **`get_two_versions`** each side = `{fields:[colNames], pk:{names,indexes(0-based)}, data:<base64>}`.
  `data` decodes (UTF-8) to **TSV**: rows split on `\n`, columns on `\t`, aligned to `fields`.

**Plant inventory** (id→name, ~7600 plants) exists **only in a live pang tab** (websocket-streamed into
`module_plants.coll.data`); there is **no HTTP endpoint** that lists plants, and ids are sparse
(203 … 50050) so a numeric range scan isn't viable. The first Full scan briefly opens `pang.qxs` in the
foreground (~6 s) to harvest it, then caches it (`all_plants` GM key).

---

## 3. The "what changed" pipeline (the meat — §`chg*` / `loadChangeDetail`)

Lazy, on first expand of the 🔧 badge only. Per visit (`v.window_commits` = the commits inside the
active window, stashed by `ensureChangesEnriched`):

1. **`gmFetchTablesPatchBatch(commitIds)`** — one batched call for the newest `MAX_COMMITS_DETAILED` (3)
   commits' patches. Cached in module-scope `_patchCache` by commit id (immutable → never invalidated).
2. **Classify each changed table by NAME + mode `before` fetching** (`chgClassify` + `chgDeviceToken`):
   - `iw_lnk_*` / `*_id_to_*` → **noise** (relink side-effect) — never fetched, shown as a footnote
     `driver-ID relink` (suppressed entirely if a device was added).
   - `mode: add`/`del` on `iw_par_<tok>`/`iw_set_<tok>` → **device** — never fetched (see §4).
   - everything else → **fetch**.
3. **`gmFetchTwoVersionsBatch(jobs)`** — one batched call for the fetch-kind tables (capped at
   `MAX_TABLES_PER_COMMIT` = 14; overflow surfaced as a footnote). Cached in `_diffCache` by
   `commitId|table`.
4. **`chgDiff(ver)`** — decode both sides, **diff rows keyed by `pk.indexes`, compare values by column
   NAME** (NOT position — a `mod:struct:content` reorder/insert otherwise produces phantom `X→Y` lines).
   Returns `{added, removed, modified:[{key,col,from,to}], unreadable}`. `row_date` column is ignored.
5. **`chgBuildCommit`** turns each diff into human lines (`{t, k, more?}` where `k` = `add|del|mod|plain` → colour;
   `more` = a list rendered behind a per-line "show all" toggle). Buckets — each rendered as its own collapsible
   section, **all collapsed by default** (v4.34), top-to-bottom in this order:
   - **`units`** (1st) — `iw_sys_plant_units` → `chgPushUnits`: named by **unit** via `chgUnitLabel` = `unit_name (unit_id)`,
     e.g. `Belimo Energimåler (1)`, or just `ING_EXT_05` when no name. Add/remove beyond `CHG_UNIT_LIST_CAP` (6) collapses to
     a count (`- 102 units removed`) **with `more` = the full list**, so the drawer offers a nested "show all". A device (§4)
     backed by a freshly-added **unit** is named by that unit and pushed here too (it *is* a plant_units add).
   - **`graphic`** (2nd) — `iw_sys_graphic_designer` → `chgPushGraphic`: a real line
     `Graphic <panel>: rev a → b · layout / background image edited` (the xml/json/png blobs are never shown as text).
   - **`sett`** (3rd) — `iw_sys_plant_settings` only → `chgPushParams` per-row: `⚙ <rowLabel>: <from> → <to>` (`rowLabel`
     prefers a name column `name/setting/par_name/key/tag/alias_text` + composite-PK rest in parens, e.g. `packet_interval (AK3)`;
     the redundant `value` column word is dropped). **Always per-row (no coalescing)** so you see exactly which setting changed.
     Own collapsible "Plant settings (N)" section (it changes on almost every commit).
   - **`oth`** (4th) — "More changes": pure-driver devices, `iw_set_*`/`*_param` tables, virtual values, etc. Param tables here
     pass `coalesce=true`: ≥`CHG_COALESCE_MIN` (4) rows with the SAME col/from/to (a regroup) collapse to one
     `⚙ group: 3 → 6 (N rows)` line instead of dozens of near-identical ones.
   - **No section is truncated in the model.** Long sections are revealed in the drawer `CHG_CHUNK` (10) lines at a time via a
     **clickable** `+N more changes` line (`renderChunked`) — each click appends the next chunk and updates the count, so nothing
     is dumped at once and nothing is lost. (Unit add/remove still pre-coalesce to a count + nested "show all" via `more`.)
   - `foot` = terse footnotes (relinks, unreadable, dropped tables), capped at 4.
   - If a commit changed tables but yields zero human-meaningful lines → `renderChangeDetail` shows an inline
     `Snapshot recorded — no parameter changes` (the drawer never renders blank under a non-zero badge).
   - **`loadChangeDetail` fetches all three `CHG_PRIORITY` tables first** (`fetchKind.sort`) so a 100+-table snapshot can't
     drop settings/units/graphic before the `MAX_TABLES_PER_COMMIT` (14) fetch cap. (`CHG_PRIORITY` = fetch-first set; the
     *display* order is units (1st) → graphic (2nd) → settings (3rd) → more (4th).)
6. **`renderChangeDetail`** writes the model into the drawer — **everything via `textContent`** (decoded
   config is untrusted; never `innerHTML`). Line colour from `k` (`.chg-add` green, `.chg-del` red,
   `.chg-mod` blue, `.chg-plain` default). **All four groups render as collapsed sections** via the shared
   `renderCollapse(title, lines, st)` helper — "▸ Plant units (N)", "▸ Graphic (N)", "▸ Plant settings (N)", "▸ More changes (N)"
   — each a `.chg-more-toggle` flipping a hidden `.chg-more-body` on click/Enter/Space. The body is filled by `renderChunked`:
   the first `CHG_CHUNK` (10) lines plus a **clickable `.chg-more-link`** "+N more changes" that appends the next chunk per
   click (DOM nodes created lazily, only as revealed). A line with `more` gets a nested `.chg-showall` ("show all"/"hide")
   sub-list. If every group is empty, an inline `Snapshot recorded` line is shown instead.

**Drawer UI state survives a re-render (v4.38).** `applyAndRender` rebuilds the whole list (`innerHTML=''`), so a
normalize/workday toggle used to wipe an open drawer and reset every expanded section back to its first chunk. Now the
drawer's open flag + per-section `{expanded, revealed}` live on **`v._chgUI`** (keyed `commit#:group`), which persists on
the visit object across re-renders. `renderChangeDetail(detail, model, ui)` restores from it; `renderCollapse`/`renderChunked`
read+write it; the badge `openDrawer`/`closeDrawer` set `v._chgUI.open`, and `renderVisits` re-opens (`if (v._chgUI.open)
openDrawer()`) after a rebuild — so the drawer comes back exactly where you left it.

**Staleness**: the drawer toggle checks `document.contains(detail)` after the await — a re-render
discards the old node, so a late result is harmless. `loadChangeDetail` memoises its in-flight promise
(`v._changeDetailPromise`) so rapid expand/collapse can't double-fetch; the resolved model is cached on
`v._changeDetail`.

---

## 4. Device add/remove detection (§`chgDeviceToken` + the coalescing in `chgBuildCommit`)

A device creates a *set* of tables: `iw_set_<token>` + `iw_par_<token>_groups` + `iw_par_<token>_param`,
plus a row in `iw_sys_order_no` and `iw_sys_plant_units`, plus a relink in `iw_lnk_driver_id_to_no`.

- `chgDeviceToken(table)` = `/^iw_(?:par|set)_(?:da3_)?(.+?)(?:_groups|_param)?$/` → the device id
  (`da3_` prefix stripped). Handles **every** driver family (AK3 `da3_mc370002_0207`, BACNET
  `10111_energy_valve_1_1`, modbus `cc_210b_modbus`, …) — NOT just the old narrow `CHG_DEV_TOKEN_RE`.
- A token is treated as a real device if it has **≥2 add-tables** OR it **matches a freshly-added unit**.
- **Naming**: `iw_sys_plant_units` is the source of truth. Build `token → unitLabel` from added units'
  lowercased `grp_name`/`order_no`/`unit_id`; if a device token matches, the line is
  `+ Device added: Belimo Energimåler (1)` and that unit is *consumed* (not shown twice). No match →
  `+ Device added: <token>`.
- The device's `iw_par_/iw_set_` add-tables, the matching `iw_sys_order_no` row, and the relink are all
  **folded into / suppressed** under the one device line.
- ⚠️ A device's tables and its `iw_sys_plant_units` row are sometimes committed **in different commits**
  (validated on 10111: tables in one commit, the unit row added/reconfigured in another). So a device
  may surface as `+ Device added: <token>` in one commit and as a modified unit in another — both correct.

---

## 5. Action chips (§`ACTION_META` / `actionChips`)

The `action` field from `get_history` is a pang tool code. The panel renders each as a **colour-dot +
friendly label** (dot colour = category; raw code in the chip's `title`). Labels were read straight from
the pang UI (`comp_module_plants_wp_btn_*` ids + tools submenu) — **don't guess them**.

Categories (`cat` → dot colour): `edit` (blue) = Designer V4/V3, VV designer, AK3 setup, **Backup** (=`upload`),
File upload · `server` (orange) = Restart/Start/Stop plant, Restart PC · `vnc` (purple) = Start/Stop VNC,
next ping/upload · `access` (teal) = Direct, Direct V3, Proxy, **phpMyAdmin** (=`pma_local`), Client admin ·
`diag` (grey) = System tools, Get status, Screen dump.

Non-obvious: **`pma_local` = "phpMyAdmin"** (DB access, not plant-management); **`upload` = "Backup"**;
`designer` = "VV designer"; `restart` = "Restart PC" vs `restart_plant_server` = "Restart plant".

---

## 6. Time attribution & category mapping (§`attributeTime` / `categorizeVisit`)

pang logs **clicks, not active time**, so any estimate is inferred. Build ONE chronological timeline of
all clicks across all plants for the day; the gap between each click and the next is credited to the
plant that was open across it, **capped at `ACTIVE_CAP_MS` (30 min)** (normal sparse-clicking work counts
in full; a real break is capped, not inflated). The last click gets a `TAIL_MS` (10 min) wrap-up. This
click-only result is frozen on each visit as **`base_minutes`** (and cached) — the immutable floor.

**Commit fusion (v4.37, in `ensureChangesEnriched`).** The click model can't see **sub-tool config work**:
phpMyAdmin / Designer / Direct / VNC sessions log almost no pang clicks, and the save commits a while
*after* your last click — so a real config session collapses to ~1 min of click time. Fix: when a visit
is **sparse** (`count ≤ SPARSE_CLICK_MAX` = 2) **and** opened a **config surface** (an `edit`/`access`/`vnc`
action per `ACTION_META`), widen its window tail to `COMMIT_SESSION_MAX_MS` (20 min) and, if a
**change-triggered** commit lands in it, credit the real span `[first click → that commit]` clamped to
`[COMMIT_SESSION_MIN_MS` (5), `COMMIT_SESSION_MAX_MS` (20)] min. `estimated_minutes` is recomputed from `base_minutes` every render (idempotent) and a no-op on click-heavy plants (they never qualify). **v4.52 (R1):** the triggered commit now *defines* the session — it lifts a low click-base UP to the span, and when the base only reached its value because a long cross-plant idle hit the 30-min gap cap (`base ≥ ACTIVE_CAP_MS`, unearnable from ≤2 clicks) it pulls the estimate DOWN to the span. Sub-cap bases stay lift-only, so legitimate click estimates are never reduced. The
top-up is exposed as `v.commit_added_minutes` (drives a tooltip note). Only change-triggered commits count
(see §2 / `isScheduledCommit`); scheduled snapshots feed neither time nor badge.

**Isolated config-touch cap (v4.50, in `ensureChangesEnriched`).** The opposite error: a **single** pang
click that opened an access/VNC/diagnostics surface but committed **nothing** is a quick glance,
yet the 30-min gap cap can credit it the full 30 min (measured over 30 real days: a lone pma click → 30 min).
When `count === 1 && triggered.length === 0` and the lone action's `ACTION_META.cat` is `access`/`vnc`/`diag`, lower `base_minutes` to
`ISOLATED_TOUCH_CAP` (8 min). Gated on **no-commit** (a commit-bearing pma touch is instead lifted by the
fusion above) and the **config surface** a lone glance. **v4.53 (R-g)** widened this from the original `pma_local`/`sys_tools`-only check to all access/vnc/diag surfaces (so a lone Direct/Proxy/VNC glance is now capped too) and keyed it off `v.actions` so it also fires on quick/single-date scans. Edit (Designer/AK3) and server actions are deliberate work and stay uncapped. Strictly reduces credit.

**Long-silence damping (v4.56, in `ensureChangesEnriched`).** A 39-day corpus (1,043 clicks, 39 plants)
showed **40% of all raw credit was capped 30-min blocks**, and of the 68 capped silences longer than
45 min only ~4 in 10 had a triggered commit proving work continued. So each capped gap is provisional:
`attributeTime` records them per plant (`v.capped_gaps = [{ts, gap}]`, persisted by `cacheVisit`), and
enrichment re-judges every gap longer than `LONGGAP_MS` (45 min) — it keeps the full 30 only when a
**change-triggered commit for that plant** lands within `LONGGAP_EVIDENCE_MS` (60 min) of the silence
starting; otherwise it's re-credited at `LONGGAP_CREDIT_MIN` (15). Applied to `base_minutes` BEFORE the
isolated-touch cap and fusion; skipped when the commits fetch failed (`commits[pid]` undefined) or the
visit came from a pre-4.56 cache (no `capped_gaps` → old behaviour). Absence of a commit isn't proof of
absence of work (log-reading/VNC-watching never commits) — hence the fallback is 15, not less. Corpus
validation: 18/39 days unchanged; the visually-approved 26/05 and 12/06 days bit-identical; changed
days lose 15–45 min, always the unevidenced hour-plus silences.

`normalizeMinutes` optionally rescales the per-plant minutes to a "Workday total" (default 7.5 h, rounded
to 5 min) when "Distribute to total" is ticked, over the fused `estimated_minutes`. **v4.53 (R2)** distributes over **bookable visits only** (filters out Quick-check visits via `categorizeVisit(v)[CAT_CHECK]`), so the booked total equals the configured workday instead of leaking a slice into the not-booked bucket; Quick-check visits keep their raw estimate, and quick-ness keys off the raw `estimated_minutes` so a bookable visit can't flip to Quick when normalize scales it under 15 min.

### Category mapping → timesheet (v4.48–4.50, §`categorizeVisit` / `dayCategoryTotals` / `renderCategorySummary` / `categoryChips`)

The 📋 **Day by category** panel (`.catsum`, above `.results`) and the per-plant `.catrow` chips map each
visit's `estimated_minutes` onto Thomas's Rocketlane task categories. **Plant work only** — meetings, admin,
documentation and training never touch pang and are deliberately omitted.

`categorizeVisit(v) → { category: minutes }` splits ONE visit's minutes `M` (the normalized value when
"Distribute to total" is on, else `estimated_minutes`):
- Designer (`designer4/3/`) and AK3 (`ak3_setup`) log few clicks but cost real time. **AK3** → **Setup -
  PC/Gateway** via a `CAT_AK3_MIN_EACH` (18) per-use nominal. **Drawing & Design** (v4.54) is credited
  `max(CAT_DESIGNER_MIN_EACH × designerN, v.designer_minutes)` — the flat 8-min/click nominal OR the **designer
  session** (`designerGapByPlant`: from each Designer click until you leave the plant, bridging a brief burst
  of quick same-plant pop-outs but stopping at a sustained > 2 min pause; gap-capped), whichever is larger.
  **v4.60:** the LAST designer session is additionally **commit-extendable** in enrichment — a plant's own
  triggered commit within 20 min of the session's click-based end (`v.designer_last {s,e}`, cached) proves the
  drawing continued through a quick other-plant glance, so the session extends to that commit (≤ 30 min cap).
  Category-only: shifts Drawing↔Integration inside the visit; plant/day totals untouched. Both capped at the visit's `M`.
- The **remainder** → **Integration** when there's config evidence (`changes_in_window > 0 || pma_local ||
  sys_tools`); → Drawing if the visit was graphic-only; → Setup if AK3-only; else a `≤ CAT_CHECK_MAX_CLICKS`
  (2)-click no-commit visit → **Support - External**.
- `dayCategoryTotals` rolls these up (ordered `CAT_ORDER`, coloured `CAT_COLOR`, short-labelled `CAT_SHORT`);
  `renderCategorySummary` draws the bars + a clipboard **⧉ Copy** of `Category: H h` lines; `categoryChips`
  draws the same split per row. Re-rendered by `applyAndRender`, so it tracks the workday/normalize toggles.

**Why commit *content* is NOT used (v4.50).** A 30-day measurement found **457/457** triggered commits across
94 plants classify as `integration` — a device-add commits the graphic table AND the device tables together,
so commit content can never isolate Drawing/Settings. Therefore **Drawing comes from the Designer *actions* — and (v4.54) the gap that follows each Designer click**,
and `changes_in_window > 0` is the integration-evidence signal. The v4.48 `tables.php` classification pass was
removed as provably dead (`categorizeVisit` keeps a harmless `v.commit_classes` fallback that now always
resolves to `changes_in_window`).

---

## 7. Scope, scanning & caching

- **Fast scope** = your recent pang plants ∪ your **footprint** (`user_plants` GM key: every plant you've
  ever been matched on — grows automatically each scan). Used by the default auto-load on date change
  (`doScan('quick')`, when the date isn't cached) and by the **Refresh** button (`doScan('refresh')`, which
  also writes the date's cache). Covers your real working set without a full scan, plant-admin/designer too.
- **Full scan** = all ~7600 plants (after a one-time confirm, ~1 min). Because `get_history` returns each
  plant's *entire* history, ONE full scan **caches every date you worked** (`full_scan_cache`, capped
  `MAX_CACHED_DATES` = 400 dates/user) — browsing any other date that month is then instant.
- Scans **batch** `get_history` (`HISTORY_BATCH_MAX` = 30 plants/request, `SCAN_PARALLEL` = 20 concurrent).
  Server load = same as single calls (processed sequentially) but far fewer round-trips. The hard limit
  on big scans is **total data volume**, not round-trips — so keeping the everyday scope small (footprint)
  is what keeps it fast.
- **Measured server profile (2026-07-02, don't re-tune blindly):** ~3–6 ms/plant marginal server cost,
  ~45 KB/plant payload, **no gzip** → a full scan transfers ~300 MB and is bandwidth/parse-bound. The
  browser caps HTTP/1.1 at ~**6 connections per origin**, so `SCAN_PARALLEL=20` already sits above the
  real ceiling — raising batch/concurrency constants buys nothing. The wins are elsewhere:
- **Scan reliability (v4.57):** `gmFetchHistoryBatch` returns **null** on transport/parse failure (was
  `{}` — indistinguishable from "no history"); `fetchHistoryBatchReliable` retries once, then reports the
  batch's plants as failed. A scan with failures **renders but is never cached** (`writeCacheDates`
  skipped) — a silently-partial full scan used to poison every cached date until the next full scan —
  and the footer shows `⚠ N unreachable — not cached`. Full scans run **footprint-first** (recent ∪
  `user_plants` scanned before the other ~7,500) and the progress line shows a live
  `X of Y plants · Z found for <date>` counter (`.scan-live`).

---

## 8. Critical gotchas (these caused real, hard-to-find bugs)

1. **Sandbox / `unsafeWindow`** — `@grant GM_*` sandboxes the script; its `window` is **not** the page
   window. Page globals (`module_plants`, pang's `coll.data` inventory) live on **`unsafeWindow`**. Read
   page state via `PAGE = (unsafeWindow || window)`. (`localStorage`/`document` *are* shared.) This silently
   broke Full scan for everyone until v4.20 — a Playwright/page-context eval does NOT see what the
   sandboxed script sees.
2. **`GM_xmlhttpRequest` rejects the internal HTTPS cert** — the browser accepts `tools.iwmac.local`'s
   https cert for page loads, but `GM_xmlhttpRequest` validates it and silently returns empty. **All API
   calls must go to the HTTP origin.** `apiOrigin()` probes `get_history` (http first) and uses whichever
   origin actually returns data; reuse it for the changes endpoints too. (Broke Search on https until v4.22.)
3. **Per-origin `localStorage`** — http and https keep *separate* `pang.recent` / `pang.favorites` /
   `pang.login.username`. The backend (`coll.data`, history, commits) is identical, but recent/login differ.
   The script harvests recent + login from **both** origins (`syncRecentBothOrigins`).
4. **Identity = the auth cookie `iw_security[username]`** (readable via `document.cookie` on a pang tab),
   NOT the SPA's `pang.login.username` (missing/mis-formatted for SSO logins — this was the eivind bug).
   (A v4.36-removed "pick your name" chooser used to offer a manual `user_override` when a scan matched
   nothing; the key is still *read* by `effectiveUsername` for backward compat, but nothing sets it now.)
5. **`pang.recent` is hard-capped at 50** and misses plant-admin/designer visits (`designer4`/`direct_plant`
   etc. don't enter it). A "0 on Search" usually means the work was on non-recent plants — run Full scan.

---

## 9. Key functions — where to find things

`pangBase()` / `apiOrigin()` / `gmProbeOrigin()` (origin selection) · `gmFetchHistoryBatch` (get_history) ·
`gmFetchCommitsBatch` / `gmFetchTablesPatchBatch` / `gmFetchTwoVersionsBatch` (changes APIs) ·
`loadVisitsForDate` / `loadUserHistoryAllDates` (build a date's visits; freeze `base_minutes`) · `attributeTime` /
`normalizeMinutes` (time split) · `isScheduledCommit` (scheduled vs change-triggered) · `ensureChangesEnriched`
(🔧 badge counts from change-triggered `window_commits` + commit→time fusion → `estimated_minutes`/`commit_added_minutes`) ·
`loadChangeDetail` + `chgDecodeSide` / `chgDiff` / `chgRowLabel` / `chgClassify` / `chgDeviceToken` /
`chgUnitLabel` / `chgPushUnits` (adds `more` for "show all") / `chgPushParams` (`coalesce` flag; drops the redundant `value` word) / `chgPushGraphic` /
`chgPushOrdinary` / `chgBlobToken` / `chgBuildCommit` (returns `{units, graphic, settings, oth, othOverflow, foot, footOverflow}`) /
`renderChangeDetail` (+ `renderCollapse` helper) (the "what changed" drawer) · `ACTION_META` / `actionChips` (chips) ·
`categorizeVisit` / `dayCategoryTotals` / `renderCategorySummary` / `categoryChips` (the 📋 Day-by-category roll-up +
per-row `.catrow` chips; constants `CAT_*` — see §6) · `renderVisits` (the per-plant rows +
badge/drawer wiring) · `escapeHtml` (encodes `& < > " '`) · `tsFromPangDate` / `tsToLocalTime`.

Debug helper (DevTools console on Rocketlane): `window.__rlRecap.dump('<plant_id>')` — shows captured
username, known/all-plants counts, harvest timestamps. `all_plants_count` is the tell for a broken harvest.

---

## 10. Testing live (no install needed)

The cleanest way to validate diff/label logic without waiting for a Tampermonkey update: open
`http://tools.iwmac.local/pang.qxs` in a browser and run the pipeline in the page console / via the
Claude-in-Chrome MCP (same-origin `fetch` to the APIs works there). Replicate `chgDecodeSide`/`chgDiff`/
`chgBuildCommit` and call them on a real commit, e.g.:

```js
// find a real config-change commit, then diff it
const patch = await getTablesPatch(commitId);          // mode != "" tables
const vers  = await getTwoVersions(table, commitId);   // {old,new}
// decode base64 → TSV, key by pk.indexes, diff by column NAME → human lines
```

Known good fixtures: plant **2511** commit `13199608` (AK3 device add + SM850 regroup + graphic),
plant **10111** commit `13191667` (Belimo BACNET device add), plant **3694** commit `13271966`
(graphic-only). These exercise device coalescing, param diffs, unit naming, blob summarising, and the
empty/footnote-only branches.

---

## 11. GM storage keys

`known_plants` (footprint ids) · `plant_names` (id→name) · `all_plants` (full inventory ids) ·
`name_lookup_ids` · `full_scan_cache` (`{username:{isoDate:{scanned_at,scanned,visits[]}}}`; each cached
visit now also carries `base_minutes` = the click-only floor, so commit fusion re-runs identically on a
cached date — legacy entries without it fall back to `estimated_minutes`) ·
`user_plants` (`{username:[ids]}` footprint) · `pang_origin` (last-seen http/https) ·
`pang.recent` / `pang.login.username` (mirrored from both origins) · `workday_hours` · `user_override` ·
`last_harvest_ts` / `harvest_done`.

---

## 12. Version history (highlights)

- **4.17** identity = `iw_security[username]` cookie + "pick your name" fallback.
- **4.20** `unsafeWindow` fix — Full scan had silently never worked (sandbox).
- **4.22** http-first `apiOrigin()` — fixes Search on https (GM_xmlhttpRequest cert).
- **4.23** per-user footprint (`user_plants`); **4.24** one Full scan caches every date that month.
- **4.25** time estimate retune: 30-min active cap (was a 10-min cutoff that scored a 7 h day as ~1.6 h).
- **4.26** 🔧 changes-in-visit badge (commits inside your active window).
- **4.27** action codes → friendly chips; **(v4.29 →)** colour dot + name.
- **4.28** click the 🔧 badge → drawer showing *what changed* (tables.php/data.php diff).
- **4.29** name `iw_sys_plant_units` changes by unit; stop hiding units on device-add.
- **4.30** generalised device detection (BACNET/energy-valve/modbus, not just AK3); name a device by its
  added unit ("Belimo Energimåler"); colour-code drawer lines (green added / red removed / blue changed).
- **4.31** drawer split into a **priority section** (`iw_sys_plant_settings`, `iw_sys_plant_units`,
  `iw_sys_graphic_designer` — shown in full up top, fetched first) + a collapsible **"More changes"** for
  everything else. Graphic promoted from a footnote to a real `Graphic <panel>: rev a → b` line. Per-table
  coalescing caps (`CHG_UNIT_LIST_CAP` 6, `CHG_PARAM_LIST_CAP` 12) keep a full-rebuild snapshot (e.g. units
  104→2) from dumping 100+ lines.
- **4.32** drawer re-tiered: only `iw_sys_plant_units` + `iw_sys_graphic_designer` stay always-visible;
  `iw_sys_plant_settings` moves to its **own collapsible "Plant settings (N)" section** (uncapped — it changes on
  almost every commit). Coalesced unit add/remove lines now carry a **"show all"** expander listing every unit
  (`more` field + `.chg-showall`). All three tables are still fetched first.
- **4.33** fixed always-visible **order**: `units` (`iw_sys_plant_units`) renders first, `graphic`
  (`iw_sys_graphic_designer`) second, then the Plant-settings and More-changes collapses. `chgBuildCommit` now
  returns separate `units` / `graphic` arrays (was one `pri`).
- **4.34** **all four groups now start collapsed** — units and graphic became their own
  `▸ Plant units (N)` / `▸ Graphic (N)` collapses too (was always-visible). Opening the badge shows four collapsed
  section headers; the empty-commit fallback renders inline (not inside a phantom "Plant units (1)").
- **4.35** **`+N more changes` is now clickable** (`renderChunked` + `.chg-more-link`): a long section reveals `CHG_CHUNK`
  (10) lines per click instead of dumping or truncating. Removed the model-level caps (`CHANGE_HEADLINE_CAP`,
  `CHG_PARAM_LIST_CAP`) — every changed line is kept and reachable, created lazily as revealed.
- **4.36** **removed the "pick your name" chooser** (`renderUserPicker` + the `Wrong name?` block + `.userpick` CSS).
  A date with no activity for you now just shows **"No data for &lt;date&gt;"** (`renderVisits` empty state; a Quick
  scan still nudges Full scan). `user_override` is still read by `effectiveUsername` but nothing sets it anymore.
- **4.37** **fused config commits into the time estimate + cleaned the badge** (`isScheduledCommit` + new
  `ensureChangesEnriched` body). (1) Classify scheduled (`:00/:01` hourly, nightly, daily) vs change-triggered
  commits; the 🔧 badge + drawer now show only change-triggered ones (on plant-2701/2026-06-19 the badge drops
  4→2). (2) A sparse-click visit (≤2 clicks) that opened a config surface (`edit`/`access`/`vnc` action) with a
  change-triggered commit is credited the real session span `[first click → commit]`, clamped 5-20 min, added
  over the frozen click-only `base_minutes`. Bounded, idempotent, additive — click-heavy plants are untouched
  (verified: thomas 06-19 stays 135 min). Adds `base_minutes` to the cache and `SCHED_*` / `COMMIT_SESSION_*` /
  `SPARSE_CLICK_MAX` constants. Designed via a 4-lens workflow (the full interval-union model was rejected as
  over-engineered); the synthesis's save-lag tail was dropped because the click model already credits the
  post-last-click gap (would double-count).
- **4.38** **the 🔧 drawer keeps its place across re-renders** (`v._chgUI`). A normalize/workday toggle calls
  `applyAndRender` → full list rebuild, which used to close every open drawer and reset expanded sections back to
  their first chunk ("+45 more changes" again). Now the open flag + per-section `{expanded, revealed}` persist on
  the visit; `renderChangeDetail` takes a `ui` arg and restores them, and `renderVisits` re-opens the drawer after
  a rebuild — so it comes back exactly where you left it.
- **4.39** **readability pass on change lines.** Drop the redundant `value` column word in settings/param lines
  (`packet_interval (AK3): 400 → 4000`), and coalesce bulk-identical changes in "More changes" param tables —
  ≥`CHG_COALESCE_MIN` (4) rows sharing col/from/to become one `⚙ group: 3 → 6 (N rows)` line (plant-2511 fixture
  13199608: a 44-row SM850 regroup collapses to 2 lines). Gated to "More changes" only — the priority Plant-settings
  section stays per-row so you always see which setting changed.
- **4.40** **fixed stale scan UI after a superseded scan.** Changing the date supersedes any running scan, but the
  superseded scan's `finally` is `seq`-guarded out and the cached path never scans — so a half-filled progress bar (and
  disabled Search/Full-scan/↻ buttons) could stick when you switched to a cached date. `openDefault` now resets
  `progress` to 0% and re-enables the buttons up front, and `onProg` is `seq`-guarded so a superseded in-flight scan
  can't keep animating the bar.
- **4.41** date picker is **Monday-first**: added `lang="nb-NO"` to the `<input type="date">`. Chromium's native
  picker takes its locale (first-day-of-week, day/month names, dd.mm.yyyy display) from the element's `lang`; nb-NO
  is Monday-first and matches the script's existing Norwegian date formatting. `input.value` stays ISO
  (`YYYY-MM-DD`) regardless of `lang`, so no date logic changes. (For English labels + Monday-first instead, use `en-GB`.)
- **4.42** switched the picker `lang` to **`en-GB`** — Monday-first (UK/European week convention) but **English** day/month
  labels (Mon, Tue, … / dd/mm/yyyy), per request. Same mechanism as 4.41; only the locale tag differs.
- **4.43** the `lang` approach didn't actually take (Chromium's native date picker reads first-day-of-week from the
  **browser/OS locale**, not the element `lang`, so it stayed Sunday-first). Replaced the native picker with a **custom
  Monday-first calendar** drawn in-script: a `.datebtn` (shows dd/mm/yyyy) opens a `.datecal` popup; `renderCal` builds a
  Monday-first grid (`start = Monday on/before the 1st via (getDay()+6)%7`), English labels, prev/next month + Today, with
  selected/today highlights. A **hidden `<input type="date">`** still holds the canonical ISO value and fires `change`
  (→ `openDefault`), so the rest of the script is untouched. Fully locale-independent — Monday-first on any browser.
- **4.44** restyled the custom calendar (CSS only): **circular day cells** (`aspect-ratio:1` + `border-radius:50%`), today =
  blue bold text, selected = filled blue circle (white), uppercase muted weekday header, circular nav buttons with hover,
  softer frame (10px radius, lighter border + shadow), footer divider. Selected-today resolves to white-on-blue (source
  order `other` → `today` → `sel`, so `sel` wins the colour — no blue-on-blue).
- **4.45** fixed the calendar being **clipped** by the panel's `overflow: hidden` (the panel is anchored `bottom: 70px`,
  so when it's short the popup extended past the panel box and got cut). `.datecal` is now `position: fixed`, positioned
  in `openCal` from `dateBtn.getBoundingClientRect()` — it escapes the panel's clip, is **clamped** horizontally to the
  viewport, and **flips above** the field if opening downward would overflow the bottom. Always fully on screen.
- **4.46** **the real "Sunday cut off" cause** (diagnosed live on kiona.rocketlane.com): the calendar lives inside
  `.controls`, so its day-cell `<button>`s inherited `padding: 6px 10px` from the panel's `#PANEL .controls button`
  rule (1,2,0 `.datecal-day` overrode colour/border but not padding). That inflated cells 30→35px, so 7 columns
  (≈245px) overflowed the 250px popup and the Sunday column spilled off the right and was clipped. Fix: `padding: 0;
  min-width: 0;` on `.datecal-day` and `.datecal-nav`. Verified on the real page: cells back to 30px, all 7 columns
  inside the popup. (NB: the clip was *internal grid overflow*, independent of the 4.45 panel-overflow/position:fixed
  work — that's still needed for the vertical clip when the panel is short.)
- **4.47** consolidated the scan buttons: the **Search** button became **Refresh** (`doScan('refresh')` — re-scan the
  selected date over the fast scope **and** update its cache), and the separate **↻** button was removed (it did the
  same thing). Date-change still auto-loads via `doScan('quick')`; only the button label/action and the removal changed.
  Dropped `resyncBtn` and its disable/enable/listener references.
- **4.48** added the 📋 **Day by category** timesheet roll-up (`.catsum` panel above `.results`). New module before
  `renderVisits`: `categorizeVisit(v)` splits one visit's shown minutes across Thomas's Rocketlane categories
  (`CAT_INTEGRATION`/`CAT_DRAWING`/`CAT_SETUP_PC`/`CAT_SUPPORT`), `dayCategoryTotals(visits)` rolls them up, and
  `renderCategorySummary(catsumEl, visits)` draws bars + a clipboard **⧉ Copy**. Wired into `applyAndRender` (re-runs on
  normalize/workday toggle). **Split model** (validated against the 2026-06-19 commissioning day — reproduces the by-hand
  split: Integration 4.40 h, Drawing 1.47 h, Setup 0.90 h, Support 0.38 h, total 7.15 h): Designer & AK3 log few clicks
  but cost real time, so each is credited a nominal chunk (`CAT_DESIGNER_MIN_EACH=8`, `CAT_AK3_MIN_EACH=18`) carved off
  `M`; the remainder → Integration when there's config evidence (a non-graphic commit, `pma_local`, or `sys_tools`),
  → Drawing if graphic-only, → Setup if AK3-only, else a short access-only visit (`< QUICK_CHECK_MAX_MIN` min, or ≤`CAT_CHECK_MAX_CLICKS` clicks, no commit) → **Quick check** (`CAT_CHECK`) — in `CAT_NOT_BOOKED`, so shown but excluded from the Copy total (v4.51).
  Key insight: a device-add commits the graphic table **and** the device tables, so commit content can't isolate Drawing
  (on 06-19 *all* triggered commits classified as integration) — **Drawing comes from the Designer actions**. To capture
  action multiplicity, `loadUserHistoryAllDates` now records `action_counts` per visit (also cached via `cacheVisit`;
  old caches without it fall back to presence=1). `ensureChangesEnriched` now also runs one `tables.php` pass over the
  day's triggered commits → `chgCommitClass(tables)` → `v.commit_classes {integration,design,settings,other}`, so a
  genuine graphic-only commit isn't mistaken for Integration evidence. Plant work only — meetings/admin/docs/training
  aren't in pang and are omitted. Also fixed the stale `SCRIPT_VERSION` const (`'4.25'` → `'4.48'`; was only the console
  log prefix).
- **4.62–4.63** ⤴ **Book day** — one click writes the split into the Rocketlane timesheet via Rocketlane's own API.
  New module before `renderVisits`: `rlCreds` (api-key + userId from `localStorage.__api_key`, same as the
  chat-bridge), `rlFetch` (GM_xmlhttpRequest, origin-pinned to `kiona.api.rocketlane.com/api/v1` — page fetch is
  CORS-blocked, the app tunnels through a comlink iframe), `rlProjects` (paginated `GET /projects?pageSize=100&page=N`,
  cached 24 h in `rl_projects_cache`), `rlFindProject` (name starts with `<plant_id> -`), `rlCategories`
  (`GET /timesheets/categories`), `rlEntriesOn` (weekly `GET /users/{id}/timesheets/{monday}` → that date's entries,
  the dedupe source), `bookTexts` (activity texts from the newest ≤`BOOK_MAX_COMMITS` triggered commits:
  added `iw_set_*` tables → "Integration: added Grundfos CIM200 …"; `iw_sys_graphic_designer` diffs → **panel names**,
  "Drawing: Wireless Overview"), `buildBookingPlan`, `bookPlanEntries` (`POST /users/{id}/time-entries` with
  `{date, minutes, activityName, billable, categoryId (FLAT — mandatory), projectId}` → 201, verified by live trial),
  and `openBookingFlow` (confirm-plan UI in `.catsum`, per-row ✅/❌/⏭/⚠). Rules: **quick checks never booked**;
  same project+category already on the date ⇒ skipped (re-click can't double-book); **RAC** (`RAC_RE` on the project
  name or any changed table) ⇒ Integration remainder books as **Setup - PC / Gateway** ("Setup: RAC — …"); no matching
  project ⇒ row flagged "book manually". Button lives in `.catsum-head`; `renderCategorySummary` now takes `isoDate`.
- **4.61** housekeeping: re-synced the `SCRIPT_VERSION` console-log const (stale at `'4.50'` since the 4.51–4.60
  releases; it only prefixes `LOG` lines, but a wrong console tag derails installed-version debugging) and this file's
  "Current version" header. No behaviour change.
- **4.60** commit-anchored designer-session extension. The click-based designer session often ends at a quick glance at ANOTHER plant (v4.55's bridge is same-plant only) — but the graphic save then commits on the designer's plant minutes later. Fix: `designerGapByPlant` also returns each plant's LAST session `{s,e}` (→ `v.designer_last`, cached); enrichment extends it to the latest triggered commit ≤ 20 min after `e` (per-session 30-min cap). Corpus-validated: fires 19× / +190 min Drawing over 3 months (e.g. 17/06 10232 designer@11:54 → 5285 glance @11:57 → commit @12:08 ⇒ 3→14 min); category-only, totals unchanged; 12/06 10230 lands on the same 30 min as approved.
- **4.59** the panel is draggable by its header (pointer events; `KEY_PANEL_POS` persists `{left,top}`; clamped to the viewport on apply so it can't be lost off-screen; double-click the header resets to the default bottom-right dock; the × button is excluded from the drag handle).
- **4.58** commit→time deep-dive (285 triggered commits near real visits, 39 plants since 04-01). Measured save→commit lag after the nearest click: 0-2 min 103, 3-6 min 46, **7-10 min 30, 11-20 min 38**, 21-60 min 68 — so ~31% of genuine saves landed beyond the old 6-min non-sparse badge window, and **13 click-heavy visits ended with a save 7-20 min after the last click** that got no badge/drawer/evidence at all. Fix: `CHANGE_PAD_TAIL_MS` 6→20 min (aligned with `COMMIT_SESSION_MAX_MS`). Display/evidence only — no time change for click-heavy visits (fusion stays sparse-only); a late commit can now correctly flip an access-only visit out of Quick check into Integration. **Measured & REJECTED — commit-chained session extension** (each save ≤20 min after the previous anchor extends a sparse session past the 20-min clamp, capped 60, stopped at the next click elsewhere): the whole 3-month corpus has only 5 sparse+commit visits, ZERO truncated chains, and the single visit it changes is on the approved 26/05 anchor (10111 22→56 min, partly double-counting an interleaved 9815 glance). Do not re-chase it.
- **4.57** scan deep-dive (measured, not guessed): server ~3–6 ms/plant, ~45 KB/plant, no gzip → full scan ≈ 300 MB, bandwidth/parse-bound; browser HTTP/1.1 ~6 conns/origin means the batch=30/conc=20 constants already exceed the effective ceiling → left unchanged. Shipped instead: **(1)** transport failures retried once and a scan with failures is **never cached** (was: a failed batch resolved `{}`, silently dropped up to 30 plants, and a full scan cached that hole into every date) with a `⚠ N unreachable — not cached` footer; **(2)** live progress counter (`X of Y plants · Z found for <date>`); **(3)** footprint-first ordering in the full scan so your plants surface in the first seconds. Also verified `ensureUserAndRecent` is a warm no-op (no per-scan pang sync).
- **4.56** deep-dive on per-plant time (39 days / 1,043 clicks / 39 plants, full pipeline replicated offline). Findings: 40% of raw credit was capped 30-min blocks; 107 capped silences (39× 30–45 min, 18× 45–60, 34× 60–120, 16× >120); only 41 had commit evidence of continued work. Shipped **evidence-gated long-silence damping**: capped gaps recorded per plant (`capped_gaps`, cached), and a >45-min silence keeps its 30 only with a triggered commit in its first hour, else 15. Also fixed `cacheVisit` dropping `designer_minutes` — cached dates silently lost v4.54's gap-based Drawing (why a cached day showed nominal-only Drawing). Rejected after measuring: VNC start/stop pairing (`stop_vnc` appears once in the corpus), widening the 20-min fusion window (2 misses vs risk), crude >60-min threshold without the evidence gate (punishes evidenced work). Validation: 18/39 days unchanged, 26/05 + 12/06 bit-identical, changes always −15 per unevidenced long silence.
- **4.55** `designerGapByPlant` credits the whole designer **session**, not just the immediate gap: it bridges a tight burst of quick same-plant clicks (a momentary pop-out to pma/VNC and back, each gap ≤ `DESIGNER_BURST_MS` = 2 min) and runs until you leave the plant or hit a sustained > 2 min same-plant pause (capped 30). Fixes the "designer → quick check → resume designing" pattern (12/06 plant 10230: 9→30 min) while leaving spread-out designer clicks untouched (26/05 2511 stays 36 min — its clicks are 6 and 31 min apart, not a burst). Residual risk (bounded): a designer click + quick burst + then a long *break* before leaving credits the break as drawing (capped 30); rare.
- **4.54** better **Drawing** time. The graphic designer logs one pang click then runs click-free, so the flat 8-min/click nominal collapsed long sessions. New `designerGapByPlant(events)` sums the gap AFTER each Designer click (gap-capped) → `v.designer_minutes`; `categorizeVisit` credits Drawing `max(CAT_DESIGNER_MIN_EACH × designerN, v.designer_minutes)` (lift-only over the old nominal). Both build paths now retain per-click action (`_events` in `loadVisitsForDate`, `rec.ev` in `loadUserHistoryAllDates`) to feed it. Validated on the real 26/05 timeline: 2511's 30-min designer session 16→36 min, day Drawing 0.5→0.85 h. Old caches lacking `designer_minutes` fall back to the nominal.
- **4.53** time-calc R-g + R2 (from the multi-agent review). **R-g**: widen the isolated-touch cap to any lone access/vnc/diag surface (Direct/Proxy/VNC, not just pma/sys) with no commit → a single glance + long idle reads 8 min not 30 (now also fires on quick scans, keyed off `v.actions`). **R2**: distribute the workday total over **bookable** visits only (filters `categorizeVisit(v)[CAT_CHECK]`), so "to book" equals the configured hours instead of leaking into quick checks; quick-ness keys off the raw estimate so it's stable across normalize. Sim-verified: (g) 30→8, lone `restart` untouched, (i) booked 7.0→7.5 h.
- **4.52** time-calc R1 (from the review). A sparse config session's triggered commit now *defines* the session end — lifts a low click-base up to the span, and pulls a base DOWN to the span when it hit the 30-min gap cap (a long-idle artifact, unearnable from ≤2 clicks). Fixes a lone pma/designer click + commit + long idle reading 30 min instead of ~12; sub-cap bases stay lift-only (no regression), click-heavy untouched. Sim-verified: (d) 30→12, (e) 13→13, click-heavy 35→35.
- **4.51** short access-only visits → a separate **Quick check** bucket (`CAT_CHECK`, grey), time-based (`QUICK_CHECK_MAX_MIN=15`; the old ≤2-click test kept as a fallback for time over-credited by a long gap). Shown on the row + roll-up but in `CAT_NOT_BOOKED` → **excluded from the Copy-to-timesheet total** (foot now reads `≈ X h to book · Y h quick checks (not booked)`). These were previously folded into `Support - External`, so the booked total drops by the quick-check time (on the 06-19 fixture the former Support 0.38 h moves out of the booked 7.15 h into the not-booked line).
- **4.50** time-model deep-dive (multi-agent workflow over 30 real days / 193 plant-day records / 41,833 events).
  Two shipped changes, both validated to leave the approved 06-19 split bit-identical (Integration 4.40 / Drawing
  1.47 / Setup 0.90 / Support 0.38 h):
  1. **Removed the v4.48 `tables.php` commit-content classification pass** (`chgCommitClass` + the per-commit fetch in
     `ensureChangesEnriched`). Empirically 457/457 triggered commits across 94 plants classify as `integration` — a
     device-add commits the graphic table AND the device tables together, so commit *content* can never isolate
     Drawing/Settings. `changes_in_window > 0` is the byte-identical signal; `categorizeVisit`'s `commit_classes`
     fallback already uses it. Pure perf/complexity win, zero behaviour change.
  2. **Isolated config-touch cap** (`ISOLATED_TOUCH_CAP = 8`): in `ensureChangesEnriched`, a single pang click that
     opened a config surface (`pma_local`/`sys_tools`) with NO triggered commit has its click-only floor lowered
     30→8 min (a lone pma click was inheriting the full 30-min gap cap — measured over-credit). Gated on
     `count==1 && triggered.length==0 && (pma_local||sys_tools)` so Direct/VNC login glances and commit-bearing
     touches (which fusion instead lifts) are untouched.
  REJECTED after empirical test (kept as a guardrail note): a **density-gated gap bridge** (credit a within-plant gap
  up to 60 min when bracketed by dense clicks) — the workflow recommended it, but re-running it on the data showed it
  fires on COOP OBS Steinkjer's 95-min commit-less gap (06-19), inflating Integration 4.40→5.03 h on a gap that's
  likely an evening break. Too speculative; the cap correctly protects "plant left open all day" records (gaps of
  183/249/295 min). Also rejected: broad quick-touch floors / cross-plant reattribution (both move Support's lone
  clicks → breach the split), and extending commit-fusion past ≤2 clicks (would double-count interleaved H6).
  Deferred (measure-only): an AK3 per-use floor and a `Setup - Network/IT` bucket for sys-only visits.
- **4.49** shows the category split **per plant** too: each plant row now renders a `.catrow` of `categoryChips(v)`
  (same `categorizeVisit(v)` that feeds the day roll-up) — small colour-dot chips like `Integration 53m · Drawing 24m ·
  Setup 18m` under the action chips, ordered by `CAT_ORDER`, using `CAT_SHORT` labels and `fmtMinutes`. Refines with the
  rest of the row once commit classes arrive; hidden (`.catrow:empty`) for visits that produce no split.
