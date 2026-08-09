# Ventilation panel QA checklist

Executable before a `360.NNN Ventilasjon` panel is handed over. Every check has a
pass condition that can be evaluated without judgement.

Geometry references point at
[VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md).

**Failure rule.** If any check in stage C fails, **restart from the retained
source export.** Do not patch the damaged derivative. A patched panel accumulates
compensating errors — a shortened duct, then a shifted damper to match, then a
moved value to clear the damper — and the third correction is no longer traceable
to the first defect.

Keep the source export unmodified for the whole session. It is the restart point.

---

## Stage A — Structural

Machine-checkable. Run before rendering anything.

| # | Check | Pass condition |
|---|---|---|
| A1 | The file parses | `json.loads` succeeds on the final text |
| A2 | Envelope | `format` = `iwmac-designer-panel`, `version` = `1` |
| A3 | Counts match reality | `counts.single_objects` = `len(panel.single_objects)`; same for `containers` and `graphics` |
| A4 | Sequential names | `panel.single_objects[i].name` = `object_{i}` for every i, from `object_0`, no gaps |
| A5 | All ids exist | every `obj_id` is a key in [reference_data/design-object-catalog.json](reference_data/design-object-catalog.json) → `objects` |
| A6 | All 17 fields | every object has `obj_id, name, id, posWidth, posHeight, posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag, sub_group, driver_id, unit_id, unit_ref, alias_text` |
| A7 | Integer geometry | all four position fields are integers, not floats or strings |
| A8 | Inside the canvas | `0 ≤ posLeft`, `posLeft + posWidth ≤ panel_width`; same vertically |
| A9 | No `image_svg` | `panel` has no `image_svg` key — **Ventilasjon never authors one** |
| A10 | Empty collections | `containers` = `[]`, `graphics` = `[]` |
| A11 | Background | `org_image_name` = `00-blank-sidebar-1400x750`, `background_embedded` = `true`, `image_data` present |
| A12 | No legacy V2 ids | none of `alarm_anim.gif`, `number6`, `red_led_small`, or any other V2 id |
| A13 | UTF-8 | the file decodes as UTF-8; `°` appears literally, not as `°`, `gr C`, or mojibake |
| A14 | No trailing prose | the output is one JSON object, nothing before `{` or after `}`, no comments |

```bash
python - <<'PY'
import json, pathlib, sys
p = pathlib.Path("panel.json")
d = json.loads(p.read_text(encoding="utf-8"))
env = d.get("envelope", d)              # committed refs wrap; live exports do not
pan = env["panel"]
objs = pan["single_objects"]
cat = json.loads(pathlib.Path("reference_data/design-object-catalog.json")
                 .read_text(encoding="utf-8"))["objects"]
F = ["obj_id","name","id","posWidth","posHeight","posLeft","posTop","zIndex",
     "tag_text","linked","link_name","link_tag","sub_group","driver_id",
     "unit_id","unit_ref","alias_text"]
bad = []
if env["counts"]["single_objects"] != len(objs): bad.append("A3 count mismatch")
for i, o in enumerate(objs):
    if o["name"] != f"object_{i}":       bad.append(f"A4 {i} {o['name']}")
    if o["obj_id"] not in cat:           bad.append(f"A5 {o['obj_id']}")
    miss = [f for f in F if f not in o]
    if miss:                             bad.append(f"A6 {o['name']} {miss}")
    for k in ("posLeft","posTop","posWidth","posHeight"):
        if not isinstance(o[k], int):    bad.append(f"A7 {o['name']} {k}")
if "image_svg" in pan:                   bad.append("A9 image_svg present")
if pan.get("containers") or pan.get("graphics"): bad.append("A10 not empty")
print("\n".join(bad) or "stage A pass")
PY
```

---

## Stage B — Geometry

Checked against the source export. No rendering needed.

| # | Check | Pass condition |
|---|---|---|
| B1 | Canvas | matches the source export; 1400×750 for new work |
| B2 | Z bands | every `zIndex` is one of `"5"`, `"15"`, `"20"`, `"40"`, `"110"`, `"300"`, `"375"`, `"1100"` — and **`"default"` appears zero times.** A mixture of bands and `"default"` stacks unpredictably |
| B3 | Duct runs | extract (24, 200) 1025×18; supply run split matches the source; centrelines y 209 and y 451 |
| B4 | Rotor | `number_360_vg_rot` at (282, 149) 60×343 |
| B5 | Room | `number_360_room` at (1044, 159) 100×339 |
| B6 | Sidebar headers | `number_v3_header_grey75` 250×20 at x 1150; y 0 and y 165; third header y taken from the source |
| B7 | Fan setpoint columns | boxes 62×22 at x 1260 and x 1330; pitch 25 px; label y = value y + 5 |
| B8 | Temperature column | boxes 62×22, `_no_conn_no_tag`, pitch 25 px |
| B9 | Bypass cluster | if present: all six objects at the §3 offsets from the anchor; the duct column continuous y 211…449 |
| B10 | Cluster integrity | every cluster in §5 is complete — no fan without its airflow value, no coil without its temperatures |
| B11 | Cluster offsets | each member's offset from its anchor matches §5 |
| B12 | `con_top` boxes | top edge is at the duct's bottom edge |
| B13 | `con_down` boxes | bottom edge is at the duct's top edge |
| B14 | Alarm count | one bell per guarded role, no duplicates, no decorative bells |
| B15 | No panel content in the sidebar band | schematic objects end before x 1150 |
| B16 | Sidebar objects on the sidebar | every sidebar object has `posLeft ≥ 1150` |

**B10 is the check that catches the most damage.** A cluster missing one member
renders as an unlabelled fan or a coil with no temperature, which reads as a
different unit rather than as a defect.

---

## Stage C — Visual

**Render and look.** Stage A and B both pass on panels that are visibly wrong.

### C1. Full-panel render at 1400×750, native scale

No scaling, no thumbnail. Scaled renders hide 1–3 px collisions, which is the size
of most of the defects in this list.

### C2. Zoomed crops

Render each region separately at native or greater scale:

| Crop | Region |
|---|---|
| Bypass column | x 350…520, y 180…480 |
| Heat recovery | x 260…420, y 130…570 |
| Lower equipment train | x 420…900, y 370…600 |
| Status og vendere | x 1145…1400, y 0…165 |
| Vifteregulering | x 1145…1400, y 160…360 |
| Temperaturregulering | x 1145…1400, y 350…470 |

### C3. Every visible text bounding box

For each object that renders text, check the **rendered glyphs** against every
neighbour.

**Do not use `posWidth`/`posHeight` for this.** Six labels in the production
export have `posHeight` 1 while rendering ~11 px of text; box arithmetic says they
collide with nothing. The check is on pixels.

Pass: no rendered glyph touches another rendered glyph, and no glyph is clipped by
its own container or by the canvas edge.

### C4. Every dynamic object against its neighbours

Value boxes, LEDs, alarm bells, pumps and valves — each fully visible, each
attached to the component it reports on.

### C5. No unintentional overlap

**Detection.** Two objects overlap when their rendered pixel extents intersect.

**Intentional overlaps — a closed list. Anything else is a defect.**

| Pair | Magnitude | Why |
|---|---|---|
| `exhaust_connector_up` ∩ `exhaust_pipe_vertical` | 7 px | The connector sockets into the pipe |
| `supply_pipe_vertical` ∩ `supply_connector_down` | 5 px | Same |
| `dummy_resirc_damp_vert` ∩ the duct column | full duct width | The damper overlays a continuous duct |
| `dummy_resirc_damp_hor` ∩ a horizontal run | full duct height | Same |
| `con_top` / `con_down` / `con_left` / `con_right` value box ∩ its duct | connector edge only | The connector is drawn to touch |
| Equipment body ∩ its duct run | body straddles the run | Coils and fans sit on the duct |
| An LED ∩ its equipment body | LED fully inside | §9 of the geometry contract |

**Never shorten a duct to resolve an overlap in this table.** The duct column is
continuous by design; the damper overlays it.

### C6. Connectors visibly join their ducts

Zoom on each `con_*` box. The connector stub must meet the duct edge with no gap
and no gratuitous overshoot. A stub pointing at empty canvas is a defect even
though every stage-A and stage-B check passed.

### C7. Labels are visually centred, not merely equal-width

`number_v3_label_11px_norm` renders **left-aligned from `posLeft`**. Equal
`posWidth` on two labels does not centre them.

For every heading that names a column: measure the rendered glyph run, compute its
centre, compare to the column centre.

| Heading | Column centre | Tolerance |
|---|---|---|
| `Tilluft` | 1291 | ±2 px |
| `Avtrekk` | 1361 | ±2 px |

Production places `Avtrekk` at x 1341, exactly `1361 − 40/2`. `Tilluft` at the
production x of 1276 is 1 px right of centre for a 32 px rendered width; the
corrected value is **1275**.

### C8. Every `°C` renders

Count the degree signs in the render and compare to the count in the JSON. A
mismatch means an encoding failure somewhere in the pipeline. Reference: 13 in the
9099 export, 8 in the smaller reference.

`gr C` appearing anywhere in the render is a defect.

### C9. Every LED is fully contained in its intended visual parent

| LED | Parent | Pass condition |
|---|---|---|
| LV402 status | `number_v3_el_heater`, x 697…737, y 413…498 | LED 13×13 at (700, 466); fully inside; lower-left; does not cover the tag; ≥ 14 px clear of the `SB520 %` box at y 493 |
| Aggregatstatus | its value pill | fully inside; does not cover the numeric value; visible right and vertical padding retained |
| A/B alarm | — | production places these **beside** the switch, not inside it — do not "fix" them into it |

### C10. Sidebar rows do not collide

Rendered-glyph separation between a row label and the value box below it: **≥ 4 px**.

Box-to-box separation in production is **0 px** — the label box bottom is exactly
the next value box top — so this check cannot be done on coordinates. It is a
render check.

If a row collides, the fix is usually the object choice, not the position: use
`number_v3_60px_dark_no_conn_no_tag` where the row label already names the signal,
so the box renders no caption of its own.

### C11. Compare to the source

Put the render beside the source screenshot or production export at the same
scale. Every production role present, in the same place, in the same reading
order.

**Object count is not the comparison.** A panel with every role at the right
coordinates is correct at 92 objects and at 102.

---

## Stage D — Linking and sanitization

Only for a panel derived from a production export.

| # | Check | Pass condition |
|---|---|---|
| D1 | Unlinked | every object: `linked` = `"false"` |
| D2 | Placeholders | `id` = `driver_id` = `"driver_id"` |
| D3 | Blank link fields | `link_name`, `link_tag`, `unit_id`, `unit_ref`, `sub_group` all `""` |
| D4 | Aliases preserved | `alias_text` byte-identical to the source |
| D5 | No source plant ids | no string matching a plant-parameter id such as `9099_OJEXHAUST_OJ_1_1_0_4_19` survives anywhere in the file |
| D6 | Plant id cleared | `source_plant_id` and `panel.plant_id` are `""` |
| D7 | No personal metadata | no `saved_by`, no session data, no token |
| D8 | Navigation | a `sub_page_*` object survives only if its target panel id is known in the destination plant; otherwise it is removed, not repointed |
| D9 | Nothing invented | no driver ID, unit ID, file path or panel target appears that was not in the source |

```bash
grep -oE '[0-9]{4}_[A-Z0-9_]+' panel.json | sort -u
```

Expected output: nothing. Any hit is a D5 failure.

---

## Stage E — Import and save warnings

| # | Check | Pass condition |
|---|---|---|
| E1 | The Insert flow accepts the file without an error toast | |
| E2 | No object renders as a broken `undefined`-class box | an unknown `obj_id` fails here even though stage A5 passed against a stale catalogue |
| E3 | The background appears | a missing background means `org_image_name` or `image_data` did not survive |
| E4 | Save round-trip | export the saved panel and re-run stage A; counts and names must still agree |

---

## Regression checklist — run before generating any new ventilation panel

Nine questions. Answer all nine before emitting a single object.

1. **Which export am I cloning?** Name the file. If there is none, say so
   explicitly — the panel is then invented, and every coordinate needs a reason.
2. **Have I retained an unmodified copy of it?** It is the restart point for a QA
   failure.
3. **Which rules here are `REF-9099` rather than `VENT`?** A reference-specific
   coordinate copied onto a different unit is a defect, not fidelity.
4. **Does this unit have a bypass leg?** If not, the entire x-411 column is
   omitted — one of the three exports has no bypass at all.
5. **Where is the third sidebar header in my source?** y 357 and y 400 both occur.
6. **Am I emitting `°C` and not `gr C`?**
7. **Am I using z bands and not `"default"`, with no mixture?**
8. **Which overlaps in my panel are intentional?** List them before rendering. Any
   overlap not on the C5 list is a defect.
9. **Have I invented any instrument code, driver id, unit id or panel target?**
   Codes come from the target plant's parameter inventory; positions come from the
   reference. Never the reverse.
