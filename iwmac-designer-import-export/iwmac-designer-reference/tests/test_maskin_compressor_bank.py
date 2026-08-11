import copy
import importlib.util
import json
import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "maskin-compressor-bank"


def _load(name, filename):
    """The scripts are hyphenated, so they cannot be imported by name."""
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


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

    normalized_source = copy.deepcopy(source)
    normalized_edited = copy.deepcopy(edited)
    normalized_edited["counts"] = copy.deepcopy(normalized_source["counts"])
    normalized_edited["panel"]["image_data"] = normalized_source["panel"][
        "image_data"
    ]
    normalized_edited["panel"]["single_objects"] = copy.deepcopy(
        normalized_source["panel"]["single_objects"]
    )
    assert normalized_edited == normalized_source, (
        "full panel metadata changed outside counts, image_data, or appended objects"
    )

    additions = edited_objects[expected_count:]
    aliases = [item["alias_text"] for item in additions]
    assert aliases == expectations["added_aliases"], (
        f"added aliases: expected {expectations['added_aliases']}, got {aliases}"
    )
    forbidden = expectations["forbidden_added_alias_terms"]
    assert not any(
        term.lower() in alias.lower() for alias in aliases for term in forbidden
    ), f"forbidden fixed-speed addition found in aliases {aliases}"
    for item in additions:
        assert item["driver_id"] == "driver_id", (
            f"invented driver_id in {item['name']}"
        )
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


def validate_raster_shape(raster):
    width = raster["width"]
    height = raster["height"]
    pixels = raster["pixels"]
    assert len(pixels) == height, (
        f"raster rows: expected {height}, got {len(pixels)}"
    )
    for index, row in enumerate(pixels):
        assert len(row) == width, (
            f"raster row {index}: expected width {width}, got {len(row)}"
        )
        for pixel in row:
            assert len(pixel) == 4 and all(
                isinstance(channel, int) and 0 <= channel <= 255
                for channel in pixel
            ), f"invalid RGBA pixel {pixel}"


def sample_cross_section(raster, start, length, orientation, offset):
    x, y = start
    if orientation == "horizontal":
        return [
            raster["pixels"][y + offset][x + step] for step in range(length)
        ]
    return [raster["pixels"][y + step][x + offset] for step in range(length)]


def validate_pipe_samples(raster, expectations):
    validate_raster_shape(raster)
    for pipe in expectations["pipes"]:
        expected_pattern = pipe["cross_section"]
        for offset, expected_pixel in enumerate(expected_pattern):
            control = sample_cross_section(
                raster,
                pipe["control_start"],
                pipe["length"],
                pipe["orientation"],
                offset,
            )
            edited = sample_cross_section(
                raster,
                pipe["edited_start"],
                pipe["length"],
                pipe["orientation"],
                offset,
            )
            expected_run = [expected_pixel] * pipe["length"]
            assert control == expected_run, f"{pipe['name']} control sample changed"
            assert edited == control, (
                f"{pipe['name']} discontinuity or thickness/alpha mismatch"
            )


def matching_pixel_components(raster, rgba):
    target = tuple(rgba)
    remaining = {
        (x, y)
        for y, row in enumerate(raster["pixels"])
        for x, pixel in enumerate(row)
        if tuple(pixel) == target
    }
    components = []
    while remaining:
        seed = remaining.pop()
        component = {seed}
        pending = [seed]
        while pending:
            x, y = pending.pop()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    component.add(neighbor)
                    pending.append(neighbor)
        components.append(component)
    return components


def component_center(component):
    xs = [point[0] for point in component]
    ys = [point[1] for point in component]
    return [(min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2]


def validate_compressor_pitch(raster, expectations):
    validate_raster_shape(raster)
    components = matching_pixel_components(
        raster, expectations["compressor_marker_rgba"]
    )
    actual_centers = sorted(component_center(component) for component in components)
    expected_centers = expectations["compressor_centers"]
    assert actual_centers == expected_centers, (
        f"compressor centers: expected {expected_centers}, got {actual_centers}"
    )
    actual_pitches = [
        right[0] - left[0]
        for left, right in zip(actual_centers, actual_centers[1:])
    ]
    expected_pitch = expectations["compressor_pitch"]
    assert actual_pitches == [expected_pitch] * (len(actual_centers) - 1), (
        f"compressor pitch: expected {expected_pitch}, got {actual_pitches}"
    )
    translation = expectations["translation"]
    actual_vector = [
        actual_centers[-1][0] - actual_centers[-2][0],
        actual_centers[-1][1] - actual_centers[-2][1],
    ]
    expected_vector = [translation["dx"], translation["dy"]]
    assert actual_vector == expected_vector, (
        f"compressor translation: expected {expected_vector}, got {actual_vector}"
    )


def validate_overlay_alignment(raster, edited, expectations):
    validate_raster_shape(raster)
    actual_anchors = sorted(
        [list(point) for component in matching_pixel_components(
            raster, expectations["field_anchor_rgba"]
        ) for point in component]
    )
    expected_by_alias = expectations["overlay_anchors"]
    expected_anchors = sorted(expected_by_alias.values())
    assert actual_anchors == expected_anchors, (
        f"field anchors: expected {expected_anchors}, got {actual_anchors}"
    )

    additions = panel(edited)["single_objects"][expectations["source_object_count"] :]
    objects_by_alias = {item["alias_text"]: item for item in additions}
    for alias, expected_anchor in expected_by_alias.items():
        assert alias in objects_by_alias, f"overlay alignment missing object {alias}"
        item = objects_by_alias[alias]
        actual_center = [
            item["posLeft"] + item["posWidth"] // 2,
            item["posTop"] + item["posHeight"] // 2,
        ]
        assert actual_center == expected_anchor, (
            f"overlay alignment for {alias}: expected {expected_anchor}, "
            f"got {actual_center}"
        )

    source_pattern = panel(edited)["single_objects"][
        expectations["source_object_count"] - len(additions) :
        expectations["source_object_count"]
    ]
    translation = expectations["translation"]
    for source_item, added_item in zip(source_pattern, additions):
        actual_vector = [
            added_item["posLeft"] - source_item["posLeft"],
            added_item["posTop"] - source_item["posTop"],
        ]
        expected_vector = [translation["dx"], translation["dy"]]
        assert actual_vector == expected_vector, (
            f"overlay alignment translation for {added_item['alias_text']}: "
            f"expected {expected_vector}, got {actual_vector}"
        )
        for key in ("obj_id", "posWidth", "posHeight"):
            assert added_item[key] == source_item[key], (
                f"overlay alignment role mismatch for {added_item['alias_text']}: "
                f"{key} expected {source_item[key]}, got {added_item[key]}"
            )


def clone_pairs(raster, expectations, before=None):
    """Every declared source-column pixel with the pixel the clone put at +vector.

    `before` defaults to the same raster: the source column is expected to be
    untouched by the edit, so the after image carries both halves.
    """
    source = before if before is not None else raster
    dx = expectations["translation"]["dx"]
    dy = expectations["translation"]["dy"]
    additive = [tuple(rgba) for rgba in expectations.get("clone_additive_rgba", [])]
    for region in expectations["clone_source_regions"]:
        for y in range(region["y"], region["y"] + region["height"]):
            for x in range(region["x"], region["x"] + region["width"]):
                src = source["pixels"][y][x]
                dst = raster["pixels"][y + dy][x + dx]
                if tuple(dst) in additive:
                    continue
                yield region["name"], (x, y), src, dst


def validate_clone_is_verbatim(raster, expectations, before=None):
    """M-A02 and M-A04: the clone reproduces the source pixel for pixel.

    One check catches the whole family, because every one of them shows up as a
    destination pixel that is not byte-identical to its source pixel: a soft
    mask that MULTIPLIES the source alpha, a two-row copy of a three-row
    antialiased line, a recoloured pipe, a shifted centreline. The failure
    message names which one, because the repair differs: a faded clone is
    redrawn with a binary mask, a thinned one is remeasured.
    """
    validate_raster_shape(raster)
    background = tuple(expectations["background_rgba"])
    faded, dropped, other = [], [], []
    for name, point, src, dst in clone_pairs(raster, expectations, before):
        if src == dst:
            continue
        if src[:3] == dst[:3] and src[3] != dst[3]:
            faded.append((name, point, src[3], dst[3]))
        elif tuple(src) != background and tuple(dst) == background:
            dropped.append((name, point, src))
        else:
            other.append((name, point, src, dst))

    if faded:
        ratios = {round(dst / src, 3) for _, _, src, dst in faded if src}
        uniform = (
            " The scaling is uniform across the region, which is the tell: a soft, "
            "feathered or opacity-scaled mask multiplied the source alpha instead of "
            "copying it, so the compressor, its pipes, its labels and its pills all "
            "come out faded together. A mask is BINARY."
            if len(ratios) == 1 else ""
        )
        raise AssertionError(
            f"clone alpha multiplied on {len(faded)} pixel(s); first "
            f"{faded[0][0]} at {faded[0][1]}: source alpha {faded[0][2]} -> "
            f"{faded[0][3]}.{uniform}"
        )
    if dropped:
        raise AssertionError(
            f"clone dropped {len(dropped)} source pixel(s); first {dropped[0][0]} at "
            f"{dropped[0][1]} carried {dropped[0][2]} and the clone left background "
            f"there. A line that looks 2 px wide is often 3 rows, the outer ones "
            f"partially transparent: reproduce EVERY row the source has, or the copy "
            f"comes out thinner and harder-edged than the original"
        )
    if other:
        raise AssertionError(
            f"clone differs from its source on {len(other)} pixel(s); first "
            f"{other[0][0]} at {other[0][1]}: {other[0][2]} -> {other[0][3]}"
        )


def validate_headers_measured_independently(raster, expectations):
    """M-A03: each header is measured from itself, never from the other one.

    The discharge and suction headers of one panel legitimately differ in
    thickness and alpha profile. The defect this catches is the plausible one:
    measuring the header you extended first and reusing its cross-section for
    the second, which produces a suction line that is visibly the wrong weight
    and matches nothing on the panel.
    """
    validate_raster_shape(raster)
    headers = [pipe for pipe in expectations["pipes"] if pipe["orientation"] == "horizontal"]
    assert len(headers) >= 2, "fixture must carry two independently measured headers"
    profiles = {pipe["name"]: pipe["cross_section"] for pipe in headers}
    distinct = {json.dumps(profile) for profile in profiles.values()}
    assert len(distinct) == len(profiles), (
        f"two headers share one cross-section {profiles}; this fixture exists to "
        f"prove they are measured separately"
    )
    for pipe in headers:
        rows = len(pipe["cross_section"])
        x, y = pipe["edited_start"]
        after = raster["pixels"][y + rows][x]
        assert tuple(after) == tuple(expectations["background_rgba"]), (
            f"{pipe['name']} extension is {rows + 1} or more rows deep at x={x}; its "
            f"own source measures {rows}. Header weight is per-source, never carried "
            f"over from the other header"
        )


def raster_translation_vector(raster, expectations):
    components = matching_pixel_components(raster, expectations["compressor_marker_rgba"])
    centers = sorted(component_center(component) for component in components)
    assert len(centers) >= 2, "need at least two compressor markers to measure a vector"
    return [centers[-1][0] - centers[-2][0], centers[-1][1] - centers[-2][1]]


def object_translation_vector(edited, expectations):
    objects = panel(edited)["single_objects"]
    count = expectations["source_object_count"]
    additions = objects[count:]
    pattern = objects[count - len(additions) : count]
    vectors = {
        (added["posLeft"] - source["posLeft"], added["posTop"] - source["posTop"])
        for source, added in zip(pattern, additions)
    }
    assert len(vectors) == 1, (
        f"the added objects do not share one translation vector: {sorted(vectors)}. "
        f"Every member of the cluster moves by the same vector or the cluster is "
        f"no longer a cluster"
    )
    return list(vectors.pop())


def validate_single_translation_vector(raster, edited, expectations):
    """M-A01: ONE measured vector, applied to both layers.

    The artwork and the objects are drawn by different tools in different steps,
    and each one on its own can look right: the background renders, the objects
    render, and the pills sit one pixel off the pills drawn for them. Nothing in
    either layer can see that alone - only comparing the two vectors can.
    """
    raster_vector = raster_translation_vector(raster, expectations)
    object_vector = object_translation_vector(edited, expectations)
    assert raster_vector == object_vector, (
        f"two translation vectors: the background moved the compressor column by "
        f"{raster_vector} and the dynamic objects moved by {object_vector}. The "
        f"compressor artwork, both pipe branches, the status artwork, the labels, "
        f"the empty pills and the objects take ONE measured vector"
    )
    declared = [expectations["translation"]["dx"], expectations["translation"]["dy"]]
    assert raster_vector == declared, (
        f"measured vector {raster_vector} is not the declared vector {declared}"
    )


def validate_artwork_precedes_objects(raster, edited, expectations):
    """M-A06: no object may be placed where the background draws no anchor.

    An object over absent artwork is well-formed to every JSON check there is -
    correct field count, legal obj_id, sequential name, plausible coordinates -
    and renders as a status strip floating over nothing and a value pill on
    white. The artwork is extended FIRST; this is what proves it was.
    """
    validate_raster_shape(raster)
    anchor = tuple(expectations["field_anchor_rgba"])
    additions = panel(edited)["single_objects"][expectations["source_object_count"] :]
    for item in additions:
        x = item["posLeft"] + item["posWidth"] // 2
        y = item["posTop"] + item["posHeight"] // 2
        assert 0 <= x < raster["width"] and 0 <= y < raster["height"], (
            f"{item['alias_text']} centre ({x},{y}) is outside the background"
        )
        actual = tuple(raster["pixels"][y][x])
        assert actual == anchor, (
            f"no background anchor under {item['alias_text']} at ({x},{y}): the "
            f"artwork there is {actual}. The object was placed before the artwork "
            f"that draws it existed"
        )


def validate_alias_gap_report(edited, expectations):
    """M-A08 and M-A09: every object carries an alias, and the gap is reported.

    An unknown plant parameter is not a reason to ship alias_text "". The alias
    is the relink key, so an object without one can never be linked by anyone.
    The role's grammar alias goes on the object, the object ships unlinked, and
    the parameter that could not be resolved is REPORTED - not invented from the
    group anatomy, which suggests the continuation without evidencing it.
    """
    grammar = re.compile(expectations["alias_grammar"])
    resolved = set(expectations["link_map_resolved_aliases"])
    additions = panel(edited)["single_objects"][expectations["source_object_count"] :]

    for item in additions:
        alias = item.get("alias_text") or ""
        assert alias.strip(), (
            f"{item['name']} carries an empty alias_text. On Maskin the alias IS the "
            f"parameter name and the only relink key: an object added without one can "
            f"never be linked, by anyone, ever"
        )
        assert grammar.match(alias), (
            f"alias {alias!r} does not follow the role grammar "
            f"{expectations['alias_grammar']}"
        )

    unresolved = [item["alias_text"] for item in additions
                  if item["alias_text"] not in resolved]
    assert unresolved == expectations["unresolved_aliases"], (
        f"link-map gap report: expected {expectations['unresolved_aliases']}, got "
        f"{unresolved}. Every alias the canonical map does not resolve is reported "
        f"as an unresolved linking gap and left open until the plant's own parameter "
        f"dump is supplied"
    )
    for item in additions:
        if item["alias_text"] in expectations["unresolved_aliases"]:
            assert item["linked"] == "false" and item["driver_id"] == "driver_id", (
                f"{item['alias_text']} is not in the canonical link map and yet ships "
                f"linked; a driver id that resolves nothing looks linked and is not"
            )


def multiply_region_alpha(raster, expectations, factor):
    dx = expectations["translation"]["dx"]
    dy = expectations["translation"]["dy"]
    background = tuple(expectations["background_rgba"])
    for region in expectations["clone_source_regions"]:
        for y in range(region["y"], region["y"] + region["height"]):
            for x in range(region["x"], region["x"] + region["width"]):
                pixel = raster["pixels"][y + dy][x + dx]
                if tuple(pixel) == background:
                    continue
                pixel[3] = int(round(pixel[3] * factor))


def move_component_horizontally(raster, rgba, center_x, delta):
    components = matching_pixel_components(raster, rgba)
    matches = [
        component
        for component in components
        if component_center(component)[0] == center_x
    ]
    assert len(matches) == 1, (
        f"marker component at x={center_x}: expected 1, got {len(matches)}"
    )
    component = matches[0]
    for x, y in component:
        raster["pixels"][y][x] = [238, 241, 244, 255]
    for x, y in component:
        raster["pixels"][y][x + delta] = list(rgba)


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

    def test_rejects_duplicate_object_record(self):
        broken = copy.deepcopy(self.edited)
        broken["panel"]["single_objects"].append(
            copy.deepcopy(broken["panel"]["single_objects"][-1])
        )
        broken["counts"]["single_objects"] += 1
        with self.assertRaisesRegex(AssertionError, "object names|duplicate object"):
            validate_full_edit(self.source, broken, self.expectations)

    def test_rejects_changed_existing_link_or_position(self):
        for field, replacement in (
            ("driver_id", "invented"),
            ("unit_id", "OTHER"),
            ("linked", "true"),
            ("alias_text", "changed"),
            ("posLeft", 999),
        ):
            with self.subTest(field=field):
                broken = copy.deepcopy(self.edited)
                broken["panel"]["single_objects"][4][field] = replacement
                with self.assertRaisesRegex(
                    AssertionError, "existing object prefix changed"
                ):
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

    def test_rejects_background_patch_with_objects_even_when_count_matches(self):
        broken = copy.deepcopy(self.patch)
        broken["panel"]["single_objects"].append(
            copy.deepcopy(self.source["panel"]["single_objects"][0])
        )
        broken["counts"]["single_objects"] = 1
        with self.assertRaisesRegex(AssertionError, "single_objects must be empty"):
            validate_background_patch(broken)


class MaskinCompressorBankRasterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = load_fixture("raster-before.json")
        cls.raster = load_fixture("raster-after.json")
        cls.edited = load_fixture("edited-full-panel.json")
        cls.expectations = load_fixture("expectations.json")

    def test_valid_raster_keeps_pipe_style_and_continuity(self):
        validate_pipe_samples(self.raster, self.expectations)

    def test_valid_raster_keeps_compressor_pitch(self):
        validate_compressor_pitch(self.raster, self.expectations)

    def test_valid_dynamic_objects_align_with_background_fields(self):
        validate_overlay_alignment(self.raster, self.edited, self.expectations)

    def test_after_raster_changes_only_declared_masked_features(self):
        validate_raster_shape(self.before)
        changed = {
            (x, y)
            for y in range(self.raster["height"])
            for x in range(self.raster["width"])
            if self.before["pixels"][y][x] != self.raster["pixels"][y][x]
        }
        expected = {
            (x, y) for y in range(8, 11) for x in range(56, 73)
        }
        expected.update((x, y) for y in range(9, 11) for x in range(73, 76))
        expected.update((x, y) for y in range(11, 48) for x in range(74, 76))
        expected.update((x, y) for y in range(48, 50) for x in range(56, 73))
        expected.update((x, y) for y in (54, 56) for x in range(70, 75))
        expected.update((x, y) for y in range(54, 57) for x in (70, 74))
        expected.add((72, 58))
        expected.update(tuple(anchor) for anchor in self.expectations["overlay_anchors"].values())
        self.assertEqual(
            changed,
            expected,
            "raster-after must preserve every pixel outside the declared feature mask",
        )

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
        move_component_horizontally(broken, marker, center_x=72, delta=1)
        with self.assertRaisesRegex(
            AssertionError, "compressor centers|compressor pitch"
        ):
            validate_compressor_pitch(broken, self.expectations)

    def test_rejects_dynamic_overlay_misalignment(self):
        broken = copy.deepcopy(self.edited)
        broken["panel"]["single_objects"][-2]["posLeft"] += 1
        with self.assertRaisesRegex(AssertionError, "overlay alignment"):
            validate_overlay_alignment(self.raster, broken, self.expectations)


class MaskinCompressorBankArtworkTests(unittest.TestCase):
    """The M-A* rules: the raster half, which no JSON check can see.

    Each of the seven documented failures of 2026-08-11 gets the test that would
    have caught it. They are raster tests because the defect is in the pixels:
    a panel can pass validate-maskin-panel.py with zero errors, insert cleanly,
    and still show a faded compressor hanging off a broken pipe.
    """

    @classmethod
    def setUpClass(cls):
        cls.before = load_fixture("raster-before.json")
        cls.raster = load_fixture("raster-after.json")
        cls.edited = load_fixture("edited-full-panel.json")
        cls.expectations = load_fixture("expectations.json")

    def test_valid_clone_reproduces_the_source_column_verbatim(self):
        validate_clone_is_verbatim(self.raster, self.expectations)
        validate_clone_is_verbatim(self.raster, self.expectations, before=self.before)

    def test_rejects_alpha_multiplied_by_a_soft_mask(self):
        broken = copy.deepcopy(self.raster)
        multiply_region_alpha(broken, self.expectations, 0.6)
        with self.assertRaisesRegex(AssertionError, "alpha multiplied"):
            validate_clone_is_verbatim(broken, self.expectations, before=self.before)

    def test_alpha_multiplication_message_names_the_uniform_scaling_tell(self):
        broken = copy.deepcopy(self.raster)
        multiply_region_alpha(broken, self.expectations, 0.5)
        with self.assertRaisesRegex(AssertionError, "mask is BINARY"):
            validate_clone_is_verbatim(broken, self.expectations, before=self.before)

    def test_rejects_dropped_antialiasing_row(self):
        broken = copy.deepcopy(self.raster)
        region = self.expectations["clone_source_regions"][0]
        dx = self.expectations["translation"]["dx"]
        y = region["y"] + 1
        for x in range(region["x"], region["x"] + region["width"]):
            if broken["pixels"][y][x + dx] != self.expectations["background_rgba"]:
                broken["pixels"][y][x + dx] = list(self.expectations["background_rgba"])
        with self.assertRaisesRegex(AssertionError, "clone dropped"):
            validate_clone_is_verbatim(broken, self.expectations, before=self.before)

    def test_rejects_recoloured_clone(self):
        broken = copy.deepcopy(self.raster)
        region = self.expectations["clone_source_regions"][1]
        dx = self.expectations["translation"]["dx"]
        broken["pixels"][region["y"] + 1][region["x"] + dx] = [1, 2, 3, 255]
        with self.assertRaisesRegex(AssertionError, "clone differs from its source"):
            validate_clone_is_verbatim(broken, self.expectations, before=self.before)

    def test_valid_headers_are_measured_independently(self):
        validate_headers_measured_independently(self.raster, self.expectations)

    def test_rejects_suction_header_drawn_at_the_discharge_weight(self):
        broken = copy.deepcopy(self.raster)
        cyan = next(pipe for pipe in self.expectations["pipes"]
                    if pipe["name"] == "cyan header")
        rows = len(cyan["cross_section"])
        x, y = cyan["edited_start"]
        for step in range(cyan["length"]):
            broken["pixels"][y + rows][x + step] = list(cyan["cross_section"][0])
        with self.assertRaisesRegex(AssertionError, "Header weight is per-source"):
            validate_headers_measured_independently(broken, self.expectations)

    def test_rejects_two_headers_sharing_one_measured_cross_section(self):
        broken = copy.deepcopy(self.expectations)
        broken["pipes"][1]["cross_section"] = copy.deepcopy(
            broken["pipes"][0]["cross_section"]
        )
        with self.assertRaisesRegex(AssertionError, "share one cross-section"):
            validate_headers_measured_independently(self.raster, broken)

    def test_valid_artwork_and_objects_share_one_translation_vector(self):
        validate_single_translation_vector(self.raster, self.edited, self.expectations)

    def test_rejects_objects_moved_by_a_second_vector(self):
        broken = copy.deepcopy(self.edited)
        for item in broken["panel"]["single_objects"][
            self.expectations["source_object_count"] :
        ]:
            item["posLeft"] += 1
        with self.assertRaisesRegex(AssertionError, "two translation vectors"):
            validate_single_translation_vector(self.raster, broken, self.expectations)

    def test_rejects_cluster_members_that_do_not_move_together(self):
        broken = copy.deepcopy(self.edited)
        broken["panel"]["single_objects"][-1]["posTop"] += 3
        with self.assertRaisesRegex(
            AssertionError, "do not share one translation vector"
        ):
            validate_single_translation_vector(self.raster, broken, self.expectations)

    def test_valid_every_added_object_sits_on_drawn_artwork(self):
        validate_artwork_precedes_objects(self.raster, self.edited, self.expectations)

    def test_rejects_object_placed_before_its_artwork_exists(self):
        broken = copy.deepcopy(self.raster)
        anchor = self.expectations["overlay_anchors"]["C4 MT capacity"]
        broken["pixels"][anchor[1]][anchor[0]] = list(
            self.expectations["background_rgba"]
        )
        with self.assertRaisesRegex(AssertionError, "no background anchor under"):
            validate_artwork_precedes_objects(broken, self.edited, self.expectations)

    def test_rejects_whole_column_of_objects_over_the_unedited_background(self):
        with self.assertRaisesRegex(AssertionError, "no background anchor under"):
            validate_artwork_precedes_objects(
                self.before, self.edited, self.expectations
            )


class MaskinCompressorBankAliasGapTests(unittest.TestCase):
    """M-A08 and M-A09: the alias is always emitted, the gap is always reported."""

    @classmethod
    def setUpClass(cls):
        cls.edited = load_fixture("edited-full-panel.json")
        cls.expectations = load_fixture("expectations.json")

    def test_valid_additions_carry_grammar_aliases_and_report_the_gap(self):
        validate_alias_gap_report(self.edited, self.expectations)

    def test_rejects_empty_alias_on_an_unresolvable_parameter(self):
        broken = copy.deepcopy(self.edited)
        broken["panel"]["single_objects"][-1]["alias_text"] = ""
        with self.assertRaisesRegex(AssertionError, "empty alias_text"):
            validate_alias_gap_report(broken, self.expectations)

    def test_rejects_alias_outside_the_role_grammar(self):
        broken = copy.deepcopy(self.edited)
        broken["panel"]["single_objects"][-1]["alias_text"] = "Runtime total 4"
        with self.assertRaisesRegex(AssertionError, "role grammar"):
            validate_alias_gap_report(broken, self.expectations)

    def test_rejects_invented_binding_for_an_unresolved_alias(self):
        broken = copy.deepcopy(self.edited)
        item = broken["panel"]["single_objects"][-1]
        item["driver_id"] = "10229_AK3_AKC_0_11_1_0_299"
        item["linked"] = "true"
        with self.assertRaisesRegex(AssertionError, "ships\\s+linked"):
            validate_alias_gap_report(broken, self.expectations)

    def test_rejects_gap_report_that_claims_an_unresolved_alias_is_resolved(self):
        broken = copy.deepcopy(self.expectations)
        broken["link_map_resolved_aliases"] = (
            broken["link_map_resolved_aliases"] + ["C4 MT capacity"]
        )
        with self.assertRaisesRegex(AssertionError, "link-map gap report"):
            validate_alias_gap_report(self.edited, broken)


class MaskinCompressorBankCompareTests(unittest.TestCase):
    """validate-maskin-panel.py --compare, exercised through its own module.

    Compare mode is the only thing in the kit that can see "I changed only what
    you asked for". The single-document checks judge the candidate alone, so
    every claim of that form is unproven until this runs.
    """

    @classmethod
    def setUpClass(cls):
        cls.validator = _load("validate_maskin_panel", "validate-maskin-panel.py")
        cls.rules = cls.validator.load_rules()
        cls.source = load_fixture("source-panel.json")
        cls.edited = load_fixture("edited-full-panel.json")
        cls.patch = load_fixture("background-only-patch.json")

    def compare(self, candidate, scope="compressor-addition", source=None):
        return self.validator.compare(
            source if source is not None else self.source,
            candidate,
            self.rules,
            [],
            patch_scope=scope,
        )

    def errors(self, findings):
        return [f for f in findings if f.severity == "error"]

    def assert_error(self, findings, rule, fragment):
        matches = [f for f in self.errors(findings)
                   if f.rule == rule and fragment.lower() in f.message.lower()]
        self.assertTrue(
            matches,
            f"expected a {rule} error mentioning {fragment!r}; got "
            + "; ".join(f"{f.rule} {f.severity}: {f.message[:90]}" for f in findings),
        )

    def test_valid_compressor_addition_reports_no_errors(self):
        findings = self.compare(self.edited)
        self.assertEqual(
            [], self.errors(findings),
            "; ".join(f.message for f in self.errors(findings)),
        )
        self.assertTrue(
            any(f.rule == "M-C00" and "3 added" in f.message for f in findings),
            "compare must report the added count it matched by role",
        )

    def test_valid_background_only_patch_reports_no_errors(self):
        findings = self.compare(self.patch, scope="background-only")
        self.assertEqual(
            [], self.errors(findings),
            "; ".join(f.message for f in self.errors(findings)),
        )

    def test_rejects_added_object_with_an_empty_alias(self):
        broken = copy.deepcopy(self.edited)
        broken["panel"]["single_objects"][-1]["alias_text"] = ""
        self.assert_error(self.compare(broken), "M-C02", "empty alias_text")

    def test_rejects_objects_added_over_an_unchanged_background(self):
        broken = copy.deepcopy(self.edited)
        broken["panel"]["image_data"] = self.source["panel"]["image_data"]
        self.assert_error(self.compare(broken), "M-C05", "byte-identical")

    def add_row(self, document, alias):
        candidate = copy.deepcopy(document)
        objects = candidate["panel"]["single_objects"]
        extra = copy.deepcopy(objects[-1])
        extra["name"] = f"object_{len(objects)}"
        extra["alias_text"] = alias
        objects.append(extra)
        candidate["counts"]["single_objects"] += 1
        return candidate

    def test_rejects_new_column_carrying_a_vsd_no_existing_compressor_has(self):
        """The row was imported from the clone source, not measured from the
        machine. C4 was cloned from fixed-speed C3, so a VSD row on it is a
        property of the column that was copied, never of the compressor."""
        broken = self.add_row(self.edited, "C4 MT VSD 1 speed")
        self.assert_error(self.compare(broken), "M-C03", "evidence decides")

    def test_rejects_added_row_whose_alias_is_not_in_the_role_grammar(self):
        broken = self.add_row(self.edited, "C4 MT VSD")
        self.assert_error(self.compare(broken), "M-C02", "not compressor rows")

    def test_rejects_out_of_scope_field_change_on_a_pre_existing_object(self):
        for field, replacement in (("posLeft", 999), ("zIndex", "default")):
            with self.subTest(field=field):
                broken = copy.deepcopy(self.edited)
                broken["panel"]["single_objects"][5][field] = replacement
                self.assert_error(self.compare(broken), "M-C04", "escaped it")

    def test_renamed_alias_reads_as_a_dropped_role_not_a_field_edit(self):
        """Why "never rename an alias" is a rule and not a preference: the role
        key is (obj_id, alias_text, tag_text), so a renamed object cannot be
        paired with the one it used to be. It leaves the panel as a lost role
        and arrives as a stranger, and no field-level check ever sees the edit."""
        broken = copy.deepcopy(self.edited)
        broken["panel"]["single_objects"][5]["alias_text"] = "C3 MT capacity "
        findings = self.compare(broken)
        self.assert_error(findings, "M-C01", "missing from the candidate")
        self.assertFalse(
            [f for f in self.errors(findings) if f.rule == "M-C04"],
            "a rename is invisible to the field-level scope check by construction",
        )

    def test_rejects_dropped_source_object(self):
        broken = copy.deepcopy(self.edited)
        del broken["panel"]["single_objects"][6]
        broken["counts"]["single_objects"] -= 1
        for index, item in enumerate(broken["panel"]["single_objects"]):
            item["name"] = f"object_{index}"
        findings = self.compare(broken)
        self.assertTrue(
            self.errors(findings),
            "dropping a source role must be an error, not a silent renumbering",
        )

    def test_rejects_unknown_patch_scope(self):
        findings = self.compare(self.edited, scope="artwork")
        self.assert_error(findings, "M-C04", "unknown --patch-scope")


if __name__ == "__main__":
    unittest.main()
