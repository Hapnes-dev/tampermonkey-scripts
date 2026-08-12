# Documentation audit — IWMAC Designer ventilation generation

Audit of the documentation set that an AI reads before generating a
`360.NNN Ventilasjon` panel. Date: 2026-08-09.

> **This file now carries four audits.** Everything down to "Files changed by
> this audit" is the ventilation audit of 2026-08-09, findings **F1–F21**,
> unchanged. The [2026-08-10 addendum](#addendum--2026-08-10-the-oversikt-store-overview-incident)
> audits the same document set against the **Oversikt** (store overview) panel
> type after a real failure, findings **F22–F28**. The
> [2026-08-11 centering addendum](#addendum--2026-08-11-the-oversikt-centering-correction)
> audits the Oversikt set **against itself** after a placement correction on a
> delivered panel, findings **F29–F35** — the first whose subject is a rule that
> was present and followed rather than missing. The
> [2026-08-11 compressor-bank addendum](#addendum--2026-08-11-extending-a-compressor-bank)
> audits the **Maskin** set after seven failures in one sitting while extending a
> compressor bank, findings **F36–F41** — the first whose subject is a class of
> rule **no validator can enforce**, because the defects live in the panel's
> raster background and every file that carried them was structurally perfect.
> All four use the same severity scale.

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

---

# Addendum — 2026-08-11: extending a compressor bank

**Scope.** Everything above is unchanged: the ventilation audit of 2026-08-09
(F1–F21), the Oversikt incident addendum of 2026-08-10 (F22–F28) and the
Oversikt centering addendum of 2026-08-11 (F29–F35). This addendum audits the
**Maskin documentation set against itself** after a recurring workflow —
*generate a machine-room demo, then add one fixed-speed MT compressor, then
extend the background artwork to match* — produced seven failures in one sitting.
Same severity scale, numbering continues at **F36**. No ventilation, Oversikt,
list-panel or room-control rule was touched, and no earlier finding was reopened.

**What is different about this one.** The first two audits found rules that were
**missing**. The third found a rule that was **present but imprecise**. This one
finds a class of rule that **no validator can ever enforce**. A status strip
floating on white, a clone faded by a mask that multiplied source alpha, a
discharge branch that stops one pixel short of its header, a three-row
antialiased line reproduced as two rows — every one of those files is
structurally perfect. It parses, it inserts, it validates clean, every count
matches every array length. The defect is in the pixels, and the pixels are a
base64 blob to every check in this repository.

That changes what a fix can even be. The other three addenda ended in validator
rules. This one ends in a **QA stage that looks at the background with nothing on
top** and a **raster fixture the tests can actually fail against**, plus one
family of rules (`M-A01`–`M-A09`) that is documented as *deliberately not
validator-enforced* — because claiming otherwise would be worse than the gap: a
clean validator run on a faded clone would then read as proof.

**Six of the seven failures were order failures, not drawing failures.** Objects
placed before the artwork that draws their anchor existed; a repair attempted on
a damaged derivative instead of the retained original; a branch drawn before
anyone looked at the background alone. Only one was a drawing mistake in the
ordinary sense, and even that one — the alpha multiply — is arithmetic, not
craft.

**Evidence.** **E9**, **E10** (`TEMPLATE-10229`), **E12**
(`maskin-akpc-link-map.json`) and **E13** (the 96 × 64 instrumented fixture) as
defined at the head of [documentation-change-log.md](documentation-change-log.md),
plus **E24**, added by this pass: the delivered end state of the workflow, 69
`single_objects`, unlinked, with the fourth MT compressor cloned into the
embedded raster background. **E24 is uncommitted and is an authored demo, not a
measurement** — it is cited for what the workflow produced and never for
production geometry. Production compressor geometry comes from E10.

**Documents and tools audited against E10, E13, E24 and the incident:**
[MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md),
[MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md),
[MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md),
[MASKIN-COPILOT-PREFLIGHT.md](MASKIN-COPILOT-PREFLIGHT.md),
[reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt),
[reference_data/maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json),
[AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md), [AI-BRIEFING.txt](AI-BRIEFING.txt),
[AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt),
[PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md),
[VISUAL-CORRECTNESS-CONTRACT.md](VISUAL-CORRECTNESS-CONTRACT.md), `CLAUDE.md`,
[documentation-rules.json](documentation-rules.json),
[validate-maskin-panel.py](validate-maskin-panel.py) and
[tests/test_maskin_compressor_bank.py](tests/test_maskin_compressor_bank.py).

## The incident

A generated machine-room demo, then one sentence: *add another fixed-speed MT
compressor.*

1. The **dynamic cluster went on first** — status strip, capacity, runtime, and
   correctly **no VSD row**, because the compressor being added has no VSD. Three
   well-formed objects, every field present, counts consistent. They were sitting
   on empty background.
2. The artwork was then cloned from the source column with a **soft alpha mask**
   that multiplied source alpha. The whole clone came out faded — symbol, pipes,
   labels and pills together — and that uniformity read as a rendering artifact
   rather than as the compositing bug it was.
3. The **discharge branch did not reach the header.** A gap of a pixel or two,
   invisible in the delivered render because the value pill sits on it.
4. The first gap repair reproduced **two rows of a three-row antialiased line**.
   The result was thinner and harder-edged than every other pipe on the panel.
5. The working fix had to reproduce **every source row including its per-row
   alpha** — which is when it became clear the cyan suction header and the orange
   discharge header have **different measured thicknesses on the same drawing**,
   and that reusing one number for the other was itself a defect.
6. By then the derivative carried **cumulative raster damage from repeated
   edits**, unattributable after the fact. The only sound move was to restart
   from the retained original source.
7. The three objects and the artwork had to end up on **one measured translation
   vector**. Two vectors — one for the drawing, one for the objects — is
   invisible in JSON and unmistakable on screen.

Separately, and unresolved on purpose: the fourth compressor's Danfoss parameter
names are **not in `maskin-akpc-link-map.json`**, which covers C1–C3. They could
not be invented. The delivered objects shipped with `alias_text: ""`, which this
addendum records as a defect of its own (F40).

**The failure mode is, again, not a malformed panel.** Every intermediate file
would have passed `validate-maskin-panel.py` without a warning.

## Root cause

Six findings. Each is a property of the documentation set — not of the agent that
read it, and not of the panel that came out.

### F36 (S4 — structural). Adding a compressor is two request classes at once, and nothing owned the join

`AI-REQUEST-ROUTING.md` defines four classes: new unlinked demo · linked copy ·
**modification of a supplied export** · **background-only patch**. Extending a
bank is the third *and* the fourth simultaneously — one full document that must
carry all 66 pre-existing objects back unchanged, plus one background patch with
zero counts and three empty arrays. Nothing said a single request could be both.

So each document handled its own half and none handled the join, and the join is
where the order lives. The guide's §4 treated "add a compressor" as an instance
of editing and said nothing about sequence; the routing table had no row for a
request that produces two deliverables. **An unowned procedure has no order**,
and six of the seven failures were order failures.

It is S4 rather than S2 because the shape is structural and will recur: any
future request that spans two classes lands in the same seam.

**Fixed** by giving the procedure an owner and an explicit order — guide **§4a**,
nine ordered steps with the rule ids inline: retain the original (`M-A07`) · name
the two deliverables · measure the column actually being copied, **C3, not C1** ·
measure the two headers independently · fix one translation vector from a named
pair (`M-A01`) · **extend the artwork before any object exists** (`M-A06`) ·
connect the branches (`M-A05`) · inspect the background alone · place the objects
last (`M-A08`). And by the sentence that makes step 1 load-bearing: *on any
visual failure go back to step 1, not to step 6.* Changes 146, 152.

### F37 (S1 — wrong). The visual acceptance gate was blind to the defect class it existed to catch

QA stage C renders the full panel at native size **with the objects on** and
inspects one crop per role. Every document in the set points at it as the check
that catches drawing defects, and `MASKIN-COPILOT-PREFLIGHT.md` point 11 says in
so many words that only a render can see this.

The evidence contradicts it. The pills and the status strip cover **exactly** the
junction where a branch meets its header. A reviewer following stage C to the
letter is looking at the one view in which a 1 px gap, a dropped antialiasing row
and a faded junction are all hidden. The document states that a check catches a
defect class it structurally cannot see, and an agent following it ships a
defective panel believing it passed its own gate — which is S1 exactly.

**Fixed** by adding stage **C0**, run only when the artwork changed and run
**twice** — before the objects go on, and again on the delivered file. Decode
`panel.image_data`, open it at 100 % with nothing on top, and check six things:
the branch meets the header with the source's junction geometry (`M-A05`); the
new column matches the cloned column row for row including partial-alpha rows
(`M-A04`); the two headers were measured separately (`M-A03`); nothing is faded
(`M-A02`); one vector placed artwork and objects alike (`M-A01`); and nothing
that already existed moved, compared against the **retained original** rather
than the previous attempt. Change 148.

### F38 (S2 — undetermined). The drawing doctrine had no compositing arithmetic

[reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt)
carried the Illustrator doctrine — canvas layout, the circuit colour code as
function, symbol and pill rules, the light-skin-only rule — and four narrative
checklists. It was written for a **human drawing in Illustrator**. The actual
recurring task is **raster surgery on an exported PNG**, and for that the
document said nothing at all.

Three decisions were therefore left with no basis, and all three were invented:
whether a mask may be feathered (it may not — a pixel is copied or it is not);
whether "2 px wide" means two rows (it usually means three, one of them partially
transparent); and whether one measured thickness may serve two lines (it may not
— the orange discharge and cyan suction headers legitimately differ on the same
drawing). Each invented answer produced one of the seven failures.

The tell for the first is worth recording, because it is what made the bug
survive a look: multiplying source alpha fades the symbol, the pipes, the labels
and the pills **by the same factor**, and uniform wrongness reads as a rendering
artifact rather than as a copy that lost data.

**Fixed** by five numbered rules replacing the four narrative checklists, which
moved to the guide and the QA checklist where procedure and acceptance already
live: **R1** compositing must not multiply source alpha, a mask is binary · **R2**
measure every source line independently · **R3** reproduce every row the source
has, including partial-alpha antialiasing rows · **R4** restore headers and
junctions from the sampled source raster, not from an approximation · **R5**
after a failed iteration restart from the retained original. R1–R4 are tagged
`GLOBAL`: alpha arithmetic is not a property of machine rooms. Change 147.

### F39 (S3 — misleading). A measured drift table read as an instruction to reproduce the drift

Contract §6.1 publishes the compressor pitches measured on `TEMPLATE-10229` —
C1→C2 is 79/81/81, C2→C3 is 82/79/80, with 1 px of vertical drift between rows.
Every word of it is true. Two lines away, the cluster rule says relocate with
**one** vector.

Read together by someone extending a bank, the table looks like geometry to
reproduce, and reproducing it puts the three objects on three slightly different
offsets — and then the artwork on a fourth. Technically true, reliably misread:
S3. It is also the reason the one-vector rule was never connected to the
background at all, since the rule was written about *objects* and the drift table
was written about *objects*, and nothing in either mentioned the drawing
underneath.

**Fixed** as conflict **M-7**, resolved by scope rather than by averaging: §6.1
**measures what production drew by hand** and is not an instruction. When
extending a bank, one pitch from one **named** source pair applies to every layer
— compressor symbol, discharge branch, suction branch, status artwork, static
labels, empty pills **and** the dynamic objects — and `M-G04`'s 79–82 px range
still accepts it. A second vector anywhere is the defect (`M-A01`). E24's own
three objects share exactly one (+81, 0) offset, which is the rule holding.
Changes 146, 150.

### F40 (S2 — undetermined). "Unknown parameter" had no documented outcome, so an object shipped without its relink key

Two rules were both true and pointed opposite ways. QA stage D requires
`alias_text` on every object and calls a missing alias an unlinkable object.
`maskin-akpc-link-map.json` covers **C1–C3 only**, so a fourth compressor's
Danfoss parameters do not exist in any evidence this repository holds, and the
never-invent rule forbids deriving them from the group anatomy.

Nothing said what to *do*. The decision was invented, and the invented answer —
ship with `alias_text: ""` — is the worst of the three available: it satisfies no
rule, it destroys the role name along with the parameter, and it produces an
object **no one can ever link**, including the human with the plant's parameter
dump in hand.

**Fixed** as conflict **M-8**, resolved by separating the two things that were
being conflated. **The alias is required** — it is the role name and the relink
key, and it comes from the grammar `C<n> <MT|LT> <role>`. **The parameter is
unresolved** — it is the plant's binding, it is not in the map, and it stays
open. So the object ships with its grammar alias, `linked: "false"`, and the gap
is **reported as unresolved** until that plant's own parameter dump is supplied
(`M-A09`, preflight point 20). E24 shipped all three objects with the empty
alias, which is now named a defect rather than tolerated. Changes 150, 152.

### F41 (S4 — structural). Maskin could not prove an edit stayed inside its own scope, though two other panel types could

Oversikt gained `--compare` in Part 7 and `--patch-scope` in Part 9. Room-control
tables carry a verbatim-copy rule with a parameter dump behind it. Maskin had
neither: "this is the same panel plus one compressor" was a claim with nothing
behind it, and a class-3 edit that must return the entire supplied document had
no check that the other 66 objects came back unchanged.

That asymmetry is the S4 shape this scale names — the same control existing for
one panel type and not another, drifting further apart with every pass. It also
had a specific cost here: nothing could see that a column had been thinned, that
a new column was incomplete, or that a "background-only patch" was not actually
zero counts and three empty arrays.

**Fixed** by `--compare SOURCE CANDIDATE [--patch-scope SCOPE]`, pairing by
**role key** `(obj_id, alias_text, tag_text)` and never by array index, because
Insert renames every object from the live canvas child index. `M-C01` nothing
dropped · `M-C02` what may be added, and that an addition carries a non-empty
grammar-conformant alias · `M-C03` columns atomic across the pair, including **no
optional VSD row that no existing compressor on that side has** — the clone-C1
trap, caught mechanically · `M-C04` the declared patch scope held · `M-C05`
background and canvas. Four scopes: `compressor-addition`, `background-only`,
`position`, `none`. Change 149.

**What this finding does not claim.** `--compare` sees objects. It cannot see a
faded clone or a 1 px gap, and the contract says so in the enforcement column of
its own rule table. The artwork family is enforced by stage C0 and by the test
module, which is a weaker guarantee honestly labelled rather than a stronger one
implied.

### This pass's own defects

Following the precedent F35 set: this pass introduced an **evidence-id
collision** — it first numbered the compressor demo `E14`, which Part 7 already
used, and since all three rule builders write into the same
`documentation-rules.json`, the Maskin builder silently **overwrote** a live
Oversikt evidence record. It was found by running all three builders' `--check`,
not by reading, and not by the tests. Renumbered to **E24**, both records
regenerated, all three checks clean. That defect and four smaller ones are
itemized in change 153 of the log, which owns them.

The shared-namespace hazard itself is now a known property of the three builders
and is recorded there rather than left as a surprise for the next pass.

## Corrective controls

| Finding | Control | Where it lives |
|---|---|---|
| F36 | Nine ordered steps, artwork before objects, restart from the retained original on any visual failure | guide §4a; `M-A01`–`M-A09`; preflight point 19 |
| F37 | Stage **C0** — the background alone, at native size, nothing on top, run before the objects and again on the delivery | [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) |
| F38 | Five pixel rules; a mask is binary; every line measured independently; every row reproduced including partial alpha | [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) `R1`–`R5` |
| F39 | One vector from one **named** pair across artwork and objects; the pitch table declared a measurement, not an instruction | conflict `M-7`; contract §6.1 note, §16.1; `M-A01` |
| F40 | The alias is required, the parameter is unresolved; report the gap, never empty the alias | conflict `M-8`; `M-A09`; preflight point 20; `M-C02` |
| F41 | `--compare` + `--patch-scope`, paired by role key; columns atomic; the VSD trap caught mechanically | [validate-maskin-panel.py](validate-maskin-panel.py); `M-C01`–`M-C05` |
| all | The artwork rules stated as **not validator-enforced**, and given a raster fixture the tests fail against | contract §16.1 enforcement column; `CLAUDE.md`; [tests/test_maskin_compressor_bank.py](tests/test_maskin_compressor_bank.py) |

**The load-bearing control is stage C0's ordering, not its content.** Its six
checks are ordinary. What makes them work is that they run on a canvas with
**nothing on it** — the one moment in the whole procedure when the defects are
visible at all. Every other control here makes a rule checkable; this one makes a
rule *observable*, which is what the incident actually needed.

## Files changed by this addendum

| File | Change |
|---|---|
| [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) | §16 · §16.1 `M-A01`–`M-A09` with the enforcement column · §16.3 `M-C01`–`M-C05` · conflicts `M-7`, `M-8` · evidence `E24` · two rule-namespace rows |
| [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) | §4a — the nine ordered steps |
| [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) | Stage **C0** — the background alone |
| [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) | `R1`–`R5` replace the four narrative checklists |
| [validate-maskin-panel.py](validate-maskin-panel.py) | `--compare`, `--patch-scope`, `M-C01`–`M-C05`, role-key pairing, four scopes |
| [tests/test_maskin_compressor_bank.py](tests/test_maskin_compressor_bank.py) | 16 → **45** tests; nine helpers; three new classes |
| [tests/fixtures/maskin-compressor-bank/expectations.json](tests/fixtures/maskin-compressor-bank/expectations.json) | Six new keys; the raster fixtures themselves **unchanged** |
| [build-maskin-rules.py](build-maskin-rules.py) | The two rule families, conflicts `M-7`/`M-8`, evidence `E24` |
| [documentation-rules.json](documentation-rules.json) | Regenerated by all three builders, never hand-edited |
| [AI-BRIEFING.txt](AI-BRIEFING.txt) | Artwork-first bullet; the compositing bullet rewritten around *a mask is binary*; a stale pointer to the removed checklists repaired |
| [MASKIN-COPILOT-PREFLIGHT.md](MASKIN-COPILOT-PREFLIGHT.md) | Points **19** and **20**; 1–18 unchanged and unrenumbered |
| `CLAUDE.md` | Four rows in the Maskin owner table; the not-validator-enforced paragraph; the C1–C3 limit of the link map |
| [documentation-change-log.md](documentation-change-log.md) | Part 11, changes 146–154; evidence `E24`; conflicts `M-7`, `M-8` |
| [AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt) | **Unchanged, deliberately** — 7 949 characters against a hard 8 000 cap, 16 to spare. See the gaps section |
| [reference_data/maskin-10229-sanitized.json](reference_data/maskin-10229-sanitized.json) | **Unchanged, deliberately** — it is the evidence, not a draft |
| [reference_data/maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json) | **Unchanged, deliberately** — C1–C3 is what the evidence covers |

`AI-BRIEFING-REVISED.txt`, `AI-AGENT-INSTRUCTIONS-REVISED.txt` and
`CLAUDE-REVISED.md` were again left untouched, for the reason the 2026-08-10
addendum gives: they are change records, and mirroring a contract into them
recreates the multiple-owner problem F27 records.

## Verification

Run from `iwmac-designer-reference/`.

| Command | Result |
|---|---|
| `python -m unittest tests.test_maskin_compressor_bank` | Ran **45** tests — **OK** (16 before this pass) |
| `python -m unittest tests.test_maskin_10229_contract` | Ran **62** tests — **OK**, unchanged by this pass |
| `python build-maskin-rules.py --check` | `documentation-rules.json is up to date` — exit 0 |
| `python build-oversikt-rules.py --check` | `up to date` — exit 0. **Run because of the E14 collision, and the reason it was found** |
| `python build-romkontroll-rules.py --check` | `up to date` — exit 0 |
| character count of `AI-AGENT-INSTRUCTIONS.txt` | `7949` / `7984` worst-case CRLF — unchanged, against the hard 8 000 cap |

Test invocation is **per module** by convention: `python -m unittest discover -s
tests` fails here because `tests/` deliberately has no `__init__.py`, and adding
one is not a fix.

## Remaining evidence gaps

Created by the incident and by the fix, not found in the documents:

1. **No production export of a four-compressor Maskin exists.** `TEMPLATE-10229`
   has 3 MT and 3 LT. Every `M-A0*` rule is therefore exercised against the
   96 × 64 instrumented fixture (E13) and against E24, which is an authored demo.
   **No artwork rule in this pass has been measured against a production panel
   that actually has a fourth compressor.**
2. **The fourth compressor's Danfoss parameters remain unresolved, by decision.**
   `maskin-akpc-link-map.json` covers C1–C3. The group anatomy suggests the
   continuation and suggesting is not evidence. This is a gap the documentation
   now *requires* a future agent to report rather than close.
3. **The real panel's antialiasing profile has never been measured into any
   document.** The three-row orange header and two-row cyan header that the tests
   assert are properties of the miniature fixture — instrumentation, chosen to
   make the rule falsifiable. The rule says *measure the source*; the repository
   does not say what the source measures.
4. **E24 is uncommitted**, so the one real example of the clone this pass
   regulates cannot be reproduced from the repository — the same limitation E9,
   E14, E18, E20, E21 and E22 carry, and for the same reason.
5. **Stage C0 has no recorded execution.** It is a human visual act on a decoded
   PNG, and nothing in this repository records that a reviewer performed it on
   E24 or on anything else. The stage exists; evidence that it has ever been run
   does not. This is the honest shape of a control for a defect class no tool can
   see, and it is stated rather than papered over.
6. **The user prompt driving this pass arrived truncated**, cut off mid-sentence
   inside its third audit question (`"Does it distinguish"`). Questions 1 and 2
   are answered and closed in the log; question 3 is **recorded as unanswerable
   rather than guessed at**, following the precedent the previous addendum set
   for the same situation.

**A stated gap is a deliverable; a guess is not.** No coordinate entered any
document from E24, no parameter name was inferred from the group anatomy, and no
artwork rule was presented as validator-enforced.

---

# Addendum — 2026-08-11: removing equipment and rerouting a circuit

**Scope.** Everything above is unchanged: the ventilation audit of 2026-08-09
(F1–F21), the Oversikt incident addendum of 2026-08-10 (F22–F28), the Oversikt
centering addendum of 2026-08-11 (F29–F35) and the compressor-bank addendum of
2026-08-11 (F36–F41). This addendum audits the **Maskin documentation set
against a second artwork workflow** — *remove a static component from the drawing
and route the circuit that fed it somewhere else* — after one editing session
produced nine distinct raster defects and no failing check. Same severity scale,
numbering continues at **F42**. No ventilation, Oversikt, list-panel or
room-control rule was touched, and no earlier finding was reopened.

**Evidence.** Two kinds, and they are labelled differently throughout:

| Label | Meaning |
|---|---|
| *repository evidence* | text that is or is not in a committed file, quoted or cited by section |
| *evidence from this editing incident* (**E25**) | the observed failure sequence of the 2026-08-11 session. **The intermediate rasters were derivatives and were not retained**, so nothing was measured from them — which is the incident's own first finding |

**No count in this addendum is a repository-wide frequency.** Nine defects in one
session is a description of that session. Where a rule is said to be absent, the
absence was checked by reading the file; where a rule is said to be misread, the
misreading is E25's, once.

**What is different about this one.** The compressor-bank addendum (F36–F41)
found a class of rule no validator can enforce and answered it with a QA stage
and a raster fixture. This one finds that **those rules were written for the
workflow that produced them.** `M-A01`–`M-A09` sit under a heading that reads
*"Extending a compressor bank"*, and every one of them is phrased around a clone:
one translation vector, alpha copied verbatim, a copied branch connects. A
removal task inherits none of that phrasing. The panel is the same panel and the
pixels are the same pixels — and an agent reading the kit correctly found no rule
that named what it was doing.

**Six of the nine failures were not drawing failures.** They were an erase mask
that was never bounded, a background operation that was never separated from an
equipment operation, a crossing whose semantics were never decided, junctions
that were never enumerated, a comparison that was made against the previous
attempt, and a repair stacked on a derivative. The drawing skill was not the
missing thing.

## The incident

Recorded from the session, not measured (**E25**):

1. Three fixed-speed MT compressors were added successfully, by cloning the C3
   cluster. **The §16 workflow worked.**
2. A second request removed the internal bottom-right heat exchanger and routed
   *Liq. consumer* directly to the receiver.
3. An oversized erase rectangle removed part of the receiver tank.
4. Transparent pixels and opaque black cleanup pixels together produced a black
   background where a normal light background had been requested.
5. A direct yellow liquid line crossed a cyan pipe with no graphical bypass.
6. Repeated cleanup left black and partial-alpha remnants on the pipe.
7. Yellow and cyan sections were redrawn at inconsistent apparent thickness.
8. A cleared cyan corridor left a gap at the upper horizontal-to-vertical
   junction.
9. Another cleared corridor left a gap where the vertical riser met the lower
   *M-T Suct.* header.
10. **Structural JSON checks continued to pass throughout.** Every defect existed
    only in `panel.image_data`.
11. Repairing a derivative repeatedly made it progressively harder to distinguish
    original artwork from introduced damage.

## Root cause

**The kit had one artwork workflow and the request was the other one.** Adding
artwork and removing artwork fail differently: an addition's risk is that the new
thing does not match, and a removal's risk is that something else goes with it.
Every artwork rule in the repository on 2026-08-11 was written for the first
risk. Nothing named the second — no protection boundary, no erase-mask
discipline, no diff scope, and no rule that a background colour and an equipment
removal are two operations.

The second root cause is narrower and worth separating: **"look at it" was the
whole visual control.** Stage C0 said to inspect the background alone at native
size, which is correct and which E25 satisfied by looking at a full-panel
screenshot. Nothing said *which crops*, at *what magnification*, against *what
baseline* — so the evidence that would have shown a one-pixel junction gap was
never produced, and the defect survived three review rounds.

### F42 (S4 — structural). No document owned equipment removal and rerouting

*Repository evidence.* [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md)
carried §4a *"Extending a compressor bank — the ordered procedure"* and no
counterpart. [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) §16
is titled *"Extending a compressor bank"*. The rule ids `M-A01`–`M-A09` are all
phrased around a clone: *"one measured translation vector"*, *"compositing must
never multiply source alpha"*, *"a copied branch connects"*, *"artwork first,
objects second"*. `M-A07` — restart from the retained original — is the only one
that generalises without rewording.

*Consequence.* A removal request routes to the nearest procedure and inherits
its emphasis. E25 got the translation-vector discipline it did not need and none
of the erase discipline it did.

**Corrective.** A named, separate procedure — guide §4b — and a separate
normative section, contract §17, with its own rule namespace `M-A10`–`M-A19`.
The classification is stated first, because the request is an *artwork*
modification and the most expensive early error is treating it as an object one.

### F43 (S2 — undetermined). Nothing said which artwork must survive an erase

*Repository evidence.* Searching the kit as it stood, the words *protect*,
*protected* and *neighbour* appear in no artwork rule. `M-A02`'s prohibition —
*"NEVER paste an opaque rectangular crop over pipes or unrelated art"*
([maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) `R1`) — is
the closest text, and it is about **pasting**, not erasing. Nothing named the
receiver, or any other symbol, as a unit that must be complete.

*Evidence from this editing incident.* The erase rectangle was sized for the
heat exchanger and clipped the receiver, which sits beside it.

**Corrective.** `M-A11`: identify the exact component, identify every protected
neighbour, determine the smallest safe edit mask, never use a large rectangular
erase across mixed artwork, and restore from source the moment a cleanup reaches
a protected boundary. The receiver is declared an **atomic artwork cluster** —
body, rounded ends, outline, internal detail, level bar, labels and connection
pixels — as is every other complex equipment symbol. Contract §17.3 carries a
worked negative example of the failing mask.

### F44 (S2 — undetermined). Transparency and background colour were never distinguished

*Repository evidence.* The background-colour rule, added in Part 12, is about
*which colour*: *"preserve the background of a supplied production export …
Background colour is a requirement of the job, not of this method"*
([maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) §6,
contract §2). **No document in the kit mentions pixel alpha in the background at
all.** An agent asked for "the normal background" therefore has no statement that
a transparent pixel is not one.

*Evidence from this editing incident.* Transparent pixels plus opaque black
cleanup pixels produced a black panel where a normal light background was
requested — two different mistakes with one appearance.

**Corrective.** `M-A12` names four pixel classes and forbids conflating any two:
fully transparent, opaque source background, opaque black artwork, and
legitimately dark text and outlines. Flatten only confirmed background pixels;
never globally replace all dark pixels; sample several blank points across the
canvas *and* the sidebar afterwards; and keep the colour conversion as **its own
operation**, separately verified and separately reported.

### F45 (S2 — undetermined). Crossing versus junction was never a decision

*Repository evidence.* `M-A05` says *"A copied branch connects."* That is the
only statement in the kit about two runs meeting, and it assumes they should.
Neither *crossing*, *bypass*, *bridge* nor *bend* appears as a defined term
anywhere in the Maskin documents, so a route that crosses another circuit has no
rule to follow and no vocabulary to report in.

*Evidence from this editing incident.* The new liquid line crossed a cyan pipe
and was drawn straight through it, which reads as a junction between two circuits
that are not connected.

**Corrective.** `M-A15` defines four things that happen where runs meet —
junction, crossing without connection, bend, termination — and requires the
choice to be made *before* drawing. For a non-connected crossing: the underlying
pipe keeps its continuity, the foreground circuit is carried over by a bypass
drawn entirely in its own measured style, the bypass is visible at native size,
and the two circuits touch nowhere outside the one declared crossing window.

### F46 (S3 — misleading). "A copied branch connects" read as covering every junction

*Repository evidence.* `M-A05` and QA stage C0's first checkbox — *"The new
branch meets the header"* — are both scoped to the branch the edit **created**.
Nothing covered a junction the edit **passed through**, and a cleared corridor
damages exactly those.

*Evidence from this editing incident.* Two junctions broke, neither of them on a
newly drawn branch: the upper horizontal-to-riser join and the riser-to-header
join, both inside corridors cleared to make room for the reroute.

**Corrective.** `M-A17` requires a **junction ledger**: one row per connection the
edit touched, with both endpoints, the expected shared rectangle, the circuit's
colour and alpha pattern, and a pass/fail — *inspected programmatically, not only
where a screenshot pointed*. The failure modes are enumerated, including the one
that reads as a pass: **only the antialiasing rows touching while the opaque
centrelines stay apart.**

### F47 (S3 — misleading). "Open it at 100% zoom" was answered with a scaled screenshot

*Repository evidence.* QA stage C says *"Open it at **100% zoom** — a scaled
render hides a 6 px miss"*, and stage C0 says to decode the background and open
it *"at 100% with nothing on top"*. Both are correct. Neither names a single
required artefact: no crop list, no magnification, no baseline, no manifest. The
only enumerated crops in the file are stage C2's per-role crops, which are about
pill placement.

*Evidence from this editing incident.* Review proceeded on full-panel previews.
A one-pixel junction gap is not visible in one, and it survived until it was
looked for deliberately.

**Corrective.** Stage **C0b** enumerates the deliverables — background-only
render at native size, full-panel render, an equipment crop, one crop per edited
crossing, one per edited junction, a nearest-neighbour magnification of each
critical junction, before/after at the same bounds, and a list of every modified
bounding box — and [maskin-visual-qa.py](maskin-visual-qa.py) produces them
deterministically with a machine-readable `qa-manifest.json`. **The manifest
states what it does not decide**, so a passing manifest cannot be read as
semantic image validation.

### F48 (S2 — undetermined). "Restart from the retained original" never said what to retain, or when

*Repository evidence.* `M-A07`, `R5` and QA stage C6 all say the same thing:
*"After a failed visual iteration, restart from the retained original"*, *"Never
repair the next attempt on top of an already damaged crop"*. **None of them says
to decode and keep the original before starting**, which is what makes a restart
possible, and none defines an acceptable checkpoint. §4a step 1 comes closest —
*"Copy the supplied export and its decoded background out of the working set"* —
and it is one clause inside the compressor procedure.

*Evidence from this editing incident.* Repairs were stacked on the derivative,
and by the fourth iteration original artwork and introduced damage were no longer
separable. The intermediate rasters do not exist today, which is why this
addendum can measure nothing from the incident.

**Corrective.** `M-A10` states retention as its own numbered rule: decode and
retain before editing, work on a separate derivative, preserve the retained
original as the **immutable before-image**, restart from it or from a
**specifically named** accepted checkpoint, never patch a damaged derivative, and
never use a previous assistant preview as the geometric source while the original
raster exists.

### F49 (S3 — misleading). The anti-generic-width rules lived under "extending a compressor bank"

*Repository evidence.* `M-A03`, `M-A04`, `R2` and `R3` are exactly right and
exactly the rules E25 needed — *"an anti-aliased line is 3 rows"*, *"Visual
equality to the source outranks any generic two-pixel line-width rule"*. All four
sit under headings about cloning a column, and all four are phrased about *the
copy*: **reproduce** every row the source has. A repair is not a copy, and the
word for what E25 was doing — redrawing part of an existing run — appears
nowhere.

*Evidence from this editing incident.* Yellow and cyan sections were redrawn at
an apparent thickness that did not match the runs they joined.

**Corrective.** `M-A16` restates the measurement discipline for **repairs**, and
adds the acceptance test the clone rules did not need: a repaired segment matches
the **adjacent untouched source segment** exactly, so the comparison is against
the drawing rather than against the inventory alone. It also states explicitly
that horizontal and vertical segments of one circuit may need different sampled
profiles — the miniature fixture is built so that they do.

### F50 (S2 — undetermined). Nothing checked that a circuit still reached its anchors

*Repository evidence.* Every continuity statement in the kit is local: a branch
meets a header, a junction has no gap. There is no whole-path requirement
anywhere, so a circuit could satisfy every stated rule at every named join and
still be in two pieces because of a break nobody named.

*Evidence from this editing incident.* Two independent breaks in one circuit. Each
was found separately, by eye, after a screenshot.

**Corrective.** `M-A17` adds the whole-path check: **search the edited circuit's
raster as connected components and confirm the required anchors belong to the
same component**, excluding intentional non-connected crossings.
`maskin_raster_qa.check_connectivity` implements it, and the crossing convention
is made explicit so the check knows what may legitimately interrupt a run.

### F51 (S2 — undetermined). Nothing bounded what an artwork edit was allowed to change

*Repository evidence.* `M-C04` bounds what a **JSON** patch may change, per
declared scope, and `M-C05` compares background **lengths** and says so:
*"a background that changed is not a background that changed correctly"*. On the
raster side there was no scope at all. The only instruction was stage C0's
*"Nothing that already existed moved. Compare against the retained original, not
against the previous attempt"* — a checkbox with no method behind it.

*Evidence from this editing incident.* Cleanup residue accumulated in areas
nobody had authorised as part of the edit, and it was never systematically
compared away.

**Corrective.** `M-A18`: compare with the retained original; changes outside the
union of the documented edit masks are **zero**; and when a background-colour
conversion was also requested, report the two scopes **independently** and
confirm the protected foreground artwork is unchanged in both. On the JSON side,
`M-C06` and the new `--patch-scope artwork-only` state the object-preservation
verdict explicitly — same count, nothing added, nothing dropped, every field of
every object identical.

## Corrective controls

| Finding | Control | Where |
|---|---|---|
| F42 | A separate named procedure and a separate normative section, with their own rule namespace | guide §4b; contract §17; `M-A10`–`M-A19` |
| F43 | Protection boundary; the receiver declared atomic; smallest safe mask; restore-from-source on contact | `M-A11`; `check_protected_regions`, `check_component_removed` |
| F44 | Four pixel classes; transparency is not a colour; flatten confirmed background only; conversion is its own pass | `M-A12`; `check_background_fill` |
| F45 | Junction / crossing / bend / termination defined; the choice made before drawing; bypass in the circuit's own style | `M-A15`; `check_crossings` |
| F46 | A junction ledger over every connection the edit touched, with the antialiasing-only failure named | `M-A17`; `check_junctions` |
| F47 | Stage C0b's enumerated deliverables and a deterministic crop/manifest helper that states its own limits | QA stage C0b; [maskin-visual-qa.py](maskin-visual-qa.py) |
| F48 | Retention as its own rule: decode first, derivative separate, before-image immutable, checkpoints named | `M-A10` |
| F49 | The measurement discipline restated for repairs, with the adjacent untouched run as the acceptance sample | `M-A16`; `check_pipe_profiles` |
| F50 | Connected-component check over the edited circuit's required anchors | `M-A17`; `check_connectivity` |
| F51 | Raster diff scope, reported in two scopes; object preservation as a validator verdict | `M-A18`, `M-C06`; `check_diff_scope`, `--patch-scope artwork-only` |
| all | Ten single-defect negatives, each failing the check that names its defect | `tests/test_maskin_equipment_removal.py` |
| all | The decision tree A–J at the head of the Copilot-facing content | preflight; generated bundle |

## Files changed by this addendum

| File | Change |
|---|---|
| [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) | New §17 (owner). Rule table, evidence base (E25, E26), routing table, scope summary and §14 evidence gaps extended |
| [MASKIN-AUTHORING-GUIDE.md](MASKIN-AUTHORING-GUIDE.md) | New §4b — fifteen ordered phases. Ten rows added to the failure catalogue |
| [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) | New stage C0b, `artwork-only` scope, rule-id table, test commands, a second regression prompt |
| [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) | New §5b — pixel rules `R6`–`R10` |
| [MASKIN-COPILOT-PREFLIGHT.md](MASKIN-COPILOT-PREFLIGHT.md) | Decision tree A–J ahead of rule 1; new rules 21 and 22 |
| [CLAUDE.md](CLAUDE.md) | Two routing rows; host fact 6 — what *Background picture only* does |
| [../README.md](../README.md) | The Maskin-background note now points at both procedures and the two verification commands |
| [documentation-rules.json](documentation-rules.json) | Regenerated: `M-A10`–`M-A19`, `removal_and_rerouting`, `M-C06`, `artwork-only`, E25, E26 |
| [MASKIN-KNOWLEDGE-BUNDLE.md](MASKIN-KNOWLEDGE-BUNDLE.md) | Regenerated; carries the decision tree and all 22 preflight rules |
| [validate-maskin-panel.py](validate-maskin-panel.py) | `artwork-only` patch scope; `M-C06` object-preservation verdict |
| [maskin_raster_qa.py](maskin_raster_qa.py) | New — the pixel checks, one implementation |
| [maskin-visual-qa.py](maskin-visual-qa.py) | New — crops, magnifications, before/after pairs, `qa-manifest.json` |
| [build-maskin-removal-fixture.py](build-maskin-removal-fixture.py) | New — the E26 fixture and its ten single-defect mutators |
| [build-maskin-rules.py](build-maskin-rules.py) | New rule blocks and evidence entries |
| [build-maskin-knowledge.py](build-maskin-knowledge.py) | Extracts the decision tree; accepts 1..N preflight rules |
| `tests/test_maskin_equipment_removal.py` | New — 32 tests |
| `tests/test_maskin_knowledge_bundle.py` | Preflight count unpinned; decision-tree and workflow-presence tests added |

## Remaining evidence gaps

Created by the incident and by the fix, not found in the documents:

1. **The E25 rasters do not exist.** They were derivatives and were not retained
   — the incident's own first finding. Every rule in §17 is therefore stated from
   an observed failure sequence and exercised against an instrumented miniature.
   **No rule in this pass has been measured against the production raster it came
   from.** One retained before/after pair from a real removal would let the
   protection boundaries, the crossing convention and the background sample
   points be checked rather than reasoned.
2. **What a real Maskin's non-connected crossing looks like is unmeasured.**
   §17.6 states the convention the drawing method's orthogonal style can express,
   and the fixture implements it. Whether production draws a liquid-over-suction
   crossing as a jog, as a line break, or does not draw one at all, is not
   established by any committed file: **no committed raster in this repository
   contains a documented crossing.**
3. **No production background colour has been sampled into any document.**
   `M-A12` says to derive it from the requirement or from a clean source sample,
   and states no value — correctly, but that means the rule has never been
   exercised against a real panel's actual canvas colour.
4. **Stage C0b has no recorded execution**, exactly as stage C0 had none when it
   was introduced. `maskin-visual-qa.py` makes the artefacts reproducible; it
   cannot make a reviewer look at them, and nothing in this repository records
   that anyone has.
5. **The `artwork-only` scope has not been run against a real pair.** It is
   exercised against a five-object miniature. A 66-object production pair would
   confirm that role-key pairing behaves the same at scale — the same limitation
   `compressor-addition` carries.
6. **Whether a removal should ever remove an object is unresolved by evidence.**
   §17.1 forbids it unless the user names the object, which is a judgement about
   safety rather than a measurement. A production case where the drawn pill is
   gone and the binding should have gone with it would test it.

---

# Addendum — 2026-08-12: linked state mistaken for binding validity

**Scope.** Findings **F52–F57** are primarily `GLOBAL` linking behavior.
Oversikt is the worked example because that is where the failure occurred.
Nothing below makes a driver-family rule from one store.

**Evidence.** **E27**, as registered in
[documentation-change-log.md](documentation-change-log.md): a 184-object
Oversikt export and its plant parameter workbook. Every object carried
`linked:"true"`, non-empty `driver_id` and non-empty `unit_id`; only **120/184**
driver ids resolved exactly. Manual replacement changed **52 objects / 13
controllers / four roles**, including driver family (AK2 to AK3_AKC), bus prefix
(`001:` to `000:`), parameter tail/register and alias identity. Live artifacts
are not committed. The sanitized 8-object / 6-of-8 analogue is committed under
[tests/fixtures/oversikt-linking/](tests/fixtures/oversikt-linking/).

## The incident

The initial result treated binding-looking fields as proof, preserved almost all
bindings, removed `panel.image_svg_trace`, called the result "linked-ready", and
reported 64 unmatched ids as commentary rather than as a blocking failure.

That result was structurally valid. Its claim was not evidence-backed. The
manual replacements show why: the old strings did not merely differ in
formatting; they represented different controller or parameter identities.

## Findings

### F52 (S1 — wrong). `linked:"true"` was treated as binding validity

*Repository evidence.* `CLAUDE.md` §5 already records the host assignment:
`linked="true"` whenever `driver_id !== "driver_id"`, including an empty
`driver_id`. It also records that the host does no parameter lookup during load.

*Incident evidence.* All 184 objects were structurally linked; 64 driver ids did
not resolve in the authoritative parameter workbook.

*Consequence.* An agent could follow the field shape exactly and call stale
bindings valid.

**Corrective.** AI-BRIEFING §8b now owns four distinct states: structurally
linked, source-resolved, semantically verified and unresolved. The invariant is
explicit: host state, syntax, prefix and suffix are never sufficient.

**Scope:** `GLOBAL`. **Machine-checkable:** exact source resolution begins at
`O-B03`; `O-S09` remains structural only.

### F53 (S3 — misleading). "Preserve and patch" preserved the fields the task asked to repair

*Repository evidence.* Oversikt contract §6.2 and the guide required
`driver_id`, `unit_id` and `alias_text` to survive every patch. Correct for
geometry work, misleading for a link/relink task.

*Consequence.* The stronger geometry-preservation rule swallowed the binding
request. Known-unverified links were protected from correction.

**Corrective.** Conflict **OV-C5**, resolved by task scope: geometry-only
preserves bindings; link/relink/validation preserves geometry and checks or
patches bindings from the parameter source. `--patch-scope binding-repair`
enforces the second.

**Scope:** rule is `GLOBAL`; conflict application is `OVERSIKT`.

### F54 (S1 — wrong). An unresolved subset was reported but did not stop completion

*Incident evidence.* The result named 64 unmatched ids and still used
"linked-ready."

*Consequence.* Reporting became a substitute for resolving. A user received an
explicit failure count and an incompatible success label in the same delivery.

**Corrective.** `O-B08` is the hard stop. Any unresolved intended link forbids
finished, fully linked, linked-ready, production-ready and verified. Required
delivery becomes verified subset + matrix + source coverage + unresolved
objects/controllers/roles + missing evidence.

**Scope:** `GLOBAL`. **Machine-checkable:** completion status in validator
output; **manual:** humans must not add a contradictory success label outside
the tool.

### F55 (S4 — structural). Oversikt validation could not consume the supplied parameter source

*Repository evidence.* `validate-romkontroll-panel.py` already had
`--source-sql`; `validate-oversikt-panel.py` explicitly said invented bindings
were invisible and offered no source input.

*Consequence.* The decisive artifact was supplied and the applicable validator
could not read it.

**Corrective.** `validate-oversikt-panel.py --parameters` consumes `.xlsx`,
`.csv`, `.json` and `.sql` via dependency-free `parameter_source.py`. Rules
`O-B00`–`O-B08` cover source totals, parse errors, ambiguity, absence, unit,
alias, role/type and completion. Geometry-only runs remain unchanged.

**Scope:** `OVERSIKT` executable application of the `GLOBAL` invariant.

### F56 (S2 — undetermined). No binding verification matrix fixed identity across exports

*Repository evidence.* Existing coverage matrices tracked controller roles and
geometry, not panel-versus-source bindings. Replacement exports can carry
`object_10000` names and different array order.

*Consequence.* Index-wise comparison could pair an alarm with a value, or a
replacement object with the wrong source row, while a large diff hid it.

**Corrective.** The 18-column matrix is grouped by controller and role.
`object_10000` names are preserved. Tests reverse the array and prove no
drop/relink/retype finding appears; only `O-C12` reports ordering.

**Scope:** matrix schema `GLOBAL`; grouping rule `OVERSIKT`.

### F57 (S3 — misleading). Alias similarity and host literals looked like independent corroboration

*Repository evidence.* `id:"driver_id"` and `link_name:"link_name"` are host
literals; `link_tag` and `unit_ref` are optional metadata. Existing linking
prose allowed matching from descriptive aliases without defining exact versus
normalized-only comparison.

*Consequence.* Several fields from one unvalidated document appeared to support
each other. Punctuation, whitespace or a familiar parameter suffix could be
upgraded silently into a match.

**Corrective.** CLAUDE.md §5 states what each field proves and does not prove.
`O-B05` records exact, normalized-only and different aliases with both strings.
Fuzzy matching produces candidates only. `link_name` is explicitly not a
destination-panel field.

**Scope:** `GLOBAL`.

## Corrective controls

| Finding | Control | Owner/enforcer |
|---|---|---|
| F52 | Four statuses + exact-source invariant | AI-BRIEFING §8b; rules JSON |
| F53 | Task-scope split; conflict OV-C5; binding-repair patch scope | Oversikt contract/guide; `O-C16` |
| F54 | Completion hard stop and partial-file policy | AI-BRIEFING §8b; `O-B08` |
| F55 | Parameter-aware validator for xlsx/csv/json/sql | `parameter_source.py`; `O-B00`–`O-B08` |
| F56 | Controller-role binding matrix; non-sequential/reordered fixtures | validator JSON report; tests |
| F57 | Host-field proof boundary; exact alias classification | CLAUDE.md §5; `O-B05` |

## Machine-checkable versus manual

Machine-checkable now: exact unique driver resolution; source coverage;
`unit_id`; duplicate source rows; exact versus normalized-only/different alias
status; explicit and conservative deterministic role/access/datatype conflicts;
field-level binding-repair scope.

Still manual: semantic role suitability when a driver family does not expose
enough deterministic metadata; whether the supplied parameter source covers the
whole requested plant scope; production operational readiness. `O-B07` keeps
the first visible and unresolved. No validator claims to automate the latter
two.

## Files changed by this addendum

Normative owners: `CLAUDE.md` host-field clarification; `AI-BRIEFING.txt` §8b;
`OVERSIKT-GENERATION-CONTRACT.md` §8.4/§8.5, `OV-C5`, E27 and incident §13.6.

Procedure/acceptance/routing:
[AI-REQUEST-ROUTING.md](AI-REQUEST-ROUTING.md),
[OVERSIKT-AUTHORING-GUIDE.md](OVERSIKT-AUTHORING-GUIDE.md),
[OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md).

Derived:
[OVERSIKT-COPILOT-PREFLIGHT.md](OVERSIKT-COPILOT-PREFLIGHT.md),
[AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt),
[documentation-rules.json](documentation-rules.json) via
[build-oversikt-rules.py](build-oversikt-rules.py).
[MASKIN-KNOWLEDGE-BUNDLE.md](MASKIN-KNOWLEDGE-BUNDLE.md) was regenerated because
its builder consumes the revised global briefing; no Maskin rule changed.

Executable/regression:
[validate-oversikt-panel.py](validate-oversikt-panel.py),
[parameter_source.py](parameter_source.py),
[build-oversikt-linking-negatives.py](build-oversikt-linking-negatives.py),
[tests/test_oversikt_link_binding.py](tests/test_oversikt_link_binding.py), and
the sanitized fixture directory.

`AI-BRIEFING-REVISED.txt` remains historical and was not reapplied. No competing
normative source was created.

---

# Addendum — 2026-08-12: existing Oversikt relink followed the wrong evidence

**Scope.** Findings **F58–F62** apply to
`oversikt-existing-panel-relink`. The observed names and indices are scoped
`CASE-RELINK-A-20260812`; none is a reusable controller-number rule.

**Evidence.** **E28** is the live, uncommitted repair set: existing panel
exports, the embedded store-plan background, a newer user-corrected JSON, and
captured parameter evidence. The visible labels were `K51`, `K4A`, `K4B`,
`K3B`, `K3C`, `K3D`. The workbook covered the first five and did not contain
`K3D`. Case-only controller indices were 90, 30, 29, 32 and 33 respectively.

## Findings

### F58 (S1 — wrong). The final array object was treated as the final disk

The first repair selected a JSON entry by array position and fixed one cluster.
Array order is document order, not store geography; `object_N` is host
implementation identity. The correct match is equipment role plus position,
using geometry, type, alias, current binding, background label and screenshot.

**Corrective.** Routing §1.3.1 and Oversikt contract §8.6 forbid last-object,
rightmost-object, highest-unit and array-position inference.

### F59 (S1 — wrong). Identified equipment received estimated coordinates

The second repair found equipment units but placed new clusters at estimated
positions. The user then supplied a corrected JSON with exact manual placement.
Any later coordinate normalization would undo the correction.

**Corrective.** The newest current-task JSON now has explicit domain
precedence for geometry, dimensions, types, names, order and background. A
binding-only compare preserves all of them.

### F60 (S3 — misleading). The background was not separated from live objects

A screenshot or trace can show a cabinet label or rectangle without proving
that another Designer object should render on top of it. Conversely, scanning
only `single_objects` misses the visual target.

**Corrective.** Contract §8.6 requires `image_data` first,
`image_svg_trace` second, complete foreground enumeration, and a spatial
background/foreground reconciliation before adding any live object.

### F61 (S1 — wrong). A missing equipment unit invited sequence inference

`K3D` appeared visually but had no workbook unit. Neighbor `K3C` and the local
index sequence made a fabricated next id look plausible. Alarm suffixes in the
same case also varied, and earlier objects used AK2 while current rows used
AK3_AKC.

**Corrective.** Missing equipment is a per-cluster STOP: no next index, cloned
neighbor, family replacement or suffix substitution. Exact workbook cells are
copied whole. Independent verified clusters continue, and the delivery is
truthfully partial.

### F62 (S4 — structural). Binding-only scope did not cover document metadata

`O-C16` protected object geometry, identity, names and order but did not reject
changes to panel metadata, arrays, counts or background values. A task could
therefore report visual preservation while changing the document around the
objects.

**Corrective.** `binding-repair` now compares all non-export-only envelope and
panel fields as well as object fields. `--task oversikt-existing-panel-relink`
adds machine-readable classification, primary output, visual-preservation,
completion and unresolved-binding metadata. The importable panel JSON remains
primary; the report is an optional companion.

## Ownership and controls

- Routing: `AI-REQUEST-ROUTING.md` §1.3.1.
- Normative behavior and the scoped incident: `OVERSIKT-GENERATION-CONTRACT.md`
  §8.6.
- Procedure: `OVERSIKT-AUTHORING-GUIDE.md` §8c.
- Acceptance: `OVERSIKT-QA-CHECKLIST.md` stage E2.
- Compact application: `OVERSIKT-COPILOT-PREFLIGHT.md`, “RELINK EXISTING
  PANEL”.
- Machine derivative: `panel_types.oversikt.existing_panel_relink` in
  `documentation-rules.json`, generated by `build-oversikt-rules.py`.
- Executable gate: `validate-oversikt-panel.py --task
  oversikt-existing-panel-relink`.

No live workbook, panel background, plant-specific driver id or personal data
was committed. The 25-object, six-label regression shape is generated by
`build-oversikt-existing-relink-fixture.py` into
`tests/fixtures/oversikt-existing-relink/case.json`; every coordinate and
identifier is synthetic/masked.

## Session analysis — 20 points (`CASE-RELINK-A-20260812`)

Classification of each point is in brackets.

1. **What was attempted first.** The phrase “last disk” was read as the final
   `single_objects` entry. `object_183` (`V3_R_28px_circular_defrost_nrm` at
   772,313, alias `u60 Def. relay`, unit `001:069`) was selected and that
   cluster was repaired. [Troubleshooting procedure]
2. **Why that appeared plausible.** High `object_N` values look like sequence.
   A defrost disk is visually a disk. One nearby cluster is a complete-looking
   repair. [Assumption requiring further verification]
3. **What was misunderstood.** “Last disk” named visible equipment on the
   store plan, not JSON array position. [OVERSIKT rule]
4. **Why array order was misleading.** `single_objects` is document order.
   `object_N` is host implementation identity assigned at load/paste. Neither
   is store geography. [GLOBAL IWMAC Designer rule]
5. **Why estimated coordinates were insufficient.** After the screenshot
   clarified K51/K4A/K4B/K3B/K3C/K3D, new objects were placed by eye. The user
   then supplied a JSON whose coordinates they considered correct. Screenshot
   estimates are not rank-1 geometry once that file exists. [JSON-generation
   or repair rule]
6. **What evidence changed the interpretation.** The screenshot named the
   equipment labels; the later JSON named the coordinates; the workbook named
   the units and driver IDs. [Troubleshooting procedure]
7. **What the screenshot contributed.** Visible labels, spatial context, and
   which clusters were missing as live objects. It did not own coordinates
   after the corrected JSON arrived. [OVERSIKT rule]
8. **What the workbook contributed.** Equipment names, parameter names,
   complete driver IDs, controller family, controller index, access and
   datatype. [GLOBAL IWMAC Designer rule]
9. **What the revised JSON contributed.** Manual placement: coordinates,
   sizes, types, names, z-order, background. Binding-only work starts there.
   [JSON-generation or repair rule]
10. **Which source owned geometry.** The newest user-supplied panel JSON.
    [JSON-generation or repair rule]
11. **Which source owned bindings.** The parameter workbook, by exact row.
    [GLOBAL IWMAC Designer rule]
12. **Which identifiers were verified.** Complete driver IDs for K51, K4A,
    K4B, K3B and K3C roles that existed in the workbook. [Project-specific
    example]
13. **Which information remained unavailable.** A K3D equipment row.
    [Project-specific example]
14. **Why K3D was not linked.** No matching unit in the supplied parameter
    export. Inferring index 34 from K3C=33 would fabricate a binding.
    [GLOBAL IWMAC Designer rule]
15. **Why the final result worked.** Coordinates stayed locked; only verified
    binding fields changed; unmatched equipment stayed unresolved; validation
    compared the candidate to the corrected JSON and the workbook.
    [Troubleshooting procedure]
16. **Universal findings.** Array order is not physical order. Newest
    corrected JSON owns placement. Copy complete driver IDs. Do not invent
    missing units. Separate visual authority from binding authority. Validate
    changed IDs against source data. Preserve visual fields in binding-only
    mode. Distinguish background artwork from live objects.
    [GLOBAL IWMAC Designer rule]
17. **Oversikt-specific findings.** Four-role cooling cluster as a reusable
    pattern, not a requirement. Clusters are `single_objects`, not containers.
    Value at z 110, symbols at z 375. Same-cluster stacking is legal.
    [OVERSIKT rule]
18. **Project-specific findings.** K51=90, K4A=30, K4B=29, K3B=32, K3C=33;
    the absolute coordinates in the session prompt; K3D missing from that
    workbook. [Project-specific example]
19. **Prohibited assumptions.** Last-array-object identity; `object_N` as
    equipment order; `unit_id` order as layout order; one cluster satisfying a
    multi-label screenshot; driver-ID fragment surgery; uniform alarm
    suffixes; screenshot estimates after a corrected JSON.
    [Assumption requiring further verification]
20. **Checks that should be automated.** Binding-only visual preservation;
    exact-source driver IDs; distinct alarm suffixes; AK2 replaced only from
    an exact AK3_AKC row; array order ≠ physical order; highest `object_N` is
    not the target; missing unit stays unresolved while others complete;
    background byte-identity; unique names; counts; intentional stacking not
    reported as `O-G07` errors; unrelated objects unchanged.
    [JSON-generation or repair rule]

### F63 (S3 — misleading). Same-cluster stacking was reported as generic overlap

*Incident evidence.* A verification report of the final linked panel emitted
`O-G07` warnings for alarm/value, alarm/cooling, alarm/defrost and
value/defrost pairs inside the newly placed clusters, then collapsed the rest
into “…and 121 further overlapping pair(s)”. Those pairs are the cooling-as-
left-anchor stacking the user placed by hand.

*Consequence.* The overlap check drowned the real findings (encoding, duplicate
controllers, unresolved source rows) in noise. An agent “fixing” the warnings
would move user-corrected symbols.

*Corrective.* `O-G07` skips same-controller pairs of two different cluster
roles. Cross-controller overlaps remain warnings. Duplicate roles remain
`O-G04`. Absolute session coordinates stay `CASE-RELINK-A-20260812`; only the
relative stacking pattern is reusable when a matching production reference
supports it.

**Scope:** `OVERSIKT` executable application. **Machine-checkable:** the
existing-relink fixture’s synthetic cooling-anchor clusters produce zero
`O-G07` findings; a forced cross-controller overlap still warns.

