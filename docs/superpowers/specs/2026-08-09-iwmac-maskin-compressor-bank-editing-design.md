# IWMAC Maskin Compressor-Bank Editing Documentation Design

## Goal

Document a safe, repeatable method for editing an existing Maskin compressor bank from an exported IWMAC Designer panel JSON. Capture the successful C3-to-C4 workflow, prevent the observed failure modes, and provide executable regression evidence without exposing plant, driver, user, or customer identifiers.

## Scope

Update these existing documents:

- `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md`
- `iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt`
- `iwmac-designer-import-export/iwmac-designer-reference/reference_data/maskin-drawing-method.txt`
- `iwmac-designer-import-export/README.md`, only where import behavior is described

Add reusable masked fixture data and an executable Python regression test under `iwmac-designer-reference/tests/`.

## Non-goals

- No userscript or host-internal changes.
- No production IWMAC writes.
- No changes to unrelated verified host facts.
- No full customer panel or identifying plant, driver, user, or customer data in committed examples.
- No new production dependencies.
- No recommendation to insert a full export into a populated panel unless object duplication is intentional.

## Documentation Architecture

`reference_data/maskin-drawing-method.txt` owns the complete normative procedure. It receives the exact heading `Editing an existing Maskin compressor bank from an exported panel JSON`, followed by deliverable selection, object-preservation rules, atomic column cloning, layer separation, alpha-safe compositing, measured raster rules, QA requirements, failure lessons, and four reusable checklists.

`CLAUDE.md` mirrors the operational contract in enough detail for repository-aware agents and links to the complete method and fixture. `AI-BRIEFING.txt` carries a compact self-contained version because it is commonly supplied independently to an AI. README changes remain limited to import semantics and direct readers to the detailed method.

Normative rules use `MUST`, `MUST NOT`, `ONLY`, and `NEVER` where violation causes a broken or misleading artifact.

## Deliverable Contract

Before editing, classify output:

- Background-only patch: change `image_data`; keep `single_objects`, `containers`, and `graphics` empty; declare zero counts for them.
- Entire/full JSON: preserve the complete original panel document and object arrays, changing only intended content.
- Insert JSON appends objects. A full JSON is inserted only into an empty canvas unless duplication is intentional.

This classification is part of the pre-edit checklist and acceptance tests.

## Compressor-Column Contract

Inspect source objects at the intended new column before creating any object. Artwork does not imply live-object creation.

When parameter boxes are explicitly requested, clone the nearest role-matching compressor column as one atomic pattern. For another fixed-speed MT compressor matching C3, clone exactly controller status, capacity, and runtime. Do not clone C1's VSD row. Apply one measured translation vector to artwork and dynamic-object coordinates.

New objects remain unlinked:

- `driver_id`: `driver_id`
- `linked`: `false`
- blank unit/link fields
- descriptive `alias_text`

Driver IDs are never invented.

## Raster and Layer Contract

Background artwork owns pipes, compressor housing, static labels, status/value-pill artwork, and empty value fields. Dynamic objects own live state and live values and render above the background. New artwork never bakes in live text or numbers.

Raster compositing preserves source alpha or masks only intended non-background pixels. Opaque rectangular crops are prohibited. Continuous headers are restored using sampled source raster style before compressor housing is placed above branches.

Every source image is measured independently for centerline, color, alpha, thickness, anti-aliasing, and junction geometry. The worked source's orange 191/255/64 three-row header, opaque two-row cyan header, and opaque two-column vertical branches are documented as example-specific, not generic constants.

## Worked Example

A masked C3-to-C4 example demonstrates:

1. Source C3 is fixed-speed MT and C1 includes an extra VSD row.
2. Existing center-to-center pitch determines the C4 translation vector.
3. Background-only output keeps all object arrays empty.
4. Full output preserves every original object.
5. If live boxes are explicitly requested, exactly three unlinked objects are appended: status, capacity, runtime.
6. Background and dynamic-object overlay are rendered together for alignment validation.

All plant and driver IDs are masked. Fixture uses a minimal derivative crop and metadata rather than a full production panel.

## Regression Assets

Add:

- `iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/source-panel.json`
- `iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/edited-full-panel.json`
- `iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/background-only-patch.json`
- `iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/expectations.json`
- minimal masked before/after raster crops used by tests
- `iwmac-designer-reference/tests/test_maskin_compressor_bank.py`

Tests validate:

- duplicate object names or records
- changed existing links and other protected existing fields
- non-sequential `object_N` names
- declared counts versus array lengths
- pipe continuity
- pipe thickness and alpha-pattern equality against a control segment
- compressor center-to-center pitch
- dynamic-object alignment with empty background fields

Tests start from one valid fixture, then create one in-memory mutation per defect and assert the detector rejects it. Standard-library Python is preferred; existing Pillow availability may be used only if already required by repository tests. Otherwise raster samples are represented as explicit RGBA matrices in JSON so tests remain dependency-free.

## Checklists

Documentation includes four independent checklists:

1. Pre-edit decision checklist: source, requested deliverable, role match, existing target objects, measured pitch, and output mode.
2. Compressor-bank editing checklist: atomic sibling choice, one translation vector, layer ownership, alpha-safe composite, sampled pipes, optional object clone.
3. Post-edit JSON integrity checklist: parse, counts, sequential names, exact object diff, protected fields, and explicit change list.
4. Post-edit pixel/raster QA checklist: continuity, thickness, alpha, junctions, pitch, full preview, zoomed crop, and dynamic overlay.

## Error Handling

Validation failures identify the exact invariant and expected/actual value. Documentation forbids claiming visual equality until both raster and overlay checks pass. After any failed editing iteration, restart from the original export rather than modifying the failed derivative.

## Acceptance Criteria

1. All requested rules and failure/success lessons appear normatively in the complete method.
2. `CLAUDE.md` and `AI-BRIEFING.txt` remain useful when read independently without contradicting the complete method.
3. README changes only describe import behavior and link to deeper guidance.
4. Four checklists and masked C3-to-C4 worked example are present.
5. Executable regression tests prove detection of all eight requested regression classes.
6. Valid full fixture preserves original objects and appends only three explicitly requested unlinked fixed-speed MT objects.
7. Valid background-only patch contains no dynamic objects.
8. No committed fixture contains real plant, driver, user, or customer identifiers.
9. No userscript, host internal, or unrelated verified fact changes.
10. Primary dirty checkout remains untouched; work occurs in an isolated worktree based on current `origin/main`.
