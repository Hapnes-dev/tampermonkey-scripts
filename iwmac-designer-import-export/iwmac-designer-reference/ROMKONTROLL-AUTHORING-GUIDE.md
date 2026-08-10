# Romkontroll table — authoring guide

> **Procedure only.** Every rule it applies is owned by
> [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md);
> where this guide and the contract disagree, the contract wins. Routing —
> whether to build a panel at all — is
> [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md).

Four jobs, four sections:

| You are | Go to |
|---|---|
| building a room-control table for a plant that has none | §3 |
| copying an existing one to another plant | §4 |
| editing a supplied export (adding a column, a room, a signal) | §5 |
| checking one someone else produced | [ROMKONTROLL-QA-CHECKLIST.md](ROMKONTROLL-QA-CHECKLIST.md) |

---

## 1. What you need before starting

| Input | Required for | Without it |
|---|---|---|
| The plant's `iw_gen_driver_parameters` dump | mode C (linked) | you cannot bind anything — say so, offer mode B |
| A known-good room-control export | geometry, column order, conventions | fall back to [reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json) and say you did |
| The list of rooms in scope | row set | derive it from the dump's `unit_name` and confirm it |
| The list of signals in scope | column set | derive it from the parameters the room controllers share, and list what you chose |

A room-control table is **one panel per building**, not per floor. If the
request says "one per plan", check whether it means one panel showing all floors
(this panel type) or eight panels — the two readings produce very different
files.

## 2. Pre-generation checklist — answer all fifteen, in writing

`GLOBAL` Nothing is generated until every line has an answer. An unanswered
line is a guess waiting to become an invented identifier.

| # | Question | Answered by |
|---|---|---|
| 1 | Is this a generic JSON request or an IWMAC Designer panel request? | [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md) §1 |
| 2 | Which panel type is it? | routing §2; contract §1.1 |
| 3 | Is a known-good export of that type available, and have I opened it? | contract §"Evidence" |
| 4 | Which file owns the document shape? | [AI-BRIEFING.txt](AI-BRIEFING.txt) §2–§3 |
| 5 | Which file owns the geometry? | contract §6 |
| 6 | Which file owns `obj_id` selection? | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) + contract §5 |
| 7 | Linked or unlinked — mode A, B or C? | contract §10 |
| 8 | Where does each `driver_id` come from, row by row? | contract §7 — the dump, verbatim |
| 9 | Where does each `unit_id` come from? | the same dump row |
| 10 | Is every identifier in the file traceable to a source row? | contract §7.2 cross-check |
| 11 | Does the panel need a background, and containers? | contract §2 (background), §4 (exactly one container) |
| 12 | Will the content exceed the declared viewport, and is that expected? | contract §8 — yes, and yes |
| 13 | Which validator runs, with which flags? | contract §11 |
| 14 | Do `counts` match the three array lengths? | contract §2 |
| 15 | Does every room in the source appear exactly once, and no room that is not in the source? | contract §6.6 |

Bonus question, and the one that catches the rest: **is anything in this file a
guess?** If yes, remove it or mark it. A marked gap is a finding; an unmarked
guess is a defect.

---

## 3. Building a new room-control table

### 3.1 Decide the rows

1. Read the dump. Group rows by `unit_id`; each room controller is one unit.
2. Get the room number from `unit_name` — on plant 8653 the pattern is
   `563.<room>-OU001`. **Confirm the pattern on the plant you are working on**;
   it is a convention, not a guarantee.
3. Sort ascending **as integers**, not as strings — `912` sorts after `214`,
   and `"1002" < "212"` as text.
4. The floor is the leading digit. Derive it; never ask for it, never invent it.
5. Do not insert floor headers, divider rows or spacer rows (contract §6.6).

### 3.2 Decide the columns

1. Take the parameters the room controllers have in common. On 8653 that is 31
   signals, identified by `menu` code (contract §9).
2. Order them **functionally**, not alphabetically and not in dump order:
   measurement → adjustment → calculated setpoint → actuator outputs → stages →
   alarms → alarm limits → controls, then the secondary zone (the bathroom on
   8653), then curve points, then references.
3. Add the label columns: room number, description, and a **repeat of the room
   number** partway across so a scrolled row stays identifiable. On 8653 the
   repeat is at column 16, after 14 signal columns.
4. Header text = the Norwegian description + the engineering unit + `(r)` or
   `(rw)` from `att`. All three come from the dump.

### 3.3 Build the container

One `table_container`, 22 keys, per contract §4. Then:

```
columns = label columns (100, 130, …) + signal columns (90 each), no gutter
rows    = 50 body rows, height 27
headers = one band of 34 header cells (height 85) every 22 body rows
origin  = left 5, top 5; first header band at container-relative top 20
```

Emit, in this order per band: the 34 header cells, then the body cells for the
rows that follow it. Every (column, row) pair gets exactly one body cell —
`num_of_col × num_of_rows` cells in total, no holes. Body cells carry
`tag_text: " "` except the room-number and description columns.

Set `num_of_rows`, `num_of_col` and `last_y` from what you actually emitted, not
from the reference. `last_y = last_body_row_top + row_height`.

### 3.4 Place the canvas objects

For every (room, signal) pair that the dump can bind:

1. Pick the `obj_id` from the signal's role — contract §5: alarm state gets
   `V3_R_20px_anim_rg_alarm_nrm` (20×20), everything else gets
   `number_v3_value_only` (80×20).
2. Position it centred in its cell, contract §6.4:
   `posLeft = 5 + cell.posLeft + (cell.posWidth − posWidth) / 2`,
   `posTop = 5 + cell.posTop + floor((27 − 20) / 2)`.
3. Copy `driver_id`, `unit_id` and `alias_text` **verbatim** from the dump row.
4. Set the seven constants (contract §3.2) and `zIndex: "110"`.
5. If the dump has no row for that pair, emit **nothing** — the cell stays empty
   (contract §6.7).

Name the objects `object_0…object_N` in emission order. Then set `counts`.

### 3.5 Background

Emit the blank canvas background: `background_embedded: true`,
`panel.converted: "true"`, `panel.image_data` = the 1400×750 blank PNG data URI.
The grid is drawn by the container; **do not author artwork** and do not emit
`panel.image_svg` or `panel.image_svg_trace`.

### 3.6 Validate

```bash
python validate-romkontroll-panel.py out.json --check --source-sql "iw_gen_driver_parameters.sql"
```

Then compare against the reference:

```bash
python validate-romkontroll-panel.py --compare reference_data/romkontroll-8653-sanitized.json out.json
```

Explain every structural difference the comparison reports. A difference is not
automatically a defect — a different building has different rooms — but an
unexplained one is.

---

## 4. Copying a room-control table to another plant

1. Start from the source export, not from scratch.
2. Rewrite the plant prefix in every `driver_id`: `<src>_…` → `<target>_…`.
   **That alone is not enough.** The rest of the id encodes the unit and the
   parameter, and those differ per plant.
3. Re-resolve every binding against the **target** plant's dump. The portable
   key is the `menu` code plus the room, not the id.
4. Rooms will differ. Rebuild the row set from the target dump (§3.1) and let
   the row count change. Do not keep 50 rows because the source had 50.
5. Signals may differ. A column whose `menu` code no signal in the target plant
   carries is dropped, and the columns to its right shift left by its width.
   Recompute every `posLeft`; do not leave a gap.
6. Blank `source_plant_id`, `panel.plant_id` and `saved_by` if the file is not
   for a specific operator, or set them to the target's values.
7. Run `--check --source-sql` against the **target** dump. Zero errors means
   every binding resolves on the target plant.

`--profile TEMPLATE-8653-ROMKONTROLL` will fail on the copy. That is correct:
the profile is scoped evidence about one building.

---

## 5. Editing a supplied export

`GLOBAL` **Preserve and patch. Never rebuild.** A supplied export outranks
every document here (precedence rank 1).

| Change | Do |
|---|---|
| add a signal column | append the column at the functionally correct position; shift the columns to its right by the new width; add one header cell per band and one body cell per row; bump `num_of_col`; add one canvas object per room that has the signal |
| remove a column | delete its header cells, its body cells and its canvas objects; shift the right-hand columns left; bump `num_of_col` |
| add a room | insert the row in integer order; add one body cell per column; add the canvas objects; shift every row below it down by 27; recompute the header bands (a row crossing a band boundary moves the bands); bump `num_of_rows` and `last_y` |
| remove a room | the inverse |
| relink to a new controller | change `driver_id`, `unit_id` and `alias_text` together, all from the same dump row. Changing one alone produces a binding that resolves to the wrong parameter |
| fix a header caption | change the header item's `tag_text` **and** its `name` — on header items they are equal (contract §4.1) |

Things not to touch when editing:

- `linked: "true"` on an object with an empty `driver_id` — host behaviour, not
  a defect (contract §3.1).
- `link_tag: "NA"` on container items, `alias_text: "new text"` on all 1,802 —
  host artefacts, round-tripped.
- container `width: 405` / `height: 72` — they do not describe the table and
  "correcting" them invents a number.
- `image_data` — the background is the blank canvas; leave it.

After any structural edit, re-derive the affected geometry rather than nudging
it. The pitch rules in contract §6.3 are exact; an off-by-one row top is
invisible in a diff and obvious on screen.

---

## 6. Post-generation acceptance gate

`GLOBAL` All eight. This is the gate the QA checklist tests in detail.

1. **Schema** — `--check` reports zero errors under `R-S*`.
2. **Catalogue** — every `obj_id` resolves (contract §5, conflict RC-C2).
3. **Source binding** — `--check --source-sql` reports zero errors under
   `R-B6`…`R-B9`: every id exists in the dump, every `unit_id` agrees, every
   alias is byte-identical, every room appears exactly once.
4. **Counts** — `counts` equals the three array lengths; `num_of_col` and
   `num_of_rows` equal the measured grid.
5. **Layout** — `R-T*` clean: the grid is complete, every object sits centred in
   a cell, header bands are regular.
6. **Panel-type contract** — one `table_container`, no graphics, the label
   columns empty, the room labels unique and ascending.
7. **Inspection against the known-good example** — run `--compare` and account
   for every difference in words.
8. **No invented identifiers** — state explicitly, in the answer, that every
   `driver_id`, `unit_id` and `alias_text` came from the source, and name the
   source file.

Then, and this is a delivery requirement rather than a validation one:

> **Return the actual downloadable JSON file.** Not a summary of it, not the
> schema, not a snippet, not a description of what it would contain. A panel
> that is described but not delivered is not a deliverable.

If part of the work could not be completed — a room without parameters, a signal
the dump does not carry — deliver everything else and say precisely what is
missing and why. Scaling the panel down is the operator's decision, not yours.
