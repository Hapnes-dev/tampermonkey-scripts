# IWMAC Export Trace and Copy Cleanup Design

**Date:** 2026-08-09

## Goal

Make **Export JSON** the only panel-output action. Every export with a background must include `panel.image_svg_trace` without asking. Remove **Copy JSON** and its clipboard-only implementation.

## Scope

Change:

- `iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js`
- `iwmac-designer-import-export/README.md`
- `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md` where it describes the button set

Do not change import behavior, background-to-Illustrator behavior, trace settings, panel format version, or generated reference data.

## UI and API cleanup

Sidebar keeps three buttons:

1. **Export JSON**
2. **Insert JSON…**
3. **Background → Illustrator**

Remove:

- **Copy JSON** button
- `doCopyJson()`
- clipboard helper used only by `doCopyJson()`
- `window.__IWDIE.doCopyJson`
- `GM_setClipboard` userscript grant
- documentation that advertises clipboard export

## Export flow

1. Collect panel through existing host collector.
2. Embed background through existing `embedBackground()` flow.
3. Process background trace automatically:
   - Embedded SVG: decode existing SVG and store it in `panel.image_svg_trace`.
   - Embedded raster image: trace with existing worker and existing color-aware options; use existing main-thread fallback if worker tracing fails.
   - No embedded background: continue without `image_svg_trace`.
4. Download formatted JSON only after required trace processing completes.
5. Report successful export with existing panel/background summary plus trace details.

No trace confirmation dialog remains.

## Failure behavior

For raster backgrounds, export must not silently degrade to JSON without a trace.

- If image loading fails, worker tracing and main-thread fallback both fail, canvas access fails, tracer is unavailable, or generated SVG is empty: show a clear error toast and do not download.
- A panel without a background remains valid and exports without `image_svg_trace`.
- An SVG background that cannot be decoded is treated as trace failure: show error and do not download.

## Compatibility

`panel.image_svg_trace` remains AI-reading metadata only. Existing insert normalization continues stripping it, so imported canvases still render the embedded pixel/SVG background rather than the trace.

Bump userscript version from `1.6.0` to `1.6.1`. Panel envelope format stays version 1.

## Verification

- Static checks confirm **Copy JSON**, `doCopyJson`, clipboard helper, and `GM_setClipboard` are absent.
- Node loads userscript and exercises existing exported pure helpers without syntax/runtime errors.
- Source-focused tests or checks cover trace outcome policy:
  - SVG background supplies trace.
  - Raster success downloads traced JSON.
  - Raster failure does not download.
  - No-background panel still downloads.
- README and reference docs describe three buttons and automatic trace inclusion.
- Scan `C:\Users\Thomas\Downloads\` again immediately before editing or committing userscript; sync any export newer than repo version first.
- Run `graphify update .` after code changes.
