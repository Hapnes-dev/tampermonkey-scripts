# IWMAC Designer Import/Export

Adds a **Panel JSON** section to the IWMAC Designer's manager sidebar (right below *Manage Files*) with three buttons — **Export JSON**, **Copy JSON**, **Insert JSON…** — so a panel's complete look (objects, containers, graphics, background image) can be copied out as a single `.json` file and inserted into another panel, on the same plant or a different one. The designer itself has no way to move a panel between plants; this script adds it.

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
| Background image | Base64-embedded into the export (the host's own `converted`/`image_data` format), re-applied on insert |
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

## How it integrates

- The sidebar is static HTML loaded with `innerHTML +=` — that re-serializes existing children and silently kills `addEventListener` handlers, so the injected buttons use **inline `onclick` attributes** calling `window.__IWDIE.*` (exactly how the host's own sidebar buttons survive). An idempotent interval re-adds/de-dupes the fieldset if the sidebar is ever re-rendered.
- **Export** calls the host's own collector `getPanelDataFromDOM(...)` (the same function the designer's save uses) after mirroring the host's pre-save global resets — no DOM re-implementation, byte-compatible documents.
- **Insert** drives the host's own loaders (`DesignPanelHandler.load_new_ver_objects` / `load_new_ver_containers` — the code path behind the designer's template insert), then renumbers `object_N` names from the live child index (the same policy as the designer's `Duplicator` paste) and runs `UpdateObjectWorker()`.
- Background embed/apply uses the host's own `converted:"true"` + `image_data` document format consumed by `renderPanel`/`iw_set_base_image`.
- Clipboard uses `GM_setClipboard` (the host is plain http, so `navigator.clipboard` is unavailable) with a textarea/`execCommand` fallback.
- Console surface: `window.__IWDIE` (`doExport`, `doCopyJson`, `openImportPanel`, `applyImport`, `_collect`). Pure helpers are `module.exports`-ed for Node unit checks.

See [iwmac-designer-reference/](iwmac-designer-reference/) for the full host internals reference (`CLAUDE.md` + probe artifacts in `reference_data/`, including the **complete object catalogues** — all 820 palette entries and all 1769 render definitions — the live toolbar registry, and the persisted round-trip verification log).

**Round-trip verified live:** export → insert on a fresh panel → host Compile → server fetch-back came back field-identical for every object, background included; the copy loaded 1:1 after a full reload. (One host quirk found: newly compiled panels always land `visible=1` — the save popup's Visible field is ignored on insert.)
