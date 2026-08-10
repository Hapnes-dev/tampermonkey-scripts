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
        """OV-C1 and OV-C3 record fleet figures that disagree with this panel.
        Both survive with a scope; neither is merged into a mean."""
        conflicts = {c["id"]: c for c in OVERSIKT["conflicts"]}
        self.assertEqual({"OV-C1", "OV-C2", "OV-C3"}, set(conflicts))
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


if __name__ == "__main__":
    unittest.main()
