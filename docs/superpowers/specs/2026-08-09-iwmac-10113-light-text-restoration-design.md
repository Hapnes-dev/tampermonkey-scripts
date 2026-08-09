# IWMAC Plant 10113 Light-Text Restoration Design

## Goal

Create a production-quality light-background version of plant 10113 panel `Oversikt` without changing any Designer object or any C4 pipe pixel.

The deliverable is an artifact set outside the repository. It must not be imported, compiled, synced, or published automatically.

## Authoritative Inputs

The required panel source is:

`C:\Users\Thomas\Downloads\iwmac-panel_10113_oversikt_C4_pipe_only.json`

Processing must fail closed when this exact file is absent. A similarly named export, a semantically similar 68-object export, or an already lightened image is not an automatic substitute.

Supporting evidence:

- Original production export: `F:\Downloads\iwmac-panel_10113_oversikt_20260809-1137.json`
- Light Illustrator source: `iwmac-designer-import-export/iwmac-designer-reference/reference_data/maskin-light-template.ai`
- Native light raster reference: `iwmac-designer-import-export/iwmac-designer-reference/reference_data/maskin-light-style-reference.png`
- Handoff: `C:\Users\Thomas\Downloads\claude_handoff_iwmac_text_quality.json`

The Illustrator source is PDF-compatible, has a 1400 x 750 point artboard, and embeds Roboto Regular at weight 400. Its production layers are `Backround`, `Rør`, and `Maskinrom`.

## Source Gate

Before artwork processing:

1. Require the exact authoritative file.
2. Parse it as `iwmac-designer-panel` version 1.
3. Require a 1400 x 750 embedded PNG.
4. Require exactly 68 `single_objects`, zero containers, and zero graphics.
5. Capture raw serialized spans for `single_objects`, `containers`, and `graphics`.
6. Compare the authoritative image with the original production export and isolate the C4 pipe-only delta.
7. Reject the source if the observed delta conflicts with the handoff claim of 326 changed pixels in three pipe regions.

No output may be presented as validated when any source-gate check fails.

## Chosen Approach

Use vector-derived light artwork, then preserve C4 pipe pixels from the authoritative export.

1. Render `maskin-light-template.ai` at exactly 72 DPI so its 1400 x 750 point artboard becomes a 1400 x 750 PNG without scaling.
2. Compare fixed landmarks between the rendered template and the authoritative background: compressor symbols, empty pills, static labels, equipment outlines, and right information panel.
3. Require exact or explicitly measured alignment. Do not guess an offset.
4. Copy only the verified C4 orange-discharge and cyan-suction pipe pixels from the authoritative source onto the rendered light image.
5. Do not smooth, resample, recolor, widen, redraw, or antialias those pixels.
6. Reject the result if the template does not align with plant 10113 geometry.

This route avoids reconstructing glyph alpha from labels flattened against black. It uses the verified production font and light rendering instead of global raster conversion.

## Fallback

If the Illustrator source cannot be rendered or does not align, use localized label reconstruction only.

1. Start from a verified light image whose non-label geometry already matches the authoritative source.
2. Define exact rectangles for `Run Cap. %`, `Capacity %`, `Reg Cap. %`, `Runtime`, and `VSD %`.
3. Confirm every rectangle excludes live-value objects and C4 pipe masks.
4. Clear only those rectangles using verified local background pixels.
5. Render Roboto Regular, weight 400, with measured point size, fill, baseline, tracking, kerning, and coordinates.
6. Reject the result if any typography metric remains inferred rather than measured.

Whole-image inversion, thresholding, brightening, black replacement, remapping, or recoloring is forbidden. A complete SVG redraw is also out of scope because it creates avoidable geometry drift.

## JSON Preservation

Final JSON must preserve source serialization wherever possible.

- Replace only the `panel.image_data` string in the authoritative source bytes.
- Do not parse and reserialize the complete document for final output.
- Preserve all 68 `single_objects` byte-for-byte.
- Preserve every driver ID, unit ID, tag, link, alias, position, size, container, and graphic.
- Do not invent C4 bindings.
- Do not copy or add `saved_by`, personal identifiers, `image_svg_trace`, or unrelated production metadata from another export.

Parsed objects may be used for validation but not as the source of final serialization.

## Required Outputs

Write artifacts outside the repository, beside the authoritative source unless a later explicit destination is supplied:

1. `iwmac-panel_10113_oversikt_C4_light_crisp_text.json`
2. `iwmac-panel_10113_oversikt_C4_light_crisp_text.png`
3. `iwmac-panel_10113_oversikt_C4_light_crisp_text_zoom.png`
4. `iwmac-panel_10113_oversikt_C4_light_crisp_text_validation.md`
5. `iwmac-panel_10113_oversikt_C4_light_crisp_text_pipe_comparison.png`

The zoom uses crop `x=0..410`, `y=285..395`. Any enlargement must use nearest-neighbor scaling so inspection does not blur native pixels.

## Validation

The report must include deterministic evidence for every invariant:

- Format is `iwmac-designer-panel`, version 1.
- Embedded `image_data` decodes as PNG at exactly 1400 x 750.
- `single_objects` count is 68.
- Raw `single_objects`, `containers`, and `graphics` spans are byte-identical to the authoritative source.
- Parsed driver IDs, unit IDs, tags, links, aliases, positions, and sizes are unchanged.
- No binding was added or removed.
- C4 orange and cyan pipe masks are pixel-identical to the authoritative source.
- C4 pipes retain three-pixel thickness.
- C4 pipe masks do not intersect edited label regions.
- Live values such as `12.3` remain Designer objects and are not rasterized.
- Right information panel remains unchanged from the verified light source.
- Changed pixels are limited to the approved construction regions.
- Static labels show no halo, doubled edge, clipping, jagged threshold edge, or artificial heavy weight at native scale.

The pipe-comparison image must show authoritative and final native-scale crops plus a difference view. A zero-difference result over the complete C4 pipe mask is required.

## Failure Behavior

Stop without creating a claimed-final artifact when:

- authoritative source is missing;
- source shape or object count differs;
- raw object spans cannot be preserved;
- Illustrator render is not exactly 1400 x 750;
- template alignment is unproven;
- C4 pipe delta cannot be isolated;
- any pipe pixel changes;
- typography requires guessed metrics;
- validation fails.

Partial inspection files may use a temporary directory, but they must be labeled diagnostic and never returned as final output.

## Non-Goals

- No `.user.js` edits or version bump.
- No userscript behavior change.
- No new bindings.
- No import into IWMAC Designer.
- No compile, sync, save, upload, or POST operation.
- No GitHub publication of production panel artifacts.
- No Graphify or Obsidian refresh for artifact generation.
