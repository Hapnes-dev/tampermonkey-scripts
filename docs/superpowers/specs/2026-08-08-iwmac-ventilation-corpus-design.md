# IWMAC Ventilation Corpus Design

## Goal

Expand `iwmac-designer-import-export` reference material with production evidence about ventilation systems. Start with a bounded batch of 20 plants, then make later batches repeatable.

## Scope

First pass surveys 20 plants through authenticated, read-only IWMAC Designer requests. It produces a ventilation-specific data set and focused documentation without changing userscript behavior.

Included panels:

- Panel name contains a normalized ventilation term, including `Ventilasjon`.
- Linked unit display name contains a normalized ventilation term.
- JSON-backed and XML-only panels.
- Visible and hidden panels, with visibility recorded.
- Modern V3 and legacy V2 object families.

Stored `unit_id` alone is not discovery evidence. Plant 9099 demonstrates why: its ventilation unit uses `V01`.

## Non-goals

- No production writes.
- No userscript feature changes.
- No attempt to make XML-only panels exportable.
- No claim that 20 plants represent the full fleet.
- No committing browser state, temporary survey files, personal metadata, or authenticated artifacts.

## Source and Derivation

The general plant-panel survey remains the raw source. A deterministic derivation step selects ventilation candidates from panel names and linked unit display names. Exact source names remain unchanged; matching uses case-insensitive normalized text.

For each panel, fetch JSON first. If JSON is empty, fetch XML and record the panel as XML-only. Requests retain existing pacing to avoid unnecessary load.

The initial 20 plants should prioritize likely ventilation candidates from available plant/unit inventories. If fewer than 20 candidate plants can be identified from existing data, fill the batch using diverse plants from the known fleet and record zero-match plants so search coverage stays auditable.

## Data Products

Add:

- `iwmac-designer-reference/VENTILATION-CORPUS.md`
- `iwmac-designer-reference/reference_data/ventilation-panel-corpus.json`

Update as supported by collected evidence:

- project `README.md`
- `PANEL-TYPE-GUIDE.md`
- `PLANT-PANEL-CATALOG.md`
- deep `iwmac-designer-reference/CLAUDE.md`
- general `plant-panel-survey.json` when the 20-plant batch adds source records

The machine-readable corpus is authoritative for ventilation-specific counts. Human documents summarize it and link to it.

## Corpus Record

Each matched panel records:

- plant ID, plant name, and fleet
- exact panel name
- discovery reason: panel name, unit name, or both
- JSON, XML, or XML-only availability
- visible or hidden state
- width and height
- object, linked-object, container, graphic, and V2 counts
- linked unit IDs and available unit display names
- object-ID census
- background name and byte size
- maximum content extent
- copy-source suitability and limitations

Each surveyed plant also has enough batch metadata to prove whether it produced matches or was a zero-match plant.

## Canonical Examples

### Production: plant 9099

`360.001 Ventilasjon` is canonical modern production evidence:

- 1400 × 750
- 102 objects
- 57 linked objects
- unit ID `V01`
- modern V3 objects
- zero V2 objects, containers, and graphics
- small embedded blank/sidebar PNG background
- suitable as a modern layout and object-family reference
- driver bindings require cross-plant rebinding

Committed material strips `saved_by` and other personal metadata. Production aliases and object-family statistics may remain because they explain panel construction.

### Generated demo

`ventilation_demo_360001.json` remains separately classified generated material:

- 45 unlinked objects
- SVG background
- no production bindings
- excluded from production survey totals
- usable as an AI-generated layout example only

## Error Handling

- Record per-plant and per-panel fetch failures instead of silently dropping them.
- Treat empty JSON followed by valid XML as XML-only, not failed.
- Preserve malformed-response evidence only as sanitized error summaries.
- Do not publish partial totals as complete when requests fail.
- Keep temporary retry artifacts outside committed reference data.

## Validation

- Validate all generated JSON.
- Check every included panel has an explicit discovery reason.
- Check production and generated records never share production totals.
- Verify plant 9099 values against supplied export.
- Recompute human-facing totals from machine-readable data.
- Check XML-only limitation is documented.
- Scan committed files for `saved_by`, tokens, session data, and personal identifiers.
- Review final Git diff to ensure unrelated dirty work was not copied into the isolated branch.

## Acceptance Criteria

1. Exactly 20 plants are attempted in initial batch and every attempt has an outcome.
2. Discovery checks both panel names and unit display names.
3. JSON-backed and XML-only ventilation panels can be represented.
4. Every matched panel records inclusion reason and source format.
5. Plant 9099 canonical record matches source export statistics.
6. Generated demo remains outside production corpus totals.
7. Human documentation agrees with validated JSON corpus.
8. No personal metadata, credentials, browser state, or temporary survey artifacts are committed.
9. Existing unrelated work in primary checkout remains untouched.
