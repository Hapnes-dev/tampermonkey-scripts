# Logic Designer Import/Export

Adds **Export sketch (JSON)** and **Import sketch (JSON)** to the **File** menu of the IWMAC **VV Designer** (`internal.iwmac.local/vv_fbx.qxs`), so a sketch's logic can be moved **between plants** — something the host tool has no direct way to do (sketches live per-plant; templates are the only built-in detour). Also adds a **Live Simulate** panel to try the logic on the canvas before you ever save or deploy.

## Install

👉 [**Install Logic Designer Import/Export**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-import-export/Logic-Designer-Import-Export.user.js)

Requires the [Tampermonkey](https://www.tampermonkey.net/) browser extension. Auto-updates from this repo on every `@version` bump.

## Workflow: move logic to another plant

1. On the **source plant** (`vv_fbx.qxs?plant_id=A`): open the sketch → **File → Transfer → Export sketch (JSON)** → a `vv-sketch_<plant>_<name>_<date>.json` file downloads. *(Fileless alternative: **Copy sketch (JSON text)** puts the same JSON on the clipboard.)*
2. Open the designer for the **target plant** (`vv_fbx.qxs?plant_id=B`) and start the application (pick any project).
3. **File → Transfer → Import sketch (JSON)** → an import panel opens. Load the sketch any of three ways: click **Choose File**, **drag-and-drop** the `.json` onto the panel, or **paste** the exported/copied JSON text and press **Import pasted JSON**. (Copy on plant A + paste on plant B = transfer with no file at all.)
4. If the sketch came from a different plant, you're asked to **rebind parameter bindings**: `A_…` driver ids are rewritten to `B_…` (say OK when the plants share the same unit layout — e.g. identical store setups; Cancel keeps the original ids for manual reconfiguration).
5. The graph lands on the canvas marked **unsaved**, and the current-sketch pointer is cleared — so **Ctrl+S opens "Save sketch"** to store it as a *new* sketch on the target plant (it can never silently overwrite a previously open sketch).
6. Verify (F10), save into a project, deploy when ready — all through the normal host flows.

## Live Simulate — test the logic before deploying

Click **Live Simulate** in the top menu bar (right of *Set Process Mode*; also under **File → Simulate**) to run the sketch **on the canvas, client-side only** — nothing is compiled or sent to the plant — so you can watch the flow and confirm it behaves before saving or deploying.

It drives the host's own simulator (Tools → Simulate, the same per-block math), but fixes the three things that make the built-in one awkward for iterating:

- **You set the inputs in a panel**, not through a `prompt()` popping up for every block. Each block that needs a value (`PARAMV`, `TAGVALUE`, `CALENDAR`, `TOGGLE_INTERVAL`, …) gets a row with a number field and quick **0 / 1** buttons; `CONST`s use their configured value automatically.
- **The whole graph runs at once** (no Next-Next-Next), and the values **stay on the canvas** — each block shows its result (green **TRUE** / red **FALSE** / the number), wires go green as the flow runs, and IF/IF_ELSE branches grey out. The host normally wipes this after 5 s; the panel keeps it.
- **Every change re-simulates automatically** (toggle *auto re-run* off for manual **▶ Run**). Change a limit, flip a switch to 1, watch the alarm/write output flip live.

The panel is organised in **Inputs** and **Result** sections, can be **dragged** by its header and **resized** from the bottom-right corner (both sections grow with it), and closes with the **✕** in the top-right corner or **Esc**. It lists the **output blocks** (`ALARM`, `VIRTUALOUT`, `WRITETOUNIT`, …) with their computed values, and routes any alarm-fired message into the panel instead of a modal. Under the results, a **Flow** section explains the run step by step — evaluation order, and for every block which upstream block fed which input pin with what value (`in0 <- PARAMV (0) "Romtemp" = 12`), plus a list of blocks that were **not** evaluated (e.g. an invalidated IF branch). **↻ Inputs** rebuilds the row list after you add/remove blocks (typed values are kept per block); **■ Clear** wipes the on-canvas values; **Close** restores everything. It runs `syntax_check` first and shows the same errors F10 would, so an unconfigured/unwired block is reported rather than silently mis-simulated. It never sets the dirty flag or calls the server — saving and deploying stay entirely in your hands.

**⧉ Copy log** puts a complete, self-contained simulation report on the clipboard — made to be **pasted to an AI** (ChatGPT, Copilot, Claude, …) so it can debug or improve the logic without access to the designer: what the sketch is (blocks with data + wires with pin names), the input values you set, the full flow trace, output values, alarm messages, unreached blocks — or the syntax errors when the run never started. Also available from the console as `__LDIO.getSimLog()`.

## What it handles for you

| Concern | Behaviour |
|---|---|
| **Plant-bound parameter bindings** | `PARAMV`/`WRITETOUNIT` `driver_ids` (and legacy `driver_id`) are plant-prefixed (`3111_IWT_…`). On cross-plant import you get a one-click prefix rewrite `source_` → `target_`. Foreign prefixes that don't match the source plant are left untouched. |
| **Bindings that can't auto-transfer** | `CALENDAR`/`CALENDAR 2.0` ids and `TAGVALUE` unit bindings are plant-specific id spaces — the import warns you to reconfigure those blocks via their dialogs. |
| **Unknown block types** | If the sketch uses processes not published in the target designer's library, you're warned with the list before anything is touched — by *display name* when the export carries the v1.4 `requires_processes` manifest, not just the cryptic key. |
| **Hand-/AI-authored near-misses** | Import fills omitted housekeeping fields on a copy (`override`/`runtime`/`properties` → `{}`, `data` → `null`, `groups` → `[]`) and a missing `func` from the plant's palette (with a toast). Real exports pass through byte-identical. |
| **Bad files fail clearly** | A file that can't be imported opens an **itemised error panel** — every problem with a plain-language fix (wrong envelope, missing `mode`, string ids, `from`/`to` wires, unknown/renamed block types with the correct name, `override` nested in `data`, wires to non-existent blocks, …), a *Copy problems* button, and nothing touches the canvas. Same checks as `validate-vv-sketch.js`, live in the panel. |
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
  "generator": "LDIO v1.4.0",            // v1.4+: which script version exported it
  "requires_processes": [                // v1.4+: only when library processes are used
    { "type": "29_59DF59D32D9E56.37390576", "alias_text": "EW Switch", "current_revision": "3833" }
  ],
  "sketch": { "mode": "function", "require_plant_revision": 0,
              "blocks": [...], "connections": [...], "groups": [...] }   // exact paper.save() document
}
```

Import also accepts a **bare** `paper.save()` document (`{mode, blocks, connections, …}`), so JSON from other tooling works too. The two `v1.4+` fields are **optional and additive**: v1.3-era exports and hand-authored envelopes without them import unchanged, and older importers/validators ignore them.

## Validating AI-generated files

If an AI (ChatGPT, Copilot, Claude, …) generated the sketch JSON, **validate it before importing** — two real AI attempts failed on invented schemas/field names (documented in [`vv-designer-reference/CLAUDE.md`](vv-designer-reference/CLAUDE.md) §20.8/§20.9):

```
node validate-vv-sketch.js my-sketch.json
```

[`validate-vv-sketch.js`](validate-vv-sketch.js) checks the full host contract — envelope shape, `sketch.mode`, integer block ids, the 71-type allowlist (with a correction map: `EQUAL`→`LIKE`, `WRITEOUTUNIT`→`WRITETOUNIT`, …), verbatim `func` values, per-type `data` payloads (`driver_ids[]`, `initial_value`, `pri a|b|c`, …), `source`/`target` + numeric `put` connections, and one-wire-per-input. Exit 0 = importable; exit 1 = numbered errors, each with the exact fix.

[`vv-sketch.schema.json`](vv-sketch.schema.json) is a JSON Schema (draft-07) for editor/CI validation of the same format (the validator is stricter — prefer it).

When *prompting* an AI to generate a sketch, hand it the ready-made briefing [`vv-designer-reference/AI-BRIEFING.txt`](vv-designer-reference/AI-BRIEFING.txt) (self-contained: concepts, contract, block allowlist, recipes, a validated example, all documented AI failures as prohibitions, and a self-check) **together with [`AI-EXAMPLES.txt`](vv-designer-reference/AI-EXAMPLES.txt)** — eight complete sketches (seven verbatim production exports + an authored exercise-window template) plus notable block shapes, all in the accepted format (the briefing says what's allowed; the examples show what correct output looks like). Alternatively paste §20.0 + §20.4 + §20.6 from the reference doc.

## How it integrates

- The host rebuilds its menu on every mode switch; the script wraps `menu_main.creator.render` and appends a **Transfer** header + its items (and a **Simulate** header + Live simulate) to the `file` level, plus a top-level **Live Simulate** button after the mode toggle (`creator.add(null, …)` — the same call the host uses for File/Tools/Set Process Mode), before each render — so the entries survive FUNCTION↔PROCESS switches. Clicks are caught by a capture-phase listener (and a wrapped `application.on_menu` as fallback).
- Export = `logic_designer.paper.save()` in an envelope → `Blob` download.
- Import opens a **panel with a visible file input** (plus drag-drop and paste). This is deliberate: a browser only opens a file picker from a *direct* user click, so a visible input the user clicks themselves always works — a programmatic `input.click()` fired from the host's menu-callback chain gets rejected once the click's user-activation has lapsed (the v1.0.x bug). Import then runs validation → optional rebind (on a deep copy) → `paper.reset()` + `paper.load()`.
- **Live Simulate** drives the host's own client simulator (`paper.simulator_step` + the per-block `sim` functions). It temporarily wraps three host hooks while the panel is open — `paper.get_user_input` (feed panel values instead of `prompt()`), `system_dialogs.information.show` (route alarm/error modals into the panel), and `paper.callback` (swallow the host's `simulation_*` progress events) — and restores all three on Close. It mirrors the host's `simulator_start` setup but skips the `confirm()`, runs the step loop to completion in one go, and cancels the host's 5-second auto-clear so results persist. The dirty flag is preserved across `save()`'s side effect, so simulating never marks the sketch unsaved.
- No server calls, no network grants — saving/deploying stays in the host's hands.
- Internals exposed as `window.__LDIO` for console debugging; pure helpers are `module.exports`-ed for Node unit tests.

See [`vv-designer-reference/`](vv-designer-reference/) (in this folder) for the full VV Designer internals reference these integrations are built on.
