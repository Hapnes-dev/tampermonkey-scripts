# Oversikt authoring guide — how to build or repair a store overview

> The procedure. The **rules** it applies live in
> [OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md); the
> **acceptance tests** live in [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md).
> Where this file states a coordinate, a count or a role, the contract owns it.

## The procedure

Eleven steps, in order. Steps 1–5 read; step 6 decides; steps 7–8 write; steps
9–11 verify. **Nothing is written before step 7.**

| # | Step | Output |
|---|---|---|
| 1 | Classify the request | the input class and the precedence rank |
| 2 | Inspect the supplied artefacts | dimensions, counts, background, bindings |
| 3 | Inventory the controllers and cases | one row per controller |
| 4 | Group the objects into clusters | cluster list with roles and origins |
| 5 | Build the coverage matrix | the table that gates step 7 |
| 6 | Reconcile against the PDF or screenshot | a named list of proven differences |
| 7 | Patch, or generate | the panel JSON |
| 8 | Preserve links for layout work, or verify them for linking work | binding matrix + source-backed patch, or byte-identical preservation |
| 9 | Render a preview | an HTML preview with the real background |
| 10 | Validate | validator output, exit status 0 |
| 11 | Write the verification report | the nine-item report |

> **Hard stop, between steps 5 and 7.**
> **No final panel may be emitted until the cluster inventory is complete.**
> If the inventory cannot be completed from the supplied evidence, the
> deliverable is **the inventory plus a named gap** — not a panel.

## 1. Classify the request

Read every supplied artefact **before** deciding what to produce. Then pick one
row of the routing table and say which one you picked.

| Input | Class | Produce |
|---|---|---|
| A PDF or byggeplan drawing, nothing else | **PDF-only** | an explicitly unlinked draft |
| A screenshot or PNG of an existing panel, nothing else | **screenshot-only** | an unlinked draft, geometry scaled from the image, `scale_x`/`scale_y` stated |
| A background image plus an equipment list | **background + list** | one cluster per listed position, anchored on the artwork |
| A store PNG plus a parameter workbook, no panel JSON | **PNG + workbook** | a built panel: bindings from the workbook, each value object centred on the footprint measured on the PNG, plus the footprint sidecar |
| A panel JSON export | **production JSON** | the entire supplied document, patched |
| A panel JSON export **and** a PDF, screenshot or PNG | **production JSON + secondary** | the supplied document, patched only where the secondary source proves a difference |
| **Two** panel JSON exports | **two candidates** | a comparison first, then one of them named as the base — never a merge |
| A panel JSON **and** a verbal placement correction | **JSON + verbal correction** | the whole document with only the named change, declared with `--patch-scope` |

Contract §6 owns this table; the columns there also say what each class must
**not** produce.

The two questions that decide everything downstream:

1. **Was a panel JSON supplied?** If yes, the operation is **preserve and
   patch**, and every rebuild instinct is wrong. Go to §7a.
2. **Is this an Oversikt at all?** The navigation-hub *Oversikt* of a hotel
   panel set is an icon-tile menu that shares only the name. It is not this panel
   type and none of this applies.
3. **Are bindings in scope?** "Move", "resize" and "centre" mean no: preserve
   them. "Link", "relink", "validate links" and "failed values" mean yes:
   existing `linked:"true"` and non-empty ids must be resolved against the
   supplied parameter source. Contract §8.4 owns the distinction.

### PDF-only is a draft, and says so

A PDF describes the store. It carries no panel-pixel coordinates, no driver ids,
no unit ids and no parameter aliases. From a PDF alone you can produce room and
case **names** and their **relative** arrangement — nothing else.

So the deliverable is a draft that:

- has **no** `driver_id`, **no** `unit_id`, **no** `link_tag` — every binding
  empty, in the shape of the unlinked demo contract;
- is **labelled a draft** in the delivery, not presented as a finished panel;
- **discloses the missing evidence by name**: "no plant id, no controller
  addresses, no parameter aliases, coordinates estimated from the drawing at
  scale X".

**Never invent a plant number, a driver id, a unit id or an alias to make a
draft look finished.** An invented binding looks linked and reads nothing.

## 2. Inspect the supplied artefacts

For a supplied JSON, record before touching anything:

```bash
python validate-oversikt-panel.py SOURCE.json
```

When bindings are in scope and a parameter source was supplied, run the source
check on the **source before editing**:

```bash
python validate-oversikt-panel.py SOURCE.json --parameters PARAMETERS.xlsx --json-report
```

Record intended, structurally linked, source-resolved, semantically verified
and unresolved counts separately. Never let the first count stand in for the
last three.

- Canvas `panel_width` × `panel_height`.
- `counts` versus the actual array lengths.
- Whether `panel.image_data` is present and `panel.converted` is `"true"`.
- The distinct `obj_id`s and how many of each.
- The `zIndex` values in use — explicit bands or the literal `"default"`.
- Any anomalies the validator warns about, so you can tell yours from theirs.

For a PDF or screenshot: the rooms and cases it names, and — for a screenshot —
the pixel dimensions, so the scale factor to the panel canvas is a stated number
rather than a feeling.

> The point of step 2 is that **you can prove what the source contained** when
> you are later asked whether you dropped something. Run the validator on the
> *source* first, not only on your output.

## 3. Inventory the controllers and cases

One row per controller. Identity comes from the fields, never from position:

| Rank | Field |
|---|---|
| primary | `unit_id` |
| fallback | the first five underscore fields of `driver_id`, used only where `unit_id` is empty |
| never | proximity, alias text, array order |

On the committed reference, 21 of 21 clusters resolve from `unit_id` alone.

> **Never group by proximity when identity fields are present.** Proximity merges
> two adjacent cases into one cluster and splits one case whose symbols were
> nudged apart. Both mistakes look plausible on screen and neither shows up in
> the JSON.

Do not assume one controller family per store. The reference panel carries three
— Danfoss AK-CC (`NNN:NNN`), Carel EVD Evolution (`CNN`) and a third family
(`UNN`).

For a PDF or a drawing, the inventory is of **positions**, not controllers: each
display case, cabinet, cold room and freeze room the plan names. Say so, and
say that no controller identity was available.

## 4. Group the objects into clusters

A cluster is every object bound to one controller. Group the inventory from
step 3 by identity and record, per cluster:

- the roles present — alarm, value, cooling, defrost;
- the bounding box and its origin;
- the background feature it sits on.

Two rules from the contract apply while grouping:

- **A cluster is atomic.** Place all of its members or none; move it with one
  vector. A cluster half-moved reads as two positions.
- **A cluster is not required to have four members.** On the reference, 15 have
  four roles and 6 have alarm + value only, because those controllers expose no
  cooling or defrost relay.

## 5. Build the coverage matrix

The table that gates the whole job. One row per controller, ten columns:

| controller | alarm | value | cooling | defrost | label | source coordinate | background target | equipment footprint | value centre |
|---|---|---|---|---|---|---|---|---|---|
| `000:011` | ✓ | ✓ | ✓ | ✓ | — | (917, 113) | freezer island, top right | (880, 100) 120×90 | ✓ (917, 148) |
| `C50` | ✓ | ✓ | — | — | — | (722, 124) | wall cabinet, north aisle | UNMEASURED | — |

- **Derived from the source**, at the highest precedence rank available.
- **Complete before any object is written.**
- A blank cell is a fact about the controller, not a gap to fill.
- **`UNMEASURED` in the footprint column is a stated gap, not a pass.** It says
  the centring of that value object has not been verified. Leaving the column
  blank, or omitting it, silently converts "not checked" into "fine".

Report per-type counts underneath it — and label them:

> Counts are evidence, not targets. 21 alarm / 21 value / 15 cooling / 15 defrost
> is what plant 10113 has. A candidate is judged against **its own** source,
> never against another store's numbers or the fleet median.

### Where the matrix comes from, by input class

| Class | Source of the matrix |
|---|---|
| production JSON | the export itself — it is complete by definition |
| production JSON + secondary | the export; the secondary source may add a *label*, never remove a row |
| background + list | the equipment list, one row per listed position, bindings blank unless supplied |
| screenshot-only | the visible clusters, with a stated note that invisible ones cannot be ruled out |
| PDF-only | the positions the plan names, all binding columns blank |

## 6. Reconcile against the PDF or screenshot

Only when both a JSON and a secondary description were supplied.

Walk the matrix against the drawing and produce a **named list of proven
differences**. Each entry must say which controller, what the drawing shows, and
what the JSON shows.

- The drawing names a case the JSON has no cluster for → **report it as a gap**.
  It may be an uninstrumented case. Do not invent a cluster to cover it.
- The drawing omits a case the JSON has a cluster for → **the drawing is
  incomplete. Keep the cluster.**
- The drawing places a case somewhere the JSON does not → report the discrepancy
  with both coordinates and ask, unless the task explicitly asked for a
  relocation.

> **Never let the PDF reduce the panel.** A store-layout drawing routinely omits
> instrumented positions, shows equipment that was never instrumented, and
> carries no panel coordinates at all. If it shows fewer positions than the JSON
> contains, the discrepancy is a finding — not a licence to delete clusters.
>
> This step is where the 2026-08-10 incident went wrong: a PDF reduced 21
> clusters to 9, and nothing downstream noticed.

## 7. Patch only verified differences — or generate

### 7a. When a JSON was supplied — preserve and patch

**Start from the supplied document. Change the named objects. Emit the whole
thing.**

Never re-derive coordinates, never renumber, never emit only the objects you
touched, and never rebuild the panel from a description of it.

Preserve verbatim:

| Preserve | Note |
|---|---|
| `panel.image_data`, `panel.converted`, `panel.org_image_name`, `panel.image_name`, `panel_width`, `panel_height` | the background and the coordinate space |
| every untouched object's `obj_id`, `posLeft`, `posTop`, `posWidth`, `posHeight`, `zIndex` | |
| `driver_id`, `unit_id`, `link_name`, `link_tag`, `sub_group`, `unit_ref`, `alias_text` on **every** object | including the ones you move |
| array order, and the `object_N` names that follow it | |
| known anomalies — an inverted cluster, a `tag_text` of a single space, a duplicated alias | report them; do not tidy them |

Drop exactly one thing: `panel.image_svg_trace`, which is export-only AI input
that the host deletes on insert.

When moving a cluster, apply the **same** translation vector to every member, so
the internal offsets survive intact.

### 7b. When no JSON was supplied — generate

- One cluster per position in the matrix, anchored on the background feature it
  monitors.
- Roles per the matrix. **Never pad a cluster to four.**
- Object vocabulary from the contract §4 — the exact `obj_id` strings. An
  unknown `obj_id` renders as a broken `undefined`-class box.
- `zIndex`: value box 110, circular symbols 375 — or the literal `"default"`
  throughout. Never mixed in one panel.
- Bindings only where the task supplied them. Otherwise blank, and the panel is
  a draft.

### 7c. Placement — two levels, and the second is the one that gets missed

> **Level 1 — the cluster.** Place each cluster on the case, cabinet, cold room
> or freezer room it monitors in the background artwork.
>
> A cluster on empty floor, in a margin, or in a grid of cards is a defect **even
> if its bindings are perfect** — the position *is* the information.

> **Level 2 — the value object.** Centre the `number_v3_40px_no_conn_no_tag`
> object on the **equipment footprint**: the rectangle of the physical box,
> cabinet, case or room drawn in the artwork.
>
> **The temperature bubble must be in the centre of the box.**

**Level 1 does not imply level 2.** A cluster built around the equipment's text
label satisfies level 1 and fails level 2 — that is the 2026-08-11 correction,
and it is why the two are numbered separately.

To place it:

1. Find the **equipment footprint** on the background: the visible physical box.
   Not its caption, not the aisle, not the cluster's own bounding box.
2. Compute the top-left, rounding **half up** (Python's `round()` is banker's
   rounding and lands a pixel left of centre on even widths):
   `value_left = round_half_up(x + (width - w) / 2)`,
   `value_top  = round_half_up(y + (height - h) / 2)`.
3. `(w, h)` is **this panel's** value-object size — 42 × 22 on the two measured
   stores, but read it from the panel rather than forcing it.
4. If you measured on the image and the canvas is a different size, state
   `scale_x = panel_width / image_width` and `scale_y = panel_height /
   image_height` and apply them before centring.
5. Place alarm, cooling and defrost **relative to the value object** (§7.2a of
   the contract). They do not need to be on the centre.
6. **No footprint, no coordinate.** If you cannot establish the box — no visible
   outline, ambiguous which case a controller serves — say so and leave the
   controller out. A named gap is a deliverable; a guess is not.

A combined A/B case driven by one regulator is **one** footprint, the union of
the two sections — but only where the evidence shows they share a controller.
Adjacency is not evidence.

The 90 px grid in `panel-conventions.json` and `AI-BRIEFING.txt` MODE B belongs
to the **CLUSTER KIT** deliverable — a tray of parts a human then drags into
place — and only there. **A kit must be labelled a kit, never delivered as a
finished panel.** Contract §12, conflict OV-C2.

Full rule, the seven terms it depends on, and how it is checked:
[OVERSIKT-GENERATION-CONTRACT.md](OVERSIKT-GENERATION-CONTRACT.md) §7.1–§7.1c.

## 8. Preserve or verify links; always preserve the background

Called out separately because it is the failure that leaves no trace.

### 8a. Layout/geometry-only task

> **A layout correction never clears `driver_id`, `unit_id` or `alias_text`.**

Blanking a binding turns a working object into one that renders and reads
nothing — and the JSON still looks fine: the object is there, the right type, in
the right place. Strip bindings **only** when the task explicitly asks for a
reusable, unlinked reference, and then use the sanitization profile in contract
§10 rather than blanking by hand.

The background survives every edit: `image_data`, `converted`, `org_image_name`,
the canvas dimensions and any transparency. An Oversikt without its store plan
is not the same panel, whatever its objects say.

### 8b. Link, relink, link-validation or failed-value task

`linked:"true"` and a non-empty `driver_id` are only structural state. They do
not prove the controller or parameter. Work in this order:

1. Load the plant-specific workbook, CSV, JSON or SQL dump. It is mandatory
   evidence for every row it covers.
2. Build the contract §8.4 matrix, grouped by controller and role — alarm,
   value, cooling, defrost — never by array index or proximity.
3. Resolve the existing `driver_id` exactly and uniquely.
4. Verify exact `unit_id`, controller identity, exact alias/description,
   parameter meaning, role and access/datatype where supplied.
5. Mark anything short of all checks **unresolved**. Record normalized-only
   alias differences separately; fuzzy candidates never authorize a binding.
6. For one unique compatible row, copy `driver_id` and `unit_id` verbatim and
   use the exact source alias required by the panel contract. Never transform
   AK2→AK3, `001:`→`000:`, prefixes, controller numbers, group digits or
   suffixes. Keep `link_name`, `link_tag`, `sub_group` and `unit_ref` unchanged;
   this source check does not verify them.
7. Retain unresolved objects' original binding fields byte-for-byte and mark
   them **UNVERIFIED in the report**. Do not add a custom verification field to
   the panel JSON and do not silently blank them.
8. Prove the repair changed no geometry, object identity, names or order:

```bash
python validate-oversikt-panel.py \
  --compare SOURCE.json CANDIDATE.json \
  --patch-scope binding-repair \
  --parameters PARAMETERS.xlsx
```

Hard stop: if any intended link remains unresolved, deliver the verified subset,
matrix, source coverage, exact unresolved controllers/roles and missing evidence.
Do not call the panel finished, fully linked, linked-ready, production-ready or
verified.

## 9. Render a preview

```bash
python render-oversikt-panel.py PANEL.json -o panel-preview.html
```

With a source to compare against, draw it underneath as dashed ghosts — a
displaced cluster is instantly visible and invisible in a text diff:

```bash
python render-oversikt-panel.py CANDIDATE.json --source SOURCE.json -o panel-preview.html
```

With measured equipment footprints, draw them too — the amber box, its centre,
and a dashed box where the value object would sit if it were centred on it:

```bash
python render-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json -o panel-preview.html
```

Where the dashed amber box and the blue value box coincide, the temperature
bubble is on the centre of the equipment. Where they do not, the gap is the
error, at the size it actually is. **Check the amber box against the artwork
under it first** — if it is not around the visible case, the measurement is
wrong, not the panel.

The preview must embed **the actual background** and **all** objects. A preview
without the artwork proves nothing: every rule in this file is about where an
object sits relative to the store, and with no store there is nothing to sit on.

Preview HTML is deliberately git-ignored (`*-preview.html`, `_preview-*.html`).
Generate it, look at it, do not commit it.

## 10. Validate

```bash
python validate-oversikt-panel.py PANEL.json
```

```bash
python validate-oversikt-panel.py PANEL.json --profile TEMPLATE-10113
```

```bash
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json
```

For a patch, declare what it was allowed to change:

```bash
python validate-oversikt-panel.py --compare SOURCE.json PATCHED.json --patch-scope value-position
```

To check value centering at all, supply measured footprints:

```bash
python build-oversikt-footprints.py PANEL.json -o FOOTPRINTS.json
```

```bash
python validate-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json
```

For linking work:

```bash
python validate-oversikt-panel.py PANEL.json --parameters PARAMETERS.xlsx
```

For a source-backed binding repair:

```bash
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json \
  --patch-scope binding-repair --parameters PARAMETERS.xlsx
```

**The generator emits a template, not evidence.** Every `footprint` in it is
`0×0` until you measure the boxes on the background image, and a `0×0` box has
no centre — so an unfilled template fails with one `O-G09` per controller. That
is the intended behaviour: an unmeasured sidecar must fail loudly rather than
report that nothing is wrong. `--synthetic` back-derives the boxes from the
panel's own value objects for testing the checker; it passes `O-G08` by
construction, says so in an `O-G09` warning, and is never evidence of anything.

**Whenever a production export was supplied, run `--compare`.** The bare check
cannot see a missing cluster: a reduced panel is well-formed, and nothing inside
a document says how many clusters the store has. Only the comparison — or the
named profile, for a known template — can catch it.

**Without `--footprints`, nothing about centering was checked.** A panel JSON
carries no equipment-box boundaries, so the validator says so in one `O-G08`
line rather than falling silent. Do not report a clean run as evidence that the
temperature bubbles are on their boxes.

Checked: envelope and counts, all 17 fields, unique and sequential names,
catalogue-valid `obj_id`s, geometry on canvas, embedded background, no
`image_svg_trace`, `linked` consistent with `driver_id`, z-bands, controller
inventory, cluster cohesion, duplicate roles, lattice detection, overlaps — and
in compare mode: dropped, added, missing, moved, resized, relinked, reordered
and retyped objects plus background and canvas changes; with `--patch-scope`,
the field-level patch diff; with `--footprints`, value centering and the
usability of the measurement itself; with `--parameters`, exact source
resolution, unit identity, alias status, deterministic role/access/datatype
compatibility, source coverage and the completed-linking hard stop.

Exit status is non-zero when any `error` finding is present. `O-G05` — a partial
cluster — is `info` on purpose and never fails a run.

Stage by stage: [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md).

## 11. Write the verification report

Nine items. A delivery missing any of them is incomplete.

1. **The input class** from step 1, named exactly.
2. **The source precedence rank** the geometry came from.
3. **The coverage matrix**, source versus candidate.
4. **Per-type counts, labelled as evidence and not as targets.**
5. **Every cluster added, removed, moved or relinked, with its reason.**
6. **The footprint evidence** behind any centering claim: where measured, at what
   resolution, the scale applied, and which controllers are `UNMEASURED`. If none
   was measured, say **centering was not verified**.
7. **The exact validator commands run, and their output** — including the
   declared `--patch-scope` for a patch.
8. **The render inspected, and what was checked in it.**
9. **Every evidence gap, stated as a gap** — separated from what was verified.

For linking work, include the full binding-verification matrix, parameter-source
filename, exact source coverage, separate structurally-linked/source-resolved/
semantically-verified/unresolved counts, and every unresolved controller/role.

> **A clean validator run is a necessary condition, never a sufficient one.** The
> nine-cluster reconstruction that triggered this documentation passes a bare
> `--check`: valid structure, real background, correct object types, clean
> bindings, no overlaps — and more than half the store missing. Structure is what
> a script can see; whether the panel is *the store* is what the matrix, the
> render and a reviewer are for.

## Failure catalogue

Each of these has a fixture in `build-oversikt-negatives.py` and a test that
asserts the validator catches it.

| Failure | What it looks like | Caught by |
|---|---|---|
| **Dashboard regrouping** | The same objects arranged in tidy blocks or a legend. Bindings perfect, spatial meaning gone. | `O-G06`, `O-C06` |
| **Reduced reconstruction** | 9 clusters rebuilt from a PDF where the source had 21. *Looks right.* | `O-C03`, `O-C01` |
| **Cluster out of room** | One cluster anchored on the wrong case, or on empty floor. | `O-C06` |
| **Duplicated cluster** | The same controller placed twice — the panel now shows two cases that are one. | `O-G04`, `O-C05` |
| **Stripped links** | Layout corrected, bindings blanked. The JSON still looks fine. | `O-C07`, `O-C08`, `O-C03` |
| **Missing background** | Objects preserved, artwork dropped. Every coordinate now means nothing. | `O-S07`, `O-C13` |
| **Forced four objects** | A 2-member cluster padded with cooling and defrost symbols bound to parameters the controller does not expose. | `O-C05`, `O-P04` |
| **Cluster torn apart** | Members left behind when the cluster moved. Reads as two positions. | `O-G03` |
| **Object substituted** | A purpose-built symbol replaced by a generic value pill. | `O-C09` |
| **Structurally linked, source-unresolved** | `linked:"true"` plus non-empty ids, but no exact parameter-source row. Looks complete; validity unproved. | `O-B03`, `O-B08` with `--parameters` |
| **Invented/transformed binding** | A driver id constructed, prefix-edited, AK2→AK3 converted or suffix-matched rather than copied. Looks linked; reads nothing or the wrong parameter. | `O-B03`; `O-B04` if it resolves under the wrong unit; `O-P07` remains only a profile warning |
| **Wrong semantic role** | Exact row exists, but an alarm object points at defrost/cooling/value or access/datatype is incompatible. | `O-B05`–`O-B07`, then `O-B08` |
| **Bubble off the box centre** | The cluster is on the right case; the temperature object sits a few tens of pixels off its centre because it was built around a label or a cluster anchor. Every binding correct. | `O-G08` — **only with `--footprints`**. Otherwise a render and a reviewer |
| **Centred on the label** | The value object centred on the equipment's caption in the artwork, which is drawn offset from the equipment. | `O-G08` if the footprint is measured; otherwise nothing |
| **Forced 42×22** | A supplied panel's value objects silently resized to the size the documentation quotes. | `O-C10`, and `O-C16` under a declared patch scope |
| **Unscaled measurement** | Coordinates read off a 1868×1000 background and written straight onto a 1400×750 canvas. | `O-G10` if the resolution is recorded; otherwise nothing |
| **Patch that patched more** | A centering correction that also nudged an alarm, rewrote an alias, or reordered the array. | `O-C16` with `--patch-scope value-position` |
| **Guessed footprint** | A coordinate emitted for equipment whose box could not be measured — the gap filled in by inference. | Nothing. This is why "no footprint, no coordinate" is a rule and not a preference |
