# SQL Equipment Import

A floating panel that overlays the phpMyAdmin frameset on IWMAC plant servers. Pick a driver template from a GitHub-hosted manifest, load a `.sql` from disk, **or fetch a live driver straight from any plant** via the Toolbox plant-SQL API. Edit unit rows + Modbus settings (RTU/TCP, multi-IP) in the form, and emit the full SQL ready to paste into the plant DB. The rest of the template (CREATE TABLE, parameter rows, set rows, processes, order_no, …) is emitted verbatim.

Static templates come from this repo; the live fetch talks to `toolbox.iwmac.local:8505/plant-sql/`.

## Install

[Click to install](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/SQL-Equipment-Import.user.js) (requires [Tampermonkey](https://www.tampermonkey.net/))

## Usage

1. Open phpMyAdmin on a plant (`*.plants.iwmac.local:*/secure/phpMyAdmin/...`) and select the plant DB. The panel appears top-right (drag header to move; `×` hides; click "SQL Import" to reopen).
2. Pick a **Driver template** from the dropdown — it lists everything published in [`templates/manifest.json`](templates/manifest.json). The script downloads the picked `.sql` directly from GitHub raw. (If the manifest fails to load, the **load a .sql from disk** input below still works.)
### Fetch a live driver from a plant (v8.0)

Between the template dropdown and the disk loader sits **"…or fetch a live driver from a plant"**:

1. The plant id is pre-filled from the phpMyAdmin hostname (`6176.plants.iwmac.local` → `6176`); type any other plant id to use a donor plant. The **🔎 all plants** link opens the toolbox [Search All Plants](http://toolbox.iwmac.local:8501/search_all_plants) tool — filter `regulator_type` / `unit_name` there to find which plant runs the regulator you need, then bring its plant id back here.
2. **Load drivers** lists every driver on that plant, live from its `iw_sys_plant_units`: `driver_type — unit count — regulator type(s)`. The filter box narrows by regulator or driver name.
3. Click a driver and the script rebuilds a full template from the source plant: the driver's unit rows, its `iw_sys_plant_settings` (owner = driver_type), `iw_sys_order_no`, `iw_sys_processes`, and every linked `iw_par_<link>_groups` / `iw_par_<link>_param` / `iw_set_<base>` table — `CREATE TABLE IF NOT EXISTS` plus all rows.
4. The form takes over exactly as with a file template: rename/renumber units, set RTU/TCP, **Generate SQL**, copy, paste into the target plant's phpMyAdmin.

### Common form flow

3. The form populates from the file:
   - **Unit rows** — pre-filled from the `iw_sys_plant_units` block; rename / add (`+`) / remove (`−`).
   - **mb_mode** (RTU/TCP/…), **comm_baudrate**, **comm_parity** — pre-filled from `iw_sys_plant_settings`; edit as needed.
   - **mb_tcp_servers** — only shown when mb_mode is TCP. One IP per row, auto-numbered: `1;ip;502;1000;2;1000`, `2;ip;...`, etc.
4. Click **Generate SQL** → review in textarea → **Copy** → paste into the phpMyAdmin SQL tab → Run.

## Adding a new driver template

1. Drop the `.sql` file into [`templates/`](templates/).
2. Add an entry to [`templates/manifest.json`](templates/manifest.json):
   ```json
   {
     "name": "MY_DRIVER-v1",
     "display_name": "My Driver v1",
     "driver_type": "MYDRV",
     "file": "MY_DRIVER-v1.sql"
   }
   ```
3. Commit + push. Click the `↻` button next to the dropdown in the panel (or reload the page) to pick up the new template.

The userscript fetches `manifest.json` and template files from `https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/templates/…` with a cache-buster, so changes are visible immediately after push.

## Notes (AI reference)

- Runs only on the top frameset window (`window.top === window`); the phpMyAdmin top page has no `<body>`, so the panel is appended to `document.documentElement` with `position: fixed`.
- `gmFetch()` uses `GM_xmlhttpRequest` (with `@connect raw.githubusercontent.com`) so cross-origin fetches work even with strict browser CORS.
- Runtime SQL parser (`parseBlock` + `extractTuples` + `splitFields`) is single-quote-aware (`''` escape) and locates `iw_sys_plant_units` and `iw_sys_plant_settings` by name. Editable fields are looked up by column name (`unit_id`, `unit_name`, `driver_addr` / `driver_adr`, plus the named `EDITABLE_SETTINGS`).
- Single-quote escaping doubles `'` → `''`; backslashes are escaped as `\\` to be safe across MariaDB modes.
- Backends: GitHub raw (templates) and `http://toolbox.iwmac.local:8505/plant-sql/` (live driver fetch — POST JSON `{plant_id, sql_command}`, SELECT-only here, statements batched with `;` and chunked ×8 per call, results come back per statement). Calls carry `X-Caller: SQL Equipment Import` and a per-plant `X-Run-Id`, same convention as AK3-Autoscan / Topology Copy.
- Security (v8.1): both request helpers run `anonymous: true`, so no browser cookies ever ride along to GitHub or the Toolbox API; the panel never stores or sends any credential. API text is treated as untrusted — plant id re-validated at fetch time, identifiers (tables, columns, index names, engine/charset) must match `[A-Za-z0-9_]+`, column types must match a strict shape, quoted defaults are unquoted and re-escaped, driver names are whitespace-collapsed before landing in `--` comments, and every value is escaped with the single-quote/backslash escaper. All panel HTML from dynamic data goes through `escapeHtml`.
- The live fetch discovers table layouts from `information_schema` (sys-table columns differ between plant generations) and rebuilds `CREATE TABLE` from `information_schema.columns/statistics/tables`, because the API refuses `SHOW CREATE TABLE`. Every value is `CAST(… AS CHAR)` so datetimes arrive as `YYYY-MM-DD HH:MM:SS`, not the API's JSON date form. Tables page at 5000 rows.
- Driver link chain used by the fetch: `units.driver_type` = `settings.owner` = `processes.process_name`; `units.order_no` → `iw_sys_order_no.db_link/group_link` → `iw_par_<db_link>`, `iw_par_<group_link>`, `iw_set_<db_link minus _param>`.
- Cross-plant regulator *search* stays in the toolbox [Search All Plants](http://toolbox.iwmac.local:8501/search_all_plants) Streamlit tool: its all-plants dataset lives in db_main, which has no HTTP API reachable from a userscript (verified — toolbox-sql sees only the toolbox-local MariaDB, and the Streamlit table is a canvas glide-grid that cannot be scraped).
