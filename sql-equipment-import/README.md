# SQL Equipment Import

A floating panel that overlays the phpMyAdmin frameset on IWMAC plant servers. Pick a driver template from a GitHub-hosted manifest (or load a `.sql` from disk), edit unit rows + Modbus settings (RTU/TCP, multi-IP) in the form, and emit the full SQL ready to paste into the plant DB. The rest of the template (CREATE TABLE, parameter rows, set rows, processes, order_no, …) is emitted verbatim.

No database, no API. Templates are static files in this repo.

## Install

[Click to install](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/SQL-Equipment-Import.user.js) (requires [Tampermonkey](https://www.tampermonkey.net/))

## Usage

1. Open phpMyAdmin on a plant (`*.plants.iwmac.local:*/secure/phpMyAdmin/...`) and select the plant DB. The panel appears top-right (drag header to move; `×` hides; click "SQL Import" to reopen).
2. Pick a **Driver template** from the dropdown — it lists everything published in [`templates/manifest.json`](templates/manifest.json). The script downloads the picked `.sql` directly from GitHub raw. (If the manifest fails to load, the **load a .sql from disk** input below still works.)
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
- The script never talks to a backend other than GitHub raw.
