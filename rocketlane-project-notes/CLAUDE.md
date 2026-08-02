# Rocketlane Project Notes Column — technical reference

Deep technical notes for `rocketlane-project-notes/rocketlane-project-notes.user.js`. Current version: **1.10.0**. The script is one strict-mode IIFE; grants are `GM_getValue`, `GM_setValue`, and `GM_xmlhttpRequest`, with `@connect toolbox.iwmac.local`. Repo-wide rules for version bumping, commit/push, and line endings live in the **root `CLAUDE.md`** and are not repeated here.

---

## 1. What it is / where it runs

The script overlays a writable `Note` column into Rocketlane's virtualized AG Grid and persists notes locally plus, when enabled, in `team_status.iw_project_notes` through the Toolbox SQL API.

- Exact `@match`: `https://*.rocketlane.com/*`.
- `@run-at document-idle`.
- `isProjectsPage()` tests `/\/projects(\b|\/|\?)/` against `location.pathname + location.search`.
- Grid work additionally requires `.ag-root-wrapper`; thus the route test is broad enough to match project subpaths, but injection happens only where the expected grid exists.
- `applyToGrid()` and `startObserver()` start immediately. `refreshFromSql(true)` also starts immediately on **every matched Rocketlane page**, not only after a Projects grid is found.

There are no Rocketlane API calls. Project identity is taken from rendered grid rows: `row-id` first, otherwise a digits-only `/projects/(\d+)` link match.

## 2. State model and storage

Module state is shared across all rendered rows in the page:

| Identifier | Role |
|---|---|
| `notesCache` | In-memory `{projectId: note}` map, initialized from GM storage. |
| `sqlApiUrl` | Configured Toolbox endpoint; blank means local-only. |
| `lastRemoteSyncMs` | Throttles SQL reads. |
| `NOTE_WIDTH` | Current note-column width. |
| `headerStatus` | Global saving/saved/error header state. |
| `nextSaveSeq`, `latestSaveSeqByProject` | Ignore stale async completions for the **same project**. |
| `lastFailedSave` | One retry candidate `{projectId,text}`. |
| `activePopover` | The single open expanded editor. |
| `observer` | One body-wide `MutationObserver`. |

GM keys:

| Key | Default / content |
|---|---|
| `tm_project_notes_v1` (`STORAGE_KEY`) | `'{}'`; JSON note map. Parse failures silently become `{}`. |
| `tm_project_notes_width_v1` (`WIDTH_KEY`) | `'220'`; stored as a string, clamped to **80–800 px** on read. |
| `tm_pn_sql_api_url_v1` (`SQL_API_URL_KEY`) | `http://toolbox.iwmac.local:8505/toolbox-sql`; blank disables SQL. |

`writeLocalNotes()` replaces both the module cache and the entire stored JSON object. `getNote()` returns `notesCache[projectId] || ''`.

## 3. SQL API contract and synchronization

`sqlApiPost(sqlCommand)` sends form-urlencoded `sql_command=<encoded SQL>` through `GM_xmlhttpRequest` with a **15000 ms** timeout. It parses JSON, includes `request_id` in errors, accepts only `data.success && data.results`, and distinguishes HTTP errors, API errors, invalid JSON, network error, and timeout.

The script constructs these operations:

- Read: `SELECT project_id, note FROM team_status.iw_project_notes`.
- Update: `UPDATE ... SET note='...', updated_at='...' WHERE project_id='...'`.
- Existence check after zero affected rows: `SELECT 1 ... LIMIT 1`.
- Insert only if no row exists: `INSERT INTO ... (project_id,note,updated_at) VALUES (...)`.
- Delete: `DELETE ... WHERE project_id='...'`.

`escapeSqlString()` doubles backslashes and single quotes. `nowIso()` emits local time as `YYYY-MM-DDTHH:MM:SS.mmm` without a zone suffix.

### Save path

`setNote(projectId,text)`:

1. Converts all-empty/whitespace text to `''`; otherwise it preserves the original text exactly.
2. Returns if that value equals the current cached value.
3. Writes the new map to GM storage **before** any network request; blank deletes the local property.
4. Allocates a monotonically increasing sequence and records it per project.
5. In local-only mode, clears header status and returns.
6. Shows global `saving`, performs SQL upsert/delete, then ignores the completion if a newer save exists for that project.
7. On success, stamps `lastRemoteSyncMs`, clears retry state, and shows `saved`.
8. On failure, leaves the local mutation in place, stores one `lastFailedSave`, logs a warning, and leaves a sticky `error` status.

The variable is named `trimmed`, but non-empty values are **not** replaced with `text.trim()`; leading/trailing whitespace is retained. The README's phrase “trimmed value is unchanged” is therefore imprecise.

### Remote refresh

`refreshFromSql(force)` skips when SQL is disabled or when a non-forced read is within `REMOTE_REFRESH_MS=60000`. A successful `sqlReadAll()` includes only rows with both a truthy project id and non-empty note, then `writeLocalNotes(remote)` replaces the entire local map. Visible `.tm-pn-cell` nodes are rerendered. Failures are deliberately silent and retain the local cache.

> ⚠️ This is replacement, not conflict resolution. A later successful SQL refresh can erase locally cached notes whose prior SQL save failed, because the remote map becomes the complete local map.

> ⚠️ The refresh guard checks `!cell.querySelector('textarea')`, but both editors are contenteditable `<div class="tm-pn-editor">`; no `<textarea>` is created. A refresh can therefore call `renderCellText()` on an actively edited inline cell and destroy that editor.

The shipped code only calls `refreshFromSql(true)` at startup and after a successful health check. Although `REMOTE_REFRESH_MS` implements throttling, there is no interval timer that invokes periodic refresh by itself.

### Health and configuration

`sqlHealthCheck()` GETs `sqlApiUrl` with trailing slashes removed plus `/health`, timeout **8000 ms**. HTTP 200 is OK; 503 is reported as MariaDB down; all other statuses are unexpected. `testConnectionInteractive()` renders the test as `saving`, then shows saved/error; a successful check calls `refreshFromSql(true)`.

The header `⚙` calls `configureSqlInteractive()`: prompt current URL, persist trimmed input, clear sync UI, reset `lastRemoteSyncMs`, and health-check nonblank URLs. Blank is local-only. The blank branch calls `refreshFromSql(true)`, which immediately returns because SQL is disabled.

## 4. Header status state machine

`setHeaderStatus(kind,title)` clears both existing timers and rerenders every `.tm-pn-header`.

| State | Display / lifetime |
|---|---|
| `saving` | `…`, pulsing gray, no auto-clear. |
| `saved` | `✓`, green; after **1400 ms** adds `.tm-pn-fade`, then after **600 ms** removes status. |
| `error` | `!`, red, sticky and clickable. |
| `null` | Removes status nodes. |

The error click builds a confirmation containing details, API URL, project id, and a **120-character** note preview. OK retries `setNote(lastFailedSave.projectId,lastFailedSave.text)`; Cancel clears status. Only the latest failure is retained.

Status is global, while stale-completion sequencing is per project. Concurrent saves on two different projects can therefore overwrite one another's visible header state; only two saves for the same project are ordered by `latestSaveSeqByProject`.

`renderHeaderStatus()` inserts `.tm-pn-status` before `.tm-pn-cfg` returned by `querySelector()`. Because the test `⚡` is the first `.tm-pn-cfg`, status appears before the health/config controls.

## 5. AG Grid overlay architecture

The script does not change AG Grid column definitions. It inserts absolutely positioned overlays and shifts existing DOM cells.

### Discovery and insertion

- Project-name selectors, in order: `[col-id="projectName"]`, `[col-id="project_name"]`, `[col-id="name"]`.
- Header rows: `.ag-header-row-column, .ag-header-row`.
- Data rows: `.ag-row, [role="row"][row-id]`.
- Each row/header is idempotent by the presence of `.tm-pn-cell` / `.tm-pn-header`.
- `getCellRight()` uses inline `style.left`, then inline `style.width` or `offsetWidth`.
- Note left position is the right edge of the name cell/header.

`shiftSiblingsAfter(parent,fromLeft)` finds direct `:scope > [col-id]` children at or to the right of the insertion point. It snapshots initial left into `data-tm-orig-left` and writes `orig + NOTE_WIDTH`. `widenContainer()` similarly snapshots inline width in `data-tm-orig-width` and writes `orig + NOTE_WIDTH`.

Containers considered are `.ag-center-cols-container`, `.ag-center-cols-viewport > .ag-center-cols-container`, `.ag-pinned-left-cols-container`, `.ag-header-container`, and `.ag-pinned-left-header`, but only a container containing an injected note cell/header is widened.

`applyWidthStyles()` also forces `.ag-pinned-left-cols-container`, `.ag-pinned-left-header`, and `.ag-horizontal-left-spacer` to `PINNED_LEFT_BASE + NOTE_WIDTH`, where `PINNED_LEFT_BASE=400`.

### Virtualization / SPA reapplication

`startObserver()` observes `document.body` with `{childList:true,subtree:true}`. It coalesces mutations into one `requestAnimationFrame`, then calls `applyToGrid()`. `popstate` and `hashchange` enqueue the same work. The observer never disconnects; route gating occurs inside `applyToGrid()`.

No explicit cleanup restores `data-tm-orig-left`, widths, or injected nodes when navigating away. In normal SPA rerenders the host removes/recreates grid DOM; the script simply reinjects when a matching grid returns.

### Resizing

The header resizer tracks `mousemove`/`mouseup` in capture phase, clamps to **80–800 px**, updates `NOTE_WIDTH`, calls `applyWidthStyles()`, and stores the final width on mouseup.

> ⚠️ During a resize, `applyWidthStyles()` updates injected cell/header widths and the forced pinned-left width only. It does **not** recompute existing siblings' `left` values or containers' `data-tm-orig-width`-based widths. Those are recalculated only when their injection/widening functions run on new DOM.

## 6. Cell display and URL tokenization

`renderCellText()` rebuilds a cell from scratch:

- Non-empty note: `.tm-pn-text` with link-aware fragments.
- Empty note: `.tm-pn-text.tm-pn-empty` containing `Add note…`.
- Hover actions: `✎` calls `startEdit()`; `⤢` calls `openPopover()`.

`appendTextWithLinks()` recognizes `/\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi`. It repeatedly removes trailing `) . , ; : ! ? ]` from the anchor and appends that punctuation as text. `www.` links receive `https://`. Anchors use `target="_blank"` and `rel="noopener noreferrer"`.

Display anchors stop row-event propagation. Editor anchors open with `window.open()` unless Alt/Option is held; the Alt branch leaves default contenteditable/caret behavior to the browser.

## 7. Contenteditable editor internals

Both editing surfaces use `createNoteEditor(initialText)`, a `<div contenteditable="true" spellcheck="false">`.

### Text ↔ DOM conversion

- `renderEditorContent()` splits on `\n`, emits `<br>` between lines, and tokenizes links.
- `getEditorText()` recursively reads text nodes, maps `<br>` to `\n`, and inserts separators before `DIV`, `P`, and `LI` blocks when needed.
- `getEditorCaretOffset()` and `setEditorCaretOffset()` convert a selection to/from an absolute text offset, counting `<br>` as one character.
- Every `input` schedules one `requestAnimationFrame`: read text/caret, rebuild linked DOM, then restore caret.
- Paste and drop are forced to plain text through `document.execCommand('insertText')`.

### Inline editor

`startEdit()` refuses a second `.tm-pn-editor`, captures the cached note, empties the cell, creates the editor, focuses it, and selects all content.

- Enter without Shift prevents default and blurs → save.
- Shift+Enter executes `insertLineBreak`.
- Escape marks cancelled and blurs → restore original.
- Blur calls `setNote()` unless cancelled, then immediately rerenders the cell. The async SQL operation is not awaited.

### Expanded popover

Only one popover can exist. Opening another cancels the current one (`closePopover(false)`). Default CSS size is `min(720px,70vw)` × `min(480px,70vh)`, minimum **320×260**, maximum **95vw×95vh**, with native `resize:both`.

It positions below the cell where possible, otherwise above, with an 8 px viewport margin. The source cell rectangle is captured once when opened.

- Save button, outside mousedown, or Ctrl/Cmd+Enter: save and close.
- Cancel or Escape: discard and close.
- Normal Enter without Shift: `insertLineBreak`.
- Alt+Enter or `⤢`: toggle maximize.
- Maximize is at most **1200 px** wide or 90% viewport, height 85% viewport, centered; restore clears explicit size and repositions relative to the original captured cell rect.

`closePopover(save)` starts `setNote()` without awaiting it, removes the panel/listener, clears `activePopover`, and rerenders the original cell node.

## 8. Gotchas

> ⚠️ **SQL fallback is local persistence, not an outbox.** Failed writes are not queued. `lastFailedSave` holds one manual retry only, and a successful remote refresh replaces the entire local cache.

> ⚠️ **Do not assume a 60-second polling loop exists.** `REMOTE_REFRESH_MS` is only a throttle inside `refreshFromSql`; current call sites are startup and successful health test.

> ⚠️ **The active-editor guard is stale.** Refresh checks for a `<textarea>`, but editors are contenteditable `<div>` nodes. Use `.tm-pn-editor` if this behavior is ever repaired.

> ⚠️ **Grid positioning relies on inline `left`/`width`.** AG Grid DOM/column-layout changes can break `getCellRight`, sibling shifting, or container widening even if class names remain.

> ⚠️ **`data-tm-orig-left` and `data-tm-orig-width` are the unshifted baseline.** Recomputing from already shifted values would compound the note width on every MutationObserver pass.

- `setNote()` mutates the local cache before SQL. UI reports failure but retains the local value until a later remote replacement.
- Notes containing only whitespace become empty/deleted; otherwise whitespace is preserved verbatim.
- `sqlReadAll()` drops empty remote rows from the map rather than storing empty strings.
- A successful save sets `lastRemoteSyncMs` even though it did not read the full remote table.
- Project-link fallback accepts numeric ids only. Non-numeric Rocketlane ids require `row-id`.
- The global pinned-left base is hard-coded at **400 px** rather than measured from the current grid.
- The observer watches child-list changes only, not style/attribute mutations. Width changes do not themselves queue a full grid reapply.
- The script has no unload/teardown path for observer, global listeners, style tags, or an active popover.
- `document.execCommand()` is used for copy-like editor insertion/line breaks; behavior depends on browser contenteditable support.

## 9. Constants & storage keys quick-ref

| Identifier | Value |
|---|---|
| `@version` | `1.10.0` |
| `@match` | `https://*.rocketlane.com/*` |
| `STORAGE_KEY` | `tm_project_notes_v1` |
| `WIDTH_KEY` | `tm_project_notes_width_v1` |
| `SQL_API_URL_KEY` | `tm_pn_sql_api_url_v1` |
| `SQL_API_URL_DEFAULT` | `http://toolbox.iwmac.local:8505/toolbox-sql` |
| `SQL_TABLE` | `team_status.iw_project_notes` |
| `MIN_WIDTH` / `MAX_WIDTH` | `80` / `800` |
| Default stored width | `220` |
| `PINNED_LEFT_BASE` | `400` |
| `REMOTE_REFRESH_MS` | `60000` |
| SQL POST timeout | `15000 ms` |
| Health timeout | `8000 ms` |
| `SAVE_STATUS_HOLD_MS` | `1400` |
| `SAVE_STATUS_FADE_MS` | `600` |
| Error preview | `120` characters |

Important selectors/classes: `.ag-root-wrapper` · `.ag-header-row-column, .ag-header-row` · `.ag-row, [role="row"][row-id]` · `[col-id="projectName"]`, `[col-id="project_name"]`, `[col-id="name"]` · `.tm-pn-header` · `.tm-pn-cell` · `.tm-pn-editor` · `.tm-pn-popover` · `.tm-pn-status`.

## 10. Key functions — where to find things

**Local state:** `readLocalNotes` / `writeLocalNotes` / `getNote` · `readWidth` / `saveWidth`.

**SQL:** `escapeSqlString` · `nowIso` · `sqlApiPost` · `sqlReadAll` · `sqlUpsertNote` · `sqlDeleteNote` · `refreshFromSql` · `setNote`.

**Health/config/status:** `sqlHealthCheck` · `testConnectionInteractive` · `configureSqlInteractive` · `isSqlEnabled` · `setHeaderStatus` · `renderHeaderStatus` · `onHeaderStatusClick` · `clearHeaderStatusTimers` / `clearAllSyncStates`.

**Route/grid:** `isProjectsPage` · `applyToGrid` · `startObserver` · `getProjectIdFromRow` · `getProjectNameCell` · `getCellRight` · `shiftSiblingsAfter` · `widenContainer` · `injectCellIntoRow` · `injectHeaderInto`.

**Width/style:** `ensureStyles` · `applyWidthStyles` · `startResize`.

**Text/link/editor:** `appendTextWithLinks` · `renderCellText` · `createNoteEditor` · `renderEditorContent` · `getEditorText` · `getEditorCaretOffset` / `setEditorCaretOffset` · `startEdit`.

**Popover:** `openPopover` · `closePopover`.
