# CLAUDE-REVISED.md — revision specification for `CLAUDE.md`

**This file is a specification, not a replacement file.** `CLAUDE.md` is 101 766
characters across 576 lines, and the instruction for this audit was explicitly
*"do not delete existing technical details merely to shorten the documentation"*.
A full rewrite would have to either reproduce every retained paragraph verbatim —
producing a second copy that immediately drifts — or silently drop detail. This
form does neither: every one of the 27 sections gets a **verdict**, and every
section whose verdict is *rewrite* or *move* gets its **full replacement text**
and the **exact anchor** it replaces.

Applying it is mechanical. Nothing here requires judgement about what to keep.

The **factual corrections** from the audit (F1 encoding, F2 the diff claims, F8
the character-cap unit) are **already applied in place** — see
[documentation-change-log.md](documentation-change-log.md) Part 1. What remains
below is the **structural** work: separating the four classes of information that
`CLAUDE.md` currently interleaves.

---

## The problem this revision solves

`CLAUDE.md` today mixes four kinds of statement in one document, with no marker
telling a reader which kind they are looking at:

| Class | What it is | Where it should live | Goes stale when |
|---|---|---|---|
| **1. Host facts** | How IWMAC Designer V5 itself behaves — the DOM model, the save paths, the importer's `zIndex` passthrough, the API surface | `CLAUDE.md` | IWMAC ships a new Designer build |
| **2. Output invariants** | What a valid panel JSON must contain regardless of panel type | `AI-BRIEFING.txt` | The envelope schema changes |
| **3. Object vocabulary** | Which `obj_id` exists and what it draws | `DESIGN-OBJECT-CATALOG.md` (generated) | The palette changes |
| **4. Measured geometry** | Where things actually sit on a real panel of a given type | **`VENTILATION-GEOMETRY-CONTRACT.md`** (new) | A new production export is measured |

Class 4 had no owner, so it accumulated inside class 1 — §17b's two ventilation
subsections are 112 lines of coordinates living in a host-behaviour document.
That is why the same measurement appears in three files in three forms, and why
an agent reading `CLAUDE.md` for host facts also absorbs geometry that may have
been superseded by a newer export.

**The rule after this revision:** a coordinate belongs in the geometry contract.
`CLAUDE.md` may *point at* geometry; it may not *state* it. The one exception is
a coordinate that demonstrates a host behaviour (e.g. that the importer preserves
`zIndex` verbatim) — those stay, because the number is illustrating a class-1
fact, not defining a layout.

---

## Section-by-section disposition

Verdicts: **KEEP** (unchanged) · **KEEP+** (unchanged, gains a cross-reference) ·
**REWRITE** (replacement text given below) · **MOVE** (content relocates; a
pointer stays).

| § | Lines | Title | Class | Verdict |
|---|---|---|---|---|
| — | 1–9 | Title and preamble | 1 | **REWRITE** — add the four-class map (R1) |
| 1 | 10–24 | Technology stack & page anatomy | 1 | KEEP |
| 2 | 25–35 | Core mental model: the DOM is the document | 1 | KEEP |
| 3 | 36–52 | The manager sidebar | 1 | KEEP |
| 3b | 53–83 | The toolbar layer (w2ui) | 1 | KEEP |
| 4 | 84–121 | The object palette | 1 + 3 | **KEEP+** (R2) — point at the catalogue as the vocabulary owner |
| 5 | 122–135 | Objects on canvas: attributes & bindings | 1 | KEEP |
| 5b | 136–148 | Input layer: drag / move / resize | 1 | KEEP |
| 6 | 149–165 | Containers | 1 | KEEP |
| 7 | 166–172 | The two panel stores | 1 | KEEP |
| 8 | 173–204 | The design-panel JSON document (normative) | 1 + 2 | **KEEP+** (R3) — mark the boundary with `AI-BRIEFING.txt` |
| 9 | 205–227 | Save paths (9.1, 9.2) | 1 | KEEP |
| 10 | 228–253 | Load paths (10.1, 10.2, 10.3) | 1 | KEEP |
| 11 | 254–261 | The graphics layer (d3) | 1 | KEEP |
| 12 | 262–270 | Copy / paste — the `Duplicator` | 1 | KEEP |
| 13 | 271–277 | Auto-tagging & the tag system | 1 | KEEP |
| 13b | 278–292 | The selector popups & the linking write-back | 1 | KEEP |
| 14 | 293–301 | Templates | 1 | KEEP |
| 15 | 302–335 | Server API catalogue | 1 | KEEP |
| 16 | 336–339 | Hotkeys | 1 | KEEP |
| 17 | 340–347 | Ecosystem: the Import/Export userscript | 1 | KEEP |
| 17b | 348–365 | Generating a panel JSON from a description | 2 + 4 | **REWRITE** (R4) — the kit index, restated as a routing table |
| 17b.1 | 366–379 | Editing an existing Maskin compressor bank | 4 | **KEEP+** (R5) — scope-tag it as Maskin-only |
| 17b.2 | 380–397 | Generating or editing a Ventilasjon panel | **4** | **MOVE** (R6) → geometry contract §1–§11 |
| 17b.3 | 398–491 | Ventilation panel fidelity and template-matching | **4** | **MOVE** (R7) → geometry contract; 4 rules stay as host facts |
| 18 | 492–508 | How to introspect live | 1 | KEEP |
| 19 | 509–537 | Gotchas (the real footguns) | 1 | **KEEP+** (R8) — one gotcha added |
| 20 | 538–546 | Constants quick-ref | 1 | KEEP |
| 21 | 547–576 | Key functions — where to find things | 1 | KEEP |

**Net effect:** 22 sections unchanged, 4 gain a cross-reference, 3 are rewritten,
2 subsections move. No host fact is deleted. Approximately 9 400 characters of
geometry leave `CLAUDE.md` for a document that owns geometry, and are replaced by
about 1 900 characters of pointers — the geometry itself is not lost, it is
**stated once instead of three times**.

---

## R1 — preamble (replaces lines 1–9)

**Anchor:** the `# IWMAC Designer (V5) — host deep-dive reference` heading and the
paragraphs before `## 1.`.

**Insert after the existing preamble, before `## 1.`:**

> ### What this file is, and is not
>
> This is the **host reference**: how IWMAC Designer V5 behaves. Every statement
> here is a fact about the application — its DOM model, its save and load paths,
> its API, its footguns. It goes stale when IWMAC ships a new Designer build.
>
> Three things are deliberately **not** here:
>
> | Question | File |
> |---|---|
> | What must a valid panel JSON contain? | [AI-BRIEFING.txt](AI-BRIEFING.txt) — the output contract |
> | Which `obj_id` do I use, and what does it draw? | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) — generated, 797 objects |
> | Where do things sit on a real ventilation panel? | [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) — measured coordinates |
>
> **A coordinate does not belong in this file.** If you find yourself about to
> write `posLeft` here, the geometry contract owns it — unless the number exists
> to demonstrate a host behaviour, such as the importer writing `zIndex` through
> verbatim.
>
> When two of these files disagree, the precedence order in
> [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) §0 decides.
> Summarised: a supplied panel or screenshot beats a production export, which
> beats panel-specific rules here, which beat the briefing, which beats the
> catalogue, which beats generic design advice. **Never average two conflicting
> coordinates.**

---

## R2 — §4 The object palette (append, do not alter)

**Anchor:** end of §4, before `## 5.`.

**Append:**

> The palette is the **vocabulary owner's source**, not the vocabulary itself.
> [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) is generated from it by
> `build-object-catalog.py` and is what an agent should read — it names all 797
> objects, ranks them by production usage, and flags the ones whose spelling
> looks like a typo but is not (`numberV3_filter_with_diff_press`,
> `V3_58px_fan_left_nrm`, `number_v3_cooler_2-way`).
>
> **The `W×H` in the catalogue is the toolbox default, not a placement size.** A
> production export of the same panel type outranks it. Seven objects in the
> ventilation references are placed at a size the catalogue does not list — the
> sidebar header is `60×25` in the palette and `250×20` on every real panel. Edit
> the *generator* if this text needs changing; the Markdown is regenerated.

---

## R3 — §8 The design-panel JSON document (append)

**Anchor:** end of §8, before `## 9.`.

**Append:**

> **Boundary with [AI-BRIEFING.txt](AI-BRIEFING.txt).** This section describes the
> document the *Designer* reads and writes. The briefing describes the document an
> *agent* must produce for the Import/Export userscript to insert. They are the
> same schema seen from two ends, and where the briefing is stricter — required
> field order, the 17-field object template, the sanitization contract — the
> briefing wins for generation. This section wins for understanding what the host
> does with the result.
>
> Note the two envelope shapes an agent will encounter. A **live userscript
> export** is flat: `{format, version, generator, source_plant_id, panel_name,
> panel_width, panel_height, counts, background_embedded, panel}` with the objects
> at `panel.single_objects`. A **committed reference** in `reference_data/` wraps
> that in `{_note, envelope: {...}}`. Any script reading either must start with
> `env = d.get("envelope", d)`.

---

## R4 — §17b heading and kit index (rewrite lines 348–365)

**Anchor:** `## 17b. Generating a panel JSON from a description (for AI assistants)`
through the bullet ending `…the distilled Advansor …method.txt`.

**Replacement:**

> ## 17b. Generating a panel JSON from a description (for AI assistants)
>
> The Insert JSON path accepts **AI-authored** panels, which makes "P&ID → panel"
> generation practical. Everything an agent needs is next to this file. Read them
> in this order, and stop at the one that answers your question:
>
> | Read this | To answer | Kind |
> |---|---|---|
> | [AI-BRIEFING.txt](AI-BRIEFING.txt) | What must the JSON contain? | Normative contract |
> | [AI-AGENT-INSTRUCTIONS.txt](AI-AGENT-INSTRUCTIONS.txt) | Same, compressed for the M365 Copilot Studio instructions field | Normative, size-capped |
> | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) | Which object draws what? | Generated vocabulary |
> | [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) | Where does it go on a vent panel? | Measured geometry |
> | [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md) | Is what I produced correct? | Executable QA |
> | [documentation-rules.json](documentation-rules.json) | The same rules, for a validator | Machine-readable |
>
> **The instructions file is capped at 8 000 characters and rejects `<` and `>`.**
> The cap counts characters, not bytes, and a CRLF working tree adds one per line.
> Measure the worst case before editing:
>
> ```bash
> python -c "import io;t=io.open('AI-AGENT-INSTRUCTIONS.txt',encoding='utf-8').read();print(len(t),len(t)+t.count(chr(10)))"
> ```
>
> The second number is what matters. A file at 7 995 characters with LF endings
> becomes 8 028 when pasted from a CRLF checkout, and the field truncates it
> silently.
>
> ### Worked examples and reference data
>
> - [reference_data/generated-panel-example.json](reference_data/generated-panel-example.json) — a complete correct answer: a CO₂ rack overview generated from a description.
> - [reference_data/generated-maskin-example.json](reference_data/generated-maskin-example.json) — a generated **Maskin** (CO₂ booster), light-skin variant.
> - [reference_data/real-vent-panel-example.json](reference_data/real-vent-panel-example.json) and [-2](reference_data/real-vent-panel-example-2.json) — real production exports, plant ids masked. **These are evidence E2 and E3 in the geometry contract; do not edit them.**
> - [reference_data/real-vent-panel-linked-example.json](reference_data/real-vent-panel-linked-example.json) — the linking kit for briefing §8b.
> - [reference_data/hotel-panelset-anatomy.json](reference_data/hotel-panelset-anatomy.json) — hotel / multi-building panel-set anatomy, briefing §7d.
> - [reference_data/plant-panel-survey.json](reference_data/plant-panel-survey.json) — fleet survey, 41 Coop Extra plants, 231+ panels, 2026-08-08, read-only `iw_load_ctrls` fetches.
> - [VENTILATION-CORPUS.md](VENTILATION-CORPUS.md) — the focused MENY ventilation corpus, kept separate from the Coop totals.
> - [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) — the distilled Advansor drawing method.
> - [reference_data/panel-conventions.json](reference_data/panel-conventions.json) — production drawing conventions mined from 194 compiled panels.
>
> **Ventilasjon is objects-only.** A vent panel is drawn with
> duct/pipe/connector/equipment objects on the ~6 KB blank background — **never**
> an authored `panel.image_svg`. See the geometry contract §1 for what that does
> and does not mean; it is the most misread rule in this kit.
>
> **XML-only export boundary:** XML-only panels can be surveyed and classified
> through their panel-linked unit IDs, but the current userscript's export path
> does not reproduce them.

---

## R5 — §17b.1 Maskin compressor bank (append one line)

**Anchor:** immediately after the `### Editing an existing Maskin compressor bank
from an exported panel JSON` heading.

**Insert:**

> *Scope: **Maskin panels only**. Maskin is background-drawn — artwork in
> `image_data`, live objects on top. None of the rules below transfer to
> Ventilasjon, which is objects-only. Do not generalise a Maskin measurement to a
> vent panel or the reverse.*

The rest of the subsection is unchanged. It is class-4 information for a
different panel type, and it is already correctly scoped by its heading — the
only defect is that a reader skimming for "how do I draw a panel" can land here
and apply background-drawing rules to Ventilasjon.

---

## R6 — §17b.2 (replace lines 380–397 entirely)

The whole subsection is measured ventilation geometry. It moves to
[VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md), where it is
already present in expanded and scope-tagged form:

| Paragraph in CLAUDE.md 380–397 | Now lives in |
|---|---|
| "A vent panel is a process schematic … not a table-style dashboard" | Contract §1 Canvas and composition |
| "Classify first" — the four cases | Contract §0 (precedence) + QA checklist Stage A |
| "Measured anchors" | Contract §3–§6 (with evidence ids, which the original lacked) |
| "Functional clusters move whole" + the dx/dy offsets | Contract §5, per cluster, as offset tables |
| "Z-index is load-bearing" | Contract §2 Z-index bands — **and** the host fact stays here, see below |
| "Both vent references are already linked" | Contract §11 Linking and sanitization |
| "QA before delivering" | [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md), Stages A–E |
| "Regression prompt" | QA checklist, the 9-question regression list |

**Replacement text for the whole subsection:**

> ### Generating or editing a Ventilasjon panel from an export
>
> The full geometry, cluster and sidebar contract is
> [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md); the
> acceptance procedure is
> [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md). Read those before
> generating. Two **host** facts belong here rather than there, because they are
> statements about the importer, not about a layout:
>
> **The importer writes `zIndex` through verbatim.** It substitutes `"default"`
> only when the field is absent
> ([iwmac-designer-import-export.user.js](../iwmac-designer-import-export.user.js)).
> So the z-order an agent emits is the z-order that renders — there is no
> normalising pass to rescue a wrong band. This is why the contract's §2 bands are
> enforceable at all.
>
> **Object array order is not paint order.** `zIndex` decides stacking; the array
> order decides only the `object_N` names. Two exports of the same panel can order
> the array differently and render identically — which is why they must be
> compared **by role, never by array index**.

---

## R7 — §17b.3 (replace lines 398–491)

The subsection's twelve numbered rules split cleanly. Four are host or process
facts and stay in `CLAUDE.md`; eight are measured geometry and move.

| Rule | Content | Disposition |
|---|---|---|
| 1 | Clone the complete visual grammar | **MOVE** → contract §0 precedence + §1 |
| 2 | The scaffold is part of the design | **MOVE** → contract §6 duct runs |
| 3 | Use the exact production object types; the 41-id list; exact `obj_id` spelling | **SPLIT** — the spelling rule is a host fact and **stays**; the id list moves to the catalogue's production-usage ranking, which already carries it |
| 4 | Visual fidelity vs linking; the preserve/sanitize table | **MOVE** → contract §11 (the table is reproduced there verbatim) |
| 5 | Preserve the production background contract | **SPLIT** — "objects-only does not mean no background" is a host fact and **stays**; the `00-blank-sidebar-1400x750` measurement moves |
| 6 / 6b | Match the production composition; the sidebar row by row | **MOVE** → contract §1, §6, §8 |
| 7 | Do not invent equipment to fill space | **MOVE** → contract §5 required roles |
| 8 | Avoid overlap; the hover-tooltip trap | **SPLIT** — the tooltip trap is a host fact and **stays**; overlap detection moves to contract §7 and the QA checklist |
| 9 | Structural comparison before declaring complete | **MOVE** → QA checklist Stage A |
| 10 | Render-based QA is mandatory | **MOVE** → QA checklist Stage C |
| 11 | The seventeen visual acceptance criteria | **MOVE** → QA checklist Stage C, where each criterion gains a pass/fail test |
| 12 | The 53-object worked lesson | **KEEP, rewritten** — it is the rationale for the whole contract |

**Replacement text for the whole subsection:**

> ### Ventilation panel fidelity — the host facts
>
> The template-matching rules, the measured anchors and the acceptance criteria
> that used to live here are now in
> [VENTILATION-GEOMETRY-CONTRACT.md](VENTILATION-GEOMETRY-CONTRACT.md) and
> [VENTILATION-QA-CHECKLIST.md](VENTILATION-QA-CHECKLIST.md), scope-tagged and
> carrying the evidence id each measurement came from. Five things stay here
> because they are facts about the Designer, not about a layout.
>
> **Spell `obj_id` exactly as the catalogue or the reference JSON spells it.** An
> unknown id renders as a broken `undefined`-class box (§4) — there is no
> fallback and no error. Do not normalise capitalisation and do not "correct"
> historical spelling. Three that look wrong and are not:
> `numberV3_filter_with_diff_press` (no underscore after `number`),
> `V3_58px_fan_left_nrm` (no `number_` prefix), `number_v3_cooler_2-way` (hyphen,
> not underscore).
>
> **"Objects-only" is about the drawing, not the background.** It means the ducts,
> equipment, values, symbols and controls are Designer objects rather than painted
> artwork. It does **not** mean the panel has no background: a real vent panel
> carries a real embedded background image, and dropping it is a regression. What
> is forbidden is authoring a `panel.image_svg` process drawing.
>
> **A Designer hover tooltip is runtime UI, not saved panel content.** Capture QA
> screenshots with the pointer moved away from every object. A tooltip caught in a
> screenshot has been mistaken for a stray label object and "fixed" by deleting a
> real one.
>
> **`unit_ref` and `unit_id` are written by the selector popup, not by you** (§13b).
> An agent producing an unlinked demo leaves both `""`; inventing a value produces
> a panel that links to nothing and reports no error.
>
> **The 53-object lesson (2026-08-09)** — why the contract exists. Asked for a
> ventilation demo, an agent built a new conceptual panel from a short equipment
> list: roughly half the production object set, approximated filters and coils,
> invented spacing. It parsed, imported and rendered. It was still wrong, because
> a vent panel is judged against the drawing the site already uses, and every
> approximation was a difference a technician would read as an error. The correct
> approach was available and cheaper: open the supplied production JSON, treat all
> 102 objects as the baseline, preserve geometry, `zIndex`, `tag_text` and
> `alias_text`, and change only what the new unit actually requires.
>
> **Object count is not the lesson.** A 53-object panel is not wrong because 53 <
> 102; it is wrong because roles were missing and geometry was invented. The
> target is coverage of the required production roles, listed in contract §5.

---

## R8 — §19 Gotchas (append one entry)

**Anchor:** end of §19, matching the numbering already in use.

**Append:**

> **N. Comparing two exports by array index reports differences that do not
> exist.** The 9099 export and the committed reference, diffed index by index,
> show 85 objects differing in `posLeft`, 84 in `posTop` and 66 in `obj_id` — a
> figure that suggests two unrelated panels. Matched by role, 79 of 102 objects
> are geometrically identical and 21 moved. The array order is not stable across
> exports because it is not paint order (see §17b.2). **Diff by role.** A useful
> role key is `(obj_id, alias_text)`, falling back to `(obj_id, nearest-neighbour
> position)` for the unlabelled scaffold objects.

---

## What is deliberately not changed

- **§§1–16, 18, 20, 21 are untouched.** They are the host deep-dive, they are
  live-verified, and the audit found no factual defect in them.
- **No section is deleted.** Two subsections relocate; both leave a pointer and a
  disposition table naming where each paragraph went.
- **The Maskin subsection keeps its full detail.** It is class-4 geometry for a
  different panel type, and the audit's scope was ventilation. Extracting a
  `MASKIN-GEOMETRY-CONTRACT.md` is the obvious next step and is listed under
  "Evidence required" in [DOCUMENTATION-AUDIT.md](DOCUMENTATION-AUDIT.md); it is
  not attempted here because there is only one measured Maskin export, and one
  sample is not enough to distinguish a house convention from that plant's
  accident.
- **No coordinate is dropped.** Every measurement leaving `CLAUDE.md` is already
  present in `VENTILATION-GEOMETRY-CONTRACT.md` with an evidence id and a scope
  tag it did not have here. The disposition tables in R6 and R7 are the proof —
  each maps a source paragraph to its destination.
