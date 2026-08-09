import copy
import json
import pathlib
import unittest


FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "maskin-compressor-bank"


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


if __name__ == "__main__":
    unittest.main()
