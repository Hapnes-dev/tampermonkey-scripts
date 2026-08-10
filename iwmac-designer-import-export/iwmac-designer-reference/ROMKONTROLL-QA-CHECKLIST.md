# Romkontroll table — QA checklist

> **The acceptance gate, stage by stage.** Every rule it tests is owned by
> [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md); the
> procedure that produces the file is
> [ROMKONTROLL-AUTHORING-GUIDE.md](ROMKONTROLL-AUTHORING-GUIDE.md). Rule ids
> (`R-S*`, `R-T*`, `R-B*`, `R-P*`, `R-C*`) are the validator's, so a failure
> here names the check that caught it.
>
> **Do not weaken a check to make a file pass.** If a rule is wrong, change it in
> the contract with evidence and record it in
> [documentation-change-log.md](documentation-change-log.md). A rule silently
> relaxed to accommodate one generation is how a validator stops being evidence.

Run in order. A stage that fails stops the pipeline; fix and restart from stage 1.

---

## Stage 0 — routing (before anything is generated)

| # | Check | Fails if |
|---|---|---|
| 0.1 | The request wants a **panel document**, not a data file | the answer would have no `panel.single_objects` |
| 0.2 | The panel type is the room-control **table**, not the floor plan and not the spjeldliste | [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md) §2 routes elsewhere |
| 0.3 | Output mode A / B / C chosen and stated | the answer does not say which |
| 0.4 | A parameter dump was supplied ⇒ mode C | mode B was chosen anyway without the user asking for a template |
| 0.5 | The known-good export was opened before generating | it was cited but not read |

## Stage 1 — the file parses and is the right document

| # | Check | Rule |
|---|---|---|
| 1.1 | Valid JSON, UTF-8, no mojibake (`Ã¸`, `Â°`, `�`) | R-S1, R-S17 |
| 1.2 | `format == "iwmac-designer-panel"` | R-S2 |
| 1.3 | `version == 1` | R-S3 |
| 1.4 | `panel` present; `single_objects`, `containers`, `graphics` all present and arrays | R-S4, R-S5 |
| 1.5 | `counts.single_objects` / `.containers` / `.graphics` equal the array lengths | R-S6 |
| 1.6 | `background_embedded` agrees with `panel.image_data` and `panel.converted` | R-S13 |
| 1.7 | No `panel.image_svg_trace` (input-only; the importer deletes it) | R-S14 |
| 1.8 | No `panel.image_svg` — this panel type has no authored artwork | contract §2 |

> A file can pass every check in this stage and still be the §13.2 failure.
> Parsing is not usability.

## Stage 2 — objects are well formed

| # | Check | Rule |
|---|---|---|
| 2.1 | Names `object_0…object_N`, sequential, no gaps, no duplicates | R-S7 |
| 2.2 | All 17 fields on every object | R-S8 |
| 2.3 | `posWidth/posHeight/posLeft/posTop` are JSON numbers, integers ≥ 0 | R-S9 |
| 2.4 | `zIndex` is a **string**, never `"default"` | R-S10 |
| 2.5 | `id == "driver_id"` and `link_name == "link_name"` on every object | R-S11 |
| 2.6 | Every `obj_id` resolves in the catalogue or the controls registry | R-S12 |
| 2.7 | No `obj_id` the catalogue marks inactive, outdated or unsupported | R-S12 |
| 2.8 | No object at (0,0) unless it is intentional | R-S15 |
| 2.9 | No unexplained coincident objects | R-S16 |
| 2.10 | The seven constants hold: `id`, `link_name`, `link_tag`, `sub_group`, `unit_ref`, `linked`, `posHeight` | contract §3.2 |

## Stage 3 — the table is a table

| # | Check | Rule |
|---|---|---|
| 3.1 | Exactly one container, `container_type == "table_container"` | R-T1 |
| 3.2 | `unique_id` contains `custom_` — otherwise the container **silently vanishes on Insert** | R-T2 |
| 3.3 | Container `zIndex` is the number `4`; every item `zIndex` is the string `"5"` | R-T3 |
| 3.4 | `num_of_col` equals the measured column count | R-T4 |
| 3.5 | `num_of_rows` equals the measured body-row count | R-T5 |
| 3.6 | The grid is complete: `num_of_col × num_of_rows` body cells, no holes | R-T6 |
| 3.7 | Every header band carries one header per column, all of equal height | R-T7 |
| 3.8 | Body rows evenly pitched, except across a header band (`row + header`) | R-T8 |
| 3.9 | `last_y == last_row_top + row_height` | R-T9 |
| 3.10 | Every canvas object sits inside a cell, at the centred offset | R-T10 |
| 3.11 | Label columns carry no canvas objects | R-T11 |
| 3.12 | Every body row has a room label in the first column; labels unique and ascending as integers | R-T12 |
| 3.13 | Every room carries the same object count, or the differences are listed room by room | R-T13 |
| 3.14 | Container items: `link_tag == "NA"`, `driver_id == ""` on all | R-T14 |
| 3.15 | `graphics` is empty | R-T15 |
| 3.16 | Content beyond the viewport is **reported, not corrected** | R-T16 |

> 3.16 is the check people get backwards. A room-control table cannot fit
> 1400×750 and is not supposed to — contract §8. Compressing it to fit is a
> defect, not a fix.

## Stage 4 — bindings are real

| # | Check | Rule |
|---|---|---|
| 4.1 | Mode C: no object carries the literal `"driver_id"` | R-B1 |
| 4.2 | Mode C: no object with a real `driver_id` has an empty `unit_id` | R-B2 |
| 4.3 | Mode B: **every** object is unlinked — no half-linked file | R-B3 |
| 4.4 | `linked` agrees with the binding (`"true"` whenever `driver_id != "driver_id"`) | R-B4 |
| 4.5 | `driver_id` values are unique | R-B5 |
| 4.6 | With `--source-sql`: every `driver_id` exists in the dump | R-B6 |
| 4.7 | With `--source-sql`: every `unit_id` matches its dump row | R-B7 |
| 4.8 | With `--source-sql`: every `alias_text` is **byte-identical** to its dump row — including odd whitespace | R-B8 |
| 4.9 | With `--source-sql`: every source room appears exactly once; no invented room | R-B9 |
| 4.10 | Alarm-role objects bind to alarm **states**, not alarm **limits** | R-B10 |

> Without `--source-sql`, stage 4 cannot see an invented binding at all. A
> well-formed id naming a parameter the controller does not expose is
> indistinguishable from a real one. **Run it with the dump.**

## Stage 5 — comparison with the known-good example

Run whenever a known-good export of this panel type exists:

```bash
python validate-romkontroll-panel.py --compare reference_data/romkontroll-8653-sanitized.json out.json
```

| # | Check | Rule |
|---|---|---|
| 5.1 | Envelope differences accounted for | R-C1 |
| 5.2 | Object census differences accounted for | R-C2 |
| 5.3 | Every missing or extra room explained | R-C3 |
| 5.4 | Every missing or extra column explained | R-C4 |
| 5.5 | Per-cell displacement: median 0 for cells present in both, unless a column width changed | R-C5 |
| 5.6 | Container-attribute differences explained | R-C6 |
| 5.7 | No binding present in the source and placeholdered or lost in the candidate | R-C7 |
| 5.8 | Z-bands unchanged | R-C8 |

A difference is a **finding**, not automatically a defect — another building has
other rooms. An *unexplained* difference is a defect.

## Stage 6 — profile (same plant only)

```bash
python validate-romkontroll-panel.py out.json --profile TEMPLATE-8653-ROMKONTROLL
```

Only for a panel of the same building. `R-P1`…`R-P7` assert that building's
34 columns, 50 rooms, header bands, row pitch, obj_id census, container
attributes and reset cluster. **A failure on another plant means the profile
does not apply**, not that the panel is wrong.

## Stage 7 — delivery

| # | Check |
|---|---|
| 7.1 | The **actual JSON file** is delivered — not a summary, a schema, a snippet or a description |
| 7.2 | The answer states the mode (A/B/C) and why |
| 7.3 | The answer names the source of every class of identifier |
| 7.4 | The answer states explicitly that no identifier was invented |
| 7.5 | The answer names the validator run and its result — "validated" without a command and an output is a claim, not evidence |
| 7.6 | Anything not delivered is named, with the reason |
| 7.7 | Any preview is drawn from the same coordinates as the JSON, and labelled approximate unless it was rendered by the Designer |

---

## The two failures this checklist exists to catch

Recorded in contract §13. The rule ids below are **measured**, not predicted:
both failures are reproduced by [build-romkontroll-negatives.py](build-romkontroll-negatives.py)
(`dataset-not-a-panel`, `placeholder-overview`) and the ids are asserted in
[tests/test_romkontroll_8653_contract.py](tests/test_romkontroll_8653_contract.py)
`RejectedGenerationTest`.

| Failure | `--check` fires | `--compare` adds | `--profile` adds |
|---|---|---|---|
| §13.1 — a custom dataset, not a panel | R-S2 (1.2), R-S3 (1.3), R-S4 (1.4) | R-C1 (5.1), R-C3 (5.3), R-C8 (5.8) | — |
| §13.2 — panel-shaped placeholder overview | R-S10 (2.4), R-S11 (2.5), R-T1 (3.1) | R-C3 (5.3), R-C8 (5.8) | R-P1 (stage 6) |

Two things this table used to claim, and does not:

- **Stage 4.1 does not fire on §13.2.** Every one of its 59 objects carries the
  placeholder, so the file is a well-formed *mode B template* — R-B1 records the
  detected mode as a note and reports no error. What makes §13.2 a defect is that
  nobody asked for a template and the dump was attached: that is **stage 0.4**,
  a routing check, and it is the reason stage 0 comes before the validator.
- **Stage 5.3 fires for a different reason than "rooms are missing", and 5.4 does
  not fire at all.** R-C3's message is *no grid could be derived, so rooms,
  columns and cell placement were not compared at all*. With no container there
  is nothing to compare rooms or columns against, so R-C4 stays silent. A file
  that removes the table removes the comparison too — which is exactly why R-C3
  is an error rather than a skipped check.

Failure §13.2 passed stages 1.1–1.5 cleanly. That is the point of stages 3–5.
