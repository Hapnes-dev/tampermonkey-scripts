"""Contract tests for the GLOBAL visual-correctness rules (VC-*).

    cd iwmac-designer-reference
    python -m unittest tests.test_visual_correctness -v

(`python -m unittest discover -s tests` does not work here: tests/ has no
__init__.py. Run the modules by name, as the other suites in this directory
do.)

Every test but the baselines is a mutation test: it takes the committed
synthetic demo fixture, breaks exactly one visual rule, and asserts the
validator reports it with the right rule id and severity. The rules under test
are VISUAL-CORRECTNESS-CONTRACT.md SS2 (analysis block), SS3 (objects never
cover text; deliberate-overlap proof), SS4/SS5 (width from allowed values).

The suite exists because structurally valid panels have repeatedly been
visually wrong: text covered by live objects, and value objects sized to the
one value currently shown instead of the longest allowed display value.
"""

import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "reference_data" / "visual-correctness-demo.json"
VALUES = ROOT / "reference_data" / "visual-correctness-allowed-values.json"


def _load(name, filename):
    """The scripts are hyphenated, so they cannot be imported by name."""
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = _load("validate_visual_correctness", "validate-visual-correctness.py")


def load_fixture():
    with open(FIXTURE, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_values():
    with open(VALUES, "r", encoding="utf-8") as handle:
        return json.load(handle)


def panel_of(document):
    return validator.extract_panel(document)


def rules_of(findings, severity=None):
    return [f.rule for f in findings
            if severity is None or f.severity == severity]


def complete_analysis():
    return {key: "stated" for key in validator.ANALYSIS_KEYS}


class FixtureBaseline(unittest.TestCase):

    def test_committed_fixture_is_clean(self):
        findings = validator.run(panel_of(load_fixture()))
        self.assertEqual([], [f.as_dict() for f in findings])

    def test_fixture_is_clean_with_its_allowed_values_map(self):
        findings = validator.run(panel_of(load_fixture()),
                                 allowed_values=load_values())
        self.assertEqual([], [f.as_dict() for f in findings])

    def test_fixture_counts_match_arrays(self):
        document = load_fixture()["envelope"]
        self.assertEqual(document["counts"]["single_objects"],
                         len(document["panel"]["single_objects"]))


class TextProtection(unittest.TestCase):
    """VC-T01/VC-T02/VC-T03 - contract SS3."""

    def mutated(self, index, **fields):
        document = load_fixture()
        obj = document["envelope"]["panel"]["single_objects"][index]
        obj.update({key: str(value) for key, value in fields.items()})
        return panel_of(document)

    def test_value_moved_onto_label_is_an_error(self):
        panel = self.mutated(1, posLeft=110, posTop=100)
        findings = validator.run(panel)
        self.assertIn("VC-T01", rules_of(findings, "error"))

    def test_icon_moved_onto_label_is_an_error(self):
        panel = self.mutated(2, posLeft=150, posTop=96)
        findings = validator.run(panel)
        self.assertIn("VC-T01", rules_of(findings, "error"))

    def test_the_error_names_the_covered_text(self):
        panel = self.mutated(1, posLeft=110)
        findings = validator.run(panel)
        errors = [f for f in findings if f.rule == "VC-T01"]
        self.assertTrue(errors)
        self.assertIn("Room temperature", errors[0].message)

    def test_one_pixel_of_overlap_is_still_an_error(self):
        # Label A ends at x 220; a value starting at 219 overlaps by 1 px.
        panel = self.mutated(1, posLeft=219)
        findings = validator.run(panel)
        self.assertIn("VC-T01", rules_of(findings, "error"))

    def test_edge_adjacency_is_not_an_overlap(self):
        # Label A ends at x 220; a value starting exactly there touches, and
        # touching is not covering.
        panel = self.mutated(1, posLeft=220)
        findings = validator.run(panel)
        self.assertEqual([], rules_of(findings))

    def test_blank_label_is_not_protected_text(self):
        document = load_fixture()
        objects = document["envelope"]["panel"]["single_objects"]
        objects[0]["tag_text"] = ""
        objects[1]["posLeft"] = "110"
        findings = validator.run(panel_of(document))
        self.assertNotIn("VC-T01", rules_of(findings))

    def test_partial_live_on_live_overlap_is_a_warning(self):
        panel = self.mutated(2, posLeft=290, posTop=96)  # alarm onto value
        findings = validator.run(panel)
        self.assertIn("VC-T02", rules_of(findings, "warning"))
        self.assertNotIn("VC-T01", rules_of(findings))

    def test_exactly_coincident_live_stack_is_only_info(self):
        document = load_fixture()
        objects = document["envelope"]["panel"]["single_objects"]
        clone = copy.deepcopy(objects[2])
        clone["name"] = "object_5"
        objects.append(clone)
        findings = validator.run(panel_of(document))
        self.assertIn("VC-T03", rules_of(findings, "info"))
        self.assertEqual([], rules_of(findings, "error"))
        self.assertEqual([], rules_of(findings, "warning"))

    def test_source_proves_a_live_over_text_overlap(self):
        panel = self.mutated(1, posLeft=110)
        source = self.mutated(1, posLeft=110)
        findings = validator.run(panel, source_panel=source)
        self.assertIn("VC-T03", rules_of(findings, "info"))
        self.assertEqual([], rules_of(findings, "error"))

    def test_source_proves_a_partial_live_on_live_overlap(self):
        panel = self.mutated(2, posLeft=290, posTop=96)
        source = self.mutated(2, posLeft=290, posTop=96)
        findings = validator.run(panel, source_panel=source)
        self.assertIn("VC-T03", rules_of(findings, "info"))
        self.assertEqual([], rules_of(findings, "warning"))

    def test_source_with_a_different_arrangement_proves_nothing(self):
        # The source overlaps the same pair, but 30 px differently - not
        # 'the same relative arrangement', so the candidate still fails.
        panel = self.mutated(1, posLeft=110)
        source = self.mutated(1, posLeft=140)
        findings = validator.run(panel, source_panel=source)
        self.assertIn("VC-T01", rules_of(findings, "error"))

    def test_translated_panel_stays_proven_when_moved_together(self):
        # Proof is position-independent: the same pair, same relative offset,
        # elsewhere on the canvas.
        panel = self.mutated(1, posLeft=110)
        moved = panel_of(load_fixture())
        for obj in moved["single_objects"]:
            obj["posLeft"] = str(float(obj["posLeft"]) + 400)
        moved["single_objects"][1]["posLeft"] = str(110 + 400)
        findings = validator.run(panel, source_panel=moved)
        self.assertIn("VC-T03", rules_of(findings, "info"))
        self.assertEqual([], rules_of(findings, "error"))

    def test_blank_source_label_does_not_prove_text_overlap(self):
        # The source shows the same pair at the same offset, but its label is
        # blank - the production panel proved live-over-blank, never
        # live-over-text. The role pair is part of the proof signature.
        panel = self.mutated(1, posLeft=110)
        source_doc = load_fixture()
        objects = source_doc["envelope"]["panel"]["single_objects"]
        objects[0]["tag_text"] = ""
        objects[1]["posLeft"] = "110"
        findings = validator.run(panel, source_panel=panel_of(source_doc))
        self.assertIn("VC-T01", rules_of(findings, "error"))


class ContainerCoordinates(unittest.TestCase):
    """Container-relative children are converted to panel-absolute."""

    def with_container_child(self, child_left, child_top):
        document = load_fixture()
        panel = document["envelope"]["panel"]
        panel["containers"].append({
            "unique_id": "custom_demo_container",
            "name": "demo container",
            "left": "90", "top": "190",
            "items": [{
                "obj_id": "number_v3_40px_no_conn_no_tag",
                "name": "cell_0",
                "posLeft": str(child_left), "posTop": str(child_top),
                "posWidth": "40", "posHeight": "20",
                "tag_text": "",
            }],
        })
        return panel_of(document)

    def test_container_child_lands_on_label_in_absolute_terms(self):
        # Container at (90,190) + child at (15,12) = (105,202): on label B.
        findings = validator.run(self.with_container_child(15, 12))
        self.assertIn("VC-T01", rules_of(findings, "error"))

    def test_container_child_clear_of_text_is_clean(self):
        # Container at (90,190) + child at (500,12) = (590,202): clear.
        findings = validator.run(self.with_container_child(500, 12))
        self.assertEqual([], rules_of(findings, "error"))

    def test_container_without_origin_skips_children_and_warns(self):
        # No left/top on the container, so the child has no absolute
        # position. Assuming (0,0) would put this child directly on label A
        # and report a false VC-T01; the child is skipped and the skip is a
        # warning instead.
        document = load_fixture()
        document["envelope"]["panel"]["containers"].append({
            "unique_id": "custom_orphan",
            "name": "orphan container",
            "items": [{
                "obj_id": "number_v3_40px_no_conn_no_tag",
                "name": "cell_0",
                "posLeft": "110", "posTop": "100",
                "posWidth": "40", "posHeight": "20",
                "tag_text": "",
            }],
        })
        findings = validator.run(panel_of(document))
        self.assertNotIn("VC-T01", rules_of(findings))
        self.assertIn("VC-S01", rules_of(findings, "warning"))


class WidthFromAllowedValues(unittest.TestCase):
    """VC-W01/VC-W02 - contract SS5."""

    def run_width(self, panel_document, values):
        return validator.run(panel_of(panel_document), allowed_values=values)

    def test_state_value_narrower_than_longest_label_fails(self):
        document = load_fixture()
        document["envelope"]["panel"]["single_objects"][4]["posWidth"] = "42"
        findings = self.run_width(document, load_values())
        errors = [f for f in findings if f.rule == "VC-W01"]
        self.assertTrue(errors)
        self.assertEqual("error", errors[0].severity)
        self.assertIn("Communication error", errors[0].message)

    def test_current_value_being_short_does_not_excuse_the_width(self):
        # Same mutation, phrased as the incident: the current reading is 'OK'
        # (2 chars, fits 42 px); the map still requires the widest state.
        document = load_fixture()
        document["envelope"]["panel"]["single_objects"][4]["posWidth"] = "42"
        document["envelope"]["panel"]["single_objects"][4]["tag_text"] = "OK"
        findings = self.run_width(document, load_values())
        self.assertIn("VC-W01", rules_of(findings, "error"))

    def test_numeric_range_sizes_for_the_widest_bound(self):
        document = load_fixture()
        document["envelope"]["panel"]["single_objects"][4]["posWidth"] = "40"
        values = {"maps": [{"match": {"alias_text": "Unit status"},
                            "values": "-200.0 to 200.0"}]}
        findings = self.run_width(document, values)
        # '-200.0' is 6 chars: 6*7+6 = 48 px > 40 px.
        self.assertIn("VC-W01", rules_of(findings, "error"))

    def test_list_form_values_are_accepted(self):
        document = load_fixture()
        document["envelope"]["panel"]["single_objects"][4]["posWidth"] = "60"
        values = {"maps": [{"match": {"alias_text": "Unit status"},
                            "values": ["OFF", "Communication error"]}]}
        findings = self.run_width(document, values)
        self.assertIn("VC-W01", rules_of(findings, "error"))

    def test_map_matching_no_object_is_reported_as_info(self):
        values = {"maps": [{"match": {"alias_text": "No such alias"},
                            "values": "0 = OFF / 1 = ON"}]}
        findings = self.run_width(load_fixture(), values)
        self.assertIn("VC-W02", rules_of(findings, "info"))
        self.assertEqual([], rules_of(findings, "error"))

    def test_map_without_values_is_a_warning(self):
        values = {"maps": [{"match": {"alias_text": "Unit status"}}]}
        findings = self.run_width(load_fixture(), values)
        self.assertIn("VC-W02", rules_of(findings, "warning"))

    def test_driver_id_contains_matches(self):
        document = load_fixture()
        obj = document["envelope"]["panel"]["single_objects"][4]
        obj["driver_id"] = "NNNNN_2_104_16_0_1234"
        obj["posWidth"] = "42"
        values = {"maps": [{"match": {"driver_id_contains": "_2_104_"},
                            "values": "0 = Alarm / 1 = OK / 2 = Communication error"}]}
        findings = self.run_width(document, values)
        self.assertIn("VC-W01", rules_of(findings, "error"))

    def test_container_child_value_is_width_checked(self):
        # A value cell inside a table container must fit the longest allowed
        # value exactly as a canvas object must (contract SS5).
        document = load_fixture()
        document["envelope"]["panel"]["containers"].append({
            "unique_id": "custom_table",
            "name": "demo table",
            "left": "90", "top": "500",
            "items": [{
                "obj_id": "number_v3_val_cell_grey25",
                "name": "cell_0",
                "posLeft": "10", "posTop": "5",
                "posWidth": "42", "posHeight": "20",
                "tag_text": "",
                "alias_text": "Unit status",
            }],
        })
        findings = self.run_width(document, load_values())
        errors = [f for f in findings if f.rule == "VC-W01"]
        self.assertTrue(errors)
        self.assertIn("cell_0", errors[0].message)


class DisplayLabelParsing(unittest.TestCase):
    """The E23 production forms parse to the right label set."""

    def test_slash_separated_pairs(self):
        self.assertEqual(["OFF", "ON"],
                         validator.display_labels("0 = OFF / 1 = ON"))

    def test_the_contract_worked_example(self):
        labels = validator.display_labels(
            "0 = Alarm / 1 = OK / 2 = Communication error")
        self.assertEqual(["Alarm", "OK", "Communication error"], labels)

    def test_semicolon_and_newline_separators(self):
        self.assertEqual(["A", "B"], validator.display_labels("0=A;1=B"))
        self.assertEqual(["A", "B"], validator.display_labels("0=A\n1=B"))

    def test_labels_keep_internal_punctuation(self):
        labels = validator.display_labels(
            "3 = Comp. w. unloaders only / 4 = 1xVariable + Single step")
        self.assertEqual(["Comp. w. unloaders only",
                          "1xVariable + Single step"], labels)

    def test_slash_inside_a_label_survives(self):
        # Only a spaced ' / ' separates pairs; 'Heat/Cool' is one label.
        labels = validator.display_labels("0 = Heat/Cool / 1 = Off")
        self.assertEqual(["Heat/Cool", "Off"], labels)

    def test_range_yields_the_widest_bound(self):
        self.assertEqual(["-200.0"],
                         validator.display_labels("-200.0 to 200.0"))

    def test_blank_yields_nothing(self):
        self.assertEqual([], validator.display_labels(""))
        self.assertEqual([], validator.display_labels(None))


class RoleClassification(unittest.TestCase):
    """A catalog entry without either flag falls through to the patterns."""

    def element(self, obj_id, text=""):
        return {"obj_id": obj_id, "name": "object_0", "text": text,
                "rect": (0.0, 0.0, 10.0, 10.0), "raw": {}, "where": "canvas"}

    def test_catalog_entry_without_flags_falls_back_to_patterns(self):
        # Navigation entries in the catalog carry neither only_tag_text nor
        # can_link/states; the name patterns still classify them live.
        catalog = {"sub_page_nav_button": {}}
        role = validator.classify(self.element("sub_page_nav_button"), catalog)
        self.assertEqual("live", role)

    def test_catalog_entry_without_flags_and_no_pattern_is_other(self):
        catalog = {"decor_frame_plain": {}}
        role = validator.classify(self.element("decor_frame_plain"), catalog)
        self.assertEqual("other", role)


class AnalysisBlock(unittest.TestCase):
    """VC-A01 - contract SS2."""

    def test_complete_analysis_passes(self):
        findings = validator.run(panel_of(load_fixture()),
                                 analysis=complete_analysis())
        self.assertEqual([], rules_of(findings, "error"))

    def test_missing_keys_are_named(self):
        analysis = complete_analysis()
        del analysis["A8"]
        analysis["A10"] = ""
        findings = validator.run(panel_of(load_fixture()), analysis=analysis)
        errors = [f for f in findings if f.rule == "VC-A01"]
        self.assertTrue(errors)
        self.assertIn("A8", errors[0].message)
        self.assertIn("A10", errors[0].message)

    def test_non_object_analysis_is_an_error(self):
        findings = validator.run(panel_of(load_fixture()), analysis=[])
        self.assertIn("VC-A01", rules_of(findings, "error"))


class CommandLine(unittest.TestCase):
    """Exit status 0 clean / 1 on errors, same as the per-type validators."""

    def run_cli(self, *argv):
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            return validator.main(list(argv))

    def test_clean_fixture_exits_zero(self):
        self.assertEqual(0, self.run_cli(str(FIXTURE)))

    def test_clean_fixture_with_values_exits_zero(self):
        self.assertEqual(0, self.run_cli(str(FIXTURE),
                                         "--allowed-values", str(VALUES)))

    def test_mutated_panel_exits_one(self):
        document = load_fixture()
        document["envelope"]["panel"]["single_objects"][1]["posLeft"] = "110"
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "mutated.json"
            path.write_text(json.dumps(document), encoding="utf-8")
            self.assertEqual(1, self.run_cli(str(path)))

    def test_json_report_flag_still_exits_by_severity(self):
        self.assertEqual(0, self.run_cli(str(FIXTURE), "--json-report"))

    def run_cli_capture(self, *argv):
        import contextlib
        import io
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = validator.main(list(argv))
        return code, buffer.getvalue()

    def test_negative_char_px_is_rejected(self):
        # A negative estimate would silently suppress every VC-W01.
        import contextlib
        import io
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as caught:
                self.run_cli(str(FIXTURE), "--char-px", "-1")
        self.assertEqual(2, caught.exception.code)

    def test_nan_char_px_is_rejected(self):
        import contextlib
        import io
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as caught:
                self.run_cli(str(FIXTURE), "--char-px", "nan")
        self.assertEqual(2, caught.exception.code)

    def test_negative_pad_px_is_rejected(self):
        import contextlib
        import io
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as caught:
                self.run_cli(str(FIXTURE), "--pad-px", "-1")
        self.assertEqual(2, caught.exception.code)

    def test_json_report_shape_on_unreadable_panel(self):
        code, output = self.run_cli_capture("no-such-file.json",
                                            "--json-report")
        self.assertEqual(1, code)
        report = json.loads(output)
        self.assertEqual(1, report["errors"])
        self.assertEqual("VC-S01", report["findings"][0]["rule"])

    def test_json_report_shape_on_non_panel_document(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "not-a-panel.json"
            path.write_text(json.dumps({"hello": "world"}), encoding="utf-8")
            code, output = self.run_cli_capture(str(path), "--json-report")
        self.assertEqual(1, code)
        report = json.loads(output)
        self.assertEqual("VC-S01", report["findings"][0]["rule"])


class EnvelopeShapes(unittest.TestCase):
    """The validator accepts enveloped and bare panel documents."""

    def test_bare_panel_document(self):
        panel = load_fixture()["envelope"]["panel"]
        findings = validator.run(validator.extract_panel(panel))
        self.assertEqual([], rules_of(findings, "error"))

    def test_panel_key_document(self):
        document = {"panel": load_fixture()["envelope"]["panel"]}
        findings = validator.run(validator.extract_panel(document))
        self.assertEqual([], rules_of(findings, "error"))


if __name__ == "__main__":
    unittest.main()
