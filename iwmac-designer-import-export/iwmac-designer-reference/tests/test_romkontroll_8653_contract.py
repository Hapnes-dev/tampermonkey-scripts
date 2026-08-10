"""Contract tests for the room-control table and the TEMPLATE-8653-ROMKONTROLL profile.

    cd iwmac-designer-reference
    python -m unittest tests.test_romkontroll_8653_contract -v

(`python -m unittest discover -s tests` does not work here: tests/ has no
__init__.py and adding one would change how every other module in it resolves.
Run the modules by name, as the other suites in this directory do.)

Every test but the baselines is a mutation test: it takes the committed
sanitized fixture, breaks exactly one thing, and asserts the validator reports
it with the rule id the QA checklist promises. The nine mutations live in
build-romkontroll-negatives.py so the CLI and this suite cannot disagree about
what "a placeholder overview" means.

The suite exists because on 2026-08-10 two generated versions of this exact
panel were rejected. Both parsed cleanly. The first was a custom dataset with
correct room analysis and no panel document around it; the second was a correct
envelope around 59 labels, no table and no bindings, produced with the
parameter dump attached. Structural validity was never the missing control -
the table, the bindings and the comparison against the known-good export were.

The two reproductions in build-romkontroll-negatives.py are asserted to fire
the same rule ids the real rejected files fire, so this suite keeps testing the
incident and not a paraphrase of it.
"""

import collections
import contextlib
import copy
import importlib.util
import io
import json
import os
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "reference_data" / "romkontroll-8653-sanitized.json"
PROFILE = "TEMPLATE-8653-ROMKONTROLL"

# The plant's parameter dump is not committed - it carries live driver ids for
# a real building. Point IWMAC_ROMKONTROLL_SQL at a copy to run the binding
# tests; without it they skip, and say so, rather than passing silently.
SQL_PATH = os.environ.get("IWMAC_ROMKONTROLL_SQL", "")
HAVE_SQL = bool(SQL_PATH) and pathlib.Path(SQL_PATH).is_file()
NO_SQL = "set IWMAC_ROMKONTROLL_SQL to an iw_gen_driver_parameters dump"


def _load(name, filename):
    """The scripts are hyphenated, so they cannot be imported by name."""
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = _load("validate_romkontroll_panel", "validate-romkontroll-panel.py")
negatives = _load("build_romkontroll_negatives", "build-romkontroll-negatives.py")
fixture_builder = _load("build_romkontroll_fixture", "build-romkontroll-fixture.py")
rules_builder = _load("build_romkontroll_rules", "build-romkontroll-rules.py")

RULES = validator.load_rules()
ROMKONTROLL = RULES["panel_types"]["romkontroll_table"]
TEMPLATE = RULES["profiles"][PROFILE]

VALUE = fixture_builder.VALUE_OBJ
ALARM = fixture_builder.ALARM_OBJ
CELL_BODY = fixture_builder.CELL_BODY
CELL_HEADER = fixture_builder.CELL_HEADER


def source():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def envelope(document=None):
    return fixture_builder.envelope_of(document if document is not None else source())


def run(document, profile=None, sql_path=None, label="candidate.json"):
    """validate() returns (panel, findings); these tests only assert findings.
    Use panel_for() when a test needs the measured panel itself."""
    return validator.validate(document, RULES, label, profile_name=profile,
                              sql_path=sql_path)[1]


def run_pair(source_doc, candidate_doc):
    return validator.validate_pair(source_doc, candidate_doc, RULES,
                                   "source.json", "candidate.json")[1]


def panel_for(document, label="candidate.json"):
    return validator.Panel(document, label)


def errors(findings):
    return [f for f in findings if f.severity == "error"]


def warnings(findings):
    return [f for f in findings if f.severity == "warning"]


def fired(findings):
    return {f.rule for f in findings}


def failed(findings):
    return {f.rule for f in errors(findings)}


def objects_of(document):
    return envelope(document)["panel"]["single_objects"]


def container_of(document):
    return envelope(document)["panel"]["containers"][0]


def negative(name):
    return negatives.build(name)


class FixtureBaselineTest(unittest.TestCase):
    """The committed fixture must pass, or every mutation test below is
    measuring the fixture instead of the mutation."""

    def test_fixture_has_no_errors(self):
        self.assertEqual([], [repr(f) for f in errors(run(source()))])

    def test_fixture_passes_its_own_profile(self):
        findings = run(source(), profile=PROFILE)
        self.assertEqual([], [repr(f) for f in errors(findings)])

    def test_the_only_warning_is_the_documented_annotation_cluster(self):
        """The three objects below the last row are an anomaly of this panel,
        recorded in the profile. Reported as a warning naming them - not
        forced into an error, and not silently allowed."""
        warned = warnings(run(source()))
        self.assertEqual(["R-T10"], sorted({f.rule for f in warned}))
        for name in ("object_1550", "object_1551", "object_1552"):
            self.assertIn(name, warned[0].message)

    def test_envelope_is_the_accepted_shape(self):
        env = envelope()
        self.assertEqual("iwmac-designer-panel", env["format"])
        self.assertEqual(1, env["version"])
        self.assertEqual("Tabell romkontroll alle plan", env["panel_name"])
        self.assertEqual("1400px", env["panel_width"])
        self.assertEqual("750px", env["panel_height"])
        self.assertEqual({"single_objects": 1553, "containers": 1, "graphics": 0},
                         env["counts"])
        self.assertIs(True, env["background_embedded"])

    def test_counts_equal_the_array_lengths(self):
        env = envelope()
        panel = env["panel"]
        for key, array in (("single_objects", panel["single_objects"]),
                           ("containers", panel["containers"]),
                           ("graphics", panel["graphics"])):
            self.assertEqual(len(array), env["counts"][key], key)

    def test_panel_carries_no_authored_artwork_and_no_trace(self):
        panel = envelope()["panel"]
        self.assertNotIn("image_svg", panel)
        self.assertNotIn("image_svg_trace", panel)
        self.assertEqual("true", panel["converted"])
        self.assertTrue(panel["image_data"].startswith("data:image"))

    def test_names_are_sequential(self):
        names = [o["name"] for o in objects_of(source())]
        self.assertEqual([f"object_{i}" for i in range(1553)], names)

    def test_every_object_carries_all_seventeen_fields(self):
        for obj in objects_of(source()):
            self.assertEqual(set(fixture_builder.OBJECT_FIELDS), set(obj), obj["name"])

    def test_the_seven_constants_hold_on_every_object(self):
        for obj in objects_of(source()):
            self.assertEqual("driver_id", obj["id"], obj["name"])
            self.assertEqual("link_name", obj["link_name"], obj["name"])
            self.assertEqual("", obj["link_tag"], obj["name"])
            self.assertEqual("", obj["sub_group"], obj["name"])
            self.assertEqual("", obj["unit_ref"], obj["name"])
            self.assertEqual("true", obj["linked"], obj["name"])
            self.assertEqual(20, obj["posHeight"], obj["name"])

    def test_linked_stays_true_on_the_two_objects_with_no_binding(self):
        """Host behaviour, not a defect: load_new_ver_objects sets linked
        "true" whenever driver_id is not the literal placeholder - including
        when it is empty (V3scripts.js:514). Tidying these to "false" would
        make the fixture disagree with what the Designer produces."""
        unbound = [o for o in objects_of(source()) if not o["driver_id"]]
        self.assertEqual(2, len(unbound))
        for obj in unbound:
            self.assertEqual("true", obj["linked"])
            self.assertEqual("", obj["unit_id"])

    def test_geometry_fields_are_json_numbers(self):
        for obj in objects_of(source()):
            for field in ("posWidth", "posHeight", "posLeft", "posTop"):
                self.assertIsInstance(obj[field], int, f"{obj['name']}.{field}")

    def test_z_bands_are_explicit_strings(self):
        bands = collections.Counter(o["zIndex"] for o in objects_of(source()))
        self.assertEqual({"110": 1551, "1100": 2}, dict(bands))
        self.assertNotIn("default", bands)

    def test_object_census(self):
        census = collections.Counter(
            (o["obj_id"], o["posWidth"], o["posHeight"]) for o in objects_of(source()))
        self.assertEqual({
            (VALUE, 80, 20): 1300,
            (ALARM, 20, 20): 250,
            ("number_v3_label_11px_norm", 50, 20): 2,
            ("number_v3_60px_json_obj", 60, 20): 1,
        }, dict(census))


class ContainerBaselineTest(unittest.TestCase):
    """One table_container is what makes this panel type what it is."""

    def test_exactly_one_table_container(self):
        panel = envelope()["panel"]
        self.assertEqual(1, len(panel["containers"]))
        self.assertEqual([], panel["graphics"])
        self.assertEqual("table_container", panel["containers"][0]["container_type"])

    def test_container_attributes(self):
        container = container_of(source())
        self.assertEqual("custom_0", container["unique_id"])
        self.assertEqual("objects_container", container["id"])
        self.assertEqual("objects_container_0", container["name"])
        self.assertEqual("container_c", container["type"])
        self.assertEqual("50", container["num_of_rows"])
        self.assertEqual("34", container["num_of_col"])
        self.assertEqual("300", container["descr_width"])
        self.assertEqual("100", container["val_width"])
        self.assertEqual("true", container["cells"])
        self.assertEqual("1625", container["last_y"])
        self.assertEqual(5, container["left"])
        self.assertEqual(5, container["top"])
        self.assertEqual(4, container["zIndex"])

    def test_container_zindex_is_a_number_and_item_zindex_a_string(self):
        """The production asymmetry, preserved. Normalizing either one makes
        the document disagree with what getPanelDataFromDOM collects."""
        container = container_of(source())
        self.assertIsInstance(container["zIndex"], int)
        for item in container["items"]:
            self.assertEqual("5", item["zIndex"])

    def test_unique_id_contains_custom(self):
        """Insert routes on unique_id.indexOf("custom_"); the other branch,
        .template(), is an empty stub, so the container vanishes with no
        error at all (V3scripts.js:528, :684)."""
        self.assertIn("custom_", container_of(source())["unique_id"])

    def test_items_draw_the_grid_and_carry_no_bindings(self):
        items = container_of(source())["items"]
        self.assertEqual(1802, len(items))
        self.assertEqual({CELL_BODY: 1700, CELL_HEADER: 102},
                         dict(collections.Counter(i["obj_id"] for i in items)))
        for item in items:
            self.assertEqual("", item["driver_id"])
            self.assertEqual("NA", item["link_tag"])
            self.assertEqual("new text", item["alias_text"])

    def test_body_cells_are_columns_times_rows(self):
        self.assertEqual(1700, 34 * 50)

    def test_last_y_is_the_last_row_top_plus_the_row_height(self):
        geometry = fixture_builder.table_geometry(envelope())
        last = geometry["rows"][-1]["rel_top"]
        self.assertEqual(1598, last)
        self.assertEqual(str(last + 27), container_of(source())["last_y"])


class GridBaselineTest(unittest.TestCase):
    """The measured grid. These are this building's numbers, not targets."""

    def setUp(self):
        self.geometry = fixture_builder.table_geometry(envelope())

    def test_thirty_four_columns(self):
        columns = self.geometry["columns"]
        self.assertEqual(34, len(columns))
        self.assertEqual({90: 31, 100: 2, 130: 1},
                         dict(collections.Counter(c["width"] for c in columns)))

    def test_columns_are_contiguous_with_no_gutter(self):
        columns = self.geometry["columns"]
        for left, right in zip(columns, columns[1:]):
            self.assertEqual(left["rel_left"] + left["width"], right["rel_left"])

    def test_fifty_rows_pitched_twenty_seven_apart_except_across_a_band(self):
        rows = self.geometry["rows"]
        self.assertEqual(50, len(rows))
        self.assertEqual(105, rows[0]["rel_top"])
        deltas = collections.Counter(b["rel_top"] - a["rel_top"]
                                     for a, b in zip(rows, rows[1:]))
        self.assertEqual({27: 47, 112: 2}, dict(deltas))
        self.assertEqual(112, 27 + 85)  # a row that follows a header band

    def test_three_header_bands_of_equal_height(self):
        bands = TEMPLATE["header_bands"]
        self.assertEqual(3, bands["count"])
        self.assertEqual(85, bands["height"])
        self.assertEqual([20, 699, 1378], bands["rel_tops"])
        self.assertEqual([22, 22, 6], bands["body_rows_per_band"])
        self.assertEqual(50, sum(bands["body_rows_per_band"]))
        self.assertEqual(102, 3 * 34)  # one header per column per band

    def test_fifty_rooms_unique_and_ascending_as_integers(self):
        labels = fixture_builder.room_labels(self.geometry)
        rooms = [labels[i] for i in sorted(labels)]
        self.assertEqual(50, len(rooms))
        self.assertEqual(50, len(set(rooms)))
        self.assertEqual(sorted(rooms, key=int), rooms)
        self.assertEqual("212", rooms[0])
        self.assertEqual(TEMPLATE["rooms"], rooms)

    def test_the_floor_is_the_leading_digit_of_the_room_number(self):
        labels = fixture_builder.room_labels(self.geometry)
        floors = collections.Counter(str(labels[i])[0] for i in sorted(labels))
        self.assertEqual(50, sum(floors.values()))
        self.assertEqual(list("23456789"), sorted(floors))

    def test_the_room_column_repeats_partway_across(self):
        """So a row scrolled sideways still says which room it is."""
        label_columns = [c["index"] for c in TEMPLATE["columns"]
                         if c["kind"] == "label"]
        self.assertEqual([0, 1, 16], label_columns)

    def test_every_canvas_object_sits_centred_in_its_cell(self):
        """The placement formula, checked against all 1550 grid objects with
        integer arithmetic - no float comparison, no tolerance.

        Which objects are grid objects is the validator's own answer, not a
        second one written here: two definitions of "in a cell" would let the
        suite pass a panel the validator rejects."""
        panel = panel_for(source(), "fixture")
        container = panel.container
        origin_left, origin_top = container["left"], container["top"]
        checked = 0
        for obj in panel.grid_objects():
            column, row = panel.placed[obj["name"]]
            cell = panel.cell_for(column, row)
            self.assertIsNotNone(cell, obj["name"])
            width = cell["posWidth"]
            self.assertEqual(
                origin_left + cell["posLeft"] + (width - obj["posWidth"]) // 2,
                obj["posLeft"], obj["name"])
            self.assertEqual(
                origin_top + cell["posTop"] + (27 - obj["posHeight"]) // 2,
                obj["posTop"], obj["name"])
            self.assertEqual(0, (width - obj["posWidth"]) % 2, obj["name"])
            checked += 1
        self.assertEqual(1550, checked)

    def test_the_three_objects_outside_the_grid_are_the_annotation_cluster(self):
        """1553 objects, 1550 cells. The remaining three sit below the last
        row: the reset control and its two free-text labels. They are an
        anomaly of this building, recorded as one - not evidence that the
        placement formula has exceptions."""
        panel = panel_for(source(), "fixture")
        self.assertEqual(["object_1550", "object_1551", "object_1552"],
                         [o["name"] for o in panel.strays])
        last_row_bottom = self.geometry["rows"][-1]["abs_top"] + 27
        for obj in panel.strays:
            self.assertGreater(obj["posTop"], last_row_bottom)
        self.assertIn("annotation_cluster_below_the_grid", TEMPLATE["anomalies"])

    def test_the_value_and_alarm_offsets_are_five_three_and_thirty_five_three(self):
        offsets = TEMPLATE["cell_offsets"]["per_obj_id"]
        self.assertEqual([{"dx": 5, "dy": 3, "count": 1300}], offsets[VALUE])
        self.assertEqual([{"dx": 35, "dy": 3, "count": 250}], offsets[ALARM])


class ViewportTest(unittest.TestCase):
    """panel_height is a viewport, not a clipping boundary."""

    def test_the_content_is_far_larger_than_the_declared_canvas(self):
        extent = TEMPLATE["content_extent"]
        self.assertEqual({"min_left": 240, "max_right": 3120,
                          "min_top": 113, "max_bottom": 1690}, extent)
        self.assertGreater(extent["max_right"], 1400)
        self.assertGreater(extent["max_bottom"], 750)

    def test_overflow_is_reported_and_never_an_error(self):
        findings = run(source())
        self.assertEqual([], [f for f in errors(findings) if f.rule == "R-T16"])

    def test_compressing_to_fit_the_viewport_is_the_defect(self):
        findings = run(negative("compressed-to-viewport"))
        self.assertIn("R-T10", failed(findings))


class RulesGeneratorTest(unittest.TestCase):
    """documentation-rules.json is generated, never hand-edited."""

    def test_documentation_rules_is_up_to_date(self):
        """The generator's own --check, run in process.

        It reads documentation-rules.json, regenerates the romkontroll blocks
        from the fixture and exits 1 if the two differ - so a hand-edit of the
        rules file, or a fixture change nobody regenerated for, fails here."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = rules_builder.main(["--check"])
        self.assertEqual(0, status, err.getvalue().strip() or out.getvalue().strip())

    def test_the_profile_matches_the_fixture(self):
        env = envelope()
        self.assertEqual(len(env["panel"]["single_objects"]), TEMPLATE["object_count"])
        self.assertEqual(len(container_of(source())["items"]),
                         TEMPLATE["container_item_count"])
        self.assertEqual(34, TEMPLATE["column_count"])
        self.assertEqual(50, TEMPLATE["room_count"])
        self.assertEqual(4, TEMPLATE["distinct_obj_ids"])

    def test_counts_are_labelled_as_evidence_not_as_targets(self):
        applies = TEMPLATE["applies_when"]
        self.assertIn("does NOT apply to another building", applies)
        self.assertIn("They are the fixture", TEMPLATE["objects_not_listed"])

    def test_the_panel_type_names_what_it_is_not(self):
        not_this = ROMKONTROLL["identity"]["not_this_panel_type"]
        self.assertIn("romkontroll_floor_plan", not_this)
        self.assertIn("spjeldliste", not_this)
        self.assertIn("data_file", not_this)
        self.assertIn("13.1", not_this["data_file"])

    def test_the_spjeldliste_conflict_is_recorded_and_not_averaged(self):
        """One container per row is true of the spjeldliste and false here.
        Both statements survive, each scoped - RC-C1."""
        conflicts = {c["id"]: c for c in ROMKONTROLL["conflicts"]}
        self.assertEqual(["RC-C1", "RC-C2", "RC-C3", "RC-C4", "RC-C5"],
                         sorted(conflicts))
        first = conflicts["RC-C1"]
        self.assertEqual({"LIST", "ROMKONTROLL"}, set(first["scope_of_each"]))
        self.assertIn("Neither document is rewritten", first["resolution"])
        self.assertIn("RC-C1", ROMKONTROLL["identity"]["not_this_panel_type"]["spjeldliste"])

    def test_the_catalogue_conflict_widened_validation_by_evidence(self):
        """RC-C2: number_v3_cell_grey25 is used 1700 times and is not a
        palette object. The allowlist grew to include the controls registry.
        The rule the other direction - relax the check until the file passes -
        is the one this repository refuses."""
        conflicts = {c["id"]: c for c in ROMKONTROLL["conflicts"]}
        self.assertIn("not weakened to make a file pass",
                      conflicts["RC-C2"]["resolution"])


class DocumentRuleTest(unittest.TestCase):
    """R-S* - the document is a panel document at all."""

    def test_a_dataset_is_not_a_panel(self):
        findings = run(negative("dataset-not-a-panel"))
        self.assertLessEqual({"R-S2", "R-S3", "R-S4"}, failed(findings))

    def test_wrong_format_is_an_error(self):
        document = source()
        envelope(document)["format"] = "iwmac-panel"
        self.assertIn("R-S2", failed(run(document)))

    def test_unsupported_version_is_an_error(self):
        document = source()
        envelope(document)["version"] = 2
        self.assertIn("R-S3", failed(run(document)))

    def test_count_mismatch_is_an_error(self):
        document = source()
        envelope(document)["counts"]["single_objects"] = 1552
        self.assertIn("R-S6", failed(run(document)))

    def test_a_gap_in_the_names_is_an_error(self):
        document = source()
        objects_of(document)[7]["name"] = "object_9999"
        self.assertIn("R-S7", failed(run(document)))

    def test_a_missing_field_is_an_error(self):
        document = source()
        del objects_of(document)[3]["alias_text"]
        self.assertIn("R-S8", failed(run(document)))

    def test_a_geometry_string_is_an_error(self):
        document = source()
        objects_of(document)[11]["posLeft"] = "240"
        self.assertIn("R-S9", failed(run(document)))

    def test_zindex_default_is_an_error(self):
        """It is legal to the importer and it silently makes array order the
        stacking order on a panel that uses explicit bands."""
        document = source()
        for obj in objects_of(document)[:5]:
            obj["zIndex"] = "default"
        self.assertIn("R-S10", failed(run(document)))

    def test_a_blank_link_name_is_an_error(self):
        document = source()
        for obj in objects_of(document)[:5]:
            obj["link_name"] = ""
        self.assertIn("R-S11", failed(run(document)))

    def test_an_invented_obj_id_is_an_error(self):
        document = source()
        objects_of(document)[0]["obj_id"] = "number_v3_room_temp_cell"
        self.assertIn("R-S12", failed(run(document)))

    def test_a_missing_background_is_reported(self):
        document = source()
        panel = envelope(document)["panel"]
        del panel["image_data"]
        envelope(document)["background_embedded"] = True
        self.assertIn("R-S13", fired(run(document)))

    def test_image_svg_trace_must_not_be_emitted(self):
        """Export writes it for the AI to read; applyImportCore deletes it
        before rendering. Re-emitting it is a 2 MB round trip to nowhere."""
        document = source()
        envelope(document)["panel"]["image_svg_trace"] = "<svg/>"
        self.assertIn("R-S14", failed(run(document)))

    def test_mojibake_is_an_error(self):
        document = source()
        objects_of(document)[0]["alias_text"] = "Romtemperatur Ã¸vre"
        self.assertIn("R-S17", failed(run(document)))


class TableRuleTest(unittest.TestCase):
    """R-T* - the table is a table."""

    def test_no_container_is_not_this_panel_type(self):
        findings = run(negative("container-dropped"))
        self.assertIn("R-T1", failed(findings))

    def test_a_non_custom_unique_id_is_an_error(self):
        findings = run(negative("non-custom-unique-id"))
        self.assertIn("R-T2", failed(findings))

    def test_num_of_col_must_equal_the_measured_columns(self):
        findings = run(negative("column-dropped"))
        self.assertIn("R-T4", failed(findings))

    def test_num_of_rows_must_equal_the_measured_rows(self):
        document = source()
        container_of(document)["num_of_rows"] = "49"
        self.assertIn("R-T5", failed(run(document)))

    def test_a_hole_in_the_grid_is_an_error(self):
        document = source()
        container = container_of(document)
        container["items"] = [i for i in container["items"]
                              if not (i["obj_id"] == CELL_BODY
                                      and fixture_builder.as_int(i["posTop"]) == 105
                                      and fixture_builder.as_int(i["posLeft"]) == 230)]
        self.assertIn("R-T6", failed(run(document)))

    def test_last_y_must_agree_with_the_last_row(self):
        document = source()
        container_of(document)["last_y"] = "1598"
        self.assertIn("R-T9", failed(run(document)))

    def test_an_object_outside_its_cell_is_an_error(self):
        document = source()
        objects_of(document)[0]["posLeft"] += 7
        self.assertIn("R-T10", failed(run(document)))

    def test_a_label_column_carrying_a_canvas_object_is_an_error(self):
        document = source()
        stray = copy.deepcopy(objects_of(document)[0])
        stray["name"] = "object_1553"
        stray["posLeft"] = 15
        stray["posTop"] = 113
        objects_of(document).append(stray)
        envelope(document)["counts"]["single_objects"] = 1554
        self.assertIn("R-T11", failed(run(document)))

    def test_rooms_out_of_integer_order_is_an_error(self):
        findings = run(negative("text-sorted-rooms"))
        self.assertIn("R-T12", failed(findings))

    def test_a_duplicated_room_is_an_error(self):
        document = source()
        geometry = fixture_builder.table_geometry(envelope(document))
        first, second = geometry["rows"][0], geometry["rows"][1]
        column = geometry["columns"][0]
        cells = geometry["cells"]
        cells[(column["rel_left"], second["rel_top"])]["tag_text"] = \
            cells[(column["rel_left"], first["rel_top"])]["tag_text"]
        self.assertIn("R-T12", failed(run(document)))

    def test_a_populated_graphics_array_is_an_error(self):
        document = source()
        envelope(document)["panel"]["graphics"] = [{"id": "g0"}]
        envelope(document)["counts"]["graphics"] = 1
        self.assertIn("R-T15", failed(run(document)))


class BindingRuleTest(unittest.TestCase):
    """R-B* - the bindings are real."""

    def test_the_fixture_is_a_linked_panel(self):
        panel = validator.Panel(source(), "fixture")
        self.assertEqual("C", panel.mode())

    def test_a_placeholder_in_a_linked_panel_is_an_error(self):
        """One template placeholder among 1552 real bindings.

        Measured, not assumed: this is rejected by R-B3 and R-B4, not by R-B1.
        A single placeholder moves Panel.mode() from "C" to "mixed", and R-B1
        only speaks about a file that carries no binding of any kind - in every
        other mode it is a note recording which mode was detected. R-B3 is the
        rule that owns "half linked": a template withholds every binding, a
        linked panel withholds none. R-B4 fires alongside it because linked
        stayed "true" while driver_id became the placeholder, which contradicts
        the host rule at V3scripts.js:514.

        The expectation was corrected to the measurement rather than the
        validator relaxed to the expectation - QA checklist, "do not weaken a
        check to make a file pass"."""
        document = source()
        objects_of(document)[0]["driver_id"] = "driver_id"
        errors = failed(run(document))
        self.assertIn("R-B3", errors)
        self.assertIn("R-B4", errors)
        self.assertNotIn("R-B1", errors)

    def test_a_real_driver_id_with_no_unit_id_is_an_error(self):
        document = source()
        objects_of(document)[0]["unit_id"] = ""
        self.assertIn("R-B2", failed(run(document)))

    def test_a_half_linked_file_is_neither_a_template_nor_a_panel(self):
        findings = run(negative("half-linked"))
        self.assertIn("R-B3", failed(findings))

    def test_a_duplicate_driver_id_is_an_error(self):
        document = source()
        objects = objects_of(document)
        objects[1]["driver_id"] = objects[0]["driver_id"]
        self.assertIn("R-B5", failed(run(document)))

    @unittest.skipUnless(HAVE_SQL, NO_SQL)
    def test_the_fixture_resolves_against_the_dump(self):
        findings = run(source(), sql_path=SQL_PATH)
        self.assertEqual([], [repr(f) for f in errors(findings)])

    @unittest.skipUnless(HAVE_SQL, NO_SQL)
    def test_a_constructed_driver_id_resolves_to_nothing(self):
        """The defect no amount of structural validation can see. A
        well-formed identifier naming a parameter the controller does not
        expose is indistinguishable from a real one until something resolves
        it - which is the whole argument for --source-sql."""
        clean = run(negative("constructed-driver-ids"))
        self.assertEqual([], [repr(f) for f in errors(clean)])
        against_sql = run(negative("constructed-driver-ids"), sql_path=SQL_PATH)
        self.assertIn("R-B6", failed(against_sql))

    @unittest.skipUnless(HAVE_SQL, NO_SQL)
    def test_a_rewritten_alias_is_an_error(self):
        """alias_text is copied byte for byte, odd whitespace included. It is
        what a human links by afterwards."""
        document = source()
        obj = objects_of(document)[0]
        obj["alias_text"] = " ".join(obj["alias_text"].split())
        self.assertIn("R-B8", failed(run(document, sql_path=SQL_PATH)))

    @unittest.skipUnless(HAVE_SQL, NO_SQL)
    def test_an_invented_room_is_an_error(self):
        findings = run(negative("text-sorted-rooms"), sql_path=SQL_PATH)
        self.assertIn("R-B9", failed(findings))


class ProfileTest(unittest.TestCase):
    """R-P* - same building only."""

    def test_an_unknown_profile_is_an_error(self):
        findings = run(source(), profile="TEMPLATE-9999")
        self.assertTrue(errors(findings))

    def test_a_maskin_profile_is_rejected_for_a_room_control_table(self):
        findings = run(source(), profile="TEMPLATE-10229")
        self.assertTrue(errors(findings))

    def test_a_dropped_column_fails_the_profile(self):
        findings = run(negative("column-dropped"), profile=PROFILE)
        self.assertTrue(errors(findings))

    def test_a_renamed_room_fails_the_profile(self):
        findings = run(negative("text-sorted-rooms"), profile=PROFILE)
        self.assertTrue(errors(findings))

    def test_the_profile_does_not_claim_to_apply_to_another_building(self):
        self.assertIn("another building", TEMPLATE["applies_when"])


class CompareModeTest(unittest.TestCase):
    """R-C* - against the known-good export."""

    def test_the_fixture_compares_clean_with_itself(self):
        findings = run_pair(source(), source())
        self.assertEqual([], [repr(f) for f in errors(findings)])

    def test_median_displacement_is_zero_for_an_unmoved_grid(self):
        findings = run_pair(source(), source())
        moved = [f for f in findings if f.rule == "R-C5"]
        self.assertTrue(moved)
        self.assertIn("0 moved", moved[0].message)

    def test_a_dataset_has_no_grid_to_compare_at_all(self):
        findings = run_pair(source(), negative("dataset-not-a-panel"))
        self.assertIn("R-C3", failed(findings))
        self.assertIn("R-C8", failed(findings))

    def test_a_placeholder_overview_loses_the_z_bands(self):
        findings = run_pair(source(), negative("placeholder-overview"))
        message = [f for f in findings if f.rule == "R-C8"][0].message
        self.assertIn("110", message)
        self.assertIn("default", message)

    def test_a_placeholder_overview_loses_the_object_census(self):
        findings = run_pair(source(), negative("placeholder-overview"))
        census = [f for f in findings if f.rule == "R-C2"]
        self.assertTrue(census)
        self.assertTrue(any(VALUE in f.message for f in census))

    def test_a_dropped_column_is_reported_column_by_column(self):
        findings = run_pair(source(), negative("column-dropped"))
        self.assertTrue([f for f in findings if f.rule == "R-C4"])

    def test_a_lost_binding_is_an_error_in_compare(self):
        findings = run_pair(source(), negative("half-linked"))
        self.assertIn("R-C7", failed(findings))

    def test_matching_is_not_by_array_index(self):
        """Insert renumbers from the live canvas child index, so a candidate
        must be matched to its source by room and column - never by slot."""
        document = source()
        objects = objects_of(document)
        objects.reverse()
        for index, obj in enumerate(objects):
            obj["name"] = f"object_{index}"
        findings = run_pair(source(), document)
        self.assertEqual([], [repr(f) for f in errors(findings)])


class NegativeGeneratorTest(unittest.TestCase):
    """The generated negatives and this suite must not drift apart."""

    def test_all_nine_are_registered(self):
        self.assertEqual(9, len(negatives.NEGATIVES))
        self.assertEqual(sorted(negatives.NEGATIVES), sorted(negatives.EXPECTED))

    def test_every_negative_fails_on_the_rule_it_names(self):
        for name, expected in sorted(negatives.EXPECTED.items()):
            with self.subTest(negative=name):
                sql = SQL_PATH if name in negatives.NEEDS_SQL else None
                if name in negatives.NEEDS_SQL and not HAVE_SQL:
                    self.skipTest(NO_SQL)
                findings = run(negative(name), sql_path=sql)
                self.assertLessEqual(set(expected), failed(findings))

    def test_every_negative_is_rejected(self):
        for name in sorted(negatives.NEGATIVES):
            with self.subTest(negative=name):
                if name in negatives.NEEDS_SQL:
                    continue  # invisible without the dump, by construction
                self.assertTrue(errors(run(negative(name))))

    def test_negatives_do_not_touch_the_committed_fixture(self):
        before = FIXTURE.read_bytes()
        for name in sorted(negatives.NEGATIVES):
            negative(name)
        self.assertEqual(before, FIXTURE.read_bytes())
        self.assertEqual([], [repr(f) for f in errors(run(source()))])

    def test_each_negative_breaks_one_thing(self):
        """A mutation has consequences - compressing the panel also empties
        the label columns - but no negative may break an unrelated namespace,
        or a finding stops being attributable to one cause."""
        for name, expected in sorted(negatives.EXPECTED.items()):
            if name in negatives.NEEDS_SQL:
                continue
            with self.subTest(negative=name):
                namespaces = {rule.split("-")[1][0] for rule in failed(run(negative(name)))}
                self.assertLessEqual(namespaces,
                                     {rule.split("-")[1][0] for rule in expected})


class RejectedGenerationTest(unittest.TestCase):
    """The 2026-08-10 incident, kept executable.

    The rule ids below are what the real rejected files produce. If a future
    change to the validator stops catching them, this suite fails before the
    documentation can go stale."""

    def test_the_dataset_failure_is_caught_before_anything_else(self):
        findings = failed(run(negative("dataset-not-a-panel")))
        self.assertEqual({"R-S2", "R-S3", "R-S4"}, findings)

    def test_the_placeholder_overview_failure_is_caught_by_three_rules(self):
        findings = failed(run(negative("placeholder-overview")))
        self.assertEqual({"R-S10", "R-S11", "R-T1"}, findings)

    def test_the_placeholder_overview_parses_and_is_still_unusable(self):
        """It passed every structural check the first four stages make. That
        is the argument for stages 3 to 5 existing at all."""
        document = negative("placeholder-overview")
        env = fixture_builder.envelope_of(document)
        self.assertEqual("iwmac-designer-panel", env["format"])
        self.assertEqual(1, env["version"])
        self.assertEqual(len(env["panel"]["single_objects"]),
                         env["counts"]["single_objects"])
        self.assertIn("R-T1", failed(run(document)))

    def test_the_placeholder_overview_is_detected_as_an_unlinked_template(self):
        """Mode B. Which is why the mode-C placeholder rule R-B1 does NOT
        fire on it - the file is internally consistent and simply answers a
        question nobody asked."""
        panel = validator.Panel(negative("placeholder-overview"), "candidate")
        self.assertEqual("B", panel.mode())
        self.assertNotIn("R-B1", failed(run(negative("placeholder-overview"))))

    def test_every_rule_the_docs_credit_actually_fires(self):
        """documentation-rules.json records which checks caught each failure,
        and contract 13.3 and the QA checklist repeat those ids. An earlier
        draft credited R-B1 and R-C4 with catching 13.2; neither fires. This
        test is what keeps a documented rule id from being aspirational."""
        recorded = {r["id"]: r for r in ROMKONTROLL["rejected_generations"]}
        for incident, name in (("13.1", "dataset-not-a-panel"),
                               ("13.2", "placeholder-overview")):
            with self.subTest(incident=incident):
                document = negative(name)
                fires = failed(run(document, profile=PROFILE))
                fires |= failed(run_pair(source(), document))
                claimed = {r for r in recorded[incident]["caught_by"]
                           if r.startswith("R-")}
                self.assertTrue(claimed, incident)
                self.assertEqual(set(), claimed - fires,
                                 f"{incident} credits rules that do not fire")

    def test_the_two_rules_that_do_not_fire_are_not_credited(self):
        """The specific regression: R-B1 needs a file with no binding of any
        kind, R-C4 needs a grid to compare columns in. Both are silent on the
        13.2 file, and the fix was to correct the claim, not to widen the
        rules until the claim became true."""
        recorded = {r["id"]: r for r in ROMKONTROLL["rejected_generations"]}
        credited = set(recorded["13.2"]["caught_by"])
        self.assertNotIn("R-B1", credited)
        self.assertNotIn("R-C4", credited)

    def test_neither_failure_carries_a_table(self):
        for name in ("dataset-not-a-panel", "placeholder-overview"):
            with self.subTest(failure=name):
                document = negative(name)
                env = fixture_builder.envelope_of(document)
                self.assertEqual([], (env or {}).get("panel", {}).get("containers", []))


if __name__ == "__main__":
    unittest.main()
