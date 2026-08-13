# Ventilation geometry contract (360.NNN Ventilasjon)

Object-by-object geometry for an IWMAC Designer V5 ventilation panel, measured
from production exports. This file answers **where**, in pixels.
[DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) answers **which id**.
[AI-BRIEFING.txt](AI-BRIEFING.txt) answers **what shape the file has**.
[VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) answers **how it is verified**.

Every coordinate is a literal `posLeft`, `posTop`, `posWidth`, `posHeight` from a
real export. Nothing here is estimated, rounded, or averaged.

## How to read this file

### Source precedence — normative

When two sources disagree, take the higher rank. **Never average conflicting
coordinates.** A supplied export becomes the geometric template.

| Rank | Source |
|---|---|
| 1 | A panel JSON or screenshot supplied with the current task |
| 2 | A production export of the same panel **and system type** |
| 3 | **This file** — `VENTILATION-GEOMETRY-CONTRACT.md` |
| 4 | Panel-specific rules in [CLAUDE.md](CLAUDE.md) |
| 5 | [AI-BRIEFING.txt](AI-BRIEFING.txt) or its accepted revision |
| 6 | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |
| 7 | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| 8 | Generic visual-design advice |

This is the same eight-rank list held machine-readably in
[documentation-rules.json](documentation-rules.json) → `source_precedence`.
Earlier revisions of this file carried a seven-rank list that omitted the
geometry contract itself, and briefing §7a carried a five-rank list that omitted
both it and the catalogue. Those are superseded; there is one list.

**When evidence is missing, mark the gap and stop.** Do not invent a coordinate,
`obj_id`, driver id, unit id, parameter alias, file path, or navigation target.
Unresolved questions go in §12, not into a plausible number.

### Scope tags

**Every rule carries a scope tag.** Do not promote a tag by inference.

| Tag | Meaning |
|---|---|
| `GLOBAL` | Holds for every IWMAC Designer panel of any type |
| `VENT` | Holds for every Ventilasjon panel; confirmed in two or more independent production exports |
| `REF-9099` | Measured in the 9099 export family only. A different AHU may legitimately differ |
| `PROFILE-9099-ROTOR-DEMO` | Geometry of one named, corrected profile (§0). Applies **only** when that profile is the selected template |
| `SCREENSHOT` | Derived from a visual correction stated in the task. **Not present in any export inspected here.** Outranks production under precedence rank 1, and is recorded as unverified |
| `CASE-4743-360008` | Measured on the plant-4743 `360.008` modification (E29). Binary-filter size, ualarm offsets and screenshot `posTop` 169 are **this panel**, not every AHU |
| `PROFILE-BINARY-FILTER-BACNET` | Sanitized fixture profile derived from that case. Inventory is binary Normal/Alarm, not numeric Pa |
| `ADVISORY` | Judgement or convention, not a measurement |

`VENT` is the only tag that generalizes. A `REF-9099` or `PROFILE-*` coordinate
placed on a different AHU without evidence is the failure mode this tagging
exists to prevent.

## 0. Profiles and the atomic cluster model

### 0.1 The profile registry

A **profile** is a complete, internally consistent set of geometry for one AHU
configuration, evidenced by one file. Select exactly one before placing anything,
and say which one you selected.

| Profile | Evidence | Recovery | Bypass | Water heating | Electric heater | Inlet dampers |
|---|---|---|---|---|---|---|
| `PROFILE-9099-ROTOR-DEMO` | **E4** — [tests/fixtures/ventilation-9099-rotor-demo.json](tests/fixtures/ventilation-9099-rotor-demo.json) | rotor | yes | yes | yes | production horizontal flow dampers |
| *(unnamed, E1/E2 revision)* | E1, E2 | rotor | yes | yes | yes | `number_v3_dummy_resirc_damp_hor` |
| *(unnamed, E3 plant)* | E3 | rotor | **no** | yes | yes (different unit) | `V3_horis_damper_flow-*` |

Only the first is a *profile* in the machine-readable sense: it is the one
declared in [documentation-rules.json](documentation-rules.json) → `profiles`,
and the only one the validator can enforce with `--profile`. The other two rows
are evidence sets, listed so that a coordinate found in this file can always be
traced to the configuration it was measured on.

**The three are the same panel type and not the same panel.** E4 is the corrected
revision; E1 and E2 are earlier revisions of the same AHU; E3 is a different
plant. Where they disagree, this file records **all** the readings and names
which one the profile takes — it never averages them.

### 0.2 Every component is an atomic cluster

A cluster is **an anchor, its members, and their offsets from that anchor**. The
offsets are the contract; the absolute positions are one instantiation of it.

- **Relocate a cluster with one translation vector applied to every member.**
- **A cluster is complete or it is a defect.** A heating coil with a `SB510 %`
  output but no circulation pump and no 3-way valve fails cluster integrity even
  though every object in it is individually legal.
- **Never leave a member behind** — an alarm, an output, a pump or a caption that
  did not move with its anchor is the most common visual defect in a generated
  panel.

Machine-readable form: `profiles.<name>.clusters[]` in
[documentation-rules.json](documentation-rules.json), each with `anchor`,
`members[]` (`role`, `obj_id`, `offset`, `required`), and the roles that must be
absent.

### 0.3 Validator rule ids

Every rule below is enforced by
[validate-ventilation-panel.py](validate-ventilation-panel.py). Three namespaces,
and the split matters: **`V-S*` and `V-G*` run on every panel, `V-P*` run only
when a profile is selected.**

| Id | Enforces | Sections |
|---|---|---|
| `V-S01` | Envelope shape, version, non-empty panel | §1 |
| `V-S02` | `counts` equals array lengths | §11 |
| `V-S03` | All 17 object fields present | §11 |
| `V-S04` | Names sequential `object_0…object_N`, no gaps or duplicates | §11 |
| `V-S05` | Integer geometry, inside the canvas | §1 |
| `V-S06` | Explicit z bands, never mixed with `default` | §2 |
| `V-S07` | Canvas, background, no `image_svg`, empty `containers`/`graphics` | §1 |
| `V-S08` | Binding contract — demo placeholders, or production host literals | §11 |
| `V-S09` | UTF-8: `°C` preserved, never `gr C` | §7.1 |
| `V-G02` | Every `obj_id` exists in the palette | §5 |
| `V-G03` | Connector direction matches the target's side | §6 |
| `V-G04` | No free-standing caption duplicating a rendered tag | §7 |
| `V-G05` | One alarm per guarded role, beside it, clear of captions | §10 |
| `V-G06` | Sidebar uniqueness: no duplicate rows, headers or coordinates | §8 |
| `V-G07` | Exactly one position value per `KA` code | §5.9 |
| `V-P00` | The named profile exists | §0.1 |
| `V-P01`, `V-P02` | Cluster anchors and member offsets | §0.2, §3–§5 |
| `V-P03` | Inlet damper objects, sizes and value sides | §5.9 |
| `V-P04` | Fixed information blocks (outdoor temperature) | §5.9 |
| `V-P05` | Equipment-body LED inside its body, at the corrected position | §9.1 |
| `V-P06` | Profile alarm coordinates | §10 |
| `V-P07` | Roles the profile deliberately does not carry | §7 |
| `V-P08` | Sidebar caption centring | §7.2 |
| `V-G08` | Filter intersects a duct, owns one adjacent alarm, is not stretched to fake a crossing | §5.3b |
| `V-G09` | `bacnet_ualarm` suffix, matching base driver, one ualarm per (base, component) | §10.2 |
| `V-P09` | Binary vs numeric differential-pressure filter `obj_id` | §5.3b |
| `V-P10` | Unsupported live tags when source-truth cleanup is in force | authoring guide |
| `V-P11` | Sidebar geometry cloned by semantic role from a sibling panel | §8.6 |
| `V-P12` | No `bacnet_ualarm` on sidebar setpoints/commands unless the profile allows it | §10.2 |
| `V-C01`–`V-C05` | Source/candidate compare and patch-scope (`--compare`, `--patch-scope`) | authoring guide |

**There is no `V-G01`.** The id was never issued; the global relationship rules
start at `V-G02`. Do not renumber to close the gap — the ids are referenced by
name from the test suite, this file, [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md)
and [VENTILATION-AUTHORING-GUIDE.md](VENTILATION-AUTHORING-GUIDE.md), and a
renumber would silently repoint every one of them.

## Evidence base

| Alias | File | Objects | Distinct ids | Canvas | Background |
|---|---|---|---|---|---|
| **E1** | `iwmac-panel_9099_360-001-ventilasjon_recommended.json` (user Downloads, plant 9099, **not committed**) | 102 | 41 | 1400×750 | `00-blank-sidebar-1400x750`, embedded, 7 986 B |
| **E2** | [reference_data/real-vent-panel-example.json](reference_data/real-vent-panel-example.json) | 102 | 41 | 1400×750 | same |
| **E3** | [reference_data/real-vent-panel-example-2.json](reference_data/real-vent-panel-example-2.json) | 92 | 39 | 1400×750 | same |
| **E4** | [tests/fixtures/ventilation-9099-rotor-demo.json](tests/fixtures/ventilation-9099-rotor-demo.json) — the sanitized `PROFILE-9099-ROTOR-DEMO` fixture | 97 | 43 | 1400×750 | same |
| **E29** | Live `iwmac-panel_4743_360-008-reserve-2_…json` (Downloads, **not committed**). Sanitized twin: [tests/fixtures/ventilation-binary-filter/canonical.json](tests/fixtures/ventilation-binary-filter/canonical.json) | 86 live / fixture is reduced | — | 1400×750 | blank sidebar |

**E1, E2 and E4 are three revisions of one AHU; E3 is a different plant.** E4 is
the corrected revision and the only committed *demo*: 97 objects all carrying the
`"driver_id"` placeholder, `source_plant_id` empty, no real driver id, unit id or
plant metadata anywhere in it.

**That placeholder is also the mode discriminator**, and the split is total
rather than statistical: 0 of the 194 production objects in E2 and E3 carry the
literal `"driver_id"`, and 97 of E4's 97 do. The validator reads it to choose
between the demo binding contract and the production one — an unlinked object in
a *real* export carries an **empty** `driver_id`, which is not the placeholder.

| File | Objects | Real driver ids | `"driver_id"` placeholder | Empty | `source_plant_id` |
|---|---|---|---|---|---|
| E2 | 102 | 57 | 0 | 45 | `NNNNN` |
| E3 | 92 | 55 | 0 | 37 | `NNNNN` |
| E4 | 97 | 0 | 97 | 0 | `""` |

All 121 `obj_id` values used across E1–E3 exist in
[reference_data/design-object-catalog.json](reference_data/design-object-catalog.json)
(797 ids). None of the three contains `panel.image_svg`, a container, or a graphic.

**E1 and E2 are the same AHU, differently revised.** Compared by role
(`obj_id` + `tag_text`): 79 of 102 objects sit at identical geometry, 21 moved,
1 exists only in E1 and 2 only in E2. Compared by array index they look almost
totally different (85 `posLeft`, 84 `posTop`, 66 `obj_id` mismatches) because the
two files order `single_objects` differently. **Index-wise diffing of two panel
exports is meaningless — always match on role.**

**E3 is a different plant and a different unit.** It has no bypass column, no
rotary recovery temperatures, a two-row fan block, its third sidebar header at
y 400 instead of y 357, and a sub-page navigation row. It is the evidence that
separates `VENT` from `REF-9099`.

## 1. Canvas and composition — `VENT`

| Property | Value | Evidence |
|---|---|---|
| `panel_width` / `panel_height` | `"1400px"` / `"750px"` | E1, E2, E3 |
| `org_image_name` | `00-blank-sidebar-1400x750` | E1, E2, E3 |
| `background_embedded` | `true`, `image_data` present, `converted:"true"` | E1, E2, E3 |
| `panel.image_svg` | **absent** | E1, E2, E3 |
| `containers`, `graphics` | `[]`, `[]` | E1, E2, E3 |

Match the source canvas when copying a panel of another size; 1400×750 is the
default for new work, not a law.

**Zones.** Schematic x 2…1144, sidebar x 1150…1390. The sidebar background is
part of the embedded raster, so sidebar objects must start at x ≥ 1150 or they
sit on white. Schematic occupies y 140…600; sidebar y 0…470 (E1/E2), y 0…667 (E3,
which has the navigation row at y 629).

**Airflow.** Extract/exhaust on the **upper** horizontal run, fresh/supply on the
**lower** one. Heat recovery spans both. Conditioning equipment follows the
process sequence left to right along the supply run: cooler → heating coil →
electric coil → supply fan.

**Object count is not a quality target.** Coverage of the production roles listed
in §3–§9 is the target. A panel that has every role at the right coordinates is
correct at 92 objects and at 102.

## 2. Z-index bands — `VENT`

The importer writes `zIndex` through verbatim, supplying `"default"` only when the
field is missing. Emit the band as a **string**.

| Band | Contents | Count in E1 |
|---|---|---|
| `"5"` | Duct and pipe runs, connectors, sidebar header bars | 10 |
| `"15"` | Dummy arrows and short lines | 3 |
| `"20"` | Sub-page navigation buttons (E3 only) | 0 |
| `"40"` | Equipment bodies: fans, rotor, coils, heater, room | 7 |
| `"110"` | Value, setpoint and JSON boxes; filter; outside temp; dampers | 47 |
| `"300"` | Dummy 2-way motor (E3 only) | 0 |
| `"375"` | Alarm bells, LEDs, pumps, valves, kurver button | 12 |
| `"1100"` | Text labels | 23 |

E1 uses exactly six distinct values: 5, 15, 40, 110, 375, 1100.

If you emit `"default"` everywhere instead, array order **is** stacking order —
ducts first, labels last. Mixing explicit bands and `"default"` in one panel is
the reliable way to get an unpredictable stack; do not do it.

## 3. Bypass / recirculation cluster — `REF-9099`

**One atomic cluster.** Present in E1 and E2 at byte-identical coordinates.
**Absent from E3** — a unit without a recirculation leg does not get one.

Anchor: `number_v3_exhaust_connector_up` top-left (411, 211).

| Role | `obj_id` | x | y | w | h | z | Offset from anchor |
|---|---|---|---|---|---|---|---|
| Exhaust connector, up | `number_v3_exhaust_connector_up` | 411 | 211 | 18 | 50 | 5 | (0, 0) |
| Exhaust duct, vertical | `number_v3_exhaust_pipe_vertical` | 411 | 254 | 18 | 75 | 5 | (0, +43) |
| Supply duct, vertical | `number_v3_supply_pipe_vertical` | 411 | 329 | 18 | 75 | 5 | (0, +118) |
| Supply connector, down | `number_v3_supply_connector_down` | 411 | 399 | 18 | 50 | 5 | (0, +188) |
| Recirculation damper | `number_v3_dummy_resirc_damp_vert` | 407 | 310 | 40 | 40 | 110 | (−4, +99) |
| Damper position value | `number_v3_R_45px_con_left`, tag `KA502 %` | 429 | 317 | 62 | 22 | 110 | (+18, +106) |
| Damper caption | `number_v3_label_8px_norm`, tag `KA502` | 371 | 322 | 50 | 1 | 1100 | (−40, +111) |

**The duct column is continuous from y 211 to y 449 at x 411…429.**

**These overlaps are intentional and must not be "fixed":**

| Pair | Overlap |
|---|---|
| `exhaust_connector_up` (ends y 261) ∩ `exhaust_pipe_vertical` (starts y 254) | 7 px |
| `exhaust_pipe_vertical` (ends y 329) ∩ `supply_pipe_vertical` (starts y 329) | 0 px, exact abutment |
| `supply_pipe_vertical` (ends y 404) ∩ `supply_connector_down` (starts y 399) | 5 px |
| `dummy_resirc_damp_vert` (x 407…447, y 310…350) ∩ duct column | full width of the duct |

The connector pieces are drawn to socket into the pipe, so the join renders as a
continuous duct. **Never shorten a vertical duct to make room for the damper.**
The damper overlays the continuous column; the column does not stop for it.

`KA502 %` starts at x 429, exactly the duct's right edge — adjacent, not
overlapping. Its `con_left` connector points back at the duct.

## 4. Heat recovery cluster — `VENT` (rotor geometry), `REF-9099` (satellites)

Anchor: `number_360_vg_rot` top-left (282, 149) 60×343, z 40. Identical in
E1, E2 **and** E3 — the strongest cross-plant constant in the panel type.

| Role | `obj_id` / tag | x | y | w | h | z | Offset | Scope |
|---|---|---|---|---|---|---|---|---|
| Rotor body | `number_360_vg_rot` | 282 | 149 | 60 | 343 | 40 | (0, 0) | `VENT` |
| Rotor alarm | `V3_R_34px_circular_alarm_nrm` | 294 | 309 | 34 | 34 | 375 | (+12, +160) | `REF-9099` |
| Rotor output | `number_v3_R_45px_con_top`, `LX001 %` | 288 | 484 | 46 | 38 | 110 | (+6, +335) | `REF-9099` |
| Efficiency | `number_v3_R_45px_no_conn_bott_center`, `Virk.gr %` | 288 | 537 | 46 | 22 | 110 | (+6, +388) | `REF-9099` |
| Efficiency temp | `number_v3_R_45px_con_down`, `RT402 °C` | 357 | 417 | 46 | 38 | 110 | (+75, +268) | `REF-9099` |

The rotor spans **both** runs: it starts 51 px above the extract centreline
(y 209) and ends 41 px below the supply centreline (y 451).

**Frost protection.** E1, E2 and E3 carry no dedicated frost-protection value on
the rotor; the frost alarm in E1 belongs to the heating coil (§5). Do not invent
one. → *Evidence required*, §12.

**No duplicate decorative label.** The rotor body carries no `tag_text`; the only
text near it is the two value boxes, which render their own tags. Do not add a
`number_v3_label_*` reading "VGV" or "Rotor" — no export has one.

## 5. Equipment clusters — copy whole, never split

**Relocate a cluster by adding one translation vector to every member.** The
offsets, not the absolute positions, are the contract. See §0.2 for the model and
`V-P01`/`V-P02` for the enforcement.

**Required roles per component type** — a cluster missing one of these is
incomplete regardless of how the objects look:

| Component | Required roles | Optional roles |
|---|---|---|
| Fan | body, airflow value, motor output, alarm | — |
| Filter | Inventory-driven body (`numberV3_filter_with_diff_press` **or** `number_v3_filter_only`) + QD tag if the object renders one + one alarm | never a fabricated Pa value |
| Rotor | body, alarm, output `LX001 %`, efficiency | profile-supported temperatures |
| Cooling coil | body, cooling output, alarm | profile-supported temperatures |
| Water-heating coil | body, output, alarm, **circulation pump**, **3-way valve** | temperatures |
| Electric heater | body, output, run-status LED | profile-supported alarm/status roles |
| Bypass / recirculation | continuous vertical duct, damper overlay, position value | caption |

**Prohibited by construction:** a second differential-pressure box beside a
filter; a decorative `Rotor` or `VGV` label; a `SB510 %` heating output on a coil
with no pump and no valve. Each of these is a specific `V-P07` / `V-G04` failure,
not a matter of taste.

### 5.1 Extract fan

Anchor `V3_58px_fan_left_nrm` 59×59 z 40, tag `JV501`. Offsets are stable across
all four files; the anchor x is not.

| Anchor position | Scope |
|---|---|
| (187, 179) | `REF-9099` — E1 |
| **(152, 179)** | `PROFILE-9099-ROTOR-DEMO` — E2, E4 |

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Fan body | `V3_58px_fan_left_nrm`, `JV501` | 187 | 179 | 59 | 59 | 40 | (0, 0) |
| Airflow | `number_v3_R_60px_no_conn_tag_up_center`, `RF501 m3/h` | 185 | 140 | 62 | 22 | 110 | (−2, −39) |
| Motor output | `number_v3_R_45px_con_top`, `LR501 %` | 193 | 236 | 46 | 38 | 110 | (+6, +57) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 199 | 160 | 34 | 34 | 375 | (+12, −19) |

**Profile alarm position: (197, 160)** — E4, offset (+45, −19) from the anchor at
x 152. The task brief quoted "(198, 94) or the exact latest fixture coordinate";
the fixture is the latest and it reads 197, 160. `V-P06` enforces the fixture
value.

### 5.2 Supply fan — `REF-9099`

Anchor `V3_58px_fan_right_nrm` (795, 421) 59×59 z 40, tag `JV401`.

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Fan body | `V3_58px_fan_right_nrm`, `JV401` | 795 | 421 | 59 | 59 | 40 | (0, 0) |
| Airflow | `number_v3_R_60px_no_conn_tag_up_center`, `RF401 m3/h` | 793 | 381 | 62 | 22 | 110 | (−2, −40) |
| Motor output | `number_v3_R_45px_con_top`, `LR401 %` | 800 | 476 | 46 | 38 | 110 | (+5, +55) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 843 | 403 | 34 | 34 | 375 | (+48, −18) |

**The airflow and motor-output offsets are a template; the alarm offset is not.**

| Offset | E1 extract | E1 supply | E2 extract | Stable? |
|---|---|---|---|---|
| Airflow | (−2, −39) | (−2, −40) | (−2, −39) | **yes, within 1 px** |
| Motor output | (+6, +57) | (+5, +55) | (+5, +57) | **yes, within 2 px** |
| Alarm | (+12, −19) | (+48, −18) | (+45, −19) | **dy stable at −19±1; dx varies 12…48** |

Place the alarm dy at −19 from the fan; choose dx so the bell clears the fan body
and its neighbours, and state the value used. Do not treat +45 as normative — it
is E2's extract fan only.

### 5.3 Extract filter

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Filter body | `numberV3_filter_with_diff_press`, `QD501 Pa` | 466 | 154 | 90 | 83 | 110 | (0, 0) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 527 | 108 | 34 | 34 | 375 | (+61, −46) |

The body is identical in E1, E2 and E4. The alarm is not.

| Alarm position | Offset | Scope |
|---|---|---|
| (527, 108) | (+61, −46) | `REF-9099` — E1, E2 |
| **(498, 106)** | **(+32, −48)** | `PROFILE-9099-ROTOR-DEMO` — E4, and the value the task brief states |

### 5.3b Binary-filter cluster — `CASE-4743-360008` / `PROFILE-BINARY-FILTER-BACNET`

**Not a replacement for §5.3.** Use this only when the parameter inventory exposes
a binary filter guard (Normal/Alarm or equivalent) and **no** numeric differential
pressure.

| Role | `obj_id` / tag | x | y | w | h | z | Offset from body |
|---|---|---|---|---|---|---|---|
| Supply filter body | `number_v3_filter_only`, `QD40` | 129 | 413 | 90 | 83 | 110 | (0, 0) |
| Supply filter ualarm | `bacnet_ualarm_v1` | 152 | 387 | 35 | 31 | 375 | (+23, −26) |
| Extract filter body | `number_v3_filter_only`, `QD50` | 466 | 169 | 90 | 83 | 110 | (0, 0) |
| Extract filter ualarm | `bacnet_ualarm_v1` | 489 | 141 | 35 | 31 | 375 | (+23, −28) |

Evidence: E29 (user-supplied later export) plus the user's screenshot and explicit
`posTop` 169 for QD50. **90×83 is source-scoped.** Palette default for
`number_v3_filter_only` is 27×53; catalogue size is a toolbox default, not a
placement rule. Preserve the source size during a position-only patch (`V-C04`).

Screenshot-scoped placement: the alarm sits **above and slightly right** of the
filter graphic, close enough to read as belonging to it, and must not cover the
filter body or the QD text. A cropped or scaled screenshot needs an explicit
canvas scale before deriving absolute coordinates. A user-stated coordinate such
as `posTop` 169 is used directly.

`V-G08` requires the filter rectangle to intersect a horizontal duct. Move the
symbol by changing `posLeft`/`posTop`. Do not stretch width or height to fake a
crossing.

The filter **body** in E29 is unlinked (`driver_id` empty). The ualarm carries the
Filtervakt parameter. Do not copy the body's empty driver onto the alarm.

When the cluster moves, apply **one translation vector** to body + alarm (`V-C05`).

### 5.4 Supply filter

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Filter body | `numberV3_filter_with_diff_press`, `QD401 Pa` | 171 | 397 | 90 | 83 | 110 | (0, 0) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 199 | 352 | 34 | 34 | 375 | (+28, −45) |

E2 places the same filter at x 189 with its alarm at (+8, −45). dy is stable, dx
is not.

**Profile:** E4 keeps the E2 body at **x 189** and moves the alarm to
**(199, 352)**, offset (+10, −45) — the absolute alarm coordinate the task brief
states. `V-P06` enforces (199, 352).

**The filter carries its own differential pressure in `tag_text`.** Do not add a
separate value box for it — `VENT`, true in E1, E2, E3 and E4. A second box
carrying a `QD` code is the specific defect `V-P07` catches.

### 5.5 Cooling coil

Anchor `number_v3_cooler_2-way` (456, 409) 38×132 z 40 — the same position in
E1, E2 and E4.

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Coil body | `number_v3_cooler_2-way` | 456 | 409 | 38 | 132 | 40 | (0, 0) |
| Caption | `number_v3_label_8px_norm`, `Cool` | 464 | 412 | 50 | 2 | 1100 | (+8, +3) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 457 | 379 | 34 | 34 | 375 | (+1, −30) |
| Coil temp, left of run | `number_v3_R_45px_con_right`, `RT510 °C` | 408 | 492 | 62 | 22 | 110 | (−48, +83) |
| Coil temp, right of run | `number_v3_R_45px_con_left`, `RT410 °C` | 485 | 494 | 62 | 22 | 110 | (+29, +85) |
| Cooling power | `number_v3_R_45px_no_conn_bott_center`, `SB520 %` | 452 | 532 | 46 | 22 | 110 | (−4, +123) |

**Profile differences** — `PROFILE-9099-ROTOR-DEMO`, from E4:

| Role | E1 / E2 | E4 | Note |
|---|---|---|---|
| Alarm | (457, 379), offset (+1, −30) | **(458, 385)**, offset (+2, −24) | the brief's stated cooling-alarm coordinate; `V-P06` |
| Cooling power | `number_v3_R_45px_no_conn_bott_center` (452, 532) 46×22 | **`number_v3_R_45px_con_top` (453, 532) 46×38** | the profile attaches the output to the duct instead of floating it |
| Caption `Cool` | present | **absent** | see §7 and `V-P07` — the coil renders no tag of its own, but the profile carries no decorative label either |
| Coil temperatures | `RT510` / `RT410` | **absent** | this profile carries only profile-supported temperatures; do not re-add them without evidence |

**`SB520 %` legitimately appears twice in E4** — once as the cooling output here
and once as the electric heater's regulator power (§5.7), with different
`alias_text`. Duplicate-value detection is therefore scoped to `KA` codes
(`V-G07`) and must not be widened to every tag string.

### 5.6 Heating coil

Anchor `number_v3_heater_3_way` (583, 413) 40×210 z 40, tag `LV401`.

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Coil body | `number_v3_heater_3_way`, `LV401` | 583 | 413 | 40 | 210 | 40 | (0, 0) |
| Frost alarm | `V3_R_34px_circular_alarm_nrm` | 561 | 377 | 34 | 34 | 375 | (−22, −36) |
| Coil temp, left of run | `number_v3_R_45px_con_right`, `RT520 °C` | 536 | 524 | 62 | 22 | 110 | (−47, +111) |
| Coil temp, right of run | `number_v3_R_45px_con_left`, `RT420 °C` | 609 | 497 | 62 | 22 | 110 | (+26, +84) |
| Heating power | `number_v3_R_45px_con_left`, `SB510 %` | 620 | 570 | 62 | 22 | 110 | (+37, +157) |
| Circulation pump | `V3_21px_single_pump_grey_green_up`, `JP410` | 601 | 527 | 21 | 21 | 375 | (+18, +114) |
| 3-way valve | `v3_3w_valve_right_down_nrm` | 602 | 572 | 22 | 18 | 375 | (+19, +159) |

**Cluster integrity is the point of this cluster.** `SB510 %`, the pump and the
3-way valve are one unit. A panel that shows the heating output with no pump and
no valve is incomplete — `V-P01` fails it — and that specific omission is the
defect the task brief calls out by name.

**Profile frost-alarm position: (584, 378)** — E4, offset (+1, −35), against
E1/E2's (561, 377) at offset (−22, −36). The profile puts the bell to the right
of the coil body instead of the left. `V-P06` enforces (584, 378).

**Pump orientation is unresolved and must not be averaged.**

| Reading | Source |
|---|---|
| `V3_21px_single_pump_grey_green_up` | E1 and E2 — two production exports |
| **`V3_21px_single_pump_grey_green_down`** | E4 and the task brief — precedence rank 1 |

Both are legal 21×21 palette entries at the same coordinate (601, 527). The
profile takes `_down` because the supplied correction outranks production; the
production reading is recorded here and in §12 rather than discarded. If a future
export of this AHU shows `_up`, that is rank-2 evidence against a rank-1
correction and the question reopens — do not silently switch.

> **Instrument codes are plant-specific; the positions are not.** E1 and E2 place
> the four coil temperatures at effectively the same coordinates but swap which
> loop is numbered 4xx and which 5xx: E1 has `RT510`/`RT410` on the cooler and
> `RT520`/`RT420` on the heater; E2 has exactly the reverse. Copy the **position**
> from the reference and the **code** from the target plant's parameter inventory.
> Never copy a code across plants because the coordinate matched.

### 5.7 Electric heater

Anchor `number_v3_el_heater` (697, 413) 40×85 z 40, tag `LV402`.
**Body bounds x 697…737, y 413…498.**

| Role | `obj_id` / tag | x | y | w | h | z | Offset | Scope |
|---|---|---|---|---|---|---|---|---|
| Heater body | `number_v3_el_heater`, `LV402` | 697 | 413 | 40 | 85 | 40 | (0, 0) | `REF-9099`, E1 and E4 |
| Regulator power | `number_v3_R_45px_no_conn_bott_center`, `SB520 %` | 694 | 493 | 46 | 22 | 110 | (−3, +80) | `REF-9099`, E1 and E4 |
| **Run-status LED** | `V3_led_13px_circ_grey_green` | **703** | **460** | 13 | 13 | 375 | **(+6, +47)** | `PROFILE-9099-ROTOR-DEMO`, E4 |

E2 places the body at x 693 (bounds 693…733); E3 uses the same `obj_id` at
(459, 412) with tag `LI401`, on a different unit. **The 40×85 body size is stable
across all four files; the x position is not.**

The heater body carries **no alarm** in any export. The LED is a status
indicator, not an alarm — do not add a bell here to "complete" the cluster.

**LED containment is a hard constraint**, enforced by `V-P05`:

| Check | Value |
|---|---|
| LED bounds | x 703…716, y 460…473 |
| Inside the body (697…737, 413…498)? | yes — margins left 6, right 21, top 47, bottom 25 |
| Clear of the `LV402` tag the body renders? | yes |
| Clear of `SB520 %` (starts y 493)? | yes — 20 px |
| Superseded position | **(700, 466)** — the earlier `SCREENSHOT` reading; `V-P05` rejects it |

See §9.1 for how the 13 px variant was resolved.

### 5.8 Room / zone endpoint — `VENT` (body), `REF-9099` (satellites)

Anchor `number_360_room` (1044, 159) 100×339 z 40 — identical in E1, E2 and E3.

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Room body | `number_360_room` | 1044 | 159 | 100 | 339 | 40 | (0, 0) |
| CO₂ caption | `number_v3_label_8px_norm`, `RP501 ppm` | 1064 | 276 | 59 | 13 | 1100 | (+20, +117) |
| CO₂ value | `number_v3_R_45px_no_conn_tag_up_left` | 1071 | 290 | 46 | 22 | 110 | (+27, +131) |
| Room-temp caption | `number_v3_label_8px_norm`, `RT600 °C` | 1070 | 317 | 47 | 13 | 1100 | (+26, +158) |
| Room-temp value | `number_v3_R_45px_no_conn_tag_up_left` | 1071 | 331 | 46 | 22 | 110 | (+27, +172) |

The two value boxes have an **empty-looking** `tag_text` of a single space — the
caption above each one is a separate 8 px label. This is the "row label already
names the value" pattern of §7.

### 5.9 Inlet dampers and the outdoor-temperature block

**Object choice here is profile-scoped, not global.** Both damper families are
production-real, and an earlier revision of [CLAUDE.md](CLAUDE.md) rule 3 listed
`V3_horis_damper_flow-*` among eight "bad substitutions" — which was true of the
E1/E2 revision and false as a general rule. Select by profile.

#### 5.9a Recirculation-dummy variant — `REF-9099` (E1, E2)

| Role | `obj_id` / tag | x | y | w | h | z |
|---|---|---|---|---|---|---|
| Outdoor temp block | `numberV3_outside_temp`, `RT-90` | 20 | 301 | 79 | 50 | 110 |
| Extract-end recirc damper | `number_v3_dummy_resirc_damp_hor` | 28 | 182 | 42 | 42 | 110 |
| Supply-end recirc damper | `number_v3_dummy_resirc_damp_hor` | 30 | 424 | 42 | 42 | 110 |
| Extract damper value | `number_v3_R_45px_con_top`, `KA501 %` | 24 | 218 | 46 | 38 | 110 |
| Extract damper caption | `number_v3_label_8px_norm`, `KA501` | 31 | 181 | 50 | 20 | 1100 |
| Supply damper value | `number_v3_R_45px_con_top`, `KA401 %` | 25 | 461 | 46 | 38 | 110 |
| Supply damper caption | `number_v3_label_8px_norm`, `KA401` | 31 | 423 | 50 | 1 | 1100 |
| Exhaust arrow | `number_v3_dummy_21x17_Arrow_Left` | 2 | 200 | 21 | 17 | 15 |
| Intake arrow | `number_v3_dummy_21x17_Arrow_Right` | 2 | 443 | 21 | 17 | 15 |

Here the values are `con_top` because their target is the **duct**: they sit
below the run with the connector pointing up at it.

E3 uses `V3_horis_damper_flow-left_nrm` / `-right_nrm` 36×26 at z 40 on a unit
with no recirculation, at (30, 195) and (30, 438).

#### 5.9b Production flow-damper variant — `PROFILE-9099-ROTOR-DEMO` (E4)

**This is the corrected variant.** Use the production horizontal damper objects,
not a generic recirculation dummy, and attach each position value to the damper
rather than to the duct.

| Role | `obj_id` / tag | x | y | w | h | z |
|---|---|---|---|---|---|---|
| Outdoor temp block | `numberV3_outside_temp`, `RT001 °C` | **16** | **17** | 79 | 50 | 110 |
| Extract damper | `V3_horis_damper_flow-left_nrm` | 75 | 196 | 36 | 26 | 40 |
| Fresh-air damper | `V3_horis_damper_flow-right_nrm` | 96 | 438 | 36 | 26 | 40 |
| Extract damper position | `number_v3_R_45px_con_down`, `KA501 %` | 71 | 163 | 46 | 38 | 110 |
| Fresh-air damper position | `number_v3_R_45px_con_down`, `KA401 %` | 93 | 405 | 46 | 38 | 110 |
| Duct outdoor temperature | `number_v3_R_45px_con_down`, `RT901 °C` | 133 | 417 | 46 | 38 | 110 |

Rules this variant carries, all enforced:

- **Damper direction follows airflow** — `flow-left` on the extract run,
  `flow-right` on the fresh-air run (`V-P03`).
- **`con_down`, not `con_top`** — the value sits **above** its damper and points
  down at it. The connector direction changed because the *target* changed from
  the duct to the damper, not as a style preference (§6, `V-G03`).
- **Exactly one position value per damper.** No separate 8 px `KA501` / `KA401`
  captions: the `con_down` box renders its own tag, so a caption beside it is the
  duplicate `V-P07` catches, and a second value box carrying the same `KA` code
  is what `V-G07` catches. A stale duplicate left behind by an edit is a defect
  on any plant, which is why the one-value-per-`KA`-code rule is global while the
  object choice is not.
- **Do not substitute `number_v3_dummy_resirc_damp_hor`** for these inlet
  dampers. The vertical recirculation dummy in §3 is a different role and stays.

**Outdoor temperature is a fixed information block in this profile.**
`numberV3_outside_temp` sits in the upper-left corner at **(16, 17), 79×50,
zIndex 110** — *not* on the fresh-air duct. The duct-mounted outdoor reading in
this profile is a separate `con_down` box, `RT901 °C` at (133, 417). Any text
elsewhere in the documentation saying the outdoor-temperature object always sits
at the fresh-air inlet describes the E1/E2 revision, where it is at (20, 301),
and does not generalize. `V-P04` pins the profile position; a supplied production
export still overrides it under rank 1.

> **OPEN — the `KA401 %` / `RT901 °C` adjacency, measured 2026-08-10.**
> These two boxes overlap. `KA401 %` occupies x 93–139, y 405–443 and
> `RT901 °C` occupies x 133–179, y 417–455, so they share a **6 × 26 px**
> rectangle, and in a browser render their glyphs come within **≈ 1 px** of each
> other. Both are `number_v3_R_45px_con_down`, so neither box is wider than the
> profile says.
>
> **This adjacency does not exist in production.** E2 carries `RT901 °C` at
> exactly (133, 417) — identical to this profile — but places `KA401 %` at
> (25, 461) as a `con_top` box, far away. The overlap was created by moving
> `KA401 %` to (93, 405) per the corrected profile while keeping production's
> `RT901 °C`. It is therefore a consequence of change 27, not a production quirk
> like the duplicated `SB520 %` in §11.
>
> **Nothing here is changed to resolve it**, because resolving it would mean
> inventing a coordinate for one of two objects that each come from evidence:
> `KA401 %` (93, 405) from the task brief at rank 1, `RT901 °C` (133, 417) from
> E2 at rank 2. Precedence does not adjudicate between two *different* objects,
> only between conflicting claims about the same one.
>
> **What to do.** An agent generating from this profile MUST reproduce both
> coordinates as given and MUST NOT nudge either to open a gap. Whoever next has
> the real 9099 panel in front of them should read off the true placement and
> record it here, at which point this note is superseded. Until then the
> adjacency is documented, pinned by a regression test, and explicitly not a
> licence to move anything.

### 5.10 Smoke detector — `REF-9099`

| Role | `obj_id` / tag | x | y | w | h | z |
|---|---|---|---|---|---|---|
| Smoke LED | `V3_led_18px_circ_grey_red` | 893 | 422 | 18 | 18 | 375 |
| Caption | `number_v3_label_8px_norm`, `RY401` | 886 | 410 | 50 | 1 | 1100 |
| Drop line | `number_v3_dummy_6x15_Line_Small_Down` | 899 | 438 | 6 | 15 | 15 |

## 6. Duct runs and the connector rule — `VENT`

| Run | `obj_id` | x | y | w | h | z | E1 | E2 | E3 |
|---|---|---|---|---|---|---|---|---|---|
| Extract, right to left | `number_v3_exhaust_pipe_horisontal` | 24 | 200 | 1025 | 18 | 5 | ✓ | ✓ | ✓ |
| Fresh air | `number_v3_fresh_pipe_horisontal` | 24 | 442 | 260 | 18 | 5 | ✓ | ✓ | 270 wide |
| Supply, left to right | `number_v3_supply_pipe_horisontal` | 337 | 442 | 710 | 18 | 5 | ✓ | ✓ | x 327, 720 wide |

Extract centreline **y 209**, supply centreline **y 451**, runs **242 px** apart —
identical in E1, E2 and E3. The fresh/supply split point moves with the unit.

**Connector rule.** This is what makes the drawing read as ductwork, and it is
the single rule that most often separates a production-looking panel from a
diagram. **A value must be attached to the thing it describes.**

| Object suffix | Sits | Points | Its edge must meet |
|---|---|---|---|
| `con_down` | **above** the target | down | the target's top edge |
| `con_top` | **below** the target | up | the target's bottom edge |
| `con_left` | to the **right** of the target | left | the target's right edge |
| `con_right` | to the **left** of the target | right | the target's left edge |

The name describes **where the connector stub leaves the box**, not where the box
goes — `con_top` means the stub exits the top, so the box is underneath. Getting
this backwards produces a bubble with a stub pointing into empty space.

The target may be a duct, an equipment body, a valve or a damper. Whatever it is,
**the connector edge must visibly meet it**; a value floating near its target is
a defect, not an approximation (`V-G03`).

Measured instances:

- `number_v3_R_45px_con_down` (46×38) over a run — E1: `RT502 °C` (985, 175) over
  the extract run, `RT401 °C` (985, 417) over the supply run. Over a *damper* —
  E4: `KA501 %` (71, 163) above the damper at (75, 196).
- `number_v3_R_45px_con_top` (46×38) below a run, its top edge at the duct's
  bottom edge — E1: `KA501 %` (24, 218), duct bottom y 218; `LR501 %` (193, 236).
- `number_v3_R_45px_con_left` / `_con_right` (62×22) attach horizontally, used on
  vertical ducts and on coil bodies.

A `con_top` box whose top edge is not at the duct's bottom edge renders as a
floating box with a stub pointing at nothing.

## 7. Text and value ownership — `VENT`

1. **No standalone text label when the equipment object already displays its
   tag.** `number_v3_el_heater` renders `LV402` itself; `number_v3_heater_3_way`
   renders `LV401`; `numberV3_filter_with_diff_press` renders `QD401 Pa`. Adding a
   `number_v3_label_*` beside them duplicates the text.
2. **No second caption when a value object already renders `tag_text`.** A
   `con_top`/`con_down`/`con_left`/`con_right` box renders its own tag.
3. **The signal description belongs in `alias_text`**, never in `tag_text`. It is
   what a human links by afterwards.
4. **`tag_text` = visible instrument code + unit**, and only on objects that
   render a tag: `RT401 °C`, `RF401 m3/h`, `KA401 %`, `QD401 Pa`, `SB510 %`.
5. **Use a no-tag value object when a row label already names the value.**
   `number_v3_60px_dark_no_conn_no_tag` in the temperature section;
   `number_v3_R_45px_no_conn_tag_up_left` for the room boxes.

### 7.1 Degree symbol — `VENT`, supersedes the ASCII guidance

**Write `°C`. Never write `gr C`.**

| Export | `tag_text` containing `°` | `tag_text` containing `gr C` |
|---|---|---|
| E1 | 13 | 0 |
| E2 | 13 | 0 |
| E3 | 8 | 0 |

Production also carries `æ ø å` and `³`: `Sp. høyfart m³/h:`, `Sp. nattkjøl. m³/h:`,
`Kjølemodus kombibatteri`. The Insert JSON path reads files as UTF-8 and these
survive it. Emit UTF-8, preserve `°` literally, and do not escape it.

The mojibake risk that produced the old "plain ASCII is safest" advice is real but
belongs to a different channel — injecting text into the ISO-8859-1 Designer page
via `addScriptTag`. It never applied to the panel JSON.

### 7.2 Left-aligned labels and visual centring — `VENT` (mechanism), `SCREENSHOT` (values)

**`number_v3_label_11px_norm` renders its text left-aligned from `posLeft`.**
`posWidth` is the object's box, and it does **not** centre the text.

Consequence: **equal `posWidth` on two labels does not make them visually
centred.** E1 and E2 both give `Tilluft` and `Avtrekk` `posWidth` 50 while placing
them 65 px apart, precisely because the two words have different rendered widths.

To centre a label on a column whose centre is `C`, given rendered text width `W`:

```
posLeft = C - W / 2
```

| Column | Boxes | Centre | Heading | Production x | Rendered W | Ideal x | Delta |
|---|---|---|---|---|---|---|---|
| Supply (Tilluft) | x 1260, w 62 | **1291** | `Tilluft` | 1276 (E1, E2) | 32 | **1275** | +1 px right |
| Extract (Avtrekk) | x 1330, w 62 | **1361** | `Avtrekk` | 1341 (E1, E2) | 40 | **1341** | 0, already centred |

`SCREENSHOT` — the rendered widths 32 and 40, and therefore the corrected
`Tilluft` x of 1275, come from the visual correction stated in the task. **No
screenshot was supplied to this audit and no export contains those values**; both
exports use `posWidth` 50 for both headings. Under precedence rank 1 the
correction outranks production, so it is recorded as the rule. It is *consistent*
with production — `Avtrekk` at 1341 is exactly `1361 − 40/2` — which is
corroboration, not verification.

When emitting the headings, set `posLeft` from the formula and leave `posWidth` at
the production value of 50; the width is inert for a left-aligned label.

> **Every rendered width in this file is an estimate, and no rule may fail a
> panel on the strength of one.** The two supplied readings disagree with two
> independent checks: Arial advance widths at 11 px give 26 and 37, not 32 and
> 40; and production renders `A-Alarm` / `B-Alarm` on a **45 px pitch** at
> x 1305 and 1350 — byte-identical in E1, E2 and E4, on two different plants —
> which caps `A-Alarm` near 41 px, while scaling the model up to fit `Tilluft`
> at 32 would make it 48 and put the two captions in collision. Production
> renders that row on two plants, so it is evidence and the estimate is not.
> The validator therefore estimates from Arial metrics, tolerates 3 px on any
> overlap it derives from an estimate, and reports width-dependent findings as
> warnings (`V-P08`). Recorded as open evidence in §12 and in
> `documentation-rules.json` → `open_evidence`.

## 8. Sidebar contract — `VENT` structure, `REF-9099` rows

E1 and E2 are **geometrically identical** across all 36 sidebar objects. E3 keeps
the same grammar with different rows.

### 8.1 Section headers

`number_v3_header_grey75`, **250×20 at x 1150**, z `"5"`.

| Section | `tag_text` | y (E1, E2) | y (E3) |
|---|---|---|---|
| 1 | `Status og vendere` | 0 | 0 |
| 2 | `Vifteregulering` | 165 | 165 |
| 3 | `Temperaturregulering` | **357** | **400** |

The third header's y is **not** a constant. Take it from the source export.

The catalogue lists this object's palette default as 60×25. That is the size it
arrives at from the toolbox, not the size production uses. Always place it 250×20.

### 8.2 Section 1 — Status og vendere — `REF-9099`

| Role | `obj_id` / tag | x | y | w | h | z |
|---|---|---|---|---|---|---|
| Header | `number_v3_header_grey75`, `Status og vendere` | 1150 | 0 | 250 | 20 | 5 |
| Label | `number_v3_label_11px_norm`, `Driftsmodus` | 1243 | 24 | 50 | 1 | 1100 |
| Mode pill | `number_v3_custom_json_obj` | 1160 | 36 | 230 | 20 | 110 |
| Label | `number_v3_label_11px_norm`, `Systemvender` | 1175 | 59 | 50 | 1 | 1100 |
| Label | `number_v3_label_11px_norm`, `A-Alarm` | 1305 | 59 | 50 | 1 | 1100 |
| Label | `number_v3_label_11px_norm`, `B-Alarm` | 1350 | 59 | 50 | 1 | 1100 |
| Mode switch | `number_v3_60px_json_obj` | 1160 | 73 | 100 | 20 | 110 |
| A-alarm LED | `V3_led_16px_circ_grey_red` | 1317 | 75 | 16 | 16 | 375 |
| B-alarm LED | `V3_led_16px_circ_grey_yellow` | 1362 | 75 | 16 | 16 | 375 |
| Label | `number_v3_label_11px_norm`, `Alarmkvittering` | 1172 | 95 | 50 | 1 | 1100 |
| Acknowledge | `number_v3_60px_json_obj` | 1160 | 108 | 100 | 20 | 110 |
| Temp-mode pill | `number_v3_custom_json_obj` | 1290 | 134 | 100 | 20 | 110 |
| Label | `number_v3_label_11px_norm`, `Aktiv temp.reg. modus:` | 1160 | 138 | 50 | 1 | 1100 |

**Row pitch in this section is not uniform** — value tops run 36, 73, 108, 134
(pitch 37, 35, 26). Do not impose 25 px here; it is a mixed-control block, not a
setpoint grid.

**Labels sit above their control**, at value top − 12 (rows 1–3). The last row
inverts this: the label at y 138 sits *below* the pill top at y 134, because that
pill is in the right-hand column.

Note the `posHeight` of 1 on six labels here. An 11 px label renders its text
regardless of a degenerate box height; the box is not the text. This is why
overlap must be judged on rendered glyphs, not on `posHeight`.

### 8.3 Section 2 — Vifteregulering — `REF-9099`

Two setpoint columns of `number_v3_60px_dark_no_conn` **62×22**, z `"110"`.

| Column | x | Centre |
|---|---|---|
| Supply (Tilluft) | **1260** | 1291 |
| Extract (Avtrekk) | **1330** | 1361 |

| Row | Label | Label x, y | Supply box y | Extract box y |
|---|---|---|---|---|
| 1 | `Sp. høyfart m³/h:` | 1160, 210 | 205 | 205 |
| 2 | `Sp. lavfart m³/h:` | 1160, 235 | 230 | 230 |
| 3 | `Sp. nattkjøl. m³/h:` | 1160, 260 | 255 | 255 |
| 4 | `Min friskluft %:` | 1160, 284 | — | 279 |
| 5 | `Sp. CO2 ppm:` | 1161, 312 | — | 308 (**x 1332**) |

- **Row pitch 25 px** for rows 1–3; row 4 is +24 and row 5 is +29.
- **Label y = value y + 5**, every row.
- Rows 4 and 5 are single-column and sit in the **extract** column.
- **Row 5's box is at x 1332, not 1330** — a 2 px production inconsistency,
  reproduced here because E1 and E2 agree on it. Emit 1330 for a new panel and say
  you normalised it; do not silently "fix" it when cloning.
- Headings `Tilluft` / `Avtrekk` at y 190, `posHeight` 20 — see §7.2 for x.
- First row clearance: header bottom y 185 → heading y 190 → first value y 205.

### 8.4 Section 3 — Temperaturregulering — `REF-9099`

One column of `number_v3_60px_dark_no_conn_no_tag` **62×22 at x 1329**, z `"110"`.

| Row | Label | Label x, y | Box y |
|---|---|---|---|
| 1 | `Sp. romtemperatur °C:` | 1160, 390 | 385 |
| 2 | `Maks tilluftstemperatur °C:` | 1160, 415 | 410 |
| 3 | `Min tilluftstemperatur °C:` | 1160, 440 | 435 |

- **Row pitch 25 px**, uniform.
- **Label y = value y + 5**, uniform.
- **x 1329, not 1330.** The temperature column is 1 px left of the fan column in
  both exports.
- Header bottom y 377 → first value y 385: **8 px clearance**.
- The `_no_tag` variant is correct here because the row label already names the
  value (§7.5).

### 8.5 Sidebar spacing — measured, not advisory

| Measurement | Value | Basis |
|---|---|---|
| Label column x | 1160 | E1, E2; 1156/1161/1165/1172/1175/1243/1305/1350 where a longer text needs shifting |
| Value box size | 62×22 | E1, E2, E3 |
| Setpoint row pitch | 25 px | §8.3 rows 1–3, §8.4 all rows |
| Label offset within a setpoint row | value y + 5 | every setpoint row in E1, E2, E3 |
| Box-to-box vertical gap | **3 px** (22 px box in a 25 px pitch) | derived |
| Label box to next value box | **0 px** — label y+5, h 20 ends exactly at the next value top | derived |
| Rendered-glyph gap, label to next box | **≈ 6 px** at 11 px font | derived, `ADVISORY` |
| Header bottom to first value | 8 px (§8.4), 20 px (§8.3, heading row between) | E1, E2 |
| Last value bottom to next header | 357 − (308+22) = **27 px** | E1, E2 |

**The 0 px box-to-box figure is why tag captions collide.** A value object that
renders a caption above its box consumes the space the previous label's box
already occupies. In the sections above production avoids this by using
`_no_conn_no_tag` in the temperature block and by putting the caption in a
separate 8 px label elsewhere. **Prefer `number_v3_60px_dark_no_conn_no_tag`
wherever the row label already explains the signal.**

Minimum acceptable rendered-glyph separation for a new row: **4 px**. `ADVISORY` —
production's own margin is ≈ 6 px and nothing in the exports establishes a floor.

### 8.6 Sibling-panel sidebar geometry clone — `VENT` procedure, geometry from the named sibling

When the user names a sibling Ventilasjon panel (for example 360.002 as the
reference for 360.008) and asks for **minimal visual movement** when switching
panels, copy **geometry only** by semantic role:

- Copy: `posLeft`, `posTop`, `posWidth`, `posHeight` (and `zIndex` only if the
  reference requires it).
- Preserve on the target: `driver_id`, `unit_id`, `alias_text`, `tag_text` when
  the target wording is intentionally different, and system identity.

Match by visible `tag_text`, then `alias_text`. **Never by array index.** Designer
has no CSS `text-align` field; apparent label centring is object geometry plus
the object's own left-aligned rendering.

`V-P11` enforces equality against `--sibling-sidebar`. Helper:
`clone-ventilation-sidebar-geometry.py`.

Do not put `bacnet_ualarm` objects in the right sidebar unless the chosen
reference and the request both support it (`V-P12`).

## 9. LED placement

### 9.1 Equipment-body LED (LV402) — `PROFILE-9099-ROTOR-DEMO`

**Resolved by E4.** The earlier reading was `SCREENSHOT`-scoped with the variant
unknown; the fixture settles both the object and the position.

| Property | Current — E4 | Superseded — the earlier screenshot reading |
|---|---|---|
| `obj_id` | **`V3_led_13px_circ_grey_green`** | unknown; "pick by state semantics" |
| Position | **(703, 460)**, offset (+6, +47) | (700, 466) |
| Bounds | x 703…716, y 460…473 | x 700…713, y 466…479 |
| Interior margins | left 6, right 21, top 47, bottom 25 | left 3, bottom 19, right 24, top 53 |
| Clearance to `SB520 %` (y 493) | 20 px | 14 px |

Parent: `number_v3_el_heater`, bounds **x 697…737, y 413…498**.

**grey→green for running** is now evidenced, not inferred: E4's LED carries
`alias_text` "Status,-Electric heater run status". The 13 px family also holds
`_grey_red`, `_grey_yellow`, `_green_grey`, `_red_grey` and the `_int` and
`_square` variants — pick by state semantics for a *different* role, but this
role is settled.

Placement rule, unchanged in substance and now anchored to a real coordinate:
**fully inside the body**, not centred over the tag, not outside it, and clear of
the output box below. `V-P05` fails a panel whose LED escapes the body bounds or
sits at the superseded (700, 466).

### 9.2 Status pill LED (Aggregatstatus) — `SCREENSHOT`, still unresolved

This rule comes from a visual correction stated in the task. **No such
configuration exists in E1, E2, E3 or E4**, so it is not production-verified and
the profile does not carry it.

The LED must sit **fully inside** the Aggregatstatus value pill, must not cover
the numeric value, and must retain visible right and vertical padding.

→ *Evidence required*, §12. **No object in E1, E2 or E3 is captioned
`Aggregatstatus`.** The nearest production construct is the `Driftsmodus` row of
§8.2: a 230×20 `number_v3_custom_json_obj` pill at (1160, 36) whose A/B alarm LEDs
sit **outside** it, at x 1317 and 1362 against a pill ending at x 1390 — i.e.
production does *not* place those LEDs inside that pill. The requested layout is a
different design and the pill's geometry is unknown.

## 10. Alarms

### 10.1 Global rules — `VENT`

- **One alarm per guarded role.** E1 and E4 both have exactly seven bells for
  seven guarded roles: extract fan, supply fan, extract filter, supply filter,
  rotor, cooling, heating frost. No bell appears twice on the same component.
- **Beside the guarded component, never over it**, and above or immediately
  beside it. Every `V3_R_34px_circular_alarm_nrm` in E1 sits clear of its
  equipment body.
- **Never over a tag, a value or an equipment control.**
- **Checked at native rendering size**, 34×34 for the standard bell.
- z `"375"` — above equipment (40) and values (110), below labels (1100).

> **Role uniqueness is keyed on (parameter, component), not on the parameter
> alone.** A unit with two like components legitimately repeats an alias:
> production reference E3 guards its extract and fresh-air dampers with two
> `Malf. damper` alarms 243 px apart. Two different dampers are two different
> roles. Only two bells on the *same* component are the duplicate `V-G05`
> reports.

### 10.2 Generic alarm vs BACnet ualarm — geometry only

Host behaviour (when `.Ualarm` is appended or stripped, `addAlarmObject`) is
owned by [CLAUDE.md](CLAUDE.md) §13c. Which roles may receive a ualarm is owned by
[VENTILATION-AUTHORING-GUIDE.md](VENTILATION-AUTHORING-GUIDE.md). This section
owns **where** a ualarm sits.

Two placements, two scopes — do not average them:

| Placement | Scope | Geometry |
|---|---|---|
| Interactive Designer Add (param selector, BACnet toolbar on) | host | `left = selected.offsetLeft + selected.offsetWidth + 5`, `top = selected.offsetTop` — **to the right**. Width/height `null` → control default **35×31**, z 375. No collision check. |
| Conversion that copies a production panel | the selected export | relative offset from that export's main object (steps below). E29 filter ualarms sit above-right at about **(+23, −26)/(+23, −28)** (`CASE-4743-360008`, §5.3b) — **not** the host default. |

When a selected production export already has `bacnet_ualarm_v1` on the same
semantic role:

1. Find the main object in the reference.
2. Find its associated ualarm by base-driver relationship (`driver_id` with one
   `.Ualarm` suffix) or verified semantic mapping.
3. `dx = alarm.posLeft - main.posLeft`, `dy = alarm.posTop - main.posTop`.
4. Find the equivalent target main object by semantic role, never array index.
5. Place at `target.posLeft + dx`, `target.posTop + dy`.
6. Preserve verified alarm size and `zIndex`. E29 ualarms are **35×31** at z
   `"375"` (controls-registry width/height, not the palette's 31×31 listing).
7. Visual overlap and adjacency check. Filter alarms use §5.3b.

Do not reuse one coordinate for both an upper and a lower damper. Two ualarms
may share one base driver when they guard two distinct components (E29 dampers);
two ualarms on the **same** component fail `V-G09` / `V-G05`.

v1 vs v2: same 35×31. v1 state 0 is `transp.gif`; v2 state 0 is
`grey_no_attention.png`. E29 uses v1. Do not substitute v2 without evidence.

### 10.3 Profile alarm coordinates — `PROFILE-9099-ROTOR-DEMO`

Absolute positions from E4, each 34×34 at z `"375"`. These are **profile
geometry** — do not universalize them to a different AHU.

| Guarded role | x | y | Offset from its anchor | E1 / E2 reading |
|---|---|---|---|---|
| Extract fan | 197 | 160 | (+45, −19) from (152, 179) | (199, 160) at anchor 187 |
| Supply fan | 843 | 403 | (+48, −18) from (795, 421) | same |
| Extract filter | 498 | 106 | (+32, −48) from (466, 154) | (527, 108) |
| Supply filter | 199 | 352 | (+10, −45) from (189, 397) | (197, 352) at anchor 189 |
| Rotary heat exchanger | 294 | 309 | (+12, +160) from (282, 149) | same |
| Cooling | 458 | 385 | (+2, −24) from (456, 409) | (457, 379) |
| Heating / frost | 584 | 378 | (+1, −35) from (583, 413) | (561, 377) |

Three properties are tested per bell: clear of the component it guards, clear of
every caption, and unique for its (role, component) pair. The caption-overlap
test compares an exact alarm rectangle against an *estimated* label rectangle, so
it tolerates 3 px and is a warning rather than an error on a production export —
see §7.2 on why rendered label widths are estimates here.

## 11. Linking and sanitization — `GLOBAL`

For an unlinked demo derived from a production export:

| Field | Value |
|---|---|
| `id` | `"driver_id"` |
| `driver_id` | `"driver_id"` |
| `linked` | `"false"` |
| `link_name` | `""` |
| `link_tag` | `""` |
| `unit_id` | `""` |
| `unit_ref` | `""` |
| `sub_group` | `""` |
| `alias_text` | **preserved verbatim** |

Also set the envelope's `source_plant_id` and `panel.plant_id` to `""`.

Preserve `obj_id`, all four geometry fields, `zIndex`, `tag_text`, `alias_text`,
the background fields, and every scaffold object.

**Remove source plant-specific parameter identifiers.** E1 carries 57 real driver
ids of the form `9099_OJEXHAUST_OJ_1_1_0_4_19`; none may survive into a demo.

**Preserve navigation only when the target is known.** A `sub_page_*` object
stores the **target panel's numeric id** in `driver_id`. If the target does not
exist in the destination plant, drop the object rather than pointing it somewhere.

**Never invent a driver ID, unit ID, file path, or panel target.** An invented id
looks linked and is not — worse than an empty one.

> Two production-versus-generated asymmetries, so they are not mistaken for bugs:
> a real export carries `link_name` literally `"link_name"` on every object (102/102
> in E1) and an *unlinked* object in a real export has an **empty** `driver_id`,
> not the `"driver_id"` placeholder a generated panel must emit. An export is
> evidence of what the host writes, not a template for what an AI writes.

**That asymmetry is what tells the two modes apart, and it is a total split, not a
heuristic.** Across the three files measured here, production exports carry the
`"driver_id"` placeholder on **0 of 194** objects while the sanitized demo carries
it on **97 of 97**. `V-S08` uses exactly that test to decide which mode it is in,
and it is the reason the checklist's structural rules can be strict on a demo
without failing every production reference handed to it (see §0.3 and the table
in §2).

E4 — [`tests/fixtures/ventilation-9099-rotor-demo.json`](tests/fixtures/ventilation-9099-rotor-demo.json) —
is the worked example of this whole section: 97 objects, 97 placeholders, zero
real driver ids, zero unit ids, `source_plant_id` empty. Diff a candidate demo
against it rather than against E1 or E2, which are linked production files.

## 12. Evidence required

An open item here is a **licence to stop, not a licence to guess**. If a task needs
one of these numbers, say which one is missing and what would settle it. Do not
fill the hole with a plausible coordinate — that is the failure this section
exists to prevent.

### 12.1 Still open

1. **`iwmac-panel_9099_360-001-ventilasjon_20260809-1857.json` does not exist.**
   The named input is absent from Downloads, Documents and Desktop. The only 9099
   export on disk is `iwmac-panel_9099_360-001-ventilasjon_recommended.json`, used
   here as E1. If the 1857 export is a different revision, every `REF-9099` figure
   must be re-measured against it.
2. **No screenshots were supplied.** Every `SCREENSHOT` rule rests on the task's
   stated corrections, not on an image verified here. That covers §7.2's rendered
   text widths and §9.2's status-pill LED.
3. **The circulation pump's vertical variant is disputed** (§5.6). E1 and E2 — two
   production exports of this AHU — record `V3_21px_single_pump_grey_green_up`;
   the supplied correction and E4 record `_down`, at the same coordinate
   (601, 527), and both are legal 21×21 palette entries. The profile takes `_down`
   because rank 1 outranks rank 2, but **the disagreement is unresolved, not
   settled**. A fresh export of this AHU showing `_up` reopens it; do not switch
   silently in either direction.
4. **The Aggregatstatus pill has no known geometry** (§9.2) — the name appears in
   no export, and no configuration matching it exists in E1, E2, E3 or E4.
5. **Rotor frost protection** (§4) — no export carries a frost-protection value on
   the rotor. If the target unit has one, its position is undetermined.
6. **Rendered text metrics are not measured, and the two supplied readings are
   contradicted** (§7.2). `Tilluft` 32 px and `Avtrekk` 40 px disagree with Arial
   advance widths (26 and 37) and with production's 45 px `A-Alarm` / `B-Alarm`
   pitch, which is byte-identical across E1, E2 and E4 on two plants. Until the
   widths are measured at native scale, the validator estimates from Arial metrics
   and reports every width-dependent finding as a **warning** (`V-P08`), never an
   error. Mirrored in `documentation-rules.json` → `open_evidence[0]`.
7. **No minimum-gap value is established by production** (§8.5). The 4 px floor is
   advisory.
8. **Whether QD glyphs sit in the 3–5 px ualarm/filter overlap at native Designer render** is still screenshot-vs-export, not averaged. E29 JSON rectangles overlap; the screenshot said the alarm must not cover QD. `VC-T03` infos when `--source` is the canonical export.
9. *(closed — was: host JS 502 / `bacCheck` idempotence.)* Re-fetched `?t=9` on 2026-08-13. See §12.3.

### 12.2 Closed by E4

Recorded so a later revision does not reopen them from the old text.

| Was open | Closed by | Now in |
|---|---|---|
| The 13 px LED variant for LV402 was unknown — the family existed in the catalogue but no export placed one | E4 places `V3_led_13px_circ_grey_green` at (703, 460), `alias_text` "Status,-Electric heater run status" | §5.7, §9.1, `V-P05` |
| Whether the inlet dampers are recirculation dummies or production flow dampers | Both, in different revisions of the same AHU — E1/E2 dummies, E3 and E4 flow dampers | §5.9a / §5.9b, `V-P03` |
| Whether the outdoor-temperature block belongs on the fresh-air duct | Profile-scoped: (20, 301) in E1/E2, (16, 17) corner block in E4 — and E4 *also* carries a duct-mounted `RT901 °C` | §5.9b, `V-P04` |
| Five alarm coordinates that disagreed between the contract text and the fixture | E4 read directly | §10.2, `V-P06` |

### 12.3 Closed by live host JS (`?t=9`, 2026-08-13)

| Was open | Closed by | Now in |
|---|---|---|
| `addAlarmObject` offset, inherited fields, BACnet-mode trigger | Live `graphics_build.js:846-872` + `iw_popup_paramhandler.js:1087-1098`. Host default is to the **right** (`offsetWidth + 5`). Graphics path never creates an object. Trigger is `bacnetHandler.enabled`. | CLAUDE.md §13c; this file §10.2 |
| Whether `bacCheck` is idempotent | It is **not**. Always concatenates `.Ualarm`. `checkDriver` replaces the **first** `.Ualarm` only, and only in `load_new_ver_objects`. Container items skip it. | CLAUDE.md §13c, gotcha #27; `V-G09` |

## 13. Panel-type scope summary

**Read the scope column before copying the fact.** Only `VENT` rows generalize to
any AHU. A `PROFILE-9099-ROTOR-DEMO` row is enforceable **only** when that profile
is the selected template (§0.1); a `REF-9099` row describes the E1/E2 revision of
one unit; a `SCREENSHOT` row rests on a stated correction no image here verified.

| Fact | Scope |
|---|---|
| Canvas 1400×750, blank-sidebar background, no `image_svg`, 0 containers, 0 graphics | `VENT` |
| Extract run (24,200) 1025×18; centrelines y 209 / y 451, 242 px apart | `VENT` |
| Rotor `number_360_vg_rot` (282,149) 60×343 | `VENT` |
| Room `number_360_room` (1044,159) 100×339 | `VENT` |
| Sidebar headers 250×20 at x 1150; sections 1 and 2 at y 0 and y 165 | `VENT` |
| Setpoint boxes 62×22; columns x 1260 / x 1330; 25 px pitch; label at value y + 5 | `VENT` |
| Z bands 5 / 15 / 20 / 40 / 110 / 300 / 375 / 1100, never mixed with `default` | `VENT` |
| `°C` in `tag_text`, never `gr C` | `VENT` |
| A cluster is anchor + members + offsets, and moves whole (§0.2) | `VENT` |
| One alarm per guarded role, keyed on (parameter, component) | `VENT` |
| Connector suffix fixes which side of the target the box sits on (§6) | `VENT` |
| Third sidebar header y | **varies** — 357 (E1, E2), 400 (E3) |
| Bypass column at x 411 | `REF-9099` — absent from E3 |
| Every cluster offset in §5 unless a profile row below overrides it | `REF-9099` |
| Inlet dampers as `number_v3_dummy_resirc_damp_hor` (§5.9a) | `REF-9099` |
| Outdoor temp `numberV3_outside_temp` on the fresh-air duct at (20, 301) | `REF-9099` |
| Coil instrument codes (`RT410`/`RT510` versus `RT420`/`RT520`) | plant-specific |
| Fan alarm dx | **not stable** — 12, 45, 48 across three fans |
| Extract fan body (152, 179); alarm (197, 160) | `PROFILE-9099-ROTOR-DEMO` |
| Inlet dampers `V3_horis_damper_flow-left_nrm` (75,196) / `-right_nrm` (96,438), 36×26 (§5.9b) | `PROFILE-9099-ROTOR-DEMO` |
| `con_down` `KA501 %` (71,163) and `KA401 %` (93,405), 46×38, one per damper | `PROFILE-9099-ROTOR-DEMO` |
| Outdoor temp `numberV3_outside_temp` `RT001 °C` (16,17) 79×50, zIndex 110, corner block | `PROFILE-9099-ROTOR-DEMO` |
| Duct-mounted `con_down` `RT901 °C` (133,417) 46×38 | `PROFILE-9099-ROTOR-DEMO` |
| Seven alarm coordinates in §10.2 | `PROFILE-9099-ROTOR-DEMO` |
| Heating cluster: pump (601,527), 3-way valve (602,572), `SB510 %` (620,570) | `PROFILE-9099-ROTOR-DEMO` |
| LV402 run-status LED `V3_led_13px_circ_grey_green` 13×13 at (703, 460) | `PROFILE-9099-ROTOR-DEMO` |
| Cooling output as `number_v3_R_45px_con_top` (453, 532); no `Cool` caption | `PROFILE-9099-ROTOR-DEMO` |
| `Tilluft` x 1275, `Avtrekk` x 1341, rendered widths 32 / 40 | `SCREENSHOT` — contradicted, §7.2 and §12.1-6 |
| Aggregatstatus LED inside its pill | `SCREENSHOT`, geometry unknown, in no export |
