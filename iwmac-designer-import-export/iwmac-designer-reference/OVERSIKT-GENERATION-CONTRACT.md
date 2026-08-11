# Oversikt generation contract (store overview / case positions / byggeplan)

> The single owner of the Oversikt rules. It answers **where** an object goes,
> **which controller** it belongs to, **what a cluster is**, **how a supplied
> production panel is edited**, and **how the result is verified**.
>
> Search terms that name this panel type: `Oversikt`, `store overview`,
> `case-position`, `byggeplan`, `disk`, `display case`, `cabinet`, `cold room`,
> `freeze room`, `controller cluster`, `alarm`, `temperature`, `cooling`,
> `defrost`.
>
> **Not this panel type:** the navigation-hub *Oversikt* of a hotel panel set
> (icon tiles + captions, `CLAUDE.md` §17b). It shares only the name.

## Routing — which file owns which question

| Question | File | Kind |
|---|---|---|
| A coordinate, a role, a z-band, a cluster rule, an anomaly — each with its evidence id and scope tag | **this file** | normative |
| The step-by-step procedure for building or repairing one | [OVERSIKT-AUTHORING-GUIDE.md](OVERSIKT-AUTHORING-GUIDE.md) | procedural |
| The acceptance tests, stage by stage | [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md) | procedural |
| A block to paste into Copilot, or upload as a knowledge file | [OVERSIKT-COPILOT-PREFLIGHT.md](OVERSIKT-COPILOT-PREFLIGHT.md) | derived |
| The same rules as data | [documentation-rules.json](documentation-rules.json) → `panel_types.oversikt` | generated |
| The same rules as an executable check | [validate-oversikt-panel.py](validate-oversikt-panel.py) | executable |
| The file to copy | [reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json) | measured |
| Host behaviour — insert, rename, background pipeline, `linked` | [CLAUDE.md](CLAUDE.md) | normative |
| Fleet context — how many Oversikt panels exist and what sizes | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) | descriptive |
| Which `obj_id` renders what | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) | measured |

**There is one live owner per rule.** Where another file states an Oversikt
geometry, cluster or coverage rule that disagrees with this one, this file wins
and the disagreement is recorded in §12 rather than averaged away.

## How to read this file

### Source precedence — normative

Shared with the ventilation, list-panel and Maskin contracts; the machine-
readable copy is `documentation-rules.json` → `source_precedence`. This file
does not define a second one.

| Rank | Source |
|---|---|
| 1 | A panel JSON or screenshot supplied with the current task |
| 2 | A production export of the same panel and system type |
| 3 | The measured geometry contract for the panel type, scope-tagged — **this file** for an Oversikt |
| 4 | Panel-specific rules in [CLAUDE.md](CLAUDE.md) |
| 5 | [AI-BRIEFING.txt](AI-BRIEFING.txt) |
| 6 | [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md) |
| 7 | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| 8 | Generic visual-design advice |

Three rules govern the table:

- **Never average conflicting coordinates.** Take the value from the highest-
  ranked source that has one.
- **A scoped profile under `profiles.*` sits at rank 3** alongside this file and
  applies only inside its own scope. It never overrides a supplied export.
- **When evidence is missing, mark the gap and stop.** Do not invent a
  coordinate, `obj_id`, driver id, unit id, parameter alias or navigation target.

The catalogue is rank 7 on purpose. It proves an `obj_id` exists; it does not
prove the panel you are building uses it. Passing the id-exists check is the one
check an agent always remembers to run and the one that proves the least.

**A PDF is not rank 1 or 2.** A store-layout PDF, a byggeplan drawing or a
screenshot describes the store; it does not describe the panel. Where a supplied
production export and a PDF disagree, the export wins — see §6.

### Scope tags

Every measured rule below carries one.

| Tag | Meaning |
|---|---|
| `GLOBAL` | Applies to every panel type. |
| `OVERSIKT` | Applies to Oversikt / store-overview panels. Confirmed on the plant-10113 export (E14/E15) and the 194-panel drawing survey. |
| `TEMPLATE-10113` | Geometry and cluster inventory of **one** named Oversikt — the plant-10113 store overview. Reproduce it when repairing or copying *that* panel. |
| `ADVISORY` | Judgement, not a measured fact. May be overridden with a stated reason. |

**Do not promote a tag by inference.** A `TEMPLATE-10113` number becomes
`OVERSIKT` only when a second production export shows the same thing.

## 0. Definition, profiles and rule ids

### 0.1 What an Oversikt is

> An Oversikt is the **spatial floor-plan panel**: a drawing of the store, with
> one controller cluster placed **on** each display case, cold room or freezer
> room it monitors.

The background carries the store. The Designer objects carry the live readings.
The information content of the panel is **where each reading sits** — which case
is warm, which room is defrosting, which cabinet is in alarm — and a reader gets
that by looking at the plan, not by reading labels.

> **An Oversikt is a MAP, not a dashboard.** — `OVERSIKT`
>
> Grouping the same objects into tidy cards, rows, columns or a legend destroys
> the only thing the panel type exists to show, **even when every object and
> every binding is otherwise correct**. A panel that lists 21 controllers in a
> grid is not a worse Oversikt; it is a different panel that happens to contain
> the same JSON objects.

This is the whole of the 2026-08-10 incident (§13) in one sentence, and the
validator enforces it as `O-G06`.

### 0.2 The profile registry

| Profile | Panel | Canvas | Objects | Clusters | Evidence |
|---|---|---|---|---|---|
| `TEMPLATE-10113` | Plant-10113 store overview (Coop Prix Breiviken) | 1400×750 | 72 | 21 | E14 → E15 |

A profile is a **named panel**, not a style. `--profile TEMPLATE-10113` asserts
"this document should be that panel"; it is the right check when repairing or
copying 10113 and the wrong check for any other store, where it will report
every one of its own controllers as an unexpected addition.

`documentation-rules.json` → `profiles.TEMPLATE-10113.applies_when` says the
same thing in the data: *it does NOT apply to another store.*

### 0.3 Every cluster is atomic

A **controller cluster** is every dynamic object bound to one case or room
controller, placed together on the physical position that controller serves. It
is the unit an Oversikt is counted in — not the object.

- Place every member of a cluster **or none**.
- Relocate a cluster with **one** translation vector applied to every member.
- A cluster half-moved is worse than a cluster not moved: it reads as two
  positions, and a reader will look for a second case that does not exist.

The validator enforces cohesion as `O-G03` (span limit 160 px) and whole-cluster
movement as `O-C06`.

### 0.4 Validator rule ids

`python validate-oversikt-panel.py` emits every finding with an id. Four
namespaces, matching the Maskin precedent (`M-S*`/`M-G*`/`M-P*`):

| Id | Severity | What it says | Section |
|---|---|---|---|
| `O-S00` | error | No objects at all | §1 |
| `O-S01` | error/warn | Envelope `format`/`version`/`panel` | §1 |
| `O-S02` | error/warn | `counts.*` disagrees with the array lengths | §1 |
| `O-S03` | error/warn | Missing or unknown object fields (the 17) | §1 |
| `O-S04` | error/warn | Duplicate or non-sequential object names | §1 |
| `O-S05` | error | Unparseable or off-canvas geometry | §1 |
| `O-S06` | error/warn | Canvas dimensions | §1 |
| `O-S07` | error/warn | No embedded background / `converted` not `"true"` | §2 |
| `O-S08` | error | `panel.image_svg_trace` was emitted | §2 |
| `O-S09` | error/warn | `linked` disagrees with `driver_id` | §8 |
| `O-S10` | error | `obj_id` is not in the design-object catalogue | §4 |
| `O-S11` | error | Mis-decoded text (mojibake) | §1 |
| `O-S12` | warning | `zIndex` outside the measured bands | §3 |
| `O-G00` | info | The inventory line: objects, clusters, per-role counts | §5 |
| `O-G01` | error | Objects with neither `unit_id` nor a usable `driver_id` | §5 |
| `O-G02` | info | `obj_id`s outside the four cluster roles | §4 |
| `O-G03` | error | A cluster torn apart (span > 160 px) | §0.3 |
| `O-G04` | error | A role appears twice on one controller — duplicated cluster | §5 |
| `O-G05` | **info** | Partial clusters — **legitimate, must not be "fixed"** | §5.3 |
| `O-G06` | error | Clusters on a regular lattice — dashboard/kit shape | §0.1, §12 |
| `O-G07` | warning | Overlapping objects, minus the expected pairs | §9 |
| `O-G08` | error/warn/**info** | The value object is not centred on the measured equipment footprint. **Info, and the only finding, when `--footprints` is absent: centering was not checked.** | §7.1b |
| `O-G09` | error/warn/info | The footprint sidecar itself: format, duplicates, unknown controllers, unmeasured controllers, and a sidecar that declares itself synthetic | §7.1c |
| `O-G10` | error/info | The footprint's frame of reference: `source_image_size`, `panel_size`, the scale between them | §7.1c |
| `O-P00` | error | Unknown profile, or a profile of another panel type | §0.2 |
| `O-P01` | error | Canvas differs from the profile | §0.2 |
| `O-P02` | error | Object count differs from the profile | §0.2 |
| `O-P03` | error | Controllers missing from / extra to the profile | §0.2 |
| `O-P04` | error | A controller's coverage differs from the profile | §5 |
| `O-P05` | error | An object's `obj_id` differs from the profile | §4 |
| `O-P06` | error | An object's geometry differs from the profile | §7 |
| `O-P07` | warning | An unfamiliar `alias_text` on a known template | §8 |
| `O-P08` | error/warn | The embedded background is not the profile's artwork | §2 |
| `O-C00` | info | The compare header: objects and clusters on both sides | §6 |
| `O-C01` | error | Source objects absent from the candidate | §6 |
| `O-C02` | warning | Candidate objects with no source counterpart | §6 |
| `O-C03` | error | **Source controller clusters missing entirely** | §6 |
| `O-C04` | error | Controllers that exist only in the candidate | §6 |
| `O-C05` | error | A controller's coverage changed | §5.3, §6 |
| `O-C06` | error/warn | A cluster moved (> 20 px) or nudged | §7 |
| `O-C07` | error | Objects lost their driver binding | §8 |
| `O-C08` | error | Binding changes (`driver_id` or `unit_id`) | §8 |
| `O-C09` | error | An object changed type — a retype, not a drop plus an add | §4 |
| `O-C10` | warning | Objects resized | §7 |
| `O-C11` | warning | Objects changed `zIndex` | §3 |
| `O-C12` | warning | Array order changed | §1 |
| `O-C13` | error | The embedded background was dropped or replaced | §2 |
| `O-C14` | warning | `org_image_name` / `converted` changed | §2 |
| `O-C15` | error | The canvas changed size | §1 |
| `O-C16` | error/info | A declared `--patch-scope` was exceeded — a field changed that the stated patch does not permit | §6.2 |

Only `error` findings drive the exit status. `O-G05` is deliberately `info`: a
partial cluster is production-correct, and a validator that scolds an author for
it teaches exactly the wrong lesson (§5.3).

`O-G08` is the other deliberate severity. Without `--footprints` it is a single
`info` line saying the run proved **nothing** about centering. Silence would be
read as a pass, and "the temperature bubbles are on the boxes" is exactly the
claim a structural run has no way to make — the panel does not contain the boxes.

```bash
python validate-oversikt-panel.py PANEL.json --profile TEMPLATE-10113
```

```bash
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json
```

```bash
python validate-oversikt-panel.py --compare SOURCE.json PATCHED.json --patch-scope value-position
```

```bash
python build-oversikt-footprints.py PANEL.json -o FOOTPRINTS.json
```

```bash
python validate-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json
```

```bash
python render-oversikt-panel.py PANEL.json --source SOURCE.json --footprints FOOTPRINTS.json
```

## Evidence base

| Id | What | Committed |
|---|---|---|
| **E14** | `Coop_Prix_Breiviken_complete_disks.json` — the production export supplied with the 2026-08-10 task. Plant 10113, 72 objects, 21 clusters. | no — live plant id and 72 real driver ids |
| **E15** | [reference_data/oversikt-10113-sanitized.json](reference_data/oversikt-10113-sanitized.json) — E14 with the plant number masked to `NNNNN` and the plant/author/background-filename fields blanked. Nothing else touched. | **yes** |
| **E16** | `Coop_Prix_Breiviken_overview.json` (10 624 bytes, no background, dashboard grouping) and `..._v2.json` (54 227 bytes, 9 of 21 clusters). The two failed attempts. | no |
| **E17** | [build-oversikt-negatives.py](build-oversikt-negatives.py) — seven synthetic negatives derived from E15, one broken rule each. | generator yes, output no |
| **E22** | `iwmac-panel_10240_oversikt_20260811-1308.json` — a second production Oversikt export, supplied with the 2026-08-11 centering correction. Plant 10240, 128 objects, 32 clusters, all four roles on all 32, 1400×750, value 42×22, `zIndex` 110/375. | no — live plant id and 128 real driver ids |

**E22 is deliberately not committed and deliberately not made into a profile.**
A second masked reference panel would be a second `TEMPLATE-*` profile, and two
profiles is the shape that invites averaging one store's coordinates against
another's — which `OV-C1` exists to forbid. What E22 contributes is one
relationship that holds across both stores, not a coordinate: see §7.2 and
`OV-C4`.

E15 is E14 minus the plant identity: **same 72 objects, same 21 clusters, same
geometry, sizes, `zIndex`, `tag_text`, `alias_text`, `unit_id`, array order and
byte-identical `image_data`.** Everything measured below is measured on it, and
`build-oversikt-rules.py --check` fails the test suite if the file and the rules
JSON ever drift apart.

E17's `forced_four_object` negative deliberately contains driver ids naming
parameters those controllers do not expose. **Never copy an object out of it.**

### Mode discriminator — the literal `"driver_id"`

A production export never emits the literal string `"driver_id"`; its unlinked
objects carry an **empty** `driver_id`. Only a generated demo writes the
placeholder. That asymmetry is how a reviewer tells a real export from a
generated one, and it is why E15 is *masked* rather than *unlinked* — see §10.

## 1. Canvas, composition and structure

| Fact | Value | Scope | Evidence |
|---|---|---|---|
| Canvas | **1400 × 750** | `OVERSIKT` | E14, E15 |
| Single objects | 72 | `TEMPLATE-10113` | E14, E15 |
| Containers | 0 | `OVERSIKT` | E14, E15 |
| Graphics | 0 | `OVERSIKT` | E14, E15 |
| Distinct `obj_id`s | 4 | `TEMPLATE-10113` | E15 |
| Controller clusters | 21 | `TEMPLATE-10113` | E15 |
| Cluster shapes | 15 × four-role, 6 × alarm + value | `TEMPLATE-10113` | E15 |

**Match the plant, not the contract**, when a supplied export says otherwise.
1400 × 750 is the standard; 1400 × 755 and 1280 × 1024 both exist in the fleet
([PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md)), and an export that says 1280 × 1024
is right about its own plant. `O-S06` is a warning for this reason; `O-C15` — the
canvas changing *between* a source and its candidate — is an error, because then
every coordinate means something different.

> **72 is not a target and neither is the fleet median.** — `OVERSIKT`
>
> The fleet median is **132 objects across 44 Oversikt panels**. This panel has
> 72. Neither number is a design goal: a store has as many clusters as it has
> cooling positions, and the only correct count for a candidate is the count its
> own source proves. Report counts as evidence; never generate to one.

Structure rules inherited from `global_invariants` — `GLOBAL`:

- Envelope `iwmac-designer-panel` v1, with `panel`, and `counts` equal to the
  array lengths (`O-S01`, `O-S02`).
- Every object carries all **17** fields: `obj_id, name, id, posWidth,
  posHeight, posLeft, posTop, zIndex, tag_text, linked, link_name, link_tag,
  sub_group, driver_id, unit_id, unit_ref, alias_text` (`O-S03`).
- Names are `object_0 … object_N-1`, unique and sequential (`O-S04`). The host
  renames from the canvas child index on insert, so non-sequential names are
  harmless — they simply carry no information, which is why the sequence check
  is a warning and the duplicate check is an error.
- Geometry is integral and on-canvas (`O-S05`). An Oversikt has no legitimate
  overflow; the list panel is the panel type that scrolls, not this one.
- Text is UTF-8. Write `°C`, never `gr C` (`O-S11`).
- **Array order is preserved on an edit** (`O-C12`). Order is how a reviewer
  lines two exports up, and the host's rename-from-index makes order the only
  thing the names encode.

## 2. Background ownership — `OVERSIKT`

> **The background owns the static store. Objects own the live symbols. Nothing
> else.**

| The background carries | Designer objects carry |
|---|---|
| Walls, room outlines, doorways | The alarm bell |
| Cabinet, disk and case boxes | The temperature / value box |
| Aisles, floor, shelving | The cooling symbol |
| Room-name captions, the store title | The defrost symbol |
| Static legends and keys | — |

**Never bake a live value, an alarm colour or a dynamic symbol into the
artwork**, and never draw a temperature box in artwork that an object will also
render. A drawn value is frozen at the moment the picture was made, and nobody
can tell by looking. A drawn box under a real box is a double image at the best
of times and a contradiction at the worst.

**Light skin only.** `ADVISORY`, and the same rule the Maskin contract carries:
never introduce a dark background, not even when the plant's existing panel is
dark. Redraw on the light store plan.

### 2.1 The four background fields — `GLOBAL`

| Field | Meaning |
|---|---|
| `panel.image_data` | The background as a `data:` URI. This is how a raster travels inside an export. |
| `panel.converted` | `"true"` whenever `image_data` is present. The host keys the render path off it. |
| `panel.org_image_name` | The server-side filename the artwork came from. Informational; masked out of a committed reference. |
| `panel.image_svg` | An AI-authored **vector** background, validated by `iwdieValidateSvg` and converted by `iwdieSvgToDataUrl` on insert. |

Priority on insert: **a file picked in the dialog > `panel.image_svg` >
`panel.image_data`.**

`panel.image_svg_trace` is **written by export, never by a generator** — it is an
automatic vector trace supplied to an AI as *input*, and `applyImportCore`
deletes it before rendering. Emitting it is a defect (`O-S08`).

> **An Oversikt without a background is not an Oversikt** (`O-S07`, error). The
> panel *is* its store plan: with no artwork, every coordinate below describes
> nothing and no reviewer can tell whether a cluster sits on its case. The first
> failed attempt (E16 v1) had no background at all, which is why nobody could see
> what was wrong with it by looking at the file.

### 2.2 The `TEMPLATE-10113` background fingerprint

`profiles.TEMPLATE-10113.background.image_data_chars` = **48210**. `O-P08` is an
error when the candidate has no background at all and a warning when it has a
different one — because a different plan may be a legitimate re-render, but the
coordinates in the profile were measured against *this* artwork.

### 2.3 Background preservation on an edit

`image_data`, `converted`, `org_image_name`, the canvas dimensions and any
transparency **survive every edit**. A candidate without the source's background
is not the same panel, whatever its objects say (`O-C13`, `O-C14`).

## 3. Z-index bands — `OVERSIKT`

Mode: **explicit bands OR the literal string `"default"` — never mixed in one
panel.** With `"default"`, array order *is* stacking order.

| Band | Count on E15 | `obj_id`s |
|---|---|---|
| `110` | 21 | `number_v3_40px_no_conn_no_tag` |
| `375` | 51 | `V3_R_28px_circular_cooling_nrm`, `V3_R_28px_circular_defrost_nrm`, `V3_R_34px_circular_alarm_nrm` |

> **Conflict — these are NOT the Maskin bands and NOT the Ventilasjon bands.**
> The ventilation list in [CLAUDE.md](CLAUDE.md) reads "110 value/setpoint/json
> boxes … 1100 labels"; Maskin inverts it (pills at 1100, json boxes at 110).
> On an Oversikt the value box is **110** and all three circular symbols are
> **375**, so the symbols draw **over** the value box where they overlap. The
> bands are per panel type. Recorded, not averaged.

`O-S12` warns when an object sits outside these bands or in a band it was not
measured in. It is a warning, not an error: a legend or a label object
legitimately needs a band this panel type has never used.

## 4. Object vocabulary — `TEMPLATE-10113`

Four `obj_id`s, four roles. Spell them exactly as written; an unknown `obj_id`
renders as a broken `undefined`-class box (`O-S10`).

| Role | `obj_id` | Count | Size | Band | Aliases measured on E15 |
|---|---|---|---|---|---|
| alarm | `V3_R_34px_circular_alarm_nrm` | 21 | 34 × 34 | 375 | `--- High t.alarm`, `High temperature alarm` |
| value | `number_v3_40px_no_conn_no_tag` | 21 | 42 × 22 | 110 | `u56 Display air`, `Regulation temperature`, `Actual Temperature Tact` |
| cooling | `V3_R_28px_circular_cooling_nrm` | 15 | 28 × 28 | 375 | `u58 Comp1/LLSV` |
| defrost | `V3_R_28px_circular_defrost_nrm` | 15 | 28 × 28 | 375 | `u60 Def. relay` |

An `obj_id` outside these four is reported as `O-G02` **info**, not an error: a
label, a legend or a sub-page button is legitimate on an Oversikt. It simply
takes no part in coverage, because it belongs to no controller.

> **Substitution is a retype, and the validator names it.** — `GLOBAL`
>
> Swapping a purpose-built symbol for a generic value pill is a real and
> recurring failure — it is what the Maskin audit found. `O-C09` reports it as
> `object_0 V3_R_34px_circular_alarm_nrm -> number_v3_40px_no_conn_no_tag`,
> naming both types, instead of a drop plus an unexplained addition. That is why
> `match_objects` pairs on binding and on exact position, not on `obj_id` alone.

## 5. Controller identity and coverage — `OVERSIKT`

### 5.1 Identity

| Rank | Field | Note |
|---|---|---|
| primary | **`unit_id`** | The controller. `000:011`, `C50`, `U86`. |
| fallback | the first five underscore-separated fields of **`driver_id`** | plant, system, driver family, line, address — the controller, with the parameter tail dropped. Used only where `unit_id` is empty. |
| never | spatial proximity, alias text, array adjacency | — |

**Measured on E15: 21 of 21 clusters resolve from `unit_id` alone**, and the
driver-prefix fallback agrees with `unit_id` on every one of them without
collapsing two controllers into one.

> **Never group by proximity when identity fields are present.** Proximity merges
> two adjacent cases into one cluster and splits one case whose symbols were
> nudged apart — and both failures look plausible on screen. Proximity is a
> **reporting** aid: use it to say *where* a cluster landed, never to decide
> *which* cluster an object belongs to.

An object with neither a `unit_id` nor a usable `driver_id` belongs to no
controller and cannot be inventoried (`O-G01`, error).

### 5.2 Controller families measured on E14

| Prefix | Controller | `unit_id` shape | Objects |
|---|---|---|---|
| `<plant>_AK3_AKC_…` | Danfoss AK-CC case controllers on an AK3 gateway | `NNN:NNN` | 60 of 72 |
| `<plant>_EVDEVO_IJMODBUS_…` | Carel EVD Evolution driver | `CNN` | 6 of 72 |
| `<plant>_SLV_SLV_…` | a third controller family | `UNN` | 6 of 72 |

Recorded as measured. **Do not infer a controller family from a store's name,
and do not assume a store has only one.** This store has three.

### 5.3 Coverage — and why four is not a rule

> **A cluster is NOT required to have four members.** — `OVERSIKT`
>
> On E15, 15 clusters carry all four roles and **6 carry alarm + value only** —
> because those controllers expose no cooling or defrost relay to read. Coverage
> is derived from the **source**, never forced to four. Adding a cooling or
> defrost symbol to a two-member cluster **invents a binding**: it produces an
> object that renders a symbol and reads a parameter that does not exist.

The six partial clusters on E15 are `C50`, `C51`, `C52`, `U86`, `U87`, `U88` —
the Carel and SLV controllers. The validator reports them as `O-G05` **info**,
and `tests/test_oversikt_10113_contract.py` asserts that they are reported *as
info and never as an error*: it is the rule that must not fire.

The counter-check is `O-C05`, an error, whose message ends *"four objects per
controller is not a rule"*. It fires in both directions — a candidate that drops
a role and a candidate that pads one.

### 5.4 The coverage matrix

Before editing or emitting an Oversikt, build the matrix. One row per
controller:

| controller | alarm | value | cooling | defrost | label | source coordinate | background target |
|---|---|---|---|---|---|---|---|

- It is derived from the **highest-ranked source available**, per the precedence
  table.
- It is completed **before any object is written**.
- Per-type counts are reported and never treated as a quota.

> **Hard stop.** No final panel may be emitted until the cluster inventory is
> complete. If the inventory cannot be completed from the supplied evidence, the
> deliverable is **the inventory plus a named gap**, not a panel.

`O-G00` prints the inventory line on every run — objects, clusters, and per-role
totals — and ends `COUNTS ARE EVIDENCE, NOT TARGETS`.

## 6. Input routing — the decision tree

Read the inputs first, pick **exactly one** row, then **say in the delivery which
row you used**.

| Input | You have | Produce | Must not |
|---|---|---|---|
| **PDF only** | equipment and room names, no coordinates in panel pixel space | an explicitly **unlinked draft**: clusters named from the plan's own labels, no driver ids, no unit ids, and a disclosed list of what the PDF could not supply | present the draft as a finished panel, invent plant/tag/link data, or claim a coordinate the plan does not contain |
| **Screenshot / PNG only** | positions in image pixels, no bindings | an **explicitly unlinked draft** whose geometry is read off the image and scaled to the panel canvas, **with `scale_x`/`scale_y` stated**, and a named list of what the image could not supply | guess a driver id from a rendered value, or present the draft as insert-ready |
| **Background image + equipment list** | artwork and an inventory, no measured coordinates | one cluster per listed position, anchored on the artwork feature that matches its name; unlinked unless bindings were supplied | fall back to a tidy grid when the artwork identifies the positions |
| **PNG + parameter workbook, no panel JSON** | artwork with visible equipment, and controller identities with their parameters | a panel built from both: identities and bindings from the workbook, one cluster per identified equipment item, each **value object centred on the equipment footprint measured on the PNG** (§7.1b), with the scale stated and a footprint sidecar emitted alongside | centre on a label or a workbook row order, or emit a coordinate for equipment whose footprint could not be measured |
| **Production JSON supplied** | everything — geometry, ordering, bindings, background | the **entire** supplied document with only the named change applied. **Preserve and patch. Never rebuild.** | emit only the changed objects, re-derive coordinates, renumber objects, or drop a cluster you were not asked to remove |
| **Production JSON + PDF, screenshot or PNG** | an authoritative panel plus a secondary description of it | the supplied JSON, patched only where the secondary source proves a **specific coordinate**, each patch named individually | let the PDF reduce the panel, or rebuild from the image because the image is easier to read than the JSON |
| **Two panel JSON files** | two candidate panels for the same store | a **comparison first** — `--compare` both ways — then a stated choice of one as the base, with the reason | merge geometry from both. A panel is one author's coherent layout; a merge is a third layout nobody drew |
| **Panel JSON + a verbal placement correction** | an authoritative panel and one named change ("the temperature bubble must be in the centre of every box") | the whole document with **only the named change** applied, declared with `--patch-scope` and proven by a field-level diff (§6.2) | apply an unrequested second correction, or treat "like this" as proof of a coordinate. If the correction points at visual evidence you do not have, **name the missing evidence** — the SVG trace and the embedded PNG do not prove a coordinate nobody measured |

### 6.1 The PDF rule — `OVERSIKT`

> A PDF may identify equipment and room names. It may **not** silently override
> or reduce a supplied production export.
>
> **If the PDF shows fewer positions than the JSON contains, the PDF is
> incomplete.** Report the discrepancy; keep the clusters.

A store-layout PDF is a drawing of the shop floor made for some other purpose.
It routinely omits positions that have controllers, shows equipment that was
never instrumented, and carries no panel-pixel coordinates at all. Treating it
as authoritative over an export is how 21 clusters became 9.

### 6.2 Preserve and patch — `GLOBAL`

When a production JSON is supplied it is **the geometric and object-coverage
template**. Start from that document, change the named objects, and emit the
whole thing.

Preserved verbatim:

- `panel.image_data`, `panel.converted`, `panel.org_image_name`,
  `panel.image_name` and the canvas dimensions.
- Every object's `obj_id`, `posLeft`, `posTop`, `posWidth`, `posHeight` and
  `zIndex` — unless that object is the one being moved.
- `driver_id`, `unit_id`, `link_name`, `link_tag`, `sub_group`, `unit_ref` and
  `alias_text` on **every** object.
- Array order, and the `object_N` names that follow it.
- **Known anomalies** — an inverted cluster, a `tag_text` of a single space, a
  duplicated alias. Report them; do not tidy them (§9).

#### The nine steps

1. **Parse the supplied document** and report what it contains — objects,
   clusters, canvas, background, per-role counts. If it does not parse, stop
   here and say so.
2. **Copy it whole.** The patch is applied to a copy of the supplied document,
   never to a document reconstructed from a description of it.
3. **Name the change** in the terms of §7.1a before touching a coordinate: which
   objects, which fields, on which controllers, and why.
4. **Establish the evidence for each new coordinate.** For a centering patch that
   means a measured equipment footprint per controller (§7.1c). No footprint, no
   coordinate — the controller is left exactly as supplied and reported as a gap.
5. **Compute, do not eyeball.** Apply the §7.1b formula with the object's own
   size and the stated scale.
6. **Change only the named fields.** Everything in the preserved list above stays
   byte-identical, including on the objects being moved.
7. **Drop the export-only fields** the host rejects — `panel.image_svg_trace`
   (§2, `O-S08`). This is a host-consistency action, listed separately because it
   is *not* part of the patch and must be disclosed as its own line.
8. **Diff the result against the source** and confirm the differences are exactly
   the declared scope, field by field (below).
9. **Look at it.** Render at native size and inspect the controller-level crops —
   stage C of [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md). Steps 1–8
   prove the patch did what it said; only this one proves it was the right patch.

#### Patch scope — the field-level diff, `O-C16`

"I only fixed the placement" is unfalsifiable by eye across 128 objects, so it is
declared and checked:

```bash
python validate-oversikt-panel.py --compare SOURCE.json PATCHED.json --patch-scope value-position
```

For a **centering patch**, the permitted object-level differences are:

| Objects | Permitted differences |
|---|---|
| temperature/value (`number_v3_40px_no_conn_no_tag`) | `posLeft`, `posTop` — nothing else |
| every other object | **none** |

Everything else — a resized bubble, a rewritten alias, a re-bound driver id, a
nudged alarm, a changed `zIndex`, a reordered array — **fails QA** unless it is
separately disclosed and justified as its own change. It does not travel under a
geometry correction.

| Scope | Permits |
|---|---|
| `value-position` | `posLeft`/`posTop` on value objects only — the centering patch |
| `position` | `posLeft`/`posTop` on any object — a whole cluster moved to a different case, declared as such |
| `none` | nothing: the candidate must be object-identical to the source |

Envelope `exported_at` and `generator` are export-only and are exempt.

### 6.3 What compare mode reports

`--compare SOURCE.json CANDIDATE.json` runs the full `--check` on the candidate
and then diffs it against the source. Objects are paired by **descending
specificity, never by array index**: binding, then position, then alias, then
binding alone, then exact position, then nearest by position. An index-based
diff calls a reordered panel a rewritten one and hides the rewrite in the noise.

| Finding | Meaning |
|---|---|
| `O-C01` | source objects **dropped** |
| `O-C02` | candidate objects **added** with no source counterpart |
| `O-C03` | **source clusters missing entirely** — the headline check |
| `O-C04` | controllers that exist only in the candidate: a binding was invented or an identity rewritten |
| `O-C05` | a controller's coverage changed |
| `O-C06` | a cluster **moved** (> 20 px, error) or **nudged** (≤ 20 px, warning) |
| `O-C07` | bindings **stripped** |
| `O-C08` | bindings **changed** |
| `O-C09` | an object **retyped** |
| `O-C10` / `O-C11` | resized / re-layered |
| `O-C12` | array order changed |
| `O-C13` / `O-C14` | background dropped, replaced, or its metadata changed |
| `O-C15` | canvas resized |

> **What `--check` alone cannot see.** A reduced panel is *well-formed*. Nine
> tidy clusters with correct bindings and a real background pass every structural
> rule, because nothing in the document says how many clusters the store has.
> Only `--compare` (against the source) or `--profile` (against a known template)
> can catch it. This limitation is asserted in the test suite
> (`test_nine_cluster_reconstruction_is_clean_in_plain_check`) so that it stays
> documented rather than quietly regressing.
>
> **Whenever a production export was supplied, run `--compare`.** The bare check
> is for panels that have no source.

## 7. Placement and geometry

### 7.1 The placement rule — `OVERSIKT`

The rule has **two levels**, and until 2026-08-11 this document stated only the
first. Satisfying the first does not satisfy the second.

> **Level 1 — the CLUSTER.** Place each controller cluster on the case, cabinet,
> cold room or freezer room it monitors in the background artwork.
>
> A cluster on empty floor, in a margin, or in a grid of cards is a defect **even
> if its bindings are perfect**.

> **Level 2 — the VALUE OBJECT.** The `number_v3_40px_no_conn_no_tag` object
> itself must sit in the **visual centre of the equipment footprint**, not merely
> somewhere within the cluster that sits near the equipment.
>
> **The temperature bubble must be in the centre of the box.**

`O-C06` measures level 1 against the source: a cluster displaced by more than
20 px is no longer on the case the source placed it on. Below that it is a nudge
and a warning — an author dragging a cluster by a few pixels has not changed
which case it names.

`O-G08` measures level 2, and only against a measured footprint (§7.1c).

> **Why the second level had to be written down.** On 2026-08-11 a generated
> panel was almost correct: every controller had its linked alarm, temperature,
> cooling and defrost objects, and every cluster was near the right equipment.
> The correction was one sentence — *the temperature bubble must be in the centre
> of every box* — and this document could not be used to defend the original
> placement or to derive the corrected one, because "center or anchor **the
> cluster** on the case" is satisfied by a cluster built around a text label a
> few tens of pixels off the equipment centre. Necessary, and not sufficient.

### 7.1a The seven geometry terms — never interchangeable

Most of the ambiguity above is one word doing four jobs. These seven are
distinct, and a sentence that uses one where it means another is a defect in this
document, not a stylistic choice.

| Term | What it is | What it is **not** |
|---|---|---|
| **Equipment footprint** | The rectangle of the physical thing drawn in the artwork — the blue box, the cabinet outline, the display case, the room. Measured on the image. | Not the cluster, not the label, not the aisle around it |
| **Equipment centre** | The geometric centre of that rectangle: `(x + width/2, y + height/2)` | Not the centre of the text, not the centroid of the cluster |
| **Temperature/value anchor** | The top-left of the `number_v3_40px_no_conn_no_tag` object, chosen so the object's own centre lands on the equipment centre | Not the cluster's top-left |
| **Controller-cluster geometry** | The relative arrangement of alarm, value, cooling and defrost within one controller's cluster — the anatomy in §7.2 | Not a placement rule; it says nothing about where the cluster goes |
| **Text-label anchor** | The position of a caption drawn *in the artwork* ("Frys 1", "Kjølerom") | **Never** a placement target. A label is usually offset from the equipment it names |
| **Shared/combined equipment footprint** | One rectangle covering two visually separate sections driven by one regulator — an A/B case — used only where evidence shows the sections share a controller | Not an assumption to make from adjacency |
| **Uncertain/unmeasurable background target** | Artwork where no footprint can be established: no visible box, illegible, ambiguous which case a controller serves | Not a licence to approximate. Report the gap |

### 7.1b Centering the value object — `OVERSIKT`

> Identify the **visible physical footprint** of the equipment the controller
> monitors — box, cabinet, case or room. Centre the value object on that
> footprint, unless a higher-precedence supplied production panel proves another
> position.
>
> **Never** centre the value object on: the equipment text label; the regulator
> name; the cluster bounding box; an approximate or OCR-derived coordinate; empty
> floor beside the equipment.

Given an equipment footprint `(x, y, width, height)` and a value object of size
`(w, h)` in the same coordinate space:

```text
value_left = round_half_up(x + (width  - w) / 2)
value_top  = round_half_up(y + (height - h) / 2)
```

- **`round_half_up`, not Python's `round()`.** `round()` is banker's rounding —
  `round(2.5)` is `2` — which lands one pixel left of centre on every other
  even-width footprint. `validate-oversikt-panel.half_up()` is the reference
  implementation, mirrored in the renderer and the generator, and the three are
  asserted equal in the test suite.
- **`(w, h)` is the object's own proven size.** On E15 and E22 it is 42 × 22, but
  that is a measurement of two stores, not a constant. Never silently force
  `42x22` onto a supplied panel; if a panel uses another size, centre that size.
- **State the scale and apply it.** Footprints are measured on the background
  image; objects live on the panel canvas. `scale_x = panel_width / image_width`,
  `scale_y = panel_height / image_height`. Measure on the image, scale, then
  centre. A coordinate quoted without the resolution it was measured at is not
  evidence.
- **Do not infer a box from a nearby label.** If the only thing visible is a
  caption, there is no footprint — see the last row of §7.1a.
- **Combined A/B sections**: where evidence shows two sections share one
  regulator, the footprint is the **union** of the two, and the value object is
  centred on the union. Where the evidence does not show it, they are two
  footprints or none — adjacency is not evidence.
- **Alarm, cooling and defrost need not occupy the centre.** They are positioned
  relative to the value object (§7.2). Only the value object is centred.
- **Precedence is unchanged.** A supplied production export is rank 1 and
  outranks any measurement. Do **not** "correct" a production anomaly merely
  because it is not geometrically centred, unless the user asks for that change
  or higher-ranked evidence proves it wrong. A footprint record may be marked
  `production_proven` to record such a position without proposing to change it.
- **If the footprint cannot be established, do not emit a coordinate.** Report
  the evidence gap and name what is missing. An omission is reported as a gap; a
  guess is reported as a pass.

### 7.1c Proving it — the footprint sidecar

**A panel JSON contains no equipment-box boundaries.** The artwork is an opaque
base64 PNG, so no amount of parsing answers "is the bubble on the box?". The
validator therefore refuses to claim it: without `--footprints` the only thing
`O-G08` says is that it proved nothing.

Measurements go in an `iwmac-oversikt-footprints` sidecar — the same shape of
evidence input as `validate-romkontroll-panel.py --source-sql`:

```json
{
  "format": "iwmac-oversikt-footprints",
  "version": 1,
  "panel_size": [1400, 750],
  "source": "background-image",
  "source_image_size": [1868, 1000],
  "records": [
    {
      "unit_id": "000:067",
      "source": "background-image",
      "source_image_size": [1868, 1000],
      "panel_size": [1400, 750],
      "footprint": { "left": 0, "top": 0, "width": 0, "height": 0 },
      "value_object_size": [42, 22],
      "expected_value_position": { "left": 0, "top": 0 },
      "evidence_note": ""
    }
  ]
}
```

Header values are the per-record defaults; any record may override them.
`expected_value_position` is optional and is a **cross-check**: if it disagrees
with what the recorded footprint implies, `O-G09` rejects the record rather than
picking one of the two numbers. `production_proven` is optional and downgrades
every centering verdict for that record to `info`.

```bash
python build-oversikt-footprints.py PANEL.json -o FOOTPRINTS.json
```

emits one record per controller with the half the panel proves — the controller
list, each value object's real size, the canvas, and the background's natural
resolution read out of the PNG `IHDR` header — and leaves every footprint `0x0`.
**An unfilled template does not validate**, on purpose: `O-G09` rejects a
zero-width box because it has no centre, so an unmeasured template fails loudly
instead of quietly reporting that nothing is wrong.

`--synthetic` back-derives each footprint from the value object it appears to
verify. It is test instrumentation, it passes `O-G08` by construction, and it is
stamped `"synthetic": true` and `"source": "synthetic-back-derived"` so it can
never be quoted as evidence. The validator reads both stamps: a synthetic sidecar
raises an `O-G09` **warning** and the run's closing line says the centering check
proved nothing, because the cheapest sidecar in the repository to produce is
exactly the one that would otherwise launder instrumentation into a pass. The
renderer marks it the same way.

`render-oversikt-panel.py --footprints` draws the sidecar in amber over the
artwork: the measured box, its centre, and a dashed box where the value object
would sit if it were centred on it. **Check the amber box against the artwork
first** — if it is not around the visible case, the sidecar is wrong, not the
panel.

> **What no script can prove.** That the measured rectangle is the right
> rectangle. Whether the amber box is around the case this controller monitors is
> a question for the artwork and a pair of eyes — stage C of
> [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md). The validator checks
> arithmetic against a measurement; it does not check the measurement.

### 7.2 Cluster anatomy measured on E15 — `TEMPLATE-10113`

Offsets from the cluster's top-left corner:

| Role | Dominant offset | Distribution |
|---|---|---|
| alarm | **(4, 0)** | (4,0) ×19, (5,0) ×1, (3,21) ×1 |
| value | **(0, 35)** | (0,35) ×14, (0,34) ×3, (0,36) ×2, (0,33) ×1, (0,0) ×1 |
| cooling | **(7, 58)** | (7,58) ×15 |
| defrost | **(7, 58)** | (7,58) ×15 |

Cluster bounding boxes — **not** equipment footprints (§7.1a). These are the
extents of the four Designer objects, and they say nothing about the size of the
case underneath:

| Roles | Size | Count |
|---|---|---|
| alarm + value + cooling + defrost | 42 × 86 | 15 |
| alarm + value | 42 × 57 | 5 |
| alarm + value | 42 × 55 | 1 |

> **These are the offsets THIS panel used** — measured, not a construction rule
> for another store, and **never to be averaged with the fleet medians** in
> `reference_data/panel-conventions.json`. See conflict **OV-C1** in §12.

Cooling and defrost share one coordinate on purpose: the host draws whichever
state is active (§9).

#### 7.2a What the second store corroborates — the value object is the anchor

The table above is expressed from the cluster's top-left corner, which is an
artefact of how it was measured. Expressed from the **value object** instead, the
same data says something that survived into a second store:

| Evidence | Store | Alarm, relative to the value object | Coverage |
|---|---|---|---|
| E15 | 10113 | (+4, −35) | 20 of 21 clusters |
| E22 | 10240 | (+5, −35) | **32 of 32 clusters** |

E22 also places cooling and defrost at (+3…+7, +23…+24) from the value object on
all 32 clusters.

> **What generalizes is the ANCHOR RELATIONSHIP, not the pixel offsets.** Two
> independent production panels, drawn for different stores by different authors,
> both hang the alarm, cooling and defrost symbols off the value object's
> position. That is why centring the *value object* on the equipment (§7.1b) is
> the correct construction and centring the *cluster* is not: move the value
> object to the equipment centre and the rest of the cluster follows from it.
>
> The offsets themselves are per-panel measurements. (+4, −35) and (+5, −35) are
> **not** to be averaged into (+4.5, −35), and neither is to be applied to a third
> store. See conflict **OV-C4** in §12.

### 7.3 The cluster inventory of `TEMPLATE-10113`

21 clusters, all resolved from `unit_id`. Positions are the cluster bounding-box
top-left.

| Controller | Members | Roles | Origin | Size |
|---|---|---|---|---|
| `000:001` | 4 | A V C D | (634, 616) | 42 × 86 |
| `000:002` | 4 | A V C D | (560, 615) | 42 × 86 |
| `000:010` | 4 | A V C D | (917, 221) | 42 × 86 |
| `000:011` | 4 | A V C D | (917, 113) | 42 × 86 |
| `000:012` | 4 | A V C D | (841, 41) | 42 × 86 |
| `000:013` | 4 | A V C D | (775, 41) | 42 × 86 |
| `000:014` | 4 | A V C D | (703, 42) | 42 × 86 |
| `000:030` | 4 | A V C D | (295, 116) | 42 × 86 |
| `000:031` | 4 | A V C D | (348, 40) | 42 × 86 |
| `000:032` | 4 | A V C D | (419, 43) | 42 × 86 |
| `000:045` | 4 | A V C D | (888, 416) | 42 × 86 |
| `000:065` | 4 | A V C D | (489, 40) | 42 × 86 |
| `000:066` | 4 | A V C D | (558, 42) | 42 × 86 |
| `000:067` | 4 | A V C D | (631, 42) | 42 × 86 |
| `000:085` | 4 | A V C D | (808, 597) | 42 × 86 |
| `C50` | 2 | A V | (722, 124) | 42 × 57 |
| `C51` | 2 | A V | (806, 176) | 42 × 57 |
| `C52` | 2 | A V | (806, 255) | 42 × 57 |
| `U86` | 2 | A V | (405, 470) | 42 × 57 |
| `U87` | 2 | A V | (458, 453) | 42 × 57 |
| `U88` | 2 | A V | (457, 521) | 42 × 55 |

The full per-object list — name, `obj_id`, left, top, width, height, alias — is
`profiles.TEMPLATE-10113.objects` in `documentation-rules.json`, and `O-P05`/
`O-P06` check every entry.

## 8. Linking, bindings and what may never be blanked

### 8.1 The binding fields — `GLOBAL`

| Field | On a production Oversikt |
|---|---|
| `driver_id` | plant-prefixed: `<plant>_AK3_AKC_0_11_1_0_7`. **Copied verbatim, never constructed.** |
| `unit_id` | the controller: `000:011`, `C50`, `U86`. Not plant-prefixed. |
| `linked` | `"true"` whenever `driver_id` is not the literal placeholder — the host sets it on load |
| `alias_text` | the parameter's selector text; what a human relinks by |
| `id`, `link_name` | the host literals `"driver_id"` and `"link_name"` |

`O-S09` reports a `driver_id` with `linked` not `"true"` as an error, and a
`linked:"true"` with no binding as a warning — the latter is legitimate host
behaviour on a real export.

### 8.2 Never blank a binding — `GLOBAL`

> **A layout correction never clears `driver_id`, `unit_id` or `alias_text`.**
>
> Blanking a real binding turns a working object into one that renders and reads
> nothing, and **the failure is invisible in the JSON** — the object is still
> there, still the right type, still in the right place. Strip bindings **only**
> when the task explicitly asks for a reusable, unlinked reference.

`O-C07` catches it: *"N object(s) lost their driver binding … the objects still
render and read nothing, and the JSON looks fine"*.

### 8.3 Never invent one

An invented driver id looks linked and is not. Driver ids come from the plant's
own parameter dump (`reference_data/driver-parameters-sample.sql`), and the group
digits differ per driver type. **Copy verbatim; never construct.**

`O-P07` is the early warning on a known template: an `alias_text` that this
template's objects have never carried is the shape an invented binding takes.

## 9. Anomalies — recorded, not corrected — `TEMPLATE-10113`

Four production facts a naive validator would misreport, and a naive author would
"fix".

### 9.1 Fifteen coincident cooling/defrost pairs — deliberate

15 coordinate pairs carry two coincident objects; in every case the pair is
cooling + defrost **on one controller**. The two 28 × 28 symbols share one
position and the host renders whichever state is active.

> An overlap check that reports these is reporting noise, and noise is how a real
> overlap gets ignored. A candidate that *separates* them has changed the panel.

`check_overlaps` skips a same-controller `{cooling, defrost}` pair, and skips any
overlap thinner than `HAIRLINE = 2` px — symbols stacked vertically in a cluster
routinely abut by a pixel, because the cluster was laid out by dragging.

Positions: (302,174) (355,98) (426,101) (496,98) (565,100) (567,673) (638,100)
(641,674) (710,100) (782,99) (815,655) (848,99) (895,474) (924,171) (924,279).

### 9.2 Two genuine cross-controller overlaps

| Objects | Controllers | Roles | Overlap |
|---|---|---|---|
| `object_13` / `object_61` | `000:014` / `C50` | cooling / alarm | 12 × 4 px |
| `object_15` / `object_61` | `000:014` / `C50` | defrost / alarm | 12 × 4 px |

Preserved verbatim. Two cases stand close enough on the plan that their symbols
clip; the store, not the panel, decides that. **Reported as a warning, never
silently corrected** — moving one of them moves a cluster off its case.

### 9.3 The inverted `U88` cluster

On `U88` the alarm bell sits **below** the value box (alarm y = 542, value
y = 521). The artwork under it is what decides. **Do not normalise it away when
copying this panel.**

### 9.4 Twenty-one single-space `tag_text` values

21 objects carry a `tag_text` of a single space, not an empty string. Preserved
verbatim; do not normalise. (The Maskin export carries three of the same.)

## 10. Sanitization for a reusable reference — `OVERSIKT`

Profile: **masked production reference**, exactly as
`reference_data/real-vent-panel-example.json` is.

> **Why not the unlinked demo contract.** The global unlinked demo contract
> (`global_invariants.unlinked_demo_contract`, used by `TEMPLATE-10229`) blanks
> `unit_id` and `driver_id`. On an Oversikt that **deletes controller identity**
> — which *is* the structure the reference exists to carry. A blanked Oversikt
> has no clusters, so it cannot demonstrate a single rule in this file.

| Mask | To |
|---|---|
| `driver_id` | the leading plant field only, replaced with `NNNNN` |
| `envelope.source_plant_id` | `""` |
| `panel.plant_id` | `""` |
| `panel.saved_by` | `""` |
| `panel.org_image_name` | `""` |
| `panel.image_name` | `""` |

| Preserve | Why |
|---|---|
| `unit_id` | a bus address with no plant behind it binds to nothing |
| `linked`, `link_name`, `link_tag`, `sub_group`, `unit_ref` | host literals |
| `alias_text` | what a human relinks by |
| all geometry, `zIndex`, `tag_text`, array order and `image_data` | the reference |

| Drop | Why |
|---|---|
| `panel.image_svg_trace` | export-only AI input; the host deletes it on insert |

Owner: [build-oversikt-fixture.py](build-oversikt-fixture.py). Re-run it, do not
hand-edit the fixture.

## 11. Verification report format

Nine items. A delivery missing any of them is incomplete.

1. **The input class** from §6, named exactly.
2. **The source precedence rank** worked from.
3. **The controller coverage matrix**, source versus candidate.
4. **Per-type counts, labelled as evidence and not as targets.**
5. **Every cluster added, removed, moved or relinked, with its reason.**
6. **The footprint evidence** (§7.1c) — who measured each equipment footprint and
   from what, at which image resolution, with `scale_x`/`scale_y` stated; which
   controllers are unmeasured; and, if any value object moved, its before and
   after position. **With no footprints, say that centering was not verified.**
7. **The exact validator commands run and their output** — including the declared
   `--patch-scope` on a patch and the `--footprints` run on any centering claim.
8. **The render inspected, and what was checked in it** — for a centering job,
   the controller-level crops, not only the whole panel.
9. **Every evidence gap, stated as a gap.**

```bash
python validate-oversikt-panel.py PANEL.json --profile TEMPLATE-10113
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json
python validate-oversikt-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope value-position
python validate-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json
python render-oversikt-panel.py PANEL.json --footprints FOOTPRINTS.json
```

Stage by stage: [OVERSIKT-QA-CHECKLIST.md](OVERSIKT-QA-CHECKLIST.md).

## 12. Conflict decisions on record

Three places where another file in this repository says something different.
Recorded and scoped; **not averaged.**

### OV-C1 — case-cluster member offsets

| | Source | Claim | Scope |
|---|---|---|---|
| A | `reference_data/panel-conventions.json` → `the_case_cluster` | alarm (dx 12, dy 0), temp box (dx 7, dy 22), cooling (dx 10, dy 35), defrost (dx 28, dy 38), footprint ~62 × 66 | fleet median over 28 clusters mined from 16 stores |
| B | E15, measured | alarm (4, 0), value (0, 35), cooling (7, 58), defrost (7, 58), footprint 42 × 86 | `TEMPLATE-10113` |

**Resolution.** Both are recorded; neither is averaged. The fleet figure is a
median across stores and is **not the geometry of any one panel** — in particular
it separates cooling and defrost, which on E15 are exactly coincident. When a
production export is supplied, its own offsets win. The fleet figure is for a
store with no export.

### OV-C2 — cluster placement

| | Source | Claim | Scope |
|---|---|---|---|
| A | `panel-conventions.json` → `ai_implications`, and `AI-BRIEFING.txt` §7b MODE B | emit one case cluster per cooling position laid out in a neat grid, 90 px column pitch, 90 px row pitch | **CLUSTER KIT only** — a tray of parts the human then drags |
| B | this file | every cluster is anchored on the physical case or room it monitors; a grid of cards is a defect | `OVERSIKT` — any panel presented as finished |

**Resolution.** Scoped, not merged. The 90 px grid is legitimate for the CLUSTER
KIT deliverable and only there, **and a kit must be labelled a kit.** A panel
delivered as an Oversikt is spatial. This is the exact confusion behind the
2026-08-10 incident, and `O-G06` is the check that separates the two.

### OV-C3 — the partial cluster

| | Source | Claim | Scope |
|---|---|---|---|
| A | `panel-conventions.json` → `the_case_cluster` | 11 occurrences of a 3-member variant without the cooling symbol | fleet |
| B | E15, measured | 6 occurrences of a 2-member variant: alarm + value only | `TEMPLATE-10113` |

**Resolution.** Both are real and neither generalizes. The rule that *does*
generalize is the one both support: **cluster membership is whatever the
controller exposes, and is read from the source rather than assumed.**

### OV-C4 — what the value object is positioned against

| | Source | Claim | Scope |
|---|---|---|---|
| A | E15 and E22, measured | The cluster's symbols are positioned **relative to the value object** — alarm at (+4, −35) on 10113, (+5, −35) on 10240 | per panel; the *relationship* holds on both |
| B | §7.1b, the construction rule | The value object is positioned **relative to the equipment footprint** — centred on the box in the artwork | `OVERSIKT` |

**Resolution.** These are not in conflict; they are two links in one chain, and
they were conflated before 2026-08-11. The equipment footprint fixes the value
object; the value object fixes the rest of the cluster. Read in the wrong order
they produce the original defect: a cluster assembled around a label anchor, with
correct internal anatomy, sitting off the centre of its box.

**Scoped, not merged.** (+4, −35) and (+5, −35) are two measurements of two
stores. Do not average them, do not apply either to a third store, and do not
"correct" E15's anatomy to match E22's. Above all, neither may be collapsed back
into "centre the cluster" — that sentence is what this conflict exists to
prevent.

## 13. The incident — what went wrong on 2026-08-10

### 13.1 What happened

A store-layout PDF was supplied alongside a production panel export (E14).

- **Attempt 1** (E16 v1, 10 624 bytes, no embedded background) read the PDF and
  produced a **dashboard-like grouping** — the readings arranged into blocks,
  not a floor plan. The spatial information, which is the entire content of the
  panel type, was gone.
- **Attempt 2** (E16 v2, 54 227 bytes, 1400 × 750, background embedded) imitated
  the *appearance* of the production panel and rebuilt **9 of the 21 controller
  clusters**, some of them off their positions.
- The supplied production JSON actually held **72 objects in 21 controller
  clusters**: 21 alarm, 21 temperature, 15 cooling, 15 defrost.

Attempt 2 is the dangerous one. It looks right. It has the background, the
canvas, the correct object vocabulary and clean bindings — and it silently omits
**12 controllers**, more than half the store.

### 13.2 Root cause

Four failures, each independently sufficient:

1. **The PDF was treated as authoritative over the supplied export.** A PDF
   describes the store; only the export describes the panel. §6.1.
2. **The panel was rebuilt instead of patched.** With a production JSON in hand,
   the correct operation was preserve-and-patch: take the whole document, change
   the named objects, emit all 72. §6.2.
3. **No cluster inventory was built before writing objects.** Nothing in the
   process would have noticed 12 missing controllers, because nothing had ever
   counted them. §5.4.
4. **Coverage was assumed rather than derived.** "Four objects per controller"
   is not a rule, and neither is "one cluster per thing I can see on the plan".
   §5.3.

### 13.3 The correct recovery

**Preserve the supplied production JSON** — background, coordinates, ordering,
links, unit ids, driver ids, aliases, z-indexes, all 21 clusters — and apply only
the change that was actually requested. Not a reduced approximation rebuilt from
a drawing.

### 13.4 The controls that now exist

| Control | Catches |
|---|---|
| `O-C03` in compare mode | *"12 of 21 source controller cluster(s) are missing entirely: 000:001, 000:002, 000:010, 000:066, 000:067, 000:085, C50, C51, C52, U86, U87, U88"* |
| `O-C01` | the 36 dropped objects behind those clusters |
| `O-G06` | the dashboard/lattice shape of attempt 1 |
| `O-S07` | attempt 1's missing background |
| `O-C13` | a background dropped during an edit |
| `O-C07` | bindings blanked during a "layout correction" |
| `O-C05` | a partial cluster padded to four with invented bindings |
| `O-G05` as **info** | stops the *opposite* error — an author "repairing" a legitimate 2-member cluster |
| `--profile TEMPLATE-10113` | all of the above for this named panel, with no source file to hand |

Seven negative fixtures reproduce the failure shapes without customer data
(E17), and `tests/test_oversikt_10113_contract.py` asserts each one fails on the
rule it was built to break — and that the fixture itself passes clean.

### 13.5 The second incident — 2026-08-11, the centering correction

A different store, a different failure mode, and a much smaller one — which is
why it is worth recording.

**What happened.** A store-layout PNG and a plant parameter workbook produced a
panel; later a panel JSON was supplied needing a layout correction. The generated
panel was **almost correct**: every controller carried its linked alarm,
temperature, cooling and defrost objects, and every cluster was near the right
equipment. The objects had been built around **approximate label or cluster
anchors**. The correction was one sentence:

> The temperature bubble must be in the center of every box.

**Root cause — a documentation ambiguity, not a generation bug.** §7.1 said
*"center or anchor each cluster on the case, cabinet or room it monitors"*. That
is satisfied by a cluster assembled around a caption a few tens of pixels off the
equipment centre. The document had no word for the equipment footprint as
distinct from the cluster's own bounding box, no word for the label anchor as
distinct from the equipment centre, and no statement that the **value object
specifically** is the thing that must be centred. Every failure was inside the
range the wording permitted.

**What was insufficient.** Centring the *cluster* near the equipment. The
`number_v3_40px_no_conn_no_tag` object itself had to be centred on the visible
equipment box. The relevant centre is the physical blue box or the combined case
footprint — never the nearby text label. Alarm, cooling and defrost need not
occupy the box centre; they follow the value object (§7.2a).

**The patch that was correct.** Only the temperature objects' `posLeft`/`posTop`
changed. Bindings, unit ids, aliases, object ids, dimensions, z-indexes, object
names, array order, background fields and all unrelated geometry were unchanged,
and the export-only `panel.image_svg_trace` was dropped from the insert-ready
result (§2). Verified by parsing, by a source-to-candidate field diff, and by
visual inspection of controller-level crops.

**What this incident is not.** It is not evidence about coordinates for any other
plant. Nothing measured on 10240 is a construction rule (E22, `OV-C4`).

| Control now in place | Catches |
|---|---|
| §7.1a, the seven terms | the ambiguity itself — one word doing four jobs |
| §7.1b + `O-G08` | a value object centred on a label, a cluster box, or nothing |
| `O-G09` / `O-G10` | a measurement that is unusable, self-contradicting, or of another panel |
| `O-G08` info when `--footprints` is absent | the validator quietly implying it checked centering when it cannot |
| §6.2 nine steps + `O-C16` | an unrelated change travelling under a geometry correction |
| §6 routing, last three rows | rebuilding from the image, merging two panels, or over-applying a verbal correction |

## 14. Evidence required before delivering

State, in the delivery:

- Which **input class** (§6) the task was, and which **precedence rank** the
  geometry came from.
- Whether a production JSON was supplied and, if so, that the operation was
  **preserve-and-patch** — with the declared `--patch-scope` and its clean
  `O-C16` line.
- The **coverage matrix**, and for a patch, source-versus-candidate.
- For any claim about value centering: **the footprint evidence** — where the
  footprints were measured, at what resolution, with `scale_x`/`scale_y` stated,
  and which controllers have no measurement. If no footprints were measured, say
  that centering was **not verified**; do not let a clean structural run stand in
  for it.
- The **validator commands** and their output — including a clean compare run
  when a source existed.
- Every **evidence gap**, named. A PDF-only draft is delivered *as a draft*, with
  its missing evidence disclosed.

> **A clean validator run is a necessary condition, never a sufficient one.**
> The nine-cluster reconstruction passes a bare `--check`. It has valid
> structure, a real background, correct object types, clean bindings and no
> overlaps — and it is missing more than half the store. Structure is what a
> script can see; whether the panel is *the store* is what a reviewer and a
> render are for.

## 15. Evidence still missing

Nine open items. Each says what would settle it. **A stated gap is a
deliverable; a guess is not** — nothing below is filled in by inference.

| # | Gap | What would settle it |
|---|---|---|
| 1 | **Partly settled 2026-08-11, and still open.** Every `TEMPLATE-10113` number — the 42 × 86 cluster extent, the coincident cooling/defrost pair, the 110/375 bands, the 21 single-space `tag_text` values — is still measured on E14 alone. E22 (plant 10240, 128 objects, 32 clusters) is the second export that item asked for, and it confirms four things independently: the 42 × 22 value size, the 110/375 bands, all four roles on all 32 clusters, and the symbols-positioned-relative-to-the-value-object relationship (`OV-C4`). It confirms **no coordinate**, because a coordinate is a property of a store. | A second export that may be **committed** — E22 carries a live plant id and 128 real driver ids and is deliberately not masked into a second profile (§ "Evidence base"), because two `TEMPLATE-*` profiles is the shape that invites averaging. Until then every coordinate stays `TEMPLATE-10113`. |
| 2 | **The fleet survey cannot be re-derived here.** `reference_data/panel-conventions.json` reports a median over 28 clusters mined from 16 stores, but those exports are not in the repository, so `OV-C1` and `OV-C3` are recorded from its summary rather than re-measured. | The survey's source exports, or a re-run that keeps per-store offsets instead of a median. |
| 3 | **Navigation is unobserved.** All 72 objects carry the placeholder `link_name` `"link_name"` with empty `link_tag`, `sub_group` and `unit_ref`. Nothing shows whether a case cluster ever links through to a detail panel, as the hotel navigation hub does. | An Oversikt export containing a navigation object. |
| 4 | **Why six clusters carry only two roles.** The 15 four-role clusters are all `000:NNN` addresses; the 6 two-role clusters are exactly `C50`–`C52` and `U86`–`U88`. Whether the missing cooling and defrost relays are a property of that address family, of those controller models, or of this store's wiring is not established. | The plant's `iw_gen_driver_parameters` dump for those six controllers, or a second store carrying the same address shapes. |
| 5 | **Canvas.** Only 1400 × 750 has been seen for an Oversikt. The house style also names 1280 × 1024 for older plants. | An Oversikt export on any other canvas. |
| 6 | **The two `O-G07` overlaps.** `object_13`/`object_61` and `object_15`/`object_61` are recorded as genuine adjacency — two cases standing close on the plan — on the strength of the artwork alone. | The store's own layout drawing, or the plant's equipment list with positions. |
| 7 | **The 21 single-space `tag_text` values.** One per value box. Whether the Designer writes the space or an author typed it is unknown; the fixture preserves it either way. | Creating a `number_v3_40px_no_conn_no_tag` in the Designer and exporting it unedited. |
| 8 | **The incident's PDF is not retained.** E16's two attempts are named but uncommitted, and the store-layout PDF behind them is not in the repository, so *"the drawing showed fewer positions than the JSON"* comes from the task narrative rather than from evidence that can be re-checked here. | The PDF itself, or a position count taken from it. |
| 9 | **byggeplan as an input class is unmeasured.** No byggeplan-derived Oversikt export exists in this repository; the term is treated as a name for this panel type on the strength of the task brief and the house-style list, not of a measured artifact. | An Oversikt whose author states it was built from a byggeplan, with that drawing. |
