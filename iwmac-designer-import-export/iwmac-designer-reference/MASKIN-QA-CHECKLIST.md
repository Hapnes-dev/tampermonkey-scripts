# Maskin panel QA checklist

What must be true before a Maskin panel JSON is delivered. Five stages, in order.
**Do not skip stage C.** It is the only stage that can see the drawing, and the
drawing is what every coordinate in this panel type exists to line up with.

| Stage | Question | Tool |
|---|---|---|
| **0** | Does it pass the validator? | [validate-maskin-panel.py](validate-maskin-panel.py) |
| **A** | Is the document structurally legal? | validator + reparse |
| **B** | Is the geometry the template's geometry? | validator `--profile` + role diff |
| **C** | **Does it look right on the real background?** | [render-maskin-panel.py](render-maskin-panel.py) + eyes |
| **D** | Are the bindings right, and is nothing live committed? | validator + grep |
| **E** | Will the host accept it? | [CLAUDE.md](CLAUDE.md) §10.1 |

Related: [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) owns the
measurements, [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) owns the
procedure, [MASKIN-COPILOT-PREFLIGHT.md](MASKIN-COPILOT-PREFLIGHT.md) is the
compact version of both for a system prompt.

## Stage 0 — Run the validator

```bash
python validate-maskin-panel.py PANEL.json --profile TEMPLATE-10229
```

Drop `--profile` only when no profile applies — and then **say so in the
delivery**, because dropping it disables every `M-P*` check, which is most of the
geometry.

**Zero errors is the bar.** Warnings are read, not ignored: each one is either
expected (the known anomalies) or a finding.

`--json` emits the same result machine-readably. `--mode demo|production` forces
the binding contract when auto-detection would pick the wrong one.

In the same pass, run the GLOBAL visual-correctness validator — no live object
over descriptive text, state values sized for their longest allowed display
value ([VISUAL-CORRECTNESS-CONTRACT.md](VISUAL-CORRECTNESS-CONTRACT.md)):

```bash
python validate-visual-correctness.py PANEL.json
```

### What the validator cannot check

- Whether a value pill landed **on** the pill drawn in the artwork.
- Whether the artwork and the object set describe the same machine.
- Whether an alias names the parameter the object actually shows.
- Whether a coordinate you invented happens to look plausible.

Stage C exists because of the first one. The other three are why every delivery
carries a gaps section.

### The rule ids

| Namespace | Runs | Covers |
|---|---|---|
| `M-S01…M-S10` | always | envelope, counts, fields, names, bounds, z bands, background, binding mode, encoding, residue |
| `M-G01…M-G07` | always | palette, band ownership, setpoint pill, compressor clusters, duplicates, suction groups, pill size |
| `M-P01…M-P05` | only with `--profile` | roles present, coordinates, z per role, absent-by-design, canvas and background fingerprint |

## Stage A — Structural

- [ ] **The JSON reparses.** Read the emitted file back from disk, not from
      memory. `python -c "import json,io;json.load(io.open('PANEL.json',encoding='utf-8'))"`
- [ ] **Envelope shape**: `format` is `iwmac-designer-panel`, `version` is the
      integer `1`, `panel` is present. (`M-S01`)
- [ ] **`counts` equals each array's length** — `single_objects`, `containers`,
      `graphics`. A count that disagrees with its array is the single most
      common structural defect. (`M-S02`)
- [ ] **All 17 fields on every object**: `obj_id, name, id, posWidth, posHeight,
      posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag, sub_group,
      driver_id, unit_id, unit_ref, alias_text`. (`M-S03`)
- [ ] **Names are `object_0 … object_N`**, sequential, no gaps, no duplicates —
      unless a preserved source document dictates otherwise, in which case say
      so. (`M-S04`)
- [ ] **Geometry is integer pixels.** Not strings, not floats. A non-integer
      coordinate survives collection and breaks on render. (`M-S05`)
- [ ] **`containers` and `graphics` are empty.** Maskin is a single-object panel
      type; the container-built type is the list panel.
- [ ] **UTF-8 survived**: `°C`, `m³`, æ/ø/å. Never `gr C`, never `m3`. If a
      transport mangled it, fix the transport — do not degrade the panel text.
      (`M-S09`)

## Stage B — Geometry

- [ ] **Every profile role is present, once, with the profile's `obj_id`.**
      (`M-P01`)
- [ ] **Coordinates and sizes match the profile** unless a documented rule
      intentionally changed them — and then the change is named in the delivery.
      (`M-P02`)
- [ ] **z per role matches.** (`M-P03`)
- [ ] **Nothing absent-by-design was invented.** On `TEMPLATE-10229` that is
      `C2/C3 MT VSD 1 speed` and `C2/C3 LT VSD 1 speed`. (`M-P04`)
- [ ] **Canvas is 1400×750** and the background fingerprint matches. (`M-P05`)
- [ ] **Every `obj_id` exists** in
      [reference_data/all-design-objects.json](reference_data/all-design-objects.json).
      (`M-G01`)
- [ ] **Each z band carries only its families** — 110 json/no-conn, 360 AK-PC
      strips, 375 alarm/LED/pump, 1000 enable/disable, 1100 value and setpoint
      pills. No explicit band mixed with `"default"`. (`M-G02`, `M-S06`)
- [ ] **Value and setpoint pills are 50×20.** (`M-G07`)
- [ ] **Setpoints use `number_v3_white_value_only`; measurements do not.**
      Remember that `Requested cap. …` is a measurement. (`M-G03`)
- [ ] **Every compressor cluster is complete** — status, capacity, runtime; VSD
      only where the machine has one. Pitch consistent with a measured pair.
      (`M-G04`)
- [ ] **Every declared suction group carries its eight readouts.** (`M-G06`)
- [ ] **Duplicate aliases and duplicate driver ids are reported and expected.**
      On `TEMPLATE-10229` there is exactly one of each, both on
      `Suction temp. To-MT`. A second duplicate is a finding. (`M-G05`)

### Compare by role, never by array index

```
role key = (obj_id, alias_text, tag_text)
```

Two exports of the same panel routinely order `single_objects` differently. An
index-wise diff of the two ventilation references reported 85 of 102 objects
moved; matched by role, 79 of 102 were identical. **Report the moved roles, not
a count of differing array slots.**

## Stage C — Visual

**Mandatory. A Maskin panel is objects positioned inside pills that the
background drew. Nothing but a render can tell you whether they landed.**

```bash
python render-maskin-panel.py PANEL.json
```

It writes `PANEL-preview.html` at native 1400×750 with the real background from
`panel.image_data` and every dynamic object drawn as its band's colour. Open it
at **100% zoom** — a scaled render hides a 6 px miss.

Automated capture, when a browser is not open:

```bash
export CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
pixelshot PANEL-preview.html --output /tmp/pixelbrowse --tile-height 20000 --viewport-width 1460 --wait-network-idle
```

then slice the tall tile into readable bands. `--tile-height 1568` truncates a
tall preview silently — `tiles.json` still says `"complete": true`.

### C1. Full panel

- [ ] The whole 1400×750 canvas is visible with the real artwork behind it.
- [ ] No object sits outside the canvas.
- [ ] No object sits on blank white artwork.
- [ ] Nothing overlaps a drawn caption.

### C2. One crop per role

`render-maskin-panel.py` derives its crops from
`documentation-rules.json → panel_types.maskin.roles`, so the crop list cannot
drift from the role inventory. Inspect all of them:

- [ ] **MT compressor column** — three status strips on their drawn strips, three
      capacity pills, three runtime pills, **one** VSD pill under C1.
- [ ] **LT compressor column** — same, one VSD pill under C1.
- [ ] **MT suction group** — including the two adjacent pills on the "To °C" /
      "To offset" row.
- [ ] **LT suction group** — including its own "To offset" pill.
- [ ] **Heat recovery** — pump symbol, tan speed pill, LED on the `V3hr` valve,
      the four `Shr` sensors, the two setpoint pills.
- [ ] **Receiver** — `Prec reference` on the **darker** drawn pill, `Prec` on the
      lighter one 25 px below.
- [ ] **High pressure / gas cooler** — the condenser row across the top, the
      `Pgc`/`Pgc reference` pair, `Vhp OD`.
- [ ] **Alarm / IO** — the tan no-connection box and the OK strip inside the
      information panel.

### C3. Every pill lands on a drawn pill

The check that matters, applied object by object in each crop:

- [ ] The pill sits **inside** its drawn pill, not beside it and not half on it.
- [ ] No drawn pill is left empty that should carry a value.
- [ ] No two objects share one drawn pill — **unless** the artwork drew two
      adjacent pills, as on the MT suction row.
- [ ] AK-PC strips land exactly on their drawn green-outlined strips.
- [ ] LEDs and pump symbols sit on their drawn symbol, fully contained.

### C4. The setpoint shading reads correctly

- [ ] Every `number_v3_white_value_only` sits on a **visibly darker grey** drawn
      pill than the measurement pills around it. That is the drawing-method
      doctrine, and the receiver's `Ref` / `Prec bar` pair is the clearest
      instance.

### C5. Text and clipping

- [ ] No value text is clipped by its box.
- [ ] Every `°C` renders as the degree sign, not as mojibake.
- [ ] No hover tooltip is visible in any captured image. **A Designer tooltip is
      runtime UI, not panel content** — move the pointer away before capturing.

### C6. On failure — restart, do not patch

**If stage C fails, go back to the retained source export or the sanitized
fixture and redo the change.** Do not stack a compensating edit on an already
damaged derivative: the second edit hides the first rather than reverting it, and
the result is a panel nobody can diff against anything.

## Stage D — Linking and sanitization

- [ ] **The binding mode is the one the class requires.** A new demo emits the
      literal `"driver_id"` everywhere; a production copy never does — an
      unlinked production object carries an **empty** `driver_id`. (`M-S08`)
- [ ] **`alias_text` is present on every object** and carries a real Danfoss
      parameter name. Stripping it makes the panel unrelinkable.
- [ ] **Nothing committed carries live state** (`M-S10`):
  - [ ] no plant id in `source_plant_id`, `plant_id`, `org_image_name`,
        `image_name` or `panel_name`;
  - [ ] no plant-prefixed `driver_id`;
  - [ ] no `NNN:NNN` `unit_id`;
  - [ ] no personal identity in `saved_by` (`firstname.lastname`);
  - [ ] no `link_tag`, `unit_ref` or `sub_group` residue.
- [ ] **`panel.image_svg_trace` is absent.** It is what the export writes as AI
      *input*; the host deletes it on insert; it must never appear in authored or
      committed output. (`M-S07`)
- [ ] **The fixture was regenerated, not hand-edited.**
      `python build-maskin-fixture.py` owns
      `reference_data/maskin-10229-sanitized.json`.
- [ ] **The generated rules are current.**

```bash
python build-maskin-rules.py --check
```

## Stage E — Import and save

- [ ] **Insert JSON appends. It never clears the canvas.** A full panel document
      belongs on an **empty** canvas unless duplication is intended. Say this in
      the delivery.
- [ ] **The host renames every inserted object** from the live canvas child
      index, so absolute `object_N` values do not survive an append. Only order
      and uniqueness matter.
- [ ] **`linked` will come back `"true"`** on any object whose `driver_id` is not
      the literal `"driver_id"` — including an empty one. That is host behaviour
      (V3scripts.js:514), not a defect, and it is why two objects in
      `TEMPLATE-10229` are `linked:"true"` with no binding.
- [ ] **A background-only patch declares zero counts and empty arrays.** Re-emitting
      the objects "to be safe" duplicates all of them.
- [ ] **A compile always lands `visible=1`.** `iw_save_ctrls.php` ignores the
      posted `visible` value on insert; hide the panel afterwards via the picture
      manager if needed.

## Test commands

```bash
python -m unittest tests.test_maskin_10229_contract
```

```bash
python -m unittest tests.test_build_ventilation_corpus tests.test_list_panel_contract tests.test_maskin_compressor_bank tests.test_ventilation_profile_9099 tests.test_maskin_10229_contract
```

> **The repo convention is per-module.** `python -m unittest discover -s tests`
> fails here with `ImportError: Start directory is not importable`, because
> `tests/` has no `__init__.py`. Do not "fix" it by adding one — name the modules.

## Regression prompt

Run this against any agent given the kit:

> *"Add a fourth fixed-speed compressor to the MT bank of the attached Maskin
> export."*

It passes only if the answer:

1. names the request class (**3 — modification of a supplied export**);
2. emits the **entire** supplied document, not just the new objects;
3. adds exactly three objects — status, capacity, runtime — and **no VSD row**;
4. uses a measured pitch from a named MT pair, not an averaged constant;
5. leaves all 66 existing objects byte-identical, including the three
   `tag_text = " "` values and the duplicate `Suction temp. To-MT` alias;
6. states that the background artwork has no fourth drawn column, so either the
   artwork must change too or the new pills will float;
7. keeps the new objects unlinked with real aliases from the link map;
8. reports the validator command and its output, and the render it inspected.

An answer that emits three loose objects, or that clones C1 and brings a VSD row
with it, or that silently "tidies" the anomalies, fails.
