# IWMAC Designer Import/Export

Adds a **Panel JSON** section to the IWMAC Designer's manager sidebar (right below *Manage Files*) with four stacked buttons — **Export JSON**, **Insert JSON…**, **Edit in VectorCraft…**, **Background → Illustrator** — so a panel's complete look (objects, containers, graphics, background image) can be copied out as a single `.json` file and inserted into another panel, on the same plant or a different one, the background artwork can be edited as vectors in a browser editor, and it can be handed to Adobe Illustrator for editing. The designer itself has no way to do any of these; this script adds them.

Runs on `http(s)://legacy.iwmac.local/iwmac_designer_v4/?plant_id=<id>` ("IWMAC Designer V5"). Since v1.35.0 it also runs on the hosted vector editor, `https://hapnes-dev.github.io/iwmac-vector/app/`, for [Edit in VectorCraft](#edit-in-vectorcraft-v1350); Tampermonkey asks once to allow that, and Tampermonkey's storage, when it updates.

## Install

👉 [**Install IWMAC Designer Import/Export**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js)

Requires Tampermonkey. Auto-updates on every `@version` bump.

## Workflow: copy a panel's style to a new panel / another plant

1. Open the designer on the **source** plant, *Retrieve → Load* the panel you want to copy.
2. Click **Export JSON** to download `iwmac-panel_<plant>_<name>_<stamp>.json`.
3. Open the designer on the **target** plant, *New → Create Panel* (or load an existing panel to combine into).
4. Click **Insert JSON…**, pick/drop/paste the export. It is checked and read back first; **⚡ Insert without checking** skips that for pasted text.
5. If the file comes from another plant, the script offers to **rewrite the driver-id plant prefixes** (`10113_…` → `<target>_…`) so objects can link to the target plant's drivers.
6. If the target panel already holds objects, the script asks what to do with them:
   **Replace** clears the canvas first, so you end up with an exact copy of the export;
   **Add** inserts on top of what is there, for merging two panels. An empty panel skips
   the question and simply gets a 1:1 copy. The embedded background is applied when the
   canvas has none, or when you chose Replace — otherwise it asks first.
7. Nothing touches the server until you use the designer's own **Save** buttons (*Compile Panel for Plant* / *Sync Panels with Plant*). That includes Replace: it only clears the screen, so reloading without saving brings the old panel back.

## Exporting a panel that has no objects yet (v1.11.0)

An **Oversikt** panel that nobody has linked out from is a background picture and nothing else:
`getPanelDataFromDOM` collects zero objects, zero containers, zero graphics. Until v1.11.0
**Export JSON** refused that panel outright — *"Canvas is empty — load a panel first"* — which was
wrong in the one case where the picture is the whole point: you want to hand the drawing to an AI,
have it work out where the links belong, and insert the objects it proposes back as JSON.

Now **Export JSON** on an object-less panel downloads two files instead of refusing:

| File | What it is |
|---|---|
| `iwmac-bg_<plant>_<panel>_<stamp>.png` (or `.svg` / `.jpg`) | The background as the designer shows it. Opaque pixels stay **byte-for-byte**; transparent PNG holes are flattened onto the canvas CSS background-color (otherwise viewers paint those holes black). This is the file to give Copilot or Claude. |
| `iwmac-panel_<plant>_<name>_<stamp>.json` | The background-only envelope: real `plant_id`, `panel_name`, `panel_width`/`panel_height` and empty `single_objects`/`containers`/`graphics` — the template the AI fills in, and proof of the exact schema Insert expects. |

The picture's pixel size *is* the panel geometry (1400 × 750 on a standard panel), so coordinates
worked out on the image land where they were meant to. **No vector trace runs on this path** — a
trace costs minutes on a photo background and a template has no use for one; use
*Background → Illustrator* when you actually want vectors.

Two files means two of Chrome's download prompts: the multiple-file *"Download multiple files?"*
ask (once per site — choose **Allow**), and, because the designer runs on plain `http`, the
*"can't be downloaded securely"* flag on each one — choose **Keep** both times. Verified on plant
10240 *Oversikt*: 0 objects, a 47 kB 1400 × 750 PNG background, both downloads reaching Chrome.

If the canvas has no objects *and* no background picture there is genuinely nothing to export, and
the toast says so.

Round trip: export → give the `.png` to the AI with the internal documentation as its knowledge → it returns a panel
`.json` → **Insert JSON…** → link and save with the designer's own buttons.

Internal documentation lives in the private `tampermonkey-scripts-documents` repository.

## Parameter list → Excel (v1.12.0, v1.13.0)

The **PARAMETER SELECTOR** popup (Actions → *Open Paramselector Popup*, or any object-link
dialog) gets two buttons to the right of the ALIAS TEXT / UNIT ID / UNIT NAME row:

- **EXPORT XLSX** — select a regulator in the UNITS list, click it, and every parameter of
  that regulator — all of them, not just the visible page — downloads as
  `parameters_<plant>_<unit>_<date>_<time>.xlsx`.

  **Tick several units with the checkbox column** (v1.16.0; Ctrl/Shift+click also work
  where nothing intercepts them — one machine had another extension swallowing Ctrl+clicks,
  which is why the checkboxes exist). The header checkbox selects every unit. With more
  than one selected, EXPORT XLSX walks exactly those units — progress panel, no
  confirmation, selection restored afterwards — and downloads
  `parameters_<plant>_<n>-units_<date>_<time>.xlsx` in the banded multi-unit layout.
  Clicking a unit's name row still single-selects and loads it exactly as before.
- **EXPORT ALL XLSX** (v1.13.0) — after an in-page confirmation, walks every unit in the
  UNITS list through the host's own loader (one at a time, roughly a second per unit),
  restores your original selection, and downloads the whole plant as
  `parameters_<plant>_all-units_<date>_<time>.xlsx`: one sheet, a gray-blue band per unit,
  group bands inside each unit, parameters collapsible at outline level 2 — the same
  layout as supermarket-superuser's all-units export. Units that fail to load or hold no
  parameters are skipped and counted in the result message.

  While it runs (v1.14.0) a centered progress panel shows the current unit, a progress
  bar, a live parameter count and a **Cancel** button; cancelling finishes the current
  unit, restores your selection and downloads nothing. The panel's overlay also blocks
  clicks into the dialog during the walk — clicking units mid-export would corrupt it.
  Keep the tab in the foreground: Chrome throttles background tabs to a crawl.

The workbook uses the same style as the supermarket-superuser parameter export: bold
white-on-blue header row (frozen), one collapsible header-blue band per parameter group with
the group's parameters indented under it (Excel outline +/- buttons), AutoFilter dropdowns
on every column, and numeric-looking values stored as real numbers so they sort and sum.
Columns: Group, **Unit ID**, **Unit name** (v1.21.0), **Alias text** (v1.21.1), Access
(Read / Read/write), Eng unit, Type, Application, Tag, SGR, Driver ID — the full record the
popup's grid holds, including the columns it hides. The all-units sheet leads with the unit
instead, so there the order is Unit ID, Unit name, Group, Alias text, … The three headers
are the popup's own ALIAS TEXT / UNIT ID / UNIT NAME fields, so the parameter text is
headed *Alias text*, not *Name* — there is only one Name in the sheet, the unit's.

Unit ID and Unit name are the ID and Name of the UNITS list, in that order (`V01` /
`360.001 Ventilasjon`), and repeat on every parameter row — like Group — so filtering and
sorting stay correct. A unit band row puts the id in column A and `name (count)` in
column B; group band rows leave both blank.

The button is deliberately **not** a w2ui toolbar item: the host's ALIAS TEXT / UNIT ID /
UNIT NAME row is a radio group ("which item adds to Label"), and clicking the export must
never change that selection. It is a separate element styled with the host's own w2ui
button classes, re-added automatically whenever the host re-renders the toolbar.

## Background picture only (v1.10.0)

Tick **Background picture only — insert no objects** under *Background options* in the Insert
dialog (at the top of it before v1.31.0) and the import takes nothing from the file but its
artwork. No objects, containers or graphics are
inserted, everything already on the canvas keeps its position, and both mid-import questions —
replace-or-add and driver-id rebinding — are skipped, because neither has anything to decide.

It works on any file that carries a background: a full export (only the picture is taken), an
artwork-only patch with empty object arrays, or an AI-authored `image_svg`. A picture picked
under *Background options* still wins over the one inside the `.json`, so the box is also the
way to drop a fresh PNG under a panel you do not otherwise want to touch. If the file has no
artwork at all, the import is refused and says so — nothing on the canvas changes. Since
v1.31.0 an artwork-only file does not need the box: its check offers **Apply the background
only** directly.

Before v1.10.0 an artwork-only file was rejected outright as an empty panel document; that
rejection now names the box as the way through.

> **Editing an existing Maskin background:** tick **Background picture only** — that swaps the
> drawing and leaves every existing object untouched. **Replace** is for putting a full export
> onto a panel whose current content you no longer want; adding a full export instead duplicates
> every object. Maskin drawing rules and validators live in the private `tampermonkey-scripts-documents` repository.

## Draw background (v1.32.0 to v1.35.0): replaced by Edit in VectorCraft

Until v1.35.0, **Draw background…** drew Maskin artwork on the canvas itself: pipes, boxes,
dots and labels in the house palette, a pen tool, and components from an Illustrator file.
In v1.36.0, **Edit in VectorCraft…** takes its place on the sidebar. VectorCraft is a full
vector editor, with the pen and direct selection, pathfinder, layers, zoom and undo, so the
homegrown editor was removed.

Backgrounds drawn with it keep working. Draw stored its shapes inside the PNG, in an `iTXt`
chunk with the keyword `iwdie-draw`, and the untouched picture under them in `iwBs`. Both are
still read:
- **Edit in VectorCraft…** opens such a background as the picture under the shapes, with the
  shapes as editable objects on the *Tegning* layer.
- **Background → Illustrator** writes the shapes as Illustrator objects.

A drawing read from a file is cleaned on the way in: known shapes, numbers, `#rrggbb`
colours and plain text only. So a hostile PNG cannot put markup into the page.

## Komponenter: components from Illustrator (v1.33.0, in VectorCraft's Libraries since v1.37.0)

The Maskin artwork's Illustrator files keep their components around the artboard: fans,
pumps, compressors, tanks, valves, alarm and temperature symbols, arrows. VectorCraft's own
`.ai` reader leaves those out. Measured: `2349_Maskin.ai` opens there with the artboard
only. So this script reads the components itself and hands them to VectorCraft as one of its
own libraries.

**In VectorCraft.** When *Edit in VectorCraft…* opens a panel, the components arrive in
VectorCraft's **Libraries** panel (the third tab on the right), as *Komponenter -
2349_Maskin.ai*:
- Each Illustrator layer they came from is a group of the library, and each component a
  graphic with its thumbnail.
- **Search** finds a component by its name. One without a name is called after its layer and
  number (*Temperatur 12*).
- **Drag** one onto the drawing, or **double-click** it to put it in the middle. It lands in
  the selected layer as a group with the component's name, and every path in it can be
  edited like any other.

**How they get there.** VectorCraft keeps reusable art in libraries: a `.vclibrary` file
(JSON) whose graphics are each a VectorCraft document with a PNG thumbnail. The script
writes one:
- Each component becomes a native VectorCraft document (format version 1, as VectorCraft's
  own example files are written). It has one artboard round the component and one layer,
  and the component is a group of paths: anchors with their handles, fills, strokes with cap,
  join and dashes, opacity, the fill rule.
- The thumbnails, at most 128 px a side, are drawn in the editor's tab.

The file is dropped on VectorCraft's menu bar. A library dropped there is imported even with a
document open, while one dropped on the drawing would be placed as art. For the 386
components of `2349_Maskin.ai` the file is about 3.5 MB and takes about a second to make.
Libraries in VectorCraft's web version last for that tab only, so every *Edit in VectorCraft…*
brings them again. Nothing is uploaded.

**Open plant .ai…** (since v1.50.0; *Plant .ai…* in v1.49.0, *Components from .ai…* before,
*Import .ai…* until v1.39.0), in the banner of the editor's tab, reads a `.ai` file - see *One button for the panel's .ai* below.
Since v1.55.0 it only opens the file; the components row then offers to read its components.
Since v1.59.0 they are read as it opens and pasted around its artboard, where the file keeps
them (see *The components around the artboard* below); Libraries get them when asked.
Every visible object
lying wholly outside its artboard becomes a component. The new set replaces the one kept, and
goes into Libraries at once.

**Where they are kept.** The components live in Tampermonkey's storage (`iwdie.library.v1`,
about 0.5 MB for these files), where the Designer and the editor's page both reach them. A
library imported in Draw (v1.33.0 to v1.35.0) lived in the Designer's own `localStorage`
(`iwdie.draw.library.v1`). The first *Edit in VectorCraft…* copies it over, and the old copy
stays where it is.

v1.36.0 opened the components as a sheet in a VectorCraft tab of their own, to copy from and
paste. v1.37.0 replaces that: the Libraries panel keeps names, needs no second tab, and
places a component where it is dropped.

How the file is read:
- A PDF-compatible `.ai` carries two copies of the drawing. The PDF page that previews the
  file shows only the artboard. Illustrator's own native data, split over the file's
  `AIPrivateData` streams, holds everything, and that is what is read. Illustrator 2020 and
  later pack it with zstd, which browsers cannot unpack, so the script carries its own
  decoder; older files use zlib, which the browser unpacks.
- CMYK colours go through the ICC profile the file carries, as Illustrator shows them. For
  the Maskin files that is U.S. Web Coated (SWOP) v2, and the house palette comes out within
  1 of 255 per channel. A file without a usable profile falls back to the plain formula.
- Groups wider or taller than 700 px are opened into their parts, so a sheet of components
  becomes the components. A group that straddles the artboard's edge gives up the parts that
  lie outside it.
- Hidden objects and hidden layers are left out, as Illustrator hides them; the banner says
  how many.
- Compound paths stay one path, so their holes stay holes. Opacity, dash patterns, caps and
  joins come along.
- Symbol instances are read through the art they carry. VectorCraft's own reader gives up on
  those.
- Text, placed pictures, gradients and clipping are not read.

`2349_Maskin.ai` (Illustrator 2020 or later) gives 386 components in about half a second. The
kit's Maskin template (Illustrator 23) gives 418.

A stored library is cleaned on the way in, the same way a drawing is:
- path data: absolute M, L, C and Z only, rebuilt from its numbers;
- groups: at most nine deep, at most 5000 shapes each.

So neither a hostile file nor a doctored storage entry can put markup into the page.

The kit's `tests/test-draw-library.js` holds the reader, the decoder, the colours and the
cleaning. `tests/test-vectorcraft-bridge.js` holds the library file and the VectorCraft
documents in it.

## What it handles for you

| Concern | Behaviour |
|---|---|
| Background image | Base64-embedded into the export (the host's own `converted`/`image_data` format), re-applied on insert; or attach a PNG/JPG in the Insert dialog to give an image-less panel its artwork; or import the artwork **alone** with *Background picture only*, leaving every object on the canvas where it is |
| Cross-plant driver ids | Detected via the `<plant>_` prefix; offered rebind on insert; leftovers reported |
| A target panel that is not empty | Replace-or-add is asked before anything is touched; Replace clears the canvas and the host's own object/container caches the way a full panel load does, Add keeps everything and merges |
| Name collisions on insert | Canvas object names renumbered after insert (same policy as the designer's own paste) |
| Drawing background artwork | **Edit in VectorCraft…** opens the panel in an open-source vector editor in a new tab, with the picture, any drawing and the objects on a hidden layer. Saving there sets the background through `iw_set_base_image`, and the next edit reopens the same document (v1.35.0; on the sidebar since v1.36.0, in place of *Draw background…*) |
| Editing the background in Illustrator | *Background → Illustrator* writes a real .ai: the picture on a locked layer, the drawing as Illustrator objects, the panel's objects on a hidden reference layer (v1.34.0) |
| Components from Illustrator | The objects around a `.ai` file's artboard go into VectorCraft's own Libraries panel, to drag onto the drawing (v1.33.0; in VectorCraft's Libraries since v1.37.0). Those drawn in the panel's picture are found there and opened as editable groups (v1.44.0) |
| Did everything go in? | Since v1.31.0 the canvas is counted after every insert with the host's own serializer; the toast is green when every object and container arrived and red when any did not, and says how many (since v1.31.1 the file's own warnings are listed but never colour it) |
| Empty canvas on **export** | Not an error since v1.11.0 — the background picture is downloaded as-is plus a background-only envelope, so an unlinked *Oversikt* can still be handed to an AI |
| Not-a-panel-file / VV sketch file on **insert** | Blocked with an itemised error panel, canvas untouched |
| Server writes | Never — export reads the DOM, insert only renders; saving stays 100 % in the host's own buttons |
| Bookkeeping | Host's own `UpdateObjectWorker` runs after insert, exactly like the designer's paste |

## File format

```jsonc
{
  "format": "iwmac-designer-panel",
  "version": 1,
  "exported_at": "2026-09-10T09:12:00.000Z",
  "generator": "IWDIE v1.22.0",
  "ai_guide": {
    // v1.17.0, rewritten in v1.22.0 — the reading contract: what every key is for,
    // the field-by-field schema, relationships, identifiers, linking, what to
    // preserve, how to add, how to validate, worked examples. See below.
  },
  "source_plant_id": "10113",
  "panel_name": "Oversikt",
  "panel_width": "1400px",
  "panel_height": "750px",
  "counts": { "single_objects": 54, "containers": 0, "graphics": 0 },
  "summary": {
    // v1.22.0 — facts derived from the panel: object types and how often they
    // occur, linking counts, units referenced, z-index values, extent
  },
  "background_embedded": true,
  "background": {
    // v1.17.0 — what the image_data blob is, without opening it
    "field": "image_data", "mime": "image/png",
    "width": 1400, "height": 750, "bytes": 118784,
    "source_name": "oversikt.png"
  },
  "panel": {
    // the EXACT document the designer itself saves/loads (getPanelDataFromDOM):
    // plant_id, panel_name, panel_width, panel_height, org_image_name, image_name,
    // saved_by, single_objects[], containers[], graphics[]
    // + converted:"true" when a background is embedded
    // + image_svg when that background is authored artwork (v1.23.0) — the markup
    //   itself, returned so the drawing stays editable across round trips
  },
  "image_data": "data:image/png;base64,…",   // v1.17.0: last in the file
  "image_svg_trace": "<svg …>",              // v1.17.0: last in the file
  "change_log": []                            // v1.22.0: optional, written by an AI that modified the file
}
```

Insert also accepts a **bare** panel document and the server's array-of-one wrapping, so files fetched straight from `V3load_design_panel` / `iw_load_ctrls.php?format=json` import fine.

### Green if it went in, red if it did not (v1.31.1)

The first live insert with 1.31.0 — a Replace of 200 objects on plant 2313, 200 of 200
counted on the canvas afterwards, background applied — came back **amber**: *⚠ Inserted —
2 warnings to look at*. The two warnings were the file's layout (two objects past the
canvas edge, four pairs of value boxes on each other). The check had shown them before
Insert was pressed, and nothing about the insert had gone wrong.

The toast's colour now answers one question: **did everything in the file reach the
canvas?**

- ✅ **green** — every object and container is on the canvas, no graphic was skipped, and
  the background went on or you chose to keep yours;
- ⛔ **red** — anything did not arrive: objects or containers (*3 of the 128 did not appear
  on the canvas*), a graphic, or the background;
- ⚠ **amber** only when the canvas could not be counted, because then nobody knows.

What the check found in the file — warnings, notes, and bindings that still point at
another plant — is listed under its own label, *From the check — about the file, not the
insert*, below the insert's lines. It never sets the colour: it describes the file, and
you saw it before pressing Insert. A binding to another plant moved there from red, because
the objects did arrive, and keeping the original ids is one of the choices Insert offers. A
green toast stays up longer the more it lists, up to 30 seconds, and hovering holds it.

For node, `iwdieInsertOutcome` returns `findings` beside `lines`. Only failures to arrive
make `tone` `err`, and only an uncounted canvas makes it `caution`.

Verified in the stub host page:
- A Replace with a file carrying one warning and two notes: 128 of 128 on the canvas, green, with the findings under their label.
- A host that drops three objects: red, *⛔ Inserted — but 3 objects did not appear*.

### A report you can read, and a green that means it (v1.31.0)

The check report had grown into one long tinted block under the form: every finding a
sentence carrying three samples, the file's read-back as a list of facts, and the Insert
button at the bottom of a box you had to scroll to. And a green toast after Insert only
meant that the designer had not thrown — nothing looked at whether the objects arrived.

**The report replaces the form** in the Insert dialog, top to bottom:

- a **verdict banner** — ✅ *Ready to insert*, ⚠ *Ready to insert — 2 warnings to look at*,
  ⛔ *This file cannot be inserted* — with one line on what that means, and the file name;
- an **at-a-glance grid**: panel, plant (*2746 (you are on 2313)* when they differ),
  contents, linked · unlinked, background, and what wrote the file;
- errors, warnings and notes as **one headline each, in words** — *2 pairs of value boxes
  sit on top of each other — one hides the other on the panel* — with the complete list
  folded under *show all N*. The old messages sampled three; the fold holds every one.
  Per-object findings of one kind are one line: fifty missing coordinates read *50 position
  fields are missing or not numbers*, not fifty lines;
- the rest of the read-back — sections, roles, units, prefixes, duct runs — folded under
  **File details**, open by default only on a refused file;
- the buttons pinned at the bottom: **Insert 128 objects** (the count is on the button),
  *📋 Copy report for the AI*, *← Choose another file*.

A failure found at insert time uses the same layout: ⛔ *Not inserted — Nothing on the
canvas was changed*, the errors grouped, the diagnosis, and *Copy the fix for the AI*. The one
failure that can come after the canvas was cleared — the designer refusing the objects in
Replace mode — says the panel was cleared and that reloading without saving brings it back,
instead of claiming nothing changed.

**⚡ Insert without checking** sits next to *Check* under the paste box. It skips the report
and the checks proper — envelope counts, overlaps, objects outside the panel, unknown
types — and goes straight to the insert. What it does not skip: a document the designer
cannot load is still refused (not JSON, arrays that are not arrays, objects with no
obj_id), and replace-or-add, rebinding and the background question are still asked,
because they are decisions, not checks. The toast then says what was not looked for.

**Green is earned.** After every insert the canvas is counted with the host's own
serializer — the count Export and the replace-or-add question already use — and compared
with what was handed to the designer, plus what was there before in Add mode. The toast is:

- ✅ **green** — *Inserted — everything went in* — only when every object and container
  arrived, the background went on or you chose to keep yours, no graphics were skipped and
  no warnings remain. Notes ride along as ℹ lines;
- ⚠ **amber** when something did not arrive (*3 of the 128 did not appear on the canvas —
  the designer dropped them*), graphics were skipped, the background failed, warnings
  remain, or the canvas could not be counted — an uncounted canvas proves nothing;
- ⛔ **red** when nothing arrived, or bindings point at another plant.

*(1.31.1 changed these colours: warnings no longer turn the toast amber, and anything that
did not arrive turns it red — see above.)*

Each fact is a line of its own, the save reminder sits underneath, and × closes it. Green
goes by itself after ten seconds; amber and red stay until closed. A new toast replaces the
last one instead of stacking on top of it. The count is taken where the host is at rest,
after the loaders — which are synchronous — have finished, and once more 600 ms later
before anything is called missing.

Smaller changes:
- Paste, then **Ctrl+Enter**, checks.
- The whole drop zone opens the file picker.
- The background picture and *Background picture only* are folded under **Background options**.
- A file that carries artwork and nothing else is offered as **Apply the background only**. It is no longer refused at Insert for want of the box.
- Headlines use real plurals: *1 object reaches…*, never *1 object(s) reach…*.

For node:
- `iwdieCheckFile` also returns `details` (each finding → `{lead, items, why}`) and `overview` (the grid's fields).
- `iwdieGroupFindings`, `iwdieFindingsHtml`, `iwdieBlockedReportHtml`, `iwdieCountPhrase` and `iwdieInsertOutcome` are pure and exported. The last one is the toast's verdict, tested for every tone.
- The message strings themselves are unchanged, so *Copy report for the AI* reads as before.

Verified by running the real userscript in a stub host page — the Designer's loaders and serializer, stubbed. None of these runs used the live Designer:
- The 2313 panel checked ✅ with two notes. *Insert 128 objects* put all 128 on the canvas, and the toast was green.
- A quick insert into a host that silently drops three objects gave amber, *but 3 objects did not appear*.
- Replace on a five-object canvas cleared it, counted 128, and gave green.
- Add counted 133 and went amber for the file's one warning.
- A file missing three obj_ids was refused, with the three on one line. A quick insert of the same file stopped at *Not inserted*, with 0 objects on the canvas.
- A serializer that throws gave amber, *the canvas could not be counted*.
- An artwork-only file offered and applied the background alone, leaving the canvas as it was.

### Good to know is not a warning (v1.30.0)

A house panel came back amber. Plant 2313's ventilation panel — the production export and
a relinked copy alike — read *⚠ Ready to insert, with 2 warnings*, and after Insert the
toast turned red. Neither finding needed fixing:

- **One signal shown on two objects.** The report already said *fine when the same signal is
  meant to show twice* and counted it as a warning anyway. A damper pair on one open
  command, or a status shown in the drawing and again in the sidebar, is how panels are
  built.
- **An alarm dot on a value box.** The overlap check treated every pair of live objects the
  same, so the alarm placed on the corner of an airflow box — deliberately, to mark that
  value with its alarm — read as a collision.

Both are **notes** now: reported, never a verdict. The Insert dialog stays green — *✅ Ready
to insert — every check passes* — with an **ℹ Good to know · nothing to fix** block under
the headline, above the file's read-back. After Insert the toast is **green**, with each
note as an ℹ line; it is amber when real warnings remain and red only when bindings point
at another plant and will not resolve here. *(1.31.0 redrew this dialog and made the toast
count the canvas before it turns green — see above.)*

Everything that is a fault still warns: an object outside the canvas, **two value boxes on
top of each other**, the drawing running under the settings column, an obj_id the
catalogue does not list, counts that disagree with the arrays, and a foreign plant prefix.
The split for overlaps is by role — a pair where one side is an alarm or LED dot is a note,
any other pair of live objects is a warning.

The dialog also reads in a better order: what decides the verdict first — errors, the
refusal's diagnosis, warnings — then the notes, then *What the file holds*. *Copy report
for the AI* says `clean, with 2 note(s) for information.` and lists them under *Notes (for
information - nothing to fix)*, so an agent does not go looking for a fault.

For node: `iwdieCheckFile` returns `notes` beside `warnings`; `iwdieCheckPanelGeometry(doc,
notes)` fills the array when given one and returns the warnings alone either way; the
dialog's markup is `iwdieCheckReportHtml(result, fileName)`, pure, so what the user sees is
testable. Those checks now have committed tests; the "13 assertions" 1.26.0 describes below
were never committed.

### Objects, a progress bar, and the worker that died (v1.29.0)

1.28.0 froze the tab. The tracer runs in a Web Worker whose source is lifted from the
script by `Function.prototype.toString`, which carries a function's body and nothing it
closes over — and 1.28.0 had just made the palette builder call `iwdieMergeBlendColours`.
The worker threw `ReferenceError` on its first message, the catch fell back to tracing on
the main thread, and the only feedback for the length of the job was Chrome's *Page
Unresponsive* dialog. Three things changed:

- **The worker carries its dependencies** (`iwdieTraceWorkerDeps`), and the check suite
  runs the built worker source in a bare scope on the real template, so the next helper
  added to the palette builder fails a test instead of a browser. A trace that fails
  *inside* the worker is reported, never retried on the main thread; the main-thread
  fallback is only for a browser that cannot start a worker at all.
- **A progress panel** for both traces (*Background → Illustrator* and the export's
  structural trace): the worker runs the tracer's pipeline step by step and reports the
  palette scan, the quantisation, each colour layer by name (*Tracing colour 4 of 9 –
  Uteluft-kjerne*), and the SVG; the panel shows the bar, the stage, the elapsed seconds
  and a **Cancel** that terminates the worker.
- **The trace is grouped as the drawing's objects**, not as colour layers. Colour layers
  put every duct casing, zone border and pill into one *Hvitt*. Now
  `iwdieTraceObjectTree` nests what lies inside what (a zone's grey inside its border, the
  exchanger's pill inside its ring, a symbol's white inside its outline), and
  `iwdieTraceAssemblies` joins the shapes a duct is made of — the core line, the white
  strip along each side, the arrows — which touch but never nest. Each group is named by
  what it is: *Kanaler* (the joined network, with *Kapsling*, *Kjerne-avtrekk*,
  *Kjerne-tilluft* and *Pil* inside), *Kanal-uteluft*, *Kanal-avtrekk*, *Sone*,
  *Sidefelt*, *Gjenvinner*, *Symbol*; anti-aliasing crumbs are *Kant* and ride inside the
  object they touch; canvas-coloured islands are dropped because the plate shows through
  identically. Stacked back to front, top-level objects numbered first.

On the house template: **24 top-level objects, 86 paths, 35 kB**, and the render is
pixel-identical to 1.28.0 (mean error 0.38). 31 new assertions.

### A vector trace Illustrator can edit (v1.28.0)

*Background → Illustrator* on the house Ventilasjon template gave **1 017 paths, 200 kB**,
of which 905 had fewer than eight points — anti-aliasing specks — under one `scale(0.5)`
group with no names. Measured, then rebuilt:

- **Dominant colours are never merged.** The palette builder folded any shade within 24
  of a picked colour into it; the zone-box grey (205,210,215) is 9 from the canvas grey
  (204,205,206) and covers a quarter of the image, and it was lost on every trace. A
  colour covering half a percent of the image is a fill, not a halo.
- **Halos are blends.** An anti-aliasing colour lies on the straight line between the two
  colours it blends; a palette colour within 14 of the segment between two dominant ones
  is dropped (`iwdieMergeBlendColours`). Distance alone cannot tell a halo from a
  neighbouring grey; geometry can.
- **One quantisation cycle.** The palette is derived from the image already; letting the
  tracer re-average it drifted the 2 000-pixel fresh-air blue into whatever light pixels
  landed nearest, and it vanished from the shipped trace.
- **Editing options**: `pathomit` 32 per scale step (64 at 2×) instead of 4, straight
  fits (`ltres`/`qtres` 1).
- **Tidied output** (`iwdieTidyTraceSvg`): the supersample scale baked into the
  coordinates, no transform group, `stroke`/`opacity` noise gone, one group per colour
  named after the house palette (`Soner`, `Avtrekk-kjerne`, `Uteluft-kjerne`, `Piler` …),
  the full-canvas plate as a single rect, a title and a description.

Result on the same template: **109 paths, 33 kB, ten named groups**, mean pixel error
0.38 against 1.93 before — the zones and the blue are right for the first time; what
moved are the half-transparent white edges along the duct casings, 0.5 % of the pixels,
which is exactly what a person editing the file does not want as separate rings. The
export's `image_svg_trace` goes through the same tidy, so an agent reading it gets
named colour layers too. 14 assertions drive the whole pipeline on the real template.

### The check is the first step of Insert (v1.27.0)

The separate *Check AI file…* button lasted one day. A check you have to remember to run
is a check that gets skipped, so it is now the first thing *Insert JSON…* does: pick, drop
or paste a file and the dialog runs every check and reads the file back — ⛔ *Not inserted
— the file is refused*, ⚠ *Ready to insert, with N warnings*, ✅ *Ready to insert* — and
the file stays in memory. It reaches the canvas only when you press **Insert now**; the
replace-or-add question and the driver-id rebinding follow exactly as before.

A refused file shows the importer's own diagnosis in the same report (*the file is
incomplete — it was cut off before the JSON finished*, with the bracket count) and offers
*📋 Copy the fix for the AI* beside *📋 Copy report for the AI*. `window.__IWDIE.stageImportText(text, name)`
drives the staged step from automation. `iwdieCheckFile` now returns the `diagnosis` too.

Verified live on plant 2313 against the installed 1.27.0: the 2313 panel staged → ⚠ *Ready
to insert, with 1 warning* and canvas at 0 → **Insert now** → *Inserted 122 objects,
background applied*, dialog closed; a truncated paste → ⛔ *Not inserted*, the "cut off"
diagnosis, *Copy the fix* offered and no *Insert now*; the 2746 export → ⚠ 3 warnings with
the foreign-prefix line, and no phantom "outside the canvas" fact any more. **1.27.1** stops
a refused file's diagnosis facts printing twice — once in the facts list and again under
the diagnosis headline; they now live under the headline only, in the dialog and in the
copied text.

### Check AI file… — the checks before the canvas (v1.26.0)

A fourth button under *Panel JSON*. Pick, drop or paste a `.json` and it runs **every check
Insert runs** — JSON, envelope, the 17 object fields, counts, geometry, authored SVG — plus
one Insert cannot: whether the bindings carry *this* plant's prefix. Nothing touches the
canvas. The verdict is Insert's: ⛔ *would block*, ⚠ *would take it with N warnings*, ✅
*clean*.

It also reads the file back in words, which is the half an author actually needs: what
it holds (`12 objects, 0 containers`), roles (`3 label, 2 alarm, 2 fan …`), linking counts,
units, plant prefix, the section headers in order, straight duct runs in the artwork, and
whether the background is authored SVG, an embedded picture, or missing — in which case
it says what Compile will do about it.

*📋 Copy report for the AI* puts the whole thing on the clipboard as plain text ending in
the one instruction that matters (*return the complete corrected file, keep every
untouched object byte for byte*); *Insert this file…* hands a passing file straight to
the import dialog without picking it again.

The check is a pure function, `iwdieCheckFile(text, {plantId})`, exported to node and
covered by 13 assertions: the starter scaffold comes back clean, the 2313 panel comes back
with its one deliberate warning, the same file checked as if on plant 9999 gets the
foreign-prefix warning, and broken JSON, a wrong format, a bad `image_svg` and an empty
document are each refused with the reason Insert would give. *(Those assertions were never
committed; 1.30.0 is the first release whose check has tests. The 2313 panel's "one
deliberate warning" is a note since then.)*

Verified live on plant 2313 with Playwright against the installed 1.26.0: the 2313 panel
→ ⚠ one warning and the full read-back; *Copy report* → "Copied — paste it back to the
AI"; *Insert this file…* → check dialog closed, import ran, 122 objects on the canvas
under the authored SVG; truncated JSON → ⛔ with the "4 brackets never close, the answer
was cut off" diagnosis and no insert button; the 2746 export → ⚠ 9 overlapping pairs, 4
doubled aliases, and *bindings carry plant prefix 2746 but this is plant 2313*.

**1.26.1** fixes what that run showed: the report is amber for warnings and green for
clean instead of borrowing the refusal's red, the headline sits on its own line, a
truncated roles list no longer ends "….", the report opens scrolled to its top, and
`summary.extent.objects_outside_canvas` uses the same 2 px of grace as the geometry check
— the facts said "2 objects outside the canvas" for the house's own 1 px header overhang
while the warnings, correctly, said nothing.

### The export explains the panel, seeds a new one, and Insert checks geometry (v1.25.0)

Found by reading a finished export end to end the way a Copilot agent does, rather than
reading the source. Three gaps, three answers.

**An agent could count objects but not see the panel.** `summary` listed obj_ids; it
said nothing about what they meant or where they sat. Two derived blocks now do:
`summary.roles` counts by role (17 setpoints, 17 duct values, 12 alarms, 5 fans …)
using the catalogue's own role index, and `summary.layout` gives the header bars in
reading order with how many live objects sit under each, the settings column, the
rows of live objects on the drawing as y-bands, and — when the background is authored
SVG — every straight duct run parsed from the artwork, so a con_down or con_top can be
attached to real geometry. `background.width`/`height` are no longer null for an SVG
background; the viewBox is read.

**An agent had rules but no seed.** `examples.minimal_file` was one label.
`examples.starter_ventilation` is a complete, correct file — two duct runs, exchanger
and zone in `image_svg`, eleven unlinked objects at the measured positions, every id
from the catalogue — that passes the importer and the geometry checks as it stands.
`quick_start` (ten lines) opens the guide, `read_order_by_task` says which sections
matter for reading, modifying, creating or linking, `caption_conventions` records what
production writes in `tag_text` (including the non-breaking space it uses to nudge a
centred caption — copy it, never trim it), and the decision blocks now precede
`examples` instead of trailing 30 kB behind them. Two references to an internal
`DESIGN-OBJECT-CATALOG.md` the agent never had point at `object_catalogue` instead.

**Nothing stopped a messy file at the door.** Insert validated shape only. It now runs
the `self_check` geometry over the incoming panel and reports, as warnings never
refusals: objects outside the canvas (2 px of grace, because the house's own headers
overhang by one), live objects on top of each other, the drawing running under the
settings column, one alias linked on two objects, and obj_ids the catalogue does not
list. Run on a real house panel it finds nine overlapping pairs and two doubled
setpoint boxes — true, and left for the owner to judge. *(Since 1.30.0 an alias linked on
two objects, and an alarm or LED dot on a value box, are notes rather than warnings — see
above.)*

The catalogue's `number_v3_40px_dark_con_down` — the cascade-setpoint box on both
production Ventilasjon panels — now sits under `value_conn`; the 1.24.0 generator had
filed it under an unnamed role, and the new geometry check flagged it as unknown on the
first real panel it saw. A listed id is known whatever its role; only an id the catalogue
has never seen is reported.

### The guide tells an agent what to place, where, and which parameters to pick (v1.24.0)

v1.22.0 made the file explain its *format*. It still could not answer the two questions an
agent actually has — **which object does this signal want, and where does it go** — and
answered both with "clone a real export", which is no help to an agent that was given
none. Four blocks, each built from data rather than opinion:

| Block | What it settles | Where it comes from |
|---|---|---|
| `object_catalogue` | every legal `obj_id`, grouped by role, with its palette size and how often production uses it | the designer's own live palette dump (820 entries) narrowed to the 72 ids that appear in the 22-panel usage census and the real Ventilasjon panels |
| `signal_to_object` | which object a parameter row wants, keyed on `Application`, `Access`, `Type` and `Eng unit` | cross-tabulated over 202 linked objects in two production Ventilasjon panels |
| `layout` | where it goes, in pixels: settings column at x 1150/1175/1245, a `con_down` value ~30 px above the duct centre line, `con_top` ~28 px below, a flow box ~67 px above, a bell within 40 px of its component | measured on a production panel |
| `parameter_selection` | which rows belong on a panel at all, and which stay in the list | the 272-row plant list that became a 122-object panel |

`self_check` adds the assertions an agent can run over its own file before returning it
(counts, canvas bounds, 17 fields, no overlaps among value and icon objects, nothing past
x 1145, no invented bindings), and `common_mistakes` names what went wrong on panels that
had to be rebuilt. `drawing_style` gained the survey behind the background question: over
20 MENY plants a background picture is on 82 % of Oversikt panels, 63 % of Energi, 50 % of
Ventilasjon and 20 % of Maskin — so "does this plant have one" is a question to ask, not a
rule to assume either way.

The guide grew from 36 kB to 44 kB. On an export that is usually 100-800 kB, and it
replaces the internal briefing an outside agent never had.

**Sizes in the 1.23.0 catalogue were wrong.** They were taken from how production stretches
an object, not from the palette: `number_v3_heater_3_way` is 38x132, not 40x210, and
`number_v3_el_heater` 38x65, not 40x85. The generated catalogue carries the palette default
and says plainly that production stretches headers, banners and duct pieces.

### Authored artwork round-trips, and the guide says how to draw (v1.23.0)

Three changes, all of them from building a Ventilasjon panel for plant 2313 against the
system drawing and watching where the file left an agent stranded.

**`panel.image_svg` comes back out.** Insert has converted AI-authored SVG into the
background since v1.2.0 and then dropped the markup, so the next export could only offer
the raster plus an autotrace of it — on a real panel, 3.8 kB of named paths came back as
1002 traced paths and 203 kB. Export now returns the markup verbatim as `panel.image_svg`
whenever the background still is that SVG, and writes no `image_svg_trace` beside it: the
artwork is the artwork, not a trace of itself. The download note says *editable artwork
(N shapes)*. A raster background is unchanged — trace as before — and a stale `image_svg`
on a raster panel is dropped, so re-export is idempotent.

**The "Ventilasjon is objects-only" rule is gone.** `ai_guide` asserted in three places
that a 360.NNN panel carries no background and that ducts must never be drawn into
`image_svg`. Production disagrees: the house Ventilasjon panels sit on
`<plant>--template-Ventilasjon.png`, and an agent that followed the guide produced a bare
canvas that was rejected on sight. The guide now says what the house does — copy the
plant's own background when it has one, author one when it does not, and keep ducts,
exchanger and zone boxes in the artwork while fans, filters, dampers, coils, pumps,
values and alarms stay objects, because only an object can carry a signal.

**`ai_guide.object_catalogue` and `ai_guide.drawing_style`.** The legal `obj_id` list
lived only in the internal briefing, so an agent holding one export could copy the ids it
saw and nothing else; the catalogue now ships in the file, grouped by role with each id's
natural size. `drawing_style` carries what no document stated and had to be measured off
the template: a duct is a **white casing 16 wide with a 2 wide coloured core**
(`#F3C96A` avtrekk, `#F79E7A` tilluft, `#B0E0EF` uteluft), a zone box is `#CDD2D7` with a
5 wide white border, the exchanger a grey pill with a white inner pill. Drawing flat
coloured bars instead is the visible tell that a panel was authored without it.

### The file explains itself (v1.22.0)

The usual round trip is: export a panel, hand the `.json` to a Copilot agent together
with the plant's parameter list (the userscript's own Excel export) or the equipment
order, and ask it to analyse the panel, add or relink objects, or build a new panel
from scratch — then insert what it returns. The agent has no access to this source
and often no access to the internal reference kit, so since v1.22.0 the file carries
the whole contract itself. `ai_guide` (guide version 2) holds:

| Section | What it answers |
|---|---|
| `purpose`, `how_to_use`, `read_order`, `skip_fields`, `coordinates` | what the file is, how to read it, how to modify it, how to create one; the coordinate system, including container-relative item positions |
| `file_layout` | every top-level key: type, whether the importer requires it, who sets it, what it means |
| `schema.panel`, `schema.object_entry`, `schema.container`, `schema.container_item`, `schema.graphic` | field by field: type, required or optional, allowed values, meaning, an example — the 17 object fields, the container keys, the panel keys |
| `relationships` | how objects, containers, parameters, the background and the counts refer to each other |
| `identifiers` | how each id is generated or, mostly, *not* generated but copied: `obj_id`, `name`, `unique_id`, `driver_id`, `unit_id`, `plant_id` |
| `linking` | the unlinked and linked shapes, the parameter-export columns and the object field each one feeds, and the rules that keep an agent from inventing a binding |
| `z_index` | why the stacking values matter and where to take them from |
| `when_modifying`, `when_adding_objects`, `when_creating` | what to preserve byte-for-byte, how to add an object or a container, how to turn a unit and parameter list into a panel |
| `validate_before_returning`, `when_information_is_missing`, `do_not` | the checklist, the rule for unknowns, and what must never be changed or removed |
| `examples` | an unlinked object, a linked object taken from the file itself, a container, and the smallest complete file the importer accepts |
| `object_fields`, `constant_fields`, `constant_fields_note`, `structure` | unchanged from v1.17.0–v1.19.0 |

The guide describes the file it is in: a panel whose objects all live in containers
is told so and pointed at `panel.containers[].items` rather than at an empty
`panel.single_objects[]` — the misdirection recorded on plant 4731's floor plans.

`summary` is derived from the panel at export time — object types with counts,
how many objects carry a parameter binding, the units and plant prefixes referenced,
the z-index values in use, the content extent against the canvas — so a reader can
orient without counting 94 lines by hand. It is orientation only: the object entries
are the truth, and an agent that changes the file is told to drop or recompute it.

**Nothing the importer reads moved**, so the format version stays at 1: files
written before v1.22.0 import unchanged, a file with the guide and one without import
identically, and an agent may keep or omit `ai_guide` and `summary` in what it returns
(it must not edit the guide). `change_log` is the one sanctioned place for an agent's
notes — an optional top-level array the importer ignores. One thing Insert now checks
that it did not before: when the envelope's `counts` disagree with the array lengths,
the arrays are used and the mismatch is reported as a warning in the result message,
because a stale count is the commonest bookkeeping slip in an AI-edited file.

Measured on a 94-object Ventilasjon export, the guide is about 33 kB and the summary
3 kB; the guide is the same on every export, the summary grows with the object count.

### Written to be read (v1.17.0)

An export is mostly blob. Measured on real files, `image_data` is 80% of one, and
`image_svg_trace` plus `image_data` are 86% of another. Each is a single line tens
of thousands of characters long, so a reader working through the file — a person
scrolling it, or an AI agent given the path — spends most of it on base64 that
carries no structure.

Position was never the problem: both fields were already the last keys of `panel`,
and `panel` was already the last key of the envelope, so they already sat at the
end of the file. Lifting them to the top level puts them beside `panel` rather than
inside it, which is tidier to describe and to skip, but it does not move them
meaningfully earlier or later.

What actually helps a reader are the two fields added ahead of the panel:

- **`ai_guide`** — the read order, the coordinate system, the 17 object fields, and
  the rules that get a file rejected. `skip_fields` names the one field worth
  ignoring — the base64 picture — and, when the export carries a trace,
  `ai_guide.structure` describes that instead of hiding it (see below). Since
  v1.22.0 it is the complete contract, described above.
- **`background`** — mime type, pixel size and byte count, read from the image
  header rather than by decoding it. These are the facts a reader would otherwise
  open the blob to get.

Nothing is removed and nothing inside `panel` changes, so the file is still one
self-contained document that imports on its own. If you want the blobs out of the
file altogether, that is a different export shape — sidecar `.png`/`.svg` files
next to a lean `.json` — and this version does not do it.

**Older files import unchanged.** The format version stays at 1 because nothing was
taken away: Insert reads the blobs from wherever they are, so every file exported
before v1.17.0 — with `image_data` and `image_svg_trace` still inside `panel` — loads
exactly as it always did, with no warning and no conversion step. A file that
carries a blob in both places keeps the one inside `panel`.

### One object per line (v1.18.0)

Indenting every field of every object turned 58 objects into 1104 lines. That is
a 58-row table written as a thousand lines, and it cannot be scanned: comparing
two objects means holding both in your head. Arrays whose elements are flat
objects are now written one element per line — the whole file goes from 1189
lines to 145, 88% fewer, and each object sits on one ~330-character line
directly under the one before it. A container, which nests an `items` array,
still expands normally.

Only whitespace changes. The file parses back identically, so importers and
validators are unaffected.

`ai_guide.constant_fields` names the fields holding one value on every object —
on a real Maskin export that is six of the seventeen (`id`, `linked`,
`link_name`, `link_tag`, `sub_group`, `unit_ref`), a third of every line saying
the same thing 58 times. The host requires them, so they are still written; the
guide just tells a reader which ones carry no information about this panel.

**The drawing's structure lives inside background-bearing exports too:** since v1.6.1, **Export JSON** automatically includes `image_svg_trace` whenever it embeds a raster or SVG background, without confirmation (at the top level since v1.17.0; `panel.image_svg_trace` in older files, and still read from there). It exists so an **AI can read how the drawing is structured** (where pipe runs, vessels and frames sit — geometry a PNG can't convey) and generate matching artwork via its own `image_svg`. Raster backgrounds use the existing worker tracer, its color-aware derived palette, and a fresh-pixel main-thread fallback if the worker fails; SVG backgrounds are strictly UTF-8 decoded and validated. Insert strips the field and never renders it; the embedded background always stays the real one. A valid panel with no embedded background omits the trace and exports normally. If required SVG decoding/validation or raster tracing fails, Export shows an error and does not download JSON.

**The background image lives inside the JSON.** Export always embeds it (`panel.converted: "true"` + `image_data: "data:image/png;base64,…"` — the designer's own embedded-image format, at the top level since v1.17.0 and inside `panel` before that), so one file carries the whole panel, artwork included. Since v1.1.0 the Insert dialog also has an **optional background-image picker**: choose a PNG/JPG there *before* the .json and it is embedded into the imported panel on the fly. And since v1.2.0 **an AI can author the artwork itself**: put raw SVG markup in `panel.image_svg` (a string starting with `<svg`, `viewBox="0 0 1400 750"`, no `<script>`) and Insert validates it, converts it to a data-URL background and embeds it — verified live with a generated AHU drawing behind 79 objects. Priority on insert: picked file > `image_svg` > `image_data`.

### The embedded trace is coarse on purpose (v1.19.0)

The two traces exist for different readers, so they are no longer the same trace.

| | embedded `image_svg_trace` | downloaded `.svg` |
|---|---|---|
| read by | an AI, from inside the JSON | Illustrator, by a person |
| wants | structure | fidelity |
| source | 1× | 2× nearest |
| `pathomit` | 32 | 4 |
| measured | **451 paths, 141 kB** | 12 337 paths, 2060 kB |

The embedded trace used to be the full-fidelity one — 2060 kB, 88.5% of the
export, roughly half a million tokens. It could not do the job it exists for: no
agent can read it. Dropping paths shorter than 32 points removes the text
speckle and keeps the equipment. Measured on a Maskin panel, every pipe run, the
vessel, the gascooler and its four fans, the compressors, the oil separator and
the field pills survive; the fills still carry the pipe colours (7 warm, 3 blue,
2 green). Text is lost, and costs nothing — the labels are in
`panel.single_objects[].tag_text` and `alias_text`, spelled properly rather than
traced into outlines.

`ai_guide.structure` now describes the field instead of `skip_fields` telling an
agent to ignore it, which is the point: at 141 kB it is worth reading. Export
also got faster, because the embedded trace no longer supersamples — about
1.2 s instead of 4.5 s.

### Trace quality: the labels (v1.17.2, download only since v1.19.0)

Panel text is drawn at about 8 px, so at 1:1 a glyph stroke is one pixel and its
antialiasing dominates the edge the tracer is trying to fit. The labels came out
as mush — legible as shapes, not as words.

The **downloaded `.svg`** is taken from a copy of the background drawn at **2×
with image smoothing off**, then scaled back into panel coordinates. (Since
v1.19.0 this applies to that file only — the embedded `image_svg_trace` is traced
at 1× for structure, as above.) Every source pixel
becomes a clean 2×2 block, so the fitted outlines land on the real edges.
Measured on a 1400×750 Maskin panel, as the share of pixels in a label row
differing from the source by more than 30/255:

| trace | label row | whole image | time | size |
|---|---|---|---|---|
| 1× (before) | 7.9% | 2.7% | 1.3 s | 1738 kB |
| **2× nearest** | **1.7%** | **0.7%** | 4.1 s | 2060 kB |
| 3× / 4× nearest | 1.6% | 0.7% | 9.4 / 16.3 s | ~2200 kB |
| 2× *smoothed* | 9.7% | 3.9% | 4.5 s | 3639 kB |

Two results decided the shape of this. Smoothing must be **off**: bilinear
interpolation invents colours that the quantizer then scatters, scoring worse
than not supersampling at all. And 2× is the whole win — 3× and 4× score the
same for 2.3× and 4× the time.

It is **gated on source size**, at 2 Mpx: cost scales with pixel count at
roughly a second per megapixel, and a photo background can already take minutes,
so quadrupling that is not worth six percentage points on text a photo does not
have. Anything larger traces at 1× exactly as before, and the toast says which
happened. Whatever scale is used, the result comes back in panel coordinates, so
the trace geometry and the objects' `posLeft`/`posTop` stay in one coordinate
system.

## Background → Illustrator (v1.3.0)

**Background → Illustrator**, the last button, exports the **current panel's background image as a file Adobe Illustrator edits directly**. (The host hard-codes the manager sidebar to 900px; the script relaxes `#manager_div` to fit its content so the extra button never causes a sidebar scrollbar while the buttons stay the host's standard size. v1.3.3 capped that growth to the viewport, which turned out to clip the fieldset's bottom edge on shorter windows — since v1.5.2 there is no cap and `overflow` is forced visible. Since v1.5.4 a measured **compact mode** kicks in only when the column wouldn't fit the window — fieldset gaps 8→4px and slimmer paddings reclaim ~68px with the buttons untouched at 28px; tall windows keep the host's stock spacing, with hysteresis so the mode never flaps. And v1.5.5 found the *actual* constant clipper: the host also hard-codes the sidebar's parent `#master_wrapper` to 900px with `overflow:hidden`, which cut the last ~18px of the fieldset at **any** window size — it now grows with content exactly like `#manager_div`.)

- **PNG/JPG background** → **Export Background** (v1.34.0) offers three deliveries, because **pixels contain no vectors**. It is drawn in VectorCraft's style (see below): one choice among cards, the chosen one's options under it, then Cancel and a blue Export. Enter exports, Esc cancels, and a double-click on a card exports that one.
  - **Illustrator document (.ai)** (v1.34.0; it replaces the v1.3.0 pixel-exact .ai). This is a real Illustrator document with layers, written as Illustrator's own editing data:
    - **Bakgrunn**, locked: the canvas colour and the picture, pixel-exact at panel size (1 px = 1 pt). When the background carries a Draw drawing, this is the picture *under* the drawing, so nothing shows twice.
    - **Tegning**: the Draw drawing (v1.32.0) as Illustrator objects. Paths keep their fill and stroke as one object. Boxes keep their rounded corners. Pipes keep their dashes, caps, joins and arrowheads. Labels become point text in Arial, and opacity is kept. Groups keep their names, library components (v1.33.0) included. With no drawing the layer is empty, ready to draw on.
    - **Panelobjekter**, hidden and not printed: every object on the panel as a dashed box with its label, showing where the live values will sit. Turn it on while you draw.
    - **Sporing**, on request, hidden: the vector trace below, as Illustrator objects in named groups.

    Illustrator opens the labels as legacy text and offers to update them; choose **Update**. Every other viewer (Acrobat, file previews) shows the panel as the designer does, drawing included, from the file's plain PDF page.

    Why not a plain PDF, as VectorCraft writes its ".ai": measured in Illustrator, a PDF's optional content groups all land in "Layer 1", hidden ones shown. Every filled and stroked shape splits in two. An SVG's top-level groups stay groups. Only Illustrator's own editing data gives layers, locks and names.

    What it has to look like was measured the same way:
    - the data zlib-compressed after `%AI12_CompressedData` (uncompressed, it is refused);
    - y negated with the artboard's top at 0, and `%AI3_TemplateBox` at W/2, H/2 (Illustrator shifts the art by the difference);
    - a closed path repeating its first point;
    - the picture's rows bottom-up, with the alpha bytes after the colour;
    - no two objects sharing an id: one repeat and Illustrator refuses the whole file.
  - **SVG — vector trace** (v1.4.0): the image is auto-traced to an **`.svg` of editable vector shapes** (vendored [imagetracerjs](https://github.com/jankovicsandras/imagetracerjs), public domain — the script stays one self-contained file). Shapes, pills and pipe runs come out clean **in the drawing's own colours** (v1.5.1: the palette is built from the image's exact colours with a guaranteed slot for saturated ones — before that, flat schematics traced to grey because thin coloured lines never won a sampled palette slot); **small text becomes rough outlines** — retype labels in Illustrator (that limitation is inherent to tracing, Illustrator's own Image Trace included). Since v1.4.1 the trace runs **in a Web Worker**, so the browser stays fully responsive even on photo backgrounds that take minutes (measured: main thread answers in ~4 ms while tracing; ~1–2 s total for a 1400×750 schematic, ≈7–16 k paths depending on colours). The worker is built by lifting the tracer's own constructor source — no second copy of the library, and a main-thread fallback covers browsers that cannot start a worker at all (since v1.29.0 that is the *only* case it covers: a failure inside the worker is reported, not retried on the main thread, and a progress panel with a Cancel shows the stage the worker is at).
  - **Save the picture as-is** (v1.11.0, flatten v1.16.2): opaque pixels stay **byte-for-byte**; transparent holes are filled with `#main_image`'s CSS background-color so the file matches the designer (a transparent PNG otherwise renders those holes black in viewers). Same file the empty-canvas export path produces. This is what an AI asked to look at the panel and propose link positions actually wants; a trace or a PDF only makes the drawing harder for it to read.
- **SVG background** (e.g. an AI-authored `image_svg` one) → the **`.svg` itself**, because it is already vector and Illustrator opens `.svg` natively (*File → Open*) with full editability — wrapping it in a PDF would rasterize exactly what you want to edit. The toast says so.

Filename: `iwmac-bg_<plant>_<panel>_<stamp>.ai` (or `.svg`, `.png`, `.jpg`). The .ai is about 200 kB for a 1400 × 750 panel and is written in about a second. Note: because the designer runs on plain `http`, Chrome may flag the download ("can't be downloaded securely") — choose **Keep**; the file still lands in Downloads on default settings.

**In VectorCraft's style (v1.34.0).** [VectorCraft](https://github.com/storytold/vectorcraft) is an open-source Rust reimplementation of Illustrator (MIT OR Apache-2.0). The export dialog takes its Medium Dark theme: panel `#535353`, cards `#424242`, text `#d1d1d1`, accent `#378ef0`, primary `#1473e6`, Source Sans 3. It also takes its metrics: 22 px padding, radius 6, 28 px pill buttons, a 2 px accent ring on the chosen card. The tokens are CSS custom properties on `.iwdie-vc` (`--vc-panel`, `--vc-accent`, …), so other dialogs can follow. No VectorCraft or ArtCraft branding is used.

v1.34.2: on the live Designer the option labels came out dark grey on dark grey. A rule in the
Designer's own `V3_designer.css` ends in `, span`, so every span on the page is `#5e6468`,
14 px, weight 500. The dialog's spans now take the dialog's text colour, and the library
panel and the style row are pinned against the same rule. The stub host page carries that
rule now, so a test sees what the live page shows.

## Edit in VectorCraft (v1.35.0)

[VectorCraft](https://github.com/storytold/vectorcraft) is an open-source vector editor
modelled on Illustrator, written in Rust (MIT OR Apache-2.0, by the ArtCraft team and the
VectorCraft contributors). Its official web build runs entirely in the browser
(WebAssembly, drawing with WebGPU or WebGL2). An unmodified copy of that build is hosted at
**<https://hapnes-dev.github.io/iwmac-vector/app/>** (repository
[Hapnes-dev/iwmac-vector](https://github.com/Hapnes-dev/iwmac-vector)). This script bridges
the Designer and that page, so a background can be edited as vectors without leaving the
browser.

**Opening.** **Edit in VectorCraft…** on the sidebar (v1.36.0, in place of *Draw
background…*; in v1.35.0 it was a choice under *Background → Illustrator*). A new tab opens
the panel as a document with these layers:

- **Bakgrunn**: the canvas colour and the picture, at panel size.
- **Tegning**: a drawing made in Draw (v1.32.0 to v1.35.0) as editable shapes; empty, ready
  to draw on, when there is none.
- **IWMAC-objekter**, on top (v1.46.0): the panel's own objects, each as a placeholder like
  the ones the IWMAC menu places. It shows the Designer's picture of the object, at the
  object's size, where it is on the panel, with its tag text (below). Until v1.45.0 they were
  dashed boxes on a hidden layer, Panelobjekter.
- **Komponenter** and, hidden, **Bakgrunn (original)**, when components were found in the
  picture (v1.44.0, below), and **Rør** under them when pipes were (v1.45.0).

A panel without a background opens as an empty canvas of its size. A background that cannot
be read stops the edit with a message, so it is never replaced by an empty one. The first
start downloads the editor (about 20 MB). After that the browser has it cached.

**Components found in the picture (v1.44.0).** When components from Illustrator are kept
(by **Components from .ai…**), *Edit in VectorCraft…* first looks for them in the panel's
picture. Those it finds can then be moved, resized, recoloured or replaced one by one, instead
of being drawn again:
- Each component is drawn at its size in the library and looked for in four quarter turns.
  A place must match it closely, and must not be a piece of something bigger in the
  component's own colours.
- Each one found is taken out of the picture. Its pixels are filled from those round it, so a
  pipe that ran through it runs on.
- It arrives as a group of its own on a new layer, **Komponenter**, named as in the library
  (*Temperatur 92*, *MiniVifte*), where it was found and turned as it was. Every path in it can
  be edited, and a component from Libraries can take its place.
- The picture as it was goes along on a hidden layer under the rest, **Bakgrunn (original)**.

While it looks, the new tab shows how far it has come, with a **Skip - open the picture as it
is** button. Closing the tab stops it too. The search runs in workers, so the Designer does
not freeze. The message in the Designer then says what was found, and of which kind.

Since v1.47.0 the new tab lists every step - your components drawn to compare, the search,
what each one shows, the pills, the pipes, the drawing for VectorCraft, the editor starting -
each with what it found and how long it took, the time so far, and while the search runs how
many workers it has and about how long is left. It shows between the steps too, not only
during the search: before, the bar stood still at 92 % from the search to the editor. The
Skip button goes once the picture has been read. On the Maskin panel in the stub host: 331
looks, 52 places in 1.9 s, 7 components, 53 pills (5 under the panel's objects), 37 pipes,
and the editor starting after 3.0 s in all.

**Pills and pipes too (v1.45.0).** Much of a Maskin picture is drawn on the panel directly,
not placed from the library, so the library cannot find it. Two kinds of it now become vectors
as well:
- **Pills**: the value boxes, the dark pills (*Ref*, *Hr Req %*), the status pills (*Manuel*,
  *Alarm*, *Running*, *OK*) and buttons, in any size and colour. Each is found by its shape: a
  plain area with round ends, ringed or not by a line of another colour. It is measured to a
  tenth of a pixel, from how much of its colour each edge pixel holds, and becomes a vector
  pill: its fill, its ring as a stroke in the ring's own colour (the library's, when the ring is
  too thin to cover a pixel whole), and, on top, its text as the picture's own pixels. A pill of
  the library found in the picture is measured too, so it looks exactly as it did; it is named
  after the library's pill of its colour and size, else *Pille*.
- **Pipes**: straight lines across and down, in the library's own colours (orange, blue,
  green, yellow - not greys), about 2 px wide. Each is read along its length, its middle and
  width to a tenth of a pixel. Lines that meet at a corner become one line round the corner; a
  line that stops at another is taken to its middle. A short piece counts only next to a pipe,
  so the strokes of letters stay in the picture. Pipes go on a layer of their own, **Rør**, under
  the components.
- A component found keeps only the shapes the picture shows where it was found. A library
  component may carry a part the picture does not have there, such as the stub to a value
  below it. That part is left out, and the picture keeps what really is there.
- The search is about six times faster: it runs in up to four workers, and a place must first
  show the component's own difference of light, so plain areas are passed over at once.
  Components of one colour, such as a dark pill with its stub, are found too, by their outline.

Measured on the Maskin panel of plant 2349, with the 386 components of `2349_Maskin.ai` kept:
in about 2.5 seconds, 7 components of the library (the five compressors, the heat exchanger and
the pump), 58 pills (11 of them with a text) and 37 pipes, none false. Drawn back, the panel
differs from its picture by 0.4 on average (out of 765, the sum over red, green and blue); most
pills by 1 to 4 where they are. Without workers (a page that forbids them), the same takes about
7 seconds.

Only a component drawn in the picture as it is in the library is found. One that was scaled,
mirrored or changed in the artwork stays part of the picture: there, the gas cooler, the receiver,
the oil separator and some valves. So do the texts beside things, the dotted lines to the values
and the arrows. The colours must match too: a library read from a file without its colour
profile may find nothing. Without kept components, the panel opens as before.

**After the first live sync (v1.46.1).** Two things in it looked wrong in the Designer:
- **Dark blots over labels** ("Run C●●", "Vhp ●●", "Li● consum●"). Letters with round sides
  that touch, such as "OD", "ap" or "er", fill a small pill, so they were taken for dark pills
  and drawn over the text. A pill's fill must now be 14 px high or more and 28 px long; a
  label's letters are 11 px at most. Text inside may fill no more than 40 % of it. On Thomas's
  screenshot the old rules found 11 such blots, the new ones none, and on the Maskin picture
  all 58 real pills are still found.
- **Dark rims round values.** A pill or component under one of the panel's own objects was
  drawn again as vectors, a little off, and peeked out round the object. What the panel's
  objects cover (half or more of it) now stays in the picture as it was: the Designer shows
  the object over it, and in VectorCraft its placeholder lies on top. The message says how
  many stayed.

**Deleting left black, and an object's frame stayed behind (v1.47.0).** After that first
sync, the dark rims were part of the picture. Read again, a frame with a dark rim 2 px or more
wide looked like a dark pill with the white inside as its text (v1.46.1 no longer reads it so).
A click on it chose the white inside, Delete took that, and a black pill was left. And since
v1.46.1 kept what the objects cover in the picture, an object deleted or moved in VectorCraft
left its frame behind, which could not be deleted, being part of the picture.

So what an object stands on - a value's frame, a dark *Ref* pill, a status pill, a component -
now goes **into its placeholder**, cut out of the picture exactly as it is (so nothing is
redrawn a little off), with the ground filled in under it:
- Move the placeholder and the frame moves with it; at the sync the object moves, and the frame
  is in the new picture where it was taken.
- Delete the placeholder and the frame goes too, leaving the ground. At the sync the object is
  taken **off the panel**, as the Designer's own Delete does it (`delete_xml_obj`: out of its
  list of objects, off the canvas). The panel is not saved: reload it without saving to have
  it back. The toast names each one.
- Leave it as it is, and the picture comes back the same, pixel for pixel.
- The next edit of a background that came from VectorCraft puts each kept frame back into the
  placeholder of the object over it. A frame left with no object over it stays as art of its
  own, on the layer **IWMAC-rammer**.
- Not taken off: objects whose placeholders are all missing because the layer
  **IWMAC-objekter** was not in the save (VectorCraft leaves hidden layers out), or more than
  half of them at once when that is more than ten. The toast then names them, to delete in
  the Designer.

**Nothing of the Designer's drawn again (v1.48.0).** After a sync, some bubbles still had dark
rings. The panel itself, read in the Designer without changing it (plant 2349, *Maskin*), shows
why: 45 of its 58 objects are values drawn as bare text (39 `number_v3_value_only`, 6
`number_v3_white_value_only`). Their CSS class gives them no background, no border and no picture.
The white bubbles and the dark *Ref* pills under them are the picture's own. Versions 1.45.0 to
1.47.0 drew such pills again as vectors, measuring their ring and guessing its colour; under a value
the bubble then had a ring of another shade, a little off. And a background that came from
VectorCraft opened that drawing again, its vector pills with it.

So now:
- **A pill is never drawn again.** Under a value that is bare text, the bubble goes into the
  value's placeholder as the picture has it (since v1.47.0). The placeholder is then drawn
  see-through, its outline and text, so the bubble shows as the Designer shows it. Under no
  object a pill is a piece of the picture as it is: to move, copy or delete, not a vector.
- **What the Designer draws itself is left to it.** Under an object the Designer draws with a
  picture or colour of its own (a status, a value in its own bubble, an LED, a pump), what the
  picture has there is taken out and nothing is drawn in its place: only the Designer's object.
  Which kinds do is read from the Designer's own render definition: a picture of its own, or a
  picture, a colour or a border from its CSS class.
- **Starting again from the picture.** Editing a background that came from VectorCraft, the new
  tab first asks: go on with its drawing, or start again from the picture it was first read from
  (kept, hidden, in the drawing). For a drawing made before v1.48.0 starting again is what Enter
  does, since those versions drew the pills again. Starting again leaves out what was changed in
  VectorCraft before.
- A piece cut out of the picture is clear round its edge in the picture's own colour, not black,
  so it does not darken where it is drawn scaled.

Measured in the stub host, on the Maskin picture with objects of those kinds: after a sync the
bubbles under four bare-text values and the dark Ref pill are the picture's pixel for pixel (not
one differs). Under two statuses and a value with its own bubble there is the ground. 51 pills
became pieces of the picture, and none was drawn again. Both questions were answered, Start
again for an older drawing by Enter, and each read the original picture again.

**An older drawing mended, and a progress page that never stands still (v1.48.1).** The dark
rings stayed after 1.48.0 for those who went on with a drawing made by an earlier version. Its
pills under the values were vectors, drawn again from the first edit on, and every later edit
opened that drawing again. Starting again removed them, but with them everything drawn since.
Now going on mends such a drawing, and that is what Enter does:
- The pieces the old drawing drew again under the panel's objects are taken out: each group of
  its layer Komponenter an object covers by half or more.
- Its picture's own copy of a bubble there is taken out too.
- Each value that is bare text gets its bubble cut afresh from the picture the drawing came from
  (its hidden layer), as a fresh reading cuts it. Under an object the Designer draws itself
  nothing is put back.
- Everything else in the drawing stays: what you drew, moved or placed in VectorCraft since.

A drawing of v1.47.0, which already kept the bubbles exactly, is gone on with as it is. Measured
in the stub host on a drawing made the 1.46.0 way (six pills under objects drawn again, their
ring dark and 1.5 px off): Enter, then a sync. Under the four bare-text values and the dark Ref
pill, the bubbles are the picture's pixel for pixel; under the two statuses there is the ground.

The progress page's time now runs on by itself, in the tab's own timer: the clock, the running
step's own time, and the bar creeping on towards the step's end while nothing else is heard.
Reading the pills and the pipes held the page for seconds on a slow machine, and the tab with
it, so both now run in workers, and the ground's colour comes from the search's workers. What
each found place shows is checked a few at a time. Measured with the CPU slowed six times: the
page used to stand still for 4.2 s after the search; now the longest pause is 0.4 s, and the
editor starts after 4.3 s instead of 7.9 s.

**The black, at last (v1.48.2).** Moving the background in VectorCraft showed black pills
wherever bubbles had been taken out of the picture. The cause was there from the first reading
(v1.44.0) on. The panel's picture, `2349_Maskin.png`, has a transparent ground, and the Designer
shows its own grey (`#main_image`'s background colour) through it. Read on a bare canvas, that
ground is black, so a pill taken out was filled with "what lies round it", black, and opaque. The
black stayed hidden under the pill drawn again or the bubble carried, and showed as a dark rim
wherever that sat a little off, or whole when something moved. The test pictures had a solid
ground, so it never showed there.

Now the picture is read over the panel's own colour, as the Designer shows it, and what is taken
out of it is filled with that. Editing a drawing an earlier version made, Enter mends it: its
picture's pure black is filled in from the picture the drawing came from. The places of the pills
found there are erased to the real ground, since the drawing has each pill itself, as a vector, a
piece of the picture or in a placeholder. As in v1.48.1, a drawing whose bubbles were drawn again
also gets them cut afresh. Measured in the stub host with a copy of the Maskin picture whose ground
is transparent: read and synced by v1.46.0, its picture was black (0, 0, 0) where the bubbles had
been; mended by Enter in v1.48.2, and read afresh by v1.48.2, it has the panel's colour there, and
moving the background in VectorCraft shows no black.

**One button for the panel's .ai, and the plant's folder (v1.49.0).** The editor's banner had
three buttons: *Ready for Image Trace*, *Background from .ai…* and *Components from .ai…*. Both
.ai buttons asked for the same file, the panel's own Illustrator file (`2349_Maskin.ai`). Now
there is one, **Open plant .ai…** (*Plant .ai…* in v1.49.0). One file does both: its components
go to Libraries, replacing those kept, and its artboard opens in a new tab as vectors, to paste
in place as the background. The sharpened copy for Image Trace is a link beside it, *Image Trace
copy*.

And the file need not be looked for. Every plant has a folder of its own on the plants' share,
its name beginning with the plant's number (*2349 …*). Chrome lets an https page read a folder
the user picks (the File System Access API), so in the editor's tab:
- **Connect…** (*Connect the plants' folder…* in v1.49.0), once: pick the folder that holds
  every plant's own folder.
  It is kept in the editor site's storage; the browser asks again once a session (**Allow
  reading …**).
- The plant's own folder is found in it by the plant's number - since v1.50.0 also in the
  grouping folder whose number range holds it, as the share keeps them - and shown in the banner
  with its `.ai` files (three folders deep). The names of the plants' folders are kept for half a
  day, so that is quick after the first time; a plant not among them has them read again.
- **Open plant .ai…** then reads the plant's `.ai` files again and takes the panel's by itself: the one named after the panel - the
  words of its name, so *2313_Ventilasjon.ai* for *360.002 Ventilasjon* - that is not in an old
  or archived folder or named as a copy. When that is not clear, it lists the plant's `.ai`
  files, newest first, with **Another file…** under them. Without a connected folder, it asks
  for the file as before.
- In v1.49.0, **Give the path of the plants' folder…** let **Copy its path** copy the plant
  folder's full path for Explorer's address bar, as a browser cannot see a picked folder's path.
  Since v1.50.0 the folder's name in the banner opens it in Explorer instead (below).

Nothing about the share is in the script: its name and folders come from what is picked. The Designer's own page cannot do this (it is http, and Chrome lets only
an https page read folders), so it lives in the editor's tab. Measured in the stub host with a
plants' folder made in the editor site's own file system (`2313 Test anlegg` with
`Tegninger/2313_Ventilasjon.ai` and an archived copy, beside two other plants'): the banner showed
*2313 Test anlegg · 2 .ai files*, and **Plant .ai…** took `2313_Ventilasjon.ai` by itself. Its
386 components went to Libraries in 12 pages, and its artboard opened as a document. Not yet
tried on the real share.

**A banner that reads at a glance, and the plant's folder in Explorer (v1.50.0).** The banner
had grown into paragraphs. Now it says what to do in one line, *Ctrl+S → Enter syncs the drawing
to the Designer*, and then has a row for each thing there is:

| Row | Says | On hover |
|---|---|---|
| Plant folder | the plant's folder by name - a link that opens it in Explorer - and its `.ai` files | where it lies in the plants' folder |
| Components | *386 in Libraries (12 pages)* | what the components are, and how to use Libraries' pages |
| IWMAC objects | *72 in the IWMAC menu* | how to place one, and what a sync does with it |
| Drawing (v1.55.0) | *locked - only the IWMAC objects move · Unlock* | what is locked, and how to lock or unlock it |

Under them are **Open plant .ai…** and the link *Image Trace copy*, then the news, kept short:
*✓ Ready to sync*, *Sending…*, *✓ Synced 18:56 · 1 placed · 2 changed · 1 removed* (the name of
the PNG uploaded on hover), and anything that went wrong, a line each, in red.

**Explorer** comes from Anleggsmappe, the team's plant-folder tool, which registers links of
the form `anlegg://<plant number>`: such a link opens that plant's folder, found from the number
alone. The folder's name in the banner is one (*Open in Explorer* before the plants' folder is
connected). Versions 1.50.0 and 1.51.0 also had **Open plant folder** on the Designer's
sidebar; 1.51.1 took it off again. The script passes the plant's number on and knows nothing
else of the share. Followed by the page itself, such a link
fires the page's `beforeunload`, so the Designer's or VectorCraft's *Leave site?* could ask,
though the page stays; it is followed in a hidden frame instead. Measured in Chromium:
`beforeunload` fired at every click from the page, and at none from the frame, while the link
was still launched. The browser asks once whether to open such links: tick **Always allow**.
Without Anleggsmappe's links on the PC, nothing happens.

On the share, plant folders lie in grouping folders named by number range (`2300-2349`,
`6800-6849 SWE`), and v1.49.0 looked only directly in the plants' folder, so it found none
there. Now it also looks in the ranges that hold the plant's number. Up to three folders of one
number are read: the first is shown, the others counted (*+1*, named on hover), and their `.ai`
files are offered together. Measured in the stub host on a plants' folder laid out like the
share, whose folder names had been kept from before its grouping folders existed: they were read
again; *2300-2349 › 2313 COOP EXTRA Sveio* was found, with a second folder of that number in
*2300-2349 SWE*; and **Open plant .ai…** took `2313_Ventilasjon.ai` by itself.

**The plant's own .ai before a trace (v1.51.0).** When components are kept, *Edit in
VectorCraft…* reads the picture for them first (*Looking for them*, *Pills*, *Pipes*). Before it
starts, the editor's tab now offers the better way: the Illustrator file the picture was drawn
in, whose artboard is the whole picture as exact vectors. It shows:

- **Plant folder** - *Anlegg › 2300-2349 › 2349 COOP EXTRA Sveio*, a link that opens it in
  Explorer (*Open in Explorer* while its path is not known yet);
- **.ai files** - those VectorCraft's tab has seen in it, the panel's own first;
- a place to drop the `.ai`, dragged from that Explorer window, and **Choose the .ai file…**;
- **Trace the picture**, to go on as before.

The file chosen there goes to VectorCraft instead of a trace: the panel opens as it is, the
file's components go to Libraries in place of those kept, and its artboard opens as vectors in a
tab of its own, to paste in place as the background (Ctrl+A, Ctrl+C in its tab; the layer
*Bakgrunn* in the panel's tab; Ctrl+Shift+V). The file travels through Tampermonkey's storage, at
most 40 MB, and leaves it as soon as VectorCraft's tab has it.

In v1.51.0 and v1.52.0, the card's plant folder came from VectorCraft's tab, where the page could
not read folders itself. With the plants' folder connected there, that tab read its grouping
folders in the background and kept every plant's folder by number in Tampermonkey's storage.
Since v1.53.0, PANG tells the card where the folder is (below), and that index is gone.

Measured in the stub host:
- **The index.** A plants' folder laid out like the share, connected in VectorCraft's tab, gave
  every plant's folder by number, the plants' folder itself first and then the grouping folders
  in order, so the card shows the folder the banner shows. With components kept from
  `2349_Maskin.ai`, *Edit in VectorCraft…* then showed the card with *2300-2349 › 2313 COOP
  EXTRA Sveio +1* and the three `.ai` files seen, the panel's own first.
- **Explorer from the card.** The link launched `anlegg://2313`, without a `beforeunload`.
- **The .ai, chosen or dropped.** `2349_Maskin.ai`, chosen through the file chooser, went to
  VectorCraft without a trace: 386 components into Libraries, its artboard into a tab of its
  own, and the file out of Tampermonkey's storage. Dropped on the card, it did the same; a file
  that is no `.ai` was refused there.
- **Trace the picture.** It ran the steps as before: 52 places, 7 components, 58 pills and 37
  pipes, in 3 seconds.

**The card reads the plant's folder itself (v1.52.0).** Version 1.51.0 assumed the Designer is
served on http, where Chrome lets no page read folders. So the card showed only what VectorCraft's
tab had read. On a first edit that was nothing: just *Open in Explorer*, which does nothing on a
PC without Anleggsmappe's links. The Designer is served on https, though, and there Chrome lets
the page read a folder its user picks. So the card now does it itself:

- **Connect the plants' folder…**, once: choose the folder that holds every plant's folder
  (*Anlegg*). It is kept in the Designer site's storage. The browser asks again once a session,
  when **Open plant folder…** is clicked.
- The plant's folder is found by its number, by the same search as VectorCraft's banner. It is
  shown with its `.ai` files, the panel's own marked, and a click on one uses it.
- **Open plant folder…** opens the file dialog in the plant's folder, where the panel's file
  lies.
- If you choose the plant's own folder instead of the one that holds them all, it is used as it
  is and not kept.

Where the page cannot read folders (http), the card shows what VectorCraft's tab last read, as
in v1.51.0.

Measured in the stub host. Its page is on 127.0.0.1, which Chrome treats as secure, as it does
https. The folder dialog was stood in by the site's own file system, laid out like the share.

- **Connect.** The dialog was asked once and the folder kept. The card showed *2300-2349 › 2313
  COOP EXTRA Sveio +1* with three `.ai` files, the panel's own marked.
- **Open plant folder….** The file dialog opened in `Tegninger`.
- **A click on the file.** It was handed on (2,136 kB).
- **The next edit.** It found the folder without a click.
- **The plant's own folder chosen.** It was used and not kept.

**The plant's folder from PANG (v1.53.0).** PANG, IWMAC's plant admin, already knows where every
plant's folder is: its **Folder** button asks its own server (`get_folder_location`, at
`tools.iwmac.local/services/pang/folder.php`, no login needed) and opens the answer in Explorer
through `pang://folder`, a link type PANG's tools register on IWMAC's PCs. The card and
VectorCraft's banner now do the same, through Tampermonkey, as PANG is on another site:

- **Plant folder** shows the folder in full, as PANG tells it - such as
  `\\…\Anlegg\2300-2349\2349 COOP EXTRA Sveio` - with **Copy path**, for Explorer's or a file
  dialog's address bar. VectorCraft's banner shows its name.
- **Open plant folder** opens it in Explorer, as PANG's Folder button does. Nothing to install:
  Anleggsmappe's `anlegg://` link is used only when PANG has not answered.
- From there, drag the panel's `.ai` onto the card.
- On https, **List them here…** connects the folder that holds every plant's folder, once, and
  lists the plant's `.ai` files on the card, each used with a click (v1.52.0). It copies that
  folder's path, taken from PANG's answer, so it can be pasted in the dialog's address bar.

Nothing about the share is in the script: PANG says it, each time.

Measured: on IWMAC's network, PANG's service answered for plant 2349 without a login, with that
plant's folder. PANG's handler log shows the link form it receives from its own Folder button
(`pang://folder/?server=…&path=…`), which is the form the card writes. In the stub host, with
Tampermonkey's request answered as PANG answers:

- the card asked for plant 2313 in that form and showed the folder;
- **Open plant folder** linked to `pang://folder?server=…&path=…/2313%20COOP%20EXTRA%20Sveio`;
- **Copy path** copied the folder's path;
- **List them here…** copied the plants' folder's path, then listed the plant's `.ai` files, and a
  click on one handed it on;
- VectorCraft's banner showed the folder's name, linked to the same.

`pang://` is registered on the test PC, so the links were checked rather than clicked: there, a
click opens Chrome's prompt, which a headless browser cannot show.

**The .ai becomes the background by itself (v1.54.0; replaced in v1.55.0, below).** Until now the `.ai` opened in a tab of its
own, and making it the panel's background meant Ctrl+A and Ctrl+C there, then the layer *Bakgrunn*
and Ctrl+Shift+V in the panel's tab, and its IWMAC objects were not in that tab. Now the script
does it, both for the `.ai` chosen on the card and for **Open plant .ai…** in VectorCraft:

1. VectorCraft opens the file and reads its artboard as vectors. The script knows which document
   is in front from the window titles VectorCraft's web build reports in the console.
2. VectorCraft saves it as SVG, as Ctrl+S is made ready, and the script keeps that save.
3. The script builds the panel anew from it:
   - the file's own layers (for 2349: *Backround*, *Rør*, *Maskinrom*), named as in the file,
     sit just above *Bakgrunn*, scaled from the artboard to the panel if the sizes differ;
   - the picture moves under them, to *Bakgrunn (original)*;
   - the IWMAC objects stay on top as placeholders, as before.
4. The file's own tab closes (VectorCraft's File › Close), and so does the panel's old tab with
   **Open plant .ai…**; the new panel opens, and Ctrl+S is made ready for it.

**Open plant .ai…** starts from the panel as it stands in VectorCraft, so changes made there are
kept. On a panel that was traced:

- the trace's *Rør* and *Komponenter* go under *Bakgrunn* with the picture, as the file draws the
  same;
- the pieces of the picture a trace carried with the objects go.

VectorCraft's web build shows a layer marked hidden and saves it without that mark. So those
layers lie under *Bakgrunn*, whose plate of the panel's colour covers them, both in VectorCraft
and in the panel's PNG; they stay in the Layers panel.

The file's ids and CSS classes are prefixed, as both drawings may be VectorCraft's own saves, each
calling its classes `cls-1`, `cls-2`…. Without that, the panel's styles recoloured the file's
labels.

If a step fails, it is as before: the file in a tab of its own, with the steps to paste it in
place.

Measured in the stub host with `2349_Maskin.ai`:

- **From the card.** The file opened in 2.6 s, was saved for the script by 5.4 s, closed, and the
  panel opened with its layers at 6.4 s; all done, Libraries included, in 15 s.
- **The sync after it.** It carried the file's three layers, the six placeholders, and no picture
  in *Bakgrunn*.
- **Open plant .ai… on a traced panel.** Done in 13 s; the trace's layers lay under *Bakgrunn*, and
  5 carried pieces went.
- **Its labels.** They matched the file's own, as checked against the first run.

**The .ai opens as it is, and the drawing is locked under the objects (v1.55.0).** Thomas asked
for two things. Choosing an `.ai` should run no check of its vectors: it should open as
VectorCraft's File › Open opens it, and then ask whether to add the IWMAC Designer's objects to
it. And the background should not move, only what is on top of it. So, for the `.ai` chosen on
the card and for **Open plant .ai…** alike:

1. VectorCraft opens the file as a document, as its File › Open does. Nothing is read, saved,
   converted or merged. Its components are not read either: the components row offers that,
   *read them from 2349_Maskin.ai*. (Since v1.59.0 they are read, and go around its artboard:
   see below.)
2. A question in VectorCraft's look: **Add the panel's 6 objects** (Enter) or **Just the
   drawing** (Esc).
3. Added, the file's drawing is locked (Select All, then Object › Lock › Selection), the objects
   go on a new layer over it (*Layer 4* for 2349's three layers), and they are pasted in place,
   where they are on the panel.

The panel's own drawing opens the same way: the picture, a trace of it, or the VectorCraft
drawing behind the background. It opens without its objects and is locked, and they are pasted
in place on its layer *IWMAC-objekter*. A click or a drag on the drawing then moves nothing; only
the objects move. The banner's new row, **Drawing**, says *locked - only the IWMAC objects move ·
Unlock*. **Unlock** is VectorCraft's Object › Unlock All (Ctrl+Alt+2); Object › Lock › Selection
(Ctrl+2) locks what is selected again.

How the objects land where they were:

- VectorCraft takes a paste whose text is SVG as art, centred on the view's centre, and pastes
  it in place while Ctrl+Shift is held. The script sends such a paste event with the keys held,
  after Fit Artboard in Window (Ctrl+0) has put the view's centre on the artboard's.
- The SVG pasted holds a hidden frame, *IWMAC-ramme*, three artboards wide and centred on the
  artboard, so the centre of what is pasted is the artboard's too.
- On an `.ai` whose artboard is not the panel's size, the objects are scaled as the Designer
  lays that drawing on the panel: evenly, centred. The artboard's size is read from the file's
  own bytes (its first page's trim box).
- On the panel's drawing they go into *IWMAC-objekter*, because a paste goes to the current
  layer, and Select All makes the layer of the last object it selects the current one. That
  layer is last, and holds a transparent 1 × 1 anchor, *IWMAC-anker*, which is locked with the
  rest.

**Open plant .ai…** takes the objects as the panel's drawing has them at that moment, saved for
the script when Ctrl+S is ready. A placeholder moved there and not yet synced lands where it was
moved to.

A sync stays safe if a paste does not arrive:

- The frame says the objects' layer is in the save. A drawing with the anchor but no frame never
  got them: a sync then takes no object off the panel, and says *the drawing holds none of them*.
- The save that makes Ctrl+S ready also shows whether the objects arrived. If they did not, the
  banner offers to put them on again, or to open the panel with them, unlocked, as before. The
  Drawing row keeps *Put them on* after a sync's news has replaced that offer, and a save checks
  that they arrived the second time.
- Neither helper stays in the panel's picture.

**Just the drawing** syncs too: the drawing becomes the panel's background, and its objects stay
as they are.

Measured in the stub host with `2349_Maskin.ai` and six objects:

- **From the card.** The file opened in 2.8 s and the question showed at 2.9 s; after **Add**,
  the six placeholders were on *Layer 4* by 4.7 s. A drag on the background moved nothing. One
  placeholder dragged 100 × 50 px moved its object by 146, 73 at the sync; the other five stayed
  where they were, to the pixel.
- **A traced panel.** It opened at 2.5 s with its objects on *IWMAC-objekter*, and Ctrl+S was
  ready at 11.4 s. The sync after a drag moved one object; the frame and the anchor were in the
  save.
- **Open plant .ai… after that.** The `.ai` opened and Enter added the objects. The sync from it
  changed nothing: the moved placeholder came along where it was.
- **Just the drawing.** The sync held all six objects, and said why.
- **A paste that does not arrive** (blocked in the stub). The save that made Ctrl+S ready showed
  it; the sync held all six objects. *Put them on* in the Drawing row put them on, the check
  found them, and the next sync left all six where they were.

**The sync, made faster to use and harder to lose (v1.56.0).** Thomas asked for the sync from
VectorCraft to the Designer to be faster, more reliable and as automatic as it can be. It was
measured first, in his Chrome on plant 2349's *Maskin* panel (58 objects, traced), with the
upload stopped on its way so nothing reached the server:

| Step | Time |
|---|---|
| Ctrl+S → the chooser → Enter | a key press, a dialog and another key press |
| VectorCraft saves the SVG (Ctrl+S made ready) | 0.03 s |
| Tampermonkey carries it to the Designer tab | 0.03 s |
| The Designer: placeholders, picture, PNG, background, objects | about 1.1 s |
| The upload of the PNG (the server answers in 40-110 ms) | a moment more |
| The panel kept on the plant | the Designer's own *Compile Panel for Plant*, by hand |

So the time went to the steps by hand, not the computer. And a sync could be lost: the
Designer tab that began the edit was the only one listening, so after a reload of that tab,
or with another panel open in it, a sync went to Downloads or was refused. What changed:

- **Ctrl+S syncs at once.** No chooser; **Ctrl+Shift+S** is VectorCraft's own Save As, to
  Downloads.
- **Auto-sync**, in the banner's new row *Sync*: **By itself** syncs a moment after each
  change - VectorCraft marks its title with \* when the drawing changes - once nothing has been
  pressed, dragged or typed for 2 seconds. **Only on Ctrl+S** turns it off. Either is kept for
  the next edits. With no Designer tab answering, auto-sync pauses until the next Ctrl+S instead
  of filling Downloads.
- **The upload no longer holds the sync up.** The Designer sets the background and the objects,
  says *applied* at once, and uploads the PNG after; the banner says only when the upload
  failed.
- **Less to carry.** The SVG no longer brings VectorCraft's own copy of the document (*Preserve
  Editing Capabilities*): a sync changes the SVG that copy would have to match, so it was never
  reopened, and the Designer threw it away.
- **The right Designer tab, found.** Each edit is noted in Tampermonkey's storage with its plant
  and panel. When the tab that began it is gone - closed, reloaded - another Designer tab of the
  plant takes the sync after 3 seconds. Such a tab does not take objects off: it cannot tell an
  object deleted in VectorCraft from one renamed since, and says so.
- **The right panel, waited for.** A sync that comes while the Designer shows another panel waits,
  kept in the storage; the banner says *Waiting*. It goes on as soon as that panel is open again
  in a Designer tab of the plant.
- **The objects put on, whatever the window.** The objects are put on the drawing as soon as the
  tab is in front, no longer only once the window has the focus too: while another window was in
  front, or a screenshot was being taken, the drawing stood there unlocked and without its
  objects. The pointer and the keyboard are kept off VectorCraft while it happens. If the save
  that makes Ctrl+S ready shows them missing, they are put on once more by themselves before the
  banner says so.

Measured in the stub host, with six objects:

- **Ctrl+S.** *✓ Synced* 0.3 s after the key, while the stand-in server took 1.5 s over the
  upload.
- **Auto-sync.** Synced by itself 2.9 s after a drag, and that object moved in the Designer.
- **Another panel open.** The sync waited, then moved the object once the panel was back.
- **The first Designer tab closed.** A second tab of the plant took the sync and moved the
  object, 3.7 s after the key.
- **Less to carry.** The SVG sent went from 509 kB to 106 kB for the plant's `.ai`, and from
  958 kB to 442 kB for a traced panel.

Left by hand: keeping the panel on the plant, the Designer's *Compile Panel for Plant*. It writes
the panel to the live plant, so it is not done by itself yet: that needs a test on a panel where
a compile does no harm.

**The plant's .ai offered on any computer (v1.55.1).** On another computer the card *Best result:
the plant's own .ai file* did not show. It came only before a trace, and there is a trace only
when components from an `.ai` are kept. Tampermonkey keeps them in one browser alone, so a
computer that had never read them got neither. Now the card shows whenever no VectorCraft drawing
is behind the panel's background, and it says what happens without the `.ai`:

| Components kept | Picture | The card says | Its other button |
|---|---|---|---|
| yes | yes | the picture is about to be traced | **Trace the picture** |
| no | yes | the picture is about to open as it is | **Open the picture** |
| - | no | VectorCraft is about to open an empty canvas | **Open an empty canvas** |

A panel whose background was synced from VectorCraft opens that drawing, as before, without the
card. **Open plant .ai…** in VectorCraft's banner works on any computer too.

A sync knows each object by its element on the canvas, not by its name, so it stays right
when names change between syncs: the Designer renames the objects when one is placed or taken
off. An object placed by a sync is known again at the next one too: moved, resized or deleted
in VectorCraft, the same happens to it in the Designer, instead of a second one being placed.

Measured in the stub host, on the Maskin picture with six objects on its frames: the L-T Sd
placeholder deleted, the Po placeholder moved 200 px, a value placed from the IWMAC menu, and
the Alarm pill (under no object) deleted. At the sync (0.3 s) the L-T Sd object came off the
panel and its frame out of the picture (the ground there, 229, 231, 234), Po moved with its
frame (gone from the old place, white in the new), the new value was placed, and the Alarm
pill's place shows the column's grey (205, 210, 215), not black. A second sync, after the new
value was moved 100 px and the Ref placeholder deleted: the new value moved (not placed again)
and Ref came off with its dark pill. Compared with the original picture, only those five
places differ much; elsewhere the redrawn vectors differ by 1.2 on average (out of 765). A
second edit put the three frames left back into their placeholders.

Your components from Illustrator arrive in VectorCraft's **Libraries** panel; once **Open
plant .ai…** has opened another file, the components row offers to read its own (v1.55.0), and since v1.59.0 that file's lie around its artboard as well. The Designer's own objects arrive there too, as
**IWMAC-objekter** (v1.40.0), and have a menu of their own in the bar, **IWMAC** (v1.41.0,
below). See [Komponenter](#komponenter-components-from-illustrator-v1330-in-vectorcrafts-libraries-since-v1370).
The banner sits at the drawing's top left. It folds into a one-line tab 20 seconds after the
panel opens, and again 12 seconds after each message. A click on its title folds or unfolds
it, and after that it stays as you left it.

**Sending it back (v1.42.0).** In VectorCraft, press **Ctrl+S** (since v1.56.0 it syncs at
once; until then it offered *Sync to IWMAC Designer* or *Save a file…* first). The drawing goes
to the Designer tab the edit started from, which draws it at panel size and makes it the
background through the host's own `iw_set_base_image`. **Ctrl+Shift+S** is VectorCraft's own
Save As, its file to Downloads. The banner then reports one of these (shorter since v1.50.0):

- *Updating the panel…*;
- *✓ Synced 09:44*, with how many IWMAC objects were placed, changed and removed, and on hover
  the name the PNG was uploaded under (v1.42.0);
- *Not synced:* and the reason.

Keep editing and sync as often as you like. The panel itself is not saved until you use the
Designer's own Save.

VectorCraft offers no way in other than its own Save, so the sync uses it:
- A document VectorCraft has saved as SVG once is saved again straight away: a sync takes a
  moment.
- **Ctrl+S is made ready when the panel opens (v1.46.0).** VectorCraft's first save of a
  document is its Save As, so the script answers that once, right after the panel and the
  libraries are in, while the tab is in front. That save stays in the tab and goes nowhere.
  The banner then says *✓ Ready to sync*. Every sync after that is VectorCraft's own Save, without a
  dialog: Ctrl+S, and the Designer has it, measured at 0.2 seconds. While it is being
  made ready (about 3 seconds), keys typed are held back from VectorCraft's dialog.
- When it could not be made ready - and for a plant's `.ai`, which is not saved as it opens - the
  first sync answers the Save As instead: Format **SVG**, OK, OK (until v1.56.0 also **Preserve
  Editing Capabilities**). Since v1.57.0 it does so from the keyboard, out of sight:
  - VectorCraft's web Save As starts on its own format, for a drawing opened from SVG or `.ai`
    alike. Tab takes the keyboard from the file name to the Format menu, Space opens it, five
    Tabs reach SVG, Space takes it, Enter is OK, and Enter again in SVG Options.
  - The keys go straight to VectorCraft's canvas while the dialog's field keeps the keyboard, so
    nothing depends on where the dialogs sit.
  - A card in VectorCraft's look, *Syncing to the IWMAC Designer…*, covers the dialogs
    meanwhile, and the pointer is kept off them.
  - Where the keys did not get there, the dialogs are closed again and the clicks of earlier
    versions take over: where those dialogs sit, centred in the window, once VectorCraft's own
    text field shows that the dialog is open (2.9 seconds in front, 78 seconds behind another
    tab, measured in v1.46.0).
  - Measured in the stub host: no click, 1.9 s from Ctrl+S to the Designer's answer, where the
    clicks took 3.9 s. With the keys sent wrong on purpose, the clicks took over and it still
    saved as SVG, in 4.6 s.
- A save that comes out in another format meanwhile is held back, and Save As is tried again
  more slowly.
- If it still does not save, the dialogs it opened are closed again, and the banner says *Not
  synced* with **Try again**: nothing is left to finish by hand (v1.57.0).

**Labels at their own size, in their own font (v1.58.0).** After a sync of the plant's `.ai`, the
panel's labels came out bigger and ran into each other. VectorCraft styles the SVG's text with
classes like `font-family:Roboto;font-size:12`. CSS takes no bare number for a font size, so the
browser that drew the panel's picture used its own size instead: 16 px in an image. And Roboto,
the drawings' font, is no Windows font. So the Designer now draws the synced SVG like this:

- The font sizes and letter spacing get their unit (`12px`), and a family without a generic
  fallback gets `sans-serif`.
- A font the machine lacks is fetched from Google Fonts: its latin faces, regular and bold. It is
  kept a month in Tampermonkey's storage and written into the SVG as `@font-face` before it is
  drawn. A family Google Fonts does not have is drawn with `sans-serif`. A web font of the
  Designer page's own counts as missing, since no image draws with it, and a font the SVG
  brings along itself is not fetched.
- Should the browser not draw the SVG so changed, it is drawn as it came.
- The SVG kept in the PNG for the next edit stays as VectorCraft saved it.

Measured in the stub host, whose machine has no Roboto: 2349's labels came out at 12 px in
Roboto, as the plant's own picture shows them (*Pc Bar*, *Run Cap. %* and *Capacity %* side by
side again). The first sync fetched Roboto and Source Sans 3: four files, about 160 kB, since
Google serves both weights of each in one file. Later syncs take them from the storage. A panel
synced before v1.58.0 is drawn right at its next sync.

**The components around the artboard (v1.59.0).** Thomas asked for the objects of an `.ai`
outside its artboard to be there in VectorCraft too, so they are easy to pick. VectorCraft's own
`.ai` reader leaves that art out: `2349_Maskin.ai` comes in as its PDF page, and its 386
components were only in Libraries, twelve pages of them. Now the `.ai` opened from the card or
with **Open plant .ai…** gets them where the file keeps them, as Illustrator shows them:

- They are read while the question about the IWMAC objects waits. After it is answered, either
  way, they are pasted on a new layer over the rest, nothing locked. Each is a group of its own,
  so a click takes one: drag it onto the drawing, or Alt+drag a copy. Then **Fit All in Window**
  shows the artboard with all of them; **Ctrl+0** fits the artboard again.
- VectorCraft pastes SVG centred on the view, so two hidden squares at opposite corners, off the
  artboard, centre the paste on the artboard's centre and each component lands where it was.
- VectorCraft's Save As SVG keeps the artboard as its viewBox but writes everything, the art
  around it too. So the Designer leaves out of what it keeps every component still wholly off
  the panel's picture, measured as the panel draws it. One moved onto the drawing, if only
  partly, stays and is drawn.
- The components row says how many are around the artboard; **into Libraries too** puts them
  there as before.

Measured in the stub host with `2349_Maskin.ai`: the 386 components were in place 1.7 s after
*Just the drawing* and 2.8 s after *Add*, objects included. One dragged onto the drawing was a
single group of 53 x 53 pt. The save VectorCraft made was 536-539 kB with all 386. What the
panel's PNG kept was 107-110 kB of SVG (24-25 kB packed), with only the one dragged on.

**The PNG on the server (v1.42.0).** Each sync also uploads the background's PNG to the plant's
pictures, as Manage Images' *Upload to server* does. It is the same request
(`designer_site/iw_upload_image.php`, field `userfile`), read the same way. The panel then
carries that name, as *Set background* sets it, through the host's own `imagesetValue`.
- The name follows the plants' own pictures: plant, panel and day, as in
  `2349_Maskin_111026.png`.
- The first sync of an edit picks the name. Later ones write over it.
- A picture that this script did not upload is never written over: the name gets `-2`, `-3`
  instead. The script notes what it uploaded in Tampermonkey's storage.
- If the upload is refused, the background is set all the same, and the toast and the banner
  say why.
- The PNG carries the VectorCraft document in its `iwVz` chunk, like the background.

**The next edit.** The PNG keeps the saved SVG, with VectorCraft's own document inside it,
in a private chunk that viewers skip: `iwVz`, zlib-compressed, since v1.38.0 (`iwVc`, plain,
before). *Edit in VectorCraft* on that background reopens exactly that document, with its
layers and editable shapes, not a flattened picture. A background drawn in Draw over a
VectorCraft document (v1.35.0) brings that drawing along as a layer of its own, *Tegning
(Designer)*. Saved without *Preserve Editing Capabilities*, the SVG is kept all the same: the
next edit opens its layers and paths, without VectorCraft's own extras.

**Keeping the picture light (v1.38.0).** Every viewer of a panel loads its background PNG,
so the document in it is compressed. A panel with its picture and a few shapes went from
572 kB to 440 kB. When even the compressed document would pass 1 MB, which a traced panel
does, it is kept without VectorCraft's own copy (the `<vectorcraft:document>` inside
`<metadata>`). What VectorCraft draws stays as it was, so the next edit opens the same layers
and paths, and the toast says so.

**Making the picture into vectors (v1.38.0).** VectorCraft's own **Image Trace** turns a
picture into shapes, but a panel picture traced as it is loses its small text, and its
anti-aliased edges become slivers. Measured on a Maskin panel (1400 × 750):

| Traced as | Result |
|---|---|
| the picture as it is, 16 Colors | the labels break up, the edges are jagged |
| enlarged 3× smoothly, 16 Colors | every in-between shade of an edge a shape of its own: 38,535 paths, 32 MB |
| enlarged 3×, 6 Colors | 5,657 paths, but the pipe colours run together |
| enlarged 3×, VectorCraft's Automatic palette | 99,298 paths: it no longer sees flat art |
| **enlarged 3× and set to the picture's own 12 flat colours, 16 Colors** | **the right colours, the labels whole, 6,155 paths** |

*Image Trace copy* (a link in the banner of the editor's tab, so named since v1.50.0: *A copy
with the picture sharpened* in v1.49.0, the button **Ready for Image Trace** before) makes that
last kind:
- It enlarges the picture three times (less for a big one: at most 12 million pixels).
- It sets every pixel to the picture's own flat colours. Those are its exact colours that
  cover at least 0.02 % of it, with near-twins merged. The in-between shades of anti-aliased
  edges are left out: a colour on the line between two others, rarer than half the rarer of
  them.
- It opens the result as a new document in the same VectorCraft, `<panel>-trace.svg`, with the
  panel's layers and objects as they opened.

Then:
1. Select the picture.
2. **Image Trace ▾** (Quick Actions, on the right) → **16 Colors**.
3. **Expand**.
4. Save from that tab as usual; the Designer takes it like any other save.

For the panel above it took two seconds to prepare and under a minute to trace. The save was
9.4 MB, 2.4 MB compressed, and kept as plain SVG at 513 kB: the PNG came to 726 kB. Do it
before editing, as the copy starts from the panel as it opened.

A picture that is not made of flat colours (a photo) is refused with a note. Traced, it
would be thousands of specks.

A fully traced panel is thousands of paths. Often it is better to keep the picture, and trace
or draw only what is to change.

**The panel's own .ai as its background (v1.39.0).** Maskin artwork is drawn in Illustrator.
When the panel's `.ai` is at hand, it is the exact vector version of the picture, and lighter
than any trace. **Open plant .ai…** (**Plant .ai…** in v1.49.0, **Background from .ai…** before), in the banner, opens it
in the same VectorCraft as a document of its own. VectorCraft reads its artboard as vectors, with the text as outlines.
Then:
1. In that tab, **Ctrl+A** and **Ctrl+C**.
2. In the panel's tab, click the **Bakgrunn** layer in Layers.
3. **Ctrl+Shift+V** (Edit ▸ Paste in Place). It lands where it was on the artboard.
4. Hide or delete the old picture, and save as usual.

Measured with `2349_Maskin.ai`: 436 objects at X 705.595, Y 375, W 1388.809, H 750 in the
.ai, and the same numbers after Paste in Place on the panel. That works because the panel's
document and the .ai have the same artboard, 1400 × 750, one point to a pixel. A file whose
artboard has another size lands where it was on its own artboard: scale it to fit. The file
is only read in the browser; nothing is uploaded.

**The Designer's own objects (v1.40.0).** VectorCraft's **Libraries** panel also gets
**IWMAC-objekter**: a placeholder for each of the 72 object ids in the script's catalogue,
grouped by role (Headers, Labels, Values, Values with connector, … Buttons). The search field
finds them by id: `fan`, `value_only`, `alarm`. A placeholder is a group named
`IWMAC <obj_id>` in a dashed box.

1. Drag one onto the drawing, where the object goes, or place it from the **IWMAC** menu
   (below). Resize it if the object should be bigger.
2. A label or the header shows a text of its own, and an object with a tag shows its tag. Write
   over it with the Type tool, and it becomes the object's tag text: JV401 on a fan.
3. Save as usual.

**As the Designer draws them (v1.43.0).** A placeholder shows the Designer's own picture of the
object, at the size the Designer draws it.
- The size is the object's render definition, as production panels place it: a "40px Box"
  42 × 22, the header 250 × 20, an AK-PC group 81 × 21. Before, the palette's sizes were used
  (50 × 20, 60 × 25, 80 × 80). Labels size to their text in the Designer, and are placed 50 × 20.
- The picture is the one the Designer shows for the object, from its own `/iw_icons/`: the fan,
  the pump, the value box, the "Alarm" pill.
  - A label shows its text at its own size and weight.
  - The header shows its bar with its text.
  - An object with a tag shows the default tag under it (JV50, RT-XX).
- The Designer's tab takes both from the Designer itself when *Edit in VectorCraft* opens: its
  live render definitions (`controls`) and the pictures as PNG. It keeps them in Tampermonkey's
  storage for a week. Without them, a placeholder is the light box of v1.40.0.
- The IWMAC menu shows the same pictures.

**As the Designer paints them, stacked as it stacks them (v1.60.0).** Thomas opened panel
360.001 of plant 10251 in VectorCraft and found objects missing. Its picture is blank
(`00-blank-sidebar-1400x750`): the drawing is its 123 objects. For 70 of them, of 34 kinds, the
render definition has no picture of its own, and the Designer paints them by their CSS class.
- **What went wrong.** A pipe's class repeats its 50 px picture along it (`repeat-x`), a coil's
  picture sits 14 px down, and a value box has a colour, a border and round corners. Instead,
  the catalogue's picture was squeezed into the box: a 1025 px pipe showed as one short piece
  in its middle. Bends, which the catalogue lacks, came as empty boxes named `number_v3_…`.
- **Painted as its class paints it.** Each such object is now painted at its own size. An
  element of its classes is laid out out of sight, and its background colour, its picture
  (placed and repeated as the CSS says), its border and rounding go into a PNG. The IWMAC
  menu's pictures of such kinds are painted the same way, from the class's own picture rather
  than the catalogue's.
- **Tags.** The tag text goes where the Designer writes it, at its size: JV501 over its fan,
  RT502 °C over its value box.
- **Stacking.** The placeholders are stacked by their zIndex. The room of 360.001 (z 40) came
  after RT600's value (z 110) and label (z 1100) in the panel's list, and was laid over them.
- **The kept looks** in Tampermonkey's storage are made anew once. A picture that failed to load
  is fetched again next time, instead of being kept missing for a week.

Measured on the live Designer, read-only, with 360.001's objects from its API: 70 objects
painted in 0.5 s and 54 tags placed, in a 192 kB layer. Drawn, it matches the Designer's own
view of the panel, pipes, bends, coils, rotor and room included.

The Designer takes each placeholder out of the picture and places that object on the panel,
at the placeholder's position and size. It uses the Designer's own loader, as Insert does. The
objects arrive unlinked. Their stacking order is that of the panel's own objects of the same
kind or role, or else the band for the role: 5 headers and ducts, 40 equipment, 110 values, 375
alarms, LEDs, pumps and valves, 1100 labels. The toast and the banner count them.

A placeholder becomes its object once. Since v1.47.0 the syncs after it, in the same editor
tab, know it as that object: moved, resized or deleted there, the object is moved, resized or
taken off. (Before, a moved one was placed again.) In a later edit it is one of the panel's
objects, with a placeholder of its own.

**The panel's own objects (v1.46.0).** The placeholders on the layer **IWMAC-objekter** stand
for objects that are already on the panel. Each says which object it is: its name on the
panel (`object_12`), its obj_id and where it was, as `data-iwdie-*` attributes, which
VectorCraft keeps through a save. A sync then changes that object instead of placing another:
- Moved or resized in VectorCraft, the object moves or is resized on the panel. It keeps its
  link, its driver and everything else about it.
- Its text written over (JV401 → JV402, a label's text), its tag text changes.
- Left as it was (a pixel either way), it is left alone.
- Deleted in VectorCraft, the object is taken off the panel at the sync (v1.47.0; before, it
  stayed). See *Deleting left black* above for when it is not.
- Copied in VectorCraft (Alt+drag), the copy becomes a new object of its kind, even one outside
  the catalogue.
- If the panel's objects were renamed meanwhile, as deleting one in the Designer renames
  them, the object is found by its kind and where it was.
- A placeholder whose object is no longer on the panel places nothing, and the toast says so
  (v1.46.1). Placing it would bring back what was deleted in the Designer.

Their pictures are the Designer's own: for every kind on the panel, not only the catalogue's
72, the script takes the Designer's render definition and picture from `/iw_icons/`, as for
the menu, and keeps them in Tampermonkey's storage for a week. The objects are changed on the
Designer's canvas, where its Save reads them: the element's place and size, and its
`tag_text`. Measured in the stub host: a placeholder dragged 200 px moved its object from 20
to 220 px at the sync, and the two others stayed as they were. Not yet tried in the live
Designer.

The picture is then kept without VectorCraft's own copy of the document, which still holds the
placeholders, so the next edit opens what is left, as layers and paths. A hidden placeholder
stays as it is and becomes nothing. Keep each placeholder a group with its name: the name is
what makes it one.

Nothing is kept on GitHub. The library and the menu are made from the script's catalogue each
time the editor opens, so they always match the script.

Measured in the hosted build: a fan, a value and a label were dragged from the library, and
the fan's text was written over. The saved SVG named them, as in
`<g id="IWMAC_V3_58px_fan_left_nrm" data-name="IWMAC V3_58px_fan_left_nrm">`. They became three
objects at the placeholders' positions and sizes, the fan with its text as tag text. Saved
again with the value moved, the other two were skipped.

**The IWMAC menu (v1.41.0).** VectorCraft draws its own menus on its canvas, and they take
nothing from outside: an item in the **Object** menu would mean changing the app, and the
hosted build stays unmodified. So the objects have a menu of their own in the same bar,
**IWMAC**, after *Help*, drawn in VectorCraft's own style.
- Each role opens a submenu of its objects, with a preview, the description and the size.
- The search field at the top finds objects by id, description or role: `fan`, `value tag 45`.
  **Enter** takes the first one found.
- Choose one, then click where it goes on the drawing. It lands centred there as one group
  named `IWMAC <obj_id>`, selected, as one dragged from Libraries.
- Hold **Shift** while clicking to place more of the same. **Esc** stops, and so does a click
  off the drawing, which places nothing.
- What is typed in the search stays out of VectorCraft's shortcuts, and the keyboard is
  VectorCraft's again once something is placed.
- Your kept components are in it too (v1.45.0), under **Komponenter**: a submenu for each of
  their Illustrator layers, with a picture of each component, its name and size. The search
  finds them by name. They are placed the same way, as a group named after the component.
  VectorCraft's own **Libraries** panel does not scroll (0.9.0), so a big library cannot be seen
  whole there; the menu's lists scroll.

**Libraries in pages that fit (v1.47.0).** VectorCraft 0.9.0 draws its Libraries panel without
a scroll area (its Properties panel has one; Libraries has none, in the dock or floating), so
what does not fit the panel's height cannot be reached at all. The script cannot change the
hosted app, so it sends each library in pages small enough to show whole, each a library of
its own in the list at the top of Libraries:
- How many fit is worked out from the window's height, at four graphics a row (the dock's own
  width): 36 at a window 900 px high.
- A layer of the `.ai` goes whole onto a page while it fits; small ones share a page, each a
  group of it; a bigger one is spread over pages of its own, named *Komponenter v1 1/4 -
  2349_Maskin.ai* and on.
- Twins (the same size and picture) in one layer show once.
- The IWMAC objects the same way, by role: *IWMAC-objekter: Headers, Labels, …*. Two kinds that
  look alike both stay.
- All pages go in with one drop. The first page of the components is the one Libraries shows.

With `2349_Maskin.ai`'s 386 components: 12 pages; the 72 IWMAC object kinds: 4.

Measured in the hosted build: a fan found by the search, two values placed with Shift held, and
a label from its submenu. The save named them `IWMAC_V3_58px_fan_left_nrm`,
`IWMAC_number_v3_value_only`, `IWMAC_number_v3_value_only-2` and
`IWMAC_number_v3_label_11px_norm`, and they became four objects where they were clicked.

When a VectorCraft tab was closed with unsaved changes, the next one asks to *Recover
Documents*: choose *Discard* unless you want them back.

**What it refuses, and why:**

- **The wrong panel.** The Designer changes panels without reloading the page. A save that
  arrives while another panel is open is refused, in both tabs. Open the panel again, then
  save again in VectorCraft.
- **No Designer tab answers within 8 seconds.** The tab may have been closed, reloaded or
  discarded by the browser. The SVG then goes to **Downloads**, so no work is lost. Open
  *Edit in VectorCraft* again from the Designer to send work back.
- **SVG Compressed** goes to Downloads, and the banner says to choose **SVG**.

**How it works.** The script runs on both pages: Tampermonkey asks once to allow the new
`@match` for the editor's page, and the storage permissions (`GM_setValue`, `GM_getValue`,
`GM_deleteValue`, `GM_addValueChangeListener`). The flow:

1. The Designer writes the job (the SVG, the panel and the plant) to Tampermonkey's own
   storage. It then opens the editor at `…/app/#job=<id>`.
2. On the editor's page the script drops that SVG on the canvas, as you would by hand.
3. When the editor saves, the script catches the SVG and answers the Designer through the
   same storage.
4. The Designer acknowledges each save.

The hosted files stay exactly as released. The script only adds the banner and catches the
save while the page runs. Nothing leaves the browser: the editor is a static page, and the
panel goes from tab to tab through Tampermonkey's storage.

**The hosted copy.** It is VectorCraft's official web build 0.9.0, byte for byte, with its
licences and notices. To move to a newer release, run the repository's *Update VectorCraft*
workflow with the release tag.

The ArtCraft name and marks belong to the ArtCraft team and are not open source. They appear
only inside that unmodified build, as its brand terms allow. This script's own dialog follows
VectorCraft's colours but carries none of those marks. VectorCraft calls itself alpha.

The kit's `tests/test-vectorcraft-bridge.js` holds the SVG the Designer sends, the sizing,
the merge, the PNG chunk, the component library as a `.vclibrary`, the script header and the
sidebar. It also holds the IWMAC objects: the library, the names, the placeholders taken out
and made into objects, the menu's placeholder files and search, the sync's upload (the name,
the server's list and its answer), and the objects' looks. And the components found in the
picture: the search on a made-up picture, run as the worker runs it, the picture with them
taken out, and their groups turned as they were found. And (v1.45.0) a made-up pill measured to
a tenth of a pixel, its name, its SVG and its erasing; a box that is no pill; a library pill known
as one; a pipe round a corner, its width, and a letter's stroke left alone; a component's absent
stub left out; and the job's layers with Rør. And (v1.46.0) the panel's objects as
placeholders - each with its picture, its tag text and which object it is - what a sync asks of
the panel (moved, relabelled, resized, found again after a renaming, new, gone), and Ctrl+S
made ready.

## AI-generated panels (Copilot)

Insert JSON also takes **AI-authored** files — generate a panel from a P&ID or system description and insert it, then link the objects by hand. The authoring kit lives in the private `tampermonkey-scripts-documents` repository.

### When the AI's file is rejected (v1.7.0)

An AI that cannot reach its knowledge files does not fail loudly — it improvises a document *about* a panel and hands that over instead, and the old error (`Unknown format "…"`) said nothing a user could act on. Insert JSON now explains the refusal and hands back a correction you can paste straight into the chat. Three causes are named separately:

| What the AI did | What the dialog now says |
|---|---|
| Invented a format (`"IWMAC Designer demo specification"`, `source_note` explaining it could not open the reference) | Names it as a document written *about* a panel, lists the top-level keys and reports `single_objects[]: not found`. The correction tells the agent to **report an unreadable knowledge file and stop**, never to substitute one it wrote |
| Was cut off mid-answer | Counts the unclosed brackets and says the answer was truncated — with the advice to attach a `.json` file rather than paste a long panel into chat, and never to emit `... (truncated)` |
| Produced a valid wrapper with broken objects | Lists the offending indices — which objects have no `obj_id`, which have unusable geometry |

Each case renders a **📋 Copy the fix for the AI** button. The copied text carries the required envelope skeleton, all 17 object fields, and the rules that reject or silently break a file — including that a non-numeric coordinate lands the object at 0,0 while `"120px"` is quietly read as `120`. Nothing is imported in any of these cases; the canvas is untouched.

Canonical plant `9099` is outside that MENY batch: panel `360.001 Ventilasjon` joins `V01` to the exact live inventory name `360.001Ventilasjon`. The spaced SQL sample is sample/stale formatting and does not override the live inventory; `ventilation_demo_360001.json` remains outside production totals, and is not a file in this repository — it was an uncommitted session artifact, kept in the corpus only as a named counter-example.

## How it integrates

- The sidebar is static HTML loaded with `innerHTML +=` — that re-serializes existing children and silently kills `addEventListener` handlers, so the injected buttons use **inline `onclick` attributes** calling `window.__IWDIE.*` (exactly how the host's own sidebar buttons survive). An idempotent interval re-adds/de-dupes the fieldset if the sidebar is ever re-rendered.
- **Export** calls the host's own collector `getPanelDataFromDOM(...)` (the same function the designer's save uses) after mirroring the host's pre-save global resets — no DOM re-implementation, byte-compatible documents.
- **Insert** drives the host's own loaders (`DesignPanelHandler.load_new_ver_objects` / `load_new_ver_containers` — the code path behind the designer's template insert), then renumbers `object_N` names from the live child index (the same policy as the designer's `Duplicator` paste) and runs `UpdateObjectWorker()`.
- **Replace** clears the canvas the way the host's own full-panel load does — `objectList.clear()`, `designContainers.clear()`, `table_container.clear()`, then `#control_container` emptied and the graphics registry reset, mirroring `DesignPanelHandler.renderPanel`. The hidden `#objects_landing_field` is preserved, and the graphics registry reset is what lets an import's own graphics load (`loadedGraphic.loader` replaces rather than merges). DOM only: no request is made, so the stored panel is untouched until Save.
- Background embed/apply uses the host's own `converted:"true"` + `image_data` document format consumed by `renderPanel`/`iw_set_base_image`.
- Console surface: `window.__IWDIE` (`doExport`, `openImportPanel`, `applyImport`, `doExportBackgroundAi`, `_collect`). Pure helpers are `module.exports`-ed for Node unit checks (incl. `buildImagePdf` — the PDF writer is pure/synchronous and structurally unit-tested: header, MediaBox, stream lengths, xref offsets).

Host internals, object catalogues, and probe artifacts live in the private `tampermonkey-scripts-documents` repository.

**Round-trip verified live:** export → insert on a fresh panel → host Compile → server fetch-back came back field-identical for every object, background included; the copy loaded 1:1 after a full reload. (One host quirk found: newly compiled panels always land `visible=1` — the save popup's Visible field is ignored on insert.)
