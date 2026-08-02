# Logic Designer Section Copy/Paste — technical reference

Deep technical notes for this one userscript, intended to let an engineer resume work without first
re-reading the entire file. Repo-wide rules (including version bumping, commit, and push) live in the
**root `CLAUDE.md`** and are not repeated here.

> Single file: `logic-designer-copy-paste/Logic-Designer-Section-Copy-Paste.user.js` — pure helpers plus
> one browser IIFE. Current `@version`: **1.7.0**. Grants: `unsafeWindow`, `GM_setValue`, `GM_getValue`,
> and `GM_addStyle`.

---

## 1. What it is / where it runs

This script extends IWMAC's VV Designer with selection-aware section copy/paste, cursor-positioned ghost
paste, session undo, multi-wire creation, bulk connector removal, bulk driver-tag assignment, sketch
quick-open, and alarm-to-block highlighting. Canvas changes are made against the host's in-memory
`logic_designer.paper`; the user still saves or deploys through the host UI.

- `@match http://internal.iwmac.local/vv_fbx.qxs*`
- `@match https://internal.iwmac.local/vv_fbx.qxs*`
- `@run-at document-idle`; `@noframes` prevents execution in child frames.
- There is no additional page router. The match rules are the primary context gate. Host-dependent work
  resolves `unsafeWindow.logic_designer.paper` through §`getDesigner`; sketch quick-open separately
  requires `unsafeWindow.logic_designer_manager` and stays dormant when it is absent.
- §`getPlantId` prefers `unsafeWindow.plant_id`, then the `plant_id` query parameter.
  Other features do not parse plant/project/sketch identity from the URL.

The README says the script “never calls the server.” That is true only in the narrow sense that the
userscript has no network grant and creates no `fetch`/XHR itself. §`ensureProjects` and
§`ensureSketches` call the host's `logic_designer_manager.load_project_list` and
`load_sketch_list` RPC client, so sketch quick-open does cause host-managed reads.

---

## 2. Execution boundary and module layout

The first ten helpers are top-level pure functions. The browser body runs only when both `window` and
`document` exist; a Node footer exports those helpers through `module.exports` for tests. The exported
set is exactly §`buildSnapshot`, §`createUndoHistory`, §`pairSourcesToTargets`,
§`classifyBlockPinDirection`, §`distributeSourcesAcrossTargets`, §`matchProjectId`,
§`formatSketchEntry`, §`isRowProcessed`, §`parseAlarmToken`, and §`distinctPointers`.

Inside the IIFE, `W` is `unsafeWindow` when available and otherwise `window`. `W.__LDSCP_LOADED` is set
before feature bootstrap; a second evaluation returns immediately. The bootstrap order is:

1. §`mountLauncher`, §`installCursorTracker`, §`installKeyboardShortcuts`
2. `SelectionInterceptor.install()` and `DeleteInterceptor.install()`
3. `MultiWireMode.install()`, `RemoveConnectorsMode.install()`, `GhostPasteMode.install()`
4. `WireObserver.install()` and `MoveObserver.install()`
5. `SketchQuickOpen.install()` and `AlarmHighlight.install()`

The main runtime components are deliberately different kinds of integration:

| Component | Role | Host mutation |
|---|---|---|
| `HostAdapter` | Sole general canvas adapter | Yes |
| `SelectionInterceptor` | Capture-phase Ctrl/Cmd-click selection toggle | `paper.selected_blocks`, optional `__select_block` |
| `DeleteInterceptor` | Pre-delete snapshot for undo | No; lets the host delete normally |
| `MultiWireMode` | Stateful source collection and batched connection creation | Yes |
| `RemoveConnectorsMode` | Click/drag connector teardown | Yes |
| `GhostPasteMode` | SVG preview and positioned paste commit | Preview DOM, then canvas mutation |
| `WireObserver` | Wrap host wire create/remove calls for undo | Wraps methods; records only |
| `MoveObserver` | Coalesce host block moves into undo batches | Wraps `__move_block`; records only |
| `SketchQuickOpen` | Augment splash dialog and drive native open flow | Host RPC reads and synthetic UI events |
| `AlarmHighlight` | Scrape alarm rows and draw temporary SVG outlines | Read-only toward host state |

Most modules install event listeners immediately. `WireObserver` polls until `paper.initialized === true`;
`MoveObserver.install` retries every **500 ms** until `__move_block` is ready; `AlarmHighlight.install`
retries every **1000 ms** until its window exists. Other UI and interceptors do not have a readiness
gate, so their handlers must tolerate an unavailable paper.

---

## 3. Host canvas model and `HostAdapter`

The adapter treats numeric keys in `paper.elements` as live blocks; nonnumeric keys are templates.
`paper.selected_blocks` may hold numeric strings or numbers, so §`getSelection` normalizes to live
numbers. §`resolveBlockRefShared` resolves an event target by `target.block_id` first, otherwise by
walking every block's `el.set.items[].node` and testing identity/containment.

### Read paths

| Information | Source |
|---|---|
| Type | `paper.get_block_type(ref)`, falling back to `el.block_type` |
| Position | main Raphael shape `main._.dx/.dy`, then `main.matrix.e/.f`, then local attrs/path, finally `(0,0)` |
| Payload | getters/raw fields for `type`, `func`, `compile_type`, `data`, `override`, `config`, `properties`, `runtime`, `inputs`, `outputs` |
| Internal wires | destination `inputs[i].connected_to = {ref, put_id, ...}`; only if both refs are selected |
| Wires touching deleted nodes | scan every live block's inputs; keep either endpoint in the deletion set |
| Pin hit | compare event target with `el.set[pin.set_id].node` |
| Wire hit | compare event target with `connection.bg.node` / `connection.line.node` |

`paper.connections` is not trusted to supply pin indexes. Healthy wire reads derive the target pin by
matching `connection_id` in the destination inputs and derive the source pin from that input's
`connected_to.put_id`.

### Mutation paths

- §`createNode` allocates `paper.element_pointer` (or max numeric key + 1), calls
  `paper.__render_block(type, x, y, ref, override || {}, properties || [])`, then conditionally
  `set_block_func` and `set_block_data`, and finally advances `element_pointer` beyond the used ref.
- §`createWire` calls `paper.__connect({id: fromNode, put: fromPin},
  {id: toNode, put: toPin}, true)`.
- §`setSelection` assigns `paper.selected_blocks` directly. This updates the logical selection but does
  not itself repaint selection visuals.
- §`deleteNode` temporarily selects one ref, calls `paper.__delete_selected()`, then restores the prior
  selection minus that ref.
- §`setBlockInputCount` passes through to `paper.set_block_input_count`.
- §`disconnectWire` is the most delicate adapter method. On a healthy destination input it finds the
  source output, repairs a possibly stale `put_connection_id` by matching `connection_id`, then calls
  both `__disconnect_output` and `__disconnect_input`. If the input is already clear, it enters a direct
  orphan-cleanup path that removes SVG shapes, source/output bookkeeping, target/input bookkeeping, and
  entries from `paper.connections`.

---

## 4. Clipboard snapshot, copy, and the two paste paths

`STORE_KEY` contains JSON text for a version-1 snapshot:

```text
{
  version: 1,
  copiedAt: ISO timestamp,
  nodes: [{ localId: "n0", type, position: {x,y}, data, unknownType? }],
  wires: [{ from: {nodeLocalId, pin}, to: {nodeLocalId, pin} }],
  cursorAnchor: {x,y} | null
}
```

§`doCopy` reads the normalized selection, captures node position and §`getNodeData`, captures only wires
whose **both endpoints** are selected, calls §`buildSnapshot`, adds the latest mouse position transformed
to SVG world coordinates, then persists through `GM_setValue('ldscp:clipboard:v1', JSON.stringify(...))`.
`latestSelectionRefs` is retained only in memory so ghost paste can clone current live SVG shapes.

§`ClipboardStore.load` returns `null` for absent, malformed, or non-version-1 data. There is no snapshot
migration. The GM clipboard survives reloads; `latestSelectionRefs`, undo history, and cursor state do not.

Both paste commands commit through §`applySnapshotAt`:

1. Compute `delta = basePos - snapshotOriginAnchor`.
2. Deep-clone `snapshot.nodes` with JSON serialization and translate each position.
3. Create all possible nodes, recording `localId → new ref`; a failed node does not abort the batch.
4. Recreate each wire whose endpoints were both created; collect failures otherwise.
5. Select successfully created refs and push one `paste` undo record when at least one node exists.

Normal §`doPaste` anchors on `nodes[0].position` and adds `PASTE_OFFSET` `(40, 40)`. Repeated Ctrl+V does
**not** update the stored snapshot, so each paste lands at the same single offset from the original.

`GhostPasteMode` loads the same snapshot. §`chooseAnchor` chooses the copied node nearest
`snapshot.cursorAnchor`; without a cursor anchor it chooses the nodes' bounding-box top-left. The ghost
therefore glues that chosen node's origin—not the exact copied cursor point—to the current cursor.
§`buildOverlay` clones live Raphael SVG nodes only when the still-live `latestSelectionRefs` count equals
the snapshot node count; otherwise it draws fallback rectangles/labels. Wires are approximate dashed
straight lines between block midpoints. Mousemove uses §`clientToSvgWorld`; left-click commits only inside
the located host SVG. Right-click, Escape, or window blur cancels.

> ⚠️ §`getNodeData` captures `compile_type`, `config`, `runtime`, `inputs`, and `outputs`, but
> §`createNode` does not explicitly restore those fields. Reconstruction explicitly consumes only
> `override`, `properties`, `func`, and `data` in addition to `type` and position. The README's broad
> statement that “config” travels with a block is therefore stronger than the implemented write path.

---

## 5. Undo stack and host-operation observers

§`createUndoHistory` is an unbounded in-memory LIFO stack with `push`, `pop`, `size`, `isEmpty`, and
`clear`. There is no redo and no persistence. §`doUndo` pops first and dispatches by record type; an undo
failure does not put the record back.

| Record type | Producer | Undo behavior |
|---|---|---|
| `paste` | §`applySnapshotAt` | Delete the created refs |
| `delete` | `DeleteInterceptor` before host Delete | Recreate blocks, translate old refs to new refs, restore internal and external touching wires |
| `multi-wire` | §`doMultiWire` | Remove created wires, restore replaced wires, shrink expansions |
| `remove-batch` | `RemoveConnectorsMode` | Recreate all removed wires |
| `wire-create` | `WireObserver` around host `__connect` | Disconnect its destination input |
| `wire-remove` | `WireObserver` before host `__disconnect_output` | Recreate the wire |
| `tag-paste` | §`applyTagPaste` | Restore old block data and old alias when it was a string |
| `move-batch` | `MoveObserver` | Move each surviving block back to its captured `from` coordinate |

### `WireObserver`

§`tick` polls every **500 ms** (or **1500 ms** after an exception). Once the paper is initialized it wraps
only `paper.__connect` and `paper.__disconnect_output`. Recording becomes active only after both the total
element count and §`buildPinCountFingerprint` (`ref:inputCount,outputCount;...`) remain unchanged across
polls. Wrapper calls also re-check those two values before recording, suppressing host rebuild noise.

History is cleared on either of two detected host transitions:

- a “sketch swap” where a previous element count above 4 drops below half; or
- a pin-count fingerprint change while the element count stays equal (host-side block resize).

`prevConnectionsLength` is updated but is not used as a gate or transition detector. Similar-sized
sketch swaps are not recognized by this logic. Script-created changes avoid observer records with
`suppressNextCreate` / `suppressNextRemove`, keyed as `"<toNode>:<toPin>"` and consumed by the first
matching wrapped call.

### `MoveObserver`

`MoveObserver` wraps `paper.__move_block(block, x, y)`. It reads `from` from the main shape matrix before
the host call, computes `to` with the host's 10-pixel snap rule `Math.round(coord / 10) * 10`, and groups
all calls within `FLUSH_MS = 50` into one `move-batch`. Repeated calls for one ref keep the first `from`
and latest `to`. Undo suppresses the next wrapped move per ref; wires follow because the host move method
redraws them. `uninstall` methods exist for both observers but bootstrap never calls them.

---

## 6. Multi-wire state machine and pairing algorithms

`MultiWireMode` cycles `inactive → collecting → fill → inactive` through Shift+F or the menu. `collecting`
allows expandable target inputs; `fill` sets `noExpand` and uses only current pins. Entry cancels remove
and ghost-paste modes. Sources are `{blockRef, pinIndex, side, y, overlayEl}` and all must share the first
chosen side. Orange SVG rings mark them. Clicking a chosen source again toggles it off.

The mode polls `paper.selected_blocks` every **150 ms**. §`processMarqueeSelection` classifies blocks as
`source-only`, `target-only`, `bidirectional`, or `none` from their input/output counts, then either adds
all pins, finalizes against one opposite-side target, fans one source out to multiple targets, or
distributes sources over multiple targets. Distribution occurs only when total target capacity fits all
sources and no single target can absorb the full source set. §`distributeSourcesAcrossTargets` sorts by
visual Y and splits `N` sources across `M` targets as `floor(N/M)`, giving one extra to the first `N % M`
targets.

For each target, §`doMultiWire`:

1. Drops sources already connected to that target block (any target pin).
2. Sorts remaining sources by visual Y.
3. Calls §`pairSourcesToTargets`.
4. Optionally expands an input target when `config.expandable_inputs` is truthy and
   `config.maximum_inputs` is numeric.
5. Disconnects occupied pins selected for replacement, creates the new wires, and records created wires,
   replaced wires, and expansions for one undo record.

The pairing semantics depend on the final gesture:

| Final target gesture | Existing pins |
|---|---|
| Block body / marquee target | Skip occupied pins and use free pins |
| Specific pin | Use consecutive pins starting at the clicked index; occupied pins are marked for replacement |

Expansion is input-side only and cannot exceed `maximum_inputs`. Any leftover count is returned as
`unpaired`. When sources were selected from input pins, §`doMultiWire` reverses each pair so the target's
output is the actual wire source.

---

## 7. Remove-connectors implementation

Shift+D or the menu toggles `RemoveConnectorsMode`; entry cancels multi-wire and ghost paste. Its actual
implemented gestures are:

- left-click a wire: remove it and begin a drag session;
- drag across further wire hit targets: remove each distinct `connectionId` once;
- release: push one `remove-batch` for the drag and toast the count;
- click a block body: §`removeAllWiresOfBlock` removes every healthy wire touching that ref and pushes one
  batch immediately;
- click a pin: consume the click without changing it;
- press Escape or Ctrl+Z while active: cancel the mode.

§`removeWireSilent` pre-registers observer suppression and delegates to §`disconnectWire`; the caller
owns undo batching. Empty-canvas mousedown starts an empty paint session and is not prevented, so the
host may still perform its own canvas gesture while the mode hit-tests wires under mousemove.

The README promises a connector-removal “marquee.” The source defines §`getWiresInSelection`, but no
runtime call site uses it, and remove mode never reads `paper.selected_blocks`; therefore selection-based
marquee removal is not implemented in version 1.7.0. §`onMouseOver` and §`onMouseOut` are also placeholders,
so the `.ldscp-wire-hover` style is never applied by this script.

---

## 8. Paste tags

The launcher menu owns a persistent hidden `.ldscp-paste-tags-panel`. §`applyTagPaste` trims input lines,
removes blanks, and filters the current selection to `PARAMV` and `WRITETOUNIT` blocks.

- Exactly one eligible `WRITETOUNIT`: set its `data.driver_ids` to **all** lines; leave `alias_text`
  unchanged.
- Any other eligible selection: line count must exactly equal block count. Blocks sort by main-shape
  matrix Y; each receives `driver_ids: [line]`, and `alias_text` is set to the raw driver ID until the
  host edit dialog later resolves a friendly label.

Each update stores a deep-cloned `oldData` and the prior `oldAliasText` for `tag-paste` undo. In one-to-one
mode, individual write failures are logged and successful writes still form an undo record. If every
write fails, the panel reports an error. Undo restores the alias only when the old value was a string;
a prior `null` alias is not explicitly written back.

---

## 9. Launcher, keyboard, selection, and mode arbitration

§`mountLauncher` creates a fixed bottom-right `⋯` button and menu entries for copy, paste, undo,
multi-wire, remove connectors, and paste tags. Undo's disabled state is refreshed only when the menu
opens. Icons are hardcoded inline SVG; dynamic labels use `textContent`. §`toast` messages last **3000 ms**.

| Action | Shortcut | Guard/behavior |
|---|---|---|
| Copy | Ctrl/Cmd+C | Ignore editable targets and nonempty browser text selection |
| Paste | Ctrl/Cmd+V | Same guards |
| Ghost paste | Ctrl/Cmd+B | Same guards; toggles mode |
| Undo | Ctrl/Cmd+Z | Ignore editable targets; cancel an active mode before touching history |
| Multi-wire | Shift+F | Shift-only; cycles auto-expand/fill/off |
| Remove | Shift+D | Shift-only; toggles |
| Cancel mode | Escape | Priority: multi-wire, then remove, then ghost paste |

`SelectionInterceptor` listens on capture-phase `mousedown`. Ctrl/Cmd-click without Shift/Alt toggles a
resolved numeric ref in `paper.selected_blocks`, then best-effort calls `paper.__select_block(ref, event)`
for visuals and consumes the event. `DeleteInterceptor` listens earlier than the host's normal Delete
handler, snapshots selected blocks plus **all** touching wires, pushes `delete`, and intentionally does
not prevent the host deletion.

---

## 10. Sketch quick-open

`SketchQuickOpen` augments the visible splash table rows selected by
`#comp_application_windows_tbl_wnd_splash_projects tr.qxsTable_tr`. A body-wide `MutationObserver`
watches child, subtree, and `style` changes; when the splash is hidden it clears project/sketch caches.

§`ensureProjects` calls `logic_designer_manager.load_project_list(plantId, cb)` once per visible dialog
session. §`matchProjectId` tries a trimmed exact project-name match, then case-insensitive match.
§`attachArrow` stamps `row.dataset.ldscpSqo = '1'`; resolvable rows receive a `▾` in their `<td>`.
Expansion selects the project cell with synthetic `mousedown → mouseup → click`, then loads/caches its
sketch list through `load_sketch_list`. The inserted sketch list is a valid sibling `<tr>` containing a
`<td colspan>` rather than a bare div between table rows.

§`openSketch` deliberately drives the host's native sequence instead of calling `paper.load`:

```text
splash Ok → hover/click File → click “Load Sketch” → click matching sketch-id cell → load-dialog Ok
```

§`pollFor` defaults to 40 tries at 50 ms (about **2 seconds**) for each awaited UI element. Project and
sketch RPC failures are nonfatal and render an empty/error list. The `projectId` argument to
§`openSketch` is not read inside that function; the chosen project is carried by the host's selected
splash row.

> ⚠️ The comment before the final load-dialog confirmation says it gives the table “a tick to record
> selection,” but the poll predicate is `found.win.querySelector('.qxsTable_td_selected') || true`.
> It is therefore truthy immediately and clicks Ok without waiting.

---

## 11. Alarm-to-block highlighting

`AlarmHighlight` watches only `#comp_application_window_problems_wnd_vv_alarms` for `style` changes and
scrapes the visible table `#comp_application_window_problems_tbl_wnd_vv_alarms`. Alarm rows must contain
`VV_<proj>_<sketch>:<pointer>:<line>`; §`parseAlarmToken` returns numeric `proj`, `sketch`, `pointer`, and
`line`. Matching is not anchored, so a token may be embedded in longer row text.

Each row is stamped `data-ldscp-alarm="1"` and wired once. Clicking it finds the first
`paper.elements[ref].pointer` equal to the alarm pointer and draws an orange rectangle around the main
Raphael shape. The overlay begins fading at **1600 ms** and is removed at **2050 ms**.

The fixed `⚠ Errors: N` pill counts alarm **rows**, while §`flashAll` deduplicates pointers so multiple
rows for one block cause one flash. Its × button clears the retained alarms/pill locally. Missing pointers
are only warned in the console. Project/sketch fields are parsed but are not checked against the currently
open canvas; pointer lookup alone decides which block flashes.

---

## 12. Gotchas

> ⚠️ **Wire teardown is input-side and asymmetric.** The normal §`disconnectWire` contract requires a
> destination input. If that input is already clear, its orphan fallback cannot recover a pin index and
> gathers every `paper.connections` entry whose target is the same block, then removes them all. A call
> intended for one stale pin can therefore clean every remaining connection targeting that block.

> ⚠️ **Input-source multi-wire can reach the wrong disconnect contract.** §`pairSourcesToTargets` marks
> occupied clicked targets for replacement regardless of whether `targetSide` is `input` or `output`.
> §`doMultiWire` then passes `dstRef/dstPin` to input-only §`disconnectWire`. For a source selection made
> from inputs and finalized on an occupied output pin, that output index is treated as an input index.

> ⚠️ **Observer suppression tokens are one-shot but not exception-safe.** Callers add
> `"<toNode>:<toPin>"` before the host operation. If an error happens before §`recordCreateFromArgs` or
> §`recordRemoveBeforeCall` consumes it—or if observer recording is inactive/unstable and those recorders
> are not called—the Set entry remains and can suppress a later real user operation at that endpoint.

> ⚠️ **§`undoMultiWire` does not register observer suppression.** It directly disconnects created wires
> and recreates replaced wires. When `recordingActive` is true and the topology fingerprint
> is stable, those undo calls themselves satisfy the wrapper's conditions for new `wire-remove` and
> `wire-create` records. Other wire undo paths explicitly suppress their inverse calls.

> ⚠️ **Undo is destructive on failure.** §`doUndo` pops before attempting a reversal; partial or failed
> undo is not retried or re-pushed. There is no redo. A sketch swap detected only by a large count drop,
> so a swap to a similarly sized sketch can leave stale ref-based records on the stack.

> ⚠️ **Captured payload is broader than restored payload.** See §4: `config`, `compile_type`, `runtime`,
> `inputs`, and `outputs` are stored but not explicitly reapplied by §`createNode`. Do not assume adding a
> field to §`getNodeData` makes it participate in paste or delete undo.

> ⚠️ **Only internal wires enter the clipboard.** Wires from a selected block to an unselected block are
> intentionally excluded by §`buildSnapshot`; deletion undo uses a separate “touching wires” capture so
> it can restore external edges.

> ⚠️ **The source comment saying `WireObserver` wraps `__disconnect_input` is stale.** Installation wraps
> `__connect` and `__disconnect_output` only. Input clearing is observed indirectly through the paired
> output-side host call.

> ⚠️ **The README's remove-mode marquee and hover feedback are not present in 1.7.0.**
> §`getWiresInSelection` is unused, remove mode does not inspect selected blocks, and its mouseover/out
> handlers are placeholders. “Gesture handlers land in Tasks 10-11” is also stale task-era prose.

> ⚠️ **One-to-one tag writes are not atomic.** §`applyTagPaste` calls `set_block_data` and then
> `set_block_override` inside one `try`, but appends the undo entry only after both succeed. If the data
> write succeeds and the alias write throws, the new `driver_ids` remain while that block is absent from
> the `tag-paste` undo payload.

- `paper.element_pointer` must be advanced after manual `__render_block` or later host nodes can reuse a
  ref. §`bumpRefCounter` is load-bearing.
- `getInternalWires` and most wire restoration logic depend on destination
  `inputs[].connected_to`; `paper.connections` alone does not provide the required pin mapping.
- Host wire disconnect requires both `__disconnect_output` and `__disconnect_input`. Removing one looks
  visually or structurally successful while leaving the other side stale.
- Mode mutexes are intentional: entering multi-wire, remove, or ghost paste exits the other modes.
- Ctrl+Z while a mode is active cancels that mode rather than popping history. Preserve this ordering in
  §`installKeyboardShortcuts`.
- The duplicate-load flag is set before bootstrap. If bootstrap throws synchronously, reinjecting the same
  userscript in that page session will still return at `W.__LDSCP_LOADED`.
- The “Host adapter — read-side only; write-side comes in Task 7” comment is stale: the module already
  contains all write paths.
- §`attachArrow` stamps a project row even when name-to-id resolution fails, so that DOM row is not retried
  if the project list later changes during the same dialog instance.

---

## 13. Constants & storage keys quick-ref

| Identifier / key | Exact value | Purpose |
|---|---|---|
| `SCRIPT_NAME` | `Logic Designer Section Copy/Paste` | Log prefix/title |
| `VERSION` | `1.7.0` | Runtime constant; duplicates `@version` |
| `LOAD_FLAG` | `__LDSCP_LOADED` | Duplicate-load guard on `unsafeWindow` |
| `STORE_KEY` | `ldscp:clipboard:v1` | Only GM storage key; JSON clipboard snapshot |
| `PASTE_OFFSET` | `{ x: 40, y: 40 }` | Ctrl+V translation |
| `SHORTCUTS.MULTIWIRE` | `{ key: 'f', label: 'Shift+F' }` | Multi-wire cycle |
| `SHORTCUTS.REMOVE` | `{ key: 'd', label: 'Shift+D' }` | Remove toggle |
| `SHORTCUTS.PASTE_PLACE` | `{ key: 'b', label: 'Ctrl+B', ctrl: true }` | Ghost paste |
| `FLUSH_MS` | `50` ms | Move-batch coalescing inside `MoveObserver` |
| Multi-wire poll | `150` ms | Selection observation |
| `WireObserver` poll | `500` ms normal / `1500` ms after error | Readiness and stability gate |
| Toast lifetime | `3000` ms | UI notification removal |
| Quick-open `pollFor` defaults | `tries=40`, `delayMs=50` | About 2 s per wait |
| Alarm fade/remove | `1600` / `2050` ms | Highlight lifecycle |
| Alarm install retry | `1000` ms | Wait for lazy host dialog |
| `ROW_SEL` | `#comp_application_windows_tbl_wnd_splash_projects tr.qxsTable_tr` | Project rows inside `SketchQuickOpen` |
| `ALARM_DIALOG_ID` | `comp_application_window_problems_tbl_wnd_vv_alarms` | Visible alarm table |
| `ALARM_WINDOW_ID` | `comp_application_window_problems_wnd_vv_alarms` | Style-observed window |

No state other than the clipboard is persisted. Undo records, quick-open caches, active alarms, current
modes, latest cursor, and selection refs are page-session memory.

---

## 14. Key functions — where to find things

§`buildSnapshot` (portable local-id clipboard graph) · §`doCopy` / §`ClipboardStore.load` /
§`applySnapshotAt` / §`doPaste` (clipboard pipeline) · §`clientToSvgWorld` and
`GhostPasteMode` (§`chooseAnchor`, §`buildOverlay`, §`onClickGhost`) (cursor paste) · `HostAdapter`
(§`getSelection`, §`getNodeData`, §`getInternalWires`, §`createNode`, §`createWire`, §`disconnectWire`,
§`deleteNode`) (host model boundary) · `SelectionInterceptor` / `DeleteInterceptor` (capture-phase host
gesture augmentation) · §`createUndoHistory`, §`doUndo`, and the `undo*` functions (session history) ·
`WireObserver` (§`buildPinCountFingerprint`, §`tick`, §`recordCreateFromArgs`,
§`recordRemoveBeforeCall`) (native wire observation) · `MoveObserver` (§`record`, §`flush`, §`snap`)
(50-ms drag coalescing) · `MultiWireMode` (§`processMarqueeSelection`, §`addSourcePin`,
§`finalizeOnPin`, §`finalizeOnBlock`) plus §`pairSourcesToTargets`,
§`distributeSourcesAcrossTargets`, and §`doMultiWire` (multi-connect algorithm) ·
`RemoveConnectorsMode` (§`removeWireSilent`, §`removeAllWiresOfBlock`, mouse handlers) (bulk teardown) ·
§`applyTagPaste` / §`undoTagPaste` (driver IDs) · §`mountLauncher` /
§`installKeyboardShortcuts` (UI and chords) · `SketchQuickOpen` (§`ensureProjects`, §`ensureSketches`,
§`attachArrow`, §`toggleList`, §`openSketch`) (splash augmentation) · `AlarmHighlight`
(§`scrapeAlarms`, §`refByPointer`, §`flash`, §`renderPill`) (alarm mapping and overlays).
