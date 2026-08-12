# SQL Equipment Import — technical reference

Deep technical notes for `sql-equipment-import/SQL-Equipment-Import.user.js`, a single IIFE. Current
`@version`: **7.6**. Grants: `GM_setClipboard`, `GM_xmlhttpRequest`, `GM_addStyle`,
`GM_getResourceText`. Repo-wide rules (version bumping, commit/push, line endings) live in the
**root `CLAUDE.md`** and are not repeated here. The folder `README.md` is user-facing; the source is
authoritative where its older workflow description disagrees.

The script also `@require`s CodeMirror **5.65.16** plus SQL mode, and declares CodeMirror base/Eclipse
CSS as `CM_CSS` / `CM_THEME` resources.

---

## 1. What it is / where it runs

This is a client-only SQL template transformer over the phpMyAdmin frameset. It loads a static driver
template from GitHub raw (or local disk), exposes selected unit/Modbus fields, and produces SQL for the
user to copy and execute manually.

- `@match *://*.plants.iwmac.local:*/secure/phpMyAdmin/*`
- `@run-at document-end`
- `@connect raw.githubusercontent.com`

The first runtime guard is `if (window.top !== window) return;`, so only the frameset's top window owns
the UI. The top page may have no `<body>`; styles, panel, reopen button, and editor modal are therefore
appended to `document.documentElement`. The panel starts **collapsed**, can be resized, dragged by its
header, hidden with `×`, and reopened through the fixed **SQL Import** button.

The script does not contact a plant database or execution API. Its only network calls are GETs to GitHub
raw; the generated SQL is copied for manual use.

---

## 2. Template source and manifest

Remote files live under:

`https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/templates`

`gmFetch()` adds `?_=<Date.now()>` (or `&...`) to every request, uses `GM_xmlhttpRequest` with an
**arraybuffer** response and **30,000 ms** timeout, then tries strict UTF-8 decoding. Invalid UTF-8 falls
back to `windows-1252`, preserving older Norwegian phpMyAdmin exports. Local files use the same
UTF-8-then-Windows-1252 strategy through `FileReader.readAsArrayBuffer`.

`templates/manifest.json` currently has a top-level informational `$schema_comment` and a `templates`
array with **146** entries. The runtime consumes:

| Field | Runtime use |
|---|---|
| `display_name` | option/suggestion text and case-insensitive search |
| `driver_type` | displayed in parentheses and included in search |
| `file` | filename fetched from `REPO_BASE`; encoded as one URL component |
| `pass_through` | optional truthy flag; bypasses all SQL transformation |
| `name` | present by convention, but not read by the current userscript |

Manifest order is dropdown order; there is no sort, schema validation, or field normalization.
`display_name.toLowerCase()` is called unconditionally, so every entry needs a string `display_name`.
`file` must name a file in the same `templates/` directory. Search suggestions are capped at **12**.

The manifest currently contains one `pass_through: true` entry. Pass-through still loads/parses/renders
the form internally, but `applyPassThroughVisibility()` hides units, settings, TCP legacy controls, SQL
command, and their labels. `buildOutput()` returns `CURRENT.sqlText` exactly.

---

## 3. Normal template contract

For the editable path to work as intended, a template must contain the first occurrence of each of:

```sql
INSERT INTO `iw_sys_plant_units` (`...columns...`) VALUES (...);
INSERT INTO `iw_sys_plant_settings` (`...columns...`) VALUES (...);
```

`REPLACE INTO` is accepted in place of `INSERT INTO`; matching is case-insensitive. Explicit column
lists are strongly preferred. When omitted, the parser assumes exactly:

- `iw_sys_plant_units`: `row_date`, `active`, `blockout`, `unit_id`, `unit_name`, `grp_name`,
  `driver_type`, `driver_addr`, `regulator_type`, `order_no`, `view_order`, `driver_adr_extra`
- `iw_sys_plant_settings`: `row_date`, `setting`, `owner`, `value`, `eng_unit`, `help_text`, `help_link`

The units block needs usable `unit_id`, `unit_name`, and `driver_addr` (or legacy `driver_adr`) columns.
Its **first tuple** is the prototype for every editable row: all noneditable unit fields are copied from
that tuple when output is rebuilt. The settings block should contain an owner and rows named
`mb_mode`, `comm_port`, `comm_baudrate`, and `comm_parity`; missing editable rows are not synthesized.
`mb_tcp_servers` may be present or is added on TCP output.

Both blocks must use `VALUES` and end in a semicolon that is outside strings/parentheses. The parser
recognizes SQL single-quoted strings and doubled-quote escaping (`''`). It does not implement a full SQL
grammar; backslash-escaped quotes, double-quoted string rules, comments containing structural tokens,
or unusual statements are outside its proven contract.

Everything after/between those blocks may contain arbitrary driver setup — processes, order numbers,
`CREATE TABLE`, parameter/group/set rows, and so on. The transformer does not parse those structures,
but §6 explains the global command rewrite that still touches their `INSERT/REPLACE INTO` verbs.

To publish a template:

1. add the `.sql` file under `templates/`;
2. add a manifest object with string `name`, `display_name`, `driver_type`, and exact `file`;
3. use `pass_through: true` only when the SQL must be returned byte-for-byte and has no editable unit/
   Modbus contract;
4. commit/push, then reload the manifest with `↻`.

The inspected normal example, `ADAM_6015-v1.sql`, demonstrates both editable blocks followed by process,
order-number, group, parameter, and set SQL. The inspected pass-through example contains no plant-unit
block and is intentionally emitted unchanged.

---

## 4. Parser internals

`parseBlock(sqlText, table)`:

1. locates the first `REPLACE|INSERT INTO \`<table>\` [(columns)] VALUES` header;
2. calls `findStmtEnd` to find the first semicolon outside a single-quoted string and parenthesis depth;
3. `extractTuples` walks the VALUES text and extracts outermost parenthesized tuples;
4. `splitFields` separates commas outside strings and nested parentheses;
5. maps raw field expressions to column names without evaluating them.

If tuples contain more fields than known columns, synthetic `col_N` names are appended. `unq()` removes
one surrounding single-quote pair and converts doubled quotes back to `'`; nonquoted expressions remain
raw. The returned block is `{ start, end, cols, tuples, rows, raw }`, where `start/end` allow exact
replacement in the original SQL.

`sqlEsc` doubles backslashes and single quotes; `q` wraps the result in single quotes. Generated
`mb_tcp_servers` deliberately uses a separate quote helper that escapes only quotes, preserving literal
`\r\n` sequences for MariaDB to interpret as CRLF.

---

## 5. Form state and current defaults

`CURRENT` holds `{ name, sqlText, passThrough, units, settings }`; `MANIFEST` holds the fetched array.
Loading any normal template does **not** reproduce all of its unit tuples in the form. Instead:

- exactly **three** rows are created, numbered 1, 2, 3;
- the shape of `unit_id` and `unit_name` is taken from the template rather than
  guessed. `setNumbering` compares the template's **first two** unit tuples: a
  digit group that advances by one between them is the unit counter and becomes
  a slot; one that repeats is part of the name and is left alone. Only two rows
  are compared because templates restart their run further down (IJsmall goes
  F50, F51, F52, F50), which would otherwise read as "no counter";
- with a single template row, groups whose value equals the unit number become
  slots (`patternFromValue`). Failing that, a name holding *other* digits is a
  model number and is kept verbatim (`PCO3`, `350 Kjolemaskin`); a name with no
  digits at all gets the number appended (`Carel HECU01`);
- slots keep the template's zero padding, so `U50`/`F50 Plug-In50` yields
  `U01`/`F01 Plug-In01` and `ID1`/`Carel PR100` yields `ID1`/`Carel PR100`;
- a fixed pattern is never accepted for `unit_id` — it has to stay unique;
- driver addresses become `0_1`, `0_2`, `0_3`, always carrying the same number
  as their row's `unit_id`;
- **row 1 drives the block.** Retyping its `unit_id` re-derives the ID pattern
  and renumbers every row below it, addresses included: `P46` gives
  `P46`/`0_46`, `P47`/`0_47`, `P48`/`0_48`. Nothing else cascades;
- `+` continues the pattern from the last row's number while that row still
  matches it, and falls back to `incLastNum` once it has been hand-edited;
- every row retains the same first template tuple as `_raw` for noneditable fields.

Settings controls exist for `EDITABLE_SETTINGS = ['mb_mode', 'comm_port', 'comm_baudrate',
'comm_parity']`. Parity options are 0/1/2 (None/Odd/Even); baudrate options are 9600, 19200, 38400,
57600, 115200, with an unusual template value prepended if needed.

> ⚠️ **Despite the README's “pre-filled” wording, every load forcibly sets `mb_mode` to `'0'` (RTU)**
> after rendering. The template's mode only influences which option was initially marked before that
> assignment.

TCP is selected by mode `'2'`. Switching mode calls `renumberDriverAddr`:

- TCP: addresses `1_1`, `2_1`, ... and per-unit IPs `192.168.10.100`, `.101`, ...;
- RTU: addresses `0_1`, `0_2`, ...;
- TCP hides `comm_port`, `comm_baudrate`, `comm_parity` and shows `.seii-uip` in each unit row.

The old standalone `#seii-tcpwrap` / `addIpRow` UI still exists, but `syncTcpVisible()` and
`applyPassThroughVisibility()` always hide it. `renderForm()` parses an existing `mb_tcp_servers` into
`tcpMap`, but that map is currently unused. TCP IPs are therefore the per-unit fields, not the legacy
list described in the README.

Adding a unit increments the last number in ID/name. Address increment uses the first number for TCP,
last number for RTU. The remove handlers preserve at least one unit row.

---

## 6. Output transformation — `buildOutput`

Normal generation performs these mutations:

1. Globally replace every `INSERT INTO` or `REPLACE INTO` token in the full template with the selected
   `#seii-cmd` value. This applies to **all tables**, not only the two editable blocks.
2. Read form units, discard rows with empty `unit_id`, and require at least one.
3. Rebuild the plant-units block in parsed column order:
   - `row_date` keeps a raw expression only when it matches `NOW()`; otherwise becomes `NOW()`;
   - unit ID/name/address are newly quoted;
   - every other expression comes from the row's `_raw` prototype, falling back to the last source
     template row, then `''`;
   - the rebuilt block is removed from its original position and **prepended** to the output.
4. Reparse the settings block, clone all rows, and patch the `value` only for existing editable setting
   rows.
5. In TCP mode, build `mb_tcp_servers` from the first IP seen for each numeric server prefix in
   `driver_addr`, sort prefixes numerically, and emit lines in fixed form
   `<sequence>;<ip>;502;1000;2;500`. Patch an existing settings row or append one using the first
   settings row's owner and help text `ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout`.
6. Rebuild the complete settings block in its original position. All other SQL text retains its relative
   bytes except for the global command replacement and whitespace around the moved units block.

Pass-through mode returns before all six steps, including the global command replacement.

The output textarea is readonly. **Edit ⛶** opens a 90vw × 90vh editor; CodeMirror is used when present,
otherwise the modal textarea becomes editable. Closing commits the editor value back to the output.
Backdrop close requires both mousedown and mouseup on the backdrop so selecting text out of the editor
does not close it.

---

## 7. Gotchas

1. **README drift is substantial.** Current code always defaults normal templates to RTU, always creates
   three synthesized unit rows, and uses per-unit TCP IP inputs. Do not reimplement from the README's
   older pre-filled/separate-list description.
2. **The rest of a normal template is not literally verbatim.** The selected `INSERT INTO` versus
   `REPLACE INTO` command is replaced globally, the units block moves to the top, and the settings block
   is regenerated. Use `pass_through` for truly unchanged SQL.
3. **Only the first matching block per table is parsed.** A template split across multiple
   `iw_sys_plant_units` or settings INSERTs will leave later blocks outside the editable merge (though
   their command verbs still change globally).
4. **The first unit tuple is the editable prototype.** Three synthesized rows inherit its driver type,
   group, order number, and every other noneditable field. Heterogeneous original tuples are not
   represented faithfully in the initial form.
5. In TCP output the server prefixes from `driver_addr` are used only for grouping/sort; generated
   `mb_tcp_servers` IDs are renumbered sequentially with `i + 1`. Noncontiguous addresses such as
   `3_1` can therefore point at a server ID that was emitted as `1`; keep prefixes contiguous from 1.
6. If two units share a TCP server prefix, the **first nonempty IP** wins. Conflicting later IPs are
   silently ignored.
7. Missing editable setting rows are not added (except `mb_tcp_servers`). A template must include the
   four `EDITABLE_SETTINGS` rows if the controls are expected to affect output.
8. Parser escaping is narrow: doubled single quotes are supported; a full MySQL lexer is not. In
   particular, do not rely on backslash-escaped quote syntax inside the two editable statements.
9. `gmFetch`'s cache-buster means GitHub raw is requested on every manifest/template reload; no template
   cache or GM storage exists.
10. The inspected pass-through template
    `templates/INGICS_param_group_set_and_mqtt_defaults.sql` contains a hardcoded MQTT password at
    **line 28**. This reference intentionally does not reproduce it.

> ⚠️ **Never copy credentials from a template into documentation, logs, or a new manifest field.**
> `pass_through` means every byte—including any embedded credential—is copied into generated output.

---

## 8. Constants & storage keys quick-ref

- `REPO_BASE = https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/templates`
- `MANIFEST_URL = REPO_BASE + '/manifest.json'`
- `EDITABLE_SETTINGS = ['mb_mode', 'comm_port', 'comm_baudrate', 'comm_parity']`
- `MB_MODE_OPTS = [['0', 'RTU'], ['2', 'TCP']]`
- `PARITY_OPTS`: `0` None, `1` Odd, `2` Even
- `BAUDRATE_OPTS`: `9600`, `19200`, `38400`, `57600`, `115200`
- HTTP timeout: **30,000 ms**
- Suggestion limit: **12**; suggestion blur delay: **150 ms**
- Clipboard “Copied!” reset: **1,200 ms**
- Main IDs are prefixed `seii-`; panel `#seii-panel`, modal `#seii-modal`, reopen button `#seii-toggle`
- Persistent storage keys: **none**

## 9. Key functions — where to find things

`gmFetch` (GitHub raw + encoding fallback) · `extractTuples` / `splitFields` / `findStmtEnd` /
`parseBlock` / `unq` (SQL parser) · `sqlEsc` / `q` (SQL quoting) · `loadManifest` /
`renderTemplateOptions` / `renderSuggest` / `pickTemplate` (manifest UI) · `loadSqlText` /
`applyPassThroughVisibility` (template state/mode) · `patternFromSeries` /
`patternFromValue` / `patternFromLast` / `fillPattern` / `setNumbering` / `numOf` /
`renumberUnits` (unit numbering) · `renderForm` / `addUnitRow` / `incLastNum` /
`incFirstNum` / `renumberDriverAddr` / `syncTcpVisible` (editable form) · `parseTcpServers` /
`addIpRow` (retained legacy TCP-list path) · `buildOutput` (transformer) · `getEditorValue` /
`setEditorValue` (CodeMirror/plain editor abstraction) · `setCollapsed` (panel state).
