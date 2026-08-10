# List panel generation contract (spjeldliste and other long tabular lists)

How to turn a source table — Excel, CSV or JSON — into an importable IWMAC
Designer V5 **list panel**. This file answers **how a list panel is generated**,
deterministically, for an arbitrary new table.

[VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) is the
equivalent file for schematic ventilation panels; it does not apply here.
[DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) answers **which `obj_id`**.
[AI-BRIEFING.txt](AI-BRIEFING.txt) answers **what shape the file has**.
[CLAUDE.md](CLAUDE.md) answers **what the host does with it on import**.

Every coordinate here is a literal `posLeft`, `posTop`, `posWidth`, `posHeight`,
`left`, `top`, `width` or `height` read out of a real export. Nothing is
estimated, rounded, or averaged between sources.

---

## How to read this file

### Section map — the eight required separations

| Part | Sections |
|---|---|
| **A. Source-table interpretation** | §2, §7 |
| **B. Template selection** | §1, §6 step 2 |
| **C. Column mapping** | §7 |
| **D. Row and group construction** | §5, §6 steps 5–9, §8.5–§8.9, §9 |
| **E. Linking modes** | §10 |
| **F. Geometry and overflow** | §8 |
| **G. Validation** | §12, §14 |
| **H. Output-only behaviour** | §15 |

### Source precedence — normative

When two sources disagree, take the higher rank. **Never average conflicting
coordinates.** A supplied export becomes the geometric template, whole.

| Rank | Source |
|---|---|
| 1 | A panel JSON or screenshot supplied with the current task |
| 2 | A production export of the same panel **and system type** |
| 3 | **This file** — `LIST-PANEL-GENERATION-CONTRACT.md` |
| 4 | Panel-specific rules in [CLAUDE.md](CLAUDE.md) |
| 5 | [AI-BRIEFING.txt](AI-BRIEFING.txt) or its accepted revision |
| 6 | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |
| 7 | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| 8 | Generic visual-design advice |

Same eight-rank list as
[documentation-rules.json](documentation-rules.json) → `source_precedence` and
as §"Source precedence" of the ventilation contract. There is one list.

**Every resolved conflict is recorded**, in §16 of this file and in
[documentation-change-log.md](documentation-change-log.md), with the winning
source named. A conflict silently resolved is a conflict that will come back.

**When evidence is missing, mark the gap and stop.** Never infer or invent an
`obj_id`, `driver_id`, `unit_id`, navigation target, plant id, signal alias, or
production coordinate. Unresolved questions go in §16, not into a plausible
number. The failure messages for each stop condition are in §14.

### Scope tags

**Every rule carries a scope tag.** Do not promote a tag by inference.

| Tag | Meaning |
|---|---|
| `GLOBAL` | Holds for every IWMAC Designer panel of any type |
| `LIST` | Holds for every spjeldliste-style list panel; **independently confirmed in two production exports from two different plants** (E5 and E6) |
| `TEMPLATE-SPECIFIC` | Measured in one export only. A different list may legitimately differ. Do not universalize |
| `ADVISORY` | Judgement or convention, not a measurement |

`LIST` is the only tag that generalizes. A `TEMPLATE-SPECIFIC` coordinate copied
onto a different list without evidence is the failure mode this tagging exists
to prevent.

### Evidence

| Id | Artefact | Content | Committed? |
|---|---|---|---|
| **E5** | `iwmac-panel_5295_360-001-spjeldliste_ny.json` (user `Downloads\`) | Plant 5295, system 360.001. 55 `single_objects`, 25 `containers`, 0 `graphics`. `exported_at 2026-08-10T06:52:20.942Z`, `generator "IWMAC Designer Helper"`, `saved_by "copilot"`, `background_embedded true`, `panel.converted "true"`. 26 damper entries, 2 groups. Live driver ids present | **No** — live plant id, not committed |
| **E6** | [reference_data/real-spjeldliste-example.json](reference_data/real-spjeldliste-example.json) | System 360.004, plant masked to `NNNNN`. 383 `single_objects`, 208 `containers`. `generator "IWDIE v1.2.0"`, `saved_by "user"`, `background_embedded false`. 210 damper entries, 21 groups. No live bindings | **Yes** |
| **E7** | `Spjeld liste med sjaktspjeld 06.02.26_with_driver_id_no.xlsx` (user `Downloads\`) | Sheet1, 1104 data rows × 26 columns, inline strings. 28 rows carry `System nr. == 360.001` — the source table behind E5 | **No** — customer data |
| **E8** | `Spjeldliste_360.001_companion.json` (user `Downloads\`) | 1 048 bytes, `"format": "iwmac-designer-task-companion"`. A worked instance of the §15 anti-pattern, retained as a negative example | **No** |

**Provenance grading of E5 — disclose this when E5 decides a rule.** E5 is
*user-supplied panel JSON for the current task*, so it holds precedence rank 1.
But it is not a userscript export: the userscript writes
`generator: 'IWDIE v<version>'`, and its Insert help text tells a human author to
write `"generator": "<your name>"`. `"IWMAC Designer Helper"` with
`saved_by "copilot"` means E5 is **agent-authored in insert format**. It is
therefore weaker as *production* evidence than E6, which is a genuine `IWDIE`
export. Where the two agree, the fact is `LIST`. Where only E5 shows something,
it is `TEMPLATE-SPECIFIC` and its agent provenance is stated.

> **Filename note.** The brief named
> `iwmac-panel_5295_360-001-spjeldliste_20260810-0852.json`. No file of that name
> exists anywhere under `C:\Users\Thomas`. `…_ny.json` — same plant, same system,
> `exported_at` 08:52 UTC on the same day — was used in its place and is what E5
> refers to. This substitution is disclosed rather than silently absorbed.

---

## 1. Scope and classification

### 1.1 What a list panel is `LIST`

A list panel is the **one panel type built out of containers.** Every other
documented panel type — ventilation, kjøl, maskin, energi — is a flat field of
`single_objects` over a background image, with `panel.containers` empty.

| | Normal panel | List panel |
|---|---|---|
| `panel.single_objects` | all content | scaffold only — banner, headers, dividers, group stripes, separators |
| `panel.containers` | `[]` | **one container per table row** |
| `panel.graphics` | `[]` unless artwork is preserved | `[]` in both E5 and E6 |
| Background | plant artwork | blank canvas (`00-blank-1400x750`) |
| Content bounds | inside the canvas | **deliberately outside it** — see §8.10 |

A "table-style blank panel" that is really just labels laid out in a grid is
**not** a list panel and must not be built from this contract. The test is
mechanical: if a row must repeat an identical multi-column cell group tens or
hundreds of times, use a list panel; if the panel has a handful of rows and no
repeating row template, use `single_objects` and the ordinary panel rules.

> **⚠️ "One container per table row" is `LIST`, not `GLOBAL` — conflict RC-C1.**
> This contract describes the **spjeldliste family**: `container_c` containers,
> one per row, 208 of them in E6, with the cells as container *items*. The
> room-control table (`Tabell romkontroll alle plan`) is container-built too and
> does the opposite: **one** `table_container` draws the entire 34 × 50 grid, and
> every live value is a `single_object` on the canvas, centred in its cell. Both
> statements are measured and neither is general. Do not apply this contract's
> row geometry, container schema or `container_c` shape to a room-control table —
> that panel type is owned by
> [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md), and
> which of the two a request means is decided in
> [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md). Neither document is rewritten to
> match the other; each keeps its scope tag.

### 1.2 When to use the spjeldliste template `ADVISORY`

Use it when **all** of the following hold:

1. The output is one long tabular list of like items, each identified by a tag.
2. Rows repeat one fixed column set.
3. The row count is large enough that vertical overflow past the 750 px canvas
   is acceptable (E6 runs to y 4 668).

Use it as the template for a **different** list type too — a valve list, a fan
list, a room list — but see class (d) in §1.3: changing the columns changes the
column-x table, and the new x values are then unmeasured. Do not present them as
`LIST` facts.

If the request is for a long list of items that are *not* one homogeneous type,
stop and ask rather than inventing a hybrid template.

### 1.3 The four request classes

| Class | Request | Must be preserved | May change |
|---|---|---|---|
| **(a)** | New **unlinked** list from a table | Envelope shape; scaffold object set and geometry (§8.1–§8.4); container schema (§5); the seven-column x table (§7.3); the unlinked binding contract (§10.1) | Row count, row content, group segmentation, divider height, stripe positions, `panel_name`, container count |
| **(b)** | **Same-plant linked** list, using driver data supplied with the task | Everything in (a), **plus** every `driver_id`, `unit_id`, `unit_ref` and `alias_text` exactly as supplied — copied, never derived | Which cells are live (§10.3), row content, geometry that follows from row count |
| **(c)** | Copy or modification of a supplied production list | Everything the supplied file contains that the request does not explicitly change, **including its artefacts** (§11): `#c1`/`#c2` markers, duplicate group stripes, ad-hoc separators, `linked:"true"` on static cells | Only the fields the request names, plus the geometry that must follow (row tops, divider height, stripe tops, counts) |
| **(d)** | New list type with **changed columns** | Envelope, container schema, row pitch, group gap, banner and divider *structure*, the binding contract | The column set, every column x, the header text, the header count, the divider count and x positions |

**Class (d) is the one that loses evidence.** The x table in §7.3 is measured for
the seven spjeldliste columns. A different column set has no measured x values.
Derive them, state that they are derived, tag them `ADVISORY`, and say so in the
response — do not present them as production geometry.

---

## 2. Required inputs and stop conditions

### 2.1 Knowledge files

Read before generating. If one cannot be opened, name it exactly and stop
(`E-KB-MISSING`, §14).

| File | Needed for |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Host behaviour on import, container collector, gotchas |
| [AI-BRIEFING.txt](AI-BRIEFING.txt) | Envelope, 17-field schema, linking rules |
| [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) | `obj_id` validity |
| **This file** | Everything list-specific |
| [documentation-rules.json](documentation-rules.json) | Machine-readable invariants (`panel_types.list_panel`) |

### 2.2 Source-table fields

| Role | Required? | Missing behaviour |
|---|---|---|
| Damper / item tag (`Spjeldnr.`) | **Required** | **Stop** — `E-COL-MISSING`. It is the row identity; without it there is no row |
| Room number (`Romnr.`) | Optional | Leave the cell blank (`tag_text ""`), keep the object |
| Design minimum flow (`Prosj. min. m³/h`) | Optional | Leave blank |
| Design maximum flow (`Prosj. maks. m³/h`) | Optional | Leave blank |
| Measured value (`Erverdi`) | Optional | Omit the cell entirely unless live output was requested — see §10 |
| Flow setpoint (`SP.pådrag m³/h`) | Optional | Omit unless live |
| Damper angle (`Spjeldvinkel %`) | Optional | Omit unless live |
| Group / section key | Optional | Whole table becomes one group; no gap, one stripe |
| Row order key | Optional | Source-table order is used, unchanged |
| Side (left / right half) | Optional | See §9 — **may stop** |
| Driver address or driver id | Only for class (b) | **Stop** — `E-LINK-NODATA` — if linked output was requested |

### 2.3 Hard stop conditions

Stop, emit the §14 message, and produce no file:

1. A knowledge file in §2.1 cannot be opened → `E-KB-MISSING`.
2. The tag column cannot be identified → `E-COL-MISSING`.
3. A linked list was requested and no driver data was supplied → `E-LINK-NODATA`.
4. A required `obj_id` is not in the catalogue → `E-OBJID-UNKNOWN`.
5. Side allocation is ambiguous and the request needs two half-tables →
   `E-SIDE-AMBIG` (§9.4).
6. A requested column has no production object mapping → `E-COL-UNMAPPED`.

**Never infer or invent** an `obj_id`, `driver_id`, `unit_id`, navigation
target, plant id, signal alias, or production geometry. These are not gaps to be
filled plausibly; they are stop conditions.

### 2.4 What may be left blank instead of stopping

A cell whose source value is empty gets `tag_text ""` and **keeps its object**,
so every row carries the same role set. A whole column absent from the source
table is omitted from every row — the remaining columns keep their measured x
values; they do not reflow.

> **Production does both, and this is the one place the contract picks rather
> than copies.** In E6, 31 of 185 left-half rows have no `room` cell at all
> rather than an empty one; in E5, 2 of 21. Elsewhere the opposite: 5 E6 rows
> and 2 E5 rows carry a `design_min` cell whose `tag_text` is blank. Nothing
> predicts which a human did. **Emitting the object with `tag_text ""` is the
> rule here** — `ADVISORY`, chosen because it makes "every row has the same
> roles" a checkable invariant (§12 check 16) and because an omitted object
> cannot be told apart from a bug. Preserve whichever form a supplied export
> already uses when editing it (class (c)).

---

## 3. Canonical panel envelope

### 3.1 Required top level `GLOBAL`

```jsonc
{
  "format": "iwmac-designer-panel",   // exactly this string
  "version": 1,                        // integer 1, not "1"
  "generator": "<who wrote it>",
  "source_plant_id": "",              // "" for an unlinked demo; the plant id only when bindings are real
  "panel_name": "<name>",
  "panel_width": "1400px",             // a STRING with the px suffix, not a number
  "panel_height": "750px",
  "counts": { "single_objects": 0, "containers": 0, "graphics": 0 },
  "background_embedded": false,
  "panel": { }
}
```

`counts` **must equal the actual array lengths** — `counts.single_objects ==
len(panel.single_objects)`, `counts.containers == len(panel.containers)`,
`counts.graphics == len(panel.graphics)`. Verified true in E5 (55 / 25 / 0) and
E6 (383 / 208 / 0). This is the single cheapest validation in the whole contract
and it is checked first.

`exported_at` is present in both exports but is **not required**; omit it rather
than fabricate a timestamp.

**`panel_width` and `panel_height` are strings carrying the `px` suffix** —
`"1400px"`, `"750px"` — at both envelope level and inside `panel`. E5, E6 and
the ventilation references all agree, and the userscript's own Insert-help
template prints the same strings. The value is handed to
`iw_set_base_image(doc.panel_width, doc.panel_height, …)` unchanged, so a bare
number is not a stylistic variant. Object coordinates, by contrast, are integers
(§12 check 10).

### 3.2 `panel` keys `LIST`

| Key | Value | Evidence |
|---|---|---|
| `single_objects` | array — scaffold only | E5, E6 |
| `containers` | array — one per row | E5, E6 |
| `graphics` | `[]` | E5 (0), E6 (0) |
| `panel_width` / `panel_height` | the **strings** `"1400px"` / `"750px"` | E5, E6 |
| `org_image_name` | `"00-blank-1400x750"` | E5, E6 |
| `plant_id` | `""` for an unlinked demo | see §10.1 |

**`graphics` stays empty** unless the task supplies a panel whose graphics must
be preserved (class (c)). Never synthesize graphics for a list panel.

### 3.3 Background handling `LIST`

Both exports sit on the blank 1400×750 canvas named `00-blank-1400x750`. They
differ in how it is carried:

| | E5 | E6 |
|---|---|---|
| `background_embedded` | `true` | `false` |
| `panel.converted` | `"true"` | absent |
| `panel.image_data` | 5 610-char data URI | absent |
| `panel.image_svg_trace` | 267 chars, imagetracer.js 1.2.6 | absent |
| `panel.image_name` | `""` | `"00-blank-1400x750"` |

**For generated output, use the E6 form:** `background_embedded: false`, no
`image_data`, `image_name` and `org_image_name` both `"00-blank-1400x750"`. The
host resolves the named blank itself; embedding it adds kilobytes that carry no
information. Embed a background **only** when preserving one that was supplied
(class (c)), in which case copy `image_data`, `image_svg_trace`, `converted` and
`background_embedded` together, unchanged.

### 3.4 Minimal valid envelope

Complete, importable, two rows in one group. Scaffold reduced to the banner and
one column header so the shape is readable; a real panel carries the full
scaffold of §8.

```json
{
  "format": "iwmac-designer-panel",
  "version": 1,
  "generator": "list-panel-contract minimal example",
  "source_plant_id": "",
  "panel_name": "Minimal list",
  "panel_width": "1400px",
  "panel_height": "750px",
  "counts": { "single_objects": 2, "containers": 2, "graphics": 0 },
  "background_embedded": false,
  "panel": {
    "plant_id": "",
    "panel_width": "1400px",
    "panel_height": "750px",
    "image_name": "00-blank-1400x750",
    "org_image_name": "00-blank-1400x750",
    "graphics": [],
    "single_objects": [
      {
        "obj_id": "previous_page_tekn_box_no", "name": "object_0", "id": "driver_id",
        "posWidth": 1570, "posHeight": 57, "posLeft": 15, "posTop": 50, "zIndex": "5",
        "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "",
        "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "",
        "alias_text": "new text"
      },
      {
        "obj_id": "number_v3_label_12px_bold", "name": "object_1", "id": "driver_id",
        "posWidth": 50, "posHeight": 20, "posLeft": 83, "posTop": 90, "zIndex": "900",
        "tag_text": "Spjeldnr.", "linked": "true", "link_name": "link_name", "link_tag": "",
        "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "",
        "alias_text": "new text"
      }
    ],
    "containers": [
      {
        "id": "objects_container", "unique_id": "custom_0",
        "name": "objects_container_0", "type": "container_c",
        "container_type": "objects_container", "className": "objects_container",
        "header_footer": [], "linked": "0", "linked_to": "0",
        "width": 1544, "height": 23, "left": 19, "top": 106,
        "zIndex": 4,
        "items": [
          {
            "obj_id": "number_v3_label_12px_bold", "name": "object_14", "id": "driver_id",
            "posWidth": 50, "posHeight": 20, "posLeft": 0, "posTop": 3, "zIndex": "900",
            "tag_text": "=999.001-SQ401", "linked": "true", "link_name": "link_name", "link_tag": "",
            "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "",
            "alias_text": "new text"
          }
        ],
        "title": "Objects Container"
      },
      {
        "id": "objects_container", "unique_id": "custom_1",
        "name": "objects_container_1", "type": "container_c",
        "container_type": "objects_container", "className": "objects_container",
        "header_footer": [], "linked": "0", "linked_to": "0",
        "width": 1544, "height": 23, "left": 19, "top": 126,
        "zIndex": 4,
        "items": [
          {
            "obj_id": "number_v3_label_12px_bold", "name": "object_14", "id": "driver_id",
            "posWidth": 50, "posHeight": 20, "posLeft": 0, "posTop": 3, "zIndex": "900",
            "tag_text": "=999.001-SQ402", "linked": "true", "link_name": "link_name", "link_tag": "",
            "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "",
            "alias_text": "new text"
          }
        ],
        "title": "Objects Container"
      }
    ]
  }
}
```

`=999.001-…` is a synthetic tag in a reserved-looking system number, chosen so
it cannot collide with a real plant. It is not production data.

---

## 4. Canonical 17-field object schema

### 4.1 The field list `GLOBAL`

Every object — in `single_objects` **and** inside `container.items` — carries all
seventeen fields, in this order. A missing field is a validation failure, not a
default.

`obj_id`, `name`, `id`, `posWidth`, `posHeight`, `posLeft`, `posTop`, `zIndex`,
`tag_text`, `linked`, `link_name`, `link_tag`, `sub_group`, `driver_id`,
`unit_id`, `unit_ref`, `alias_text`

Confirmed 17/17 on all 55 + 383 `single_objects` and on every container item in
E5 and E6.

Types: `posWidth`, `posHeight`, `posLeft`, `posTop` are **integers**. `zIndex`
is a **string** on objects (`"900"`, `"5"`, `"3"`, `"155"`) and an **integer**
on containers (§5). `linked` is the **string** `"true"` or `"false"`, never a
boolean. `tag_text` is a string, or `null` on a live value cell (§4.4). `linked`,
`link_name`, `link_tag`, `sub_group`, `unit_ref` and `alias_text` are constants
in a list panel — see §4.2 before writing any of them.

### 4.2 The seven constant fields — measured, and not what you expect `LIST`

Before the templates, the finding that governs all of them. Across **every**
object in both exports — 55 + 383 `single_objects` and 93 + 788 container items,
1319 objects in total — seven fields are constants, and they are **not** the
unlinked sentinels used on ventilation panels:

| Field | Value in a list panel | Exceptions |
|---|---|---|
| `id` | `"driver_id"` | none — 1319/1319 |
| `linked` | `"true"` | none — 1319/1319, including the banner and the column headers |
| `link_name` | `"link_name"` | none — 1319/1319 |
| `link_tag` | `""` | `"NA"` on `number_v3_header_appgrey` (dividers) and `number_v3_header_grey50` (stripes) — 264/264 of those, in both exports |
| `sub_group` | `""` | none |
| `unit_ref` | `""` | none |
| `alias_text` | `"new text"` | the 78 genuinely linked live cells in E5, which carry the real signal alias |

`driver_id` and `unit_id` are the only fields that carry information: `""` on all
scaffold, `""` / `"#c1"` / `"#c2"` on static cells (§10.5), a real BACnet id and
unit on a linked live cell.

**This contradicts `global_invariants.unlinked_demo_contract`**, which specifies
`linked "false"`, `link_name ""`, `driver_id "driver_id"` for an unlinked
generated panel. That rule was written for ventilation panels, where objects
genuinely *were* linked and had to be sanitized. A list panel's scaffold was
never linked: `linked "true"` with an empty `driver_id` is the Designer's
default state for a freshly placed object, and both production exports carry it
on 100% of their objects.

**Resolution — reproduce the production form.** Emitting `linked "false"` and
`driver_id "driver_id"` would make a generated list panel differ from every
existing one in every object, which destroys role-based diffing for no gain. The
guarantee that matters is preserved a different way, and it is the rule a
validator enforces:

> **A generated list panel must contain no non-empty `driver_id`, `unit_id` or
> `alias_text` other than values copied verbatim from supplied data.** Empty is
> the unlinked state here; `"false"` is not required and is not observed.

Recorded as conflict L-13 in §16.1.

### 4.3 Template — unlinked static label cell

The default for class (a). A text cell showing a value copied from the source
table.

```json
{
  "obj_id": "number_v3_label_12px_bold",
  "name": "<ROLE_NAME_FROM_§7.3>",
  "id": "driver_id",
  "posWidth": 50, "posHeight": 20,
  "posLeft": "<COLUMN_X_FROM_§7.3>", "posTop": 3,
  "zIndex": "900",
  "tag_text": "<VALUE_FROM_SOURCE_TABLE>",
  "linked": "true",
  "link_name": "link_name", "link_tag": "",
  "sub_group": "",
  "driver_id": "",
  "unit_id": "", "unit_ref": "",
  "alias_text": "new text"
}
```

Every field except `name`, `posLeft` and `tag_text` is a literal constant.
`posTop: 3` centres a 20 px cell inside a 23 px row.

Do **not** write the column role into `alias_text`. It is tempting and it is an
invention: 881 of 881 unlinked cells across both exports read `"new text"`, and
a validator that checks "no `alias_text` outside the copied set" will flag it.

### 4.4 Template — unlinked **live-value placeholder** cell

For a panel that should show live values but has no driver data yet, so a human
can link it in the Designer afterwards.

```json
{
  "obj_id": "number_v3_value_only",
  "name": "<ROLE_NAME_FROM_§7.3>",
  "id": "driver_id",
  "posWidth": 50, "posHeight": 20,
  "posLeft": "<COLUMN_X_FROM_§7.3>", "posTop": 0,
  "zIndex": "900",
  "tag_text": null,
  "linked": "true",
  "link_name": "link_name", "link_tag": "",
  "sub_group": "",
  "driver_id": "",
  "unit_id": "", "unit_ref": "",
  "alias_text": "new text"
}
```

Identical to the linked cell of §4.5 except that `driver_id`, `unit_id` and
`alias_text` stay empty / default. That is deliberate: the placeholder and the
bound cell differ **only** in the three fields that carry real identifiers, so
linking one afterwards is a three-field edit and a diff shows exactly what was
bound.

`tag_text` is `null`, not `""` — 78/78 live cells in E5. The collector writes
`tag_text` unconditionally and the renderer replaces it with the live value, so
`null` is the correct empty here (CLAUDE.md §6a).

`posTop` is **0** for a live cell and **3** for a static cell. Both measured in
E5 (78 live cells at 0, all 93 static cells at 3). Do not normalize them to one
value.

> **`alias_text` and later manual linking.** The brief asks how `alias_text`
> guides it. Honest answer for list panels: **it does not.** In both exports
> every unlinked object carries the Designer default `"new text"`, and only a
> genuinely bound cell carries a real alias such as
> `"spjeld_luftmengde_mv_1 [ Spjeld - Aktuell luftmengde ]"`. A human links a
> placeholder by its **position in the table** — the row's `damper_tag` cell is
> the identifier, not the alias. Writing a hint into `alias_text` is a local
> convention with no production precedent; if a task explicitly asks for it, say
> so in the response and record it as a deliberate deviation.

### 4.5 Template — linked live-value cell copied from supplied source data

For class (b) only. Every identifier below is **copied verbatim** from the
supplied data. None is derived, and none is transcribed by hand from a
screenshot.

```json
{
  "obj_id": "number_v3_value_only",
  "name": "<ROLE_NAME_FROM_§7.3>",
  "id": "driver_id",
  "posWidth": 50, "posHeight": 20,
  "posLeft": "<COLUMN_X_FROM_§7.3>", "posTop": 0,
  "zIndex": "900",
  "tag_text": null,
  "linked": "true",
  "link_name": "link_name",
  "link_tag": "",
  "sub_group": "",
  "driver_id": "<COPY_FROM_SOURCE>",
  "unit_id": "<COPY_FROM_SOURCE>",
  "unit_ref": "",
  "alias_text": "<COPY_FROM_SOURCE>"
}
```

Only three fields are copied. `link_tag`, `sub_group` and `unit_ref` are empty
on all 78 linked cells in E5 — binding a list cell does **not** populate them,
and a `<COPY_FROM_SOURCE>` placeholder in those three would be asking for data
that does not exist.

**On the shape of `driver_id`.** In E5 every live cell carries a BACnet driver id
of the documented form
`<plant>_<DRIVERNAME>_<dev>device<dev>_0_<dev>_<objtype>_<instance>_85`, with
object-type digit `2` (BACnet AV) and property `85` (present-value). Six of its
eight segments reproduce exactly from the `bacnet://<device>/AV:<instance>`
address in the source workbook — **verified 63 of 63, zero mismatches** (E5 × E7).

The two segments that do **not** reproduce are `<DRIVERNAME>` and `unit_id`.
Both are a per-device lookup that exists only inside the plant's own
configuration. In E5 they resolve as, for example, device `2400077 →
(BACNET26, RC378)` — nine such pairs, all distinct, no pattern connecting the
device number to either value.

**Therefore a driver id may never be assembled from an address.** Six of eight
segments being derivable is exactly the trap: the result looks right and binds
to nothing. Copy the whole id, or stop with `E-LINK-NODATA`.

Related: the workbook's own `*_driver_id_no` columns (values like `33827`,
`85410`) appear **nowhere** in E5 — zero verbatim matches across the panel. They
are a different identifier space. Do not put them in `driver_id`.

### 4.6 Never invented

`obj_id` · `driver_id` · `unit_id` · `unit_ref` · `link_tag` · `sub_group` ·
`alias_text` · navigation target · plant id. Where evidence is required and
absent, write the literal placeholder `"<COPY_FROM_SOURCE>"` and say in the
response which fields still need filling — do not emit an identifier that has
never been observed.

---

## 5. Canonical container schema

### 5.1 The sixteen container fields `LIST`

One container = one table row. Field-set identical on all 25 containers in E5 and
all 208 in E6.

| Field | Type | Value | Scope |
|---|---|---|---|
| `id` | string | `"objects_container"` — constant, **not** the row index | `LIST` |
| `unique_id` | string | `custom_<i>` | `LIST` |
| `name` | string | `objects_container_<i>`, same `i` | `LIST` |
| `type` | string | `"container_c"` | `LIST` |
| `container_type` | string | `"objects_container"` | `LIST` |
| `className` | string | `"objects_container"` | `LIST` |
| `header_footer` | array | `[]` | `LIST` |
| `linked` | string | `"0"` | `LIST` |
| `linked_to` | string | `"0"` | `LIST` |
| `width` | integer | `1544` | `LIST` |
| `height` | integer | `23` | `LIST` |
| `left` | integer | `19` | `LIST` |
| `top` | integer | per §8.5 | `LIST` |
| `zIndex` | **integer** | `4` | `LIST` |
| `items` | array | the row's cells | `LIST` |
| `title` | string | `"Objects Container"` | `LIST` |

**The table is in the collector's emission order**, `items` second-to-last and
`title` last — `title` is a merged custom attribute and is appended after the
item array (`container_tool.js:2254-2262`). Key order is not load-bearing:
`load_new_ver_containers` reads every field by name. Match it anyway, so a
generated row byte-diffs cleanly against a production one.

Four of these read like placeholders and are not:

- **`id` is the string `"objects_container"`, identical on every container.**
  It is neither the row index nor the object-level `id` sentinel `"driver_id"`.
  All 25 E5 containers and all 208 E6 containers carry it.
- **`linked` and `linked_to` are the strings `"0"`**, not `"false"` and not
  `""`. The object-level `linked` sentinel *is* `"false"` (§4.1) — the two
  levels disagree, and both are reproduced verbatim.
- **`title` is `"Objects Container"`**, not empty, on all 233 production
  containers. Nothing renders it.
- `zIndex` is an integer where every object `zIndex` is a string (§5.2).

> **Sixteen fields is the `LIST` container shape, not the container shape.** The
> host's `table_container` flavour carries **22** keys — these sixteen with
> `type "container_c"` but `container_type "table_container"`, `title "Table
> Container"`, and the six table-state fields `num_of_rows`, `num_of_col`,
> `descr_width`, `val_width`, `cells`, `last_y` merged in from
> `table_container.tablecontainer[<name>]` (`container_tool.js:3699-3849`,
> CLAUDE.md §6). Measured on E19: 22 keys, `unique_id "custom_0"`, `zIndex` the
> integer `4` as here, items at `"5"` rather than `"900"`. Conflict **RC-C1**:
> both field sets are real, each belongs to its own panel type, and neither is
> the general case. The table flavour is specified in
> [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) §4.

### 5.2 The zIndex type split — not a typo `LIST`

**Container `zIndex` is the integer `4`. Item `zIndex` is the string `"900"`.**
Both exports, every container, every item. Emitting `"4"` or `900` inverts the
observed types. A validator must check the type, not just the value.

The same split applies to scaffold objects, which are `single_objects` and so use
strings: `"900"`, `"5"`, `"3"`, `"155"` (§8).

### 5.3 Sequential ids `LIST`

`unique_id == "custom_" + i` and `name == "objects_container_" + i`, for `i` from
0, with no gaps and no duplicates. Verified true across all 25 E5 containers and
all 208 E6 containers. `id` does **not** participate — it is the same constant
string on every row (§5.1).

This ordering follows the **emission order**, which is the visual order top to
bottom. Do not renumber after sorting.

### 5.4 Item naming policy `LIST`

Item `name` values **collide freely** — within a row, across rows, and with
`single_objects` names on the same canvas. E6 has 208 rows all naming their tag
cell `object_14`. The host does not care: `constructItems` appends items to the
container it is building, and nothing resolves an item by name.

**The deterministic policy is to copy the template's role→name mapping**, which
is identical in E5 and E6 (§7.3, "item name" column). This is evidence-backed,
requires no invention, round-trips through the Designer unchanged, and makes two
generated panels diff cleanly by role.

Do **not** invent a new naming scheme such as `cell_0_tag`. It would import fine
but would diff badly against every existing export, and role-based diffing is
how these panels are reviewed.

### 5.5 What a container never contains `LIST`

No nested containers. No `graphics`. No scaffold objects — the banner, headers,
dividers, group stripes and separators are `single_objects`, never items. A
scaffold object placed inside a container will render at the wrong offset,
because item coordinates are container-relative.

---

## 6. Template-first generation algorithm

Eleven steps, in order. Each names its stop conditions.

**Step 1 — Parse and validate the source table.**
Read every row. Normalize headers by the alias table in §7.2. Identify the tag
column; if it cannot be identified, stop with `E-COL-MISSING`. Record which
optional columns are present. Do not drop rows silently: if rows are excluded,
list them in the response (§6, step 5 note).

**Step 2 — Select exactly one authoritative template.**
By precedence: a panel supplied with the task, else a production export of the
same system type, else this contract's measured defaults (§8). **One** template —
never a blend. Name the chosen template in the response. Never average
coordinates from two templates.

**Step 3 — Identify template objects by role, not by array index.**
Match on (`obj_id`, `tag_text`, `posLeft`) — for example "the header whose
`obj_id` is `number_v3_label_12px_bold` and whose `posLeft` is 330 is the
*design-minimum* header". Array position is not a role: E5 and E6 place the same
roles at different indices, and the banner is `object_5` in both files only by
coincidence of authoring order.

**Step 4 — Build the column mapping manifest.**
§7. Internal to generation; it is **not** written into the panel file (§15.4).
If a requested column has no production object mapping, stop with
`E-COL-UNMAPPED`.

**Step 5 — Classify rows: side, group, order.**
Side per §9 — stop with `E-SIDE-AMBIG` if two half-tables were requested and the
side cannot be read from explicit data. Group by the group key, or one group if
none. Order within the group by the order key, else source order.

> Row selection is **not** mechanical. E7 holds 28 rows for system 360.001; E5
> renders 26 entries. Three were dropped and one was hand-normalized (a leading
> `+` added to a tag). An automatic generator must therefore either take the
> table verbatim, or report every deviation. It must never quietly drop a row.

**Step 6 — Clone the row-container template.**
Take the container shape from §5 (or from the selected template) and produce one
container per row. Assign `id` / `unique_id` / `name` sequentially (§5.3).

**Step 7 — Populate static cells.**
For each present static column, emit the §4.3 object at that column's x with the
source value as `tag_text`. Preserve UTF-8 exactly (§7.4).

**Step 8 — Populate live cells only when requested and supported.**
Live cells appear only if the request asked for them **and** (for real bindings)
driver data was supplied. Otherwise emit nothing for those columns, or emit the
§4.4 placeholder if the request asked for placeholders. Never fabricate a
binding to make a column look populated.

**Step 9 — Recompute all derived geometry.**
Row tops, group gaps, group stripe tops, divider heights, and `counts`. Every
formula is in §8. Nothing in this step is copied from the template — the template
supplied the *constants*; the row set determines the *values*.

**Step 10 — Sanitize or preserve bindings, per request class.**
Class (a): strip every binding to the §10.1 unlinked contract and drop `#c1` /
`#c2` markers. Class (b): copy supplied ids verbatim. Class (c): **preserve**,
including artefacts — see the preservation matrix in §11.2. Class (d): as (a),
with the column caveat of §1.3.

**Step 11 — Validate and emit exactly one JSON file.**
Run §12 in full. On any failure, fix and re-run; do not emit a file that fails
its own validation. Emit one `.json` file and nothing else (§15).

---

## 7. Column mapping manifest

### 7.1 What it is and where it goes

A machine-readable record, built in step 4 and used through steps 7–9, of how
source columns become panel cells.

> **It is generation state, not panel content.** It must **not** appear in the
> emitted Designer JSON — not as a top-level key, not inside `panel`, not as an
> extra field on an object. The importer ignores unknown keys at best and
> rejects the file at worst, and an unknown key is undocumented output. If a
> future importer version documents such a block, this rule changes then, in
> writing, not by assumption.

Per output column, record: `role` · `source_header_aliases` · `required` ·
`side` · `pos_left` · `obj_id` · `binding` (static | live) · `signal_alias_rule`
· `unit_expectation` · `blank_behavior`.

### 7.2 The seven known spjeldliste roles `LIST`

Header `tag_text` is quoted **exactly as production writes it**. Note `m3/h`
with an ASCII `3`, not `m³/h` — that is what both exports contain, and the
header text is template data, not prose to be improved. The `å` in `pådrag` is
genuine UTF-8 and must survive (§7.4).

| Role key | Header `tag_text` | Required | Binding | Source aliases seen in E7 |
|---|---|---|---|---|
| `damper_tag` | `Spjeldnr.` | **yes** | static | `Tag Autogenerert`, `Spjeldnr.`, `Spjeld`, `Tag` |
| `room` | `Romnr.` | no | static | `Betjener rom`, `Romnr.`, `Rom` |
| `design_min` | `Prosj. min. m3/h` | no | static | `V min`, `Prosj. min.`, `Min` |
| `design_max` | `Prosj. maks. m3/h` | no | static | `V max`, `Prosj. maks.`, `Maks` |
| `actual_flow` | `Erverdi` | no | **live** | `luftmengde` (address column) |
| `flow_setpoint` | `SP.pådrag m3/h` | no | **live** | `spjeld pådrag Settpunkt` (address column) |
| `damper_angle` | `Spjeldvinkel %` | no | **live** | `Spjeld vinkel` (address column) |

Alias matching is case-insensitive and whitespace-normalized. An unrecognized
header is **not** silently mapped to the nearest role — report it and either
leave it out or stop with `E-COL-UNMAPPED`.

### 7.3 Column x table `LIST`

Header x is **absolute** (`single_objects`). Cell x is **container-relative**
(`items`). Every value that appears in both exports is identical in both; the
two files differ only in which roles they populate, never in where a role sits.

Coverage, so nothing here is read as better-evidenced than it is: all **14
headers** are present in both. Of the cells, `damper_tag` (both halves),
`room` (left), `design_min` and `design_max` (both halves) are in both files.
**`room` on the right (`object_29`, x 1031) is E6-only** — E5 has no right-half
room cell at all. **All six live cells (`object_46`–`object_51`) are E5-only** —
E6 contains no `number_v3_value_only` object. Those seven values are therefore
single-source; reproduce them, but treat them as `TEMPLATE-SPECIFIC`.

| Role | Header x (left) | Header y | Cell x (left) | Item `name` (left) | Header x (right) | Cell x (right) | Item `name` (right) |
|---|---|---|---|---|---|---|---|
| `damper_tag` | 83 | 90 | **0** | `object_14` | 863 | **786** | `object_13` |
| `room` | 259 | 92 | **239** | `object_44` | 1048 | **1031** | `object_29` |
| `design_min` | 330 | 92 | **342** | `object_40` | 1119 | **1131** | `object_25` |
| `design_max` | 433 | 92 | **445** | `object_37` | 1222 | **1234** | `object_22` |
| `actual_flow` | 555 | 91 | **530** | `object_46` | 1344 | **1319** | `object_49` |
| `flow_setpoint` | 614 | 92 | **609** | `object_47` | 1403 | **1398** | `object_50` |
| `damper_angle` | 710 | 91 | **698** | `object_48` | 1499 | **1494** | `object_51` |

**The right half is not a constant offset.** Header offsets are 780 for
`damper_tag` and 789 for the other six. Cell offsets are 786, 792, 789, 789,
789, 789, 796. **Use the table. Do not compute the right half by adding a
constant** — every published constant (780, 786, 789) is wrong for at least one
column. This corrects the "+780" claim in briefing §7c; see §16.

All cells are 50 × 20. A value wider than 50 px overflows its box — that is how
production renders, and it is not corrected by widening the cell.

### 7.4 Encoding `GLOBAL`

Write real UTF-8: `å` in `SP.pådrag`, `æøå` in any Norwegian text, `°C` never
`gr C`, `³` where the text genuinely uses it. **But copy header text verbatim
from the template** — production writes `m3/h` in these seven headers, and
"fixing" it to `m³/h` is a silent change to template data. UTF-8 must survive a
round trip through file writing; mojibake (`Ã¥`, `Â°`) is a validation failure
(§12).

---

## 8. Geometry rules

All values below are literal reads from E5 and E6. A value present in only one
export is tagged `TEMPLATE-SPECIFIC` and named.

### 8.1 Banner `LIST`

| Field | Value |
|---|---|
| `obj_id` | `previous_page_tekn_box_no` |
| `posLeft` / `posTop` | 15 / 50 |
| `posWidth` × `posHeight` | 1570 × 57 |
| `zIndex` | **`"5"`** |
| `tag_text` | `" "` (single space) |

**The banner `zIndex` is `"5"`, not `"155"`.** Both exports. `"155"` belongs to
the single 11 px-wide divider at x 790 (§8.4). Briefing §7c and the `_note`
wrapper inside E6 both state 155 for the banner; both are wrong. See §16.

### 8.2 Half-table titles `LIST`

Four `number_v3_label_12px_bold_white`, 50 × 20, `posTop` 63, `zIndex` `"900"`,
at `posLeft` **288, 520, 894, 1127**.

`tag_text` is `" "` — **blank in both exports**. The briefing describes these as
carrying half-table titles; no export inspected here has any text in them. Emit
them blank to match the template; put text in them only if the task supplies it.

### 8.3 Column headers `LIST`

Fourteen `number_v3_label_12px_bold`, 50 × 20, `zIndex` `"900"`. Positions and
text: §7.3.

### 8.4 Vertical dividers `LIST`

Thirteen `number_v3_header_appgrey`. All share one height, `H` (§8.8).

| Count | `posLeft` | `posTop` | `posWidth` | `zIndex` |
|---|---|---|---|---|
| 5 | 232, 321, 427, 543, 605 | 87 | 3 | `"5"` |
| 1 | 703 | 88 | 3 | `"5"` |
| **1** | **790** | **86** | **11** | **`"155"`** |
| 5 | 1021, 1110, 1216, 1332, 1394 | 87 | 3 | `"5"` |
| 1 | 1492 | 88 | 3 | `"5"` |

The wide 11 px divider at x 790 is the **half-table separator**; the twelve 3 px
ones are column rules. Right-hand column rules are at left + **789** exactly,
all six — unlike the headers and cells (§7.3). Confirmed in both exports.

### 8.5 Row geometry `LIST`

| Constant | Value |
|---|---|
| `container.left` | 19 |
| `container.width` | 1544 |
| `container.height` (`row_height`) | 23 |
| `container.zIndex` | 4 (integer) |
| First row `top` (`first_row_top`) | **106** |
| Normal row pitch (`row_pitch`) | **20** |
| Group gap pitch (`group_gap_pitch`) | **40** |

Formulas:

```
first_row_top        = 106
normal_next_top      = previous_top + row_pitch          # 20
group_next_top       = previous_top + group_gap_pitch    # 40
table_height         = last_row_top + row_height - table_origin_top
```

`table_origin_top` is the banner top, 50, when the whole block is measured;
use the divider top, 87, when computing divider height (§8.8).

The pitch is 20 while the row is 23 tall, so consecutive rows **overlap by 3 px**
by design. That is production behaviour in both exports and is not a defect;
§12 checks for *unexpected* overlap, meaning any delta other than 20 or 40.

### 8.6 Group segmentation `LIST`

A group boundary is a `top` delta of 40 instead of 20. E5: **2** groups
(sizes 19 and 6; first-row tops 106 and 506 — 24 deltas, of which exactly one is
40). E6: 21 groups (20 deltas of 40; first-row tops 106 … 4 586).

Groups come from the **source table's group key**. They are not inferred from
row content and never from tag numbering.

### 8.7 Group stripe `LIST`

`number_v3_header_grey50`, uniformly `posLeft` **15**, **1570 × 20**, `zIndex`
**`"3"`**, `tag_text` `" "`, `link_tag` `"NA"`.

```
stripe_top = group_first_row_top - 2
```

Exact in both exports wherever a stripe exists.

**Stripes come in a bundle of 14.** Every distinct stripe y carries exactly 14
copies — 14 at one y in E5, 238 at 17 distinct y in E6. Stacked identical
objects; the count is an authoring artefact (§11).

**Production does not stripe every group, and the stripe is not a group marker.**
E5 has 2 groups and stripes only the first. E6 has 21 groups, stripes 15, skips
6 (first-row tops 626, 1 306, 2 186, 2 366, 4 106, 4 226), and carries 2 extra
stripe rows *inside* groups (y 3 144, 3 164 → rows 3 146 and 3 166, the second
and third rows of the group starting at 3 126). So `stripe ⇔ group start` fails
in both directions: 6 group starts unstriped, 2 striped rows at no boundary.

The closest predicate tested is "the row's damper tag ends in `SQ40x`": it
matches 16 of the 17 striped rows, but also 6 unstriped rows, so it is not the
rule either. Treat the stripe as an **author-applied row highlight** whose
placement is not derivable from the export.

**Generation rule** `ADVISORY`: emit **one** stripe per group at
`group_first_row_top - 2`. One, not fourteen. Do not reproduce skips or
mid-group extras — they are artefacts, not layout. When *modifying* a supplied
export (class (c)), leave its stripes exactly as they are.

### 8.8 Divider height `LIST`

All thirteen dividers share one height:

```
divider_height = last_row_top + row_height - divider_top - 2
```

With `row_height` 23 and `divider_top` 87, this is `last_row_top - 66`.

| Export | `last_row_top` | Computed | In file |
|---|---|---|---|
| E5 | 606 | 606 + 23 − 87 − 2 = **540** | 540 ✓ |
| E6 | 4 646 | 4 646 + 23 − 87 − 2 = **4 580** | 4 580 ✓ |

The 11 px divider starts 1 px higher (`posTop` 86) and the two at `posTop` 88
start 1 px lower, but **all thirteen carry the same height value**. Their bottoms
therefore differ by ±1. Copy the height to all thirteen; do not recompute per
divider from its own top.

### 8.9 Dotted separators `TEMPLATE-SPECIFIC` — do not generate

`number_v3_label_8px_norm`, 50 × 20, `zIndex` `"900"`, `posLeft` 15 (one at 14 in
E5), `tag_text` a run of dots — 500 in almost every instance, 510 in one.

Counts and positions do **not** follow the rows: 9 separators for 25 rows in E5,
113 for 208 rows in E6, at y values that correlate with neither group boundaries
nor row tops. **This is author-driven decoration with no derivable rule.**

**Do not emit separators in generated output.** Preserve them untouched when
modifying a supplied export.

### 8.10 Intentional overflow `LIST`

| | E5 | E6 | Canvas |
|---|---|---|---|
| Max x of `single_objects` | 1 585 | 1 585 | 1 400 |
| Max y of `single_objects` | 628 | 4 668 | 750 |

**Horizontal overflow is structural and always present.** Banner and stripes are
1 570 px wide at x 15, ending at 1 585 — 185 px past the 1 400 px canvas. Right
half-table cells reach x 1 544. This is how the panel is meant to look.

**Vertical overflow is a function of row count.** E5 fits (628 < 750); E6 does
not (4 668). Both are correct.

Per briefing §9: on a list panel **rows may run past the canvas; nothing else
may.** A scaffold object out of bounds beyond §8.1–§8.8 is a defect.

---

## 9. Left / right allocation

### 9.1 The structure `LIST`

The panel carries two half-tables of the same seven columns, left and right
(§7.3). A row's cells live in **one** container, and most containers populate
only one half.

| | E5 | E6 |
|---|---|---|
| Left-only containers | 20 | 185 |
| Right-only containers | 4 | 21 |
| **Mixed** (both halves in one container) | **1** | **2** |
| Total entries | 21 left / 5 right | 187 left / 23 right |

**Mixed rows exist and must be supported** — E5 index 24 (`top` 606), E6 indices
57 (`top` 1 386) and 204 (`top` 4 586). A generator that assumes one side per
container will fail to reproduce a supplied export.

The right half is **not** a parallel band beside the left half. Right-side rows
mostly occupy their own containers *below* the left block, continuing the same
`top` sequence. Briefing §7c's "same row band" description is wrong; see §16.

### 9.2 What actually predicts the side `LIST`

The observed rule is **the component number series in the tag**:

| Side | Series observed |
|---|---|
| **Right** | 5-series only — E5: 5 of 5 entries; E6: SQ5xx ×13, SK5xx ×9, +1 |
| **Left** | 4-series, 6-series, or unnumbered — E5: LD ×17, SQ401, 40101, SK402, U1-SK401; E6: LD ×130, ST ×28, SQ ×23, SK ×6 |

This is a **convention of one production style, not a hard requirement.** It is
strong enough to reproduce a supplied export and too weak to apply to an unknown
plant on its own.

### 9.3 What does *not* hold `ADVISORY`

- **"Supply-side left, extract-side right" is contradicted by the evidence.**
  Every right-half alias in E5 reads *tilluft* (supply) — e.g.
  `spjeld_luftmengde_sp_3 [ Spjeld tilluft - Setpunkt luftmengde (m3/h) ]` — and
  no left-half alias mentions *avtrekk*. Do not allocate by airflow direction.
- **"400-series left / 500-series right" is incomplete.** It omits the 6-series,
  which is 70 % of E6's left column, and the ST 4xx instrument series.
- **No column in E7 carries the side.** It cannot be read from the workbook.

### 9.4 Rule

1. If the source table has an explicit side column, use it.
2. Else, if the request supplies a template whose tags are recognizable, apply
   the §9.2 series convention and **say in the response that it was used and
   that it is a convention**.
3. Else, if the request needs two half-tables and neither 1 nor 2 resolves it,
   **stop with `E-SIDE-AMBIG`.** Do not guess, and do not split by row count.
4. A **single-side table is permitted** and is the safe default when the side is
   simply not part of the request: emit only left-half columns, keep the full
   14-header scaffold so the panel matches the template, and say the right half
   is intentionally empty.

---

## 10. Binding modes

### 10.1 Static unlinked cells — the default `LIST`

```
id: "driver_id"        driver_id: ""            linked: "true"
link_name: "link_name" link_tag: ""             sub_group: ""
unit_id: ""            unit_ref: ""             tag_text: "<value>"
alias_text: "new text"
```

Envelope: `source_plant_id: ""`, `panel.plant_id: ""`. This is what class (a)
emits everywhere.

**The unlinked state of a list object is `driver_id: ""` and `unit_id: ""`, not
`linked: "false"`.** See §4.2 for the measurement and for why this scoped rule
overrides `unlinked_demo_contract` in
[documentation-rules.json](documentation-rules.json), which was written for
ventilation panels.

**Never convert a static value into a fake linked field.** A number typed into
`tag_text` alongside an **invented** `driver_id` renders exactly like a working
binding and shows a stale value forever. That is the worst possible failure for
this panel type — and note that it is the *invented identifier* that causes it,
not the `linked` flag, which is `"true"` on 1319 of 1319 production objects
including the banner.

### 10.2 Dynamic unlinked placeholders `LIST`

§4.4. `number_v3_value_only`, `posTop: 0`, `tag_text: null`, `driver_id: ""`,
`unit_id: ""`, `alias_text: "new text"`. The panel imports, shows empty value
boxes, and a human links them in the Designer afterwards. This is the correct
answer to "I want live values but I have no driver data".

The placeholder differs from the bound cell of §10.3 in exactly three fields, so
the linking step is visible in a diff.

### 10.3 Same-plant linked cells `LIST`

§4.5, class (b) only, every identifier copied verbatim from supplied data —
`driver_id`, `unit_id`, `alias_text`, and nothing else.

Which columns are live is measured: in E5, **`actual_flow`, `flow_setpoint` and
`damper_angle` are live** (78 cells, `tag_text: null`, real driver ids), and
`damper_tag`, `room`, `design_min`, `design_max` are static text. E6 has **no
live cells at all** — 0 of its container items are bound.

**This corrects briefing §7c**, which states production leaves the three
value columns unpopulated for later hand-linking. E5, at precedence rank 1,
populates and links all three. Both patterns are legitimate; the request decides.
See §16.

### 10.4 Cross-plant copies `GLOBAL`

**Never copy source-plant ids into a panel for a different plant, and never into
a generic demo.** A `driver_id` contains the plant number; carried across, it
either binds to the wrong point or binds to nothing.

To move a list between plants: keep the geometry and the static text, reset
`driver_id`, `unit_id` and `alias_text` to the §10.1 empty state, and re-link at
the destination. The **row's `damper_tag` cell** is what identifies the point to
re-link — it is the only field that survives the move and means anything. Do not
try to preserve the binding by keeping the alias: a source-plant alias in a
destination-plant panel is a claim about a signal that may not exist there.

### 10.5 The bookkeeping markers `LIST`

Some production static cells carry `driver_id: "#c1"` or `"#c2"` — visible in E5
and E6 on the `design_min` / `design_max` cells (24 + 24 in E5, 210 + 210 in E6).
They are not driver ids and bind to nothing.

This is an author artefact the Designer round-trips. **Do not emit it when
generating; do not strip it when editing a supplied file.** Full rationale and
the preservation matrix: §11. Same rule as CLAUDE.md gotcha #25.

`linked: "true"`, `link_name: "link_name"` and `alias_text: "new text"` were
previously classed with these markers. They are **not** artefacts — they are the
constant, universal state of every object in both exports, and generated output
reproduces them (§4.2).

---

## 11. Artefact cleanup

### 11.1 The distinction

A **production artefact** is a value present in a real export that carries no
layout or binding meaning: a by-product of how a human drove the Designer.

Two different rules apply to the same artefact:

- **Editing a supplied export (class (c)):** preserve it. Removing it produces a
  diff full of changes the request never asked for, and hides the real change.
- **Generating a new panel (classes (a), (b), (d)):** do not copy it. It would
  be noise fabricated to look like provenance.

### 11.2 Preservation matrix

| Artefact | Preserve on edit | Copy to new template | Reason | Evidence |
|---|---|---|---|---|
| `driver_id: "#c1"` / `"#c2"` on `design_min` / `design_max` cells | **Yes** | **No** — emit `""` | Author bookkeeping the Designer round-trips; harmless, meaningless | E5, E6; CLAUDE.md #25 |
| `linked: "true"` on unbindable objects (banner, dividers, stripes) | **Yes** | **Yes** | Not an artefact — the universal state, 1319/1319. See §4.2 | E5, E6 |
| `link_name: "link_name"` on unlinked objects | **Yes** | **Yes** | Same: 1319/1319, constant | E5, E6 |
| `alias_text: "new text"` on every unlinked object | **Yes** | **Yes** | Same: 881/881 unlinked objects. Do **not** substitute a role hint | E5, E6 |
| `link_tag: "NA"` on dividers and stripes only | **Yes** | **Yes** | 264/264 of those two obj_ids; `""` on all others | E5, E6 |
| 14 stacked copies of each group stripe | **Yes** | **No** — emit 1 | 14× at every distinct y in both files; only one is visible | E5, E6 |
| Group stripes missing on some groups | **Yes** | **No** — stripe every group | 6 of 21 groups unstriped in E6; no rule predicts which | E6 |
| Mid-group extra stripe rows | **Yes** | **No** | 2 in E6 (y 3 144, 3 164), at no group boundary | E6 |
| Dotted separators (`number_v3_label_8px_norm`) | **Yes** | **No** | Placement is author-driven and underivable (§8.9) | E5, E6 |
| The one separator at x 14 instead of 15 | **Yes** | **No** | Single-instance hand offset | E5 |
| The one separator with 510 dots instead of 500 | **Yes** | **No** | Single-instance hand edit | E5 |
| Embedded background (`image_data`, `image_svg_trace`, `converted`) | **Yes** — copy all four fields together | **No** — use `background_embedded: false` | Named blank resolves host-side (§3.3) | E5 vs E6 |
| Colliding item `name` values | **Yes** | **Yes** — via the §7.3 role map | Host ignores item names; role map is the deterministic policy | E5, E6 |
| `_note` prose wrapper around the envelope | n/a | **No** | Reference-file convention, not panel content; readers must accept both shapes | E6 |

**Nothing in this table may be extended by inference.** An oddity not listed here
has not been assessed; report it rather than deciding its fate silently.

---

## 12. Validation contract

Deterministic and mechanical. Every check either passes or names the object that
failed. Run all of them before emitting (§6 step 11).

**Envelope**

1. The file re-parses as JSON after being written.
2. `format == "iwmac-designer-panel"` exactly.
3. `version == 1`, as an integer.
4. `counts.single_objects`, `counts.containers`, `counts.graphics` each equal the
   corresponding array length.
5. Required top-level keys all present (§3.1).
6. No top-level key outside the documented set (§15.4).

**Objects**

7. Every `single_object` has all 17 fields (§4.1).
8. Every container item has all 17 fields.
9. Every `obj_id` — objects and items — appears in
   [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md).
10. `posWidth`, `posHeight`, `posLeft`, `posTop` are integers, not strings and
    not floats.
11. Object `zIndex` is a string; container `zIndex` is an integer `4` (§5.2).
12. No object is unintentionally at (0, 0). Container-relative x 0 is legitimate
    for the `damper_tag` cell; an *absolute* object at (0, 0) is not.

> **Check 9 is `LIST`. The table panels resolve against a wider allowlist —
> conflict RC-C2.** A spjeldliste is built entirely from palette objects, so
> the catalogue is a complete authority here and check 9 stays as written. A
> room-control table is not: `number_v3_cell_grey25` appears **1 700 times** in
> the known-good export (evidence E19) and is in neither
> [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) nor the 797 ids of
> `reference_data/all-design-objects.json`. It is in
> `reference_data/controls-registry.json` — the live dump of all 1 769 render
> definitions — as `168 × 25`, `zindex 5`, `classname "css_v3_cell_grey25"`,
> `obj_type "dummy"`, `canLink false`; 991 of those 1 769 definitions have no
> palette entry, the whole `number_v3_cell_*` / `number_v3_val_cell_*` family
> among them. They are generated by the host's table container
> (`container_tool.js:3699-3849`), not placed from the palette.
>
> `load_allowlist()` in
> [validate-romkontroll-panel.py](validate-romkontroll-panel.py) therefore
> resolves `R-S12` against the **union** of the two registries, and emits a note
> naming any registry-only id rather than passing over it in silence. That is a
> widening **by evidence**, not a check relaxed to make a file pass: an id in
> neither source is still an error, the 39 ids the catalogue's `menu` marks
> `Inactive_IBT` / `Outdated____IBT` are still rejected, and the two cell
> families are named rather than admitted by wildcard. Resolution owned by
> [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) §12,
> conflict RC-C2.

**Containers**

13. `unique_id` and `name` are sequential from 0, unique, gapless (§5.3).
14. `id`, `type`, `container_type`, `className`, `header_footer`, `linked`,
    `linked_to`, `title` match §5.1 exactly — all eight are constants, and
    `id` in particular is the string `"objects_container"`, never an index.
15. `left == 19`, `width == 1544`, `height == 23` on every container, unless a
    supplied template says otherwise.
16. Every container holds the same set of item roles, except a container that
    carries both a left-half and a right-half row (§9.1). Generated output does
    not omit a cell for a blank value (§2.4).

**Geometry**

17. Consecutive container `top` deltas are **only** 20 or 40. Any other value is
    an unexpected overlap or an unexplained gap.
18. `first_row_top == 106` unless a supplied template says otherwise.
19. The 40-delta count equals `group_count - 1` — group gaps occur exactly once
    per boundary, never twice, never inside a group.
20. Every group has exactly one stripe at `group_first_row_top - 2`
    (generated output; a preserved export is exempt — §11.2).
21. All thirteen dividers carry the same height, equal to
    `last_row_top + row_height - divider_top - 2`, so the rules cover every row.
22. Stripe geometry is `posLeft 15`, `1570 × 20`, `zIndex "3"`.
23. Only container rows exceed the canvas. Every scaffold object lies within
    §8.1–§8.8, and horizontal overflow to x 1 585 is expected (§8.10).

**Bindings**

24. The seven constants of §4.2 hold on every object: `id == "driver_id"`,
    `linked == "true"`, `link_name == "link_name"`, `sub_group == ""`,
    `unit_ref == ""`, `alias_text == "new text"` unless copied from supplied
    data, and `link_tag == "NA"` on `number_v3_header_appgrey` /
    `number_v3_header_grey50` and `""` on everything else.
25. Every non-empty `driver_id` is either copied verbatim from supplied data or
    is the documented marker `"#c1"` / `"#c2"` in a preserved export. No
    `driver_id` was assembled from a BACnet address (§4.5).
26. Every non-empty `unit_id` and every `alias_text` other than `"new text"` was
    copied verbatim from supplied data.
27. No plant id in an unlinked demo: `source_plant_id == ""` and
    `panel.plant_id == ""`. No source-plant id survives into a panel for a
    different plant (§10.4).
28. No navigation target invented.

**Text**

29. UTF-8 survives: `å`, `ø`, `æ`, `°`, `³` read back correctly; no `Ã¥`, `Â°`,
    no `gr C`.
30. Header `tag_text` matches §7.2 verbatim, including `m3/h`.

**Output**

31. The file contains no explanatory wrapper, no `_note`, no manifest, no
    commentary — nothing the importer does not consume (§15).
32. Insert is understood to target an **empty** panel. Inserting into a
    populated panel appends and duplicates; if append was genuinely requested,
    say so explicitly in the response.

### 12.1 Machine-readable form

These are mirrored in [documentation-rules.json](documentation-rules.json) under
`panel_types.list_panel`. When a rule changes, change both, and log it in
[documentation-change-log.md](documentation-change-log.md).

---

## 13. Worked examples

### 13.1 Example A — new unlinked list from a synthetic table

**The source table is synthetic.** `999.001` is not a real system number and
these tags exist on no plant. It is here to be audited, not imported into
production.

| Group | Spjeldnr. | Romnr. | Prosj. min. m3/h | Prosj. maks. m3/h |
|---|---|---|---|---|
| A | `=999.001-SQ401` | 1.001 | 50 | 400 |
| A | `=999.001-SQ402` | 1.002 | 60 | 450 |
| A | `=999.001-LD601` | 2.010 | 24 | 80 |
| B | `=999.001-LD602` | 2.011 | 30 | 120 |

Derivation, step by step:

- 4 rows, 2 groups (3 + 1). All tags are 4- or 6-series → all left half (§9.2).
- Row tops: 106, 126, 146 (pitch 20), then the group boundary: 146 + 40 = **186**.
- `last_row_top` = 186 → `divider_height` = 186 + 23 − 87 − 2 = **120**.
- Stripes: 104 (= 106 − 2) and 184 (= 186 − 2). One each, not fourteen.
- Columns present: `damper_tag`, `room`, `design_min`, `design_max` → cell x
  0, 239, 342, 445; item names `object_14`, `object_44`, `object_40`,
  `object_37`.
- No live columns requested → no `actual_flow` / `flow_setpoint` /
  `damper_angle` cells. The 14 headers stay: the scaffold matches the template.
- Scaffold: 1 banner + 4 titles + 14 headers + 13 dividers + 2 stripes = **34**
  `single_objects`; **4** containers; **0** graphics.

```json
{
  "format": "iwmac-designer-panel",
  "version": 1,
  "generator": "LIST-PANEL-GENERATION-CONTRACT example A",
  "source_plant_id": "",
  "panel_name": "999.001 Spjeldliste (synthetic)",
  "panel_width": "1400px",
  "panel_height": "750px",
  "counts": { "single_objects": 34, "containers": 4, "graphics": 0 },
  "background_embedded": false,
  "panel": {
    "plant_id": "",
    "panel_width": "1400px",
    "panel_height": "750px",
    "image_name": "00-blank-1400x750",
    "org_image_name": "00-blank-1400x750",
    "graphics": [],
    "single_objects": [
      { "obj_id": "previous_page_tekn_box_no", "name": "object_0", "id": "driver_id", "posWidth": 1570, "posHeight": 57, "posLeft": 15, "posTop": 50, "zIndex": "5", "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },

      { "obj_id": "number_v3_label_12px_bold_white", "name": "object_1", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 288, "posTop": 63, "zIndex": "900", "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold_white", "name": "object_2", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 520, "posTop": 63, "zIndex": "900", "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold_white", "name": "object_3", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 894, "posTop": 63, "zIndex": "900", "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold_white", "name": "object_4", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 1127, "posTop": 63, "zIndex": "900", "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },

      { "obj_id": "number_v3_label_12px_bold", "name": "object_5",  "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 83,   "posTop": 90, "zIndex": "900", "tag_text": "Spjeldnr.",        "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_6",  "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 259,  "posTop": 92, "zIndex": "900", "tag_text": "Romnr.",           "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_7",  "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 330,  "posTop": 92, "zIndex": "900", "tag_text": "Prosj. min. m3/h",  "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_8",  "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 433,  "posTop": 92, "zIndex": "900", "tag_text": "Prosj. maks. m3/h", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_9",  "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 555,  "posTop": 91, "zIndex": "900", "tag_text": "Erverdi",          "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_10", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 614,  "posTop": 92, "zIndex": "900", "tag_text": "SP.pådrag m3/h",   "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_11", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 710,  "posTop": 91, "zIndex": "900", "tag_text": "Spjeldvinkel %",   "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_12", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 863,  "posTop": 90, "zIndex": "900", "tag_text": "Spjeldnr.",        "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_13", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 1048, "posTop": 92, "zIndex": "900", "tag_text": "Romnr.",           "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_14", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 1119, "posTop": 92, "zIndex": "900", "tag_text": "Prosj. min. m3/h",  "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_15", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 1222, "posTop": 92, "zIndex": "900", "tag_text": "Prosj. maks. m3/h", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_16", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 1344, "posTop": 91, "zIndex": "900", "tag_text": "Erverdi",          "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_17", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 1403, "posTop": 92, "zIndex": "900", "tag_text": "SP.pådrag m3/h",   "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_label_12px_bold", "name": "object_18", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 1499, "posTop": 91, "zIndex": "900", "tag_text": "Spjeldvinkel %",   "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },

      { "obj_id": "number_v3_header_appgrey", "name": "object_19", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 232,  "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_20", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 321,  "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_21", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 427,  "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_22", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 543,  "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_23", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 605,  "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_24", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 703,  "posTop": 88, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_25", "id": "driver_id", "posWidth": 11, "posHeight": 120, "posLeft": 790,  "posTop": 86, "zIndex": "155", "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_26", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 1021, "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_27", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 1110, "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_28", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 1216, "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_29", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 1332, "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_30", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 1394, "posTop": 87, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_appgrey", "name": "object_31", "id": "driver_id", "posWidth": 3,  "posHeight": 120, "posLeft": 1492, "posTop": 88, "zIndex": "5",   "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },

      { "obj_id": "number_v3_header_grey50", "name": "object_32", "id": "driver_id", "posWidth": 1570, "posHeight": 20, "posLeft": 15, "posTop": 104, "zIndex": "3", "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
      { "obj_id": "number_v3_header_grey50", "name": "object_33", "id": "driver_id", "posWidth": 1570, "posHeight": 20, "posLeft": 15, "posTop": 184, "zIndex": "3", "tag_text": " ", "linked": "true", "link_name": "link_name", "link_tag": "NA", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" }
    ],
    "containers": [
      { "id": "objects_container", "unique_id": "custom_0", "name": "objects_container_0", "type": "container_c", "container_type": "objects_container", "className": "objects_container", "header_footer": [], "linked": "0", "linked_to": "0", "width": 1544, "height": 23, "left": 19, "top": 106, "zIndex": 4,
        "items": [
          { "obj_id": "number_v3_label_12px_bold", "name": "object_14", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 0,   "posTop": 3, "zIndex": "900", "tag_text": "=999.001-SQ401", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_44", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 239, "posTop": 3, "zIndex": "900", "tag_text": "1.001",          "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_40", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 342, "posTop": 3, "zIndex": "900", "tag_text": "50",             "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_37", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 445, "posTop": 3, "zIndex": "900", "tag_text": "400",            "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" }
        ],
        "title": "Objects Container"
      },
      { "id": "objects_container", "unique_id": "custom_1", "name": "objects_container_1", "type": "container_c", "container_type": "objects_container", "className": "objects_container", "header_footer": [], "linked": "0", "linked_to": "0", "width": 1544, "height": 23, "left": 19, "top": 126, "zIndex": 4,
        "items": [
          { "obj_id": "number_v3_label_12px_bold", "name": "object_14", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 0,   "posTop": 3, "zIndex": "900", "tag_text": "=999.001-SQ402", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_44", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 239, "posTop": 3, "zIndex": "900", "tag_text": "1.002",          "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_40", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 342, "posTop": 3, "zIndex": "900", "tag_text": "60",             "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_37", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 445, "posTop": 3, "zIndex": "900", "tag_text": "450",            "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" }
        ],
        "title": "Objects Container"
      },
      { "id": "objects_container", "unique_id": "custom_2", "name": "objects_container_2", "type": "container_c", "container_type": "objects_container", "className": "objects_container", "header_footer": [], "linked": "0", "linked_to": "0", "width": 1544, "height": 23, "left": 19, "top": 146, "zIndex": 4,
        "items": [
          { "obj_id": "number_v3_label_12px_bold", "name": "object_14", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 0,   "posTop": 3, "zIndex": "900", "tag_text": "=999.001-LD601", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_44", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 239, "posTop": 3, "zIndex": "900", "tag_text": "2.010",          "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_40", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 342, "posTop": 3, "zIndex": "900", "tag_text": "24",             "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_37", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 445, "posTop": 3, "zIndex": "900", "tag_text": "80",             "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" }
        ],
        "title": "Objects Container"
      },
      { "id": "objects_container", "unique_id": "custom_3", "name": "objects_container_3", "type": "container_c", "container_type": "objects_container", "className": "objects_container", "header_footer": [], "linked": "0", "linked_to": "0", "width": 1544, "height": 23, "left": 19, "top": 186, "zIndex": 4,
        "items": [
          { "obj_id": "number_v3_label_12px_bold", "name": "object_14", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 0,   "posTop": 3, "zIndex": "900", "tag_text": "=999.001-LD602", "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_44", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 239, "posTop": 3, "zIndex": "900", "tag_text": "2.011",          "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_40", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 342, "posTop": 3, "zIndex": "900", "tag_text": "30",             "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" },
          { "obj_id": "number_v3_label_12px_bold", "name": "object_37", "id": "driver_id", "posWidth": 50, "posHeight": 20, "posLeft": 445, "posTop": 3, "zIndex": "900", "tag_text": "120",            "linked": "true", "link_name": "link_name", "link_tag": "", "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "", "alias_text": "new text" }
        ],
        "title": "Objects Container"
      }
    ]
  }
}
```

Every `obj_id` used — `previous_page_tekn_box_no`,
`number_v3_label_12px_bold_white`, `number_v3_label_12px_bold`,
`number_v3_header_appgrey`, `number_v3_header_grey50` — is in the catalogue.
Every binding is the §10.1 sentinel. No plant id, no driver id, no unit id.

### 13.2 Example B — same-plant list derived from a supplied production export

Request: *"Add one damper to the attached 360.001 list, in the last group,
keeping the live values working."* Class (c) with a class (b) row.

**Field-by-field, what happens to the file:**

| Field | Action | Why |
|---|---|---|
| `format`, `version`, `panel_width`, `panel_height` | unchanged | envelope constants |
| `source_plant_id`, `panel.plant_id` | **unchanged** — the real plant id stays | the bindings are real; this is not a demo |
| `background_embedded`, `image_data`, `image_svg_trace`, `converted` | unchanged, copied as a set | §3.3 preservation |
| `counts.containers` | **+1** | must equal the array length |
| `counts.single_objects` | unchanged | no scaffold object added |
| All 13 divider `posHeight` | **recomputed** | `last_row_top` moved by 20 |
| Existing container `top` values | unchanged | the new row goes at the end |
| New container `top` | `previous_top + 20` | same group, normal pitch |
| Group stripes | **unchanged** — including duplicates and gaps | §11.2 preserve-on-edit |
| Dotted separators | **unchanged** | §11.2 |
| `#c1` / `#c2` markers on existing rows | **unchanged** | §11.2 |
| Existing `driver_id` / `unit_id` / `alias_text` | **unchanged** | never re-derived |
| New row's `driver_id` / `unit_id` / `alias_text` | **copied from supplied data** | §4.5 — or stop with `E-LINK-NODATA` |
| New container `id` / `unique_id` / `name` | next index in sequence | §5.3 |

**The new row** — plant and driver identifiers masked, exactly as they must be
in any committed document. `<COPY_FROM_SOURCE>` marks a field that has to come
from the supplied export or its accompanying driver data; nothing here may be
constructed:

```json
{
  "id": "objects_container", "unique_id": "custom_25",
  "name": "objects_container_25", "type": "container_c",
  "container_type": "objects_container", "className": "objects_container",
  "header_footer": [], "linked": "0", "linked_to": "0",
  "width": 1544, "height": 23, "left": 19, "top": 626,
  "zIndex": 4,
  "items": [
    { "obj_id": "number_v3_label_12px_bold", "name": "object_14", "id": "driver_id",
      "posWidth": 50, "posHeight": 20, "posLeft": 0, "posTop": 3, "zIndex": "900",
      "tag_text": "=360.001-SQ412", "linked": "true", "link_name": "link_name", "link_tag": "",
      "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "",
      "alias_text": "new text" },

    { "obj_id": "number_v3_label_12px_bold", "name": "object_44", "id": "driver_id",
      "posWidth": 50, "posHeight": 20, "posLeft": 239, "posTop": 3, "zIndex": "900",
      "tag_text": "3.014", "linked": "true", "link_name": "link_name", "link_tag": "",
      "sub_group": "", "driver_id": "", "unit_id": "", "unit_ref": "",
      "alias_text": "new text" },

    { "obj_id": "number_v3_value_only", "name": "object_46", "id": "driver_id",
      "posWidth": 50, "posHeight": 20, "posLeft": 530, "posTop": 0, "zIndex": "900",
      "tag_text": null, "linked": "true", "link_name": "link_name",
      "link_tag": "<COPY_FROM_SOURCE>", "sub_group": "<COPY_FROM_SOURCE>",
      "driver_id": "<COPY_FROM_SOURCE>", "unit_id": "<COPY_FROM_SOURCE>",
      "unit_ref": "<COPY_FROM_SOURCE>", "alias_text": "<COPY_FROM_SOURCE>" }
  ],
  "title": "Objects Container"
}
```

**And the geometry that follows.** `last_row_top` goes 606 → 626, so every
divider height goes 540 → **560** (`626 + 23 − 87 − 2`). Thirteen objects change
one field each. Miss this and the column rules stop 20 px short of the last row —
the most common visible defect in a hand-edited list.

---

## 14. Error messages

Exact strings. Short, specific, and they name the missing thing. Emit the
message and **no panel file**.

| Code | Message |
|---|---|
| `E-KB-MISSING` | `Cannot open required knowledge file: <path>. Stopping. No panel generated.` |
| `E-OBJID-UNKNOWN` | `obj_id "<id>" is not in DESIGN-OBJECT-CATALOG.md. Stopping — object ids are never invented.` |
| `E-COL-MISSING` | `Source table has no damper/item tag column (tried: <aliases>). Row identity is required. Stopping.` |
| `E-SIDE-AMBIG` | `Cannot determine left/right half for <n> rows: no side column, and tags do not match the 4xx/5xx/6xx convention. Supply a side column or request a single-side table. Stopping.` |
| `E-LINK-NODATA` | `Linked output requested but no driver data supplied for: <roles>. driver_id and unit_id are never derived from an address. Supply the bindings or request placeholders. Stopping.` |
| `E-COUNTS` | `counts.<key> = <declared> but the array has <actual> entries. Panel not emitted.` |
| `E-CONTAINER-SHAPE` | `Container <index> is invalid: <field> = <value>, expected <expected>. Panel not emitted.` |
| `E-COL-UNMAPPED` | `Column "<header>" has no production object mapping in LIST-PANEL-GENERATION-CONTRACT.md §7.2. Add a documented mapping or drop the column. Stopping.` |

Every message ends by stating that nothing was produced. A half-written panel is
worse than none: it imports, looks plausible, and is wrong.

---

## 15. Output discipline

### 15.1 The deliverable is the panel file

When the task asks for a panel, the **main deliverable is one downloadable
`.json`**. Explanation is secondary and goes in the chat response, never in the
file.

### 15.2 "JSON only" means only JSON

Raw JSON, nothing before it, nothing after it. No prose, no fenced code block,
no leading "Here is…", no trailing summary.

### 15.3 Never a companion file instead of a panel

E8 is the anti-pattern, in the wild: a 1 048-byte file whose `format` is
`"iwmac-designer-task-companion"`, produced where a spjeldliste was requested. It
imports into nothing.

**A task companion, plan, manifest or summary is not a Designer panel.** If a
panel was requested and one cannot be produced, emit the §14 message — not a
substitute artefact in a made-up format.

### 15.4 No undocumented top-level keys

The final import file carries only the keys in §3.1 plus `panel`. Not the column
mapping manifest (§7.1). Not `_note`. Not `_comment`, `_generated_by`,
`_source_table`, or any other annotation.

The committed reference files wrap the envelope as `{_note, envelope: {…}}` for
documentation purposes. **A generated panel never does that**; a reader must
accept both shapes (`env = doc.get("envelope", doc)`) but a writer emits only
the flat one.

### 15.5 Insert targets an empty panel

Insert **appends**. Into a panel that already has content, it duplicates. Unless
the task explicitly asked to append to existing content, state that the target
panel should be empty.

---

## 16. Conflicts resolved and evidence still required

### 16.1 Conflicts resolved by measurement

Each row was a disagreement between a documented claim and the exports. The
winning source is named; nothing was averaged.

| # | Claim | Measured | Winner | Where fixed |
|---|---|---|---|---|
| L-1 | Banner `zIndex` is `"155"` | `"5"` in E5 and E6. `"155"` is the 11 px divider at x 790 | E5 + E6 | §8.1, §8.4 |
| L-2 | Live-cell x ≈ 540 / 600 / 700 | 530 / 609 / 698 (left), 1319 / 1398 / 1494 (right) | E5 + E6 | §7.3 |
| L-3 | Production leaves the three value columns unpopulated for later hand-linking | E5 populates and links all three (78 live cells) | E5 (rank 1) | §10.3 |
| L-4 | Right half is the left half at +780 | 780 for `damper_tag`; **789** for the other six headers; cell offsets 786 / 792 / 789 / 789 / 789 / 789 / 796 | E5 + E6 | §7.3 |
| L-5 | Dividers are "mirrored" on the right | Exactly +789, all six | E5 + E6 | §8.4 |
| L-6 | 400-series left, 500-series right | Right is 5-series only; left is 4-, 6-series and unnumbered — 6-series is 70 % of E6's left column | E5 + E6 | §9.2 |
| L-7 | The right half occupies the same row band | False. Right-side rows mostly sit in their own containers below the left block; only 1–2 mixed rows per file | E5 + E6 | §9.1 |
| L-8 | Supply-side left, extract-side right | Contradicted — every right-half alias in E5 says *tilluft* | E5 | §9.3 |
| L-9 | Right-half `Romnr.` x undocumented | 1 048 header / 1 031 cell | E5 + E6 | §7.3 |
| L-10 | "Emit one stripe per group" | Correct as a rule, but production also omits stripes for 6 of 21 groups and adds 2 mid-group extras | E5 + E6 | §8.7, §11.2 |
| L-11 | The half-table title labels carry titles | `tag_text` is `" "` in all eight instances across both files | E5 + E6 | §8.2 |
| L-12 | Container `id` is the row index, `linked "false"`, `linked_to ""`, `title ""` | `id` is the constant string `"objects_container"`; `linked` and `linked_to` are the strings `"0"`; `title` is `"Objects Container"`. 233/233 containers | E5 + E6 | §5.1, §5.3, §12 check 14 |
| L-13 | Unlinked list objects use the ventilation sentinels `linked "false"`, `link_name ""`, `driver_id "driver_id"`, a descriptive `alias_text` | 1319/1319 objects carry `linked "true"`, `link_name "link_name"`; `driver_id` is `""`; `alias_text` is `"new text"` on all 881 unlinked objects. `link_tag` is `"NA"` on dividers and stripes, `""` elsewhere | E5 + E6, over `global_invariants.unlinked_demo_contract` | §4.2, §10.1, §10.5, §11.2, §12 checks 24–26 |
| L-14 | `panel_width` / `panel_height` are integers `1400` / `750` | The strings `"1400px"` / `"750px"`, at envelope level and inside `panel`. The userscript's own Insert-help template prints the same, and the value is passed straight to `iw_set_base_image` | E5 + E6 + the userscript | §3.1, §3.2, §3.4, §13.1 |
| L-15 | E5 has 3 groups of 15 / 6 / 4 at tops 106 / 506 / 606 | E5 has **2** groups of 19 and 6 at tops 106 and 506. Its 24 `top` deltas are 23 × 20 and one × 40 | E5 | §8.6, §8.7, §16.2, Evidence table |
| L-16 | Container key order is `… zIndex, title, items` | The collector emits `… zIndex, items, title` — `title` is a merged custom attribute appended after the item array. 233/233 containers | E5 + E6 | §5.1, §3.4, §13.1, §13.2 |

L-12 through L-16 were defects in this contract's own first draft, caught by
re-measuring the exports before mirroring the values into
`documentation-rules.json` and then by running §17 against the result. They are
recorded here because the wrong forms had already been written into
`AI-BRIEFING.txt` §7c and would otherwise have looked like production evidence.
**All five were failures of the same kind: writing what the schema ought to say
instead of reading what the export does say.** L-16 is the mildest — key order
changes no behaviour — and it is listed anyway because the examples are what an
agent copies, and a reordered row defeats the byte-diff that catches the others.

L-1 also appears inside the `_note` prose wrapper of
[reference_data/real-spjeldliste-example.json](reference_data/real-spjeldliste-example.json).
The envelope in that file is correct; only its prose is wrong.

### 16.2 Still unverified

| Open question | Why it is open |
|---|---|
| Whether the four white title labels are ever populated | Blank in both exports; no export with text in them has been seen |
| Any rule governing which rows get a stripe | 6 of 21 group starts unstriped in E6 and 1 of 2 in E5, plus 2 striped rows at no boundary; the best predicate tried (tag ends `SQ40x`) misses 6 rows |
| Any rule governing dotted-separator placement | 9 for 25 rows, 113 for 208 rows, at y values matching neither rows nor groups |
| Why exactly 14 copies of each stripe | Consistent across both files; mechanism unknown |
| Whether `first_row_top` 106 varies with banner height | Only one banner height (57) observed |
| The `<DRIVERNAME>` and `unit_id` lookup | Per-device, plant-internal; nine pairs observed in E5, no derivable pattern |
| Whether a list panel can carry `graphics` | 0 in both exports; never observed non-empty |
| Whether row pitch varies with a different `row_height` | Only 23 / 20 observed |

**None of these may be closed by inference.** Closing one requires another
production export, and the closing evidence gets its own id in the table above.

---

## 17. Regression test plan

### 17.1 Fixtures

Three fixtures, three purposes.

| Fixture | Purpose | Must pass |
|---|---|---|
| **E5** — the 360.001 production export | Real bindings, embedded background, mixed row, live cells | §12 checks 1–15, 17–24, 29–30. Check 16 is exempt (2 rows omit the `room` cell); checks 25–28 are exempt — E5's driver ids and plant id are real, not invented. Divider height 540 = 606 − 66. 2 groups, tops 106 / 506 |
| **E6** — [reference_data/real-spjeldliste-example.json](reference_data/real-spjeldliste-example.json) | Committed, masked, 208 rows, 21 groups, deep vertical overflow, no live cells | §12 checks 1–15, 17–24, 29–32; check 16 exempt (31 rows omit the `room` cell), 25–26 exempt (`#c1`/`#c2` markers). Divider height 4 580 = 4 646 − 66. `counts` 383 / 208 / 0. Envelope unwrapping from `{_note, envelope}` |
| **Example A** (§13.1) | Generated output, end to end | All 32 checks of §12, no exemptions. `counts` 34 / 4 / 0. Divider height 120. Stripes at 104 and 184. Every `obj_id` in the catalogue |

### 17.2 The executable form

[tests/test_list_panel_contract.py](tests/test_list_panel_contract.py) — 44
tests, run from this directory:

```bash
python -m unittest tests.test_list_panel_contract -v
```

It takes its constants from `documentation-rules.json` → `panel_types.list_panel`
rather than from literals, so a rule and its test cannot drift apart, and it
reads the two envelope examples straight out of this file's fenced ```json
blocks — **keyed by section heading, not by array index**, for the same reason
§6 forbids index-matching objects.

| Assertion | Regression it pins |
|---|---|
| `counts` equals array lengths, all three keys, every fixture | §12 check 3 |
| Container `zIndex` is `int` 4; item `zIndex` is `str` `"900"` — type asserted, not just value | §5.2 |
| Container `id` is the constant string `"objects_container"`; `unique_id` / `name` sequential and gapless | L-12 |
| The 16 container fields, in the collector's emission order | L-16 |
| The 17 object fields, in order, on every object and item | §4.1 |
| Consecutive `top` deltas ∈ {20, 40} | §8.5 |
| `divider_height == last_row_top + row_height − 89` on E5, E6 and Example A | §8.8 |
| E5 has exactly 2 groups; E6's 21 group tops match the rules file | L-15 |
| Every stripe is `posLeft 15`, `1570 × 20`, `zIndex "3"`, and sits at some row top − 2 | §8.7 |
| Example A emits one stripe per group — **and E6 provably does not** | L-10, §8.7 |
| Every E6 stripe position carries exactly 14 stacked copies | §11.2 artefact |
| Column x table (§7.3) matches both exports exactly; header geometry identical across E5 and E6 | L-2 / L-4 / L-9 |
| The right-half offset is 780 for the tag column and 789 for the other six | L-4 |
| The two examples carry no non-empty `driver_id`, no `unit_id`, no plant id; `alias_text` is `"new text"` throughout | L-13 |
| No `driver_id` matching the BACnet assembly pattern | §10.4 |
| `panel_width` / `panel_height` are the strings `"1400px"` / `"750px"` | L-14 |
| `link_tag` is `"NA"` on exactly the dividers and stripes, `""` elsewhere | §4.2 |
| UTF-8 round-trip: `SP.pådrag m3/h` reads back byte-identical | §7.4 |
| Every `obj_id` in every fixture resolves in the 797-entry palette dump | §12 check 12 |
| Example A's `counts`, divider height and stripe tops match the §17.1 fixture row | §13.1 |

Two of these are worth reading twice. The stripe pair asserts **both** that
generated output follows the one-stripe-per-group rule and that production
violates it — so a later "correction" of E6 to match the rule fails the suite
rather than passing it. And the E6 group measurements are compared against
`documentation-rules.json`, which is where L-15 was caught in the first place.

E5 and E7 are **not committed** — live plant data. A test that needs them skips
when the file is absent, exactly as the ventilation suite does for its
uncommitted 9099 fixtures. **A green run on a clean checkout has therefore
verified less than a green run on Thomas's machine**; the skip count is the
difference, and `-v` prints it.

---

## 18. Panel-type scope summary

**Read the scope column before copying the fact.**

| Fact | Scope |
|---|---|
| List panels are the only container-built panel type | `LIST` |
| One container per row; scaffold in `single_objects` | `LIST` |
| Container 19 / 1544 / 23, `zIndex` int 4; items `zIndex` str `"900"` | `LIST` |
| `first_row_top` 106, pitch 20, group gap 40 | `LIST` |
| `divider_height = last_row_top + row_height - divider_top - 2` | `LIST` |
| `stripe_top = group_first_row_top - 2` | `LIST` |
| Banner `previous_page_tekn_box_no` (15,50) 1570×57 `zIndex "5"` | `LIST` |
| 13 dividers; the 11 px one at x 790 `zIndex "155"`; right = left + 789 | `LIST` |
| The seven-column x table, both halves, and its item-name map | `LIST` |
| Header text verbatim, `m3/h` with ASCII 3 | `LIST` |
| Horizontal overflow to x 1585 is structural | `LIST` |
| Static cell `posTop` 3; live cell `posTop` 0, `tag_text` `null` | `LIST` |
| 17 fields on every object and item; integers for geometry | `GLOBAL` |
| Unlinked sentinels `id`/`driver_id` = `"driver_id"`, `linked "false"` | `GLOBAL`, and **list panels are the documented exception** — see §4.2 and L-13. A list panel uses `id "driver_id"`, `driver_id ""`, `linked "true"`, `alias_text "new text"` |
| The 16 container fields in the collector's emission order, `items` then `title` | `LIST`, and not load-bearing — the importer reads by name (§5.1) |
| `counts` must equal array lengths | `GLOBAL` |
| Never invent `obj_id`, `driver_id`, `unit_id`, alias, plant id | `GLOBAL` |
| Insert appends — target an empty panel | `GLOBAL` |
| Right half = 5-series tags, left = 4-/6-series | `LIST`, but a **convention** (§9.2) |
| Live columns are `Erverdi`, `SP.pådrag`, `Spjeldvinkel %` | `TEMPLATE-SPECIFIC` — E5 only; E6 has none |
| Embedded background with `image_data` and `converted "true"` | `TEMPLATE-SPECIFIC` — E5 only |
| 14 stacked copies of each group stripe | artefact — preserve, never generate |
| Groups without stripes; mid-group extra stripes | artefact — preserve, never generate |
| Dotted separators `number_v3_label_8px_norm` | artefact — preserve, never generate |
| `#c1` / `#c2` on static cells; `linked "true"` on scaffold | artefact — preserve, never generate |
| Half-table title labels carry text | **unverified** — blank in every instance seen |
