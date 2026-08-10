"""Regression tests for TEMPLATE-10229 and validate-maskin-panel.py.

Every test but the baselines is a mutation test: it takes the committed
sanitized fixture, breaks exactly one thing, and asserts the validator reports
it. A validator that only ever passes proves nothing, so each rule is exercised
by the defect it exists to catch.

Run:
    python -m unittest tests.test_maskin_10229_contract -v
from the iwmac-designer-reference directory.
"""

import copy
import importlib.util
import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "reference_data" / "maskin-10229-sanitized.json"
PROFILE = "TEMPLATE-10229"


def _load(name, filename):
    """The scripts are hyphenated, so they cannot be imported by name."""
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = _load("validate_maskin_panel", "validate-maskin-panel.py")
RULES = validator.load_rules()
PALETTE = validator.load_palette()
PROFILE_RULES = RULES["profiles"][PROFILE]
MASKIN_RULES = RULES["panel_types"]["maskin"]


def load_fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def run(document, profile=PROFILE):
    return validator.validate(document, profile_name=profile, rules=RULES, palette=PALETTE)


def run_global(document):
    """Panel-type rules only. Used where a mutation would also trip a
    template-geometry rule and make the assertion ambiguous."""
    return run(document, profile=None)


def errors(findings):
    return [f for f in findings if f.severity == "error"]


def warnings(findings):
    return [f for f in findings if f.severity == "warning"]


def fired(findings):
    return {f.rule for f in findings}


def objects_of(document):
    return validator.envelope_of(document)["panel"]["single_objects"]


def find(document, **criteria):
    """Return the one object matching every criterion, or raise."""
    hits = [o for o in objects_of(document)
            if all((o.get(k) or "") == v for k, v in criteria.items())]
    if len(hits) != 1:
        raise AssertionError("expected exactly one object matching %r, found %d"
                             % (criteria, len(hits)))
    return hits[0]


def renumber(document):
    envelope = validator.envelope_of(document)
    objects = envelope["panel"]["single_objects"]
    for index, item in enumerate(objects):
        item["name"] = "object_%d" % index
    envelope["counts"]["single_objects"] = len(objects)
    return document


def remove(document, obj):
    """Drop an object and keep counts and names consistent, so the mutation
    under test is the only thing the validator can complain about."""
    objects = objects_of(document)
    objects.remove(obj)
    return renumber(document)


def add(document, obj):
    objects_of(document).append(obj)
    return renumber(document)


# --------------------------------------------------------------------------
# Baselines. The fixture is the profile's evidence; if it stops validating,
# either the fixture or the contract moved, and the two move together.
# --------------------------------------------------------------------------

class FixtureBaselineTest(unittest.TestCase):

    def test_fixture_validates_clean(self):
        found = errors(run(load_fixture()))
        self.assertEqual([], [f.message for f in found])

    def test_the_only_warning_is_the_documented_duplicate_alias(self):
        """The 10229 export really does carry two boxes on 'Suction temp.
        To-MT'. That is recorded as an anomaly, not silently normalised - so
        the warning must survive, and nothing else may appear beside it."""
        found = warnings(run(load_fixture()))
        self.assertEqual(["M-G05"], sorted(fired(found)))
        self.assertEqual(1, len(found))
        self.assertIn("Suction temp. To-MT", found[0].message)

    def test_fixture_matches_the_recorded_counts(self):
        objects = objects_of(load_fixture())
        self.assertEqual(PROFILE_RULES["object_count"], len(objects))
        self.assertEqual(PROFILE_RULES["distinct_obj_ids"],
                         len({o["obj_id"] for o in objects}))

    def test_every_obj_id_exists_in_the_palette(self):
        missing = sorted({o["obj_id"] for o in objects_of(load_fixture())} - PALETTE)
        self.assertEqual([], missing,
                         "an obj_id absent from the palette renders as a broken box")

    def test_fixture_carries_its_background(self):
        """Every coordinate in the profile was measured against this artwork.
        A fixture without it is a list of numbers with nothing to check against."""
        panel = validator.envelope_of(load_fixture())["panel"]
        self.assertEqual("true", panel["converted"])
        self.assertEqual(PROFILE_RULES["background"]["image_data_chars"],
                         len(panel["image_data"]))

    def test_fixture_drops_the_export_only_trace_field(self):
        panel = validator.envelope_of(load_fixture())["panel"]
        self.assertNotIn("image_svg_trace", panel)

    def test_aliases_survive_sanitization(self):
        """Sanitization strips bindings and keeps aliases, because on Maskin the
        alias IS the Danfoss parameter name and it is what a human relinks by."""
        aliases = [o["alias_text"] for o in objects_of(load_fixture())]
        self.assertEqual(66, len(aliases))
        self.assertEqual(65, len(set(aliases)))
        self.assertTrue(all(a.strip() for a in aliases))

    def test_the_mutation_helpers_do_not_themselves_break_the_panel(self):
        """Guards every other test: remove() must leave a valid panel behind, so
        a reported error is the mutation and not the bookkeeping."""
        document = load_fixture()
        remove(document, find(document, alias_text="Shr2"))
        found = fired(errors(run_global(document)))
        self.assertNotIn("M-S02", found)
        self.assertNotIn("M-S04", found)


# --------------------------------------------------------------------------
# M-S* structure
# --------------------------------------------------------------------------

class StructureRuleTest(unittest.TestCase):

    def test_m_s01_rejects_a_wrong_envelope_format(self):
        document = load_fixture()
        validator.envelope_of(document)["format"] = "iwmac-panel"
        self.assertIn("M-S01", fired(errors(run_global(document))))

    def test_m_s01_rejects_a_wrong_envelope_version(self):
        document = load_fixture()
        validator.envelope_of(document)["version"] = "1"
        self.assertIn("M-S01", fired(errors(run_global(document))))

    def test_m_s02_rejects_a_count_that_disagrees_with_the_array(self):
        document = load_fixture()
        validator.envelope_of(document)["counts"]["single_objects"] = 65
        self.assertIn("M-S02", fired(errors(run_global(document))))

    def test_m_s03_rejects_a_missing_field(self):
        document = load_fixture()
        del find(document, alias_text="Superheat MT")["unit_ref"]
        found = errors(run_global(document))
        self.assertIn("M-S03", fired(found))
        self.assertTrue(any("unit_ref" in f.message for f in found), found)

    def test_m_s04_rejects_non_sequential_names(self):
        document = load_fixture()
        objects_of(document)[7]["name"] = "object_71"
        self.assertIn("M-S04", fired(errors(run_global(document))))

    def test_m_s05_rejects_a_fractional_coordinate(self):
        document = load_fixture()
        find(document, alias_text="Pgc")["posLeft"] = "1057.5"
        self.assertIn("M-S05", fired(errors(run_global(document))))

    def test_m_s05_warns_when_an_object_leaves_the_canvas(self):
        document = load_fixture()
        find(document, alias_text="Pgc")["posLeft"] = 1380
        self.assertIn("M-S05", fired(warnings(run_global(document))))

    def test_m_s06_rejects_mixing_default_with_explicit_bands(self):
        document = load_fixture()
        find(document, alias_text="Pgc")["zIndex"] = "default"
        self.assertIn("M-S06", fired(errors(run_global(document))))

    def test_m_s06_warns_on_a_z_band_outside_the_measured_set(self):
        document = load_fixture()
        find(document, alias_text="Pgc")["zIndex"] = "500"
        found = warnings(run_global(document))
        self.assertIn("M-S06", fired(found))
        self.assertTrue(any("Ventilasjon" in f.message for f in found), found)

    def test_m_s06_warns_when_the_whole_panel_uses_default(self):
        """Legal - the userscript emits it - but then ARRAY ORDER is stacking
        order, which is the trap the message exists to name."""
        document = load_fixture()
        for obj in objects_of(document):
            obj["zIndex"] = "default"
        found = warnings(run_global(document))
        self.assertIn("M-S06", fired(found))
        self.assertTrue(any("ARRAY ORDER" in f.message for f in found), found)

    def test_m_s07_rejects_the_trace_field_in_authored_output(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["image_svg_trace"] = "<svg/>"
        found = errors(run_global(document))
        self.assertIn("M-S07", fired(found))
        self.assertTrue(any("image_svg_trace" in f.message for f in found), found)

    def test_m_s07_only_warns_about_the_trace_field_in_a_host_export(self):
        """Export writes it FOR an AI to read, so a real export carrying it is
        normal. It still must not be committed or handed back."""
        document = load_fixture()
        validator.envelope_of(document)["panel"]["image_svg_trace"] = "<svg/>"
        findings = validator.validate(document, rules=RULES, palette=PALETTE,
                                      mode="production")
        self.assertNotIn("M-S07", fired(errors(findings)))
        self.assertIn("M-S07", fired(warnings(findings)))

    def test_m_s07_rejects_containers_and_graphics(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["containers"] = [{"x": 1}]
        self.assertIn("M-S07", fired(errors(run_global(document))))

    def test_m_s07_warns_when_the_background_is_missing(self):
        document = load_fixture()
        panel = validator.envelope_of(document)["panel"]
        panel["image_data"] = ""
        found = warnings(run_global(document))
        self.assertIn("M-S07", fired(found))
        self.assertTrue(any("unreadable" in f.message for f in found), found)

    def test_m_s07_accepts_a_background_only_patch(self):
        """One of the four request classes: artwork changes, objects do not."""
        document = load_fixture()
        envelope = validator.envelope_of(document)
        envelope["panel"]["single_objects"] = []
        envelope["counts"] = {"single_objects": 0, "containers": 0, "graphics": 0}
        findings = run_global(document)
        self.assertEqual([], errors(findings))
        self.assertIn("M-S01", fired(findings))

    def test_m_s07_rejects_a_background_only_patch_that_lies_about_its_counts(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["single_objects"] = []
        self.assertIn("M-S02", fired(errors(run_global(document))))

    def test_m_s08_rejects_a_linked_flag_on_an_unlinked_demo(self):
        document = load_fixture()
        find(document, alias_text="Superheat MT")["linked"] = "true"
        self.assertIn("M-S08", fired(errors(run_global(document))))

    def test_m_s08_rejects_a_leftover_unit_id_on_an_unlinked_demo(self):
        document = load_fixture()
        find(document, alias_text="Superheat MT")["unit_id"] = "000:060"
        self.assertIn("M-S08", fired(errors(run_global(document))))

    def test_m_s08_rejects_an_empty_alias(self):
        """An unlinked demo with no aliases cannot be relinked afterwards."""
        document = load_fixture()
        find(document, alias_text="Superheat MT")["alias_text"] = ""
        found = errors(run_global(document))
        self.assertIn("M-S08", fired(found))
        self.assertTrue(any("relinks by" in f.message for f in found), found)

    def test_m_s08_rejects_a_plant_id_on_an_unlinked_demo(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["plant_id"] = "10229"
        self.assertIn("M-S08", fired(errors(run_global(document))))

    def test_m_s08_holds_the_host_literals_on_a_production_export(self):
        """The mirror image: the host emits id and link_name on every exported
        object regardless of linking."""
        document = load_fixture()
        for obj in objects_of(document):
            obj["driver_id"] = ""
        find(document, alias_text="Superheat MT")["id"] = ""
        findings = run_global(document)
        self.assertIn("M-S08", fired(errors(findings)))
        self.assertTrue(any("host literal" in f.message for f in errors(findings)))

    def test_m_s09_rejects_degraded_degree_celsius(self):
        document = load_fixture()
        find(document, alias_text="Superheat MT")["alias_text"] = "Superheat MT gr C"
        found = errors(run_global(document))
        self.assertIn("M-S09", fired(found))

    def test_m_s10_rejects_a_personal_identity_in_saved_by(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["saved_by"] = "kari.nordmann"
        found = errors(run_global(document))
        self.assertIn("M-S10", fired(found))
        self.assertTrue(any("live identity" in f.message for f in found), found)

    def test_m_s10_accepts_a_generator_marker_in_saved_by(self):
        """'copilot' and 'user' are the repository's existing markers. They are
        not identities and must not be flagged."""
        for marker in ("copilot", "user", ""):
            document = load_fixture()
            validator.envelope_of(document)["panel"]["saved_by"] = marker
            self.assertNotIn("M-S10", fired(errors(run_global(document))), marker)

    def test_m_s10_rejects_a_live_driver_id(self):
        document = load_fixture()
        find(document, alias_text="Superheat MT")["driver_id"] = "10229_AK3_AKC_0_60_0_206_7"
        found = errors(run_global(document))
        self.assertIn("M-S10", fired(found))
        self.assertTrue(any("live plant binding" in f.message for f in found), found)

    def test_m_s10_rejects_a_plant_prefixed_background_filename(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["org_image_name"] = "10229_maskin_030626.png"
        self.assertIn("M-S10", fired(warnings(run_global(document))))


# --------------------------------------------------------------------------
# M-G* Maskin relationships
# --------------------------------------------------------------------------

class MaskinRelationshipTest(unittest.TestCase):

    def test_m_g01_rejects_an_obj_id_outside_the_catalogue(self):
        document = load_fixture()
        find(document, alias_text="Superheat MT")["obj_id"] = "number_v3_value_only_XL"
        found = errors(run_global(document))
        self.assertIn("M-G01", fired(found))
        self.assertTrue(any("undefined-class box" in f.message for f in found), found)

    def test_m_g02_warns_when_an_object_family_leaves_its_band(self):
        document = load_fixture()
        find(document, alias_text="Superheat MT")["zIndex"] = "360"
        self.assertIn("M-G02", fired(warnings(run_global(document))))

    def test_m_g03_warns_when_a_setpoint_uses_the_measurement_pill(self):
        document = load_fixture()
        find(document, alias_text="Hr reference")["obj_id"] = "number_v3_value_only"
        found = warnings(run_global(document))
        self.assertIn("M-G03", fired(found))
        self.assertTrue(any("Hr reference" in f.message for f in found), found)

    def test_m_g03_warns_when_a_measurement_uses_the_setpoint_pill(self):
        document = load_fixture()
        find(document, alias_text="Superheat MT")["obj_id"] = "number_v3_white_value_only"
        self.assertIn("M-G03", fired(warnings(run_global(document))))

    def test_m_g03_does_not_fire_on_requested_capacity(self):
        """'Requested cap. MT' reads like a setpoint and is a measurement. The
        marker list is deliberately narrower than the word 'request'."""
        found = warnings(run_global(load_fixture()))
        self.assertEqual([], [f for f in found if f.rule == "M-G03"])

    def test_m_g04_rejects_a_compressor_column_missing_its_capacity(self):
        document = load_fixture()
        remove(document, find(document, alias_text="C2 MT capacity"))
        found = errors(run_global(document))
        self.assertIn("M-G04", fired(found))
        self.assertTrue(any("atomic cluster" in f.message for f in found), found)

    def test_m_g04_rejects_a_compressor_column_missing_its_status(self):
        document = load_fixture()
        remove(document, find(document, alias_text="C3 LT status"))
        self.assertIn("M-G04", fired(errors(run_global(document))))

    def test_m_g04_warns_on_a_gap_in_compressor_numbering(self):
        document = load_fixture()
        for row in ("status", "capacity", "Runtime total"):
            remove(document, find(document, alias_text="C2 MT %s" % row))
        found = warnings(run_global(document))
        self.assertIn("M-G04", fired(found))
        self.assertTrue(any("numbered [1, 3]" in f.message for f in found), found)

    def test_m_g04_accepts_a_fixed_speed_compressor_without_a_vsd_row(self):
        """C2 and C3 are fixed-speed on this machine. Their missing VSD row is
        the plant, not a defect."""
        self.assertEqual([], [f for f in errors(run_global(load_fixture()))
                              if f.rule == "M-G04"])

    def test_m_g05_warns_on_a_new_duplicate_alias(self):
        document = load_fixture()
        find(document, alias_text="Superheat LT")["alias_text"] = "Superheat MT"
        found = [f for f in warnings(run_global(document)) if f.rule == "M-G05"]
        self.assertEqual(2, len(found), found)

    def test_m_g06_warns_when_a_suction_group_loses_a_readout(self):
        document = load_fixture()
        remove(document, find(document, alias_text="Superheat LT"))
        found = warnings(run_global(document))
        self.assertIn("M-G06", fired(found))
        self.assertTrue(any("Superheat" in f.message and "LT" in f.message for f in found))

    def test_m_g06_is_silent_when_the_group_is_not_claimed_at_all(self):
        """No LT control-status strip means the panel is not claiming an LT
        circuit, so its absent LT readouts are not a defect."""
        document = load_fixture()
        for alias in ("Control status LT", "Superheat LT", "Ss-LT", "Sd-LT",
                      "Suction ref. To-LT", "Suction temp. To-LT",
                      "Running capacity LT", "Requested cap. LT"):
            remove(document, find(document, alias_text=alias))
        self.assertEqual([], [f for f in warnings(run_global(document))
                              if f.rule == "M-G06"])

    def test_m_g07_warns_when_a_value_pill_is_resized(self):
        document = load_fixture()
        find(document, alias_text="Superheat MT")["posWidth"] = 60
        found = warnings(run_global(document))
        self.assertIn("M-G07", fired(found))
        self.assertTrue(any("toolbox defaults" in f.message for f in found), found)


# --------------------------------------------------------------------------
# M-P* TEMPLATE-10229 geometry
# --------------------------------------------------------------------------

class TemplateProfileTest(unittest.TestCase):

    def test_m_p00_rejects_an_unknown_profile(self):
        findings = validator.validate(load_fixture(), profile_name="TEMPLATE-NOPE",
                                      rules=RULES, palette=PALETTE)
        self.assertIn("M-P00", fired(errors(findings)))

    def test_m_p00_rejects_a_profile_from_another_panel_type(self):
        other = next((name for name, spec in RULES["profiles"].items()
                      if spec.get("panel_type") != "maskin"), None)
        self.assertIsNotNone(other, "expected at least one non-Maskin profile")
        findings = validator.validate(load_fixture(), profile_name=other,
                                      rules=RULES, palette=PALETTE)
        self.assertIn("M-P00", fired(errors(findings)))

    def test_m_p01_rejects_a_substituted_object_family(self):
        """The 'Hr pump speed' role is a custom JSON object on this machine.
        Drawing it as an ordinary value pill loses what the object does."""
        document = load_fixture()
        find(document, alias_text="Hr pump speed")["obj_id"] = "number_v3_value_only"
        found = errors(run(document))
        self.assertIn("M-P01", fired(found))
        self.assertTrue(any("number_v3_custom_json_obj" in f.message for f in found), found)

    def test_m_p02_rejects_a_moved_object(self):
        document = load_fixture()
        find(document, alias_text="Prec")["posTop"] = 400
        found = errors(run(document))
        self.assertIn("M-P02", fired(found))
        self.assertTrue(any("'Prec'" in f.message for f in found), found)

    def test_m_p02_rejects_a_missing_role(self):
        document = load_fixture()
        remove(document, find(document, alias_text="Vrec OD"))
        found = errors(run(document))
        self.assertIn("M-P02", fired(found))
        self.assertTrue(any("'Vrec OD'" in f.message and "missing" in f.message
                            for f in found), found)

    def test_m_p02_keeps_both_boxes_of_the_duplicated_role(self):
        """The duplicate is measured, so dropping one of the two is a change,
        not a cleanup. Role comparison is by multiset, not by first match."""
        document = load_fixture()
        pair = [o for o in objects_of(document)
                if o["alias_text"] == "Suction temp. To-MT"]
        self.assertEqual(2, len(pair))
        remove(document, pair[1])
        self.assertIn("M-P02", fired(errors(run(document))))

    def test_m_p02_warns_about_a_role_the_template_does_not_have(self):
        document = load_fixture()
        find(document, alias_text="Shr2")["alias_text"] = "Shr9"
        self.assertIn("M-P02", fired(warnings(run(document))))

    def test_m_p03_rejects_a_compressor_moved_off_its_column(self):
        document = load_fixture()
        find(document, alias_text="C3 MT status")["posLeft"] = 240
        found = errors(run(document))
        self.assertIn("M-P03", fired(found))
        self.assertTrue(any("C3 MT status" in f.message for f in found), found)

    def test_m_p03_pitch_is_recorded_and_is_not_uniform(self):
        """The measured pitch is not a clean constant. Rounding it to a tidy
        number would move every compressor after the first."""
        pitch = PROFILE_RULES["compressor_columns"]["MT"]["status"]["pitch"]
        self.assertEqual([[79, -1], [82, 1]], pitch)

    def test_m_p04_rejects_a_vsd_row_the_machine_does_not_have(self):
        """Cloning C1 to make another compressor imports its VSD row. C2 and C3
        are fixed-speed."""
        document = load_fixture()
        source = find(document, alias_text="C1 MT VSD 1 speed")
        clone = copy.deepcopy(source)
        clone["alias_text"] = "C2 MT VSD 1 speed"
        clone["posLeft"] = 167
        add(document, clone)
        found = errors(run(document))
        self.assertIn("M-P04", fired(found))
        self.assertTrue(any("fixed-speed" in f.message for f in found), found)

    def test_m_p05_rejects_a_resized_canvas(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["panel_width"] = "1280px"
        found = errors(run(document))
        self.assertIn("M-P05", fired(found))

    def test_m_p05_warns_when_the_background_is_dropped(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["image_data"] = ""
        found = warnings(run(document))
        self.assertIn("M-P05", fired(found))
        self.assertTrue(any("measured against that artwork" in f.message for f in found))


# --------------------------------------------------------------------------
# Generated artifacts must still match their generators.
# --------------------------------------------------------------------------

class GeneratedArtifactTest(unittest.TestCase):

    def test_documentation_rules_matches_its_generator(self):
        """documentation-rules.json is generated from the fixture. Hand-editing
        the Maskin regions is the failure this test exists to catch."""
        result = subprocess.run([sys.executable, str(ROOT / "build-maskin-rules.py"), "--check"],
                                cwd=str(ROOT), capture_output=True, text=True)
        self.assertEqual(0, result.returncode,
                         "run: python build-maskin-rules.py\n" + result.stdout + result.stderr)

    def test_documentation_rules_round_trips_byte_identically(self):
        """Guards the generator's write step: if the on-disk formatting and the
        generator's formatting ever diverge, every regeneration produces a
        whole-file diff and real changes become invisible."""
        path = ROOT / "documentation-rules.json"
        raw = path.read_text(encoding="utf-8")
        again = json.dumps(json.loads(raw), ensure_ascii=False, indent=2) + "\n"
        self.assertEqual(raw, again)

    def test_the_profile_roles_and_the_role_classifier_agree(self):
        """The fixture builder and the rules builder share one definition of a
        role. This asserts they were not forked."""
        builder = _load("build_maskin_fixture", "build-maskin-fixture.py")
        for entry in PROFILE_RULES["objects"]:
            hits = builder.classify(entry["alias_text"])
            self.assertEqual(1, len(hits),
                             "%r classified into %r" % (entry["alias_text"], hits))


if __name__ == "__main__":
    unittest.main()
