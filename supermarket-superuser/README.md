# Supermarket Superuser

Power-user overlay for the **IWMAC Supermarket parameters page** (`…/supermarket/#/<plant>/settings/regulators`). Adds column filters, a searchable unit selector, an Edit mode that drag-moves parameters between Measurements ⇄ Settings (`att` `r` ⇄ `rw`), a cross-group **Show all parameters** view, a full driver-parameter editor with scaling presets, batch changes (alarm priority / scaling / override deletes) on marked rows — repeatable across **other units** — and a real Excel (`.xlsx`) export. Everything floats in overlay portals above the native IWMAC UI; the page's own header and tables are never restructured.

By ØTS / MATS / Hapnes. Console tag: `[Supermarket Parameters POC]`, CSS/id prefix `sm-poc-`.

## Install

[**Install Supermarket-superuser.user.js**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/supermarket-superuser/Supermarket-superuser.user.js)

> Requires [Tampermonkey](https://www.tampermonkey.net/). Historically distributed via `http://toolbox.iwmac.local/oets/tm/Supermarket-superuser.user.js` (≤ v4.4); from v4.5 this repo copy auto-updates from GitHub.

## Match

```
*.plants.iwmac.local:8080/supermarket/*
*www.iwmac.local/supermarket/*
*iwmac.net/supermarket/*
*:81/supermarket/*
```

The script injects on any `/supermarket/` page but only *activates* on the **`/settings/regulators`** route (hash or path). On every other route it sleeps — all overlays, styles and portals are removed.

## Toolbar

Floats as a fixed overlay aligned into the Kiona top bar's free space (ending just left of the language/user controls) when the bar exists, otherwise as a fixed top-center bar. Since v4.6 it is **never inserted into the bar's DOM** — the bar is framework-rendered, and a foreign child crashed its re-render, which is what used to kill the language dropdown:

| Control | What it does |
|---|---|
| **Enable Edit mode** | Turns on row selection, drag-move and the batch menus. Turning it off discards unsaved moves. |
| **Hide 0.0** | Hides rows whose Value is `0` / `0.0` (works in both the native panes and Show all parameters). |
| **Save** + `N changes` | Writes the pending Measurements ⇄ Settings moves (`att` `r` ⇄ `rw`) to the plant DB. |
| **Export Excel** | Downloads the visible (filtered) rows as `.xlsx` — Measurements + Settings sheets. |
| **Help** | Full in-page user guide (draggable modal). |

## Features

### Column filters
A floating filter input above every column of both panes. Matching is case- and diacritic-insensitive; space-separated terms are AND-ed; `a++b` requires the parts to appear **in order**. `Esc`/`x` clears a field; active fields turn yellow and a `visible/total` counter appears. The **Unit** column filter doubles as a dropdown listing exactly the distinct units present in the table. Filters survive IWMAC's SPA redraws.

### Searchable unit selector
The native unit `<select class="iwmac_dropdown">` is visually replaced by a searchable combo: filter by name or unit id, toggle **A-Z**/**Orig** sort, `↑`/`↓`/`Enter`/`Esc` navigation — and `↑`/`↓` step to the previous/next unit even while the list is closed. Selection is pushed back through the native select with real `input`/`change` events, so the SPA reloads normally.

### Edit mode — move parameters between panes
Select rows (click, `Shift`+click range, `Ctrl`+click toggle, `Ctrl`+`Shift`+`A` all visible, `Esc` clear) and drag them to the opposite pane. Moves are **pending** until saved: the row is shown as a ghost row under the target pane (green = will become `rw`/Setting, blue = will become `r`/Measurement) and can be dragged back to undo. **Save** resolves each row's `driver_id` (SQL lookup by alias + menu when the row doesn't carry one), writes both the main and override tables in one `batch_sql` transaction, then soft-refreshes the IWMAC list — no page reload.

### Show all parameters
A `Show all parameters` button is injected next to the native group buttons (pixel-styled from a real group button). It fetches **every group** of the selected unit through the page's own `settings.php` JSON-RPC (6 groups in parallel, per-unit 30 s cache, progressive rendering) and shows a two-pane, sortable, per-column-filterable table with a Group badge per row. Edit-mode drag-move works here too. Right-click a row for: **Highlight used_in_graphics** (marks rows used in plant graphics green, via toolbox `get_unit_menu.php`), **Get Driver Parameter Details**, and — in Edit mode — the batch actions.

### Driver parameter details
A full editor for one `iw_gen_driver_parameters` row: alias_text, plant_pri (A/B/C/N/blank), eng_unit, format (`%.1f` …), range min/max, scale mode (1 scale / 2 format / 3 scale+format+clipping), raw/eng min/max, att (`r`/`rw`/`vr`/`vrw`), format_extra (with a large-textarea editor). Fields that have data in the override table get a blue border. Rows that already know their `driver_id` (every Show-all-parameters row) are fetched by driver_id directly (v4.6) — the unit+alias+menu route fails on AK3-style plants, where display aliases carry bus-address prefixes and the all-params "menu" is the RPC group hash. Extras: **Scaling Presets** (Invert, x0.1…x1000, Kelvin→Celsius, L/h↔m³/h, CT ratios … with live preview), **Copy Meter ID** (`plant_id;unit_id;element_id`), **Delete Override**, **Apply to other units…**.

### Batch on marked + Apply to other units
With rows marked in Edit mode (works in the native panes *and* Show all parameters; the entries are also injected into IWMAC's own right-click menu):

- **Change Plant pri for marked** — alarm priority A/B/C/N/blank.
- **Scale all marked** — scale mode + raw/eng ranges, a "raw X should become Y" calculator, custom values, and the preset table.
- **Delete overrides for marked** — removes the whole override row per driver_id (Escape stop/start regenerates from the tag list).

Every batch write is **verified**: the rows are re-selected from the DB afterwards and each field compared, with a written/failed report. **Apply to other units…** opens a unit picker and repeats the change per unit, re-matching parameters by **alias + menu** (never by `driver_id`, which is unique per unit) — per-unit results show written / not found / error.

### Excel export
A genuine `.xlsx` is built from scratch in the page (store-only ZIP + CRC32 + minimal SpreadsheetML — the script runs `@grant none`, so no GM APIs or libraries). Numeric-looking values become real numbers so Excel can sum/sort. Sheets `Measurements` and `Settings`, columns Group/Name/Value/Unit, filename `parameters_<plant>_<unit>_<YYYY-MM-DD_HHMM>.xlsx`. Respects the active filters; exports all groups when Show all parameters is open, otherwise the current group.

## How it works (short)

- **SPA-safe lifecycle:** a MutationObserver (ignoring the script's own nodes), wrapped `history.pushState`/`replaceState` (IWMAC navigates without hashchange events), and `hashchange`/`popstate` all funnel into a 250 ms debounced re-init keyed on a content signature; leaving the route tears everything down.
- **Overlay portals:** filters, ghost rows, the unit combo and the all-params view live in fixed-position portal `<div>`s that `stopPropagation()` on all pointer/keyboard events, so the IWMAC SPA never reacts to clicks inside script UI.
- **Writes** go through the toolbox API `http://toolbox.iwmac.local/oets/api/index2.php` (`action=batch_sql`, ≤ 500 statements per transaction) against `iw_plant_server3.iw_gen_driver_parameters` **and** `…_override` (`INSERT … ON DUPLICATE KEY UPDATE`, so values survive an Escape parameter regeneration). Reads use the same API's raw `sql_command` plus the page-origin `settings.php` JSON-RPC.

Full technical reference (architecture, API payloads, exact SQL, gotchas, function index): [CLAUDE.md](CLAUDE.md).
