# Logic Designer Section Copy/Paste

Adds **copy/paste (offset & cursor-placed), multi-wire, remove-connectors, drag-move undo, type colors, sketch quick-open, sketch save/deploy info, a formula-dialog editor, and alarm-to-block highlighting** to the IWMAC **VV Designer** (the visual function-block editor at `internal.iwmac.local/vv_fbx.qxs`). The host editor has no way to duplicate a chunk of logic, wire many pins at once, undo a drag, see types at a glance, or jump from an alarm to the block that raised it — this script fills those gaps by driving the designer's in-memory canvas directly.

> Author: **Henrik Monge**. Packaged here with auto-update headers. Current version: **1.7.29**.

## Install

👉 [**Install Logic Designer Section Copy/Paste**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-copy-paste/Logic-Designer-Section-Copy-Paste.user.js)

Requires the [Tampermonkey](https://www.tampermonkey.net/) browser extension. Clicking the link opens Tampermonkey's install/update prompt. Once installed from this URL, Tampermonkey **auto-updates** it whenever a new `@version` is pushed here (see [Auto-update](#auto-update)).

Runs on `http://internal.iwmac.local/vv_fbx.qxs*` (and `https://`).

## What it does

A small **⋯ launcher** appears bottom-right on the designer page; it opens a menu with every action. Everything is also on the keyboard. The script has **no network grants and makes no requests of its own** — canvas edits are made purely in memory, so you still **Save/Deploy through the host** as normal. A few read-only features (sketch quick-open, the sketch-info pill, formula Verify) do go through the host's *own* RPC client, so those cause host-managed reads; none of them write.

| Feature | Shortcut | What it does |
|---|---|---|
| **Copy section** | `Ctrl+C` | Snapshots the selected blocks **and the wires between them** (both endpoints selected) to a clipboard. Variable bindings/config travel with each block. |
| **Paste section** | `Ctrl+V` | Recreates the snapshot offset by `(40, 40)`, re-creates the internal wires, and selects the new blocks so you can immediately drag them. |
| **Paste at cursor (ghost)** | `Ctrl+B` | Paste with a **cursor-following ghost preview** of the copied section — move the mouse to position it, click to drop it exactly where you want. Reuses the same clipboard as `Ctrl+V`. |
| **Undo** | `Ctrl+Z` | Session-scoped undo for the script's own operations — paste, delete, wire create/remove, **block drag-move**, and tag paste (separate from the host). |
| **Multi-wire** | `Shift+F` | Pick N pins (or whole blocks) on one side, then click a target — it creates all the wires top-to-bottom, **fanning out**, **distributing** across multiple targets, or **auto-expanding** an expandable-input block as needed. Press again to cycle the marquee bulk-add: **collecting** (skips outputs that already feed something) → **fill** (existing pins only, no expanding) → **all pins** → off. Collected sources survive the flips. |
| **Remove connectors** | `Shift+D` | Click a wire, **drag-paint across wires** to sweep-cut them, or click a block to drop every wire touching it. One drag = one undo step. |
| **Type colors** | menu | Recolor by resolved data type — **bool** purple, **int** blue, **float** green, **string** orange. Cycles **off → wires only → wires + blocks**, with a legend in the top bar. Purely visual (inline styles, restored on toggle-off); the choice persists per user. |
| **Paste tags** | menu | Bulk-set `driver_ids` on selected `PARAMV` / `WRITETOUNIT` blocks from pasted lines — one `driver_id` per block, or fill a single `WRITETOUNIT` with all of them. |
| **Switch project** | menu | Re-opens the host's own **"Get started!"** project selector without reloading the page (it is hidden after startup, not destroyed). Save first — unsaved sketch changes are yours to keep, same as before a reload. |

More features run automatically (no shortcut):

- **Drag-move undo** — moving a block (or an alt-drag / multi-select drag) on the host canvas is now a single `Ctrl+Z` step. The script wraps `paper.__move_block`, coalescing the many per-block moves of one drag into a single `move-batch` undo record (wires follow for free).
- **Sketch quick-open** — the host **"Get started!"** dialog gets a per-project arrow that lists that project's sketches so you can open one **directly**, instead of load-project-then-load-sketch.
- **Alarm → block highlight** — in the Virtual Values "problems" alarm window, clicking an alarm line (`VV_<proj>_<sketch>:<pointer>:<line>`) **flashes the offending block** on the canvas (matched by its `(NN)` pointer label). Read-only — scrapes the dialog DOM, no host alarm RPC exists.
- **Sketch info pill** — a compact `💾 saved · 🚀 deployed` pill in the top bar showing when the open sketch was last saved and deployed, and by whom; click it for recent history entries. Strictly read-only — it calls only `load_*` RPCs, never revert/save/publish.
- **Formula dialog editor** — the host's **Configure formula** dialog edits formulas in a cramped single-line input. This swaps it for a synced **multi-line monospace textarea**, adds a **Verify** button (the same `verify_math` RPC the Ok button runs, so you can check without closing), and a **?** quick-reference covering inputs, PHP functions, operators and worked examples. ⚠️ **Verify checks syntax only** — a name that isn't a real PHP function (`avg`, `sum`, `ln`) passes Verify and then fails at deploy as a formula-error alarm. Edits mirror back through the host component, so Ok reads exactly what you typed.
- **Stray-selection guard** — dragging a text selection out of a side panel used to leave a pale-blue highlight stuck over the canvas, because the host swallows canvas mousedowns so the browser never collapses it. Now cleared automatically.
- **Delete works in text fields** — the host's shortcut handler doesn't check whether you're typing, so `Delete` was swallowed inside input fields (`Backspace` worked, `Delete` didn't). The script runs earlier and lets the keypress through as normal text editing.

`Esc` cancels multi-wire / remove / ghost-paste mode. `Ctrl+Z` while a mode is active cancels the mode instead of undoing.

## How it works (brief)

- **Selection:** `Ctrl`/`Cmd`-click toggles a block in/out of the selection across all block categories (the host's native selection is narrower). Marquee selection is observed by polling `paper.selected_blocks`.
- **Host integration:** it reads/writes `logic_designer.paper` — `elements`, `connections`, `__render_block`, `__connect`, `__disconnect_output`/`__disconnect_input`, `__move_block`, `element_pointer`, `set_block_data`. It wraps `__connect`/`__disconnect_output` (wire edits) and `__move_block` (drag-moves) so host-native gestures also land on its undo stack, with count-fingerprint / flush-window guards so host-driven rebuilds and single drags don't create spurious or fragmented undo entries.
- **Clipboard:** persisted via `GM_setValue` (`ldscp:clipboard:v1`) as a portable snapshot (`version, nodes[], wires[]` with local ids), so a copy survives a reload and pastes position-independently. `Ctrl+V` and the `Ctrl+B` ghost paste share one commit path (`applySnapshotAt`). The Type-colors choice persists separately under `ldscp:typecolors:v1`.
- **Wire sweep:** remove-mode drag-cutting pre-samples every wire's SVG path into screen coordinates once per drag, then removes any wire passing within 6 px of the swept segment — so a fast drag can't tunnel between sample points.
- **Type resolution:** a block's color comes from its declared `output_type` when that is a single definite type; otherwise from the configured type in its data (`CONST`, a configured Selector); otherwise by tracing the bottom-most connected input back to its source, recursively. Ambiguous (`mixed`, multi-type) blocks stay uncolored.
- **Sketch quick-open & alarm highlight** use `logic_designer_manager` (project/sketch RPC) and DOM scraping of the problems dialog respectively — both self-contained and read-only toward host state.
- **Testable core:** the pure helpers (`buildSnapshot`, `createUndoHistory`, `pairSourcesToTargets`, `classifyBlockPinDirection`, `distributeSourcesAcrossTargets`, `matchProjectId`, `formatSketchEntry`, `isRowProcessed`, `parseAlarmToken`, `distinctPointers`) are `module.exports`-ed for Node unit tests; the browser body is skipped under Node.

## Auto-update

The header carries `@updateURL` + `@downloadURL` pointing at this file's raw URL on `main`, so Tampermonkey checks for a newer `@version` periodically and updates in place.

- **The `@namespace` is kept as the author's original** (`https://logic-designer-section.local`) so re-installing from the link above **updates an existing install in place** rather than creating a duplicate.
- To start receiving auto-updates on a copy that was installed manually (before it had these headers), **install once from the link above** — from then on it's automatic.

**Maintainer note:** bump `@version` on every change before committing, or installed copies won't pull the update.

## Grants

`unsafeWindow` (reach the host's `logic_designer`), `GM_setValue`/`GM_getValue` (clipboard), `GM_addStyle` (UI). No network grants — it makes no external requests.

## Reference: how the VV Designer works

The host-editor deep-dive lives in the private `tampermonkey-scripts-documents` repository.
