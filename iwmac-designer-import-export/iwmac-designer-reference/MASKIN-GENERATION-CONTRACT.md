# Maskin generation contract (machine room / CO₂ booster)

Object-by-object geometry, role inventory and binding semantics for an IWMAC
Designer V5 **Maskin** panel, measured from a production export. This file
answers **where**, in pixels, and **which role**.
[DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) answers **which id**.
[AI-BRIEFING.txt](AI-BRIEFING.txt) answers **what shape the file has**.
[MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) answers **how to build one**.
[MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) answers **how it is verified**.
[reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt)
answers **how the background artwork is drawn**.

Every coordinate is a literal `posLeft`, `posTop`, `posWidth`, `posHeight` from a
real export. Nothing here is estimated, rounded, or averaged.

## Routing — which file owns which question

| Question | File | Kind |
|---|---|---|
| What does the host do on Insert / Export / load? | [CLAUDE.md](CLAUDE.md) | normative |
| What shape is the file, what are the 17 fields? | [AI-BRIEFING.txt](AI-BRIEFING.txt) | normative |
| What is a Maskin panel, in one page? | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) | descriptive |
| Which `obj_id` exists, and what does it look like? | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) | generated |
| **Where does a Maskin object go, and what role does it play?** | **this file** | **measured** |
| How do I author, copy, edit or patch one? | [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) | procedural |
| How do I prove it is correct before delivering? | [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) | procedural |
| What do I paste into a Copilot system prompt? | [MASKIN-COPILOT-PREFLIGHT.md](MASKIN-COPILOT-PREFLIGHT.md) | normative, compact |
| The same rules as data | [documentation-rules.json](documentation-rules.json) → `panel_types.maskin`, `profiles.TEMPLATE-10229` | generated |
| The same rules as code | [validate-maskin-panel.py](validate-maskin-panel.py) | executable |
| How is the background drawn? | [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) | normative, artwork |
| **How do I remove background equipment and reroute a circuit?** | **this file, §17** — procedure in [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) §4b | **normative** |
| Do the pixels actually connect? | [maskin_raster_qa.py](maskin_raster_qa.py) · [maskin-visual-qa.py](maskin-visual-qa.py) | executable |
| Which Danfoss parameter is behind an alias? | [reference_data/maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json) | reference |

**There is one live owner per rule.** Where an older document states a Maskin
geometry, z-band or role fact, this file supersedes it, and the older text
carries a pointer rather than a copy.

## How to read this file

### Source precedence — normative

When two sources disagree, take the higher rank. **Never average conflicting
coordinates.** A supplied export becomes the geometric template.

| Rank | Source |
|---|---|
| 1 | A panel JSON or screenshot supplied with the current task |
| 2 | A production export of the same panel **and machine type** |
| 3 | **This file** — `MASKIN-GENERATION-CONTRACT.md` |
| 4 | Panel-specific rules in [CLAUDE.md](CLAUDE.md) |
| 5 | [AI-BRIEFING.txt](AI-BRIEFING.txt) or its accepted revision |
| 6 | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |
| 7 | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| 8 | Generic visual-design advice |

This is the same eight-rank list held machine-readably in
[documentation-rules.json](documentation-rules.json) → `source_precedence`, and
the same one [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md)
and [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md) use.
There is one list; this file does not define a second.

**The catalogue is rank 7 for a reason.** Its `width`/`height` are the *toolbox
defaults* an object is born with — they are not placement geometry, and several
Maskin objects are placed at a size the catalogue does not list. Use the
catalogue to decide **whether an `obj_id` exists**; use this file to decide
**where it goes and how big it is**.

**When evidence is missing, mark the gap and stop.** Do not invent a coordinate,
`obj_id`, driver id, unit id, parameter alias, file path, plant id or navigation
target. Unresolved questions go in §14, not into a plausible number.

### Scope tags

**Every rule carries a scope tag.** Do not promote a tag by inference.

| Tag | Meaning |
|---|---|
| `GLOBAL` | Holds for every IWMAC Designer panel of any type |
| `MASKIN` | Holds for Maskin panels. Confirmed on E9/E10 and consistent with the 39-panel fleet survey; a rule resting on E9 alone says so in its own evidence column |
| `TEMPLATE-10229` | Measured on the plant-10229 AK-PC 782A booster only. A different machine room may legitimately differ |
| `ADVISORY` | Judgement or convention, not a measurement |

`GLOBAL` and `MASKIN` generalize. **`TEMPLATE-10229` does not.** Placing a
`TEMPLATE-10229` coordinate on a different machine room without evidence is the
failure mode this tagging exists to prevent — and, today, **most of the geometry
in this file is `TEMPLATE-10229`**, because it rests on one export. Section 14
lists exactly what a second export would promote.

## 0. Profiles, clusters and rule ids

### 0.1 The profile registry

A **profile** is a complete, internally consistent set of geometry for one
machine-room configuration, evidenced by one file. Select exactly one before
placing anything, and say which one you selected.

| Profile | Evidence | Controller | Compressors | Gas cooler | Receiver | Heat recovery |
|---|---|---|---|---|---|---|
| `TEMPLATE-10229` | **E9 / E10** — [reference_data/maskin-10229-sanitized.json](reference_data/maskin-10229-sanitized.json) | AK-PC 782A | 3 MT + 3 LT, C1 VSD on each | yes | yes | yes |

One profile is declared today. It is the one in
[documentation-rules.json](documentation-rules.json) → `profiles.TEMPLATE-10229`
and the only value `validate-maskin-panel.py --profile` accepts.

[reference_data/generated-maskin-example.json](reference_data/generated-maskin-example.json)
(E11) is **not** a profile. It is an authored demo whose coordinates were
composed rather than measured — see §13.

### 0.2 Every component is an atomic cluster

A cluster is **an anchor, its members, and their offsets from that anchor**. The
offsets are the contract; the absolute positions are one instantiation of it.

- **Relocate a cluster with one translation vector applied to every member.**
- **A cluster is complete or it is a defect.** A compressor with a status strip
  and a capacity pill but no runtime pill fails cluster integrity even though
  every object in it is individually legal.
- **Never leave a member behind.**
- **Never copy a member the target does not have.** On E9 only C1 carries a VSD
  row. Cloning C1 to build a C4 imports a VSD row the machine does not have.

Machine-readable form: `panel_types.maskin.compressor_columns` and
`panel_types.maskin.required_roles` in
[documentation-rules.json](documentation-rules.json).

### 0.3 Validator rule ids

Every rule below is enforced by
[validate-maskin-panel.py](validate-maskin-panel.py). Three namespaces, and the
split matters: **`M-S*` and `M-G*` run on every panel, `M-P*` run only when a
profile is selected.** The namespaces mirror `V-S*`/`V-G*`/`V-P*` in the
ventilation validator; the numbers are independent.

| Id | Enforces | Sections |
|---|---|---|
| `M-S01` | Envelope shape, version, panel present | §1 |
| `M-S02` | `counts` equals array lengths | §1 |
| `M-S03` | All 17 object fields present | §1 |
| `M-S04` | Names sequential `object_0…object_N`, no gaps or duplicates | §1 |
| `M-S05` | Integer geometry, inside the canvas | §1 |
| `M-S06` | Explicit z bands, never mixed with `default` | §3 |
| `M-S07` | Background ownership: `converted`/`image_data`/`image_svg`, and **no `image_svg_trace` in authored output** | §2 |
| `M-S08` | Binding contract — demo placeholders, or production host literals | §10 |
| `M-S09` | UTF-8: `°C`, `m³`, Norwegian letters preserved | §1 |
| `M-S10` | No sanitization residue — personal identity, plant-prefixed names or driver ids, `NNN:NNN` unit ids | §10 |
| `M-G01` | Every `obj_id` exists in the generated palette | §4 |
| `M-G02` | Each z band carries only the object families that belong in it | §3 |
| `M-G03` | Setpoint pills use `number_v3_white_value_only`; measurements do not | §8 |
| `M-G04` | Compressor columns: complete clusters, consistent pitch, no invented VSD | §6 |
| `M-G05` | Duplicate alias / duplicate driver id reporting | §9 |
| `M-G06` | A claimed suction group carries its required readouts | §7 |
| `M-G07` | Value and setpoint pills are 50×20 | §4 |
| `M-P01` | Every profile role is present, once, with the profile's `obj_id` | §5 |
| `M-P02` | Profile coordinates and sizes | §5 |
| `M-P03` | Profile z-index per role | §3, §5 |
| `M-P04` | Roles the profile deliberately does not carry | §6 |
| `M-P05` | Profile canvas and background fingerprint | §1, §2 |

Two further namespaces are introduced by §16, and **only one of them is
validator-enforced**:

| Id | Enforces | Enforced by | Sections |
|---|---|---|---|
| `M-A01`…`M-A09` | Background artwork and raster compositing | **Not the validator.** [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) stage C and `tests/test_maskin_compressor_bank.py` | §16.1 |
| `M-A10`…`M-A19` | Equipment removal, circuit rerouting, background fill, crossings and junctions | **Not the validator.** QA stage C0, [maskin_raster_qa.py](maskin_raster_qa.py) via `tests/test_maskin_equipment_removal.py`, and [maskin-visual-qa.py](maskin-visual-qa.py) | §17 |
| `M-X01`…`M-X07` | The gaps that stop output instead of producing a guess | The agent, by reporting them | §17.11 |
| `M-C01`…`M-C06` | A candidate against the source it was derived from | `validate-maskin-panel.py --compare` | §16.3, §17.10 |

`M-A*` rules are about pixels. A panel JSON does not contain the artwork's
geometry — only a base64 blob — so no amount of JSON checking can decide whether
a pipe connects. The `M-A*` ids exist so that a render QA finding, a regression
test and a review comment can name the same rule; they are enforced by looking,
and by the raster fixture tests, never by `validate-maskin-panel.py`.

**`M-C06` is the exception in the other direction.** Object preservation during
an artwork-only edit is entirely a JSON question, so it is a validator rule —
`--patch-scope artwork-only` (§17.10).

Run it:

```bash
python validate-maskin-panel.py panel.json --profile TEMPLATE-10229
```

```bash
python validate-maskin-panel.py candidate.json --compare source.json candidate.json --patch-scope compressor-addition
```

**A clean validator run is a necessary condition, never a sufficient one.** The
validator cannot see the background artwork, so it cannot tell you that a value
pill landed on the drawn pill it belongs to. That is what §5 of
[MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) is for.

## Evidence base

| Alias | File | Objects | Distinct ids | Canvas | Background |
|---|---|---|---|---|---|
| **E9** | `iwmac-panel_10229_maskin_20260810-1033.json` (user Downloads, plant 10229, **not committed**) | 66 | 11 | 1400×750 | `10229_maskin_030626.png`, embedded, 123 966-char data URI, **plus a 2 241 097-char `image_svg_trace`** |
| **E10** | [reference_data/maskin-10229-sanitized.json](reference_data/maskin-10229-sanitized.json) — the sanitized `TEMPLATE-10229` fixture | 66 | 11 | 1400×750 | same `image_data`, byte-identical; trace dropped |
| **E11** | [reference_data/generated-maskin-example.json](reference_data/generated-maskin-example.json) — an authored demo, **not a geometry source** | 63 | 9 | 1400×750 | authored `image_svg`, 23 898 chars, 215 drawable elements |
| **E12** | [reference_data/maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json) — alias → Danfoss AK-PC parameter map | — | — | — | — |
| **E13** | [tests/fixtures/maskin-compressor-bank/](tests/fixtures/maskin-compressor-bank/) — miniature instrumented fixture | — | — | 96×64 | test instrumentation only |
| **E24** | `machine-room-demo-extra-mt-compressor-connected-pipes-matched-size.json` (user Downloads, **not committed**) — the delivered fourth-MT-compressor demo | 69 | — | 1400×750 | raster `image_data`, extended |
| **E25** | The 2026-08-11 equipment-removal editing session: three MT compressors added, then the internal heat exchanger removed and Liq. consumer rerouted to the receiver. **Observed, not committed** — the intermediate rasters were derivatives of a supplied panel and were discarded during the session | — | — | 1400×750 | raster `image_data`, damaged and repeatedly repatched |
| **E26** | [tests/fixtures/maskin-equipment-removal/](tests/fixtures/maskin-equipment-removal/) — instrumented removal/rerouting fixture | 5 | 4 | 96×64 | test instrumentation only |

**E9 is not committed.** It carries a live plant id (`10229`), 64 real
driver ids, a real unit id and a named author. **E10 is E9 with its bindings
replaced and nothing else touched** — geometry, `obj_id`, sizes, `zIndex`,
`tag_text`, `alias_text`, array order and the background raster are preserved
byte-for-byte. Every measurement in this file is reproducible from E10, which is
in the repository.

E9's envelope, verbatim:

```
format             iwmac-designer-panel
version            1                       (integer, not a string)
exported_at        2026-08-10T08:33:23.213Z
generator          IWDIE v1.7.0
source_plant_id    10229
panel_name         Maskin
panel_width        1400px                  (css string)
panel_height       750px
counts             {single_objects: 66, containers: 0, graphics: 0}
background_embedded true
panel.plant_id     10229
panel.org_image_name 10229_maskin_030626.png
panel.image_name   ""
panel.saved_by     (an IWMAC username - withheld; E10 blanks it)
panel.converted    "true"
panel.image_data   123 966 chars
panel.image_svg_trace 2 241 097 chars
```

**`E13` and `E26` are test instrumentation, not production geometry.** Their
96×64 canvases, their marker colours, `E13`'s `(+24,0)` compressor pitch and
`E26`'s pipe profiles, junction rectangles and background colour exist so a unit
test can assert on an exact pixel; none of them describes a real machine room.
Do not quote them as Maskin facts.

**`E25` is an observation, not an artifact.** It is the record of one editing
session's failure sequence, and §17 is grounded in it as *evidence from that
incident* — no coordinate, colour, thickness or count from it appears anywhere in
this file, because the intermediate rasters no longer exist to be measured.

**`E24` is an authored demo, not a measurement.** It is the delivered answer to
the recurring fourth-compressor request (§16), retained as the evidence behind
`M-A01`, `M-A08` and conflicts M-7/M-8, not as geometry to copy. What it
establishes, and nothing more: the three appended objects sit at `(315,289)`,
`(327,326)` and `(328,362)` against C3 MT's `(234,289)`, `(246,326)`,
`(247,362)` — a **uniform `(+81, 0)`** on all three members, inside `M-G04`'s
79–82 px range and consistent with `M-A01`; and all three carry
`alias_text: ""`, which `M-A08` now names as a defect.

### Mode discriminator — the literal `"driver_id"`

| File | Objects | Real driver ids | `"driver_id"` placeholder | Empty | `source_plant_id` |
|---|---|---|---|---|---|
| E9 | 66 | 64 | 0 | 2 | `10229` |
| E10 | 66 | 0 | 66 | 0 | `""` |
| E11 | 63 | 0 | 63 | 0 | `""` |

**A generated demo emits the literal string `"driver_id"`; a production export
never does.** An *unlinked* object in a real export carries an **empty**
`driver_id` — E9 has two of them (§9). The validator reads this to choose
between the demo binding contract and the production one, and the split is total
rather than statistical.

## 1. Canvas, composition and structure — `MASKIN` / `TEMPLATE-10229`

| Fact | Value | Scope | Evidence |
|---|---|---|---|
| Canvas | `panel_width "1400px"`, `panel_height "750px"` | `MASKIN` | E9, E10 |
| Single objects | 66 | `TEMPLATE-10229` | E9, E10 |
| Containers | 0 | `MASKIN` | E9, E10 |
| Graphics | 0 | `MASKIN` | E9, E10 |
| Distinct `obj_id` | 11 | `TEMPLATE-10229` | E9, E10 |
| Object names | `object_0 … object_65`, sequential, no gaps | `GLOBAL` | E9, E10 |
| Geometry bounds | left 15…1171, top 21…722; right edge max 1252, bottom edge max 742 | `TEMPLATE-10229` | E9, E10 |
| All 17 fields present | on all 66 objects | `GLOBAL` | E9, E10 |

**Match the plant, not the number.** 1400×750 is the fleet standard and the
Maskin standard; a supplied export that says otherwise outranks this row under
precedence rank 1.

**66 is this template, not a target.** The fleet survey in
[PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) puts the Maskin median at 59 objects
across 39 panels. Object count is justified against the selected template, role
by role — never count against count.

**Containers and graphics are empty on Maskin.** The one container-built panel
type is the list panel; see
[LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md).

**Encoding is UTF-8 and load-bearing** (`GLOBAL`). Write `°C`, never `gr C`;
`m³`, never `m3`; keep æ/ø/å. The Insert flow reads files as UTF-8 and
production panels carry these characters today.

## 2. Background ownership — `MASKIN`

**The background owns all artwork. Dynamic objects own live values and nothing
else.**

| The background draws | Dynamic objects draw |
|---|---|
| the enclosure, pipe runs and their function colours | the number inside a value pill |
| every equipment symbol — compressors, gas cooler, receiver, valves, pumps | the AK-PC status strip's live text |
| every static label and unit caption | the LED's live colour |
| **the empty white value pills** | the pump symbol's live state |
| **the darker grey setpoint pills** | the OK/alarm strip's live state |
| the grey information panel on the right | — |

Two prohibitions, both `MASKIN`:

- **Never bake a live number, state or colour into the background.**
- **Never draw a value box in artwork that a dynamic object will also render.**
  The drawn pill is empty by design; the object renders into it.

The artwork doctrine — canvas layout, the circuit colour code as *function*
(orange = HP/discharge, yellow = receiver/liquid, cyan = MT suction, blue = LT
suction), the Illustrator layer template, the PDF→AI→PNG workflow, and the
background-colour rule — lives in
[reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt).

**Background colour is not fixed by this contract**, `MASKIN`. Preserve the
background of a supplied production export unless the user explicitly asks for a
background change; when artwork is authored new, its background colour follows
the user's requirement or the production reference chosen for the job. A dark
Maskin is not a defect on colour grounds alone. Everything else in this section
holds at any background colour: background ownership, the empty pills, the
functional circuit colours, and objects landing inside the pills the artwork
draws.

### 2.1 The four background fields — `GLOBAL`

| Field | Who writes it | Meaning |
|---|---|---|
| `panel.converted` | host and export | `"true"` means `image_data` carries the background |
| `panel.image_data` | host and export | a `data:` URI of the raster background |
| `panel.image_svg` | **an AI author** | raw SVG text; validated by `iwdieValidateSvg` (must start `<svg`, carry a viewBox, no `<script>`) and converted on insert |
| `panel.image_svg_trace` | **the export, never a generator** | an automatic vector trace of the raster, supplied to an AI as **input**. `applyImportCore` deletes it before rendering |

Insert priority: **a background file picked in the dialog > `panel.image_svg` >
`panel.image_data`.**

**`image_svg_trace` is input, not output** (`GLOBAL`, `M-S07`). It is normal in a
host export — E9 carries 2 241 097 characters of it — and a defect in anything
authored or committed. E10 drops it, which is why the fixture is 161 166 bytes
instead of 2.5 MB. The validator reports it as an **error** on authored output
and a **warning** on a detected production export.

### 2.2 The `TEMPLATE-10229` background fingerprint — `TEMPLATE-10229`

`converted "true"`, `org_image_name "10229_maskin_030626.png"` (blanked in E10),
`image_data` 123 966 characters. `M-P05` checks the length so that a fixture
rebuilt from a different raster fails loudly instead of silently changing the
drawing every coordinate here is measured against.

## 3. Z-index bands — `MASKIN`

E9 uses **explicit numeric-string bands**, so array order does not affect
stacking on this panel.

| Band | Count | Object families |
|---|---|---|
| `110` | 2 | `number_v3_custom_json_obj`, `number_v3_60px_no_conn` |
| `360` | 9 | the AK-PC strips — `V3_akpc_772_781_781A_783_contr`, `V3_akpc_782A_suct`, `V3_akpc_783_781A_782A_cond` |
| `375` | 3 | `V3_ok_alarm_nrm`, `V3_led_13px_circ_grey_green`, `V3_21px_single_pump_grey_green_down` |
| `1000` | 1 | `V3_81x21_enebled_disabled_nrm` |
| `1100` | 51 | `number_v3_value_only`, `number_v3_white_value_only` |

`M-G02` enforces the band→family mapping; `M-S06` forbids mixing explicit bands
with `"default"` in one panel.

> ### ⚠️ Conflict M-1 — these are **not** the Ventilasjon bands
>
> [CLAUDE.md](CLAUDE.md) §"Z-index is load-bearing" lists `110` as value/setpoint
> boxes and `1100` as labels. **That statement is `VENT`-scoped.** On Maskin the
> mapping is close to inverted: `1100` is the value pills and `110` is the two
> json / no-connection boxes.
>
> **Decision: both readings are recorded, neither is averaged, and the bands are
> declared per panel type.** Carrying a vent band onto a Maskin panel puts every
> value pill underneath the artwork. Recorded machine-readably at
> `panel_types.maskin.z_indexes.conflict`.

`"default"` is legal (`GLOBAL`) — the userscript fills it in when `zIndex` is
missing — **but then array order *is* stacking order.** A panel is one or the
other. E11 is entirely `"default"`; E9/E10 are entirely explicit.

## 4. Object vocabulary — `TEMPLATE-10229`

Eleven ids, 66 placements. Every one exists in
[reference_data/all-design-objects.json](reference_data/all-design-objects.json)
(`M-G01`).

| `obj_id` | n | Size | z | Role |
|---|---|---|---|---|
| `number_v3_value_only` | 44 | 50×20 | 1100 | the measurement pill — every live number |
| `number_v3_white_value_only` | 7 | 50×20 | 1100 | the setpoint / reference pill (§8) |
| `V3_akpc_772_781_781A_783_contr` | 6 | 81×21 | 360 | compressor status strip ("Manuel"/auto state) |
| `V3_akpc_782A_suct` | 2 | 81×21 | 360 | suction-group control status strip |
| `V3_akpc_783_781A_782A_cond` | 1 | 81×21 | 360 | condenser control status strip |
| `V3_ok_alarm_nrm` | 1 | 61×21 | 375 | the OK / alarm strip |
| `V3_81x21_enebled_disabled_nrm` | 1 | 81×21 | 1000 | heat-recovery enable/disable strip |
| `V3_led_13px_circ_grey_green` | 1 | 13×13 | 375 | the `V3hr` heat-recovery valve LED |
| `V3_21px_single_pump_grey_green_down` | 1 | 21×21 | 375 | the heat-recovery pump |
| `number_v3_custom_json_obj` | 1 | 40×20 | 110 | `Hr pump speed` — sits on a tan pill, not a white one |
| `number_v3_60px_no_conn` | 1 | 62×22 | 110 | `u17 Ther Air` — the no-connection box in the information panel |

**Pill size is 50×20 and it is a rule** (`M-G07`, `MASKIN`): all 51 value and
setpoint pills are exactly 50×20. The two 110-band boxes are deliberately
different objects at different sizes because the artwork under them is different
— **verified visually**: `Hr pump speed` sits on a distinctly tan drawn pill and
`u17 Ther Air` sits inside the information panel, not on a white pill.

**Do not substitute a generic value box for a purpose-built object.** E11
substituted `number_v3_value_only` for both 110-band ids (§13). Both
substitutions are legal palette entries — which is the point: passing the
id-exists check is not the same as matching the template's vocabulary, and the
id-exists check is the only one an agent usually remembers to run.

## 5. Role inventory — `TEMPLATE-10229`

Eight operational roles, 66 objects, no object outside a role. Coordinates are
literal `posLeft,posTop` and sizes literal `posWidth×posHeight`.

**Compare panels by role key — `obj_id` + `alias_text` + `tag_text` — never by
array index.** Two exports of the same panel routinely order `single_objects`
differently; an index-wise diff reports differences that are not real. This is
the same lesson the ventilation contract learned from E1 vs E2.

### 5.1 MT compressor column — 10 objects

| Alias | `obj_id` | Position | Size | z |
|---|---|---|---|---|
| `C1 MT status` | `V3_akpc_772_781_781A_783_contr` | (73,289) | 81×21 | 360 |
| `C2 MT status` | `V3_akpc_772_781_781A_783_contr` | (152,288) | 81×21 | 360 |
| `C3 MT status` | `V3_akpc_772_781_781A_783_contr` | (234,289) | 81×21 | 360 |
| `C1 MT capacity` | `number_v3_value_only` | (86,326) | 50×20 | 1100 |
| `C2 MT capacity` | `number_v3_value_only` | (167,325) | 50×20 | 1100 |
| `C3 MT capacity` | `number_v3_value_only` | (246,326) | 50×20 | 1100 |
| `C1 MT Runtime total` | `number_v3_value_only` | (86,362) | 50×20 | 1100 |
| `C2 MT Runtime total` | `number_v3_value_only` | (167,362) | 50×20 | 1100 |
| `C3 MT Runtime total` | `number_v3_value_only` | (247,362) | 50×20 | 1100 |
| `C1 MT VSD 1 speed` | `number_v3_value_only` | (87,403) | 50×20 | 1100 |

### 5.2 LT compressor column — 10 objects

| Alias | `obj_id` | Position | Size | z |
|---|---|---|---|---|
| `C1 LT status` | `V3_akpc_772_781_781A_783_contr` | (72,614) | 81×21 | 360 |
| `C2 LT status` | `V3_akpc_772_781_781A_783_contr` | (152,614) | 81×21 | 360 |
| `C3 LT status` | `V3_akpc_772_781_781A_783_contr` | (232,615) | 81×21 | 360 |
| `C1 LT capacity` | `number_v3_value_only` | (87,651) | 50×20 | 1100 |
| `C2 LT capacity` | `number_v3_value_only` | (167,651) | 50×20 | 1100 |
| `C3 LT capacity` | `number_v3_value_only` | (246,651) | 50×20 | 1100 |
| `C1 LT Runtime total` | `number_v3_value_only` | (87,687) | 50×20 | 1100 |
| `C2 LT Runtime total` | `number_v3_value_only` | (167,687) | 50×20 | 1100 |
| `C3 LT Runtime total` | `number_v3_value_only` | (246,687) | 50×20 | 1100 |
| `C1 LT VSD 1 speed` | `number_v3_value_only` | (87,722) | 50×20 | 1100 |

### 5.3 MT suction group — 9 objects

| Alias | `obj_id` | Position | Size | z |
|---|---|---|---|---|
| `Sd-MT` | `number_v3_value_only` | (55,191) | 50×20 | 1100 |
| `Control status MT` | `V3_akpc_782A_suct` | (1171,210) | 81×21 | 360 |
| `Suction ref. To-MT` | `number_v3_white_value_only` | (580,233) | 50×20 | 1100 |
| `Suction temp. To-MT` | `number_v3_value_only` | (581,257) | 50×20 | 1100 |
| `Suction temp. To-MT` **(duplicate alias, §9)** | `number_v3_value_only` | (626,257) | 50×20 | 1100 |
| `Superheat MT` | `number_v3_value_only` | (588,298) | 50×20 | 1100 |
| `Ss-MT` | `number_v3_value_only` | (589,325) | 50×20 | 1100 |
| `Running capacity MT` | `number_v3_value_only` | (15,326) | 50×20 | 1100 |
| `Requested cap. MT` | `number_v3_value_only` | (15,361) | 50×20 | 1100 |

### 5.4 LT suction group — 9 objects

| Alias | `obj_id` | Position | Size | z |
|---|---|---|---|---|
| `Control status LT` | `V3_akpc_782A_suct` | (1171,238) | 81×21 | 360 |
| `Sd-LT` | `number_v3_value_only` | (424,504) | 50×20 | 1100 |
| `Suction ref. To-LT` | `number_v3_white_value_only` | (511,557) | 50×20 | 1100 |
| `Suction temp. To-LT` | `number_v3_value_only` | (511,582) | 50×20 | 1100 |
| `To opt. offset LT` | `number_v3_value_only` | (557,582) | 50×20 | 1100 |
| `Superheat LT` | `number_v3_value_only` | (519,623) | 50×20 | 1100 |
| `Ss-LT` | `number_v3_value_only` | (518,649) | 50×20 | 1100 |
| `Running capacity LT` | `number_v3_value_only` | (16,651) | 50×20 | 1100 |
| `Requested cap. LT` | `number_v3_value_only` | (16,687) | 50×20 | 1100 |

**The MT and LT suction rows are not mirror images.** The MT row's second pill
carries the alias `Suction temp. To-MT` a second time; the LT row's second pill
carries `To opt. offset LT`. The artwork labels both second pills "To offset".
That asymmetry is a measured anomaly, not a licence to rename either one — §9.

### 5.5 Heat recovery — 10 objects

| Alias | `obj_id` | Position | Size | z | `tag_text` |
|---|---|---|---|---|---|
| `HR Consumer request` | `number_v3_white_value_only` | (367,23) | 50×20 | 1100 | `''` |
| `Hr reference` | `number_v3_white_value_only` | (428,22) | 50×20 | 1100 | `''` |
| `Shr8` | `number_v3_value_only` | (430,59) | 50×20 | 1100 | `''` |
| `Shr4` | `number_v3_value_only` | (474,59) | 50×20 | 1100 | `''` |
| `Hr pump running` | `V3_21px_single_pump_grey_green_down` | (560,21) | 21×21 | 375 | `' '` |
| `Shr3` | `number_v3_value_only` | (578,59) | 50×20 | 1100 | `''` |
| `Hr pump speed` | `number_v3_custom_json_obj` | (583,21) | 40×20 | 110 | `' '` |
| `V3hr` | `V3_led_13px_circ_grey_green` | (596,85) | 13×13 | 375 | `''` |
| `Shr2` | `number_v3_value_only` | (644,70) | 50×20 | 1100 | `''` |
| `Hr enable` | `V3_81x21_enebled_disabled_nrm` | (1169,325) | 81×21 | 1000 | `''` |

`Hr enable` sits in the right-hand information panel with the other status
strips, not on the heat-recovery artwork. Role membership follows the *parameter*,
not the pixel neighbourhood.

### 5.6 Receiver — 3 objects

| Alias | `obj_id` | Position | Size | z |
|---|---|---|---|---|
| `Prec reference` | `number_v3_white_value_only` | (814,373) | 50×20 | 1100 |
| `Prec` | `number_v3_value_only` | (814,398) | 50×20 | 1100 |
| `Vrec OD` | `number_v3_value_only` | (761,479) | 50×20 | 1100 |

`Prec reference` and `Prec` are vertically stacked 25 px apart in one column —
**the setpoint above its measurement**, which is the drawn arrangement the
artwork labels `Ref` / `Prec bar`.

### 5.7 High pressure / gas cooler — 13 objects

| Alias | `obj_id` | Position | Size | z |
|---|---|---|---|---|
| `Sc3` | `number_v3_value_only` | (840,47) | 50×20 | 1100 |
| `Cond. capacity` | `number_v3_value_only` | (904,47) | 50×20 | 1100 |
| `Cond. requested cap.` | `number_v3_value_only` | (969,47) | 50×20 | 1100 |
| `Cond. ctrl.` | `number_v3_white_value_only` | (1017,46) | 50×20 | 1100 |
| `Pc` | `number_v3_value_only` | (56,72) | 50×20 | 1100 |
| `Sgc` | `number_v3_value_only` | (1017,72) | 50×20 | 1100 |
| `Tc` | `number_v3_value_only` | (54,103) | 50×20 | 1100 |
| `V3gc` | `number_v3_value_only` | (1065,156) | 50×20 | 1100 |
| `Cond. control status` | `V3_akpc_783_781A_782A_cond` | (1170,267) | 81×21 | 360 |
| `Shp` | `number_v3_value_only` | (1058,345) | 50×20 | 1100 |
| `Pgc reference` | `number_v3_white_value_only` | (1058,381) | 50×20 | 1100 |
| `Pgc` | `number_v3_value_only` | (1057,406) | 50×20 | 1100 |
| `Vhp OD` | `number_v3_value_only` | (938,412) | 50×20 | 1100 |

### 5.8 Alarm / IO — 2 objects

| Alias | `obj_id` | Position | Size | z | `tag_text` |
|---|---|---|---|---|---|
| `u17 Ther Air` | `number_v3_60px_no_conn` | (1169,58) | 62×22 | 110 | `' '` |
| `--- DI1 Alarm` | `V3_ok_alarm_nrm` | (1169,86) | 61×21 | 375 | `''` |

Both live in the right-hand information panel, and **both are the two objects
with an empty `driver_id`** in E9 (§9).

### 5.9 The right-hand status column — `TEMPLATE-10229`

Five objects share the information panel's left edge at **x ≈ 1169–1171**, in one
vertical column:

| y | Alias | `obj_id` |
|---|---|---|
| 58 | `u17 Ther Air` | `number_v3_60px_no_conn` |
| 86 | `--- DI1 Alarm` | `V3_ok_alarm_nrm` |
| 210 | `Control status MT` | `V3_akpc_782A_suct` |
| 238 | `Control status LT` | `V3_akpc_782A_suct` |
| 267 | `Cond. control status` | `V3_akpc_783_781A_782A_cond` |
| 325 | `Hr enable` | `V3_81x21_enebled_disabled_nrm` |

Pitch between the three control-status strips is 28–29 px. This column is where
the AK-PC strips live; the compressor status strips are on the artwork instead.

## 6. Compressor columns as clusters — `TEMPLATE-10229`

Each compressor is a cluster of **three required members plus one optional one**:

| Member | `obj_id` | Required |
|---|---|---|
| `status` | `V3_akpc_772_781_781A_783_contr` 81×21 z360 | **yes** |
| `capacity` | `number_v3_value_only` 50×20 z1100 | **yes** |
| `Runtime total` | `number_v3_value_only` 50×20 z1100 | **yes** |
| `VSD 1 speed` | `number_v3_value_only` 50×20 z1100 | only where the machine has a VSD |

Alias grammar: `C<n> <MT|LT> <status|capacity|Runtime total|VSD 1 speed>`.
`M-G04` parses it and reports an incomplete compressor.

### 6.1 Measured pitch — there is no single constant

| Row | C1→C2 | C2→C3 |
|---|---|---|
| MT status | (79,−1) | (82,1) |
| MT capacity | (81,−1) | (79,1) |
| MT runtime | (81,0) | (80,0) |
| LT status | (80,0) | (80,1) |
| LT capacity | (80,0) | (79,0) |
| LT runtime | (80,0) | (79,0) |

Horizontal pitch is **79–82 px**, vertical drift **−1…+1 px**. The variation is
hand placement in the Designer, not a grid — nothing in the host snaps.

**Do not "correct" the drift to a constant.** When you clone a compressor
column, reuse a measured vector from the same row; when you extend one, the
honest choice is the pitch of the neighbouring pair, and say which pair you used.

### 6.2 The VSD row is not universal — `TEMPLATE-10229`

On E9 **only C1 carries a VSD row**, on each of the two suction groups. C2 and
C3 are fixed-speed: status, capacity and runtime only. Confirmed visually — the
artwork draws the "VSD %" caption and its empty pill once per column, under C1.

Roles that are **absent by design** and must not be invented (`M-P04`):
`C2 MT VSD 1 speed`, `C3 MT VSD 1 speed`, `C2 LT VSD 1 speed`, `C3 LT VSD 1 speed`.

**Cloning C1 to build a C4 imports a VSD row the machine does not have.** Clone
C3 — the fixed-speed neighbour — unless the request says the new compressor is
variable-speed.

### 6.3 MT → LT translation — `TEMPLATE-10229`

The ten compressor roles translate from MT to LT by very nearly one vector:

| Role | Δ |
|---|---|
| `C1 * status` | (−1,325) |
| `C2 * status` | (0,326) |
| `C3 * status` | (−2,326) |
| `C1 * capacity` | (1,325) |
| `C2 * capacity` | (0,326) |
| `C3 * capacity` | (0,325) |
| `C1 * Runtime total` | (1,325) |
| `C2 * Runtime total` | (0,325) |
| `C3 * Runtime total` | (−1,325) |
| `C1 * VSD 1 speed` | (0,319) |

**The suction-group readouts do not share it.** `Sd` moves (369,313), `Ss`
(−71,324), `Suction ref.` (−69,324), `Superheat` (−69,325), `Control status`
(0,28) — because the LT circuit is drawn elsewhere on the artwork, not directly
below the MT circuit.

> ### ⚠️ Conflict M-2 — there is no panel-wide MT→LT vector
>
> It is tempting to read "≈(0,+325)" off the compressor rows and apply it to the
> whole panel. **That is wrong and would move seven suction readouts to empty
> artwork.** The compressor *columns* translate; the *panel* does not.
>
> **Decision: the vector is recorded per role, never per panel.** Machine-readable
> at `panel_types.maskin.role_translations_mt_to_lt.measured`.

## 7. Suction groups — required readouts — `TEMPLATE-10229`

A panel that claims a suction group carries that group's readouts. `M-G06`
checks the eight alias stems below against each declared group suffix (`MT`,
`LT`):

`Control status` · `Running capacity` · `Requested cap.` · `Suction temp. To-` ·
`Suction ref. To-` · `Superheat` · `Ss-` · `Sd-`

Both groups carry all eight on E9. The ninth object in each group is the second
"To offset" pill (§5.3, §5.4).

## 8. The setpoint pill rule — `MASKIN`

**`number_v3_white_value_only` is the setpoint / reference pill.
`number_v3_value_only` is the measurement pill.**

Measured on E9: **7 of 7** white pills carry a setpoint marker in their alias;
**0 of 59** measurement pills do.

| Marker | Matching aliases |
|---|---|
| `reference` | `Hr reference`, `Prec reference`, `Pgc reference` |
| `ref.` | `Suction ref. To-MT`, `Suction ref. To-LT` |
| `consumer request` | `HR Consumer request` |
| `ctrl.` | `Cond. ctrl.` |

**The marker is `consumer request`, not `request`.** `Requested cap. MT`,
`Requested cap. LT` and `Cond. requested cap.` are *measurements* — what the
controller is currently asking for — and they correctly use the measurement pill.
A `request` marker would misclassify all three.

**Visually confirmed**: the setpoint pills are drawn in a *visibly darker grey*
in the background artwork than the measurement pills, exactly as
[maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) specifies
("white pills drawn EMPTY — number objects render into them; dark grey pills =
setpoints"). The `Ref` / `Prec bar` pair on the receiver is the clearest example:
same column, 25 px apart, visibly different pill shades.

`M-G03` reports a mismatch as a **warning**, not an error — it is a naming
heuristic measured on one export, and a plant could legitimately name a setpoint
something else. Severity is declared in the rules file, not hard-coded.

## 9. Anomalies — recorded, not corrected — `TEMPLATE-10229`

Production is preserved as-is. Every finding below is carried verbatim into E10
and reported rather than fixed.

### 9.1 Three objects carry `tag_text = " "` (a single space)

`Hr pump speed` (object_48), `u17 Ther Air` (object_49), `Hr pump running`
(object_53). The other 63 objects carry `''`. **Do not normalise the space
away** when copying this template — it round-trips through the host, and E10
preserves it.

### 9.2 Two objects are `linked:"true"` with an empty `driver_id`

`--- DI1 Alarm` (object_24) and `u17 Ther Air` (object_49).

**This is host behaviour, not a defect.** `load_new_ver_objects` sets
`linked="true"` whenever `driver_id !== "driver_id"` — and an empty string is
not the literal placeholder, so an unlinked production object comes back marked
linked (V3scripts.js:514, [CLAUDE.md](CLAUDE.md) §5). The validator's production
binding contract accepts it.

Observed alongside it, without asserting a causal link: in the information panel
the artwork carries **example content** (`2,7 °C` in the tan box, `OK` in the
alarm strip) rather than the empty pill used everywhere else — and these are the
two objects with no binding behind them.

### 9.3 Duplicate alias and duplicate driver id — `Suction temp. To-MT`

Two objects at (581,257) and (626,257) share the alias `Suction temp. To-MT`,
and in E9 they shared one driver id (`…_206_7`).

**Artwork evidence:** the background draws two adjacent pills on that row,
captioned **"To °C"** and **"To offset"**. The LT row is drawn the same way — and
its second pill binds to `To opt. offset LT`. So the MT "To offset" pill is bound
to the suction temperature rather than to the offset parameter.

> **Decision: recorded as a measured anomaly. Not corrected here.**
> This file describes production; the fixture preserves production. Any
> corrective — rebinding the second MT pill to the MT offset parameter — is
> `ADVISORY`, belongs to the plant engineer, and requires the target plant's own
> parameter dump to name the driver id. **Never invent that driver id.**
>
> `M-G05` reports both the duplicate alias and the duplicate driver id as
> **warnings**, on E9, on E10 and on any copy — deliberately, so the anomaly stays
> visible instead of being silently inherited.

## 10. Linking and sanitization — `GLOBAL` unless noted

### 10.1 What a production export looks like

| Field | Value on E9 |
|---|---|
| `id` | the host literal `"driver_id"`, on all 66 |
| `link_name` | the host literal `"link_name"`, on all 66 |
| `link_tag` | `""`, on all 66 |
| `sub_group` | `""`, on all 66 |
| `unit_ref` | `""`, on all 66 |
| `unit_id` | `"000:060"` on 64, `""` on 2 |
| `linked` | `"true"` on all 66 (§9.2) |
| `driver_id` | `10229_AK3_AKC_0_60_0_<param>_<index>` on 64, `""` on 2 |
| `tag_text` | `''` on 63, `' '` on 3 |
| `alias_text` | 65 distinct values across 66 objects |

`id` and `link_name` are **host literals**, not bindings — the host writes them
and never reads them back as data. They are not sanitization targets.

### 10.2 alias_text is the link key — `MASKIN`

**On Maskin, `alias_text` IS the Danfoss parameter name.** `Pc`, `Sd-MT`,
`Running capacity MT`, `C2 LT capacity` are AK-PC parameter names, not free
captions. E12 resolved **64 of 64** objects on a fully linked production panel by
**exact alias string match**.

Consequences:

- **Relink by exact alias match. Never fuzzy, never positional.**
- **Never rename an alias to make it prettier.** A renamed alias is an unlinkable
  object.
- **alias_text survives sanitization.** Stripping it makes the fixture
  unrelinkable and destroys the role inventory.
- Unit numbers are plant-specific; alias names are the portable part. Relinking
  by alias is therefore also *the* way to move a Maskin picture between plants.

### 10.3 The sanitization contract — `GLOBAL`

Produce a committable fixture by **replacing bindings and preserving everything
that describes the drawing**.

| Replace | With |
|---|---|
| `envelope.source_plant_id` | `""` |
| `panel.plant_id` | `""` |
| `panel.saved_by` | `""` |
| `panel.org_image_name` | `""` |
| `panel.image_name` | `""` |
| `object.id` | `"driver_id"` |
| `object.driver_id` | `"driver_id"` |
| `object.linked` | `"false"` |
| `object.link_name` | `""` |
| `object.link_tag` | `""` |
| `object.unit_id` | `""` |
| `object.unit_ref` | `""` |
| `object.sub_group` | `""` |

| Preserve byte-for-byte | Drop |
|---|---|
| `obj_id`, `name`, `posLeft`, `posTop`, `posWidth`, `posHeight` | `panel.image_svg_trace` |
| `zIndex`, `tag_text`, `alias_text`, **array order** | |
| `panel.image_data`, `panel.converted`, `panel.panel_width`, `panel.panel_height` | |

Generator: [build-maskin-fixture.py](build-maskin-fixture.py). **Do not
hand-edit the fixture** — change the generator and regenerate.

`M-S10` then checks for residue the field list alone would miss: a dotted
personal identity (`firstname.lastname`), a plant-prefixed `org_image_name`,
`image_name` or `panel_name`, a plant-prefixed `driver_id`, and a `NNN:NNN`
`unit_id`. `copilot`, `user` and `""` are accepted authors.

### 10.4 The unlinked demo contract — `GLOBAL`

For generated output: `id` and `driver_id` are the **literal** `"driver_id"`,
`linked` is `"false"`, `link_name`/`link_tag`/`unit_id`/`unit_ref`/`sub_group`
are empty, `source_plant_id` and `panel.plant_id` are empty, and `alias_text`
carries a **real** Danfoss parameter name from E12 so the human can relink by
exact match afterwards.

**Never invent a driver id, unit id, plant id, parameter name or panel target.**
An invented id looks linked and is not.

## 11. Request classes — `GLOBAL`

**Classify the request before writing anything, and say which class you picked.**
Most bad Maskin output is a correctly executed answer to the wrong class.

| Class | Output | Background | Insert target |
|---|---|---|---|
| **1. New unlinked demo** | a full panel document, unlinked-demo contract on every object | author `image_svg`, or state that the background is supplied separately | empty canvas |
| **2. Linked copy with supplied parameters** | a full panel document keeping every supplied binding, driver-id **plant prefix** rewritten to the target plant | carry `panel.image_data` through unchanged | empty canvas |
| **3. Modification of a supplied export** | **the entire supplied document**, with only the requested objects changed or appended | unchanged | empty canvas |
| **4. Background-only patch** | `panel.image_data` (or `image_svg`) changed; `counts` all zero; `single_objects`, `containers`, `graphics` all empty | the new artwork | the existing populated canvas |

Rules that apply across the classes:

- **Insert JSON appends. It never clears the canvas** (`GLOBAL`,
  [CLAUDE.md](CLAUDE.md) §10.1). A full panel document belongs on an **empty**
  canvas unless duplication is intended. On a populated canvas, class 1–3 output
  duplicates every object.
- **The host renames every inserted object** from the live canvas child index, so
  absolute `object_N` values do not survive an append — only order and uniqueness
  matter.
- **In class 3 the supplied panel is the whole geometric template.** Every
  untouched object keeps every field byte-for-byte. Do not renumber, re-space,
  re-order or "tidy" anything the request did not name.
- **In class 2, never invent the target plant's prefix.** If it was not supplied,
  stop and ask.
- **Class 4 is the right answer whenever the canvas already carries its objects
  and only the artwork changes** — and it is the only class whose output is
  legitimately empty of objects.

## 12. Conflict decisions on record

| Id | Conflict | Decision |
|---|---|---|
| **M-1** | [CLAUDE.md](CLAUDE.md) z-bands (110 = values, 1100 = labels) vs E9 (1100 = values, 110 = json/no-conn) | Both recorded. The CLAUDE.md list is scoped `VENT`; the Maskin bands are scoped `MASKIN`. Bands are per panel type. **Not averaged.** §3 |
| **M-2** | Compressor rows translate MT→LT by ≈(0,+325); suction readouts do not | Vector recorded **per role**, never per panel. §6.3 |
| **M-3** | `image_svg_trace` present in E9 and forbidden in output | Severity is mode-dependent: **error** for authored output, **warning** for a detected production export. §2.1 |
| **M-4** | 66 objects (E9) vs a 59-object fleet median | Neither is a target. Object count is justified role by role against the selected template. §1 |
| **M-5** | `Suction temp. To-MT` appears twice, on a pill the artwork labels "To offset" | Recorded as a measured anomaly with artwork evidence; **not corrected**. Any corrective is `ADVISORY` and needs the plant's own dump. §9.3 |
| **M-6** | The DESIGN-OBJECT-CATALOG size for an id vs its measured placement size | The catalogue's sizes are toolbox defaults. **This file wins on placement geometry.** §Source precedence |
| **M-7** | "Relocate a cluster with ONE vector" (`M-A01`, preflight 9) vs the measured per-row pitch drift of §6.1 (C1→C2 is 79/81/81, C2→C3 is 82/79/80 — no single vector describes either pair) | §6.1 **measures what production drew**; it is not an instruction to reproduce the drift. **When extending a bank, one pitch from one named source pair applies to every member and to the artwork** — the artwork is a raster copy of one column at one offset, and the objects must land on it. Name the pair. `M-G04`'s 79–82 px range still accepts it. §16.1 |
| **M-8** | QA stage D requires `alias_text` on every object; a new compressor row whose Danfoss parameter is not in the link map has no evidenced alias, and E24 shipped all three new objects with `alias_text: ""` | **The alias is required and follows the `C<n> <MT\|LT> <role>` grammar** (`M-A08`). The alias is the relink key (§10.2) and the role name, not the plant's binding — E13 already uses `C4 MT status`. What stays unresolved is the **parameter**: no invented driver id, no invented unit, and the gap is reported (`M-A09`). An empty alias makes the object permanently unlinkable, which is a worse outcome than a stated gap. §16.1 |
| **M-9** | `M-A15` requires the crossed pipe to stay continuous **and** the bypass to be unbroken — and two orthogonal runs cannot both be continuous and disjoint in one raster layer | **Recorded, not averaged.** The convention is stated: the **foreground** circuit is carried over by the bypass, and the crossed circuit keeps its own continuity — interrupted by the bypass itself, inside one declared crossing window, and by nothing else. A background gap, a cleared corridor or a cleanup smear in that window is the defect. The connectivity check bridges the declared window and only the declared window. §17.6 |
| **M-10** | `M-A11` forbids erasing across mixed artwork; `M-A19` phase 4 removes a component that, on a dense drawing, always touches something | **Sequential, not contradictory.** The mask is a set of shapes, not a rectangle; phase 5 then restores protected neighbours from the retained original. Erase small, then restore — which is also why `M-A10` comes first. §17.3, §17.9 |
| **M-11** | `M-C06` reports object preservation, and an `alias_text` edit — the field most likely to be "tidied" during an artwork pass — is invisible to it | **Both behaviours kept.** `M-C06` pairs by role key, so an edit to `obj_id`, `alias_text` or `tag_text` leaves the panel as a dropped role and arrives as a stranger, reported by `M-C01`/`M-C02`. The rules are read together and both documents say so. §17.10 |

## 13. The negative example — why E11 is not a Maskin reference

[reference_data/generated-maskin-example.json](reference_data/generated-maskin-example.json)
(E11) is a legitimate worked example of **the unlinked-demo contract** and of
**`image_svg` authoring**. It is committed, it inserts cleanly, and its aliases
come from E12 so a later relink resolves them.

**It is not a geometry reference, and it must never be used as the template for a
Maskin panel.** Measured against `TEMPLATE-10229`, by role:

| Measure | E11 | E9 / E10 |
|---|---|---|
| Objects | 63 | 66 |
| Distinct `obj_id` | 9 | 11 |
| Background | authored `image_svg`, 23 898 chars, 215 drawable elements | the production raster, `image_data` 123 966 chars |
| `zIndex` | `"default"` on all 63 | explicit bands on all 66 |
| Roles missing | **3** — `C3 LT status`, `C3 LT capacity`, `C3 LT Runtime total` | — |
| Roles invented | **1** — `Liq. inj. status MT` | — |
| `obj_id` substitutions | **2** | — |
| Shared roles at the right coordinates | **0 of 62** | — |

The validator, run with the profile, reports **90 errors and 6 warnings**.

**What was lost, precisely:**

1. **An entire compressor.** The third LT compressor's status, capacity and
   runtime are absent. The LT bank reads as a two-compressor machine.
2. **A role that does not exist on this machine** was added: `Liq. inj. status
   MT`. An invented role is worse than a missing one — it will never link.
3. **Two purpose-built objects became generic value pills.** `Hr pump speed`
   (`number_v3_custom_json_obj`, 40×20) and `u17 Ther Air`
   (`number_v3_60px_no_conn`, 62×22) both became `number_v3_value_only` 50×20.
   Both substitutes are legal palette entries; neither matches the artwork
   underneath, which is a tan pill and an information-panel box respectively.
4. **Every shared role moved.** Not one of the 62 roles present in both files
   sits at the template's coordinates. Displacement, matched by role and paired
   optimally: **median 23.2 px, mean 36.6 px, max 157.7 px; 41 of 62 roles more
   than 20 px out, 13 more than 50 px.** Horizontal error spans −111…+145 px,
   vertical −62…+35 px.
5. **Background ownership was inverted.** E11 authors its own SVG; the production
   panel's artwork *is* the reference, and every value pill is positioned to land
   inside a pill drawn in that artwork. Authored artwork plus composed
   coordinates means nothing lands on anything.
6. **The z-index model was dropped.** All-`"default"` is legal, but it makes array
   order the stacking order — a different model from the one the template uses,
   and the two cannot be mixed.
7. **The binding semantics survived and are the one thing to copy.** E11's
   unlinked-demo contract and its E12-sourced aliases are correct. That is the
   part worth reusing.

**The general failure class**, stated without reference to any particular file:
*an authored demo composed from a role list, on authored artwork, at composed
coordinates, is not a substitute for a measured production export.* It will pass
JSON parsing, pass the `obj_id`-exists check, insert without an error, and still
be wrong in every position — because none of those checks can see the drawing.

> **A note on a claim this section does not make.** The task that produced this
> file described the failure as "a generic 12-object authored SVG demo". **No
> 12-object Maskin artifact exists in this repository.** E11 is 63 objects and
> its SVG carries 215 drawable elements. The failure class above is real and is
> documented from artifacts that exist; the specific 12-object file is not
> invented here. If such a file exists outside the repository, it is not
> evidence until it is supplied.

**E11's disposition:** kept, with its role narrowed. It is referenced as a demo
and binding example, and this section is linked wherever it is mentioned so no
reader mistakes it for a geometry source.

## 14. Evidence required

**A stated gap is acceptable; an invented fact is not.** These are open.

1. **A second Maskin production export, from a different plant.** Every geometry
   rule in §5–§7 currently rests on E9 alone and is therefore tagged
   `TEMPLATE-10229`. A second export is what would promote the shared facts to
   `MASKIN` — most importantly the right-hand status column's x ≈ 1170, the
   compressor pitch, and the 50×20 pill size.
2. **A Maskin panel with four or more compressors per suction group**, to confirm
   that the 79–82 px pitch continues rather than the column re-spacing.
3. **A Maskin panel whose VSD compressor is not C1**, to confirm that the VSD row
   is a per-compressor property rather than a C1-only drawing convention.
4. **Whether the duplicated `Suction temp. To-MT` binding is intentional.** §9.3
   records the artwork evidence that it is not, but confirming it needs the
   plant's own parameter dump, and correcting it is the plant engineer's call.
5. **Whether the information panel's filled example content** (`2,7 °C`, `OK`) is
   a deliberate artwork choice for unbound objects or a leftover. §9.2 records
   the observation without a causal claim.
6. **A Maskin panel drawn on a different controller family.** The AK-PC strip ids
   in §4 are recorded as measured; do not infer a controller model from a strip
   id, and do not assume another pack controller uses these ids.
7. **The Danfoss parameters behind a fourth compressor.** E12 carries C1–C3 MT
   and LT status / capacity / `Runtime total`, plus `VSD 1 speed` on C1 only —
   **63 signals, none of them C4.** The parameter-group anatomy in E12
   (`230+i` = Cᵢ status, `240+i` = Cᵢ capacity, `288–299` = runtimes) *suggests*
   the continuation, and suggesting is not evidence: whether a given plant's
   pack controller exposes a fourth compressor block, and under which alias
   spelling, is answered by that plant's own parameter dump. Until one is
   supplied, a fourth column is delivered with its `C4 …` role aliases
   (`M-A08`) and **unlinked**, and the gap is stated (`M-A09`). This is the
   linking gap E24 hit.
8. **The E25 rasters themselves.** §17 is grounded in an editing session whose
   intermediate images were derivatives and were not retained — which is the
   incident's own first finding (`M-A10`). Every rule there is stated from the
   observed failure sequence and exercised against the instrumented `E26`
   fixture; **none of it has been measured against the production raster it came
   from.** A retained before/after pair from one real removal would let the
   protection boundaries, the crossing convention and the background sample
   points be checked rather than reasoned.
9. **What a real Maskin's non-connected crossing actually looks like.** §17.6
   states the convention the drawing method's orthogonal style can express, and
   `E26` implements it. Whether production draws its liquid-over-suction
   crossings as a jog, as a line break, or not at all is **unmeasured**: no
   committed raster in this repository contains a documented crossing.
10. **A second raster with a measurably different header thickness.** `M-A03`
   rests on one panel in which the orange discharge header and the cyan suction
   header differ. That one observation is enough to forbid reusing a
   measurement across sources; it is not enough to state what either thickness
   *is* on any other panel, and this file therefore states neither.

## 15. Panel-type scope summary

| Rule | Scope |
|---|---|
| 17 object fields, sequential names, integer geometry, UTF-8 | `GLOBAL` |
| Insert appends; the host renames from the canvas child index | `GLOBAL` |
| `linked:"true"` on an empty `driver_id` is host behaviour | `GLOBAL` |
| The literal `"driver_id"` is the demo/production discriminator | `GLOBAL` |
| The sanitization contract and the unlinked-demo contract | `GLOBAL` |
| Canvas 1400×750; containers and graphics empty | `MASKIN` |
| The background owns all artwork including the empty pills | `MASKIN` |
| `image_svg_trace` is input, never output | `GLOBAL` |
| Z bands 110 / 360 / 375 / 1000 / 1100 with their families | `MASKIN` |
| `number_v3_white_value_only` marks a setpoint | `MASKIN` |
| Pills are 50×20 | `MASKIN` |
| `alias_text` is the Danfoss parameter name; relink by exact match | `MASKIN` |
| Every coordinate in §5 | `TEMPLATE-10229` |
| Compressor pitch 79–82 px and the MT→LT role vectors | `TEMPLATE-10229` |
| 3 MT + 3 LT compressors, VSD on C1 only | `TEMPLATE-10229` |
| The three `' '` tag_texts and the duplicate MT alias | `TEMPLATE-10229` |
| Rebinding the second MT "To offset" pill | `ADVISORY` |
| One translation vector for artwork and objects (`M-A01`) | `MASKIN` |
| Compositing never multiplies source alpha (`M-A02`) | `GLOBAL` |
| Every source line remeasured independently (`M-A03`, `M-A04`) | `GLOBAL` |
| No dynamic object without its drawn anchor (`M-A06`) | `MASKIN` |
| Restart from the retained original after a visual failure (`M-A07`) | `GLOBAL` |
| A new role carries its grammar alias; the parameter gap is reported (`M-A08`, `M-A09`) | `MASKIN` |
| Retain the original raster; restart from it, never patch a damaged derivative (`M-A10`) | `GLOBAL` |
| Protected components are enumerated before any erase, and restored from source (`M-A11`) | `MASKIN` |
| Transparency is not a background colour; flatten only confirmed background pixels (`M-A12`) | `MASKIN` |
| No cleanup residue — no foreign colour and no unmeasured alpha in an edited area (`M-A13`) | `GLOBAL` |
| The circuit-routing inventory is written before pixels change (`M-A14`) | `MASKIN` |
| A non-connected crossing carries a visible bypass in the foreground circuit's style (`M-A15`) | `MASKIN` |
| Thickness and alpha come from the adjacent source run, never from a generic width (`M-A16`) | `GLOBAL` |
| Every junction the edit touched is enumerated and checked (`M-A17`) | `MASKIN` |
| Changes outside the documented edit masks are zero; scopes reported separately (`M-A18`) | `GLOBAL` |
| The phase order — retain, protect, inventory, remove, restore, draw, validate, render (`M-A19`) | `MASKIN` |
| Compare by role key against the source before delivering (`M-C*`) | `GLOBAL` |
| An artwork-only edit changes no Designer object field (`M-C06`) | `GLOBAL` |
| A named gap stops output rather than producing a guess (`M-X01`…`M-X07`) | `GLOBAL` |

## 16. Extending a compressor bank — artwork, raster and compare rules

§6 says what a compressor column **is**. This section says what happens when a
request adds one to a panel that already exists, because that is the request that
arrives, and because everything expensive about it happens in the background
raster, which no other section owns.

The request shape, verbatim and recurring: *a Maskin demo is generated, then an
extra fixed-speed MT compressor is asked for, then the background artwork is
asked to grow a compressor symbol, a discharge branch, a suction branch, status
artwork, static labels and empty value pills that connect to the headers already
drawn and match the source column exactly.* Evidence: **E24**.

### 16.1 Artwork rules — `M-A01`…`M-A09`

**None of these is checked by `validate-maskin-panel.py`** (§0.3). They are
enforced by a native-size render, by review, and by the raster regression tests
in `tests/test_maskin_compressor_bank.py`.

| Id | Rule |
|---|---|
| **`M-A01`** | **One measured translation vector.** The compressor symbol, the upper discharge branch, the lower suction branch, the status artwork, the static labels, the empty value pills **and the three dynamic objects** are placed with a single `(dx, dy)` measured once. Two vectors that differ by one pixel is a defect even when each is individually defensible. |
| **`M-A02`** | **Compositing must never multiply source alpha.** Copy each source pixel's alpha verbatim. A soft, feathered or anti-aliased mask multiplies it, and a uniformly scaled alpha is exactly what makes a clone look faded — every pipe, label and pill at once, which reads as a rendering problem rather than as the compositing bug it is. A mask is binary: a pixel is copied or it is not. |
| **`M-A03`** | **Every source line is remeasured independently** — row count, per-row RGBA, per-row alpha, thickness, anti-aliasing and junction geometry. The orange discharge header and the cyan suction header on the same panel are **not** the same thickness. Measuring one and reusing the number for the other is a guess wearing a measurement's clothes. |
| **`M-A04`** | **Reproduce every row the source has, including the faint ones.** An anti-aliased line is 3 rows — a full-alpha core with a partial-alpha row on each side — and reproducing the 2 visible rows produces a thinner, harder line that does not match its own header 10 px away. Copy the per-row alpha values, do not re-derive them. |
| **`M-A05`** | **A copied branch connects.** The new branch's endpoint meets the existing header pixel-for-pixel, with the junction geometry copied from the source junction. A gap is the single most visible artwork defect and the easiest to leave behind, because the branch itself looks right in isolation. |
| **`M-A06`** | **Artwork first, objects second.** No dynamic object is added before the artwork that draws its anchor exists. A status strip with no compressor under it, or a value pill on white background, is a defect — and it is invisible to the validator, which sees a perfectly well-formed object. |
| **`M-A07`** | **After a failed visual iteration, restart from the retained original.** Repeated edits to a derivative accumulate raster damage that no single step is responsible for. Keep the original source background; re-derive from it. Do not patch a chain of compensating edits. |
| **`M-A08`** | **A new role carries its alias.** The grammar is `C<n> <MT\|LT> <role>` (§6), and it applies even when the plant parameter behind the row is unknown: `alias_text` is the relink key (§10.2), so an object shipped with an empty alias can never be linked by anyone. Emitting `alias_text: ""` on a new compressor row is a defect. |
| **`M-A09`** | **An unresolved parameter is reported, never invented.** If the alias does not resolve in [maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json), say so, name the aliases, and deliver the panel unlinked. A stated linking gap is a valid deliverable; a plausible driver id is not (§10.3). |

**Why `M-A01` and the §6.1 pitch table do not conflict** — recorded as **M-7**.
§6.1 measures the production drift (79–82 px horizontally, −1…+1 px vertically,
different per row). That is a **measurement of what was drawn**, not an
instruction to reproduce the drift. When you *extend* a bank you take **one**
pitch from **one named source pair** and apply it to every member and to the
artwork, because the artwork is a raster copy of one column at one offset and
the objects must land on it. Say which pair you took it from. `M-G04` still
accepts the measured 79–82 px range, so a uniform pitch inside it passes.

### 16.2 What the delivered artwork must reproduce

Measured per source, never assumed. The list is the checklist, the values are
whatever *that* panel's own source column measures:

1. Compressor symbol — outline, fill, every internal detail, at the same size.
2. Discharge branch — row count, per-row RGBA, per-row alpha, and the junction
   into the discharge header.
3. Suction branch — the same, measured **separately**, against the suction
   header.
4. Status artwork under the strip.
5. Static labels — same glyph rendering, same anti-aliasing, same position
   relative to the symbol.
6. Empty value pills — **empty**. The background never draws a number (§2).

### 16.3 Compare rules — `M-C01`…`M-C05`

Class 3 says *preserve everything you were not asked to change* (§11). Nothing
in the single-document checks can see that: they judge the candidate alone, and
a candidate that quietly moved four pills passes every one of them. So the claim
"I changed only X" is **unproven** until this runs.

```bash
python validate-maskin-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope compressor-addition
```

| Id | Enforces |
|---|---|
| `M-C01` | An object present in the source is missing from the candidate — matched by role key, so ordering is not an excuse. Under `background-only`, the inverse: the patch must carry zero counts and three empty arrays |
| `M-C02` | What may be added, and what an addition must carry — under `compressor-addition`, complete compressor rows with grammar-conformant, non-empty `alias_text` (`M-A08`) |
| `M-C03` | Columns are atomic across the pair: no source column thinned, no new column incomplete, and **no optional row that no existing compressor on that side has** (the clone-C1 trap, §6.2) |
| `M-C04` | The declared `--patch-scope` held: every pre-existing object differs only within it. Without a scope the same differences are reported as warnings |
| `M-C05` | Background and canvas. Under `compressor-addition` a byte-identical background is an **error** — objects were added over artwork that does not draw them (`M-A06`) |

Patch scopes: `compressor-addition` (new complete columns, no field difference on
anything pre-existing, background must change), `background-only` (class 4: zero
counts, empty arrays, background must change), `position` (`posLeft`/`posTop`
only), `none` (field-identical).

**What `M-C05` cannot do:** it compares base64 lengths, not pixels. A background
that changed is not a background that changed *correctly*. `M-A01`–`M-A05` are
still decided by looking at a native-size render.

## 17. Removing static equipment and rerouting a circuit — `M-A10`…`M-A19`, `M-C06`

§16 owns *adding* a compressor column. This section owns the opposite request,
which arrives just as often and fails differently: **remove a piece of static
equipment from the drawing and route the circuit that fed it somewhere else.**
Everything expensive about it happens in the background raster, and none of it
is enforceable from a panel JSON.

The request shape, verbatim and recurring: *remove the internal heat exchanger
in the bottom-right line section and route the Liq. consumer line directly to
the receiver.* Evidence: **E25** — the 2026-08-11 editing session, in which that
one sentence produced nine distinct raster defects while every structural check
kept passing.

### 17.0 Which rules live here

| Id | Rule | Enforced by |
|---|---|---|
| `M-A10` | Source retention and restart discipline | review; the retained original is the input to `M-A18` |
| `M-A11` | The component protection boundary | `maskin_raster_qa.check_protected_regions`, `check_component_removed` |
| `M-A12` | The background-fill contract | `maskin_raster_qa.check_background_fill` |
| `M-A13` | No cleanup residue | `maskin_raster_qa.check_no_cleanup_residue` |
| `M-A14` | The circuit-routing inventory, written before pixels change | it is the input to every check below |
| `M-A15` | Crossing, bypass, junction, bend, termination | `maskin_raster_qa.check_crossings` |
| `M-A16` | Thickness and alpha acceptance | `maskin_raster_qa.check_pipe_profiles` |
| `M-A17` | The junction ledger and circuit connectivity | `maskin_raster_qa.check_junctions`, `check_connectivity` |
| `M-A18` | Pixel-diff scope | `maskin_raster_qa.check_diff_scope` |
| `M-A19` | Phase order | review; the order is the rule |
| `M-C06` | Object preservation during an artwork-only edit | `validate-maskin-panel.py --patch-scope artwork-only` |
| `M-X01`…`M-X07` | The gaps that stop output instead of producing a guess | §17.11 |

**`M-A10`–`M-A19` are not validator rules**, for the same reason `M-A01`–`M-A09`
are not (§0.3): the background is a base64 blob in the document. `M-C06` *is* a
validator rule, because object preservation is the one half of this workflow that
lives in JSON. The raster half is enforced by
[maskin_raster_qa.py](maskin_raster_qa.py) through
`tests/test_maskin_equipment_removal.py` and
[maskin-visual-qa.py](maskin-visual-qa.py), and by looking at the render.

### 17.1 Classify it correctly, or the rest does not matter — `MASKIN`

**This is an artwork modification.** The Designer objects are not what changed.

| Question | Answer | Consequence |
|---|---|---|
| Is a live value or object being changed? | **No**, unless the user names one | No object may be removed because the equipment under it was |
| Which class? | **3 and/or 4**, never 1 or 2 | The supplied export is the template (§11) |
| Target canvas empty? | Deliver a **full class-3 document** carrying the new artwork | Insert appends; a full document belongs on an empty canvas |
| Target canvas already populated? | Deliver a **class-4 background-only patch** | Zero counts, three empty arrays, *Background picture only* ticked |
| Both, in one delivery? | Legitimate — say which file is for which canvas | The full document is not a substitute for the patch |

Three prohibitions, all `MASKIN`:

- **Removing artwork never removes an object.** A value pill whose drawn pill
  disappeared is a finding to report, not an object to delete: deleting it
  destroys a binding the user did not ask you to touch. If the user *does*
  identify a live object that should also go, that is a separate, named object
  change, and the patch scope stops being `artwork-only`.
- **Never hand a populated canvas a full document.** Insert appends
  ([CLAUDE.md](CLAUDE.md) §10.1); every object is duplicated, in place, on top of
  itself, and the panel still renders.
- **Recommend *Background picture only* whenever the existing objects should
  stay.** It is the only import path that swaps the drawing and touches nothing
  else ([../README.md](../README.md), userscript v1.10.0).

### 17.2 Source retention and restart discipline — `M-A10`, `GLOBAL`

Normative. The cheapest rule in this section to follow, and the most expensive
one to skip:

1. **Decode and retain the original source background before editing it.** Keep
   the decoded raster, not only the base64.
2. **Keep a separate working derivative.** The retained original is never written
   to.
3. **Preserve an immutable before-image for pixel comparison** (`M-A18`). It is
   the retained original, and it is what "unchanged" is measured against for the
   rest of the task.
4. **Every failed visual iteration restarts from the retained original**, or from
   a **specifically named** checkpoint the user accepted. "The last one but with
   the pipe fixed" is not a checkpoint.
5. **Never continue patching an already damaged derivative.** Two compensating
   edits hide each other rather than reverting; after three, nobody can say which
   pixels are original artwork and which are introduced damage. That is what
   happened in E25, and it is why the receiver had to be restored from source
   rather than repaired in place.
6. **Never use a previous assistant preview as the geometric source** while the
   original panel raster is available. A preview is a rendering of a claim; the
   raster is the evidence.

### 17.3 The component protection boundary — `M-A11`, `MASKIN`

**Before erasing anything**, write down four things:

1. **The exact static component being removed** — outline, fill, internal detail,
   its own labels and its connection pixels, as a set of bounding boxes.
2. **Every protected neighbour inside or touching those boxes** — equipment
   symbols, vessels, valves, sensor marks, pipes, arrows, static labels, value
   fields, and the empty pills the artwork draws.
3. **The smallest safe edit mask** that covers 1 and excludes 2.
4. **What restores each protected neighbour** if the mask has to grow: the
   retained original, by pixel copy, never by redrawing.

Then:

- **Do not use a large rectangular erase across mixed artwork.** An erase
  rectangle is a blunt instrument and this drawing is dense; a rectangle that is
  comfortably bigger than the equipment is comfortably bigger than the clearance
  to its neighbours.
- **The receiver vessel is an atomic protected artwork cluster**: body, rounded
  top and bottom, outline, internal divider or coil detail, level bar, its nearby
  labels and its connection pixels. A partial vessel is not a vessel. The same
  protection applies to every other complex equipment symbol — the gas cooler
  with its fan row, the oil separator, the heat-recovery exchanger, a valve glyph
  with its tag.
- **If a cleanup touches a protected component's boundary, restore that component
  from the retained source before continuing** — not afterwards, and not by
  redrawing it. A redrawn vessel is a new vessel.

> #### ⚠️ Negative example — the erase rectangle that took the receiver
>
> The internal heat exchanger sits left of the receiver with a few pixels of
> background between them. The rectangle drawn to clear the exchanger was
> widened "to catch the connecting stub", and its right edge landed inside the
> vessel:
>
> ```
>   before                             after the oversized erase
>   +----------+   .----------.        +----------+   .----------.
>   | int. HX  |   |          |        | int. HX  |   |          |
>   |          |   |  Prec    |        |     +----+---+  Prec    |
>   |          |   |  bar   # |        |     | E R A S E      #  |   <- the mask
>   +----------+   |        # |        +-----+----+---+        # |
>                  '----------'                      '----------'
>   receiver complete, level bar #     left wall and part of the level bar gone.
>                                      The vessel now reads as an open box - and
>                                      every JSON check still passes.
> ```
>
> The repair is **not** to redraw the wall. It is to restore the receiver's whole
> bounding box from the retained original and to shrink the mask (`M-A10`,
> `M-A11`).

### 17.4 The background-fill contract — `M-A12`, `MASKIN`

Four pixel classes. Conflating any two of them is a defect:

| Class | What it is | What it must not be confused with |
|---|---|---|
| **Fully transparent** | `alpha == 0`; shows whatever the host puts behind it | a background colour |
| **Opaque source background** | the canvas colour this drawing actually uses | white, or "light" |
| **Opaque black artwork** | line work, glyph cores, symbol outlines | a cleanup colour |
| **Dark text and outlines** | legitimately dark artwork | background to be replaced |

Normative:

- **Do not assume transparent pixels will display as the intended panel
  background.** They display as whatever is behind them — which is how a panel
  asked for on the normal light background arrives black.
- **When the user requests a normal light background, flatten only confirmed
  background pixels** to the selected source-backed background colour.
- **Do not globally replace all dark pixels.** Dark text, outlines, arrows and
  symbols are legitimate artwork; a global dark-to-light replacement erases the
  labels the drawing exists to carry.
- **Determine the requested background colour from the current requirement or
  from a clean sample of the source background** — never from a constant in this
  document. §2 still holds: background colour follows the source or the user's
  requirement, and a dark Maskin is not a defect on colour grounds alone.
- **Verify several blank points across the main canvas and the sidebar after
  flattening.** One sample proves one pixel.
- **Background-colour conversion is a separate operation from equipment
  removal.** Two passes, verified separately, with their diffs reported
  separately (`M-A18`). Folding them together is what let opaque black cleanup
  pixels pass as "part of the background change" in E25.

### 17.5 The circuit-routing inventory — `M-A14`, `MASKIN`

**Complete this before a single pixel changes.** It is the input to every check
in §17.6–§17.8, and writing it afterwards means recording what was drawn instead
of deciding what should be.

For **each pipe the edit touches**, record:

| Field | Notes |
|---|---|
| Circuit role | receiver/liquid, MT suction, … — the *function*, per §2 |
| Source colour | sampled from the supplied raster, never assumed |
| Centreline | in panel pixels |
| Horizontal thickness | measured |
| Vertical thickness | measured **separately**; it may differ |
| Per-row / per-column alpha | every row, including the faint ones |
| Antialiasing rows | which rows, and their alpha values |
| Start anchor | what the run begins at |
| End anchor | what it terminates at |
| Every bend | with its own corner geometry |
| Every crossing | with the other circuit named |
| Every junction | with the segments it joins |
| Connected or non-connected | per crossing — decided, never inferred |
| Bridge or bypass required | yes/no, and its footprint |
| Flow arrow and label ownership | which run owns which arrow and caption |

**Sample the colours from the supplied source.** In this workflow yellow is the
receiver/liquid circuit and light cyan is MT suction — that is what the colours
*mean* (§2, and the colour code in
[reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt)),
and it is not a licence to write an RGB triple in from memory. Two plants'
yellows are not the same yellow, and one panel's cyan header is not the same
weight as its own cyan riser.

The machine-readable form of exactly this inventory is what
[maskin_raster_qa.py](maskin_raster_qa.py) consumes.
`tests/fixtures/maskin-equipment-removal/expectations.json` is a worked example
of its shape — **its values are test instrumentation and describe no real
machine room.**

### 17.6 Crossing, bypass, junction, bend, termination — `M-A15`, `MASKIN`

Four different things happen where two runs meet, and they are drawn
differently. **Decide which one applies before drawing.**

| Term | Definition | Raster consequence |
|---|---|---|
| **Junction** | two pipe segments are functionally connected | their pixels touch continuously, opaque core to opaque core |
| **Crossing without connection** | the circuits remain separate | one must visibly bridge or bypass the other |
| **Bend** | one circuit changes direction and remains continuous | the corner carries the source's own corner geometry |
| **Termination** | a pipe intentionally ends at equipment, a valve, an arrow or a documented endpoint | the endpoint meets that thing; nothing dangles |

For a **non-connected crossing**:

- **Preserve the underlying pipe's continuity.** It may be interrupted by the
  bypass itself and by nothing else — never by a background gap, a cleared
  corridor or a cleanup smear.
- **Draw the bypass entirely in the foreground circuit's style.** Its legs, its
  top span and its returning segment use the same measured thickness, colour and
  per-row alpha as the rest of that circuit (`M-A16`).
- **No background gap, dark residue or accidental electrical-style junction dot
  may remain** anywhere in the crossing.
- **The bypass must be visible at native size**, not only when zoomed. A one- or
  two-pixel jog is not a bypass; it is noise.
- **The two circuits touch nowhere except inside the declared crossing window.**
  Contact anywhere else reads as a junction, which is the opposite of what the
  drawing is saying.

Two orthogonal runs cannot both be continuous and disjoint in one raster layer —
at the crossing, one is drawn over the other. **The convention is that the
foreground circuit is carried over by the bypass and the crossed circuit keeps
its own continuity**, interrupted only inside that single declared window. The
bypass is the reader's only evidence that the circuits do not connect, which is
why a straight run through another circuit is a defect even when nothing is
visibly broken.

### 17.7 The junction ledger — `M-A17`, `MASKIN`

**Every edited pipe carries a junction ledger, and every connection the edit
touched is in it** — not only the one the latest screenshot happened to show.

Per expected connection, record: the horizontal segment's endpoint, the vertical
segment's endpoint, the expected overlap or shared pixel rectangle, the circuit
colour and alpha pattern, and the pass/fail result.

A junction **fails** if:

- one or more background pixels separate the segments;
- a horizontal line stops short of a riser;
- a riser stops short of a header;
- **only an antialiasing row touches while the opaque centreline remains
  separated** — the halo bridges the join, so the pipe reads connected at a
  glance without being connected;
- cleanup left a break on **any** source row that belongs to the pipe.

**Inspect every connection the edit touched, programmatically.** Two of the nine
E25 defects were junctions nobody had a screenshot of; they surfaced only when
every junction was enumerated instead of the reported one.

Beyond the per-junction ledger, run the whole-path check: **search the edited
circuit's raster as connected components and confirm that the required anchors
belong to the same connected component**, excluding intentional non-connected
crossings from the requirement. The ledger proves each join; connected
components prove the route. `maskin_raster_qa.check_connectivity` is that check.

### 17.8 Thickness and alpha acceptance — `M-A16`, `GLOBAL`

**"2 px everywhere" is not a rule and never was.** Instead:

- **Measure each source pipe independently** — `M-A03`, restated for repairs
  rather than clones.
- **Preserve every source row or column, including partial-alpha antialiasing.**
- **Apparent thickness includes the antialiasing rows.** A line that is two
  opaque pixels plus one partial-alpha row is **not** equivalent to a two-pixel
  opaque line: it is wider, softer, and it matches the run it joins.
- **Horizontal and vertical segments of one circuit may need different sampled
  profiles**, where the source proves that they do.
- **At bends and junctions, use the source junction profile** rather than
  overlapping two rectangles and accepting whatever falls out.
- **A repaired segment matches the adjacent source segment's colour and alpha
  profile exactly.** The adjacent untouched run is the acceptance sample —
  compare against it, and not against the inventory alone, so that a wrong
  inventory is caught as well.

### 17.9 Phase order — `M-A19`, `MASKIN`

**Changing this order is a defect**, because overlaying objects hides background
damage and every later phase depends on the retained original still existing.

1. Retain the original source.
2. Create the protected-component masks.
3. Inventory circuits, crossings and junctions.
4. Remove **only** the requested component.
5. Restore protected neighbouring equipment from source.
6. Restore all underlying pipes that should remain continuous.
7. Draw the new route.
8. Draw the bridge or bypass geometry at every intentional non-connected crossing.
9. Restore labels and arrows from source where appropriate.
10. Validate the background colour.
11. Validate the pipe profiles.
12. Validate every junction.
13. Render the background **alone**.
14. Render the complete panel with the dynamic objects.
15. Generate the deliverables — only after **both** renders pass.

Phases 13 and 14 are both mandatory and neither substitutes for the other: a gap
at a junction is invisible under the pill that covers it, and a pill that landed
on nothing is invisible in a background-only render.

### 17.10 Diff scope and object preservation — `M-A18`, `M-C06`

**Compare the final image with the retained original.** Changes outside the union
of the documented edit masks must be **zero**, unless the user also requested a
background-colour conversion.

If the background colour changes globally:

- separate the expected background-colour diff from the local artwork diff;
- confirm that protected foreground artwork remains unchanged;
- **report both scopes independently.** One number covering both hides whichever
  is smaller, and the artwork diff is always the smaller one.

On the JSON side, when only artwork is being edited:

- compare Designer objects **by role key, never by array index** (§5);
- the object count and every object field remain identical — `driver_id`,
  `unit_id`, `unit_ref`, `alias_text`, geometry, `zIndex`, `tag_text` and every
  linked value;
- the only exception is an object change the user explicitly requested;
- **`image_svg_trace` must not be emitted** (`M-S07`, §2.1).

```bash
python validate-maskin-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope artwork-only
```

`artwork-only` is the scope for an artwork edit delivered as a full class-3
document: the background must change, every pre-existing object stays
field-identical, nothing is added and nothing is dropped. `background-only` is
the scope for the class-4 patch. `M-C06` reports the object-preservation verdict
explicitly, pass or fail, because "I only changed the drawing" is precisely the
claim this workflow makes.

**And note what `M-C06` cannot see.** It pairs objects by role key — `obj_id` +
`alias_text` + `tag_text` — so an edit to one of *those* fields leaves the panel
as a dropped role and arrives as a stranger, reported by `M-C01`/`M-C02` instead.
That is a property of the pairing, not a hole in it, and it is why the rules are
read together.

### 17.11 Stop and report — `M-X01`…`M-X07`, `GLOBAL`

**These stop output. Report the gap; do not guess.**

| Id | Stop when |
|---|---|
| `M-X01` | the intended component to remove cannot be localized in the supplied artwork |
| `M-X02` | it is unclear whether two crossing circuits connect |
| `M-X03` | the original raster is unavailable |
| `M-X04` | a pipe's exact source style cannot be sampled |
| `M-X05` | the target background colour is unspecified and cannot be derived from the supplied evidence |
| `M-X06` | a required connection anchor cannot be identified |
| `M-X07` | the edit would overwrite a live value field or a protected component |

In every case: name what is missing, name what would resolve it (a native-size
screenshot, the retained raster, the source export, one sentence from the user),
and deliver whatever *is* fully evidenced — never a plausible-looking whole.

### 17.12 What the QA of this workflow must produce

Owned in full by [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) stage C0. The
short form: **a full-panel preview alone is not acceptable evidence**, because a
one-pixel gap is invisible in a scaled screenshot. The deterministic helper is

```bash
python maskin-visual-qa.py CANDIDATE.json --original SOURCE.json --spec ROUTING.json --out qa/
```

It decodes the delivered background, cuts the required crops and their
nearest-neighbour magnifications, runs the pixel checks and writes
`qa-manifest.json`. **It does not decide whether the drawing is right** — it
proves continuity, cross-section, protection and scope, and it lists what it did
not decide. The generic structural validator sees none of this; never report it
as though it did.
