# Documentation audit — IWMAC Designer ventilation generation

Audit of the documentation set that an AI reads before generating a
`360.NNN Ventilasjon` panel. Date: 2026-08-09.

**Objective.** Make the set reliable enough that another AI produces a
production-quality panel without repeated visual corrections.

**Method.** Every claim in the documentation that asserts a coordinate, a
dimension, a count, an encoding or an object id was checked against three real
exports. Findings are only recorded where the evidence contradicts the document
or where the document leaves a decision undetermined.

## Documents audited

| File | Bytes | Role |
|---|---|---|
| [CLAUDE.md](CLAUDE.md) | 102 420 | Host behaviour and repo deep-dive, 21 sections |
| [AI-BRIEFING.txt](AI-BRIEFING.txt) | 61 673 | Normative output contract for the AI knowledge file |
| [AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt) | 7 996 | Same contract compressed for a Copilot Studio instructions field |
| [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) | 171 858 | Authoritative `obj_id` vocabulary, generated |
| [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) | 14 601 | Per-panel-type fleet statistics and anatomy |

## Evidence base

| Alias | File | Objects | Note |
|---|---|---|---|
| **E1** | `iwmac-panel_9099_360-001-ventilasjon_recommended.json` | 102 | Plant 9099, uncommitted, in the user's Downloads |
| **E2** | [reference_data/real-vent-panel-example.json](reference_data/real-vent-panel-example.json) | 102 | Same AHU, earlier revision, sanitized |
| **E3** | [reference_data/real-vent-panel-example-2.json](reference_data/real-vent-panel-example-2.json) | 92 | Different plant and unit, sanitized |
| — | [reference_data/design-object-catalog.json](reference_data/design-object-catalog.json) | 797 ids | Catalogue source of truth |

All 121 `obj_id` values used across E1–E3 exist in the catalogue. **Zero missing
ids.** The `obj_id` vocabulary is the healthiest part of the set.

> **The named input `iwmac-panel_9099_360-001-ventilasjon_20260809-1857.json`
> does not exist** anywhere under Downloads, Documents or Desktop. E1 is the only
> 9099 export on disk and was used in its place. **No screenshots were supplied
> with the task**, so every screenshot-derived correction is recorded as stated,
> not as verified. See §16.

## Severity scale

| Severity | Meaning |
|---|---|
| **S1 — wrong** | The document states something the evidence contradicts. An AI following it produces a defective panel |
| **S2 — undetermined** | The document leaves a decision an AI must make with no basis, so it invents one |
| **S3 — misleading** | Technically true but reliably misread |
| **S4 — structural** | Redundancy and layering problems that cause drift over time |

---

# Findings

## S1 — Wrong

### F1. `gr C` is instructed everywhere and appears in no production panel

| Location | Text |
|---|---|
| [AI-AGENT-INSTRUCTIONS.txt:15](AI-AGENT-INSTRUCTIONS.txt) | `UTF-8 works; plain ASCII (gr C) safest.` |
| [AI-AGENT-INSTRUCTIONS.txt:21](AI-AGENT-INSTRUCTIONS.txt) | `tag_text = code + unit (RT401 gr C, KA401 %)` |
| [AI-BRIEFING.txt:322](AI-BRIEFING.txt) | `Safe default: plain ASCII ("gr C", "hoyfart", "gasskjoler")` |
| [AI-BRIEFING.txt:459, 480, 485](AI-BRIEFING.txt) | Worked examples quoting `"RT502 gr C"`, `"RT510 gr C"`, `"RT410 gr C"`, `"RT420 gr C"`, `"RT520 gr C"` |
| [AI-BRIEFING.txt:560](AI-BRIEFING.txt) | `tag_text = instrument code + unit ("RT401 gr C", …)` |
| [AI-BRIEFING.txt:940](AI-BRIEFING.txt) | Linking example built on `"RT401 gr C"` |
| [CLAUDE.md:486](CLAUDE.md) | `**plain-ASCII text as the safe default**` |

Measured:

| Export | `tag_text` with `°` | `tag_text` with `gr C` |
|---|---|---|
| E1 | 13 | **0** |
| E2 | 13 | **0** |
| E3 | 8 | **0** |

Production also carries `æ ø å` and `³` in sidebar labels: `Sp. høyfart m³/h:`,
`Sp. nattkjøl. m³/h:`, `Kjølemodus kombibatteri`. The catalogue's own worked
example is `RT401 °C` ([build-object-catalog.py:466](build-object-catalog.py)).

`CLAUDE.md:486` is self-contradicting in one sentence: it calls plain ASCII the
safe default and then states in its own parenthesis that the Insert flow reads
UTF-8 and that production `°`/æøå survive. The mojibake risk it describes belongs
to `addScriptTag` on the ISO-8859-1 Designer page — a different channel that never
touches panel JSON.

**Impact.** An AI following the instruction emits `RT401 gr C` where every real
panel shows `RT401 °C`, on 8–13 objects per panel. This is a visible defect on
every generated ventilation panel, and it is the exact class of "repeated visual
correction" this audit exists to eliminate.

**Action.** Remove the ASCII-default instruction from all three files. Replace
with a positive rule: emit UTF-8, write `°C`, and scope the mojibake warning to
the channel it actually applies to.

### F2. The 9099-versus-reference divergence figure is an index-wise artifact

[CLAUDE.md:402](CLAUDE.md): *"85 objects differ in `posLeft`, 84 in `posTop`, 66
in `obj_id`"*.
[CLAUDE.md:452](CLAUDE.md): *"Two panels can agree on all six counts and still
differ in every coordinate — the 9099 export and the committed reference do
exactly that."*

Both numbers come from comparing `single_objects[i]` to `single_objects[i]`. The
two files order their arrays differently, so this compares unrelated objects.

Re-measured by role (`obj_id` + `tag_text`):

| Metric | Index-wise | Role-wise |
|---|---|---|
| Identical geometry | 17 | **79** |
| Moved | 85 | **21** |
| Only in E1 | — | 1 |
| Only in E2 | — | 2 |
| `obj_id` multiset difference | 66 | **2 ids** |

**Impact.** An AI reading "85 of 102 differ" concludes the reference has no
transferable geometry and falls back to inventing a layout — the failure mode the
whole document is trying to prevent. The section's *conclusion* ("both sets of
anchors are real and must not be merged") is correct; only the number is wrong,
and it overstates divergence roughly four-fold. `CLAUDE.md:452`'s "differ in every
coordinate" is false as written: 79 of 102 objects are byte-identical.

**Action.** Replace both figures with the role-wise numbers and add the rule that
**panel exports must be diffed by role, never by array index.**

### F3. The allowlist gives palette defaults as if they were placement sizes

[AI-AGENT-INSTRUCTIONS.txt:11](AI-AGENT-INSTRUCTIONS.txt):

| Stated | Production | Delta |
|---|---|---|
| `number_v3_header_grey75 260x20` | **250×20** in E1, E2 and E3, all six headers | 10 px too wide |
| `number_v3_exhaust_pipe_horisontal 50x18` | **1025×18** in E1, E2 and E3 | the duct run |

[AI-BRIEFING.txt:310](AI-BRIEFING.txt) compounds it with `number_v3_header_grey75,
W 260-280`, a range that excludes the only width production uses.

**Impact.** A 260 px header overhangs the sidebar's right edge; the sidebar
background ends at x 1400 and the header would end at x 1410. Every generated
ventilation panel is visibly wrong at the top of all three sections.

**Action.** Correct both dimensions. Add a general rule that the catalogue's
`W×H` is the **palette default**, not the placement size — see F4.

### F4. The catalogue calls its `W×H` column "the placement size"

[DESIGN-OBJECT-CATALOG.md:13](DESIGN-OBJECT-CATALOG.md), generated from
[build-object-catalog.py:469](build-object-catalog.py): *"**`W×H` is the placement
size in pixels** on the 1400×750 canvas."*

The column holds the size the object arrives at from the toolbox. Production
overrides it constantly:

| `obj_id` | Catalogue `W×H` | Production placement |
|---|---|---|
| `number_v3_header_grey75` | 60×25 | **250×20** |
| `number_360_vg_rot` | 60×324 | **60×343** |
| `number_v3_el_heater` | 38×65 | **40×85** |
| `number_v3_dummy_resirc_damp_vert` | 26×36 | **40×40** |
| `number_v3_60px_dark_no_conn` | 61×21 | **62×22** |
| `number_v3_R_45px_con_left` | 62×20 | **62×22** |
| `number_v3_custom_json_obj` | 61×21 | **230×20** and **100×20** |

The sentence's second half — that pipes are meant to be stretched — already
admits the first half is not general. **Six of the seven objects above are not
pipes.**

**Impact.** An AI treating the catalogue as geometry places every sidebar box 1 px
short in both axes and every header at a quarter of its width.

**Action.** Reword the generator's rule 5 and regenerate. State the precedence
explicitly: the catalogue is the **vocabulary**; a production export is the
**geometry**.

### F5. `AI-AGENT-INSTRUCTIONS.txt` contradicts itself three times

The compressed file states a global rule and its ventilation exception far apart,
in a document with no section structure. Each pair reads as a contradiction.

| # | Global rule | Ventilation reality |
|---|---|---|
| a | `:5` `org_image_name ""`, `background_embedded false` | `:21` `bg 00-blank-sidebar-1400x750`; E1, E2, E3 all embed it |
| b | `:9`, `:25` `zIndex "default"` | `:21` `zIndex 5 ducts, 40 equipment, 110 values, 375 alarms, 1100 labels` |
| c | `:15`, `:25` `Never overlap; 8 px gaps` / `no overlaps` | Every duct connector, every damper and every `con_*` value box overlaps by design |

The parenthetical exceptions that do exist (`7c + vent bands excepted` at `:25`)
cover (b) partially and (a) and (c) not at all.

**Impact.** For (c) specifically: an AI that obeys "never overlap" shortens the
duct to clear the damper, or floats the `con_top` boxes 8 px below the run so the
connectors point at nothing. Both are the reported failure symptoms.

**Action.** In the revision, state each rule once with its ventilation branch
adjacent to it, not 12 lines away.

### F6. The briefing's worked cluster examples carry E2's instrument codes

[AI-BRIEFING.txt:480](AI-BRIEFING.txt) gives the heating coil as `RT510 gr C`
(535,518) and `RT410 gr C` (610,490); `:485` gives the cooling coil as
`RT420 gr C` (482,486) and `RT520 gr C` (408,486).

In E1 those same coordinates carry the **opposite** codes: the heater has
`RT520`/`RT420` and the cooler has `RT510`/`RT410`. The two exports are the same
AHU with the loops renumbered.

**Impact.** An AI copying the briefing verbatim onto a third plant emits a code
that names the wrong loop. Nothing in the file warns that codes are plant-specific
while positions are not.

**Action.** Keep the positions, replace the literal codes with role names
(`coil temp, left of run`), and state the rule: **copy the position from the
reference, the code from the target plant.**

### F7. The briefing's fan-cluster offsets present an unstable value as a template

[AI-BRIEFING.txt](AI-BRIEFING.txt) §7a-3 and
[AI-AGENT-INSTRUCTIONS.txt:21](AI-AGENT-INSTRUCTIONS.txt) both give the fan cluster
as `flow -2,-39 + output +5,+57 + bell +45,-19`, and the briefing adds that the
supply fan "repeats this within 3 px".

Measured across three fans:

| Offset | E1 extract | E1 supply | E2 extract | Stable? |
|---|---|---|---|---|
| Airflow | (−2, −39) | (−2, −40) | (−2, −39) | **yes** |
| Motor output | (+6, +57) | (+5, +55) | (+5, +57) | **yes** |
| Alarm | **(+12, −19)** | (+48, −18) | (+45, −19) | **no — dx spans 12…48** |

The "within 3 px" claim holds inside E2 and fails across E1: E1's extract-fan bell
sits 33 px left of where the rule puts it.

**Impact.** Minor visually, but it is the document asserting a template where the
evidence shows a judgement call — which trains an AI to trust the other offsets
less than it should.

**Action.** Split the cluster into stable offsets (state as normative) and the
alarm dx (state as a clearance judgement with a required dy of −19).

### F8. The 8 000 cap is stated without its unit of measure

`CLAUDE.md:353` states `AI-AGENT-INSTRUCTIONS.txt` is 7 971 chars. **That figure
is correct** for a newline-normalised read: the file is pure ASCII, and
`len(text)` after universal-newline decoding is exactly 7 971. On disk it is
**7 996 bytes** — the file has CRLF endings and 25 line breaks, so every newline
costs a second byte. The document never says which unit the 8 000 limit counts,
nor whether the line endings are included.

**Impact.** An editor who measures with `wc -c` or `ls -l` reads 7 996 and
concludes there are 4 characters of headroom, then declines a 20-character
correction the field would have accepted. The reverse error is the dangerous
one, and it is not hypothetical: a file authored with LF endings measures 7 995
characters and looks safe, but pasted from a CRLF working tree it becomes
**8 028** and is silently truncated on import. `AI-AGENT-INSTRUCTIONS-REVISED.txt`
hit exactly that and was trimmed to 7 943 / 7 976 so it fits under either count.

**Action.** State the unit, count the worst case, and record the command so the
number is re-derivable rather than remembered:

```bash
python -c "import io;t=io.open('AI-AGENT-INSTRUCTIONS.txt',encoding='utf-8').read();print(len(t),len(t)+t.count(chr(10)),t.count('<'),t.count('>'))"
```

**Earlier drafts of this audit recorded F8 as a stale byte count in
`CLAUDE.md:353`. That reading was wrong and is withdrawn** — the number needs no
correction. What was missing is the unit, the CRLF worst case, and the
measurement method.

## S2 — Undetermined

### F9. No document states that `number_v3_label_11px_norm` renders left-aligned

This is the root cause of the reported `Tilluft` / `Avtrekk` centring defect, and
**nothing in the set says it.**

The consequence — `posWidth` does not centre the text — is invisible in the data,
because production gives both headings `posWidth` 50 while placing them 65 px
apart. An AI that reads only the coordinates concludes the widths are equal and
therefore the labels are centred, which is exactly backwards.

**Missing rule.** To centre a label on a column centre `C` with rendered text
width `W`: `posLeft = C − W / 2`. Supply column centre 1291, extract 1361.

**Action.** State the alignment behaviour, the formula, and the worked values.
Recorded in [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md)
§7.2.

### F10. The bypass column is described as skeleton, never as a cluster

[AI-BRIEFING.txt](AI-BRIEFING.txt) §7a-2 lists the four x-411 duct pieces among
the skeleton coordinates and §7a-3 defines clusters for fans, filters and coils —
but not for the bypass. The damper and its `KA502 %` value are listed separately
again in §7a-4's vicinity.

**Missing rules.** That the six objects are one atomic unit; that the duct column
is continuous from y 211 to y 449; that the connector-to-pipe overlaps of 7 px and
5 px are intentional; and that the damper overlays the column rather than
interrupting it.

**Impact.** This is the second reported symptom — the vertical duct being
shortened to make space for the damper. An AI that has seen "never overlap" and
has not seen "this overlap is deliberate" will resolve the conflict by trimming.

**Action.** [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md)
§3 defines the cluster, its offsets and each intentional overlap by magnitude.

### F11. Overlap is prohibited without a detection method or an exception list

[AI-BRIEFING.txt:312](AI-BRIEFING.txt) does carry an exception — *"on a schematic
panel a value box deliberately sits on top of the duct or pipe it belongs to"* —
which is the best statement in the set on this topic. It is still not actionable:

- It names one intentional overlap (value over duct) out of at least four classes
  in E1: connector∩pipe, damper∩duct, LED∩equipment body, value∩equipment body.
- It gives no way to tell an intentional overlap from a defect.
- It does not say what "overlap" is measured on. E1 has six labels with
  `posHeight` 1 whose rendered glyphs are ~11 px tall. Bounding-box arithmetic on
  `posHeight` says they collide with nothing; the render says otherwise.

**Missing rule.** Overlap is judged **on rendered glyphs and rendered graphics at
native size**, not on `posWidth`/`posHeight`; and there is a closed list of
intentional overlaps per panel type.

**Action.** [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) defines the
detection method and the exception list.

### F12. Sidebar spacing has no measured floor

[CLAUDE.md](CLAUDE.md)'s ventilation rules say vertical pitch is *"compact and
consistent"* and the visual acceptance list asks that *"sidebar values form clean
columns"*. Neither is checkable.

Measured in E1 and E2 (identical):

| Measurement | Value |
|---|---|
| Setpoint row pitch | **25 px** |
| Label y offset within a row | **value y + 5** |
| Value box | **62×22** |
| Box-to-box vertical gap | **3 px** |
| Label box bottom to next value box top | **0 px** |
| Header bottom to first value | 8 px (temperature section) |
| Last value bottom to next header | 27 px |

The 0 px figure is the mechanism behind the reported caption collisions: a value
object that renders a caption above its box consumes space the previous row's
label box already occupies. Production sidesteps it by using
`number_v3_60px_dark_no_conn_no_tag` in the temperature section, where the row
label already names the signal — a design decision the documentation never
explains.

**Action.** Publish the measurements, and state the `_no_tag` preference as a rule
with its reason.

### F13. Three sidebar columns are documented as one

[AI-AGENT-INSTRUCTIONS.txt:21](AI-AGENT-INSTRUCTIONS.txt): `SP columns Tilluft
x1260 / Avtrekk x1330`. True for the fan section's first three rows. Production
also uses **x 1332** (CO₂ row) and **x 1329** (all three temperature rows).

**Impact.** Small, but a document that says "the columns are x 1260 and x 1330"
while the file it points at contains 1329, 1330 and 1332 gives an AI no way to
know whether it is cloning or correcting. Both are defensible; the choice must be
stated.

**Action.** Record all three x values with their rows, and state that 1330 is
normative for new work with the deviation noted when cloning.

### F14. The third sidebar header's y is treated as a constant

[AI-AGENT-INSTRUCTIONS.txt:21](AI-AGENT-INSTRUCTIONS.txt): `headers 250x20 y
0/165/357`. E3 puts `Temperaturregulering` at **y 400**.

**Impact.** An AI cloning E3's row set into E1's header positions overlaps the
header with its own first row.

**Action.** Mark y 0 and y 165 as panel-type constants and the third as
source-dependent.

### F15. No render-QA step verifies text, LEDs or connectors

[CLAUDE.md](CLAUDE.md)'s ventilation rule 10 has a 10-step render QA — the
strongest QA material in the set. It checks structure, counts and gross layout.
It does not check:

- every visible text bounding box against its neighbours;
- that a `con_top`/`con_down` box's connector edge actually meets the duct;
- that an LED is fully inside its intended visual parent;
- that `°C` renders rather than mojibake;
- **what to do when a check fails.**

The last omission matters most. Patching a damaged derivative is how a panel
accumulates the compensating errors that produce "repeated visual corrections".

**Action.** [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) extends the
sequence to 14 steps, adds zoomed crops per region, and requires a restart from
the retained source export on failure rather than a patch.

## S3 — Misleading

### F16. Object counts are stated prominently and disclaimed quietly

[PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) leads its Ventilasjon section with *"34
panels, median 92 objects"* and does carry the correct caveat — *"The median is a
fleet statistic, not a target"*. [CLAUDE.md](CLAUDE.md) similarly notes 53 is not
a universal threshold.

The disclaimers are right and should stay. The problem is ordering: the number is
in the heading, the caveat is in the body. A model summarising the section for its
own context keeps the number.

**Action.** Put the target statement first — *coverage of the production roles is
the target; the object count is an outcome* — and the fleet statistic after it.

### F17. `zIndex "default"` and the band table are both true, in different modes

[AI-BRIEFING.txt](AI-BRIEFING.txt) §3 and §7a-5 are consistent once you know that
`"default"` means "array order decides" and that ventilation uses explicit bands
instead. Neither file says that.

**Impact.** The reliable failure is a **mixture** — some objects banded, others
`"default"` — which stacks unpredictably.

**Action.** State the two modes as mutually exclusive per panel, and that
ventilation uses bands.

### F18. Production-versus-generated field asymmetries read as bugs

Two are unexplained anywhere:

- Every object in E1 has `link_name` literally `"link_name"` (102/102), while the
  sanitization contract requires `link_name: ""`.
- An *unlinked* object in a real export has an **empty** `driver_id`, while a
  generated panel must emit the placeholder `"driver_id"`.

**Impact.** An AI comparing its output to a production export sees two field
mismatches and "corrects" its output to match, defeating the linking workflow.

**Action.** State that an export is evidence of what the host writes, not a
template for what an AI writes, and list the two known asymmetries.

## S4 — Structural

### F19. The ventilation contract is stated four times

| Location | Content |
|---|---|
| [AI-BRIEFING.txt](AI-BRIEFING.txt) §7a (~310 lines) | Skeleton, clusters, sidebar, z-bands, sanitization, verification |
| [CLAUDE.md](CLAUDE.md) "Generating or editing a Ventilasjon panel from an export" | Workflow and sanitization |
| [CLAUDE.md](CLAUDE.md) "Ventilation panel fidelity and template-matching rules" | 12 rules, 17-item acceptance list, 10-step QA |
| [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) Ventilasjon | Anatomy and statistics |
| [AI-AGENT-INSTRUCTIONS.txt:21](AI-AGENT-INSTRUCTIONS.txt) | The whole thing in one line |

Skeleton coordinates appear in four files, cluster offsets in three, sidebar
geometry in four, z-bands in four, the sanitization field list in four.

**Impact.** This is why F1 needed seven separate edits and F6 needed three. Each
copy drifts independently; the set has already drifted.

**Action.** One geometry owner —
[VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) — referenced
by the rest. The compressed instructions file necessarily restates a summary; it
must say which file it is a summary *of*.

### F20. Four kinds of information are interleaved in every document

The set mixes:

1. **Host facts** — what the Designer and the userscript do (CLAUDE.md's job)
2. **Output invariants** — what a valid file must contain (AI-BRIEFING's job)
3. **Object vocabulary** — which ids exist (DESIGN-OBJECT-CATALOG's job)
4. **Measured geometry** — where things go on a real panel (nobody's job)

Category 4 having no owner is the structural cause of F9 through F15: measured
facts were recorded wherever someone happened to be writing, so they were recorded
partially and inconsistently.

The consequence for an AI is that it cannot tell a **host constraint** (violating
it breaks the import) from a **layout convention** (violating it looks wrong) from
a **fleet statistic** (violating it means nothing). All three are written in the
same voice.

**Action.** This is the single most important change in the rewrite. Every rule in
the revised set carries a scope tag: `GLOBAL`, `VENT`, `REF-9099`, `SCREENSHOT`,
`ADVISORY`.

### F21. Source precedence exists in two places with different rankings

[DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) rule 7 and
[PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) both state that a user-supplied panel
JSON outranks the document — correct and valuable.
[AI-BRIEFING.txt](AI-BRIEFING.txt) §7a has an EVIDENCE PRIORITY list of 5 ranks.
Neither list mentions screenshots, and no list is complete.

**Action.** One 7-rank list, stated identically in every deliverable, including
screenshots at rank 1, with the rule **do not average conflicting coordinates.**

---

# Duplicate and conflict register

Required by the audit brief; summarised for lookup.

## Duplicate rules

| Rule | Stated in |
|---|---|
| Ventilation skeleton coordinates | AI-BRIEFING §7a-2, CLAUDE.md fidelity rules, AI-AGENT-INSTRUCTIONS:21, PANEL-TYPE-GUIDE |
| Fan cluster offsets | AI-BRIEFING §7a-3, CLAUDE.md, AI-AGENT-INSTRUCTIONS:21 |
| Sidebar header positions | AI-BRIEFING §7a-4, CLAUDE.md, AI-AGENT-INSTRUCTIONS:21, PANEL-TYPE-GUIDE |
| Z-index bands | AI-BRIEFING §7a-5, CLAUDE.md, AI-AGENT-INSTRUCTIONS:21, PANEL-TYPE-GUIDE |
| Sanitization field list | AI-BRIEFING §7a-7, CLAUDE.md ×2, AI-AGENT-INSTRUCTIONS:21 |
| No `image_svg` on Ventilasjon | AI-BRIEFING §7a-1, CLAUDE.md, AI-AGENT-INSTRUCTIONS:21, PANEL-TYPE-GUIDE |
| Source precedence | DESIGN-OBJECT-CATALOG rule 7, PANEL-TYPE-GUIDE, AI-BRIEFING §7a EVIDENCE PRIORITY |

## Contradictory rules

| # | Conflict | Resolution |
|---|---|---|
| 1 | `gr C` versus `°C` | `°C`. Production, rank 2, beats generic advice, rank 7 |
| 2 | `background_embedded false` versus the blank sidebar | Blank sidebar for Ventilasjon; `false` is the table-panel default |
| 3 | `zIndex "default"` versus the bands | Bands for Ventilasjon; never mixed within one panel |
| 4 | "Never overlap" versus schematic overlaps | Overlap is intentional for a closed list of pairs; judged on rendered pixels |
| 5 | `header_grey75` 260 / 260-280 versus 250 | 250×20 |
| 6 | `exhaust_pipe_horisontal` 50×18 versus 1025×18 | Palette default versus placement; stretch to the run |
| 7 | `RT510`/`RT410` versus `RT520`/`RT420` on the same coil | Position is transferable, code is not |
| 8 | Catalogue `W×H` as placement size versus measured placements | Catalogue is vocabulary; export is geometry |
| 9 | Sidebar columns 1330 versus 1329 versus 1332 | 1330 normative; deviations recorded |
| 10 | Third header y 357 versus y 400 | Source-dependent |

## Rules to remove

| Text | File | Reason |
|---|---|---|
| `plain ASCII (gr C) safest` | AI-AGENT-INSTRUCTIONS:15 | F1 |
| `Safe default: plain ASCII ("gr C", …)` | AI-BRIEFING:322 | F1 |
| `plain-ASCII text as the safe default` | CLAUDE.md:486 | F1 |
| `gr C` in six worked examples | AI-BRIEFING:459, 480, 485, 560, 940; AI-AGENT-INSTRUCTIONS:21 | F1 |
| `85 objects differ in posLeft, 84 in posTop, 66 in obj_id` | CLAUDE.md:402 | F2 |
| `still differ in every coordinate` | CLAUDE.md:452 | F2 |
| `number_v3_header_grey75 260x20` | AI-AGENT-INSTRUCTIONS:11 | F3 |
| `number_v3_header_grey75, W 260-280` | AI-BRIEFING:310 | F3 |
| `number_v3_exhaust_pipe_horisontal 50x18` | AI-AGENT-INSTRUCTIONS:11 | F3 |
| `W×H is the placement size in pixels` | build-object-catalog.py:469 | F4 |

**Nothing else is proposed for removal.** No technical detail is deleted to
shorten a document; every correction above replaces a wrong statement with a
measured one.

## Rules to add

| Rule | Owner | Finding |
|---|---|---|
| 7-rank source precedence, screenshots at rank 1, no averaging | all | F21 |
| Scope tags on every rule | all | F20 |
| `number_v3_label_11px_norm` renders left-aligned; centring formula | geometry contract §7.2 | F9 |
| Bypass as an atomic cluster with its intentional overlaps | geometry contract §3 | F10 |
| Overlap detection on rendered glyphs; closed exception list | QA checklist | F11 |
| Sidebar spacing measurements and the `_no_tag` preference | geometry contract §8.5 | F12 |
| Diff panels by role, never by array index | CLAUDE-REVISED, geometry contract | F2 |
| Catalogue is vocabulary, export is geometry | catalogue rule 5 | F4 |
| Position transfers, instrument code does not | geometry contract §5.6 | F6 |
| Alarm dy normative, dx a clearance judgement | geometry contract §5.2 | F7 |
| 14-step render QA with zoomed crops and restart-on-failure | QA checklist | F15 |
| Production-versus-generated field asymmetries | geometry contract §11 | F18 |
| Coverage of roles is the target, not object count | all | F16 |
| The 8 000 limit counts characters; measurement command recorded | CLAUDE-REVISED | F8 |

## Where production examples should replace prose

| Prose | Replacement |
|---|---|
| "vertical pitch is compact and consistent" | 25 px pitch, label at value y + 5, box 62×22 |
| "sidebar headers share a consistent width and alignment" | 250×20 at x 1150, y 0 / 165 / source-dependent |
| "sidebar values form clean columns" | x 1260 and x 1330, centres 1291 and 1361 |
| "bells NEXT TO their component" | dy −19 from the fan; per-cluster table of all seven bells |
| "align carefully" / "avoid overlap" | the centring formula and the intentional-overlap table |
| "clusters move whole" | per-cluster offset tables, §5 of the geometry contract |

---

# Evidence required

Open items. **Nothing below was guessed.**

1. **`iwmac-panel_9099_360-001-ventilasjon_20260809-1857.json` is absent.** Every
   `REF-9099` figure comes from `..._recommended.json`. If the 1857 export is a
   different revision, the geometry contract must be re-measured against it.
2. **No screenshots were supplied.** The `Tilluft` rendered width of 32 px, the
   `Avtrekk` width of 40 px, the LV402 LED at (700, 466) and the Aggregatstatus
   pill layout are recorded as stated corrections, not verified measurements. They
   are tagged `SCREENSHOT` and, under precedence rank 1, still outrank production.
3. **`Aggregatstatus` appears in no export.** The pill's geometry is unknown; the
   nearest production analogue places its LEDs *outside* the pill.
4. **The 13 px LED variant for LV402 is unknown.** The family exists in the
   catalogue; no inspected export places one.
5. **No font-metric table exists** for `number_v3_label_11px_norm`, so the centring
   formula cannot be applied to a heading whose rendered width has not been
   measured.
6. **Rotor frost protection has no known position** — no export carries one.
7. **No production evidence establishes a minimum rendered gap.** The 4 px floor
   in the QA checklist is advisory; production's own margin is ≈ 6 px.

---

# Files changed by this audit

| File | Change |
|---|---|
| [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) | **New.** Measured geometry, the missing category-4 owner |
| [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) | **New.** 14-step render QA, overlap detection, exception list |
| [CLAUDE-REVISED.md](CLAUDE-REVISED.md) | **New.** Restructured primary reference |
| [AI-BRIEFING-REVISED.txt](AI-BRIEFING-REVISED.txt) | **New.** Self-contained generation contract |
| [AI-AGENT-INSTRUCTIONS-REVISED.txt](AI-AGENT-INSTRUCTIONS-REVISED.txt) | **New.** Compressed, within the 8 000-char cap |
| [documentation-rules.json](documentation-rules.json) | **New.** Machine-readable rule set |
| [documentation-change-log.md](documentation-change-log.md) | **New.** Per-change record |
| [AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt) | F1, F3 applied in place |
| [AI-BRIEFING.txt](AI-BRIEFING.txt) | F1, F3 applied in place |
| [CLAUDE.md](CLAUDE.md) | F1, F2, F8 applied in place |
| [build-object-catalog.py](build-object-catalog.py) | F4 applied; catalogue regenerated |
| [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) | Regenerated from the corrected generator |

**No production reference JSON was modified.** No parameter ID was invented.
