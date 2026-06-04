# IWMAC Topology Copy

**Version: 1.19**

Adds three buttons to the IWMAC `sys_tools` topology toolbar:

- **Copy Topology** — expands every node and copies the hierarchy as a rich-text table (HTML for Zendesk/Gmail/Word, TSV fallback for Excel/Notepad).
- **Export to Excel** — downloads a real `.xlsx` with native +/- collapse buttons in the row gutter, mirroring the tree levels in the browser.
- **Show Details** — fetches the Toolbox SQL API and injects six connection columns (Connection type, Address, Comm port, Baudrate, Parity, Driver addr) straight into the live page grid, then expands every node. **Runs automatically whenever you open the Topology view** — the button is also there for an on-demand refresh. See the topology *with* wiring details without leaving the page.

## Install

[Click here to install (latest, currently v1.19)](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-topology-copy/IWMAC-Topology-Copy.user.js)

After installing, Tampermonkey auto-updates whenever a new version is pushed.

## Match

`*://*.plants.iwmac.local:8080/secure/sys_tools/*` — works for any plant ID prefix (e.g. `6176`, `1234`, …).

## Clipboard output

When you click **Copy Topology** the clipboard receives both formats simultaneously:

- `text/html` — formatted table with header row, grey group rows, indented Tree column. Pastes as a real table in Zendesk, Gmail, Word, etc.
- `text/plain` — TSV with 2-space indentation per depth level. Pastes cleanly into Excel/Sheets/Notepad.

## Excel export

Clicking **Export to Excel** downloads `topology_<plant>_<YYYY-MM-DD>.xlsx`. Each row gets an `outlineLevel` matching its depth in the tree, so Excel renders native outline buttons (1 / 2 / 3) in the gutter — click them to collapse/expand the same way you do in the browser.

Built as a real OOXML package using a tiny built-in stored-zip writer (no external dependency).

## Show Details (in-grid)

**Runs automatically when you open the Topology view** (and the **Show Details** button re-runs it on demand). It enriches the grid *in place* instead of copying or downloading:

1. Fetches the per-unit connection data from the Toolbox SQL API (`toolbox.iwmac.local:8505/plant-sql/`) — the same query the Excel export uses.
2. **Expands every node first** — some plants only flatten a connection node's child units into `grid.records` once that node is open — then adds six columns to the live w2ui grid (**Connection type, Address, Comm port, Baudrate, Parity, Driver addr**) and fills them for every leaf unit.

Address / Comm port are derived tree-position-aware (a unit under a `COMx - IP` node shows `Moxa converter (IP)` + that COM number; a unit under a bare IP node shows the IP), so the values match the Excel export exactly. Works on the grid's own `columns` / `records` arrays via `grid.refresh()` — it never edits the DOM directly, so the virtualized tree stays in sync. Re-running refreshes the data without duplicating columns.

## How it works

1. Calls the grid's own *Open all* toolbar action (`w2ui.grid_topology_toolbar.click('open_all')`) so every level is expanded before scraping.
2. Scrapes every `tr.w2ui-record` under `#grid_grid_topology_records`, reading `title` attributes for Tree / Unit name / Owner and the text for Status.
3. Depth is derived from the number of `span.w2ui-show-children` placeholders in the Tree cell.
4. The buttons are injected as extra `<td>`s before `#tb_grid_topology_toolbar_right`, styled with the same `w2ui-button` markup as the built-in toolbar buttons.
5. **Show Details** instead reads the grid model directly (`w2ui.grid_topology.records`), matching each leaf's `unit_id` to the SQL-API row and its `w2ui.parent_recid` to the parent connection node for the address/port logic, then pushes the new columns and calls `grid.refresh()`.
6. The auto-run is armed by a capture-phase click listener on the `#node_topology` sidebar node; the existing poll fires it once the grid + toolbar have loaded, guarded so it never re-enters while busy or duplicates columns.
