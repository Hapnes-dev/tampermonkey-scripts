# Maskin knowledge bundle

> **GENERATED — DO NOT HAND-EDIT.** Rebuild with `python build-maskin-knowledge.py` and verify with `python build-maskin-knowledge.py --check`.

This is a single-file rendering of the live owners listed below. On any conflict, follow the rendered source precedence and the owner named by the relevant rule block.

## Build sources

- `documentation-rules.json`
- `MASKIN-COPILOT-PREFLIGHT.md`
- `MASKIN-QA-CHECKLIST.md`
- `AI-BRIEFING.txt`
- `reference_data/maskin-akpc-link-map.json`

## Source precedence

| rank | entry key | source / rule |
|---|---|---|
| 1 | source | A panel JSON or screenshot supplied with the current task |
| 2 | source | A production export of the same panel and system type |
| 3 | source | The measured geometry contract for the panel type, scope-tagged: VENTILATION-GEOMETRY-CONTRACT.md for vent panels, LIST-PANEL-GENERATION-CONTRACT.md for list panels, MASKIN-GENERATION-CONTRACT.md for Maskin panels |
| 4 | source | Panel-specific rules in iwmac-designer-reference/CLAUDE.md |
| 5 | source | AI-BRIEFING.txt (its accepted revision is applied in place; AI-BRIEFING-REVISED.txt is a record, not a second contract) |
| 6 | source | PANEL-TYPE-GUIDE.md |
| 7 | source | DESIGN-OBJECT-CATALOG.md |
| 8 | source | Generic visual-design advice |
| "" | rule | Never average conflicting coordinates. Take the value from the highest-ranked source that has one. |
| "" | rule | When no source at any rank has the value, mark the gap and stop. Do not invent a coordinate, obj_id, driver id, unit id, parameter alias, file path or navigation target. |
| "" | rule | A scoped profile under profiles.* sits at rank 3 alongside the geometry contract and applies only inside its own scope. It never overrides a supplied export or a production export of the same panel. |

## Scope tags used here

| scope | definition |
|---|---|
| MASKIN | Applies to Maskin / machine-room panels. Confirmed on the plant-10229 AK-PC 782A CO2 booster export (E9/E10) and consistent with the fleet survey in PANEL-TYPE-GUIDE.md. A rule tagged MASKIN that rests on E9 alone says so in its own evidence list. |
| TEMPLATE-10229 | Geometry of one named Maskin template: the plant-10229 AK-PC 782A booster with 3 MT + 3 LT compressors, gas cooler, receiver and heat recovery, measured from E9 and committed sanitized as E10. Reproduce it when that template is the selected source. A different machine room legitimately differs - never promote a TEMPLATE-10229 coordinate to MASKIN without a second export. |
| GLOBAL | Applies to every panel type. |

## Global invariants

- **envelope**
  - **format** — iwmac-designer-panel
  - **version** — 1
  - **required_top_level**
    - format
    - version
    - generator
    - source_plant_id
    - panel_name
    - panel_width
    - panel_height
    - counts
    - background_embedded
    - panel
  - **required_panel**
    - plant_id
    - panel_name
    - panel_width
    - panel_height
    - org_image_name
    - image_name
    - saved_by
    - single_objects
    - containers
    - graphics
  - **note** — Committed reference JSONs in this repo wrap the same document as {_note, envelope:{...}}. A live userscript export is flat. A reader must accept both: env = doc.get('envelope', doc).
- **counts_must_equal_array_lengths** — true
- **object_fields**
  - obj_id
  - name
  - id
  - posWidth
  - posHeight
  - posLeft
  - posTop
  - zIndex
  - tag_text
  - linked
  - link_name
  - link_tag
  - sub_group
  - driver_id
  - unit_id
  - unit_ref
  - alias_text
- **object_field_count** — 17
- **naming**
  - **pattern** — object_&lt;n&gt;
  - **start** — 0
  - **sequential** — true
  - **duplicates_allowed** — false
- **geometry_type** — integer pixels
- **obj_id_rule**
  - **must_exist_in** — reference_data/all-design-objects.json
  - **spelling** — verbatim - do not normalise capitalisation or 'correct' historic spelling
  - **examples_that_look_wrong_and_are_not**
    - numberV3_filter_with_diff_press
    - numberV3_outside_temp
    - number_v3_cooler_2-way
  - **on_violation** — An id with no palette entry renders as a broken undefined-class box.
- **encoding**
  - **output** — UTF-8
  - **degree_symbol** — °C
  - **forbidden** — gr C
  - **evidence** — Insert JSON reads files as UTF-8; production exports carry 13 (E1/E2) and 8 (E3) degree tags and zero 'gr C'; DESIGN-OBJECT-CATALOG.md itself prints RT401 °C.
  - **note** — The mojibake risk lives in other transports (terminal paste, the ISO-8859-1 page, old mail). Fix the transport; do not degrade the panel text.
  - **scope** — GLOBAL
- **unlinked_demo_contract**
  - **id** — driver_id
  - **driver_id** — driver_id
  - **linked** — false
  - **link_name** — ""
  - **link_tag** — ""
  - **unit_id** — ""
  - **unit_ref** — ""
  - **sub_group** — ""
  - **alias_text** — PRESERVE - it is what a human links by afterwards
  - **source_plant_id** — ""
  - **panel.plant_id** — ""
  - **prohibition** — Never invent a driver id, unit id, parameter id, file path or panel target. An invented id looks linked and is not.
  - **scope_exception** — List panels do NOT follow this contract. Production list panels carry linked "true", link_name "link_name" and driver_id "" on every object. See panel_types.list_panel.bindings, which overrides this block for that panel type, and preserves the same safety guarantee through a different invariant.
- **quality_metric**
  - **object_count_is_not_a_target** — true
  - **target** — coverage of the production roles present in the reference
  - **scope** — GLOBAL
- **container_fields**
  - id
  - unique_id
  - name
  - type
  - container_type
  - className
  - header_footer
  - linked
  - linked_to
  - width
  - height
  - left
  - top
  - zIndex
  - items
  - title
- **container_field_count** — 16
- **visual_correctness**
  - **scope** — GLOBAL
  - **contract** — VISUAL-CORRECTNESS-CONTRACT.md
  - **validator** — validate-visual-correctness.py
  - **tests** — tests/test_visual_correctness.py
  - **fixtures**
    - reference_data/visual-correctness-demo.json
    - reference_data/visual-correctness-allowed-values.json
  - **rule_namespaces**
    - **VC-T** — text protection (contract SS3, SS4)
    - **VC-W** — width from allowed values (contract SS5)
    - **VC-A** — analysis-block completeness (contract SS2)
  - **visual_analysis_before_generation**
    - **rule** — A supplied production JSON is an authoritative visual template, not merely a schema or a data source. Before generating from it or modifying it, classify: panel type and visual purpose, background ownership, container anatomy, repetition model, live-object overlay model and z-bands, object vocabulary and per-object role, measured geometry and content bounds, text inventory, value sizing sources, operator-facing information priority, intentional overlaps, sanitization state (A1..A12). State the analysis before emitting JSON; cite it for every geometric decision.
    - **items**
      - A1 panel type and visual purpose
      - A2 background ownership
      - A3 container anatomy
      - A4 repetition model
      - A5 live-object overlay model and z-bands
      - A6 object vocabulary and roles
      - A7 measured geometry and content bounds
      - A8 text inventory
      - A9 value sizing sources
      - A10 operator-facing information priority
      - A11 intentional overlaps
      - A12 sanitization state
  - **text_protection**
    - **rule** — A live object (alarm icon, status symbol, value, setpoint, navigation, decoration) must never overlap a nonblank descriptive-text rectangle, at any z-index, unless the supplied production panel proves that exact overlap intentional (same object pair, same role pair, same relative arrangement).
    - **not_a_blanket_overlap_ban** — Live-over-artwork overlaps are routine and often mandatory (connector-pipe, damper-duct, LED-equipment, value-duct, cluster-on-case). The removed 'Never overlap; 8 px gaps' instruction caused agents to trim ducts; this rule protects text only. See DOCUMENTATION-AUDIT.md F5/F10/F11.
    - **role_geometry** — Descriptive text, icon/symbol, live value and engineering unit each own their own rectangle; a table row reserves a static label cell, a blank icon cell and a blank value cell. Never an icon appended at the end of a text string without a reserved cell; never assume right-side space is free because the current text is short.
    - **proof_tolerance_px** — 2
  - **allowed_values_sizing**
    - **rule** — The current value is never sufficient to size a value object. When the source provides allowed display values (format_extra enum maps, an 'Allowed values' workbook column, state definitions, value maps, translated state labels), parse every allowed display value and size the object (or choose the obj_id variant) for the longest of them, plus the engineering unit when co-located.
    - **enum_form** — 'value = label' pairs separated by a spaced slash (' / '), ';', ',' or newlines; a bare '/' inside a label is label content (Heat/Cool), not a separator. Dominant production form '0 = OFF / 1 = ON' (E23; all 107 of its enum maps use the spaced form).
    - **range_form** — 'a to b' sizes for the widest bound rendering including sign and decimals.
    - **worked_example** — '0 = Alarm / 1 = OK / 2 = Communication error': longest label 19 chars, about 19*7+6 = 139 px at the 13 px font; a 42 px numeric pill truncates it.
    - **evidence**
      - E23
      - E22
  - **width_estimator**
    - **char_px** — 7.0
    - **pad_px** — 6.0
    - **note** — Conservative floor detector at the 13 px default font, never a typesetter: findings prove 'cannot fit', never 'fits pixel-perfectly'. A rendered screenshot outranks the estimate.
  - **cannot_see** — Text drawn inside background artwork has no rectangle in the JSON; collisions with background text need a render plus a human eye or a measured sidecar, exactly as equipment footprints need one (O-G08).

## Evidence records referenced here

| id | file | role / what it is | other fields |
|---|---|---|---|
| E9 | iwmac-panel_10229_maskin_20260810-1033.json (user Downloads, plant 10229, NOT committed) | The production export supplied with the 2026-08-10 Maskin documentation task. Highest-precedence source for Maskin geometry, object vocabulary, z-indexes, ordering, background fields, aliases and role coverage. Carries live plant bindings and is therefore not committed. | committed: false<br>sanitized: false<br>panel: Maskin<br>generator: IWDIE v1.7.0 |
| E10 | reference_data/maskin-10229-sanitized.json | E9 with its bindings replaced by the unlinked-demo contract and nothing else touched. Produced by build-maskin-fixture.py. Authoritative for TEMPLATE-10229 geometry; a demo, not a production export, for bindings. | committed: true<br>sanitized: true<br>plant: ""<br>panel: Maskin<br>derived_from: E9<br>dropped: ["panel.image_svg_trace"] |
| E11 | reference_data/generated-maskin-example.json | An AUTHORED demo: 63 objects on an AI-authored image_svg background, insert-verified, aliases taken from E12. Its coordinates were composed, not measured, and its zIndex is "default" throughout. Valid as a worked example of the unlinked-demo contract and of image_svg authoring. NOT a geometry source: where it disagrees with E9/E10, E9/E10 win. | committed: true<br>sanitized: true<br>panel: Maskin |
| E12 | reference_data/maskin-akpc-link-map.json | Alias to Danfoss AK-PC parameter map, 64/64 exact alias matches on a masked production panel, plus the relink recipe and the driver-id anatomy. This is why alias_text survives sanitization. | committed: true |
| E13 | tests/fixtures/maskin-compressor-bank/ | Miniature 96x64 instrumented fixture for the compressor-bank editing procedure: source panel, edited full panel, background-only patch and expectations. Its marker colours, canvas and (+24,0) pitch are test instrumentation, never production geometry. | committed: true<br>sanitized: true |
| E24 | machine-room-demo-extra-mt-compressor-connected-pipes-matched-size.json (user Downloads, NOT committed) | The delivered fourth-MT-compressor demo: a TEMPLATE-10229 unlinked panel plus one appended compressor column (status, capacity, runtime) over a background extended with the matching artwork. | committed: false<br>sanitized: true<br>panel: Maskin<br>canvas: 1400x750<br>objects: 69<br>note: An authored demo, not a measurement. It is evidence of what the workflow produced and where it failed - the three appended objects share ONE (+81,0) offset from the C3 MT column at (234,289) / (246,326) / (247,362), which is the M-A01 single-vector rule holding, and all three carry alias_text "", which is the M-A08 defect. Never cite it for production geometry: E9 and E10 own that. |

## Copy source and negative example

### File to copy

- **file** — reference_data/maskin-10229-sanitized.json
- **committed** — true
- **sanitized** — true
- **plant** — ""
- **panel** — Maskin
- **role** — E9 with its bindings replaced by the unlinked-demo contract and nothing else touched. Produced by build-maskin-fixture.py. Authoritative for TEMPLATE-10229 geometry; a demo, not a production export, for bindings.
- **derived_from** — E9
- **dropped**
  - panel.image_svg_trace

### Negative example

- **file** — reference_data/generated-maskin-example.json
- **committed** — true
- **sanitized** — true
- **panel** — Maskin
- **role** — An AUTHORED demo: 63 objects on an AI-authored image_svg background, insert-verified, aliases taken from E12. Its coordinates were composed, not measured, and its zIndex is "default" throughout. Valid as a worked example of the unlinked-demo contract and of image_svg authoring. NOT a geometry source: where it disagrees with E9/E10, E9/E10 win.

## The 20 preflight rules — verbatim

1 PRECEDENCE, highest first. Never average two conflicting coordinates.
  1 panel JSON or screenshot supplied with this task  2 production export of the
  same panel and machine type  3 MASKIN-GENERATION-CONTRACT.md  4 panel rules in
  the reference CLAUDE.md  5 AI-BRIEFING.txt  6 PANEL-TYPE-GUIDE.md
  7 DESIGN-OBJECT-CATALOG.md  8 generic visual advice. Say which rank you worked
  from. A supplied export IS the geometric template. The catalogue's sizes are
  toolbox defaults, not placement geometry: use it to check that an obj_id
  exists, never to decide how big an object is.

2 NAME THE CLASS, and the profile, before placing anything.
  1 new unlinked demo  2 linked copy for another plant  3 modification of a
  supplied export  4 background-only patch. Class 3 emits the ENTIRE supplied
  document with only the named objects changed, never just the new objects.
  Class 4 emits zero counts and three empty arrays. The only profile with
  complete measured geometry is TEMPLATE-10229: AK-PC 782A, 3 MT plus 3 LT
  compressors, VSD on C1 only, gas cooler, receiver, heat recovery. If none fits,
  say so and name what you cannot cover.

3 NEVER INVENT a coordinate, obj_id, driver id, unit id, parameter alias, plant
  id, file path or navigation target. Missing evidence is reported, not filled
  in. Copy obj_id spelling exactly, including V3_81x21_enebled_disabled_nrm.

4 BACKGROUND OWNS ALL ARTWORK. Dynamic objects own live values only. The
  background draws the enclosure, pipes, equipment symbols, every static label,
  the EMPTY white value pills and the DARKER GREY setpoint pills. Never bake a
  live number or state into artwork. Never draw a value box that an object will
  also render. Background colour follows the supplied export or the user's
  requirement: preserve a supplied background unless a change is requested, and
  a dark background is not a defect on colour grounds alone.
  NEVER EMIT panel.image_svg_trace. The export writes it as AI input and the host
  deletes it on insert. If you author new artwork, the template coordinates no
  longer apply, and you must say so.

5 STRUCTURE. All 17 fields on every object: obj_id, name, id, posWidth,
  posHeight, posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag,
  sub_group, driver_id, unit_id, unit_ref, alias_text. counts equal array
  lengths. names are object_0 to object_N, sequential, no gaps or duplicates.
  Integer pixels inside 1400 x 750. containers and graphics empty.

6 Z-INDEX BANDS, strings, never mixed with "default". 110 custom json and
  no-connection boxes. 360 AK-PC status strips. 375 alarms, LEDs, pumps.
  1000 enable/disable strip. 1100 value and setpoint pills. THESE ARE NOT THE
  VENTILATION BANDS. The reference CLAUDE.md list, 110 values and 1100 labels, is
  ventilation-scoped; using it here puts every pill under the artwork.

7 OBJECT BY ROLE. Measurement: number_v3_value_only 50x20 z1100. Setpoint or
  reference: number_v3_white_value_only 50x20 z1100. Compressor run state:
  V3_akpc_772_781_781A_783_contr 81x21 z360. Suction group control state:
  V3_akpc_782A_suct 81x21 z360. Condenser control state:
  V3_akpc_783_781A_782A_cond 81x21 z360. OK/alarm: V3_ok_alarm_nrm 61x21 z375.
  Enable/disable: V3_81x21_enebled_disabled_nrm 81x21 z1000. Valve LED:
  V3_led_13px_circ_grey_green 13x13 z375. Pump: V3_21px_single_pump_grey_green_down
  21x21 z375. Two objects are deliberately NOT value pills because the artwork
  under them differs: Hr pump speed is number_v3_custom_json_obj 40x20 z110 on a
  tan pill, u17 Ther Air is number_v3_60px_no_conn 62x22 z110 in the information
  panel. Substituting a generic value box for either is a defect even though both
  substitutes are legal palette ids.

8 SETPOINT PILL RULE. The white pill marks a setpoint. The markers are
  reference, ref., consumer request and ctrl. The marker is NOT plain request:
  Requested cap. MT, Requested cap. LT and Cond. requested cap. are measurements
  and use the normal value pill.

9 CLUSTERS ARE ATOMIC. Place every member or none, and relocate with ONE vector.
  Compressor: status, capacity, Runtime total, plus VSD 1 speed ONLY where the
  machine has a VSD. On TEMPLATE-10229 only C1 has one, so cloning C1 to build a
  C4 imports a VSD row the machine does not have. Clone C3. Measured horizontal
  pitch is 79 to 82 px with 1 px vertical drift; reuse a pitch from a named pair
  and say which, never average them into a constant.
  Suction group, eight required readouts per suffix MT and LT: Control status,
  Running capacity, Requested cap., Suction temp. To-, Suction ref. To-,
  Superheat, Ss-, Sd-.
  Heat recovery: pump, speed, LED, four Shr sensors, two setpoints, enable strip.
  Right-hand status column at x about 1170: u17 Ther Air y58, DI1 alarm y86,
  Control status MT y210, Control status LT y238, Cond. control status y267,
  Hr enable y325.

10 MT TO LT IS NOT ONE PANEL VECTOR. Only the compressor columns translate, by
   about 0 plus 325. The suction readouts each move differently: Sd by 369,313
   and Ss by minus 71,324. Applying a compressor vector panel-wide moves seven
   readouts onto empty artwork.

11 EVERY PILL LANDS ON A DRAWN PILL. A pill floating on white artwork, half on
   its drawn pill, or sharing one drawn pill with another object is a defect. Two
   adjacent pills are correct only where the artwork drew two, as on the MT
   suction row. No validator can check this. Only a render can.

12 ALIAS IS THE LINK KEY. On Maskin alias_text IS the Danfoss parameter name, and
   a production panel resolved 64 of 64 objects by exact string match. Take names
   from maskin-akpc-link-map.json. Never rename an alias to make it prettier and
   never strip it during sanitization: a renamed or missing alias is an
   unlinkable object.

13 A NEW DEMO IS UNLINKED. id and driver_id are the literal string driver_id,
   linked is false, and link_name, link_tag, sub_group, unit_id, unit_ref,
   source_plant_id, plant_id and saved_by are empty. A production export never
   emits the literal driver_id: its unlinked objects carry an EMPTY driver_id
   instead, and the host then marks them linked true, which is host behaviour and
   not a defect. Object count is not a quality target; role coverage is.

14 PRESERVE PRODUCTION, INCLUDING ITS ANOMALIES. On TEMPLATE-10229: three objects
   carry tag_text of a single space, two are linked true with an empty driver_id,
   and Suction temp. To-MT appears twice on the two adjacent pills the artwork
   labels To and To offset, sharing one driver id, where the LT row binds its
   second pill to To opt. offset LT. Report these. Do not silently tidy them.
   Any corrective is advisory and needs the plant's own parameter dump.

15 TEXT IS UTF-8. Keep the degree sign, the cubic-metre sign and the Norwegian
   letters. Write the real symbols, never gr C or m3. If a transport mangles it,
   fix the transport, never degrade the panel text.

16 VERIFY IN ORDER. a Re-parse the emitted JSON from disk. b Run
   validate-maskin-panel.py PANEL.json --profile TEMPLATE-10229, dropping the
   profile only when none applies and saying so; zero errors is the bar, and
   warnings are read, not ignored. c Render at native 1400 x 750 with the REAL
   background and the dynamic-object overlay, then inspect the full panel plus
   one crop per role: MT bank, LT bank, MT suction, LT suction, heat recovery,
   receiver, gas cooler, alarm and IO. Move the pointer away first, because a
   hover tooltip is not panel content. d Compare by role key, obj_id plus
   alias_text plus tag_text, NEVER by array index; two exports of one panel order
   their objects differently. e Run validate-visual-correctness.py PANEL.json
   (--source when a production export was supplied): no live object may cover
   descriptive text, and state values fit their longest allowed display value,
   never the current reading (VISUAL-CORRECTNESS-CONTRACT.md, GLOBAL). f On a
   visual failure RESTART from the retained source export or the sanitized
   fixture rather than patching a chain of compensating edits.

17 INSERT APPENDS. It never clears the canvas, and the host renames every object
   from the live canvas child index. A full panel document belongs on an EMPTY
   canvas unless duplication is intended. Say this when delivering one.

18 REPORT the class, the precedence rank, the profile, every role you moved,
   added or removed with its vector or reason, which pitch you reused and from
   which pair, the exact validator command and output, the crops you inspected,
   and everything you could not verify. A stated gap is a valid deliverable and a
   guess is not. Passing validation is not evidence the panel is correct: the
   validator cannot see the drawing.

19 EXTENDING A COMPRESSOR BANK IS AN ORDERED PROCEDURE, and the order is the
   rule: adding a compressor is class 3 and class 4 at once, one full document
   plus one background-only patch. a Retain the original source background
   untouched; every retry starts from it, never from the damaged derivative,
   because repeated edits to a derivative accumulate raster damage nobody can
   attribute afterwards. b Measure the column you are actually copying, the
   nearest role match, not C1. c Measure the discharge and the suction header
   SEPARATELY: they legitimately differ in thickness on the same panel, so each
   stays source-driven and neither number is reused for the other. d Fix ONE
   translation vector from a NAMED pair and apply that same vector to the
   compressor symbol, the upper discharge branch, the lower suction branch, the
   status artwork, the static labels, the empty pills AND the dynamic objects;
   a second vector anywhere is the defect. e EXTEND THE ARTWORK FIRST, before
   any object exists. f Copy every source pixel's alpha VERBATIM and never
   multiply it: a mask is BINARY. A soft, feathered or opacity-scaled mask
   fades the whole clone together, and that uniformity is the tell. Reproduce
   every row the source has, including partially transparent antialiasing rows,
   or the copy comes out thinner and harder-edged. g Connect the new branches
   continuously to the existing headers, then look at the BACKGROUND ALONE at
   native size: a gap is invisible under the objects that will cover it.
   h Place the objects last. On ANY visual failure go back to a, not to e.

20 AN OBJECT ALWAYS CARRIES AN ALIAS. An unknown plant parameter is never a
   reason for alias_text "": the alias is the relink key, so an object without
   one can never be linked by anyone, ever. Give it the role's alias in the
   grammar C n MT or LT role, emit it unlinked, and REPORT the gap as
   unresolved. maskin-akpc-link-map.json covers C1 to C3 only; a fourth
   compressor's Danfoss parameters are NOT in it. The group anatomy suggests
   the continuation, and suggesting is not evidence: leave it open until that
   plant's own parameter dump is supplied.

## Envelope shape

Kept as JSON because the nested envelope shape itself is normative.

```json
{
  "format": "iwmac-designer-panel",
  "version": 1,
  "generator": "your-agent-name",
  "source_plant_id": "PLANT_ID_OR_EMPTY",
  "panel_name": "PanelName",
  "panel_width": "1400px",
  "panel_height": "750px",
  "counts": { "single_objects": N, "containers": 0, "graphics": 0 },
  "background_embedded": false,
  "panel": {
    "plant_id": "PLANT_ID_OR_EMPTY",
    "panel_name": "PanelName",
    "panel_width": "1400px",
    "panel_height": "750px",
    "org_image_name": "",
    "image_name": "",
    "saved_by": "copilot",
    "single_objects": [ OBJECT, OBJECT, ... ],
    "containers": [],
    "graphics": []
  }
}
```

## The 17-field object template

Kept as JSON because this is the literal object shape to copy.

```json
{
  "obj_id": "number_v3_value_only",
  "name": "object_0",
  "id": "driver_id",
  "posWidth": 50, "posHeight": 20, "posLeft": 100, "posTop": 100,
  "zIndex": "default",
  "tag_text": "",
  "linked": "false",
  "link_name": "", "link_tag": "", "sub_group": "",
  "driver_id": "driver_id",
  "unit_id": "", "unit_ref": "",
  "alias_text": "Po MT suction pressure"
}
```

## Maskin identity, canvas, composition, background, and z bands

### Identity

- **identity**
  - **name** — Maskin / machine room
  - **owner_document** — MASKIN-GENERATION-CONTRACT.md
  - **description** — The machine-room overview of a CO2 booster refrigeration pack: MT and LT compressor banks, gas cooler / condenser, receiver, high-pressure and receiver valves, optional heat recovery, and a right-hand status strip.
  - **controller**
    - **family** — Danfoss AK-PC pack controller
    - **measured_on_E9** — AK-PC 782A (V3_akpc_782A_suct suction strips, V3_akpc_783_781A_782A_cond condenser strip)
    - **note** — The six compressor status strips on E9 use V3_akpc_772_781_781A_783_contr. Recorded as measured; do not infer a controller model from a strip id.
  - **linking** — alias_text IS the Danfoss parameter name. Relink by EXACT alias match - never fuzzy, never positional. See evidence E12.

### Owner document

- **owner_document** — MASKIN-GENERATION-CONTRACT.md

### Canvas

- **canvas**
  - **width** — 1400
  - **height** — 750
  - **scope** — MASKIN
  - **evidence**
    - E9
    - E10
  - **override** — Match the plant if a supplied export says otherwise.

### Composition

- **composition**
  - **single_objects** — 66
  - **containers** — 0
  - **graphics** — 0
  - **distinct_obj_ids** — 11
  - **scope** — TEMPLATE-10229
  - **evidence**
    - E9
    - E10
  - **note** — Fleet median is 59 objects across 39 Maskin panels (PANEL-TYPE-GUIDE.md). 66 is this template, not a target.

### Background

- **background**
  - **ownership** — The background owns ALL artwork: enclosure, pipes, equipment symbols, valves, static labels, the empty value pills and the grey information panel. Dynamic objects own live values, status strips, LEDs and pumps, and nothing else.
  - **never** — Never bake a live number, state or colour into the background, and never draw a value box in artwork that a dynamic object will also render.
  - **family** — Advansor-style CO2 booster drawing. reference_data/maskin-drawing-method.txt is the artwork doctrine; reference_data/maskin-light-style-reference.png is the one rendered reference that ships with the kit, and it is a light template.
  - **colour** — Background colour is not fixed by this contract. Preserve the background of a supplied production export unless the user explicitly asks for a background change; for newly authored artwork the colour follows the user's requirement or the production reference chosen for the job. A dark background is not a defect on colour grounds alone. Background ownership, object alignment, the functional circuit colours, the empty pills, the z bands and QA stage C apply at any background colour.
  - **fields**
    - **converted** — "true" plus panel.image_data (a data: URI) is how a raster background travels in an export
    - **image_svg** — AI-authored vector background. Validated by iwdieValidateSvg and converted by iwdieSvgToDataUrl on insert.
    - **image_svg_trace** — WRITTEN BY EXPORT, NEVER BY A GENERATOR. It is an automatic vector trace of the raster background, supplied to an AI as input, and the insert path deletes it. Emitting it is a defect.
    - **priority_on_insert**
      - a background file picked in the dialog
      - panel.image_svg
      - panel.image_data

### Z indexes

- **z_indexes**
  - **mode** — explicit bands OR the literal string "default" - never mixed in one panel
  - **bands**
    - **110**
      - **count_E10** — 2
      - **obj_ids**
        - number_v3_60px_no_conn
        - number_v3_custom_json_obj
    - **360**
      - **count_E10** — 9
      - **obj_ids**
        - V3_akpc_772_781_781A_783_contr
        - V3_akpc_782A_suct
        - V3_akpc_783_781A_782A_cond
    - **375**
      - **count_E10** — 3
      - **obj_ids**
        - V3_21px_single_pump_grey_green_down
        - V3_led_13px_circ_grey_green
        - V3_ok_alarm_nrm
    - **1000**
      - **count_E10** — 1
      - **obj_ids**
        - V3_81x21_enebled_disabled_nrm
    - **1100**
      - **count_E10** — 51
      - **obj_ids**
        - number_v3_value_only
        - number_v3_white_value_only
  - **scope** — MASKIN
  - **evidence**
    - E9
    - E10
  - **conflict** — These are NOT the Ventilasjon bands. On a vent panel 110 is value/setpoint boxes and 1100 is labels; on Maskin E9, 1100 is the value pills and 110 is the two json/no-conn boxes. The bands are per panel type. Never carry a vent band onto a Maskin panel.
  - **default_mode_note** — "default" is legal - the userscript fills it in when zIndex is missing - but then array order IS stacking order. E9 uses explicit bands, so on E9 array order does not affect stacking.

## TEMPLATE-10229 profile metadata

- **title** — Plant-10229 AK-PC 782A CO2 booster machine room
- **scope** — TEMPLATE-10229
- **evidence**
  - E9
  - E10
- **derived_from** — reference_data/maskin-10229-sanitized.json, generated by build-maskin-rules.py
- **panel_type** — maskin
- **canvas**
  - 1400
  - 750
- **object_count** — 66
- **distinct_obj_ids** — 11
- **background**
  - **converted** — true
  - **image_data_chars** — 123966
  - **image_svg** — false
  - **note** — The raster background travels with the fixture. It is the artwork every coordinate below was measured against; rendering the objects without it proves nothing.
- **applies_when** — The task supplies this template, names TEMPLATE-10229, or asks for a copy of the 10229 machine room. It does NOT apply to an arbitrary Maskin panel.

## Object vocabulary

- **object_vocabulary** — one row per source entry below.

| obj_id | count_E10 | sizes | z_bands |
|---|---|---|---|
| number_v3_value_only | 44 | ["50x20"] | ["1100"] |
| number_v3_white_value_only | 7 | ["50x20"] | ["1100"] |
| V3_akpc_772_781_781A_783_contr | 6 | ["81x21"] | ["360"] |
| V3_akpc_782A_suct | 2 | ["81x21"] | ["360"] |
| V3_ok_alarm_nrm | 1 | ["61x21"] | ["375"] |
| V3_81x21_enebled_disabled_nrm | 1 | ["81x21"] | ["1000"] |
| V3_led_13px_circ_grey_green | 1 | ["13x13"] | ["375"] |
| V3_akpc_783_781A_782A_cond | 1 | ["81x21"] | ["360"] |
| number_v3_custom_json_obj | 1 | ["40x20"] | ["110"] |
| number_v3_60px_no_conn | 1 | ["62x22"] | ["110"] |
| V3_21px_single_pump_grey_green_down | 1 | ["21x21"] | ["375"] |

## Role inventory with TEMPLATE-10229 coordinates

- **roles** — one section per source role cluster below.
- **profiles.TEMPLATE-10229.objects** — one table row per profile object below.

### MT compressor column

- **count_E10** — 10
- **aliases** — one row per source entry in the table below.

| name | obj_id | alias_text | tag_text | left | top | width | height | zIndex |
|---|---|---|---|---|---|---|---|---|
| object_7 | V3_akpc_772_781_781A_783_contr | C2 MT status | "" | 152 | 288 | 81 | 21 | 360 |
| object_8 | V3_akpc_772_781_781A_783_contr | C1 MT status | "" | 73 | 289 | 81 | 21 | 360 |
| object_56 | V3_akpc_772_781_781A_783_contr | C3 MT status | "" | 234 | 289 | 81 | 21 | 360 |
| object_46 | number_v3_value_only | C2 MT capacity | "" | 167 | 325 | 50 | 20 | 1100 |
| object_22 | number_v3_value_only | C1 MT capacity | "" | 86 | 326 | 50 | 20 | 1100 |
| object_54 | number_v3_value_only | C3 MT capacity | "" | 246 | 326 | 50 | 20 | 1100 |
| object_35 | number_v3_value_only | C1 MT Runtime total | "" | 86 | 362 | 50 | 20 | 1100 |
| object_47 | number_v3_value_only | C2 MT Runtime total | "" | 167 | 362 | 50 | 20 | 1100 |
| object_55 | number_v3_value_only | C3 MT Runtime total | "" | 247 | 362 | 50 | 20 | 1100 |
| object_50 | number_v3_value_only | C1 MT VSD 1 speed | "" | 87 | 403 | 50 | 20 | 1100 |

### LT compressor column

- **count_E10** — 10
- **aliases** — one row per source entry in the table below.

| name | obj_id | alias_text | tag_text | left | top | width | height | zIndex |
|---|---|---|---|---|---|---|---|---|
| object_6 | V3_akpc_772_781_781A_783_contr | C1 LT status | "" | 72 | 614 | 81 | 21 | 360 |
| object_60 | V3_akpc_772_781_781A_783_contr | C2 LT status | "" | 152 | 614 | 81 | 21 | 360 |
| object_63 | V3_akpc_772_781_781A_783_contr | C3 LT status | "" | 232 | 615 | 81 | 21 | 360 |
| object_23 | number_v3_value_only | C1 LT capacity | "" | 87 | 651 | 50 | 20 | 1100 |
| object_61 | number_v3_value_only | C2 LT capacity | "" | 167 | 651 | 50 | 20 | 1100 |
| object_64 | number_v3_value_only | C3 LT capacity | "" | 246 | 651 | 50 | 20 | 1100 |
| object_34 | number_v3_value_only | C1 LT Runtime total | "" | 87 | 687 | 50 | 20 | 1100 |
| object_62 | number_v3_value_only | C2 LT Runtime total | "" | 167 | 687 | 50 | 20 | 1100 |
| object_65 | number_v3_value_only | C3 LT Runtime total | "" | 246 | 687 | 50 | 20 | 1100 |
| object_51 | number_v3_value_only | C1 LT VSD 1 speed | "" | 87 | 722 | 50 | 20 | 1100 |

### MT suction group

- **count_E10** — 9
- **aliases** — one row per source entry in the table below.

| name | obj_id | alias_text | tag_text | left | top | width | height | zIndex |
|---|---|---|---|---|---|---|---|---|
| object_3 | number_v3_value_only | Sd-MT | "" | 55 | 191 | 50 | 20 | 1100 |
| object_42 | V3_akpc_782A_suct | Control status MT | "" | 1171 | 210 | 81 | 21 | 360 |
| object_17 | number_v3_white_value_only | Suction ref. To-MT | "" | 580 | 233 | 50 | 20 | 1100 |
| object_1 | number_v3_value_only | Suction temp. To-MT | "" | 581 | 257 | 50 | 20 | 1100 |
| object_59 | number_v3_value_only | Suction temp. To-MT | "" | 626 | 257 | 50 | 20 | 1100 |
| object_0 | number_v3_value_only | Superheat MT | "" | 588 | 298 | 50 | 20 | 1100 |
| object_18 | number_v3_value_only | Ss-MT | "" | 589 | 325 | 50 | 20 | 1100 |
| object_26 | number_v3_value_only | Running capacity MT | "" | 15 | 326 | 50 | 20 | 1100 |
| object_25 | number_v3_value_only | Requested cap. MT | "" | 15 | 361 | 50 | 20 | 1100 |

### LT suction group

- **count_E10** — 9
- **aliases** — one row per source entry in the table below.

| name | obj_id | alias_text | tag_text | left | top | width | height | zIndex |
|---|---|---|---|---|---|---|---|---|
| object_41 | V3_akpc_782A_suct | Control status LT | "" | 1171 | 238 | 81 | 21 | 360 |
| object_45 | number_v3_value_only | Sd-LT | "" | 424 | 504 | 50 | 20 | 1100 |
| object_16 | number_v3_white_value_only | Suction ref. To-LT | "" | 511 | 557 | 50 | 20 | 1100 |
| object_5 | number_v3_value_only | Suction temp. To-LT | "" | 511 | 582 | 50 | 20 | 1100 |
| object_57 | number_v3_value_only | To opt. offset LT | "" | 557 | 582 | 50 | 20 | 1100 |
| object_4 | number_v3_value_only | Superheat LT | "" | 519 | 623 | 50 | 20 | 1100 |
| object_19 | number_v3_value_only | Ss-LT | "" | 518 | 649 | 50 | 20 | 1100 |
| object_28 | number_v3_value_only | Running capacity LT | "" | 16 | 651 | 50 | 20 | 1100 |
| object_27 | number_v3_value_only | Requested cap. LT | "" | 16 | 687 | 50 | 20 | 1100 |

### Heat recovery

- **count_E10** — 10
- **aliases** — one row per source entry in the table below.

| name | obj_id | alias_text | tag_text | left | top | width | height | zIndex |
|---|---|---|---|---|---|---|---|---|
| object_53 | V3_21px_single_pump_grey_green_down | Hr pump running |   | 560 | 21 | 21 | 21 | 375 |
| object_48 | number_v3_custom_json_obj | Hr pump speed |   | 583 | 21 | 40 | 20 | 110 |
| object_32 | number_v3_white_value_only | Hr reference | "" | 428 | 22 | 50 | 20 | 1100 |
| object_33 | number_v3_white_value_only | HR Consumer request | "" | 367 | 23 | 50 | 20 | 1100 |
| object_52 | number_v3_value_only | Shr8 | "" | 430 | 59 | 50 | 20 | 1100 |
| object_29 | number_v3_value_only | Shr4 | "" | 474 | 59 | 50 | 20 | 1100 |
| object_30 | number_v3_value_only | Shr3 | "" | 578 | 59 | 50 | 20 | 1100 |
| object_31 | number_v3_value_only | Shr2 | "" | 644 | 70 | 50 | 20 | 1100 |
| object_40 | V3_led_13px_circ_grey_green | V3hr | "" | 596 | 85 | 13 | 13 | 375 |
| object_39 | V3_81x21_enebled_disabled_nrm | Hr enable | "" | 1169 | 325 | 81 | 21 | 1000 |

### Receiver

- **count_E10** — 3
- **aliases** — one row per source entry in the table below.

| name | obj_id | alias_text | tag_text | left | top | width | height | zIndex |
|---|---|---|---|---|---|---|---|---|
| object_14 | number_v3_white_value_only | Prec reference | "" | 814 | 373 | 50 | 20 | 1100 |
| object_13 | number_v3_value_only | Prec | "" | 814 | 398 | 50 | 20 | 1100 |
| object_9 | number_v3_value_only | Vrec OD | "" | 761 | 479 | 50 | 20 | 1100 |

### High pressure / gas cooler

- **count_E10** — 13
- **aliases** — one row per source entry in the table below.

| name | obj_id | alias_text | tag_text | left | top | width | height | zIndex |
|---|---|---|---|---|---|---|---|---|
| object_38 | number_v3_white_value_only | Cond. ctrl. | "" | 1017 | 46 | 50 | 20 | 1100 |
| object_36 | number_v3_value_only | Sc3 | "" | 840 | 47 | 50 | 20 | 1100 |
| object_20 | number_v3_value_only | Cond. capacity | "" | 904 | 47 | 50 | 20 | 1100 |
| object_37 | number_v3_value_only | Cond. requested cap. | "" | 969 | 47 | 50 | 20 | 1100 |
| object_2 | number_v3_value_only | Pc | "" | 56 | 72 | 50 | 20 | 1100 |
| object_21 | number_v3_value_only | Sgc | "" | 1017 | 72 | 50 | 20 | 1100 |
| object_44 | number_v3_value_only | Tc | "" | 54 | 103 | 50 | 20 | 1100 |
| object_58 | number_v3_value_only | V3gc | "" | 1065 | 156 | 50 | 20 | 1100 |
| object_43 | V3_akpc_783_781A_782A_cond | Cond. control status | "" | 1170 | 267 | 81 | 21 | 360 |
| object_12 | number_v3_value_only | Shp | "" | 1058 | 345 | 50 | 20 | 1100 |
| object_15 | number_v3_white_value_only | Pgc reference | "" | 1058 | 381 | 50 | 20 | 1100 |
| object_11 | number_v3_value_only | Pgc | "" | 1057 | 406 | 50 | 20 | 1100 |
| object_10 | number_v3_value_only | Vhp OD | "" | 938 | 412 | 50 | 20 | 1100 |

### Alarm / IO

- **count_E10** — 2
- **aliases** — one row per source entry in the table below.

| name | obj_id | alias_text | tag_text | left | top | width | height | zIndex |
|---|---|---|---|---|---|---|---|---|
| object_49 | number_v3_60px_no_conn | u17 Ther Air |   | 1169 | 58 | 62 | 22 | 110 |
| object_24 | V3_ok_alarm_nrm | --- DI1 Alarm | "" | 1169 | 86 | 61 | 21 | 375 |

## Required and absent roles

### Required roles

- **required_roles**
  - **rule** — A Maskin panel that claims a suction group must carry that group's readouts, and a compressor that exists must carry status, capacity and runtime.
  - **per_suction_group**
    - Control status
    - Running capacity
    - Requested cap.
    - Suction temp. To-
    - Suction ref. To-
    - Superheat
    - Ss-
    - Sd-
  - **per_compressor**
    - status
    - capacity
    - Runtime total
  - **per_compressor_optional**
    - VSD 1 speed
  - **scope** — TEMPLATE-10229
  - **evidence**
    - E9
    - E10

### Absent by design

- **absent_by_design**
  - **roles**
    - C2 MT VSD 1 speed
    - C3 MT VSD 1 speed
    - C2 LT VSD 1 speed
    - C3 LT VSD 1 speed
  - **why** — On E9 only C1 carries a VSD row, on each suction group. C2 and C3 are fixed-speed: status, capacity and runtime only. Cloning C1 to make a C4 imports a VSD row the machine does not have.
- **profiles.TEMPLATE-10229.absent_by_design** — the same source values above.

## Compressor columns and MT-to-LT translations

### Compressor columns

- **compressor_columns.measured** — one table per suction level below.
- **profiles.TEMPLATE-10229.compressor_columns** — the same measured tables below.
- **scope** — TEMPLATE-10229
- **evidence** — ["E9", "E10"]
- **rule** — A compressor column is an atomic cluster: status strip, capacity pill, runtime pill, and a VSD pill only where the machine has one. Clone the whole column with ONE translation vector; never copy the status strip alone.
- **pitch_note** — Measured centre pitch is 79-82 px in x with a 0-1 px y jitter that is in the source. Do not average it to a round number and do not 'correct' the jitter when reproducing this template.

#### MT

- **cells** — one row per measured cell; **pitch** — status: [79, -1]<br>[82, 1]<br>capacity: [81, -1]<br>[79, 1]<br>runtime: [81, 0]<br>[80, 0]<br>vsd: []

| role | compressor | obj_id | left | top | zIndex |
|---|---|---|---|---|---|
| status | 1 | V3_akpc_772_781_781A_783_contr | 73 | 289 | 360 |
| status | 2 | V3_akpc_772_781_781A_783_contr | 152 | 288 | 360 |
| status | 3 | V3_akpc_772_781_781A_783_contr | 234 | 289 | 360 |
| capacity | 1 | number_v3_value_only | 86 | 326 | 1100 |
| capacity | 2 | number_v3_value_only | 167 | 325 | 1100 |
| capacity | 3 | number_v3_value_only | 246 | 326 | 1100 |
| runtime | 1 | number_v3_value_only | 86 | 362 | 1100 |
| runtime | 2 | number_v3_value_only | 167 | 362 | 1100 |
| runtime | 3 | number_v3_value_only | 247 | 362 | 1100 |
| vsd | 1 | number_v3_value_only | 87 | 403 | 1100 |

#### LT

- **cells** — one row per measured cell; **pitch** — status: [80, 0]<br>[80, 1]<br>capacity: [80, 0]<br>[79, 0]<br>runtime: [80, 0]<br>[79, 0]<br>vsd: []

| role | compressor | obj_id | left | top | zIndex |
|---|---|---|---|---|---|
| status | 1 | V3_akpc_772_781_781A_783_contr | 72 | 614 | 360 |
| status | 2 | V3_akpc_772_781_781A_783_contr | 152 | 614 | 360 |
| status | 3 | V3_akpc_772_781_781A_783_contr | 232 | 615 | 360 |
| capacity | 1 | number_v3_value_only | 87 | 651 | 1100 |
| capacity | 2 | number_v3_value_only | 167 | 651 | 1100 |
| capacity | 3 | number_v3_value_only | 246 | 651 | 1100 |
| runtime | 1 | number_v3_value_only | 87 | 687 | 1100 |
| runtime | 2 | number_v3_value_only | 167 | 687 | 1100 |
| runtime | 3 | number_v3_value_only | 246 | 687 | 1100 |
| vsd | 1 | number_v3_value_only | 87 | 722 | 1100 |


### MT-to-LT role translations

- **role_translations_mt_to_lt**
- **measured** — one row per source role below.
- **profiles.TEMPLATE-10229.role_translations_mt_to_lt** — the same measured rows below.
- **scope** — TEMPLATE-10229
- **evidence**
  - E9
  - E10

| role | to | MT coordinate | LT coordinate | delta |
|---|---|---|---|---|
| C1 MT Runtime total | C1 LT Runtime total | (86, 362) | (87, 687) | (1, 325) |
| C1 MT VSD 1 speed | C1 LT VSD 1 speed | (87, 403) | (87, 722) | (0, 319) |
| C1 MT capacity | C1 LT capacity | (86, 326) | (87, 651) | (1, 325) |
| C1 MT status | C1 LT status | (73, 289) | (72, 614) | (-1, 325) |
| C2 MT Runtime total | C2 LT Runtime total | (167, 362) | (167, 687) | (0, 325) |
| C2 MT capacity | C2 LT capacity | (167, 325) | (167, 651) | (0, 326) |
| C2 MT status | C2 LT status | (152, 288) | (152, 614) | (0, 326) |
| C3 MT Runtime total | C3 LT Runtime total | (247, 362) | (246, 687) | (-1, 325) |
| C3 MT capacity | C3 LT capacity | (246, 326) | (246, 651) | (0, 325) |
| C3 MT status | C3 LT status | (234, 289) | (232, 615) | (-2, 326) |
| Control status MT | Control status LT | (1171, 210) | (1171, 238) | (0, 28) |
| Requested cap. MT | Requested cap. LT | (15, 361) | (16, 687) | (1, 326) |
| Running capacity MT | Running capacity LT | (15, 326) | (16, 651) | (1, 325) |
| Sd-MT | Sd-LT | (55, 191) | (424, 504) | (369, 313) |
| Ss-MT | Ss-LT | (589, 325) | (518, 649) | (-71, 324) |
| Suction ref. To-MT | Suction ref. To-LT | (580, 233) | (511, 557) | (-69, 324) |
| Superheat MT | Superheat LT | (588, 298) | (519, 623) | (-69, 325) |

- **note** — The compressor rows translate by about (0,+325). The suction-group readouts do NOT share one vector - Sd, Ss, Superheat and the suction references each move differently because the LT circuit is drawn elsewhere on the artwork. There is no single MT-&gt;LT vector for the panel.

## Setpoint pill

- **setpoint_pill**
  - **rule** — number_v3_white_value_only is the setpoint / reference pill; number_v3_value_only is the measurement pill.
  - **alias_markers**
    - reference
    - ref.
    - consumer request
    - ctrl.
  - **evidence**
    - E9
    - E10
  - **measured** — 7 of 7 white pills carry a marker; 0 of 59 measurement pills do. 'Requested cap. MT/LT' and 'Cond. requested cap.' are measurements despite the word 'requested' - which is why the marker is 'consumer request', not 'request'.
  - **severity** — warning
  - **scope** — MASKIN

## Recorded anomalies

- **anomalies** — one row per recorded anomaly below.
- **profiles.TEMPLATE-10229.anomalies** — the same rows below.

| object | alias | finding | treatment |
|---|---|---|---|
| object_48 | Hr pump speed | tag_text is ' ' (a single space), not empty | preserved verbatim in E10; do not normalise it away when copying this template |
| object_49 | u17 Ther Air | tag_text is ' ' (a single space), not empty | preserved verbatim in E10; do not normalise it away when copying this template |
| object_53 | Hr pump running | tag_text is ' ' (a single space), not empty | preserved verbatim in E10; do not normalise it away when copying this template |
| ["object_1", "object_59"] | Suction temp. To-MT | 2 objects share this alias at (581,257) and (626,257), and in E9 they shared one driver id | preserved in E10 and reported as a WARNING by the validator. Whether it is intentional is open evidence - do not silently delete one. |

## Request, sanitization, binding, and insert contracts

### Request classes

- **request_classes**
  - **new_unlinked_demo**
    - **output** — a full panel document with the unlinked-demo contract on every object
    - **background** — author image_svg, or state that the background is supplied separately
    - **insert** — empty canvas only - Insert JSON appends
  - **linked_copy**
    - **output** — a full panel document keeping every supplied binding, with the driver-id plant prefix rewritten to the target plant
    - **background** — carry panel.image_data through unchanged
    - **insert** — empty canvas only
    - **never** — Never invent a driver id, unit id or plant id. If the target plant's prefix was not supplied, stop and ask.
  - **modify_supplied_export**
    - **output** — the ENTIRE supplied document, with only the requested objects changed or appended
    - **rule** — The supplied panel is the whole geometric template. Every untouched object keeps every field byte-for-byte.
    - **insert** — empty canvas only - inserting a full document onto a populated canvas duplicates every object
  - **background_only_patch**
    - **output** — panel.image_data (or image_svg) changed; counts all zero; single_objects, containers and graphics all empty
    - **rule** — This is the correct answer whenever the target canvas already carries its objects and only the artwork changes.

### Sanitization

- **sanitization**
  - **replace**
    - **envelope.source_plant_id** — ""
    - **panel.plant_id** — ""
    - **panel.saved_by** — ""
    - **panel.org_image_name** — ""
    - **panel.image_name** — ""
    - **object.id** — driver_id
    - **object.driver_id** — driver_id
    - **object.linked** — false
    - **object.link_name** — ""
    - **object.link_tag** — ""
    - **object.unit_id** — ""
    - **object.unit_ref** — ""
    - **object.sub_group** — ""
  - **preserve**
    - obj_id
    - name
    - posLeft
    - posTop
    - posWidth
    - posHeight
    - zIndex
    - tag_text
    - alias_text
    - array order
    - panel.image_data
    - panel.converted
    - panel.panel_width
    - panel.panel_height
  - **drop**
    - panel.image_svg_trace
  - **why_alias_survives** — alias_text is the selector a human relinks by (evidence E12). Stripping it makes the fixture unrelinkable and destroys the role inventory.
  - **generator** — build-maskin-fixture.py

### Bindings

- **bindings**
  - **production_export**
    - **id** — driver_id (host literal on every object)
    - **link_name** — link_name (host literal on every object)
    - **driver_id** — &lt;plant&gt;_&lt;controller path&gt;_&lt;parameter&gt;_&lt;index&gt;, or empty on an object the designer never linked
    - **linked** — "true" whenever driver_id is not the literal placeholder - INCLUDING when driver_id is empty. That is host behaviour (V3scripts.js), not a defect.
    - **unit_id** — the AK-PC unit address, identical across the pack
  - **demo** — global_invariants.unlinked_demo_contract, unchanged.
  - **mode_discriminator** — The literal string "driver_id" in driver_id. A generated demo emits it on every object; a production export never does - an unlinked production object carries an EMPTY driver_id.

### Insert semantics

- **insert_semantics** — Insert JSON APPENDS to the live canvas - it never clears it, and it renames every inserted object from the canvas child index. A full panel document belongs on an EMPTY canvas unless duplication is intended.

## Alias-to-Danfoss parameter map

- **_note** — THE CANONICAL MASKIN LINK MAP - built by cross-referencing a fully linked production Maskin panel (64 objects, CO2 booster rack on a Danfoss AK-PC 782A pack controller, plant masked NNNNN) against the same plant's iw_gen_driver_parameters dump: every driver_id resolved, and the panel's alias_text matched the dump row's alias_text VERBATIM in 64 of 64 cases. RULE: on machine pictures the object alias IS the Danfoss parameter name - relink by EXACT alias match, never fuzzy. Use with briefing section 8b.

### relink_recipe

1. Find the pack unit in the dump: unit_name like 'AK-PC782AB-041x 11' (or the unit holding Pc/Pgc/Prec/Running capacity rows). On the reference panel 62/64 objects link to that one unit; the leftovers (room sensor 'u17 Ther Air', gateway 'DI1 Alarm') live on an IO/gateway unit.
2. Per object: EXACT-match the object's alias_text against the dump's alias_text, preferring rows of the pack unit. Duplicated panel objects (same alias twice) take the same row.
3. Write the row's driver_id and unit_id verbatim; linked stays/becomes "true"; alias_text already matches so leave it; id stays literally "driver_id"; link_name/link_tag/positions untouched.
4. Return the COMPLETE updated panel json (same envelope, only the link fields changed). List every alias you could not find - leave those objects unlinked rather than guessing.
5. Cross-plant: unit numbers differ between plants (the id tail is plant-specific), so NEVER reuse ids from another plant - the alias names are the portable part. Insert's prefix rebind only fixes the plant number, not the unit; a dump relink is the correct way to move a Maskin picture.

- **driver_id_anatomy** — NNNNN_AK3_&lt;unit-tail&gt;_&lt;group&gt;_&lt;param&gt;. The last two numbers are the parameter group + parameter. Groups observed on the AK-PC 782A: 206-228 suction/superheat temps, 207/211-213/219-220 Tc/Sd/Sc3/Ss, 260/285 condenser control, 288-299 compressor runtimes, 330-346 Sgc/Shp/Pc/Pgc/Prec/V3gc, 338 gas-cooler valve refs, 354/358 heat recovery, 374 Hr enable, 521 liquid injection, 531 references/offsets, 763 = MT pack block, 764 = LT pack block, 765 = receiver block, 0 = IO/alarms. Compressor params inside 763/764: 230+i = Ci status, 240+i = Ci capacity, 337 = VSD speed.

### canonical_signals

- **_comment** — alias (= dump alias, verbatim) : [obj_id used on the panel, param tail on the reference plant]

| alias | obj_id | parameter tail |
|---|---|---|
| Pc | number_v3_value_only | 336_7 |
| Tc | number_v3_value_only | 207_7 |
| Sgc | number_v3_value_only | 330_3 |
| Shp | number_v3_value_only | 333_13 |
| Pgc | number_v3_value_only | 336_10 |
| Pgc reference | number_v3_white_value_only | 338_33 |
| Vhp OD | number_v3_value_only | 338_27 |
| V3gc | number_v3_value_only | 343_10 |
| Prec | number_v3_value_only | 346_25 |
| Prec reference | number_v3_white_value_only | 531_248 |
| Vrec OD | number_v3_value_only | 765_393 |
| Sd-MT | number_v3_value_only | 211_13 |
| Ss-MT | number_v3_value_only | 213_13 |
| Sc3 | number_v3_value_only | 212_13 |
| Suction temp. To-MT | number_v3_value_only | 206_7 |
| Suction ref. To-MT | number_v3_white_value_only | 531_132 |
| Superheat MT | number_v3_value_only | 224_14 |
| Running capacity MT | number_v3_value_only | 763_22 |
| Requested cap. MT | number_v3_value_only | 763_21 |
| Control status MT | V3_akpc_782A_suct | 763_6 |
| C1 MT status | V3_akpc_772_781_781A_783_contr | 763_230 |
| C2 MT status | V3_akpc_772_781_781A_783_contr | 763_231 |
| C3 MT status | V3_akpc_772_781_781A_783_contr | 763_232 |
| C1 MT capacity | number_v3_value_only | 763_240 |
| C2 MT capacity | number_v3_value_only | 763_241 |
| C3 MT capacity | number_v3_value_only | 763_242 |
| C1 MT Runtime total | number_v3_value_only | 288_24 |
| C2 MT Runtime total | number_v3_value_only | 289_24 |
| C3 MT Runtime total | number_v3_value_only | 290_24 |
| C1 MT VSD 1 speed | number_v3_value_only | 763_337 |
| Sd-LT | number_v3_value_only | 219_13 |
| Ss-LT | number_v3_value_only | 220_13 |
| Suction temp. To-LT | number_v3_value_only | 209_7 |
| Suction ref. To-LT | number_v3_white_value_only | 531_181 |
| To opt. offset LT | number_v3_value_only | 531_174 |
| Superheat LT | number_v3_value_only | 228_14 |
| Running capacity LT | number_v3_value_only | 764_22 |
| Requested cap. LT | number_v3_value_only | 764_21 |
| Control status LT | V3_akpc_782A_suct | 764_6 |
| C1 LT status | V3_akpc_772_781_781A_783_contr | 764_230 |
| C2 LT status | V3_akpc_772_781_781A_783_contr | 764_231 |
| C1 LT capacity | number_v3_value_only | 764_240 |
| C2 LT capacity | number_v3_value_only | 764_241 |
| C1 LT Runtime total | number_v3_value_only | 298_24 |
| C2 LT Runtime total | number_v3_value_only | 299_24 |
| C1 LT VSD 1 speed | number_v3_value_only | 764_337 |
| Cond. ctrl. | number_v3_white_value_only | 260_4 |
| Cond. capacity | number_v3_value_only | 285_40 |
| Cond. requested cap. | number_v3_value_only | 285_42 |
| Cond. control status | V3_akpc_783_781A_782A_cond | 285_41 |
| HR Consumer request | number_v3_white_value_only | 354_72 |
| Hr reference | number_v3_white_value_only | 358_51 |
| Hr pump running | V3_21px_single_pump_grey_green_down | 358_31 |
| Hr pump speed | number_v3_custom_json_obj | 358_32 |
| Hr enable | V3_81x21_enebled_disabled_nrm | 374_9 |
| V3hr | V3_led_13px_circ_grey_green | 354_61 |
| Shr2 | number_v3_value_only | 354_23 |
| Shr3 | number_v3_value_only | 358_25 |
| Shr4 | number_v3_value_only | 358_26 |
| Shr8 | number_v3_value_only | 358_23 |
| Liq. inj. status MT | V3_led_13px_circ_grey_green | 521_9 |
| u17 Ther Air | number_v3_60px_no_conn | 0_2532  (IO/gateway unit, not the pack) |
| --- DI1 Alarm | V3_ok_alarm_nrm | 0_9  (IO/gateway unit, not the pack) |

## Artwork rules M-A01–M-A09

- **artwork**
- **owner_document** — MASKIN-GENERATION-CONTRACT.md#16
- **enforced_by**
  - MASKIN-QA-CHECKLIST.md stage C (native-size render)
  - tests/test_maskin_compressor_bank.py (raster fixture)
- **not_enforced_by** — validate-maskin-panel.py. The M-A* ids exist so a render finding, a regression test and a review comment can name the same rule - not because the validator checks them.
- **evidence**
  - E13
  - E24
- **single_vector_vs_pitch_drift** — Conflict M-7. The 79-82 px / -1..+1 px drift in compressor_columns measures what production drew; it is not an instruction to reproduce the drift. When extending a bank, one pitch from one NAMED source pair applies to every member and to the artwork, because the artwork is a raster copy of one column at one offset and the objects must land on it.

### rules

| id | rule | defect | scope |
|---|---|---|---|
| M-A01 | ONE measured translation vector. The compressor symbol, the discharge branch, the suction branch, the status artwork, the static labels, the empty value pills AND the dynamic objects are placed with a single (dx, dy) measured once. | Two vectors that differ by one pixel, even when each is individually defensible. | MASKIN |
| M-A02 | Compositing must never multiply source alpha. Copy each source pixel's alpha verbatim; a mask is binary. | A soft or feathered mask scales alpha, and the whole clone - pipes, labels, pills - comes out faded at once, which reads as a rendering problem rather than as the compositing bug it is. | GLOBAL |
| M-A03 | Remeasure every source line independently: row count, per-row RGBA, per-row alpha, thickness, anti-aliasing and junction geometry. | Measuring the discharge header and reusing the number for the suction header. They are not the same thickness on the same panel. | GLOBAL |
| M-A04 | Reproduce every row the source has, including partial-alpha anti-aliasing rows, with the source's own alpha values. | An anti-aliased 3-row line reproduced as its 2 visible rows: thinner and harder than the header it joins. | GLOBAL |
| M-A05 | A copied branch connects: its endpoint meets the existing header pixel-for-pixel, with junction geometry copied from the source junction. | A gap. The branch looks correct in isolation, which is why this survives review. | MASKIN |
| M-A06 | Artwork first, objects second. No dynamic object is added before the artwork drawing its anchor exists. | A status strip with no compressor under it, or a value pill on white. The validator sees a well-formed object. | MASKIN |
| M-A07 | After a failed visual iteration, restart from the retained original background. | Compensating edits stacked on a derivative accumulate raster damage no single step is responsible for. | GLOBAL |
| M-A08 | A new role carries its alias, grammar 'C&lt;n&gt; &lt;MT\|LT&gt; &lt;role&gt;', even when the plant parameter behind it is unknown. | alias_text "" on a new compressor row. The alias is the relink key, so the object can never be linked by anyone. | MASKIN |
| M-A09 | An unresolved parameter is reported as a linking gap: name the aliases, deliver unlinked. | A plausible driver id. An invented id looks linked and is not. | MASKIN |

### reproduce_per_source

- Compressor symbol - outline, fill, internal detail, same size.
- Discharge branch - row count, per-row RGBA, per-row alpha, junction into the discharge header.
- Suction branch - the same, measured separately against the suction header.
- Status artwork under the strip.
- Static labels - same glyph rendering, anti-aliasing and offset.
- Empty value pills. The background never draws a number.

## Compare rules M-C01–M-C05

- **compare**
- **command** — python validate-maskin-panel.py --compare SOURCE.json CANDIDATE.json [--patch-scope SCOPE]
- **match_by** — role key (obj_id + alias_text + tag_text), never array index. Insert renames every object from the live canvas child index.
- **limit** — M-C05 compares base64 lengths, not pixels. A background that changed is not a background that changed correctly - M-A01 to M-A05 are decided by a native-size render.

### rules

| id | rule |
|---|---|
| M-C01 | An object present in the source is missing from the candidate. Under background-only, the inverse: zero counts and three empty arrays. |
| M-C02 | What may be added, and what an addition must carry - under compressor-addition, complete compressor rows with grammar-conformant, non-empty alias_text (M-A08). |
| M-C03 | Columns are atomic across the pair: no source column thinned, no new column incomplete, and no optional row that no existing compressor on that side has (the clone-C1 trap). |
| M-C04 | The declared patch scope held: every pre-existing object differs only within it. Without a scope, reported as warnings. |
| M-C05 | Background and canvas. Under compressor-addition a byte-identical background is an error - objects were added over artwork that does not draw them (M-A06). |

### patch_scopes

| scope | contract |
|---|---|
| compressor-addition | new complete columns, no field difference on anything pre-existing, background must change |
| background-only | class 4: zero counts, empty arrays, background must change |
| position | posLeft/posTop only |
| none | field-identical |

## QA rule block

- **qa**
  - **checklist_file** — MASKIN-QA-CHECKLIST.md
  - **stages**
    - A structural
    - B geometry
    - C visual
    - D linking/sanitization
    - E import/save
  - **checks**
    - Reparse the emitted JSON.
    - counts equals each array length.
    - All 17 object fields present on every object.
    - Names sequential object_0..object_N unless a preserved source dictates otherwise.
    - Every obj_id present in reference_data/all-design-objects.json.
    - No live plant id, driver id, unit id, link target or saved_by identity in anything committed.
    - Geometry, sizes, zIndex, aliases and ordering match the source unless a documented rule changes them.
    - Render at 1400x750 with the real background AND the dynamic-object overlay; inspect MT bank, LT bank, gas cooler, heat recovery, receiver/valves and the right-hand status strip.
    - Compare by role key (obj_id + alias_text + tag_text), never by array index.
    - When artwork was extended: at native size, on the background alone, confirm the new branch meets the header with no gap, the new column matches the source column in row count, per-row alpha and apparent opacity, and no pre-existing pixel moved (M-A01 to M-A05). No JSON check sees any of this.
    - python validate-maskin-panel.py PANEL.json [--profile TEMPLATE-10229]
    - python validate-maskin-panel.py --compare SOURCE.json CANDIDATE.json [--patch-scope compressor-addition] whenever a source export exists.
    - python -m unittest tests.test_maskin_compressor_bank tests.test_maskin_10229_contract
  - **render_crops** — Derived, not listed. render-maskin-panel.py computes one crop per entry in panel_types.maskin.roles from the role's own object bounding box, so the crops cannot drift from the role inventory. Do not hand-place them here.
  - **test_command_note** — The repo convention is per-module. `python -m unittest discover -s tests` fails with ImportError: Start directory is not importable, because tests/ has no __init__.py.
  - **on_failure** — Restart from the retained source export or the sanitized fixture. Do not stack compensating edits on an already damaged derivative.

## Evidence still required

- **evidence_required**
  - A second Maskin production export from a different plant, to separate MASKIN from TEMPLATE-10229. Every geometry rule here currently rests on E9 alone.
  - A Maskin panel with 4 or more compressors per suction group, to confirm that the compressor pitch continues at ~80 px.
  - A Maskin panel whose LT bank has a VSD compressor other than C1, to confirm that the VSD row is a per-compressor property and not a C1-only convention.
  - Whether the two objects sharing driver_id ~206_7 on E9 are intentional or a leftover. Recorded as an anomaly, not corrected.
  - The Danfoss parameters behind a fourth compressor. E12 carries C1-C3 MT and LT status/capacity/Runtime total plus VSD 1 speed on C1 only, and no C4 signal of any kind. The group anatomy (230+i status, 240+i capacity, 288-299 runtimes) suggests the continuation; suggesting is not evidence. Until a plant's own parameter dump is supplied, a fourth column ships with its C4 role aliases and unlinked, and the gap is stated (M-A08, M-A09).
  - A second raster in which the discharge and suction headers differ in thickness. One such observation forbids reusing a measurement across sources (M-A03); it does not establish what either thickness is anywhere else, and no number is recorded here.

## QA stages

- Stage 0 — Run the validator
- Stage A — Structural
- Stage B — Geometry
- Stage C — Visual
- Stage D — Linking and sanitization
- Stage E — Import and save

## Exact QA commands

```bash
python validate-maskin-panel.py PANEL.json --profile TEMPLATE-10229
```

```bash
python validate-visual-correctness.py PANEL.json
```

```bash
python validate-maskin-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope compressor-addition
```

```bash
python render-maskin-panel.py PANEL.json
```

```bash
export CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
pixelshot PANEL-preview.html --output /tmp/pixelbrowse --tile-height 20000 --viewport-width 1460 --wait-network-idle
```

```bash
python build-maskin-rules.py --check
```

```bash
python -m unittest tests.test_maskin_compressor_bank tests.test_maskin_10229_contract
```

```bash
python -m unittest tests.test_build_ventilation_corpus tests.test_list_panel_contract tests.test_maskin_compressor_bank tests.test_ventilation_profile_9099 tests.test_maskin_10229_contract
```
