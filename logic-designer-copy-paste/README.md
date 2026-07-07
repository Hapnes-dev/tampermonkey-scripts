# Logic Designer Section Copy/Paste

Adds **copy/paste, multi-wire, remove-connectors, and undo** to the IWMAC **VV Designer** (the visual function-block editor at `internal.iwmac.local/vv_fbx.qxs`). The host editor has no way to duplicate a chunk of logic or wire many pins at once — this script fills those gaps by driving the designer's in-memory canvas directly.

> Author: **Henrik Monge**. Packaged here with auto-update headers.

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
| **Undo** | `Ctrl+Z` | Session-scoped undo for the script's own paste / delete / wire / tag operations (separate from the host). |
| **Multi-wire** | `Shift+W` | Pick N pins (or whole blocks) on one side, then click a target — it creates all the wires top-to-bottom, **fanning out**, **distributing** across multiple targets, or **auto-expanding** an expandable-input block as needed. Toggles: auto-expand → fill-only → off. |
| **Remove connectors** | `Shift+D` | Click, drag-paint, or marquee over wires/blocks to bulk-delete connections. |
| **Paste tags** | menu | Bulk-set `driver_ids` on selected `PARAMV` / `WRITETOUNIT` blocks from pasted lines — one `driver_id` per block, or fill a single `WRITETOUNIT` with all of them. |

`Esc` cancels multi-wire / remove mode. `Ctrl+Z` while a mode is active cancels the mode instead of undoing.

## How it works (brief)

- **Selection:** `Ctrl`/`Cmd`-click toggles a block in/out of the selection across all block categories (the host's native selection is narrower). Marquee selection is observed by polling `paper.selected_blocks`.
- **Host integration:** it reads/writes `logic_designer.paper` — `elements`, `connections`, `__render_block`, `__connect`, `__disconnect_output`/`__disconnect_input`, `element_pointer`, `set_block_data`. It wraps `__connect`/`__disconnect_output` so host-native wire edits also land on its undo stack, with count-fingerprint guards so host-driven rebuilds don't create spurious undo entries.
- **Clipboard:** persisted via `GM_setValue` (`ldscp:clipboard:v1`) as a portable snapshot (`version, nodes[], wires[]` with local ids), so a copy survives a reload and pastes position-independently.
- **Testable core:** the pure graph helpers (`buildSnapshot`, `createUndoHistory`, `pairSourcesToTargets`, `classifyBlockPinDirection`, `distributeSourcesAcrossTargets`) are `module.exports`-ed for Node unit tests; the browser body is skipped under Node.

## Auto-update

The header carries `@updateURL` + `@downloadURL` pointing at this file's raw URL on `main`, so Tampermonkey checks for a newer `@version` periodically and updates in place.

- **The `@namespace` is kept as the author's original** (`https://logic-designer-section.local`) so re-installing from the link above **updates an existing install in place** rather than creating a duplicate.
- To start receiving auto-updates on a copy that was installed manually (before it had these headers), **install once from the link above** — from then on it's automatic.

**Maintainer note:** bump `@version` on every change before committing, or installed copies won't pull the update.

## Grants

`unsafeWindow` (reach the host's `logic_designer`), `GM_setValue`/`GM_getValue` (clipboard), `GM_addStyle` (UI). No network grants — it makes no external requests.
