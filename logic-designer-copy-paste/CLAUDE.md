# Logic Designer Section Copy/Paste — technical reference

Deep technical notes for this one userscript, intended to let an engineer resume work without first
re-reading the entire file. Repo-wide rules (including version bumping, commit, and push) live in the
**root `CLAUDE.md`** and are not repeated here.

> Single file: `logic-designer-copy-paste/Logic-Designer-Section-Copy-Paste.user.js` — pure helpers plus
> one browser IIFE. Current `@version`: **1.7.29**. Grants: `unsafeWindow`, `GM_setValue`, `GM_getValue`,
> and `GM_addStyle`.

---

## 1. What it is / where it runs

This script extends IWMAC's VV Designer with selection-aware section copy/paste, cursor-positioned ghost
paste, session undo, multi-wire creation, bulk connector removal, bulk driver-tag assignment, sketch
quick-open, alarm-to-block highlighting, formula-dialog assistance, sketch history/status, and optional
type-based wire/block colors. Canvas changes are made against the host's in-memory
`logic_designer.paper`; the user still saves or deploys through the host UI. The launcher can also
re-open the host's project selector, but does not itself save or load a project.

- `@match http://internal.iwmac.local/vv_fbx.qxs*`
- `@match https://internal.iwmac.local/vv_fbx.qxs*`
- `@run-at document-idle`; `@noframes` prevents execution in child frames.
- There is no additional page router. The match rules are the primary context gate. Host-dependent work
  resolves `unsafeWindow.logic_designer.paper` through §`getDesigner`; sketch quick-open separately
  requires `unsafeWindow.logic_designer_manager` and stays dormant when it is absent.
- §`getPlantId` prefers `unsafeWindow.plant_id`, then the `plant_id` query parameter.
  Other features do not parse plant/project/sketch identity from the URL.

The userscript has no network grant and creates no `fetch`/XHR itself, but several features call the
host's RPC client. §`ensureProjects` / §`ensureSketches` use `load_project_list` / `load_sketch_list`;
`SketchInfoWidget` also uses `load_sketch_list` and `load_history_list`; and
`FormulaDialogHelper`'s Verify button calls `verify_math`. These are host-managed requests, not purely
local operations.

---

## 2. Execution boundary and module layout

The first ten helpers are top-level pure functions. The browser body runs only when both `window` and
`document` exist; a Node footer exports those helpers through `module.exports` for tests. The exported
set is exactly §`buildSnapshot`, §`createUndoHistory`, §`pairSourcesToTargets`,
§`classifyBlockPinDirection`, §`distributeSourcesAcrossTargets`, §`matchProjectId`,
§`formatSketchEntry`, §`isRowProcessed`, §`parseAlarmToken`, and §`distinctPointers`.

Inside the IIFE, `W` is `unsafeWindow` when available and otherwise `window`. `W.__LDSCP_LOADED` is set
before feature bootstrap; a second evaluation returns immediately. The exact bootstrap order is:

1. §`mountLauncher`, §`installStraySelectionGuard`, §`installCursorTracker`,
   §`installKeyboardShortcuts`
2. `SelectionInterceptor.install()` and `DeleteInterceptor.install()`
3. `MultiWireMode.install()`, `RemoveConnectorsMode.install()`, `GhostPasteMode.install()`
4. `WireObserver.install()` and `MoveObserver.install()`
5. `SketchQuickOpen.install()` and `AlarmHighlight.install()`
6. `FormulaDialogHelper.install()`, `SketchInfoWidget.install()`, and `TypeColorMode.install()`

That is **12** `.install()` calls, plus the four direct bootstrap functions in step 1.

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
| `FormulaDialogHelper` | Replace the formula input with a synced textarea, validation, and help | Wraps `show_formula`; `verify_math` RPC on demand |
| `SketchInfoWidget` | Show save/deploy dates and recent history | Wraps load/save callbacks; host RPC reads |
| `TypeColorMode` | Repaint typed wires and optionally block bodies | Inline SVG styles only; GM preference |
| §`installStraySelectionGuard` | Collapse browser text selection on SVG mouse gestures | Selection API only |

Most modules install event listeners immediately. `WireObserver` polls until `paper.initialized === true`;
`MoveObserver.install` retries every **500 ms** until `__move_block` is ready; `AlarmHighlight.install`
retries every **1000 ms** until its window exists. `FormulaDialogHelper` and `SketchInfoWidget` each
retry installation every **1000 ms** until their host method exists. Other UI and interceptors do not
have a readiness gate, so their handlers must tolerate an unavailable paper.

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
| All sweepable wires | §`getAllWires` resolves every `connection.user` endpoint and returns its line/background SVG path node |

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

`MultiWireMode` cycles `inactive → collecting → fill → all → inactive` through Shift+F or the menu.
`collecting` permits input expansion but skips already-connected outputs during block/marquee bulk-add;
`fill` keeps that filter and sets `noExpand`; `all` includes connected outputs in bulk-add and permits
input expansion again. Explicit pin clicks bypass the bulk-add filter, so a connected output can be
chosen deliberately in any active phase. Entry cancels remove and ghost-paste modes. Sources are
`{blockRef, pinIndex, side, y, overlayEl}` and all must share the first chosen side. Orange SVG rings
mark them. Clicking a chosen source again toggles it off.

The mode polls `paper.selected_blocks` every **150 ms** in all three active phases.
§`processMarqueeSelection` classifies blocks as `source-only`, `target-only`, `bidirectional`, or `none`
from their input/output counts, then either bulk-adds pins, finalizes against one opposite-side target,
fans one source out to multiple targets, or distributes sources over multiple targets. Output bulk-adds
route through §`addOutputsOrWarn`; when filtering leaves no sources it resets `sourceSide` and toasts how
to reach all-pins mode. The multi-target capacity calculation uses the same filtered output count.
Distribution occurs only when total target capacity fits all sources and no single target can absorb the
full source set. §`distributeSourcesAcrossTargets` sorts by visual Y and splits `N` sources across `M`
targets as `floor(N/M)`, giving one extra to the first `N % M` targets.

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

Shift+D or the menu toggles `RemoveConnectorsMode`; entry cancels multi-wire and ghost paste. Its
implemented gestures are:

- left-click an exact wire hit: remove it and begin a drag session;
- left-press empty canvas: consume the host gesture, build the sweep index, and run a zero-length sweep
  at the press point;
- drag: sweep the segment from the previous pointer position to the current one and remove each indexed
  `connectionId` at most once;
- release: push one `remove-batch` for the drag and toast the count;
- click a block body: §`removeAllWiresOfBlock` removes every healthy wire touching that ref and pushes one
  batch immediately;
- click a pin: consume the click without changing it;
- press Escape or Ctrl+Z while active: cancel the mode.

§`buildHitIndex` calls §`getAllWires` once per drag and pre-samples each usable SVG path at
`WIRE_SAMPLE_PX = 8` path-length units, transforming the samples to screen coordinates with
`getScreenCTM()`. §`sweepRemove` tests those points against each pointer segment with a
`WIRE_HIT_PX = 6` screen-pixel radius. The index is not refreshed during the gesture. This replaces the
old mousemove reliance on `event.target`, which could step over thin wire strokes.

§`removeWireSilent` pre-registers observer suppression and delegates to §`disconnectWire`; the caller
owns undo batching. Empty-canvas mousedown now calls `preventDefault` / `stopPropagation`, so the host's
own selection marquee does not start while sweep-cutting.

Selection-based connector removal is still not a runtime path: §`getWiresInSelection` remains exported
from `HostAdapter` but unused, and remove mode does not read `paper.selected_blocks`. §`onMouseOver` and
§`onMouseOut` also remain placeholders, so `.ldscp-wire-hover` is not applied by this script. The current
README describes drag-paint sweeping rather than promising this unused selection path.

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
multi-wire, remove connectors, type colors, paste tags, and switch project. Undo's disabled state is
refreshed only when the menu opens. Icons are hardcoded inline SVG; dynamic labels use `textContent`.
§`toast` messages last **3000 ms**. Active-mode banners share a larger animated top-center style;
multi-wire uses the default orange border, remove mode uses red, and ghost paste uses blue.

| Action | Shortcut | Guard/behavior |
|---|---|---|
| Copy | Ctrl/Cmd+C | Ignore editable targets and nonempty browser text selection |
| Paste | Ctrl/Cmd+V | Same guards |
| Ghost paste | Ctrl/Cmd+B | Same guards; toggles mode |
| Undo | Ctrl/Cmd+Z | Ignore editable targets; cancel an active mode before touching history |
| Multi-wire | Shift+F | Shift-only; cycles collecting/fill/all-pins/off |
| Remove | Shift+D | Shift-only; toggles |
| Cancel mode | Escape | Priority: multi-wire, then remove, then ghost paste |

`SelectionInterceptor` listens on capture-phase `mousedown`. Ctrl/Cmd-click without Shift/Alt toggles a
resolved numeric ref in `paper.selected_blocks`, then best-effort calls `paper.__select_block(ref, event)`
for visuals and consumes the event. `DeleteInterceptor` listens earlier than the host's normal Delete
handler, snapshots selected blocks plus **all** touching wires, pushes `delete`, and intentionally does
not prevent the host deletion. When Delete/Del originates in an input, textarea, select, or contenteditable
target, the interceptor instead stops propagation without preventing default; browser forward-delete
continues, while the host's canvas shortcut does not see the key.

The “Switch project” entry closes the launcher and calls
`W.application_windows.wnd_splash.show_modal()` when available. It only reopens the host's existing
project selector; it performs no unsaved-change check and does not call a load RPC directly.

§`installStraySelectionGuard` listens to capture-phase left-button `mousedown` and `mouseup`. If the
event target is an SVG element and the browser selection is noncollapsed, it calls `removeAllRanges()`;
editable targets are excluded. The implementation checks the SVG namespace only—it does not verify that
the SVG belongs to `logic_designer.paper`.

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
> undo is not retried or re-pushed. There is no redo. A sketch swap is detected only by a large count drop,
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

> ⚠️ **The sweep index is a gesture-time snapshot.** §`buildHitIndex` converts wire samples to screen
> coordinates only on mousedown. Scrolling, zooming, or otherwise moving the canvas during the same drag
> leaves those coordinates stale until mouseup and a new press. Also, `WIRE_SAMPLE_PX` is passed to SVG
> `getPointAtLength`, so the nominal 8-unit spacing is not guaranteed to remain eight screen pixels under
> a scaled CTM.

> ⚠️ **Selection removal and hover styling are still dead paths.** §`getWiresInSelection` has no runtime
> caller, remove mode does not inspect `paper.selected_blocks`, and §`onMouseOver` / §`onMouseOut` are
> placeholders. Version 1.7.29 does implement geometric drag-paint sweeping; these remnants are separate
> from that working gesture.

> ⚠️ **One-to-one tag writes are not atomic.** §`applyTagPaste` calls `set_block_data` and then
> `set_block_override` inside one `try`, but appends the undo entry only after both succeed. If the data
> write succeeds and the alias write throws, the new `driver_ids` remain while that block is absent from
> the `tag-paste` undo payload.

> ⚠️ **Type-color repaint skips unresolved types without unpainting them.** §`paintWires` and
> §`paintBlocks` simply `continue` when §`effectiveColor` becomes `null`. A block or wire that was colored
> earlier can therefore retain that inline color after a live type/configuration change until the mode is
> turned off (or another host repaint overwrites it).

> ⚠️ **The stray-selection guard is broader than its name.** It clears a noncollapsed browser selection
> for a left press/release on any SVG target in the document, not specifically the designer canvas. SVG
> controls elsewhere on the page can therefore trigger the same clearing.

> ⚠️ **Sketch history attribution is heuristic.** `SketchInfoWidget` takes `who` from the first history
> entry and accepts the first string field whose key resembles user/author/by/name. The source does not
> establish that this field is the actor responsible for the displayed `load_sketch_list.date` value.

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
| `VERSION` | `1.7.29` | Runtime constant; duplicates `@version` |
| `LOAD_FLAG` | `__LDSCP_LOADED` | Duplicate-load guard on `unsafeWindow` |
| `STORE_KEY` | `ldscp:clipboard:v1` | GM storage key for the JSON clipboard snapshot |
| `PREF_KEY` (inside `TypeColorMode`) | `ldscp:typecolors:v1` | GM storage key: `off`, `wires`, or `full` |
| `PASTE_OFFSET` | `{ x: 40, y: 40 }` | Ctrl+V translation |
| `SHORTCUTS.MULTIWIRE` | `{ key: 'f', label: 'Shift+F' }` | Multi-wire cycle |
| `SHORTCUTS.REMOVE` | `{ key: 'd', label: 'Shift+D' }` | Remove toggle |
| `SHORTCUTS.PASTE_PLACE` | `{ key: 'b', label: 'Ctrl+B', ctrl: true }` | Ghost paste |
| `FLUSH_MS` | `50` ms | Move-batch coalescing inside `MoveObserver` |
| Multi-wire poll | `150` ms | Selection observation |
| `WIRE_HIT_PX` | `6` screen px | Sweep point-to-segment hit radius |
| `WIRE_SAMPLE_PX` | `8` SVG path-length units | Sweep-index sample step before CTM transform |
| `WireObserver` poll | `500` ms normal / `1500` ms after error | Readiness and stability gate |
| Type-color repaint | `1500` ms interval / `80` ms quick refresh | Repaint new or host-repainted SVG elements |
| Toast lifetime | `3000` ms | UI notification removal |
| Quick-open `pollFor` defaults | `tries=40`, `delayMs=50` | About 2 s per wait |
| Formula/SketchInfo install retry | `1000` ms | Wait for lazy host methods |
| SketchInfo refresh delays | `500` ms after load / `800` ms after save callback / `1500` ms without callback | Deferred metadata reload |
| Alarm fade/remove | `1600` / `2050` ms | Highlight lifecycle |
| Alarm install retry | `1000` ms | Wait for lazy host dialog |
| `ROW_SEL` | `#comp_application_windows_tbl_wnd_splash_projects tr.qxsTable_tr` | Project rows inside `SketchQuickOpen` |
| `ALARM_DIALOG_ID` | `comp_application_window_problems_tbl_wnd_vv_alarms` | Visible alarm table |
| `ALARM_WINDOW_ID` | `comp_application_window_problems_wnd_vv_alarms` | Style-observed window |

Only the clipboard snapshot and type-color preference are persisted. `TypeColorMode.install` migrates a
legacy stored boolean `true` to `full`; `false` and unrecognized values leave the default `off`. Undo
records, quick-open and sketch-info state, active alarms, the multi-wire/remove/ghost interaction modes,
latest cursor, and selection refs are page-session memory. The persisted type-color preference is
reapplied on each page.

---

## 14. Key functions — where to find things

§`buildSnapshot` (portable local-id clipboard graph) · §`doCopy` / §`ClipboardStore.load` /
§`applySnapshotAt` / §`doPaste` (clipboard pipeline) · §`clientToSvgWorld` and
`GhostPasteMode` (§`chooseAnchor`, §`buildOverlay`, §`onClickGhost`) (cursor paste) · `HostAdapter`
(§`getSelection`, §`getNodeData`, §`getInternalWires`, §`getAllWires`, §`createNode`, §`createWire`, §`disconnectWire`,
§`deleteNode`) (host model boundary) · `SelectionInterceptor` / `DeleteInterceptor` (capture-phase host
gesture augmentation) · §`createUndoHistory`, §`doUndo`, and the `undo*` functions (session history) ·
`WireObserver` (§`buildPinCountFingerprint`, §`tick`, §`recordCreateFromArgs`,
§`recordRemoveBeforeCall`) (native wire observation) · `MoveObserver` (§`record`, §`flush`, §`snap`)
(50-ms drag coalescing) · `MultiWireMode` (§`processMarqueeSelection`, §`addSourcePin`,
§`addOutputsOrWarn`, §`finalizeOnPin`, §`finalizeOnBlock`) plus §`pairSourcesToTargets`,
§`distributeSourcesAcrossTargets`, and §`doMultiWire` (multi-connect algorithm) ·
`RemoveConnectorsMode` (§`buildHitIndex`, §`sweepRemove`, §`removeWireSilent`,
§`removeAllWiresOfBlock`, mouse handlers) (bulk teardown) ·
§`applyTagPaste` / §`undoTagPaste` (driver IDs) · §`mountLauncher` /
§`installKeyboardShortcuts` / §`installStraySelectionGuard` (UI, chords, and selection cleanup) ·
`SketchQuickOpen` (§`ensureProjects`, §`ensureSketches`,
§`attachArrow`, §`toggleList`, §`openSketch`) (splash augmentation) · `AlarmHighlight`
(§`scrapeAlarms`, §`refByPointer`, §`flash`, §`renderPill`) (alarm mapping and overlays) ·
`FormulaDialogHelper` (§`enhance`, §`mirror`, §`refreshHelper`, §`verifyNow`, §`toggleHelpPop`) (formula
textarea/validation/help) · `SketchInfoWidget` (§`refresh`, §`render`, §`toggleHistory`) (current-sketch
metadata) · `TypeColorMode` (§`effectiveColor`, §`paintWires`, §`paintBlocks`, §`quickRefresh`,
§`setMode`) (visual type coloring).

---

## 15. Formula dialog helper

`FormulaDialogHelper` waits for `W.designer_windows.show_formula`, retrying every **1000 ms**, then
replaces that function with a wrapper. The wrapper calls the original first and runs §`enhance`
afterward, so the host has already populated
`#comp_designer_windows_inp_wnd_formula_formula` before the userscript reads it.

On the first open, §`enhance` inserts `textarea.ldscp-formula-ta` immediately after the host input and
hides the input. The textarea is reused on later opens and resynchronized from `input.value`. Its input
handler calls §`mirror`, which collapses each newline and surrounding whitespace to one space, trims the
result, and writes it through `designer_windows.inp_wnd_formula_formula.set_value()`; direct assignment
to the hidden input is only the fallback. The host's existing Ok handler therefore continues reading its
own component rather than a parallel userscript-only value. Textarea keydown propagation is stopped so
host shortcuts do not consume formula editing keys.

The helper UI has three independent pieces:

| Piece | Implementation |
|---|---|
| Input hint | §`currentInputCount` calls `paper.get_block_inputs(current_block, true)`; §`refreshHelper` lists available `inpN` names and warns for referenced indexes beyond that count |
| Verify | §`verifyNow` calls `logic_designer_manager.verify_math(flattenedFormula, Math.max(inputCount, 1), callback)`; only `reply.ok === true && reply.data === true` renders “Syntax OK” |
| `?` popup | §`toggleHelpPop` renders `HELP_SECTIONS` beside the dialog when possible, links to the PHP function index, and closes on the next outside click |

The popup presents the source's quick reference for inputs, PHP/IWMAC functions, operators, examples,
and caveats; those claims are UI copy embedded in this userscript, not independently verified by this
repository. The popup itself warns that Verify is syntax-only. The module does not save a formula, but
pressing Verify does issue the host-managed `verify_math` request.

---

## 16. Sketch info widget

`SketchInfoWidget` discovers the current ids by wrapping `logic_designer_manager.load_sketch`; the source
notes that no probed global exposed the current sketch id. The wrapped callback parses a string envelope
as JSON when needed, captures `sketch_id`, `project_id`, and `sketch_name` (falling back to the requested
id and a null project), schedules §`refresh` after **500 ms**, and then invokes the original callback.
The captured `name` is retained in `current` but is not displayed or otherwise read by this module.

§`refresh` clears the prior widget state and starts up to two host reads:

| RPC/source | Fields consumed | UI result |
|---|---|---|
| `load_sketch_list(String(projectId), cb)` | matching entry's `date` and `compile_date` | 💾 saved date and 🚀 deploy date |
| `load_history_list(String(sketchId), cb)` | history array; first-entry heuristic §`fieldWho` | actor suffix, entry count, and click-open history list |

§`fieldDate` accepts the first string value beginning `YYYY-MM-DD`. §`fieldWho` accepts the first
non-date, nonnumeric string whose key matches `user|author|by|name`. The dropdown renders at most the
first **12** entries and heuristically chooses one additional string as a comment/label. Dates are
shortened to their first 16 characters. A sample of the first history entry is logged once at debug
level per page session.

Installation retries every **1000 ms** until `load_sketch` exists. If `save_sketch` exists at that time,
it is also wrapped: a supplied callback is allowed to run and §`refresh` follows after **800 ms**;
without a callback, refresh is scheduled after **1500 ms**. The wrapper does not inspect whether the save
reply represents success. The widget itself calls only `load_sketch_list` and `load_history_list`; it
never initiates save, publish, deploy, or history revert.

---

## 17. Type color mode

`TypeColorMode` is a visual overlay that colors a connection from its source block's resolved type and,
in full mode, colors each numeric block's main Raphael shape (`el.set.items[0].node`) the same way.
Untyped elements are skipped. The fixed palette is:

| Resolved family | Accepted declared strings | Color |
|---|---|---|
| bool | `/bool/i` | `#9b5de5` |
| int | `/int/i` | `#1d7fd6` |
| float | `/float|double|real|analog/i` | `#2a9d34` |
| string | `/string|text/i` | `#f77f00` |

§`effectiveColor` resolves in this exact order (its `seen` argument defaults to a new Set):

1. §`colorFor(el.output_type)` when the declaration is one definite value. Arrays must contain exactly
   one entry; empty, multi-type, and `mixed` declarations do not resolve.
2. §`configuredColor(el)`: `data.input_type`, `data.output_type`, `data.type`, then `data.data_type`,
   followed by any data string exactly matching `boolean|integer|float|string`.
3. Recursively follow the source ref of the bottom-most connected input, scanning inputs from last to
   first. The `seen` Set stops cycles.

The launcher cycles through three persisted states:

| Mode | Wires | Block bodies | Bulk-paint lifecycle |
|---|---:|---:|---|
| `off` | original | original | timer/listeners removed; stored inline styles restored |
| `wires` | colored | original | 1500-ms refresh plus 80-ms post-mouseup/keyup refresh |
| `full` | colored | colored | same refresh strategy |

§`paintWires` stores the prior inline `stroke` in `data-ldscp-type-prev`; §`paintBlocks` similarly stores
inline `fill` in `data-ldscp-type-prev-fill`. Turning off restores those saved values. A legend containing
the four swatches is shown while either active mode runs and is positioned immediately left of the
measured sketch-info pill when that pill exists.

The second GM key, `ldscp:typecolors:v1`, stores `off`, `wires`, or `full`. On install, the legacy boolean
`true` migrates to `full`; the code has no explicit `false` branch, so `false` leaves the default `off`.
