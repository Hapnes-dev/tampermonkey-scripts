# Supermarket Superuser — technical reference

> Read this before touching `Supermarket-superuser.user.js`. It documents how the script is
> built, the APIs and SQL it uses, and the footguns. The user-facing feature list lives in
> [README.md](README.md); the in-page Help modal (`showHelpModal`) is the end-user guide.

Authors: ØTS / MATS / Hapnes. Historic name in logs: `[Supermarket Parameters POC]`
("POC" is legacy — this is the production tool). All CSS classes, element ids and dataset
keys are prefixed `sm-poc-` / `smPoc`.

## 1. What it is / where it runs

A single-IIFE userscript (`@grant none` → runs in the page context, no GM APIs) that
overlays power-tools on the IWMAC **Supermarket** app's parameters view. It activates only
when `isSettingsPage()` matches `/settings/regulators` in `location.hash` or
`location.pathname`; on every other route `sleepPoc()` removes every style, portal,
toolbar, hint and observer artifact the script owns.

Matches (plant servers on :8080/:81, central www, and iwmac.net): see the header. Same
script everywhere — plant id and unit id are re-derived per page (§4).

The page shows one **unit**'s parameters, split into two panes: **Measurements**
(read-only parameters, `att='r'`) and **Settings** (writable, `att='rw'`) — that mapping
is the core domain fact: *which pane a parameter lives in is decided by the `att` column
of `iw_plant_server3.iw_gen_driver_parameters`* (`sideToAtt()`).

## 2. Lifecycle: SPA-survival (the load-bearing part)

IWMAC is a SPA that redraws its tables constantly (live values) and navigates with
`history.pushState` — **no hashchange event fires**. The script survives via
`startContentWatcher()`:

- **MutationObserver** on `document.body` (childList+subtree). Mutations consisting only
  of the script's own nodes are ignored via `isPocNode()` (id/class/dataset whitelist +
  `closest()` on the portals); everything else calls `scheduleReinit()` (250 ms debounce
  → `refreshPoc()`) plus `quickOverlayRestore()` — a same-frame repositioning pass so the
  filter-bar padding doesn't visibly collapse while the debounce waits.
- **`history.pushState`/`replaceState` are wrapped** to dispatch a custom
  `sm-poc-locationchange` event; that plus `hashchange`/`popstate` run `onRouteChange`
  (sleep when off-page, hard `refreshPoc()` when on-page).
- **`suppressObserverUntil`** (`suppressOwnMutationRefresh()`, 800 ms) mutes the observer
  while the script mutates rows itself (pending-move marking).
- **Content signature** (`computeContentSignature()`: hash + column counts + row counts +
  first-row text) decides whether a reinit must re-bind row/drag handlers
  (`tablesChanged`) or only reposition overlays. Filter state is persisted from the DOM
  before rebinds (`persistFiltersFromDom`).
- **Watcher singleton across script updates:** the observer/listeners are stored on
  `window.__SM_POC_OBSERVER` / `__SM_POC_EVENT_ABORT` keyed by
  `window.__SM_POC_WATCHER_VERSION === SCRIPT_VERSION`. A new script version disconnects
  the old observer and `abort()`s all old listeners (every listener is registered with
  that AbortController's signal), so Tampermonkey updates hot-swap cleanly without a
  page reload. **Keep `SCRIPT_VERSION` in sync with `@version` — it is functional**, not
  cosmetic.
- `installGlobalCompatibilityGuards()` stubs `window.christmasAudio` — IWMAC's seasonal
  page script references it and crashes without it.
- `buildToolbar()` self-heals a "polluted" toolbar (IWMAC redraws occasionally re-parent
  page content into it — detected and rebuilt).

`refreshPoc()` is idempotent and is *the* entry point: find tables → inject styles →
toolbar → unit combo → all-params button → (all-params view active ? keep/reposition it :
pane filters) → bind selection/drag/drop once per signature → `applyMoveMode()`.

## 3. Overlay architecture: portals

Nothing is inserted into IWMAC's tables or header (the native sort/click handlers keep
working; the toolbar hint says exactly that). Five fixed-position, `inset:0`,
`pointer-events:none` portal divs own all UI; their children re-enable pointer-events:

| Portal id | Contents |
|---|---|
| `sm-poc-filter-portal` | one `.sm-poc-pane-filters` host per pane (grid of per-column inputs) |
| `sm-poc-ghost-portal` | one `.sm-poc-ghost-host` per pane (pending-move ghost rows) |
| `sm-poc-unit-portal` | the searchable unit combo (positioned over the hidden native select) |
| `sm-poc-all-params-portal` | the `Show all parameters` button + full-page view |
| *(body-level)* | modals (`.sm-poc-batch-modal`), context menu, `#sm-poc-hint`, toolbar (fixed, aligned over the Kiona bar by `positionToolbar` — see gotcha 13) |

All portals (and the all-params view) register `stopPropagation()` for
pointerdown/mousedown/mouseup/click/dblclick/focusin/keydown/keyup — the SPA must never
see events from script UI. Overlay geometry is re-synced by `positionAllFilterHosts()`
on rAF-throttled window `resize` + capture-phase `scroll`. Hosts are positioned over the
pane container's rect (`getTableContainerForTbody`), and the container gets
`padding-top` equal to the overlay height (`setContainerTopPadding`, restored by
`releaseFilterSpacing`) so the first rows aren't hidden underneath. Positioning bails
while a rect is "unstable" (width < `MIN_STABLE_TABLE_WIDTH` 160 → mid-redraw) and the
host is hidden instead of flashing at 0,0.

## 4. Identifying plant & unit

- `getPlantId()` — first match of: hostname `^(\d{4,5})\.`, href `//(\d{4,5})\.`,
  hash `#/(\d{4,5})/settings`, or path `/(\d{4,5})/settings`.
- `getUnitId()` — the native `select.iwmac_dropdown`'s current value. Unit ids look like
  `10112_...` driver-scoped ids; the select's option text is the human name.

## 5. HTTP APIs

All requests go through `fetchWithTimeout` (AbortController; 15 s default, 25 s for the
RPC). **Same-origin:**

- `POST /services/iwmac_plant/settings.php` — JSON-RPC 2.0 (`settingsRpc(method, params)`):
  - `get_groups {plant:Number, unit_id, preffered_group:''}` → `[{id, alias_text}, …]`
  - `get_parameters {plant, unit_id, group:<group.id>, preffered_group:''}` →
    `{read: csv, write: csv}` — `read` = Measurements, `write` = Settings. Each CSV line
    (custom quoted-CSV parser `parseParamCsvLine`) is
    `aliasText, valueHtml, unitHtml, driverId`.

**Toolbox API** (`http://toolbox.iwmac.local/oets/…`, network-authed, LAN-only — see §9):

- `POST oets/api/index2.php` with FormData:
  - `action=get_driver_parameter_details` + `plant_id, unit_id, alias_text[, driver_id][, menu]`
    → `{success, data: {…row}|[rows], has_multiple_parameters, total_parameters_found}` —
    full parameter row(s) incl. `override_*` copies of every field. On failure the script
    falls back to the raw-SQL alias lookup below.
  - `action=batch_sql` + `sql_commands=<JSON array>` — executes the statements as one
    transaction per call. `executeBatchSqlCommands` chunks at
    `BATCH_SQL_COMMAND_LIMIT` (500) with 120 ms between chunks and surfaces
    "earlier batches may already be saved" on mid-run failure. Response carries
    `total_affected_rows`.
  - `sql_command=<SELECT …>` — raw read used for driver-id lookup and post-write
    verification (`extractDriverParameterRows` tolerates any of
    `data/rows/result/results` nesting).
- `GET oets/supermarket/get_unit_menu.php?enhetsid=<unit>&plant_id=<plant>` →
  `{success, menu_list:[menu, …]}` — menus used in plant graphics
  (used_in_graphics highlighting).

## 6. The write path (what actually hits the DB)

`buildDriverParameterSql(driverId, changes)` returns **two statements per parameter**:

```sql
UPDATE iw_plant_server3.iw_gen_driver_parameters
   SET `field` = 'value', …            -- live row
 WHERE `driver_id` = '<id>';

INSERT INTO iw_plant_server3.iw_gen_driver_parameters_override
       (driver_id, row_date, `field`, …)
VALUES ('<id>', NOW(), 'value', …)
ON DUPLICATE KEY UPDATE `field` = VALUES(`field`), …;   -- survives Escape regen
```

The override table is why edits persist: when the plant's **Escape** process
regenerates `iw_gen_driver_parameters` from the tag list, the override row re-applies the
customisation. `buildDeleteOverrideSql` (`DELETE FROM …_override WHERE driver_id=…`) is
the "make it stock again" operation — the UI warns to stop/start Escape afterwards.
`sqlQuote` escapes `\` and `'`. After **any** batch write, `allParamsCache.clear()`.

**Driver-id resolution** (`resolveDriverParameterRequests`): rows that already carry
`driver_id` (all-params rows do, native rows usually don't) pass through; the rest are
looked up 40 at a time (`BATCH_LOOKUP_REQUEST_LIMIT`) with one SELECT per chunk:

```sql
SELECT driver_id, alias_text, menu, unit_id, element_id, plant_pri, scale,
       raw_min, raw_max, eng_min, eng_max, `format`, att
FROM iw_plant_server3.iw_gen_driver_parameters
WHERE `unit_id` = '<unit>' AND ( (`menu`='<m>' AND (
        `alias_text` = '<alias>'
     OR REPLACE(REPLACE(`alias_text`,' ',''), CHAR(160), '') = '<aliasNoSpace>'
     OR `element_id` = '<aliasBase>_<menu>')) OR … )
LIMIT <n*3 min 5>
```

`findBestDriverParameterMatch` then prefers exact alias(+menu), falls back to
whitespace-insensitive alias, then optionally first row. Native rows encode menu+alias as
`[MENU] Alias text` in the first cell (`getDataFromRow` parses it).

**Verification** (`verifyBatchChanges`): after a batch write the affected driver_ids are
re-SELECTed (chunked IN-lists) and every changed field compared (trimmed string
equality); the result modal separates lookup failures from verify failures.

**Cross-unit copy** (`applyChangesAcrossUnits`): sequential per unit —
`cloneRequestForOtherUnit` **deletes `driver_id`/`unit_id`** so each unit re-resolves by
alias+menu (driver_id is unit-unique; copying it would corrupt other units). Each unit is
its own batch: one unit failing doesn't stop the rest. Per-unit result: written / not
found / error (green/yellow/red rows).

## 7. Feature internals

### Pane column filters
`ensurePaneFilters(key)` builds a CSS-grid of inputs whose column template mirrors the
live column widths (`syncFilterGridWidths`, with header-`width`-attr and equal-split
fallbacks). State lives in `activeFilters[side][colIdx]` and survives DOM swaps.
Matching: `normalizeFilterText` (NFKD, strip diacritics, collapse ws, lowercase);
space-separated terms AND-ed; `++` = ordered substring sequence. Filtering sets
`row.style.display` (30 ms debounce per side) and re-renders the `visible/total` meta.
The **Unit** column input gets a `<datalist>` of distinct unit texts +
`bindUnitPickerOpen` (plain click opens the picker via `input.showPicker()`).
Native headers are *never* modified (`ensureHeaderFilters` actively removes remnants of
the older in-header approach).

### Hide 0.0
`hideZeroValuesEnabled` + `isZeroDisplayText` (nbsp-normalised, comma→dot,
`/^[-+]?0+(?:\.0+)?$/`) folded into both `applyFilters` (native, value = cell 1) and
`allParamMatches` (all-params, value = stripped `valueHtml`).

### Searchable unit combo
Native select gets `.sm-poc-unit-native-hidden` (visibility:hidden — keeps layout);
combo is fixed-positioned over its rect (min-width 320). `selectNativeUnit` writes
through `HTMLSelectElement.prototype` value setter then dispatches `input`+`change` so
the SPA reloads; while the all-params view is open, unit switching debounces 250 ms
(`allParamsUnitSwitchTimer`) before refetching — arrow-stepping through units stays
smooth and the per-unit cache makes revisits instant.

### Edit mode & pending moves
`moveModeEnabled` gates everything (rows get `draggable`, body gets
`.sm-poc-move-mode`). Selection: `selectedRows` Set + per-side `selectionAnchor` for
Shift-ranges; `Ctrl+Shift+A` selects visible rows of `lastActiveTableKey`. A drag to the
opposite pane does **not** move DOM rows — it calls `registerPendingAttChange`:
`pendingAttChanges` Map keyed by `driver:<id>` or `<menu>|<alias>` stores
`{…data, targetAtt, originalSide, targetSide}`, the source row gets
`data-sm-poc-target-side` (so `rowVisualSide()` differs from its physical table and pane
filters hide it) and a **ghost row** clone is rendered under the target pane
(`renderPendingVisualRows`): green `pending-to-settings` / blue `pending-to-measurements`,
"N visually moved here, not saved", drag back to undo. Dropping a row on its original
side cancels that pending entry. Toolbar Save (`savePendingAttChanges`): confirm →
resolve driver_ids (any failure aborts the whole save) → `att` write per §6 → rows flip
to `saved-awaiting-redraw` → `requestNativeParameterRedraw`.

`requestNativeParameterRedraw`: re-clicks the selected group button, waits 700 ms and
compares content signatures; if unchanged, re-dispatches the unit-select `change` and
checks again at +900 ms — i.e. it *asks IWMAC to redraw itself* rather than reloading.

### Show all parameters
Button injected via portal but **pixel-cloned** from an unselected native group button
(`syncAllParamsButtonStyle` copies ~30 computed properties + size) and
`div.groups` gets extra `padding-left` to reserve its spot. Activation
(`activateAllParamsView`): guarded by a **generation counter** (`allParamsGeneration`) —
any older in-flight fetch stops issuing requests and discards its result; per
`plant|unit` cache entry fresh for 30 s (stale cache renders instantly, then refreshes).
`fetchAllGroupParameters`: `get_groups` → `get_parameters` per group with
`mapWithConcurrency(…, 6)`; progress renders at most every 300 ms, never while an input
inside the view has focus, and stops progressive re-rendering past 700 accumulated rows
(final render only) — re-rendering large tables is what used to pin the scroll position.
The view replaces the native panes via `setNativeParameterPanesHidden(true)` (saves old
inline `display` in a dataset — **the `undefined` check there is load-bearing**, see code
comment) and renders two `.sm-poc-all-pane`s: separate header + scroll tables (header
width shrunk by scrollbar gap in `syncAllParamsHeaderScrollbarGap`), sortable headers
(`allParamsSort`), per-column filters (`allParamsFilters`), row data both on
`row.__smPocAllParam` and `dataset` (driverId, aliasText, groupName, menu) —
NB: that `menu` is the RPC **group-id hash**, not the DB `menu` column (gotcha 14). Wheel events
are manually routed to the pane scroller (portal is fixed → default scroll would hit the
page). Native group-button clicks and pointer-downs deactivate the view. Scroll positions
are carried across re-renders.

### Context menus
The all-params view has its own menu (`showAllParamsContextMenu`): Highlight
used_in_graphics / Get Driver Parameter Details / (Edit mode) Change Plant pri / Scale
all marked / Clear marking. On the **native** panes the script *augments IWMAC's own
right-click menu*: `getPotentialContextMenus` heuristically finds it (fixed divs,
z-index ≥ 2147483000, ≥160×70 px, text matching known native items like
"Legg til parameter"/"Vis parameter i Bacnet Klient"), clones the last item as a style
template and inserts the two batch actions after "Get Driver Parameter Details"
(`addBatchContextMenuItems`, once per menu via dataset flag, then nudges the menu up if
it overflows). Retried at 40/120/260/500 ms after each contextmenu event because the menu
renders async.

### used_in_graphics highlight
`get_unit_menu.php` returns the menu list used by plant graphics; each row's menu token
(`\[([A-Za-z0-9][A-Za-z0-9_-]*)\]` over groupId+groupName+aliasText) is matched against
it → `.sm-poc-used-in-graphics` (green).

### Driver details modal
`fetchAllParamsDriverDetailsResponse` is **driver_id-first** (v4.6): rows that
carry a `driver_id` (every all-params row) are fetched via
`fetchFullDriverParameterRowByDriverId` — raw SQL `SELECT p.*` with a
`LEFT JOIN …_override o` aliasing all 13 editable fields to `override_<field>`,
the same shape the toolbox details action returns. Only rows without a
driver_id go through the toolbox details action + alias-SQL fallback (which
needs alias+menu to match the DB — impossible for all-params rows, gotcha 14) →
multiple matches open a chooser first. The form covers alias_text, plant_pri, eng_unit,
format (`%.0f…%.4f`, `%e`, `%X`, `%s`, `%d`, `%i`, `%u`), range_min/max, scale
(1 scale-only / 2 format-only / 3 scale+format+clipping), raw/eng min/max, att
(`r`/`rw`/`vr`/`vrw` — v* = virtual), format_extra (+ big-textarea editor). Fields whose
`override_<field>` has data get `.sm-poc-override-field` (blue outline). Save diffs the
form against the original (`computeDriverFormChanges`) and writes only changed fields
(§6). "Apply to other units…" reuses the same diff via the unit picker. Scaling presets
(`getScalePresets`, ~23 entries: Invert, MV-alarm, x0.001…x1000, Kelvin→Celsius,
L/h↔L/s↔m³/h, CT ratios `1200/5A`…`2000/1A`, /5, ×400/1000) preview through linear
interpolation `engFromRaw` and fill the form with `scale='1'`. Modals are draggable via
`setupDraggablePocModal`.

### Batch modals
`openPlantPriBatchModal` (plant_pri A/B/C/N/blank) and `openScaleMarkedModal`
(scale/format/raw/eng + calculator "raw X should become Y" ⇒ raw_min=0,raw_max=X,
eng_min=0,eng_max=Y + custom row + preset table + "Delete overrides for marked") both
end in `applyChangesToMarkedParameters` (current unit; confirm text lists up to 12 OK/12
FAIL lookups and warns when >500 commands split into multiple transactions) or
`applyMarkedChangesToOtherUnits` (unit picker → §6 cross-unit).

### Excel (.xlsx) export
`@grant none` → no GM_download, no libraries. `buildXlsxBlob` hand-builds a minimal OOXML
package: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml(+rels)`, `xl/styles.xml`,
one `sheet<N>.xml` per sheet — zipped **store-only** (no compression) with a local CRC32
table (`xlsxZip`). `xlsxCell` emits `<v>` for `/^-?\d+(\.\d+)?$/` values (real numbers in
Excel) and inline strings otherwise. Sheet names are sanitised to Excel's 31-char/charset
rules. Export respects visibility: all-params view → its filtered rows (all groups);
native view → visible rows of the current group. Download via temporary object-URL `<a>`.

Since v4.7 the sheets are styled and structured (COM-verified against real Excel).
Sheet layout (v4.11): **one combined `Parameters` sheet** — measurements and settings
together, writable rows first within each group, the Access column varying per row.
(v4.7–4.10 shipped two per-side sheets; users kept landing on a tab where every row had
the same Access and read it as "the column is broken" — two support cases in one day
prompted the merge.)

- Sheet rows are model objects `{cells, style, outline}`. `buildCombinedExportRows`
  merges both sides' enriched 7-column rows into one sheet: header row (style 1) → per
  group a band row `Group name (count)` (style 2) → the group's settings rows, then its
  measurement rows, at `outlineLevel=1`. The Group column stays on every data row so
  AutoFilter sort/filter keeps working.
- `xlsxStylesXml` ships 3 `cellXfs`: 0 default, 1 = bold white on `#1976D2` (header),
  2 = bold `#0D47A1` on `#E3F2FD` (group band). Wired via a content-type override + a
  `rIdStyles` workbook relationship.
- Worksheet extras in **schema order** (Excel rejects out-of-order children):
  `sheetPr/outlinePr summaryBelow="0"` (+/− button sits on the band row above the
  details) → `dimension` → `sheetViews/pane ySplit="1" state="frozen"` (frozen header) →
  `sheetFormatPr outlineLevelRow="1"` → `cols` (widths from `EXPORT_COL_WIDTHS`) →
  `sheetData` → `autoFilter ref="A1:E<last>"` (sort/filter dropdowns).
- **No merged cells** on the band rows on purpose — merged cells inside an AutoFilter
  range break Excel sorting.
- Columns 5–7 are **Access / Allowed values / Driver ID** (v4.8). Driver ID: all-params
  rows carry it in `dataset`; the native single-group export calls
  `fetchNativeGroupDriverIds` (get_groups → match selected group button text →
  get_parameters → alias→driver_id map, §5 RPC) and leaves blanks on failure.
  `enrichExportRowsWithAccess` then batch-fetches `att`/`range_min`/`range_max`/
  `format_extra` for every exported driver_id via `fetchDriverParameterRowsByDriverIds`.
  Since v4.9 that SELECT LEFT JOINs the override table and exposes **override-aware
  `*_effective` aliases** (`COALESCE(NULLIF(o.x,''), p.x)`) used by the export, while the
  plain `p.*` fields keep `verifyBatchChanges` (its other caller) comparing the main
  table. **Access** renders the resolved `att` (`accessLabelFromAtt`: r/rw/vr/vrw →
  Read / Read/write / … — side-based fallback when the toolbox lookup fails), and rows
  the page serves in the **write list are never downgraded** below Read/write (the
  page's split is authoritative for writability). The export hint appends
  `(N writable)` — or `(no writable parameters on this unit)`, which is the *normal*
  result for SM 850 / driver-system units (e.g. 6918 unit 000:000: all 184 params are
  `att='r'` in the DB). Every row gets `allowedValuesText` (v4.12 — read-only rows too;
  the same enum/range describes their possible states):
  enum options parsed from format_extra's JSON `v` map (`formatExtraOptionsText`, capped
  at 10 options — format_extra is `{"rev","type":"num","v":{"0":{"t":"Off",…},…}}`), else
  `range_min to range_max` / `min …` / `max …`. `exportParametersToExcel` is async
  because of these lookups.

## 8. Keyboard map

Edit mode (outside inputs): `Esc` clear selection · `Ctrl+Shift+A` select visible in the
last-active table. Unit combo: `↑/↓` navigate (open) or step unit (closed), `Enter`
select, `Esc` close. Filter inputs: `Esc` clears that filter. All bound in
`bindKeyboardShortcuts` (once, `window.__SM_POC_KEYS`) + per-widget handlers.

## 9. Gotchas (the real footguns)

1. **`SCRIPT_VERSION` must match `@version`** — it keys the watcher hot-swap (§2) and is
   shown in Help. Bump both plus the two `console.log` version strings.
2. **Toolbox = LAN only.** Everything under §5 "Toolbox API" (driver details, every DB
   write, used_in_graphics) needs `toolbox.iwmac.local` reachable — and the calls are
   plain `http://`, so from an `https://` page they'd also be blocked as mixed content.
   Filters, unit combo, all-params *view* and Excel export are same-origin and work
   everywhere.
3. **driver_id is unit-unique.** Never copy one across units — cross-unit ops must
   resolve per unit by alias+menu (`cloneRequestForOtherUnit` deletes it on purpose).
4. **Override vs main table:** writing only the main table looks fine until Escape
   regenerates parameters and reverts it. Always write both (that's what
   `buildDriverParameterSql` does). Deleting an override needs an Escape stop/start to
   regenerate stock values.
5. **>500 SQL commands ⇒ multiple transactions.** Earlier chunks may be committed when a
   later chunk fails — the confirm dialog warns; keep that warning intact.
6. **Observer feedback loops:** any new UI you add must be recognised by `isPocNode()`
   (id/class/dataset/`closest`) or every render triggers a reinit storm. DOM writes to
   *native* rows must be wrapped in `suppressOwnMutationRefresh()`.
7. **Don't re-render the all-params view on live-value reinits** — `refreshPoc` only
   repositions it while it exists; a full render every few hundred ms resets the scroll
   (the code comment marks this).
8. **`setNativeParameterPanesHidden`'s `undefined` check** — the saved display is often
   `''` (falsy); checking truthiness re-saves `'none'` and the panes stay invisible after
   closing the view.
9. **Pending moves are virtual.** Rows never physically move between tbodies; visibility
   comes from `rowVisualSide()` (dataset target side) + filters, and ghost rows are
   clones. Code that walks "the settings rows" must decide physical vs visual side.
10. **`sqlQuote` escapes `'` and `\` only** — fine for the trusted internal API, but
    interpolated SQL means every new write path must go through it (and `escapeHtml` for
    any DOM-bound strings; both exist — use them).
11. **Norwegian remnants:** native column labels are translated for filter placeholders
    (`COLUMN_LABEL_TRANSLATIONS`); a few internal strings/log labels are still Norwegian
    (`Mangler driver_id`, `Driver-lookup feilet`, hint label `ulagrede att-endringer`) —
    harmless, but keep user-facing strings English.
12. **The native context-menu augmentation is heuristic** (§7) — if IWMAC renames
    "Get Driver Parameter Details"/"Legg til parameter" etc., `getPotentialContextMenus`'
    regex needs updating.
13. **Never insert DOM into framework-rendered containers — above all
    `.top_bar_kiona`.** A foreign child desyncs the app's vdom↔DOM diff, and the
    next top-bar re-render (e.g. opening the language dropdown) dies in an
    uncaught `Cannot read properties of undefined (reading 'childNodes')` storm,
    leaving the bar dead until reload (the ≤4.5 toolbar bug, live-debugged on
    plant 6918). The toolbar therefore floats `position:fixed` over the bar
    (`positionToolbar`, class `sm-poc-toolbar-kiona`). The one remaining
    structural mutation of page-owned DOM is the native context-menu
    augmentation (§7) — no crashes observed (that menu looks imperatively
    rendered), but treat it as prime suspect if right-click breaks after an
    IWMAC update.
14. **All-params `menu` ≠ DB `menu`.** `parseSettingsParameterCsv` stores the RPC
    group id (an MD5-ish hash) as `menu`; the DB column is a menu *name* (often
    empty on AK3 plants, whose aliases also carry `051:1`-style bus-address
    prefixes). Alias+menu DB matching with all-params row data therefore finds
    nothing — that's why the details fetch is driver_id-first (v4.6). Cross-unit
    copy from such a modal matches on the DB row's real alias/menu (returned by
    the driver_id lookup), never the hash.

## 10. Constants quick-ref

| Constant | Value | Used for |
|---|---|---|
| `BATCH_SQL_COMMAND_LIMIT` | 500 | statements per `batch_sql` transaction |
| `BATCH_LOOKUP_REQUEST_LIMIT` | 40 | alias-lookups per SELECT / driver_ids per verify IN-list |
| `ALL_GROUPS_FETCH_CONCURRENCY` | 6 | parallel `get_parameters` calls |
| `BATCH_FETCH_CONCURRENCY` | 4 | declared for `mapWithConcurrency` consumers |
| `ALL_PARAMS_CACHE_FRESH_MS` | 30 000 | per plant\|unit all-params cache freshness |
| `ALL_PARAMS_PROGRESS_RENDER_MS` | 300 | min gap between progressive renders |
| `ALL_PARAMS_PROGRESSIVE_MAX_ROWS` | 700 | stop progressive re-rendering past this |
| `FETCH_TIMEOUT_MS` | 15 000 | default fetch timeout (RPC uses 25 000) |
| `DEFAULT_HINT_SUPPRESS_MS` | 1 800 | idle hints don't overwrite action hints |
| `MIN_STABLE_TABLE_WIDTH` | 160 | rect-stability gate for overlay positioning |

## 11. Key functions — where to find things

| Area | Functions |
|---|---|
| Lifecycle | `startContentWatcher`, `refreshPoc`, `scheduleReinit`, `sleepPoc`, `computeContentSignature`, `isPocNode`, `isSettingsPage` |
| Overlays | `getFilterPortal`/`getGhostPortal`/`getUnitPortal`/`getAllParamsPortal`, `positionAllFilterHosts`, `positionToolbar`, `setContainerTopPadding`, `getStableHostRect` |
| Filters | `ensurePaneFilters`, `buildFilterGrid`, `applyFilters`, `filterTextMatches`, `normalizeFilterText`, `updateUnitFilterDatalist`, `persistFiltersFromDom` |
| Unit combo | `ensureSearchableUnitDropdown`, `selectNativeUnit`, `stepUnitSelection`, `renderUnitOptions` |
| Edit mode | `applyMoveMode`, `handleRowClick`, `bindSelectionOnTable`, `bindDragOnTable`, `bindDropZone`, `moveRowsToSettings`/`moveRowsToMeasurements`, `registerPendingAttChange`, `renderPendingVisualRows`, `savePendingAttChanges`, `requestNativeParameterRedraw` |
| All params | `activateAllParamsView`, `fetchAllGroupParameters`, `renderAllParamsView`, `createAllParamsPane`, `filterAllParamsView`, `deactivateAllParamsView`, `setNativeParameterPanesHidden` |
| Details modal | `openAllParamsDriverDetails`, `showAllParamsDriverParameterModal`, `computeDriverFormChanges`, `saveAllParamsDriverParameterChanges`, `markDriverOverrideFields`, `getScalePresets`, `engFromRaw` |
| Batch & cross-unit | `openPlantPriBatchModal`, `openScaleMarkedModal`, `applyChangesToMarkedParameters`, `applyMarkedChangesToOtherUnits`, `applyChangesAcrossUnits`, `openUnitPickerModal`, `deleteOverridesForMarkedParameters`, `verifyBatchChanges` |
| SQL/API | `settingsRpc`, `executeBatchSqlCommands`, `buildDriverParameterSql`, `buildDeleteOverrideSql`, `resolveDriverParameterRequests`, `fetchDriverParameterRowsByAliasSql`, `fetchDriverParameterRowsByDriverIds`, `fetchFullDriverParameterRowByDriverId`, `sqlQuote` |
| Native menu | `getPotentialContextMenus`, `addBatchContextMenuItems`, `scheduleBatchContextMenuAugment` |
| Excel | `buildXlsxBlob`, `xlsxZip`, `xlsxCell`, `xlsxStylesXml`, `xlsxSheetXml`, `buildCombinedExportRows`, `fetchNativeGroupDriverIds`, `enrichExportRowsWithAccess`, `accessLabelFromAtt`, `allowedValuesText`, `formatExtraOptionsText`, `exportParametersToExcel`, `collectAllParamsExportRows`, `collectNativeExportRows` |
| Misc | `showHint`, `showHelpModal`, `setupDraggablePocModal`, `mapWithConcurrency`, `fetchWithTimeout`, `getPlantId`, `getUnitId`, `escapeHtml` |
