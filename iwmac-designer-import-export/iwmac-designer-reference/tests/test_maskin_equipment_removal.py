"""Removing static equipment and rerouting an existing circuit - the raster half.

Run:
    python -m unittest tests.test_maskin_equipment_removal
from the iwmac-designer-reference directory.

WHY THESE ARE RASTER TESTS.

Every defect below produces a structurally perfect panel document. It parses,
`counts` matches every array length, all 17 fields are present, every `obj_id`
exists in the palette, the z bands are right, and
`validate-maskin-panel.py --profile` reports zero errors. The receiver is still
missing a corner, the canvas is still black, the riser still stops one row short
of the header - because all of that lives in `panel.image_data`, which is a
base64 blob to every JSON check in this repository.

Rules: MASKIN-GENERATION-CONTRACT.md section 17 (`M-A10`-`M-A19`, `M-C06`).
Fixture: build-maskin-removal-fixture.py, whose 96 x 64 miniature is
instrumentation - not Maskin geometry, and never a source of defaults.

ONE DEFECT, ONE INTENDED CHECK. Each negative applies exactly one edit. A single
defect is sometimes visible to more than one check - a clipped receiver is also
a change outside the edit mask - so each test asserts the check that *names* the
defect, which is the one whose message tells a reader what to repair.
"""

import copy
import importlib.util
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "maskin-equipment-removal"


def _load(name, filename):
    """The scripts are hyphenated, so they cannot be imported by name."""
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


qa = _load("maskin_raster_qa", "maskin_raster_qa.py")
builder = _load("build_maskin_removal_fixture", "build-maskin-removal-fixture.py")
validator = _load("validate_maskin_panel", "validate-maskin-panel.py")


def load_fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class RemovalFixtureIsCurrentTest(unittest.TestCase):
    """The committed artefacts are the generator's output, not a hand-edit."""

    def test_every_committed_artefact_matches_its_generator(self):
        stale = [name for name, value in builder.artefacts().items()
                 if builder.serialise(value)
                 != (FIXTURES / name).read_text(encoding="utf-8")]
        self.assertEqual([], stale,
                         "run: python build-maskin-removal-fixture.py")


class GoodEditPassesEveryPixelCheckTest(unittest.TestCase):
    """The delivered edit: equipment gone, circuit rerouted, everything else intact."""

    @classmethod
    def setUpClass(cls):
        cls.before = load_fixture("raster-before.json")
        cls.after = load_fixture("raster-after.json")
        cls.spec = load_fixture("expectations.json")

    def test_requested_component_is_fully_removed(self):
        qa.check_component_removed(self.after, self.spec)

    def test_protected_components_are_byte_identical(self):
        qa.check_protected_regions(self.before, self.after, self.spec)

    def test_background_is_the_requested_colour_at_every_sample_point(self):
        qa.check_background_fill(self.after, self.spec)

    def test_no_cleanup_residue_inside_the_edit_masks(self):
        qa.check_no_cleanup_residue(self.after, self.spec)

    def test_the_non_connected_crossing_carries_a_bypass(self):
        results = qa.check_crossings(self.after, self.spec)
        self.assertEqual(1, len(results))
        self.assertEqual("non-connected", results[0]["kind"])

    def test_repaired_runs_match_the_adjacent_source_cross_section(self):
        qa.check_pipe_profiles(self.after, self.spec)

    def test_every_junction_in_the_ledger_is_continuous(self):
        ledger = qa.check_junctions(self.after, self.spec)
        self.assertEqual(2, len(ledger))
        self.assertTrue(all(row["result"] == "pass" for row in ledger))

    def test_each_circuit_reaches_all_of_its_required_anchors(self):
        qa.check_connectivity(self.after, self.spec)

    def test_the_two_diff_scopes_are_separated_and_nothing_escaped_them(self):
        report = qa.check_diff_scope(self.before, self.after, self.spec)
        self.assertEqual(0, report["unauthorised_pixels_changed"])
        self.assertGreater(report["edit_mask_pixels_changed"], 0)
        self.assertGreater(report["background_conversion_pixels_changed"], 0,
                           "the background conversion must be reported as its own "
                           "scope, not folded into the artwork diff")

    def test_the_manifest_reports_every_check_and_what_it_cannot_decide(self):
        manifest = qa.qa_manifest(self.before, self.after, self.spec)
        self.assertEqual(["pass"] * 9,
                         [check["result"] for check in manifest["checks"]])
        self.assertEqual(2, len(manifest["junction_ledger"]))
        self.assertTrue(manifest["not_decided_here"],
                        "a manifest that lists no limits is claiming semantic "
                        "image validation it does not perform")


class NegativeFixturesTest(unittest.TestCase):
    """Ten single-defect edits, ten intended failures.

    Every one of them is a defect a screenshot round-trip found by eye during
    the 2026-08-11 editing session, and every one of them is invisible to
    `validate-maskin-panel.py`.
    """

    @classmethod
    def setUpClass(cls):
        cls.before = load_fixture("raster-before.json")
        cls.spec = load_fixture("expectations.json")

    def defect(self, name):
        return builder.negative(name)

    def test_receiver_clipped_by_an_oversized_erase_mask(self):
        raster = self.defect("receiver-clipped-by-erase-mask")
        with self.assertRaisesRegex(AssertionError, "receiver vessel"):
            qa.check_protected_regions(self.before, raster, self.spec)

    def test_transparent_background_delivered_black(self):
        raster = self.defect("transparent-background-rendered-black")
        with self.assertRaisesRegex(AssertionError, "not the requested background"):
            qa.check_background_fill(raster, self.spec)

    def test_transparent_pixels_left_unflattened_are_caught_before_they_render(self):
        """The other half of the same rule: transparency is not a colour."""
        raster = copy.deepcopy(load_fixture("raster-after.json"))
        raster["pixels"][60][4] = [0, 0, 0, 0]
        with self.assertRaisesRegex(AssertionError, "fully transparent"):
            qa.check_background_fill(raster, self.spec)

    def test_dark_cleanup_residue_left_on_the_liquid_line(self):
        raster = self.defect("dark-residue-on-liquid-line")
        with self.assertRaisesRegex(AssertionError, "cleanup residue"):
            qa.check_no_cleanup_residue(raster, self.spec)

    def test_repaired_run_redrawn_at_a_guessed_width(self):
        raster = self.defect("inconsistent-pipe-cross-section")
        with self.assertRaisesRegex(AssertionError, "differs from the adjacent source run"):
            qa.check_pipe_profiles(raster, self.spec)

    def test_new_route_crosses_a_circuit_with_no_bypass(self):
        raster = self.defect("missing-bypass-at-crossing")
        with self.assertRaisesRegex(AssertionError, "run straight along their own centreline"):
            qa.check_crossings(raster, self.spec)

    def test_bypass_leg_drawn_at_the_wrong_thickness(self):
        raster = self.defect("bypass-with-inconsistent-thickness")
        with self.assertRaisesRegex(AssertionError, "bypass leg"):
            qa.check_pipe_profiles(raster, self.spec)

    def test_upper_horizontal_to_riser_junction_left_a_gap(self):
        raster = self.defect("upper-junction-gap")
        with self.assertRaisesRegex(AssertionError, "background pixels separate"):
            qa.check_junctions(raster, self.spec)

    def test_riser_to_header_junction_left_a_gap(self):
        raster = self.defect("lower-junction-gap")
        with self.assertRaisesRegex(AssertionError, "background pixels separate"):
            qa.check_junctions(raster, self.spec)

    def test_only_the_antialiasing_rows_touch_at_a_junction(self):
        """Distinct from a plain gap, and repaired differently: the halo bridges
        the join while the opaque cores never meet, so the pipe reads connected
        at a glance and is not."""
        raster = self.defect("only-antialiasing-touches")
        with self.assertRaisesRegex(AssertionError, "only antialiasing pixels touch"):
            qa.check_junctions(raster, self.spec)

    def test_artwork_outside_the_edit_mask_changed(self):
        raster = self.defect("unrelated-artwork-changed")
        with self.assertRaisesRegex(AssertionError, "outside the union of the documented edit masks"):
            qa.check_diff_scope(self.before, raster, self.spec)

    def test_every_negative_is_exactly_one_edit_away_from_the_good_raster(self):
        """The single-defect claim, checked rather than asserted in prose."""
        good = load_fixture("raster-after.json")
        for name in builder.NEGATIVES:
            with self.subTest(negative=name):
                raster = builder.negative(name)
                changed = sum(
                    1
                    for y in range(good["height"])
                    for x in range(good["width"])
                    if good["pixels"][y][x] != raster["pixels"][y][x])
                self.assertGreater(changed, 0, "a negative that changes nothing "
                                                "proves nothing")


class ObjectPreservationTest(unittest.TestCase):
    """The JSON half: an artwork edit must not disturb the object layer.

    `--patch-scope artwork-only` is the scope for an equipment removal delivered
    as a full class-3 document, and `background-only` for the class-4 patch. Both
    say the same thing about the objects and neither can say anything about the
    pixels.
    """

    @classmethod
    def setUpClass(cls):
        cls.rules = validator.load_rules()
        cls.source = load_fixture("source-panel.json")
        cls.full = load_fixture("artwork-only-full-panel.json")
        cls.patch = load_fixture("background-only-patch.json")

    def compare(self, candidate, scope):
        return validator.compare(self.source, candidate, self.rules, [],
                                 patch_scope=scope)

    def errors(self, findings):
        return [finding for finding in findings if finding.severity == "error"]

    def assert_error(self, findings, rule, fragment):
        matches = [finding for finding in self.errors(findings)
                   if finding.rule == rule and fragment.lower() in finding.message.lower()]
        self.assertTrue(matches, f"expected a {rule} error mentioning {fragment!r}; got "
                        + "; ".join(f"{f.rule} {f.severity}: {f.message[:90]}"
                                    for f in findings))

    def test_valid_artwork_only_full_document_reports_no_errors(self):
        findings = self.compare(self.full, "artwork-only")
        self.assertEqual([], self.errors(findings),
                         "; ".join(f.message for f in self.errors(findings)))
        self.assertTrue(any(f.rule == "M-C06" and f.severity == "info"
                            for f in findings),
                        "object preservation must be reported, not assumed")

    def test_valid_background_only_patch_reports_no_errors(self):
        findings = self.compare(self.patch, "background-only")
        self.assertEqual([], self.errors(findings),
                         "; ".join(f.message for f in self.errors(findings)))

    def test_rejects_a_designer_object_changed_during_artwork_only_work(self):
        for field, replacement in (("driver_id", "10229_AK3_AKC_0_60_0_763_1"),
                                   ("unit_id", "000:060"),
                                   ("unit_ref", "REF"),
                                   ("link_name", "iw_param_name"),
                                   ("linked", "true"),
                                   ("posLeft", 12),
                                   ("posTop", 12),
                                   ("posWidth", 9),
                                   ("zIndex", "default")):
            with self.subTest(field=field):
                broken = copy.deepcopy(self.full)
                broken["panel"]["single_objects"][2][field] = replacement
                self.assert_error(self.compare(broken, "artwork-only"),
                                  "M-C06", "changed during an artwork-only edit")

    def test_a_changed_role_key_reads_as_a_lost_role_not_a_field_edit(self):
        """`obj_id`, `alias_text` and `tag_text` ARE the role key, so touching one
        leaves the panel as a dropped role and arrives as a stranger. That is why
        the object-preservation verdict cannot be the only check: it pairs by the
        very fields these edits change."""
        for field, replacement in (("alias_text", "Prec bar"),
                                   ("tag_text", " "),
                                   ("obj_id", "number_v3_white_value_only")):
            with self.subTest(field=field):
                broken = copy.deepcopy(self.full)
                broken["panel"]["single_objects"][2][field] = replacement
                findings = self.compare(broken, "artwork-only")
                self.assert_error(findings, "M-C01", "missing from the candidate")
                self.assert_error(findings, "M-C02", "adds nothing")

    def test_rejects_an_object_dropped_during_artwork_only_work(self):
        broken = copy.deepcopy(self.full)
        del broken["panel"]["single_objects"][3]
        broken["counts"]["single_objects"] -= 1
        self.assert_error(self.compare(broken, "artwork-only"),
                          "M-C01", "missing from the candidate")

    def test_rejects_an_object_added_during_artwork_only_work(self):
        broken = copy.deepcopy(self.full)
        extra = copy.deepcopy(broken["panel"]["single_objects"][2])
        extra["name"] = "object_5"
        extra["alias_text"] = "Prec 2"
        broken["panel"]["single_objects"].append(extra)
        broken["counts"]["single_objects"] += 1
        self.assert_error(self.compare(broken, "artwork-only"),
                          "M-C02", "adds nothing")

    def test_rejects_objects_carried_in_a_background_only_patch(self):
        broken = copy.deepcopy(self.patch)
        broken["panel"]["single_objects"].append(
            copy.deepcopy(self.source["panel"]["single_objects"][0]))
        broken["counts"]["single_objects"] = 1
        self.assert_error(self.compare(broken, "background-only"),
                          "M-C01", "zero counts and three empty arrays")

    def test_rejects_an_artwork_only_delivery_whose_background_never_changed(self):
        broken = copy.deepcopy(self.full)
        broken["panel"]["image_data"] = self.source["panel"]["image_data"]
        self.assert_error(self.compare(broken, "artwork-only"),
                          "M-C05", "byte-identical")

    def test_rejects_a_retained_image_svg_trace(self):
        """The export writes it as AI input; the host deletes it on insert; a
        delivery that carries it is emitting its own reading material."""
        broken = copy.deepcopy(self.full)
        broken["panel"]["image_svg_trace"] = "<svg viewBox='0 0 96 64'></svg>" * 40
        findings = validator.validate(broken, rules=self.rules,
                                      palette=validator.load_palette())
        matches = [f for f in findings
                   if f.rule == "M-S07" and f.severity == "error"]
        self.assertTrue(matches, "image_svg_trace must be an error in authored output; "
                        + "; ".join(f"{f.rule} {f.severity}" for f in findings))


if __name__ == "__main__":
    unittest.main()
