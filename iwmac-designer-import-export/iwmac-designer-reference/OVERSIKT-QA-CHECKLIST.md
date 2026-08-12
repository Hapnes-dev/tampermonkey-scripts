# Oversikt QA checklist

> Acceptance tests for a store-overview panel — new, copied or patched. The
> rules being tested live in
> [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md); the
> procedure that produces the panel is
> [OVERSIKT-AUTHORING-GUIDE.md](OVERSIKT-AUTHORING-GUIDE.md).
>
> Work the stages in order. Stage 0 is cheap and catches most of it; stages A–F
> catch what a script cannot see.

## Stage 0 — Run the validator

```bash
python validate-oversikt-panel.py PANEL.json
```

When a production export was supplied — **always**, no exceptions:

```bash
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json
```

When the panel is (or claims to be) the plant-10113 store overview:

```bash
python validate-oversikt-panel.py PANEL.json --profile TEMPLATE-10113
```

When the change was a centering patch, declare the scope so that anything else
that moved is reported:

```bash
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope value-position
```

When equipment footprints have been measured — the only way any script can say
anything about centering:

```bash
python validate-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json
```

When the task is to link, relink, validate links or diagnose failed values, the
plant-specific parameter source is mandatory:

```bash
python validate-oversikt-panel.py PANEL.json --parameters PARAMETERS.xlsx
```

For a repaired source panel:

```bash
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json \
  --patch-scope binding-repair --parameters PARAMETERS.xlsx
```

Exit status 0 means no `error` findings. `info` and `warning` findings still
need reading — `O-G05` (partial clusters) and `O-G02` (non-cluster objects) are
information about the panel, not complaints about it.

In the same pass, run the GLOBAL visual-correctness validator — text protection
and allowed-values sizing, `VC-*` rule ids, same exit convention
([VISUAL-CORRECTNESS-CONTRACT.md](VISUAL-CORRECTNESS-CONTRACT.md)):

```bash
python validate-visual-correctness.py PANEL.json --source SOURCE.json
```

### What the validator cannot check

It reads structure and geometry. It does not know your store.

| It cannot tell you | Only this can |
|---|---|
| Whether a cluster sits on **its own** case in the artwork | the render, stage C |
| Whether a value object is centred on its equipment box — **without a sidecar** | measured footprints + `--footprints`, then the crops |
| Whether the measured rectangle was the **right** rectangle | a human looking at the artwork, stage C |
| Whether a missing cluster is missing — **without a source** | `--compare`, or `--profile` |
| Whether a `driver_id` names a parameter the controller exposes — **without `--parameters`** | the plant parameter source + `--parameters` |
| Whether parameter meaning matches the visual role when the source has no deterministic role/access/datatype evidence | a human reviewing the matrix; `O-B07` keeps it unresolved |
| Whether the background artwork is the right store | the render, stage C |
| Whether a partial cluster is partial *because the controller is* | the controller's own parameter list |

> **A clean run is necessary, never sufficient.** The nine-cluster
> reconstruction that triggered this checklist passes a bare `--check` with zero
> findings above `info`: valid envelope, real background, catalogue-valid object
> types, clean bindings, no overlaps — and more than half the store missing. The
> same holds for placement: a panel whose every temperature bubble sits *beside*
> its case rather than on it passes every structural rule in the file. **A panel
> JSON contains no equipment-box boundaries**, so without the sidecar the
> validator says so — `O-G09`, *info*, "centering was not checked" — and that
> line belongs in the delivery rather than being replaced by "0 errors".

### The rule ids

| Prefix | Namespace |
|---|---|
| `O-S*` | structure — envelope, fields, geometry, background, catalogue |
| `O-G*` | relationships — controllers, clusters, coverage, layout shape |
| `O-B*` | plant-parameter binding evidence — only with `--parameters` |
| `O-P*` | profile — this panel against a named template |
| `O-C*` | compare — this candidate against its source |

The 2026-08-11 centering rules extend the existing namespaces rather than
opening a new one: `O-G08` (value centred on its footprint), `O-G09` (the
sidecar itself — format, coverage, unfilled template), `O-G10` (the measurement
scale, *info*) and `O-C16` (patch scope). No id was renumbered. The full table
with severities is contract §0.4.

## Stage A — Structural

Every item is checked by `--check`; verify them by reading the findings, not by
assuming a green exit meant each one was looked at.

- [ ] **Envelope** is `iwmac-designer-panel`, `version: 1`, with a `panel`
      object. `O-S01`
- [ ] **`counts` equals the array lengths** — `single_objects`, `containers`,
      `graphics`. A count that disagrees is the first sign of a hand edit.
      `O-S02`
- [ ] **All 17 fields on every object**: `obj_id, name, id, posWidth, posHeight,
      posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag, sub_group,
      driver_id, unit_id, unit_ref, alias_text`. No extras. `O-S03`
- [ ] **Names are unique**, and `object_0 … object_N-1` in sequence. Duplicates
      are an error; a gap in the sequence is a warning, because the host renames
      from the canvas child index on insert. `O-S04`
- [ ] **Every `obj_id` exists in the catalogue**
      ([reference_data/all-design-objects.json](reference_data/all-design-objects.json)).
      An unknown id renders as a broken `undefined`-class box. `O-S10`
- [ ] **Geometry parses, is non-negative and stays on canvas.** An Oversikt does
      not scroll — that is the list panel. `O-S05`
- [ ] **Canvas** matches the plant. 1400 × 750 is the standard; an export that
      says otherwise is right about its own plant. `O-S06`
- [ ] **Text is UTF-8** — `°C`, never `gr C`, and no mojibake in `alias_text`,
      `tag_text`, `link_name` or `sub_group`. `O-S11`
- [ ] **`zIndex` mode is consistent**: explicit bands *or* the literal
      `"default"` throughout — never mixed. Value boxes 110, circular symbols
      375. `O-S12`
- [ ] **`containers` and `graphics` are empty.** An Oversikt is single objects
      over artwork; containers are the list-panel pattern.

## Stage B — Background

- [ ] **`panel.image_data` is present** and `panel.converted` is `"true"`.
      `O-S07`
- [ ] **`panel.image_svg_trace` is absent.** It is export-only AI input; the host
      deletes it on insert, and emitting it is a defect. `O-S08`
- [ ] **On a patch, the background is byte-identical to the source** —
      `image_data`, `converted`, `org_image_name`, `image_name` and the canvas
      dimensions. `O-C13`, `O-C14`, `O-C15`
- [ ] **No live value, alarm colour or dynamic symbol is baked into the
      artwork.** A drawn reading is frozen and nobody can tell by looking.
- [ ] **The background is the light store plan.** No dark artwork, not even when
      the plant's existing panel is dark.
- [ ] **The artwork is the right store** — walls, rooms and cases match the plan
      the clusters were placed against.

## Stage C — Controllers, clusters and coverage

This is the stage the 2026-08-10 incident would have failed.

- [ ] **Every object has an identity** — a `unit_id`, or a `driver_id` whose
      first five underscore fields give a controller. `O-G01`
- [ ] **Clusters were grouped by identity, not by proximity.** Proximity merges
      adjacent cases and splits nudged ones, and both look right on screen.
- [ ] **Every source controller is present in the candidate.** The headline
      check. `O-C03`
- [ ] **No controller exists only in the candidate** — that is an invented
      binding or a rewritten identity. `O-C04`
- [ ] **No unexplained additions or removals of objects.** Each one named, with
      a reason. `O-C01`, `O-C02`
- [ ] **Per-controller coverage matches the source**, role by role. `O-C05`,
      `O-P04`
- [ ] **No role appears twice on one controller** — one controller is one
      position, and a duplicated cluster shows two cases where there is one.
      `O-G04`
- [ ] **Partial clusters were left partial.** A controller with no cooling or
      defrost relay has nothing to show; padding it to four invents a binding.
      `O-G05` is *info*, and staying at info is the pass condition.
- [ ] **No cluster is torn apart** — every member within the cluster span.
      `O-G03`
- [ ] **Per-type counts are reported** — alarm / value / cooling / defrost — and
      **labelled as evidence, not targets**. `O-G00`
- [ ] **The counts were judged against this panel's own source**, never against
      another store, the fleet median, or the 21/21/15/15 of the committed
      fixture.

### Is the bubble on the box? — the stage-C question

Cluster-near-the-equipment is stage D. This is the finer one, and it is the
question the 2026-08-11 correction was about: **is the temperature/value object
itself on the visual centre of the physical box, cabinet, case or room drawn in
the artwork?**

- [ ] **Each measured footprint is the equipment, not the label.** The blue box,
      the cabinet outline, the room — never the caption beside it, never the
      cluster's own bounding box, never bare floor. This is the check no script
      performs; `--footprints` only compares against whatever rectangle it was
      handed. §7.1a
- [ ] **The value object is centred on it** — `left = x + (width - w) / 2`,
      `top = y + (height - h) / 2`, rounded half-up, using **this panel's**
      value-object size. `O-G08`
- [ ] **The measurement was scaled onto the canvas.** Measured at the image's
      natural size, `scale_x = panel_width / image_width` and
      `scale_y = panel_height / image_height` are stated and applied. A scale of
      exactly 1 is still stated. `O-G10`
- [ ] **A combined A/B case under one regulator is one footprint** — the union —
      and only where evidence shows the two sections are one position. Adjacency
      is not evidence.
- [ ] **Alarm, cooling and defrost were not forced to the centre.** They hang off
      the value object; only the value object owns the box centre.
- [ ] **Unmeasured controllers are named as unmeasured**, not silently left out
      of the report. `O-G09`
- [ ] **A production position that is off-centre was reported, not corrected** —
      unless the task asked for the correction or higher-ranked evidence proved
      it wrong. Mark the record `production_proven` and say so.
- [ ] **The sidecar is not a synthetic one.** `build-oversikt-footprints.py
      --synthetic` back-derives boxes from the objects themselves: it is test
      instrumentation, it proves the plumbing and nothing about the artwork. The
      validator warns (`O-G09`) and ends the run saying centering was not proved;
      the renderer shouts about it in the preview. A delivery whose only centering
      evidence is a synthetic sidecar has no centering evidence.

### The coverage matrix

Reproduce it in the delivery, source versus candidate:

| controller | alarm | value | cooling | defrost | label | source coordinate | equipment footprint | value centre |
|---|---|---|---|---|---|---|---|---|

A blank cell is a fact about the controller. It is not a gap to fill.
`UNMEASURED` in the footprint column is a **stated gap, not a pass**.

## Stage D — Placement and layout shape

Compare **by role and by controller, never by array index.** Two exports of the
same panel routinely order their objects differently: index-by-index they look
almost entirely different, and matched by identity they are the same drawing.
Every `O-C*` finding is produced by identity matching for this reason.

- [ ] **Every cluster is anchored on the case, cabinet or room it monitors.** A
      cluster on empty floor or in a margin is a defect even with perfect
      bindings. This is **level 1** — necessary, and not sufficient: the value
      object's own centring is stage C.
- [ ] **Nothing moved that was not asked to move.** A displacement over 20 px is
      an error; below it, a nudge. `O-C06`
- [ ] **The patch scope held.** On a centering correction the only permitted
      object-level differences are `posLeft`/`posTop` on temperature/value
      objects, and **no field difference at all** on any other object. `O-C16`

```bash
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope value-position
```

- [ ] **Anything outside that scope is disclosed and justified separately** — a
      resized bubble, a rewritten alias, a re-bound driver id, a nudged alarm, a
      changed `zIndex`, a reordered array. It does not travel under a geometry
      correction.
- [ ] **A cluster that did move, moved whole** — one vector, every member,
      internal offsets intact. A value object moved alone to reach its box centre
      is the deliberate exception, and it still has to stay inside the cluster
      span (`O-G03`); if it does not, the whole cluster needed moving.
- [ ] **The clusters are not on a regular lattice.** A grid of cards is a
      **CLUSTER KIT** hand-off, and a kit must be labelled a kit, never delivered
      as a finished panel. `O-G06`
- [ ] **Overlaps are explained.** Coincident cooling/defrost on the *same*
      controller is deliberate — the host draws whichever state is active.
      Anything else needs a reason. `O-G07`
- [ ] **No object is hidden** behind another, or stacked outside its z-band such
      that it never renders. `O-S12`, `O-C11`
- [ ] **No duplicate labels** — two captions naming the same case read as two
      cases.
- [ ] **Known anomalies survived.** An inverted cluster, a `tag_text` of a single
      space, a duplicated alias: report them, do not tidy them.

## Stage E — Links and sanitization

- [ ] **Task scope was named.** Layout correction: bindings preserved. Link,
      relink, validation or failed values: bindings checked and repaired from
      the parameter source. "Preserve and patch" was not read as "preserve
      known-unverified links." `OV-C5`
- [ ] **No binding was blanked during layout work.** `driver_id`, `unit_id` and
      `alias_text` survive a layout correction. `O-C07`
- [ ] **No binding was changed outside a declared binding task**, and each
      change is named by controller and role. `O-C08`
- [ ] **`linked` agrees with the host's literal-state rule.** A `driver_id` with
      `linked` not `"true"` is an error; `linked:"true"` with an empty
      `driver_id` is legitimate host behaviour on a real export. **This is
      structural consistency only, never validity.** `O-S09`
- [ ] **Every intended link has one matrix row**, grouped by controller and
      alarm/value/cooling/defrost role, never array index or proximity. The row
      records both driver ids, both unit ids, both aliases, exact-match states,
      access, datatype, verdict, reason and evidence. `O-B00`
- [ ] **Every panel `driver_id` resolves exactly and uniquely.** A matching plant
      prefix, familiar suffix or syntactically plausible id does not count.
      Duplicate source rows are ambiguous. `O-B02`, `O-B03`
- [ ] **Resolved `unit_id` matches exactly**, including bus prefix. AK2→AK3 and
      `001:`→`000:` are never inferred transformations. `O-B04`
- [ ] **Alias comparison is exact.** Capitalization, punctuation, whitespace,
      abbreviation and encoding differences are recorded as normalized-only or
      different with both values; fuzzy candidates never authorize a link.
      `O-B05`
- [ ] **Controller identity, object role, access and datatype agree** where the
      source makes them deterministic. If not automatable, the matrix says
      manual semantic verification remains and the object stays unresolved.
      `O-B06`, `O-B07`
- [ ] **No completed-linking claim exists with unresolved intended links.**
      Deliver verified subset, matrix, source coverage, exact unresolved
      controllers/roles and required evidence instead. `O-B08`
- [ ] **Partial-file policy held.** Existing unresolved binding fields remain
      byte-identical and are labelled UNVERIFIED in the external report; no
      custom verification field was invented inside the JSON.
- [ ] **Binding repair preserved document identity and geometry.**
      `--patch-scope binding-repair` reports `O-C16` held; names (including
      `object_10000` forms), `obj_id`, coordinates, dimensions, `zIndex` and
      array order did not change.
- [ ] **No object was retyped.** A purpose-built symbol replaced by a generic
      value pill is reported with both type names. `O-C09`
- [ ] **No driver id was constructed.** They are copied verbatim from the plant's
      parameter source; prefixes, controller numbers, group digits and suffixes
      are never edited.
- [ ] **On a known template, no unfamiliar aliases.** An alias this template's
      objects have never carried is the shape an invented binding takes. `O-P07`
- [ ] **Array order is preserved on a patch.** `O-C12`
- [ ] **For a committed reference**: the *masked production* profile was used —
      plant field of `driver_id` → `NNNNN`, `plant_id` / `saved_by` /
      `org_image_name` / `image_name` blanked, and **`unit_id` preserved**. The
      global unlinked-demo contract blanks `unit_id`, which on an Oversikt
      deletes the cluster structure the reference exists to carry. Re-run
      [build-oversikt-fixture.py](build-oversikt-fixture.py); do not hand-edit.

## Stage F — Render, and the draft rule

- [ ] **A preview was rendered and looked at.**

```bash
python render-oversikt-panel.py PANEL.json -o panel-preview.html
```

```bash
python render-oversikt-panel.py CANDIDATE.json --source SOURCE.json -o panel-preview.html
```

```bash
python render-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json -o panel-preview.html
```

- [ ] **The preview embeds the actual background** and draws **all** objects. A
      preview without the store plan proves nothing: every placement rule is
      about where an object sits relative to the store.
- [ ] **With a source, the ghosts line up.** Dashed source clusters under the
      candidate make a displaced cluster obvious and a missing one unmissable.
- [ ] **Every cluster reads as one thing** on its case — not two, not a floating
      pair.
- [ ] **With footprints, the amber box was judged against the artwork first.**
      Solid amber is the measured footprint, the crosshair its centre, dashed
      amber where the value object should sit. **If the amber box is not around
      the visible case, the sidecar is wrong, not the panel** — fix the
      measurement before touching a coordinate.
- [ ] **The controller-level crops were opened, one by one.** Whether each bubble
      is on the centre of its box is a visual question and this is where it gets
      answered; the whole-panel view is too small to see a 3 px drift and too
      small to see a bubble sitting on the label instead of the case.
- [ ] **The preview was not committed.** `*-preview.html` and `_preview-*.html`
      are git-ignored on purpose.

### If the input was a PDF or a screenshot only

- [ ] **The deliverable is labelled a draft**, in the delivery text, not only in
      a comment.
- [ ] **Every binding is empty** — no `driver_id`, no `unit_id`, no `link_tag`.
- [ ] **No plant id, tag or navigation target was invented.** An invented
      binding looks linked and reads nothing.
- [ ] **The missing evidence is disclosed by name** — no controller addresses, no
      parameter aliases, coordinates estimated at a stated scale.
- [ ] **For a screenshot, the scale factor is stated as a number.**

## Stage G — Import and save

- [ ] **Insert onto an empty canvas.** Insert *appends*; on a populated panel it
      duplicates every object.
- [ ] **Object names renumber on insert** — expected, from the live canvas child
      index. Only order and uniqueness carry information.
- [ ] **Re-export after insert and compare** with the file you inserted. Only the
      `object_N` names may differ.
- [ ] **A compiled panel lands `visible=1`** whatever the save popup posted.
      Hide it afterwards via the panel-order manager if it should not be live.

## The verification report

Nine items — contract §11. A delivery missing any of them is incomplete.

1. The input class, named exactly.
2. The source precedence rank the geometry came from.
3. The coverage matrix, source versus candidate.
4. Per-type counts, labelled as evidence and not as targets.
5. Every cluster added, removed, moved or relinked, with its reason.
6. The footprint evidence — who measured what, from which image at which
   resolution, with the scale factors, which controllers are unmeasured, and the
   before/after position of every value object that moved. **With no footprints,
   the words "centering was not verified".**
7. The exact validator commands run, and their output — including the declared
   `--patch-scope` on a patch.
8. The render inspected, and what was checked in it — the controller-level crops
   for a centering job, not only the whole panel.
9. Every evidence gap, stated as a gap and kept separate from what was verified.

For linking work, attach the full binding matrix and state the parameter source,
intended count, structurally-linked count, exact source coverage,
semantically-verified count and unresolved count separately. Name every
unresolved controller/role and what evidence would settle it.

## Test commands

Run from `iwmac-designer-reference/`. The repo convention is per-module —
`discover -s tests` fails because `tests/` has no `__init__.py`, and adding one
is not the fix.

```bash
python -m unittest tests.test_oversikt_10113_contract
```

```bash
python -m unittest tests.test_oversikt_link_binding
```

```bash
python -m unittest tests.test_maskin_10229_contract tests.test_maskin_compressor_bank tests.test_list_panel_contract tests.test_ventilation_profile_9099 tests.test_build_ventilation_corpus
```

Regenerate the rules from the fixture, and fail if they have drifted:

```bash
python build-oversikt-rules.py --check
```

Rebuild the seven negative fixtures into a scratch directory (they are
deliberately not committed — each would embed another copy of the 48 kB store
plan):

```bash
python build-oversikt-negatives.py --out survey-tmp/oversikt-negatives
```

Emit a footprint sidecar template to fill in from the artwork — **a template
that has not been filled in does not validate**, it reports itself as unfilled:

```bash
python build-oversikt-footprints.py PANEL.json -o FOOTPRINTS.json
```

## Regression prompts

Run these against any agent given the kit.

### 1 — Preserve and patch

> *"Here is our store overview panel export and the store layout PDF. Move the
> two clusters in the back room onto their correct cases."*

It passes only if the answer:

- recognises that a production JSON was supplied, and says so;
- **preserves and patches** — returns all 72 objects, not a rebuild;
- moves exactly two clusters, whole, each with one vector;
- leaves the other 19 controllers untouched — geometry, bindings, order and all;
- keeps the embedded background byte-identical;
- treats the PDF as identification only, and reports rather than acts on any
  position the PDF omits;
- reports the coverage matrix and per-type counts, labelled as evidence;
- runs `--compare` against the supplied export and shows a clean result apart
  from the two intended `O-C06` moves.

It fails if the answer rebuilds the panel from the PDF, returns fewer clusters
than it received, pads a two-member cluster to four, blanks a binding while
"tidying", or delivers a grid.

### 2 — The centering correction

> *"Attached is the panel JSON. The temperature bubble must be in the center of
> every box."*

It passes only if the answer:

- treats it as a **geometry patch of the supplied document**, not a rebuild, and
  changes `posLeft`/`posTop` on temperature/value objects and **nothing else** —
  demonstrated with `--patch-scope value-position`, not asserted;
- distinguishes the **equipment footprint** from the label, the cluster bounding
  box and the approximate anchor, and says which it measured;
- states the source of each footprint, its image resolution and the
  `scale_x`/`scale_y` it applied — or reports the evidence gap and emits **no
  coordinate** for the controllers it could not measure;
- uses the panel's own value-object size in the formula rather than assuming
  42 × 22;
- leaves alarm, cooling and defrost where they were;
- treats a combined A/B case as one footprint only where evidence shows it;
- does not "correct" a production position purely for being off-centre;
- verifies by re-parsing, by a source-to-candidate field diff, and by looking at
  controller-level crops.

It fails if the answer centres on the text label, silently forces 42 × 22,
measures on the image without scaling, moves the whole cluster when only the
value object was asked to move, invents a footprint for a controller it could
not see, or reports "0 errors" as proof of centering when no footprints were
supplied.

### 3 — Link validation after a stale-controller migration

> *"Here is an Oversikt export and this plant's parameter workbook. Link out the
> panel and give me the corrected JSON."*

The source has binding-looking fields on every object, but only part of its
`driver_id` set resolves exactly. It passes only if the answer:

- treats `linked:"true"` and non-empty ids as structural state, not validity;
- preserves geometry, object identity, names, order and background;
- resolves every intended alarm/value/cooling/defrost role exactly in the
  supplied parameter source and checks exact `unit_id`;
- records alias differences without normalizing them into matches;
- never converts AK2→AK3, `001:`→`000:`, controller indexes or suffixes by
  inference;
- reports the matrix and separate source-resolved, semantically-verified and
  unresolved counts;
- uses `--parameters` and `--patch-scope binding-repair`;
- refuses "finished", "fully linked", "linked-ready", "production-ready" and
  "verified" while one intended role is unresolved.

It fails if most matches are treated as enough, if unmatched ids are only
mentioned in prose, if array index pairs the two exports, or if stale unresolved
fields are silently changed or described as verified.
