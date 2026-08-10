# Documentation change log — panel generation contracts

Parts 1–4 (2026-08-09 and 2026-08-10) cover the **ventilation** generation
contract. [Part 5](#part-5--2026-08-10-the-list-panel-generation-contract)
(2026-08-10) covers the **list panel** (spjeldliste) generation contract and uses
its own finding ids, `L-1`–`L-16`. [Part 6](#part-6--2026-08-10-the-maskin-machine-room-generation-contract)
covers the **Maskin** (machine room) contract, conflict ids `M-1`–`M-6`,
[Part 7](#part-7--2026-08-10-the-oversikt-store-overview-generation-contract)
covers the **Oversikt** (store overview / case position / byggeplan) contract,
conflict ids `OV-C1`–`OV-C3`, and
[Part 8](#part-8--2026-08-10-the-room-control-table-tabell-romkontroll-alle-plan-generation-contract)
covers the **room-control table** (`Tabell romkontroll alle plan`) contract,
conflict ids `RC-C1`–`RC-C5`. Part 8 also adds the first `GLOBAL` document that
is not about a panel type at all — [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md),
which owns *which* deliverable a request is asking for.

Date: 2026-08-09. Driven by [DOCUMENTATION-AUDIT.md](DOCUMENTATION-AUDIT.md); finding
ids (F1–F21) refer to that document.

Every row below records the **original text**, the **revised text**, the **reason**,
the **source** the revision is grounded in, and whether the rule is **normative**
(a generated panel is wrong if it violates it) or **advisory** (judgement, may be
overridden with a stated reason).

Scope tags used throughout: `GLOBAL` · `VENT` (ventilation panels only) ·
`REF-9099` (measured from one production export) · `SCREENSHOT` (derived from a
rendered image, not from JSON or source) · `ADVISORY`.

Evidence ids:

| id | file | note |
|---|---|---|
| E1 | `iwmac-panel_9099_360-001-ventilasjon_recommended.json` (user Downloads) | 102 objects, live plant id — **not committed** |
| E2 | [reference_data/real-vent-panel-example.json](reference_data/real-vent-panel-example.json) | 102 objects, masked |
| E3 | [reference_data/real-vent-panel-example-2.json](reference_data/real-vent-panel-example-2.json) | 92 objects, different plant |
| E4 | [tests/fixtures/ventilation-9099-rotor-demo.json](tests/fixtures/ventilation-9099-rotor-demo.json) | 97 objects, 43 distinct `obj_id`s — the sanitized corrected rotor profile, added 2026-08-10 (Part 4) |
| E5 | `iwmac-panel_5295_360-001-spjeldliste_ny.json` (user Downloads) | List panel. Plant 5295, system 360.001, 55 `single_objects` + 25 containers, 78 live cells — **not committed** (live plant id). Added 2026-08-10 (Part 5) |
| E6 | [reference_data/real-spjeldliste-example.json](reference_data/real-spjeldliste-example.json) | List panel. System 360.004, plant masked, 383 `single_objects` + 208 containers, no live bindings. The normative list template. Added 2026-08-10 (Part 5) |
| E7 | `Spjeld liste med sjaktspjeld 06.02.26_with_driver_id_no.xlsx` (user Downloads) | The source workbook behind E5. 1 104 data rows × 26 columns; 28 rows carry `System nr. == 360.001` — **not committed** (customer data). Added 2026-08-10 (Part 5) |
| E8 | `Spjeldliste_360.001_companion.json` (user Downloads) | 1 048 bytes, `"format": "iwmac-designer-task-companion"`. A negative example — the output-discipline anti-pattern. Added 2026-08-10 (Part 5) |
| E9 | `iwmac-panel_10229_maskin_20260810-1033.json` (user Downloads) | Maskin. Plant 10229, `IWDIE v1.7.0`, 66 `single_objects`, 11 distinct `obj_id`s, embedded 123 966-char raster background plus a 2 241 097-char `image_svg_trace` — **not committed** (live plant id, 64 real driver ids, named author). Added 2026-08-10 (Part 6) |
| E10 | [reference_data/maskin-10229-sanitized.json](reference_data/maskin-10229-sanitized.json) | E9 with its bindings replaced and nothing else touched: same 66 objects, same geometry, sizes, `zIndex`, `tag_text`, `alias_text`, array order and byte-identical `image_data`. The committed `TEMPLATE-10229` reference. Added 2026-08-10 (Part 6) |
| E11 | [reference_data/generated-maskin-example.json](reference_data/generated-maskin-example.json) | An authored Maskin demo — 63 objects, 9 distinct ids, authored `image_svg`, every `zIndex` `"default"`. Reclassified in Part 6 from worked example to **negative example**. Added 2026-08-10 (Part 6) |
| E12 | [reference_data/maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json) | alias → Danfoss AK-PC parameter map; the source of link names. Added 2026-08-10 (Part 6) |
| E13 | [tests/fixtures/maskin-compressor-bank/](tests/fixtures/maskin-compressor-bank/) | Miniature instrumented fixture, 96×64. Test instrumentation, **not** production geometry. Added 2026-08-10 (Part 6) |
| E14 | `Coop_Prix_Breiviken_complete_disks.json` (user Downloads) | Oversikt. Plant 10113, 650 882 bytes, 72 `single_objects`, 21 controller clusters, 1400×750, an embedded 48 210-character raster store plan plus a 528 876-character `image_svg_trace` — **not committed** (live plant id, 72 real driver ids). Added 2026-08-10 (Part 7) |
| E15 | [reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json) | E14 with the plant number masked to `NNNNN` inside every driver id and the plant/author/background-filename fields blanked. Same 72 objects, same 21 clusters, same geometry, sizes, `zIndex`, `tag_text`, `alias_text`, `unit_id`, array order and byte-identical `image_data`. The committed `TEMPLATE-10113` reference. Added 2026-08-10 (Part 7) |
| E16 | `Coop_Prix_Breiviken_overview.json` (10 624 bytes) and `..._v2.json` (54 227 bytes) (user Downloads) | The two failed attempts of the 2026-08-10 incident: a dashboard grouping with no background, and a 9-of-21-cluster reconstruction. Negative examples — **not committed**. Added 2026-08-10 (Part 7) |
| E17 | [build-oversikt-negatives.py](build-oversikt-negatives.py) | Seven synthetic negatives derived from E15, one broken rule each. Generator committed, output not. Added 2026-08-10 (Part 7) |
| E18 | `iwmac-panel_8653_tabell-romkontroll-alle-plan_20260810-2157.json` (user Downloads) | Room-control table. Plant 8653, 1 894 376 bytes, **1 553 `single_objects` + exactly 1 `table_container`** holding 1 802 grid items, 34 columns × 50 room controllers on 8 floors, 1 551 live bindings, content reaching x 3 120 / y 1 690 on a declared 1400 × 750 viewport — **not committed** (live plant id, 1 551 real driver ids). The known-good export supplied with the task and, per the brief, **never modified**: every measurement in Part 8 is read from it and reproduced from E19. Added 2026-08-10 (Part 8) |
| E19 | [reference_data/romkontroll-8653-sanitized.json](reference_data/romkontroll-8653-sanitized.json) | E18 with the plant number masked to `NNNN` inside every driver id and the plant/author/background-filename fields blanked. 1 275 328 bytes. Same 1 553 objects, same container, same 1 802 items, same geometry, sizes, `zIndex`, `tag_text`, `alias_text`, `unit_id`, `linked` and array order. The committed `TEMPLATE-8653-ROMKONTROLL` reference. Added 2026-08-10 (Part 8) |
| E20 | `iw_gen_driver_parameters (3).sql` (user Downloads) | The plant's parameter dump, 5 002 553 bytes: **10 315 rows, 10 315 distinct `driver_id`**. All 1 551 bindings in E19 resolve in it with `unit_id` and `alias_text` byte-identical — the evidence for the verbatim-copy rule (contract §7.2) — **not committed** (customer data). Five tests skip unless `IWMAC_ROMKONTROLL_SQL` points at it. Added 2026-08-10 (Part 8) |
| E21 | `Tabell_romkontroll_alle_plan.json` (1.58 MB) and `Romkontroll_alle_plan_IWMAC_Designer.json` (30 KB) | The two rejected generations of the 2026-08-10 incident: a custom dataset that was not a panel, and a 59-object unlinked placeholder overview. **Recorded from the task's own description — the files themselves were not supplied to this pass** and are not committed. Their shapes are reproduced synthetically by [build-romkontroll-negatives.py](build-romkontroll-negatives.py) (`dataset-not-a-panel`, `placeholder-overview`), which is what the rule ids in contract §13 are measured against. Added 2026-08-10 (Part 8) |

Scope tag added 2026-08-10: `PROFILE-9099-ROTOR-DEMO`, for geometry that is a
property of one named profile rather than of ventilation panels in general. `VENT`
remains the only tag that generalizes to every ventilation panel.

Two further scope tags added 2026-08-10 with Part 5: `LIST`, for rules that hold
for list panels and are confirmed by both list exports, and `TEMPLATE-SPECIFIC`,
for values measured from a single export and therefore not yet generalizable.
`TEMPLATE-SPECIFIC` is the list-panel counterpart of `REF-9099`; it is named for
the template rather than for a plant because a list template is copied between
plants.

Two further scope tags added 2026-08-10 with Part 6: `MASKIN`, for rules that
hold for every machine picture, and `TEMPLATE-10229`, for geometry measured from
the one production export supplied with that task. `TEMPLATE-10229` is the
Maskin counterpart of `REF-9099` — a profile, not a plant claim.

Two further scope tags added 2026-08-10 with Part 7: `OVERSIKT`, for rules that
hold for every store-overview panel, and `TEMPLATE-10113`, for geometry measured
from the one Oversikt export supplied with that task. `TEMPLATE-10113` is the
Oversikt counterpart of `REF-9099` and `TEMPLATE-10229`. The distinction carries
weight here: the fleet survey in `reference_data/panel-conventions.json` and the
measured `TEMPLATE-10113` geometry disagree on cluster offsets and on the shape
of a partial cluster, and both are recorded rather than blended (`OV-C1`,
`OV-C3`).

Two further scope tags added 2026-08-10 with Part 8: `ROMKONTROLL`, for rules
that hold for every room-control table, and `TEMPLATE-8653-ROMKONTROLL`, for
geometry measured from the one export supplied with that task. It is the
room-control counterpart of `REF-9099`, `TEMPLATE-10229` and `TEMPLATE-10113` —
a profile, not a plant claim. The distinction is load-bearing here for a reason
the earlier panel types did not have: a room-control table's column set *is* the
building's signal set, so **34 columns and 50 rooms describe one building and
nothing else**. What generalizes is the two-layer structure, not a count.
`ROMKONTROLL` is also deliberately *not* `LIST`: the two table families are built
differently and the difference is recorded as `RC-C1` rather than reconciled.

---

## Part 1 — changes applied in place to live files

### AI-AGENT-INSTRUCTIONS.txt

The file is pasted into the M365 Copilot Studio instructions field, which caps at
8 000 characters and rejects `<`/`>`. Every edit below was character-budgeted; the
net change is **−1 character** (7 971 → 7 970 LF; worst-case CRLF 7 995).

#### 1. The encoding rule inverted — `gr C` was recommended (F1)

| | |
|---|---|
| **Original** | `Never overlap; 8 px gaps. UTF-8 works; plain ASCII (gr C) safest.` |
| **Revised** | `8 px gaps; schematic panels overlap on purpose. Emit UTF-8: "°C" not "gr C".` |
| **Reason** | This is the single instruction the user asked to remove by name. It told the agent to emit the exact string that every production export avoids. It also stated a blanket "never overlap" that contradicts §7a, where four overlap classes are deliberate. |
| **Source** | E1/E2 carry 13 `°` tags and zero `gr C`; E3 carries 8. `DESIGN-OBJECT-CATALOG.md` prints `RT401 °C`. Insert JSON decodes UTF-8 (`iwdieValidateSvg`/import path). Rendered tests confirmed `°C` survives. |
| **Status** | **Normative** · GLOBAL |

#### 2. `gr C` in the tag-convention example (F1)

| | |
|---|---|
| **Original** | `tag_text = code + unit (RT401 gr C, KA401 %).` |
| **Revised** | `tag_text = code + unit (RT401 °C, KA401 %).` |
| **Reason** | A worked example outranks a rule in practice — an agent copies the example. Leaving it would have re-introduced `gr C` after the rule above was fixed. |
| **Source** | Same as change 1. |
| **Status** | **Normative** · GLOBAL |

#### 3. Header-bar size contradicted itself within the same file (F3)

| | |
|---|---|
| **Original** | `number_v3_header_grey75 260x20 header bar` (allowlist line) — while the Ventilasjon line in the same file said `headers 250x20` |
| **Revised** | `number_v3_header_grey75 250x20 header bar` |
| **Reason** | Two different sizes for one object in one document. An agent has no way to choose. |
| **Source** | E1 and E2: all three sidebar headers are `250×20` at x1150. The palette default is `60×25` — neither figure. |
| **Status** | **Normative** · VENT (the 250×20 measurement); the allowlist entry itself is GLOBAL |

#### 4. Catalogue sizes were presented as placement rules (F4)

| | |
|---|---|
| **Original** | `ALLOWLIST (obj_id, width x height, role).` |
| **Revised** | `ALLOWLIST (obj_id, default size, role - an export outranks it).` |
| **Reason** | The listed sizes are what the palette inserts, not what production places. Seven objects in the vent references are placed at a size different from their catalogue default (`number_v3_el_heater` 38×65 → 40×85, `number_360_vg_rot` 60×324 → 60×343, `number_v3_header_grey75` 60×25 → 250×20, `number_v3_dummy_resirc_damp_vert` 26×36 → 40×40, `number_v3_60px_dark_no_conn` 61×21 → 62×22, `number_v3_R_45px_con_left` 62×20 → 62×22, `number_v3_custom_json_obj` 61×21 → 230×20 or 100×20). An agent that trusts the catalogue size produces a panel whose every component is the wrong size. |
| **Source** | E1/E2 placements vs `reference_data/all-design-objects.json`. |
| **Status** | **Normative** · GLOBAL |

#### 5. Pipe sizes stated as fixed (F4)

| | |
|---|---|
| **Original** | `number_v3_exhaust_pipe_horisontal 50x18 / _vertical 18x50 pipe` |
| **Revised** | `number_v3_exhaust_pipe_horisontal / _vertical pipe (stretches)` |
| **Reason** | `50x18` is the palette default. The production extract run is `1025×18` and the supply run `710×18`. Quoting the default beside the object name invites a 50 px duct. |
| **Source** | E1: extract run (24,200) 1025×18; supply run (337,442) 710×18. |
| **Status** | **Normative** · GLOBAL |

#### 6–8. Character budget (no rule change)

| Original | Revised | Δ |
|---|---|---|
| `LAYOUT, table-style only (7a/7c/7d layouts override it).` | `LAYOUT, table-style only (7a/7c/7d override it).` | −8 |
| `Use the document's sensor names in alias_text.` | `Sensor names go in alias_text.` | −15 |
| `vary only obj_id, name index, sizes, positions, tag_text, alias_text:` | `vary only obj_id, name index, geometry, tag_text, alias_text:` | −10 |

**Reason.** The file has ~4 characters of headroom against the 8 000 cap; changes
1–5 add 33. These three shorten wording without dropping a fact — "geometry"
covers sizes and positions, and the sensor-name rule is unchanged in meaning.
**Status: editorial, no normative effect.**

---

### AI-BRIEFING.txt

#### 9. The TEXT ENCODING block recommended plain ASCII (F1)

| | |
|---|---|
| **Original** | `- TEXT ENCODING: the Insert JSON flow reads files as UTF-8, and production panels do contain Norwegian letters, degree signs and m3-superscripts - those survive the real pipeline. BUT if your output travels through any non-UTF-8 channel (copy-paste through terminals, old mail systems) they mojibake. Safe default: plain ASCII ("gr C", "hoyfart", "gasskjoler"); Norwegian/degree characters are acceptable when the user asks for them.` |
| **Revised** | `- TEXT ENCODING: emit UTF-8. The Insert JSON flow reads files as UTF-8, production panels carry Norwegian letters, degree signs and m3-superscripts, and rendered tests confirm they survive the real pipeline. Write "°C", never "gr C"; write "høyfart", never "hoyfart". The catalogue itself uses "RT401 °C". The mojibake risk lives in other channels (pasting through a terminal, an ISO-8859-1 page, old mail) - that is a transport problem to fix at the transport, not a reason to degrade the panel text.` |
| **Reason** | The original stated the correct fact and then drew the wrong conclusion from it. It made the degraded form the default and the correct form conditional on the user asking. |
| **Source** | Same as change 1, plus `CLAUDE.md` §19 gotcha 26 on where mojibake actually originates (`addScriptTag` on the ISO-8859-1 page). |
| **Status** | **Normative** · GLOBAL |

#### 10–14. Five worked examples still printed `gr C` (F1)

| Line | Original | Revised |
|---|---|---|
| 459 | `("RT502 gr C" at (985,174) … "RT401 gr C" at` | `("RT502 °C" … "RT401 °C" at` |
| 480 | `coil temps con_right "RT510 gr C" (535,518) and con_left "RT410 gr C"` | `… "RT510 °C" … "RT410 °C"` |
| 485 | `con_top (453,532) + "RT420 gr C" con_left (482,486) + "RT520 gr C"` | `… "RT420 °C" … "RT520 °C"` |
| 560 | `7a-8 TAG CONVENTION. tag_text = instrument code + unit ("RT401 gr C",` | `… ("RT401 °C",` |
| 940 | `object's alias_text/tag_text: "RT401 gr C" -> "Actual supply` | `… "RT401 °C" -> "Actual supply` |

**Reason.** Six sites carried the forbidden string; fixing the rule without the
examples leaves the wrong form as the more visible instruction.
**Source:** as change 1. **Status: normative · GLOBAL.**

#### 15. Header-bar width range excluded the measured value (F3)

| | |
|---|---|
| **Original** | `- Table-style: each section has a header bar (number_v3_header_grey75, W 260-280) then rows every 28-30 px starting ~35 px below the header.` |
| **Revised** | `- Table-style: each section has a header bar (number_v3_header_grey75, W 250-280; the Ventilasjon sidebar uses exactly 250x20) then rows every 28-30 px starting ~35 px below the header.` |
| **Reason** | The stated range `260-280` excludes the only header width that appears in both vent references. An agent following the briefing literally cannot produce the production sidebar. |
| **Source** | E1, E2: three headers, each `250×20`. |
| **Status** | **Normative** for the 250×20 figure (VENT); the 250–280 range remains **advisory** for table-style panels |

#### 16. The overlap rule named one exception out of four, and defined no detection method (F11)

| | |
|---|---|
| **Original** | `- Never overlap objects. Leave 8+ px gaps. EXCEPTION: on a schematic panel a value box deliberately sits on top of the duct or pipe it belongs to - that is what the z-index bands (7a-5) are for.` |
| **Revised** | `- Never overlap objects. Leave 8+ px gaps. Overlap is measured on RENDERED extents, not on posWidth: a left-aligned label whose text is narrower than its box does not overlap its neighbour.`<br>`  EXCEPTIONS - four classes, all intentional, none of them a defect to "fix" (7a-5 is what the z-index bands are for):`<br>`  1. a value box sitting on the duct or pipe it belongs to;`<br>`  2. a con_* connector edge landing ON its duct - a stub that stops short is the defect;`<br>`  3. a damper symbol laid over a continuous duct column - NEVER shorten the duct to clear it;`<br>`  4. an equipment body straddling the run it conditions.`<br>`  Anything outside that list is a real overlap. See VENTILATION-GEOMETRY-CONTRACT.md for the measured exception table.` |
| **Reason** | "Avoid overlap" with one example is the instruction that produces the two most common vent defects: an agent shortens the bypass duct to clear the damper, and pulls connector value boxes back off their ducts. The original also gave no way to *detect* overlap, so an agent compares `posWidth` boxes and reports false positives on left-aligned labels. |
| **Source** | E1 bypass column: `exhaust_connector_up`/`exhaust_pipe_vertical` overlap 7 px, `supply_pipe_vertical`/`supply_connector_down` 5 px, damper 40×40 over an unbroken column running y211→y449. Left-alignment of `number_v3_label_11px_norm` from the rendered sidebar. |
| **Status** | **Normative** · VENT for the four classes; the rendered-extent detection rule is GLOBAL |

---

### CLAUDE.md (iwmac-designer-reference)

#### 17. Plain ASCII named as the safe default (F1)

| | |
|---|---|
| **Original** | `**plain-ASCII text as the safe default** (the Insert flow reads files as UTF-8 and production panels do carry °/æøå — those survive; the mojibake risk is other channels like addScriptTag on the ISO-8859-1 page, verified both ways)` |
| **Revised** | `**UTF-8 text** — write °C, never gr C (the Insert flow reads files as UTF-8, production panels carry °/æøå, the object catalogue itself uses RT401 °C, and rendered tests confirm they survive; the mojibake risk is other channels like addScriptTag on the ISO-8859-1 page, verified both ways — fix the transport, do not degrade the panel text)` |
| **Reason** | Third statement of the same inverted rule. This one sits in the "load-bearing rules, all live-verified" list, which is what a reader trusts most. |
| **Source** | As change 1. |
| **Status** | **Normative** · GLOBAL |

#### 18. The 85 / 84 / 66 diff figure was an array-index artifact (F2)

| | |
|---|---|
| **Original** | `not its unmasked twin — 85 objects differ in posLeft, 84 in posTop, 66 in obj_id — so the two sets of anchors are both real and must not be merged.` |
| **Revised** | `not its unmasked twin. **Diff them by role, never by array index.** Compared index by index, 85 objects differ in posLeft, 84 in posTop and 66 in obj_id — but that figure is an artifact of the two files ordering their objects differently. Matched by role, **79 of 102 objects are geometrically identical**; 21 moved, 1 exists only in the 9099 export, 2 only in the committed reference. The moves are real and the two sets of anchors must still not be merged — but the panels are the same drawing, not two unrelated layouts.` |
| **Reason** | The original figure says the two references share almost nothing, which is false and actively harmful: it tells an agent that neither reference constrains the other, so any layout is defensible. The role-matched figure says the opposite — the layout is stable and only 21 objects move. |
| **Source** | Role-wise diff of E1 against E2 performed for this audit: 79 identical, 21 moved, 1 only-E1, 2 only-E2; obj_id multisets differ by 2 ids. Index-wise diff of the same two files reproduces 85/84/66 exactly, which is what identifies it as an ordering artifact. |
| **Status** | **Normative** · REF-9099 (the specific counts); the "diff by role, not index" method is GLOBAL |

#### 19. "Still differ in every coordinate" (F2)

| | |
|---|---|
| **Original** | `**Counts are necessary but not sufficient.** Two panels can agree on all six counts and still differ in every coordinate — the 9099 export and the committed reference do exactly that.` |
| **Revised** | `**Counts are necessary but not sufficient.** Two panels can agree on all six counts and still differ where it matters. The 9099 export and the committed reference agree on every count and still move 21 of 102 objects — including both fans, both filters and the electric heater. Compare role by role and report the moved roles, not a count of differing array slots.` |
| **Reason** | Same false claim as change 18, in the QA section where it directs how comparison is done. The revision keeps the point (counts are insufficient) and replaces the unsupportable example with the measured one, and states the required output of the comparison. |
| **Source** | As change 18. Moved roles include extract fan (x187→x152), supply filter (x171→x189), electric heater (x697→x693). |
| **Status** | **Normative** · GLOBAL (comparison method); REF-9099 (the counts) |

#### 20. The 8 000 limit was stated without its unit (F8)

| | |
|---|---|
| **Original** | `(7,971 chars, no angle brackets — the field rejects <\|> and caps at 8000)` |
| **Revised** | `(7,9xx **characters**, no angle brackets — the field rejects <\|> and caps at 8000). The cap counts characters, not bytes, and a CRLF working tree adds one per line: measure the worst case before editing — python -c "import io;t=io.open('AI-AGENT-INSTRUCTIONS.txt',encoding='utf-8').read();print(len(t),len(t)+t.count(chr(10)))"` |
| **Reason** | The 7 971 figure is correct (the file is pure ASCII; `len(text)` after newline normalisation is exactly 7 971), but the document never said what unit the 8 000 limit counts. On disk the file is 7 996 bytes because of 25 CRLF pairs, so an editor measuring with `wc -c` reads 4 characters of headroom instead of 29. The dangerous direction is the reverse and it is not hypothetical: `AI-AGENT-INSTRUCTIONS-REVISED.txt` measured 7 995 characters with LF endings and would have become **8 028** when pasted from a CRLF working tree — silently truncated. It was trimmed to 7 943 / 7 976 to fit under either count. The literal count is now written `7,9xx` so the sentence does not go stale on every edit; the command re-derives it. |
| **Source** | Direct measurement of the file: 7 996 bytes, 7 971 characters LF-normalised, 25 CRLF pairs, 0 non-ASCII characters. |
| **Status** | **Normative** · GLOBAL (the measurement procedure) |
| **Withdrawn** | An earlier draft of this audit recorded F8 as a *stale byte count* needing correction. That reading was wrong and is withdrawn — the number was right; the unit and the CRLF worst case were missing. |

---

### build-object-catalog.py → DESIGN-OBJECT-CATALOG.md

#### 21. Catalogue rule 5 called `W×H` the placement size (F4)

| | |
|---|---|
| **Original** | `5. **W×H is the placement size in pixels** on the 1400×750 canvas. Pipe/duct pieces are meant to be stretched along their run (posWidth); symbols are not.` |
| **Revised** | `5. **W×H is the toolbox default size, not a placement rule.** It is what the palette inserts; a production export of the same panel type outranks it, and real placements routinely differ (number_v3_header_grey75 is 60×25 here and 250×20 on every Ventilasjon sidebar). Pipe/duct pieces are meant to be stretched along their run (posWidth); symbols are not.` |
| **Reason** | The catalogue is the most-consulted document when choosing objects, and it told the reader its own sizes were placements. Together with change 4 this closes the same defect at both ends. |
| **Source** | Seven measured size differences listed under change 4. |
| **Status** | **Normative** · GLOBAL |
| **Note** | Edited in the **generator**, not in the generated Markdown. `DESIGN-OBJECT-CATALOG.md` was regenerated (`python build-object-catalog.py`: 797 objects, 11 menus, 266 panels scanned). Editing the `.md` directly would be reverted by the next regeneration. |

---

### Second pass — the self-check lists (F1, F11 again)

The corrections above fixed the *rules*. The self-check lists at the end of both
instruction files still carried the pre-correction versions, which is the worst
place for a stale rule: a checklist is the last thing an agent reads and it
overrides an earlier paragraph in practice.

#### 22. `AI-BRIEFING.txt` §9 — "ASCII only"

| | |
|---|---|
| **Original** | `[] tag_text on text objects, alias_text on linkable objects, ASCII only` |
| **Revised** | `[] tag_text on text objects, alias_text on linkable objects, UTF-8`<br>`   text (°C, æøå) - not plain-ASCII substitutes` |
| **Reason** | Fourth site of the inverted encoding rule, and the one an agent checks against last. |
| **Source** | As change 1. |
| **Status** | **Normative** · GLOBAL |

#### 23. `AI-BRIEFING.txt` §9 — "no overlaps"

| | |
|---|---|
| **Original** | `[] positions inside the canvas (list panels 7c excepted), no overlaps,`<br>`   integer pixels` |
| **Revised** | `[] positions inside the canvas (list panels 7c excepted), integer`<br>`   pixels, and no overlap outside the four intentional classes in`<br>`   section 5` |
| **Reason** | Directly contradicted the corrected §5, which now enumerates four intentional overlap classes. A self-check that fails a correct panel trains the agent to break it. |
| **Source** | As change 16. |
| **Status** | **Normative** · VENT |

#### 24. `AI-AGENT-INSTRUCTIONS.txt` self-check — "no overlaps"

| | |
|---|---|
| **Original** | `integer positions in canvas (lists may run below); no overlaps;` |
| **Revised** | `integer positions in canvas (lists may run past); no overlaps outside 7a;` |
| **Reason** | Same contradiction, against the corrected LAYOUT paragraph in the same file. |
| **Source** | As change 16. |
| **Status** | **Normative** · VENT |
| **Budget** | +11 characters, offset by two neutral trims: `one JSON object;` → `one JSON doc;` (−3) and `Trace the geometry from` → `Trace geometry from` (−4), plus `run below` → `run past` (−1). Net +3 → 7 973 characters LF, **7 998 worst-case CRLF, 2 characters of headroom.** |

#### 25. `AI-BRIEFING.txt` §4 header — the allowlist size column

| | |
|---|---|
| **Original** | `4. OBJECT ALLOWLIST (production-proven; obj_id \| W x H \| role)` |
| **Revised** | `4. OBJECT ALLOWLIST (production-proven; obj_id \| default size \| role)`<br>`   The size column is what the palette inserts, not a placement rule. A`<br>`   production export of the same panel type outranks it.` |
| **Reason** | Third and last site of the F4 defect, closing it in all three files that state a size (instructions, briefing, catalogue generator). |
| **Source** | As change 4. |
| **Status** | **Normative** · GLOBAL |

**Headroom warning.** `AI-AGENT-INSTRUCTIONS.txt` now sits **2 characters** below
the worst-case cap. The next edit to that file must trim before it adds. Measure
first — the command is in `CLAUDE.md` §17b and in finding F8.

> **Superseded 2026-08-10.** The file was replaced wholesale (Part 4, change 45).
> The warning still holds; only the figure moved. Current measurement: **7 958
> characters LF, 7 991 worst-case CRLF, 33 lines — nine characters of headroom.**

---

## Part 2 — new documents

None of these delete or replace an existing file; each takes ownership of a class
of information that previously had no owner (F5, F6, F7).

| File | What it owns | Why it is new | Status |
|---|---|---|---|
| [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) | **Measured panel geometry** — coordinates, cluster offsets, z-bands, sidebar rows, the intentional-overlap table, the centring formula. 13 sections, every rule scope-tagged. | The fourth information class had no home. Geometry was scattered across CLAUDE.md prose, AI-BRIEFING §7a and PANEL-TYPE-GUIDE, in three partly-conflicting forms. | **Normative**; each rule individually tagged GLOBAL / VENT / REF-9099 / SCREENSHOT / ADVISORY |
| [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) | **Executable QA** — Stage A structural (A1–A14, with an inline Python validator), B geometry (B1–B16), C visual (C1–C11, with the zoomed-crop region table and a ±2 px centring tolerance), D linking/sanitization (D1–D9), E import/save, plus a 9-question regression checklist. | The existing QA text was a 10-step prose list with no pass/fail criteria and no commands. | **Normative** |

> **Correction, 2026-08-10.** Two statements in the table above are no longer true of
> the files they describe. The QA checklist's **±2 px centring tolerance is no longer a
> pass/fail criterion** — it was demoted to a warning because it rests on an estimated
> glyph width (Part 4, change 31), and a Stage 0 was added ahead of Stage A. The
> `AI-AGENT-INSTRUCTIONS-REVISED.txt` row's "not yet swapped in" is superseded: it was
> **applied on 2026-08-10** and that file is now a stub (Part 4, changes 45–46).
| [DOCUMENTATION-AUDIT.md](DOCUMENTATION-AUDIT.md) | The findings F1–F21 in severity bands, the duplicate-rule register, the 10-row contradiction register, rules to add/remove, and the Evidence-required list. | Record of why each change above was made. | Reference |
| [AI-AGENT-INSTRUCTIONS-REVISED.txt](AI-AGENT-INSTRUCTIONS-REVISED.txt) | A restructured 17-paragraph replacement for the Copilot Studio instructions field: adds an explicit PRECEDENCE paragraph, a TEXT ALIGNMENT paragraph, and a VENT OVERLAP paragraph. **7 943 characters / 7 976 worst-case CRLF / 0 angle brackets.** | The in-place edits fixed the live file's facts but could not restructure it inside the character budget. | **Normative** (proposed replacement — not yet swapped in) |
| [documentation-rules.json](documentation-rules.json) | The same rules, machine-readable, so a validator can check a generated panel without parsing Markdown. Structure: `source_precedence`, `global_invariants`, `panel_types.ventilation.{canvas,background,z_indexes,clusters,sidebar,text_rules,overlap_rules,qa}`. | Requested deliverable; also the only form a script can consume. | **Normative** (mirror of the prose; prose wins on conflict) |
| documentation-change-log.md | This file. | — | Reference |

---

## Part 3 — proposed but not applied

Two restructuring documents are delivered as **section-by-section revision
specifications** rather than as full replacement files, because the originals are
102 420 and 61 673 characters and the instruction was explicitly *"do not delete
existing technical details merely to shorten the documentation"*. A full rewrite
would have had to either reproduce every retained paragraph verbatim or silently
drop detail; the specification form does neither.

| File | Form | Applying it | Status as of 2026-08-10 |
|---|---|---|---|
| [CLAUDE-REVISED.md](CLAUDE-REVISED.md) | Ordered disposition of every section of `CLAUDE.md`, with full replacement text for each section that changes and a keep/move/delete verdict for each that does not. | Mechanical — each entry names the exact anchor text. | **NOT APPLIED, partially superseded** — see Part 4, change 48 |
| [AI-BRIEFING-REVISED.txt](AI-BRIEFING-REVISED.txt) | Same form for `AI-BRIEFING.txt`, including the full text of the restructured §7a header and the new precedence preamble. | Mechanical. | **FULLY APPLIED** — R1–R14, see Part 4, changes 43–44 and 47 |

The factual corrections in Part 1 are **already live** in both files; what remains
in Part 3 is the structural separation of the four information classes.

> **Update, 2026-08-10.** That separation is now done for the ventilation half. The
> geometry, the procedure and the acceptance tests each have an owning document, so
> the *destination* of every MOVE verdict in both specifications exists. What is left
> unapplied is only the *deletion* half of `CLAUDE-REVISED.md` R6/R7, and its line
> anchors have since gone stale. Each of the three revision files now carries a status
> block at its head saying which of those states it is in; read that block before
> treating any of them as outstanding work.

---

# Part 4 — 2026-08-10: the corrected 9099 rotor profile

Driven by a task brief that supplied the corrected geometry for one ventilation
panel, obtained by repeated render-and-review of a 9099-style rotor AHU. The brief
required that geometry be recorded as **a named profile, not as facts about every
AHU**, and that a machine-readable form and regression tests exist for it.

New evidence: **E4**, a sanitized fixture built from that corrected panel. New scope
tag: `PROFILE-9099-ROTOR-DEMO`.

**The organizing correction of this pass.** Most of the ventilation geometry recorded
before today was stated as though it applied to ventilation panels generally, when in
fact it had been measured on one or two panels. Two production references then
disagreed with each other on dampers, on outdoor temperature and on the circulation
pump — not because either was wrong, but because they are different units. Every
change below either attaches a scope to a coordinate that previously had none, or
corrects a coordinate against newer evidence, or converts a prose rule into a check
that runs.

---

## Rules changed

#### 26. Inlet dampers: two damper families, both production-real (supersedes CLAUDE.md rule 3)

| | |
|---|---|
| **Original** | `CLAUDE.md` §17b.3 rule 3 listed `V3_horis_damper_flow-left_nrm` and `V3_horis_damper_flow-right_nrm` among **eight substituted ids that "appear nowhere in the reference"** — i.e. as evidence of a bad generation. The contract's §5.9 recorded only the recirculation dummies. `AI-BRIEFING.txt` 7a-6 qualified the dummies with "on a unit without recirculation". |
| **Revised** | Both families are production-real and are **not alternatives**. Contract §5.9 split into **§5.9a** (`REF-9099` recirculation dummies, E2 at (28,182) and (30,424)) and **§5.9b** (`PROFILE-9099-ROTOR-DEMO` flow dampers: extract `V3_horis_damper_flow-left_nrm` (75,196) 36×26, fresh-air `V3_horis_damper_flow-right_nrm` (96,438) 36×26). Which family a panel uses is a property of the selected template, not of whether the unit recirculates. Direction follows airflow. `number_v3_dummy_resirc_damp_hor` MUST NOT be substituted for a profile inlet damper. |
| **Reason** | A generic blacklist built from one comparison. Rule 3 recorded what one demo substituted for **one** template and was then read as a global prohibition, which would reject the corrected panel outright. |
| **Source** | E3 carries both flow dampers at (30,195) and (30,438), 36×26. E4 carries the recirculation column **and** both flow dampers — verified this session. The other six substitutions in rule 3 stand. |
| **Status** | **Normative** · §5.9a `REF-9099`, §5.9b `PROFILE-9099-ROTOR-DEMO` |
| **Files** | `CLAUDE.md` (rules 3 and 12), `VENTILATION-GEOMETRY-CONTRACT.md` §5.9a/§5.9b, `AI-BRIEFING.txt` 7a-6, `documentation-rules.json`, validator rule `V-P05` |

#### 27. Damper position values: `con_top` below → `con_down` above, and exactly one per damper

| | |
|---|---|
| **Original** | KA501 as a `con_top` object at (24,218) and KA401 at (25,461), each with a separate `number_v3_label_8px_norm` caption beside it. |
| **Revised** | `number_v3_R_45px_con_down` `KA501 %` at **(71,163)** 46×38 and `KA401 %` at **(93,405)** 46×38, sitting **above** their dampers with the stub pointing down, and **no separate caption** — the value object renders its own tag. Exactly one position value per damper; a second `KA\d{3}` value for the same damper is a defect, not a duplicate to tolerate. |
| **Reason** | The old pair placed the value below the damper and then needed a caption to say what it was. The corrected panel attaches the value to the damper it describes and drops the caption, which also removes two of the free-standing captions flagged by `V-G04`. |
| **Source** | E4, verified this session: both objects present at those coordinates, no companion caption. |
| **Status** | **Normative** · `PROFILE-9099-ROTOR-DEMO` |
| **Files** | contract §5.9b, `documentation-rules.json`, validator `V-P05`/`V-G04`, QA B-stage, tests |

#### 28. Outdoor temperature is not always on the fresh-air duct

| | |
|---|---|
| **Original** | `numberV3_outside_temp` with `RT-90`, placed on the fresh-air inlet at (20,301) — stated without a scope, so readable as a general rule. |
| **Revised** | Placement is **profile-specific**. In `PROFILE-9099-ROTOR-DEMO` it is a fixed information block in the upper-left corner: **(16,17), 79×50, zIndex 110, `RT001 °C`** — deliberately *not* on the duct. E2 places it on the duct; E3 has none at all. The same profile *also* carries a duct-mounted `RT901 °C` at (133,417), so the two are distinct roles and not a relocation of one object. A supplied production export still overrides all of this under rank 1. |
| **Reason** | A single unscoped coordinate for an object whose placement genuinely varies by unit. An agent following it would move a correct block. |
| **Source** | E4 verified this session: `numberV3_outside_temp` (16,17) 79×50 z=110 `RT001 °C`; `number_v3_R_45px_con_down` (133,417) `RT901 °C`. E2 confirms the duct placement for its own panel. |
| **Status** | **Normative** · `PROFILE-9099-ROTOR-DEMO` for (16,17); `REF-9099` for the duct placement |
| **Files** | contract §5.8, `documentation-rules.json`, validator `V-P06`, QA, tests |

#### 29. Five alarm coordinates corrected, and alarm uniqueness re-keyed

| | |
|---|---|
| **Original** | Extract fan (199,160), extract filter (527,108), supply filter (197,352), cooling (457,379), heating/frost (561,377). Uniqueness was checked on `alias_text` alone. |
| **Revised** | Extract fan **(197,160)**, extract filter **(498,106)**, supply filter **(199,352)**, cooling **(458,385)**, heating/frost **(584,378)**; rotor **(294,309)** and supply fan **(843,403)** confirmed unchanged. All seven are `V3_R_34px_circular_alarm_nrm`, 34×34, zIndex 375. Uniqueness is keyed on **(alias, nearest guarded component)**: one alarm per guarded role, clear of the component and of any caption. |
| **Reason** | The old figures came from a screenshot reading of an earlier revision. The re-keying is the more important half: E3 legitimately carries two `Malf. damper` alarms 243 px apart on two different dampers, so keying on the alias alone failed a correct production panel. Keying on the pair still fails two alarms on **one** component, which is the defect the brief asked for. |
| **Source** | E4, all seven verified this session. E3 objects 83/84 at (27,219) and (27,462) for the re-keying. The brief offered "(198,94) *or the exact latest fixture coordinate*" for the extract fan; the fixture coordinate (197,160) was taken, as the brief permits. |
| **Status** | **Normative** · `PROFILE-9099-ROTOR-DEMO` for the coordinates; the uniqueness key is `VENT` |
| **Files** | contract §5.1/§5.3/§5.4/§5.5/§5.6/§10.1/§10.2, `documentation-rules.json`, validator `V-G05`, QA B14, `AI-BRIEFING.txt` 7a-8, tests |

#### 30. The LV402 run-status LED: variant and position resolved

| | |
|---|---|
| **Original** | "13×13 at (700,466), variant unknown" — tagged `SCREENSHOT`, with the variant recorded as an open question. |
| **Revised** | `V3_led_13px_circ_grey_green` at **(703,460)**, 13×13, zIndex 375 — offset **(+6,+47)** from the `number_v3_el_heater` anchor `LV402` at (697,413), 40×85. The LED MUST sit fully inside the heater body and MUST NOT cover the tag or the output value. |
| **Reason** | An unresolved variant means an agent picks one, and the old position put the LED 6 px lower, at the edge of the body. |
| **Source** | E4, verified this session. |
| **Status** | **Normative** · `PROFILE-9099-ROTOR-DEMO` |
| **Files** | contract §9.1, QA C9, `documentation-rules.json`, validator `V-P07`, tests |

#### 31. Rendered-glyph width is an estimate, so no rule may fail a panel on one (supersedes revision spec R9)

| | |
|---|---|
| **Original** | `AI-BRIEFING-REVISED.txt` **R9** specified a QA check that **fails** a panel whose sidebar caption is off-centre by more than **±2 px**, computed from screenshot-read widths of 32 px for `Tilluft` and 40 px for `Avtrekk`. The QA checklist carried the same ±2 px tolerance as a pass/fail criterion. |
| **Revised** | The centring **formula is kept**; the tolerance became validator rule **`V-P08`, reported as a WARNING and never as an error**. The two widths are now labelled estimates wherever they appear. |
| **Reason** | The two figures are screenshot readings and Arial at 11 px gives 26 and 37 instead. Production renders `A-Alarm` and `B-Alarm` on a fixed 45 px pitch at x 1305 and x 1350, byte-identical across E1, E2 and E4 on two different plants, which caps `A-Alarm` near 41 px — so the pitch is fixed and the caption width is not what positions it. A rule that fails a panel on an estimated glyph width will reject correct panels, and the validator is deliberately dependency-free (no PIL, no fontTools), so it cannot measure text properly. |
| **Source** | E1/E2/E4 sidebar rows; Arial 11 px metrics. |
| **Status** | **Advisory** — warning only · `PROFILE-9099-ROTOR-DEMO` |
| **Files** | contract §7.2 and §12.1 item 6, QA C7, `AI-BRIEFING.txt` 7a-4, `AI-AGENT-INSTRUCTIONS.txt`, validator `V-P08`, `open_evidence[0]` in `documentation-rules.json` |

#### 32. The circulation-pump variant is disputed, and recorded as disputed

| | |
|---|---|
| **Original** | Contract §5.6 and `AI-BRIEFING.txt` §7a-3 both specified `V3_21px_single_pump_grey_green_up`, stated as settled. |
| **Revised** | The brief and E4 use `V3_21px_single_pump_grey_green_**down**` at (601,527), 21×21, offset (+18,+114) from the `LV401` anchor at (583,413). Both variants are palette-valid at the same size. `_down` wins for this profile under precedence rank 1, and **the dispute is stated rather than silently resolved** — contract §12.1 item 3, `AI-BRIEFING.txt` 7a-3, and a flag on `CLAUDE.md` rule 12. |
| **Reason** | E2 and E3 both use `_up`; two production panels against one corrected panel is not enough to overturn either, and picking one silently would hide that from the next agent. |
| **Source** | E4 verified this session: `V3_21px_single_pump_grey_green_down` (601,527) 21×21 tag `JP410`. E2/E3 carry `_up`. |
| **Status** | **Normative for this profile**, open in general · `PROFILE-9099-ROTOR-DEMO` |
| **Files** | contract §5.6/§12.1, `AI-BRIEFING.txt` 7a-3, `CLAUDE.md` rule 12, `documentation-rules.json` |

#### 33. Water-heating and electric-heating clusters are atomic

| | |
|---|---|
| **Original** | Cluster members were listed as component inventory, with no rule that a partial cluster is a defect. |
| **Revised** | Every component is an **atomic cluster** — an anchor, its members, and each member's offset from that anchor — and a cluster is relocated by applying one translation vector to every member. Concretely for this profile: `SB510 %` (`number_v3_R_45px_con_left`, (620,570), offset (+37,+157) from `LV401`) requires **both** the circulation pump (601,527) and the 3-way valve `v3_3w_valve_right_down_nrm` (602,572), and a panel carrying the value without them **fails cluster integrity**. Same for fan, filter, rotor, cooling, electric-heater and bypass clusters. |
| **Reason** | The most common generated defect was a plausible-looking value with no mechanism behind it. Stating members as an inventory does not catch that; stating them as a cluster with a completeness rule does. |
| **Source** | E4, all three objects verified this session at the stated coordinates. |
| **Status** | **Normative** · cluster model `VENT`; the offsets `PROFILE-9099-ROTOR-DEMO` |
| **Files** | contract §5 and §9, `VENTILATION-AUTHORING-GUIDE.md`, `documentation-rules.json` → `profiles.PROFILE-9099-ROTOR-DEMO.clusters`, validator `V-P01`–`V-P04`, QA, tests |

#### 34. Bypass: never shorten the duct to clear the damper

| | |
|---|---|
| **Original** | Covered only by the general overlap exceptions (change 16). |
| **Revised** | Stated as its own rule wherever the bypass is described: the vertical duct stays **continuous** and the damper **overlays** it. Shortening a duct to clear a damper is a defect. |
| **Reason** | It is the specific failure the overlap exception exists to prevent, and it kept recurring while it was only implicit. |
| **Source** | E1 bypass column: an unbroken run y211→y449 under a 40×40 damper. |
| **Status** | **Normative** · `VENT` |
| **Files** | contract §5.7, `AI-BRIEFING.txt` §5, authoring guide, preflight §6, QA |

#### 35. Two production quirks that MUST NOT be "fixed"

| | |
|---|---|
| **Original** | Duplicate-value detection was stated generally, and a blank `tag_text` was treated as an omission. |
| **Revised** | Two documented exceptions. **(a)** `SB520 %` appears **twice** in E4 — once as the cooling output, once as the electric-heater output, with different `alias_text`. Duplicate-value detection is therefore scoped to `KA\d{3}` position codes only. **(b)** Room-endpoint value objects carry a **single-space** `tag_text` on purpose, with adjacent `number_v3_label_8px_norm` captions supplying `RP501 ppm` and `RT600 °C`. |
| **Reason** | Both look like defects to a naive checker and are not. Without this, a validator "fixes" a correct production panel. |
| **Source** | E4. |
| **Status** | **Normative** · `VENT` |
| **Files** | contract §5.5, authoring-guide failure catalogue, QA stage 0, `AI-BRIEFING.txt` 7a-9 "NOT A DEFECT" list, validator |

#### 36. Sidebar sections are built exactly once

| | |
|---|---|
| **Original** | Header size and row pitch were specified; nothing said a section may not be emitted twice. |
| **Revised** | Each section is built **once**: no duplicate row label, no duplicate value object, no two objects at the same coordinate, no label colliding with `Tilluft` or `Avtrekk`. Header bars stay **250×20 at x 1150**. Where a separate row label already names the signal, the value object MUST be `number_v3_60px_dark_no_conn_no_tag` so it renders no second caption. |
| **Reason** | Re-emitting a section is the most common sidebar defect and produced most of the duplicate captions seen in review. |
| **Source** | E1/E2/E4 sidebars. E3's three stacked `sub_page_link_btn_*` at y 629 are production copy-paste debris, which is why coordinate collisions are an **error on a generated demo and a warning on a production export** (change 39). |
| **Status** | **Normative** · `VENT` |
| **Files** | contract §7, QA, `documentation-rules.json`, validator `V-G06`, tests |

---

## Rules made executable

The prose rules above were also written as code. `documentation-rules.json` gained a
`profiles` block, and `validate-ventilation-panel.py` was added to run it.

| Rule id | Checks | Scope |
|---|---|---|
| `V-S*` | Structural: 17 fields, `counts` vs array lengths, sequential `object_0..N`, integer pixels, canvas bounds, z-band purity, empty `containers`/`graphics`, no `image_svg` | global |
| `V-G*` | Relationships: connector attachment, free-standing captions, alarm-per-role, coordinate collisions, cluster completeness | global |
| `V-P*` | Profile geometry: cluster anchors and offsets, damper family and position values, outdoor-temperature block, LED containment, caption centring | only when `--profile` selects a profile |

Three scoping decisions worth recording, because each was made **after** running the
checks against real production exports and finding them wrong:

#### 37. `V-S08` withdrawn — "linked is true but driver_id is empty" is not a defect

| | |
|---|---|
| **Original** | A candidate check asserting that a `linked="true"` object must carry a non-empty `driver_id`. |
| **Revised** | **Removed**, with the reason recorded in the validator docstring so it is not re-added. |
| **Reason** | It produced **45 errors on E2 and 37 on E3** — every one a correct production object. The host sets `linked="true"` whenever `driver_id !== "driver_id"` (`V3scripts.js:514`), and an **empty** `driver_id` is not the placeholder, so production exports legitimately carry linked-but-empty objects. My inference was simply wrong about the host. |
| **Source** | E2: 45 linked-with-empty vs 57 linked-with-real. E3: 37 vs 55. |
| **Status** | Withdrawn |

Two further candidate checks were rejected the same way and are recorded as rejected:
`driver_id` is **not** always plant-prefixed (E3's navigation objects carry `"1"`,
`"3"`, `"6"` and a pdf path), and `unit_ref` being empty on two samples is not a rule.

#### 38. The demo/production discriminator

| | |
|---|---|
| **Revised** | `detect_mode()` classifies a panel by one signal: a generated demo emits the literal `"driver_id"` placeholder on **every** object; a production export **never** does. |
| **Reason** | Several checks must be errors on a generated panel and warnings on a production one. That needs a reliable discriminator, not a guess. |
| **Source** | **0 placeholders across 194 production objects; 97 across 97 demo objects.** A total split, not a heuristic. |
| **Status** | **Normative** · global |

#### 39. Severity by mode, for three relationship rules

| | |
|---|---|
| **Original** | `V-G04` (free-standing caption), `V-G05` (alarm uniqueness) and `V-G06` (coordinate collision) fired as errors on every panel. |
| **Revised** | Error on a generated demo, **warning** on a production export. `V-G07` (cluster completeness) is profile-scoped and does not run without `--profile`. |
| **Reason** | Together with change 37, the unscoped forms produced **495 errors on E2 and 96 on E3** — both correct production panels. A validator that fails its own reference data teaches an agent to ignore it. |
| **Source** | E2, E3. Both now report **0 errors**. |
| **Status** | **Normative** · global |

#### 40. Two mechanical traps recorded in the validator

`parseInt` semantics — the host parses geometry with `parseInt`, so `"120px"` → 120
and `"196.5"` → 196. `as_int()`/`px()` mirror the host exactly; `is_integer_px()` is
deliberately **stricter**, because the contract requires integer pixels even where the
host would tolerate a fraction. A `ValueError` on `"196.5"` was fixed by adding `px()`,
not by weakening the test.

Label-overlap tolerance — `LABEL_OVERLAP_TOLERANCE = 3` px, because a 1 px overlap
between `object_22` and the `Cool` caption in E2 was an artifact of an **estimated**
label height. Same principle as change 31: never fail a panel on an estimated glyph
extent.

**Rule-id numbering.** There is **no `V-G01`** — the id was never issued. The gap is
deliberate and documented in contract §0.3; do not renumber to close it.

---

## Files added or replaced

| # | File | Change | Status |
|---|---|---|---|
| 41 | [tests/fixtures/ventilation-9099-rotor-demo.json](tests/fixtures/ventilation-9099-rotor-demo.json) | **New.** The sanitized canonical fixture (E4): 97 objects, 43 distinct `obj_id`s, 13 `°` tags. Verified this session: **0 objects carry a non-placeholder binding**, `source_plant_id` and `plant_id` both empty, `id` and `driver_id` the literal `"driver_id"` throughout, `linked` false. No real driver ids, unit ids, personal metadata or live plant bindings. | **Normative** · `PROFILE-9099-ROTOR-DEMO` |
| 42 | `validate-ventilation-panel.py` | **New.** Dependency-free (no PIL, no fontTools) — it deliberately cannot measure text, which is why every width-dependent finding is a warning. Accepts both the committed `{_note, envelope}` wrapper and a flat live export via `envelope_of()`. | **Normative** |
| 43 | [tests/test_ventilation_profile_9099.py](tests/test_ventilation_profile_9099.py) | **New.** 47 tests covering the brief's 14 required regression conditions, plus paired negative tests — e.g. two alarms on **one** component still fail, which is what proves change 29's re-keying did not simply disable the check. Python `unittest`, the existing convention. | **Normative** |
| 44 | [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) | **Refactored**, 657 → 1037 lines. Reorganized by profile and by atomic cluster; the 8-rank precedence list moved to the front matter; §0 profile registry; §12.1 seven open items and §12.2 four items closed by E4; §13 scope summary. **No existing evidence or measurement was deleted** — the brief forbade shortening by deletion, so superseded figures are retained with their supersession noted. | **Normative** |
| 45 | [VENTILATION-AUTHORING-GUIDE.md](VENTILATION-AUTHORING-GUIDE.md) | **New**, ~380 lines. The procedure: select a profile, place clusters, attach values, verify. Carries the decision table (rotor vs plate recovery, bypass present or absent, water heating present or absent, electric heater present or absent, one vs two sidebar value columns, navigation target known or unknown) and the failure catalogue. | **Normative** |
| 46 | [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) | **Extended**, 273 → ~400 lines. New **Stage 0** (checks 0.1–0.9) runs before Stage A. C9 corrected for the LED (change 30); C7's ±2 px tolerance demoted to a warning (change 31). | **Normative** |
| 47 | [documentation-rules.json](documentation-rules.json) | **Extended** with `profiles.PROFILE-9099-ROTOR-DEMO` — anchors, members, offsets, object ids, connector relationships, required and optional roles — plus `open_evidence`. | **Normative** (prose still wins on conflict) |
| 48 | [VENTILATION-COPILOT-PREFLIGHT.md](VENTILATION-COPILOT-PREFLIGHT.md) | **New.** The embeddable preflight block: **exactly 80 lines, 5 071 characters, 5 151 worst-case CRLF, zero `<` or `>`**. Written to be pasted whole into a Copilot system prompt or attached as a knowledge file. | **Normative** |

---

## The three revision specifications

#### 49. `AI-BRIEFING-REVISED.txt` — R1–R14 fully applied

All fourteen revisions are now present in `AI-BRIEFING.txt`, including **R14**, which
split §9's flat 11-item self-check into four blocks — EVERY PANEL, LIST PANELS (7c)
ONLY, VENTILASJON (7a) ONLY, EVERY PANEL LAST — because the flat list made an agent
building a Maskin panel read ventilation checks and vice versa. Every original check
was preserved and redistributed; none was dropped.

**Two items were applied in corrected form**, and the file now says so at its head so
that no future agent "restores" the specification text:

- **R2** specifies a **seven**-rank precedence list that omits
  `VENTILATION-GEOMETRY-CONTRACT.md` entirely. The canonical list is **eight** ranks.
  Applied as eight, with R2's consequence bullet renumbered from "rank 6 loses to
  rank 2" to rank 7 to match.
- **R9** is change 31 above.

**Three changes were applied that the specification does not contain**: the
connector-direction table in 7a-2, the circulation-pump dispute in 7a-3 (change 32),
and the correction of 7a-6's "on a unit without recirculation" qualifier (change 26).

#### 50. `CLAUDE-REVISED.md` — R7 deliberately **not** applied

R7 would replace `CLAUDE.md` lines 398–491 with a twelve-rule disposition table
(rules 1/2/4/6/6b/7 MOVE→contract, 9/10/11 MOVE→QA checklist, 3/5/8 SPLIT, 12
KEEP-rewritten). It was **not applied**, for two reasons: its line anchors are stale
after this session's edits to `CLAUDE.md`, and the destination documents it
presupposes now exist in a different shape. The targeted contradiction it was meant to
fix was applied to `CLAUDE.md` **directly** instead (changes 51–53). The file now
carries a status block saying it is a proposal, not outstanding work.

#### 51. `AI-AGENT-INSTRUCTIONS.txt` replaced; the REVISED file reduced to a stub

The revision was measured before acting rather than after: current file 7 998
worst-case characters over 25 lines, revision 7 976 over 33, 40 diff lines. The
revision is a genuine superset — it **adds** PRECEDENCE, TEXT ALIGNMENT, VENTILASJON
and VENT OVERLAP blocks and tightens six others **without dropping a rule** — so it
was applied rather than merely marked.

Applied through a script that asserts its own preconditions: five anchored
single-occurrence replacements each guarded against a missing anchor, an assertion
that no `<` or `>` survives, an assertion that the worst case stays under 8 000, and a
CRLF write. Two of the five replacements are the corrections from changes 31 and 49
(eight ranks, and widths marked as estimates); three are cosmetic contractions to stay
under the cap. **Result: 7 958 characters LF, 7 991 worst case, 33 lines — nine
characters of headroom.**

`AI-AGENT-INSTRUCTIONS-REVISED.txt` was then reduced to a 2 490-byte stub. Keeping the
applied text in two places would guarantee drift, and the stub is shaped so it cannot
be mistaken for pasteable content: it says what was applied, records the two
corrections, and states the field's limits — 8 000 **characters** not bytes, one extra
character per line from CRLF, and the rejection of `<` and `>` — with the measuring
command inline.

#### 52–53. `CLAUDE.md` §17b.3 — three edits

| | |
|---|---|
| **52** | Rules 3 and 12 corrected for the damper finding — change 26. Rule 12 also now flags the pump-variant dispute — change 32. |
| **53** | The intro sentence **"This is the authoritative implementation and QA contract"** was **deleted**. It was true when written and false once the contract, guide, checklist and validator existed. Replaced with a five-row routing table naming which document owns a coordinate, a procedure, an acceptance test, the machine-readable form, and the Copilot block. The measurements below it are retained **unedited** as the record of what was seen in the 9099 export on 2026-08-09; where one disagrees with the contract, **the contract wins**, because it carries the newer evidence and the scope tag saying which panels the number applies to. |

---

### Findings from the verification pass (54–56)

These three came out of actually rendering the fixture and measuring it, rather than
out of the brief. They are recorded here because a later agent re-running the same
render will meet all three and needs to know which are defects.

#### 54. The `KA401 %` / `RT901 °C` overlap — OPEN, deliberately unresolved

| | |
|---|---|
| **Measured** | `KA401 %` occupies x 93–139, y 405–443; `RT901 °C` occupies x 133–179, y 417–455. They share a **6 × 26 px** rectangle and their rendered glyphs come within **≈ 1 px**. Both are `number_v3_R_45px_con_down`, so neither box is oversized. |
| **Not a production quirk** | E2 carries `RT901 °C` at exactly (133, 417) — the same coordinate — but places `KA401 %` at **(25, 461)** as a `con_top` box, nowhere near it. The overlap was **created by change 27**, which moved `KA401 %` to (93, 405) per the corrected profile while the duct temperature stayed where production has it. |
| **Why nothing was changed** | Resolving it means inventing a coordinate for one of two objects that each rest on evidence: `KA401 %` from the task brief at rank 1, `RT901 °C` from E2 at rank 2. Precedence adjudicates conflicting claims about *one* object; it says nothing about two different objects that happen to collide. The brief's own rule applies — mark the gap, do not invent geometry. |
| **Status** | Recorded as an OPEN note in contract §5.9b and pinned by `MeasuredToleranceTest`, which fails if either coordinate moves **or** if the overlap changes size. Whoever next sees the real 9099 panel should read off the true placement and supersede the note. |
| **Files** | `VENTILATION-GEOMETRY-CONTRACT.md` §5.9b, `tests/test_ventilation_profile_9099.py` |

#### 55. The extract-fan alarm's 15 × 2 px overlap is **not** a defect

| | |
|---|---|
| **Measured** | The extract-fan alarm (197, 160, 34 × 34) overlaps the `RF501 m3/h` box (150, 140, 62 × 22) by 15 × 2 px at one corner. |
| **Verdict** | Not a defect. `RF501 m3/h` is `number_v3_R_60px_no_conn_tag_up_center`, so its tag renders **above** its own box; the shared sliver contains no glyphs, and the alarm carries no text. The rule is "clear of tags and values" (change 29) — clear of *text*, not of bounding boxes, which the four intentional overlap classes in contract §11 already establish. |
| **Note** | The brief gave this alarm as "(198, 94) *or the exact latest fixture coordinate*". The fixture has (197, 160); the permission clause covers taking the fixture value, as recorded in change 29. |

#### 56. `render-ventilation-panel.py` cannot place connector text, and now says so

| | |
|---|---|
| **Original** | The renderer drew every tag at its box's top-left. |
| **Problem found** | That is right for a plain label and wrong for two families. `KA502 %` looked occluded by the recirculation dummy when it is correct — intentional overlap class 2, the `con_left` stub landing on its target. The `_tag_up_center` family was drawn inside its box when the id says the tag renders above it, which is what made finding 55 look like a collision. |
| **Revised** | `text_placement()` applies what the `obj_id` actually states: `_tag_up_center` renders above the box, centred, and is **exact**. The `con_*` families are centred and drawn **brown**, flagged as approximate, because the side is readable from the name but the stub width is recorded nowhere in this repository. The legend counts them — 18 of 52 tags in the fixture. |
| **Why not just measure the inset** | It is not in the catalogue, the exports or the screenshots. Guessing it would make the preview look authoritative while being wrong, which is the failure this contract exists to prevent. A flagged approximation is honest; an invented offset is not. |
| **Effect on the verification result** | With the correction, the fixture renders with **zero glyph overlaps** and **zero** exactly-placed pairs closer than 4 px. The single sub-4 px pair is change 54's, and it involves approximate placement — which is why it is reported as open rather than as a pass. |
| **Files** | `render-ventilation-panel.py`, `VENTILATION-QA-CHECKLIST.md` C1 |

---

## What this pass deliberately did not do

- **Did not delete technical facts to shorten anything.** Superseded measurements are
  retained with their supersession recorded, per the brief.
- **Did not invent an `obj_id`, coordinate, driver id, unit id, alias, file path or
  navigation target.** Where evidence was missing it became an open item in contract
  §12.1 (seven of them) rather than a number.
- **Did not universalize the profile.** Every coordinate from this brief carries
  `PROFILE-9099-ROTOR-DEMO`. `VENT` was used only for rules that hold for any
  ventilation panel: the cluster model, connector attachment, alarm-per-role,
  sidebar-built-once, and the two production quirks in change 35.
- **Did not resolve the circulation-pump variant.** Two production panels say `_up`,
  the corrected panel says `_down`; the profile records `_down` and the dispute stays
  open (change 32).

---

# Part 5 — 2026-08-10: the list panel generation contract

A separate pass, with its own brief and its own evidence. It does not touch any
ventilation rule. Finding ids are `L-1`–`L-16` and refer to the conflict table in
[LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md) §16.1.

Evidence: **E5**–**E8** in the table at the head of this file. Two of the four
are uncommitted (live plant id, customer data), so every measurement below is
reproduced in the contract and in `documentation-rules.json`, which are committed.

**Source precedence used**, highest first: the export supplied with the task
(E5) → a production export of the same panel type (E6) → panel-specific rules in
`CLAUDE.md` → `AI-BRIEFING.txt` → `PANEL-TYPE-GUIDE.md` → `DESIGN-OBJECT-CATALOG.md`.
Where E5 and E6 agree, the rule is tagged `LIST`. Where only one shows a value, it
is `TEMPLATE-SPECIFIC`. No coordinate was averaged.

**One substitution, disclosed.** The brief named
`iwmac-panel_5295_360-001-spjeldliste_20260810-0852.json`. No file of that name
exists anywhere under `C:\Users\Thomas`. `iwmac-panel_5295_360-001-spjeldliste_ny.json`
is the same plant, the same panel, and `exported_at 2026-08-10T06:52:20.942Z` — the
same export, saved under a different name. The brief asks for "any user-supplied
production spjeldliste export, especially" that one, so the stop condition does not
fire. It is recorded as E5 with the substitution noted in
`documentation-rules.json` → `evidence.E5.substitution_disclosure`.

**One provenance caveat.** E5 reports `generator "IWMAC Designer Helper"` and
`saved_by "copilot"`. The userscript emits `generator "IWDIE v<version>"`, so E5
was written by an agent in Insert format, not by the Designer. It keeps precedence
rank 1 as the export supplied with the task, but it is weaker than E6 as evidence
of what production looks like. Every rule tagged `LIST` is confirmed by both.

---

## Rules changed

### 57. `AI-BRIEFING.txt` §7c — the list-panel section rewritten

| | |
|---|---|
| **Original** | A short paragraph describing the spjeldliste as an example of an unusual panel, with partial geometry and no container schema. |
| **Problem found** | It was the only list-panel documentation, it was incomplete, and what it did contain duplicated rules that now have an owner. An agent reading only this file could not build a valid container. |
| **Revised** | Rewritten as a normative summary that names [LIST-PANEL-GENERATION-CONTRACT.md](LIST-PANEL-GENERATION-CONTRACT.md) as owner, then carries enough detail to work standalone: the scaffold object set with geometry, the container template in full, the divider-height formula, the column x table, the binding contract, and the four request classes. |
| **Reason** | The brief asks for one owner per rule and summaries elsewhere — not deletion. `AI-BRIEFING.txt` is pasted into environments where the contract is not available, so the fallback detail stays. |
| **Source** | E5 + E6. |
| **Files** | `AI-BRIEFING.txt` §7c, plus the routing table at §0 and the self-check list at the end. |
| **Status** | **Normative** · LIST |

### 58. `PANEL-TYPE-GUIDE.md` — list panels classified

| | |
|---|---|
| **Original** | The guide covered the 41-plant survey's panel families. List panels were mentioned in passing and not classified. |
| **Revised** | A new section places list panels as the second container-built family, distinguishes the spjeldliste from other long tabular listings, and points at the contract for generation. It states plainly that the survey did not cover them, so they carry no fleet statistics — their evidence is two exports. |
| **Reason** | A reader choosing a panel type needs to know that a list is not a table-style blank panel and is not built the same way. |
| **Source** | E5 + E6; the survey's own scope. |
| **Files** | `PANEL-TYPE-GUIDE.md` |
| **Status** | **Normative** · LIST |

### 59. `CLAUDE.md` — host behaviour for containers, and Gotcha #25 extended

| | |
|---|---|
| **Added** | A host-behaviour note stating what the Designer does with containers — the collector, the `unique_id.indexOf("custom_")` route in `load_new_ver_containers`, and the empty `.template()` branch a non-`custom_` container falls into — and referring generation to the contract. |
| **Extended** | Gotcha #25 now records the divider-height formula and that horizontal overflow is structural, not a defect. |
| **Reason** | The importer gate is a host fact, not a generation rule: a container whose `unique_id` lacks the `custom_` prefix is dropped **silently**, with no error and no visible object. That belongs in the host document, and it is the single most expensive thing to rediscover. |
| **Source** | The mirrored Designer sources; confirmed against both exports, where all 233 containers use `custom_<i>`. |
| **Files** | `CLAUDE.md` §6a, Gotcha #25 |
| **Status** | **Normative** · LIST |

### 60. `DESIGN-OBJECT-CATALOG.md` — list panel object set, added through the generator

| | |
|---|---|
| **Added** | A "List panel object set (spjeldliste)" row to the object-set table: the seven `obj_id`s a list panel uses, in emission order, with what each one is for. |
| **How** | Through `build-object-catalog.py`, **not** by hand. The catalogue header says it is generated; a hand edit would be overwritten on the next rebuild and would silently disagree with the generator in the meantime. |
| **Reason** | The brief permits the entry only if the generation process supports it. It does — object sets are a hand-curated list inside the generator, and the counts beside each id are computed from the palette. |
| **Source** | E5 + E6 for the set; the palette for the counts. |
| **Files** | `build-object-catalog.py`, `DESIGN-OBJECT-CATALOG.md` (regenerated) |
| **Status** | **Normative** · LIST |

### 61. `documentation-rules.json` — `panel_types.list_panel`

| | |
|---|---|
| **Added** | `panel_types.list_panel` with sixteen blocks — `identity`, `owner_document`, `canvas`, `background`, `composition`, `z_indexes`, `containers`, `columns`, `geometry`, `groups`, `sides`, `bindings`, `artefacts`, `required_roles`, `qa`, `evidence_required` — mirroring the shape of `panel_types.ventilation`. Evidence ids **E5**–**E8**. Scope tags `LIST` and `TEMPLATE-SPECIFIC`. `global_invariants.container_fields` and `container_field_count` (16). `source_precedence` rank 3 now names both geometry contracts instead of only the ventilation one. |
| **How** | Every geometry value was **derived from the exports at write time** by a script that asserts agreement between E5 and E6 before emitting, rather than transcribed from the contract prose. Four of the assertions would have failed on the contract's first-draft values; see changes 65–68. |
| **Reason** | The brief asks for machine-readable list-panel invariants if the schema supports them. It does: `panel_types` and `evidence` are open maps, and the file round-trips byte-exactly through `json.dumps(ensure_ascii=False, indent=2)`, so a scripted rewrite cannot reflow the ventilation content. |
| **Verification** | The ventilation block, the profiles block and evidence E1–E4 compare equal before and after. The file is CRLF, no BOM, and Norwegian characters survive as UTF-8. |
| **Files** | `documentation-rules.json` (+646 / −6 lines from this pass alone) |
| **Status** | **Normative** · LIST |

### 62. `AI-BRIEFING-REVISED.txt` — deliberately not applied

| | |
|---|---|
| **Action** | None. |
| **Reason** | Line 4 reads `STATUS AS OF 2026-08-10: FULLY APPLIED. DO NOT APPLY IT AGAIN.` The brief instructs the same. Re-applying it would have reverted change 57. |
| **Status** | No change |

---

## The unlinked-object conflict, and why the GLOBAL rule was scoped rather than followed

`global_invariants.unlinked_demo_contract` says an unlinked generated panel must
carry `linked "false"`, `link_name ""` and `driver_id "driver_id"`. Every object
in both list exports carries `linked "true"`, `link_name "link_name"` and
`driver_id ""` — 1 319 of 1 319, including the banner, the column headers and the
dividers, which cannot be bound to anything.

Following the GLOBAL rule would make a generated list panel differ from every
existing one in **every object**, which destroys role-based diffing — the one
technique that makes a list panel reviewable at all.

The rule exists to stop an agent shipping a panel that *looks* linked and is not.
That danger lives in the invented identifier, not in the flag. So the resolution
keeps the guarantee and changes the mechanism:

> A generated list panel must contain no non-empty `driver_id`, `unit_id` or
> `alias_text` other than values copied verbatim from supplied data.

Empty is the unlinked state in a list panel. `"false"` is not required and is not
observed. `unlinked_demo_contract` now carries a `scope_exception` naming
`panel_types.list_panel.bindings` as its override for this panel type; the
ventilation rule is unchanged. Recorded as L-13.

---

## Conflicts resolved (L-1 – L-11)

Each row is a claim that existed in the documentation, or that the shape of the
data invited, and what the exports actually show. Full detail, with section
references, in the contract §16.1.

| id | Claim | Measured | Winning source |
|---|---|---|---|
| L-1 | Banner `zIndex` is `"155"` | `"5"`. `"155"` belongs to the 11 px half-table divider at x 790 | E5 + E6 |
| L-2 | Live-cell x is roughly 540 / 600 / 700 | 530 / 609 / 698 left, 1 319 / 1 398 / 1 494 right | E5 + E6 |
| L-3 | Production leaves the three value columns for later hand-linking | E5 populates and links all three — 78 live cells | E5, rank 1 |
| L-4 | The right half is the left half at +780 | +780 for `damper_tag` only; +789 for the other six headers. Cell offsets 786 / 792 / 789 / 789 / 789 / 789 / 796 | E5 + E6 |
| L-5 | Dividers are "mirrored" on the right | Exactly +789, all six | E5 + E6 |
| L-6 | 400-series left, 500-series right | Right is 5-series only; left is 4-series, 6-series and unnumbered, with 6-series about 70 % of E6's left column | E5 + E6 |
| L-7 | Both halves share the same row band | False. Right-half rows mostly sit in their own containers below the left block — 1–2 mixed containers per file | E5 + E6 |
| L-8 | Supply-side left, extract-side right | Contradicted: every right-half alias in E5 names *tilluft* (supply) | E5 |
| L-9 | Right-half `Romnr.` x undocumented | Header 1 048, cell 1 031. The cell is E6-only, so `TEMPLATE-SPECIFIC` | E5 + E6 |
| L-10 | "One stripe per group" | Sound as a generation rule, but production does not follow it — see change 63 | E5 + E6 |
| L-11 | The four half-table title labels carry titles | `tag_text` is `" "` in all eight instances across both files | E5 + E6 |

### 63. The group stripe is not a group marker

| | |
|---|---|
| **Original** | The stripe placement rule was stated as `stripe_top = group_first_row_top - 2`, one per group. |
| **Problem found** | The formula is right wherever a stripe exists, but the premise is not. E6 has 21 groups and 17 stripe positions: 15 group starts are striped, **6 are not**, and **2 stripes sit inside a group** (y 3 144 and 3 164 — the second and third rows of the group starting at 3 126). E5 has 2 groups and stripes only the first. So `stripe ⇔ group start` fails in both directions. |
| **Also measured** | Every stripe position carries **exactly 14 stacked identical copies** — 14 at one y in E5, 238 at 17 distinct y in E6. Only one is visible. |
| **Best predicate tried** | "The row's damper tag ends in `SQ40x`" matches 16 of the 17 striped rows — and also 6 unstriped rows. Not the rule. |
| **Revised** | The stripe is documented as an **author-applied row highlight** whose placement is not derivable from the export. The generation rule stays `one per group at group_first_row_top - 2`, explicitly tagged `ADVISORY`, and emits **one** copy, not fourteen. When modifying a supplied export the stripes are left exactly as they are, duplicates and skips included. |
| **Source** | E5 + E6. |
| **Files** | contract §8.7, §11.2, §16.2; `documentation-rules.json` → `panel_types.list_panel.groups.stripe` |
| **Status** | **Advisory** for generation · `LIST` for the measurement |

### 64. Blank cells — production does both, so the rule is advisory and checkable

| | |
|---|---|
| **Problem found** | The brief asks which missing source fields may be left blank. Production does not answer consistently: E6 **omits** the `room` cell entirely in 31 of 185 left rows and E5 in 2 of 21, while 5 E6 rows and 2 E5 rows carry a `room` cell with blank text. Nothing in the data predicts which. |
| **Revised** | Generated output **keeps the object and sets `tag_text ""`**, so every row carries the same role set. |
| **Reason** | It is the only one of the two behaviours that can be checked mechanically — validation check 16 asserts an identical item-role set across containers — and it keeps role-based diffing usable. Stated as `ADVISORY` with the production split disclosed, not as a discovered rule. |
| **Source** | E5 + E6. |
| **Files** | contract §2.4, §12 check 16 |
| **Status** | **Advisory** · LIST |

---

## Five defects in this contract's own first draft (L-12 – L-16)

These were not found in the existing documentation. They were written **into the
new contract** from schema intuition, and caught before commit — the first four
by re-measuring the exports while mirroring the values into
`documentation-rules.json`, the fifth by running the new test suite (change 70)
against the result. Three had already been copied into `AI-BRIEFING.txt` §7c,
where they would have read as production evidence.

All five are the same failure: writing what the schema ought to say instead of
reading what the export does say.

### 65. L-12 — the container constants

| | |
|---|---|
| **Written** | `"id": 0` (the row index), `"linked": "false"`, `"linked_to": ""`, `"title": ""`. |
| **Measured** | `"id": "objects_container"` — a constant string on every row, neither the row index nor the object-level `id` sentinel `"driver_id"`. `"linked"` and `"linked_to"` are the **strings** `"0"`. `"title"` is `"Objects Container"`. 25/25 containers in E5 and 208/208 in E6. |
| **Note** | Only `unique_id` (`custom_<i>`) and `name` (`objects_container_<i>`) carry the row number. `id` does not participate in the sequence. |
| **Files corrected** | `AI-BRIEFING.txt` §7c; contract §3.4, §5.1, §5.3, §12 check 14, both worked examples |

### 66. L-13 — the object constants

| | |
|---|---|
| **Written** | The ventilation unlinked sentinels: `linked "false"`, `link_name ""`, `driver_id "driver_id"`, and a descriptive `alias_text` naming the column. |
| **Measured** | Over 1 319 objects across both exports: `id` is `"driver_id"` (1 319/1 319) · `linked` is `"true"` (1 319/1 319) · `link_name` is `"link_name"` (1 319/1 319) · `sub_group` and `unit_ref` are `""` · `driver_id` is `""` on every unlinked object · `alias_text` is the literal `"new text"` on all 881 unlinked objects · `link_tag` is `""` except `"NA"` on `number_v3_header_appgrey` and `number_v3_header_grey50`, 264/264 of those. |
| **Consequence** | Resolved as described under "The unlinked-object conflict" above, and recorded as a scoped override rather than a change to the GLOBAL rule. |
| **Files corrected** | contract §4.2 (new), §4.3–§4.6, §10.1–§10.5, §11.2, §12 checks 24–26, every JSON example |

### 67. L-14 — the canvas dimensions are strings

| | |
|---|---|
| **Written** | `"panel_width": 1400`, `"panel_height": 750`. |
| **Measured** | The **strings** `"1400px"` and `"750px"`, at envelope level and inside `panel`, in both exports and in the userscript's own Insert-help template. The value is handed to `iw_set_base_image(doc.panel_width, doc.panel_height, …)` unchanged, so a bare number is not a stylistic variant. |
| **Files corrected** | contract §3.1, §3.2, §3.4, §13.1 — six occurrences plus the envelope-field table |

### 68. L-15 — E5's group count

| | |
|---|---|
| **Written** | "E5: 3 groups, sizes 15 / 6 / 4, first-row tops 106 / 506 / 606." |
| **Measured** | **2** groups, sizes 19 and 6, first-row tops 106 and 506. E5's 24 `top` deltas are 23 × 20 and exactly one × 40; 606 is the last row of the second group, not the start of a third. |
| **Found by** | The `documentation-rules.json` generator derives group starts from the delta sequence instead of accepting a written figure, and the group sizes then had to sum to the row count. |
| **Files corrected** | contract §8.6, §8.7, §16.2, evidence table |

### 69. L-16 — the container key order

| | |
|---|---|
| **Written** | `… zIndex, title, items` — `title` placed on the header line, before the item array, in the §5.1 field table and in all seven example containers. |
| **Measured** | The collector emits `… zIndex, items, title`: `title` is a merged custom attribute appended after the item array (`container_tool.js:2254-2262`). 233/233 containers across E5 and E6. |
| **Found by** | `tests/test_list_panel_contract.py` (change 70) — it reads `global_invariants.container_fields` out of `documentation-rules.json` and asserts the contract's own examples match it key for key. |
| **Severity** | The mildest of the five: key order changes no behaviour, because `load_new_ver_containers` reads every field by name. It is recorded anyway — the examples are what an agent copies, and a reordered row defeats the byte-diff against a production export that catches the other four. |
| **Files corrected** | contract §5.1 (table row order + a note naming the collector line), §3.4, §13.1 (four containers), §13.2, §16.1 (new L-16 row), §18 |

### 70. `tests/test_list_panel_contract.py` — the contract made executable

| | |
|---|---|
| **Added** | 44 tests, the executable form of contract §17. Run with `python -m unittest tests.test_list_panel_contract -v` from `iwmac-designer-reference/`. |
| **What it pins** | (1) the measured constants — every threshold comes from `documentation-rules.json` → `panel_types.list_panel`, never from a literal in the test, so a rule and its test cannot drift apart; (2) the contract's own worked examples — the fenced JSON blocks are parsed out of the Markdown and validated against those same rules; (3) the two production exports E5 and E6, including the places where they disagree with the generation rules. |
| **How it reads the contract** | Blocks are keyed by the section heading above them, not by index. Indexing would reintroduce the exact failure mode §6 forbids for objects, and a heading shift would silently test the wrong document. |
| **Stripe rule, both directions** | One test asserts the ADVISORY rule (one stripe per group, no duplicates) on the generated example; a second asserts that E6 does **not** follow it — 6 group starts unstriped, 2 mid-group rows striped, exactly 14 stacked copies per stripe position. A later "correction" of the production fixture now fails instead of passing. |
| **Coverage caveat** | E5 lives outside the repository (live plant id), so its tests **skip** on a clean checkout. A green run there has verified less than a green run on a machine that has the file. |
| **Result** | 44 passed, 0 skipped on the authoring machine. Found L-16 (change 69). |
| **Files** | `tests/test_list_panel_contract.py` (new, LF); contract §17 rewritten as §17.1 Fixtures + §17.2 The executable form |

### 71. `reference_data/real-spjeldliste-example.json` — the `_note` wrapper corrected

| | |
|---|---|
| **Scope** | The prose `_note` only. The `envelope` object is byte-unchanged: still 383 / 208 / 0, still parses, and the test suite still passes against it. |
| **Corrected** | The banner zIndex (given as 155, measured `"5"` — the only `"155"` object in the file is the 11 px centre divider at x 790: finding L-1) and the closing sanitization advice (told generators to emit `driver_id "driver_id"` + `linked "false"`, which is the ventilation contract, not the list-panel one: finding L-13). |
| **Added** | The evidence id E6 and a pointer to `LIST-PANEL-GENERATION-CONTRACT.md` as the owner; the scaffold census with counts; the container-vs-item zIndex type split; the divider-height formula; the object constants measured across all 1171 objects; and the stripe artefact restated as measured (238 objects, 17 distinct tops, 14 copies each, not aligned to the 21 group starts) rather than as "14 per group, use ONE". |
| **Why it mattered** | This file is loaded as knowledge next to the briefing. Its `_note` is the first thing an agent reads about list panels, and two of its statements contradicted the contract built from the same envelope. |

### 72. `AI-BRIEFING.txt` — two surviving L-13 leftovers

| | |
|---|---|
| **Scope** | Two paragraphs that still taught the ventilation unlinked sentinels for **list-panel** cells after L-13 had been corrected in the contract. Found by reading the briefing diff rather than trusting the earlier "§7c rewritten" note (change 57). |
| **§7c, the cell templates** | Said the static and live cells carry "the standard unlinked convention - id `driver_id`, driver_id `driver_id`, linked `false`, link_name ``, link_tag ``", and told the agent to put the damper tag plus the column role into `alias_text`. Replaced with the measured list-panel constants (`id "driver_id"`, `linked "true"`, `link_name "link_name"`, `driver_id ""`, `alias_text "new text"`, 1 319/1 319 objects), the replacement safety rule, and the reason not to write the column role into the alias: 881/881 unlinked cells read `"new text"`, and a human links a placeholder by the row's damper-tag cell. |
| **§8b step 6, "leave uncertain objects unlinked"** | Gave one definition of "unlinked" — `driver_id "driver_id"`, `linked "false"` — inside a linking procedure whose own step 5 names "spjeldliste text cells". Now states both: the ventilation form on a normal panel, and `driver_id ""` with the row template's `linked "true"` left alone in a list panel. |
| **Checked and left alone** | The same sentinels at §7a-7 ("strip the source plant", explicitly the ventilation demo case) and in the Maskin compressor-bank section. Both are correctly scoped to panel types where the GLOBAL rule holds. |
| **Why it mattered** | The contract was right and the file an agent actually receives as knowledge was wrong. A correction applied in one document does not propagate; each copy has to be re-read. This is the same failure as L-12 – L-16, one level up. |
| **Files corrected** | `AI-BRIEFING.txt` §7c cell templates, §8b step 6 |

---

## Files changed in Part 5

| File | Change | Committed before this pass? |
|---|---|---|
| `LIST-PANEL-GENERATION-CONTRACT.md` | **New.** 18 sections, LF line endings. Corrected for L-12 – L-16 before delivery | No — new file |
| `tests/test_list_panel_contract.py` | **New.** 44 tests, LF line endings (change 70) — found L-16 | No — new file |
| `AI-BRIEFING.txt` | §7c rewritten (change 57); §0 routing table and self-check list updated; two surviving L-13 leftovers corrected in §7c and §8b (change 72) | Yes |
| `PANEL-TYPE-GUIDE.md` | List-panel section added (change 58) | Yes |
| `CLAUDE.md` | §6a host-behaviour note; Gotcha #25 extended (change 59) | Yes |
| `build-object-catalog.py` | List panel object set added to the generator (change 60) | Yes |
| `DESIGN-OBJECT-CATALOG.md` | Regenerated from the above — not hand-edited | Yes |
| `documentation-rules.json` | `panel_types.list_panel`, evidence E5–E8, two scope tags, container invariants, precedence rank 3 (change 61); `qa.test_file` / `test_command` (change 70) | Yes |
| `reference_data/real-spjeldliste-example.json` | `_note` prose corrected (change 71). **Envelope untouched** | Yes |
| `documentation-change-log.md` | This part | Yes |
| `AI-BRIEFING-REVISED.txt` | **Untouched**, deliberately (change 62) | Yes |

The working tree also carries substantial uncommitted **ventilation** work from
Parts 1–4 that predates this pass. Nothing in Part 5 touches it.

---

## What Part 5 deliberately did not do

- **Did not invent an `obj_id`, coordinate, driver id, unit id, alias, plant id or
  navigation target.** Where a value is required but not derivable, the templates
  carry the literal placeholder `"<COPY_FROM_SOURCE>"` and §14 gives the exact
  failure message to emit instead of guessing.
- **Did not universalize one export's geometry.** Seven values appear in only one
  file — the right-half `room` cell x, and all six live-cell x values — and are
  tagged `TEMPLATE-SPECIFIC` rather than `LIST`.
- **Did not average a conflicting coordinate.** Every one of L-1 – L-16 names a
  winning source.
- **Did not resolve the stripe placement rule, the separator placement rule, or
  the `<DRIVERNAME>` and `unit_id` lookup.** All three are listed as open in
  contract §16.2 with what would settle them.
- **Did not claim the 400/500 numbering convention as truth.** It is evidence from
  one production style, contradicted on the supply/extract reading by E5's own
  aliases (L-6, L-8). Where the side cannot be read from explicit source data, the
  contract stops rather than guessing.
- **Did not add a wrapper format.** E8 is retained as a negative example precisely
  because a task-companion wrapper is not a Designer panel and the importer cannot
  read it.

---

# Part 6 — 2026-08-10: the Maskin (machine room) generation contract

A separate pass with its own brief and its own evidence. It changes no
ventilation and no list-panel rule. Conflict ids are `M-1`–`M-6` and refer to the
table in [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) §12;
validator rule ids are `M-S*` (structural), `M-G*` (relationship) and `M-P*`
(profile-scoped), mirroring the ventilation namespaces.

Evidence: **E9**–**E13** in the table at the head of this file. E9 is uncommitted
— a live plant id, 64 real driver ids, a real unit id and a named author — so
every measurement below is reproduced from **E10**, which is E9 sanitized and is
in the repository.

**Source precedence used**, highest first: the export supplied with the task (E9)
→ `CLAUDE.md` host behaviour → `AI-BRIEFING.txt` → `PANEL-TYPE-GUIDE.md` →
`DESIGN-OBJECT-CATALOG.md` (valid vocabulary only). No coordinate was averaged.
No measurement was generalized past the profile it came from: geometry is tagged
`TEMPLATE-10229`; only behaviour confirmed as a property of machine pictures is
tagged `MASKIN`.

**One premise in the brief did not survive contact with the repository.** The
brief describes the failure to audit as "a generic 12-object authored SVG demo".
No 12-object Maskin artifact exists anywhere in the repository:
`generated-maskin-example.json` (E11) carries 63 objects and 215 drawable SVG
elements. The failure *class* the brief names is real and is documented in
contract §13 against the artifact that does exist. The 12-object file is not
invented here, and no claim is made about it.

---

## Rules changed

### 73. `MASKIN-GENERATION-CONTRACT.md` — a new owner for measured Maskin geometry

| | |
|---|---|
| **Original** | No document owned Maskin geometry. Coordinates, roles and z-index bands were scattered across `AI-BRIEFING.txt`, `CLAUDE.md` and a P&ID paragraph in `AI-AGENT-INSTRUCTIONS.txt`, none of them measured from an export. |
| **Problem found** | The only worked Maskin reference in the repository was an authored demo (E11) whose geometry matches production nowhere — see change 82. An agent following the repository produced a plausible panel with every readout off its drawn pill. |
| **Revised** | **New file, 15 sections.** Routing table; the 8-rank source precedence in machine-readable form; the profile registry; the atomic-cluster model; the `M-S*`/`M-G*`/`M-P*` rule ids; the evidence base with E9's envelope verbatim and the mode discriminator; canvas and composition; background ownership and the four background fields; the z-index bands; the object vocabulary; the complete 8-role inventory with per-object geometry; compressor clusters with measured pitch; suction groups; the setpoint-pill rule; the anomalies; linking and sanitization; the four request classes; the conflict register; the negative example; and what evidence is still missing. |
| **Reason** | The brief requires one live owner per rule and forbids inventing geometry. Measured geometry needed an owner that is neither the host document nor the output contract. |
| **Source** | E9, reproduced from E10. |
| **Files** | `MASKIN-GENERATION-CONTRACT.md` (new) |
| **Status** | **Normative** · `MASKIN` and `TEMPLATE-10229`, tagged per rule |

### 74. `MASKIN-AUTHORING-GUIDE.md` — the procedure, separated from the measurements

| | |
|---|---|
| **Original** | Procedure was mixed into `AI-BRIEFING.txt` and a five-paragraph section of `CLAUDE.md`, interleaved with host facts and with geometry. |
| **Revised** | **New file.** Ten ordered steps: classify the request into one of four classes, select the profile, decide background ownership *before* placing anything, place clusters whole, choose objects by role, land every pill on a drawn pill, sanitize or preserve, and report what could not be verified. Closes with an 11-row failure catalogue. |
| **Reason** | Authoring procedure and measured geometry rot at different rates and are read at different moments. Keeping them in one document is what produced the duplicated, drifting Maskin rules this pass had to reconcile. |
| **Source** | E9/E10 for every value quoted; the procedure itself derives from the host behaviour already recorded in `CLAUDE.md`. |
| **Files** | `MASKIN-AUTHORING-GUIDE.md` (new) |
| **Status** | **Normative** · `MASKIN` |

### 75. `MASKIN-QA-CHECKLIST.md` — structural and visual QA are separate requirements

| | |
|---|---|
| **Original** | No Maskin QA document. The implicit bar was "the JSON parses and inserts". |
| **Revised** | **New file.** Stages 0/A/B/C/D/E. Stage C — render at native 1400×750 on the real background, one crop per role — is mandatory and cannot be satisfied by any validator. Carries the exact per-module test commands and the note that `python -m unittest discover -s tests` fails here because `tests/` has no `__init__.py`, with an explicit instruction not to "fix" that by adding one. |
| **Reason** | The brief states it directly: correctness may not be claimed from JSON parsing alone. Every defect the render found in E11 was invisible to the parser. |
| **Source** | The repository's own test convention; the visual pass run in this session. |
| **Files** | `MASKIN-QA-CHECKLIST.md` (new) |
| **Status** | **Normative** · `MASKIN` |

### 76. `MASKIN-COPILOT-PREFLIGHT.md` — the retrieval-friendly short form

| | |
|---|---|
| **Original** | Nothing equivalent for Maskin; the ventilation counterpart already existed. |
| **Revised** | **New file.** 18 numbered plain-text items: precedence, request class, the never-invent rule, background ownership, structure, the z-bands, object-by-role, the setpoint-pill rule, cluster atomicity, the MT→LT trap, the pill-on-pill rule, alias as link key, the unlinked-demo contract, preserving production anomalies, UTF-8, the verification order, Insert-appends, and what to report. |
| **Reason** | A Copilot agent that loads one Maskin file should load this one. It is a knowledge file, not the instructions field, so the 8 000-character cap does not apply — it measures **8 435 characters** (worst-case CRLF 8 570) and carries **0** angle brackets, so it stays paste-safe either way. |
| **Source** | A compression of changes 73–75; every number in it is E9/E10. |
| **Files** | `MASKIN-COPILOT-PREFLIGHT.md` (new) |
| **Status** | **Normative** · `MASKIN` — a summary of owned rules; the contract wins on conflict |

### 77. `reference_data/maskin-10229-sanitized.json` — the committed reference, built by script

| | |
|---|---|
| **Original** | The only committed Maskin panel was E11, an authored demo. Nothing in the repository showed what a production machine picture looks like. |
| **Revised** | **New fixture, 66 objects, 161 166 bytes**, generated by `build-maskin-fixture.py` from E9. Preserved exactly: geometry, `obj_id`, sizes, `zIndex`, `tag_text` (63 empty plus the three single-space values), `alias_text` (65 distinct), array order, and the `image_data` raster **byte-identical** at 123 966 characters. Replaced: `id` and `driver_id` → the literal `"driver_id"`; `linked` → `"false"`; `unit_id`, `unit_ref`, `link_tag`, `sub_group`, `source_plant_id`, `plant_id` and `saved_by` → empty. Dropped: the 2 241 097-character `image_svg_trace`. |
| **Reason** | The brief forbids committing live plant bindings and prescribes exactly this preservation set. Aliases are preserved deliberately: they are the relink key, so stripping them would destroy the fixture's main purpose. |
| **Source** | E9 → E10 via `build-maskin-fixture.py`; residue re-checked by validator rule `M-S10`. |
| **Files** | `build-maskin-fixture.py` (new), `reference_data/maskin-10229-sanitized.json` (new) |
| **Status** | **Normative** · `TEMPLATE-10229` |

### 78. `documentation-rules.json` — `panel_types.maskin`, through its generator

| | |
|---|---|
| **Original** | The machine-readable rule file covered ventilation and list panels. It had no Maskin entry, so no Maskin rule was queryable or scope-tagged in machine form. |
| **Revised** | `panel_types.maskin` added, with `identity`, `owner_document`, `canvas`, `background`, `composition`, `z_indexes`, `object_vocabulary`, `roles`, `setpoint_pill`, `compressor_columns`, `role_translations_mt_to_lt`, `absent_by_design`, `anomalies`, `bindings`, `sanitization`, `request_classes`, `insert_semantics`, `required_roles`, `qa` and `evidence_required`; evidence E9–E13; the scope tags `MASKIN` and `TEMPLATE-10229`. |
| **How** | Through `build-maskin-rules.py`, **not** by hand. Its only flag is `--check`; a bare invocation writes. Two generator defects were fixed at the generator and the file regenerated: a stale `discover -s tests` QA command that cannot run here, and a `qa` block whose shape diverged from the ventilation one. |
| **Reason** | The brief forbids hand-editing generated artifacts, and a hand fix would have been silently reverted on the next regeneration. |
| **Source** | E9/E10. |
| **Files** | `build-maskin-rules.py` (new), `documentation-rules.json` |
| **Status** | **Normative** · tagged per rule |

### 79. `validate-maskin-panel.py` and `tests/test_maskin_10229_contract.py` — the contract made executable

| | |
|---|---|
| **Original** | No Maskin validator. A Maskin panel could only be checked by reading it. |
| **Revised** | **New validator**, rule ids `M-S01`–`M-S10` (structural), `M-G01`–`M-G07` (relationship) and `M-P01`–`M-P05` (profile-scoped), with `--profile`, `--mode {demo,production}` and `--json`, exit 1 on any error. Comparison is by **role key** — `obj_id` + `alias_text` + `tag_text` — never by array index. **New test module, 62 tests**, covering the fixture baseline, each structural rule, the relationship rules, the `TEMPLATE-10229` profile and the generated artifacts. |
| **Two false positives, found by the tests and fixed** | `M-S07` fired on E9's own `image_svg_trace`; severity is now mode-dependent and mode detection runs before the background check (conflict `M-3`). `M-S08` fired on `saved_by "copilot"`; identity checks moved into the `M-S10` residue rule. |
| **Reason** | A contract nobody can run drifts from the code it describes. Every new validator rule got a regression test, as the brief requires. |
| **Source** | E9/E10/E11. |
| **Files** | `validate-maskin-panel.py` (new), `tests/test_maskin_10229_contract.py` (new) |
| **Status** | **Normative** · each rule id carries its own scope |

### 80. `render-maskin-panel.py` — native-size visual QA

| | |
|---|---|
| **Original** | No way to see a Maskin panel without inserting it into the live Designer. |
| **Revised** | **New renderer.** Emits a native 1400×750 preview of the real background with the dynamic-object overlay, plus one zoomed crop per role group, deriving the crop regions from `documentation-rules.json` → `panel_types.maskin.roles[*].aliases` rather than from hardcoded rectangles. |
| **Reason** | Stage C of the QA checklist is not optional and cannot be automated away; it needed a repeatable way to produce the crops. Two capture defects were fixed while using it: silent clipping of wide crops (`CROP_MAX_WIDTH` 1360, per-region scale), and the in-app browser being unavailable, which is why the previews render through local headless Chrome. |
| **Source** | E10 plus the committed background raster. |
| **Files** | `render-maskin-panel.py` (new) |
| **Status** | **Procedural** · `MASKIN` |

### 81. `DESIGN-OBJECT-CATALOG.md` — the Maskin object set, added through the generator

| | |
|---|---|
| **Original** | The catalogue's object-set table had a list-panel row and no Maskin row. The 11 ids a machine picture actually uses were not retrievable as a set. |
| **Revised** | A `Maskin object set (CO2 rack machine room)` row listing all 11 measured ids in role order, stating that the machine drawing owns all artwork — so the set contains no pipes, symbols or labels — and that the sizes in the table below are toolbox defaults, because production places every AK-PC strip at 81×21. |
| **How** | Through `build-object-catalog.py`, **not** by hand, then regenerated (`797 objects, 11 menus, 266 panels scanned`). The diff against HEAD is exactly the one generated row plus its Part 5 list entry. |
| **Reason** | The brief assigns valid vocabulary to this file and forbids hand-editing generated catalogues. |
| **Source** | E9's `obj_id` frequency table; the fleet counts beside each id come from the generator's own survey. |
| **Files** | `build-object-catalog.py`, `DESIGN-OBJECT-CATALOG.md` (regenerated) |
| **Status** | **Normative** · `MASKIN` |

### 82. `generated-maskin-example.json` reclassified — worked example to negative example

| | |
|---|---|
| **Original** | `AI-BRIEFING.txt`: `- Worked example: generated-maskin-example.json`. `CLAUDE.md` §17b listed it as the Maskin sample to copy. |
| **Revised** | Both now label it a **negative example** and route copying to `reference_data/maskin-10229-sanitized.json`. `CLAUDE.md` §17b carries the measured audit; `AI-BRIEFING.txt` carries the short form and points at contract §13. |
| **The audit, by role and never by array index** | 63 objects against 66; 9 distinct `obj_id`s against 11. **Three roles missing** — the entire third LT compressor (`C3 LT status`, `C3 LT capacity`, `C3 LT Runtime total`). **One role invented** (`Liq. inj. status MT`). **Two `obj_id` substitutions.** Every `zIndex` is `"default"` where production uses five numeric bands. An authored `image_svg` where production owns a raster `image_data`. Of the **62 role instances the two files share, 0 sit at the production coordinates** — median displacement 23.2 px, mean 36.6, max 157.7, with 41 roles more than 20 px out and 13 more than 50 px. Validated against the profile it claims to represent it raises **90 errors and 6 warnings**; validated with no profile it raises **0 errors and 1 warning**. |
| **Reason** | It parses, it inserts, and it is wrong — which is precisely why it was being copied. The brief asks for this failure to be documented as a negative example, not deleted and not treated as a template. |
| **Source** | E11 against E10, paired by role key with deterministic minimum-cost matching. |
| **Files** | `AI-BRIEFING.txt`, `CLAUDE.md` §17b, `MASKIN-GENERATION-CONTRACT.md` §13. The example file itself is **unchanged** |
| **Status** | **Normative** · `MASKIN` |

### 83. `CLAUDE.md` — the compressor-bank procedure replaced by routing plus host facts

| | |
|---|---|
| **Original** | `### Editing an existing Maskin compressor bank from an exported panel JSON` — five prose paragraphs mixing host behaviour, authoring procedure and unmeasured geometry, plus a test command. |
| **Problem found** | This is the host-behaviour document. Procedure and geometry in it constitute a second competing contract, and the geometry in those paragraphs was not measured from any export. |
| **Revised** | Replaced by `### Maskin (CO₂ rack / machine room) — where the rules live, and the host facts`: a 7-row routing table, then the five facts that genuinely belong to the host. (1) The z-index list elsewhere in this file is ventilation-scoped and Maskin inverts it (`M-1`; recorded, not averaged). (2) `linked="true"` is set on load whenever `driver_id !== "driver_id"`, **including when it is empty** (`V3scripts.js:514`) — which is why E9 contains two such objects. (3) A production export never emits the literal `"driver_id"`; that is the mode discriminator. (4) `panel.image_svg_trace` is an Export **input** that `applyImportCore` deletes on Insert, so it is never output. (5) Insert appends and renames every object from the live canvas child index. §17b gained a normative bullet for the sanitized fixture. |
| **Reason** | One owner per rule. The host document keeps what only it can know and routes the rest. |
| **Source** | The mirrored Designer sources for the host facts; E9/E10 for the counts. |
| **Files** | `CLAUDE.md` §17b and the Maskin section |
| **Status** | **Normative** · `GLOBAL` for the host behaviour, `MASKIN` for the routing |

### 84. `CLAUDE.md` — the Maskin test command corrected

| | |
|---|---|
| **Original** | A bare `python -m unittest …` line with no working directory stated. |
| **Revised** | `Regression fixtures and tests — run from iwmac-designer-reference/ (the repo convention is per-module; discover -s tests fails because tests/ has no __init__.py):` above `python -m unittest tests.test_maskin_compressor_bank tests.test_maskin_10229_contract`. |
| **Reason** | The documented command has to be the one that actually runs. Checked against every `python -m unittest` line in the repository's Markdown before standardizing. |
| **Source** | Run in this session: 78 tests, OK. |
| **Files** | `CLAUDE.md` |
| **Status** | **Normative** · `GLOBAL` |

### 85. `PANEL-TYPE-GUIDE.md` — the Maskin section rewritten

| | |
|---|---|
| **Original** | A short section giving the fleet statistics (39 panels, median 59 objects, ~98% linked), a rough object mix, and a "Best copy sources" list naming the authored demo. |
| **Problem found** | It read as a specification while owning nothing, and the best source it named was the negative example. The median was also being read as a target. |
| **Revised** | Opens with a routing blockquote — five rows naming the contract, the authoring guide, the QA checklist, `documentation-rules.json` with the validator command, and the preflight — and states plainly that the section is style summary and fleet context and does **not** own geometry. Keeps the fleet statistics and adds "the median is a fleet statistic, not a target. The measured reference profile is 66 objects; neither number is a pass mark." Expands the object mix, adds the 8-item role inventory, states that the background owns all artwork, states that an alias is never renamed and never stripped during sanitization, and replaces "Best copy sources" with a 4-item named-best-references precedence list ending in the negative example. |
| **Reason** | Panel-type identity, role inventory, background family and linking method belong here per the brief's target architecture; measured coordinates do not. |
| **Source** | The 41-plant survey for the fleet numbers; E9/E10 for the roles. |
| **Files** | `PANEL-TYPE-GUIDE.md` |
| **Status** | **Normative** for the routing and the roles · `MASKIN`; the fleet statistics remain **Advisory** |

### 86. `AI-BRIEFING.txt` — routing, precedence, and the Maskin block

| | |
|---|---|
| **Original** | The "what it does not own" table listed the ventilation and list-panel owners only. The §0 precedence rank 3 named `VENTILATION-GEOMETRY-CONTRACT.md`. The Maskin material was a `MASKIN ARTWORK` header plus an editing procedure written before any export had been measured. |
| **Revised** | Five edits. (1) The ownership table gained rows for the Maskin contract, authoring guide, QA checklist, validator and both preflights, and the reprinted-number paragraph now ends "Maskin geometry is NOT reprinted here: there is one owner, and it is MASKIN-GENERATION-CONTRACT.md." (2) Precedence rank 3 now names the contract *for each panel type*. (3) A new `MASKIN (MACHINE PICTURE) - ROUTING FIRST` block names the four documents, the fixture and the validator command, and carries the two envelope-level facts an agent cannot get elsewhere: the z-bands are not the ventilation bands, and a production export never emits the literal `"driver_id"`. (4) The worked-example bullet became the negative-example bullet (change 82). (5) The compressor-bank block now opens with routing plus "the five rules that are envelope-level", requires a pitch reused from a **named** pair rather than an average, and requires comparison by role key. |
| **Reason** | This file is the output contract and the routing hub. It should say where the Maskin rules live and stop restating them. |
| **Source** | E9/E10; the host facts from `CLAUDE.md`. |
| **Files** | `AI-BRIEFING.txt` |
| **Status** | **Normative** · `GLOBAL` for the envelope facts, `MASKIN` for the routing |

### 87. `AI-BRIEFING.txt` — the relinking section records the duplicate-alias anomaly

| | |
|---|---|
| **Original** | The relinking procedure's step 2 said that the same alias appearing twice means the same row, with no caveat. |
| **Revised** | Adds that this is measured production behaviour and not always the intent: on E9, `Suction temp. To-MT` appears on two adjacent pills that the artwork labels "To °C" and "To offset", both bound to one driver id, where the LT row binds its second pill to `To opt. offset LT`. Preserve and report; any corrective is **Advisory** and needs the plant's own parameter dump. Points at contract §9.3. |
| **Reason** | An agent that "tidies" this silently changes what a production panel displays. The brief requires anomalies to be reported, not corrected. |
| **Source** | E9 `object_1` and `object_59` — both at y257, x581 and x626, one driver id — confirmed against the rendered artwork in the visual pass. |
| **Files** | `AI-BRIEFING.txt`, `MASKIN-GENERATION-CONTRACT.md` §9.3 |
| **Status** | **Normative** to preserve · the correction itself is **Advisory** · `TEMPLATE-10229` |

### 88. `AI-AGENT-INSTRUCTIONS.txt` — Maskin routing added inside the 8 000-character cap

The file is pasted into the M365 Copilot Studio instructions field, which caps at
8 000 characters and rejects `<` and `>`. It had **9 characters of headroom**, so
the Maskin block had to be paid for. Every cut below removes text that has a live
owner elsewhere; none removes a rule.

| | |
|---|---|
| **Added** | `MASKIN = CO2 rack. The drawing owns ALL artwork; objects add live values only. Read MASKIN-COPILOT-PREFLIGHT.md; MASKIN-GENERATION-CONTRACT.md owns every coordinate, role and z band, scope-tagged. Name the case as for vent; copy reference_data/maskin-10229-sanitized.json, NOT generated-maskin-example.json (NEGATIVE example). z bands 110/360/375/1000/1100, not "default", not the vent bands. Clusters are atomic, a measured pitch never averaged, every pill on a drawn pill.` — 509 characters |
| **Cut 1** | `FROM A P&ID OR SYSTEM DESCRIPTION. One row per compressor (label, run LED, capacity %, hours), MT/LT groups with an akpc strip each; Po/Pc/Prec/Pgc to TRYKK; Ss/Sd/Sgc to TEMPERATURER; gas cooler to fan icon + fan/HV/GBV % boxes + cond strip; receiver to Prec + temps; heat recovery Shr its own section. Sensor names go in alias_text.` → removed. Unmeasured rack geometry, now owned in measured form by contract §5. The Maskin block occupies its place |
| **Cut 2** | `VENTILATION-GEOMETRY-CONTRACT.md;` → `the panel type's geometry contract;` in the precedence line. Three contracts now exist; each panel-type block names its own |
| **Cut 3** | ` Vent: Tilluft x1275, Avtrekk x1341 (measured; widths are estimates).` → removed. A reprinted coordinate that `VENTILATION-GEOMETRY-CONTRACT.md` owns — and flags there as contradicted by production by 1 px, which a reprint cannot express |
| **Cut 4** | `to drag onto the plan: bell 12,0 + 40px_no_conn_no_tag 7,22 + cooling_nrm 10,35 + defrost_nrm 28,38, all on ONE case controller.` → `to drag onto the plan; the 4 offsets are in briefing THE CASE CLUSTER, all on ONE case controller.` Same four offsets, owned by `AI-BRIEFING.txt` § THE CASE CLUSTER with its evidence — 28 occurrences across 16 stores |
| **Cut 5** | MODE D's inline rules → `follow briefing MODE D - labelled cabinets and rooms only, simplified plan as image_svg, one cluster per position, aliases from the plan labels.` `AI-BRIEFING.txt` § MODE D - BYGGEPLAN UPLOAD owns them, including the gondolas-and-dimension-lines exclusion |
| **Moved, not cut** | The duplicated UTF-8 sentence left the LAYOUT line, and the self-check entry widened from `UTF-8 °C not gr C;` to `UTF-8 - °C not gr C, keep Norwegian letters and m³;`. The file still states the rule once, in full |
| **Also changed** | Self-check `zIndex "default" (7c and vent bands excepted)` → `(7c, vent and maskin bands excepted)`. Without this the file's own check would reject a correct Maskin panel |
| **Character count** | **7 991 → 7 965** worst-case CRLF (LF 7 958 → 7 932). Headroom under the cap: **9 → 35**. Angle brackets: **0**, unchanged. `°C` and `m³` verified present after the edit |
| **Reason** | The brief requires this file to stay within its documented Copilot Studio restrictions, with the Maskin detail in knowledge files. |
| **Source** | E9/E10 for the block; the named owner documents for each cut. |
| **Files** | `AI-AGENT-INSTRUCTIONS.txt` |
| **Status** | **Normative** · `MASKIN` for the block, `GLOBAL` for the self-check changes |

### 89. The `*-REVISED` files — deliberately not applied

| | |
|---|---|
| **Decision** | `AI-AGENT-INSTRUCTIONS-REVISED.txt`, `AI-BRIEFING-REVISED.txt` and `CLAUDE-REVISED.md` were **not** given Maskin content and were not promoted. |
| **Reason** | The brief says to treat `*-REVISED` files as change records or proposals per their own status header, never automatically as live contracts. Mirroring Part 6 into them would create exactly the second competing contract the brief forbids. |
| **Files** | none |
| **Status** | **Advisory** · `GLOBAL` |

---

## Conflicts resolved

Recorded in full in [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) §12.
**No conflict was resolved by averaging.**

| Id | Conflict | Decision |
|---|---|---|
| **M-1** | `CLAUDE.md` z-bands (110 values, 1100 labels) against E9 (1100 value and setpoint pills, 110 json and no-connection boxes) | Both kept. The `CLAUDE.md` list is scoped `VENT`; the Maskin bands are scoped `MASKIN`. Bands are a property of the panel type |
| **M-2** | Compressor rows translate MT→LT by ≈(0,+325); the suction readouts do not — `Sd` moves (369,313), `Ss` (−71,324) | The vector is recorded **per role**, never per panel. Applying the compressor vector panel-wide moves seven readouts onto empty artwork |
| **M-3** | `image_svg_trace` is present in E9 and forbidden in output | Severity is mode-dependent: **error** for authored output, **warning** on a detected production export. The host deletes the field on Insert |
| **M-4** | 66 objects (E9) against the 59-object fleet median | Neither is a target. Object count is justified role by role against the selected profile |
| **M-5** | `Suction temp. To-MT` on two adjacent pills sharing one driver id, where LT binds its second pill to `To opt. offset LT` | Recorded as a measured anomaly with artwork evidence; **not corrected**. Any corrective is **Advisory** |
| **M-6** | `DESIGN-OBJECT-CATALOG.md` sizes against measured placement sizes | The catalogue's sizes are toolbox defaults. The contract wins on placement geometry; the catalogue keeps vocabulary |

---

## Verification run for Part 6

| Command, from `iwmac-designer-reference/` | Result |
|---|---|
| `python -m unittest tests.test_maskin_compressor_bank tests.test_maskin_10229_contract` | Ran 78 tests — **OK** |
| `python -m unittest tests.test_build_ventilation_corpus tests.test_list_panel_contract tests.test_maskin_compressor_bank tests.test_ventilation_profile_9099 tests.test_maskin_10229_contract` | Ran 188 tests — **OK** |
| `python validate-maskin-panel.py reference_data/maskin-10229-sanitized.json --profile TEMPLATE-10229` | 0 errors, 1 warning |
| `python validate-maskin-panel.py <the supplied export> --profile TEMPLATE-10229` | 0 errors, 3 warnings |
| `python validate-maskin-panel.py reference_data/generated-maskin-example.json --profile TEMPLATE-10229` | **90 errors**, 6 warnings — change 82 |
| `python build-maskin-rules.py --check` | clean; the file is generated, never hand-edited |
| `python build-object-catalog.py` | 797 objects, 11 menus, 266 panels scanned — diff is the one generated row |

Visual QA ran at native 1400×750 on the real background, one crop per role group.
It confirmed three things no validator can see: every value box lands on an empty
pill drawn in the artwork; `Prec reference` sits on a visibly darker drawn pill
than `Prec` 25 px below it, which is what the setpoint-pill rule encodes; and the
MT and LT columns each draw three status strips, three capacity pills and three
runtime pills but only **one** VSD pill, under C1 — which is why
`absent_by_design` exists, and why a fourth compressor is cloned from C3 and
never from C1.

---

## Files changed in Part 6

| File | Change | Existed before? |
|---|---|---|
| `MASKIN-GENERATION-CONTRACT.md` | **New.** Measured-geometry owner, 15 sections (73) | No |
| `MASKIN-AUTHORING-GUIDE.md` | **New.** Procedure and failure catalogue (74) | No |
| `MASKIN-QA-CHECKLIST.md` | **New.** Stages 0–E; visual QA mandatory (75) | No |
| `MASKIN-COPILOT-PREFLIGHT.md` | **New.** 18-item short form, 8 435 chars (76) | No |
| `build-maskin-fixture.py` | **New.** Sanitizer, E9 → E10 (77) | No |
| `reference_data/maskin-10229-sanitized.json` | **New.** 66 objects, no live bindings (77) | No |
| `build-maskin-rules.py` | **New.** Generator for `panel_types.maskin` (78) | No |
| `documentation-rules.json` | `panel_types.maskin`, evidence E9–E13, two scope tags — regenerated, not hand-edited (78) | Yes |
| `validate-maskin-panel.py` | **New.** `M-S*` / `M-G*` / `M-P*` rules (79) | No |
| `tests/test_maskin_10229_contract.py` | **New.** 62 tests (79) | No |
| `render-maskin-panel.py` | **New.** Native-size preview and per-role crops (80) | No |
| `build-object-catalog.py` | Maskin object set added to the generator (81) | Yes |
| `DESIGN-OBJECT-CATALOG.md` | Regenerated from the above — not hand-edited (81) | Yes |
| `CLAUDE.md` | §17b fixture bullet and negative-example audit; Maskin section replaced by routing plus five host facts; test command corrected (82–84) | Yes |
| `PANEL-TYPE-GUIDE.md` | Maskin section rewritten (85) | Yes |
| `AI-BRIEFING.txt` | Ownership table, precedence, Maskin routing block, negative example, compressor-bank block, relinking anomaly (82, 86, 87) | Yes |
| `AI-AGENT-INSTRUCTIONS.txt` | Maskin routing inside the 8 000-character cap; five reprint cuts (88) | Yes |
| `documentation-change-log.md` | This part; evidence E9–E13 and two scope tags added at the head | Yes |
| `reference_data/generated-maskin-example.json` | **Untouched.** Reclassified in the documents that cite it, not edited (82) | Yes |
| `AI-BRIEFING-REVISED.txt`, `AI-AGENT-INSTRUCTIONS-REVISED.txt`, `CLAUDE-REVISED.md` | **Untouched**, deliberately (89) | Yes |

---

## What Part 6 deliberately did not do

- **Did not invent a coordinate, `obj_id`, driver id, unit id, alias, plant id,
  file path or navigation target.** Where the brief's premise and the repository
  disagreed — the "12-object demo" — the disagreement is stated, not reconciled.
- **Did not generalize one export.** Every coordinate in the contract is tagged
  `TEMPLATE-10229`. Only behaviour independently confirmed as a property of
  machine pictures is tagged `MASKIN`. There is exactly one measured profile, and
  the contract says so.
- **Did not average a conflicting value.** `M-1`–`M-6` each name a winner or keep
  both under different scopes. The compressor pitch stays a measured 79–82 px
  with a named pair, never a constant.
- **Did not correct a production anomaly.** The three single-space `tag_text`
  values, the two objects that are `linked:"true"` with an empty `driver_id`, and
  the duplicate `Suction temp. To-MT` binding are preserved in the fixture and
  reported in the contract.
- **Did not commit the supplied export.** It stays outside the repository. E10
  reproduces every measurement without a plant id, a driver id, a unit id or an
  author name.
- **Did not delete the negative example.** E11 is retained and cited as one,
  because the failure it demonstrates — a panel that parses, validates without a
  profile, inserts cleanly, and is still wrong on all 62 shared roles — is the
  specific thing this pass exists to prevent.
- **Did not resolve six open evidence items.** Contract §14 lists them with what
  would settle each: a second Maskin export from a different plant, a fixed-speed
  rack, a rack with more than three compressors per suffix, the plant's own
  parameter dump for the duplicate alias, an AK-PC model other than 782A, and a
  Maskin panel on a canvas other than 1400×750. A stated gap is a deliverable; a
  guess is not.

---

# Part 7 — 2026-08-10: the Oversikt (store overview) generation contract

A separate pass with its own brief and its own evidence. It changes no
ventilation, list-panel or Maskin rule. Conflict ids are `OV-C1`–`OV-C3` and
refer to the table in
[OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) §12; validator
rule ids are `O-S*` (structural), `O-G*` (relationship), `O-P*` (profile-scoped)
and `O-C*` (source-versus-candidate comparison), mirroring the ventilation and
Maskin namespaces. `O-C*` is new to this pass: no earlier panel type has a
comparison mode, because no earlier failure was *omission*.

Evidence: **E14**–**E17** in the table at the head of this file. E14 is
uncommitted — a live plant id and 72 real driver ids — so every measurement below
is reproduced from **E15**, which is E14 masked and is in the repository.

**Source precedence used**, highest first: the export supplied with the task
(E14) → the host behaviour recorded in `CLAUDE.md` → `AI-BRIEFING.txt` →
`PANEL-TYPE-GUIDE.md` → `DESIGN-OBJECT-CATALOG.md` (valid vocabulary only). No
coordinate was averaged. No measurement was generalized past the profile it came
from: geometry is tagged `TEMPLATE-10113`; only behaviour confirmed as a property
of store overviews is tagged `OVERSIKT`.

**The failure this pass exists to prevent is not a malformed panel — it is a
well-formed one that is missing half the store.** Both failed attempts (E16)
parse and insert, and the second passes every structural check. Nothing inside a
single document says how many controllers a store has, so no single-document
check can catch omission. That is the whole reason `--compare` and `--profile`
exist.

---

## Rules changed

### 90. `OVERSIKT-GENERATION-CONTRACT.md` — a new owner for measured Oversikt geometry

| | |
|---|---|
| **Original** | No document owned Oversikt rules. The case cluster was described in `reference_data/panel-conventions.json` as a fleet median, again in `AI-BRIEFING.txt` §7b as a 90 px kit grid, and nowhere as measured geometry. Three descriptions, no owner, and they disagree. |
| **Problem found** | With a production export in hand, an agent rebuilt the panel from a store-layout PDF and delivered 9 of 21 controller clusters. §13 records the incident in full. |
| **Revised** | **New file, 15 sections.** Routing; the 8-rank source precedence; profiles and rule ids; the evidence base with the mode discriminator; canvas and structure; background ownership; the z-bands; the object vocabulary; controller identity and coverage; input routing as a decision tree; placement and geometry; linking and what may never be blanked; the anomalies; sanitization; the verification report format; the conflict register `OV-C1`–`OV-C3`; the incident and its root cause; and §15, nine open evidence items. |
| **Reason** | The brief requires one live owner per rule and forbids inventing geometry. Three disagreeing descriptions in three files is the condition that produced the incident. |
| **Source** | E14, reproduced from E15. |
| **Files** | `OVERSIKT-GENERATION-CONTRACT.md` (new) |
| **Status** | **Normative** · `OVERSIKT` and `TEMPLATE-10113`, tagged per rule |

### 91. `OVERSIKT-AUTHORING-GUIDE.md` — the procedure, with a hard stop in it

| | |
|---|---|
| **Original** | No Oversikt procedure existed. `AI-BRIEFING.txt` §7b carried four modes with no ordering between them and no step that counts anything. |
| **Revised** | **New file.** Eleven ordered steps: classify the request, inspect the supplied artefacts, inventory the controllers and cases, group objects into clusters, build the coverage matrix, reconcile against the PDF or screenshot, patch only verified differences (7a preserve-and-patch, 7b generate, 7c placement), preserve links and background, render a preview, validate, write the verification report. Closes with a failure catalogue. |
| **The hard stop** | Step 3 ends the procedure if the inventory cannot be completed: *the deliverable is then the inventory plus a named gap, not a panel*. Nothing in the old process ever counted controllers, which is why nothing noticed twelve were missing. |
| **Reason** | Procedure and measured geometry are read at different moments and rot at different rates; the Maskin pass separated them for the same reason. |
| **Source** | E14/E15 for every value quoted; the procedure derives from the host behaviour in `CLAUDE.md`. |
| **Files** | `OVERSIKT-AUTHORING-GUIDE.md` (new) |
| **Status** | **Normative** · `OVERSIKT` |

### 92. `OVERSIKT-QA-CHECKLIST.md` — verification in stages, with the render mandatory

| | |
|---|---|
| **Original** | No Oversikt QA document. The implicit bar was "the JSON parses and inserts" — which the nine-cluster reconstruction clears. |
| **Revised** | **New file.** Stage 0 runs the validator; Stages A–G cover structure, background, controllers and coverage, placement shape, links and sanitization, the render and the draft rule, and import. Stage 0 states in the file what the validator *cannot* see, and Stage F cannot be satisfied by any script. |
| **Reason** | The brief requires an enumerated verification list, and the incident proves a parser cannot decide whether a panel is the store. |
| **Source** | The repository's own test convention; the validator runs in this session. |
| **Files** | `OVERSIKT-QA-CHECKLIST.md` (new) |
| **Status** | **Normative** · `OVERSIKT` |

### 93. `OVERSIKT-COPILOT-PREFLIGHT.md` — the retrieval-friendly short form

| | |
|---|---|
| **Original** | Nothing equivalent for Oversikt; the ventilation and Maskin counterparts already existed. |
| **Revised** | **New file.** 20 numbered plain-text items: map-not-dashboard, precedence, input routing, the PDF-may-not-reduce rule, inventory-before-edit, controller identity, derived coverage, atomic clusters, background ownership, preserve-through-every-edit, never-invent, object-by-role, the z-bands, structure, production anomalies, the draft rule, verification order, necessary-versus-sufficient, Insert-appends, and what to report. |
| **Reason** | A Copilot agent that loads one Oversikt file should load this one. It is a knowledge file, not the instructions field, so the 8 000-character cap does not apply — it measures **9 760 characters** (worst-case CRLF 9 913) and carries **0** angle brackets. |
| **Source** | A compression of changes 90–92; every number in it is E14/E15. |
| **Files** | `OVERSIKT-COPILOT-PREFLIGHT.md` (new) |
| **Status** | **Normative** · `OVERSIKT` — a summary of owned rules; the contract wins on conflict |

### 94. `reference_data/oversikt-10113-sanitized.json` — masked, deliberately not unlinked

| | |
|---|---|
| **Original** | No Oversikt panel of any kind was committed. Nothing in the repository showed what a store overview looks like. |
| **Revised** | **New fixture, 72 objects, 91 827 bytes**, generated by `build-oversikt-fixture.py` from E14. Preserved exactly: geometry, `obj_id`, sizes, `zIndex`, `tag_text`, `alias_text`, `unit_id`, `linked` `"true"`, array order, and the `image_data` raster **byte-identical** at 48 210 characters. Masked: the plant number inside every `driver_id` → `NNNNN`. Blanked: `plant_id`, `source_plant_id`, `saved_by`, `org_image_name`, `image_name`. Dropped: the 528 876-character `image_svg_trace`, exactly as the host does on insert. |
| **Why masked and not unlinked** | `build-maskin-fixture.py` applies the *unlinked demo contract* — every binding replaced by the literal `"driver_id"`. That is right for a geometry template and wrong here. An Oversikt is not a flat object list; it is a set of controller clusters, and the thing this fixture has to prove is that all 21 survive a round trip. Controller identity lives in `unit_id` and in the driver id, so blanking those would delete the structure the fixture exists to carry. The fixture follows the repository's other convention instead — the masked production reference already used by `real-vent-panel-example.json` and `real-spjeldliste-example.json`. |
| **Reason** | The brief forbids committing live plant bindings and requires a real sanitized fixture. |
| **Source** | E14 → E15 via `build-oversikt-fixture.py`. |
| **Files** | `build-oversikt-fixture.py` (new), `reference_data/oversikt-10113-sanitized.json` (new) |
| **Status** | **Normative** · `TEMPLATE-10113` |

### 95. `documentation-rules.json` — `panel_types.oversikt`, through its generator

| | |
|---|---|
| **Original** | The machine-readable rule file covered ventilation, list panels and Maskin. It had no Oversikt entry, so no Oversikt rule was queryable or scope-tagged in machine form. |
| **Revised** | `panel_types.oversikt` added, with `owner_document`, `identity`, `canvas`, `composition`, `background`, `z_indexes`, `object_vocabulary`, `cluster`, `coverage`, `input_routing`, `preserve_and_patch`, `anomalies`, `sanitization`, `verification` and `conflicts`; the `TEMPLATE-10113` profile with its measured cluster offsets, the 21-controller inventory and `background.image_data_chars` = 48 210; evidence E14–E17; the scope tags `OVERSIKT` and `TEMPLATE-10113`. |
| **How** | Through `build-oversikt-rules.py`, **not** by hand. Its only flag is `--check`; a bare invocation writes. `--check` is asserted by the test module, so a hand edit or a stale file is a test failure. |
| **Reason** | The brief forbids hand-editing generated artifacts, and a hand fix would be silently reverted on the next regeneration. |
| **Source** | E14/E15. |
| **Files** | `build-oversikt-rules.py` (new), `documentation-rules.json` |
| **Status** | **Normative** · tagged per rule |

### 96. `validate-oversikt-panel.py` — and the mode that catches omission

| | |
|---|---|
| **Original** | No Oversikt validator. An Oversikt could only be checked by reading it, and reading it is exactly what missed twelve controllers. |
| **Revised** | **New validator**, three modes. `--check` (the default, also reachable as a bare path argument) runs `O-S00`–`O-S12` structural and `O-G00`–`O-G07` relationship rules. `--profile TEMPLATE-10113` adds `O-P00`–`O-P08`, which hold a named panel against its recorded controller inventory **with no source file to hand**. `--compare SOURCE.json CANDIDATE.json` adds `O-C00`–`O-C15`: dropped objects, missing controllers, coverage changes, cluster moves, lost bindings, and a dropped or altered background. `--json-report` and `--no-matrix` control output. Exit 1 on any error. |
| **The central design decision** | Matching is **by controller and role**, never by array index — Insert renames every object from the live canvas child index, so two exports of one panel order their objects differently. Matching runs in passes: `unit_id`, then normalized `driver_id` prefix, then binding, then exact position. |
| **`O-G05` is deliberately `info`, not a warning** | A cluster with fewer than four roles is legitimate — 6 of the 21 reference clusters carry alarm plus value only. Making it a warning would push authors to "repair" real panels by inventing bindings, which is the *opposite* failure and is what `O-C05` exists to block. |
| **Reason** | The brief requires the three modes by name, and the incident requires a check that can see absence. |
| **Source** | E14/E15/E16. |
| **Files** | `validate-oversikt-panel.py` (new) |
| **Status** | **Normative** · each rule id carries its own scope |

### 97. `build-oversikt-negatives.py` and `tests/test_oversikt_10113_contract.py` — the contract made executable

| | |
|---|---|
| **Original** | Nothing tested any Oversikt claim. |
| **Revised** | **New generator, seven negatives**, each derived mechanically from E15 with exactly one rule broken: `nine-cluster-reconstruction` (36 objects / 9 clusters — the incident itself), `dashboard-regrouping` (all 72 objects on a 90 px lattice), `cluster-out-of-room` (one cluster moved +400,+300), `duplicate-cluster` (76 objects, one cluster emitted twice), `forced-four-object` (84 objects — the six two-role clusters padded to four), `missing-background` (`image_data` stripped), `stripped-links` (every binding blanked, 72 objects, 1 cluster). **New test module, 56 tests**, asserting that the fixture passes clean, that each negative fails on the rule it was built to break, that matching survives renumbering, and that `build-oversikt-rules.py --check` is up to date. |
| **A deliberate trap in the fixtures** | `forced-four-object` contains driver ids naming parameters those controllers do not expose. It is a negative example; the contract says never to copy an object out of it. |
| **Reason** | The brief requires a real fixture plus negative fixtures, and a contract nobody can run drifts from the code it describes. |
| **Source** | E15 → E17. |
| **Files** | `build-oversikt-negatives.py` (new), `tests/test_oversikt_10113_contract.py` (new) |
| **Status** | **Normative** · `TEMPLATE-10113` |

### 98. `render-oversikt-panel.py` — the preview that shows what a script cannot

| | |
|---|---|
| **Original** | No way to look at an Oversikt without importing it into the Designer. |
| **Revised** | **New renderer.** Emits a self-contained HTML preview at native size with the real embedded background and every object drawn to scale, role-coloured. `--source SOURCE.json` draws the source clusters underneath as dashed ghosts, so a missing or moved cluster is visible at a glance rather than inferred from a report. |
| **Reason** | Stage F of the QA checklist is mandatory and cannot be satisfied by a validator: whether a cluster sits *on its case* is a question about the artwork. |
| **Source** | The same rendering approach as `render-maskin-panel.py`. |
| **Files** | `render-oversikt-panel.py` (new). Its output matches `.gitignore`'s `*-preview.html` and is deliberately not committed. |
| **Status** | **Normative** · `OVERSIKT` |

### 99. `CLAUDE.md` — routing, five host facts, and the two-scope case cluster

| | |
|---|---|
| **Original** | The case cluster appeared once, as a single set of offsets with no scope tag, alongside a CLUSTER KIT grid presented as an equally valid way to lay a panel out. Nothing said which was a finished panel and which was a tray of parts. |
| **Revised** | A new Oversikt section: a routing table naming the one live owner of each rule, the three carried rules (preserve-and-patch; a PDF may name equipment but may never reduce the panel; coverage is derived, never forced to four), and **five host facts** — the per-panel-type z-bands (110 value box, 375 all circular symbols, no `"default"`); `linked="true"` set on load whenever `driver_id !== "driver_id"` (`V3scripts.js:514`), with all 72 reference objects linked; that a production export never emits the literal `"driver_id"`, which is why this fixture is masked rather than unlinked; `image_svg_trace` as input never output; and Insert renaming objects from the live canvas child index, so comparison is by controller and role. The production-conventions paragraph now carries **both** measurements side by side, tagged `FLEET-194` and `TEMPLATE-10113`, with an explicit instruction not to average them, and re-scopes the 90 px grid to the CLUSTER KIT hand-off. §17b gains a fixture bullet stating that 72 objects and 21 clusters are the measurement of one store, not a design target. |
| **Reason** | Deliverable 6 of the brief: route Oversikt tasks to the new files, and consolidate contradictory rules without blending them. |
| **Source** | E14/E15; `V3scripts.js` and the userscript for the host facts. |
| **Files** | `CLAUDE.md` |
| **Status** | **Normative** · scoped per statement |

### 100. `AI-BRIEFING.txt` — §7b re-owned, MODE D gated, and a new self-check block

| | |
|---|---|
| **Original** | §7b owned the Oversikt rules outright. MODE B emitted a 90 px grid with no statement that a grid is not a finished panel. **MODE D applied whenever a byggeplan was uploaded — with no clause excluding the case where a production export was also supplied.** That is the loophole the incident went through. |
| **Revised** | The front-matter ownership table routes Oversikt geometry, authoring, QA, validation and Copilot use to the new files, and the reprint note now names `OVERSIKT-GENERATION-CONTRACT.md` as the winner for §7b numbers. §0 rank 3 names the contract. §7b gains an `OVERSIKT OWNER:` block and a rule that outranks every mode below it: **PRESERVE AND PATCH, NEVER REBUILD**, plus *"fewer positions in the drawing than in the JSON means the DRAWING is incomplete"* and *"an Oversikt is a MAP, not a dashboard"*. MODE B states that a kit is a hand-off and must be labelled one. MODE D is gated on **AND NO PRODUCTION EXPORT OF THE PANEL EXISTS**, its step 3 forbids forcing four objects per controller, and a new step 3b requires the result to be labelled a draft. THE CASE CLUSTER becomes two explicitly scoped measurement blocks with `NEVER AVERAGE THEM`, followed by `COVERAGE IS DERIVED, NEVER FORCED TO FOUR`, `CLUSTERS ARE ATOMIC AND SPATIAL` and the Oversikt z-bands. A new 13-item `OVERSIKT (7b) ONLY` self-check block ends with the rule that a clean `--check` alone cannot see a missing cluster. |
| **Reason** | Same deliverable. The gate on MODE D is the most load-bearing edit in this pass: without it, the briefing still authorizes rebuilding a supplied panel from a drawing. |
| **Source** | E14/E15/E16. |
| **Files** | `AI-BRIEFING.txt` |
| **Status** | **Normative** · `OVERSIKT`, with the measurement blocks tagged `FLEET-194` and `TEMPLATE-10113` |

### 101. `PANEL-TYPE-GUIDE.md` — routing plus the not-always-four rule

| | |
|---|---|
| **Original** | The Oversikt section described the panel type and implied a four-object cluster. |
| **Revised** | A routing blockquote naming the one owner of each rule and four override rules, plus a sub-bullet — **"Not always four"** — recording that 15 of the 21 reference clusters carry all four roles and 6 carry alarm plus value only, and an extension stating that the background owns the static store while objects own the live symbols. |
| **Reason** | Same deliverable. The guide is the file an agent reads when identifying a panel type, so it must not imply a coverage quota. |
| **Source** | E15. |
| **Files** | `PANEL-TYPE-GUIDE.md` |
| **Status** | **Normative** · `OVERSIKT` |

### 102. `AI-AGENT-INSTRUCTIONS.txt` — Oversikt routing inside the 8 000-character cap

| | |
|---|---|
| **Original** | The capped instructions file mentioned Oversikt only inside HOUSE STYLE, and carried two rules that now contradict the contract: **MODE B** emitted a 90 px cluster grid with no kit label, and **MODE D** applied to any byggeplan upload with no export exclusion, telling the agent to draw a simplified plan and place one cluster per position. An agent loading only this file had no route to any Oversikt document. |
| **Revised** | A new OVERSIKT paragraph: map-not-dashboard, routing to `OVERSIKT-COPILOT-PREFLIGHT.md` and the contract, preserve-and-patch, the PDF-may-not-reduce rule, derived coverage, the z-bands, the fixture with its counts labelled evidence rather than a target, and `validate-oversikt-panel.py` with `--compare` whenever a source exists. MODE B now ends *"A KIT IS A HAND-OFF: label it a kit, never deliver a grid as a finished Oversikt"*; MODE D is gated on **NO EXPORT OF THE PANEL EXISTS**, requires a DRAFT label, and says to patch the export instead when one is in hand. |
| **Character budget** | The file was **7 965 characters (worst-case CRLF 7 998)** — two characters under the cap, so the addition had to be paid for. Seven reprint passages were cut or shortened, every one of them owned by a contract the same paragraph already routes to: the vent connector-direction sentence, the bell-offset sentence, the vent z-band enumeration, the vent composition sentence, the unlinked-demo restatement (also in LINKING and briefing 8b), the five overlap classes, and the x411 bypass detail; the vent request-class list and the Maskin case-naming clause were shortened. Net **7 938 characters, worst-case CRLF 7 973**, 27 characters of headroom, **0** angle brackets. |
| **Reason** | The brief requires contradictory Oversikt rules to be consolidated. Both edited clauses were live, and MODE D's missing exclusion is the loophole the incident used. |
| **Source** | E14/E16; the cap and the `<`/`>` restriction are recorded in Part 1. |
| **Files** | `AI-AGENT-INSTRUCTIONS.txt` |
| **Status** | **Normative** · `OVERSIKT`; the cut passages remain owned by `VENTILATION-GEOMETRY-CONTRACT.md` |

### 103. What was deliberately left alone

| | |
|---|---|
| **Decision** | `reference_data/panel-conventions.json` was **not** edited, even though its case-cluster offsets disagree with the measured ones. |
| **Reason** | It is a survey artifact: a median over 28 clusters mined from 16 stores. Overwriting it with one store's geometry would destroy the only fleet-level evidence in the repository and would be exactly the averaging the brief forbids. The disagreement is recorded as `OV-C1` and `OV-C3` with both scopes named. |
| **Decision** | `AI-BRIEFING-REVISED.txt`, `AI-AGENT-INSTRUCTIONS-REVISED.txt` and `CLAUDE-REVISED.md` were **not** given Oversikt content and were not promoted. |
| **Reason** | Same as change 89: they are change records or proposals per their own status headers. Mirroring Part 7 into them would create the second competing contract the brief forbids. |
| **Files** | none |
| **Status** | **Advisory** · `GLOBAL` |

---

## Conflicts resolved

Recorded in full in [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) §12.
**No conflict was resolved by averaging.**

| Id | Conflict | Decision |
|---|---|---|
| **OV-C1** | `panel-conventions.json` case-cluster offsets — alarm (12,0), temp box (7,22), cooling (10,35), defrost (28,38), footprint ~62 × 66 — against E15 measured: alarm (4,0), value (0,35), cooling (7,58), defrost (7,58), footprint 42 × 86 | Both kept, tagged `FLEET-194` and `TEMPLATE-10113`. The fleet figure is a median across 16 stores and is the geometry of no single panel — it even separates cooling and defrost, which on E15 are exactly coincident. When an export is supplied, its own offsets win; the fleet figure is for a store with no export |
| **OV-C2** | `panel-conventions.json` and `AI-BRIEFING.txt` §7b MODE B lay clusters out on a 90 px grid; the contract requires every cluster to sit on the case or room it monitors | Scoped, not merged. The grid is legitimate for the **CLUSTER KIT** deliverable and only there, **and a kit must be labelled a kit**. A panel delivered as an Oversikt is spatial; a grid of cards is a defect. `O-G06` is the check that separates them |
| **OV-C3** | `panel-conventions.json` records 11 occurrences of a 3-member cluster without the cooling symbol; E15 carries 6 occurrences of a 2-member cluster, alarm plus value only | Both are real and neither generalizes. The rule that does generalize is the one both support: **cluster membership is whatever the controller exposes, read from the source rather than assumed** |

---

## Verification run for Part 7

All commands run from `iwmac-designer-reference/`.

| Command | Result |
|---|---|
| `python -m unittest tests.test_oversikt_10113_contract` | Ran 56 tests in 0.126s — **OK** |
| `python -m unittest tests.test_maskin_10229_contract tests.test_maskin_compressor_bank tests.test_list_panel_contract tests.test_ventilation_profile_9099 tests.test_build_ventilation_corpus` | Ran 188 tests in 0.555s — **OK**, no regression in any earlier panel type |
| `python build-oversikt-rules.py --check` | `documentation-rules.json is up to date` |
| `python build-maskin-rules.py --check` | `documentation-rules.json is up to date` — the Oversikt block did not disturb the Maskin one |
| `python validate-oversikt-panel.py reference_data/oversikt-10113-sanitized.json` | **0 errors, 2 warnings**, exit 0 |
| `python validate-oversikt-panel.py reference_data/oversikt-10113-sanitized.json --profile TEMPLATE-10113` | **0 errors, 2 warnings**, exit 0 |
| `python validate-oversikt-panel.py --compare reference_data/oversikt-10113-sanitized.json reference_data/oversikt-10113-sanitized.json` | **0 errors, 2 warnings**, exit 0 — the legitimate case: all 21 clusters present, the 6 two-role clusters untouched |
| `python build-oversikt-negatives.py --out survey-tmp/oversikt-negatives` | 7 fixtures written |

The two warnings on the clean runs are `O-G07` overlaps — `object_13`/`object_61`
and `object_15`/`object_61` — two genuine adjacencies preserved from production,
recorded in contract §9 and **not corrected**. The clean runs also print
`INFO O-G05`, naming the six legitimate two-role clusters, and `INFO O-G00`,
which states the per-type counts and labels them *evidence, not targets*.

Every negative, in `--compare` against the fixture. All exit 1.

| Negative | Result | The rule that caught it |
|---|---|---|
| `nine-cluster-reconstruction` (36 objects / 9 clusters) | 2 errors | `O-C03` *"12 of 21 source controller cluster(s) are missing entirely: 000:001, 000:002, 000:010, 000:066, 000:067, 000:085, C50, C51, C52, U86, U87, U88"*; `O-C01` names the 36 dropped objects |
| `dashboard-regrouping` (72 objects on a lattice) | 22 errors | `O-G06` *"21 clusters sit on a regular lattice: 6 column(s) {90}px apart, 4 row(s) {90}px apart"*, plus 21 × `O-C06` for the moved clusters |
| `cluster-out-of-room` | 1 error, 2 warnings | `O-C06` *"controller 000:030 moved by (+400,+300) from (295, 116) to (695, 416)"* |
| `duplicate-cluster` (76 objects) | 3 errors, 4 warnings | `O-G03`, `O-G04`, and `O-C05` reporting one controller covered twice |
| `stripped-links` (72 objects, 1 cluster) | 4 errors, 2 warnings | `O-G01` *"72 object(s) carry neither a unit_id nor a usable driver_id"*, `O-C03` 21 of 21, `O-C07` *"72 object(s) lost their driver binding"*, `O-C08` |
| `missing-background` | 2 errors, 3 warnings | `O-S07` *"no embedded background"*, `O-C13`, and `O-C14` on `panel.converted` |
| `forced-four-object` (84 objects) | 6 errors, 7 warnings | six × `O-C05`, one per padded controller — C50, C51, C52, U86, U87, U88 — each stating that four objects per controller is not a rule |

**The nine-cluster reconstruction passes a bare `--check`.** It has valid
structure, a real background, the correct object vocabulary, clean bindings and
no overlaps. Only `--compare` or `--profile TEMPLATE-10113` catches it. That
asymmetry is stated in the contract, the guide, the checklist, the preflight and
the briefing self-check, because it is the whole lesson of the incident.

Visual QA ran through `render-oversikt-panel.py` at native 1400 × 750 on the real
background. It confirms what no validator can: every cluster sits on a drawn case
or room outline, the two `O-G07` overlaps are two cases standing close on the
plan rather than a placement error, and the 15 coincident cooling/defrost pairs
render as one symbol position per controller, which is what the host intends.

---

## Files changed in Part 7

| File | Change | Existed before? |
|---|---|---|
| `OVERSIKT-GENERATION-CONTRACT.md` | **New.** Measured-geometry owner, 15 sections (90, 103) | No |
| `OVERSIKT-AUTHORING-GUIDE.md` | **New.** 11 steps, the hard stop, failure catalogue (91) | No |
| `OVERSIKT-QA-CHECKLIST.md` | **New.** Stages 0 and A–G; the render is mandatory (92) | No |
| `OVERSIKT-COPILOT-PREFLIGHT.md` | **New.** 20-item short form, 9 760 chars (93) | No |
| `build-oversikt-fixture.py` | **New.** Masking sanitizer, E14 → E15, plus `--report` (94) | No |
| `reference_data/oversikt-10113-sanitized.json` | **New.** 72 objects, 21 clusters, plant masked (94) | No |
| `build-oversikt-rules.py` | **New.** Generator for `panel_types.oversikt` (95) | No |
| `documentation-rules.json` | `panel_types.oversikt`, the `TEMPLATE-10113` profile, evidence E14–E17, two scope tags — regenerated, not hand-edited (95) | Yes |
| `validate-oversikt-panel.py` | **New.** `O-S*` / `O-G*` / `O-P*` / `O-C*`; `--check`, `--compare`, `--profile` (96) | No |
| `build-oversikt-negatives.py` | **New.** Seven negatives, one broken rule each (97) | No |
| `tests/test_oversikt_10113_contract.py` | **New.** 56 tests (97) | No |
| `render-oversikt-panel.py` | **New.** Native-size preview, `--source` ghost overlay (98) | No |
| `CLAUDE.md` | Oversikt routing plus five host facts; the case cluster given two scopes; §17b fixture bullet (99) | Yes |
| `AI-BRIEFING.txt` | Ownership table, §0 rank 3, §7b owner block and preserve-and-patch rule, MODE B kit label, MODE D export gate and draft label, two scoped measurement blocks, the Oversikt self-check block (100) | Yes |
| `PANEL-TYPE-GUIDE.md` | Routing blockquote and the not-always-four rule (101) | Yes |
| `AI-AGENT-INSTRUCTIONS.txt` | Oversikt routing added inside the cap; MODE B and MODE D corrected; seven reprint cuts to pay for it (102) | Yes |
| `documentation-change-log.md` | This part; evidence E14–E17 and two scope tags added at the head | Yes |
| `reference_data/panel-conventions.json` | **Untouched**, deliberately (103) | Yes |
| `AI-BRIEFING-REVISED.txt`, `AI-AGENT-INSTRUCTIONS-REVISED.txt`, `CLAUDE-REVISED.md` | **Untouched**, deliberately (103) | Yes |

The preview HTML produced by `render-oversikt-panel.py` matches `.gitignore`'s
`*-preview.html` and is not committed; it is regenerated on demand.

---

## What Part 7 deliberately did not do

- **Did not invent a coordinate, `obj_id`, driver id, unit id, alias, plant id or
  navigation target.** Every number in the contract is measured on E15 and can be
  re-derived with `build-oversikt-fixture.py --report`.
- **Did not generalize one export.** Every coordinate is tagged
  `TEMPLATE-10113`. Only behaviour independently confirmed as a property of store
  overviews is tagged `OVERSIKT`. There is exactly one measured Oversikt profile,
  and the contract says so.
- **Did not average a conflicting value.** `OV-C1`–`OV-C3` each name a winner or
  keep both under different scopes. The fleet median and the measured geometry
  stand side by side in every file that quotes either.
- **Did not present a count as a target.** 72 objects, 21 clusters, 15 four-role
  clusters, 6 two-role clusters and the 28 fleet occurrences are each annotated
  where they appear as the measurement of a specific corpus. `O-G00` prints the
  same caveat at runtime.
- **Did not correct a production anomaly.** The 15 coincident cooling/defrost
  pairs, the cluster whose alarm sits below its value box, the 21 single-space
  `tag_text` values and the two cross-controller overlaps are preserved in the
  fixture and reported in contract §9.
- **Did not commit the supplied export or either failed attempt.** E14 and E16
  stay outside the repository. E15 reproduces every measurement without a plant
  id or a live driver id, and E17 reproduces both failure shapes synthetically.
- **Did not introduce a dark background.** The fixture carries the original light
  store-plan raster byte-identical, and every document that mentions artwork says
  light store-plan only.
- **Did not touch the fleet survey.** `panel-conventions.json` keeps its median;
  overwriting it with one store's numbers would have destroyed the only
  fleet-level evidence here.
- **Did not resolve nine open evidence items.** Contract §15 lists them with what
  would settle each: a second Oversikt export, the fleet survey's source exports,
  an Oversikt carrying a navigation object, the parameter dump for the six
  two-role controllers, an Oversikt on another canvas, confirmation of the two
  overlaps against a store plan, the origin of the single-space `tag_text`, the
  incident's PDF, and a byggeplan-derived Oversikt. A stated gap is a
  deliverable; a guess is not.

---

# Part 8 — 2026-08-10: the room-control table (Tabell romkontroll alle plan) generation contract

A separate pass with its own brief and its own evidence. It changes no
ventilation, Maskin or Oversikt rule, and it changes no list-panel rule either —
it adds three **scope statements** to the list contract that say where the LIST
family ends (change 114). Conflict ids are `RC-C1`–`RC-C5` and refer to the table
in [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) §12.
Validator rule ids are `R-S*` (structural), `R-T*` (table relationships), `R-B*`
(bindings), `R-P*` (profile-scoped) and `R-C*` (source-versus-candidate
comparison). `R-B*` is new to this pass: no earlier panel type has a mode
discriminator, because no earlier failure was *an unlinked file delivered as a
linked one*.

Evidence: **E18**–**E21** in the table at the head of this file. E18 is the
known-good export supplied with the task. Per the brief's first quality
constraint it was **not modified**, and being a live plant id with 1 551 real
driver ids it is not committed either, so every measurement below is reproduced
from **E19**, which is E18 masked and is in the repository. E20, the plant's
parameter dump, is what makes the verbatim-copy rule checkable.

**Source precedence used**, highest first — the repository's own list, not a new
one: the export supplied with the task (E18) → the parameter dump (E20) → the
host behaviour recorded in `CLAUDE.md` → the panel-type contract →
`AI-BRIEFING.txt` → `PANEL-TYPE-GUIDE.md` → `DESIGN-OBJECT-CATALOG.md` (valid
vocabulary only) → generic design advice. No coordinate was averaged. Geometry is
tagged `TEMPLATE-8653-ROMKONTROLL`; only behaviour confirmed as a property of
room-control tables is tagged `ROMKONTROLL`.

**The failure this pass exists to prevent is not a malformed panel, and not a
panel missing half the building — it is a request that was never routed.** The
first rejected generation answered "trenger .json fil" by serializing its own
analysis into a schema it invented. The second answered a linked-panel request
with the unlinked mode-B template, faithfully, because that was the only object
template its instructions carried. Neither failure is reachable by a schema
check: by the time a validator runs, the wrong deliverable already exists. That
is why the first new file in this pass is a routing document and not a contract,
and why change 116 spends 8 000-character-cap budget on a route rather than on
more facts.

---

## Rules changed

### 104. `AI-REQUEST-ROUTING.md` — a `GLOBAL` owner for "which deliverable is this?"

| | |
|---|---|
| **Original** | Nothing owned intent routing. `PANEL-TYPE-GUIDE.md` routes between panel *types* — but only once it is already settled that a panel is wanted. `AI-BRIEFING.txt` opens by assuming it ("You generate IWMAC Designer panel files"). No document anywhere said what to do with *"trenger .json fil"*, *"generer en Tabell romkontroll alle plan"*, or *"create a room-control table panel from this SQL export"*. |
| **Problem found** | Both 2026-08-10 failures (E21) happened before any rule in this repository could apply. §13 of the contract traces them: failure 1 produced a correct room analysis in a custom schema, failure 2 produced a correct envelope with placeholder contents. Every document that could have stopped either one is a document neither request ever reached. |
| **Revised** | **New file, 230 lines.** A search-terms header naming the phrasings the page must answer to, in Norwegian and English; **§1** the routing trigger and its vocabulary; **§1.1** the two verbatim route statements; **§1.2** context inheritance — a `.json` request inside a panel conversation inherits the panel task; **§1.3** when it really *is* a data request, so the rule cannot be read as "never emit data"; **§2** which panel type, as a discriminator on the shape of the source rather than on the word used; **§3** which output mode; **§4** do not invent, normative for every panel type; **§5** before generating; **§6** after generating; **§7** owners. |
| **The two statements are reproduced word for word** | *"If a user asks for a .json file after discussing an IWMAC panel, preserve the panel context and generate an iwmac-designer-panel document. Do not serialize the source data into a custom JSON schema."* and *"If a known-good export is attached, inspect it before generating or modifying the panel. Use it as the panel-type example and preserve its structural conventions unless a normative contract requires otherwise."* They are quoted, not paraphrased, because they are the strings a retrieval index has to match. |
| **Mode C is the default** | §3 makes the linked panel the default output whenever a plant parameter dump is attached, and says so in one sentence at the top of the section rather than as a consequence to be derived. Failure 2 is exactly the derivation not being made. |
| **Reason** | The brief requires intent routing to be owned, discoverable by keyword, and sufficient on the first page. One owner per rule means this cannot live as a paragraph in four files. |
| **Source** | E21 for the failure shapes; the trigger vocabulary from the request wordings recorded in the task; the mode-C default from E18 + E20. |
| **Files** | `AI-REQUEST-ROUTING.md` (new) |
| **Status** | **Normative** · `GLOBAL` — it owns routing for every panel type, not just this one |

### 105. `ROMKONTROLL-GENERATION-CONTRACT.md` — a new owner for measured room-control-table geometry

| | |
|---|---|
| **Original** | No document owned this panel type. The word *romkontroll* in the repository meant the **hotel floor plan** (`AI-BRIEFING.txt` §7d, `rc_*` card objects over a drawing). A "tabell romkontroll alle plan" request therefore landed on the floor-plan rules, on the spjeldliste rules, or on nothing. |
| **Problem found** | The panel type that produced the incident had no owner, no example, no vocabulary and no validator, while sharing its name with a panel type that has all four. |
| **Revised** | **New file, 1 056 lines / 65 604 characters, 16 sections.** Routing and the companion table (which source is authoritative for which *kind* of fact); source precedence, scope tags and evidence; **§1** what this panel type is, with a classification test to run first and an explicit list of what it may not be; **§2** the envelope, every field classified; **§3** all 17 `single_objects` fields with real examples, the seven constants, and §3.1 on `linked` being host behaviour rather than an assertion; **§4** the container and its 1 802 items; **§5** object selection by signal role, with §5.1 the measured alarm rule; **§6** geometry — origin, columns, rows and header bands, where an object sits inside its cell, z-index, rooms and floors, missing signals; **§7** verbatim extraction from `iw_gen_driver_parameters`, with the cross-check and encoding; **§8** viewport versus content extent; **§9** the measured column → signal map; **§10** the three output modes; **§11** the validation contract, including §11.6 on what the validator cannot see; **§12** conflicts `RC-C1`–`RC-C5`; **§13** the two rejected generations traced defect by defect; **§14** regression tests; **§15** the scope summary; **§16** nine open evidence items, each with what would settle it. |
| **Reason** | The brief requires one live owner per rule, a documented envelope, all 17 fields, object-selection rules by signal role, exact parameter extraction and the across-all-floors table rules. Splitting them across existing files would have produced the third description of the same panel that `OV-C1` already shows is how contradictions start. |
| **Source** | E18, reproduced from E19; E20 for §7; `container_tool.js` and `V3scripts.js` for host behaviour, cited by line. |
| **Files** | `ROMKONTROLL-GENERATION-CONTRACT.md` (new) |
| **Status** | **Normative** · `ROMKONTROLL` and `TEMPLATE-8653-ROMKONTROLL`, tagged per rule |

### 106. `ROMKONTROLL-AUTHORING-GUIDE.md` — the procedure, with the fifteen questions inside it

| | |
|---|---|
| **Original** | No procedure existed for this panel type. |
| **Revised** | **New file, 233 lines, six sections:** what you need before starting; **§2 the pre-generation checklist — fifteen questions, answered in writing before a single object is emitted**; building a new table; copying a table to another plant; editing a supplied export; **§6 the post-generation acceptance gate**. |
| **The fifteen questions** | They are ordered so that the ones that change the deliverable come first — is this a table or a floor plan, is a dump attached, is a known-good export attached, is the output linked or a template — and the geometry questions come last. A question that cannot be answered is a **stop**: the deliverable is then the answered subset plus the named gap, the same shape of rule as the Oversikt guide's step-3 hard stop (change 91). |
| **The acceptance gate** | §6 requires the **actual downloadable `.json` file** as the deliverable. An answer that describes the panel, summarizes it, links to it, or offers to produce it on request does not pass the gate — which is the discipline `E8` established for list panels, restated here because the incident's first failure was a file that *was* produced and was the wrong document. |
| **Reason** | The brief requires a pre-generation checklist and a post-generation acceptance gate as separate artifacts. Procedure and measured geometry rot at different rates; Parts 6 and 7 separated them for the same reason. |
| **Source** | E18/E19/E20 for every value quoted; the procedure from the host behaviour in `CLAUDE.md`. |
| **Files** | `ROMKONTROLL-AUTHORING-GUIDE.md` (new) |
| **Status** | **Normative** · `ROMKONTROLL` |

### 107. `ROMKONTROLL-QA-CHECKLIST.md` — eight stages, starting before generation

| | |
|---|---|
| **Original** | No QA document for this panel type. The implicit bar was "the JSON parses and inserts" — which **both** failed generations clear, the first because a dataset is valid JSON and the second because a placeholder panel is a valid panel. |
| **Revised** | **New file, 178 lines.** **Stage 0 — routing, before anything is generated**; Stage 1 the file parses and is the right document; Stage 2 objects are well formed; Stage 3 the table is a table; Stage 4 bindings are real; Stage 5 comparison with the known-good example; Stage 6 profile (same plant only); Stage 7 delivery. It closes with *"The two failures this checklist exists to catch"*, which names for each failure the stage that stops it **and the rules that stay silent, with the reason each one is silent**. |
| **Stage 0 is the whole point** | Every other stage in every QA document in this repository runs on an artifact. Stage 0 runs on the *request*. A checklist that begins after generation cannot catch a routing failure, and both incidents were routing failures. |
| **The rule this pass then applied to itself** | Stage 4 states that when the checklist and the validator disagree, the **measurement wins and the document is corrected** — the validator is never relaxed to match the prose. Change 118 records where this pass had to obey its own rule. |
| **Reason** | The brief requires an enumerated acceptance gate and forbids weakening validation to make generated files pass. |
| **Source** | The repository's own QA convention (changes 92, and the Maskin checklist before it); the rule ids are the measured ones from the runs in this file. |
| **Files** | `ROMKONTROLL-QA-CHECKLIST.md` (new) |
| **Status** | **Normative** · `ROMKONTROLL` |

### 108. `ROMKONTROLL-COPILOT-PREFLIGHT.md` — the retrieval-friendly short form

| | |
|---|---|
| **Original** | Nothing equivalent for this panel type; the ventilation, Maskin and Oversikt counterparts already existed. |
| **Revised** | **New file, 170 lines, three blocks.** **Block A** is the text to paste into a Copilot prompt: routing, the two-layer rule, the container, the verbatim-identifier rule, the viewport rule, output modes, the object vocabulary and the deliverable. **Block B** names the failure modes explicitly — dataset-instead-of-panel, placeholder-instead-of-linked, compressed-to-viewport, constructed driver ids, one container per row. **Block C** is the self-check to require *in the answer*, so the assistant reports its own counts rather than being asked for them afterwards. It closes with what to upload alongside it. |
| **Size** | **8 027 characters** (worst-case CRLF 8 197), 11 angle brackets. It is a knowledge file, not the instructions field, so the 8 000-character cap does not apply — the same distinction recorded for `OVERSIKT-COPILOT-PREFLIGHT.md` in change 93. Only `AI-AGENT-INSTRUCTIONS.txt` is capped. |
| **Discoverability** | Block A opens with the search terms from `AI-REQUEST-ROUTING.md` so that a retrieval index which surfaces only one room-control file surfaces one that routes correctly. |
| **Reason** | The brief requires Copilot discoverability terms and a short form an agent can carry whole. |
| **Source** | A compression of changes 104–107; every number in it is E18/E19/E20. |
| **Files** | `ROMKONTROLL-COPILOT-PREFLIGHT.md` (new) |
| **Status** | **Normative** · `ROMKONTROLL` — a summary of owned rules; the contract wins on conflict |

### 109. `reference_data/romkontroll-8653-sanitized.json` — masked, deliberately not unlinked

| | |
|---|---|
| **Original** | No room-control table of any kind was committed. Nothing in the repository showed what one looks like, which is why the brief's "use this good panel as the example" had nothing to point at. |
| **Revised** | **New fixture, 1 275 328 bytes**, generated by `build-romkontroll-fixture.py` from E18. Preserved exactly: all 1 553 `single_objects` with `obj_id`, geometry, sizes, `zIndex`, `tag_text`, `alias_text`, `unit_id`, `linked "true"` and array order; the single `table_container` with all 22 keys (`unique_id "custom_0"`, `zIndex 4`, `num_of_col "34"`, `num_of_rows "50"`, `descr_width "300"`, `val_width "100"`, `last_y "1625"`); all 1 802 container items with `zIndex "5"`, `driver_id ""`, `link_tag "NA"`, `alias_text "new text"`; and the background. Masked: the plant number inside every driver id → `NNNN`. Blanked: `plant_id`, `source_plant_id`, `saved_by`, `org_image_name`, `image_name`. |
| **Why masked and not unlinked** | Same reasoning as change 94, and stronger here. `build-maskin-fixture.py` replaces every binding with the literal `"driver_id"` — right for a geometry template, wrong for a fixture whose job is to prove that **50 rooms × 34 columns survive a round trip**. Room identity lives in `unit_id` and in the driver id; blanking them would delete the structure the fixture exists to carry, and would additionally make the fixture indistinguishable from failure 2. |
| **Anomalies preserved, not corrected** | The two objects that carry no binding at all, the three annotation objects that sit below the last row (`object_1550`–`object_1552`, the manual-reset cluster), the `number_v3_60px_json_obj` used once, and the two `zIndex "1100"` objects are all kept as they are in production and reported by the validator as warnings. Correcting a production anomaly in a reference fixture teaches the anomaly is a defect. |
| **Reason** | The brief forbids committing live plant bindings and requires a real reference example rather than a duplicated export. |
| **Source** | E18 → E19 via `build-romkontroll-fixture.py`, whose `--report` re-derives every count in the contract. |
| **Files** | `build-romkontroll-fixture.py` (new, 752 lines), `reference_data/romkontroll-8653-sanitized.json` (new) |
| **Status** | **Normative** · `TEMPLATE-8653-ROMKONTROLL` |

### 110. `documentation-rules.json` — `panel_types.romkontroll_table`, through its generator

| | |
|---|---|
| **Original** | The machine-readable rule file covered ventilation, list panels, Maskin and Oversikt. It had no room-control-table entry, so no rule of this panel type was queryable or scope-tagged in machine form. |
| **Revised** | `panel_types.romkontroll_table` added with 22 keys: `identity`, `owner_document`, `companion_documents`, `canvas`, `viewport_versus_content`, `composition`, `z_indexes`, `object_fields`, `object_vocabulary`, `object_selection`, `container`, `table`, `rooms`, `identifiers`, `output_modes`, `input_routing`, `preserve_and_patch`, `sanitization`, `verification`, `conflicts`, `rejected_generations`, `anomalies`. Plus the `TEMPLATE-8653-ROMKONTROLL` profile with its measured column set, row pitch and counts; evidence `E18`–`E21`; and the scope tags `ROMKONTROLL` and `TEMPLATE-8653-ROMKONTROLL`. |
| **How** | Through `build-romkontroll-rules.py`, **not** by hand — 1 152 lines, `--check` its only flag, a bare invocation writes. `--check` is asserted by the test module, so a hand edit or a stale file is a test failure. `build-oversikt-rules.py --check` and `build-maskin-rules.py --check` still report up to date, so the new block disturbed neither. |
| **Reason** | The brief forbids hand-editing generated artifacts. The file's own `_note` says the same thing. |
| **Source** | E18/E19/E20. |
| **Files** | `build-romkontroll-rules.py` (new), `documentation-rules.json` |
| **Status** | **Normative** · tagged per rule |

### 111. `validate-romkontroll-panel.py` — five rule namespaces, four modes, and a mode discriminator

| | |
|---|---|
| **Original** | No validator for this panel type. A room-control table could only be checked by reading it, and reading a 1 553-object grid is exactly the check that does not happen. |
| **Revised** | **New validator, 1 444 lines.** `--check` (the default, also reachable as a bare path argument) runs the `R-S*` structural and `R-T*` table rules plus `R-B*` bindings. `--profile TEMPLATE-8653-ROMKONTROLL` adds `R-P*`, holding a named panel against its recorded column and room inventory **with no source file to hand**. `--compare SOURCE.json CANDIDATE.json` adds `R-C*`: dropped objects, dropped or altered container, missing columns, missing rooms, moved cells, lost bindings, envelope drift. `--source-sql dump.sql` adds `R-B6`, which resolves every binding against `iw_gen_driver_parameters`. |
| **Matching is by room and column, never by array index** | Insert renames every object from the live canvas child index, so two exports of one panel order their objects differently. `R-C5` reports median cell displacement, which is 0,0 for a faithful copy and undefined — not zero — when there is no grid to compare. |
| **`R-B1` reports the output mode instead of demanding bindings** | `Panel.mode()` returns `"C"` (linked), `"B"` (template), `"mixed"`, `"unbound"` or `"empty"`, and `R-B1` errors **only** for `"unbound"`. A file where every object is placeholdered is a legitimate mode-B template; it is wrong as an answer to a linked-panel request, and that wrongness is a **routing** verdict, made before the validator runs. `R-B3` is what fires the moment placeholders and real ids are mixed. This asymmetry is stated in the contract, the guide, the checklist and the preflight, because reading it as "the validator will catch failure 2's placeholders" is precisely the mistake change 118 records. |
| **The allowlist was widened by evidence, and only by evidence** | `load_allowlist()` resolves `R-S12` against the **union** of `all-design-objects.json` (797 palette ids) and `controls-registry.json` (1 769 render definitions, 991 of them palette-less), and emits a note naming any registry-only id rather than passing over it silently. An id in neither source is still an error; the 39 ids the catalogue marks `Inactive_IBT` / `Outdated____IBT` are still rejected. This is conflict `RC-C2`, and it is a widening by measurement — `number_v3_cell_grey25` appears 1 700 times on a production export — not a check relaxed to make a file pass. |
| **Reason** | The brief requires a deterministic validator plus a comparison mode against the known-good fixture, and forbids weakening validation. |
| **Source** | E18/E19/E20/E21. |
| **Files** | `validate-romkontroll-panel.py` (new) |
| **Status** | **Normative** · each rule id carries its own scope |

### 112. `build-romkontroll-negatives.py` and `tests/test_romkontroll_8653_contract.py` — the contract made executable

| | |
|---|---|
| **Original** | Nothing executable existed for this panel type, and the two failures existed only as prose in the task. |
| **Revised** | **`build-romkontroll-negatives.py`** (356 lines) derives **nine** negatives from E19, one broken rule each: `dataset-not-a-panel` and `placeholder-overview` reproduce the two real failures; `column-dropped`, `compressed-to-viewport`, `container-dropped`, `constructed-driver-ids`, `half-linked`, `non-custom-unique-id` and `text-sorted-rooms` reproduce the failure modes the contract predicts. **`tests/test_romkontroll_8653_contract.py`** (864 lines) runs **97 tests**: the fixture's measured anatomy, the rules file being current, every negative's exact error set, and the two failures' rule ids. Five tests skip unless `IWMAC_ROMKONTROLL_SQL` points at E20, which is not committed. |
| **The regression test the brief asked for** | `--compare` of E19 against itself is asserted clean, which is the "regression test using the attached export" in the form the repository can actually carry: E18 cannot be committed, E19 is E18 with the plant masked, and the SQL-backed assertions run whenever the dump is present and skip loudly when it is not. |
| **The one honest asymmetry** | `constructed-driver-ids` **passes** `--check`, `--profile` and `--compare` — 0 errors, exit 0. A fabricated but well-formed driver id is indistinguishable from a real one without the dump. With `--source-sql` it fails immediately: `R-B6  1551 driver_id(s) do not exist in the dump - constructed, adapted from another plant, or invented`. This is stated in the contract §11.6, in QA stage 4 and in `R-B1`'s own runtime note, because a validator that is quiet about what it cannot see is worse than no validator. |
| **Reason** | The brief requires validator/test updates and a regression test built on the attached export. |
| **Source** | E19 for every negative; E20 for the five skipped tests; E21 for the two reproduced failures. |
| **Files** | `build-romkontroll-negatives.py` (new), `tests/test_romkontroll_8653_contract.py` (new) |
| **Status** | **Normative** · `ROMKONTROLL` |

### 113. `CLAUDE.md` — the routing block, the fixture bullet, and five host facts

| | |
|---|---|
| **Original** | The kit list opened with `AI-BRIEFING.txt`. Nothing routed a request before it, and nothing in the file mentioned a room-control table; `romkontroll` appeared only as the hotel floor plan in the §17b hotel anatomy. |
| **Revised** | Three additions. (1) `AI-REQUEST-ROUTING.md` is now the **first** entry in the kit list, labelled *"read this one first"*, with one sentence on why it exists: both 2026-08-10 failures were routing failures, not schema failures. (2) A `reference_data/romkontroll-8653-sanitized.json` bullet describing the two-layer table pattern and closing with *"34 columns, 50 rooms and 1 553 objects are the measurement of this one building, not a design target for any other"*. (3) A new section, **"Romkontroll table (tabell romkontroll alle plan) — where the rules live, and the host facts"**: an owner table routing each kind of question, three rules worth carrying without opening the contract, and **five host facts** — `custom_` or the grid silently vanishes; `linked="true"` is set on load whenever `driver_id !== "driver_id"`, empty included; the 1 802 container items are scaffold, not data; nothing clamps to `panel_width`/`panel_height`; Insert appends and renames from the live canvas child index. |
| **Why the host facts stay here and the geometry does not** | This file owns host behaviour — what the Designer does to a document on load. The contract owns what the document must contain. Splitting them that way is what keeps one owner per rule when both files describe the same container. |
| **Reason** | The brief requires the first page of AI-facing documentation to be sufficient for correct routing. |
| **Source** | `V3scripts.js:514`, `:528`, `:684`, `container_tool.js:2048`, `:3699-3849` for the host facts; E18/E19 for the counts. |
| **Files** | `CLAUDE.md` |
| **Status** | **Normative** · `GLOBAL` (host facts) and `ROMKONTROLL` (the routing table) |

### 114. `LIST-PANEL-GENERATION-CONTRACT.md` — three scope lines, and not one rule changed

| | |
|---|---|
| **Original** | §1.1: a list panel is *"the **one panel type built out of containers**… one container per table row"*. §5.1 describes the 16 container keys as *the* container shape. §12 check 9 requires every `obj_id`, objects **and items**, to appear in `DESIGN-OBJECT-CATALOG.md`. |
| **Problem found** | All three are true of the spjeldliste family and false of the room-control table, which is also container-built, uses **one** container with **22** keys, and draws its cells with `number_v3_cell_grey25` — an id used 1 700 times in production and absent from the catalogue and from the 797-id palette. Left as written, the list contract silently claims authority over a panel type it never measured. |
| **Revised** | Three inserted scope statements, each naming its conflict id and the owner of the resolution. §1.1 gains a blockquote scoping "the one panel type built out of containers" to the `objects_container` family (`RC-C1`). §5.1 gains a note that 16 keys is the `objects_container` shape and a `table_container` carries 22 (`RC-C1`). §12 gains a blockquote after check 12 stating that check 9 is `LIST`, that room-control tables resolve against the union of the palette and the controls registry, and that this is a widening **by evidence** — with the palette/registry/registry-only/retired counts (797 / 1 769 / 991 / 39) quoted (`RC-C2`). |
| **What did not change** | No LIST rule was rewritten, renumbered, weakened or moved. Every check keeps its wording and its authority over spjeldliste panels. The insertions say where the family ends; they do not say the family is wrong. |
| **Reason** | The brief requires global rules to be distinguished from panel-type-specific ones, conflicts recorded rather than silently resolved, and one authoritative owner per rule. |
| **Source** | E18/E19 measured against E6; `reference_data/all-design-objects.json` and `reference_data/controls-registry.json` counted directly. |
| **Files** | `LIST-PANEL-GENERATION-CONTRACT.md` |
| **Status** | **Normative** · `LIST` — scope statements only |

### 115. `AI-BRIEFING.txt` — routed first, and the word *romkontroll* disambiguated

| | |
|---|---|
| **Original** | The file opened straight into the contract. Its "WHAT IT DOES NOT OWN" list named the panel-type contracts but no routing document. §7c described list panels as *"the ONE panel type built from CONTAINERS"*. §7d used *romkontroll* for the hotel floor plan without qualification. The §9 self-check required *"positions inside the canvas (list panels 7c excepted)"* and *"containers [] too, unless this is a list panel"*. |
| **Revised** | Six edits. (1) A new **"ROUTE FIRST."** paragraph at the top of the file carrying both verbatim route statements, naming `AI-REQUEST-ROUTING.md` as the owner of the routing decision, and stating plainly: *"Reading this file first and skipping the routing step is how both failures in ROMKONTROLL-GENERATION-CONTRACT.md section 13 happened."* (2) "WHAT IT DOES NOT OWN" gains `AI-REQUEST-ROUTING.md` as its **first** entry and a room-control-table entry pointing at the contract (*"ONE table_container, not one container per row… conflict RC-C1"*); the QA-checklist, validator and preflight lines gain their ROMKONTROLL counterparts. (3) §7c gains a SCOPE paragraph — everything in 7c is measured on the spjeldliste and is `LIST`, not `GLOBAL`; *"route by the shape of the source, not by the word 'list': a repeated per-row cell group is 7c; a rooms × signals matrix is ROMKONTROLL-GENERATION-CONTRACT.md"* — and "the ONE panel type built from CONTAINERS" is softened to "built from CONTAINERS". (4) §7d gains **"ROMKONTROLL — TWO DIFFERENT PANELS SHARE THE WORD"** above the floor-plan block. (5) The §9 canvas check is widened to *"EXCEPT list panels (7c) and room-control tables"*, with the note that `CLAUDE.md` gotcha #25 always permitted this and only the self-check line was narrower (`RC-C5`). (6) §9 gains a full room-control-table self-check block, and the graphics/containers line becomes *"containers [] too, unless this is a list panel (7c, one per row) or a room-control table (exactly one)"*. |
| **Reason** | The brief requires the first page of AI-facing documentation to route correctly, and requires the routing statements to be discoverable verbatim. `RC-C5` additionally requires the self-check not to contradict a rule the repository already had. |
| **Source** | E18/E19; `CLAUDE.md` §19 gotcha #25 for the viewport rule. |
| **Files** | `AI-BRIEFING.txt` |
| **Status** | **Normative** · `GLOBAL` (the route-first block, the §9 widening) and `LIST` / `ROMKONTROLL` (the scope paragraphs) |

### 116. `AI-AGENT-INSTRUCTIONS.txt` — the room-table route inside the 8 000-character cap

| | |
|---|---|
| **Original** | One universal object template — `zIndex "default"`, `linked "false"`, `driver_id "driver_id"`, `link_name ""` — presented as *the* OBJECT entry, plus *"containers (empty except spjeldliste)"*, plus a LAYOUT rule requiring positions inside the canvas. E18 contradicts all four, and failure 2 followed every one of them faithfully. This is conflict `RC-C3`, and it is the reason the fix had to land **here**, in the file Copilot actually loads, rather than in a document it never reads. |
| **Revised** | Five changes. (1) A new routing paragraph: *"ROMKONTROLL TABLE ("tabell romkontroll alle plan") = rooms x signals grid; not the 7d floor plan, not 7c. ONE container, container_type "table_container", unique_id must contain custom_ or the host drops it; container zIndex 4, items "5"; num_of_col/num_of_rows/last_y match the grid; taller than the canvas ON PURPOSE - report it, never compress. Dump supplied = link it (LINKING). ROMKONTROLL-GENERATION-CONTRACT.md owns it; check with validate-romkontroll-panel.py."* (2) The OBJECT entry is relabelled *"the UNLINKED template; LINKING and ROMKONTROLL override zIndex, linked, link_name, driver_id"* — the single most load-bearing word change in this pass, because failure 2 was the universal reading of that template. (3) `containers` becomes *"(empty except spjeldliste and room tables)"*. (4) LAYOUT gains *"(lists and room tables may run past; the view scrolls)"*. (5) The self-check gains the ROMKONTROLL exceptions on `zIndex` and on canvas bounds, and ends *"containers only spjeldliste or one room table"*. |
| **Paid for in cuts, not by exceeding the cap** | CORE FACT merged into line 1; the vent equipment ids replaced by *"Vent equipment ids: trace VENTILATION-GEOMETRY-CONTRACT.md."*; MASKIN's "pitch measured never averaged" dropped (PRECEDENCE already forbids averaging) and "(a NEGATIVE example)" → "(NEGATIVE)"; OVERSIKT's "(72 objects, 21 clusters - evidence, not a target)" → "(evidence, not a target)" and "owns every rule and coordinate" → "owns every rule"; VENTILASJON lost three sentences that the geometry contract already owns; HOUSE STYLE panel names and MODE B/D compressed; BACKGROUND, TEXT ALIGNMENT, LAYOUT and VENT OVERLAP trimmed. Nothing normative was deleted — every cut is either a duplicate of a rule stated elsewhere in the same file or a pointer to the document that owns it. |
| **Measured** | **7 914 characters, worst-case CRLF 7 949, 51 characters of headroom, 0 angle brackets.** The cap counts characters, not bytes, and a CRLF working tree adds one per line; the worst case is what must clear 8 000. |
| **The PRECEDENCE line was left byte-for-byte intact** | `RC-C4`. The task that commissioned this pass proposed a different ordering — `CLAUDE.md` at rank 2, the panel-type contract at 4. The repository's list is one list printed in six files; reordering it in one of them would create the second competing precedence the brief forbids. The requester's intent is met instead by the contract's companion table, which answers "which source owns which *kind* of fact" without competing with precedence. |
| **Reason** | The brief requires the routing rules to reach the agent that failed. That agent reads this file and this file only. |
| **Source** | E18/E19/E21. |
| **Files** | `AI-AGENT-INSTRUCTIONS.txt` |
| **Status** | **Normative** · `GLOBAL` |

### 117. `PANEL-TYPE-GUIDE.md` — the third container-built family

| | |
|---|---|
| **Original** | The common-rules bullet named two exceptions to "panels are flat object lists": 9914's room-card panels and list panels. The lead-in to the list-panel section spoke of "the table family". Nothing described a room-control table. |
| **Revised** | Three edits. The common-rules bullet now reads *"Three exceptions, all container-built: 9914's room-card panels, **list panels** (spjeldliste — one container per row) and the **room-control table** (one `table_container` holding the whole grid)"*. The lead-in becomes *"The two table families below…"*, naming both contracts. And a new section, **"Room-control table (`Tabell romkontroll alle plan`)"**: how to tell it apart from a spjeldliste and from the hotel floor plan; the two-layer split with its measured evidence (all 1 802 container items carry `driver_id ""`; 1 551 of 1 553 canvas objects are bound); one container with 22 keys; `custom_` or the grid vanishes; item `zIndex "5"` against the spjeldliste's `"900"`; the panel does not fit the canvas and is not meant to (x 3 120 / y 1 690); `number_v3_cell_grey25` absent from the catalogue; and the file pointers, closing *"one building, measured; not a design target for another"*. |
| **Reason** | The guide is where an agent looks to tell panel types apart. A panel type it does not list is a panel type that gets misrouted. |
| **Source** | E18/E19, measured against E6. |
| **Files** | `PANEL-TYPE-GUIDE.md` |
| **Status** | **Normative** · `GLOBAL` (the routing bullet) and `ROMKONTROLL` (the section) |

### 118. Defects found in this pass's own first draft — corrected against the measurement

| | |
|---|---|
| **Why this entry exists** | The brief forbids weakening validation to make files pass and forbids overwriting historical findings. The mirror of both rules is that when a **document** this pass wrote disagrees with the **validator** this pass wrote, the disagreement is resolved by measuring and the document is corrected — in the open, not silently. Three defects were found this way, all in text written earlier in this same pass. |
| **Defect 1 — rule ids credited to the wrong check** | Contract §13.2 originally credited `R-B1` and `R-C4` with catching failure 2. Measured: a fully placeholdered file is mode `"B"`, so `R-B1` does not error, and with no container there is no grid, so `R-C4`/`R-C5` have nothing to measure. What actually fires is `R-S10`, `R-S11`, `R-T1` under `--check` and `R-C3` + `R-C8` under `--compare`, 32 findings in total. **The table was corrected to the measurement; the validator was not widened to the table.** |
| **Defect 2 — the half-linked rule** | The QA checklist and contract §11.3 named `R-B1` as the rule that fires on a panel where some objects are bound and some are placeholders. It is `R-B3` (and `R-B4`), because `Panel.mode()` returns `"mixed"` there and `R-B1` errors only for `"unbound"`. This surfaced as a **test failure** — `AssertionError: 'R-B1' not found in {'R-B3','R-B4'}` — and the test expectation was the thing corrected, per the checklist's own stage-4 rule. Two tests were added to pin the corrected ids so the prose cannot drift back. |
| **Defect 3 — a wrong file name** | The contract named a test module that does not exist. Corrected to `tests/test_romkontroll_8653_contract.py`, which is also the name the repository's convention predicts. |
| **Prose miscounts** | Two counts written from memory rather than measured — the number of skipped tests and the number of `R-C` findings on failure 2 — were corrected to 5 and 32. Both now come from a run recorded in this file. |
| **Files** | `ROMKONTROLL-GENERATION-CONTRACT.md`, `ROMKONTROLL-QA-CHECKLIST.md`, `build-romkontroll-rules.py`, `tests/test_romkontroll_8653_contract.py` |
| **Status** | **Normative** — the corrected ids · **Advisory** — the practice of recording them |

### 119. What was deliberately left alone

| | |
|---|---|
| **Decision** | **E18, the known-good export, was not modified in any way** — not reformatted, not renamed, not moved, not committed. |
| **Reason** | The brief's first quality constraint. Everything Part 8 needed from it is in E19, which is E18 with the plant masked and nothing else touched. |
| **Decision** | `LIST-PANEL-GENERATION-CONTRACT.md`'s rules were **not** rewritten to cover both table families, and no LIST rule was restated inside the room-control contract. |
| **Reason** | `RC-C1`. Two families, two contracts, three scope lines marking the border, and links where a rule would otherwise be duplicated. Merging them would produce one document that is authoritative for neither. |
| **Decision** | `AI-BRIEFING.txt` §7d's hotel **floor-plan** Romkontroll rules were **not** edited. |
| **Reason** | They are correct for the panel type they describe. The ambiguity was that the word was unqualified, so the fix is a disambiguation block above them, not a change to them. |
| **Decision** | `reference_data/panel-conventions.json`, `AI-BRIEFING-REVISED.txt`, `AI-AGENT-INSTRUCTIONS-REVISED.txt` and `CLAUDE-REVISED.md` were **not** touched. |
| **Reason** | Same as changes 89 and 103: the survey is fleet-level evidence, and the `-REVISED` files are change records per their own status headers. Mirroring Part 8 into them would create the second competing contract the brief forbids. |
| **Decision** | **No renderer was written**, although Part 7 shipped `render-oversikt-panel.py`. |
| **Reason** | A store overview is verified by *looking* at it — clusters sit on cases or they do not. A 3 120 × 1 690 grid of 1 553 identical value pills is not decided by looking; it is decided by `--compare` and by `--source-sql`. A renderer nobody would use is a second source of truth with no reader. Stated here so the asymmetry with Part 7 is a decision on the record rather than an omission. |
| **Files** | none |
| **Status** | **Advisory** · `GLOBAL` |

---

## Conflicts resolved

Recorded in full in [ROMKONTROLL-GENERATION-CONTRACT.md](ROMKONTROLL-GENERATION-CONTRACT.md) §12.
**No conflict was resolved by averaging, and none was resolved by editing the
older rule out of the way.**

| Id | Conflict | Decision |
|---|---|---|
| **RC-C1** | `LIST-PANEL-GENERATION-CONTRACT.md` §1.1 calls the list panel *"the one panel type built out of containers… one container per table row"*; §5.1 documents 16 container keys. E18 is container-built with **one** container carrying **22** keys and all 1 802 cells. | Both true of their own family. `LIST` is scoped to the **spjeldliste family** (`objects_container`, one per row, items `zIndex "900"`); the room-control contract owns the **`table_container` family** (one container, `num_of_rows`/`num_of_col`/`last_y`, items `zIndex "5"`). Three scope lines added to LIST; neither contract rewritten to cover both (change 114) |
| **RC-C2** | LIST §12 check 9 requires every `obj_id` — objects **and** items — to be in `DESIGN-OBJECT-CATALOG.md`. `number_v3_cell_grey25` is used **1 700×** on E18 and is in neither the catalogue nor the 797-id palette; it exists only in `controls-registry.json` (`168 × 25`, `zindex 5`, `css_v3_cell_grey25`, `obj_type "dummy"`, `canLink false`), one of **991** registry definitions with no palette entry | The catalogue stays authoritative for **palette-placed** objects; host-generated **table-cell** types are authoritative in the controls registry. The allowlist becomes "catalogue **or** controls registry" — never "catalogue or anything". An id in neither is still an error, the 39 retired ids are still rejected, and registry-only ids are **named in a note** rather than admitted silently. A widening by evidence, not a relaxation (change 111) |
| **RC-C3** | `AI-AGENT-INSTRUCTIONS.txt` teaches one universal object template (`zIndex "default"`, `linked "false"`, `driver_id "driver_id"`, `link_name ""`) and "containers (empty except spjeldliste)". E18 contradicts all four, and failure 2 followed all four faithfully | The universal template is the **mode-B** template and is now labelled as such in the file itself. Linked panels and table panels each get an explicit route. The 8 000-character cap is honoured by **paying for the route in cuts** — nothing normative removed, every cut a duplicate or a pointer (change 116) |
| **RC-C4** | The commissioning task proposed a source hierarchy with `CLAUDE.md` at rank 2 and the panel-type contract at 4. The repository's single precedence list has the contract at 3 and `CLAUDE.md` at 4 | **The repository list stands**, byte-for-byte, in all six files that print it. Reordering it in one would create a second precedence list — the exact failure mode the brief's "one authoritative owner per rule" exists to prevent. The requester's intent is met by the contract's **companion table**, which answers "which source owns which kind of fact" and does not compete with precedence. Recorded, not silently reconciled |
| **RC-C5** | `AI-BRIEFING.txt` §9 self-check requires *"positions inside the canvas (list panels 7c excepted)"*. A room-control table is not a 7c list panel and its content is 2.2× the canvas width and 2.25× its height | The exception is widened to *"list panels and room-control tables"*, with contract §8 as the owner. The underlying rule — `CLAUDE.md` §19 gotcha #25, "nothing clamps to `panel_width`/`panel_height`, the plant view scrolls" — **already permitted this**; only the self-check line was narrower than the rule it was checking (change 115) |

---

## Verification run for Part 8

All commands run from `iwmac-designer-reference/`.

| Command | Result |
|---|---|
| `python -m unittest tests.test_romkontroll_8653_contract` | Ran 97 tests in 4.718s — **OK (skipped=5)** |
| `python -m unittest tests.test_oversikt_10113_contract tests.test_maskin_10229_contract tests.test_maskin_compressor_bank tests.test_list_panel_contract tests.test_ventilation_profile_9099 tests.test_build_ventilation_corpus` | Ran 244 tests in 0.680s — **OK**, no regression in any earlier panel type |
| `python build-romkontroll-rules.py --check` | `documentation-rules.json is up to date` |
| `python build-oversikt-rules.py --check` | `documentation-rules.json is up to date` — the new block disturbed neither |
| `python build-maskin-rules.py --check` | `documentation-rules.json is up to date` |
| `python validate-romkontroll-panel.py reference_data/romkontroll-8653-sanitized.json` | **0 errors, 1 warning**, exit 0 |
| `… --profile TEMPLATE-8653-ROMKONTROLL` | **0 errors, 1 warning**, exit 0 |
| `… --compare reference_data/romkontroll-8653-sanitized.json reference_data/romkontroll-8653-sanitized.json` | **0 errors, 1 warning**, exit 0 — `INFO R-C5 1550 cell(s) present in both; median displacement 0,0; 0 moved` |
| `… --source-sql "iw_gen_driver_parameters (3).sql"` | `INFO R-B6 10315 parameter rows, 10315 distinct driver_id`; the mask normalization named explicitly; **`all 1551 driver_id(s) resolve in the dump`** — with `unit_id` and `alias_text` byte-identical on every one |
| `python build-romkontroll-negatives.py --out survey-tmp/romkontroll-negative` | 9 fixtures written |

The single warning on every clean run is `R-T10 3 object(s) sit below the last
row — the annotation cluster pattern … object_1550, object_1551, object_1552`:
the manual-reset cluster, a production anomaly **preserved and reported, never
corrected**. The clean runs also print `INFO R-T16` (content reaches x 3 120,
y 1 690 on a declared 1400 × 750 viewport — expected, contract §8), `INFO R-B1`
(output mode C — linked panel) and, without the dump, `INFO R-B6 no --source-sql:
an invented driver_id is indistinguishable from a real one here. Run it with the
dump`.

Every negative, in `--compare` against the fixture.

| Negative | exit | errors / warnings | The rules that caught it |
|---|---|---|---|
| `dataset-not-a-panel` (failure 1) | 1 | 7 / 44 | `R-S2`, `R-S3`, `R-S4`, `R-C1`, `R-C3`, `R-C8` — it has no `format`, no `version`, no `panel`, no `single_objects` |
| `placeholder-overview` (failure 2) | 1 | 5 / 32 | `R-S10` (`zIndex "default"`), `R-S11` (`link_name ""` instead of the literal), `R-T1` (no container), `R-C3`, `R-C8`; plus 21 × `R-C6`, 6 × `R-C2` census and 3 × `R-C1` as warnings |
| `container-dropped` | 1 | 2 / 21 | `R-T1`, `R-C3` |
| `non-custom-unique-id` | 1 | 1 / 2 | `R-T2` — the silent-vanish case; nothing else in the file is wrong |
| `compressed-to-viewport` | 1 | 4 / 2 | `R-T10`, `R-T11`, `R-T13` — squeezing 3 120 × 1 690 of content into 1400 × 750 |
| `column-dropped` | 1 | 2 / 4 | `R-T4`, `R-C4` |
| `text-sorted-rooms` | 1 | 2 / 2 | `R-T12`, `R-C3` — rooms ordered as text rather than by floor and number |
| `half-linked` | 1 | 2 / 1 | `R-B3`, `R-C7` — **not** `R-B1`, which reports mode `"mixed"`; see change 118 |
| `constructed-driver-ids` | **0** | 0 / 1 | **none** without the dump. With `--source-sql`: `R-B6 1551 driver_id(s) do not exist in the dump - constructed, adapted from another plant, or invented`, exit 1 |

**`constructed-driver-ids` passing a bare `--check` is the asymmetry of this
panel type**, and it is the exact counterpart of Part 7's nine-cluster
reconstruction passing structural validation. A driver id that is well-formed but
fabricated is indistinguishable from a real one inside the document; only the
plant's parameter dump can tell them apart. That is stated in contract §11.6, in
QA stage 4, in the preflight's Block B and in `R-B1`'s runtime note — and it is
why §7.1's rule is *copy verbatim*, never construct.

No visual QA was run, deliberately: see change 119.

---

## Files changed in Part 8

| File | Change | Existed before? |
|---|---|---|
| `AI-REQUEST-ROUTING.md` | **New.** `GLOBAL` intent-routing owner, 7 sections, the two verbatim statements (104) | No |
| `ROMKONTROLL-GENERATION-CONTRACT.md` | **New.** Measured-geometry owner, 16 sections, 1 056 lines (105) | No |
| `ROMKONTROLL-AUTHORING-GUIDE.md` | **New.** Procedure, the fifteen pre-generation questions, the acceptance gate (106) | No |
| `ROMKONTROLL-QA-CHECKLIST.md` | **New.** Stages 0–7; stage 0 runs on the request, not the artifact (107) | No |
| `ROMKONTROLL-COPILOT-PREFLIGHT.md` | **New.** Blocks A/B/C, 8 027 chars (108) | No |
| `build-romkontroll-fixture.py` | **New.** Masking sanitizer, E18 → E19, plus `--report` (109) | No |
| `reference_data/romkontroll-8653-sanitized.json` | **New.** 1 553 objects, 1 table container, 1 802 items, plant masked (109) | No |
| `build-romkontroll-rules.py` | **New.** Generator for `panel_types.romkontroll_table` (110) | No |
| `documentation-rules.json` | `panel_types.romkontroll_table` (22 keys), the `TEMPLATE-8653-ROMKONTROLL` profile, evidence E18–E21, two scope tags — regenerated, not hand-edited (110) | Yes |
| `validate-romkontroll-panel.py` | **New.** `R-S*` / `R-T*` / `R-B*` / `R-P*` / `R-C*`; `--check`, `--profile`, `--compare`, `--source-sql` (111) | No |
| `build-romkontroll-negatives.py` | **New.** Nine negatives, including both real failures (112) | No |
| `tests/test_romkontroll_8653_contract.py` | **New.** 97 tests, 5 skipping without the dump (112) | No |
| `CLAUDE.md` | Routing file first in the kit list; the fixture bullet; the room-control-table section with five host facts (113) | Yes |
| `LIST-PANEL-GENERATION-CONTRACT.md` | Three scope statements (§1.1, §5.1, §12); no rule changed (114) | Yes |
| `AI-BRIEFING.txt` | Route-first header with both verbatim statements; routing and romkontroll entries in "does not own"; §7c scope; §7d disambiguation; §9 widened and a new self-check block (115) | Yes |
| `AI-AGENT-INSTRUCTIONS.txt` | Room-table route added inside the cap; the OBJECT template relabelled as the unlinked one; containers, LAYOUT and self-check corrected; paid for in itemized cuts; 7 914 chars / 7 949 worst case (116) | Yes |
| `PANEL-TYPE-GUIDE.md` | Three container-built families; the room-control-table section (117) | Yes |
| `../README.md` | The kit list now names `AI-REQUEST-ROUTING.md` first, and the instructions-field character count is corrected from 7 971 to the measured **7 914** — a claim change 116 falsified | Yes |
| `documentation-change-log.md` | This part; evidence E18–E21 and two scope tags added at the head | Yes |
| `reference_data/panel-conventions.json` | **Untouched**, deliberately (119) | Yes |
| `AI-BRIEFING-REVISED.txt`, `AI-AGENT-INSTRUCTIONS-REVISED.txt`, `CLAUDE-REVISED.md` | **Untouched**, deliberately (119) | Yes |
| `iwmac-panel_8653_tabell-romkontroll-alle-plan_20260810-2157.json` (E18) | **Not modified, not committed** — the brief's first constraint (119) | n/a |

The negatives written to `survey-tmp/romkontroll-negative/` are regenerated on
demand and are not committed, matching the Oversikt and Maskin convention.

---

## What Part 8 deliberately did not do

- **Did not modify the known-good export.** E18 is byte-identical to the file
  supplied with the task. Every measurement is reproduced from E19, and
  `build-romkontroll-fixture.py --report` re-derives all of them.
- **Did not invent a coordinate, `obj_id`, driver id, unit id, alias, room name,
  column or plant id.** Where a fact could not be measured it is listed as an
  open item in contract §16 rather than filled in. The verbatim-copy rule (§7.1)
  is the same principle applied to the generator's own output.
- **Did not generalize one export.** Every geometry figure is tagged
  `TEMPLATE-8653-ROMKONTROLL`. 34 columns, 50 rooms, 8 floors, 1 553 objects and
  1 802 items describe one building. Only structure — two layers, one container,
  `custom_`, verbatim identifiers, viewport-not-boundary — is tagged
  `ROMKONTROLL`.
- **Did not weaken a validation rule to make anything pass.** The one allowlist
  widening (`RC-C2`) is driven by a production id used 1 700 times, names the
  registry-only ids it admits, and still rejects an id present in neither
  registry and all 39 retired ids. Where this pass's own prose disagreed with the
  validator, the prose was corrected — change 118 records all three cases.
- **Did not resolve a conflict by averaging or by deletion.** `RC-C1`–`RC-C5`
  each name a winner or keep both under explicit scopes, and the older rule keeps
  its wording in every case. `RC-C4` is a conflict with the commissioning task
  itself, recorded rather than quietly adopted.
- **Did not overwrite a historical finding.** Findings continue at 104; evidence
  continues at E18; conflicts use the fresh `RC-C*` namespace; validator rules
  use the fresh `R-*` namespace. Nothing from Parts 1–7 was renumbered, reworded
  or removed.
- **Did not present a count as a target.** Every count in every new document is
  annotated where it appears, and `R-P*`, `R-C2` and `PANEL-TYPE-GUIDE.md` all
  repeat the caveat at the point of use.
- **Did not correct a production anomaly.** The three annotation objects below
  the last row, the two objects with no binding, the single `number_v3_60px_json_obj`
  and the two `zIndex "1100"` objects are preserved in E19 and reported as
  warnings.
- **Did not commit the supplied export, the parameter dump, or either failed
  generation.** E18, E20 and E21 stay outside the repository; E19 reproduces
  every measurement without a plant id or a live driver id, and the negatives
  builder reproduces both failure shapes synthetically.
- **Did not build a renderer.** Stated as a decision, with its reason, in change
  119.
- **Did not claim to have inspected files it was not given.** E21 is recorded
  from the task's own description of the two rejected generations; the files
  themselves were not supplied to this pass, and the evidence table says so.
