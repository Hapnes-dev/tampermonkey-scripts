# Documentation audit — IWMAC Designer ventilation generation

Audit of the documentation set that an AI reads before generating a
`360.NNN Ventilasjon` panel. Date: 2026-08-09.

> **This file now carries three audits.** Everything down to "Files changed by
> this audit" is the ventilation audit of 2026-08-09, findings **F1–F21**,
> unchanged. The [2026-08-10 addendum](#addendum--2026-08-10-the-oversikt-store-overview-incident)
> audits the same document set against the **Oversikt** (store overview) panel
> type after a real failure, findings **F22–F28**. The
> [2026-08-11 addendum](#addendum--2026-08-11-the-oversikt-centering-correction)
> audits the Oversikt set **against itself** after a placement correction on a
> delivered panel, findings **F29–F35** — the first of the three whose subject is
> a rule that was present and followed rather than missing. All three use the
> same severity scale.

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

**Update (2026-08-11).** The gap this finding names now has a `GLOBAL` owner:
[VISUAL-CORRECTNESS-CONTRACT.md](VISUAL-CORRECTNESS-CONTRACT.md) §3 states the
role-scoped rule (a live object never covers descriptive text; live-over-artwork
classes stay deliberate) and
[validate-visual-correctness.py](validate-visual-correctness.py) makes it
executable — rectangle intersection on declared geometry, container children
resolved to panel-absolute coordinates, with the exception list derived from the
supplied source panel itself (`VC-T03`: same object pair, same relative
arrangement, ±2 px) rather than hand-maintained. Two parts of F11 remain open,
and the contract records both in its cannot-see section: overlap is still judged
on **declared** rectangles, so a `posHeight` 1 label whose rendered glyphs are
~11 px tall still evades detection, and text living inside background artwork is
invisible to any JSON-level check.

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

---

# Addendum — 2026-08-10: the Oversikt (store overview) incident

**Scope.** Everything above is the ventilation audit of 2026-08-09 and is
unchanged. This addendum audits the same document set against a different panel
type, after a real failure. It uses the same severity scale and continues the
finding numbering at **F22**. Nothing above was re-measured, and no ventilation
or Maskin rule was touched.

**Evidence.** E14–E17, defined in the table at the head of
[documentation-change-log.md](documentation-change-log.md), which owns them.
Briefly: **E14** is the production export supplied with the task — 650 882 bytes,
72 objects, 21 controller clusters, plant 10113, uncommitted because it carries a
live plant id and 72 real driver ids. **E15** is E14 masked and committed as
[reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json);
every measurement below is reproducible from it. **E16** is the two failed
attempts, 10 624 and 54 227 bytes, also uncommitted. **E17** is the seven
synthetic negatives.

**Documents audited against E14/E15:** [CLAUDE.md](CLAUDE.md),
[AI-BRIEFING.txt](AI-BRIEFING.txt),
[AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt),
[PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) and
[reference_data/panel-conventions.json](reference_data/panel-conventions.json).

## The incident

A store-layout PDF and a production Oversikt export were supplied together, with
a request to create or repair the panel.

1. The first attempt read the PDF and produced a **dashboard-like grouping** —
   objects regrouped into cards and rows rather than placed on the store plan.
   10 624 bytes.
2. The second attempt imitated the *appearance* of a store overview but rebuilt
   it from the drawing: **9 controller clusters, some misplaced**. 54 227 bytes.
3. The supplied export holds **72 objects in 21 controller clusters** — 21 alarm
   bells, 21 value boxes, 15 cooling symbols and 15 defrost symbols.

So the second attempt delivered **43 %** of the store's instrumented positions,
and it did so from a file that was already correct and already in hand. The
correct recovery was never a rebuild: it was to preserve the supplied export and
patch only what the request actually changed.

**The failure mode is not a malformed panel.** Both attempts parse. The
nine-cluster reconstruction has valid structure, a real background, correct
object vocabulary, clean bindings and no overlaps — it inserts without an error
and looks like an Oversikt. It is simply missing more than half the store, and
nothing inside a single document says how many controllers a store has.

## Root cause

Seven findings. Each is a property of the documentation set, not of the agent
that read it.

### F22 (S1 — wrong). MODE D authorized rebuilding a panel that was already supplied

`AI-BRIEFING.txt` §7b MODE D applied to **any** byggeplan or store-plan upload:
draw a simplified plan, place one cluster per position, take aliases from the
plan labels. It carried no clause excluding the case where a production export
of the same panel was also supplied.
`AI-AGENT-INSTRUCTIONS.txt` carried the same mode in compressed form, with the
same omission.

This is the exact path the incident took. An agent holding both a PDF and an
export followed the mode that matched the *PDF*, because that was the only mode
whose trigger it recognized. **Fixed** in both files: MODE D is now gated on *no
production export of the panel existing*, its result must be labelled a draft,
and both files state that with an export in hand the export is patched instead.

### F23 (S1 — wrong). One cluster geometry was published as if it were universal

The case cluster appeared once, in `panel-conventions.json`, as a fleet median
over 28 occurrences from 16 stores — and was reprinted in `CLAUDE.md` with no
scope tag. It reads as *the* cluster geometry. It is the geometry of **no single
panel**: it separates the cooling and defrost symbols by (18, 3), while on E15
those two symbols are deliberately **coincident** on all 15 clusters that have
them.

**Fixed** by recording both measurements side by side with explicit scope tags —
`FLEET-194` and `TEMPLATE-10113` — and an instruction not to average them
(conflict `OV-C1`). The survey file was **not** overwritten: it is the only
fleet-level evidence in the repository, and replacing its median with one store's
numbers would be the averaging the source-precedence rule forbids.

### F24 (S3 — misleading). A hand-off was documented as a layout

MODE B emits one cluster per position on a **90 px grid**. That is legitimate —
it is a *kit* the human drags onto the floor plan after insert. Nothing said so.
Read as a layout, it produces precisely the dashboard the first attempt
delivered.

**Fixed**: MODE B in both the briefing and the instructions file now states that
a kit is a hand-off and must be labelled one, and that a delivered panel whose
clusters sit in a grid is a defect (conflict `OV-C2`). `O-G06` detects it.

### F25 (S2 — undetermined). Cluster membership had no stated rule

Every worked example showed four objects per controller. Nothing said whether
four was a requirement, a convention or a coincidence. On E15, **15 of 21**
clusters carry all four roles and **6 carry alarm plus value only** — those six
controllers do not expose cooling or defrost.

Left undetermined, an agent picks a number, and both available guesses are
wrong: force four and it invents bindings; drop to two and it deletes real ones.
**Fixed**: coverage is derived from the source in every document that mentions
it, `PANEL-TYPE-GUIDE.md` carries a "not always four" rule, and the validator
reports partial clusters as `INFO`, never as a warning — a warning would push
authors to "repair" real panels.

### F26 (S2 — undetermined). No step in any procedure counted anything

There was no Oversikt procedure at all, and the generic ones never inventory the
source. An agent could complete every documented step and still not know that
twelve controllers were missing, because no step asked.

**Fixed**: `OVERSIKT-AUTHORING-GUIDE.md` step 3 is a controller-and-case
inventory with a **hard stop** — if the inventory cannot be completed, the
deliverable is the inventory plus a named gap, not a panel.

### F27 (S4 — structural). No document owned the Oversikt rules

The cluster was described in three files, in three different shapes, none of
them authoritative: a fleet median in `panel-conventions.json`, a 90 px kit grid
in `AI-BRIEFING.txt` §7b, and a prose summary in `PANEL-TYPE-GUIDE.md`. This is
the same category-4 gap F19 recorded for ventilation, on a different panel type.

**Fixed**: `OVERSIKT-GENERATION-CONTRACT.md` is the single owner; the other four
files carry routing tables pointing at it and keep only what they own.

### F28 (S3 — misleading). Structural validity was the whole acceptance bar

The implicit bar was "the JSON parses and inserts". The nine-cluster
reconstruction clears it. So does a panel with every cluster in the wrong room.

**Fixed**: `OVERSIKT-QA-CHECKLIST.md` separates necessary from sufficient in
Stage 0 and states in the file what the validator cannot see; the compare mode
exists specifically to catch what a single document cannot express; and Stage F
(render and look at it) cannot be satisfied by any script.

## Corrective controls

| Finding | Control | Where it lives |
|---|---|---|
| F22 | MODE D gated on no export existing; preserve-and-patch outranks every mode below it | `AI-BRIEFING.txt` §7b, `AI-AGENT-INSTRUCTIONS.txt` |
| F22 | `O-C01`/`O-C03` — dropped objects and missing controllers are errors in compare mode | `validate-oversikt-panel.py` |
| F23 | Both measurements published with scope tags and a do-not-average rule | `CLAUDE.md`, `AI-BRIEFING.txt`, contract §12 (`OV-C1`) |
| F24 | Kit must be labelled a kit; lattice detection | briefing/instructions MODE B; `O-G06` |
| F25 | Coverage derived from the source; partial clusters are `INFO`; padding is an error | contract §8, `O-G05`, `O-C05` |
| F26 | Inventory step with a hard stop before any edit | `OVERSIKT-AUTHORING-GUIDE.md` step 3 |
| F27 | One owner document; routing tables in the other four files | `OVERSIKT-GENERATION-CONTRACT.md` |
| F28 | Staged QA; mandatory render; `--compare` and `--profile` modes | `OVERSIKT-QA-CHECKLIST.md`, `validate-oversikt-panel.py` |
| all | The rules as data, regenerated not hand-edited, with `--check` asserted by a test | `build-oversikt-rules.py`, `documentation-rules.json` |

**The load-bearing one is `--compare`.** Omission cannot be detected inside a
single document, so no amount of prose or structural validation would have
caught this incident. Comparison against the supplied source would have caught
it on the first attempt, in one command.

## Files changed by this addendum

| File | Change |
|---|---|
| [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) | **New.** Measured geometry, coverage contract, conflicts `OV-C1`–`OV-C3`, the incident (§13), open evidence (§15) |
| [OVERSIKT-AUTHORING-GUIDE.md](OVERSIKT-AUTHORING-GUIDE.md) | **New.** 11-step procedure with the inventory hard stop |
| [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md) | **New.** Stage 0 and Stages A–G |
| [OVERSIKT-COPILOT-PREFLIGHT.md](OVERSIKT-COPILOT-PREFLIGHT.md) | **New.** 20-item short form for a Copilot knowledge file |
| [validate-oversikt-panel.py](validate-oversikt-panel.py) | **New.** `--check`, `--profile`, `--compare` |
| [build-oversikt-rules.py](build-oversikt-rules.py) | **New.** Generator for `panel_types.oversikt`; `--check` |
| [build-oversikt-fixture.py](build-oversikt-fixture.py) | **New.** Masking sanitizer, E14 → E15 |
| [build-oversikt-negatives.py](build-oversikt-negatives.py) | **New.** Seven negatives |
| [render-oversikt-panel.py](render-oversikt-panel.py) | **New.** Native-size preview with source-ghost overlay |
| [reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json) | **New.** The masked reference, 72 objects |
| [tests/test_oversikt_10113_contract.py](tests/test_oversikt_10113_contract.py) | **New.** 56 tests |
| [documentation-rules.json](documentation-rules.json) | `panel_types.oversikt`, the `TEMPLATE-10113` profile, E14–E17, two scope tags — regenerated |
| [CLAUDE.md](CLAUDE.md) | F23, F27 applied; Oversikt routing and five host facts added |
| [AI-BRIEFING.txt](AI-BRIEFING.txt) | F22, F23, F24, F25, F27 applied in place |
| [AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt) | F22, F24, F27 applied in place, inside the 8 000-character cap |
| [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) | F25, F27 applied in place |
| [documentation-change-log.md](documentation-change-log.md) | Part 7; evidence E14–E17 |
| [reference_data/panel-conventions.json](reference_data/panel-conventions.json) | **Unchanged, deliberately** — see F23 |

`AI-BRIEFING-REVISED.txt`, `AI-AGENT-INSTRUCTIONS-REVISED.txt` and
`CLAUDE-REVISED.md` were **not** given Oversikt content: per their own status
headers they are change records, and mirroring the contract into them would
recreate the multiple-owner problem F27 records.

## Tests added

Run from `iwmac-designer-reference/`. The repository convention is per-module —
`discover -s tests` fails because `tests/` has no `__init__.py`.

| Command | Covers | Result |
|---|---|---|
| `python -m unittest tests.test_oversikt_10113_contract` | The fixture's structure and counts, controller identity and matching under renumbering, each of the seven negatives failing on the rule it breaks, and `build-oversikt-rules.py --check` | Ran 56 tests — **OK** |
| `python -m unittest tests.test_maskin_10229_contract tests.test_maskin_compressor_bank tests.test_list_panel_contract tests.test_ventilation_profile_9099 tests.test_build_ventilation_corpus` | Regression across every earlier panel type | Ran 188 tests — **OK** |
| `python validate-oversikt-panel.py reference_data/oversikt-10113-sanitized.json [--profile TEMPLATE-10113]` | The reference passes clean in both modes | 0 errors, 2 warnings, exit 0 |
| `python validate-oversikt-panel.py --compare <src> <src>` | The legitimate case: partial clusters preserved | 0 errors, exit 0 |
| `python build-oversikt-negatives.py --out survey-tmp/oversikt-negatives` then `--compare` each | All seven negatives | exit 1 on all seven |

The two warnings on the clean runs are the `O-G07` overlaps — two production
adjacencies preserved from E14 and deliberately not corrected.

**The negative that matters most is `nine-cluster-reconstruction`**, the incident
itself. It **passes** a bare `--check` and fails only under `--compare` or
`--profile TEMPLATE-10113`, with `O-C03` naming all twelve missing controllers.
That asymmetry is stated in every document this addendum lists, because it is
the lesson.

## Remaining evidence gaps

Nine open items, owned by [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md)
§15, which states what would settle each. Summarized here so the audit reads
standalone; §15 wins on any difference.

1. **One export, one store, one chain.** Every Oversikt coordinate in the
   repository comes from E14. There is exactly one measured profile.
2. **The fleet survey cannot be re-derived.** `panel-conventions.json` records a
   median over 28 clusters from 16 stores; those source exports are not in the
   repository, so `OV-C1` and `OV-C3` cannot be resolved, only recorded.
3. **Navigation is unobserved.** All 72 objects carry the placeholder
   `link_name` `"link_name"` and empty `link_tag`, `sub_group` and `unit_ref`.
4. **Why six clusters carry only two roles is inferred, not confirmed.** The 15
   four-role clusters are all `000:NNN`; the 6 two-role ones are exactly
   `C50`–`C52` and `U86`–`U88`. A parameter dump would settle it.
5. **Canvas.** Only 1400 × 750 has been seen for this panel type.
6. **The two `O-G07` overlaps** are recorded as genuine adjacencies on the store
   plan; that reading has not been confirmed against the plan itself.
7. **The 21 single-space `tag_text` values** have no known origin.
8. **The incident's PDF was not retained**, so the specific way it under-listed
   positions cannot be measured.
9. **Byggeplan as an input class is unmeasured** — no Oversikt in the repository
   is known to have been produced from one.

**A stated gap is a deliverable; a guess is not.** Nothing above was inferred
from a second source and presented as measured.

---

# Addendum — 2026-08-11: the Oversikt centering correction

**Scope.** Everything above is unchanged: the ventilation audit of 2026-08-09
(F1–F21) and the Oversikt incident addendum of 2026-08-10 (F22–F28). This
addendum audits the **Oversikt documentation set against itself** after a real
placement correction on a delivered panel, using the same severity scale and
continuing the finding numbering at **F29**. Nothing above was re-measured, no
earlier finding was reopened, and no ventilation, Maskin, list-panel or
room-control rule was touched.

**What is different about this one.** The two audits above each found rules that
were **missing** — no owner, no procedure, no scope tag. This one audits a rule
that was **present, followed, and still not enough**. `OVERSIKT-GENERATION-CONTRACT.md`
§7.1 said a controller cluster belongs on the case, cabinet, cold room or
freezer room it monitors. The panel that had to be corrected satisfied that
sentence completely. So the defect being audited is not absence — it is a
**word doing four jobs**, which is a harder failure to see and a much easier one
to follow off a cliff.

**Evidence.** **E14**, **E15** and **E17** as defined at the head of
[documentation-change-log.md](documentation-change-log.md), plus **E22**, added
by this pass: a second production Oversikt export (plant 10240, 128 objects, 32
controller clusters, canvas 1400 × 750, value objects 42 × 22, z-bands 110/375).
E22 is **uncommitted** — it carries a live plant id and 128 real driver ids — and
was deliberately not masked into a second profile (see the gaps section, and
change 135 in the log).

**Documents and tools audited against E15, E22 and the correction:**
[OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md),
[OVERSIKT-AUTHORING-GUIDE.md](OVERSIKT-AUTHORING-GUIDE.md),
[OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md),
[OVERSIKT-COPILOT-PREFLIGHT.md](OVERSIKT-COPILOT-PREFLIGHT.md),
[AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md), [AI-BRIEFING.txt](AI-BRIEFING.txt),
[AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt),
[PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md), [CLAUDE.md](CLAUDE.md),
[documentation-rules.json](documentation-rules.json),
[validate-oversikt-panel.py](validate-oversikt-panel.py),
[render-oversikt-panel.py](render-oversikt-panel.py) and
[tests/test_oversikt_10113_contract.py](tests/test_oversikt_10113_contract.py).

## The incident

A store-layout PNG and a plant parameter workbook, and later a panel JSON that
needed a layout correction.

1. The generated panel was **almost right**. Every controller carried its linked
   alarm, temperature/value, cooling and defrost objects, and every cluster sat
   near the equipment it monitors. Nothing about it was malformed.
2. The correction was one sentence: **the temperature bubble must be in the
   centre of every box.**
3. The objects had been built around approximate **label or cluster anchors** —
   the text beside the case, or the middle of the four-object group. Both are a
   few tens of pixels from the centre of the drawn box, which is exactly how far
   wrong the panel looked.

**The documentation could neither defend the original nor derive the correction.**
Its rule was about the *cluster*; the user was looking at the
`number_v3_40px_no_conn_no_tag` inside it. A reviewer reading §7.1 and stopping
had no basis to fault the delivered panel — which is what happened.

**And the failure mode is again not a malformed panel.** The delivered file
parsed, inserted, validated clean, kept every binding and every controller. It
was simply in the wrong place by a label's width, on every box in the store.

## Root cause

Seven findings. Each is a property of the documentation set — not of the agent
that read it, and not of the panel that came out.

### F29 (S3 — misleading). One placement rule was read as two, and only one was written

§7.1 stated where the **cluster** goes. Every downstream file repeated that
sentence — briefing §7b, the guide, the checklist, `PANEL-TYPE-GUIDE.md`,
`CLAUDE.md` — and none of them said anything about where the **value object**
goes inside it. A cluster assembled around a text label satisfies the written
rule and misses the box.

Read literally the rule is true; read as the whole rule it is a trap, which is
the definition of S3. It is also necessary: a value object centred on a box in
the wrong room is a worse defect, so level 1 could not simply be replaced.

**Fixed** by stating the rule as **two levels** that are explicitly not implied
by one another — level 1, the cluster on the equipment (original wording kept
verbatim); level 2, the value object in the visual centre of the equipment
footprint — and by naming which validator rule measures which (`O-C06` for level
1, `O-G08` for level 2). Contract §7.1, change 120.

### F30 (S2 — undetermined). Seven distinct concepts shared four words

*Footprint*, *anchor*, *centre* and *position* were each used for more than one
thing across the set, and in two cases within a single section. An agent asked to
"centre the object" had at least four defensible readings — the drawn box, the
cluster's own extent, the label's position, or "roughly there" — and picked one.

Worse, the collision was in the vocabulary the fix itself would have to be
written in: the sentence that corrects the panel cannot be written unambiguously
in a vocabulary where *footprint* means two rectangles.

**Fixed** by defining **seven terms**, each with what it is *and what it is not*:
equipment footprint · equipment centre · temperature/value anchor ·
controller-cluster geometry · text-label anchor · shared/combined equipment
footprint · uncertain or unmeasurable background target. And by resolving the
collision repository-wide: **footprint** now means the equipment's own rectangle
everywhere, and a cluster's own extent is a **cluster extent** — corrected in
contract §7.2, in `CLAUDE.md`'s two-scopes blockquote (the ~62 × 66 and 42 × 86
figures are cluster extents) and in the QA matrix. Contract §7.1a, change 121.

### F31 (S2 — undetermined). "Centre it" had no arithmetic anywhere

No formula existed in any document. Placement was described in prose and
reproduced by eye, which is not reproducible between two agents, or between one
agent and its own next run — and cannot be checked by anything but an opinion.

Three sub-defects were latent in the prose version, and all three are the kind
that survive review because the result looks nearly right:

- **Rounding.** `round(2.5)` is `2` in Python — banker's rounding — so the naive
  implementation lands one pixel left of centre on every other even-width
  footprint.
- **The object's size.** 42 × 22 is measured on E15 *and* E22, which makes it
  tempting to hard-code. Two stores are not the fleet, and a value object of
  another size silently mis-centres by half the difference.
- **The frame of reference.** A coordinate measured on a 1868 × 1000 background
  and written into a 1400 × 750 panel is wrong by 25 % if the scale is not
  stated and applied.

**Fixed**: contract §7.1b carries `value_left = round_half_up(x + (width - w) / 2)`,
`value_top = round_half_up(y + (height - h) / 2)`, the explicit never-centre-on
list (label, regulator name, cluster bounding box, approximate/OCR coordinate,
empty floor), the own-size rule, and `scale_x = panel_width / image_width`,
`scale_y = panel_height / image_height` stated and applied. `half_up()` is
implemented in the validator, the generator and the renderer, and a test asserts
all three agree. Change 122.

### F32 (S1 — wrong). The validator's silence read as a pass on something it had never checked

Before this pass, `validate-oversikt-panel.py` reported `0 errors, 2 warnings`
on the reference panel and said nothing about centering — because it cannot see
centering. **A panel JSON contains no equipment-box boundaries**: the artwork is
an opaque base64 PNG, so no amount of parsing answers "is the bubble on the box?"

That is S1 rather than S3. A tool that prints `0 errors` after a QA checklist
told the author to run it is making a claim, and the claim was not true of the
one property the correction was about.

**Fixed** in three parts. **(a)** An `iwmac-oversikt-footprints` sidecar —
measured boxes supplied alongside the panel, the same shape of evidence input as
`validate-romkontroll-panel.py --source-sql` — with `O-G09` checking its format,
duplicates, unknown controllers, zero-size boxes, self-contradicting records and
**unmeasured controllers as a stated gap**, and `O-G10` stating the measurement
scale once per resolution. **(b)** Without `--footprints`, the only `O-G08`
finding is an `info` saying the run proves nothing about centering, and the
closing summary repeats it. **(c)** `build-oversikt-footprints.py` emits the
template, `render-oversikt-panel.py --footprints` draws the measured box, its
centre and the implied value position in amber so the *measurement* can be
checked against the artwork.

**And the fix states its own limit.** The sidecar proves the arithmetic; it does
not prove that the measured rectangle is the **right** rectangle. Whether the box
is around the case *this* controller monitors remains QA stage C, a human looking
at a controller-level crop. Changes 123, 127, 128, 129.

### F33 (S2 — undetermined). The input-routing table had no row for how this task arrived

§6 carried five input classes: PDF only · screenshot/PNG only · background image
plus equipment list · production JSON supplied · production JSON plus PDF. The
2026-08-11 task matched **none** of them cleanly — it arrived as a PNG plus a
parameter workbook, and later as a panel JSON plus a **verbal correction** — so
the one instruction that mattered, *patch, do not rebuild*, had to be inferred
from a neighbouring row.

This is the same failure category as F22, one step further out: F22 was a mode
whose trigger matched the wrong input; F33 is an input with no matching trigger
at all.

**Fixed**: eight input classes, each naming what to produce *and* what it must
not do. The three new ones are PNG + workbook (build from both, measure the
boxes, state the scale, emit the sidecar), two panel JSONs (compare, choose one,
**never merge geometry** — a merge is a third layout nobody drew), and panel JSON
+ verbal correction (the whole document with only the named change, declared with
`--patch-scope`; and if the correction points at visual evidence you were not
given, **name the missing evidence** rather than inferring a coordinate from a
label, an SVG trace or an embedded image nobody measured). Reinforced globally in
[AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md) §1.2: a bare placement correction
inherits the delivered file, not the brief. Changes 125, 133.

### F34 (S3 — misleading). Preserve-and-patch had no step that proved anything had been preserved

The seven-step procedure ended at "apply the change and re-validate". Every step
was sound, and nothing in the sequence distinguished *only the temperature
objects moved* from *the temperature objects moved and an unrelated tidy-up came
along with them*. A geometry correction is the request most likely to carry
unrequested "improvements" out under the heading of the fix that was asked for.

**Fixed**: **nine** steps. The two additions are *name the change in the terms of
§7.1a before touching a coordinate* (which of the seven things is moving, and
relative to what) and *a source-to-candidate field-level diff afterwards*, with
the permitted difference stated exactly — `posLeft`/`posTop` on temperature/value
objects, and **no field difference at all** on every other object. Made
executable as `--patch-scope value-position` (`O-C16`), which is **declared, not
inferred**: the tool cannot guess what the user authorized. Changes 124, 127.

### F35 (S4 — structural). This pass's own instrumentation could launder itself into evidence

Found by running the documented workflow end to end rather than by running the
tests. `build-oversikt-footprints.py --synthetic` back-derives footprints from
the panel's own value objects, for exercising the checker. Fed to the validator,
it produced `INFO O-G08 21 of 21 measured value object(s) are centred …` and a
closing line stating centering had been checked — **a pass by construction,
proving nothing about the artwork.**

It is S4 because the shape is structural and recurring: the cheapest input to
produce is the one that satisfies the check. The tests did not catch it, and
neither did the documents, because both were written by the same pass that wrote
the generator.

**Fixed**: a sidecar stamped `synthetic: true` / `source: "synthetic-back-derived"`
now raises an `O-G09` **warning**, the closing summary says centering was not
proved, the renderer says so in the preview, and two tests assert both the
warning and that a *measured* sidecar is not falsely accused. The contract and
the QA checklist state it in their own words: *a delivery whose only centering
evidence is a synthetic sidecar has no centering evidence.* Change 127.

This is the one behaviour change in this pass to an existing rule, and it is
**stricter, not looser**.

## Corrective controls

| Finding | Control | Where it lives |
|---|---|---|
| F29 | Two explicit levels; level 2 stated as not implied by level 1 | contract §7.1; `O-C06` / `O-G08` |
| F30 | Seven defined terms, each with what it is *not*; *footprint* = equipment rectangle repo-wide, cluster extent for the other | contract §7.1a; `CLAUDE.md`; QA matrix; `documentation-rules.json` → `geometry_terms` |
| F31 | The formula, half-up, own object size, stated and applied scale, never-centre-on list | contract §7.1b; `half_up()` in validator + generator + renderer, asserted equal by test |
| F32 | Footprint sidecar as evidence input; no-flag disclosure; amber overlay for checking the measurement itself | `O-G08`, `O-G09`, `O-G10`; `build-oversikt-footprints.py`; `render-oversikt-panel.py --footprints` |
| F33 | Eight input classes, each with its own prohibition; placement corrections inherit the delivered file | contract §6; `AI-REQUEST-ROUTING.md` §1.2, §4 rule 8 |
| F34 | Nine-step preserve-and-patch with a field-level diff; declared patch scope | contract §6.2; `--patch-scope value-position`, `O-C16` |
| F35 | Synthetic sidecars announce themselves and disqualify the run's centering claim | `O-G09` warning; qualified summary; renderer notice; two tests |
| all | The rules as data, regenerated not hand-edited, `--check` asserted by a test | `build-oversikt-rules.py`, `documentation-rules.json` |

**The load-bearing one is the sidecar's absence.** F32 is the finding the whole
addendum turns on, and its control is unusual: the most important thing
`--footprints` does is **refuse to conclude** when it is not given. Every other
control here makes a rule checkable; this one makes an unprovable claim visibly
unproven, which is what the incident actually needed.

## Files changed by this addendum

| File | Change |
|---|---|
| [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) | §7.1 two levels · §7.1a seven terms · §7.1b the formula · §7.1c the sidecar · §6 eight input classes · §6.2 nine steps · §11 nine-item report · §12 `OV-C4` · §13.5 the incident · E22 · §15 item 1 partly settled |
| [validate-oversikt-panel.py](validate-oversikt-panel.py) | `--footprints`, `--center-tolerance`, `--patch-scope`; `O-G08`, `O-G09`, `O-G10`, `O-C16`; `half_up`; synthetic disclosure |
| [build-oversikt-footprints.py](build-oversikt-footprints.py) | **New.** Sidecar template generator; `--synthetic` labelled instrumentation |
| [render-oversikt-panel.py](render-oversikt-panel.py) | `--footprints` amber overlay, widened crops, legend, synthetic notice |
| [tests/test_oversikt_10113_contract.py](tests/test_oversikt_10113_contract.py) | 56 → **89** tests |
| [build-oversikt-rules.py](build-oversikt-rules.py) | `geometry_terms`, `value_centering`, `footprint_evidence`; six revised blocks |
| [documentation-rules.json](documentation-rules.json) | Regenerated, never hand-edited |
| [OVERSIKT-AUTHORING-GUIDE.md](OVERSIKT-AUTHORING-GUIDE.md) | Eleven steps; ten-column matrix with `UNMEASURED` as a stated gap; the centring procedure |
| [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md) | The centring block, including the synthetic-sidecar item |
| [OVERSIKT-COPILOT-PREFLIGHT.md](OVERSIKT-COPILOT-PREFLIGHT.md) | The short form of the rule and the two commands |
| [AI-BRIEFING.txt](AI-BRIEFING.txt) | §7b level 2, the seven terms, the formula, the sidecar |
| [AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt) | The centring sentence inside the 8 000-character cap — 7 952 chars, 7 987 worst-case CRLF, paid for by 19 itemized lossless cuts |
| [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) | The fourth overriding rule; the owner-table commands |
| [CLAUDE.md](CLAUDE.md) | Two owner rows; three rules → four; *cluster extent* ≠ *footprint* |
| [AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md) | §1.2 placement corrections inherit the delivered file; §4 rule 8 gains the centring instance |
| [documentation-change-log.md](documentation-change-log.md) | Part 9, changes 120–135; evidence E22; conflict `OV-C4` |
| [reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json) | **Unchanged, deliberately** — see the gaps section |
| [reference_data/panel-conventions.json](reference_data/panel-conventions.json) | **Unchanged, deliberately** — as in the 2026-08-10 addendum |

`AI-BRIEFING-REVISED.txt`, `AI-AGENT-INSTRUCTIONS-REVISED.txt` and
`CLAUDE-REVISED.md` were again left untouched, for the reason the previous
addendum gives: they are change records, and mirroring the contract into them
recreates the multiple-owner problem F27 records.

## Verification

Run from `iwmac-designer-reference/`.

| Command | Result |
|---|---|
| `python -m unittest tests.test_oversikt_10113_contract` | Ran **89** tests — **OK** (56 before this pass) |
| `python -m unittest tests.test_romkontroll_8653_contract tests.test_maskin_10229_contract tests.test_maskin_compressor_bank tests.test_list_panel_contract tests.test_ventilation_profile_9099 tests.test_build_ventilation_corpus` | Ran **285** tests — **OK (skipped=5)**; no regression in any earlier panel type |
| `python build-oversikt-rules.py --check` | `documentation-rules.json is up to date` |
| `python validate-oversikt-panel.py reference_data/oversikt-10113-sanitized.json [--profile TEMPLATE-10113]` | 0 errors, 2 warnings, exit 0 — **and a closing line saying centering was not checked** |
| `python build-oversikt-footprints.py … -o survey-tmp/fp-template.json` then `--footprints` it | **21 errors** — an unfilled template fails loudly, one `O-G09` per controller |
| the same with `--synthetic` | 0 errors, **3 warnings** — `O-G08` reports 21 of 21 centred **and** `O-G09` says the sidecar is synthetic and proves nothing |
| `--compare SOURCE CANDIDATE --patch-scope value-position`, 21 value objects nudged 3 px | 0 errors, 23 warnings (21 × `O-C06` nudge + the two baseline overlaps) — in scope |
| the same patch with one `alias_text` also changed | **exit 1** — `ERROR O-C16 patch scope 'value-position' was exceeded … alias_text x1` |

The two warnings on every clean run are the pre-existing `O-G07` overlaps,
recorded in contract §9.2 as genuine production adjacencies and deliberately not
corrected.

**Read the two `--footprints` rows together.** A synthetic sidecar makes `O-G08`
report every value object centred, and the same run says twice that this proves
nothing. That pairing is the design of the whole control: the arithmetic is
checkable, the measurement is not, and the tool is required to say which is
which.

## Remaining evidence gaps

The nine items owned by [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md)
§15 still stand, except that **item 1 is now partly settled and still open** —
E22 is a second production Oversikt, and it confirms the 42 × 22 value size, the
110/375 z-bands, four roles on all 32 clusters and the `OV-C4` relationship. It
contributes **no coordinate**: it is one more store, uncommitted, and averaging
two stores is exactly what `OV-C1` forbids. What is still wanted is an export
that may be *committed*.

This pass adds five gaps of its own, all of them created by the fix rather than
found in the documents:

1. **No measured footprint sidecar exists in the repository.** The format, the
   generator, four rules, the overlay and thirteen tests all exist; not one real
   measurement has been committed, because measuring the boxes is a human visual
   act on artwork only the reference carries. **`O-G08` has therefore never been
   run against real evidence** — only against synthetic instrumentation that
   announces itself as proving nothing.
2. **Whether the reference panel is itself centred is unknown**, and is nowhere
   claimed. E15 is evidence of what a production Oversikt looks like, including
   any value box that is not perfectly centred; "correcting" it would destroy the
   only committed evidence this contract has.
3. **The 2 px default tolerance is a judgement, not a measurement** — the slack
   of a hand-dragged object, chosen to keep production panels from failing on
   noise. No distribution of real deviations has been measured, because of gap 1.
4. **The combined A/B footprint union rule is unexercised.** No committed panel
   has a confirmed combined display case, so the rule is stated and tested
   synthetically but never applied to real evidence.
5. **E22 is uncommitted**, so its 32-cluster confirmation cannot be reproduced
   from the repository — the same limitation E14, E18, E20 and E21 carry, and for
   the same reason: a live plant id and 128 real driver ids.

**A stated gap is a deliverable; a guess is not.** No coordinate from plant 10240
entered any document, no second profile was created from it, and nothing above
was inferred from one store and presented as measured.
