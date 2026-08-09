# MENY ventilation corpus — initial 20-plant batch

This focused production survey is a separate evidence set from the existing 41-plant Coop Extra survey. Its authoritative inputs are the [sanitized raw survey](reference_data/plant-panel-survey-meny-20.json) and the deterministic [ventilation corpus](reference_data/ventilation-panel-corpus.json), both dated 2026-08-08. The corrected authenticated GET-only rerun passed offline validation with exactly 20 plants, 101 panels, and no plant, unit, or panel errors.

## Scope and coverage

Attempted plant IDs: `8001`, `8002`, `8016`, `8045`, `8049`, `8075`, `8076`, `8088`, `8098`, `8124`, `8132`, `8146`, `8150`, `8158`, `8205`, `8214`, `8232`, `8239`, `8272`, `8289`.

- **Matched (16):** `8001`, `8002`, `8016`, `8049`, `8075`, `8088`, `8124`, `8132`, `8146`, `8150`, `8158`, `8205`, `8214`, `8232`, `8239`, `8272`.
- **Zero match (4):** `8045`, `8076`, `8098`, `8289`.
- **Partial: 0. Failed: 0.** Every attempted plant has exactly one outcome: `matched`, `zero_match`, `partial`, or `failed`.

### Focused matched corpus

| Measure | Count |
|---|---:|
| Attempted plants | 20 |
| Matched plants | 16 |
| Zero-match plants | 4 |
| Partial plants | 0 |
| Failed plants | 0 |
| Matched panels | 34 |
| JSON panels | 14 |
| XML-only panels | 20 |
| Visible panels | 33 |
| Hidden panels | 1 |
| V2-bearing panels | 30 |
| Discovery: both | 2 |
| Discovery: unit_name | 30 |
| Discovery: panel_name | 2 |

### Complete surveyed source coverage

The raw batch contains **101 panels**: **42 JSON-backed** and **59 XML-only**, **99 visible** and **2 hidden**, with no endpoint or panel errors. Coverage includes modern object types and legacy V2 objects. The committed focused metric is **30 V2-bearing matched panels**; these source-coverage counts are not additional ventilation matches.

## Deterministic discovery rule

Classification uses only human-readable names connected to the current panel:

1. Test the exact panel name after NFKC normalization, case folding, and whitespace normalization.
2. Extract a unit ID only when its driver binding occurs on the same panel-local object; a `linked` attribute alone is not evidence. JSON requires a valid `driver_id` and valid `unit_id` on the same single object or container item. Production compiled XML stores the driver binding in `<id>` (= `driver_id`) and requires that valid `<id>` plus a valid `<unit_id>` on the same `<data>`. Blank values and case-insensitive placeholders/sentinels such as `driver_id`, `unit_id`, `undefined`, `null`, and `#…` are rejected.
3. Deduplicate and sort those IDs, then join them by exact ID against the same plant's unit inventory.
4. Test only the joined human-readable unit names. Never classify from opaque IDs such as `V01`, an unrelated plant-wide unit name, or a fuzzy match.

The accepted normalized terms are `ventilasjon` and `ventilation`. A digit-to-letter boundary is valid, so `360.001Ventilasjon` matches. `Forventilasjon` and `V01` do not. Each included panel records `panel_name`, `unit_name`, or `both` as its discovery reason.

Request errors stay explicit in plant/panel error fields and lead to the appropriate `partial` or `failed` outcome; they never relax this discovery predicate or authorize an ID-only/fuzzy match.

## Read-only collection method

The survey runs in an existing authenticated Designer session and makes same-origin GET requests under `/iwmac_designer_v4/` only:

- Panel list: `designer_site/V3_objectHandler.php?function=V3get_plant_designer_panels&plant_id=<pid>`
- Unit inventory: `designer_site/iw_load_units.php?cust_id=<pid>&driverId=driver_id`
- Panel JSON: `iw_load_ctrls.php?cust_id=<pid>&format=json&name=<panel>`
- Background presence/size for valid JSON panels: `iw_load_ctrls.php?cust_id=<pid>&format=image_data&name=<panel>`
- XML fallback: `iw_load_ctrls.php?cust_id=<pid>&name=<panel>`

The unit inventory is XML whose bytes are decoded as Windows-1252 before parsing; this preserves names such as `Kjøl` and `Tørrkjøler`. The corrected run used only these GET routes and passed offline validation with zero recorded errors. The result retains sanitized metadata, not response bodies, credentials, cookies, or browser state. The runner has no POST, save, sync, upload, delete, or compile endpoint.

## Representative matched panels

| Plant | Panel | Discovery | Store | Visibility |
|---|---|---|---|---|
| `8001` MENY Rona | `Ventilasjon` | both | JSON | visible |
| `8002` MENY Bekkestua | `360.01 Ventilasjon` | both | XML-only | visible |
| `8124` MENY Alna | `360.01 Ventilasjon` | panel name | JSON | visible |
| `8239` MENY Vollebekk | `360.01 Ventilasjon` | panel name | XML-only | visible |
| `8205` MENY Brakerøya | `360.01 UR` | unit name | XML-only | hidden |

Unit-name discovery intentionally finds panels whose titles are not ventilation names—for example `Energi`, `360.01 Butikk`, or `360.01 UR`—only when objects on that exact panel link to a unit whose joined display name matches.

## Modern and legacy object evidence

The clearest modern object-drawn AHU in this batch is plant `8124`, panel `360.01 Ventilasjon`: JSON-backed at 1280×1024, 95 objects, 71 linked, zero V2 objects, and no fetch error. Its object census includes modern fans, dampers, filters, heater/cooler valves, pumps, alarm LEDs, labels, and value objects. This is direct evidence that the AHU schematic and live values are assembled from Designer objects rather than inferred from the panel title or a background alone.

Legacy evidence has a different shape. Twenty matched panels are XML-only, and 30 matched panels carry at least one V2 object. XML fallback retains panel identity/visibility, object and V2 counts, separator state, linked unit IDs, and exact joined unit names, so it supports deterministic discovery. It does not provide the richer JSON-only dimensions, linked-object totals, container/graphic semantics, census, extents, or background metadata in this artifact; those values remain unknown (`null` or empty), never zero. The current userscript export loads panel JSON, so an XML-only panel cannot be exported by that workflow until the panel has been recompiled into JSON.

## Ranked copy sources

Ranking favors a direct AHU panel, complete JSON, known dimensions, useful object coverage, a strong linked ratio, and no fetch error. Object count alone is not enough. XML-only matches are discovery evidence but are not ranked because their dimensions and linked ratios are unknown and the current userscript cannot export them.

| Rank | Plant and panel | Source | Dimensions | Objects | Linked | Fetch error | Suitability |
|---:|---|---|---|---:|---:|---|---|
| 1 | `8124` `360.01 Ventilasjon` | JSON | 1280×1024 | 95 | 71/95 (74.7%) | none | Direct AHU title; complete modern object census with zero V2 objects. |
| 2 | `8001` `Ventilasjon` | JSON | 1280×1024 | 80 | 57/80 (71.3%) | none | Direct AHU title and strong linkage, but mixed legacy content (36 V2 objects). |
| 3 | `8150` `Tørrkjøler og beredersystem` | JSON | 1280×1024 | 38 | 32/38 (84.2%) | none | Highest linked ratio here, but a smaller multi-system page found only through its panel-linked ventilation unit. |
| 4 | `8146` `Tørrkjøler og beredersystem` | JSON | 1280×1024 | 84 | 52/84 (61.9%) | none | More objects than rank 3, but lower linkage and a mixed-purpose legacy-heavy page (70 V2 objects). |

## Canonical production and generated demo

Plant `9099` is canonical production evidence but is **outside this initial MENY batch**. Its panel name is exactly `360.001 Ventilasjon`; the panel is 1400×750 with 102 objects, 57 linked, no V2 objects/containers/graphics, content extent 1400×623, and an approximately 6 KB blank/sidebar PNG. Panel objects link unit `V01`; the exact live same-plant inventory name is `360.001Ventilasjon`. The spaced name in `driver-parameters-sample.sql` is sample/stale formatting and does not override the live inventory.

`ventilation_demo_360001.json` remains separately classified as `generated_demo`: 45 unlinked objects, SVG background, no production bindings, and excluded from every production total above.

**That file is not in this repository and never was.** It was a session artifact in the user's Downloads folder on 2026-08-08, so nothing here can open it — the corpus keeps only the record, under `canonical_examples.generated_demo` with `present_in_repository: false`. The record is worth keeping because it names a counter-example: an authored `image_svg` background and 45 unlinked objects are exactly what a Ventilasjon panel must not be (see the background contract in [PANEL-TYPE-GUIDE.md](PANEL-TYPE-GUIDE.md)). Do not cite it as a template, and do not treat 45 as a target object count — the production reference is plant `9099` with 102 objects.

## Reproduction

Run the survey only from an existing authenticated Designer session. The callback is paced, same-origin, GET-only, and must not be changed to navigate, authenticate, POST, save, sync, upload, delete, or compile:

```bash
playwright-cli run-code --filename=iwmac-designer-import-export/iwmac-designer-reference/ventilation-survey-20.js
```

Keep the returned JSON outside the repository until its exact 20-plant coverage and sanitized shape have been validated; never retain raw responses, credentials, cookies, or browser state. Rebuild the corpus deterministically from the validated raw artifact with:

```bash
python iwmac-designer-import-export/iwmac-designer-reference/build-ventilation-corpus.py iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json
```

## Known limitations

- Collection requires an already authenticated Designer session; it does not sign in or handle credentials.
- The survey depends on the documented same-origin endpoint paths and their current JSON/XML payload families. Unit inventory specifically comes from `designer_site/iw_load_units.php?cust_id=<pid>&driverId=driver_id`, and its XML bytes require Windows-1252 decoding. A route, payload, or encoding failure remains an explicit error.
- XML-only records preserve enough legacy object/unit evidence for matching, but not the richer JSON metadata listed above, and current userscript export requires the panel to be recompiled into JSON first.
- The corrected authenticated GET-only survey ran with the hardened real-driver and strict XML parsing rules described above; its normalized direct JSON object passed offline validation with zero errors.
- These 20 MENY plants are an initial batch, not a MENY or IWMAC fleet census.
- Every attempted plant has exactly one outcome: `matched`, `zero_match`, `partial`, or `failed`. This batch has zero partial and zero failed outcomes, but future endpoint or panel failures must remain explicit and must never weaken the matching rule.

For Coop Extra panel construction and copy-source guidance, keep using the separate [panel-type guide](PANEL-TYPE-GUIDE.md), [plant catalog](PLANT-PANEL-CATALOG.md), and [Coop raw survey](reference_data/plant-panel-survey.json). Do not combine their totals with this MENY batch.
