# IWMAC Designer Import/Export

Adds a **Panel JSON** section to the IWMAC Designer's manager sidebar (right below *Manage Files*) with three stacked buttons — **Export JSON**, **Insert JSON…**, **Background → Illustrator** — so a panel's complete look (objects, containers, graphics, background image) can be copied out as a single `.json` file and inserted into another panel, on the same plant or a different one, and the background artwork can be handed to Adobe Illustrator for editing. The designer itself has no way to do either; this script adds both.

Runs on `http(s)://legacy.iwmac.local/iwmac_designer_v4/?plant_id=<id>` ("IWMAC Designer V5").

## Install

👉 [**Install IWMAC Designer Import/Export**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js)

Requires Tampermonkey. Auto-updates on every `@version` bump.

## Workflow: copy a panel's style to a new panel / another plant

1. Open the designer on the **source** plant, *Retrieve → Load* the panel you want to copy.
2. Click **Export JSON** to download `iwmac-panel_<plant>_<name>_<stamp>.json`.
3. Open the designer on the **target** plant, *New → Create Panel* (or load an existing panel to combine into).
4. Click **Insert JSON…**, pick/drop/paste the export.
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
white-on-blue header row (frozen), one collapsible light-blue band per parameter group with
the group's parameters indented under it (Excel outline +/- buttons), AutoFilter dropdowns
on every column, and numeric-looking values stored as real numbers so they sort and sum.
Columns: Group, Name, Access (Read / Read/write), Eng unit, Type, Application, Tag, SGR,
Driver ID — the full record the popup's grid holds, including the columns it hides.

The button is deliberately **not** a w2ui toolbar item: the host's ALIAS TEXT / UNIT ID /
UNIT NAME row is a radio group ("which item adds to Label"), and clicking the export must
never change that selection. It is a separate element styled with the host's own w2ui
button classes, re-added automatically whenever the host re-renders the toolbar.

## Background picture only (v1.10.0)

Tick **Background picture only — insert no objects** at the top of the Insert dialog and the
import takes nothing from the file but its artwork. No objects, containers or graphics are
inserted, everything already on the canvas keeps its position, and both mid-import questions —
replace-or-add and driver-id rebinding — are skipped, because neither has anything to decide.

It works on any file that carries a background: a full export (only the picture is taken), an
artwork-only patch with empty object arrays, or an AI-authored `image_svg`. A picture picked in
step 1 of the dialog still wins over the one inside the `.json`, so the box is also the way to
drop a fresh PNG under a panel you do not otherwise want to touch. If the file has no artwork at
all, the import is refused and says so — nothing on the canvas changes.

Before v1.10.0 an artwork-only file was rejected outright as an empty panel document; that
rejection now names the box as the way through.

> **Editing an existing Maskin background:** tick **Background picture only** — that swaps the
> drawing and leaves every existing object untouched. **Replace** is for putting a full export
> onto a panel whose current content you no longer want; adding a full export instead duplicates
> every object. Maskin drawing rules and validators live in the private `tampermonkey-scripts-documents` repository.

## What it handles for you

| Concern | Behaviour |
|---|---|
| Background image | Base64-embedded into the export (the host's own `converted`/`image_data` format), re-applied on insert; or attach a PNG/JPG in the Insert dialog to give an image-less panel its artwork; or import the artwork **alone** with *Background picture only*, leaving every object on the canvas where it is |
| Cross-plant driver ids | Detected via the `<plant>_` prefix; offered rebind on insert; leftovers reported |
| A target panel that is not empty | Replace-or-add is asked before anything is touched; Replace clears the canvas and the host's own object/container caches the way a full panel load does, Add keeps everything and merges |
| Name collisions on insert | Canvas object names renumbered after insert (same policy as the designer's own paste) |
| Empty canvas on **export** | Not an error since v1.11.0 — the background picture is downloaded as-is plus a background-only envelope, so an unlinked *Oversikt* can still be handed to an AI |
| Not-a-panel-file / VV sketch file on **insert** | Blocked with an itemised error panel, canvas untouched |
| Server writes | Never — export reads the DOM, insert only renders; saving stays 100 % in the host's own buttons |
| Bookkeeping | Host's own `UpdateObjectWorker` runs after insert, exactly like the designer's paste |

## File format

```jsonc
{
  "format": "iwmac-designer-panel",
  "version": 1,
  "exported_at": "2026-08-06T09:12:00.000Z",
  "generator": "IWDIE v1.17.0",
  "ai_guide": {
    // v1.17.0 — reading instructions: what to read, in what order, what to skip,
    // what the coordinates mean, and what not to change. See below.
  },
  "source_plant_id": "10113",
  "panel_name": "Oversikt",
  "panel_width": "1400px",
  "panel_height": "750px",
  "counts": { "single_objects": 54, "containers": 0, "graphics": 0 },
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
  },
  "image_data": "data:image/png;base64,…",   // v1.17.0: last in the file
  "image_svg_trace": "<svg …>"               // v1.17.0: last in the file
}
```

Insert also accepts a **bare** panel document and the server's array-of-one wrapping, so files fetched straight from `V3load_design_panel` / `iw_load_ctrls.php?format=json` import fine.

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
  the rules that get a file rejected. It names the blob fields in `skip_fields`, so
  an agent is told what to ignore instead of having to work it out.
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

### Trace quality: the labels (v1.17.2)

Panel text is drawn at about 8 px, so at 1:1 a glyph stroke is one pixel and its
antialiasing dominates the edge the tracer is trying to fit. The labels came out
as mush — legible as shapes, not as words.

The trace is now taken from a copy of the background drawn at **2× with image
smoothing off**, then scaled back into panel coordinates. Every source pixel
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
happened. The `.svg` and the embedded `image_svg_trace` both come back in panel
coordinates either way, so the trace geometry and the objects' `posLeft`/`posTop`
stay in one coordinate system.

## Background → Illustrator (v1.3.0)

The third button exports the **current panel's background image as a file Adobe Illustrator edits directly**. (The host hard-codes the manager sidebar to 900px; the script relaxes `#manager_div` to fit its content so the extra button never causes a sidebar scrollbar while the buttons stay the host's standard size. v1.3.3 capped that growth to the viewport, which turned out to clip the fieldset's bottom edge on shorter windows — since v1.5.2 there is no cap and `overflow` is forced visible. Since v1.5.4 a measured **compact mode** kicks in only when the column wouldn't fit the window — fieldset gaps 8→4px and slimmer paddings reclaim ~68px with the buttons untouched at 28px; tall windows keep the host's stock spacing, with hysteresis so the mode never flaps. And v1.5.5 found the *actual* constant clipper: the host also hard-codes the sidebar's parent `#master_wrapper` to 900px with `overflow:hidden`, which cut the last ~18px of the fieldset at **any** window size — it now grows with content exactly like `#manager_div`.)

- **PNG/JPG background** → a confirm offers two deliveries, because **pixels contain no vectors** — any vectors must be *made*:
  - **OK — vector trace** (v1.4.0): the image is auto-traced to an **`.svg` of editable vector shapes** (vendored [imagetracerjs](https://github.com/jankovicsandras/imagetracerjs), public domain — the script stays one self-contained file). Shapes, pills and pipe runs come out clean **in the drawing's own colours** (v1.5.1: the palette is built from the image's exact colours with a guaranteed slot for saturated ones — before that, flat schematics traced to grey because thin coloured lines never won a sampled palette slot); **small text becomes rough outlines** — retype labels in Illustrator (that limitation is inherent to tracing, Illustrator's own Image Trace included). Since v1.4.1 the trace runs **in a Web Worker**, so the browser stays fully responsive even on photo backgrounds that take minutes (measured: main thread answers in ~4 ms while tracing; ~1–2 s total for a 1400×750 schematic, ≈7–16 k paths depending on colours). The worker is built by lifting the tracer's own constructor source — no second copy of the library, and a main-thread fallback (with a warning toast) covers CSP-restricted loads.
  - **Cancel — pixel-exact `.ai`**: modern `.ai` is PDF-based and Illustrator opens any PDF as editable artwork, so the script hand-builds a minimal PDF: artboard = panel size (1 px = 1 pt), the image placed 1:1 and **losslessly** re-encoded (raw RGB via the browser's native `CompressionStream`; JPEG fallback on very old Chrome). Verified with a real PDF engine: 1400×750 artboard, image intact. Ideal when you want the original as an exact tracing/reference layer.
  - **Save the picture as-is** (v1.11.0, flatten v1.16.2): opaque pixels stay **byte-for-byte**; transparent holes are filled with `#main_image`'s CSS background-color so the file matches the designer (a transparent PNG otherwise renders those holes black in viewers). Same file the empty-canvas export path produces. This is what an AI asked to look at the panel and propose link positions actually wants; a trace or a PDF only makes the drawing harder for it to read.
- **SVG background** (e.g. an AI-authored `image_svg` one) → the **`.svg` itself**, because it is already vector and Illustrator opens `.svg` natively (*File → Open*) with full editability — wrapping it in a PDF would rasterize exactly what you want to edit. The toast says so.

Filename: `iwmac-bg_<plant>_<panel>_<stamp>.ai` (or `.svg`, `.png`, `.jpg`). Note: because the designer runs on plain `http`, Chrome may flag the download ("can't be downloaded securely") — choose **Keep**; the file still lands in Downloads on default settings.

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
