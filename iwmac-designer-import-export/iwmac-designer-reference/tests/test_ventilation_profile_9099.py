"""Regression tests for PROFILE-9099-ROTOR-DEMO.

Every test but the baseline is a mutation test: it takes the canonical fixture,
breaks exactly one thing, and asserts the validator reports it as an error. A
validator that only ever passes proves nothing, so each rule is exercised by the
defect it exists to catch.

Run:
    python -m unittest tests.test_ventilation_profile_9099 -v
from the iwmac-designer-reference directory.
"""

import copy
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "ventilation-9099-rotor-demo.json"
PROFILE = "PROFILE-9099-ROTOR-DEMO"


def _load_validator():
    """The validator's filename is hyphenated, so it cannot be imported by name."""
    spec = importlib.util.spec_from_file_location(
        "validate_ventilation_panel", ROOT / "validate-ventilation-panel.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = _load_validator()
RULES = validator.load_rules()
PALETTE = validator.load_palette()
PROFILE_RULES = RULES["profiles"][PROFILE]


def load_fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def run(document):
    return validator.validate(document, profile_name=PROFILE, rules=RULES, palette=PALETTE)


def errors(document):
    return [f for f in run(document) if f.severity == "error"]


def objects_of(document):
    return validator.envelope_of(document)["panel"]["single_objects"]


def find(document, **criteria):
    """Return the one object matching every criterion, or raise."""
    hits = [o for o in objects_of(document)
            if all((o.get(k) or "").strip() == v for k, v in criteria.items())]
    if len(hits) != 1:
        raise AssertionError("expected exactly one object matching %r, found %d"
                             % (criteria, len(hits)))
    return hits[0]


def remove(document, obj):
    """Drop an object and keep counts and names consistent, so the mutation
    under test is the only thing the validator can complain about."""
    envelope = validator.envelope_of(document)
    objects = envelope["panel"]["single_objects"]
    objects.remove(obj)
    renumber(document)
    return document


def renumber(document):
    envelope = validator.envelope_of(document)
    objects = envelope["panel"]["single_objects"]
    for index, item in enumerate(objects):
        item["name"] = "object_%d" % index
    envelope["counts"]["single_objects"] = len(objects)
    return document


def rules_fired(findings):
    return {f.rule for f in findings}


class ProfileFixtureTest(unittest.TestCase):
    """The fixture is the profile's evidence. If it stops validating, either the
    fixture or the contract moved, and the two are supposed to move together."""

    def test_fixture_validates_clean(self):
        findings = run(load_fixture())
        self.assertEqual([], [f.render() if hasattr(f, "render") else str(f.message)
                              for f in findings if f.severity == "error"])

    def test_fixture_matches_the_recorded_object_count(self):
        objects = objects_of(load_fixture())
        self.assertEqual(PROFILE_RULES["object_count"], len(objects))
        self.assertEqual(PROFILE_RULES["distinct_obj_ids"],
                         len({o["obj_id"] for o in objects}))

    def test_every_obj_id_exists_in_the_palette(self):
        missing = sorted({o["obj_id"] for o in objects_of(load_fixture())} - PALETTE)
        self.assertEqual([], missing,
                         "an obj_id absent from the palette renders as a broken box")

    def test_the_mutation_helper_does_not_itself_break_the_panel(self):
        """Guards every other test: remove() must leave a valid panel behind, so
        a reported error is the mutation and not the bookkeeping."""
        document = load_fixture()
        smoke = find(document, obj_id="V3_led_18px_circ_grey_red")
        remove(document, smoke)
        self.assertNotIn("V-S02", rules_fired(errors(document)))
        self.assertNotIn("V-S04", rules_fired(errors(document)))


class ClusterIntegrityTest(unittest.TestCase):
    """A cluster is atomic. Placing the value without the hardware it describes
    is the defect this profile was written to stop."""

    def test_sb510_without_the_circulation_pump_fails(self):
        document = load_fixture()
        pump = find(document, obj_id="V3_21px_single_pump_grey_green_down")
        remove(document, pump)
        found = errors(document)
        self.assertIn("V-P02", rules_fired(found))
        self.assertTrue(any("circulation pump" in f.message for f in found), found)

    def test_sb510_without_the_three_way_valve_fails(self):
        document = load_fixture()
        valve = find(document, obj_id="v3_3w_valve_right_down_nrm")
        remove(document, valve)
        found = errors(document)
        self.assertIn("V-P02", rules_fired(found))
        self.assertTrue(any("valve" in f.message for f in found), found)

    def test_a_fan_without_its_alarm_fails(self):
        document = load_fixture()
        alarm = find(document, alias_text="Alarm,-Common Alarm - extract fan")
        remove(document, alarm)
        self.assertTrue({"V-P02", "V-P06"} & rules_fired(errors(document)))

    def test_moving_one_cluster_member_alone_fails(self):
        """Relocate a cluster with one translation vector applied to every
        member; nudging a single member breaks the recorded offset."""
        document = load_fixture()
        find(document, tag_text="LR501 %")["posTop"] = "250"
        found = errors(document)
        self.assertIn("V-P02", rules_fired(found))
        self.assertTrue(any("offset" in f.message for f in found), found)


class InletDamperTest(unittest.TestCase):

    def test_substituting_the_recirculation_dummy_fails(self):
        document = load_fixture()
        find(document, obj_id="V3_horis_damper_flow-left_nrm")["obj_id"] = \
            "number_v3_dummy_resirc_damp_hor"
        found = errors(document)
        self.assertIn("V-P03", rules_fired(found))
        self.assertTrue(any("prohibit" in f.message for f in found), found)

    def test_a_ka_value_that_is_not_con_down_fails(self):
        document = load_fixture()
        find(document, tag_text="KA501 %")["obj_id"] = "number_v3_R_45px_con_top"
        self.assertTrue({"V-P03", "V-G07"} & rules_fired(errors(document)))

    def test_a_duplicate_ka_position_value_fails(self):
        document = load_fixture()
        envelope = validator.envelope_of(document)
        stale = copy.deepcopy(find(document, tag_text="KA401 %"))
        stale["posTop"] = str(int(stale["posTop"]) + 60)
        envelope["panel"]["single_objects"].append(stale)
        renumber(document)
        found = errors(document)
        self.assertIn("V-G07", rules_fired(found))
        self.assertTrue(any("KA401" in f.message for f in found), found)

    def test_a_damper_with_no_position_value_fails(self):
        document = load_fixture()
        remove(document, find(document, tag_text="KA401 %"))
        self.assertTrue({"V-P03", "V-G07"} & rules_fired(errors(document)))


class FixedObjectTest(unittest.TestCase):

    def test_moving_the_outdoor_temperature_block_fails(self):
        document = load_fixture()
        block = find(document, obj_id="numberV3_outside_temp")
        block["posLeft"], block["posTop"] = "20", "301"
        found = errors(document)
        self.assertIn("V-P04", rules_fired(found))
        self.assertTrue(any("outrank" in f.message for f in found), found)

    def test_the_led_at_the_superseded_position_fails(self):
        document = load_fixture()
        led = find(document, obj_id="V3_led_13px_circ_grey_green")
        led["posLeft"], led["posTop"] = "700", "466"
        found = errors(document)
        self.assertIn("V-P05", rules_fired(found))
        self.assertTrue(any("superseded" in f.message for f in found), found)

    def test_the_led_outside_the_heater_body_fails(self):
        document = load_fixture()
        led = find(document, obj_id="V3_led_13px_circ_grey_green")
        led["posTop"] = "560"
        found = errors(document)
        self.assertIn("V-P05", rules_fired(found))
        self.assertTrue(any("not fully inside" in f.message for f in found), found)


class AlarmTest(unittest.TestCase):

    def test_a_duplicated_alarm_fails(self):
        document = load_fixture()
        envelope = validator.envelope_of(document)
        clone = copy.deepcopy(find(document, alias_text="Alarm,-Common Alarm - cooling"))
        clone["posLeft"] = str(int(clone["posLeft"]) + 30)
        envelope["panel"]["single_objects"].append(clone)
        renumber(document)
        self.assertTrue({"V-G05", "V-P06"} & rules_fired(errors(document)))

    def test_an_alarm_detached_from_its_role_fails(self):
        document = load_fixture()
        alarm = find(document, alias_text="Alarm,-Common Alarm - cooling")
        alarm["posLeft"], alarm["posTop"] = "1000", "700"
        found = errors(document)
        self.assertTrue({"V-G05", "V-P06"} & rules_fired(found))
        self.assertTrue(any("V-G05" == f.rule for f in found),
                        "an alarm far from every component must fail the distance rule")


class SidebarTest(unittest.TestCase):

    def test_a_duplicated_section_header_fails(self):
        document = load_fixture()
        headers = [o for o in objects_of(document)
                   if o["obj_id"] == "number_v3_header_grey75"]
        headers[1]["tag_text"] = headers[0]["tag_text"]
        found = errors(document)
        self.assertIn("V-G06", rules_fired(found))
        self.assertTrue(any("twice" in f.message for f in found), found)

    def test_two_sidebar_objects_at_the_same_coordinate_fail(self):
        document = load_fixture()
        rows = [o for o in objects_of(document)
                if o["obj_id"] == "number_v3_60px_dark_no_conn" and int(o["posLeft"]) >= 1150]
        rows[1]["posLeft"], rows[1]["posTop"] = rows[0]["posLeft"], rows[0]["posTop"]
        self.assertIn("V-G06", rules_fired(errors(document)))

    def test_sidebar_rows_closing_up_vertically_fail(self):
        document = load_fixture()
        labels = sorted((o for o in objects_of(document)
                         if o["obj_id"].startswith("number_v3_label")
                         and int(o["posLeft"]) >= 1150),
                        key=lambda o: (int(o["posTop"]), int(o["posLeft"])))
        # Drag one row up onto the one above it, sharing its x so the columns overlap.
        labels[-1]["posTop"] = str(int(labels[-2]["posTop"]) + 1)
        labels[-1]["posLeft"] = labels[-2]["posLeft"]
        found = errors(document)
        self.assertIn("V-G06", rules_fired(found))
        self.assertTrue(any("px apart" in f.message for f in found), found)

    def test_the_production_alarm_row_is_not_reported(self):
        """A-Alarm and B-Alarm share row y=59 on a 45 px pitch on two plants.
        A width estimate says they nearly touch; the evidence outranks it."""
        findings = run(load_fixture())
        self.assertEqual([], [f for f in findings if "A-Alarm" in f.message])


class AbsentByDesignTest(unittest.TestCase):

    def test_reintroducing_the_cool_caption_fails(self):
        document = load_fixture()
        envelope = validator.envelope_of(document)
        template = copy.deepcopy(find(document, tag_text="Tilluft"))
        template.update(tag_text="Cool", posLeft="464", posTop="412")
        envelope["panel"]["single_objects"].append(template)
        renumber(document)
        found = errors(document)
        self.assertIn("V-P07", rules_fired(found))
        self.assertTrue(any("Cool" in f.message for f in found), found)

    def test_a_navigation_object_with_no_known_target_fails(self):
        document = load_fixture()
        envelope = validator.envelope_of(document)
        nav = copy.deepcopy(find(document, obj_id="numberV3_outside_temp"))
        nav.update(obj_id="sub_page_360_ventilation", tag_text="", posLeft="1160",
                   posTop="600", posWidth="120", posHeight="80", zIndex="20")
        envelope["panel"]["single_objects"].append(nav)
        renumber(document)
        found = errors(document)
        self.assertIn("V-P07", rules_fired(found))
        self.assertTrue(any("navigation" in f.message for f in found), found)

    def test_a_second_filter_pressure_box_fails(self):
        document = load_fixture()
        envelope = validator.envelope_of(document)
        extra = copy.deepcopy(find(document, tag_text="LR501 %"))
        extra.update(tag_text="QD501 Pa", posLeft="520", posTop="200")
        envelope["panel"]["single_objects"].append(extra)
        renumber(document)
        found = errors(document)
        self.assertIn("V-P07", rules_fired(found))
        self.assertTrue(any("QD501" in f.message for f in found), found)


class StructuralTest(unittest.TestCase):
    """These hold for every Ventilasjon panel, profile or not."""

    def test_non_sequential_names_fail(self):
        document = load_fixture()
        objects_of(document)[5]["name"] = "object_99"
        self.assertIn("V-S04", rules_fired(errors(document)))

    def test_duplicate_names_fail(self):
        document = load_fixture()
        objects = objects_of(document)
        objects[5]["name"] = objects[4]["name"]
        self.assertIn("V-S04", rules_fired(errors(document)))

    def test_counts_disagreeing_with_the_arrays_fail(self):
        document = load_fixture()
        validator.envelope_of(document)["counts"]["single_objects"] = 96
        self.assertIn("V-S02", rules_fired(errors(document)))

    def test_mixing_an_explicit_z_index_with_default_fails(self):
        document = load_fixture()
        objects_of(document)[10]["zIndex"] = "default"
        found = errors(document)
        self.assertIn("V-S06", rules_fired(found))
        self.assertTrue(any("default" in f.message for f in found), found)

    def test_image_svg_on_a_ventilation_panel_fails(self):
        document = load_fixture()
        validator.envelope_of(document)["panel"]["image_svg"] = \
            '<svg viewBox="0 0 1400 750"></svg>'
        found = errors(document)
        self.assertIn("V-S07", rules_fired(found))
        self.assertTrue(any("image_svg" in f.message for f in found), found)

    def test_a_surviving_driver_binding_fails(self):
        document = load_fixture()
        objects_of(document)[3]["driver_id"] = "9099_OJEXHAUST_OJ_1_1_0_4_19"
        found = errors(document)
        self.assertIn("V-S08", rules_fired(found))
        self.assertTrue(any("driver_id" in f.message for f in found), found)

    def test_a_surviving_unit_id_fails(self):
        document = load_fixture()
        objects_of(document)[3]["unit_id"] = "000:011"
        self.assertIn("V-S08", rules_fired(errors(document)))

    def test_linked_true_in_an_unlinked_demo_fails(self):
        document = load_fixture()
        objects_of(document)[3]["linked"] = "true"
        self.assertIn("V-S08", rules_fired(errors(document)))

    def test_a_missing_object_field_fails(self):
        document = load_fixture()
        del objects_of(document)[7]["unit_ref"]
        self.assertIn("V-S03", rules_fired(errors(document)))

    def test_degrading_the_degree_sign_fails(self):
        document = load_fixture()
        find(document, tag_text="RT401 °C")["tag_text"] = "RT401 gr C"
        found = errors(document)
        self.assertIn("V-S09", rules_fired(found))
        self.assertTrue(any("gr C" in f.message for f in found), found)

    def test_the_fixture_carries_every_degree_tag_the_evidence_records(self):
        degrees = [o for o in objects_of(load_fixture())
                   if "°C" in (o.get("tag_text") or "")]
        self.assertEqual(RULES["evidence"]["E4"]["degree_tags"], len(degrees))

    def test_an_object_off_canvas_is_reported(self):
        """Off-canvas is a warning, not an error: list panels overflow the
        canvas by design and the host just scrolls. On a Ventilasjon panel it
        is still worth surfacing, so it must not pass silently."""
        document = load_fixture()
        find(document, tag_text="Tilluft")["posLeft"] = "1500"
        found = [f for f in run(document) if f.rule == "V-S05"]
        self.assertTrue(found, "an object outside the canvas must be reported")
        self.assertEqual(["warning"], sorted({f.severity for f in found}))

    def test_a_non_integer_coordinate_fails(self):
        document = load_fixture()
        objects_of(document)[12]["posTop"] = "196.5"
        found = errors(document)
        self.assertIn("V-S05", rules_fired(found))
        self.assertTrue(any("integer" in f.message for f in found), found)


class ConnectorAttachmentTest(unittest.TestCase):

    def test_a_detached_connector_value_fails(self):
        """A value must visibly meet what it describes. A floating bubble is a
        defect, not a style choice."""
        document = load_fixture()
        find(document, tag_text="RT402 °C")["posTop"] = "600"
        found = errors(document)
        self.assertIn("V-G03", rules_fired(found))

    def test_a_connector_pointing_away_from_its_target_fails(self):
        document = load_fixture()
        value = find(document, tag_text="RT510 °C")
        value["obj_id"] = "number_v3_R_45px_con_left"
        self.assertIn("V-G03", rules_fired(errors(document)))


class DuplicateCaptionTest(unittest.TestCase):

    def test_a_free_standing_duplicate_caption_fails(self):
        document = load_fixture()
        envelope = validator.envelope_of(document)
        clone = copy.deepcopy(find(document, tag_text="Tilluft"))
        clone["posTop"] = str(int(clone["posTop"]) + 40)
        envelope["panel"]["single_objects"].append(clone)
        renumber(document)
        found = errors(document)
        self.assertIn("V-G04", rules_fired(found))
        self.assertTrue(any("Tilluft" in f.message for f in found), found)

    def test_the_known_good_sb520_duplication_is_not_reported(self):
        """The AHU controller reuses SB520 for two different powers. Both are
        production-real and carry different alias_text - do not deduplicate."""
        document = load_fixture()
        hits = [o for o in objects_of(document)
                if (o.get("tag_text") or "").strip() == "SB520 %"]
        self.assertEqual(2, len(hits))
        self.assertEqual([], [f for f in run(document) if "SB520" in f.message])


class MeasuredToleranceTest(unittest.TestCase):
    """Pin the one adjacency the evidence cannot settle.

    Contract section 5.9b records an OPEN finding: the fresh-air damper position
    value and the duct outdoor temperature overlap. The overlap is real, it is
    not a production quirk - E2 places KA401 % at (25, 461) as a con_top box -
    and it was introduced by relocating KA401 % per the corrected profile while
    keeping production's duct outdoor temperature where E2 has it.

    Resolving it would mean inventing a coordinate for one of two objects that
    each come from evidence, so nothing was moved. This test exists so that
    nothing moves by accident either: it fails both if someone silently opens
    the gap and if someone widens it, and either way the contract note has to be
    revisited rather than quietly falsified.
    """

    def box(self, document, tag):
        obj = find(document, tag_text=tag)
        left, top = int(obj["posLeft"]), int(obj["posTop"])
        return left, top, left + int(obj["posWidth"]), top + int(obj["posHeight"])

    def test_the_open_ka401_rt901_adjacency_is_unchanged(self):
        document = load_fixture()
        ka = self.box(document, "KA401 %")
        rt = self.box(document, "RT901 \N{DEGREE SIGN}C")
        self.assertEqual((93, 405, 139, 443), ka)
        self.assertEqual((133, 417, 179, 455), rt)

        overlap_x = min(ka[2], rt[2]) - max(ka[0], rt[0])
        overlap_y = min(ka[3], rt[3]) - max(ka[1], rt[1])
        self.assertEqual(
            (6, 26), (overlap_x, overlap_y),
            "The KA401/RT901 overlap changed. That is not automatically wrong, "
            "but it contradicts the OPEN note in VENTILATION-GEOMETRY-CONTRACT.md "
            "section 5.9b. Update the note with the evidence, then update this "
            "test - do not just re-baseline the numbers.")

    def test_the_documented_overlap_is_not_reported_as_an_error(self):
        """It is documented, so it must not also be noise on every run."""
        document = load_fixture()
        found = [f for f in errors(document)
                 if "KA401" in f.message or "RT901" in f.message]
        self.assertEqual([], found, found)


class RuleScopeTest(unittest.TestCase):
    """The global rules must not encode one plant's answer.

    A rule that fires on a production reference is over-generalized: the
    references are evidence, not candidates, and a validator that reports them
    as broken teaches an agent to "correct" the thing it is supposed to copy.
    The committed exports are therefore the corpus the global rules are held
    against, and the profile-scoped rules are the ones allowed to be specific.
    """

    def references(self):
        for path in sorted((ROOT / "reference_data").glob("real-vent-panel-example*.json")):
            yield path, json.loads(path.read_text(encoding="utf-8"))

    def test_the_committed_references_are_recognised_as_production(self):
        """The placeholder is the discriminator. A generated demo emits the
        literal "driver_id" on every object; a production export leaves an
        unlinked object's driver_id EMPTY. Verified across both references and
        the fixture - 0 placeholders on 194 production objects, 97 on 97 demo
        objects - so the split is total, not a heuristic."""
        for path, document in self.references():
            with self.subTest(reference=path.name):
                self.assertEqual("production",
                                 validator.detect_mode(objects_of(document)), path.name)
        self.assertEqual("demo", validator.detect_mode(objects_of(load_fixture())))

    def test_no_global_rule_reports_a_production_reference_as_broken(self):
        for path, document in self.references():
            with self.subTest(reference=path.name):
                found = [f for f in validator.validate(document, rules=RULES, palette=PALETTE)
                         if f.severity == "error"]
                self.assertEqual([], [str(f) for f in found])

    def test_the_profile_geometry_rules_do_not_run_without_a_profile(self):
        """V-P* rules are scoped geometry: they encode where THIS unit's parts
        sit. Running them unasked would universalize 9099 coordinates onto every
        AHU, which is exactly what the scope tags exist to prevent."""
        document = load_fixture()
        find(document, tag_text="LV402")["posLeft"] = "900"
        unscoped = {f.rule for f in validator.validate(document, rules=RULES, palette=PALETTE)}
        self.assertEqual(set(), {r for r in unscoped if r.startswith("V-P")})
        scoped = rules_fired(errors(document))
        self.assertTrue({r for r in scoped if r.startswith("V-P")}, scoped)

    def test_the_demo_binding_contract_is_not_pointed_at_an_export(self):
        """V-S08 is two mirror-image contracts. A demo must carry the literal
        placeholder everywhere; an export must not be judged by that rule at
        all - 45 of E2's objects are linked="true" with an empty driver_id
        because the host sets linked whenever driver_id is not the placeholder
        (V3scripts.js:514). Forcing the demo contract onto one is the bug this
        test pins."""
        path, document = next(iter(self.references()))
        forced = [f for f in validator.validate(document, rules=RULES, palette=PALETTE, mode="demo")
                  if f.rule == "V-S08"]
        self.assertTrue(forced, "the demo contract should reject a production export")
        detected = [f for f in validator.validate(document, rules=RULES, palette=PALETTE)
                    if f.rule == "V-S08"]
        self.assertEqual([], [str(f) for f in detected])

    def test_two_alarms_on_two_like_components_are_not_a_duplicate(self):
        """alias_text is the parameter name, so a unit with two identical
        components repeats it legitimately - E3 guards both dampers with a
        'Malf. damper' alarm. Only two alarms on the SAME component duplicate."""
        for path, document in self.references():
            with self.subTest(reference=path.name):
                found = [f for f in validator.validate(document, rules=RULES, palette=PALETTE)
                         if f.rule == "V-G05" and "guard the same role" in f.message]
                self.assertEqual([], [str(f) for f in found])

    def test_two_alarms_on_one_component_still_fail(self):
        """The other half of the pair above: relaxing the key must not disable
        the rule. Cloning an alarm onto its own component is still a defect."""
        document = load_fixture()
        envelope = validator.envelope_of(document)
        alarm = next(o for o in objects_of(document) if validator.is_alarm(o))
        clone = copy.deepcopy(alarm)
        clone["posLeft"] = str(int(clone["posLeft"]) + 4)
        envelope["panel"]["single_objects"].append(clone)
        renumber(document)
        found = errors(document)
        self.assertIn("V-G05", rules_fired(found))
        self.assertTrue(any("guard the same role" in f.message for f in found), found)


if __name__ == "__main__":
    unittest.main()
