# IWMAC Topology Copy — technical reference

Deep technical notes for `iwmac-topology-copy/IWMAC-Topology-Copy.user.js`, a single IIFE. Current
`@version`: **1.21**. Grants: `GM_setClipboard`, `GM_xmlhttpRequest`; `@connect toolbox.iwmac.local`.
Repo-wide rules (version bumping, commit/push, line endings) live in the **root `CLAUDE.md`** and are not
repeated here. The folder `README.md` is user-facing; source behavior wins when comments or README prose
drift.

---

## 1. What it is / where it runs

The script augments the IWMAC `sys_tools` Topology toolbar with three operations:

- **Copy Topology** — rich HTML table plus plain TSV clipboard content;
- **Export to Excel** — a genuine OOXML `.xlsx` with native row outlines;
- **Show Details** — SQL-backed connection columns inserted into the live w2ui grid.

Metadata:

- `@match *://*.plants.iwmac.local:8080/secure/sys_tools/*`
- `@run-at document-idle`

There is no additional pathname router. The script polls every **750 ms**; it acts only when the topology
toolbar/grid exists. This is necessary because w2ui rebuilds the toolbar while navigating between
`sys_tools` sidebar nodes.

`makeButton()` inserts three w2ui-shaped `<td>` cells immediately before
`#tb_grid_topology_toolbar_right`. IDs `iwmac-topo-copy-btn`, `iwmac-topo-export-btn`, and
`iwmac-topo-detail-btn` make injection idempotent.

---

## 2. Two topology representations

The script deliberately uses two different representations of the page:

1. **Rendered DOM rows** for Copy and Excel's visible topology hierarchy.
2. **`w2ui.grid_topology` model records** for live detail columns, because the grid is virtualized and
   direct DOM edits would fall out of sync.

`expandAll()` first tries `w2ui.grid_topology_toolbar.click('open_all')`, then the DOM toolbar fallback
`#tb_grid_topology_toolbar_item_open_all table.w2ui-button`. `collapseAll()` mirrors it with
`close_all` / `#tb_grid_topology_toolbar_item_close_all`.

`scrapeRows()` reads `#grid_grid_topology_records tr.w2ui-record`:

- Tree: `td[col="0"] > div` `title`
- Unit name: `td[col="1"] > div` `title`
- Owner: `td[col="2"] > div` `title`
- Status: `td[col="3"] > div` text
- Depth: `max(0, count(span.w2ui-show-children) - 1)`

It tracks the latest tree label at each depth in `lastByDepth`; a row's `parent` is the last label at
`depth - 1`. That parent label later drives connection derivation.

---

## 3. Copy flow

`onCopy()` expands the tree, waits a fixed **350 ms**, scrapes the rendered rows, then builds:

- TSV headed `Tree`, `Unit name`, `Owner`, `Status`, with two ordinary spaces per depth;
- an escaped HTML table with four non-breaking spaces per depth and gray/bold group rows (a group is a
  row with no name, owner, or status).

`writeRichClipboard()` first tries `navigator.clipboard.write()` with one `ClipboardItem` containing
both `text/html` and `text/plain`. Its second strategy installs a one-use `copy` handler and calls
`document.execCommand('copy')`. If both return false, `onCopy` tries `GM_setClipboard` with HTML; if the
GM API is unavailable it falls back to `navigator.clipboard.writeText(tsv)`.

Copy does not call the Toolbox API, does not append virtualized/missing units, and leaves the tree
expanded.

---

## 4. Toolbox SQL API query

`getPlantIdFromHost()` takes the leading digits before the first hostname dot. `fetchUnitsApi(plantId)`
POSTs JSON `{ plant_id, sql_command }` to:

`http://toolbox.iwmac.local:8505/plant-sql/`

`gmPostJson` uses `Content-Type`/`Accept: application/json` and a **30,000 ms** timeout. It parses the
response as JSON; success is determined from `body.success`, not merely the HTTP status.

`buildPlantUnitsSql(includeBacnet)` selects active units and joins connection settings by
`setting.owner = u.driver_type`. It excludes:

- `unit_id` beginning `VV_`;
- `unit_name` beginning `VV_`;
- `unit_id` equal to `SERVER` after trim/uppercase.

The query produces `plant_id`, `plant_name`, `unit_id`, `unit_name`, `driver_type`, `driver_addr`,
`connection_type`, `resolved_address`, `comm_port`, `baudrate`, and `parity`.

Connection fields from SQL:

- BACnet drivers → `Bacnet`; address from `iw_bacnet2_scanner.iw_bacnet_devices.ip_address`, falling
  back to `driver_adr_extra`.
- `AK2` → `Danfoss AK2 TCP/IP`; address from `tcpip_server`.
- `AK3` → `Danfoss AK3 XML`; address is the host portion of `xml_service_addr` after removing scheme,
  path, and port.
- `mb_mode` `0` / `1` / `2` → `Modbus RTU` / `Modbus ASCII` / `Modbus TCP`.
- TCP addresses are extracted from the matching line of `mb_tcp_servers`; `CHAR(59)` is used instead of
  a literal semicolon so the Toolbox safety validator does not split the SQL as multiple statements.
- Serial `comm_port`, `comm_baudrate`, and `comm_parity` are emitted only for modes `0`/`1`. Parity
  normalizes numeric, one-letter, and word forms to `None`, `Odd`, `Even`, `Mark`, or `Space`.

The first query includes the BACnet scanner join. If the API error matches
`/iw_bacnet|doesn.?t exist/i`, it retries without that join and uses `driver_adr_extra` for BACnet
addresses. Other errors are fatal to the caller.

Successful rows become a plain object keyed by trimmed uppercase `unit_id`. If duplicate IDs are
returned, the last row wins.

---

## 5. The page-tree/API merge — `deriveConnection`

The merge key is uppercase `unit_id`:

- Excel looks up API data with the scraped leaf's `tree` text.
- Live details look it up with `grid.records[].unit_id`.

The tree's immediate parent is not cosmetic; it can override API classification and address:

1. A parent matching `COM\s*\d+` is a serial parent.
2. Under a serial parent, connection type is forced to `Modbus RTU` even when the driver's API type
   suggests TCP. This models RTU behind a Moxa TCP bridge.
3. `COMx - <IPv4>` produces `Moxa converter (<IPv4>)`; a COM parent without an IP produces
   `Physical port`.
4. A non-COM parent containing IPv4 or IPv4`:port` overrides `api.resolved_address` with that value.
5. Otherwise address remains `api.resolved_address`.
6. Non-COM driver type `FX16` is forced to `Modbus TCP`; it is the only member of
   `tcpOnlyDrivers`.
7. Comm port prefers `api.comm_port`; only when empty does it use the number from `COMx`.
8. Baudrate, parity, and driver address come directly from the API row.

`deriveConnection()` is shared by Excel and Show Details; do not duplicate this logic in either caller
or their output will diverge.

---

## 6. Real `.xlsx` export

`onExport()` expands, waits **350 ms**, scrapes the DOM hierarchy, then attempts the SQL API. API failure
is non-fatal: it logs/warns and exports four topology-only columns.

Because large virtualized grids may not render every row, a successful API result is also used as a
completeness backstop. API unit IDs absent from the scraped set are appended as:

```text
Additional units                  depth 0
  <connection_type>               depth 1
    <unit_id> / name / driver     depth 2
```

Connection-type groups are alphabetically sorted; units inside each group sort by `unit_id`. These
synthetic records receive the same API merge as scraped leaves.

`buildXlsx()` creates an OOXML package with six files:

- `[Content_Types].xml`
- `_rels/.rels`
- `xl/workbook.xml`
- `xl/_rels/workbook.xml.rels`
- `xl/styles.xml`
- `xl/worksheets/sheet1.xml`

The built-in `makeZip()` writes an uncompressed ZIP (method `0`) with CRC-32, local headers, central
directory, and EOCD. There is no spreadsheet dependency. Text is stored as escaped inline strings.

Each data row receives `outlineLevel="<depth>"`; `sheetPr` sets `summaryBelow="0"` and
`summaryRight="0"`, so Excel displays native outline controls above/left of their detail. The maximum
depth is written to `outlineLevelRow`. Header and group rows use the gray bold styles. When any API rows
exist, the six detail columns are added, giving ten columns total; an empty API map produces four.

The actual filename is:

`topology_<plant-label>_<YYYY-MM-DD>.xlsx`

`getPlantLabel()` reads the full `.plant_info` text, removes Windows-invalid filename characters, and
turns whitespace into underscores. It is therefore commonly plant ID **plus plant name**, not just the
numeric plant ID. Its fallback is `topology`. The object URL is revoked after **5,000 ms**.

---

## 7. Live Show Details flow

`onShowDetails({ auto })` works on `w2ui.grid_topology.columns` and `.records`:

1. Refuse an absent grid, an already-shown grid, a busy grid, or a host without plant ID.
2. Set `grid.__iwmacBusy = true`, caption `Loading…`, and fetch the API map.
3. **After the fetch**, call `expandAll()` so connection children flatten into `grid.records`.
4. `waitForLeaves(grid)` polls every **100 ms** until a positive leaf count is unchanged for two ticks,
   or the default **2,500 ms** budget expires.
5. `addDetailColumns` appends only missing fields from `DETAIL_COLS`; all are sortable.
6. Build `recid → record`. For each record with `unit_id`, find its parent through
   `r.w2ui.parent_recid`, derive connection values, and assign `conn_type`, `address`, `comm_port`,
   `baudrate`, `parity`, `driver_addr`.
7. `grid.refresh()`, then `collapseAll()`. Record values persist and appear when nodes are reopened.
8. Set `grid.__iwmacDetailsShown = true`; the caption becomes `✓ Details shown` with the number of API
   matches. `filled` counts matched API rows, not all populated leaf records.

Auto-run is driven by the 750 ms toolbar poll. `maybeAutoDetails()` waits for a nonempty grid and toolbar,
sets `grid.__iwmacAutoTried = true` **before** calling Show Details, and will not retry an API failure on
every tick. A capture-phase click on `#node_topology` resets `__iwmacDetailsShown` and
`__iwmacAutoTried`; an existing grid's columns/record fields are not removed, so the next run refreshes
their values without duplicating columns.

---

## 8. Gotchas

1. **The parent label is part of the data model.** Passing an empty/wrong parent to
   `deriveConnection` changes RTU/TCP classification, Moxa address text, and COM fallback.
2. **Unit matching is exact after trim/uppercase.** Excel assumes a leaf's Tree column is its `unit_id`;
   renamed/display-only tree labels will not join.
3. Copy and the initial Excel topology come from the rendered DOM after a fixed 350 ms. Copy has no API
   backfill, so virtualized rows can be absent. Excel can recover only active units returned by SQL and
   puts them under synthetic groups rather than their original tree position.
4. API failure intentionally degrades Excel to topology-only, but Show Details cannot degrade because
   its entire purpose is the API columns.
5. `__iwmacAutoTried` is set before the async request. An automatic failure is not retried until the user
   reopens Topology (or a fresh grid object appears); this prevents a 750 ms request storm.
6. The six live columns are attached to the w2ui model, never raw `<td>` elements. Direct DOM changes
   will disappear on `grid.refresh()`.
7. The source comment immediately above `onShowDetails` says it expands rows “so the enriched rows are
   visible,” but the code explicitly collapses after refresh. The README's final collapsed state matches
   the code.
8. The README's sequence says expansion precedes the Toolbox fetch; current code fetches first and
   expands only before record population. Expansion still precedes `waitForLeaves` and the merge.
9. BACnet fallback is keyed to error text. A differently-worded missing-database error will not take the
   retry path.
10. The ZIP writer is deliberately stored/uncompressed. Changing header sizes, offsets, CRCs, or file
    count independently corrupts the `.xlsx` even though the XML strings themselves look valid.

> ⚠️ **Keep `deriveConnection` as the single merge rule for both outputs.** The tree position contains
> facts the SQL row alone cannot express, especially RTU units behind a Moxa converter.

---

## 9. Constants & storage keys quick-ref

- `COPY_BTN_ID = 'iwmac-topo-copy-btn'`
- `EXPORT_BTN_ID = 'iwmac-topo-export-btn'`
- `DETAIL_BTN_ID = 'iwmac-topo-detail-btn'`
- `DETAIL_COLS`: `conn_type` 150px, `address` 180px, `comm_port` 85px, `baudrate` 85px,
  `parity` 70px, `driver_addr` 100px
- Toolbox URL: `http://toolbox.iwmac.local:8505/plant-sql/`
- Request timeout: **30,000 ms**
- Expand-to-scrape delay: **350 ms**
- Leaf poll: **100 ms**, default budget **2,500 ms**, two stable ticks after a positive count
- Toolbar/auto poll: **750 ms**
- Object URL revoke: **5,000 ms**
- Per-grid flags/properties: `__iwmacDetailsShown`, `__iwmacAutoTried`, `__iwmacBusy`
- Persistent storage keys: **none**

## 10. Key functions — where to find things

`buildToolbarButton` / `makeButton` / `ensureButton` (toolbar lifecycle) · `setCaption` / `markShown` /
`flash` (button feedback) · `expandAll` / `collapseAll` (w2ui actions) · `scrapeRows` (DOM hierarchy) ·
`buildTSV` / `buildHTML` / `writeRichClipboard` / `onCopy` (clipboard) · `getPlantIdFromHost` /
`gmPostJson` / `buildPlantUnitsSql` / `fetchUnitsApi` (Toolbox data) · `deriveConnection` (shared merge) ·
`crc32` / `makeZip` / `buildXlsx` / `onExport` (OOXML export) · `getPlantLabel` (filename) ·
`getTopologyGrid` / `addDetailColumns` / `waitForLeaves` / `detailsShown` / `onShowDetails`
(live-grid enrichment) · `maybeAutoDetails` (guarded automatic run).
