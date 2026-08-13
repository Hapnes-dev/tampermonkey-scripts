# Ventilasjon authoring guide

**How to generate a production-quality IWMAC Designer Ventilasjon panel, start to
finish.** This is the entry point for an agent asked to build or modify a vent
panel. It is a procedure, not a reference: each step says what to do, which file
holds the numbers, and which validator rule proves you did it.

| You want | Read |
|---|---|
| The procedure — what to do, in order | **this file** |
| A coordinate, an offset, a cluster member list | [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) |
| The machine-readable form of the same rules | [documentation-rules.json](documentation-rules.json) |
| What to check before delivering | [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) |
| Which Designer object to use for a role | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| Panel types other than Ventilasjon | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |
| The envelope and the 17 object fields | [AI-BRIEFING.txt](AI-BRIEFING.txt) §7a |
| A block to paste into a Copilot system prompt | [VENTILATION-COPILOT-PREFLIGHT.md](VENTILATION-COPILOT-PREFLIGHT.md) |

> **Source precedence is defined once**, in the front matter of
> [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) and
> machine-readably in `documentation-rules.json` → `source_precedence`. Do not
> re-derive it, and do not treat a summary anywhere else as a second list. Two
> consequences drive everything below: **a panel JSON or screenshot supplied with
> the task outranks every document in this repository**, and **conflicting
> coordinates are never averaged** — one wins, the other is recorded.

---

## The procedure

1. [Classify the request](#1-classify-the-request) — four cases, and you MUST say which one.
2. [Select the template](#2-select-the-template) — a named profile or a named export, never "production style" in the abstract.
3. [Place clusters whole](#3-place-clusters-whole) — anchor plus members plus offsets.
4. [Choose objects by role](#4-choose-objects-by-role) — from the template's vocabulary, never invented.
5. [Attach every value to its target](#5-attach-every-value-to-its-target) — the connector suffix is a geometric claim.
6. [Build the sidebar once](#6-build-the-sidebar-once) — one section, one row, one value object.
7. [Sanitize the bindings](#7-sanitize-the-bindings) — a demo is unlinked by construction.
8. [Validate structurally](#8-validate-structurally) — run the validator; zero errors.
9. [Render and look at it](#9-render-and-look-at-it) — native 1400 × 750, plus zoomed crops.
10. [Report what you could not verify](#10-report-what-you-could-not-verify) — gaps are recorded, never filled.
11. [Patch a supplied export](#11-patch-a-supplied-export-case-3) — newest JSON wins; never rebuild from memory.
12. [Choose the filter object from the inventory](#12-choose-the-filter-object-from-the-inventory) — binary vs numeric Pa.
13. [Clone sidebar geometry by role](#13-clone-sidebar-geometry-by-role) — geometry only, keep target bindings.
14. [Convert alarms to bacnet_ualarm_v1](#14-convert-alarms-to-bacnet_ualarm_v1) — evidence matrix, not every linked object.

Steps 8 and 9 are both mandatory and neither substitutes for the other. **A panel
that parses is not a panel that renders correctly.** Every defect this
documentation exists to prevent — detached values, duplicate captions, an LED
outside its body, a cluster missing its pump — is structurally legal JSON.

---

## 1. Classify the request

Say which case you picked, in the first line of your answer. The cases behave
differently and picking silently is how a modification turns into a rewrite.

| Case | Request looks like | What you do |
|---|---|---|
| **1 — New unlinked demo** | "Make a 360.001 Ventilasjon demo" | Take a named template's layout whole, then strip its bindings (§7). |
| **2 — Copy of a production layout** | "Build this panel for plant X like plant Y's" | Reproduce the geometry object for object; relink from the **target** plant's dump. |
| **3 — Modification of a supplied export** | "Move the QD50 filter", "align the 360.008 sidebar with 360.002", "add BACnet alarms" | Patch **that exact file**. Newest user-supplied JSON supersedes every earlier generated candidate. Preserve every object and field not explicitly authorized. Never rebuild. |
| **4 — Background artwork** | "Draw the AHU background" | **Refuse and explain.** Ventilasjon has no artwork: the ducts and equipment are objects on the standard blank-sidebar background. `panel.image_svg` MUST NOT appear (`V-S07`). |

Case 1 is where generic dashboards come from. An agent that invents a layout
instead of tracing one produces cards and KPI boxes, not ductwork.

Case 3 is the load-bearing case for Copilot follow-ups. Details: [§11](#11-patch-a-supplied-export-case-3).

**Insert JSON appends.** A full-panel export inserted onto a non-empty canvas
duplicates everything. Insert onto an empty canvas unless duplication is the
intent.

---

## 2. Select the template

### 2.1 What you are allowed to clone

You MUST name the template in your answer. Three kinds are acceptable, in
precedence order:

1. **A panel JSON supplied with the task.** It becomes the geometric template
   outright. Every coordinate in this repository is subordinate to it.
2. **A named production export** — [real-vent-panel-example.json](reference_data/real-vent-panel-example.json)
   (E2) or [real-vent-panel-example-2.json](reference_data/real-vent-panel-example-2.json)
   (E3). Both are real, linked, and masked.
3. **A named profile** — `PROFILE-9099-ROTOR-DEMO` (E4) or
   `PROFILE-BINARY-FILTER-BACNET` (sanitized E29). Name the one you selected.
   `--profile` is what makes the `V-P*` rules run.

"Production style" is not a template. Neither is a remembered layout.

### 2.2 The decision table

Six axes decide what the panel contains. Answer each one from evidence — the
user's system description, a P&ID, a parameter inventory, or the selected export.
**An axis you cannot answer is a gap to report (§10), not a coin to flip.**

| # | Axis | If A | If B | Where the geometry lives |
|---|---|---|---|---|
| 1 | **Heat recovery** | **Rotor** — `number_360_vg_rot` (282, 149) 60×343, spanning both duct runs; alarm, output, efficiency in the cluster | **Plate / no rotor** — the rotor body and its four satellites are absent; the crossover column carries the recovery | contract §4, §5 |
| 2 | **Bypass** | **Present** — the vertical column at x 411 stays continuous: `exhaust_connector_up` y 211, `exhaust_pipe_vertical` y 254, `supply_pipe_vertical` y 329, `supply_connector_down` y 399, damper `number_v3_dummy_resirc_damp_vert` (407, 310) **overlaying** the duct | **Absent** — E3 has no bypass column at all; do not synthesize one | contract §5.9a, §13 |
| 3 | **Water heating** | **Present** — the coil cluster is body + temperatures + `SB510 %` output + alarm + **circulation pump** + **3-way valve**. All six or it is a defect (`V-P01`) | **Absent** — no coil body, and therefore no pump, no valve, no `SB510 %` | contract §5.6 |
| 4 | **Electric heater** | **Present** — `number_v3_el_heater` LV402 (697, 413) 40×85 + output + run-status LED **inside the body** (`V-P05`) | **Absent** — no body, no LED. An LED with no heater is orphaned | contract §5.7, §9.1 |
| 5 | **Sidebar value columns** | **Two** — Tilluft x 1260 and Avtrekk x 1330, when the section has a supply and an extract value per row | **One** — x 1329 alone, when the row names a single signal; use `number_v3_60px_dark_no_conn_no_tag` so the box renders no second caption (`V-G04`) | contract §8 |
| 6 | **Navigation target** | **Known** — the `sub_page_*` object carries the target panel's numeric id in `driver_id` | **Unknown** — **remove the object.** A navigation button pointing nowhere is worse than no button (`V-S08`) | contract §11 |

Two things this table does not do. It does not let you add equipment to fill
space — axis answers come from evidence, and "the panel looks empty" is not
evidence. And it does not make the profile coordinates portable: they are
`PROFILE-9099-ROTOR-DEMO` geometry, valid when that profile is the template and
not otherwise.

### 2.3 Object count is not the target

Do not aim for a number. The 2026-08-09 worked lesson in [CLAUDE.md](CLAUDE.md)
records a 53-object demo that failed because it dropped 27 production roles — but
the defect was the missing roles, not the number 53. Equally, adding a value, an
alarm, an LED, a pump, a valve or a navigation object to raise a count is a
defect in the other direction. The target is: **every role the selected template
has, no role it does not have, each in a complete cluster.**

---

## 3. Place clusters whole

A cluster is **an anchor, its members, and their offsets from that anchor**. The
offsets are the contract; the absolute positions are one instantiation of it.

- To move a component, apply **one translation vector** to every member. Never
  reposition a member individually.
- **A cluster is complete or it is a defect.** Every object in it can be
  individually legal and the cluster still fail — a heating coil with an
  `SB510 %` output but no circulation pump and no 3-way valve is the canonical
  example (`V-P01`).
- Never leave a member behind when relocating. Alarms and outputs are the two
  that get orphaned.

The eleven clusters of the canonical profile, with their anchors:

| Role | Anchor object | Anchor | Members |
|---|---|---|---|
| Extract fan | `V3_58px_fan_left_nrm` | (152, 179) | 3 |
| Supply fan | `V3_58px_fan_right_nrm` | (795, 421) | 3 |
| Extract filter | `numberV3_filter_with_diff_press` | (466, 154) | 1 |
| Supply filter | `numberV3_filter_with_diff_press` | (189, 397) | 1 |
| Rotary heat recovery | `number_360_vg_rot` | (282, 149) | 4 |
| Cooling coil | `number_v3_cooler_2-way` | (456, 409) | 4 |
| Water heating coil | `number_v3_heater_3_way` | (583, 413) | 6 |
| Electric heater | `number_v3_el_heater` | (697, 413) | 2 |
| Room endpoint | `number_360_room` | (1044, 159) | 4 |
| Bypass / recirculation column | `number_v3_exhaust_connector_up` | (411, 211) | 5 |
| Smoke detector | `V3_led_18px_circ_grey_red` | (893, 422) | 2 |

Member lists and per-member offsets are in `documentation-rules.json` →
`profiles.PROFILE-9099-ROTOR-DEMO.clusters[]` and, with their evidence, in
contract §5. `V-P01` checks completeness; `V-P02` checks the offsets. This table
is the 9099 rotor profile. A binary-filter panel uses `number_v3_filter_only`
(§12, contract §5.3b) — do not copy the diff-press anchors onto it.

**The bypass duct is not shortened to clear its damper.** The damper overlays a
continuous vertical run. Cutting the duct to make room is the specific defect
that turns a schematic into a diagram.

---

## 4. Choose objects by role

**Spell `obj_id` exactly as the catalogue or the reference JSON spells it.** An id
that matches no palette entry renders as a broken `undefined`-class box, silently.
`numberV3_filter_with_diff_press` really carries a capital V;
`number_v3_cooler_2-way` really carries a hyphen. Do not normalize either.

Three prohibitions, in the order they bite:

1. **MUST NOT invent an `obj_id`.** If the role has no object you can name from
   the catalogue, that is a gap (§10).
2. **MUST NOT substitute a generic box for a purpose-built object.** A numeric
   differential-pressure filter is `numberV3_filter_with_diff_press` — one object
   that renders body, tag and Pa together. A binary Normal/Alarm filter is
   `number_v3_filter_only` plus a verified alarm indication. Adding a fabricated
   Pa box beside a binary filter is a defect (`V-P09`). Adding a second pressure
   box beside a diff-press filter is a duplicate, not a completion (`V-P07`).
3. **MUST NOT assume an id is right because it exists.** Passing the id-exists
   check is the check agents remember to run and the one that proves least. All
   eight substitutions in the 53-object lesson were legal palette entries; none
   appeared in the reference.

**Object choice can be profile-scoped.** The inlet dampers are the worked case:
E1/E2 use recirculation dummies (`number_v3_dummy_resirc_damp_hor`), E3 and E4 use
production horizontal flow dampers (`V3_horis_damper_flow-left_nrm` /
`-right_nrm`). Both families are production-real. Which is correct depends on the
selected template, and for `PROFILE-9099-ROTOR-DEMO` it is the flow dampers
(`V-P03`). Contract §5.9a / §5.9b carry both, with their coordinates.

Catalogue dimensions are **not** placement geometry. The catalogue says how big an
object is by default; the export says where this panel puts it and at what size.

---

## 5. Attach every value to its target

A value object carries a connector stub. The suffix says which edge it leaves
from, and therefore where the box must sit relative to what it describes.

| Suffix | The box sits | Stub points | Its edge must meet |
|---|---|---|---|
| `con_down` | **above** the target | down | the target's top edge |
| `con_top` | **below** the target | up | the target's bottom edge |
| `con_left` | to the **right** of the target | left | the target's right edge |
| `con_right` | to the **left** of the target | right | the target's left edge |

Three rules follow, and all three are enforced:

- **The connector edge must visibly meet its target.** A value floating near a
  duct is a defect, not an approximation (`V-G03`).
- **The direction follows the target, not a style preference.** In E1/E2 the KA
  position values are `con_top` because their target is the *duct*; in E4 they are
  `con_down` because the target became the *damper*. The suffix changed because
  the geometry changed.
- **Exactly one position value per damper.** Duplicate `KA` objects — a stale copy
  left behind by an edit — are the most common detached-value defect (`V-G07`).

Do not add a free-standing text label for something an equipment or value object
already renders. `KA502`, `Cool`, `Rotor`, `VGV`, `Kurver` are the recurring
offenders; each is a duplicate caption unless the selected export explicitly
contains it (`V-G04`, `V-P07`).

Text is UTF-8. Write `°C`, `m³`, `høyfart` and the Norwegian letters as
themselves. **`gr C` is a degradation, not a fallback** (`V-S09`) — if degree
signs are arriving mangled, the transport is wrong; fix that instead of the panel.

---

## 6. Build the sidebar once

The sidebar is where duplication accumulates, because each section looks
plausible in isolation.

- Each section is built **exactly once**. Header bars are 250 × 20 at x 1150.
- One label column, and one or two value columns (decision-table axis 5).
- Where a separate row label already names the signal, the value object MUST be
  `number_v3_60px_dark_no_conn_no_tag` so it renders no second caption.
- No duplicate row labels, no duplicate value objects, no two objects at the same
  coordinate (`V-G06`).
- Sidebar labels MUST NOT collide with `Tilluft` / `Avtrekk` or with their own
  value boxes.

Rendered-text separation is checked at **4 px minimum**, but every rendered width
in this repository is an **estimate**: no rule fails a panel on the strength of
one, and width-dependent findings are reported as warnings (`V-P08`). Contract
§7.2 and §12.1-6 record why — the two supplied width readings disagree with Arial
metrics and with production's own `A-Alarm` / `B-Alarm` pitch.

---

## 7. Sanitize the bindings

A generated demo is **unlinked by construction**, and that is not the same shape
as an unlinked object in a real export.

| Field | Demo value |
|---|---|
| `id` | the literal `"driver_id"` |
| `driver_id` | the literal `"driver_id"` |
| `linked` | `"false"` |
| `link_name`, `link_tag`, `unit_id`, `unit_ref`, `sub_group` | `""` |
| `alias_text` | **preserved verbatim** |

Also blank the envelope's `source_plant_id` and `panel.plant_id`.

**Do not strip `alias_text`.** It is the selector text a human links by afterwards;
removing it makes the demo unrelinkable. Do not strip scaffold objects either —
"not live-linked" is not a reason to delete anything.

**MUST NOT invent a driver id, unit id, plant parameter id, file path, or target
panel id.** An invented id looks linked and is not, which is strictly worse than
an empty one. If a navigation object's target is unknown, remove the object.

Why the placeholder matters: a production export leaves an unlinked object's
`driver_id` **empty**; only a generated panel emits the literal `"driver_id"`.
Measured across the reference set, that is 0 placeholders on 194 production
objects and 97 on 97 demo objects — a total split, which is what lets `V-S08`
detect the mode automatically and check the right contract.

---

## 8. Validate structurally

```bash
python validate-ventilation-panel.py path/to/panel.json --profile PROFILE-9099-ROTOR-DEMO
```

Drop `--profile` when no named profile applies; the global `V-S*` and `V-G*` rules
still run, and only the profile-scoped `V-P*` rules are skipped. `--json` emits
machine-readable findings. Mode is detected automatically; `--mode` overrides it.

**Zero errors is the bar.** Warnings are read, not ignored — each one is either a
real finding or a known production quirk, and you should say which.

What it checks, by namespace:

- `V-S*` — envelope, `counts` versus array lengths, all 17 fields present,
  `object_0…object_N` sequential with no gaps or duplicates, integer coordinates
  inside the canvas, explicit z-bands never mixed with `default`, no `image_svg`,
  empty `containers` and `graphics`, the unlinked-demo binding contract, UTF-8 and
  degree signs.
- `V-G*` — every `obj_id` in the palette, connector-to-target attachment, duplicate
  captions, one alarm per guarded role, sidebar uniqueness, one KA value per
  damper.
- `V-P*` — the selected profile's cluster completeness and offsets, damper family,
  fixed blocks, LED containment, alarm coordinates, prohibited absences, sidebar
  centring.

The full rule-id table, and which contract section owns each, is in contract §0.3.

---

## 9. Render and look at it

**Structural validation is not enough, and this step is not optional.** Render at
native **1400 × 750** — not scaled, not cropped to fit — and inspect:

1. The full panel.
2. Zoomed crops of: inlet dampers · both fans · rotor and bypass · both filters ·
   cooling coil · water-heating coil (pump and valve present?) · electric heater
   (LED inside the body?) · room endpoint · **every** sidebar section.

Check **rendered glyph extents**, not just `posWidth` / `posHeight` — a box can be
within bounds while its text is not. Reject on sight:

- overlapping labels
- duplicate captions
- values detached from what they describe
- connector stubs pointing into empty space
- incomplete clusters
- text that adds nothing an object already renders

Move the pointer away before capturing. **A Designer hover tooltip is runtime UI,
not panel content** — a tooltip in a QA screenshot has repeatedly been mistaken
for a stray object.

**If visual QA fails, restart from the retained source export.** Do not patch a
chain of compensating geometry changes; that is how a two-pixel correction becomes
a re-spaced panel.

Full step list: [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) stage C.

---

## 10. Report what you could not verify

Finish by stating, explicitly:

- the case you picked (§1) and the template you cloned (§2.1);
- every axis of the decision table you answered from assumption rather than
  evidence;
- every role you could not place because no coordinate exists;
- the exact commands you ran and their output — validator, tests, render;
- anything that failed, plainly, including partial failures.

**Do not invent a coordinate, `obj_id`, driver id, unit id, parameter alias, file
path, or navigation target to close a gap.** Open questions belong in contract §12
and in `documentation-rules.json` → `open_evidence`, where the next session can
find them. A recorded gap costs one line; an invented coordinate propagates until
someone renders the panel and cannot say why it is wrong.

---

## 11. Patch a supplied export (case 3)

Treat the **newest user-supplied JSON** as the authoritative document. Compare
changes by semantic role, `obj_id`, alias, driver binding and geometry — never
only by array index. Use that file directly as the patch base.

Required behaviour:

- Preserve every object and every field not explicitly authorized for change.
- Do not rebuild the panel from an earlier generated file.
- Do not renumber, resize, replace or reposition unrelated objects.
- If the user later supplies a newer export, that file supersedes prior
  generated candidates.
- Run `validate-ventilation-panel.py --compare SOURCE.json CANDIDATE.json
  --patch-scope …` so only named roles or fields changed.

Patch scopes: `position`, `filter-cluster-move`, `sidebar-geometry`,
`bacnet-alarm-migration`, `alarm-and-sidebar`, `source-truth-cleanup`, `none`.

### 11.1 Session files vs the customer's SharePoint file

Generated workspace artifacts may not remain available in a later execution
context. Required assistant behaviour:

- Never imply that the customer's SharePoint file was deleted.
- If a temporary working copy is missing, say exactly that.
- Search or inspect the current workspace first.
- If the user supplies a newer export, use it directly.
- Do not reconstruct a full production panel from memory when an authoritative
  export is missing.
- Prefer asking for, or using, the latest export over silently rebuilding.

### 11.2 Unsupported values (source-truth cleanup)

When the user requests source-truth cleanup, remove live values the parameter
inventory does not support, plus their orphaned connector or caption objects.
Keep physical scaffold the user explicitly wants (E29: empty `number_360_room`).
A room box may remain empty when no room-temperature parameters exist.

E29 / `PROFILE-BINARY-FILTER-BACNET` unsupported tags: `RT900`, `RT520`, `RY401`,
`Arb. SP.`, `RT600`, `RT601`, `RT600/601`. That list is **case-scoped**. The
9099 rotor profile **does** carry a room-temperature value; do not delete RT600
there. Never preserve a plausible-looking value only because an earlier template
had it. Never create or retain a link the inventory does not support. Report
every removed role. `V-P10`.

Wrong: keep RT600/RT601 because the 9099 demo had a room temperature.
Correct: retain the empty `number_360_room` and drop the un evidenced values.

---

## 12. Choose the filter object from the inventory

| Inventory | Object | Alarm |
|---|---|---|
| Numeric differential pressure (Pa) | `numberV3_filter_with_diff_press` | Production-proven bell or ualarm per the selected reference |
| Binary Normal/Alarm (or equivalent), no Pa | `number_v3_filter_only` | One verified alarm indication, typically `bacnet_ualarm_v1` when BACnet |

Do not display a fabricated Pa value. Keep the filter icon's **verified production
size and proportions** from the source JSON. Symbols must not be stretched merely
to cross a duct. Move by changing position. The body must visually intersect its
duct (`V-G08`). The QD tag must remain readable. The associated alarm must travel
with the filter (`V-C05`).

Wrong: stretch `number_v3_filter_only` until it spans the duct.
Correct: keep 90×83 (when that is the source size) and translate the whole cluster.

Wrong: move the filter and leave the alarm at the old coordinate.
Correct: one translation vector on body + QD + alarm.

90×83 is `CASE-4743-360008` evidence, not a universal size. Palette default for
`number_v3_filter_only` is 27×53.

---

## 13. Clone sidebar geometry by role

When a sibling panel is supplied for alignment (360.002 for 360.008):

```bash
python clone-ventilation-sidebar-geometry.py TARGET.json SIBLING.json -o OUT.json
python validate-ventilation-panel.py OUT.json --profile PROFILE-BINARY-FILTER-BACNET \
  --sibling-sidebar SIBLING.json
```

Copy geometry only. Preserve the target's `driver_id`, `unit_id`, `alias_text`
and system identity. Match roles by `tag_text` then alias, never index.
Labels such as Systemvender, Alarm and Alarmkvittering must use the sibling's
measured geometry so they render with the same apparent centring.

Wrong: copy 360.002 bindings onto 360.008.
Correct: copy `posLeft`/`posTop`/`posWidth`/`posHeight` by role; keep 360.008
drivers.

Designer has no CSS text-align field.

---

## 14. Convert alarms to bacnet_ualarm_v1

Host facts: [CLAUDE.md](CLAUDE.md) (`onParamPopup_link`, `addAlarmObject`,
`bacCheck` / `checkDriver`). Geometry: contract §10.2. This section owns
**whether** to add a ualarm.

### 14.1 Decision matrix

**Strong candidate** — all of: the same semantic role already carries
`bacnet_ualarm_v1` in the selected production reference; the parameter is
BACnet-backed; the alarm is visually meaningful on the target; the user
requests alarm visibility for that role.

**Conditional candidate** — start/status, pump/fan/damper state, valve output,
temperature, pressure, airflow, efficiency. Add only when production evidence,
host semantics, alarm metadata or an explicit user requirement supports it.

**Do not add automatically:** setpoints, commands, alarm acknowledgement,
system/operating-mode selectors, navigation, static labels, decorative scaffold,
unlinked room placeholders, values with no verified BACnet parameter, right-sidebar
controls unless the chosen reference explicitly uses ualarms there (`V-P12`).

**Explicit signal rule.** If the panel already has an independently documented
fault or alarm parameter, decide from evidence whether the explicit fault object
remains, is replaced by a ualarm on the main parameter, or both are required.
Default: exactly one intended indication per guarded role (`V-G05`). E3's two
`Malf. damper` bells on two dampers are two roles, not a duplicate.

Wrong: add `bacnet_ualarm_v1` to every linked object because a sibling panel
looks busy.
Correct: apply the matrix; report skipped roles.

Wrong: add generic `V3_R_34px_circular_alarm_nrm` when the request is BACnet
ualarm conversion.
Correct: `bacnet_ualarm_v1` with the verified base driver.

### 14.2 Removing old alarms

Remove only old alarm objects that are demonstrably replaced. Do not delete
right-sidebar alarm LEDs, equipment status LEDs, or explicit fault indications
unless replacement semantics are verified. Remove stale unlinked "Alarm Points"
only when confirmed orphaned. Ensure one intended indication per guarded role
unless the reference explicitly contains more.

### 14.3 Matching hierarchy

Tolerate known source inconsistencies (`Avtreksvifte` / `Avtrekksvifte`, stale
JV40/JV50 aliases, `360.02` vs `360.08` prefixes) as **candidate discovery**,
never as silent authorization:

1. Exact target `driver_id` from the verified parameter inventory.
2. Exact normalized `alias_text`.
3. Instrument tag and functional role.
4. `obj_id` plus local equipment cluster.
5. Human review if still ambiguous.

Never bind an alarm to the wrong parameter because a string was close enough
(`V-G09`).

### 14.4 Idempotence

```bash
python migrate-ventilation-bacnet-alarms.py PANEL.json -o OUT.json [--reference REF.json]
```

The helper converts **generic circular alarms next to eligible linked process
objects**. It does **not** sweep every linked value — that over-eager sweep is
the case-study failure. Running it twice must not add a second `bacnet_ualarm_v1`,
append `.Ualarm` twice, move already-correct alarms, remove unrelated status
objects, or change object count after the first successful run.

Serialized compiled-store exports (E29) already carry **one** `.Ualarm` suffix —
that is the saved-panel shape. `--omit-ualarm-suffix` writes the base id.

Userscript Insert calls `load_new_ver_objects`, which runs `checkDriver`, so
**base** and **one suffix** both round-trip to one suffix on the next compile.
`bacCheck` **does** double if the DOM already carries `.Ualarm` (container-item
load, or any path that skipped `checkDriver`). Never author `.Ualarm.Ualarm`.
Container items must use the base id. Details: CLAUDE.md §13c.

### 14.5 Filter ualarms

A binary-filter ualarm is **not** a copy of the filter body's driver. E29 filter
bodies are unlinked; the ualarm carries the Filtervakt parameter. Place by the
§5.3b offset from the body, not by inventing a body binding.

---

## Failure catalogue

The defects that actually recur, and what catches each. If you are debugging a
rejected panel, start here.

| Symptom | Cause | Rule |
|---|---|---|
| Value bubble floating beside a duct | Wrong connector suffix, or right suffix and wrong side | `V-G03` |
| Two `KA501 %` boxes on one damper | Stale copy left after a move | `V-G07`, `V-P07` |
| `SB510 %` present, no pump, no valve | Cluster relocated member by member | `V-P01` |
| Heater LED half outside the body | Copied from the superseded (700, 466) reading | `V-P05` |
| Two alarms on one component | Cluster placed twice | `V-G05` |
| `Cool` or `Rotor` text next to the object that already renders it | Decorative caption added | `V-G04`, `V-P07` |
| Sidebar section rendered twice | Section rebuilt instead of edited | `V-G06` |
| `object_7` missing, `object_12` twice | Objects removed without renumbering | `V-S03`, `V-S04` |
| `counts` says 102, array has 97 | Objects removed, counts not updated | `V-S02` |
| One object at `zIndex "default"` among explicit bands | Field omitted, importer filled it in | `V-S06` |
| Background artwork behind a vent panel | Case 4 not refused | `V-S07` |
| A real driver id in a demo | Sanitization skipped on one object | `V-S08` |
| `gr C` in a tag | Degree sign degraded instead of fixing the transport | `V-S09` |
| Binary filter drawn as `numberV3_filter_with_diff_press` | Inventory has Normal/Alarm only | `V-P09` |
| Filter moved, alarm left behind | Cluster not translated as a unit | `V-C05`, `V-G08` |
| `.Ualarm.Ualarm` | Second `bacCheck` pass authored into JSON | `V-G09` |
| ualarm on a sidebar setpoint | Automatic "every linked object" sweep | `V-P12` |
| Sidebar labels jump when switching 360.00N | Bindings copied, or geometry not cloned by role | `V-P11` |
| RT600 kept with no inventory row | Template residue | `V-P10` |
| Panel rebuilt after a later export arrived | Case 3 ignored; workspace copy reconstructed | §11 |

Two production quirks that MUST NOT be "fixed":

- **`SB520 %` legitimately appears twice** in the canonical profile — once as the
  cooling output, once as the electric heater's regulator power, with different
  `alias_text`. Duplicate-value detection is scoped to `KA` codes for exactly this
  reason and MUST NOT be widened to every tag string.
- **Room-endpoint value objects carry a single-space `tag_text` on purpose**, with
  `number_v3_label_8px_norm` captions supplying `RP501 ppm` and `RT600 °C`
  alongside. That is the production pattern, not a missing label.
