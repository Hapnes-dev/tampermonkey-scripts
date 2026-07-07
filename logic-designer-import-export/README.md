# Logic Designer Import/Export

Adds **Export sketch (JSON)** and **Import sketch (JSON)** to the **File** menu of the IWMAC **VV Designer** (`internal.iwmac.local/vv_fbx.qxs`), so a sketch's logic can be moved **between plants** — something the host tool has no direct way to do (sketches live per-plant; templates are the only built-in detour).

## Install

👉 [**Install Logic Designer Import/Export**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-import-export/Logic-Designer-Import-Export.user.js)

Requires the [Tampermonkey](https://www.tampermonkey.net/) browser extension. Auto-updates from this repo on every `@version` bump.

## Workflow: move logic to another plant

1. On the **source plant** (`vv_fbx.qxs?plant_id=A`): open the sketch → **File → Transfer → Export sketch (JSON)** → a `vv-sketch_<plant>_<name>_<date>.json` file downloads.
2. Open the designer for the **target plant** (`vv_fbx.qxs?plant_id=B`) and start the application (pick any project).
3. **File → Transfer → Import sketch (JSON)** → an import panel opens. Load the sketch any of three ways: click **Choose File**, **drag-and-drop** the `.json` onto the panel, or **paste** the exported JSON text and press **Import pasted JSON**.
4. If the sketch came from a different plant, you're asked to **rebind parameter bindings**: `A_…` driver ids are rewritten to `B_…` (say OK when the plants share the same unit layout — e.g. identical store setups; Cancel keeps the original ids for manual reconfiguration).
5. The graph lands on the canvas marked **unsaved**, and the current-sketch pointer is cleared — so **Ctrl+S opens "Save sketch"** to store it as a *new* sketch on the target plant (it can never silently overwrite a previously open sketch).
6. Verify (F10), save into a project, deploy when ready — all through the normal host flows.

## What it handles for you

| Concern | Behaviour |
|---|---|
| **Plant-bound parameter bindings** | `PARAMV`/`WRITETOUNIT` `driver_ids` (and legacy `driver_id`) are plant-prefixed (`3111_IWT_…`). On cross-plant import you get a one-click prefix rewrite `source_` → `target_`. Foreign prefixes that don't match the source plant are left untouched. |
| **Bindings that can't auto-transfer** | `CALENDAR`/`CALENDAR 2.0` ids and `TAGVALUE` unit bindings are plant-specific id spaces — the import warns you to reconfigure those blocks via their dialogs. |
| **Unknown block types** | If the sketch uses processes not published in the target designer's library, you're warned with the list before anything is touched. |
| **Unsaved work** | Import asks before replacing a dirty canvas; export never modifies the canvas (it even preserves the dirty flag across the host's `save()` side effect). |
| **Accidental overwrite** | After import, `application.current_sketch` is cleared so the host's save flow prompts for a new name instead of overwriting. |

## File format

```jsonc
{
  "format": "vv-fbx-sketch", "version": 1,
  "exported_at": "…ISO…",
  "source_plant_id": "3111", "source_sketch_id": "8660",
  "name": "claude_demo_tempnod1_battery_alarm",
  "block_count": 6, "connection_count": 5,
  "sketch": { "mode": "function", "require_plant_revision": 0,
              "blocks": [...], "connections": [...], "groups": [...] }   // exact paper.save() document
}
```

Import also accepts a **bare** `paper.save()` document (`{mode, blocks, connections, …}`), so JSON from other tooling works too.

## Validating AI-generated files

If an AI (ChatGPT, Copilot, Claude, …) generated the sketch JSON, **validate it before importing** — two real AI attempts failed on invented schemas/field names (documented in [`../logic-designer-copy-paste/vv-designer-reference/CLAUDE.md`](../logic-designer-copy-paste/vv-designer-reference/CLAUDE.md) §20.8/§20.9):

```
node validate-vv-sketch.js my-sketch.json
```

[`validate-vv-sketch.js`](validate-vv-sketch.js) checks the full host contract — envelope shape, `sketch.mode`, integer block ids, the 71-type allowlist (with a correction map: `EQUAL`→`LIKE`, `WRITEOUTUNIT`→`WRITETOUNIT`, …), verbatim `func` values, per-type `data` payloads (`driver_ids[]`, `initial_value`, `pri a|b|c`, …), `source`/`target` + numeric `put` connections, and one-wire-per-input. Exit 0 = importable; exit 1 = numbered errors, each with the exact fix.

[`vv-sketch.schema.json`](vv-sketch.schema.json) is a JSON Schema (draft-07) for editor/CI validation of the same format (the validator is stricter — prefer it).

When *prompting* an AI to generate a sketch, give it the **machine contract**: §20.0 + the §20.4 block table + the §20.6 example from the reference doc — that trio is self-contained and was written to be pasted as instructions.

## How it integrates

- The host rebuilds its menu on every mode switch; the script wraps `menu_main.creator.render` and appends a **Transfer** header + the two items to the `file` level before each render — so the entries survive FUNCTION↔PROCESS switches. Clicks are caught by a capture-phase listener (and a wrapped `application.on_menu` as fallback).
- Export = `logic_designer.paper.save()` in an envelope → `Blob` download.
- Import opens a **panel with a visible file input** (plus drag-drop and paste). This is deliberate: a browser only opens a file picker from a *direct* user click, so a visible input the user clicks themselves always works — a programmatic `input.click()` fired from the host's menu-callback chain gets rejected once the click's user-activation has lapsed (the v1.0.x bug). Import then runs validation → optional rebind (on a deep copy) → `paper.reset()` + `paper.load()`.
- No server calls, no network grants — saving/deploying stays in the host's hands.
- Internals exposed as `window.__LDIO` for console debugging; pure helpers are `module.exports`-ed for Node unit tests.

See [`../logic-designer-copy-paste/vv-designer-reference/`](../logic-designer-copy-paste/vv-designer-reference/) for the full VV Designer internals reference these integrations are built on.
