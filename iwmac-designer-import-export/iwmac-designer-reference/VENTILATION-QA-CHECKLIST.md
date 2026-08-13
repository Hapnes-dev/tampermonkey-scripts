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

## Stage 0 — Run the validator

Everything in stages A and B, plus the nine relationship checks below, is
implemented in [validate-ventilation-panel.py](validate-ventilation-panel.py).
Run it first; it is deterministic, dependency-free, and takes under a second.

```bash
python validate-ventilation-panel.py panel.json --profile PROFILE-9099-ROTOR-DEMO
python validate-ventilation-panel.py panel.json --profile PROFILE-BINARY-FILTER-BACNET \
  --sibling-sidebar sibling.json
python validate-ventilation-panel.py --compare SOURCE.json CANDIDATE.json \
  --patch-scope alarm-and-sidebar --profile PROFILE-BINARY-FILTER-BACNET
```

Drop `--profile` when no named profile is the template — the global rules still
run and only the profile-scoped `V-P*` rules are skipped. `--json` emits findings
as JSON. Exit code is non-zero when there is at least one error.

**Zero errors is the bar for delivery.** Warnings are read and explained, not
ignored: each is either a real finding or a known production quirk, and your
report must say which.

In the same pass, run the GLOBAL visual-correctness validator. The four
deliberate overlap classes are live-over-artwork; live-over-**text** is what it
rejects, and it checks state-value widths against allowed-values maps
([VISUAL-CORRECTNESS-CONTRACT.md](VISUAL-CORRECTNESS-CONTRACT.md)):

```bash
python validate-visual-correctness.py panel.json
```

### The nine relationship checks

These are the defects that structurally valid JSON still carries. Each row is
executable — the rule id is the implementation.

| # | Check | Rule | Fails when |
|---|---|---|---|
| 0.1 | **Duplicate role objects** | `V-G04`, `V-P07` | A caption duplicates a tag an equipment or value object already renders (`Cool`, `Rotor`, `VGV`, `Kurver`, `KA502`), or a role the profile deliberately omits is present — a second differential-pressure box beside a filter, a decorative rotor label |
| 0.2 | **Incomplete clusters** | `V-P01` | A cluster is missing a required member. The canonical case: `SB510 %` present with no circulation pump and no 3-way valve |
| 0.3 | **Connector-to-target attachment** | `V-G03` | A `con_*` value box sits on the wrong side of its target, or its connector edge does not meet the target's edge. `con_down` above · `con_top` below · `con_left` right · `con_right` left |
| 0.4 | **One alarm per guarded role** | `V-G05`, `V-P06` | Two bells guard the *same* component; a bell is detached from any component; a bell overlaps a caption; a profile alarm is off its recorded coordinate |
| 0.5 | **One KA value per damper** | `V-G07` | A `KA` position code appears on more than one object — the signature of a stale copy left behind by a move |
| 0.6 | **Sidebar uniqueness** | `V-G06` | A section, row label, header or value object is emitted twice, or two sidebar objects share a coordinate |
| 0.7 | **Sequential names** | `V-S03`, `V-S04` | Names are not `object_0…object_N`, have gaps or duplicates, or an object is missing one of the 17 fields |
| 0.8 | **Rendered text collisions** | `V-P08` | Two rendered glyph runs come within the 4 px floor. **Reported as a warning, never an error** — rendered widths here are estimates (stage C7) |
| 0.9 | **Degree-sign preservation** | `V-S09` | `°C` has been degraded to `gr C`, or the file does not decode as UTF-8 |
| 0.10 | **Binary vs numeric filter** | `V-P09`, `V-G08` | Diff-press object used where inventory is binary; filter does not intersect a duct; symbol stretched; no adjacent alarm |
| 0.11 | **BACnet ualarm integrity** | `V-G05`, `V-G09`, `V-P12` | `.Ualarm.Ualarm`; two ualarms on one component; generic+bacnet on the same role; ualarm on a sidebar setpoint/command; wrong base driver |
| 0.12 | **Unsupported live values** | `V-P10` | RT600/RT601/etc. remain when the case profile forbids them; empty `number_360_room` scaffold must still be kept |
| 0.13 | **Sibling sidebar geometry** | `V-P11` | Named sidebar roles do not match the sibling panel's `posLeft`/`posTop`/`posWidth`/`posHeight` |
| 0.14 | **Patch scope** | `V-C01`–`V-C05` | Unauthorized field or object changed; filter resized on a position-only move; filter moved without its alarm |
| 0.15 | **Idempotence** | helper + `V-G09` | Second BACnet conversion adds objects, doubles `.Ualarm`, or moves already-correct alarms |

Checks 0.2, 0.3 (profile-scoped variants), 0.4's coordinate half, and 0.8 require
`--profile`. Without it they do not run, and the panel is unverified on those
axes — say so rather than reporting a clean run.

**Two known-good duplications the validator deliberately allows.** `SB520 %`
appears twice in the canonical profile (cooling output and electric-heater
regulator power, different `alias_text`), which is why 0.5 is scoped to `KA`
codes and must not be widened to every tag string. And room-endpoint value
objects carry a single-space `tag_text` on purpose, with separate
`number_v3_label_8px_norm` captions. Neither is a defect.

---

## Stage A — Structural

Machine-checkable. **Stage 0 runs all of this** — the table is the human-readable
form, and the rule column says which check owns each row. Use the inline script
below only when the validator is unavailable.

| # | Check | Rule | Pass condition |
|---|---|---|---|
| A1 | The file parses | — | `json.loads` succeeds on the final text |
| A2 | Envelope | `V-S01` | `format` = `iwmac-designer-panel`, `version` = `1` |
| A3 | Counts match reality | `V-S02` | `counts.single_objects` = `len(panel.single_objects)`; same for `containers` and `graphics` |
| A4 | Sequential names | `V-S04` | `panel.single_objects[i].name` = `object_{i}` for every i, from `object_0`, no gaps |
| A5 | All ids exist | `V-G02` | every `obj_id` is a key in [reference_data/design-object-catalog.json](reference_data/design-object-catalog.json) → `objects` |
| A6 | All 17 fields | `V-S03` | every object has `obj_id, name, id, posWidth, posHeight, posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag, sub_group, driver_id, unit_id, unit_ref, alias_text` |
| A7 | Integer geometry | `V-S05` | all four position fields are integers, not floats or strings |
| A8 | Inside the canvas | `V-S05` | `0 ≤ posLeft`, `posLeft + posWidth ≤ panel_width`; same vertically |
| A9 | No `image_svg` | `V-S07` | `panel` has no `image_svg` key — **Ventilasjon never authors one** |
| A10 | Empty collections | `V-S07` | `containers` = `[]`, `graphics` = `[]` |
| A11 | Background | `V-S07` | `org_image_name` = `00-blank-sidebar-1400x750`, `background_embedded` = `true`, `image_data` present |
| A12 | No legacy V2 ids | `V-G02` | none of `alarm_anim.gif`, `number6`, `red_led_small`, or any other V2 id |
| A13 | UTF-8 | `V-S09` | the file decodes as UTF-8; `°` appears literally, not as `°`, `gr C`, or mojibake |
| A14 | No trailing prose | — | the output is one JSON object, nothing before `{` or after `}`, no comments |

> **A7 is stricter than the host.** The Designer parses geometry with `parseInt`,
> so it accepts `"120px"` and truncates `"196.5"` to 196. This contract requires
> plain integers anyway, because a value the host silently reinterprets is a value
> the next reader will misread.

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
| B12 | `con_top` boxes | top edge is at the **target's** bottom edge — the target is not always the duct (§6) |
| B13 | `con_down` boxes | bottom edge is at the target's top edge |
| B14 | Alarm count | one bell per guarded role, no duplicates, no decorative bells |
| B15 | No panel content in the sidebar band | schematic objects end before x 1150 |
| B16 | Sidebar objects on the sidebar | every sidebar object has `posLeft ≥ 1150` |
| B17 | One position value per damper | each `KA` code appears on exactly one object; no stale duplicate left by a move |
| B18 | Inlet damper family | matches the selected template — production flow dampers or recirculation dummies, not a mixture (§5.9a / §5.9b) |

**B10 is the check that catches the most damage.** A cluster missing one member
renders as an unlabelled fan or a coil with no temperature, which reads as a
different unit rather than as a defect.

**B14 is keyed on (parameter, component), not on the parameter alone.** A unit
with two like components legitimately repeats an alias: production reference E3
guards its extract and fresh-air dampers with two `Malf. damper` alarms 243 px
apart. Two different dampers are two different roles. Only two bells on the *same*
component are a duplicate.

---

## Stage C — Visual

**Render and look.** Stage A and B both pass on panels that are visibly wrong.

### C1. Full-panel render at 1400×750, native scale

No scaling, no thumbnail. Scaled renders hide 1–3 px collisions, which is the size
of most of the defects in this list.

**Preferred: the Designer itself.** Import the panel and look at it. That is the
only render that shows the real artwork, and nothing below replaces it.

**Offline fallback: `render-ventilation-panel.py`.** When the host is not
reachable — which is the normal case for an agent — this produces an HTML page
with every object drawn as its exact box at its exact coordinates, coloured by
z-index band, with the real tag text in the real font:

```
python render-ventilation-panel.py panel.json -o preview.html
```

Open it at a **1400×750 viewport at 100% zoom**, or the rendered extents mean
nothing. Two limits, both deliberate:

- **It cannot show artwork.** Sprites are served by the host and are not in this
  repository, so C11 and any judgement about symbol orientation or shading still
  need the real thing. Label anything produced this way as approximate.
- **It cannot place connector text exactly.** A plain label draws its tag at its
  own top-left and those glyph positions are exact. The `con_left`, `con_right`,
  `con_top` and `con_down` families inset their text past a connector stub whose
  width is recorded nowhere, so the script centres their text and draws it
  **brown**. A collision between two black runs is a finding; one involving a
  brown run is a question for the host, not a defect report. The `_tag_up_center`
  family is handled exactly — the id states both the direction and the alignment.

Guessing that inset would make the preview look authoritative while being wrong.
Leave it approximate and flagged.

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
| `V3_horis_damper_flow-left_nrm` / `-right_nrm` ∩ its inlet run | full duct height | The production flow damper overlays the run exactly as the dummy does (§5.9b) |
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

> **This check is advisory, and `V-P08` reports it as a warning — never an error.**
> The 32 px and 40 px readings are supplied values that no image here verified, and
> two independent checks contradict them: Arial advance widths at 11 px give 26 and
> 37, and production renders `A-Alarm` / `B-Alarm` on a **45 px pitch** at x 1305
> and 1350, byte-identical across E1, E2 and E4 on two different plants — which
> caps `A-Alarm` near 41 px, while scaling the model up to fit `Tilluft` at 32
> would make it 48 and put the pair in collision. Production renders that row on
> two plants, so it is evidence and the estimate is not.
>
> **Do not re-space a production row to satisfy this check.** Measure the rendered
> widths at native scale first; until then, a ±2 px miss is a note in your report,
> not a correction to the panel. Contract §7.2 and §12.1-6 carry the open item.

### C8. Every `°C` renders

Count the degree signs in the render and compare to the count in the JSON. A
mismatch means an encoding failure somewhere in the pipeline. Reference: 13 in the
9099 export, 8 in the smaller reference.

`gr C` appearing anywhere in the render is a defect.

### C9. Every LED is fully contained in its intended visual parent

| LED | Parent | Pass condition |
|---|---|---|
| LV402 run status | `number_v3_el_heater`, x 697…737, y 413…498 | `V3_led_13px_circ_grey_green` 13×13 at **(703, 460)**, offset (+6, +47) from the heater anchor; fully inside; does not cover the tag; **≥ 20 px** clear of the `SB520 %` box at y 493 (`V-P05`) |
| Aggregatstatus | its value pill | fully inside; does not cover the numeric value; visible right and vertical padding retained |
| A/B alarm | — | production places these **beside** the switch, not inside it — do not "fix" them into it |

**The superseded reading is (700, 466) with an unknown variant**, from the earlier
`SCREENSHOT` scope. E4 closed it: the object is
`V3_led_13px_circ_grey_green`, and its `alias_text` — "Status,-Electric heater run
status" — is what makes grey→green for running evidenced rather than inferred. A
panel still carrying (700, 466) is failing `V-P05`, not preserving history.

**It is a status indicator, not an alarm.** Do not add a bell here to "complete"
the cluster.

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

Twelve questions. Answer all twelve before emitting a single object. The
procedure that acts on the answers is
[VENTILATION-AUTHORING-GUIDE.md](VENTILATION-AUTHORING-GUIDE.md).

1. **Which of the four cases is this?** New demo · copy of a production layout ·
   modification of a supplied export · background artwork (which is refused —
   Ventilasjon has none). Say which, in the first line of the answer.
2. **Which export am I cloning?** Name the file. If there is none, say so
   explicitly — the panel is then invented, and every coordinate needs a reason.
3. **Have I retained an unmodified copy of it?** It is the restart point for a QA
   failure.
4. **Is a named profile the template?** If yes, the run must use `--profile`, and
   the `V-P*` rules apply. If no, say that the profile-scoped axes are unverified
   rather than reporting a clean run.
5. **Which rules here are `REF-9099` or `PROFILE-9099-ROTOR-DEMO` rather than
   `VENT`?** A scoped coordinate copied onto a different unit is a defect, not
   fidelity. `VENT` is the only tag that generalizes.
6. **Does this unit have a bypass leg?** If not, the entire x-411 column is
   omitted — one of the three exports has no bypass at all.
7. **Where is the third sidebar header in my source?** y 357 and y 400 both occur.
8. **How many sidebar value columns does each section need?** Two (x 1260 /
   x 1330) when the row carries a supply and an extract value; one (x 1329) with
   `number_v3_60px_dark_no_conn_no_tag` when the row label already names the
   signal.
9. **Am I emitting `°C` and not `gr C`?**
10. **Am I using z bands and not `"default"`, with no mixture?**
11. **Which overlaps in my panel are intentional?** List them before rendering. Any
    overlap not on the C5 list is a defect.
12. **Have I invented any instrument code, driver id, unit id, file path or panel
    target?** Codes come from the target plant's parameter inventory; positions
    come from the reference. Never the reverse. A gap you cannot close is recorded
    in your report and in contract §12 — it is never filled with a plausible
    number.
13. **Is this case 3?** If yes: is the patch based on the newest user-supplied
    JSON, compared by role not index, and inside a named `--patch-scope`?
14. **Filter: numeric Pa or binary guard?** Diff-press vs `number_v3_filter_only`.
    Cluster moved as one vector?
15. **BACnet ualarms: matrix applied, not every linked object?** Sidebar commands
    excluded? One indication per role? No `.Ualarm.Ualarm`?
16. **Sibling sidebar requested?** Geometry cloned by role, bindings preserved?
