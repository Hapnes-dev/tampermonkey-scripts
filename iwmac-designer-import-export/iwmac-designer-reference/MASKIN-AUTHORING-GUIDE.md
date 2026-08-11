# Maskin authoring guide

How to produce a Maskin (machine-room / CO₂ booster) panel JSON, step by step.
This file is **procedure**. It does not define geometry, host behaviour or the
output schema — it says in what order to consult them.

| You need | Read |
|---|---|
| A coordinate, a role, a z band, an anomaly | [MASKIN-GENERATION-CONTRACT.md](MASKIN-GENERATION-CONTRACT.md) — **authoritative on any geometric conflict** |
| The envelope and the 17 fields | [AI-BRIEFING.txt](AI-BRIEFING.txt) |
| What the host does on Insert / Export | [CLAUDE.md](CLAUDE.md) |
| Whether an `obj_id` exists | [DESIGN-OBJECT-CATALOG.md](DESIGN-OBJECT-CATALOG.md) |
| How the background artwork is drawn | [reference_data/maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt) |
| Which Danfoss parameter is behind an alias | [reference_data/maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json) |
| How to prove the result is correct | [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) |
| The artwork and compare rules — `M-A01…M-A09`, `M-C01…M-C05` | [MASKIN-GENERATION-CONTRACT.md §16](MASKIN-GENERATION-CONTRACT.md#16-extending-a-compressor-bank--artwork-raster-and-compare-rules) |
| The same rules as data / as code | [documentation-rules.json](documentation-rules.json) · [validate-maskin-panel.py](validate-maskin-panel.py) |

## The procedure

1. **Classify the request** — one of four classes. Say which.
2. **Select the profile** — today there is exactly one, `TEMPLATE-10229`. Say which.
3. **Decide background ownership** before placing a single object.
4. **Place clusters whole**, never a member at a time.
   *Extending an existing bank has its own ordered procedure — §4a.*
5. **Choose objects by role**, never by "a box that shows a number".
6. **Land every pill on a drawn pill.**
7. **Sanitize the bindings** — or preserve them, depending on the class.
8. **Validate structurally** — `validate-maskin-panel.py`, zero errors.
9. **Render at 1400×750 and look at it.** This step is not optional.
10. **Report what you could not verify.**

Steps 8–9 are the [QA checklist](MASKIN-QA-CHECKLIST.md); this file covers 1–7
and 10.

## 1. Classify the request

Most bad Maskin output is a correctly executed answer to the wrong class.

| The user says | Class | You produce |
|---|---|---|
| "make me a Maskin demo", "draw a CO₂ booster panel" | **1 — new unlinked demo** | a full panel document, unlinked-demo contract on every object |
| "copy this machine picture to plant NNNNN" | **2 — linked copy** | a full panel document with the bindings carried over, plant prefix rewritten |
| "add a fourth compressor to this export", "move the receiver values" | **3 — modification of a supplied export** | **the entire supplied document**, with only the named objects changed |
| "here is the new artwork", "the drawing changed" | **4 — background-only patch** | `image_data` / `image_svg` changed, all three counts zero, all three arrays empty |

**Class 3 is the most common and the most often mis-answered.** "Add a fourth
compressor" does not mean "emit four compressor objects" — it means emit the
whole 66-object document with 3 or 4 more objects in it. An answer containing
only the new objects will be inserted onto a populated canvas and land on top of
whatever is already there.

**Class 4 is the only class whose output legitimately has no objects.** If the
canvas already carries its objects and only the drawing changed, say so and emit
the patch. Do not re-emit the objects "to be safe" — Insert appends, so that
duplicates all 66.

If the request does not fit a class — "make it look nicer", "modernise it" — say
what is ambiguous and ask. Do not pick the most ambitious reading.

## 2. Select the profile

A profile is one machine-room configuration with complete measured geometry.

| Profile | Machine | Evidence |
|---|---|---|
| `TEMPLATE-10229` | AK-PC 782A, 3 MT + 3 LT compressors, VSD on C1 only, gas cooler, receiver, heat recovery | [reference_data/maskin-10229-sanitized.json](reference_data/maskin-10229-sanitized.json) |

**One profile exists today.** If the requested machine differs — four
compressors, no heat recovery, a different pack controller — say so explicitly,
state which parts of the profile you are reusing and which you cannot, and mark
the rest as a gap. Do not silently stretch the profile onto a machine it does
not describe.

**A panel supplied with the request outranks the profile** (precedence rank 1).
When the user attaches an export, that export *is* the template: its geometry,
its object vocabulary, its z bands, its ordering, its background. The profile
becomes a cross-check, not a source.

### What you are allowed to clone

| Clone | Do not clone |
|---|---|
| `obj_id`, `posLeft`, `posTop`, `posWidth`, `posHeight` | `driver_id` — outside class 2 |
| `zIndex`, array order | `unit_id`, `unit_ref` |
| `tag_text` — including the three that are `" "` | `plant_id`, `source_plant_id` |
| `alias_text` — **always**; it is the link key | `saved_by` |
| `panel.image_data`, `converted`, canvas size | `org_image_name` when it is plant-prefixed |
| the anomalies (§9 of the contract) | `panel.image_svg_trace` — **never** |

### Object count is not the target

E9 is 66 objects; the 39-panel fleet median is 59. Neither is a quota. Justify
**role coverage** against the selected profile: every compressor has its three
required members, every declared suction group has its eight readouts, the gas
cooler has its control status. A panel with the right 54 roles is better than one
padded to 66 with invented ones.

## 3. Decide background ownership first

**The background owns all artwork. Dynamic objects own live values only.**

This decision comes before geometry because it determines whether the
coordinates in the contract mean anything. Every value pill in
`TEMPLATE-10229` is positioned to land inside a pill **drawn in the
`10229_maskin_030626.png` artwork**. Change the artwork and the coordinates stop
meaning what they meant.

| Class | Background |
|---|---|
| 1 — new demo | author `panel.image_svg` per [maskin-drawing-method.txt](reference_data/maskin-drawing-method.txt), **or** state that the artwork is supplied separately and place nothing until it is |
| 2 — linked copy | carry `panel.image_data` through unchanged |
| 3 — modification | unchanged, byte for byte |
| 4 — background-only | the new artwork, and nothing else changes |

A class-4 patch is inserted with **Background picture only — insert no objects**
ticked in the Insert dialog (userscript v1.10.0). That is what makes the three
empty arrays legal: without the box the import refuses the file as an empty panel
document, and with it the artwork is swapped while every object already on the
canvas keeps its position.

Rules that hold in every class:

- **Never bake a live number, state or colour into the background.**
- **Never draw a value box in artwork that a dynamic object will also render.**
  The drawn pills are empty on purpose.
- **Never emit `panel.image_svg_trace`.** It is what the *export* writes so an AI
  can read the drawing's geometry. `applyImportCore` deletes it on insert. Its
  presence in your output is a defect (`M-S07`).
- **Background colour follows the source, not this document.** Preserve the
  background of a supplied production export unless the user explicitly asks for
  a background change. When you author new artwork, take the background colour
  from the user's requirement, or from the production reference chosen for the
  job. Everything else in this section still binds at any background colour.

**If you author artwork in class 1, the coordinates in the contract do not
transfer.** You are drawing a new picture; the pills must be placed where *your*
pills are. Say that plainly rather than shipping template coordinates over
different artwork — that is exactly the failure documented in §13 of the
contract.

## 4. Place clusters whole

A cluster is an anchor, its members, and their offsets. **Place every member or
none, and relocate with one vector.**

### The compressor cluster

| Member | `obj_id` | Size | z | Required |
|---|---|---|---|---|
| `C<n> <MT\|LT> status` | `V3_akpc_772_781_781A_783_contr` | 81×21 | 360 | **yes** |
| `C<n> <MT\|LT> capacity` | `number_v3_value_only` | 50×20 | 1100 | **yes** |
| `C<n> <MT\|LT> Runtime total` | `number_v3_value_only` | 50×20 | 1100 | **yes** |
| `C<n> <MT\|LT> VSD 1 speed` | `number_v3_value_only` | 50×20 | 1100 | only where the machine has a VSD |

A compressor with a status strip and a capacity pill but no runtime pill is a
defect, even though each object is individually legal (`M-G04`).

**Adding a compressor: clone C3, not C1.** On `TEMPLATE-10229` only C1 carries a
VSD row — C2 and C3 are fixed speed. Cloning C1 imports a VSD row the machine
does not have. Use a measured pitch from the same row (79–82 px horizontally,
−1…+1 px vertically) and **say which pair you took it from**. Do not average the
pitches into a constant; the variation is hand placement, not a grid.

**And check the artwork first.** A new compressor object needs a drawn pill to
land in. If the background has three columns drawn and you are adding a fourth
object column, either the artwork changes too (class 4 alongside class 3) or the
new objects float on empty white. Say which — and then follow **§4a**, which is
the ordered procedure for actually extending the drawing.

### The suction group

Eight required alias stems per group suffix (`MT`, `LT`): `Control status`,
`Running capacity`, `Requested cap.`, `Suction temp. To-`, `Suction ref. To-`,
`Superheat`, `Ss-`, `Sd-` (`M-G06`).

**The MT and LT groups are not mirror images.** Their readouts sit in different
places on the drawing — `Sd` moves (369,313) between them, `Ss` moves (−71,324).
Only the compressor *columns* translate by a near-constant (0,+325). **Never
apply a compressor vector to a suction readout.**

### The heat-recovery cluster

Ten objects, four distinct object families, spanning the top of the canvas and
the right-hand information panel. `Hr enable` lives in the information panel with
the other status strips even though it belongs to the heat-recovery role — role
membership follows the parameter, not the pixel neighbourhood.

### The right-hand status column

Five strips share x ≈ 1169–1171: `u17 Ther Air` (y 58), `--- DI1 Alarm` (86),
`Control status MT` (210), `Control status LT` (238), `Cond. control status`
(267), `Hr enable` (325). Control-status pitch is 28–29 px. Keep the column.

## 4a. Extending a compressor bank — the ordered procedure

The request "add a fixed-speed MT compressor to this machine picture" is **class 3
and class 4 at once**: new objects *and* new artwork. Nine steps, in this order.
The order is the rule — six of the seven documented failures were order failures,
not drawing failures. Rule ids are
[contract §16](MASKIN-GENERATION-CONTRACT.md#16-extending-a-compressor-bank--artwork-raster-and-compare-rules).

**1. Retain the original.** Copy the supplied export and its decoded background
out of the working set before touching either. Every later step may need to
restart from them, and a derivative that has been edited twice is not a source
(`M-A07`).

**2. Name the two deliverables.** Insert **appends**. If the panel will be
inserted onto an empty canvas, deliver the whole document with the new background
in it. If the objects are already on the canvas and only the drawing changed,
deliver a **background-only patch** — zero counts, three empty arrays, ticked
*Background picture only* (§3). Never hand a populated canvas a full document.

**3. Measure the source column.** One named column — the one you are cloning.
On `TEMPLATE-10229` that is **C3, not C1**, because only C1 has a VSD row.
Record, per element: the compressor symbol's bounding box; the discharge branch's
row count, per-row RGBA **and per-row alpha**, and its junction geometry where it
meets the header; the suction branch, measured separately; the status artwork;
the static labels' glyph rendering and offsets; the empty pill rectangles.

**4. Measure the two headers independently** (`M-A03`). The discharge header and
the suction header are not the same thickness on the same drawing. Two
measurements, two numbers, and neither substitutes for the other. A line that is
three rows in the source — two solid and one partial-alpha — is a three-row line
(`M-A04`); reproducing the two visible rows produces a thinner, harder pipe that
does not match what it joins.

**5. Fix one translation vector** (`M-A01`). Take the pitch from one **named**
source pair (C2→C3, say so) and write it down as a single (dx, dy). That one
vector places the compressor symbol, the discharge branch, the suction branch,
the status artwork, the labels, the empty pills **and** the three or four dynamic
objects. The 79–82 px spread recorded in the contract measures what production
drew by hand; it is not permission to use a different number per layer
(conflict **M-7**).

**6. Extend the artwork — before any object exists** (`M-A06`). Composite the
measured column at the vector onto the retained original. Copy each source
pixel's alpha **verbatim**: a mask is binary. Any soft, feathered or
opacity-scaled mask multiplies the source alpha and fades the whole clone at once
— symbol, pipes, labels and pills together — which reads as a rendering problem
rather than as the compositing bug it is (`M-A02`).

**7. Connect the branches** (`M-A05`). Extend both headers so the new branches
meet them, and copy the junction geometry from the source junction rather than
approximating it. Then look at the background **on its own, at native size**,
before placing anything: a gap is invisible once objects sit on top, and a branch
that is correct in isolation is exactly what survives review.

**8. Place the objects.** Same vector, no re-derivation. Required roles are the
compressor cluster of §4: status strip, capacity pill, runtime pill — and a
`VSD 1 speed` pill **only if the side you cloned already has one**. Every new
object carries its alias, grammar `C<n> <MT|LT> <role>` (`M-A08`). If the plant's
parameter behind that alias is unknown — as it is for C4, which
[maskin-akpc-link-map.json](reference_data/maskin-akpc-link-map.json) does not
carry — deliver it **unlinked and report the gap** (`M-A09`). Never invent a
driver id; an invented id looks linked and is not.

**9. Compare, then render.** Against the retained original:

```bash
python validate-maskin-panel.py --compare SOURCE.json CANDIDATE.json --patch-scope compressor-addition
```

Zero errors. That proves nothing about the pixels — `M-C05` compares base64
lengths — so the native-size render of step 7, now with the objects on it, is
still the acceptance test (`MASKIN-QA-CHECKLIST.md` stage C).

**On any visual failure, go back to step 1**, not to step 6. Compensating edits
stacked on a derivative accumulate raster damage that no single edit is
responsible for (`M-A07`).

## 5. Choose objects by role

| Role | `obj_id` | Size | z |
|---|---|---|---|
| a live measurement | `number_v3_value_only` | 50×20 | 1100 |
| a setpoint or reference | `number_v3_white_value_only` | 50×20 | 1100 |
| a compressor's run state | `V3_akpc_772_781_781A_783_contr` | 81×21 | 360 |
| a suction group's control state | `V3_akpc_782A_suct` | 81×21 | 360 |
| the condenser's control state | `V3_akpc_783_781A_782A_cond` | 81×21 | 360 |
| an OK / alarm state | `V3_ok_alarm_nrm` | 61×21 | 375 |
| an enable / disable state | `V3_81x21_enebled_disabled_nrm` | 81×21 | 1000 |
| a valve open indication | `V3_led_13px_circ_grey_green` | 13×13 | 375 |
| a pump run state | `V3_21px_single_pump_grey_green_down` | 21×21 | 375 |

**The setpoint rule** (`M-G03`): `number_v3_white_value_only` is the setpoint
pill and `number_v3_value_only` is the measurement pill. The alias markers that
mean *setpoint* are `reference`, `ref.`, `consumer request` and `ctrl.` — **not
`request`**. `Requested cap. MT`, `Requested cap. LT` and `Cond. requested cap.`
are measurements and correctly use the measurement pill.

**Do not substitute a generic value box for a purpose-built object.** Two objects
on `TEMPLATE-10229` are deliberately not value pills — `Hr pump speed`
(`number_v3_custom_json_obj`, 40×20, z110) sits on a tan drawn pill, and
`u17 Ther Air` (`number_v3_60px_no_conn`, 62×22, z110) sits inside the
information panel. Both substitutes would be legal palette entries and both would
be wrong, because the artwork underneath is different.

**Spell `obj_id` exactly.** `V3_81x21_enebled_disabled_nrm` really does carry
that spelling. Do not normalise it. An id that does not match a palette entry
renders as a broken `undefined`-class box.

**Z bands are per panel type.** On Maskin: 110 json/no-connection, 360 AK-PC
strips, 375 alarm/LED/pump, 1000 enable/disable, 1100 value and setpoint pills.
These are **not** the ventilation bands — CLAUDE.md's list (110 = values,
1100 = labels) is `VENT`-scoped. Using it here puts every pill under the artwork.
Do not mix explicit bands with `"default"` in one panel (`M-S06`).

## 6. Land every pill on a drawn pill

A Maskin value object is meaningless unless it sits inside the empty pill the
artwork drew for it. That is the whole layout contract, and it is the one thing
no validator can check.

- A pill floating on white artwork is a defect, not a stylistic choice.
- A pill overlapping a drawn caption is a defect.
- A pill half on and half off its drawn pill is a defect.
- Two pills sharing one drawn pill is a defect — **unless** the artwork drew two
  adjacent pills, as on the MT suction row.

The only way to check this is to render the panel with the real background and
look at it. [MASKIN-QA-CHECKLIST.md](MASKIN-QA-CHECKLIST.md) stage C is that
step, and [render-maskin-panel.py](render-maskin-panel.py) does it for you.

## 7. Sanitize — or preserve

### Class 1, a new demo — the unlinked contract

```
id           "driver_id"      (the literal string)
driver_id    "driver_id"      (the literal string)
linked       "false"
link_name    ""
link_tag     ""
sub_group    ""
unit_id      ""
unit_ref     ""
alias_text   a REAL Danfoss parameter name from maskin-akpc-link-map.json
```

and `source_plant_id` / `panel.plant_id` / `panel.saved_by` empty.

**alias_text is the link key** — on Maskin it *is* the Danfoss parameter name,
and a fully linked production panel resolved 64 of 64 objects by exact string
match. Take the names from the link map; do not invent them and do not prettify
them. A renamed alias is an unlinkable object.

### Class 2, a linked copy — rewrite the prefix, keep the rest

A driver id is `<plant>_AK3_AKC_0_60_0_<param>_<index>`. Only the plant prefix
changes. **If the target plant's prefix was not supplied, stop and ask** — an
invented prefix produces objects that look linked and are not.

Unit numbers are plant-specific. When the target plant's unit differs, the honest
route is a relink by exact alias match against the target's own parameter dump,
not a rewritten `unit_id`.

### Committing a fixture — the sanitization contract

Anything committed to this repository has its bindings replaced and its drawing
preserved:

| Replace | With |
|---|---|
| `source_plant_id`, `plant_id`, `saved_by`, `org_image_name`, `image_name` | `""` |
| `id`, `driver_id` | `"driver_id"` |
| `linked` | `"false"` |
| `link_name`, `link_tag`, `unit_id`, `unit_ref`, `sub_group` | `""` |

Preserved byte for byte: `obj_id`, `name`, all four geometry fields, `zIndex`,
`tag_text`, `alias_text`, array order, `panel.image_data`, `converted`, canvas
size. Dropped: `panel.image_svg_trace`.

**Do not hand-edit a fixture.** [build-maskin-fixture.py](build-maskin-fixture.py)
generates it; change the generator and regenerate.

### Class 3 — preserve everything you were not asked to change

Every untouched object keeps every field byte for byte. Do not renumber, do not
re-space, do not re-order, do not normalise. That includes the anomalies: the
three `tag_text = " "` values, the two `linked:"true"` objects with an empty
`driver_id`, and the duplicated `Suction temp. To-MT` alias. **They are
production, and preserving production is the job.** Report them; do not fix them.

## 8. Report what you could not verify

Every delivery states:

- **the request class** and why;
- **the profile or supplied export** you worked from, and the precedence rank;
- **every role you moved, added or removed**, with the vector or the reason;
- **which pitch or vector you reused**, and from which pair;
- **the exact validator command and its output**;
- **the render you inspected**, and which crops;
- **every gap** — a coordinate you could not measure, an alias you could not
  resolve, a plant prefix you were not given, a machine feature the profile does
  not cover.

**A stated gap is a valid deliverable. A guess is not.** And passing validation
is not evidence the panel is correct — the validator cannot see the drawing.

## Failure catalogue

Each of these has actually happened, here or in the ventilation work.

| Failure | Why it happens | Prevention |
|---|---|---|
| Composed coordinates over authored artwork | class 1 answered with template geometry | §3 — decide background ownership first |
| Only the new objects emitted for an edit | class 3 read as "produce the delta" | §1 — class 3 emits the whole document |
| Every object duplicated on the canvas | a full document inserted onto a populated panel | Insert appends. Target an empty canvas |
| A fourth compressor with a phantom VSD row | C1 cloned instead of C3 | §4 — only C1 has a VSD |
| Suction readouts moved to empty white | the (0,+325) compressor vector applied panel-wide | §4 — the vector is per role |
| Every pill under the artwork | CLAUDE.md's `VENT` z bands used on Maskin | §5 — bands are per panel type |
| A purpose-built object replaced by a value pill | the id-exists check passed | §5 — match the profile's vocabulary |
| An unlinkable demo | `alias_text` stripped during sanitization | §7 — the alias is the link key |
| A leaked plant id in a committed file | the fixture hand-edited instead of regenerated | §7 — change the generator |
| A "corrected" anomaly | the duplicate MT alias looked like a bug | §7 — production is preserved; report, do not fix |
| 2.5 MB of `image_svg_trace` in the output | the export field copied through | §3 — trace is input, never output |
| Objects added over artwork that does not draw them | the JSON was the easy half, so it was done first | §4a step 6 — artwork first (`M-A06`) |
| The whole new column faded | a soft mask multiplied the source alpha | §4a step 6 — a mask is binary (`M-A02`) |
| A visible gap where the new branch meets the header | the branch was checked in isolation | §4a step 7 — inspect the background alone (`M-A05`) |
| The new pipe thinner and harder than the one it joins | a 3-row antialiased line reproduced as its 2 visible rows | §4a step 4 — reproduce every row, with its alpha (`M-A04`) |
| The suction branch the wrong weight | the discharge measurement was reused | §4a step 4 — measure each source line (`M-A03`) |
| Damage that no single edit explains | the derivative was patched again | §4a — restart from the retained original (`M-A07`) |
| A new object nobody can ever link | `alias_text` left empty because the parameter was unknown | §4a step 8 — alias always, binding when evidenced (`M-A08`, `M-A09`) |
