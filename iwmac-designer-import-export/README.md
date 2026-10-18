# IWMAC Designer Import/Export

Adds a **Panel JSON** section to the IWMAC Designer's manager sidebar (right below *Manage Files*) with four stacked buttons — **Export JSON**, **Insert JSON…**, **Edit in VectorCraft…**, **Background → Illustrator** — so a panel's complete look (objects, containers, graphics, background image) can be copied out as a single `.json` file and inserted into another panel, on the same plant or a different one, the background artwork can be edited as vectors in a browser editor, and it can be handed to Adobe Illustrator for editing. The designer itself has no way to do any of these; this script adds them.

Runs on `http(s)://legacy.iwmac.local/iwmac_designer_v4/?plant_id=<id>` ("IWMAC Designer V5"). Since v1.35.0 it also runs on the hosted vector editor, `https://hapnes-dev.github.io/iwmac-vector/app/`, for [Edit in VectorCraft](#edit-in-vectorcraft-v1350); Tampermonkey asks once to allow that, and Tampermonkey's storage, when it updates.

## Install

👉 [**Install IWMAC Designer Import/Export**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js)

Requires Tampermonkey. Auto-updates on every `@version` bump.

## Workflow: copy a panel's style to a new panel / another plant

1. Open the designer on the **source** plant, *Retrieve → Load* the panel you want to copy.
2. Click **Export JSON** to download `iwmac-panel_<plant>_<name>_<stamp>.json`. Since v1.83.0 a picture of pixels is
   read first, as Edit in VectorCraft reads it: the file holds the panel as an edit there would leave it, its words as
   labels and the objects it shows as objects ([below](#export-json-gives-the-panel-as-edit-in-vectorcraft-makes-it-v1830)).
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

**Always there (v1.70.0).** With nothing imported, Libraries and the IWMAC menu still offer the
house components: the Maskin template's, built into this script. Of its 418, 386 are offered. Left
out are those an IWMAC object shows: LEDs, alarm bells, state pills, switches, clocks and *no
connection*. The IWMAC menu places the live object instead. A plant's `.ai` read here comes first;
the template fills in the names it lacks. Since v1.72.0 the Oversikt template's floor plan kit is
built in too: 585 in all, its own on the pages *Oversikt kjøl*, *Oversikt frys* and *Oversikt*. Since v1.75.0 its
28 arrangements follow, each one group: 613 in all. The
banner says where they came from: *585 from the house templates, built in*, or *N from
2349_Maskin.ai and the house templates*.

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

### Named by the Maskin template (v1.63.0)

The Maskin template keeps 418 components around its artboard and names six of them. In
Libraries and in the IWMAC menu the rest were *Komponenter v1 23*. A plant's own Maskin `.ai`
is drawn from the template: 382 of `2349_Maskin.ai`'s 386 components are the template's, drawn
the same. So the script now carries a table of the template's components, `IWDIE_SYMBOLS`, and
names every component it reads that matches one, from whichever file it came. Examples:
*Kompressor*, *KompressorAv*, *Gaskjøler4Lav*, *BeholderNivå*, *Varmeveksler*, *Motorventil*,
*Treveisventil*, *Pil*, *Føler*, *KjølGrader*, *PilleMørk*.

- **What the table holds.** It carries no drawing, only names. For each way the template draws a
  component it has a hash of what it is drawn of: each shape's kind, its path letters, colours,
  stroke width and fill rule, with no coordinate. It also has the component's size and two points:
  where its first shape starts, and where all its shapes start on average. A copy turned or
  mirrored starts its paths elsewhere, so a left arrow is told from a right one. 309 entries in
  114 families, about 18 kB.
- **Turned copies.** A family is one symbol at its sizes and turns. The template draws its valves
  turned with the motor's "m" still upright, and its tanks lying as well as standing. The table
  says how each copy is turned against the family's own.
- **What it names.** A name Illustrator gave stays the component's own, and the table's says what
  it is. The table's names are not stored as the component's own, so a later table can name better.
  The components around an opened `.ai`'s artboard and those found in a picture are named the
  same way.
- **Not offered to a drawing.** Pipe pieces and colour samples get a name but are not offered. So
  is what an IWMAC object shows on a live panel: an alarm bell, an LED, a state pill, a switch or a
  clock.

A drawing can now place these symbols by name instead of drawing them; see *House symbols by name*
under *File format*. The kit's `reference_data/maskin-symbols.json` lists them, what each is and
the sizes it comes in, and `maskin-symbols.png` shows them.
`tests/test-named-components.js` holds the table to the template: all 418 named, the right ones
by the right names, each turned copy told apart.

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
| Empty canvas on **export** | Not an error since v1.11.0 — the background picture is downloaded as-is plus a background-only envelope, so an unlinked *Oversikt* can still be handed to an AI. With no picture either, the plant's overview alone (v1.62.0), to draw a new panel from |
| Plant data for an AI agent | Every export carries `overview` (v1.62.0): the plant's units, the parameter rows of the units the panel shows, its tagged signals, the panel's links checked against them, and the picture's layout and style - for an agent that draws or links an overview picture |
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
  "contents": {
    // v1.76.0 — what the file holds and where: the panel in a sentence, each key's
    // size in kB and its use (read first, read, search, copy from, look up, skip),
    // the -for-ai.png beside it, and Insert's own check of the file as exported
  },
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
  "overview": {
    // v1.62.0 — the plant behind the panel, for an agent: units, parameter rows,
    // tagged signals, links checked, the picture's layout and style; since v1.76.0
    // every object with the pill, house symbol and caption it belongs to; since
    // v1.77.0 the IWMAC objects a picture of pixels shows (picture.object_looks).
    // See below.
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
    //   itself, returned so the drawing stays editable across round trips — or
    //   (v1.65.0) the drawing a PNG from VectorCraft or Insert keeps, stamped
    //   data-iwdie-drawing, in place of image_svg_trace - since v1.76.0 sized, its
    //   classes written on its elements, its hidden original left to image_data -
    //   or (v1.83.0) a picture of pixels read as Edit in VectorCraft reads it,
    //   marked data-iwdie-optimised: the panel's picture from then on, with the
    //   objects made from it after the panel's own in single_objects
  },
  "image_data": "data:image/png;base64,…",   // v1.17.0: last in the file
  "image_svg_trace": "<svg …>",              // v1.17.0: last in the file
  "change_log": []                            // v1.22.0: optional, written by an AI that modified the file
}
```

Insert also accepts a **bare** panel document and the server's array-of-one wrapping, so files fetched straight from `V3load_design_panel` / `iw_load_ctrls.php?format=json` import fine.

### The house components always in VectorCraft (v1.70.0)

Thomas, with the Advansor 772 Maskin `.ai` he imports: make all the components permanent in
VectorCraft, every one that is not available as an IWMAC object. His file holds 417 components, and
every one is drawn exactly as one of the template's 418 built into the script (1.68.0). So nothing had
to be added to the script. What was missing was VectorCraft: its Libraries and IWMAC menu offered only
a library kept in this browser, so with none imported they were empty.

- **Libraries and the IWMAC menu always have them.** Edit in VectorCraft offers the kept components
  filled in from the template built in. With none kept, it offers the template's own: 386 in Libraries,
  in 11 pages with the IWMAC objects' pages, and in the IWMAC menu by layer. Measured in the real
  VectorCraft web build with nothing kept: Libraries filled about 6 s after the editor opened.
- **Never what an IWMAC object shows.** Sixteen of the template's families are drawn copies of what
  an IWMAC object shows live: an alarm bell, *no connection*, five switches, two clocks, four state
  pills and three LEDs (`IWDIE_SYM_OBJECT_FAMILIES`). The template draws them 32 times, and those 32
  stay out of Libraries and the menu. Pipe pieces and colour samples are no IWMAC objects, so they stay
  in. The Copilot kit's `maskin-symbols.json` marks the same sixteen `object_instead`, and a kit test
  holds the two lists together.
- **Unchanged.** Looking for components in a panel's picture still goes by a library you kept.
  Reading a plant's `.ai` in the banner still keeps its components, and they then come first.

### Every object and component for Claude and Copilot (v1.71.0)

Thomas: make sure Claude, through the MCP bridge, and the Copilot agent can use all of the objects too.

- **35 more objects in VectorCraft.** The IWMAC menu, the IWMAC-objekter pages in Libraries and the bridge's planner
  place the objects of the script's catalogue, and it lacked 35 that production Maskin panels and the house pictures
  use. Among them:
  - the CO2 compressor and three small compressors, in a new group, *Compressors*;
  - the animated fans, 25 and 32 px;
  - eight more LEDs, the red 13 px one among them;
  - the AK-PC suction and condensing strips;
  - three solenoid valves;
  - values without a connector at 40, 80 and 110 px, and five values with their own tag;
  - two labels, the inverted CO2 alarm, the running/stopped button and the link button.

  The catalogue now holds 107 objects in 20 groups, each with the Designer's picture and size. The animated fans take
  Maskin's band (z 375), not a duct fan's.
- **Pipe pieces and colour samples are components, not objects.** Only the sixteen families an IWMAC object shows are
  treated as objects. Until now, three places also called the pipe pieces and colour samples objects: the drawing
  check (CB-S02), the planner's notes and Insert's check. The export's list for an agent left them out. Now the export
  lists them with the other components (98 families), and nothing warns of them.
- **The roles these ids report.** The export's role counts and the import checks go by the catalogue, so these ids now
  count under their own role. `number_v3_40px_no_conn` counts as a value, `sub_page_link_btn_up` as a button (it was
  *navigation*), and the compressor as a compressor.
- **Claude.** The MCP server 1.3.0 lists every component in `iwmac_find` symbols, pipe pieces and colour samples too.
  `all: true` adds those an IWMAC object shows. Its objects are the IWMAC menu's.
- **Copilot.** The kit keeps a copy of the catalogue, `reference_data/vc-object-catalogue.json`. It is written from
  this script, and a test holds it to it. The edit skill's files place exactly these objects, and the overview skill
  places any of them by `obj_id`.

### The Oversikt template's components, built in (v1.72.0)

Thomas, with the house's Oversikt template (`xxxx_oversikt-v6_dato.ai`): add the components around its artboard as
the Maskin template's were, so VectorCraft always has them, and make them easy for Copilot and Claude's MCP to use.

- **What the template holds.** 224 components around its artboard: a store's floor plan kit. The case pieces come in
  light blue for cooling and dark blue for freezer: modules, island ends, squares, rooms, a slim front row with its
  ends, an angled run, curves, ring, round, diamond and oval islands. The rest is a door, trolley signs, condensing
  units, condensers, a plug-in case's plug, a pin, a dishwasher and a car wash. 24 of the 224 are only the dashed
  frames round the template's three sections, and are left out.
- **Named.** `IWDIE_SYMBOLS` names the 200 after the Maskin families, in 66 families: `KjølDisk`, `FrysDisk`,
  `KjølGavl`, `KjølRom`, `FrysSirkel` … for the cases, then `Inngang`, `Handlevogn`, `Aggregat` (a checkout, renamed
  `SelvbetjentKasse` in v1.75.0), `Kondensator3`,
  `Plugg`, `Nål` and the rest. Each family says which template it comes from (`set`: Maskin or Oversikt). A drawing
  places them by name, as it places the Maskin ones, and Insert draws them from the script:
  `<use data-iwdie-symbol="KjølDisk" x="300" y="200" width="69" height="29"/>`.
- **Always in VectorCraft.** The built-in library carries both templates, 618 components, the Oversikt ones on three
  layers of their own. Libraries offers 585 of them, in pages: *Oversikt kjøl 1/2*, *2/2*, *Oversikt frys 1/2*, *2/2*,
  *Oversikt 1/2*, *2/2*. The IWMAC menu lists them under those headings. Both offer them beside a plant's own Maskin
  `.ai` too. The menu now lists a component the template draws many times over once: the Oversikt template draws its
  case module 25 times. Measured on the hosted VectorCraft with nothing kept: *585 in Libraries (17 pages)*.
- **Never the value pill.** The template's white pill (`PilleHvitKant`) is the box an Oversikt's value object draws
  itself, so it joins what an IWMAC object shows and is not offered.
- **For agents.** An Oversikt's export lists its components in `parts.components.symbols`, with a note on placing
  them. Any other panel's export lists the Maskin ones, as before. The Claude bridge tells MCP each symbol's template.
  The MCP server 1.4.0's `iwmac_find` shows it in a `set` column and keeps one template's with `set: "Oversikt"`. The
  Copilot kit lists them (`reference_data/oversikt-symbols.json`). The overview skill's Oversikt builder draws cases
  and rooms in the template's colours and places any of them from its spec.

### A sync finds the panel's objects again after the panel was loaded again (v1.72.1)

Thomas, drawing plant 4798's 315.001 Forbruksvann in VectorCraft: after a save, the panel kept an effect box he no
longer had in VectorCraft, and a second box stood beside it. A sync knew the objects of an edit only by their elements
on the Designer's canvas: those it sent as placeholders, and those its earlier syncs placed. The Designer makes the
elements anew whenever the panel is loaded again: another panel opened and this one again, *Load* pressed again, or the
page reloaded. After that, a sync took nothing off and said nothing, and a copied placeholder's object was placed once
more beside the one an earlier sync had made.

- **Known by more than the element.** The edit keeps a record of each object: its element, and its name, kind, place
  and tag as the last sync left it. A sync finds each one by its element. Otherwise it uses the name and kind where the
  object still stands or still reads the same. Failing that, it uses the kind where the object stands, when only one
  object is there. It never matches by name alone, because a panel loaded again may give that name to another object.
  The record is also kept in Tampermonkey's storage (`iwdie.vc.known.<job>`), so a Designer tab that takes the edit
  over, the page reloaded, takes deleted objects off too. Before, such a tab took none off. An edit begun by an older
  version has no record and still takes none off, as the toast says.
- **A copy is the object it made.** A copied placeholder carries its original's name, so each sync took it for a new
  object: placed again, the last one taken off, its links and Designer-side changes lost. It now takes the object an
  earlier sync of the edit placed for it, as a placeholder of none does: kept, moved with it, taken off with it.
- **Said, never skipped.** An object of the edit that cannot be found as the last sync left it (moved *and* relabelled
  in the Designer since) is left on the panel and named in the toast, with what to do. The editor's banner counts it
  with the objects that stayed.
- Checked in the stub host with saves straight into the Designer: a copy placed, saved again, then deleted, and one
  of the panel's own placeholders deleted, with the objects made anew before each save. Also checked with a second
  Designer page taking the edit over, and in the hosted VectorCraft 0.11.0. Not run in the live Designer.

### Ctrl+S in the Designer brings the panel's objects into VectorCraft (v1.73.0)

Thomas: Ctrl+S in VectorCraft syncs the drawing to the Designer; make Ctrl+S in the Designer sync to the edit in
VectorCraft too, so they keep up with each other.

- **What goes.** The panel's objects as they stand in the Designer: moved, resized, relabelled, linked to another
  parameter, added or deleted there. They go to the open edit of the panel the Designer shows, through Tampermonkey's
  storage (`iwdie.vc.designer.<job>`), each by the key it goes by in that edit. An object the edit does not know yet
  gets a new key. Nothing is saved to the plant: the Designer's own Save and Compile stay as they are.
- **What VectorCraft does with them.** Its tab brings them into the drawing it has open, saved or not, as a version of
  its own (`<panel> · Designer N.svg`), once it is in front and ready. Each placeholder is paired with its object by its
  key. A placeholder made in VectorCraft with no key is paired by the nearest object of its kind that an earlier sync
  placed from it. A pair is moved to where its object stands. It is made again where the object's size or tag changed,
  unless it carries the art its object stands on (a bare value's pill): then it is only moved. Its name follows the
  parameter the object is linked to. An object the drawing lacks gets a placeholder. A placeholder of an object the
  Designer no longer has goes. A placeholder made in VectorCraft and not synced yet stays, and so does the rest of the
  drawing. The version before stays in its tab.
- **Both ways.** VectorCraft says how it went, and the Designer's toast repeats it: *1 moved, 1 added, 1 taken out*.
  From then on each placeholder carries its object's key, so the next Ctrl+S in VectorCraft finds every one. A
  placeholder of none standing just where a sent object stands, its own placeholder gone, is now taken for that
  object, so a version saved before the Designer's Ctrl+S does not take it off.
- **Without an edit** of the shown panel, Ctrl+S in the Designer is the browser's, as before; the Designer has no Ctrl+S
  of its own. If no VectorCraft tab of the edit answers within 6 s, the toast says so: Edit in VectorCraft… opens the
  panel there again.
- **Sync from the newest version.** A Ctrl+S in an older version's tab sends that version: what the Designer changed since
  is undone by it.
- Checked in the stub host on the hosted VectorCraft 0.11.0: an object moved, one deleted and one added in the Designer,
  then Ctrl+S there gave *1 moved, 1 added, 1 taken out*, and Ctrl+S in VectorCraft afterwards changed nothing on the
  panel. A label added and relabelled gave *1 added*, then *1 changed*. Not run in the live Designer.

### A list's words one size (v1.85.1)

Thomas, of 10113's legend after Vectorize image: *look like you use 12px object on frys and 14 on Kjøl 14 should be the
right one*.

- The words step read the legend's words at 14.5 to 15 px, but *Frys* at 13.5. A case's code read at 13 lay within
  half a pixel of it, so it was weighed with the codes, not with the legend: a 12 px label among 14 px ones.
- A word that stands in a list is now weighed with its list as well: three words or more whose ink starts within 2 px of
  one another, within 1.5 px of their median read size (`iwdieTxLabelSizes`, the words' `x0`). It still counts the words
  read alike too: a list alone, tried first, broke three alike columns of 11087's Energi into 12 and 11 px and made
  3214's codes 9 px.
- Copilot's converter passes the words' places too.
- Checked in the stub host, 1.85.0 against 1.85.1 on 16 panels: *Frys* became 14 px on 10113's and 2313's Oversikt, and
  no other label changed size. Every legend of the six Oversikt panels is one size now.

### An Oversikt's cases native first; a .ai without PDF content said, not opened (v1.85.0)

Thomas: *update Copilot so that it prioritizes native IWMAC Designer objects when generating refrigerated and freezer
display cases … native IWMAC Designer objects whenever a suitable match exists, existing .ai vector objects from the
database when no suitable native object is available, generate new vector objects only when neither option is
available. also make switch disks a permanent object in the database in vectorcraft* - and, of 10113's Oversikt .ai:
*trying to import .ai file but all looks ready messy*.

- **The cases native first, through Claude's bridge as in Copilot's `oversikt.py`.** A `case` op's case is the
  Designer's own case box: `number_v3_R_dummy_medium_temp` (cooling), `_low_temp` (freezer) or `_heated_vert`
  (`kind: 'heated'`), standing - or lying (`_horis`, `_hor`) where the box is at least as wide as high. These are the
  objects Vectorize image already makes of a case read from a picture (v1.80.0). VectorCraft shows each as a
  placeholder in its case's colour, and the sync makes it the Designer's object, z 5, under every other object.
  - A `switch` case (cooling and freezer, split on its diagonal) is the template's `KjølFrysDisk`, turned 270 when it
    stands.
  - `native: false` draws the box in Former, as 1.84.0 did.
  - A grey room that is no cooling position stays drawn: no box of the Designer's has its colour.
  - `iwdieOvKindOf`, `iwdieOvNativeCase`.
- **The switch disk was in the database already.** The Oversikt template's `KjølFrysDisk` (since 1.72.0, Libraries ›
  Oversikt) is 10113's PI50 to PI52 to the hundredth. Its description now says *switch case (switch disk)*, so a search
  for it finds it.
- **A .ai saved without PDF content is said, not opened.** Illustrator then writes, for any PDF reader, a page that
  only shows its notice. VectorCraft opened 10113's Oversikt as eight copies of it, and 2313's Oversikt .ai is the
  same. `iwdieAiPdfNotice` reads the file's text arrays; Open plant .ai… says to save it again from Illustrator with
  *Create PDF Compatible File* on, or to trace the panel's picture with Vectorize image.
- Checked in the stub host on the local VectorCraft 0.11.0 build: Claude drew the e2e's Oversikt with 13 case boxes of
  the Designer's own, a switch case and a heated case. The check was clean, also after an edit by hand. Ctrl+S placed 81
  objects, the 13 boxes among them, and linked 12. Not run in the live Designer.

### A legend's symbols stay in the drawing, and names under a cluster stay read (v1.84.1)

Thomas, after Vectorize image and a sync of 10113's Oversikt: *some objects was not syncet over*. Two things.

- **The legend's alarm, cooling and defrost symbols.** 1.83.2 made them kinds that show the symbol at rest on the
  plant's page: an inverted alarm, an inverted defrost and an evaporator's state icon. But while a panel is designed,
  the Designer draws an object by its state 1, and its `transp_d.gif` - a pink square - where that is transparent (its
  graph designer's `iw_make_ctrl`). So the legend showed two pink squares and a defrost drop for *Kjøl/Frys pågår*.
  A kind only the Designer's whole list brings is now made from a picture only when the Designer shows it as the plant's
  page does (`iwdieVzDesignerPicture`, `iwdieVzShownAlike`). No kind shows a status symbol alike in both, so a legend
  keeps those symbols in the drawing; its alarm bell is the house's `Alarm` component.
- **The top row's eight names (K31 to K12).** Each lay under a cooling or defrost object of the panel, whose dark
  circle is the words' own colour, and the step that takes an object's look out of the picture where the picture shows
  it a second time (`iwdieVzEraseLooks`) took every letter for the circle. A look the picture matches on under 40 % of
  its opaque pixels is no second look now, and what lies under it stays: the names are read as labels again.
- Copilot's converter (`optimise.js`) takes both rules from the userscript.
- Checked in the stub host on 10113's Oversikt and 15 more panels of the test bed, 1.84.0 against 1.84.1:
  - 10113: the eight names of the top row come back as labels (23 to 31), and the legend's three symbols stay in the
    drawing.
  - The legend the same on five more Oversikt panels (10214, 11087, 2313, 3214, 4559).
  - Words read better where they had lain under such a circle: 2313's "K28" reads "K38" as drawn, 2349's "F8l"
    "F8", and 3214's "F7" is read (before, it became a small arrow symbol).
  - 2313's VGV and 3530's Maskin draw their inverted three-way valves as the house's valve symbols (the Designer showed
    those kinds as pink squares too); one of 2313's had become a solenoid object, though the picture shows a three-way
    valve.
  - 10214's, 2349's and 11087's Maskin and 10245's Ventilasjon came out the same.
  - Not run in the live Designer.

### Claude draws an Oversikt through the bridge (v1.84.0, server 1.6.0)

Thomas: *kan du gå over MCP for se om du finner noen forbedringer slik at den kan enkelt hjelpe meg lage
oversiktbilder for meg*. Before this, Claude could place an Oversikt's template pieces, but each case's value, bell,
cooling and defrost were four `object` ops placed by hand, each bound by looking its row up, and each name a label
placed by guess - the very things Copilot's `oversikt.py` does by rule. Now the bridge does them by the same rule.

- **An Oversikt in one edit.** `iwmac_edit` takes:
  - `case`: the case's box in the template's colour (cooling #b0e0ef, freezer #8eb2d1, rounded 4, no outline),
    named after it; its cluster on it; its name as a label object (`number_v3_label_12px_norm`). `room: true` makes a
    walk-in cold or freezer room of it, `wall` says which side its wall is on, `caption` where its name goes, `more`
    adds boxes of the same case, `plug` the template's `Plugg`, `anatomy` another chain's cluster.
  - `room`: a room that is no cooling position, light grey in Bakgrunn, its name inside.
  - `cluster`: a cluster on a case already drawn (a template piece, the Designer's own case box).
  - `name`: a name over a group of cases ("Øl"), as a label object.
  - `legend`: the house's legend column (Symbolforklaring), once, right of x 1151.25.
  - An arrangement's `symbol` takes `cases` (each a name or `{label, unit, roles}`) or `clusters: true`.
- **The roles bound from the case controllers.** `iwmac_find {what: 'cases'}` (server 1.6.0) lists each case
  controller with the bind text of its value (`u56 Display air`), alarm (`--- High t.alarm`, not a B section's),
  cooling (`u58 Comp1/LLSV`) and defrost (`u60 Def. relay`) rows; a `case` given `unit` takes them, filled in by the
  server. A role the unit has no row for is not placed; a unit whose rows did not come is said, and its cluster is
  placed unbound. The rows come for the units linked on the panel and those ticked in the Parameter Selector.
- **Placed as Copilot places them.** The cluster's spots by how its case stands (lying, on a bottom wall, standing,
  on a right-hand wall, an island's column or row), measured on Thomas's panels; a name measured as the Designer's
  12 px Arial draws it; every case known before anything is placed, values first, then bells and states, then names.
  On the overview skill's three example plans the bridge and `oversikt.py` place every object alike (60, 84 and 60).
- **The check and the facts know an Oversikt** (two cases or more): CB-C01 a case without a value on it, CB-C02 a
  name drawn as text (every name is a label object), CB-C03 no legend; `facts.oversikt` counts the cases, cold and
  freezer, the names, those drawn as text, and says whether the legend is there. CB-O02 no longer calls one
  cluster's objects a fault: the house hangs the bell and the states on the value's end, and cooling and defrost
  share a spot.
- **A drawing VectorCraft saved is read with its colours.** VectorCraft saves every fill and stroke as a class
  (`.cls-6{fill:#b0e0ef}`), and the scene reads a drawing changed by hand from that save: a case lost its colour
  there and was no case. Both scene readers now take a property as the browser does (`iwdieSvgClassMap`,
  `iwdieSvgProp`): the style attribute, else the latest class rule, else the attribute.
- **A case keeps its name in VectorCraft.** A named box carries its name as its `id` too, as a placeholder does:
  VectorCraft dropped a bare `data-name` when it saved.
- Copilot's edit files take the same ops: `vc_edits.py` fills a case's `unit` from the export's rows.
- Checked in the stub host with the local VectorCraft 0.11.0 build: a blank Oversikt, three case controllers and
  the pack ticked. Claude drew the legend, 12 cases (two of them walk-in rooms), a technical room and a name over
  the front loaders in one edit; the check was clean; Ctrl+S placed 62 objects, the 12 of the three controllers
  linked to their rows. Not run in the live Designer.

### The symbol legend stays the picture's, and Save As by clicks for VectorCraft 0.13.1 (v1.83.2)

Thomas: *see if you can recreate this images on … plant_id=2313 … with the tool copilot agent have*, and *look there
is update can you update and keep my custom fork*. 2313's Oversikt read by Copilot's converter, and VectorCraft
0.13.1 tried in the stub host, gave these.

- **An object made from a picture shows that picture on the plant's page.** The plant's page draws an object with no
  value by its state picture 0 (its Elm app: `iw_icons/` + the picture for "0"), and what a picture is read into is
  unlinked. The Designer draws its alarm, cooling and defrost symbols (`V3_R_34px_noanim_circular_alarm_nrm`,
  `V3_R_24px_circular_cooling_nrm`, `V3_R_24px_circular_defrost_nrm`) from `status_array`, whose state 0 is
  `transp.gif`, so the symbol legend of every Oversikt lost its three symbols there: all seven Oversikt panels of the
  test bed, 2313's among them.
  - A kind whose rest picture is transparent is no longer looked for (`iwdieVzRestPicture`, `iwdieVzHiddenAtRest`, in
    `vcObjectStates`).
  - A kind only the Designer's whole list brings, beyond the catalogue and the panel's own, is looked for by its rest
    picture alone. Without that, the legend's defrost symbol became an evaporator's state icon, which shows cooling at
    rest.
  - The legend's symbols are now objects that show the very same symbol at rest: an inverted alarm
    (`V3_R_34px_noanim_circular_alarm_inv`), an evaporator's state icon (cooling) and an inverted defrost
    (`V3_R_24px_circular_defrost_inv`). A symbol no kind shows at rest stays in the drawing.
- **Save As by clicks first.** VectorCraft 0.12 keeps the format list open after a key takes a format, and in 0.13.1
  Tab moves through it otherwise: the keys took *VectorCraft Template*. The clicks (*Format ▾*, *SVG*, *OK*, at the
  same places round the window's centre) take SVG in 0.11.0 and 0.13.1 alike. `answerSaveAs` now tries them first,
  and the keys only after. In the stub host the first save was ready after 10.7 s on 0.13.1, as on 0.11.0 with the
  keys.
- **The hosted copy stays VectorCraft 0.11.0 for now.** 0.13.1, built as the site builds it (SIMD, no ArtCraft name),
  passed its checks and this script's syncs. But it opens the house Maskin template's heat exchanger, a stroked
  zigzag, as a plain rectangle: in 2349's, 3530's and the template's own .ai alike, and the official 0.13.1 build does
  the same. A sync of such a drawing would put the rectangle in the panel's picture. The colours it takes from an .ai
  also move, by up to 8 in a channel.
- **Checked against Copilot's converter again**, now on 24 panels of ten plants with 2313's Oversikt and VGV: on the
  21 the script read into a drawing, the same objects and the same drawing, byte for byte; on the other three nothing
  in both.

### The same picture read the same way every time, and Copilot reads it too (v1.83.1)

- **Ties picked the same way every run.** The searches for IWMAC objects and house symbols run in up to four workers,
  and their finds come back in the order the workers finish. Two templates nearly alike could match one place equally
  well, and then the first to come back won, one run one way, the next another. 11087's Beholder is kept twice in the
  house library, a hundredth of a pixel apart. `iwdieVcPick` now breaks such a tie by the lower template, then the turn,
  then the place.
- **Traced to the same digits in every engine.** The tracer found corners and straight runs with `Math.acos`,
  `Math.atan2`, `Math.cos` and `Math.sin`. Chrome 155 computes those otherwise than Node 24, and on 400 000
  inputs their last digits parted for 7.7 % (acos), 17.8 % (atan2) and 3.4 % (sin, cos). On 3694's
  Oversikt_NY that put one corner of one letter 0.4 px elsewhere. `iwdieVzFit` now keeps each turn as its cosine and
  finds a straight run's direction by square roots, which give the same digits in every engine, so a Chrome update
  that changes its maths no longer changes a trace. On Oversikt_NY, 14 of 245 letter outlines moved, by at
  most 0.27 px.
- **Copilot reads a picture as this script does.** The Copilot kit's edit skill has a converter, `optimise.py`. It
  runs this script's own functions in Node and makes Export JSON 1.83.0's optimised file from an export without one: a
  file from 1.82.8 or older, a colleague's, or any panel file whose picture is pixels.
  - What only a browser draws is made here ahead and kept in the skill: the glyphs of Roboto, Arial and Segoe UI, the
    house templates, the Designer's state pictures and looks, and the labels' looks and widths.
  - **Checked against this script**, in the stub host, on 22 panels of nine plants. The script read 19 of them into a
    drawing, and on each the converter made the same objects, in the same order, and the same drawing, byte for
    byte. On the other three both found nothing to make: two pictures were drawings already, and one had nothing to
    read.
  - Measured on the way: Chrome blends a picture's partly clear pixels with the panel's colour by rounding each part
    on its own (Skia's), and the converter does the same.

### Export JSON gives the panel as Edit in VectorCraft makes it (v1.83.0)

Thomas: *we need to update the export .json for copilot give as optimised self generated json*. He chose to have Export
JSON always give that file.

- **What Export JSON does now.** A panel whose picture is pixels is read as Edit in VectorCraft reads one: what the
  panel's objects stand on, the IWMAC objects the picture shows, its words, the boxes the Designer draws itself, the
  house symbols, the pipes by circuit, and the rest traced. The drawing that makes is then taken apart as a sync takes a
  save from VectorCraft. The file holds the panel as Edit in VectorCraft and a save there, unchanged, would leave it:
  - `panel.image_svg` is the drawing, in the form Export hands over any drawing, marked `data-iwdie-optimised` and
    stamped.
  - `single_objects` holds the panel's own objects as they are, then the objects made from the picture, unlinked and
    named on from the panel's: its words as labels, the IWMAC objects it shows, the boxes the Designer draws.
  - `image_data` is the panel's picture as it was, byte for byte.
  - `overview` is read from the drawing. `contents` and `ai_guide.artwork.optimised` say what the export made and
    where.
- **Insert draws such a drawing, changed or not.** Insert keeps the picture in `image_data` while an exported drawing
  comes back unchanged. Here that picture still has its words, and the labels made from them would stand on them. So
  Insert draws a drawing marked `data-iwdie-optimised` into a PNG that keeps it, makes it the panel's background and
  uploads it to the plant's pictures, as a sync does. The picture in `image_data` goes on the drawing's hidden layer
  Bakgrunn (original), so that Edit in VectorCraft can start again from it. Insert's check does not judge such a
  drawing's layers while its stamp is intact.
- **Its steps show on the page,** each with what it found and its time, and Cancel stops the export. These panels are
  exported as before:
  - one whose picture is a drawing already (an SVG, or a PNG from VectorCraft or Insert);
  - one without a picture;
  - one whose picture has nothing to make objects of (no word, IWMAC object or box), so its own pixels stay its
    picture.
  When the picture cannot be read so, or its drawing is more than `panel.image_svg` takes (3 MB), the export goes on
  as before and a toast says why.
- **What the script places is known to Insert's check.** The check knew only the kinds seen on real panels, and
  flagged what the words and box steps made: a white 12 px label, a horizontal room box. These now count as known:
  - every label the Designer's palette has, 8 to 20 px, normal or bold, white or not;
  - the Designer's boxes either way round;
  - the objects of VectorCraft's IWMAC menu.
- **Checked in the stub host on 11087's KA1:**
  - The export took 18 s and holds 120 objects: the panel's 53, then 61 labels and 6 IWMAC objects (four compressors,
    a pump and a three-way valve). These are the labels, at the same places, and the objects 1.82.8's Edit in
    VectorCraft made, and the drawing's layers are the same.
  - `image_data` is the panel's PNG byte for byte.
  - Inserted on a fresh panel: 120 objects, the drawing the background as a 172 kB PNG that keeps it, uploaded once,
    and the picture it was read from back on its hidden layer.
- Not run in the live Designer.

### Labels where the picture had its words, pipes up to the valves, words read beside drawings (v1.82.8)

Thomas synced 11087's KA1 back from VectorCraft and compared it with the Designer before. He reported: *all the object
text are a few pixels off that on top of bobbles*, and *some places the pipes are not fully connected to the object*.

- **Each label read from a picture stood 2 px low.** A label's baseline is measured on an element of its class out of
  sight, using an empty mark at the baseline. That mark was a span, and the Designer's style sheet gives every span a
  2 px margin (`#tags_detail_wr div p, span` in `V3_designer.css`). An empty inline block stands on its margin's bottom,
  so the measurement came out 8 px instead of 10 for an 11 px label. The mark is now an element no style sheet names,
  with no margin. Labels placed by an earlier sync stay where they are; nudge them up 2 px, or edit the panel again from
  its picture.
- **A pipe now runs on into the object that stands on its end** (`opts.reach`).
  - **Why it stopped short:** the picture's pipe ran on under the valve, but the object's look came out of the picture
    with a pixel round it, so the traced pipe stopped 2 px or more short.
  - **The rule:** a straight end 6 px or less short of something that draws over it, on its line, runs on 2 px into it.
    That something is a house symbol, an object found in the picture, or one of the panel's objects that draws itself.
    Words and bare values do not count, since a pipe would show through them.
  - **Where it showed:** on KA1 it closed the gaps at the V3gc, Vhp and Vrec valves, the pump and the oil separator.
- **The words step reads beside drawings.**
  - **Not over the picture's ground:** a word's run no longer grows over that ground. The gauge's white glass had taken
    the ground for its letters, grown 96 px each way and swallowed "Low-" beside it.
  - **Small letters alone:** a run 8 rows high or less is tried as small letters too. 3214's "rom" under "Oppvask-"
    is now read.
  - **The ink over a known word:** a reading the ink explains well is no longer replaced by a known word the ink
    explains worse by more than 0.015.
    - "Hr Req %" had become Hr Reg %, and 4559's K03 and K08 had become K02 and K06.
    - A full stop is kept only where the ink shows one: "Room temp" had become Room temp.
  - **Brackets:** a reading that leaves a bracket open weighs more, and a unit in brackets joins the words before it.
    11087's Energi now reads "L1-L2 (V)", and "Daggpunkt (°CI" is no longer written; its "(°C)" stays drawn.
  - **House words:** the receiver's "High-level" and "High-" are house words now (it read "HIgh").
- Checked by reading the words step again in Node on 20 panels from nine plants, with each page's own glyphs. Thirteen
  labels are now right that were wrong or missing, one wrong label is gone, and no label got worse. 2349's "K-11c" is
  still read wrong, in another way.

### A receiver stays the picture's (v1.82.7)

Thomas showed 11087's KA1 in VectorCraft beside the Designer: *look like it messes up tank here*. The receiver's outline
was broken, its two ends were value pills, and a white box sat in its middle. The p of "Oil-sep." beside it had become a
sensor.

- **A white patch is no longer searched as a box** (`IWDIE_VZ_BOXES_UNSEEN`). The receiver's middle, white between its
  two seams, had passed as the Designer's white header. It became that object, and the picture under it was taken out.
  The two ends left behind then passed as the house's 60 x 20 value pill, `KjølGrader`. Across 49 pictures from nine
  plants, 21 white patches had passed as boxes, and none of them was a header. They were receivers between their seams,
  rooms between their walls, air handlers inside their frames and gaps between pipes. The grey headers and the cases are
  searched as before.
- **The closest search takes no house component that lacks part of what the picture draws** (`iwdieVzLacks`). Two
  rules decide this:
  - Lines are each one's ink set off from its fill. The component is refused when the element's lines inside its box
    include a piece of 12 pixels or more that the component's lines do not come within two pixels of.
  - The component is also refused when it has under 85 % of the element's ink and lies exactly on under 60 % of it.

  The search judged by outline, so a component that differed only inside was taken, and what it lacked was taken out
  with it:
  - 11087's receiver became `BeholderNivå`, with one seam and another gauge.
  - 10214's receiver (and the same drawing on five more plants) became `BeholderVindu`, which has no coil.
  - 4559's receiver became `Tank`, which has no coil either.
  - 3694's info pill lost its "2,7℃", and a tank on 2349's heat recovery became a gas cooler with four fans.
  - Letters became symbols: the p of "sep.", "K-30b" and "F-85" on 2349's Oversikt, "K03" on 3214's, and parts of
    3694's case names. A small vessel became a compressor.

  Each of these now stays drawn as the picture has it. A sensor's lead may still run on past the house's, and the gas
  coolers, valves, arrows and sensors that match the picture are placed as before.
- **An upright line through a word's box is no letter** (`iwdieTxInk`). A column inked from the box's top to its
  bottom, whose ink runs on past both, has its ink taken out. "sep." beside its vessel's wall had been read as "sep.l"
  and left as drawing; it is now a label. Rows across a word stay as they were. With rows taken out too, a word in a
  bar was read with wrong letters ("Karmvärmestyrning" as "Karmvårmestyming").
- Checked in the stub host against 1.82.6 on 22 panels from nine plants, each fetched read-only:
  - The receivers, the pill, the tank and the letters changed as above.
  - Two misread labels (*rorn* and *rpm* for "rom" on 3214's Oversikt) are now the picture's drawn letters.
  - Every other label and every IWMAC object stayed the same.
- 11087's "Low-" beside its gauge is no longer a label. 1.82.6 read it only because the false white header's edges
  had been painted out before the words were read. It stays in the picture's own letters.

### Values as the Designer writes them: "12.3", in its own font (v1.82.6)

Thomas showed the Designer's values next to VectorCraft's: *also i see that the object text does not display the same as
on iwmac designer*. The Designer wrote "12.3" in bold. VectorCraft, and since 1.82.5 the Illustrator export, showed
"12.3 °C" in another size and weight.

- **Why.** A bare value (`number_v3_value_only`, `number_v3_white_value_only`) is text in its class's font, and its CSS
  paints nothing else. Its look therefore fell back to the palette's picture of the kind, which says "12.3 °C". A text
  box (the 60 px box, the white `custom_json` pill and the rest of `textbox` and `textbox_tag`) was painted as its box
  alone, with no value in it.
- **Now each one is painted as its class lays it out,** with the value the Designer writes while it designs: "12.3",
  with no unit. The value is placed where the class puts it, in its own font. `.css_v3_iw_values`, for example, is Roboto
  11 px bold in `#3C505E`, centred, 4 px from the top, and the white value is the same in white. The text is drawn over the
  box its class paints.
- **The looks kept a week are fetched again once,** as version 4 of the looks' cache.
- **This applies everywhere these looks are used:** VectorCraft's placeholders, the Illustrator export, and the page
  other viewers show.

Checked in the stub host with the Designer's own render definitions and CSS, on 10214's Maskin:
- The dark pills read "12.3" in white bold and the white pills "12.3" in dark bold, as in Thomas's screenshot, both in
  VectorCraft and in the Illustrator export.
- The 60 px box and the `custom_json` pill, empty before, now read "12.3".
- The job finds and places 77 objects, as before.

### The panel's objects in the Illustrator export, as the Designer shows them (v1.82.5)

Thomas, on an export of 10214's Maskin: *When exporting to adobe illustrator look like you don't add all the objects
in the .ai export / should be the same*.

- **What went wrong.** Background → Illustrator, and VectorCraft's own *Save .ai for Illustrator*, wrote each of the
  panel's objects as a dashed blue box with its name, on a hidden layer, Panelobjekter, that did not print. In
  Illustrator the panel had none of its values, labels, LEDs or compressors.
- **Now the objects go on top, shown, locked and printing,** on the layer Panelobjekter. Each object is a group of
  what its placeholder in VectorCraft shows:
  - its look as the Designer draws it, embedded at its size: the Designer's own picture of its kind, or the one its
    CSS paints at the object's size;
  - a box the Designer draws itself, as a path;
  - its words as Arial type, bold where they are: the tag where the Designer writes it, and a label's or the header's
    own text.

  The dashed box that marks a placeholder in VectorCraft is no part of the panel and stays out. An object whose
  picture cannot be read is drawn as the light box with what it is in it, and the message says how many.
- **The page other viewers show,** such as Windows' preview or a PDF viewer, has the objects too.
- **The dialog** offers *Panel objects, as the Designer shows them (N)*, ticked by default.
- **A degree sign made Illustrator refuse the whole file.** An object's name becomes an XML id, and the label
  *Ref °C* was written with the degree sign's UTF-8 bytes in it. Only letters now stay as they are within Latin-1, so
  *Føler* opens as before. Other signs are escaped, as `_xB0_` for the degree sign. This also broke the hidden layer
  before 1.82.5, whenever the panel's objects were exported.
- **Never twice, and never in the picture.** A drawing that already holds a Panelobjekter layer from an earlier export
  is exported with that layer drawn anew, not twice. A sync from VectorCraft leaves a layer called Panelobjekter out of
  the panel's picture. So an exported .ai opened in VectorCraft and synced does not paint the objects under the
  objects themselves.

Checked in the stub host with the Designer's CSS, on 10214's Maskin after Edit in VectorCraft and a sync:
- **Both exports** put 140 objects on Panelobjekter, with 69 pictures and 71 texts, and open in Illustrator, each
  object where the panel has it.
- **Before the XML id fix,** Illustrator refused the file ("the operation was cancelled"). Halving the objects layer
  found the label *Ref °C*.

### Smoother drags in VectorCraft: the placeholders' dashed boxes drawn opaque (v1.82.4)

Thomas: *can you see if you can improve and optimize when moving objects on vectorcraft so it gets more smooth? do deep
dive*.

- **Where the time went.** VectorCraft draws the whole drawing again on each frame of a drag, on the CPU, and its status
  bar shows how long each frame took to draw (*render*). On 10214's Maskin in a 1400 × 900 window that was 27 ms a
  frame, and on its Oversikt 48 ms. Taking the job's parts out one at a time showed where the time went:
  - the house's components and the pipes, shapes and text traced from the picture: 3 ms together;
  - the placeholders' pictures, their captions and the pills under them: about 2 ms each;
  - the dashed blue box round each placeholder: 15 ms for the Maskin's 140 boxes and 34 ms for the Oversikt's 235.
- **Why the boxes.** VectorCraft draws a shape the quick way, from outlines it keeps between frames, when the shape is
  opaque or has a single solid paint that can take its opacity, and it does not count a dashed line as such a paint
  (`draw_arc_body` and `painted_items` in its `crates/render/src/lib.rs`). So each dashed box at 60 % was drawn through a
  see-through layer as wide as the whole canvas, on every frame, with its dashes worked out again each time. The same
  box drawn opaque, or drawn solid at 60 %, takes the quick way.
- **The fix.** The box is now drawn opaque, in the blue it showed at 60 % over the panel's grey (`#819eeb`). On the grey
  it looks exactly as before. The light box of an object without a picture keeps its opacity: VectorCraft draws that
  one the quick way, because it is filled.
- **Measured** on a local copy of the hosted VectorCraft 0.11.0, dragging one object over 60 steps:

  | Job | Window | 1.82.3 | 1.82.4 |
  |---|---|---|---|
  | 10214 Maskin | 1400 × 900 | 27.5 ms a frame | 11.3 ms |
  | 10214 Oversikt | 1400 × 900 | 47.8 ms | 13.9 ms |
  | 10214 Maskin | 1920 × 1080 | 47.4 ms | 16.7 ms |

  The time grows with the number of screen pixels, so a larger window, or Windows scaling above 100 %, makes each frame
  slower in both versions.
- **Otherwise the same job.** Apart from the boxes, 1.82.4's jobs for both panels are the same as 1.82.3's, byte for
  byte.
- **Only new edits.** A document opened in VectorCraft before 1.82.4, or one it restores from then, keeps its old boxes.
  Edit in VectorCraft makes a new one.
- **Quicker still, in the hosted build (2026-10-17).** VectorCraft's official web release is built without
  WebAssembly SIMD. The hosted copy is now built with it, and draws the Maskin's drag frames in 5.0 ms instead of
  11.3 ms. See *The hosted copy* under *Edit in VectorCraft*.
- **Quicker still, by hand.** VectorCraft skips a hidden layer: with the IWMAC-objekter layer taken out, the Maskin drew
  in 2.9 ms a frame, so hiding that layer while arranging the drawing makes drags quicker still. A smaller window helps
  too. Outline Mode does not: with Ctrl+Y, VectorCraft drew the same Maskin in 21.5 ms a frame, against 11.4 ms in
  Preview, because it strokes every path and every letter again on each frame.

### The house's sensor where the picture has one, and the white value as white text (v1.82.3)

Thomas, on 10214's Maskin in VectorCraft: *look like some places you have arrorw but you should instead have føler object
instead*. He showed the house symbol `Føler` in VectorCraft's layers. Of the white value objects he wrote: *can you just
dislay as white text without square round / like you have on the black text object text but only for white / its
display right in iwmac designer but not the same in vectorCraft*.

- **Sensors, not arrows.**
  - **What went wrong.** The house's `Føler` is a filled dot with a dotted lead, and the lead is drawn faint: it
    counted as no ink for the closest search. The template also has a fixed length (15, 27 or 39 px), but the
    picture's lead runs as long as it needs. A sensor whose lead ran 11 px was weighed against the arrow `PilLiten`
    alone and taken for one: 4 of 10214 Maskin's 15 arrows were sensors.
  - **The fix.** A template's faint pixels apart from its solid ink are now ink the element may have or not
    (`iwdieVzClosest`). Such a template is weighed against an element as long as its dot, as long as the whole, or
    anything between.
  - **No arrows taken for sensors.** A sensor's dot is filled. Only an element with a filled block of 3 × 2 pixels,
    or a compact dark end with a lighter lead running on from it, is weighed against it. An arrow's head is a V of
    one-pixel strokes and is never weighed against it.
- **As long as the picture's lead.** A sensor found with a longer lead than the picture's is swapped for the shortest
  one that reaches the element's far end, with its dot kept where it was (`iwdieVzLeadFit`).
- **The white value as white text.** VectorCraft drew `number_v3_white_value_only` with the palette's
  `white_val_only.png`, which is white text on a grey box. The Designer draws that class as the white text alone, on
  the picture's own pill. Its look is now the text alone: each pixel white, as opaque as it is lighter than the box,
  with the box's ring left out. The looks kept a week are fetched again once.

Checked in the stub host with the Designer's CSS:
- **10214 Maskin.** Its 14 sensors are `Føler` and its 11 arrows `PilLiten`, before 7 and 15. Each sensor's dot sits
  on the picture's dot, its lead the shortest that reaches.
- **The white values** show their white text on the picture's dark pill.

### The clocks count on while the page is held (v1.82.2)

Thomas sent a screenshot of Chrome's *Pages Unresponsive* dialog over the progress tab, which stood at *What the objects
stand on - their pills, 0.0 s*. He wrote: *look like it freezes but works after a while / can you make it som progress
look better so it actually display seconds on each part so it dosen't look stuck*.

- **Why it stood still.** The progress tab is `about:blank`, written by the Designer's page, so it runs on that page's
  thread. Its clocks were set by a timer on that thread. While the work held the thread, they stopped. Version 1.77.1
  had already moved the running step's ring and the bar's sheen to the browser's compositor for the same reason.
- **Now the clocks count on too.** The total and the running step's own time are rows of digit strips: hundreds, tens,
  seconds and tenths. Each strip moves with a stepped CSS transform, so the compositor turns it while the page is held.
  The tens appear at 10 s and the hundreds at 100 s. A finished step shows its measured time as before.
  - In the stub host, a screencast of the tab during a 4 s hold showed the running step's clock going 1.0 → 3.4 s and
    the total 1.4 → 3.8 s.
- **Where the page was held.** A step that the page's long tasks held for 2 s or more now says so after its result, as
  in *none found · the page held 31 s*. In the stub host the page is never held for more than 0.4 s, so his live
  Designer holds it somewhere the stub host does not show. The next screenshot will name the step.
  - In the stub host, a 3.5 s hold added on purpose showed as *the page held 3.5 s*.
- **Less work in the erase.** Since 1.82.1, its search for holes made four arrays for each pixel of each hole. It now
  makes none.

### What 10214's Oversikt read wrong in the live Designer, put right (v1.82.1)

Thomas, on 10214's Oversikt with 1.82.0 (job `mvbzwcll0lqh8z`): *Kjøl and K12 you did not find on … kjøl is no object
text and K12 is no Object text*. Of the legend's icons he said: *also you did not find any objects here*.

- **Why the stub host had not seen it.** The stub host painted the panel's objects without the Designer's component
  CSS (`V3_iw_xo_components.css`) and its pictures. So the looks the live Designer paints - the value boxes' pills,
  the 360 units, the fans and the LEDs - were never taken out of the picture there. Once the live CSS was loaded, 1.82.0
  in the stub host gave exactly his result: 40 words read, without K12 and Kjøl, and `FrysDiskKort` on an AC unit. His
  panel's picture is byte for byte the stub's.
- **K12.** Taking the AC units' fan and LED out of the picture left streaks behind. The pixels were filled from the
  nearest of their four neighbours, which drew the lines round each hole into it. The streaks' new colours split K12's
  letters among more of the tracer's colours, so the letters no longer read as a word.
  - **The fix.** A pixel whose row and column disagree now takes the commonest colour round its hole
    (`iwdieVcEraseMask`).
- **Kjøl.** One of those streaks, in the ground's colour, was read as a word. It grew along its rows, which were all
  ground, to the picture's edge, and took Kjøl into a run too long to be a caption.
  - **The fix.** A word of the ground's colour is no word. A run now grows over its own letters at most eight times its
    height on each side (`iwdieTxRuns`).
- **The legend's icons were found, but showed nothing.** Their placeholders went to VectorCraft without their picture,
  because an object found by shape had no picture size in its placeholder. Now each shows the Designer's picture.
  - A kind beyond the catalogue is now also known on the Designer's page before a sync takes the placeholders out.
    Before, a page reloaded since the vectorizing left them in the picture as dashed boxes.
- **The AC units' grey stripes.** 10214's two AC units are `number_360_kb` objects: dummies with no states, whose
  look hides what is under it in every state. Under such a look, all of the picture now goes, not only what matches the
  Designer's picture. Value boxes are not included: one lay a pixel over K11 and took a stroke of its K.
- **No false objects by shape.**
  - **IoU floor.** An object's own picture is now taken only where it covers half of the element or more (IoU 0.5).
  - **Shape over colour, for mechanical objects only.** That relaxation now applies only to valves, pumps,
    compressors, fans, dampers, coils and filters.
  - **Why.** With every picture fetched, the IWT legend's needle had been taken for a 16 px LED.

Checked in the stub host with the live Designer's CSS, 1.82.0 against 1.82.1 on the same pictures:

| Picture | Words read (runs left as drawing) | IWMAC objects by shape | House symbols | Vector |
|---|---|---|---|---|
| 10214 Oversikt | 40 (7) → 42 (3): K12 and Kjøl | the legend's 3 | `FrysDiskKort` on an AC unit gone; `Nål`, `Plugg` | only the *Kommunikasjonsfeil* icon, for which the Designer has no object |
| 2349 Oversikt, 10214 Maskin, VGV, 360.01 Ventilasjon | as before | as before | as before | as before (10214 Maskin: a few specks fewer) |

Not run in the live Designer.

### Display cases and the Designer's other objects, native wherever one fits (v1.82.0)

Thomas, with screenshots of the Designer's palette (the `R_dummy` cases for medium, low and heated temperature, lying
and standing; the `disk_type_V3` multi objects; the cabinet container; room control; the Left/Top/Width/Height panel):
*Display cases are also IWMAC Designer objects that can be resized. Can you update the tool so that, whenever a display
case or another object can be replaced with an existing IWMAC Designer object, it uses the native IWMAC Designer object
instead of a VectorCraft .ai vector object? … Make sure the objects are correctly positioned, scaled, and aligned to
match the original design. Only use VectorCraft vector objects when no suitable native IWMAC Designer object is
available.*

- **A house symbol that is a case becomes the Designer's case.** Some house symbols found in a picture, exactly or as
  the closest, have a template that is a box the Designer draws itself (`iwdieVzBoxTemplate`). That means one of the
  `R_dummy` colours with 4 px corners, or a header's grey with square ones. Such a symbol becomes that object
  (`iwdieVzBoxKind`): lying when it is wider than high, standing otherwise.
  - **Sized by the picture.** It takes the size its colour has in the picture as it came, not the template's size.
  - **Only in that colour.** Half of its box or more must be within 36 of the case's colour. A case drawn in another
    colour stays the house symbol.
  - **Never hiding anything.** If another house symbol covers more than a tenth of it, or more than 2 % of its inside
    is still drawn, it stays the house symbol.
- **The legend's pills are cases too.** The Oversikt legend draws *Varme*, *Kjøl* and *Frys* as pills in the cases'
  colours, each with a light ring. The boxes step (1.80.0) now takes a case's colour drawn as a pill, round ends and
  all, when it is under 40 px across (`iwdieVzBoxes`: each corner more off the colour than on it, and at most a twelfth
  of its box off a pill's shape). The ring is taken out with it.
  - **Before.** 10214's pills were the house's box-shaped `GulDisk`, `KjølOvalDisk` and `FrysDiskSmal`, at the
    templates' own sizes, up to 9 px off. On 2349's Oversikt the *Kjøl* pill stayed vector: so much of 2349 is that
    light blue that the closest search took it for the picture's ground.
  - **Shape.** The Designer draws its cases with 4 px corners, not round ends.
- **Every kind the Designer has is searched by shape.** The search for the Designer's objects by shape (1.81.0) now
  takes every kind with pictures in one of the Designer's object folders, at 8 to 120 px (`IWDIE_VZ_OBJECT_FOLDERS`):
  valves, pumps, compressors, fans, indicators, status symbols, and the ventilation's dampers, fans, heat exchangers
  and filters. The Designer's registry has 229 such kinds; before, only the catalogue's were searched. A kind found is
  synced as itself, in its role's z band (`iwdieVcKnowKinds`).
  - **Its colours count for less.** A state picture shows the state it was drawn in: a valve's white port on another
    side, green for running. For these pictures the colour penalty is halved, and colours up to 130 apart are taken
    where the shape fits closely (F 0.95, IoU 0.6).
  - **Which kind is placed.** Several kinds can show the same picture. If the panel uses none of them, the choice goes
    in this order (`iwdieVzTwinKind` with the picture):
    1. Normal logic before inverted (`_inv`).
    2. The kind whose own picture (the Designer's `file`) is the one found, so the object shows it unlinked.
    3. The plainest: the fewest pictures.
  - **On the Oversikt legend** this gives `V3_R_24px_circular_cooling_nrm` for *Kjøl/Frys pågår*,
    `V3_R_24px_circular_defrost_nrm` for *Avriming pågår*, and the static bell `V3_R_34px_noanim_circular_alarm_nrm`
    for *Alarm*. Before, any kind with a `file` counted: the evaporator's state icon was placed for *Kjøl/Frys pågår*,
    and it shows the defrost picture unlinked.
  - **On 10214's Maskin** the 3-way valve stays `v3_3w_valve_right_down_nrm`, although it was found in its OFF picture
    and the inverted kind's own picture is OFF.
- **Not used, and why:**
  - **`Refrigeration_Cont`:** the numeric objects are cabinet containers that hold other objects. The `R_dummy`
    objects are the cases.
  - **`disk_type_V3_*`:** link buttons to another page. A picture does not say which page.
  - **A valve with the panel's own LED on its actuator** stays the house symbol: the LED shows its state (1.77.0's rule).
    This is 10214's other 3-way valve.

Checked in the stub host, with Myriad Pro on the card and every object picture fetched read-only from `/iw_icons/`:

| Picture | Cases and boxes as the Designer's | IWMAC objects by shape | Ctrl+S |
|---|---|---|---|
| 10214 Oversikt | 35, the legend's 3 pills among them, within 1 px of the picture's edges | 3: the legend's alarm, *Kjøl/Frys pågår*, *Avriming pågår* | 80 placed |
| 2349 Oversikt | 47, the 3 pills among them, within 1 px | 3, as on 10214 | 109 placed |
| 10214 Oversikt, the cases' colours shifted by 18 | 34, all from house symbols, within 1 px of the plain picture's boxes | 3 | 79 placed |
| 10214 Maskin | none (it has none) | the valve, as in 1.81.0 | 77 placed |

The third row exercises the house symbols that become boxes. When the colours are off, the boxes step finds nothing,
and the cases come through the house symbols. Only the 73 × 123 room is missing, because the house has no symbol that
size. Not run in the live Designer.

### The Designer's object, else the house's closest component, else vector; pipes as the house's pipe pieces (v1.81.0)

Thomas: *so if you can find the object in iwmac objects you can look for it in vectorCraft .ai object or fallback of that
it replaces whats in vectorcraft so close as possible / thats for pipes also / so if you can no vector at all that will
be last fallback*, and then: *pipes are also .ai objects*.

- **The order now.** Each thing in the picture becomes the first of these that has it:
  1. **An IWMAC object** the Designer's own pictures find exactly (1.77.0).
  2. **A label or a box** (1.78.0 to 1.80.0).
  3. **An IWMAC object by its shape (new).** The objects' state pictures are weighed against what is left, unturned.
     On 10214's Maskin, one of its 3-way motor valves became the Designer's own valve object, which can show its
     state. On the Oversikt, the legend's alarm bell became the Designer's alarm object.
  4. **A house symbol** the template's own pictures find exactly (1.74.0).
  5. **The house's closest component by its shape (new).** These are the Maskin and Oversikt templates' components,
     as VectorCraft's Libraries hold them, the small ones too: flow arrows, sensors' leads, pipe bends.
  6. **Vector:** only what none of these has.
- **By its shape.** What is left is taken apart into elements: patches of ink that are neither ground nor pipe.
  - **Weighing.** Each element is weighed against every component turned four ways and as big within a quarter:
    the share of the component's ink that the element has within a pixel, and the other way round, with the exact
    overlap counting as much again or more (`iwdieVzClosest`). The exact overlap tells a right arrow from a left one.
  - **Taken** at 0.85 or more (0.95 for an element of under 30 pixels), its colours within 60, or 80 for one that fits
    wholly.
  - **What a component lacks of its element goes with it.** The receiver's coil goes, the gas cooler's frame goes.
  - **A panel nothing fits** (10214's information panel) is weighed again in its parts, on its own colour.
  - **Specks** of under 10 pixels that earlier steps left are taken out.
- **What it made of 10214's Maskin:**
  - Its gas cooler is `Gaskjøler4Lav`, its 3-way motor valves `TreveisMotorventil` (or the Designer's valve object),
    its 2-way valves `VentilHvit` and `Treveisventil`, its receiver `BeholderVindu`.
  - Its 15 flow arrows are `PilLiten`, each pointing its own way, and its 7 sensors' leads are `Føler`.
  - The colours of the motor valves' *m* differ from the template's, and the arrows are under 8 px; that is why the
    exact search found none of these.
- **Pipes as the house's pipe pieces.** Each traced pipe is named after the template's pipe piece for its circuit:
  `RørHøytrykk`, `RørVæske`, `RørSugeMT`, `RørSugeLT` or `RørVarmegjenvinning`. It runs on as one piece under what
  stands on it - a valve, a sensor, a value, a word (`opts.over`) - or across a gap of 6 px at most. A gap with another
  pipe through it is a crossing, as drawn, and stays.
- **Pills of a pipe's colour.** A pipe's colour counts as a pipe only where the pipe is thin. The Oversikt legend's Varme
  pill (the liquid pipe's yellow) and its Frys pill are `GulDisk` and `FrysDiskSmal`, and its Kjøl pill is
  `KjølOvalDisk`.
- **Still vector:** what nothing of the Designer's or the house's is drawn like, mainly the pipes' small dots and dashes
  left over, and a few shapes:
  - 10214's level gauge: the template's `Nivåmåler` is drawn at 19 × 64 or 89, the picture's at 11 × 47, and no size
    is tried.
  - The Oversikt legend's *Kommunikasjonsfeil*, *Kjøl/Frys pågår* and *Avriming pågår* icons.

Checked in the stub host with Myriad Pro on the card. The share of each Maskin drawing left as vector went from almost
everything but the objects and words to the pipes alone (now named pipe pieces) and a handful of marks:

| Picture | House symbols placed (closest of them) | IWMAC objects by shape |
|---|---|---|
| 10214 Maskin | 29 (27) | 1 valve |
| 2349 Maskin | 28 (26) | 1 valve |
| 10214 Oversikt | 7 (7): AC1 and AC2, the legend's pills, IWT, Plugin | 1 (the legend's alarm) |
| 2349 Oversikt | 13 (8) | 1 (the legend's alarm) |

The words, boxes and objects of 1.80.0 are as before. The jobs take 12 to 15 s.

### Cases, rooms and bars become the Designer's own boxes (v1.80.0)

Thomas: *i think actually everything in the drawings should be objects from the databse so as little as possible to be
vector*.

- **The boxes the Designer draws itself.** His Oversikt pictures draw their cases and rooms in exactly the colours of the
  Designer's `number_v3_R_dummy_*` boxes (`V3_iw_xo_components.css`): medium temperature #b1e1ef, low #8eb2d1, heated
  #f3c96a, their corners 4 px round. His ventilation panels draw their right-hand column in a header's grey, #cdd2d7.
  - **Now:** *Vectorize image* finds each such box (`iwdieVzBoxes`) and makes it that object at its size: a case or room
    lying or standing (`number_v3_R_dummy_medium_temp_horis`, `…_low_temp`, `…_heated_vert` and so on), or a header
    in white, grey 25, 50, 75 or app grey. The paper has a step for it, *Cases, rooms and bars*, after the words and
    before the house symbols.
  - **Under everything.** A box is placed at z 5, under the panel's other objects: a case's alarm, defrost icon and value
    box stand on it, as before. On VectorCraft's IWMAC-objekter its placeholder comes first, in its colour with its
    corners round.
  - **Only a clean box.** An object covers the picture under it, so a box with anything drawn on it stays drawing: 2349's
    rooms with their condensing units, a gas cooler with its fans, the Oversikt legend's grey column. Its sides must be
    its colour past its corners, its corners no rounder than the Designer's (the legend's *Frys* pill is no case), and its
    inside its colour but for words and objects already taken out of it.
  - **Not an object's own look.** A box that one of the panel's objects, or one found in the picture, covers for seven
    tenths or more - an AK-PC state's grey, a compressor's white body, a value's pill - is taken out with that object, not
    placed again. One of the panel's own boxes is not placed twice.
  - **Found on the picture as it came.** The steps before cut the objects' looks out of the picture, and that had left
    holes in 10214's freezer islands; what they took out now counts as the box's own, inside it.
- **A word beside a case read its edge as a letter.** 2349's *F14* read as *F14)*, and *F8* and *F9* as *F8i* and *F9i*.
  The words are now read with the boxes' edges painted the colour round them (`iwdieVzBoxEdgesOff`).
- **Nothing to read.** With the picture's font on the card and no run of it reading as words - a ventilation panel whose
  words are all labels already - the paper says *no run of it reads as words*, not to add the font.
- **What else his drawings hold, and whether the Designer has it:**
  - **Valves:** the Designer's valve objects (its 2-way and 3-way valves, 64 pictures) look otherwise than his pictures'
    valves, which have an *m* in the motor's circle. Searched for, they matched only dark pills, none of them valves, so
    the valves stay house symbols and drawing.
  - **Its decorative objects** (`number_v3_dummy_*`: black valves, pumps, compressors, air heaters, dotted connector
    lines, small arrows): none of his pictures draws them. The pumps and compressors his pictures draw are found as the
    Designer's live objects already (1.77.0).
  - **Pipes, the receiver and other vessels, pills with round ends:** the Designer has no object drawn so, and they stay
    drawing.

Checked in the stub host with Myriad Pro on the card, then synced:

| Picture | Boxes placed | Before |
|---|---|---|
| 10214 Oversikt | 32: its 30 cases, Meierirom and Fryserom | 31 house symbols |
| 2349 Oversikt | 44 cases | 47 house symbols; *F14)*, *F8i*, *F9i* read |
| 10214 VGV | its grey column | traced |
| 10214 Maskin | none | none |

- **Sync:** the boxes are placed at their size at z 5, and the panel's own objects are not changed.
- **The words:** 10214's Oversikt and Maskin read 42 and 71 words as before, and 2349's Oversikt now reads *F14*, *F8*
  and *F9*.
- Not run in the live Designer.

### Every word read, the picture's font here or not; pipes by the house's circuits (v1.79.0)

Thomas, of 10214's Maskin, with screenshots before and after and its receiver open in VectorCraft: *you can see there is
some differences on maskin also / for the tank i think we have object for it. and the same with pipes / do more deep
dive and check*; and then: *all text should object text from the database so no vector on all panels*.

- **Every word read, the picture's font here or not.** 1.78.1 read the words only in a font you gave (dropped on the
  card, or Myriad Pro installed) and left them as drawing otherwise.
  - **Now:** without the picture's font, they are read in the font here that reads them best - Roboto, Arial or Segoe
    UI, by the same median cost, at 0.35 or better - and the words the panel, its plant and the house know count for
    more (`opts.loose`).
  - **A known word or phrase is weighed at every size and baseline tried**, where it stands as wide as the ink or up to
    a sixth wider (`iwdieTxKnownBest`). In Segoe UI, the *M* of *M-T Sd °C* read best as *fv* at 12 px, while the phrase
    itself fitted best at 10.5.
  - **Taken more readily:** a known word whose letters explain its ink at 0.3 (0.24 in the picture's own font).
  - **An icon two columns from its words** is read off at either end of them (the motor valve beside *V3hr*).
  - **Said so.** The paper and the opening toast name the font and say it is not the picture's own; dropping the
    picture's font on the card still reads surer. Only where no font here reads the picture as words do they stay
    drawing.
- **Read better in any font:**
  - **Known words at any size** in the picture's own font too: 10214's Energi *Hovedinntak* (read freely as no words
    at 11.5 px, where the word fits at 13.5) and the *M-T* of 2349's Maskin legend are now read.
  - **A code may have small letters before its number** (*Shr4*, *Sc3*), as *V3hr* has them after it. *5hr4* does not
    look like a code, so *Shr4* is read.
  - **A *q* not before a *u*** weighs a little more: *V3gc%*, not *V3qc%*.
  - **A unit beside its code** that reads as no words alone (the *°C* of *Sc3 °C*, three columns off) is weighed at the
    code's size and baseline and joins it.
  - **The house's case** is taken over the picture's only where the two look alike (c, o, s, u, v, w, x, z, and l):
    the picture's *butikk* stays *butikk*.
- **Pipes.** The Maskin template's pipes, and those Claude draws through the bridge, lie on *Rør* in one group per
  circuit (HP, Liquid, MT suction, LT suction, Heat recovery), each in its circuit's colour (`IWDIE_CB_CIRCUITS`).
  *Vectorize image* traced them as loose lines in the colours it read: 10214's HP as #f89f7a, not #f79f79, and its MT
  suction as #84c3d0, not #83c2ce.
  - **Now:** each traced pipe whose colour is a circuit's (the nearest, within 40) goes in that circuit's group, in its
    colour exactly. VectorCraft, Claude's `iwmac_scene` and the export then know each pipe's circuit.
  - **Other colours:** a pipe of no circuit's colour stays loose, as traced.
  - **No pipe objects.** The Designer's pipe kinds are ventilation ducts and its line kinds short dotted connectors
    (`number_v3_dummy_*_Line_*`), and none of his panels uses one for a pipe: the pipes stay drawing.
- **The receiver is not an IWMAC object.** The Designer has no tank or receiver kind among its 1 769.
  - **The house library** has eight vessel symbols. 10214's receiver is `BeholderVindu` (the receiver's body, with its
    window) with `BeholderVarmespiral`'s coil drawn in its bottom and `BeholderNivå`'s level bar on its right. None of
    the eight alone is drawn like that.
  - **Nearest match:** `BeholderVindu` differs on 14.5 % of its pixels (mean 22.4, where the search accepts 22 at most).
    Placed anyway, it would cover the coil, since a symbol is drawn over the trace.
  - **So the receiver stays traced**, as the picture has it. A symbol for it (a receiver with a window, a coil and a
    level bar) would be a new member of the Maskin template.
- **The other differences in his screenshot** came from 1.78.0 reading in Segoe UI: *L-T* read as *I-T*, *M-T Sd °C*
  in two pieces with its *°C* lost, *Room temperature* in two sizes, *= Gc-bypass active* without its *Gc-*. All 71
  words now read right, with Myriad Pro or without it.

Checked in the stub host, with the live Designer's label rules on the stub page and, on 10214's pictures, the plant's 42
unit names as the live Designer has them:

| Picture | Myriad Pro on the card | Without it |
|---|---|---|
| 10214 Oversikt | 42 of 42 right | 42 of 42 (Segoe UI) |
| 10214 Maskin | 71 of 71 | 71 of 71 (Segoe UI) |
| 10214 VGV | 7 of 7 | 7 of 7 (Roboto) |
| 10214 Energi | 8, *Hovedinntak* new | 8 (Roboto) |
| 2349 Maskin | 67, the legend's *M-T* new | 64 of the 67 (Segoe UI): *To °C* read as *Tc °C* twice, the legend's *M-T* left as drawing |

- **The plant's unit names count.** With the stub's two units alone, Segoe UI read the Oversikt's *F76* as *F 76* and
  *F65* as *F63*.
- **Sync:** Ctrl+S on the Oversikt and the Maskin with Myriad Pro gave *✓ Synced · 42 placed* and *✓ Synced · 76
  placed*, as 1.78.1 did.
- **Time:** the Oversikt took 10.8 s with the font and 15.6 s without it, the Maskin 14.4 s and 20.5 s.
- **Pipes:** 10214's Maskin has 14 HP, 3 Liquid, 11 MT suction, 4 LT suction and 4 Heat recovery pipes, none loose;
  2349's Maskin has 14, 3, 10, 3 and 4. The house Maskin drawing keeps its 6 symbols and 7 objects.
- Not run in the live Designer.

### What the first run on 10214 showed, put right (v1.78.1)

Thomas, after 1.78.0 on 10214's Oversikt, with screenshots of the panel before and after: *you can see there is some
differences / do more deep dive and check*.

- **The cases' red circles became bells.** Not this script. The Designer's alarm picture, `BellPumping_34.gif`, is a
  45-frame animation of 1.35 s whose frames 4 to 7 are a red circle without the bell, and the two screenshots caught
  different frames.
- **The words were read in Segoe UI, not in the picture's Myriad Pro.** That is why the legend's *Kjøl* and the case
  code *K12* stayed drawing (the legend's *ø* traced as a filled dot), *F76* became *F 76*, and the labels came out 11,
  12 and 14 px. 1.78.0 took the first font that read one of the four widest runs at 0.1 or better. Segoe UI did that on
  the Oversikt, while Myriad Pro failed that same test on Energi.
  - **A font you give now wins.** A font dropped on the card, or Myriad Pro installed in Windows, is used whenever it
    reads the picture at all. Roboto, Arial and Segoe UI are used only when one reads it very well. Each font is tried
    on up to eight runs most like single words, scored by the median cost of their readings (`iwdieTxFit`,
    `iwdieTxFontChoice`).
  - **Why so strict.** Measured on five of his pictures, Myriad Pro scored 0.05 to 0.17, Segoe UI 0.07 to 0.19, Roboto
    0.07 to 0.26 and Arial 0.11 to 0.25. A wrong font can fit one picture better than the right font fits another, so
    a font nobody gave is taken only at 0.05 or better.
  - **Without the picture's font nothing is read**, and the paper and the opening toast say so: *not read: its font is
    not here (fonts here: Roboto, Arial, Segoe UI) - drop the picture's font on the card …*
  - **Roboto now loads.** It was never tried before: Google Fonts now serves it as one variable face of weight
    *400 700*, and the reader only took weight 400.
  - **Faster.** A font you give that reads the picture ends the search, so the other fonts are tried only when needed.
- **The labels looked bigger than the picture's words.** The Designer draws its labels in `roboto, sans-serif`, weight
  500, colour #3C505E (`V3_iw_xo_components.css`). His PC has no Roboto, so they show in Arial. Both are wider than
  Myriad Pro, so a label as tall as its word (1.78.0) stands out past it.
  - **Size.** Each label's size is now weighed between its word's width and its capitals' height, measured in the
    label's own font as the Designer draws it, with standing out wider counting half again.
  - **Consistency.** Each word takes the size that is best for it and for the words read within half a pixel of its
    size, so a legend's words match and a code read a pixel off takes its group's size.
  - **On 10214's Oversikt:** the legend is 12 px, the cases' codes and rooms 11 px, the title 16 px.
  - **Not used:** the Designer's 8 and 10 px labels, which it draws at 11 px.
  - **Still darker** than the picture's grey: that is the colour of the Designer's labels.
- **The legend's Kjøl pill became a case end with grey stubs.** The Oversikt template's `KjølGavl` (60 × 29, its corners
  a little round) was placed on it. It is taller than the pill's fill, so a whole side of it lay on the pill's light rim,
  yet the whole still matched.
  - **The fix:** a house symbol must now also match along each of its sides, its three outer rows or columns there, or
    one pixel across (for an outline a pixel off).
  - **10214's freezer islands:** each `FrysKvadratStor` square spanned two freezer cases and the gap between them. They
    are now two `FrysDisk` cases each.
  - **2349's Oversikt:** its islands are now their `FrysGavl` ends and `FrysDisk` cases (47 symbols where 1.77.0 found
    40), and its legend's pills are left alone.
  - **IWMAC objects (1.77.0)** are still matched on the whole: their sides differ a little from one object to another.
- **One of 10214's Maskin objects was rewritten at every sync** (since before 1.78). It is a custom JSON object of
  40 × 20 whose placeholder says *Free wi…*, and each sync took that as its new text, because the caption was compared
  at the catalogue's size. It is now compared at the object's own size.

Checked in the stub host, with the live Designer's label rules on the stub page:

- **10214's Oversikt, Myriad Pro kept on the card:** 42 words, all right (legend 12 px, codes and rooms 11, title 16), 31
  symbols with the legend's pills left alone. Ctrl+S in the hosted VectorCraft gave *✓ Synced · 42 placed*. The job took
  10.2 s.
- **10214's Maskin:** 71 words. Ctrl+S gave *✓ Synced · 76 placed* (its 5 IWMAC objects found too), and no object of
  the panel changed. The job took 13.8 s.
- **Without the font, on all five pictures:** no word read, and the paper says why.
- **Symbols and objects against 1.77:** 2349's and 4559's Maskin are unchanged. The house Maskin drawing keeps its 6
  symbols and 7 objects. 4559's Oversikt only loses its legend's `KjølGavl`. 2349's Oversikt changes as above.
- Not run in the live Designer.

### Text in the picture becomes label objects (v1.78.0)

Thomas, with 10214's Oversikt legend and a crop of *K13* and *K14* beside their cases: *i think more can be replaced with
objects from database / like info panel letters and objects / save with the text next to the disk can be replace with
object text etc / do a deep dive and se if you find more*.

On his plants every name is a label object. In a picture of pixels the names are letters, and *Vectorize image* traced
each into filled shapes: a case's *K13*, a room's *Meierirom*, a Maskin's whole information column. Now the words are
read, and each word read surely becomes a label object with that text:

- **Where the words are.** The tracer's word boxes (those the export lists as `picture.texts`), found off the page on the
  picture without its pills' rings and its pipes. Boxes on one line at like heights are one run; an icon beside a word
  stays apart.
- **Read in the picture's own font.** The browser draws every letter of the font at each size the run may be, in half
  pixels, at four quarter-pixel phases. A dynamic programme over the pen's positions finds the letters that best explain
  the run's ink; a reading's cost is what its letters, laid where they stand, leave unexplained. Then come the readings
  its look-alikes give (*rn* and *m*, *O* and *0*, *l*, *I* and *1*), a case's code as codes are written (*K05*, not
  *K,0S*), and the words the panel, its plant and the house know: the panel's objects' texts, the plant's unit names, a
  Maskin's captions and legend, the Oversikt legend, rooms, heating and ventilation words. Each is weighed by how well it
  alone explains the ink. A word is known whatever its case, and a known word as wide as the ink is weighed even when the
  reading is far from it: *Maskin* had been read as *fvtaskin*.
- **A run that does not read whole** is read in pieces (a word, an icon, a word), and a wide piece that does not read in
  smaller pieces. A Maskin legend's *V3gc*, valve, *= Gc-bypass active* is one run as high as the valve. Pieces on one
  baseline are joined, and a word read by two runs is kept once, the wider reading.
- **Taken only when sure.** A reading must look like words and explain its ink well. A known word may explain it a
  little less well, and so may one shaped as panels' words are (a code, a unit, capitals, a short capitalised word). It
  needs two letters at least, and a capital inside a word nobody knows (*VarmlLrftspor*) is a letter read wrong. A word
  not read surely stays drawing.
- **The label.** The Designer's label (`number_v3_label_8px_norm` to `_20px_norm`) whose capitals stand as high as the
  picture's, white where the text is light on a dark ground, placed where the picture had the word. Its letters come out
  of the picture, so the trace leaves them. It goes on *IWMAC-objekter* as a placeholder (`IWMAC number_v3_label_…`,
  marked `data-iwdie-read`) with the word as its text, and Ctrl+S in VectorCraft places it as a label object with that
  text, unlinked.
- **The font.** Thomas's pictures are in Illustrator's default font, Myriad Pro, which the browser does not have unless it
  is installed in Windows. The card says which fonts it reads in, and *Add the picture's font…* (or a font file dropped
  on the card) keeps a font in Tampermonkey's storage: four at most, 4 MB each. `MyriadPro-Regular.otf` is in
  Illustrator's `Support Files\Required\Fonts` folder. The fonts are tried in order: the card's, Myriad Pro if installed,
  Roboto, Arial, Segoe UI. The first that reads one of the four widest runs surely is used, and no other. In a font that
  is not the picture's, *S* reads as *5* and *H* as *FI*: on 2349's Maskin in Segoe UI, 5 of 60 labels were wrong. So
  when none reads surely, the words stay drawing, and the paper and the opening toast say to add the picture's font.
- **Off on the card.** A second box, ticked: *Text in the picture becomes label objects*. The paper shows the step *Text
  in the picture* after *IWMAC objects in the picture* and before *House symbols*: erased letters are not taken for a
  symbol's strokes, and a symbol's outline is not read as letters.
- **Time.** In workers, up to four, for at most 30 s; each reading 1.5 s at most.

Checked in the stub host, with Myriad Pro kept on the card and each panel's own objects:

- **10214's Oversikt:** 42 words, all right: the cases' codes (*K01* to *K45*, *F60* to *F76*, *AC1*, *AC2*),
  *Meierirom*, *Fryserom* and the legend (*Symbolforklaring*, *Varme*, *Kjøl*, *Frys*, *Kommunikasjonsfeil*, *Alarm*,
  *Kjøl/Frys pågår*, *Avriming pågår*, *IWT*, *Plugin*). The job took 11.6 s. Ctrl+S in the hosted VectorCraft 0.11.0
  placed the 42 as label objects: *✓ Synced · 42 placed*.
- **10214's Maskin:** 71 words, all right: the information column (its bar's *Heat recovery information* a white
  label), the captions with their units (*Tc °C*, *Pgc bar*, *Vhp OD %*), the legend's *= Hr active* and *Gc-bypass
  active*. The job took 16.7 s.
- **2349's Maskin:** 66 words, all right, and its four compressors found as objects as in 1.77.0. The job took 15.2 s.
- **10214's VGV:** 7 words, all right (*Varmluftsport*, *inngangsparti*, *Aerotemper*, *Lager*, *Ventilasjon*, *butikk*,
  *Magna3*). **10214's Energi:** 7, all right (*Maskin*, *Kjøl og Frys*, *Total energi (kWh)* and *Effekt (kW)* twice,
  *L3*).
- **Unticked:** no word read; the house symbols as before.
- **Without the picture's font** (2349's Maskin; the browser had Arial and Segoe UI): no word read, the paper saying *not
  read: none of the fonts here reads it surely … drop the picture's font on the card*; the compressors and the house
  symbols as before.
- Not run in the live Designer.

Not read: a word of one letter, and what stands under the panel's objects (taken out before, as since 1.74.0). Text in
another weight than the font given reads less surely; 10214's VGV, heavier than Myriad Pro Regular, read right with the
house's heating words. Every label is a `_norm` one: a bold caption becomes a normal label.

**Also looked at in this pass, and left as they are:**

- **The Oversikt legend's icons** are the Designer's own pictures at their own sizes: the bell beside *Alarm* (34 px,
  `AlarmIcon_34` and `BellPumping_34`), the snowflake beside *Kjøl/Frys pågår* and the drop beside *Avriming pågår* (24
  px, `FreezeIcon_24` and `DefrostIcon_24`). 1.77.0 does not find them: it looks for the kinds of the object catalogue
  and of the panel, and these are pictures in `iw_icons` that no such kind shows. They stay drawn on purpose: as
  unlinked objects they would show their state 0, which for these is `transp.gif`, nothing at all. The icon beside
  *Kommunikasjonsfeil* (28 px) matches no picture of the Designer's.
- **IWT and Plugin** have objects of their own in the Designer, `disk_type_V3_iwt` and `disk_type_V3_plugin` (62 × 40).
  The legend's samples of them stay drawing, like the bell.
- **A Maskin's header bars** (*Heat recovery information*): the Designer has a header bar object,
  `number_v3_header_grey75`, but not in the bars' colour. The bar stays drawn, and its words become a white label on it.

### The progress tab keeps moving while the page works (v1.77.1)

Thomas, with a screenshot of the tab at *0.0 s* and no step running: *is it possible show better progress here? sometimes
it just look like have frozen but it still works*.

The tab that shows the steps is the Designer page's own (about:blank, written by the page), so it runs on that page's
thread. A step that holds the thread held the tab too: its clock, bar and step marks stood still. Measured in the stub
host on 2349's Maskin with its 58 objects, a Vectorize image held the thread three times. First came 0.3 s at the very
start, reading the pills under the panel's objects; then 0.07 s and 0.35 s while the house symbols' templates were drawn
and read. The first hold came before the tab had drawn any step, so it showed *0.0 s* with nothing running. On a slower
PC or a bigger panel each lasts longer.

- **What moves by itself.** The running step has a turning ring, and a sheen runs along the bar. Both are CSS transform
  animations, which Chrome runs in its compositor, off the page's thread, so they keep moving while a step holds it. In
  the stub host, the tab was recorded while the Designer page was held busy for 2 s: the ring changed in all 200 frames
  and the sheen in 75, while the clock stood still.
- **A step shows before its work starts.** The first step shows running before the picture is read. Each step is drawn
  (one frame) before its work starts. Drawing the house symbols' templates and reading their looks are now two shorter
  holds instead of one.
- **The Designer's state pictures counted.** The first Vectorize image in a week fetches the Designer's pictures of every
  state (1.77.0), and now counts them as they come: *43 of 89 pictures fetched from the Designer (kept a week)*.

On 2349's Maskin, 1.77.1 showed the first step running at 0.1 s. Its holds were 83, 273, 76, 77 and 285 ms, and the job
took 4.5 s (4.3 s before) with the same objects and symbols found. The clock and the words still wait while a step holds
the thread; then only the ring and the sheen move. Not run in the live Designer.

### IWMAC objects found in the picture become objects (v1.77.0)

Thomas: *Before vectorizing an image, … check whether any of the elements match existing objects in the IWMAC object
archive … automatically replace those elements with the corresponding objects … only vectorize elements that cannot be
matched*.

House symbols have been matched since 1.74.0; IWMAC objects were not. Where a picture showed one as pixels, drawn with
the Designer's own picture of it and with no object of the panel on it, *Vectorize image* traced it into shapes:

- 2349's Maskin shows its four compressors with the live compressor's own picture (*Kompressor ON*), and no object of
  the panel stands on any of them. 1.76.0 put the Maskin template's *Kompressor* symbol there.
- A house drawing shows AK-PC states (*Manuel*, *Alarm*) and a pump where no object stands yet.

Now, before the house symbols are looked for and the rest is traced:

- **The archive.** Every kind of the object catalogue that shows a state with a picture of its own: alarms, LEDs, fans,
  pumps, valves, compressors, AK-PC, buttons, dampers, coils and filters, and the panel's own kinds of those roles. Not
  values, labels, headers, ducts, rooms or navigation buttons: a value stands on the picture's pill, and the rest is
  drawing.
- **Every state.** Each kind's pictures as the Designer defines them, its default picture and every picture of its status
  array, fetched from the Designer's `iw_icons` (GETs only) and kept a week in Tampermonkey's storage
  (`iwdie.vc.states`). Each is drawn at its kind's size and looked for at 1:1, unturned, in workers, for at most 15 s. A
  picture several kinds share is looked for once.
- **Which kind.** A shared picture (a grey LED is three LEDs' *off*, *Running* four AK-PC kinds') becomes the kind the
  panel uses most, else the kind whose default picture it is, else the first in the catalogue.
- **Read against the panel's objects**, the one over at least half of the smaller box:
  - **None there:** the picture shows an object the panel lacks. It comes out of the picture and goes on the layer
    *IWMAC-objekter* as that object's placeholder (`IWMAC <kind>`, marked `data-iwdie-found`), showing the state the
    picture showed. Ctrl+S in VectorCraft places it as a new object, unlinked, to link as any new object; the toast
    says so.
  - **One of its role:** that object a second time. It comes out, as 1.74.0 took an object's own look out.
  - **One of another role** (an LED on a compressor): left in the picture for the house symbols and the trace.
- **Then the rest, as before.** The house symbols are looked for on what is left, and the rest is vectorized.
- **Off on the card.** The card has a box, ticked: *IWMAC objects found in the picture become objects, not shapes*.
  Untick it to vectorize them as before. The paper shows the step as *IWMAC objects in the picture*.
- **The export reads a picture of pixels the same way** before it looks for its house symbols: what the objects stand
  on and their own looks out first, then the IWMAC objects the picture shows. `overview.picture.object_looks` lists
  them (kind, box, and the object on each as `o#`, or null where the panel lacks one) and `picture.how` counts them, so
  Copilot places those as objects instead of drawing them. Taking the objects' pills out first also ended two false
  valves on 2349's Maskin: the 1.76.0 export, which searched the picture as it was, found an actuator valve where the
  *Manuel* pills meet and a solenoid valve on an *M-T* pill.

Checked in the stub host, through the card and the hosted VectorCraft 0.11.0:

- **A house drawing** (`maskin-ref.png`) with 9 objects. Found: five AK-PC condenser controllers showing *Manuel*, an
  AK-PC controller showing *Alarm*, and a running pump. After them, the heat exchanger and five compressors as house
  symbols. Ctrl+S placed the seven as new objects: 9 objects became 16.
- **2349's Maskin** with its 58 objects. Found: the four compressors, as `V3_co2_compressor_31x35_nrm`, running. After
  them, the heat exchanger and the oil separator (*Beholder*) as house symbols. The job took 3.7 s (3.5 s unticked).
  Its export, in 2.7 s, lists the four in `object_looks`, and the kit's `validate-export.py` finds no error in it.
- **2349's Oversikt.** No IWMAC object found; its 40 house symbols as before.
- **Unticked.** None found; the compressors stayed *Kompressor* symbols.
- **Three of Thomas's own exports of the day** (made with 1.74.0), their pictures and objects:
  - 4559's Maskin (10245's is the same picture): its three compressor pictures found, each with no object on it (the
    AK-PC strips stand below them), and the oil separator as a house symbol.
  - 4559's Oversikt: no IWMAC object found, and its 10 cases as house symbols.

  On such a Maskin the compressors drawn into the picture become compressor objects, unlinked: link them, or untick the
  box to keep them as drawing.
- Not run in the live Designer.

Not found: an object drawn at another size than the Designer's, or turned. Found when it should not be: a legend's
sample of an object's picture becomes an object too, so delete it in VectorCraft before Ctrl+S.

### The export as Copilot reads it (v1.76.0)

Thomas: *conduct a comprehensive deep dive into the JSON export functionality … make the exported JSON as easy as
possible for the Copilot agent to read, understand, and use when generating IWMAC overview pictures … Maintain full
compatibility*. Measured on four fresh 1.75.1 exports and every kit script that reads one:

- A picture made in VectorCraft came out as VectorCraft saved it: 65 style classes on 1 704 elements, no size on its
  root, and the picture it was first vectorized from as a hidden base64 `<image>`, 202 kB of 606. The kit's own picture
  check gave it back, unchanged, about 40 errors.
- A picture of pixels, which most production panels have, got no house symbols and no layout: only *Vectorize image*
  looked for them.
- What each object belongs to, the pill it stands on and the symbol it is by, was drawn on the `-for-ai.png` and
  written nowhere in the file.
- The file opened with 57 kB of the format's rules before a word about the panel.

1.76.0 changes reading material and the drawing's form only. The format stays `iwmac-designer-panel` v1, and every file
Insert took before, it takes now:

- **`contents`**, right after `generator`: what the panel is in one sentence, every key with its size in kB and its use
  (*read first*, *read*, *search*, *copy from*, *look up*, *skip*), the `-for-ai.png`'s name, and Insert's own check of
  the file as it went out.
- **`overview.objects`**: every object once, `o0`… as the `-for-ai.png` marks them. Each has its box on the canvas (a
  container item's too), role, text, alias, unit, link and binding check, plus the pill (`P#`), house symbol (`S#`)
  and caption it belongs to.
- **The house symbols of a picture of pixels**, found at export as *Vectorize image* finds them: the Oversikt template's
  on an Oversikt, the Maskin template's on another drawn panel, for at most 20 s. `overview.picture.symbols` and
  `picture.layout` now come for a raster too. A symbol inside a group of the drawing's own counts as well. The
  `-for-ai.png` outlines each one in green as `S1`…
- **A drawing VectorCraft saved, handed over in the form the drawing rules ask:**
  - its root sized;
  - every fill, stroke and font written on its element, its `<style>` gone;
  - the hidden original left to `image_data`, its layer kept and marked `data-iwdie-original="image_data"`.

  Unchanged, Insert keeps the picture as before. Changed, Insert puts the original back from the file's picture before
  it draws the drawing, so *Edit in VectorCraft* can still start again from it.
- **The schema** covers the whole export and is published beside the script as
  [`panel-file.schema.json`](panel-file.schema.json), where its `$id` points.

Checked:

- **Stub host.**
  - The Maskin picture of pixels exported in 3.5 s (2.5 s before) with 7 house symbols, the same seven its drawing
    lists.
  - 2349's Oversikt picture exported in 4.3 s with 40 symbols; 121 of its 140 objects are tied to one.
  - The drawing came out at 397 kB, down from 592.
  - Inserted unchanged, the picture was the export's own byte for byte. Inserted changed, the new PNG's drawing held
    the change and the original again.
- **Drawn in Chrome as the sync draws.** The old and the new drawing differ in 0 of 1 050 000 pixels, and so do three
  VectorCraft saves full of text, before and after.
- Not run in the live Designer.

### A transparent picture stays transparent through an edit in VectorCraft (v1.75.1)

Thomas: *Keep transparent pictures transparent in VectorCraft edits* - the gap 1.75.0 left. A panel picture that keeps no
drawing, a PNG from Illustrator or one saved before 1.38.0, went to VectorCraft over the Designer's grey in three ways:
a grey rect at the bottom of Bakgrunn, the picture itself and its hidden original painted over that grey, and Vectorize
image tracing the grey where the picture was transparent. A sync drew all three into the panel's picture, so a
transparent Maskin or Oversikt came back opaque grey on the plant's page.

- **The panel's colour in a group of its own.** It stands at the bottom of Bakgrunn as *Bakgrunnsfarge*. VectorCraft
  still shows the drawing over the Designer's grey. A sync, and Insert, leave the group out of the picture they make;
  the drawing kept in the PNG keeps it for the next edit.
- **The picture as it is.** Where the picture is transparent, the copies VectorCraft gets stay transparent: the picture
  under the drawing, and the hidden original that *Start again from the picture* reads.
- **Vectorize image** leaves undrawn what was transparent in the picture: a shape of the panel's colour whose pixels were
  mostly transparent. A grey the picture drew itself stays.
- A drawing an edit made before 1.75.1 stays opaque: its colour is a bare rect, and the picture it kept was painted
  over it.
- Checked in the stub host on the hosted VectorCraft 0.11.0, the stub's panel colour set to the Designer's grey. The
  sketch's Oversikt was given as a transparent PNG that keeps no drawing: 693 097 transparent pixels. Edit in
  VectorCraft vectorized it, showed it grey under the drawing, and kept the hidden original transparent. VectorCraft
  saved the colour back as `<g id="Bakgrunnsfarge">` holding a path. Ctrl+S gave a PNG transparent at (50, 50),
  (600, 700) and (1000, 100), the legend column `#cdd2d7` and a case `#b0e0ef`. It has 691 277 transparent pixels; the
  vectorized shapes' edges cover the rest. A second edit, from the drawing the PNG kept, gave the same PNG pixel for
  pixel. Not run in the live Designer.

### The Oversikt template's arrangements, placed whole (v1.75.0)

Thomas, with the template's *Kjøle*, *Fryse* and *Diverse Symboler* sheets: *can you also make it this is groupe object
also, so make it permanent in the vectorcraft so its easy for mcp and copilot to place grouped objects also*.

- **What they are.** The template lays its pieces out into 28 arrangements, each case's name written beside it (*K1*
  on the cooling sheet, *F1* on the freezer one). In light blue (`Kjøl…`) and dark blue (`Frys…`) alike: islands of two
  back-to-back rows of 1, 2 or 3 cases with an end case at each end, standing and lying (`KjølØy1Stående` …
  `KjølØy3Stående`, `KjølØy1Liggende` … `KjølØy3Liggende`), a round, a diamond, a ring and an oval island
  (`KjølØyRund`, `KjølØyDiamant`, `KjølØyRing`, `KjølØyOval`), a slim front row with its angled ends
  (`KjølFrontrad`), a run of cases round a corner at 45 degrees (`KjølHjørnerad`) and two curved cases in an S
  (`KjølBueS`). From the *Diverse* sheet: two staffed checkouts (`Kassepar`) and three self-service ones in a row
  (`SelvbetjentKasserad`).
- **Named.** `IWDIE_SYMBOL_GROUPS` holds each as its pieces - the family, its turn and its box, in reading order - and
  where the template writes each case's name. It is generated from the template's own drawing: pieces 8 px or less
  apart are one arrangement, each piece the template component at its place.
- **In VectorCraft.** Libraries and the IWMAC menu offer each as one group, on pages of their own: *Oversikt kjøl
  grupper*, *Oversikt frys grupper* and *Oversikt grupper*. Its pieces are groups named after their families, drawn
  from the library kept or built in. Each case's name is a label placeholder with the template's *K1* or *F1* where the
  template writes it: rename it, and a sync makes it the label object the Designer shows. The banner counts 613 from
  the house templates: the 585 components and the 28 arrangements.
- **The IWMAC menu keeps the names inside a component.** VectorCraft's SVG import names a group by its `id` alone. The
  menu dropped a component's inner groups with only `data-name`, so they came in nameless. It now gives each named
  group an id made of its name as well.
- **For agents.** A drawing places one by its name, as it places a component:
  `<use data-iwdie-symbol="KjølØy3Stående" x="400" y="120"/>`, turned and mirrored whole with `data-iwdie-turn` and
  `data-iwdie-flip`. Insert draws its pieces as one group named after it. Insert's check counts one as lacking only when
  one of its pieces is. An Oversikt's export lists them in `parts.components.groups`, with how many cases each names.
  Claude's bridge places one with `symbol`, with a label object where each case is named: `labels` gives the names in
  reading order, `labels: false` leaves them out, and without it the template's own are used. The scene reads one back
  as one symbol, *arrangement of N pieces*, also when it was dragged from Libraries. MCP server 1.5.0 marks them in
  `iwmac_find`. The Copilot kit lists them in `reference_data/oversikt-groups.json` (with `oversikt-groups.png`), and
  its Oversikt builder places them from a spec's `groups`: each case with its cluster and its name.
- **Two names fixed.** The template's *Diverse* sheet calls the grey pieces 1.72.0 named `Aggregat` and
  `AggregatDobbel` *Selvbetjent kasser* and *Kasser*: checkouts, not condensing units. They are `SelvbetjentKasse`
  (one self-service checkout) and `Kasse` (one staffed checkout) now. A drawing that still places the old names gets
  red dashed boxes.
- Checked in the stub host on the hosted VectorCraft 0.11.0, with nothing kept in the browser: the banner counts *613
  from the house templates*, Libraries shows the three new pages, and the IWMAC menu lists *Oversikt kjøl grupper 13*.
  `KjølØy3Stående` placed from the menu saved as one group with its 16 named children, and Ctrl+S made eight label
  objects with the text *K1*: *8 placed*. `FrysØyRund` dragged from Libraries made four with *F1*. A plain component
  from the menu still lands as one group named after it. Not run in the live Designer.

### A drawing's transparency kept in the panel's picture (v1.75.0)

Thomas, with the sketch's Oversikt on a panel and a Maskin picture beside it: *can you make the background transparent
like this maskin picture? now the background is gray - the info panel on the right should still be gray*.

- **Why it was grey.** The Oversikt is drawn with a transparent drawing area and a grey legend column. Insert JSON drew
  a drawing into the panel's PNG over the Designer's own grey (`#main_image`, `rgb(204,204,204)`), and VectorCraft's
  Ctrl+S did the same. Every transparent pixel came out opaque grey. On the plant's own page, where a transparent
  picture shows the page's `#eeeeee` as his Maskin pictures do, the Oversikt stood out grey.
- **Now.** Both render the drawing on nothing. What the drawing leaves transparent stays transparent in the PNG, and
  what it paints stays opaque: the legend column, the information column, the cases. The Designer still shows its own
  grey under the drawing.
- **A picture opened in VectorCraft from a PNG** (no drawing kept in it) still gets the panel's grey as a ground of its
  own, so a sync keeps it as it looked.
- **The panel he has.** Edit in VectorCraft, then Ctrl+S, makes its picture again from the drawing it keeps,
  transparent, with its objects untouched. So does Insert JSON of the drawing alone with *Apply the background only*.
- Checked in the stub host on the hosted VectorCraft 0.11.0 with the sketch's Oversikt. After Insert, the PNG is
  transparent at (50, 50), (600, 700) and (1000, 100), `#cdd2d7` in the legend column, and `#b0e0ef` in a case. After
  Edit in VectorCraft and Ctrl+S, the same six pixels match. Not run in the live Designer.

### Vectorize image reads the panel's objects and the house symbols (v1.74.0)

Thomas: *you can remove button trace the picture … can you see if you can optimize vectorize image? I have now objects
already in the VectorCraft so maybe it can be easier to vectorize image*.

Measured first, read-only, on eight panels of plants 2349 and 4798 and on the pictures 1.61.0 was tested with. 1.73.6's
Vectorize image went badly wrong on several of them:

- **A border became a huge circle.** An outline was fitted as a circle when all its points lay within 0.25 px plus
  1.2 % of the radius of one. A long thin outline lies that close to a huge circle too. On 2349's Maskin the 2 px bottom
  border of the heat recovery box, 204 px long, became a circle 1216 px across over the top right of the panel; on a
  ventilation picture 87 % of the pixels came out wrong. A circle now also needs the outline's own area and box to be the
  circle's.
- **Two close colours became one.** The palette merged colours under 14 apart, whatever their size. On 2349's Oversikt
  the legend column (205, 210, 215) and the Designer's grey ground (204, 204, 204) became one colour, and the column was
  drawn white. Near twins now merge only when nearly equal (under 6 apart), or when the rarer is under a sixth of the
  commoner.

Drawn back and held to the picture outside the objects' boxes, the mean difference (of 255) went from 8-25 to 0.06-0.41
on the panels that went wrong, and from about 1.1 to 0.04-0.10 on the rest; the old 3D style of 2349's Maskinrom stayed
at 1.1. Then, before the trace:

- **What the objects stand on.** Each pill one of the panel's objects stands on - the object over at least half of it,
  and no more than four times its size - comes out of the picture. Under a value that is bare text it is the value's
  bubble: it goes into the object's placeholder as vectors and moves with it in VectorCraft, and a sync puts it in the
  picture where the placeholder left it. Under an object the Designer draws itself, a state pill or an AK-PC's status,
  it is that object a second time, and goes. So does whatever of an object's own look, as the Designer draws it, the
  picture shows again where the object stands. On 2349's Maskin: 45 bubbles with their values, 11 pills left to their
  objects.
- **The house symbols.** The kept library's components, filled in from the Maskin and Oversikt templates built into the
  script, are looked for at 1:1 in four quarter turns, in workers. Not looked for: pills, the families an IWMAC object
  shows, templates less than a fifth solid, and one-colour templates the ground cannot be told from, which were found in
  plain ground. Nor is a template started on the picture's ground unless its colour is the ground's: that took the search
  on a grey panel from 60-100 s to 2-11 s on one thread. Each one found comes out of the picture and goes on the layer
  *Komponenter* as the house symbol itself, named and marked (`data-iwdie-symbol`) as the IWMAC menu places one, so
  Claude and edit files know it for what it is. 2349's Oversikt: 40 cases, islands and aggregates; 2349's Maskin: four
  compressors, the oil separator and the heat exchanger.
- **The rest** is vectorized as before, onto *Bakgrunn*, *Rør*, *Former* and *Tekst*.

The card has no *Trace the picture* any more, nor *Open the picture*: a panel with a picture and no `.ai` is vectorized.
*Choose the .ai file…* and *Open plant folder* stay; without a picture, *Open an empty canvas*.

- Checked in the stub host with plant 2349's Maskin picture and its 58 objects, through the card and the hosted
  VectorCraft 0.11.0: the job in 4.1 s (the search 2.0 s, in 4 workers), 6 symbols on *Komponenter*, 45 placeholders
  each carrying its bubble. VectorCraft opened it, Ctrl+S synced back, and the Designer reported the art under 45 objects
  in the picture where their placeholders left it. Not run in the live Designer.
- Not found yet: symbols drawn at another size or in another style than the templates; they are vectorized as shapes.
  Letters are still shapes, not text.

### The PNG upload tried again, and what a failed one means (v1.73.6)

Thomas: *sometimes this error message pops up, but it still works* - VectorCraft's banner said *The PNG was not
uploaded: Failed to fetch* under *✓ Synced*.

*Failed to fetch* is the browser saying that no answer came at all: the connection dropped on the way, or something
in the browser held the request back. It is not the server refusing. One such hold-back was this project's own: the
live test on plant 4798 blocked `iw_upload_image.php` in the Designer tab it drove, so the test could never write to
the plant, and syncs from that tab failed this way until the test's connection was gone. It *still worked* only on
the screen. The Designer sets the drawing as the background before the upload, so the panel looks right, but the
plant's pictures keep the last PNG that got through. A panel saved then shows the older picture live.

- **Tried again.** An upload that got no answer, or the gateway's 502, 503 or 504, is made again after 1.5 s, and once
  more after 4 s: three tries in all. It is the same file under the same name, so a try that did arrive is only
  written again. A refusal from the server, or a minute without an answer, is not tried again.
- **Said plainly.** When all three fail, the Designer's toast and the editor's banner say that the plant keeps the
  last PNG that got through. The banner's *Sync again* sends the drawing once more; sync before you save the panel.
- Checked in the stub host. Insert of a drawing, its upload answered by plan: dropped, dropped, OK uploaded on the
  third try; 502, OK on the second; dropped every time gave three tries and the message; a refusal was said at once.
  With Ctrl+S in VectorCraft and every try dropped, the banner showed the message with *Sync again*; that button, with
  the server answering again, uploaded the PNG and left a plain *✓ Synced*. Not run in the live Designer.

### VectorCraft's Recover Documents answered for you (v1.73.5)

Thomas: *sometimes it does not populate all the IWMAC objects to VectorCraft; a second time it works*, and then: *I
think it's because you have to press Restore on a popup*.

VectorCraft's Data Recovery keeps a copy of every document with unsaved changes in the site's storage, every 2 minutes.
An edit tab closed with changes leaves its copy behind. The next time VectorCraft starts and finds a copy whose tab is
gone - no Web Lock held for it, and no heartbeat from it for 6 minutes, three of its 2-minute intervals - it opens
*Recover Documents* on its first frame. While that dialog is open VectorCraft takes no key: not the Ctrl+A, Ctrl+2 and
paste that put the IWMAC objects on the drawing, and not the Ctrl+S that makes syncing ready (a sync then ended in
*VectorCraft did not save the drawing*). A Restore pressed after the panel had opened put the restored documents in
front of it. The second try worked because by then the copies belonged to the first tab, which was still running.

- **Answered before the panel opens.** As the editor starts, the script reads VectorCraft's recovery entries
  (`vectorcraft-recovery/…` in the site's storage) and the Web Locks of its running tabs, and applies VectorCraft's own
  rule. When the dialog is open, it answers as Thomas does: Restore (Enter, the dialog's OK), confirmed by the copies
  moving into the new tab's own area. The panel then opens after the restored documents, in front, and its IWMAC
  objects go on as usual.
- **The restored documents** open unsaved, each in a tab of its own, and the banner names them. Close those you do not
  need - Ctrl+W, Don't Save - or VectorCraft offers them again next time: a restored document stays unsaved until it
  is saved or closed.
- **Never synced into the wrong panel.** A document restored from another edit - *<name> [Recovered]*, whose name is
  not this edit's - is not synced by Ctrl+S, not read for Claude, and not used by the Designer's Ctrl+S; the banner
  says to click the panel's own tab. This edit's own drawing, restored after a crash, still syncs.
- A copy of a tab that still runs - its Web Lock held, or its heartbeat younger than 6 minutes - is left alone, as
  VectorCraft leaves it. An editor tab opened before updating runs the old version: reload it.
- Checked in the stub host on the hosted VectorCraft 0.11.0, with a genuine recovery copy the app wrote itself, planted
  as a closed tab's. 1.73.4 left the dialog open over the panel, without its objects and with Ctrl+S not ready. 1.73.5
  answered it in 0.3 s; the panel opened in front with 9 of its 9 objects, Ctrl+S on the restored document was refused,
  and the panel's own saved. With no copy, or with a copy of a tab still running, the editor started as before. Not run
  in the live Designer.

### Ctrl+S opens VectorCraft when no tab of the edit is open (v1.73.4)

Thomas, after Ctrl+S in the Designer: *No VectorCraft tab of this panel's edit answered - closed? Edit in VectorCraft…
opens the panel there again.* - if that happens, open a new tab.

- **Each VectorCraft tab of an edit notes itself open** in Tampermonkey's storage while it is (`iwdie.vc.tab.<job>`,
  one entry a tab, gone on `pagehide`, back on a return from the back-forward cache). The notes are pruned with the
  jobs.
- **Ctrl+S in the Designer** sends the objects only to an edit whose tab is open. With none open, it opens the panel in
  VectorCraft anew, as *Edit in VectorCraft…* does, with its objects as they stand in the Designer. The new tab is opened
  inside the key press, which the browser allows without a pop-up block.
- **A note that no tab answers** - left behind by a browser that closed by itself - is cleared after 6 s, and the toast
  offers a button, *Open in VectorCraft*, that opens the panel there anew. A tab opened later than 6 s after the key
  press needs a click, or the browser blocks it as a pop-up. The next Ctrl+S opens one at once.
- An editor tab still running a version before 1.73.4 notes nothing, so Ctrl+S opens a new one beside it: reload it
  once after updating.
- Checked in the stub host: an edit with no tab open got a new tab and job at Ctrl+S. An edit whose note no tab
  answered got its note cleared and the button, which opened a new tab and job. The push runs, with the editor's note
  relayed, went as before.

### Waits that last on a fast display (v1.73.3)

Thomas, after Ctrl+S in the Designer: *VectorCraft did not take the panel's objects in: VectorCraft did not save the
drawing, so it could not be read*. Reproduced in his own Chrome through the Playwright MCP on plant 4798's 315.001: the
editor's tab, brought to the front, gave up 2.1 s after it began. His display draws 242 frames a second. The script's
waits for VectorCraft were counted in frames - 480 for a save - which is 8 s at the 60 a second the headless tests run at,
but 2 s on his display, and VectorCraft needs longer than that to save a drawing as big as his panel's.

- A wait counted in frames now lasts at least as long as those frames take at 60 a second, however fast the display
  draws: 480 frames are never less than 8 s. Every wait for VectorCraft goes through it: the Designer's objects coming
  in, Ctrl+S's first Save As, a sync's save.
- A drawing VectorCraft did not save when the Designer's objects came is tried once more, 1.5 s later, before the
  Designer is told it failed.
- Checked: the stub host's push and sync runs, and the edit-file run, as before. The live run waits for this version to
  be installed in Tampermonkey. During the live test the Designer's picture upload was blocked, nothing was synced from
  VectorCraft, and nothing was saved.

### Ctrl+S in the Designer never opens the browser's Save page (v1.73.2)

Thomas: Ctrl+S in the Designer still asked to save the page as .html. It did so whenever no edit of the shown panel was
found, because the script let the key through to the browser. Now Ctrl+S on the Designer's page is always the script's,
and the browser's *Save page* never opens there.

- **With an edit of the shown panel open,** it sends the panel's objects to VectorCraft as in v1.73.0, once for each
  press: a held key repeats, and the repeats are ignored.
- **Without one,** the toast says that no edit of the panel is open and that *Edit in VectorCraft…* begins one. Nothing
  is saved: the Designer's own Save keeps the panel.
- **The editor's tab in the background** cannot take the objects in until it is in front, because a hidden tab draws
  nothing for VectorCraft to save. Its title in the tab strip now says *● Objects from the Designer -* until it is shown,
  and the Designer's toast says the objects wait for it.
- The edit is found by the panel the Designer's *Retrieve* list shows (`get_value()`), as the Designer's own Save names
  it. A panel picked in that list but not loaded counts as the shown one.

### The banner's buttons, alike (v1.73.1)

Thomas: the editor banner's buttons looked messy - a blue pill, outlined pills and an underlined link side by side. The
four are now drawn alike, as VectorCraft draws the flat buttons of its own Quick Actions: two to a row in columns of one
width, 24 px high, a 1 px border and 3 px corners, the label centred in VectorCraft's white. They sit below a rule that
parts them from the rows above, and reach the banner's right edge as far in as its left one. *Image Trace copy* is a
button now, not a link. None is drawn apart from the others. Hover lightens a button, pressing darkens it, and the
keyboard's focus shows VectorCraft's blue outline. The inline links in the rows (*Unlock*, *By itself*, *Connect…*) stay
links.

### Copilot's edits, by file (v1.69.0)

Thomas asked whether the Copilot agent could draw in VectorCraft through MCP, as Claude does. It
cannot reach the bridge: Copilot calls MCP servers from Microsoft's cloud, and the bridge listens
on `127.0.0.1` only, by design. So Copilot's edits come as a file. This script makes them in the
editor's tab with the plan and the apply Claude's edits use.

- **The file.** `{format: 'iwmac-vectorcraft-edits', version: 1, plant, panel, summary, ops}`. The
  Copilot agent's edit skill writes it from the panel's Export JSON (`vc_edits.py`) and checks it
  before it hands it over. The ops are the bridge's `iwmac_edit` ops.
- **How an op names what it changes.** Never by a cid, which only a tab that read the drawing
  knows:
  - `{object: 'object_12'}` names one of the panel's objects, by the panel's own name for it;
  - `{find: {kind, symbol, text, near: [x, y]}}` names a drawn thing: of the things that match,
    the one nearest that point, within 30 px, and only when no other is as near.

  Claude may use both forms too.
- **Open IWMAC JSON…** in the editor's banner takes such a file, instead of handing it to the
  Designer.
  - It plans the file on the drawing as it stands and says in words what it would make.
  - **Make it** makes it on a copy, opened as a version of its own, *&lt;name&gt; · edits N.svg*;
    **Leave it** changes nothing.
  - Then the check: what this edit added, told apart from what the drawing had before.
  - Ctrl+S syncs it, as any edit.
- **Refused, with nothing changed:** a file for another plant or panel, one that names a cid, and
  one whose target is not on the drawing. The banner says which, and why.

Measured in the stub host with the real VectorCraft web build. The Maskin example was inserted
and opened, then three files were opened:
- one written for another panel: refused;
- one naming a caption the drawing lacks: planned, then refused, with nothing changed;
- one written by `vc_edits.py` from the panel's JSON. It added LT3 after LT2 at the row's own
  spacing, with its drop and the main run on to it and a bound value beside it. It also moved
  the Receiver caption and renamed MT3.
  - The banner read *It makes 1 symbol, 1 caption, 2 pipes, 1 pill, 1 IWMAC object; 1 move, 1
    caption changed*.
  - After **Make it**: *nothing from this edit, 7 findings were on the drawing before it*.
  - Ctrl+S synced it with *1 placed · 1 linked*: the new value became `object_9`, linked to
    *Suction temp. To-LT*.

The kit's `tests/test-claude-bridge.js` and `tests/vc-find-cases.json` hold the targets and the file
check; the Copilot skill's own resolver answers the same cases.

### This edit's placeholders alone (v1.68.3)

Thomas: editing in VectorCraft did not sync to the Designer on Ctrl+S. Measured on plant 10266 with
Playwright:
- **A plain edit synced.** The panel's drawing opened, its objects moved and a text added, and both
  arrived.
- **An edit after Open plant .ai… did not.** It moved 16 of the 39 objects onto the places of
  others and placed 31 again as copies.

What went wrong, and what changed:
- **Why.** A plant's `.ai` keeps the IWMAC objects of the edit it was saved in, under the names the
  panel had then. Open plant .ai… added the panel's objects again, so the save held two sets.
  - The older set, first in the drawing, took the objects by name. The panel had since given those
    names to other objects.
  - The newer set found its names taken and became new objects.
- **The fix.** The panel's placeholders are marked with the edit they belong to
  (`data-iwdie-job`), and a sync changes objects by those alone.
  - An older edit's placeholders are left out of the picture and change nothing.
  - The Designer and the editor's tab say how many were left out.
- **Not changed.** A placeholder moved by a pixel or less still counts as where it was.

### No template to import at Insert's check (v1.68.2)

Thomas: remove *Import the Maskin template (.ai)…*, since the template is in the code. From
1.68.0 the script draws every name the template has, so the button showed only for a name the
template lacks, and importing the template could not help with that one.

- **The check counts the boxes.** A file that places a name that neither the template nor a library
  kept in this browser has gets a note under the buttons: how many symbols Insert draws as red
  dashed boxes with their names, to swap by hand. The check's warning names them and says to use
  the template's names.
- **A plant's own `.ai`** is still kept from Components in *Edit in VectorCraft…*. Its drawings
  come first, and the template fills in the rest.

### One file is the whole answer (v1.68.1)

Thomas: the Copilot agent should generate only one JSON file. It had answered with the panel JSON
and a zip of the JSON and its drawing as `.svg`, because the panel file's schema - and the
Copilot kit after it - asked for the drawing beside the JSON as an `.svg`. That file has had no
use since 1.65.0: Insert makes the picture from `panel.image_svg`, Edit in VectorCraft opens the
drawing with its layers, and Background → Illustrator or *Save .ai for Illustrator* writes the
`.svg` and the `.ai`. The schema's description now says that one file is the whole answer, with
no `.svg`, `.ai`, `.png` or archive beside it.

### The Maskin template built in: nothing to import (v1.68.0)

Thomas: make it so you don't have to upload `maskin-light-template.ai`. 1.67.0's check could
import the template; now the script carries it. By his decision, this replaces 1.67.0's "the
template stays out of this repository".

- **Every house symbol is drawn, with nothing kept.** The script carries the Maskin template's 418
  components (`IWDIE_LIB_BUILTIN`, zstd in base64, about 63 kB). It reads them with its own zstd
  reader the first time a symbol is drawn, in about 50 ms.
- **A kept library comes first.** A plant's own `.ai` keeps most of the template, not all. Its
  drawings are used where it has them, and the template fills in the names it lacks.
- **Where it is used.** Insert and its check, the export's list of symbols for an agent, and the
  Claude bridge. Insert's outcome says *drawn from the Maskin template built into the script*.
- **Where it is not.** Looking for components in a panel's picture at Edit in VectorCraft, and
  VectorCraft's Libraries, still go by a library you kept. Otherwise every panel with a picture
  would be searched, and every opening would fill Libraries with 418 components. (1.70.0 puts them
  in Libraries all the same, at Thomas's request; the picture search still goes by a kept one.)
- **The import button stays**, for a name the template does not have.
- **Written, not edited.** The Copilot kit's `tests/builtin-library.js` writes the block from the
  template, and a kit test holds the block to it.

### The Maskin template from Insert's check (v1.67.0)

Thomas inserted a drawing the Copilot agent made, and its 56 house symbols came in as red dashed
boxes with their names. Insert draws a symbol placed by name from the component library kept in
the browser, and his browser kept none. The only way to keep one was to open the template in Edit
in VectorCraft as the panel's `.ai`, where a sync could make it the panel's picture.

- **The check offers the template.** A file that places house symbols the kept library cannot draw
  gets **Import the Maskin template (.ai)…** beside Insert, with a note of how many would be boxes.
- **Pick the Maskin template's `.ai` once.** It is read as Libraries reads an `.ai`, its components
  named by the table and kept in this browser, in place of any kept before. The same file is then
  checked again, and Insert draws every symbol. Nothing leaves the browser, and the template is
  never opened as a drawing.
- **The template stays out of this repository.** It is internal, so the script carries only the
  names of its components, never their drawings. `maskin-light-template.ai` comes with the
  Copilot kit and the Maskin artwork.
- **A missing symbol's name is readable.** Its box wrote the name in `Source Sans 3`, unquoted. A
  family with a digit in it must be quoted, so browsers drew it in their serif. It is now
  `Roboto, Arial, sans-serif`.

### Save .ai for Illustrator, from VectorCraft's banner (v1.66.0)

Thomas: make the button in the VectorCraft banner. VectorCraft's own *Save As › PDF-compatible
.ai* keeps none of the drawing's layers, and with the house font missing on the web it breaks the
text's letters.

- **The banner has a Save .ai for Illustrator button.** It writes the drawing open in the editor
  as Background → Illustrator writes one:
  - the drawing's own layers, with Bakgrunn locked;
  - every shape as a path and every text as Arial type in its place, before or after Update;
  - a picture where it stands;
  - the IWMAC objects on a hidden reference layer, Panelobjekter;
  - a page that shows the drawing in other viewers.
- **How.** The button makes Ctrl+S ready if it is not yet. VectorCraft then saves the drawing for
  the script, the placeholders are taken out as a sync takes them, and the file goes to Downloads.
  Nothing is synced to the Designer.
- **Background → Illustrator** builds its layers the same way (`iwdieAiDrawingLayers`), and an
  emptied IWMAC-objekter layer is now left out of either file.
- **An object id beyond Latin-1 is escaped**, as an ASCII one is. A placeholder labelled
  *CO2 Alarm…* put the ellipsis's UTF-8 bytes into an id, and Illustrator refused the whole file.

### Labels in their place in the .ai, updated or not (v1.65.3)

Thomas exported the overview with **Background → Illustrator** and opened it in Illustrator.
Every centred or right-aligned label began at its point instead of being centred on it or
ending there. The `.ai` writes text in Illustrator's legacy form, and Illustrator shows legacy
text from where it starts, whatever its alignment, until **Update** converts it. Converted, it
was right; not converted, it looked broken.

- A centred or right-aligned text is now written left-aligned from where it starts. Its width
  is measured in Arial (`iwdieAiTextWidth`; Arial shares Helvetica's metrics, regular and bold,
  with the Latin-1 letters a panel uses), and a turned text moves back along its own baseline.
- It shows in its place before **Update** and after. Checked in Illustrator over COM, both ways,
  on a whole overview.
- VectorCraft's own *Save As › PDF-compatible .ai* is still not the way to Illustrator. That
  file is a PDF with no layers of the drawing's, and with Roboto missing on the web it breaks the
  text's letters.

### The house font again, and the background locked in the .ai too (v1.65.2)

- **1.65.1's font change is undone.** It named `Source Sans 3` without quotes. In CSS a family
  name with a digit in it must be quoted, so browsers threw the whole font list away and drew
  the text in their default serif. Thomas also preferred the look before. The Claude bridge's
  labels are `Roboto, Arial, sans-serif` again, and so is the kit's guide. VectorCraft still
  marks Roboto as a missing font, and its own `.ai` breaks such text. So an Illustrator file
  comes from **Background → Illustrator**, which sets the text in Arial.
- **Bakgrunn is locked in the `.ai` as well.** Background → Illustrator writes a layer named
  Bakgrunn locked, as VectorCraft opens it. A lock the drawing writes itself still wins
  (`data-iwdie-locked="0"` leaves it unlocked).

### The background locked in VectorCraft (v1.65.1)

Thomas: the background should always be locked. A drawing that opens in VectorCraft as it is -
an agent's drawing that Insert made the panel's picture, or a picture vectorized - now opens with
Bakgrunn's objects locked and every other layer free to edit. The Drawing row in the banner says
*Bakgrunn locked*, and its **Unlock** frees them (Object › Unlock All).

- **How.** VectorCraft reads no lock from an SVG and has no key for a layer's own lock. So the
  drawing opens with the other layers' objects hidden. Select All (Ctrl+A) then takes Bakgrunn's
  objects alone, and Lock (Ctrl+2) locks them. Show All (Ctrl+Alt+3) brings the rest back, and
  Deselect (Ctrl+Shift+A) lets go.
- **Not done** when the drawing has no visible Bakgrunn layer or anything loose at its top. It is
  not done either when the drawing already hides an object, which Show All would bring back.
- **Text in a font VectorCraft carries.** VectorCraft takes a text's first font family only, and
  on the web it has only its own fonts. A label in Roboto therefore showed as a missing font, and
  VectorCraft's own `.ai`/PDF export broke its letters. The Claude bridge's labels now name
  Source Sans 3 first, as the IWMAC placeholders already did, and the kit's guide asks an agent's
  drawing to do the same. For Illustrator, **Background → Illustrator** in the Designer stays the
  way: VectorCraft's `.ai` is a PDF whose layers Illustrator does not keep.

### Every drawing stays vectors, from Copilot to Illustrator (v1.65.0)

Thomas wants every panel file Copilot writes to end as if he had drawn it in VectorCraft: a
vector drawing that VectorCraft opens with its layers, an Illustrator file with the same layers,
and a PNG on the panel's overview picture. Before this version, Insert set an agent's
`panel.image_svg` as an SVG background. Nothing reached the plant's pictures until a sync from
VectorCraft. Background → Illustrator handed the SVG over as it was, so Illustrator saw groups
but no layers.

- **Insert makes the drawing the panel's picture, as a sync does.**
  - It draws `panel.image_svg` at the panel's size, with the fonts it names.
  - It keeps the drawing inside the PNG.
  - It uploads the PNG to the plant's pictures. The name follows the sync's rule, and it never
    writes over a picture this script did not upload.
  - It names the picture on the panel, as Set background does.

  The result says where the picture went and has an **Edit in VectorCraft…** button. An SVG
  picked under *Background options* is handled the same way. If the browser cannot draw the
  drawing, the background stays an SVG, as before.
- **Edit in VectorCraft opens it as the drawing it is.** The drawing in the picture is marked
  `data-iwdie-given`. The editor opens it as its layers, with nothing locked and the panel's
  objects as placeholders on top. This was checked in the web build: its own save at Ctrl+S had the
  layers Bakgrunn, Rør, Former, Tekst and IWMAC-objekter, and every house symbol was still a
  named group.
- **Open IWMAC JSON… in VectorCraft.** The editor's banner takes a panel file too. It hands the
  file to the Designer tab the edit began in, where Insert's check and questions come up. Once the
  file is in, the editor opens the panel again in the same tab: its drawing as layers, its objects
  as placeholders.
- **Background → Illustrator writes the drawing itself.** When the background is a drawing (an
  SVG background, or the drawing kept inside a PNG from VectorCraft or Insert), the dialog offers
  two files: an `.ai` with the drawing's own layers, or the `.svg` as the panel keeps it.
  - The `.ai` is Illustrator's own editing data.
  - Each top-level group becomes a layer of the same name, hidden if it is hidden.
  - Each group stays a named group.
  - Each shape becomes a path in panel coordinates, with its fill, stroke, dashes, caps and joins.
  - Each text becomes point text in the matching Arial face, turned and aligned as drawn.
  - A picture in the drawing goes in where it stands, one per layer.
  - What Illustrator's art program cannot hold is drawn as close as it can be, and the message
    names it: a gradient as its first colour, a marker as an arrowhead. Clip paths, masks and
    filters are left out.

  Illustrator (Beta) opened the worked Maskin example with its four layers, its named pipe and
  symbol groups, and its 22 texts updated to Illustrator's own type.
- **Export JSON hands the drawing back.** When a picture keeps a drawing, the export carries it as
  `panel.image_svg` in place of the coarse trace. It is stamped `data-iwdie-drawing` with a hash of
  itself. If it comes back unchanged, Insert keeps the picture. If it was edited, Insert draws it
  again.
- **The check names what VectorCraft would lose.** Its findings follow VectorCraft's own SVG
  importer:
  - anything at the top level other than a group with an id puts the whole drawing on one layer;
  - so does opacity, a filter or a mask on a layer group;
  - a group with a `data-name` but no id gets no name, and one holding a single thing is
    dissolved into it;
  - `visibility="hidden"` loses what it hides, while `display="none"` keeps it hidden;
  - a marker comes in as loose paths;
  - a picture comes in as pixels.

  Insert refuses a drawing that uses a namespace prefix it does not declare, such as
  `xlink:href` without `xmlns:xlink`. The browser cannot draw such an SVG, and VectorCraft cannot
  open it.

The Copilot kit was updated with it. An answer now delivers two files: the panel JSON, and its
drawing as an `.svg`. The kit also gained the drawing's layer rules, a JSON schema for the panel
file, and validator checks for both.

### House symbols by name (v1.63.0)

An agent drawing a Maskin picture into `panel.image_svg` had to draw its compressors, gas
coolers, receivers and valves from plain shapes. They never looked like the house's own. Now it
places them by the template's names, and Insert draws the real ones:

```
<use data-iwdie-symbol="Kompressor" x="120" y="80"/>
<use data-iwdie-symbol="Gaskjøler4Lav" x="860" y="80" width="192" height="63"/>
<use data-iwdie-symbol="Motorventil" x="400" y="295" data-iwdie-turn="90"/>
```

- **Placing one.** `x` and `y` are the top left of its box. Without `width` and `height` it comes
  at its own size; with them it is fitted into that box, its proportions kept and centred.
  `data-iwdie-turn` turns it clockwise by 90, 180 or 270, and `data-iwdie-flip="1"` mirrors it
  left to right first.
- **Which copy.** Where the template draws its own turned copy, that copy is used, so the motor's
  "m" stays upright. Among sizes, the nearest is used, so a stroke stays as drawn. Names are
  matched loosely: case, spaces and `ø` written `o` do not matter.
- **Where they come from.** Insert draws each symbol from the component library kept in this
  browser, as a group named after it. VectorCraft then shows it as *Kompressor*, to move or swap.
  Import the Maskin template's `.ai` (or the plant's own) under Components in *Edit in
  VectorCraft…* once. A name the library lacks becomes a red dashed box with the name in it.
- **The check.** Insert's check lists the symbols the drawing places. It warns of those the kept
  library lacks, and of any an IWMAC object should show instead.
- **The export.** It lists the symbols the plant's library has, in
  `overview.parts.components.symbols` (name, sizes, what it is), with how to place them in
  `parts.components.place`. The in-file guide's `drawing_style.symbols` says to use them on
  Maskin.

### A picture for the agent, its pills numbered (v1.64.3)

Thomas most often asks Copilot to *link out* a panel's picture, and it has to do that from the
Export JSON alone. The export already measures every empty pill in the picture
(`overview.picture.pills`). It cannot read the captions beside them in a traced PNG, so an agent
could not tell which pill shows *Pgc* and which *Prec*.

Export JSON now also saves the picture beside the file, as `<file>-for-ai.png`, whenever the
panel has one:

- the panel's picture at its own size;
- each pill outlined in red and numbered **P1, P2…** in the order `overview.picture.pills` lists
  them;
- the object already on a pill named in the pill's badge, **P2 · o0**, where `o0` is
  `panel.single_objects[0]`;
- every other object outlined in blue and marked **o\<n>**;
- a grid every 50 px, with its coordinates every 100.

`overview.picture.numbered` says so in the file. Give the agent both files: it reads each pill's
caption on the picture and its exact place in the JSON. Chrome asks once whether the Designer may
download two files at a time.

The Copilot kit was updated with it. A link-out of a Maskin panel is its own request class (6),
with its own validator scope, `--patch-scope link-out`. An agent is told what to do with each of
the export's link checks, how to read a pill's caption, and how to deliver placing and linking in
one file.

### Where pipes join, and a drawing's own layout (v1.64.1)

Thomas asked whether the export needed more for a Copilot agent to draw his pictures easily.
Drawing a basic Maskin through Claude's bridge showed what it lacked. Claude could route each
pipe to a compressor's cap, a valve's knot or a receiver's inlet, and continue a row of
compressors at its own spacing. An agent working from the export knew the symbols' names and
sizes, but not where their pipes join or what layout the picture already follows. The export
now tells it:

- **Ports.** `overview.parts.components.symbols` has a fourth column, `ports`: where each house
  symbol's pipes join, as `{port: [u, v, way]}` at turn 0. `u` and `v` are the share of its box
  across and down, and `way` is the direction the pipe leaves. A pipe ends at
  `x + u × width, y + v × height`. A compressor's `out` is the middle of its top; a motor valve's
  `in` and `out` are 71 % down its sides, through its knot. These are the same ports the bridge
  routes by.
- **Circuits.** `overview.style.pipes` names the `circuit` each measured pipe colour draws:
  HP, Liquid, MT suction, LT suction or Heat recovery, when it is within a step of the house colour.
- **A drawn picture's own symbols and layout.** When the picture is a drawing made with house
  symbols, `overview.picture` adds two more lists. `symbols` gives each symbol's name, box and
  turn. `layout` gives the rows of like symbols and their spacing, the information column, the
  circuits, where values stand by each kind of symbol, and the text. To change such a picture,
  an agent keeps what it has and adds in its rows. The drawing is measured in a hidden frame and
  read as the bridge reads it.
- **Captions** of values placed by the bridge now end 8 px before the pill, clear of the value
  object.
- The in-file guide's `drawing_style.symbols` says to join pipes at the ports and to follow a
  drawn picture's layout.

Measured in the stub host: the kit's new worked example, a whole basic Maskin, was inserted with
"9 of 9 match the plant" and 16 house symbols drawn. Its export listed the 16 symbols, both
compressor banks 80 apart, the information column, the four circuits by name, and where the
values stand. The kit's `tests/test-overview.js`, `test-named-components.js` and
`test-claude-bridge.js` hold the new parts.

### The guide agrees with the Copilot kit (v1.62.1)

A deep pass over the Copilot agent's knowledge kit against this script found the file's
own `ai_guide` contradicting the kit in places an agent reads first, all of them written
for Ventilasjon and applied to every type:

- **Artwork by type.** It told an agent to draw a Ventilasjon picture into `image_svg`
  when the plant had none, and shipped `examples.starter_ventilation`, an authored duct
  drawing. Every production Ventilasjon panel in the kit's evidence sits on the blank
  sidebar with its ducts, fans, dampers and coils as objects. The guide now authors
  `image_svg` only for a type that has artwork (Maskin, Oversikt, Energi) and never for
  Ventilasjon, curve, list or room-control panels. The starter is gone: 5.4 kB less
  guide.
- **z-bands per type.** `quick_start` listed the Ventilasjon bands as if universal. On
  Maskin the values are 1100, the inverse of Ventilasjon's 110; Oversikt uses 110 and 375.
  The guide now says to copy the band of the same role from the file, and names each
  type's.
- **What is drawing and what is an object.** "Fans, valves and every label are objects"
  and "no dark fills" were Ventilasjon rules; a Maskin picture draws fan circles, valve
  symbols, fixed text and dark setpoint pills. The rule is now "whatever shows or sets a
  signal is an object", in `drawing_style`, the overview's `read_me` and the Insert fix
  prompt.
- **Smaller corrections.**
  - Unlinking keeps `alias_text`, the key an object is relinked by.
  - `image_svg_trace` is kept or dropped by type.
  - The canvas follows the plant's other panels.
  - A BACnet alias is translated per plant, so relink by the point token.
  - An alias on two rows is ambiguous.
  - The settings column's measured positions.
  - The self-check's x 1145 rule applies only where there is a settings column.

The kit itself got the matching update: task T19's guide per panel type, the export's
`overview` as a parameter source in its tools and validators, a T19 validator, and the
agent's instruction field.

### The plant behind the panel, for an agent that draws overview pictures (v1.62.0)

Thomas asked for the export to help his Copilot agent generate IWMAC overview pictures with
the new VectorCraft: one file, the existing format extended rather than a new one, readable
and exact for an AI, and backward compatible. Export JSON now adds one top-level key,
`overview`, between `summary` and the picture. Insert ignores it, the format version stays 1,
and every file Insert took before it takes now.

- **What it holds.** The plant as the Designer has it at export time, as tables
  `{cols, rows}`, one row per line:
  - `units`: every unit (controller) the Designer lists, with how many of the panel's
    objects it has, its tagged signals and how many of its rows are in the file.
  - `parameters`: every row of the three linked units with the most objects, and of every
    unit ticked in the Parameter Selector's UNITS list, up to 4000. They are read as the
    selector reads them (`designer_site/iw_load_plant.php`, read-only). In each unit the
    groups the panel shows come first, and groups of alarms alone last.
  - `signals`: the rows the plant has tagged with a standard meaning ("Compressor
    Running", "Fan Relay"), with each one's measure and tag.
  - `bindings`: each linked object read against its unit's rows. It is `ok`, or the
    alias differs, the row is in another unit, it is not in the unit, or the unit is not
    on the plant.
  - `picture` and `style`: where the picture has its panels, pipes, pills, figures and
    texts, and its colours, pipe widths, pills and text, measured by the vectorizer of
    v1.61.0. A drawing kept in the picture gives its texts with their words.
  - `parts`: the kinds of object the panel uses, with their usual size and z, and the
    component library kept in this browser.
  - `read_me` comes first. It says how to read the block, and how to link: copy a row's
    ids whole, never build one.
- **An empty canvas** with no picture now exports the plant's overview alone, to draw a
  new panel from, instead of nothing.
- **Insert checks the links against the plant.** After the check, it fetches the rows
  of the units a file for this plant names and reads each link against them. These are
  warnings, listed object by object:
  - a `driver_id` that is invented;
  - one that belongs to another unit;
  - a unit the plant lacks;
  - an `alias_text` other than the row's.

  The glance grid says "N of M match the plant". *Copy report for the AI* now names the
  objects under each finding, so the agent fixes exactly those.
- **An agent's drawing opens in VectorCraft as vectors.** A background set from
  `panel.image_svg` used to reach VectorCraft as a picture of itself. Now it opens as the
  SVG it is: its top-level groups become layers (Bakgrunn, Rør, Former and Tekst, as the
  guide asks), nothing is locked, and the panel's objects sit on top as placeholders.
  Ctrl+S makes it the panel's picture and keeps the vectors in it for the next edit.

The Copilot kit's new `OVERVIEW-PICTURE-GUIDE.md` (task T19) tells the agent how to use it:
the documentation gives the topology, the overview's rows the links, the plant's style the
drawing, and the layer contract the shape VectorCraft opens.

Measured live on plant 2349's Maskin panel (read-only):
- The overview took 2.9 s and is 163 kB; 126 kB of it are the pack controller's 1615 rows.
- All 56 links matched a row.
- The pipes came out in the house's circuit colours, and the tags as 11 px Roboto
  `#3c505e`.

In the stub host, an agent's file with a four-layer drawing and three links (one right, one
with another alias, one invented) read "1 of 3 match the plant". It opened in VectorCraft as
its four layers with the objects unlocked, and synced back. Not yet run in Tampermonkey on
the live Designer.

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
*(Removed in 1.62.1: production Ventilasjon panels sit on the blank sidebar with their
ducts as objects, never on authored artwork; see below.)*
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
- **A drawing** (v1.65.0): an SVG background, or the drawing a PNG from VectorCraft or Insert keeps, goes through the same dialog. Its `.ai` card writes the drawing's own layers as Illustrator's objects, and its SVG card saves the drawing as the panel keeps it. See *Every drawing stays vectors* above.

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
VectorCraft contributors). Its web build runs entirely in the browser (WebAssembly, drawing
with WebGPU or WebGL2). A build of it is hosted at
**<https://hapnes-dev.github.io/iwmac-vector/app/>** (repository
[Hapnes-dev/iwmac-vector](https://github.com/Hapnes-dev/iwmac-vector)). Since 2026-10-17 it is
built from the official source with WebAssembly SIMD and without the ArtCraft name (see *The
hosted copy* below). This script bridges the Designer and that page, so a background can be
edited as vectors without leaving the browser.

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
| IWMAC objects | *107 in the IWMAC menu* | how to place one, and what a sync does with it |
| Drawing (v1.55.0) | *locked - only the IWMAC objects move · Unlock* | what is locked, and how to lock or unlock it |

Under them, below a rule, are four buttons drawn alike, two to a row (v1.73.1): **Open plant .ai…**,
**Open IWMAC JSON…**, **Save .ai for Illustrator** and **Image Trace copy**. Then comes the news, kept short:
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

**Vectorize image (v1.61.0).** Thomas asked for a button for when the plant's `.ai` is not to be
had: one that turns the picture into vectors by itself, as fast and as exact as it can, keeping
its colours, shapes and details, and leaving it as easy to edit in VectorCraft as possible. The
card *Best result: the plant's own .ai file* now has **Vectorize image** whenever the panel has a
picture (the first two rows of the table above). VectorCraft's web build has no API to run its
own tracer, and its logo mode works at 1024 px with ten colours at most. So the script traces the
picture itself, in a worker, before VectorCraft opens, and the steps' paper shows how far it is,
colour by colour.

- **Colours.** The palette is the picture's flat colours. A pixel counts when its neighbours
  along a row or a column match it and it is no blend of the pixels on either side of it. The
  shades along anti-aliased edges are not colours of their own: each edge pixel is read as one
  colour or as a blend of two, with how much of each.
- **Outlines.** Each colour's outline runs where it covers half a pixel. An edge pixel is cut
  into 4 x 4 parts, filled from the side its coverage rises, so an outline is placed to a
  quarter of a pixel. The outlines are fitted: sharp corners stay sharp, lines are snapped level
  or upright, circles become circles and the rest Bézier curves. A fit that strays from the
  outline's area is replaced by a plain polygon.
- **What is what.** Pills become rounded rectangles, coloured pipes stroked lines. A hole stays
  a hole: the ground shows through an "o" instead of being drawn again on top.
- **Layers, nothing locked.** *Bakgrunn* holds the ground and the large panels, *Rør* the pipes,
  *Former* the figures (each a group with what lies on it, so a click takes the whole figure),
  *Tekst* the letters, grouped into words. A letter on its own (an arrow, a dot) is a figure.
  The picture as it was is on the hidden layer *Bakgrunn (original)*, and the panel's objects are
  placeholders on *IWMAC-objekter* as before. **Ctrl+S** syncs as for any edit.

Its limits: gradients and drop shadows become flat bands of colour; rounded rectangles that are
not whole pills are traced as outlines; letters are shapes, so they can be moved, recoloured or
deleted but not retyped; and where two pipes cross, the gap between them may be closed.

Measured in the stub host with 2349's Maskin picture (1400 x 750, 17 colours): vectorized in
1.9 s, into 1513 shapes, 58 pills, 39 pipes and 1154 letters in 179 words, 391 kB of SVG. Drawn
again, it differs from the picture by 0.41 of 255 on average; 0.08 % of its pixels differ by more
than 40, none by more than 100. An older picture with gradients and shadows (1050 x 745, 48
colours) took 2.1 s and differs by 1.07 on average. VectorCraft opened the vectorized panel with
its seven layers, and a sync came back with the six placeholders.

**Placeholders that name their parameter (v1.63.0).** A placeholder placed in VectorCraft became
an unlinked object, to be linked in the Designer afterwards, one by one. Now its name can say
which parameter it shows, after the object's id:

```
IWMAC number_v3_value_only Pgc @ AK-PC782AB 111
IWMAC number_v3_value_only [9999_AK3_AKC_0_111_0_207_7]
```

The first form is the parameter's alias text and its unit, by the name the Designer's UNITS list
gives it or by its unit_id. The second is its driver_id, for a unit that has the same alias twice.
A sync links the new object to that parameter, with the unit_id, alias text, sub_group and
link_tag of the plant's own row, just as Insert links an object from a file.

- **Parameters in the IWMAC menu.** The menu now lists the plant's parameters: each unit in scope,
  its rows grouped as the Parameter Selector groups them. A unit is in scope when an object on the
  panel is linked to it or when it is ticked in the Parameter Selector. The search finds a
  parameter by its alias or driver_id. One chosen is placed as the object the panel shows such a
  parameter with: an alarm as its alarms, a state as its LEDs, the rest as its values, falling back
  to the catalogue's plainest kind. Its name binds it, and its box shows the alias.
- **The panel's own objects say theirs.** A bound object comes to VectorCraft named after its
  parameter, so the Layers panel shows what each value is. Renaming a placeholder there to another
  parameter relinks its object at the next sync. The Designer makes it again through its own loader,
  linked, as Insert makes a linked object, and only then takes the old one off. A placeholder named
  as it was sent changes nothing, and one whose binding was deleted keeps its link.
- **What could not be linked** is said, and why: no such parameter in that unit, an alias two
  units have (add `@` and the unit), an alias a unit has twice (give the driver_id), a unit whose
  rows could not be read, or a kind of object that cannot be linked. The object then stays as it
  was linked, and a new one unlinked. The editor's banner counts the linked ones: *✓ Synced · 1
  placed · 1 changed · 2 linked*.

The rows are read once, when the edit begins, with the same read-only request the Parameter
Selector makes when a unit is clicked. That waits ten seconds at most and is kept a minute. A unit
a binding names whose rows were not read yet is read at the sync.

Measured in the stub host with the real VectorCraft web build: *Pgc* chosen in the menu and placed
came back named `IWMAC number_v3_value_only Pgc @ AK-PC782AB 111` and became an object linked to
its row, with the tagged row's sub_group and link_tag. A placeholder renamed from *Suction temp.
To-MT* to *Main Switch @ 000:111* relinked its object where it stood. The other stayed as it was.

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
hosted build carries none of this script's changes. So the objects have a menu of their own in the same bar,
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

The hosted build carries none of this script's changes. The script only adds the banner and
catches the save while the page runs. Nothing leaves the browser: the editor is a static page,
and the panel goes from tab to tab through Tampermonkey's storage.

**The hosted copy.** It is VectorCraft 0.11.0, built from the official source at that release
with its licences and notices. Until 2026-10-17 it was the official web build byte for byte
(0.10.0 until 2026-10-15, 0.9.0 until 2026-10-12). Since then it differs in two ways:
- **WebAssembly SIMD is on.** The official web release is built without it, so its canvas renderer
  runs scalar code. With SIMD, VectorCraft draws a frame of a drag on 10214's Maskin in 5.0 ms
  instead of 11.5 ms, and in 7.1 ms instead of 17.4 ms at 1920 × 1080. The pixels are the same.
- **The ArtCraft name is taken out** (the repository's `build/debrand.py`): the Discord button and
  the Help menu's ArtCraft links.

The repository's `build/build.sh` makes it from a release tag. **To move to a newer release, follow
[UPDATING.md](https://github.com/Hapnes-dev/iwmac-vector/blob/main/UPDATING.md)**:
1. Build it to try with the *Update VectorCraft* workflow, *commit* unticked.
2. Check it with `build/check.py`.
3. Test this script on it.
4. Publish.
5. Check the live site.

**What this script relies on in VectorCraft.** It drives the editor from outside, so a release can break the
bridge without breaking anything else. It relies on these:
- **A dropped file opens** on `#vectorcraft_canvas` (`vcDropFile`).
- **A save is a blob download.** The script catches it by an `<a download>` click.
- **Ctrl+S saves straight away** once the document has a format, and the first save opens Save As (`vcSaveSync`).
- **Save As takes clicks** (since 1.83.2): *Format ▾*, *SVG* and *OK* at fixed places round the window's centre, then
  Enter in SVG Options. If not, the keys: Tab, Space, five Tabs to SVG, Space, Enter (`answerSaveAs`: `byClicks`,
  `byKeys`).
- **The title starts with `*`** while there are unsaved changes, which auto-sync watches.

**VectorCraft 0.12.0 changed Save As.** Its format list stays open after a key takes SVG, so the keys can no longer
reach OK, and Escape closes the dialog; in 0.13.1 they even take *VectorCraft Template*. Since 1.83.2 the script
answers by the clicks first, which take SVG in 0.11.0 and 0.13.1 alike, ready after 10.7 s on either.

**VectorCraft 0.13.1 is not hosted yet.** It opens the house Maskin template's heat exchanger as a rectangle (see
1.83.2), so the hosted copy stays 0.11.0 until a release that opens it right.

The ArtCraft name and marks belong to the ArtCraft team and are not open source. Their brand
terms ask a published modified build to carry none of them, so the hosted build has them taken
out. Its About box says it is based on VectorCraft by the ArtCraft team. This script's own
dialog follows VectorCraft's colours but carries none of those marks. VectorCraft calls itself
alpha.

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

## Claude in VectorCraft (v1.64.0)

Thomas asked for Claude to work in VectorCraft directly: to understand the panel's picture
and the plant behind it, and to add, connect and lay out equipment as asked — *"add three
compressors, connect them to the condenser, put the energy meters on the right, and align
everything with the existing layout"* — from understanding the plant through to a picture
ready to sync.

VectorCraft's own MCP server drives the desktop app, not the web build Edit in VectorCraft
opens, and the web build has no programming interface. So this script is Claude's hands in
the editor's tab, and a small MCP server of this repository's own,
[`claude-bridge/iwmac-vc-mcp.js`](claude-bridge/README.md), connects Claude Code to it.
Set-up, tools and safety are in [its README](claude-bridge/README.md).

- **The banner's Claude row** says whether the tab has found the server: *connected · ask
  Claude in Claude Code*, *working: edit…* while it works, *not running* when Claude Code is
  not running the server. Tampermonkey asks once to let the script reach `127.0.0.1`.
- **What Claude reads.** The drawing as a table — each house symbol, IWMAC object, pill,
  pipe and text with its box, an id that lasts, and a note (an object's binding, a pipe's
  circuit) — plus the drawing's own conventions: rows of like symbols and their spacing, the
  information column, the circuits and their colours, where values sit by each kind of
  symbol, the text style. A preview when it needs to look. The kept symbol library, the
  object catalogue and the plant's parameter rows, with the exact binding text.
- **What Claude changes.** House symbols by name from the kept library (v1.63.0), banks of
  them at the drawing's own spacing, values on empty pills with their bound placeholders,
  pipes routed orthogonally between the equipment's ports and coloured by circuit, text,
  moves, deletes, rebinding, alignment. Each edit is made on a copy and opens as a new
  document, *&lt;name&gt; · Claude N.svg*; the version before stays in its tab, and Claude
  can open it again.
- **What Claude cannot do.** Sync. Ctrl+S stays yours, with every guard it has: the
  background and its PNG, the placed objects made, the bound ones linked, and no picture
  this script did not upload written over. Claude cannot change a drawing it has not read,
  nor one another tab put in its place since.
- **Two edits open.** The tab opened last has Claude. The other says *with another
  VectorCraft tab* and waits; its **bring Claude here** takes Claude back.

Measured in the stub host with the real VectorCraft web build and the real server, Claude
played by a script: the scene with its facts (a row of compressors 60 apart), a preview,
three compressors carrying that row on at 60, a gas cooler, HP pipes from the compressors' caps into
the cooler's inlet, a bound *Pgc* value with its pill and caption, the check (a missing
symbol, a bell drawn where an object should be, two old values without pills), a move and
an undo — 1.5 s of tab time in all. A second tab took Claude over, the first waited without
taking it back for 20 s, and its button brought Claude back. The kit's
`tests/test-claude-bridge.js` holds the pure part and the server.

**A box, and arrows on their pipes (v1.64.2).** Drawing a basic Maskin through the bridge showed two
gaps. Claude could not draw the empty box the house puts under a strip, an alarm, an enable or an
LED, nor a panel in the information column. And the check let an arrow stand where no pipe ran.

- **`box`.** `{op: 'box', for: {ref | cid}}` draws an object's anchor at the object's own box, with
  `pad` to grow it: white, with the pills' grey ring. `{op: 'box', at, w, h, layer: 'Bakgrunn'}`
  draws a panel of the information column: light inside, with a grey ring, as 2349's are measured.
  `rx`, `fill`, `stroke` and `width` set it otherwise; `stroke: ''` draws no ring.
- **CB-F01.** The check names each flow arrow (`Pil`, `PilLiten`, `PilSikksakk`) whose centre is not
  within 3 px of a pipe running its way. An arrow wider than tall needs a horizontal run, a taller one
  a vertical run. An arrow beside a pipe whose runs are not known, a curve, is let be.
- The kit's validator makes the same check on an agent's answer (`OP-F01`).

**Copilot, by file (v1.69.0).** The Copilot agent cannot reach the bridge, so its edits come as a
file the banner's **Open IWMAC JSON…** makes, with the same plan: *Copilot's edits, by file*, in
the version history above. Targets may also name a panel object by its name (`{object}`) or a
drawn thing by what it is and where it stands (`{find}`), for Claude too.

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
