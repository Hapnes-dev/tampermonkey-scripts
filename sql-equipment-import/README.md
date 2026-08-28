# SQL Equipment Import

A floating panel that overlays the phpMyAdmin frameset on IWMAC plant servers. **Search any plant's equipment** by `unit_name`, `grp_name`, `driver_type`, `regulator_type` or `order_no` and fetch it live via the Toolbox plant-SQL API — settings, order_no, processes and the `iw_par_*`/`iw_set_*` tables are rebuilt into a template with three generic example units — or load a `.sql` from disk. Edit unit rows + Modbus settings (RTU/TCP, multi-IP) in the form, and emit the full SQL ready to paste into the plant DB.

The GitHub-hosted template picker was removed in v9.0 — the [`templates/`](templates/) folder remains in the repo only as an archive of `.sql` files for the disk loader.

## Install

[Click to install](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/SQL-Equipment-Import.user.js) (requires [Tampermonkey](https://www.tampermonkey.net/))

## Usage

1. Open phpMyAdmin on a plant (`*.plants.iwmac.local:*/secure/phpMyAdmin/...`) and select the plant DB. The panel appears top-right (drag header to move; `×` hides; click "SQL Import" to reopen).
2. **Plant id** is pre-filled from the phpMyAdmin hostname (`6176.plants.iwmac.local` → `6176`); type any other plant id to use a donor plant. The **🔎 all plants** link opens the toolbox [Search All Plants](http://toolbox.iwmac.local:8501/search_all_plants) tool — filter `regulator_type` / `unit_name` there to find which plant runs the regulator you need, then bring its plant id back here.
3. Press **Load equipment** (or just start typing in the search bar — it loads on first use). The list shows every driver on the plant, live from its `iw_sys_plant_units`; a driver hosting several equipment types (several `order_no` param lists — a mixed Modbus bus, an AKA gateway, a BACnet driver) gets one indented `↳ order_no — units — regulator — unit names` sub-row per equipment.
4. **Search** matches `unit_name`, `grp_name`, `driver_type`, `regulator_type` and `order_no`. A driver-name match shows the whole group; an equipment-level match narrows to the sub-rows that actually matched.
5. Click an **↳ equipment row** to fetch just that one: its single `iw_sys_order_no` row and its own `iw_par_<link>_groups` / `iw_par_<link>_param` / `iw_set_<base>` tables (`CREATE TABLE IF NOT EXISTS` plus all rows), together with the hosting driver's `iw_sys_plant_settings` (owner = driver_type) and `iw_sys_processes` row. Clicking the **driver row** instead fetches the whole driver — every equipment on it. The donor's real unit rows are **never copied**: the template ships three generic example units — `P01 / Pos 01 / 0_1` … — carrying the donor's linkage columns (grp_name, driver_type, regulator_type, order_no).
6. The form takes over: **Unit rows** (rename / add `+` / remove `−`, renumbering cascades from row 1), **mb_mode** (RTU/TCP), **comm_baudrate**, **comm_parity**, and per-unit IPs when TCP (emitted as `mb_tcp_servers`, auto-numbered `1;ip;502;1000;2;500`). Click **Generate SQL** → review → **Copy** → paste into the phpMyAdmin SQL tab → Run.

`…or load a .sql from disk` still works as before for file-based templates (UTF-8/latin1 auto-detected).

## Notes (AI reference)

- Runs only on the top frameset window (`window.top === window`); the phpMyAdmin top page has no `<body>`, so the panel is appended to `document.documentElement` with `position: fixed`.
- Runtime SQL parser (`parseBlock` + `extractTuples` + `splitFields`) is single-quote-aware (`''` escape) and locates `iw_sys_plant_units` and `iw_sys_plant_settings` by name. Editable fields are looked up by column name (`unit_id`, `unit_name`, `driver_addr` / `driver_adr`, plus the named `EDITABLE_SETTINGS`). The parser is **not** comment-aware, so generated `--` comments are stripped of quote characters.
- Single-quote escaping doubles `'` → `''`; backslashes are escaped as `\\` to be safe across MariaDB modes.
- Backend: `http://toolbox.iwmac.local:8505/plant-sql/` only (POST JSON `{plant_id, sql_command}`, SELECT-only here, statements batched with `;` and chunked ×8 per call, results come back per statement). Calls carry `X-Caller: SQL Equipment Import` and a per-plant random-led `X-Run-Id`, same convention as AK3-Autoscan / Topology Copy.
- The equipment list is one `GROUP BY driver_type, order_no` query with `GROUP_CONCAT(DISTINCT …)` aggregates of regulator_type / unit_name / grp_name (LEFT-capped at 300/500/300 chars) — that is what the search bar matches against, client-side. Old plants without a `regulator_type` column get an automatic retry without it.
- Security: the request helper runs `anonymous: true` (no browser cookies ride along); the panel never stores or sends any credential. API text is treated as untrusted — plant id re-validated at fetch time, identifiers (tables, columns, index names, engine/charset) must match `[A-Za-z0-9_]+`, column types must match a strict shape, quoted defaults are unquoted and re-escaped, comment labels are whitespace-collapsed and quote-stripped, and every value is escaped with the single-quote/backslash escaper. All panel HTML from dynamic data goes through `escapeHtml`.
- The live fetch discovers table layouts from `information_schema` (sys-table columns differ between plant generations) and rebuilds `CREATE TABLE` from `information_schema.columns/statistics/tables`, because the API refuses `SHOW CREATE TABLE`. Every value is `CAST(… AS CHAR)` so datetimes arrive as `YYYY-MM-DD HH:MM:SS`, not the API's JSON date form. Tables page at 5000 rows.
- Driver link chain used by the fetch: `units.driver_type` = `settings.owner` = `processes.process_name`; `units.order_no` → `iw_sys_order_no.db_link/group_link` → `iw_par_<db_link>`, `iw_par_<group_link>`, `iw_set_<db_link minus _param>`.
- Cross-plant regulator *search* stays in the toolbox [Search All Plants](http://toolbox.iwmac.local:8501/search_all_plants) Streamlit tool: its all-plants dataset lives in db_main, which has no HTTP API reachable from a userscript (verified — toolbox-sql sees only the toolbox-local MariaDB, and the Streamlit table is a canvas glide-grid that cannot be scraped).
