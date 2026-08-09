# Ventilation geometry contract (360.NNN Ventilasjon)

Object-by-object geometry for an IWMAC Designer V5 ventilation panel, measured
from production exports. This file answers **where**, in pixels.
[DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) answers **which id**.
[AI-BRIEFING.txt](AI-BRIEFING.txt) answers **what shape the file has**.
[VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) answers **how it is verified**.

Every coordinate is a literal `posLeft`, `posTop`, `posWidth`, `posHeight` from a
real export. Nothing here is estimated, rounded, or averaged.

## How to read this file

**Source precedence.** When two sources disagree, take the higher rank. Never
average conflicting coordinates.

| Rank | Source |
|---|---|
| 1 | A panel JSON or screenshot supplied with the current task |
| 2 | A production export of the same panel type |
| 3 | Panel-specific rules in [CLAUDE.md](CLAUDE.md) |
| 4 | [AI-BRIEFING.txt](AI-BRIEFING.txt) |
| 5 | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |
| 6 | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| 7 | Generic visual-design advice |

**Every rule carries a scope tag.** Do not promote a tag by inference.

| Tag | Meaning |
|---|---|
| `GLOBAL` | Holds for every IWMAC Designer panel of any type |
| `VENT` | Holds for every Ventilasjon panel; confirmed in two or more independent production exports |
| `REF-9099` | Measured in the 9099 export family only. A different AHU may legitimately differ |
| `SCREENSHOT` | Derived from a visual correction stated in the task. **Not present in any export inspected here.** Outranks production under precedence rank 1, and is recorded as unverified |
| `ADVISORY` | Judgement or convention, not a measurement |

## Evidence base

| Alias | File | Objects | Distinct ids | Canvas | Background |
|---|---|---|---|---|---|
| **E1** | `iwmac-panel_9099_360-001-ventilasjon_recommended.json` (user Downloads, plant 9099, **not committed**) | 102 | 41 | 1400×750 | `00-blank-sidebar-1400x750`, embedded, 7 986 B |
| **E2** | [reference_data/real-vent-panel-example.json](reference_data/real-vent-panel-example.json) | 102 | 41 | 1400×750 | same |
| **E3** | [reference_data/real-vent-panel-example-2.json](reference_data/real-vent-panel-example-2.json) | 92 | 39 | 1400×750 | same |

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
offsets, not the absolute positions, are the contract.

### 5.1 Extract fan — `REF-9099`

Anchor `V3_58px_fan_left_nrm` (187, 179) 59×59 z 40, tag `JV501`.

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Fan body | `V3_58px_fan_left_nrm`, `JV501` | 187 | 179 | 59 | 59 | 40 | (0, 0) |
| Airflow | `number_v3_R_60px_no_conn_tag_up_center`, `RF501 m3/h` | 185 | 140 | 62 | 22 | 110 | (−2, −39) |
| Motor output | `number_v3_R_45px_con_top`, `LR501 %` | 193 | 236 | 46 | 38 | 110 | (+6, +57) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 199 | 160 | 34 | 34 | 375 | (+12, −19) |

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

### 5.3 Extract filter — `REF-9099`

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Filter body | `numberV3_filter_with_diff_press`, `QD501 Pa` | 466 | 154 | 90 | 83 | 110 | (0, 0) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 527 | 108 | 34 | 34 | 375 | (+61, −46) |

Identical in E1 and E2.

### 5.4 Supply filter — `REF-9099`

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Filter body | `numberV3_filter_with_diff_press`, `QD401 Pa` | 171 | 397 | 90 | 83 | 110 | (0, 0) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 199 | 352 | 34 | 34 | 375 | (+28, −45) |

E2 places the same filter at x 189 with its alarm at (+8, −45). dy is stable, dx
is not.

**The filter carries its own differential pressure in `tag_text`.** Do not add a
separate value box for it — `VENT`, true in E1, E2 and E3.

### 5.5 Cooling coil — `REF-9099`

Anchor `number_v3_cooler_2-way` (456, 409) 38×132 z 40.

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Coil body | `number_v3_cooler_2-way` | 456 | 409 | 38 | 132 | 40 | (0, 0) |
| Caption | `number_v3_label_8px_norm`, `Cool` | 464 | 412 | 50 | 2 | 1100 | (+8, +3) |
| Alarm | `V3_R_34px_circular_alarm_nrm` | 457 | 379 | 34 | 34 | 375 | (+1, −30) |
| Coil temp, left of run | `number_v3_R_45px_con_right`, `RT510 °C` | 408 | 492 | 62 | 22 | 110 | (−48, +83) |
| Coil temp, right of run | `number_v3_R_45px_con_left`, `RT410 °C` | 485 | 494 | 62 | 22 | 110 | (+29, +85) |
| Cooling power | `number_v3_R_45px_no_conn_bott_center`, `SB520 %` | 452 | 532 | 46 | 22 | 110 | (−4, +123) |

### 5.6 Heating coil — `REF-9099`

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

> **Instrument codes are plant-specific; the positions are not.** E1 and E2 place
> the four coil temperatures at effectively the same coordinates but swap which
> loop is numbered 4xx and which 5xx: E1 has `RT510`/`RT410` on the cooler and
> `RT520`/`RT420` on the heater; E2 has exactly the reverse. Copy the **position**
> from the reference and the **code** from the target plant's parameter inventory.
> Never copy a code across plants because the coordinate matched.

### 5.7 Electric heater — `REF-9099`

Anchor `number_v3_el_heater` (697, 413) 40×85 z 40, tag `LV402`.
**Body bounds x 697…737, y 413…498.**

| Role | `obj_id` / tag | x | y | w | h | z | Offset |
|---|---|---|---|---|---|---|---|
| Heater body | `number_v3_el_heater`, `LV402` | 697 | 413 | 40 | 85 | 40 | (0, 0) |
| Regulator power | `number_v3_R_45px_no_conn_bott_center`, `SB520 %` | 694 | 493 | 46 | 22 | 110 | (−3, +80) |

E2 places the body at x 693 (bounds 693…733); E3 uses the same `obj_id` at
(459, 412) with tag `LI401`, on a different unit. **The 40×85 body size is stable
across all three; the x position is not.**

The heater body carries no alarm in any export.

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

### 5.9 Outside-air inlet and end dampers — `REF-9099`

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

E3 uses `V3_horis_damper_flow-left_nrm` / `-right_nrm` 36×26 at z 40 instead, on a
unit with no recirculation.

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

**Connector rule.** This is what makes the drawing read as ductwork:

- `number_v3_R_45px_con_down` (46×38) sits **above** a run, connector touching the
  duct from above. E1: `RT502 °C` (985, 175) over the extract run, `RT401 °C`
  (985, 417) over the supply run.
- `number_v3_R_45px_con_top` (46×38) sits **below** a run, its top edge at the
  duct's bottom edge. E1: `KA501 %` (24, 218) — duct bottom is y 218; `LR501 %`
  (193, 236).
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

## 9. LED placement — `SCREENSHOT`

Both rules below come from visual corrections stated in the task. **Neither
configuration exists in E1, E2 or E3**, so neither is production-verified here.

### 9.1 Equipment-body LED (LV402)

| Property | Value |
|---|---|
| Parent | `number_v3_el_heater`, bounds **x 697…737, y 413…498** |
| LED | 13×13 at **x 700, y 466** |
| LED bounds | x 700…713, y 466…479 |
| Interior margins | left 3 px, bottom 19 px, right 24 px, top 53 px |

Placement: **lower-left interior of the body.** Not centred over the tag, not
outside the body, and not overlapping the `SB520 %` output box below (which starts
at y 493 — the LED ends at y 479, a 14 px clearance).

`obj_id`: the 13 px LED family exists in the catalogue —
`V3_led_13px_circ_grey_red`, `_grey_green`, `_grey_yellow`, `_green_grey`,
`_red_grey`, and the `_int` and `_square` variants. Pick by state semantics:
grey→red for fault, grey→green for running. → *Evidence required*, §12: no export
inspected here places a 13 px LED, so the intended variant is unconfirmed.

### 9.2 Status pill LED (Aggregatstatus)

The LED must sit **fully inside** the Aggregatstatus value pill, must not cover
the numeric value, and must retain visible right and vertical padding.

→ *Evidence required*, §12. **No object in E1, E2 or E3 is captioned
`Aggregatstatus`.** The nearest production construct is the `Driftsmodus` row of
§8.2: a 230×20 `number_v3_custom_json_obj` pill at (1160, 36) whose A/B alarm LEDs
sit **outside** it, at x 1317 and 1362 against a pill ending at x 1390 — i.e.
production does *not* place those LEDs inside that pill. The requested layout is a
different design and the pill's geometry is unknown.

## 10. Alarms — `VENT`

- **Beside the guarded component, never over it.** Every one of the seven
  `V3_R_34px_circular_alarm_nrm` in E1 sits clear of its equipment body.
- **Never over a tag, a value or an equipment control.**
- **Checked at native rendering size**, 34×34 for the standard bell.
- **A repeated or decorative alarm is a defect.** E1 has exactly seven bells for
  seven guarded roles: extract fan, supply fan, extract filter, supply filter,
  rotor, cooling, heating frost. No bell appears twice.
- z `"375"` — above equipment (40) and values (110), below labels (1100).

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

## 12. Evidence required

Open questions this contract could not close from the material available.

1. **`iwmac-panel_9099_360-001-ventilasjon_20260809-1857.json` does not exist.**
   The named input is absent from Downloads, Documents and Desktop. The only 9099
   export on disk is `iwmac-panel_9099_360-001-ventilasjon_recommended.json`, used
   here as E1. If the 1857 export is a different revision, every `REF-9099` figure
   must be re-measured against it.
2. **No screenshots were supplied.** Every `SCREENSHOT` rule rests on the task's
   stated corrections, not on an image verified here. That covers §7.2's rendered
   text widths and §9's two LED placements.
3. **The 13 px LED variant for LV402 is unknown** (§9.1) — the family exists in the
   catalogue but no export places one.
4. **The Aggregatstatus pill has no known geometry** (§9.2) — the name appears in
   no export.
5. **Rotor frost protection** (§4) — no export carries a frost-protection value on
   the rotor. If the target unit has one, its position is undetermined.
6. **Rendered text metrics are not measured.** The 32 px and 40 px widths in §7.2
   are supplied values. There is no font-metric table for
   `number_v3_label_11px_norm`, so the centring formula cannot be applied to a
   third heading without measuring that heading's rendered width first.
7. **No minimum-gap value is established by production** (§8.5). The 4 px floor is
   advisory.

## 13. Panel-type scope summary

| Fact | Scope |
|---|---|
| Canvas 1400×750, blank-sidebar background, no `image_svg`, 0 containers, 0 graphics | `VENT` |
| Extract run (24,200) 1025×18; centrelines y 209 / y 451, 242 px apart | `VENT` |
| Rotor `number_360_vg_rot` (282,149) 60×343 | `VENT` |
| Room `number_360_room` (1044,159) 100×339 | `VENT` |
| Sidebar headers 250×20 at x 1150; sections 1 and 2 at y 0 and y 165 | `VENT` |
| Setpoint boxes 62×22; columns x 1260 / x 1330; 25 px pitch; label at value y + 5 | `VENT` |
| Z bands 5 / 15 / 20 / 40 / 110 / 300 / 375 / 1100 | `VENT` |
| `°C` in `tag_text`, never `gr C` | `VENT` |
| Third sidebar header y | **varies** — 357 (E1, E2), 400 (E3) |
| Bypass column at x 411 | `REF-9099` — absent from E3 |
| Every cluster offset in §5 | `REF-9099` |
| Coil instrument codes (`RT410`/`RT510` versus `RT420`/`RT520`) | plant-specific |
| Fan alarm dx | **not stable** — 12, 45, 48 across three fans |
| `Tilluft` x 1275, `Avtrekk` x 1341, rendered widths 32 / 40 | `SCREENSHOT` |
| LV402 LED 13×13 at (700, 466) | `SCREENSHOT` |
| Aggregatstatus LED inside its pill | `SCREENSHOT`, geometry unknown |
