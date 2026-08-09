# Documentation change log — ventilation generation contract

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

---

## Part 2 — new documents

None of these delete or replace an existing file; each takes ownership of a class
of information that previously had no owner (F5, F6, F7).

| File | What it owns | Why it is new | Status |
|---|---|---|---|
| [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) | **Measured panel geometry** — coordinates, cluster offsets, z-bands, sidebar rows, the intentional-overlap table, the centring formula. 13 sections, every rule scope-tagged. | The fourth information class had no home. Geometry was scattered across CLAUDE.md prose, AI-BRIEFING §7a and PANEL-TYPE-GUIDE, in three partly-conflicting forms. | **Normative**; each rule individually tagged GLOBAL / VENT / REF-9099 / SCREENSHOT / ADVISORY |
| [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) | **Executable QA** — Stage A structural (A1–A14, with an inline Python validator), B geometry (B1–B16), C visual (C1–C11, with the zoomed-crop region table and a ±2 px centring tolerance), D linking/sanitization (D1–D9), E import/save, plus a 9-question regression checklist. | The existing QA text was a 10-step prose list with no pass/fail criteria and no commands. | **Normative** |
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

| File | Form | Applying it |
|---|---|---|
| [CLAUDE-REVISED.md](CLAUDE-REVISED.md) | Ordered disposition of every section of `CLAUDE.md`, with full replacement text for each section that changes and a keep/move/delete verdict for each that does not. | Mechanical — each entry names the exact anchor text. |
| [AI-BRIEFING-REVISED.txt](AI-BRIEFING-REVISED.txt) | Same form for `AI-BRIEFING.txt`, including the full text of the restructured §7a header and the new precedence preamble. | Mechanical. |

The factual corrections in Part 1 are **already live** in both files; what remains
in Part 3 is the structural separation of the four information classes.
