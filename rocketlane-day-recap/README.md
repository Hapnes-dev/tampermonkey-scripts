# Rocketlane Day Recap

Adds a 🏭 **Day Recap** button on **pang.qxs** — pick a date and see every IWMAC plant you visited that day (plant_id, plant name, time of first action, and which actions you performed).

Rocketlane's My Timesheet gets a small button that just opens pang with the date pre-filled — pang has the live, authoritative plant data, so the recap runs there.

## Install

[Click here to install](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-day-recap/Rocketlane-Day-Recap.user.js) (requires Tampermonkey).

## Usage

### From pang
1. Open `http://tools.iwmac.local/pang.qxs`
2. Click 🏭 **Day Recap** (bottom-right)
3. Pick a date → **Search**
4. Lists every plant where you have actions logged on that date

By default, **all ~7,600 IWMAC plants are scanned** (~1 min) so every visit shows up — including plants you reached through plant-admin/designer rather than by opening them in pang. Tick **Quick scan (recent only)** to scan just your ~50 recent pang plants instead (a few seconds), at the cost of missing those plant-admin visits.

### From Rocketlane
1. On any `https://kiona.rocketlane.com/timesheets/...` page, click 🏭 **Day Recap**
2. Pick a date → **Open on pang ↗** opens pang in a new tab with the panel auto-populated

## How it works

Pang already loads `module_plants.coll.data` — the full plant inventory with names — into memory the moment `pang.qxs` opens. The script reads that directly. No SQL, no caches to maintain, no cross-origin sync issues.

For each plant in scope, it calls pang's existing `actions.php` with `method:"get_history"`. Same origin, your existing pang session cookie is used automatically.

## Why v4 is a clean break

v3.x tried to mirror pang's data into Tampermonkey storage so a panel on Rocketlane could read it. That ran into popup blockers, cross-origin localStorage walls, GM-storage sync gaps, and stale name caches. v4 sidesteps all of that by putting the panel where the data lives.

## Limitations

- Pang's API is per-plant (`get_history(plant_id)`) — there's no server-side "list everything user X did on date Y" endpoint, so the script fans out one request per plant. The default full scan does ~7,600 requests (20 in parallel, ~1 min).
- **Quick scan (recent only)** mode is fast but only covers your ~50 recent pang plants. It will miss any plant you didn't open through pang — e.g. plants you worked on via plant-admin/designer — which is exactly why the full scan is the default.
