"""Contract tests for the Oversikt panel type and the TEMPLATE-10113 profile.

    cd iwmac-designer-reference
    python -m unittest tests.test_oversikt_10113_contract -v

(`python -m unittest discover -s tests` does not work here: tests/ has no
__init__.py and adding one would change how every other module in it resolves.
Run the modules by name, as the other suites in this directory do.)

Every test but the baselines is a mutation test: it takes the committed
sanitized fixture, breaks exactly one thing, and asserts the validator reports
it. The seven mutations that model the 2026-08-10 incident live in
build-oversikt-negatives.py so the CLI and this suite cannot disagree about
what "a nine-cluster reconstruction" means.

The suite exists because that incident produced two panels that were valid
JSON, rendered without error, and were both wrong. Structural validity was
never the missing control - coverage against the source was.
"""

import collections
import copy
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "reference_data" / "oversikt-10113-sanitized.json"
PROFILE = "TEMPLATE-10113"


def _load(name, filename):
    """The scripts are hyphenated, so they cannot be imported by name."""
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = _load("validate_oversikt_panel", "validate-oversikt-panel.py")
negatives = _load("build_oversikt_negatives", "build-oversikt-negatives.py")
builder = _load("build_oversikt_rules", "build-oversikt-rules.py")
renderer = _load("render_oversikt_panel", "render-oversikt-panel.py")
footprints = _load("build_oversikt_footprints", "build-oversikt-footprints.py")

RULES = validator.load_rules()
PALETTE = validator.load_palette()
OVERSIKT = RULES["panel_types"]["oversikt"]
TEMPLATE = RULES["profiles"][PROFILE]


def source():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def run(document, profile=None):
    return validator.validate(document, profile_name=profile, rules=RULES,
                              palette=PALETTE)


def run_pair(source_doc, candidate_doc, profile=None):
    return validator.validate_pair(source_doc, candidate_doc, profile_name=profile,
                                   rules=RULES, palette=PALETTE)


def errors(findings):
    return [f for f in findings if f.severity == "error"]


def warnings(findings):
    return [f for f in findings if f.severity == "warning"]


def fired(findings):
    return {f.rule for f in findings}


def objects_of(document):
    return validator.objects_of(validator.envelope_of(document))


class FixtureBaselineTest(unittest.TestCase):
    """The committed fixture must pass, or every mutation test below is
    measuring the fixture instead of the mutation."""

    def test_fixture_has_no_errors(self):
        findings = run(source())
        self.assertEqual([], [repr(f) for f in errors(findings)])

    def test_fixture_passes_its_own_profile(self):
        findings = run(source(), PROFILE)
        self.assertEqual([], [repr(f) for f in errors(findings)])

    def test_fixture_is_72_objects_in_21_clusters(self):
        rows = validator.coverage_matrix(source(), RULES)
        self.assertEqual(72, len(objects_of(source())))
        self.assertEqual(21, len(rows))

    def test_fixture_coverage_is_21_21_15_15(self):
        totals = collections.Counter()
        for row in validator.coverage_matrix(source(), RULES):
            totals.update({r: n for r, n in row["roles"].items() if n})
        self.assertEqual({"alarm": 21, "value": 21, "cooling": 15, "defrost": 15},
                         dict(totals))

    def test_every_cluster_is_identified_by_unit_id(self):
        """Not by proximity, and not by driver id here: unit_id resolves all 21.
        If this ever fails, the fallback ordering in controller_key matters and
        the contract's claim that unit_id is enough has stopped being true."""
        rows = validator.coverage_matrix(source(), RULES)
        self.assertEqual({"unit_id"}, {row["identity_from"] for row in rows})

    def test_driver_prefix_fallback_agrees_with_unit_id(self):
        """The documented fallback must not collapse two controllers into one."""
        by_unit, by_prefix = {}, {}
        for obj in objects_of(source()):
            prefix = "_".join(obj["driver_id"].split("_")[:5])
            by_unit.setdefault(obj["unit_id"], set()).add(prefix)
            by_prefix.setdefault(prefix, set()).add(obj["unit_id"])
        self.assertTrue(all(len(v) == 1 for v in by_unit.values()))
        self.assertTrue(all(len(v) == 1 for v in by_prefix.values()))
        self.assertEqual(21, len(by_prefix))

    def test_partial_clusters_are_reported_as_legitimate(self):
        """The rule that must NOT fire. Six controllers expose no cooling or
        defrost relay; padding them to four would invent twelve bindings."""
        findings = run(source())
        partial = [f for f in findings if f.rule == "O-G05"]
        self.assertEqual(1, len(partial))
        self.assertEqual("info", partial[0].severity)
        for controller in ("C50", "C51", "C52", "U86", "U87", "U88"):
            self.assertIn(controller, partial[0].message)

    def test_coincident_cooling_and_defrost_are_not_reported_as_overlap(self):
        """15 pairs share one coordinate on purpose. Reporting them is noise,
        and noise is how the two real cross-controller overlaps get ignored."""
        overlaps = [f for f in run(source()) if f.rule == "O-G07"]
        self.assertEqual(2, len(overlaps))
        for finding in overlaps:
            self.assertIn("object_61", finding.message)

    def test_documented_anomalies_are_still_present_in_the_fixture(self):
        """The inverted U88 cluster and the single-space tag_text are preserved
        production facts, not defects to tidy. If a regeneration silently
        normalised them, the fixture stopped being a production reference."""
        objects = {o["name"]: o for o in objects_of(source())}
        self.assertGreater(int(objects["object_71"]["posTop"]),
                           int(objects["object_70"]["posTop"]))
        spaced = [o for o in objects_of(source()) if o["tag_text"] == " "]
        self.assertEqual(21, len(spaced))


class RulesGeneratorTest(unittest.TestCase):
    """documentation-rules.json is generated. If it drifts from the fixture,
    the validator is enforcing a contract nothing measured."""

    def test_documentation_rules_is_up_to_date(self):
        self.assertEqual(0, builder.main(["--check"]))

    def test_profile_matches_the_fixture_object_for_object(self):
        by_name = {o["name"]: o for o in objects_of(source())}
        self.assertEqual(len(by_name), len(TEMPLATE["objects"]))
        for expected in TEMPLATE["objects"]:
            actual = by_name[expected["name"]]
            self.assertEqual(expected["obj_id"], actual["obj_id"])
            self.assertEqual(expected["left"], int(actual["posLeft"]))
            self.assertEqual(expected["top"], int(actual["posTop"]))

    def test_counts_are_labelled_as_evidence_not_as_targets(self):
        """The single most dangerous thing a fixture can teach is that its own
        numbers are the answer. 21/21/15/15 describes plant 10113 and nothing
        else, and the rules file has to say so where a reader will hit it."""
        text = OVERSIKT["coverage"]["counts_are_evidence_not_targets"]
        self.assertIn("never treat them as a quota", text)
        self.assertIn("ITS OWN source", text)
        self.assertIn("does NOT apply to another store", TEMPLATE["applies_when"])

    def test_the_four_cluster_roles_are_the_measured_obj_ids(self):
        self.assertEqual(
            [("alarm", "V3_R_34px_circular_alarm_nrm"),
             ("value", "number_v3_40px_no_conn_no_tag"),
             ("cooling", "V3_R_28px_circular_cooling_nrm"),
             ("defrost", "V3_R_28px_circular_defrost_nrm")],
            [(e["role"], e["obj_id"]) for e in OVERSIKT["cluster"]["roles"]])

    def test_recorded_conflicts_are_scoped_and_not_averaged(self):
        """OV-C1 and OV-C3 record fleet figures that disagree with this panel;
        OV-C4 records two different answers to what the value object is
        positioned against. All survive with a scope; none is merged into a
        mean."""
        conflicts = {c["id"]: c for c in OVERSIKT["conflicts"]}
        self.assertEqual({"OV-C1", "OV-C2", "OV-C3", "OV-C4"}, set(conflicts))
        for conflict in conflicts.values():
            self.assertTrue(conflict["claim_a"]["scope"])
            self.assertTrue(conflict["claim_b"]["scope"])
            self.assertTrue(conflict["resolution"])


class StructureRuleTest(unittest.TestCase):
    """O-S*: things true of any panel document."""

    def test_count_mismatch_is_an_error(self):
        document = source()
        validator.envelope_of(document)["counts"]["single_objects"] = 71
        self.assertIn("O-S02", fired(errors(run(document))))

    def test_missing_field_is_an_error(self):
        document = source()
        del objects_of(document)[0]["unit_ref"]
        self.assertIn("O-S03", fired(errors(run(document))))

    def test_duplicate_name_is_an_error(self):
        document = source()
        objects_of(document)[1]["name"] = objects_of(document)[0]["name"]
        self.assertIn("O-S04", fired(errors(run(document))))

    def test_object_outside_the_canvas_is_an_error(self):
        document = source()
        objects_of(document)[0]["posLeft"] = 1390
        self.assertIn("O-S05", fired(errors(run(document))))

    def test_missing_background_is_an_error(self):
        findings = run(negatives.missing_background())
        self.assertIn("O-S07", fired(errors(findings)))

    def test_image_svg_trace_must_not_be_emitted(self):
        document = source()
        validator.envelope_of(document)["panel"]["image_svg_trace"] = "<svg/>"
        self.assertIn("O-S08", fired(errors(run(document))))

    def test_driver_id_without_linked_is_an_error(self):
        document = source()
        objects_of(document)[0]["linked"] = "false"
        self.assertIn("O-S09", fired(errors(run(document))))

    def test_unknown_obj_id_is_an_error(self):
        document = source()
        objects_of(document)[0]["obj_id"] = "not_a_real_object"
        self.assertIn("O-S10", fired(errors(run(document))))


class ClusterRuleTest(unittest.TestCase):
    """O-G*: things true of an Oversikt specifically."""

    def test_object_with_no_identity_is_an_error(self):
        document = source()
        objects_of(document)[0]["unit_id"] = ""
        objects_of(document)[0]["driver_id"] = "driver_id"
        self.assertIn("O-G01", fired(errors(run(document))))

    def test_torn_cluster_is_an_error(self):
        """One member dragged away from the rest. The cluster still has its
        four objects and its bindings; it now reads as two positions."""
        document = source()
        for obj in objects_of(document):
            if obj["unit_id"] == "000:011" and obj["obj_id"].endswith("alarm_nrm"):
                obj["posTop"] = int(obj["posTop"]) + 300
        self.assertIn("O-G03", fired(errors(run(document))))

    def test_duplicated_cluster_is_an_error(self):
        findings = run(negatives.duplicate_cluster())
        self.assertIn("O-G04", fired(errors(findings)))

    def test_dashboard_grid_is_an_error(self):
        """The v1 failure. Every object, every binding and the background are
        intact; only the geometry changed, and the panel is worthless."""
        findings = run(negatives.dashboard_regrouping())
        grid = [f for f in errors(findings) if f.rule == "O-G06"]
        self.assertEqual(1, len(grid))
        self.assertIn("MAP", grid[0].message)

    def test_the_fixture_is_not_mistaken_for_a_grid(self):
        self.assertNotIn("O-G06", fired(run(source())))

    def test_a_real_overlap_is_a_warning(self):
        document = source()
        objects_of(document)[0]["posLeft"] = int(objects_of(document)[4]["posLeft"])
        objects_of(document)[0]["posTop"] = int(objects_of(document)[4]["posTop"])
        self.assertIn("O-G07", fired(warnings(run(document))))

    def test_stripped_links_destroy_the_inventory(self):
        findings = run(negatives.stripped_links())
        self.assertIn("O-G01", fired(errors(findings)))


class TemplateProfileTest(unittest.TestCase):
    """O-P*: things true only of TEMPLATE-10113."""

    def test_unknown_profile_is_an_error(self):
        self.assertIn("O-P00", fired(errors(run(source(), "TEMPLATE-NOPE"))))

    def test_a_maskin_profile_is_rejected_for_an_oversikt(self):
        self.assertIn("O-P00", fired(errors(run(source(), "TEMPLATE-10229"))))

    def test_nine_cluster_reconstruction_fails_against_the_profile(self):
        findings = run(negatives.nine_cluster_reconstruction(), PROFILE)
        missing = [f for f in errors(findings) if f.rule == "O-P03"]
        self.assertTrue(missing)
        for controller in ("C50", "C51", "C52", "U86", "U87", "U88",
                           "000:001", "000:002", "000:010", "000:066",
                           "000:067", "000:085"):
            self.assertIn(controller, missing[0].message)

    def test_moved_cluster_fails_against_the_profile(self):
        findings = run(negatives.cluster_out_of_room(), PROFILE)
        self.assertIn("O-P06", fired(errors(findings)))

    def test_forced_four_object_coverage_fails_against_the_profile(self):
        findings = run(negatives.forced_four_object(), PROFILE)
        coverage = [f for f in errors(findings) if f.rule == "O-P04"]
        self.assertEqual(6, len(coverage))

    def test_a_different_background_is_reported(self):
        document = source()
        panel = validator.envelope_of(document)["panel"]
        panel["image_data"] = panel["image_data"][:-40]
        self.assertIn("O-P08", fired(run(document, PROFILE)))


class CompareModeTest(unittest.TestCase):
    """O-C*: the control that was missing on 2026-08-10.

    Three of the seven negatives are clean in --check with no profile, and that
    is honest: a candidate alone cannot prove it lost a controller it never
    mentions. Only the source can.
    """

    def test_identical_documents_compare_clean(self):
        findings = run_pair(source(), source())
        self.assertEqual([], [repr(f) for f in errors(findings)])

    def test_nine_cluster_reconstruction_lists_every_missing_controller(self):
        candidate = negatives.nine_cluster_reconstruction()
        findings = run_pair(source(), candidate)
        self.assertIn("O-C01", fired(errors(findings)))
        missing = [f for f in errors(findings) if f.rule == "O-C03"]
        self.assertEqual(1, len(missing))
        self.assertIn("12 of 21", missing[0].message)
        for controller in ("C50", "C51", "C52", "U86", "U87", "U88",
                           "000:001", "000:002", "000:010", "000:066",
                           "000:067", "000:085"):
            self.assertIn(controller, missing[0].message)

    def test_nine_cluster_reconstruction_is_clean_in_plain_check(self):
        """Documented limitation, asserted so it stays documented: without the
        source or the profile, 9 well-formed clusters look like a 9-cluster
        store. This is why --compare exists and why the contract routes a
        supplied production JSON to preserve-and-patch."""
        self.assertEqual([], errors(run(negatives.nine_cluster_reconstruction())))

    def test_dashboard_regrouping_reports_every_relocated_cluster(self):
        findings = run_pair(source(), negatives.dashboard_regrouping())
        moved = [f for f in errors(findings) if f.rule == "O-C06"]
        self.assertEqual(21, len(moved))

    def test_cluster_out_of_room_is_an_error_in_compare(self):
        findings = run_pair(source(), negatives.cluster_out_of_room())
        moved = [f for f in errors(findings) if f.rule == "O-C06"]
        self.assertEqual(1, len(moved))
        self.assertIn("000:030", moved[0].message)
        self.assertIn("(+400,+300)", moved[0].message)

    def test_a_nudge_is_only_a_warning(self):
        """A layout tidy-up inside the noise floor is not a lost cluster, and
        calling it one would teach a reader to ignore O-C06."""
        candidate = negatives.cluster_out_of_room(controller="000:030", dx=4, dy=0)
        findings = run_pair(source(), candidate)
        self.assertNotIn("O-C06", fired(errors(findings)))
        self.assertIn("O-C06", fired(warnings(findings)))

    def test_stripped_links_are_an_error_in_compare(self):
        findings = run_pair(source(), negatives.stripped_links())
        self.assertIn("O-C07", fired(errors(findings)))
        self.assertIn("O-C08", fired(errors(findings)))

    def test_missing_background_is_an_error_in_compare(self):
        findings = run_pair(source(), negatives.missing_background())
        self.assertIn("O-C13", fired(errors(findings)))

    def test_forced_four_object_changes_coverage_on_every_partial_cluster(self):
        findings = run_pair(source(), negatives.forced_four_object())
        coverage = [f for f in errors(findings) if f.rule == "O-C05"]
        self.assertEqual(6, len(coverage))
        for finding in coverage:
            self.assertIn("four objects per controller is not a rule", finding.message)

    def test_duplicate_cluster_changes_coverage(self):
        findings = run_pair(source(), negatives.duplicate_cluster())
        self.assertIn("O-C05", fired(errors(findings)))

    def test_retyping_an_object_is_an_error(self):
        """A purpose-built symbol swapped for another object at the same
        position, with the same binding. Reported as a retype, not as a drop
        plus a mystery addition - the reviewer needs to know what replaced
        what."""
        candidate = source()
        objects_of(candidate)[0]["obj_id"] = "number_v3_40px_no_conn_no_tag"
        findings = run_pair(source(), candidate)
        retyped = [f for f in errors(findings) if f.rule == "O-C09"]
        self.assertEqual(1, len(retyped))
        self.assertIn("V3_R_34px_circular_alarm_nrm -> number_v3_40px_no_conn_no_tag",
                      retyped[0].message)
        self.assertNotIn("O-C01", fired(findings))

    def test_canvas_change_is_an_error(self):
        candidate = source()
        validator.envelope_of(candidate)["panel"]["panel_width"] = "1200px"
        self.assertIn("O-C15", fired(errors(run_pair(source(), candidate))))

    def test_matching_is_not_by_array_index(self):
        """Reverse the array, renumber as the host does on insert, change
        nothing else. An index-based diff would call this 72 rewritten objects
        and 72 relinked bindings; the real answer is a reorder."""
        candidate = source()
        panel = validator.envelope_of(candidate)["panel"]
        panel["single_objects"] = list(reversed(panel["single_objects"]))
        negatives.renumber(candidate)
        findings = run_pair(source(), candidate)
        for rule in ("O-C01", "O-C02", "O-C05", "O-C06", "O-C07", "O-C08", "O-C09"):
            self.assertNotIn(rule, fired(findings))
        self.assertIn("O-C12", fired(warnings(findings)))


class NegativeGeneratorTest(unittest.TestCase):
    """The negatives themselves: each must break one thing and only one."""

    def test_all_seven_are_registered(self):
        self.assertEqual(
            {"dashboard-regrouping", "nine-cluster-reconstruction",
             "cluster-out-of-room", "duplicate-cluster", "stripped-links",
             "missing-background", "forced-four-object"},
            set(negatives.NEGATIVES))

    def test_every_negative_fails_compare_against_the_fixture(self):
        for name in sorted(negatives.NEGATIVES):
            with self.subTest(negative=name):
                findings = run_pair(source(), negatives.build(name))
                self.assertTrue(errors(findings),
                                f"{name} produced no error in compare mode")

    def test_dashboard_regrouping_keeps_every_object_and_binding(self):
        """If this ever stops being true the fixture is testing the wrong
        thing: the point of the v1 failure is that nothing was missing."""
        candidate = negatives.dashboard_regrouping()
        self.assertEqual(72, len(objects_of(candidate)))
        before = {o["driver_id"] for o in objects_of(source())}
        after = {o["driver_id"] for o in objects_of(candidate)}
        self.assertEqual(before, after)

    def test_forced_four_object_adds_exactly_twelve_objects(self):
        self.assertEqual(84, len(objects_of(negatives.forced_four_object())))

    def test_negatives_do_not_touch_the_committed_fixture(self):
        before = FIXTURE.read_bytes()
        for name in sorted(negatives.NEGATIVES):
            negatives.build(name)
        self.assertEqual(before, FIXTURE.read_bytes())


class ValueCenteringTest(unittest.TestCase):
    """O-G08/O-G09/O-G10: the sidecar contract.

    Two halves, and the second is the one that keeps the validator honest. A
    panel JSON carries no equipment-box boundaries, so without --footprints the
    validator must say it proved nothing rather than fall silent - silence in a
    tool that reports 0 errors reads as a pass, and "the temperature bubbles are
    centred" is precisely the claim a structural run cannot make.

    The synthetic sidecar these tests run against was derived FROM the fixture's
    value objects, so it proves the arithmetic and nothing about the store. That
    is all a unit test can prove here; the real answer is a measurement, and the
    real check is a pair of eyes on a controller-level crop.
    """

    def synthetic(self, **kwargs):
        return footprints.build(source(), synthetic=True, **kwargs)

    def run_with(self, sidecar, document=None, tolerance=None):
        return validator.validate(
            document or source(), rules=RULES, palette=PALETTE, footprints=sidecar,
            **({"tolerance": tolerance} if tolerance is not None else {}))

    def test_without_the_flag_the_validator_says_it_proved_nothing(self):
        findings = run(source())
        notes = [f for f in findings if f.rule == "O-G08"]
        self.assertEqual(1, len(notes))
        self.assertEqual("info", notes[0].severity)
        self.assertIn("proves NOTHING", notes[0].message)

    def test_a_centred_panel_raises_no_centering_error(self):
        findings = self.run_with(self.synthetic())
        self.assertEqual([], [repr(f) for f in errors(findings)])
        summary = [f for f in findings if f.rule == "O-G08"]
        self.assertEqual(1, len(summary))
        self.assertIn("21 of 21", summary[0].message)

    def test_a_nudge_warns_and_a_shove_errors(self):
        """The middle verdict is the one that matters. Two pixels is the slack
        of a hand-dragged object; forty is the bubble on a different part of
        the equipment, which is the 2026-08-11 correction."""
        for offset, severity in ((3, "warning"), (40, "error")):
            with self.subTest(offset=offset):
                document = source()
                value = self.first_value(document)
                value["posLeft"] = validator.as_int(value["posLeft"]) + offset
                # widen the footprint so the centre stays inside it: this test
                # is about drift, not about landing off the box entirely
                sidecar = self.synthetic(margin=200)
                findings = self.run_with(sidecar, document)
                hit = [f for f in findings if f.rule == "O-G08" and "off-centre" in f.message]
                self.assertEqual(1, len(hit))
                self.assertEqual(severity, hit[0].severity)

    def test_a_value_box_off_the_equipment_is_always_an_error(self):
        """Not a big drift - a different kind of failure. The bubble is on the
        label, the aisle or the floor, and no tolerance makes that acceptable."""
        document = source()
        value = self.first_value(document)
        value["posLeft"] = validator.as_int(value["posLeft"]) + 400
        findings = self.run_with(self.synthetic(), document, tolerance=1000)
        outside = [f for f in errors(findings) if "OUTSIDE" in f.message]
        self.assertEqual(1, len(outside))
        self.assertIn("not on the box", outside[0].message)

    def test_production_proven_records_never_demand_a_correction(self):
        """A supplied production export is rank 1 and outranks a measurement.
        A validator that told an author to 'correct' a real panel into
        geometric tidiness would teach the failure this repository documents."""
        document = source()
        value = self.first_value(document)
        value["posLeft"] = validator.as_int(value["posLeft"]) + 400
        findings = self.run_with(self.synthetic(production_proven=True), document)
        # O-G03 still fires - a cluster torn 400px apart is a separate defect,
        # and production_proven speaks only for the centering verdict.
        self.assertEqual([], [repr(f) for f in errors(findings) if f.rule == "O-G08"])
        recorded = [f for f in findings if "RECORDED, not corrected" in f.message]
        self.assertEqual(1, len(recorded))
        self.assertEqual("info", recorded[0].severity)

    def test_unmeasured_controllers_are_a_gap_not_a_pass(self):
        sidecar = footprints.build(source(), synthetic=True, only=["000:011"])
        findings = self.run_with(sidecar)
        gaps = [f for f in findings if f.rule == "O-G09" and "evidence gap" in f.message]
        self.assertEqual(1, len(gaps))
        self.assertIn("20 controller(s) have no measured footprint", gaps[0].message)
        self.assertNotIn("O-G08", fired(errors(findings)))

    def test_an_unfilled_template_does_not_validate(self):
        """The generator emits 0x0 footprints on purpose. An unmeasured
        template must fail loudly, not report that nothing is wrong."""
        findings = self.run_with(footprints.build(source()))
        zero = [f for f in errors(findings) if "has no centre" in f.message]
        self.assertEqual(21, len(zero))

    def test_a_synthetic_sidecar_says_so_rather_than_passing_quietly(self):
        """It is back-derived from the panel's own value objects, so O-G08
        passes by construction. A run that reported that as a clean centering
        check would launder instrumentation into evidence - and the file the
        generator writes is the easiest sidecar in the repository to produce."""
        findings = self.run_with(self.synthetic())
        warned = [f for f in findings if f.rule == "O-G09" and "SYNTHETIC" in f.message]
        self.assertEqual(1, len(warned))
        self.assertEqual("warning", warned[0].severity)
        self.assertIn("proves nothing about the artwork", warned[0].message)
        self.assertTrue(validator.is_synthetic(self.synthetic()))

    def test_a_measured_sidecar_is_not_accused_of_being_synthetic(self):
        sidecar = self.synthetic()
        sidecar["synthetic"] = False
        sidecar["source"] = "background-image"
        for record in sidecar["records"]:
            record["source"] = "background-image"
        findings = self.run_with(sidecar)
        self.assertEqual([], [f.message for f in findings
                              if f.rule == "O-G09" and "SYNTHETIC" in f.message])
        self.assertFalse(validator.is_synthetic(sidecar))

    def test_a_measurement_of_another_panel_is_rejected(self):
        for mutate, rule, phrase in (
                (lambda d: d["records"][0].__setitem__("unit_id", "999:999"),
                 "O-G09", "no such controller"),
                (lambda d: d["records"].append(dict(d["records"][0])),
                 "O-G09", "measured twice"),
                (lambda d: d.__setitem__("panel_size", [800, 600]),
                 "O-G10", "different panel"),
                (lambda d: d.__setitem__("source_image_size", None),
                 "O-G10", "not evidence"),
                (lambda d: d.__setitem__("format", "something-else"),
                 "O-G09", "expected 'iwmac-oversikt-footprints'"),
                (lambda d: d.__setitem__("records", []),
                 "O-G09", "carries no records")):
            with self.subTest(phrase=phrase):
                sidecar = self.synthetic()
                mutate(sidecar)
                findings = self.run_with(sidecar)
                hit = [f for f in errors(findings)
                       if f.rule == rule and phrase in f.message]
                self.assertTrue(hit, f"nothing reported {phrase!r}")

    def test_a_self_contradicting_record_is_rejected_before_it_is_used(self):
        """Both numbers are in the file and they disagree. Picking either one
        would be a confident wrong answer, which is what this namespace exists
        to prevent."""
        sidecar = self.synthetic()
        sidecar["records"][0]["expected_value_position"] = {"left": 1, "top": 1}
        findings = self.run_with(sidecar)
        hit = [f for f in errors(findings) if "contradicts itself" in f.message]
        self.assertEqual(1, len(hit))

    def test_a_footprint_measured_at_another_resolution_is_scaled_not_refused(self):
        """The background is often measured at its natural size and shown
        scaled. Doubling the resolution and the footprint together must land on
        the same canvas coordinate, and the scale must be stated once."""
        sidecar = self.synthetic()
        sidecar["source_image_size"] = [2800, 1500]
        for record in sidecar["records"]:
            record["footprint"] = {k: v * 2 for k, v in record["footprint"].items()}
            record.pop("expected_value_position", None)
        findings = self.run_with(sidecar)
        self.assertEqual([], [repr(f) for f in errors(findings)])
        scale = [f for f in findings if f.rule == "O-G10"]
        self.assertEqual(1, len(scale), "the scale note must be stated once, not per record")
        self.assertIn("scale_x=0.5", scale[0].message)

    def test_half_up_rounding_not_bankers(self):
        """round(2.5) is 2 in Python. A centering formula rounded that way
        lands a pixel left of centre on every other even-width footprint."""
        self.assertEqual([1, 2, 3, -3], [validator.half_up(v)
                                         for v in (0.5, 1.5, 2.5, -2.5)])
        self.assertEqual(validator.half_up(2.5), footprints.half_up(2.5))
        self.assertEqual(validator.half_up(2.5), renderer.half_up(2.5))

    def test_an_odd_footprint_centres_the_same_way_everywhere(self):
        """The three implementations must agree to the pixel, or the preview
        would show a gap where the validator reports a pass."""
        sidecar = footprints.build(source(), synthetic=True, margin=15, only=["000:011"])
        record = sidecar["records"][0]
        record["footprint"]["width"] += 1
        record["footprint"]["height"] += 1
        record.pop("expected_value_position")
        roles = renderer.load_roles()
        clusters = renderer.clusters_of(renderer.objects_of(source()), roles)
        drawn = renderer.footprint_geometry(sidecar, clusters, roles, 1400, 750)
        box = record["footprint"]
        expected = (validator.half_up(box["left"] + (box["width"] - 42) / 2),
                    validator.half_up(box["top"] + (box["height"] - 22) / 2))
        self.assertEqual(expected, drawn["000:011"]["expected"])

    @staticmethod
    def first_value(document):
        for obj in objects_of(document):
            if obj["obj_id"] == "number_v3_40px_no_conn_no_tag":
                return obj
        raise AssertionError("the fixture has no value object")


class FootprintGeneratorTest(unittest.TestCase):
    """The sidecar generator emits only what the panel proves, and labels the
    one thing it makes up."""

    def test_template_records_every_controller_with_a_value_object(self):
        document = footprints.build(source())
        self.assertEqual(21, len(document["records"]))
        self.assertEqual("iwmac-oversikt-footprints", document["format"])
        self.assertEqual([1400, 750], document["panel_size"])
        for record in document["records"]:
            self.assertEqual({"left": 0, "top": 0, "width": 0, "height": 0},
                             record["footprint"])
            self.assertEqual([42, 22], record["value_object_size"])

    def test_the_background_resolution_is_read_from_the_png_not_assumed(self):
        """The one thing about the artwork a panel genuinely proves. Assuming
        the canvas size instead would silently claim a 1:1 scale that may not
        hold."""
        panel = validator.envelope_of(source())["panel"]
        self.assertEqual([1400, 750], footprints.png_size(panel["image_data"]))
        self.assertIsNone(footprints.png_size(None))
        self.assertIsNone(footprints.png_size("data:image/png;base64,notpng"))

    def test_a_panel_with_no_embedded_png_leaves_the_resolution_unstated(self):
        document = footprints.build(negatives.missing_background())
        self.assertIsNone(document["source_image_size"])
        self.assertIn("could NOT be read", document["_note"])

    def test_synthetic_output_is_labelled_as_instrumentation_everywhere(self):
        document = footprints.build(source(), synthetic=True)
        self.assertTrue(document["synthetic"])
        self.assertEqual("synthetic-back-derived", document["source"])
        self.assertIn("NOT A MEASUREMENT", document["_note"])
        for record in document["records"]:
            self.assertIn("SYNTHETIC", record["evidence_note"])

    def test_synthetic_geometry_round_trips_for_any_margin(self):
        for margin in (0, 1, 7, 24, 133):
            with self.subTest(margin=margin):
                document = footprints.build(source(), synthetic=True, margin=margin)
                findings = validator.validate(source(), rules=RULES, palette=PALETTE,
                                              footprints=document)
                self.assertEqual([], [repr(f) for f in errors(findings)])

    def test_an_unknown_controller_is_refused_rather_than_silently_dropped(self):
        with self.assertRaises(SystemExit):
            footprints.build(source(), only=["999:999"])


class PatchScopeTest(unittest.TestCase):
    """O-C16: a centering patch may move value objects and change nothing else.

    The rule exists because 'I only fixed the placement' is unfalsifiable by
    eye across 128 objects. Every other difference - a resized bubble, a
    rewritten alias, a nudged alarm - has to be disclosed and justified
    separately, not carried in under a geometry correction.
    """

    def centering_patch(self, dx=6, dy=-4):
        candidate = source()
        for obj in objects_of(candidate):
            if obj["obj_id"] == "number_v3_40px_no_conn_no_tag":
                obj["posLeft"] = validator.as_int(obj["posLeft"]) + dx
                obj["posTop"] = validator.as_int(obj["posTop"]) + dy
        return candidate

    def run_scope(self, candidate, scope="value-position"):
        return validator.validate_pair(source(), candidate, rules=RULES,
                                       palette=PALETTE, patch_scope=scope)

    def test_a_pure_centering_patch_holds_the_scope(self):
        findings = self.run_scope(self.centering_patch())
        self.assertEqual([], [f for f in errors(findings) if f.rule == "O-C16"])
        held = [f for f in findings if f.rule == "O-C16"]
        self.assertEqual(1, len(held))
        self.assertIn("held", held[0].message)

    def test_moving_any_other_role_exceeds_the_scope(self):
        candidate = self.centering_patch()
        for obj in objects_of(candidate):
            if obj["obj_id"] == "V3_R_34px_circular_alarm_nrm":
                obj["posLeft"] = validator.as_int(obj["posLeft"]) + 9
                break
        breaches = [f for f in errors(self.run_scope(candidate)) if f.rule == "O-C16"]
        self.assertTrue(any("alarm).posLeft" in f.message for f in breaches))

    def test_resizing_the_value_object_exceeds_the_scope(self):
        """The formula uses the object's proven size. Forcing 42x22 onto a
        panel that uses another size is the silent change the scope catches."""
        candidate = self.centering_patch()
        for obj in objects_of(candidate):
            if obj["obj_id"] == "number_v3_40px_no_conn_no_tag":
                obj["posWidth"] = 60
                break
        breaches = [f for f in errors(self.run_scope(candidate)) if f.rule == "O-C16"]
        self.assertTrue(any("posWidth" in f.message for f in breaches))

    def test_a_rewritten_binding_is_reported_by_scope_as_well_as_by_coverage(self):
        candidate = self.centering_patch()
        objects_of(candidate)[0]["alias_text"] = "RENAMED BY THE PATCH"
        breaches = [f for f in errors(self.run_scope(candidate)) if f.rule == "O-C16"]
        self.assertTrue(any("alias_text" in f.message for f in breaches))

    def test_scope_none_forbids_every_difference(self):
        breaches = [f for f in errors(self.run_scope(self.centering_patch(), "none"))
                    if f.rule == "O-C16"]
        self.assertTrue(breaches)

    def test_scope_position_allows_a_whole_cluster_to_move(self):
        """A cluster on the wrong case is moved as a unit, and that is a
        different patch from a centering correction. The looser scope exists so
        it can be declared, not so a centering patch can hide in it."""
        candidate = negatives.cluster_out_of_room()
        loose = [f for f in errors(self.run_scope(candidate, "position"))
                 if f.rule == "O-C16"]
        strict = [f for f in errors(self.run_scope(candidate, "value-position"))
                  if f.rule == "O-C16"]
        self.assertEqual([], loose)
        self.assertTrue(strict)

    def test_the_scope_check_is_silent_when_no_scope_is_declared(self):
        findings = run_pair(source(), self.centering_patch())
        self.assertNotIn("O-C16", fired(findings))


class RendererTest(unittest.TestCase):
    """The preview is the only check that can see placement, so it has to
    actually draw the background and every object."""

    def test_preview_embeds_the_real_background_and_every_object(self):
        page = renderer.render(source(), "fixture")
        self.assertIn('--bg: url("data:image/', page)
        # one full panel plus one pane per cluster
        self.assertEqual(72 * 22, page.count('class="o"'))
        self.assertEqual(21 * 22, page.count('class="c"'))

    def test_preview_ghosts_show_lost_controllers(self):
        page = renderer.render(negatives.nine_cluster_reconstruction(),
                               "candidate", source())
        self.assertIn("12 source controller(s) have no cluster", page)

    def test_preview_says_so_when_the_background_is_missing(self):
        page = renderer.render(negatives.missing_background(), "candidate")
        self.assertIn("NO BACKGROUND", page)

    def test_preview_draws_no_footprint_furniture_without_the_sidecar(self):
        page = renderer.render(source(), "fixture")
        for marker in ('class="fp"', 'class="fpe"', 'class="fpx"', 'id="fp"'):
            self.assertNotIn(marker, page)

    def test_preview_draws_the_measured_box_its_centre_and_the_centred_value(self):
        sidecar = footprints.build(source(), synthetic=True)
        page = renderer.render(source(), "fixture", None, sidecar)
        for marker in ('class="fp"', 'class="fpe"', 'class="fpx"'):
            self.assertEqual(21 * 22, page.count(marker), marker)
        self.assertIn("MEASUREMENT SOMEBODY MADE", page)

    def test_preview_shouts_when_the_sidecar_is_synthetic(self):
        """The overlay is persuasive. A picture built from the placement it
        appears to verify has to say so on its face."""
        sidecar = footprints.build(source(), synthetic=True)
        self.assertIn("this sidecar is SYNTHETIC",
                      renderer.render(source(), "fixture", None, sidecar))

    def test_preview_names_the_unmeasured_controllers(self):
        sidecar = footprints.build(source(), synthetic=True, only=["000:011"])
        page = renderer.render(source(), "fixture", None, sidecar)
        self.assertIn("1 of 21 controller(s) measured", page)
        self.assertIn("unmeasured, and therefore unproven, not passed", page)

    def test_preview_crop_widens_to_show_a_footprint_the_value_box_missed(self):
        """A bubble dropped on the label beside its case is exactly the defect
        worth seeing, and a crop cut to the cluster alone would show the bubble
        and not the box."""
        sidecar = footprints.build(source(), synthetic=True, only=["000:011"])
        sidecar["records"][0]["footprint"] = {"left": 500, "top": 400,
                                              "width": 120, "height": 90}
        roles = renderer.load_roles()
        clusters = renderer.clusters_of(renderer.objects_of(source()), roles)
        placed = renderer.footprint_geometry(sidecar, clusters, roles, 1400, 750)
        region = next(r for r in renderer.crop_regions(clusters, 1400, 750, placed)
                      if r["name"] == "000:011")
        self.assertLessEqual(region["left"], 500)
        self.assertGreaterEqual(region["left"] + region["width"], 620)

    def test_preview_ignores_an_unusable_record_rather_than_drawing_it_roughly(self):
        """An amber box in the wrong place is worse than no amber box."""
        sidecar = footprints.build(source(), synthetic=True, only=["000:011"])
        roles = renderer.load_roles()
        clusters = renderer.clusters_of(renderer.objects_of(source()), roles)
        for mutate in (lambda d: d["records"][0].__setitem__("unit_id", "999:999"),
                       lambda d: d["records"][0].__setitem__(
                           "footprint", {"left": 0, "top": 0, "width": 0, "height": 0}),
                       lambda d: d.__setitem__("source_image_size", None),
                       lambda d: d["records"].__setitem__(0, "not an object")):
            with self.subTest(mutate=mutate):
                broken = copy.deepcopy(sidecar)
                mutate(broken)
                self.assertEqual({}, renderer.footprint_geometry(
                    broken, clusters, roles, 1400, 750))


if __name__ == "__main__":
    unittest.main()
