# Rocketlane Day Recap

Adds a 🏭 **Plants visited** button on Rocketlane's **My Timesheet** — pick a date and see every IWMAC plant you visited that day (plant_id, plant name, first/last action time, which actions you performed, and an estimated time split).

## Install

[Click here to install](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-day-recap/Rocketlane-Day-Recap.user.js) (requires Tampermonkey).

## Usage

1. On any `https://kiona.rocketlane.com/timesheets/...` page, click 🏭 **Plants visited** (bottom-right)
2. Pick a date
3. **Search** lists plants you have actions logged on that day, scanning your recent pang plants **plus every plant you've been found on before** (fast). This footprint grows automatically with each scan, so over time Search covers your real working set — including plant-admin/designer plants — without a full scan.
4. For a complete picture — to discover brand-new plants not yet in your footprint — click **🔍 Full scan**. It queries all ~7,600 plants (~1 min, after a one-time confirmation), **caches the result per date** (re-opening that day is instant), and adds anything it finds to your footprint so future Searches stay fast and complete.

Optionally set your **Workday total** and tick **Distribute to total** to split the day's hours across the plants weighted by activity.

## How it works

The panel runs on Rocketlane and calls pang's `actions.php` (`method:"get_history"`) once per plant in scope via `GM_xmlhttpRequest` (batched, http origin — see below). **Search** scopes to your recent plants plus your accumulated footprint (`user_plants`: every plant you've been matched on); **Full scan** scopes to the whole inventory and feeds that footprint. Since pang has no server-side date filter, there's no way to shrink the per-plant response — keeping the everyday scope small (footprint) is what keeps it fast.

The full inventory (plant ids + names) only exists in a live pang tab, websocket-loaded into `module_plants.coll.data` — there's no HTTP endpoint that lists plants. So the first full scan briefly opens `pang.qxs` in the foreground to harvest that list, then caches it for reuse.

## Limitations

- Pang's API is per-plant (`get_history(plant_id)`) and has no server-side "what did user X do on date Y" filter, so every plant's full history is read and filtered client-side. To keep this fast the script **batches** the reads (JSON-RPC, up to ~30 plants per request, 20 concurrent) — pang processes a batch sequentially, so it's the same server load as single calls but with far fewer round-trips (~per-plant time roughly halves; a Full scan is a few hundred requests, not ~7,600). Full-scan results are cached per date (`full_scan_cache`), so re-opening a previously full-scanned day is instant. Today's cache can go stale as you keep working — the footer shows the scan time, and Full scan always re-runs and overwrites it.
- The plant list itself only exists in a live pang tab (websocket-loaded into `module_plants.coll.data`; no HTTP endpoint, and IDs are sparse — 203 up past 50000 — so a numeric range scan isn't viable). The first full scan opens pang in the foreground for ~6 s to harvest the inventory, then caches it (`all_plants`), so the flash rarely repeats.
- Plain **Search** is fast but only covers your ~50 recent pang plants — it misses any plant you didn't open through pang (e.g. plant-admin/designer visits). Use **Full scan** to catch those.
- pang is served on both **http and https**, with *separate* per-origin browser storage — so the recent list and login differ between the two (the full inventory + history are identical). The script copies recent + login into shared Tampermonkey storage and, on first use, harvests from **both** protocols, so it works whichever one a colleague uses.
- **Identity matching.** History entries are tagged with a `user` field that pang derives from the auth cookie (`iw_security[username]`) — bare for some logins (`thomas.kvalvag`), email for others (`eivind.slordal@kiona.com`). The script reads that same cookie (not the SPA's `pang.login.username`, which can be missing or formatted differently) and normalises both sides (lowercase, strip `@domain`) before matching. If a scan still matches nothing while other people were active that day, it shows a **"pick your name"** chooser built from the actual `user` values in the data — choose yourself once and it's remembered (`user_override`). It never silently scans as someone else.
