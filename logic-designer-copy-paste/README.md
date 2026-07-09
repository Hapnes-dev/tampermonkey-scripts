# Logic Designer Section Copy/Paste

Adds **copy/paste (offset & cursor-placed), multi-wire, remove-connectors, drag-move undo, sketch quick-open, and alarm-to-block highlighting** to the IWMAC **VV Designer** (the visual function-block editor at `internal.iwmac.local/vv_fbx.qxs`). The host editor has no way to duplicate a chunk of logic, wire many pins at once, undo a drag, or jump from an alarm to the block that raised it — this script fills those gaps by driving the designer's in-memory canvas directly.

> Author: **Henrik Monge**. Packaged here with auto-update headers. Current version: **1.7.0**.

## Install

👉 [**Install Logic Designer Section Copy/Paste**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-copy-paste/Logic-Designer-Section-Copy-Paste.user.js)

Requires the [Tampermonkey](https://www.tampermonkey.net/) browser extension. Clicking the link opens Tampermonkey's install/update prompt. Once installed from this URL, Tampermonkey **auto-updates** it whenever a new `@version` is pushed here (see [Auto-update](#auto-update)).

Runs on `http://internal.iwmac.local/vv_fbx.qxs*` (and `https://`).

## What it does

A small **⋯ launcher** appears bottom-right on the designer page; it opens a menu with every action. Everything is also on the keyboard. The script never calls the server — it only manipulates the in-canvas graph, so you still **Save/Deploy through the host** as normal.

| Feature | Shortcut | What it does |
|---|---|---|
| **Copy section** | `Ctrl+C` | Snapshots the selected blocks **and the wires between them** (both endpoints selected) to a clipboard. Variable bindings/config travel with each block. |
| **Paste section** | `Ctrl+V` | Recreates the snapshot offset by `(40, 40)`, re-creates the internal wires, and selects the new blocks so you can immediately drag them. |
| **Paste at cursor (ghost)** | `Ctrl+B` | Paste with a **cursor-following ghost preview** of the copied section — move the mouse to position it, click to drop it exactly where you want. Reuses the same clipboard as `Ctrl+V`. |
| **Undo** | `Ctrl+Z` | Session-scoped undo for the script's own operations — paste, delete, wire create/remove, **block drag-move**, and tag paste (separate from the host). |
| **Multi-wire** | `Shift+F` | Pick N pins (or whole blocks) on one side, then click a target — it creates all the wires top-to-bottom, **fanning out**, **distributing** across multiple targets, or **auto-expanding** an expandable-input block as needed. Toggles: auto-expand → fill-only → off. |
| **Remove connectors** | `Shift+D` | Click, drag-paint, or marquee over wires/blocks to bulk-delete connections. |
| **Paste tags** | menu | Bulk-set `driver_ids` on selected `PARAMV` / `WRITETOUNIT` blocks from pasted lines — one `driver_id` per block, or fill a single `WRITETOUNIT` with all of them. |

Two more features run automatically (no shortcut):

- **Drag-move undo** — moving a block (or an alt-drag / multi-select drag) on the host canvas is now a single `Ctrl+Z` step. The script wraps `paper.__move_block`, coalescing the many per-block moves of one drag into a single `move-batch` undo record (wires follow for free).
- **Sketch quick-open** — the host **"Get started!"** dialog gets a per-project arrow that lists that project's sketches so you can open one **directly**, instead of load-project-then-load-sketch.
- **Alarm → block highlight** — in the Virtual Values "problems" alarm window, clicking an alarm line (`VV_<proj>_<sketch>:<pointer>:<line>`) **flashes the offending block** on the canvas (matched by its `(NN)` pointer label). Read-only — scrapes the dialog DOM, no host alarm RPC exists.

`Esc` cancels multi-wire / remove / ghost-paste mode. `Ctrl+Z` while a mode is active cancels the mode instead of undoing.

## How it works (brief)

- **Selection:** `Ctrl`/`Cmd`-click toggles a block in/out of the selection across all block categories (the host's native selection is narrower). Marquee selection is observed by polling `paper.selected_blocks`.
- **Host integration:** it reads/writes `logic_designer.paper` — `elements`, `connections`, `__render_block`, `__connect`, `__disconnect_output`/`__disconnect_input`, `__move_block`, `element_pointer`, `set_block_data`. It wraps `__connect`/`__disconnect_output` (wire edits) and `__move_block` (drag-moves) so host-native gestures also land on its undo stack, with count-fingerprint / flush-window guards so host-driven rebuilds and single drags don't create spurious or fragmented undo entries.
- **Clipboard:** persisted via `GM_setValue` (`ldscp:clipboard:v1`) as a portable snapshot (`version, nodes[], wires[]` with local ids), so a copy survives a reload and pastes position-independently. `Ctrl+V` and the `Ctrl+B` ghost paste share one commit path (`applySnapshotAt`).
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

[`../logic-designer-import-export/vv-designer-reference/`](../logic-designer-import-export/vv-designer-reference/) is a deep-dive on the host editor this script drives — its block library, type/connection rules, save format, server API, and the exact in-memory object model (`paper.elements`, pin `connected_to` shapes, `element_pointer`, the mutation API) that this script's host-adapter relies on. [`CLAUDE.md`](../logic-designer-import-export/vv-designer-reference/CLAUDE.md) is the write-up; `reference_data/` holds captured samples (save-format, a real sketch + compiled preview, config/library payloads, formula-grammar probes, dropdown enums). *(The reference lived in this folder until 2026-07-09; it now sits with the Import/Export script, whose validator and AI files build on it.)*
