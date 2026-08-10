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
| 8 | Preserve links and background | (part of step 7, verified separately) |
| 9 | Render a preview | an HTML preview with the real background |
| 10 | Validate | validator output, exit status 0 |
| 11 | Write the verification report | the eight-item report |

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
| A screenshot of an existing panel, nothing else | **screenshot-only** | an unlinked draft, geometry scaled from the image |
| A background image plus an equipment list | **background + list** | one cluster per listed position, anchored on the artwork |
| A panel JSON export | **production JSON** | the entire supplied document, patched |
| A panel JSON export **and** a PDF or screenshot | **production JSON + secondary** | the supplied document, patched only where the secondary source proves a difference |

The two questions that decide everything downstream:

1. **Was a panel JSON supplied?** If yes, the operation is **preserve and
   patch**, and every rebuild instinct is wrong. Go to §7a.
2. **Is this an Oversikt at all?** The navigation-hub *Oversikt* of a hotel
   panel set is an icon-tile menu that shares only the name. It is not this panel
   type and none of this applies.

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

The table that gates the whole job. One row per controller, eight columns:

| controller | alarm | value | cooling | defrost | label | source coordinate | background target |
|---|---|---|---|---|---|---|---|
| `000:011` | ✓ | ✓ | ✓ | ✓ | — | (917, 113) | freezer island, top right |
| `C50` | ✓ | ✓ | — | — | — | (722, 124) | wall cabinet, north aisle |

- **Derived from the source**, at the highest precedence rank available.
- **Complete before any object is written.**
- A blank cell is a fact about the controller, not a gap to fill.

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

### 7c. Placement

> **Center or anchor each cluster on the case, cabinet or room it monitors in the
> background artwork.**
>
> A cluster on empty floor, in a margin, or in a grid of cards is a defect **even
> if its bindings are perfect** — the position *is* the information.

The 90 px grid in `panel-conventions.json` and `AI-BRIEFING.txt` MODE B belongs
to the **CLUSTER KIT** deliverable — a tray of parts a human then drags into
place — and only there. **A kit must be labelled a kit, never delivered as a
finished panel.** Contract §12, conflict OV-C2.

## 8. Preserve links and the background

Called out separately because it is the failure that leaves no trace.

> **A layout correction never clears `driver_id`, `unit_id` or `alias_text`.**

Blanking a binding turns a working object into one that renders and reads
nothing — and the JSON still looks fine: the object is there, the right type, in
the right place. Strip bindings **only** when the task explicitly asks for a
reusable, unlinked reference, and then use the sanitization profile in contract
§10 rather than blanking by hand.

The background survives every edit: `image_data`, `converted`, `org_image_name`,
the canvas dimensions and any transparency. An Oversikt without its store plan
is not the same panel, whatever its objects say.

## 9. Render a preview

```bash
python render-oversikt-panel.py PANEL.json -o panel-preview.html
```

With a source to compare against, draw it underneath as dashed ghosts — a
displaced cluster is instantly visible and invisible in a text diff:

```bash
python render-oversikt-panel.py CANDIDATE.json --source SOURCE.json -o panel-preview.html
```

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

**Whenever a production export was supplied, run `--compare`.** The bare check
cannot see a missing cluster: a reduced panel is well-formed, and nothing inside
a document says how many clusters the store has. Only the comparison — or the
named profile, for a known template — can catch it.

Checked: envelope and counts, all 17 fields, unique and sequential names,
catalogue-valid `obj_id`s, geometry on canvas, embedded background, no
`image_svg_trace`, `linked` consistent with `driver_id`, z-bands, controller
inventory, cluster cohesion, duplicate roles, lattice detection, overlaps — and
in compare mode: dropped, added, missing, moved, resized, relinked, reordered
and retyped objects plus background and canvas changes.

Exit status is non-zero when any `error` finding is present. `O-G05` — a partial
cluster — is `info` on purpose and never fails a run.

Stage by stage: [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md).

## 11. Write the verification report

Eight items. A delivery missing any of them is incomplete.

1. **The input class** from step 1, named exactly.
2. **The source precedence rank** the geometry came from.
3. **The coverage matrix**, source versus candidate.
4. **Per-type counts, labelled as evidence and not as targets.**
5. **Every cluster added, removed, moved or relinked, with its reason.**
6. **The exact validator commands run, and their output.**
7. **The render inspected, and what was checked in it.**
8. **Every evidence gap, stated as a gap** — separated from what was verified.

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
| **Invented binding** | A driver id constructed rather than copied. Looks linked; reads nothing. | `O-P07` (on a known template only — otherwise only a human catches it) |
