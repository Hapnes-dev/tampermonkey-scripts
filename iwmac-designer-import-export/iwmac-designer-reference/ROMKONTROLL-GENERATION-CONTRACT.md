# Romkontroll table generation contract (room control, all floors)

> The single owner of the room-control **table** panel rules. It answers what
> the document is, which `obj_id` each signal gets, how the one
> `table_container` is built, where every object sits, where each identifier
> comes from, and how the result is verified.
>
> Search terms that name this panel type: `romkontroll`, `room control`,
> `alle plan`, `all floors`, `tabell`, `tabell romkontroll`, `table panel`,
> `room table`, `hotellrom`, `hotel room`, `per-room table`, `signal matrix`,
> `table_container`, `number_v3_cell_grey25`, `Tabell romkontroll alle plan`.
>
> **Not this panel type:**
> - the **Romkontroll floor plan** (`rc_box` room cards over a floor-plan PNG,
>   1400×750, one panel per floor) — that is `AI-BRIEFING.txt` §7d;
> - the **spjeldliste** damper list (one `objects_container` per row, 208 of
>   them) — that is [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md).
>
> All three are "list-ish" and all three are different documents. §1.1 is the
> classification test; run it before reading further.

## Routing — which file owns which question

| Question | File | Kind |
|---|---|---|
| Should this request produce a panel at all, or a data file | [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md) | normative |
| A coordinate, a column, an `obj_id` choice, a container attribute, a binding rule — each with its evidence id and scope tag | **this file** | normative |
| The step-by-step procedure, and the pre-generation checklist | [ROMKONTROLL-AUTHORING-GUIDE.md](ROMKONTROLL-AUTHORING-GUIDE.md) | procedural |
| The acceptance gate, stage by stage | [ROMKONTROLL-QA-CHECKLIST.md](ROMKONTROLL-QA-CHECKLIST.md) | procedural |
| A block to paste into Copilot, or upload as a knowledge file | [ROMKONTROLL-COPILOT-PREFLIGHT.md](ROMKONTROLL-COPILOT-PREFLIGHT.md) | derived |
| The same rules as data | [documentation-rules.json](documentation-rules.json) → `panel_types.romkontroll_table` | generated |
| The same rules as an executable check | [validate-romkontroll-panel.py](validate-romkontroll-panel.py) | executable |
| The file to copy | [reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json) | measured |
| Host behaviour — insert, rename, `linked`, `table_container`, background | [CLAUDE.md](CLAUDE.md) §6, §10.1, §19 | normative |
| Which `obj_id` renders what | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) | measured |
| The envelope and the 17-field template, for every panel type | [AI-BRIEFING.txt](AI-BRIEFING.txt) §2, §3 | normative |

**There is one live owner per rule.** Where another file states a room-control
table rule that disagrees with this one, this file wins and the disagreement is
recorded in §12 rather than averaged away.

## How to read this file

### Source precedence — normative, shared, not redefined here

The repository has exactly one precedence list. It lives in
`documentation-rules.json` → `source_precedence` and is printed in
`AI-BRIEFING.txt` §0, `VENTILATION-GEOMETRY-CONTRACT.md`,
`MASKIN-GENERATION-CONTRACT.md`, `OVERSIKT-GENERATION-CONTRACT.md` and
`LIST-PANEL-GENERATION-CONTRACT.md`. It is reprinted, not redefined:

| Rank | Source |
|---|---|
| 1 | A panel JSON or screenshot supplied with the current task |
| 2 | A production export of the same panel and system type — for this type, [reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json) |
| 3 | The measured geometry contract for the panel type, scope-tagged — **this file** for a room-control table |
| 4 | Panel-specific rules in [CLAUDE.md](CLAUDE.md) |
| 5 | [AI-BRIEFING.txt](AI-BRIEFING.txt) |
| 6 | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |
| 7 | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| 8 | Generic visual-design advice |

Three rules govern it, unchanged: **never average conflicting coordinates**;
**a scoped profile sits at rank 3** and never overrides a supplied export;
**when evidence is missing, mark the gap and stop.**

### The companion table — which source is authoritative for which *kind* of fact

Precedence resolves a conflict between two sources that both state the same
rule. It does not say where a *value* comes from, and that is the question that
produced both failures in §13. This table does, and it does not compete with
the list above:

| Kind of fact | Authoritative source | Never taken from |
|---|---|---|
| Panel geometry, composition, column order, container anatomy | the known-good export of the same panel type (rank 1–2) | a description, a screenshot alone, another panel type |
| Host + userscript import/export behaviour | [CLAUDE.md](CLAUDE.md) | an error message, a guess about the importer |
| Accepted document shape, the 17 required object fields | [AI-BRIEFING.txt](AI-BRIEFING.txt) §2–§3 | a schema inferred from one rejected file |
| Deterministic construction of a container-built list panel | [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md) for the **spjeldliste** family, **this file** for the **table_container** family | either one applied to the other family — see §12 conflict RC-C1 |
| Valid `obj_id` values, capabilities, nominal sizes | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md), and `reference_data/controls-registry.json` for host-generated cell types (§12 RC-C2) | memory, pattern-matching on a name |
| `driver_id`, `unit_id`, aliases, units, signal names | the plant's `iw_gen_driver_parameters` dump (§7) | construction, concatenation, a placeholder, another plant |
| Rejection criteria | [ROMKONTROLL-QA-CHECKLIST.md](ROMKONTROLL-QA-CHECKLIST.md) + [validate-romkontroll-panel.py](validate-romkontroll-panel.py) | "it parsed", "it inserted" |
| Why a rule says what it says, and what it used to say | [documentation-change-log.md](documentation-change-log.md) | re-derivation |

**Conflicts are recorded, never silently resolved.** Every one found while
writing this file is in §12 with an id, and in Part 8 of the change log with
the evidence.

### Scope tags

Every measured statement carries one. They are not decoration: a
`TEMPLATE-8653-ROMKONTROLL` number is a fact about one building and copying it
into another is an invented coordinate.

| Tag | Means |
|---|---|
| `GLOBAL` | true of every IWMAC Designer panel |
| `ROMKONTROLL` | true of every room-control table panel |
| `TEMPLATE-8653-ROMKONTROLL` | measured on plant 8653's panel only — evidence, not a target |
| `ADVISORY` | a recommendation, not a rejection criterion |

### Evidence

| Id | Evidence | Where it lives |
|---|---|---|
| **E18** | `iwmac-panel_8653_tabell-romkontroll-alle-plan_20260810-2157.json` — the known-good production export. 1,893,477 characters, `IWDIE v1.7.0`, exported 2026-08-10T19:57:49.159Z. 1,553 `single_objects`, 1 container, 1,802 items. | retained by the operator, **not committed**, **never modified** |
| **E19** | [reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json) — E18 with the plant number masked to `NNNN` and author/plant fields blanked, produced mechanically by [build-romkontroll-fixture.py](build-romkontroll-fixture.py). Everything else byte-identical. | committed |
| **E20** | `iw_gen_driver_parameters (3).sql` — phpMyAdmin dump of the plant's parameter table. 10,315 rows, 41 columns, 91 distinct `unit_id`, all `driver_id` unique. | retained by the operator, **not committed** |
| **E21** | Two rejected generations of this panel, 2026-08-10: `Tabell_romkontroll_alle_plan.json` (1.58 MB custom dataset) and `Romkontroll_alle_plan_IWMAC_Designer.json` (30 KB unlinked placeholder overview, `generator: "M365 Copilot"`). | retained by the operator, **not committed**; anatomy in §13 |

Every number in §2–§9 was produced by
`python build-romkontroll-fixture.py E18 --report` and
`... --sql E20`, not typed by hand. Re-run those to regenerate them.

---

## 1. What this panel type is

`ROMKONTROLL` — A single scrolling table that shows **every room controller in
the building at once**: one row per room, one column per signal, headers
repeating down the page so the column meaning survives scrolling. On E18 that
is 50 rooms × 31 signals = 1,550 live cells plus a three-object manual-reset
control, drawn as 1,553 absolutely-positioned canvas objects sitting on top of
**one** `table_container` that draws the grid, the room labels and the column
titles.

The division of labour is the whole design, and it is what both failures in
§13 missed:

| Layer | Draws | Carries a binding | Where it lives |
|---|---|---|---|
| `table_container.items` | the grid — column titles, room numbers, the "Hotellrom" description, and 1,700 empty cell rectangles | **no** — `driver_id` is `""` on all 1,802 | `panel.containers[0].items` |
| `single_objects` | the live values and the alarm indicators, one per cell | **yes** — 1,551 of 1,553 | `panel.single_objects` |

A cell is therefore **two records**: a static grey cell in the container, and a
value object on the canvas positioned inside it. Neither alone is a panel.

### 1.1 Classification test — run this first

Answer in order. The first `yes` wins.

1. Does the request name a floor plan, a room card, or one floor at a time?
   → **Romkontroll floor plan**, `AI-BRIEFING.txt` §7d. Not this file.
2. Does the source table repeat an identical multi-column cell group as one
   `objects_container` **per row** (a damper list, a spjeldliste, an equipment
   list)? → **spjeldliste family**,
   [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md).
3. Does the request ask for a **table** covering **all rooms / all floors /
   every room controller**, with signals as columns? → **this file.**
4. Is a room-control table export supplied with the task? → **this file**, and
   that export is rank 1.

`GLOBAL` A request that names both "romkontroll" and "tabell"/"table"/"alle
plan" is case 3. A request that names "romkontroll" alone is ambiguous: ask, or
state the assumption in the answer. Do not silently pick the floor plan because
it is smaller.

### 1.2 What this panel is not allowed to be

`ROMKONTROLL` The output is an **`iwmac-designer-panel` document**. It is not:

- a JSON dataset describing rooms and signals (failure §13.1);
- a headings-and-labels overview with placeholder bindings (failure §13.2);
- a per-floor set of small panels;
- a screenshot, a table in prose, a schema, or a description of the file.

If the answer does not contain `panel.single_objects`, it is not this panel
type, whatever its file extension.

---

## 2. The envelope

`GLOBAL` The accepted top level, measured on E18. Eleven keys, in this order.
The order is not enforced by the importer; it is preserved because a diff
against the fixture is the cheapest structural check there is.

| Key | Type | Status | Value on E18 | Rule |
|---|---|---|---|---|
| `format` | string | **required** | `"iwmac-designer-panel"` | Exact. Any other value is not this document type. |
| `version` | number | **required** | `1` | Only `1` is supported. |
| `exported_at` | ISO string | exporter-generated, importer-ignored | `"2026-08-10T19:57:49.159Z"` | Write it when you have a real timestamp; never invent one to look authentic. |
| `generator` | string | exporter-generated, importer-ignored | `"IWDIE v1.7.0"` | A generated panel says what generated it. Do not claim `IWDIE`. |
| `source_plant_id` | string | optional, provenance | `"8653"` | The plant the panel came from. Blank on a template. Never a guess. |
| `panel_name` | string | **required in practice** | `"Tabell romkontroll alle plan"` | The panel's name in the Designer. |
| `panel_width` | css string | **required** | `"1400px"` | Viewport width, `px` suffix, **string**. |
| `panel_height` | css string | **required** | `"750px"` | Viewport height. **Not a clipping boundary** — §8. |
| `counts` | object | **required** | `{"single_objects":1553,"containers":1,"graphics":0}` | Must equal the three array lengths exactly. A mismatch is an error, not a warning. |
| `background_embedded` | boolean | optional, compatibility | `true` | Must agree with the presence of `panel.image_data` / `panel.converted`. |
| `panel` | object | **required** | 13 keys | The design-panel document proper. |

`panel` on E18, thirteen keys:

| Key | Type | Status | Value on E18 | Rule |
|---|---|---|---|---|
| `plant_id` | string | **required** | `"8653"` | Blank on a template. Never invented. |
| `panel_name` | string | **required** | as above | Mirrors the envelope. |
| `panel_width` / `panel_height` | css string | **required** | `"1400px"` / `"750px"` | Mirror the envelope. |
| `org_image_name` | string | optional | `""` | Background filename on the host. Blank here: the background is embedded, not named. Never invent a filename. |
| `image_name` | string | optional | `""` | Collected and then discarded by the host (`CLAUDE.md` §8). Emit `""`. |
| `saved_by` | string | optional, provenance | `"thomas.kvalvag"` | The operator. Blank it in a fixture; never fabricate a name. |
| `single_objects` | array | **required** | 1,553 entries | §3. |
| `containers` | array | **required** | 1 entry | §4. Empty array is legal for other panel types, **not for this one**. |
| `graphics` | array | **required** | `[]` | Always empty on this panel type. |
| `converted` | string `"true"` | required when a background is embedded | `"true"` | Paired with `image_data`. |
| `image_data` | data URI | optional | 5,610 chars, `data:image/png;base64,…` | The blank 1400×750 canvas. **The panel carries no artwork** — the grid is drawn by the container, not by the background. |
| `image_svg_trace` | string | **input-only** | 267 chars, `<svg viewBox="0 0 1400 750" … imagetracer.js version 1.2.6">` | Written by Export as AI input; `applyImportCore` **deletes it** before rendering. Do not emit it; do not treat its absence as a defect. |

**Do not simplify this envelope from an error message.** `GLOBAL` An importer
complaint about one field is evidence about that field only. E18 is a file the
host produced and accepts; every key above is accepted. Dropping `counts`,
`converted` or `image_data` because a validator did not mention them makes the
document less like the known-good file, not more correct.

---

## 3. The 17 `single_objects` fields

`GLOBAL` Every object carries **all seventeen**, always, in both linked and
unlinked mode. A missing field is an error; an extra field is only legal for
the two documented `file_pdf` object types (`CLAUDE.md` §8).

Real example, `object_0` of E18 — the first room's space temperature:

```json
{"obj_id":"number_v3_value_only","name":"object_0","id":"driver_id","posWidth":80,"posHeight":20,"posLeft":240,"posTop":113,"zIndex":"110","tag_text":"","linked":"true","link_name":"link_name","link_tag":"","sub_group":"","driver_id":"8653_BACNET10_163031563212ou001_0_163031_0_9011_85","unit_id":"163031","unit_ref":"","alias_text":"=563.212-RT601_MV SpaceTemp [  ]"}
```

| # | Field | Type | Req. | Meaning | Linked mode | Unlinked template | Source of value | Invention | Validation |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `obj_id` | string | yes | which control is drawn | `number_v3_value_only` / `V3_R_20px_anim_rg_alarm_nrm` per §5 | same | catalogue + §5 role table | **prohibited** | must exist in the catalogue or the controls registry (§12 RC-C2) |
| 2 | `name` | string | yes | canvas identity | `object_0`…`object_N` | same | generated | n/a | sequential from 0, no gaps, no duplicates |
| 3 | `id` | string | yes | **literal** `"driver_id"` | `"driver_id"` | `"driver_id"` | constant | n/a | must be exactly `driver_id` on every object, bound or not |
| 4 | `posWidth` | **number** | yes | width in px | 80 value / 20 alarm | same | §6 | derived, not guessed | integer > 0; JSON number, not a string |
| 5 | `posHeight` | **number** | yes | height in px | `20` on all 1,553 | same | §6 | derived | integer > 0 |
| 6 | `posLeft` | **number** | yes | absolute x | `container.left + cell.posLeft + dx` (§6.4) | same | §6 | derived | integer ≥ 0 |
| 7 | `posTop` | **number** | yes | absolute y | `container.top + cell.posTop + 3` (§6.4) | same | §6 | derived | integer ≥ 0 |
| 8 | `zIndex` | **string** | yes | stacking | `"110"` on the 1,551 grid objects, `"1100"` on the 2 note labels | same | §6.5 | no | string, never the number; `"default"` is wrong on this panel type |
| 9 | `tag_text` | string | yes | static text drawn in the object | `""` on value/alarm cells; the note text on the two labels; `" "` on the reset box | same | the panel's own captions | no | present on every object, `""` when unused |
| 10 | `linked` | string | yes | host link flag | `"true"` | `"false"` | see §3.1 | n/a | `"true"`/`"false"` as a **string** |
| 11 | `link_name` | string | yes | **literal** `"link_name"` | `"link_name"` | `"link_name"` | constant | n/a | exactly `link_name` on all 1,553 — **not** `""` |
| 12 | `link_tag` | string | yes | link annotation | `""` on canvas objects, `"NA"` on container items | `""` | constant per layer | no | one of the two observed values |
| 13 | `sub_group` | string | yes | grouping | `""` | `""` | constant | no | `""` |
| 14 | `driver_id` | string | yes | the parameter binding | the **exact** string from the parameter dump | `"driver_id"` (the literal) | E20 row, copied | **prohibited** | §7 |
| 15 | `unit_id` | string | yes | the controller | the dump's `unit_id` for that row | `""` | E20 row, copied | **prohibited** | must agree with the dump row named by `driver_id` |
| 16 | `unit_ref` | string | yes | secondary unit ref | `""` | `""` | constant | no | `""` |
| 17 | `alias_text` | string | yes | the human label the linker sees | the dump's `alias_text`, **byte-identical**, UTF-8 | a description of the wanted signal | E20 row, copied | **prohibited when a dump exists** | §7 |

### 3.1 `linked` is host behaviour, not an assertion you make

`GLOBAL` `DesignPanelHandler.load_new_ver_objects` sets `linked="true"`
whenever `driver_id !== "driver_id"` — **including when `driver_id` is empty**
(`V3scripts.js:514`, `CLAUDE.md` §17b). Consequences:

- On E18 all 1,553 objects carry `linked:"true"`, including `object_1551` and
  `object_1552`, which are pure text labels with an empty `driver_id`. That is
  the host round-tripping its own flag. **It is not a defect and must not be
  tidied.**
- In an export, an *unlinked* object carries an **empty** `driver_id`, never
  the literal `"driver_id"`. In a *generated unlinked template* it is the
  literal. An export is not a template (`CLAUDE.md` §17b, linking kit).
- `linked:"false"` together with a real `driver_id` is impossible in a file the
  host produced. Emitting it is an error (§11 check R-B4).

### 3.2 The seven constants

`ROMKONTROLL` Across all 1,553 objects of E18, seven fields never vary:

| Field | Value | Count |
|---|---|---|
| `id` | `"driver_id"` | 1553 |
| `link_name` | `"link_name"` | 1553 |
| `link_tag` | `""` | 1553 |
| `sub_group` | `""` | 1553 |
| `unit_ref` | `""` | 1553 |
| `linked` | `"true"` | 1553 |
| `posHeight` | `20` | 1553 |

`zIndex` takes two values only: `"110"` ×1551, `"1100"` ×2.

---

## 4. The container

`ROMKONTROLL` **Exactly one**, and it is a `table_container` — not the
`objects_container`-per-row shape of the spjeldliste (§12 RC-C1). Twenty-two
keys on E18:

| Key | Type | Value on E18 | Rule |
|---|---|---|---|
| `id` | string | `"objects_container"` | constant |
| `unique_id` | string | `"custom_0"` | **must contain `custom_`** or `load_new_ver_containers` routes to `.template()`, an empty stub, and the container **silently vanishes on Insert** (`CLAUDE.md` §10.1). The host renumbers it afterwards, so only the prefix and uniqueness matter. |
| `name` | string | `"objects_container_0"` | host renumbers on insert |
| `type` | string | `"container_c"` | constant |
| `container_type` | string | **`"table_container"`** | the field that distinguishes this family from the spjeldliste's `"objects_container"` |
| `className` | string | `"objects_container"` | the collector normalizes `tbl_container` back to this (`CLAUDE.md` §8) |
| `header_footer` | array | `[]` | empty |
| `linked` | string | `"0"` | **string zero**, not `"false"` |
| `linked_to` | string | `"0"` | string zero |
| `width` | **number** | `405` | the *widget* width, not the table width — see below |
| `height` | **number** | `72` | the widget height |
| `left` | **number** | `5` | table origin x |
| `top` | **number** | `5` | table origin y |
| `zIndex` | **number** | `4` | the integer 4, not the string |
| `items` | array | 1,802 entries | §4.1 |
| `title` | string | `"Table Container"` | custom attribute |
| `num_of_rows` | **string** | `"50"` | must equal the number of body rows |
| `num_of_col` | **string** | `"34"` | must equal the number of columns |
| `descr_width` | string | `"300"` | width of the description block (100 + 130 + the 100-wide repeat ≈ the label columns) |
| `val_width` | string | `"100"` | nominal value-column width |
| `cells` | string | `"true"` | cells are drawn |
| `last_y` | string | `"1625"` | bottom of the last body row, container-relative: `1598 + 27` |

**`width: 405` and `height: 72` do not describe the table.** The table's
content spans 3,120 px wide and 1,625 px tall in container-relative terms. Both
were preserved verbatim from E18; neither is used to lay anything out. Do not
"correct" them to the content size — that is inventing a number the host never
wrote.

### 4.1 Container items

`ROMKONTROLL` 1,802 items, each carrying the same 17 fields as a canvas object
(`CLAUDE.md` §8: item collection mirrors object collection, except `tag_text`
is unconditional and may be `null`).

| `obj_id` | Count | Size | Role |
|---|---|---|---|
| `number_v3_header_grey75` | 102 | 90×85, 100×85, 130×85 | column titles — 34 columns × 3 header bands |
| `number_v3_cell_grey25` | 1,700 | 90×27, 100×27, 130×27 | the body grid — 34 columns × 50 rows |

Item constants on E18: `id:"driver_id"`, `zIndex:"5"` (string) on all 1,802,
`linked:"true"`, `link_name:"link_name"`, **`link_tag:"NA"`**, `sub_group:""`,
`driver_id:""`, `unit_id:""`, `unit_ref:""`, `alias_text:"new text"`.

Naming, measured — and deliberately unlike the canvas layer:

- header items: `name` **equals** `tag_text`, the column title (33 distinct
  names for 34 columns, because `Room` appears twice);
- body cells: `name` is the literal string `"driver_id"` on all 1,700.

Nothing resolves a container item by `name` (`CLAUDE.md` §6a), so the
collisions are harmless. Reproduce them; do not invent a numbering scheme.

Verbatim first header item and first body cell of E18:

```json
{"obj_id":"number_v3_header_grey75","name":"Room","id":"driver_id","posWidth":100,"posHeight":85,"posLeft":0,"posTop":20,"zIndex":"5","tag_text":"Room","linked":"true","link_name":"link_name","link_tag":"NA","sub_group":"","driver_id":"","unit_id":"","unit_ref":"","alias_text":"new text"}
{"obj_id":"number_v3_cell_grey25","name":"driver_id","id":"driver_id","posWidth":100,"posHeight":27,"posLeft":0,"posTop":105,"zIndex":"5","tag_text":"212","linked":"true","link_name":"link_name","link_tag":"NA","sub_group":"","driver_id":"","unit_id":"","unit_ref":"","alias_text":"new text"}
```

Body-cell `tag_text` distribution on E18 — 52 distinct values:

| Column | `tag_text` | Count |
|---|---|---|
| 0 and 16 (`Room`) | the room number, e.g. `"212"` | 50 rooms × 2 = 100 |
| 1 (`Beskrivelse`) | `"Hotellrom"` | 50 |
| every signal column | `" "` — a **single space**, not `""` | 1,550 |

---

## 5. Object selection

`ROMKONTROLL` Four `obj_id` values appear on E18's canvas, and each has a
reason. **Never use one text-label `obj_id` for every cell** — that is failure
§13.2, and it produces a picture of a table rather than a table.

| Role | `obj_id` | Size | Count | When |
|---|---|---|---|---|
| analog / numeric readout, and every writable setpoint | `number_v3_value_only` | 80×20 | 1,300 | the parameter row is `Analog values` **or** a `Digital IO` boolean that is *not* an alarm |
| alarm indicator | `V3_R_20px_anim_rg_alarm_nrm` | 20×20 | 250 | the parameter is an **alarm** signal (§5.1) |
| free-width writable control | `number_v3_60px_json_obj` | 60×20 | 1 | the manual-reset write box |
| static note text | `number_v3_label_11px_norm` | 50×20 | 2 | operator instructions beside the reset box |

Catalogue status of each, from `reference_data/design-object-catalog.json` and
`production-usage-census.json`:

| `obj_id` | Palette entry | Nominal size | Production placements | Notes |
|---|---|---|---|---|
| `number_v3_value_only` | yes — "Value Only", TextBox | 50×20 | 2,054 on 86 panels | placed at 80×20 here; a catalogue size is a toolbox default, not a placement (precedence rank 7 loses to rank 2) |
| `V3_R_20px_anim_rg_alarm_nrm` | yes — 20px animated red/grey alarm bell | 20×20 | 11 on 3 panels | **production-observed but rare.** Real, correct for this role, and not to be swapped for something commoner |
| `number_v3_60px_json_obj` | yes — free-width JSON Obj box | 61×21 | 173 on 45 panels | writable |
| `number_v3_label_11px_norm` | yes — 11px Normal label | 77×20 | 829 on 87 panels, 13 % of them Romkontroll | **`can_link: false`** — a label can never carry a binding |
| `number_v3_header_grey75` | yes — Dummy-Header | 60×25 palette, 250×20 controls | 152 on 53 panels | container item only |
| `number_v3_cell_grey25` | **absent from the catalogue** | 168×25 in the controls registry | — | host-generated table cell; see §12 RC-C2 |

`GLOBAL` Never use an `obj_id` that is absent from **both** the catalogue and
the controls registry, and never one the catalogue marks inactive, outdated or
unsupported. Prefer a production-observed id over an active-but-never-observed
one, and say which you used.

### 5.1 The alarm rule — measured, and narrower than "boolean"

`ROMKONTROLL` Cross-checking every bound object against E20 (§7) gives an
unambiguous split:

| `obj_id` | `application` | `parameter_type` | `att` | `eng_unit` | Count |
|---|---|---|---|---|---|
| `V3_R_20px_anim_rg_alarm_nrm` | `Digital IO` | `boolean` | `r` | *(blank)* | 250 |
| `number_v3_value_only` | `Analog values` | `float` | `rw` | `°C` | 650 |
| `number_v3_value_only` | `Analog values` | `float` | `r` | `°C` | 300 |
| `number_v3_value_only` | `Analog values` | `float` | `r` | `%` | 150 |
| `number_v3_value_only` | `Digital IO` | `boolean` | `r` | *(blank)* | 150 |
| `number_v3_value_only` | `Digital IO` | `boolean` | `rw` | *(blank)* | 50 |
| `number_v3_60px_json_obj` | `Digital IO` | `boolean` | `rw` | *(blank)* | 1 |

**A boolean is not automatically an alarm.** 200 read-only `Digital IO`
booleans on this panel are drawn as value boxes (the three fan-stage columns
and one more); 250 are drawn as alarm bells. The discriminator is the signal,
not the datatype:

> `ROMKONTROLL` An object gets `V3_R_20px_anim_rg_alarm_nrm` when its parameter
> is an alarm signal — on this plant, `element_id` suffix `_AL`, `_ALH`, `_ALL`
> (menu codes `5_2`, `5_3`, `5_4`, `5_5`, `5_6`). Alarm **limits**
> (`_ALGH`/`_ALGL`, menu `2_1`, `2_2`, `2_5`, `2_6`) are setpoints in `°C` and
> get a value box. Everything else gets a value box.

The suffix list is `TEMPLATE-8653-ROMKONTROLL`; the rule "alarm state → alarm
indicator, alarm limit → value box" is `ROMKONTROLL`.

---

## 6. Geometry

All of §6 is `TEMPLATE-8653-ROMKONTROLL` unless tagged otherwise: it is the
measurement of one building's table. The *relations* — cell pitch, centring
formula, header repeat — are `ROMKONTROLL` and reusable; the absolute column
lefts are not, because they follow from that building's column list.

### 6.1 Origin and canvas

- container `left: 5`, `top: 5` — the table's origin.
- canvas objects span `posLeft` 240…3040 (right edge 3120) and `posTop`
  113…1670 (bottom edge 1690).
- declared viewport `1400px × 750px`.

### 6.2 Columns

34 columns, from the header items of the first band. `rel` is
container-relative, `abs = rel + 5`.

| # | rel | abs | width | Header text | Canvas objects |
|---|---|---|---|---|---|
| 0 | 0 | 5 | 100 | `Room` | 0 |
| 1 | 100 | 105 | 130 | `Beskrivelse` | 0 |
| 2 | 230 | 235 | 90 | `Romtemperatur °C (r)` | 50 |
| 3 | 320 | 325 | 90 | `Lokal børverdijustering °C (r)` | 50 |
| 4 | 410 | 415 | 90 | `Kalkulert SP °C (r)` | 50 |
| 5 | 500 | 505 | 90 | `Utgang ventilmotor varme % (r)` | 50 |
| 6 | 590 | 595 | 90 | `Utgang ventilmotor kjøling % (r)` | 50 |
| 7 | 680 | 685 | 90 | `Start trinn 1 fancoil vifte (r)` | 50 |
| 8 | 770 | 775 | 90 | `Start trinn 2 fancoil vifte (r)` | 50 |
| 9 | 860 | 865 | 90 | `Start trinn 3 fancoil vifte (r)` | 50 |
| 10 | 950 | 955 | 90 | `Alarm høy temp rom (r)` | 50 |
| 11 | 1040 | 1045 | 90 | `Alarm lav temp rom (r)` | 50 |
| 12 | 1130 | 1135 | 90 | `Feil på føler (r)` | 50 |
| 13 | 1220 | 1225 | 90 | `Grenseverdi alarm høy temp rom °C (rw)` | 50 |
| 14 | 1310 | 1315 | 90 | `Grenseverdi alarm lav temp °C (rw)` | 50 + 2 note labels |
| 15 | 1400 | 1405 | 90 | `Resetter lokal justering av SP kl. 10 (hverdager), 12 (helg) (rw)` | 50 + the reset box |
| 16 | 1490 | 1495 | 100 | `Room` *(repeat)* | 0 |
| 17 | 1590 | 1595 | 90 | `Temp.føler gulv bad °C (r)` | 50 |
| 18 | 1680 | 1685 | 90 | `SP Temp. bad °C (rw)` | 50 |
| 19 | 1770 | 1775 | 90 | `Styring varmekabel bad % (r)` | 50 |
| 20 | 1860 | 1865 | 90 | `Alarm høy temp bad (r)` | 50 |
| 21 | 1950 | 1955 | 90 | `Alarm lav temp bad (r)` | 50 |
| 22 | 2040 | 2045 | 90 | `Grenseverdi alarm høy temp bad °C (rw)` | 50 |
| 23 | 2130 | 2135 | 90 | `Grenseverdi alarm lav temp bad °C (rw)` | 50 |
| 24 | 2220 | 2225 | 90 | `Kurve rt601 lavest romsettpunkt °C (rw)` | 50 |
| 25 | 2310 | 2315 | 90 | `Kurve rt601 senket romsettpunkt °C (rw)` | 50 |
| 26 | 2400 | 2405 | 90 | `Kurve rt601 forhøyet romsettpunkt °C (rw)` | 50 |
| 27 | 2490 | 2495 | 90 | `Kurve rt601 høyt romsettpunkt °C (rw)` | 50 |
| 28 | 2580 | 2585 | 90 | `Kurve rt601 lav utetemp °C (rw)` | 50 |
| 29 | 2670 | 2675 | 90 | `Kurve rt601 medium lav utetemp °C (rw)` | 50 |
| 30 | 2760 | 2765 | 90 | `Kurve RT601 Høy utetemp °C (rw)` | 50 |
| 31 | 2850 | 2855 | 90 | `Kurve RT601 Høyest utetemp °C (rw)` | 50 |
| 32 | 2940 | 2945 | 90 | `Kalkulert SP rt601 °C (r)` | 50 |
| 33 | 3030 | 3035 | 90 | `Temp.føler ute fra sd °C (r)` | 50 |

`ROMKONTROLL` The structural rules behind the table:

- three **label** columns carry no canvas objects: the room number, the
  description, and a **repeat of the room number** at column 16 — placed so the
  row is still identifiable after scrolling horizontally past 15 signal
  columns. 31 of 34 columns are live.
- every signal column is **90 wide**, laid out with **no gutter**: `rel(n+1) =
  rel(n) + width(n)`.
- header text is the parameter's Norwegian description with its engineering
  unit and its `att` flag in parentheses — `(r)` read-only, `(rw)` writable.
  Both come from the dump; neither is composed by hand.

### 6.3 Rows and header bands

| Quantity | Value |
|---|---|
| body rows | 50, one per room |
| body row height | 27 |
| body row pitch (adjacent rows) | 27 |
| first body row, container-relative top | 105 |
| last body row top | 1598 |
| `last_y` | `"1625"` = 1598 + 27 |
| header bands, container-relative top | 20, 699, 1378 |
| header band height | 85 |
| header band pitch | 679 = 85 + 22 × 27 |
| body rows per band | 22, 22, 6 |

`ROMKONTROLL` The header repeats every **22 body rows**. Where a band
interrupts the rows, the pitch between the two adjacent body rows is
`85 + 27 = 112` — measured twice on E18, and the only two non-27 gaps.

The first band starts at 20, not 0: the container's own 20 px of chrome sits
above it.

### 6.4 Where a canvas object sits inside its cell

`ROMKONTROLL` — the one formula that places all 1,550 grid objects, verified
with zero exceptions:

```
cell_abs_left = container.left + cell.posLeft          # 5 + rel
cell_abs_top  = container.top  + cell.posTop           # 5 + rel

object.posLeft = cell_abs_left + (cell.posWidth - object.posWidth) / 2   # centred
object.posTop  = cell_abs_top  + (cell.posHeight - object.posHeight) / 2 # floor()
```

Measured offsets from the cell's top-left, on E18:

| `obj_id` | dx | dy | Count | Check |
|---|---|---|---|---|
| `number_v3_value_only` | 5 | 3 | 1,300 | (90−80)/2 = 5; ⌊(27−20)/2⌋ = 3 |
| `V3_R_20px_anim_rg_alarm_nrm` | 35 | 3 | 250 | (90−20)/2 = 35 |
| `number_v3_60px_json_obj` | 17 | 45 | 1 | below the last row — the reset control, not a grid cell |
| `number_v3_label_11px_norm` | 63 / 77 | 31 / 67 | 1 each | free-placed notes |

The vertical offset uses **floor**, not round: 3, not 3.5 or 4. Every object is
at integer pixels.

### 6.5 Z-index

`ROMKONTROLL`

| Layer | `zIndex` | Type | Count |
|---|---|---|---|
| container | `4` | **number** | 1 |
| container items (headers and cells) | `"5"` | **string** | 1,802 |
| canvas value and alarm objects | `"110"` | string | 1,551 |
| the two note labels | `"1100"` | string | 2 |

The type matters as much as the value (`CLAUDE.md` §6a). `"default"` is wrong
on every object of this panel type: with `default`, array order silently
becomes stacking order.

### 6.6 Rooms and floors

`TEMPLATE-8653-ROMKONTROLL` 50 rooms, read from column 0's cell `tag_text`, in
this order:

```
212 214 221 312 314 321 402 412 414 421
502 504 506 508 510 512 514 521 602 604
606 608 610 612 614 621 702 704 706 708
710 712 714 721 802 804 806 808 810 812
814 821 902 904 906 908 910 912 914 921
```

`ROMKONTROLL` Rules the ordering demonstrates:

- **Row order is the room number ascending as an integer.** Verified: strictly
  increasing across all 50, with no duplicates.
- **The floor is the leading digit** of the room number. Distribution: floor 2
  ×3, 3 ×3, 4 ×4, 5 ×8, 6 ×8, 7 ×8, 8 ×8, 9 ×8. It is derived, never asked for
  and never invented.
- **There are no floor group rows, no divider rows and no blank spacer rows.**
  Floors are legible from the numbers and from the repeating header, and the
  grid is uniform 27 px throughout. Do not add grouping the source does not
  have.
- Every room appears **exactly once**. A room in the source and missing from
  the panel is an error; a room in the panel and not in the source is an
  invented room, which is worse.
- Each room contributes exactly 31 objects (one per live column). E18's totals:
  50 × 31 = 1,550, plus the 3-object reset control = 1,553.

Room ↔ controller is 1:1 on this plant: `unit_name` follows the pattern
`563.<room>-OU001` and each room has exactly one `unit_id`. That is
`TEMPLATE-8653-ROMKONTROLL`; verify it per plant rather than assuming it.

### 6.7 Missing signals

`ROMKONTROLL` If a room lacks a parameter another room has, **leave the cell
empty** — the container cell is still drawn, and no canvas object is emitted.
Do not substitute a placeholder object, a zero, a dash, or a value box with an
empty `driver_id`: an empty binding is indistinguishable from a broken one. E18
has no such gap (all 50 rooms carry all 31 signals); the rule exists because a
generator meeting its first ragged plant must not fill the hole.

---

## 7. Extracting identifiers from `iw_gen_driver_parameters`

`GLOBAL` The parameter dump is the **only** source of `driver_id`, `unit_id`
and `alias_text`. E20's shape: 41 columns, 10,315 rows, one row per parameter,
`driver_id` unique across the table.

Fields that matter here, retained exactly as written:

| Column | Use |
|---|---|
| `driver_id` | copied **verbatim** into the object's `driver_id`. Ready-made in the row; never assembled |
| `unit_id` | copied into `unit_id`; must match the row named by `driver_id` |
| `unit_name` | maps room → controller (`563.212-OU001`) |
| `alias_text` | copied **byte-identical** into `alias_text` |
| `element_id` | the signal's tag (`=563.212-RT601_MV SpaceTemp`) — the suffix identifies the signal |
| `menu` | the parameter's menu code (`0_9011`, `5_2`) — the stable per-signal key used for the column mapping in §9 |
| `application` | `Analog values` / `Digital IO` |
| `parameter_type` | `float` / `boolean` |
| `hardware_datatype` | `HW_REAL` / `HW_ENUM` |
| `eng_unit` | `°C`, `%`, blank — appears in the column header |
| `att` | `r` / `rw` — appears in the column header |
| `driver_type`, `driver_id_no` | provenance; not written into the panel |

### 7.1 The verbatim rule — normative

> `GLOBAL` **Use the exact `driver_id` string from the source row.** Never
> construct one that looks plausible, never concatenate one from parts, never
> pattern-match one from another room's id, and never derive one unless an
> authoritative contract states the algorithm *and* the result is verifiable
> against the source data.

E18's ids show why: `8653_BACNET10_163031563212ou001_0_163031_0_9011_85`
embeds the plant, the driver family, a concatenated bus/room token, the unit,
the menu code and a trailing index. A generator that "understood the pattern"
would produce well-formed strings that bind to nothing, and nothing downstream
would mark them as invented.

### 7.2 The cross-check — the evidence, and how to reproduce it

```bash
python build-romkontroll-fixture.py E18.json --sql "iw_gen_driver_parameters.sql"
```

Result on E18 × E20:

| Check | Result |
|---|---|
| objects carrying a `driver_id` | 1,551 of 1,553 |
| `driver_id` not found in the dump | **0** |
| `unit_id` disagreeing with the dump | **0** |
| `alias_text` byte-identical to the dump | **1,551 of 1,551** |
| `alias_text` differing only in whitespace | 0 |

So every binding on the known-good panel is a **copy**, including the alias's
odd spacing — `"=563.212-RT601_MV SpaceTemp [  ]"` keeps its two-space empty
unit bracket. Normalizing that whitespace would already be a divergence from
the source.

### 7.3 Encoding

`GLOBAL` Read the dump as **UTF-8**. Reading it as latin-1 turns `ø`/`å`/`°`
into mojibake and every alias comparison fails for a reason that has nothing to
do with the panel. Aliases and header text are UTF-8 in the JSON too — `°C`,
`æøå`, never ASCII substitutes.

---

## 8. Viewport versus content extent

`GLOBAL`, and the rule most often broken by a generator that "keeps everything
inside the canvas":

> `panel_height` is a **viewport**, not a clipping boundary. The plant view
> scrolls (`CLAUDE.md` §19 gotcha #25; `LIST-PANEL-GENERATION-CONTRACT.md`
> §8.10). Content legitimately extends past `panel_width` and `panel_height`.

On E18: declared `1400px × 750px`; content reaches x = 3,120 and y = 1,690 —
2.2× the declared width and 2.25× the declared height. This is a **known-good
production export**, so the rule is settled by evidence, not by preference.

Consequences:

- Never compress a room-control table to fit 1400×750. It cannot fit: 31
  signal columns at 90 px is 2,790 px of table on its own.
- Never drop rooms or columns to fit.
- Never rescale the 90 px column width or the 27 px row height for fit.
- A validator must **not** flag out-of-canvas geometry as an error on this
  panel type. It may report the extent as information.

---

## 9. Column → signal mapping (measured)

`TEMPLATE-8653-ROMKONTROLL` for the specific menu codes; `ROMKONTROLL` for the
principle that **one column is one `menu` code across every room**. Produced by
`--sql`; `att` and `eng_unit` are the ones that appear in the header text.

| Col | `menu` | Element suffix | `obj_id` | `att` | Unit | Type |
|---|---|---|---|---|---|---|
| 2 | `0_9011` | `RT601_MV SpaceTemp` | value | r | °C | float |
| 3 | `2_21` | `RT601_LBVJ` | value | r | °C | float |
| 4 | `2_10` | `RT601_KSP` | value | r | °C | float |
| 5 | `1_105` | `SB621_S` | value | r | % | float |
| 6 | `1_108` | `SB631_C` | value | r | % | float |
| 7 | `4_103` | `JV600_1_S` | value | r | — | boolean |
| 8 | `4_102` | `JV600_2_S` | value | r | — | boolean |
| 9 | `4_101` | `JV600_3_S` | value | r | — | boolean |
| 10 | `5_2` | `RT601_ALH` | **alarm** | r | — | boolean |
| 11 | `5_3` | `RT601_ALL` | **alarm** | r | — | boolean |
| 12 | `5_4` | `RT601_AL` | **alarm** | r | — | boolean |
| 13 | `2_1` | `RT601_ALGH` | value | rw | °C | float |
| 14 | `2_2` | `RT601_ALGL` | value | rw | °C | float |
| 15 | `5_1` | `RT601_LBVJ_RESETT` | value | rw | — | boolean |
| 17 | `0_101` | `RT602_MV` | value | r | °C | float |
| 18 | `2_4` | `RT602_SPCV` | value | rw | °C | float |
| 19 | `1_107` | `LZ602_C` | value | r | % | float |
| 20 | `5_5` | `RT602_ALH` | **alarm** | r | — | boolean |
| 21 | `5_6` | `RT602_ALL` | **alarm** | r | — | boolean |
| 22 | `2_5` | `RT602_ALGH` | value | rw | °C | float |
| 23 | `2_6` | `RT602_ALGL` | value | rw | °C | float |
| 24 | `2_13` | `RT601_Y1` | value | rw | °C | float |
| 25 | `2_15` | `RT601_Y2` | value | rw | °C | float |
| 26 | `2_17` | `RT601_Y3` | value | rw | °C | float |
| 27 | `2_19` | `RT601_Y4` | value | rw | °C | float |
| 28 | `2_12` | `RT601_X1` | value | rw | °C | float |
| 29 | `2_14` | `RT601_X2` | value | rw | °C | float |
| 30 | `2_16` | `RT601_X3` | value | rw | °C | float |
| 31 | `2_18` | `RT601_X4` | value | rw | °C | float |
| 32 | `2_20` | `RT601_SPK` | value | r | °C | float |
| 33 | `2_11` | `RT901_MV` | value | r | °C | float |

Readings worth keeping:

- **Column order is functional, not alphabetical and not the dump's order.**
  Left block: room comfort — measurement, local adjustment, calculated
  setpoint, heating/cooling actuator output, three fan stages, three alarms,
  two alarm limits, the reset. Right block, after the repeated `Room` column:
  the bathroom (`RT602`/`LZ602`) in the same measurement → setpoint → actuator
  → alarm → limit order, then the eight curve points `Y1…Y4`/`X1…X4`, the
  calculated setpoint and the outdoor temperature.
- The curve columns interleave in the dump (`2_13`, `2_15`, `2_17`, `2_19` are
  the Y values; `2_12`, `2_14`, `2_16`, `2_18` the X values) and are **grouped
  by meaning** on the panel — all four Y, then all four X.
- `RT901_MV`, the outdoor sensor, is per-room in the dump (each controller has
  its own copy) and appears once per row like any other signal.

### 9.1 The extra three objects

`TEMPLATE-8653-ROMKONTROLL` Below the last row sit a manual-reset control and
its two notes:

| `name` | `obj_id` | Position | `tag_text` | Binding |
|---|---|---|---|---|
| `object_1550` | `number_v3_60px_json_obj` | 1422, 1648 | `" "` | `8653_VIRTUAL_V_1_3115_8611_3115_6`, unit `VV_3115`, alias `Skriv 1 for resett` |
| `object_1551` | `number_v3_label_11px_norm` | 1378, 1634 | `Settes til 1 for manuell resett` | none, `zIndex "1100"` |
| `object_1552` | `number_v3_label_11px_norm` | 1392, 1670 | `OBS! Må settes til 0 igjen.` | none, `zIndex "1100"` |

The reset binds to a **virtual** driver (`VIRTUAL`, `unit_id "VV_3115"`), not a
BACnet point. Virtual points are real rows in the dump and are copied like any
other. This cluster is specific to this building — reproduce it when copying
this panel, do not add it to a plant that has no such point.

---

## 10. Output modes

`GLOBAL` Three modes exist. Choosing the wrong one is what produced both
failures; the choice is made **before** any object is written and stated in the
answer.

| Mode | Produces | Choose it only when | On this panel type |
|---|---|---|---|
| **A — data-only JSON** | a custom JSON structure describing rooms/signals | the user explicitly asks for *extracted data*, an *API payload*, a *data table*, a *CSV/JSON export of the parameters* | **never the default.** It is not a panel and cannot be inserted |
| **B — unlinked Designer template** | a valid `iwmac-designer-panel` with `driver_id:"driver_id"`, `linked:"false"`, `unit_id:""` | the user explicitly asks for a *reusable template*, an *unlinked skeleton*, or a panel for a plant whose parameters are not available | legitimate, but it is a **skeleton with the full geometry** — same columns, same rows, same objects, only the bindings withheld |
| **C — linked Designer panel** | the same document with every `driver_id`/`unit_id`/`alias_text` copied from the source | binding data exists for the rooms in scope | **the default** |

> `GLOBAL` **Default rule.** A request based on an attached plant parameter
> export, with enough binding data to resolve the signals, produces the
> **linked panel (mode C)**. Not a dataset, not a skeleton.

Placeholder binding values are legal **only** in mode B, and only because the
import contract requires them (`AI-BRIEFING.txt` §3): the literal
`"driver_id"`, `linked:"false"`, empty `unit_id`. Using them in mode C — real
IDs replaced by placeholders — is the §13.2 failure and is an error, not a
partial result.

If binding data is missing for part of the panel: emit mode C for what is
bound, leave the unresolved cells **empty** (§6.7), and say exactly which rooms
or signals could not be bound and why. Do not silently downgrade the whole file
to mode B, and do not fill the gap with placeholders.

---

## 11. Validation contract

The executable copy is [validate-romkontroll-panel.py](validate-romkontroll-panel.py);
the data copy is `documentation-rules.json` → `panel_types.romkontroll_table`.
Rule ids are stable. Four namespaces: `R-S*` structure, `R-T*` table
relationships, `R-B*` bindings, `R-P*` profile (only with `--profile`), `R-C*`
comparison (only with `--compare`).

### 11.1 Structure — every panel

| Id | Check | Severity |
|---|---|---|
| R-S1 | the file parses as JSON | error |
| R-S2 | `format == "iwmac-designer-panel"` | error |
| R-S3 | `version == 1` | error |
| R-S4 | `panel` exists and is an object | error |
| R-S5 | `single_objects`, `containers`, `graphics` all exist and are arrays | error |
| R-S6 | `counts.*` equals each array's length | error |
| R-S7 | names are `object_0..object_N`, sequential, no gaps, no duplicates | error |
| R-S8 | every object carries all 17 fields | error |
| R-S9 | `posWidth/posHeight/posLeft/posTop` are JSON **numbers**, integers ≥ 0 | error |
| R-S10 | `zIndex` is a **string** on objects and items, and is never `"default"` | error |
| R-S11 | `id == "driver_id"` and `link_name == "link_name"` on every object | error |
| R-S12 | every `obj_id` is in the catalogue **or** in the controls registry (§12 RC-C2); none is marked inactive/outdated/unsupported | error |
| R-S13 | `background_embedded` agrees with `panel.image_data` / `panel.converted` | error |
| R-S14 | no `panel.image_svg_trace` in a generated file | warning |
| R-S15 | no object at (0,0) unless `tag_text` or a binding proves it is intentional — catches geometry that failed to parse | error |
| R-S16 | no two objects share `posLeft`+`posTop` unless the pair is a documented overlap | warning |
| R-S17 | text is UTF-8 with no mojibake (`Ã¸`, `Â°`, `�`) | error |

### 11.2 Table relationships — this panel type

| Id | Check | Severity |
|---|---|---|
| R-T1 | exactly one container, `container_type == "table_container"` | error |
| R-T2 | `unique_id` contains `custom_` | error |
| R-T3 | container `zIndex` is the **number** 4; every item `zIndex` is the **string** `"5"` | error |
| R-T4 | `num_of_col` equals the number of distinct column lefts in the first header band | error |
| R-T5 | `num_of_rows` equals the number of distinct body-cell tops | error |
| R-T6 | every (column, row) pair has exactly one body cell — the grid is complete, `num_of_col × num_of_rows == body cell count` | error |
| R-T7 | header bands: every band carries one header per column, all of equal height | error |
| R-T8 | body rows are evenly pitched at the row height, except across a header band, where the gap is `row_height + header_height` | error |
| R-T9 | `last_y` equals `last_row_top + row_height` | warning |
| R-T10 | every canvas object falls inside a (column, row) cell, at the centred offset of §6.4 | error |
| R-T11 | the label columns (those whose header is the room column or the description) carry **no** canvas objects | warning |
| R-T12 | every body row carries a room label in the first column, and the labels are unique and ascending as integers | error |
| R-T13 | every room carries the same object count, or the difference is reported room by room | warning |
| R-T14 | container item `link_tag == "NA"` and `driver_id == ""` on all items | error |
| R-T15 | `graphics` is empty | error |
| R-T16 | geometry beyond `panel_width`/`panel_height` is reported as **info**, never as an error (§8) | info |

### 11.3 Bindings

| Id | Check | Severity |
|---|---|---|
| R-B1 | the file carries a binding of **some** kind — every object placeholdered (mode B) or every object bound (mode C). No binding of either kind anywhere is the error; otherwise R-B1 reports the detected mode as a note | error / note |
| R-B2 | in mode C, no object with a real `driver_id` has an empty `unit_id` | error |
| R-B3 | mode B withholds **every** binding and mode C withholds none — a file carrying both the literal `"driver_id"` and real ids is half-linked, and is neither mode | error |
| R-B4 | `linked` agrees with the binding: `"true"` whenever `driver_id != "driver_id"`, per `V3scripts.js:514`. `linked:"false"` with a real `driver_id` is impossible | error |
| R-B5 | `driver_id` values are unique across the panel | error |
| R-B6 | with `--source-sql`, every `driver_id` exists in the dump | error |
| R-B7 | with `--source-sql`, every `unit_id` matches the dump row for that `driver_id` | error |
| R-B8 | with `--source-sql`, every `alias_text` is byte-identical to the dump row | error |
| R-B9 | with `--source-sql`, every room present in the dump's scope appears exactly once in the panel, and no room appears that the dump does not have | error |
| R-B10 | alarm-role objects bind to alarm-state parameters, not to alarm limits (§5.1) | warning |

### 11.4 Profile — `--profile TEMPLATE-8653-ROMKONTROLL`

| Id | Check |
|---|---|
| R-P1 | the 34 column lefts and widths of §6.2 |
| R-P2 | 50 rooms, exactly the list in §6.6 |
| R-P3 | header bands at 20 / 699 / 1378, height 85 |
| R-P4 | body rows at 105 + 27·k with the two 112 jumps |
| R-P5 | the obj_id census: 1300 / 250 / 2 / 1 |
| R-P6 | the container's 22 keys with their exact values |
| R-P7 | the three extra objects of §9.1 |

A profile is scoped evidence. It is **not** run against another building's
panel, and a failure under `--profile` on a different plant means the profile
does not apply, not that the panel is wrong.

### 11.5 Comparison — `--compare KNOWN-GOOD.json CANDIDATE.json`

Structural and geometric difference reporting, never byte equality. Reports:

| Id | Reports |
|---|---|
| R-C1 | envelope field differences (excluding `exported_at`, `generator`, `saved_by`) |
| R-C2 | object-count and obj_id-census differences |
| R-C3 | rooms present in the source and missing from the candidate, and vice versa |
| R-C4 | columns present in the source and missing from the candidate, matched by header text |
| R-C5 | per-cell geometry displacement: for each (room, column) present in both, the pixel offset; median and worst reported |
| R-C6 | container-attribute differences |
| R-C7 | bindings present in the source and absent, placeholdered or changed in the candidate |
| R-C8 | z-index band differences |

`GLOBAL` **A clean `--check` is a necessary condition, never a sufficient
one.** Both failed attempts in §13 were valid JSON; the second would have
passed a naive envelope check. Run `--compare` whenever a known-good export of
the same panel type exists — that is the control that sees a missing room, a
missing column and a placeholdered binding.

### 11.6 What this validator cannot do

- It cannot tell whether a `driver_id` that exists in the dump is the *right*
  parameter for that column. `--source-sql` catches an invented id; only the
  column mapping (§9) and a human catch a wrong one.
- Without `--source-sql` it cannot see an invented binding at all: a well-formed
  id naming a parameter the controller does not expose looks exactly like a
  real one.
- It cannot see the rendering. It never says "the panel is correct".

---

## 12. Conflicts

Recorded, not averaged. Full entries in `documentation-change-log.md` Part 8.

| Id | Conflict | Decision |
|---|---|---|
| **RC-C1** | `LIST-PANEL-GENERATION-CONTRACT.md` §1.1 says a list panel is "the **one panel type built out of containers** … one container per table row". E18 is a container-built table panel with **one** container holding all 1,802 cells. | Both are true of their own family. LIST is scoped to the **spjeldliste family** (`container_type: "objects_container"`, one per row); this file owns the **table_container family** (one container, `num_of_rows`/`num_of_col`). LIST §1.1 and §5.1 gain an explicit scope line; neither contract is rewritten to cover both. |
| **RC-C2** | LIST §12 check 9 requires every `obj_id`, objects **and items**, to appear in `DESIGN-OBJECT-CATALOG.md`. `number_v3_cell_grey25` is used 1,700× on a production export and is **absent** from the catalogue and from `reference_data/all-design-objects.json`. It exists only in `reference_data/controls-registry.json` (`{"width":"168","height":"25","zindex":5,"classname":"css_v3_cell_grey25","hasTag":true,"only_tag_text":true,"obj_type":"dummy","canLink":false}`). 991 of the 1,769 controls definitions have no palette entry — the whole `number_v3_cell_*` / `number_v3_val_cell_*` family among them. | The catalogue stays authoritative for **palette-placed** objects. Host-generated **table-cell** types are authoritative in the controls registry. The allowlist becomes "catalogue **or** controls registry", not "catalogue or anything". Validation is **not** weakened: an id in neither source is still an error, and the two cell families are named explicitly rather than allowed by wildcard. |
| **RC-C3** | `AI-AGENT-INSTRUCTIONS.txt` teaches one universal object template — `zIndex "default"`, `linked "false"`, `driver_id "driver_id"`, `link_name ""` — and "containers (empty except spjeldliste)". E18 contradicts all four. | The universal template is the **mode B** template and is labelled as such. A linked panel and a table panel each get an explicit route. The instructions file keeps its 8,000-character cap, so the route is added by paying for it in cuts, not by exceeding the cap. |
| **RC-C4** | The task that commissioned this file proposed a source hierarchy placing `CLAUDE.md` at 2 and the panel-type contract at 4. The repository's single precedence list places the panel-type contract at 3 and `CLAUDE.md` at 4. | The repository list stands — it is one list, printed in six files, and reordering it here would create a second. The requester's intent is met by the **companion table** at the top of this file, which answers "which source owns which kind of fact" without competing with precedence. Recorded rather than silently reconciled. |
| **RC-C5** | `AI-BRIEFING.txt` §9 self-check requires "positions inside the canvas (list panels 7c excepted)". A room-control table is not a 7c list panel and its content is 2.2× the canvas. | The exception is widened to "list panels and room-control tables", with §8 of this file as the owner. The underlying rule (`CLAUDE.md` §19 gotcha #25) already permitted it; only the self-check was narrower. |

---

## 13. The two rejected generations

`ROMKONTROLL` Both are E21. They are recorded because a documentation change
that cannot point at the behaviour it prevents is untested.

### 13.1 Failure 1 — a dataset, not a panel

`Tabell_romkontroll_alle_plan.json`, 1.58 MB. Top-level keys:

```
schema_version, kilde, utvalg, plan_tolkning,
antall_romkontrollere: 50, planoversikt[8], romkontrollere[50]
```

The room analysis was **right** — 50 controllers, 8 floors. The document was
not a panel: no `format`, no `version`, no `panel`, no `single_objects`.
Rejected on sight by the importer.

Root cause: the request said "trenger .json fil" after a conversation about a
panel, and the assistant treated "JSON file" as "serialize the data I
extracted". Prevented by [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md) §1 and
§2, and by §1.2 and §10 above.

### 13.2 Failure 2 — a panel-shaped placeholder

`Romkontroll_alle_plan_IWMAC_Designer.json`, 30 KB. Correct envelope
(`format`, `version: 1`, `panel.single_objects`), `generator: "M365 Copilot"`,
`source_plant_id: ""`, `saved_by: "copilot"`, `background_embedded: false`.
Contents: **59** objects — 50 `number_v3_label_11px_norm` and 9
`number_v3_header_grey75` — **0 containers**, 0 graphics. Every object carried
`linked: "false"`, `driver_id: "driver_id"`, `unit_id: ""`, `link_name: ""`,
`zIndex: "default"`. Only `id: "driver_id"` was right.

Nine specific defects, each with the section that now prevents it:

| # | Defect | Prevented by |
|---|---|---|
| 1 | no live bindings although the dump was supplied | §10 default rule + QA stage 0.4 — a **routing** decision, made before the validator runs. With `--source-sql` the validator warns `R-B6: the panel carries no bindings - nothing to check against the dump` |
| 2 | placeholders in place of real ids | §10. A file where *every* object is placeholdered is a valid mode-B template and is rejected at routing, not by a binding rule; R-B3 is what fires the moment placeholders and real ids are mixed |
| 3 | one label `obj_id` used for every room, no value objects | §5, R-T10 |
| 4 | no signal-specific object types, no alarm indicators | §5.1, R-B10 |
| 5 | no table layout — headings and labels only | §6, R-T4…R-T12 |
| 6 | no container at all | §4, R-T1 |
| 7 | no background handling (`background_embedded: false`, no `image_data`) | §2, R-S13 |
| 8 | wrong dimensions and z-indexes (`zIndex: "default"`) | §6.4, §6.5, R-S10 |
| 9 | 1/50 of the panel's extent — 59 objects instead of 1,553 | §8, R-C2 (six census warnings, including `1553 objects in the source, 59 in the candidate`) and R-C3 (error). R-C5 cannot fire: with no container there is no grid, so no cell displacement exists to measure |
| 10 | `link_name: ""` instead of the literal `"link_name"` | §3, R-S11 |

Root cause: the only object template the assistant had was the **unlinked
mode-B** template in `AI-AGENT-INSTRUCTIONS.txt`, presented as universal, plus
"containers (empty except spjeldliste)". It followed its instructions
faithfully. That is conflict RC-C3, and it is why the fix is a change to the
instructions file, not a warning in a document Copilot never reads.

### 13.3 Would the revised documentation have prevented them?

Traced deliberately, because a documentation change that only *describes* the
failure is not a fix:

| Failure | First document that stops it | At which step |
|---|---|---|
| §13.1 | `AI-REQUEST-ROUTING.md` §1 keyword route + §2 "a .json request inside a panel conversation inherits the panel task" | before any content is generated |
| §13.1 | this file §1.2 "if the answer does not contain `panel.single_objects`, it is not this panel type" | at the self-check |
| §13.2 | `AI-AGENT-INSTRUCTIONS.txt` mode line: a supplied parameter dump ⇒ mode C, linked | at mode selection, the first decision |
| §13.2 | this file §5 role table and §6 geometry | at object selection and placement |
| §13.2 | `validate-romkontroll-panel.py --check` | R-T1 (no container), R-S10 (`zIndex "default"`), R-S11 (`link_name`) — three independent errors; `--profile TEMPLATE-8653-ROMKONTROLL` adds R-P1 |
| §13.2 | `--compare` against E19 | 32 comparison findings: R-C3 and R-C8 as errors, plus 21 × R-C6 (every container attribute absent), 6 × R-C2 (census) and 3 × R-C1 (envelope) as warnings |

The rule ids in these two rows are **measured**, not predicted. Both failures are
reproduced by [build-romkontroll-negatives.py](build-romkontroll-negatives.py)
(`dataset-not-a-panel`, `placeholder-overview`) and the exact error sets are
pinned by `RejectedGenerationTest` in
[tests/test_romkontroll_8653_contract.py](tests/test_romkontroll_8653_contract.py).
Where an earlier draft of this table named a rule that does not in fact fire —
R-B1 and R-C4 on §13.2 — the table was corrected to the measurement rather than
the validator widened to the table: see
[documentation-change-log.md](documentation-change-log.md) and
[ROMKONTROLL-QA-CHECKLIST.md](ROMKONTROLL-QA-CHECKLIST.md) "The two failures
this checklist exists to catch", which explains why each one stays silent.

---

## 14. Regression tests

[`tests/test_romkontroll_8653_contract.py`](tests/test_romkontroll_8653_contract.py)
— 97 tests, run from `iwmac-designer-reference/` (the suffix is the plant, as in
`test_oversikt_10113_contract.py`; `unittest discover -s tests` does not work
here, so run the module by name):

```bash
python -m unittest tests.test_romkontroll_8653_contract
```

It asserts, against the committed fixture E19: the envelope, the container's 22
keys, the 34 columns and 50 rooms, the object census, the placement formula for
all 1,550 grid objects, the seven constants, the two z-bands, and that
`validate-romkontroll-panel.py --check` and `--profile
TEMPLATE-8653-ROMKONTROLL` both report zero errors. It also asserts that the
two negative fixtures built by `build-romkontroll-negatives.py` — the §13.1
dataset and the §13.2 placeholder overview — are **rejected**, with exactly the
rule ids listed in §13.3. A change that makes the fixture pass by loosening a
rule breaks the negative tests.

Five of the tests need the plant's parameter dump, which is not committed. They
skip unless it is pointed at:

```bash
IWMAC_ROMKONTROLL_SQL="/path/to/iw_gen_driver_parameters.sql" python -m unittest tests.test_romkontroll_8653_contract
```

## 15. Scope summary

| Statement | Scope |
|---|---|
| The envelope, the 17 fields, `linked` semantics, the never-invent rules, viewport-vs-content | `GLOBAL` |
| One `table_container`; value/alarm object split; centred placement in a cell; header repeat; room-per-row; empty cell for a missing signal; column = one `menu` code | `ROMKONTROLL` |
| The 34 columns and their widths, the 50 rooms, the menu codes, the header band tops, the `_AL*` suffix list, the reset cluster, the counts 1553/1802/1300/250 | `TEMPLATE-8653-ROMKONTROLL` |
| "Prefer a production-observed `obj_id` to an unobserved one" | `ADVISORY` |
