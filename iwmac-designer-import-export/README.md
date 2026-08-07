# IWMAC Designer Import/Export

Adds a **Panel JSON** section to the IWMAC Designer's manager sidebar (right below *Manage Files*) with four stacked buttons — **Export JSON**, **Copy JSON**, **Insert JSON…**, **Background → Illustrator** — so a panel's complete look (objects, containers, graphics, background image) can be copied out as a single `.json` file and inserted into another panel, on the same plant or a different one, and the background artwork can be handed to Adobe Illustrator for editing. The designer itself has no way to do either; this script adds both.

Runs on `http(s)://legacy.iwmac.local/iwmac_designer_v4/?plant_id=<id>` ("IWMAC Designer V5").

## Install

👉 [**Install IWMAC Designer Import/Export**](https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js)

Requires Tampermonkey. Auto-updates on every `@version` bump.

## Workflow: copy a panel's style to a new panel / another plant

1. Open the designer on the **source** plant, *Retrieve → Load* the panel you want to copy.
2. Click **Export JSON** (downloads `iwmac-panel_<plant>_<name>_<stamp>.json`) — or **Copy JSON** for the clipboard.
3. Open the designer on the **target** plant, *New → Create Panel* (or load an existing panel to combine into).
4. Click **Insert JSON…**, pick/drop/paste the export.
5. If the file comes from another plant, the script offers to **rewrite the driver-id plant prefixes** (`10113_…` → `<target>_…`) so objects can link to the target plant's drivers.
6. Objects are **added** to the canvas (nothing is deleted); on an empty panel that's a 1:1 copy. The embedded background is applied if the canvas has none (or after a confirm if it does).
7. Nothing touches the server until you use the designer's own **Save** buttons (*Compile Panel for Plant* / *Sync Panels with Plant*).

## What it handles for you

| Concern | Behaviour |
|---|---|
| Background image | Base64-embedded into the export (the host's own `converted`/`image_data` format), re-applied on insert; or attach a PNG/JPG in the Insert dialog to give an image-less panel its artwork |
| Cross-plant driver ids | Detected via the `<plant>_` prefix; offered rebind on insert; leftovers reported |
| Name collisions on insert | Canvas object names renumbered after append (same policy as the designer's own paste) |
| Empty canvas / not-a-panel-file / VV sketch file | Blocked with an itemised error panel, canvas untouched |
| Server writes | Never — export reads the DOM, insert only renders; saving stays 100 % in the host's own buttons |
| Bookkeeping | Host's own `UpdateObjectWorker` runs after insert, exactly like the designer's paste |

## File format

```jsonc
{
  "format": "iwmac-designer-panel",
  "version": 1,
  "exported_at": "2026-08-06T09:12:00.000Z",
  "generator": "IWDIE v1.0.0",
  "source_plant_id": "10113",
  "panel_name": "Oversikt",
  "panel_width": "1400px",
  "panel_height": "750px",
  "counts": { "single_objects": 54, "containers": 0, "graphics": 0 },
  "background_embedded": true,
  "panel": {
    // the EXACT document the designer itself saves/loads (getPanelDataFromDOM):
    // plant_id, panel_name, panel_width, panel_height, org_image_name, image_name,
    // saved_by, single_objects[], containers[], graphics[]
    // + converted:"true" / image_data:"data:image/png;base64,…" when a background is embedded
  }
}
```

Insert also accepts a **bare** panel document and the server's array-of-one wrapping, so files fetched straight from `V3load_design_panel` / `iw_load_ctrls.php?format=json` import fine.

**The drawing's structure can live inside the JSON too** (v1.5.0): when the background is a raster, **Export JSON** offers to include `panel.image_svg_trace` — an automatic vector trace of the background (worker-traced, ~1–3 MB). It exists so an **AI can read how the drawing is structured** (where pipe runs, vessels and frames sit — geometry a PNG can't convey) and generate matching artwork via its own `image_svg`. Since v1.5.1 the trace keeps the **drawing's own colours**: the palette is derived from the image itself (bucketed exact colours + a guaranteed slot for saturated ones), because the tracer's evenly-sampled palette washed flat schematics to grey — thin orange/blue/yellow pipe runs never won a palette slot against 99 % white/grey. Colour is structure in these drawings (orange = hot gas, blue = suction, yellow = liquid), so the AI now reads that too. Insert strips the field and never renders it; the embedded pixel background always stays the real one. SVG backgrounds are copied into the field as-is (no confirm needed).

**The background image lives inside the JSON.** Export always embeds it (`panel.converted: "true"` + `panel.image_data: "data:image/png;base64,…"` — the designer's own embedded-image format), so one file carries the whole panel, artwork included. Since v1.1.0 the Insert dialog also has an **optional background-image picker**: choose a PNG/JPG there *before* the .json and it is embedded into the imported panel on the fly. And since v1.2.0 **an AI can author the artwork itself**: put raw SVG markup in `panel.image_svg` (a string starting with `<svg`, `viewBox="0 0 1400 750"`, no `<script>`) and Insert validates it, converts it to a data-URL background and embeds it — verified live with a generated AHU drawing behind 79 objects. Priority on insert: picked file > `image_svg` > `image_data`.

## Background → Illustrator (v1.3.0)

The fourth button exports the **current panel's background image as a file Adobe Illustrator edits directly**. (The host hard-codes the manager sidebar to 900px; the script relaxes `#manager_div` to fit its content so the extra button never causes a sidebar scrollbar while the buttons stay the host's standard size. v1.3.3 capped that growth to the viewport, which turned out to clip the fieldset's bottom edge on shorter windows — since v1.5.2 there is no cap and `overflow` is forced visible. And because the full column is ~910px tall, ~1080p windows still couldn't show all of it: since v1.5.4 a measured **compact mode** kicks in only when the column wouldn't fit — fieldset gaps 8→4px and slimmer paddings reclaim ~68px so the whole Panel JSON fieldset is visible with the buttons untouched at 28px; tall windows keep the host's stock spacing, with hysteresis so the mode never flaps.)

- **PNG/JPG background** → a confirm offers two deliveries, because **pixels contain no vectors** — any vectors must be *made*:
  - **OK — vector trace** (v1.4.0): the image is auto-traced to an **`.svg` of editable vector shapes** (vendored [imagetracerjs](https://github.com/jankovicsandras/imagetracerjs), public domain — the script stays one self-contained file). Shapes, pills and pipe runs come out clean **in the drawing's own colours** (v1.5.1: the palette is built from the image's exact colours with a guaranteed slot for saturated ones — before that, flat schematics traced to grey because thin coloured lines never won a sampled palette slot); **small text becomes rough outlines** — retype labels in Illustrator (that limitation is inherent to tracing, Illustrator's own Image Trace included). Since v1.4.1 the trace runs **in a Web Worker**, so the browser stays fully responsive even on photo backgrounds that take minutes (measured: main thread answers in ~4 ms while tracing; ~1–2 s total for a 1400×750 schematic, ≈7–16 k paths depending on colours). The worker is built by lifting the tracer's own constructor source — no second copy of the library, and a main-thread fallback (with a warning toast) covers CSP-restricted loads.
  - **Cancel — pixel-exact `.ai`**: modern `.ai` is PDF-based and Illustrator opens any PDF as editable artwork, so the script hand-builds a minimal PDF: artboard = panel size (1 px = 1 pt), the image placed 1:1 and **losslessly** re-encoded (raw RGB via the browser's native `CompressionStream`; JPEG fallback on very old Chrome). Verified with a real PDF engine: 1400×750 artboard, image intact. Ideal when you want the original as an exact tracing/reference layer.
- **SVG background** (e.g. an AI-authored `image_svg` one) → the **`.svg` itself**, because it is already vector and Illustrator opens `.svg` natively (*File → Open*) with full editability — wrapping it in a PDF would rasterize exactly what you want to edit. The toast says so.

Filename: `iwmac-bg_<plant>_<panel>_<stamp>.ai` (or `.svg`). Note: because the designer runs on plain `http`, Chrome may flag the download ("can't be downloaded securely") — choose **Keep**; the file still lands in Downloads on default settings.

## AI-generated panels (Copilot)

Insert JSON also takes **AI-authored** files — generate a panel from a P&ID or system description and insert it, then link the objects by hand. The ready-to-use kit is in [iwmac-designer-reference/](iwmac-designer-reference/): `AI-BRIEFING.txt` (knowledge file for any AI), `AI-AGENT-INSTRUCTIONS.txt` (paste into the M365 Copilot Studio instructions field — 7,994 chars, no `<`/`>`), and the example answers in `reference_data/`: `generated-panel-example.json` (CO₂ rack overview from an Advansor ValuePack P&ID, insert-verified 73/73), `generated-vent-example.json` (Ventilasjon incl. AI-drawn SVG background, insert-verified 79/79), plus two **real production exports as style ground truth** — `real-vent-panel-example.json` (360.001 Ventilasjon) and `real-spjeldliste-example.json` (360.004 Spjeldliste damper list: the container-built table pattern, 208 rows). The kit also teaches **linking**: hand the agent a plant's `iw_gen_driver_parameters` .sql dump and it fills in `driver_id`/`unit_id` per object (briefing §8b; worked pair: `real-vent-panel-linked-example.json` + `driver-parameters-sample.sql`). And it teaches **drawing the Maskin background** itself: `maskin-drawing-method.txt` is the distilled Advansor CO₂-booster drawing doctrine (layout zones, circuit colors as function — orange HP / yellow receiver / cyan MT suction / blue LT suction — symbol & pill rules, light vs dark skin, Illustrator layer template), with `maskin-light-template.ai` — the actual production Illustrator template ("how most maskin pictures should look"; real layers `Backround`/`Rør`/`Maskinrom`, artboard exactly 1400×750 pt) — rendered 1:1 as `maskin-light-style-reference.png`, `maskin-dark-style-example.png` as the dark-variant reference, and `generated-maskin-example.json` as the worked answer — a full generated Maskin (method-drawn `image_svg` + 63 objects with the canonical link-map aliases), insert-verified 63/63. Attach the briefing + examples as the agent's knowledge files.

## How it integrates

- The sidebar is static HTML loaded with `innerHTML +=` — that re-serializes existing children and silently kills `addEventListener` handlers, so the injected buttons use **inline `onclick` attributes** calling `window.__IWDIE.*` (exactly how the host's own sidebar buttons survive). An idempotent interval re-adds/de-dupes the fieldset if the sidebar is ever re-rendered.
- **Export** calls the host's own collector `getPanelDataFromDOM(...)` (the same function the designer's save uses) after mirroring the host's pre-save global resets — no DOM re-implementation, byte-compatible documents.
- **Insert** drives the host's own loaders (`DesignPanelHandler.load_new_ver_objects` / `load_new_ver_containers` — the code path behind the designer's template insert), then renumbers `object_N` names from the live child index (the same policy as the designer's `Duplicator` paste) and runs `UpdateObjectWorker()`.
- Background embed/apply uses the host's own `converted:"true"` + `image_data` document format consumed by `renderPanel`/`iw_set_base_image`.
- Clipboard uses `GM_setClipboard` (the host is plain http, so `navigator.clipboard` is unavailable) with a textarea/`execCommand` fallback.
- Console surface: `window.__IWDIE` (`doExport`, `doCopyJson`, `openImportPanel`, `applyImport`, `doExportBackgroundAi`, `_collect`). Pure helpers are `module.exports`-ed for Node unit checks (incl. `buildImagePdf` — the PDF writer is pure/synchronous and structurally unit-tested: header, MediaBox, stream lengths, xref offsets).

See [iwmac-designer-reference/](iwmac-designer-reference/) for the full host internals reference (`CLAUDE.md` + probe artifacts in `reference_data/`, including the **complete object catalogues** — all 820 palette entries and all 1769 render definitions — the live toolbar registry, and the persisted round-trip verification log).

**Round-trip verified live:** export → insert on a fresh panel → host Compile → server fetch-back came back field-identical for every object, background included; the copy loaded 1:1 after a full reload. (One host quirk found: newly compiled panels always land `visible=1` — the save popup's Visible field is ignored on insert.)
