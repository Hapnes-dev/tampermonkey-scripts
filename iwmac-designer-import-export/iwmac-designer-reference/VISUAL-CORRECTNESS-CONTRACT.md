# Visual correctness and object semantics — the GLOBAL contract

> **Search terms**: visual correctness, text covered, text hidden, overlap, collision,
> objects on top of text, label obscured, icon over text, value box too small, truncated
> state text, allowed values, format_extra, enum map, state labels, width sizing, visual
> analysis, classify panel, panel anatomy, before generating, table cell layout, icon
> cell, value cell, readability.

**Scope `GLOBAL`.** This document owns three rule areas that apply to **every** panel
type — technical drawings, process schematics, store maps, matrices, lists, grouped
overviews and hybrids alike:

1. **Mandatory visual analysis before generation** (§2) — what must be classified and
   measured about a supplied panel before any JSON is written or changed.
2. **Objects never cover text** (§3–§4) — the text-protection rule, the role-geometry
   model behind it, and the deliberate-overlap classes that bound it.
3. **Width from allowed values** (§5) — value-object sizing is derived from every
   display value the source allows, never from the value currently shown.

It deliberately contains **no coordinate, no obj_id inventory and no per-type
geometry**. Panel-type specifics stay in the per-type generation contracts, which
outrank this file on their own panel type wherever they are more specific
(`OVERSIKT-GENERATION-CONTRACT.md`, `MASKIN-GENERATION-CONTRACT.md`,
`VENTILATION-GEOMETRY-CONTRACT.md`, `ROMKONTROLL-GENERATION-CONTRACT.md`,
`LIST-PANEL-GENERATION-CONTRACT.md`). A supplied production export outranks
everything committed here, per the source-precedence ladder in
`AI-REQUEST-ROUTING.md` §1.2 and `AI-BRIEFING.txt` §0.

Executable form: `validate-visual-correctness.py` (§6). Machine-readable form:
`documentation-rules.json` → `global_invariants.visual_correctness`.

---

## §0 Why this exists

Structural validity has repeatedly been mistaken for correctness. The record:

- **2026-08-10, Oversikt rebuilds (E14/E15).** Two reconstructions of a 21-cluster
  production store overview were structurally valid, inserted cleanly, and were both
  wrong — one regrouped the map into dashboard cards, one silently dropped 12
  controllers. Nothing visual had been analyzed before generating.
- **2026-08-10, generated Maskin (negative example, `MASKIN-GENERATION-CONTRACT.md`
  §13).** 63/63 objects insert-verified; compared *by role* against production, 3 roles
  missing, 1 invented, 0 of 62 shared roles at production coordinates.
- **The blanket-"never overlap" failure (`DOCUMENTATION-AUDIT.md` F5, F10, F11).** An
  earlier instruction said "Never overlap; 8 px gaps". Production ventilation panels
  overlap **by design** (connector∩pipe, damper∩duct, LED∩equipment body,
  value∩equipment body), so an agent obeying the blanket rule shortened the duct to
  clear the damper — a reported failure. The instruction was removed
  (`documentation-change-log.md` Part 1 change 1). F11 then recorded the residual gap:
  *overlap was prohibited without a detection method or an exception list*. This
  contract is that detection method and that exception model.
- **Undersized state values.** A value object sized to its current reading ("0", "OK")
  truncates or overflows the moment the signal enters a longer state. Plant parameter
  exports carry the full display-value maps — E23 measured one store's workbook at
  15,110 parameter rows with 107 distinct enum maps of the form
  `0 = OFF / 1 = ON`, with single state labels reaching past 40 characters
  (`Comp. w. unloaders only`, `1xVariable + Comp. w. unloaders`) — while the standard
  value pill on the matching overview panel is 42 px wide. Sizing from the current
  value is sizing from the one value that happens to be present.

A JSON file can be structurally valid and still be a visually and operationally wrong
IWMAC panel. Visual correctness, object semantics, text readability and source-driven
sizing are acceptance requirements of the same rank as schema validity.

---

## §1 The role-geometry model

Every visible element on a panel plays exactly one role, and **each role owns its own
rectangle**. Roles never share geometry:

| Role | What it is | Typical carriers |
|---|---|---|
| **Descriptive text** | Static label an operator reads: names, headers, annotations | objects whose catalog entry is text-only (`only_tag_text: true`), label-family obj_ids, nonblank `tag_text` on static objects, text drawn in the background artwork |
| **Icon / symbol** | Alarm bell, status LED, cooling/defrost glyph, navigation arrow | symbol-family obj_ids, state-image objects |
| **Live value** | The changing reading or setpoint | value-pill / number-family obj_ids, `can_link` objects |
| **Engineering unit** | °C, %, Pa, m³/h | the object's own unit region, or a separate static text object |
| **Artwork** | Ducts, pipes, equipment bodies, the store plan raster | background `image_data` / `image_svg`, decoration objects |

Consequences, all normative:

- A live value never doubles as a label. A label never reserves the space a future
  icon will need "inside" its own text string.
- Where a design needs label + icon + value together (any table or list row, any
  cluster with a caption), each gets its own object or its own cell: a **static label
  cell**, a **blank icon cell**, a **blank value cell**. Never an icon appended at the
  end of a text string without a reserved cell.
- Never assume the space to the right of a text object is free because the current
  text is short. The reserved rectangle of a text object is its full
  `posWidth × posHeight`, and translated or alternate texts may fill it.
- Text classification is decided from the object catalog
  (`reference_data/design-object-catalog.json`: `only_tag_text`, `can_link`,
  `has_tag`, `object_type`), not guessed from what the current string looks like.

## §2 Mandatory visual analysis before generation

**A supplied production JSON is an authoritative visual template, not merely a schema
or a data source.** Before generating a new panel from it, or modifying it, the
supplied material is classified. The analysis is stated in the answer *before* any
JSON is emitted, and every later geometric decision cites it. Skipping this step is
how a map became a dashboard.

Classify, at minimum:

- **A1 Panel type and visual purpose** — technical drawing, process schematic, map /
  store plan, matrix, list, grouped overview, or hybrid. Route per
  `AI-REQUEST-ROUTING.md` §2; the visual purpose (what the operator reads off it) is
  named in one sentence.
- **A2 Background ownership** — embedded raster (`image_data` + `converted`), authored
  vector (`image_svg`), or none; whether descriptive text and equipment bodies live in
  the background or in objects.
- **A3 Container anatomy** — none, decorative, or structural (`table_container` two-layer
  pattern); which layer draws and which layer binds.
- **A4 Repetition model** — the repeated unit (cluster, row, column), its member roles,
  its pitch, and how many repeats the *source* proves (counts are measurements of one
  store, never design targets).
- **A5 Live-object overlay model** — which objects sit on artwork, in which z-bands;
  z-bands are read from the source, never assumed (they invert between panel types,
  conflict M-1).
- **A6 Object vocabulary** — the obj_ids actually used, against the catalog; per obj_id
  its role per §1 (alarm, status, value, setpoint, text, navigation, artwork).
- **A7 Measured geometry** — content bounds, alignment lines (shared x/y), section
  hierarchy, repeated spacing; where the panel scrolls, the scroll direction and the
  real content extent (nominal `panel_width`/`panel_height` is a viewport, not a
  clipping boundary).
- **A8 Text inventory** — every descriptive-text carrier and its rectangle; which
  rectangles must stay clear (§3).
- **A9 Value sizing sources** — for every live value: where its allowed display values
  come from (format_extra / allowed-values column / state map / range), §5.
- **A10 Operator-facing information priority** — what must be readable at a glance
  (alarms, temperatures), what is secondary; nothing in the first group may be
  covered, shrunk or displaced to satisfy the second.
- **A11 Intentional overlaps** — every overlap class the source itself proves (§3.2),
  listed with magnitudes, so they are preserved rather than "fixed".
- **A12 Sanitization state** — unlinked-demo vs masked-production contract; what the
  bindings prove about which objects are live.

For modification requests the same analysis runs on the *supplied* panel first, and
the answer preserves everything outside the requested change
(`OVERSIKT-GENERATION-CONTRACT.md` §6.2 preserve-and-patch is this rule's per-type
form). `--require-analysis` in the validator (§6) checks an analysis block for
presence and completeness of A1–A12.

## §3 Objects never cover text

**The rule.** A live object — alarm icon, status symbol, value, setpoint, navigation
element, decoration — must never overlap a nonblank descriptive-text rectangle, at any
z-index, unless the supplied production panel proves that exact overlap intentional.
Text under a symbol is text an operator cannot read; z-order does not excuse it,
because the covered text is unreadable either way.

**Detection (executable, §6).** For every pair (live object, static-text object with
nonblank text), compute axis-aligned rectangle intersection from
`posLeft/posTop/posWidth/posHeight`, after converting container-relative child
coordinates to panel-absolute (child absolute = container `left`/`top` + child
`posLeft`/`posTop`). Any positive-area intersection is a finding: **error** when
unproven, **info** when production-proven (§3.2).

### §3.1 What this rule does NOT say

This is not the old blanket "never overlap" — that rule was removed because it
contradicted production and caused agents to trim ducts (F5/F10/F11). Overlaps
between live objects and **artwork** are routine and often mandatory: a value box
sits *on* its duct, a damper *on* its column, an LED *on* its equipment body, a
cluster *on* its display case. §3 protects **text**, and only text.

### §3.2 Deliberate-overlap classes, and how one is proven

An overlap is deliberate when the supplied source (or, absent one, the committed
reference fixture for that panel type) shows the **same role pair overlapping in the
same relative arrangement**. Production-proven classes on record:

| Class | Evidence | Where documented |
|---|---|---|
| connector ∩ pipe (7 px, 5 px) | E1 ventilation export | `VENTILATION-GEOMETRY-CONTRACT.md` §3 |
| damper ∩ duct column | E1 | same |
| LED / value ∩ equipment body | E1 | same |
| cooling ∩ defrost symbol, deliberately coincident | E17/E22 Oversikt exports | `OVERSIKT-GENERATION-CONTRACT.md` §7.2 |
| paired same-role value pills, ~8 px edge overlap at 34 px pitch (two-sensor cases) | E22 production overview: 4 pairs, both members carrying the same alias | this file |

None of these puts a live object over descriptive text. No production export examined
to date proves a live-over-text overlap; until one does, live-over-text has no
deliberate class and is always a defect. When a source *is* supplied, the validator's
`--source` mode accepts candidate overlaps whose object pair overlaps identically in
the source, and still reports them as informational findings so a reviewer sees them.

### §3.3 Resolving a collision

When a required object would land on text, the fix is **moving the object to the
geometry the source assigns it** — never shortening, shrinking or deleting the text,
and never deleting the object. If the source itself provides no collision-free
placement, that is an evidence gap to disclose, not a license to improvise.

## §4 Table and list discipline

On any tabular panel (room-control table, spjeldliste, matrix, any repeated-row
layout), every row reserves separate geometry per §1:

- a **static label cell** — descriptive text only;
- a **blank icon cell** — reserved even while no icon is currently shown;
- a **blank value cell** — sized per §5, reserved even while empty.

Never place an icon at the end of a text string without a reserved cell. Never let
the value column borrow label-column space because today's labels are short: label
columns are sized to the longest label the source provides (translations included),
value columns to §5. Column and cell geometry is read from the source
(`descr_width`, `val_width`, measured cell offsets) when a source exists; the
per-type contracts own the measured numbers.

## §5 Width from allowed values

**The rule.** The current value of a signal is never sufficient to size its value
object. When the source provides allowed display values — `format_extra` enum maps in
`iw_gen_driver_parameters`, an "Allowed values" column in a parameter workbook, state
definitions, value maps, translated state labels — **every allowed display value is
parsed before the value-object width is chosen**, and the object is sized (or an
obj_id variant chosen) to fit the **longest** of them, plus the engineering unit if
the unit shares the object.

Worked example. A digital state signal carries the map
`0 = Alarm / 1 = OK / 2 = Communication error`. The current value renders "OK";
the longest allowed label is `Communication error` — 19 characters. At the panel
font (13 px Arial) that needs roughly `19 × 7 + 6 ≈ 139 px`; a 42 px numeric pill
truncates it. The correct move is the wider value-object variant from the catalog
(or the per-type contract's designated state-text object), never "it fits today".

Mechanics:

- **Enum maps** are parsed as `value = label` pairs, separated by a **spaced**
  slash (` / `), `;`, `,` or newlines (E23's dominant form: `0 = OFF / 1 = ON` —
  all 107 of its enum maps use the spaced form). A bare `/` inside a label is
  label content (`Heat/Cool`), not a separator. Labels keep internal spaces
  and punctuation; the map's numeric keys are not display text.
- **Numeric ranges** (`-200.0 to 200.0`) size for the widest rendering of either
  bound: sign, integer digits, decimal separator, the decimals the source shows, and
  the unit when co-located.
- **Translations count.** When the source carries translated state labels, the
  longest label across languages governs.
- **Text-width estimate.** Deterministic checks use a conservative per-character
  estimate (validator default `--char-px 7.0` at the 13 px default font, plus 6 px
  padding). It is a floor detector, not a typesetter: findings say "cannot fit",
  never "fits pixel-perfectly". A rendered screenshot outranks the estimate.
- **No source, no invention.** When no allowed-values source exists for a live value,
  the width comes from the panel-type contract's production-measured default for that
  obj_id, and the answer discloses that state widths are unverified.

## §6 Executable checks — `validate-visual-correctness.py`

    python validate-visual-correctness.py PANEL.json
    python validate-visual-correctness.py PANEL.json --source SOURCE.json
    python validate-visual-correctness.py PANEL.json --allowed-values VALUES.json
    python validate-visual-correctness.py PANEL.json --require-analysis ANALYSIS.json
    python validate-visual-correctness.py ... --json-report

Generic and panel-type-agnostic: runs on any `iwmac-designer-panel` document
(enveloped or bare `panel`), converts container-relative coordinates to
panel-absolute, classifies roles from `reference_data/design-object-catalog.json`
with documented name-pattern fallbacks, and reports findings with rule ids:

    VC-T*  text protection (§3, §4)
    VC-W*  width from allowed values (§5)
    VC-A*  analysis-block completeness (§2, only with --require-analysis)

Exit status 0 when no finding has severity `error`, 1 otherwise — same convention as
the per-type validators. It complements them; it replaces none of them.

**What it cannot see.** Text drawn inside the background artwork has no rectangle in
the JSON, so collisions with background text are invisible here — exactly as
equipment footprints are invisible to `validate-oversikt-panel.py` (`O-G08`). And
overlap is judged on **declared** rectangles: a label whose `posHeight` is 1 but
whose rendered glyphs are ~11 px tall (audit F11, evidence E1) intersects nothing
on paper while colliding on screen — rendered-glyph measurement stays a render-QA
step, not a JSON check. A native-size render (`render-*-panel.py`) plus a human
eye, or a measured sidecar, answers both; a clean VC run is a necessary condition,
never "the panel is correct".
The allowed-values check runs only for objects the supplied map matches; it never
invents a map.

## §7 Acceptance criteria

A generation or modification answer is acceptable only when:

1. the §2 analysis is stated before the JSON, and geometric decisions cite it;
2. `validate-visual-correctness.py` reports no `error` (alongside, never instead of,
   the panel-type validator);
3. every remaining overlap is either production-proven (§3.2, listed) or disclosed
   as an evidence gap;
4. every state-carrying value object names its allowed-values source, or discloses
   that none exists;
5. nothing outside the requested change moved (per-type preserve-and-patch rules).

## §8 Owners

| Question | Owner |
|---|---|
| Which deliverable a request wants | `AI-REQUEST-ROUTING.md` |
| These three rule areas, all panel types | this file |
| Per-type geometry, roles, z-bands, anomalies | the per-type generation contracts |
| Role taxonomy per obj_id | `reference_data/design-object-catalog.json`, `DESIGN-OBJECT-CATALOG.md` |
| The rules as data | `documentation-rules.json` → `global_invariants.visual_correctness` |
| The rules as code | `validate-visual-correctness.py`, tests in `tests/test_visual_correctness.py` |
| Why each rule exists | `documentation-change-log.md` Part 10; `DOCUMENTATION-AUDIT.md` F5/F10/F11 |
