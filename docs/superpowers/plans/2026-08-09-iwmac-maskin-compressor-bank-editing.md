# IWMAC Maskin Compressor-Bank Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add masked, executable regression evidence and normative guidance for safely editing an existing Maskin compressor bank from exported panel JSON.

**Architecture:** Keep the complete operational method in `reference_data/maskin-drawing-method.txt`; mirror a compact contract in `CLAUDE.md` and `AI-BRIEFING.txt`; limit README changes to import semantics. Use small, dependency-free JSON fixtures plus `unittest` validators to prove JSON preservation, measured raster continuity/style, compressor pitch, and dynamic-overlay alignment.

**Tech Stack:** Markdown/plain text, JSON, Python 3 standard library (`json`, `copy`, `pathlib`, `unittest`), Git.

## Global Constraints

- Work only in isolated worktree `iwmac-maskin-bank-docs`, based on current `origin/main`.
- Do not modify `IWMAC-Designer-Import-Export.user.js`; no userscript behavior or `@version` change belongs in this task.
- Do not write to production IWMAC or call any production write endpoint.
- Do not alter unrelated host internals or existing verified facts.
- Do not add third-party dependencies. Raster samples must be explicit RGBA matrices in JSON.
- Do not commit full production panels, production screenshots, plant IDs, real driver IDs, user data, or customer-identifying data.
- Use masked IDs such as `MASKED_PLANT`, placeholder driver value `driver_id`, and generic compressor labels C1/C3/C4.
- Required complete-method section title must be exactly `Editing an existing Maskin compressor bank from an exported panel JSON`.
- Background-only patch changes `image_data` and has empty `single_objects`, `containers`, and `graphics` arrays with declared counts of zero.
- Entire/full JSON preserves the complete source panel and all existing object arrays; only explicitly requested new objects may be appended.
- Insert JSON appends objects. Full JSON is safe only on an empty canvas unless duplication is intentional.
- New dynamic objects use `driver_id: "driver_id"`, `linked: "false"`, blank unit/link fields, and descriptive `alias_text`; never invent a driver ID.
- Existing source objects and protected fields must remain exact unless the worked request explicitly authorizes a change.
- For a new fixed-speed MT compressor matching C3, append exactly status, capacity, and runtime; do not copy C1's VSD row.
- Treat compressor column as one atomic visual template and apply one measured translation vector to art and object coordinates.
- Background owns pipes, equipment, static labels, pill artwork, and empty fields. Dynamic objects own live status and values.
- Preserve source alpha or mask intended pixels only. Never paste opaque rectangular crops.
- Sample centerline, color, alpha, thickness, anti-aliasing, and junction geometry from each source independently.
- Worked values `191 / 255 / 64` for orange header alpha, opaque two-row cyan header, and opaque two-column branches are example-specific, never defaults.
- Do not claim alignment from a background-only preview when requirement concerns dynamic-object overlay alignment.

## File Map

**Create:**

- `iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py` — fixture loader, invariant validators, valid-case tests, and one in-memory mutation per regression class.
- `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/source-panel.json` — masked original full export containing C1 and fixed-speed C3 patterns.
- `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/edited-full-panel.json` — source-preserving full export with exactly three C4 objects appended.
- `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/background-only-patch.json` — image-only deliverable with all object arrays empty.
- `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/expectations.json` — protected fields, expected additions, translation, pitches, pipe samples, and overlay anchors.
- `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/raster-before.json` — minimal masked source RGBA matrix.
- `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/raster-after.json` — minimal valid edited RGBA matrix.

**Modify:**

- `iwmac-designer-import-export/iwmac-designer-reference/reference_data/maskin-drawing-method.txt` — canonical complete procedure, four checklists, worked example, failure lessons, and fixture pointer.
- `iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt` — compact self-contained normative editing contract after existing Maskin artwork contract.
- `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md` — repository-agent operational summary and links near Maskin generation guidance.
- `iwmac-designer-import-export/README.md` — import-mode warning and detailed-method link only.

## Fixture Contract

Every panel fixture uses the normal envelope and nested `panel` document:

```json
{
  "format": "iwmac-designer-panel",
  "version": 1,
  "generator": "masked-regression-fixture",
  "source_plant_id": "MASKED_PLANT",
  "panel_name": "Maskin masked fixture",
  "counts": {"single_objects": 7, "containers": 0, "graphics": 0},
  "background_embedded": true,
  "panel": {
    "plant_id": "MASKED_PLANT",
    "panel_name": "Maskin masked fixture",
    "panel_width": "96px",
    "panel_height": "64px",
    "org_image_name": "masked-maskin.png",
    "image_name": "",
    "saved_by": "masked",
    "converted": "true",
    "image_data": "fixture:raster-before.json",
    "single_objects": [],
    "containers": [],
    "graphics": []
  }
}
```

`source-panel.json` contains seven sequential objects:

1. C1 controller status.
2. C1 capacity.
3. C1 VSD value.
4. C1 runtime.
5. C3 controller status.
6. C3 capacity.
7. C3 runtime.

`edited-full-panel.json` preserves those seven records exactly and appends:

```json
[
  {
    "obj_id": "V3_akpc_772_781_781A_783_contr",
    "name": "object_7",
    "id": "driver_id",
    "posWidth": 9,
    "posHeight": 3,
    "posLeft": 68,
    "posTop": 24,
    "zIndex": "360",
    "tag_text": "",
    "linked": "false",
    "link_name": "",
    "link_tag": "",
    "sub_group": "",
    "driver_id": "driver_id",
    "unit_id": "",
    "unit_ref": "",
    "alias_text": "C4 MT status"
  },
  {
    "obj_id": "number_v3_value_only",
    "name": "object_8",
    "id": "driver_id",
    "posWidth": 6,
    "posHeight": 3,
    "posLeft": 69,
    "posTop": 31,
    "zIndex": "1100",
    "tag_text": "",
    "linked": "false",
    "link_name": "",
    "link_tag": "",
    "sub_group": "",
    "driver_id": "driver_id",
    "unit_id": "",
    "unit_ref": "",
    "alias_text": "C4 MT capacity"
  },
  {
    "obj_id": "number_v3_value_only",
    "name": "object_9",
    "id": "driver_id",
    "posWidth": 6,
    "posHeight": 3,
    "posLeft": 69,
    "posTop": 38,
    "zIndex": "1100",
    "tag_text": "",
    "linked": "false",
    "link_name": "",
    "link_tag": "",
    "sub_group": "",
    "driver_id": "driver_id",
    "unit_id": "",
    "unit_ref": "",
    "alias_text": "C4 MT Runtime total"
  }
]
```

Exact miniature positions may shift while authoring fixture, but `expectations.json`, source C3, edited C4, raster feature anchors, and tests must all use one consistent measured vector. Do not copy C1 VSD object into additions.

`expectations.json` owns machine-readable invariants:

```json
{
  "protected_fields": [
    "obj_id", "name", "id", "posWidth", "posHeight", "posLeft", "posTop",
    "zIndex", "tag_text", "linked", "link_name", "link_tag", "sub_group",
    "driver_id", "unit_id", "unit_ref", "alias_text"
  ],
  "source_object_count": 7,
  "added_aliases": ["C4 MT status", "C4 MT capacity", "C4 MT Runtime total"],
  "forbidden_added_alias_terms": ["VSD"],
  "translation": {"dx": 24, "dy": 0},
  "compressor_marker_rgba": [80, 80, 80, 255],
  "compressor_centers": [[24, 58], [48, 58], [72, 58]],
  "compressor_pitch": 24,
  "field_anchor_rgba": [255, 0, 255, 255],
  "overlay_anchors": {
    "C4 MT status": [72, 25],
    "C4 MT capacity": [72, 32],
    "C4 MT Runtime total": [72, 39]
  },
  "pipes": [
    {
      "name": "orange header",
      "orientation": "horizontal",
      "control_start": [8, 8],
      "edited_start": [56, 8],
      "length": 17,
      "cross_section": [
        [230, 120, 25, 191],
        [230, 120, 25, 255],
        [230, 120, 25, 64]
      ]
    },
    {
      "name": "cyan header",
      "orientation": "horizontal",
      "control_start": [8, 48],
      "edited_start": [56, 48],
      "length": 17,
      "cross_section": [
        [40, 190, 220, 255],
        [40, 190, 220, 255]
      ]
    },
    {
      "name": "C4 vertical branch",
      "orientation": "vertical",
      "control_start": [47, 9],
      "edited_start": [71, 9],
      "length": 39,
      "cross_section": [
        [230, 120, 25, 255],
        [230, 120, 25, 255]
      ]
    }
  ]
}
```

Use dedicated marker colors only inside this masked test derivative. Documentation must say production QA samples actual source pixels; marker colors are test-fixture instrumentation, not Maskin drawing guidance.

Raster fixture shape:

```json
{
  "width": 96,
  "height": 64,
  "pixels": [
    [[238, 241, 244, 255], [238, 241, 244, 255]],
    [[238, 241, 244, 255], [238, 241, 244, 255]]
  ]
}
```

`pixels` must contain exactly `height` rows and exactly `width` four-integer RGBA pixels per row. Generate full matrices using a temporary, uncommitted Python helper if hand-authoring would be error-prone; commit only deterministic JSON outputs.

---

### Task 1: Build JSON fixture validation with TDD

**Files:**
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/source-panel.json`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/edited-full-panel.json`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/background-only-patch.json`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/expectations.json`

**Interfaces:**
- Produces: `load_fixture(name: str) -> dict`
- Produces: `validate_counts(document: dict) -> None`
- Produces: `validate_sequential_names(document: dict) -> None`
- Produces: `validate_full_edit(source: dict, edited: dict, expectations: dict) -> None`
- Produces: `validate_background_patch(document: dict) -> None`
- Contract: validators raise `AssertionError` with invariant-specific expected/actual details.

- [ ] **Step 1: Add masked source, full-edit, patch, and expectations fixtures**

Use fixture contract above. Keep source and full envelopes identical except:

- full edit points `panel.image_data` to `fixture:raster-after.json`;
- full counts become 10/0/0;
- full `single_objects` equals exact seven-object source prefix plus exact three-object C4 suffix;
- background patch points to `fixture:raster-after.json`, declares 0/0/0, and has all three arrays empty;
- no fixture contains numeric plant IDs, production `saved_by`, customer names, or any non-placeholder driver ID.

- [ ] **Step 2: Write failing valid-case tests before validators**

Create imports/constants and tests:

```python
import copy
import json
import pathlib
import unittest

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "maskin-compressor-bank"


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class MaskinCompressorBankJsonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = load_fixture("source-panel.json")
        cls.edited = load_fixture("edited-full-panel.json")
        cls.patch = load_fixture("background-only-patch.json")
        cls.expectations = load_fixture("expectations.json")

    def test_valid_full_edit_preserves_source_and_appends_requested_pattern(self):
        validate_full_edit(self.source, self.edited, self.expectations)

    def test_valid_background_patch_has_no_objects(self):
        validate_background_patch(self.patch)
        self.assertNotEqual(
            self.patch["panel"]["image_data"],
            self.source["panel"]["image_data"],
            "background-only patch must change image_data",
        )
```

- [ ] **Step 3: Run test to prove validator symbols fail**

Run:

```bash
python -m unittest iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py -v
```

Expected: failure caused by undefined `validate_full_edit` or `validate_background_patch`, not malformed fixture JSON.

- [ ] **Step 4: Implement minimal JSON validators**

Use one envelope helper and explicit messages:

```python
def panel(document):
    value = document.get("panel")
    assert isinstance(value, dict), "panel must be an object"
    return value


def validate_counts(document):
    data = panel(document)
    declared = document.get("counts", {})
    for key in ("single_objects", "containers", "graphics"):
        actual = len(data.get(key, []))
        expected = declared.get(key)
        assert expected == actual, (
            f"counts.{key}: expected actual length {actual}, got {expected}"
        )


def validate_sequential_names(document):
    objects = panel(document)["single_objects"]
    actual = [item.get("name") for item in objects]
    expected = [f"object_{index}" for index in range(len(objects))]
    assert actual == expected, f"object names: expected {expected}, got {actual}"
    records = [json.dumps(item, sort_keys=True) for item in objects]
    assert len(records) == len(set(records)), "duplicate object record detected"


def validate_full_edit(source, edited, expectations):
    validate_counts(source)
    validate_counts(edited)
    validate_sequential_names(source)
    validate_sequential_names(edited)
    source_objects = panel(source)["single_objects"]
    edited_objects = panel(edited)["single_objects"]
    expected_count = expectations["source_object_count"]
    assert len(source_objects) == expected_count, (
        f"source object count: expected {expected_count}, got {len(source_objects)}"
    )
    assert edited_objects[:expected_count] == source_objects, (
        "existing object prefix changed; full edit must preserve source records exactly"
    )
    additions = edited_objects[expected_count:]
    aliases = [item["alias_text"] for item in additions]
    assert aliases == expectations["added_aliases"], (
        f"added aliases: expected {expectations['added_aliases']}, got {aliases}"
    )
    forbidden = expectations["forbidden_added_alias_terms"]
    assert not any(term.lower() in alias.lower() for alias in aliases for term in forbidden), (
        f"forbidden fixed-speed addition found in aliases {aliases}"
    )
    for item in additions:
        assert item["driver_id"] == "driver_id", f"invented driver_id in {item['name']}"
        assert item["id"] == "driver_id", f"id placeholder changed in {item['name']}"
        assert item["linked"] == "false", f"new object linked in {item['name']}"
        for key in ("unit_id", "unit_ref", "link_name", "link_tag", "sub_group"):
            assert item[key] == "", f"new object {item['name']} has nonblank {key}"


def validate_background_patch(document):
    validate_counts(document)
    data = panel(document)
    for key in ("single_objects", "containers", "graphics"):
        assert data[key] == [], f"background-only patch {key} must be empty"
    assert data.get("image_data"), "background-only patch must contain image_data"
```

Also compare all top-level and nested source fields outside explicitly allowed `counts`, `panel.image_data`, and appended `panel.single_objects`; this catches accidental loss of full-panel metadata. Use a deep copy of both docs, normalize only those allowed fields, then assert equality.

- [ ] **Step 5: Add one in-memory JSON mutation per defect**

Add independent tests:

```python
def test_rejects_duplicate_object_record(self):
    broken = copy.deepcopy(self.edited)
    broken["panel"]["single_objects"].append(
        copy.deepcopy(broken["panel"]["single_objects"][-1])
    )
    broken["counts"]["single_objects"] += 1
    with self.assertRaisesRegex(AssertionError, "object names|duplicate object"):
        validate_full_edit(self.source, broken, self.expectations)


def test_rejects_changed_existing_link_or_position(self):
    for field, replacement in (("driver_id", "invented"), ("unit_id", "OTHER"),
                               ("linked", "true"), ("alias_text", "changed"),
                               ("posLeft", 999)):
        with self.subTest(field=field):
            broken = copy.deepcopy(self.edited)
            broken["panel"]["single_objects"][4][field] = replacement
            with self.assertRaisesRegex(AssertionError, "existing object prefix changed"):
                validate_full_edit(self.source, broken, self.expectations)


def test_rejects_nonsequential_names(self):
    broken = copy.deepcopy(self.edited)
    broken["panel"]["single_objects"][-1]["name"] = "object_11"
    with self.assertRaisesRegex(AssertionError, "object names"):
        validate_full_edit(self.source, broken, self.expectations)


def test_rejects_declared_count_mismatch(self):
    broken = copy.deepcopy(self.edited)
    broken["counts"]["single_objects"] -= 1
    with self.assertRaisesRegex(AssertionError, "counts.single_objects"):
        validate_full_edit(self.source, broken, self.expectations)


def test_rejects_unrequested_vsd_addition(self):
    broken = copy.deepcopy(self.edited)
    broken["panel"]["single_objects"][-1]["alias_text"] = "C4 MT VSD"
    with self.assertRaisesRegex(AssertionError, "added aliases|forbidden"):
        validate_full_edit(self.source, broken, self.expectations)
```

Add a patch mutation proving nonempty `single_objects` is rejected even when count matches.

- [ ] **Step 6: Run JSON tests**

Run:

```bash
python -m unittest iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py -v
```

Expected: all JSON tests pass. No raster tests exist yet.

- [ ] **Step 7: Commit JSON fixture contract**

```bash
git add iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py \
  iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/source-panel.json \
  iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/edited-full-panel.json \
  iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/background-only-patch.json \
  iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/expectations.json
git commit -m "test: add masked Maskin object fixtures"
```

---

### Task 2: Add dependency-free raster and alignment regression checks

**Files:**
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/raster-before.json`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/raster-after.json`
- Modify if coordinates need consistency: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/expectations.json`
- Modify if coordinates need consistency: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/source-panel.json`
- Modify if coordinates need consistency: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank/edited-full-panel.json`

**Interfaces:**
- Consumes: `load_fixture`, `panel`, valid source/full panel fixtures, and `expectations.json` from Task 1.
- Produces: `validate_raster_shape(raster: dict) -> None`
- Produces: `validate_pipe_samples(raster: dict, expectations: dict) -> None`
- Produces: `validate_compressor_pitch(raster: dict, expectations: dict) -> None`
- Produces: `validate_overlay_alignment(raster: dict, edited: dict, expectations: dict) -> None`
- Contract: mutations alter copied in-memory matrices only; committed fixtures remain valid.

- [ ] **Step 1: Add explicit valid before/after RGBA matrices**

Build 96×64 matrices from a neutral `[238, 241, 244, 255]` background. Include:

- untouched control segments for orange, cyan, and vertical branches;
- edited C4 segments using exact same cross-sections;
- all junction pixels needed for uninterrupted orthogonal paths;
- three one-pixel fixture-registration markers at `[24, 58]`, `[48, 58]`, and `[72, 58]` with equal x pitch 24; keep them outside pipe and field pixels so fixture instrumentation cannot overwrite production-like artwork;
- three C4 empty-field anchor markers at expected overlay centers;
- no live number or live state text pixels.

Before raster omits C4 housing/branches/field anchors. After raster adds them without replacing unrelated source pixels. Source alpha remains intact outside intended masks.

- [ ] **Step 2: Write failing raster tests**

```python
class MaskinCompressorBankRasterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raster = load_fixture("raster-after.json")
        cls.edited = load_fixture("edited-full-panel.json")
        cls.expectations = load_fixture("expectations.json")

    def test_valid_raster_keeps_pipe_style_and_continuity(self):
        validate_pipe_samples(self.raster, self.expectations)

    def test_valid_raster_keeps_compressor_pitch(self):
        validate_compressor_pitch(self.raster, self.expectations)

    def test_valid_dynamic_objects_align_with_background_fields(self):
        validate_overlay_alignment(self.raster, self.edited, self.expectations)
```

- [ ] **Step 3: Run raster tests to prove missing validators fail**

Run:

```bash
python -m unittest iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py -v
```

Expected: JSON tests pass; raster tests fail because raster validator names are undefined.

- [ ] **Step 4: Implement matrix, pipe, marker, and overlay helpers**

Use exact pixels, no Pillow:

```python
def validate_raster_shape(raster):
    width = raster["width"]
    height = raster["height"]
    pixels = raster["pixels"]
    assert len(pixels) == height, f"raster rows: expected {height}, got {len(pixels)}"
    for index, row in enumerate(pixels):
        assert len(row) == width, (
            f"raster row {index}: expected width {width}, got {len(row)}"
        )
        for pixel in row:
            assert len(pixel) == 4 and all(
                isinstance(channel, int) and 0 <= channel <= 255 for channel in pixel
            ), f"invalid RGBA pixel {pixel}"


def sample_cross_section(raster, start, length, orientation, offset):
    x, y = start
    if orientation == "horizontal":
        return [raster["pixels"][y + offset][x + step] for step in range(length)]
    return [raster["pixels"][y + step][x + offset] for step in range(length)]


def validate_pipe_samples(raster, expectations):
    validate_raster_shape(raster)
    for pipe in expectations["pipes"]:
        expected_pattern = pipe["cross_section"]
        for offset, expected_pixel in enumerate(expected_pattern):
            control = sample_cross_section(
                raster, pipe["control_start"], pipe["length"],
                pipe["orientation"], offset
            )
            edited = sample_cross_section(
                raster, pipe["edited_start"], pipe["length"],
                pipe["orientation"], offset
            )
            expected_run = [expected_pixel] * pipe["length"]
            assert control == expected_run, f"{pipe['name']} control sample changed"
            assert edited == control, (
                f"{pipe['name']} discontinuity or thickness/alpha mismatch"
            )
```

For pitch, find all pixels matching `compressor_marker_rgba`, group marker x coordinates into connected components, calculate each component bounding-box center, and compare with `compressor_centers`; then compare adjacent x deltas with `compressor_pitch`. For alignment, find exact pixels matching `field_anchor_rgba`, compare them with `overlay_anchors`, and compare each appended object's integer center `(posLeft + posWidth // 2, posTop + posHeight // 2)` with its expected anchor. If even object dimensions produce a half-pixel ambiguity, set fixture positions/sizes so integer-center calculation is exact.

- [ ] **Step 5: Add one in-memory raster mutation per defect**

```python
def test_rejects_pipe_discontinuity(self):
    broken = copy.deepcopy(self.raster)
    x, y = self.expectations["pipes"][0]["edited_start"]
    broken["pixels"][y][x + 5] = [238, 241, 244, 255]
    with self.assertRaisesRegex(AssertionError, "discontinuity"):
        validate_pipe_samples(broken, self.expectations)


def test_rejects_pipe_thickness_or_alpha_mismatch(self):
    broken = copy.deepcopy(self.raster)
    x, y = self.expectations["pipes"][0]["edited_start"]
    broken["pixels"][y][x + 5][3] = 255
    with self.assertRaisesRegex(AssertionError, "thickness/alpha mismatch"):
        validate_pipe_samples(broken, self.expectations)


def test_rejects_compressor_pitch_drift(self):
    broken = copy.deepcopy(self.raster)
    marker = self.expectations["compressor_marker_rgba"]
    # Move every marker pixel belonging to C4 one column right, clearing old pixels.
    move_component_horizontally(broken, marker, center_x=72, delta=1)
    with self.assertRaisesRegex(AssertionError, "compressor centers|compressor pitch"):
        validate_compressor_pitch(broken, self.expectations)


def test_rejects_dynamic_overlay_misalignment(self):
    broken = copy.deepcopy(self.edited)
    broken["panel"]["single_objects"][-2]["posLeft"] += 1
    with self.assertRaisesRegex(AssertionError, "overlay alignment"):
        validate_overlay_alignment(self.raster, broken, self.expectations)
```

Implement `move_component_horizontally` inside test file only. Ensure thickness mutation changes alpha while preserving nonzero color so failure proves exact raster pattern check, not only missing-pixel detection.

- [ ] **Step 6: Run focused regression suite**

Run:

```bash
python -m unittest iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py -v
```

Expected: all valid fixtures pass; all eight requested defect classes are rejected:

1. duplicate object names/records;
2. changed protected existing fields;
3. non-sequential names;
4. count mismatch;
5. pipe discontinuity;
6. pipe thickness/alpha mismatch;
7. compressor pitch drift;
8. dynamic overlay misalignment.

- [ ] **Step 7: Commit raster regression coverage**

```bash
git add iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py \
  iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank
git commit -m "test: validate Maskin raster and overlay alignment"
```

---

### Task 3: Write canonical compressor-bank editing method

**Files:**
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/reference_data/maskin-drawing-method.txt:70-153`

**Interfaces:**
- Consumes: fixture names, aliases, measured vector, and validation behavior from Tasks 1-2.
- Produces: complete normative procedure owned by exact section title.
- Contract: other documents may summarize this section but must not contradict it.

- [ ] **Step 1: Add exact titled section after `4. SYMBOLS, VALUES AND TEXT RULES` and before light/dark variants**

Use exact heading:

```text
5. Editing an existing Maskin compressor bank from an exported panel JSON
----------------------------------------------------------------------------
```

Renumber later sections consistently. Cover, in this order:

1. pre-edit deliverable decision;
2. inspect target column and preserve existing objects;
3. nearest role-matching atomic template;
4. fixed-speed C3 versus VSD-bearing C1;
5. one measured translation vector across compressor symbol, upper/lower branches, status art, labels, empty pills, and dynamic coordinates;
6. background/dynamic layer ownership;
7. alpha-safe compositing and header restoration order;
8. source-specific raster sampling;
9. JSON and rendered QA;
10. restart-from-original rule after failure.

Use normative language. State all three output modes distinctly:

- background-only patch;
- entire/full JSON;
- append semantics of Insert JSON.

- [ ] **Step 2: Add four independent checklists**

Add headings and checkboxes or `[ ]` lines:

```text
PRE-EDIT DECISION CHECKLIST
COMPRESSOR-BANK EDITING CHECKLIST
POST-EDIT JSON INTEGRITY CHECKLIST
POST-EDIT PIXEL/RASTER QA CHECKLIST
```

Required checklist coverage:

- source original retained;
- requested patch/full mode confirmed;
- target column inspected for existing objects;
- sibling role and VSD/fixed-speed status classified;
- exact center-to-center pitch measured;
- one vector recorded and reused;
- layer ownership preserved;
- alpha-safe mask/composite used;
- headers restored from sampled source raster;
- optional objects cloned only on explicit request;
- output reparsed;
- counts checked against all array lengths;
- names checked sequentially;
- exact source/output object diff listed;
- existing `driver_id`, `unit_id`, `linked`, alias, type, and position protected;
- continuity, thickness, alpha, anti-aliasing, junction, pitch checked;
- full panel, zoomed bank, and dynamic overlay rendered.

- [ ] **Step 3: Add masked worked before/after example**

Describe fixture C1/C3/C4 sequence without production IDs:

```text
Before: C1 is MT with status/capacity/VSD/runtime. C3 is nearest fixed-speed MT
sibling with status/capacity/runtime. Measured C3-to-C4 vector is (+24, 0) in
the miniature fixture.

Background-only after: image_data points to raster-after.json; all three object
arrays and counts remain zero.

Full after when parameter boxes were explicitly requested: preserve all seven
source objects exactly; append object_7..object_9 for C4 status, capacity, and
runtime using placeholder driver_id, linked false, blank link/unit fields, and
descriptive aliases. No VSD object is added.
```

Explain 24 pixels belongs only to miniature fixture; production edits remeasure exact pitch. Point to fixture directory and executable test.

- [ ] **Step 4: Add failed-iteration lessons and successful sequence**

Failed lessons must include:

- objects added before checking existing objects;
- patch returned when full JSON requested;
- full JSON returned when populated panel needed only background patch;
- compressor copied without full column;
- wrong sibling cloned;
- opaque crop covered pipes;
- nominal two-pixel line used instead of measured raster;
- background validated without dynamic overlay;
- correctness claimed without exact visual comparison.

Successful sequence must include restart from original export, classify output, clone nearest role match atomically, clone dynamic objects only if requested, use one measured vector, alpha-safe composite, restore exact sampled raster, and validate counts/object diff/raster/overlay.

- [ ] **Step 5: Review canonical method against requested prompt and fixture**

Check exact values and caveat appear:

- orange horizontal header has three sampled rows with alpha `191 / 255 / 64`;
- cyan header has two opaque rows;
- vertical branches have two opaque columns;
- values are worked-example-specific and every source is remeasured;
- visual equality outranks generic line-width assumptions.

- [ ] **Step 6: Commit canonical method**

```bash
git add iwmac-designer-import-export/iwmac-designer-reference/reference_data/maskin-drawing-method.txt
git commit -m "docs: define Maskin compressor-bank editing method"
```

---

### Task 4: Mirror operational contract in AI reference documents

**Files:**
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt:77-128`
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md:338-364`

**Interfaces:**
- Consumes: canonical method and fixture paths from Tasks 1-3.
- Produces: two independently useful summaries with direct canonical links.
- Contract: summaries remain compact but preserve all safety-critical rules.

- [ ] **Step 1: Add compact self-contained block to `AI-BRIEFING.txt`**

Place after existing `MASKIN (MACHINE PICTURE) ARTWORK` block and before `READING THE EXISTING DRAWING`.

Include exact title as a subsection label where format permits. Cover:

- decide background patch versus full JSON before editing;
- Insert appends; full JSON needs empty canvas;
- inspect source target column before adding objects;
- preserve existing objects unless parameter objects explicitly requested;
- C3 fixed-speed clone is status/capacity/runtime only; no VSD from C1;
- placeholder/unlinked field contract;
- atomic column and one measured vector;
- background/object split;
- alpha-safe composite, never opaque crop;
- exact per-source pipe sampling and example-specific alpha/thickness values;
- full JSON/object-diff/raster/full+zoom+overlay QA;
- restart from original after failed iteration;
- canonical method and regression fixture paths.

Do not duplicate full four checklists; point to complete method.

- [ ] **Step 2: Add repository-agent operational section to `CLAUDE.md`**

Place near `## 17b. Generating a panel JSON from a description`, after Maskin reference bullets or before load-bearing contract summary.

Include:

- exact section title;
- output classification warning;
- source-preserving and append-only object contract;
- role-based atomic cloning and C3/C1 example;
- background/dynamic split;
- alpha/raster sampling rules;
- mandatory JSON and rendered overlay QA;
- links to `reference_data/maskin-drawing-method.txt` and `tests/fixtures/maskin-compressor-bank/`;
- command to run `tests/test_maskin_compressor_bank.py`.

Avoid changing surrounding survey facts, host endpoint facts, production counts, or unrelated section numbering.

- [ ] **Step 3: Cross-read all three documents for contradiction**

Search for statements that could imply:

- full import replaces canvas;
- artwork automatically requires new objects;
- all pipes are nominally two pixels;
- example alpha values are universal;
- background-only preview proves overlay alignment.

Fix any contradiction in new text. Do not rewrite unrelated historic text.

- [ ] **Step 4: Run focused text assertions**

Run a short standard-library check:

```bash
python - <<'PY'
from pathlib import Path
root = Path('iwmac-designer-import-export/iwmac-designer-reference')
method = (root / 'reference_data/maskin-drawing-method.txt').read_text(encoding='utf-8')
brief = (root / 'AI-BRIEFING.txt').read_text(encoding='utf-8')
deep = (root / 'CLAUDE.md').read_text(encoding='utf-8')
title = 'Editing an existing Maskin compressor bank from an exported panel JSON'
assert title in method
assert title in brief
assert title in deep
for text in (method, brief, deep):
    assert 'driver_id' in text
    assert 'linked' in text
    assert 'background-only' in text.lower() or 'background only' in text.lower()
    assert 'VSD' in text
print('Maskin documentation contract present')
PY
```

Expected: `Maskin documentation contract present`.

- [ ] **Step 5: Commit AI reference summaries**

```bash
git add iwmac-designer-import-export/iwmac-designer-reference/AI-BRIEFING.txt \
  iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md
git commit -m "docs: teach agents safe Maskin bank edits"
```

---

### Task 5: Clarify README import behavior and complete verification

**Files:**
- Modify: `iwmac-designer-import-export/README.md:13-32`
- Test: `iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py`
- Verify all files listed in File Map.

**Interfaces:**
- Consumes: complete method and stable fixture/test paths.
- Produces: accurate user-facing import warning and final validated change set.

- [ ] **Step 1: Add narrow README warning under import workflow**

Add concise note after step 6 or behavior table:

```markdown
> **Editing an existing Maskin background:** **Insert JSON appends objects.** Use a
> background-only patch with empty object arrays when applying artwork to a populated
> panel. Insert an entire/full export only on an empty canvas unless duplicate objects
> are intentional. See [Editing an existing Maskin compressor bank from an exported
> panel JSON](iwmac-designer-reference/reference_data/maskin-drawing-method.txt) for
> object-preservation, measured-raster, and overlay-QA rules.
```

Keep README change limited to import behavior. Do not alter host internals, release history, fleet counts, or userscript claims.

- [ ] **Step 2: Run focused Maskin regression test**

```bash
python -m unittest iwmac-designer-import-export/iwmac-designer-reference/tests/test_maskin_compressor_bank.py -v
```

Expected: all tests pass.

- [ ] **Step 3: Run complete reference Python test suite**

```bash
python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -p "test_*.py" -v
```

Expected: all tests pass. If an unrelated test requires unavailable external state, report exact skipped/failing test; do not hide failure.

- [ ] **Step 4: Reparse every new JSON fixture and validate matrix dimensions**

```bash
python - <<'PY'
import json
from pathlib import Path
root = Path('iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank')
for path in sorted(root.glob('*.json')):
    value = json.loads(path.read_text(encoding='utf-8'))
    if path.name.startswith('raster-'):
        assert len(value['pixels']) == value['height'], path
        assert all(len(row) == value['width'] for row in value['pixels']), path
    print(path.name)
PY
```

Expected: all seven fixture names print without assertion or JSON error.

- [ ] **Step 5: Scan changed public artifacts for identifying data and forbidden production values**

Inspect only changed files. Search for:

- production plant ID from source artifact;
- source user's name/email;
- customer/store names;
- real driver-ID prefixes;
- `saved_by` values other than literal fixture key and masked value;
- data URLs copied from production.

Allowed: generic text discussing fields `saved_by`, `driver_id`, and `source_plant_id`; `MASKED_PLANT`; literal placeholder `driver_id`; masked fixture alias names.

Run:

```bash
git diff --check
git diff --stat
git status --short
```

Expected: no whitespace errors; only planned files changed.

- [ ] **Step 6: Review exact source/output object diff**

Run standard-library diagnostic:

```bash
python - <<'PY'
import json
from pathlib import Path
root = Path('iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/maskin-compressor-bank')
source = json.loads((root / 'source-panel.json').read_text(encoding='utf-8'))['panel']['single_objects']
edited = json.loads((root / 'edited-full-panel.json').read_text(encoding='utf-8'))['panel']['single_objects']
assert edited[:len(source)] == source
added = edited[len(source):]
assert [item['name'] for item in added] == ['object_7', 'object_8', 'object_9']
assert [item['alias_text'] for item in added] == [
    'C4 MT status', 'C4 MT capacity', 'C4 MT Runtime total'
]
print('changed existing: 0')
print('added:', ', '.join(item['name'] for item in added))
PY
```

Expected:

```text
changed existing: 0
added: object_7, object_8, object_9
```

- [ ] **Step 7: Commit README and any final test/doc consistency fixes**

```bash
git add iwmac-designer-import-export/README.md \
  iwmac-designer-import-export/iwmac-designer-reference
git commit -m "docs: clarify Maskin import deliverables"
```

Do not create an empty commit if prior commits already include all files.

---

## Codex Delegation Boundary

Claude coordinates and verifies; Codex performs multi-file implementation in one bounded thread.

1. Claude commits this plan before delegation.
2. Invoke `mcp__codex__codex` once with:
   - `cwd`: isolated worktree absolute path;
   - `sandbox`: `workspace-write`;
   - `approval-policy`: `never`;
   - prompt: implement Tasks 1-5 from this plan, run stated tests, do not push, do not modify userscript, do not touch files outside File Map, and report changed files/tests.
3. Claude does not edit assigned files while Codex runs.
4. After Codex returns, Claude inspects actual `git diff`, fixture data, and test code rather than trusting summary.
5. If correction needed, use `mcp__codex__codex-reply` with original thread ID. Do not start second Codex chain.
6. Claude runs focused and full test commands independently.
7. Claude performs final privacy scan and independent review before any push.
8. Push/PR remains an outward-facing action. Perform only under explicit current authorization; local commits do not imply push authorization.

## Final Review Gates

- [ ] Exact required heading appears in all three detailed AI/reference documents.
- [ ] Canonical method contains every requested rule, four checklists, worked example, failure lessons, and success sequence.
- [ ] README only changes import behavior.
- [ ] Valid full fixture preserves every source record and appends exactly three fixed-speed C4 objects.
- [ ] Valid background-only patch has all object arrays empty.
- [ ] Regression suite mutates and rejects all eight required defect classes.
- [ ] Pipe checks compare continuity plus exact cross-section color/alpha pattern.
- [ ] Pitch check derives marker centers from raster pixels.
- [ ] Overlay check compares dynamic-object coordinates with background field anchors.
- [ ] All fixture JSON reparses and all RGBA matrix dimensions match declarations.
- [ ] No third-party dependency added.
- [ ] No userscript or `@version` changed.
- [ ] No real plant, driver, user, customer, or production image data committed.
- [ ] `git diff --check` passes.
- [ ] Full reference test discovery passes or any unrelated external-state failure is reported exactly.
- [ ] Final `git status --short` contains only intended work.
