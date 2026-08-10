"""Regression tests for LIST-PANEL-GENERATION-CONTRACT.md.

Three things are pinned here, and each one has already caught a real defect:

1.  The invariants in ``documentation-rules.json`` -> ``panel_types.list_panel``
    still match what the reference exports actually contain. Four values in the
    contract's first draft were written from schema intuition rather than
    measured (change-log 65-68); these tests are what turns "measured once" into
    "stays measured".
2.  The JSON examples embedded in the contract parse and satisfy the section 12
    validation checks. A worked example outranks a rule in practice, so a wrong
    example is worse than a missing one.
3.  The committed reference export still has the shape the contract describes.

E5 and E7 are uncommitted (live plant id, customer data). Tests that need them
skip rather than fail, and the skip is reported, so a clean checkout is green
without pretending it verified more than it did.

Run:
    python -m unittest tests.test_list_panel_contract -v
from the iwmac-designer-reference directory.
"""

import collections
import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
RULES_FILE = ROOT / "documentation-rules.json"
CONTRACT = ROOT / "LIST-PANEL-GENERATION-CONTRACT.md"
E6_FILE = ROOT / "reference_data" / "real-spjeldliste-example.json"
E5_FILE = pathlib.Path("C:/Users/Thomas/Downloads/"
                       "iwmac-panel_5295_360-001-spjeldliste_ny.json")
CATALOGUE = ROOT / "reference_data" / "all-design-objects.json"

RULES = json.loads(RULES_FILE.read_text(encoding="utf-8"))
LIST = RULES["panel_types"]["list_panel"]


def envelope(path):
    """Committed reference JSONs wrap the document; live exports are flat."""
    doc = json.loads(path.read_text(encoding="utf-8"))
    return doc.get("envelope", doc)


def load_e5():
    if not E5_FILE.exists():
        raise unittest.SkipTest("E5 is uncommitted (live plant id): %s" % E5_FILE)
    return envelope(E5_FILE)


E6 = envelope(E6_FILE)


def objects(env):
    """Every 17-field object in the document, scaffold and cells alike."""
    panel = env["panel"]
    return list(panel["single_objects"]) + [
        item for container in panel["containers"] for item in container["items"]]


def tops(env):
    return [c["top"] for c in env["panel"]["containers"]]


def group_starts(env):
    t = tops(env)
    return [t[0]] + [t[i + 1] for i in range(len(t) - 1) if t[i + 1] - t[i] == 40]


def contract_json_blocks():
    """Every fenced json block, keyed by the section heading above it.

    Keyed rather than indexed because a block's position shifts whenever a
    section is inserted, and an off-by-one here would silently test the wrong
    document - the exact failure mode section 6 forbids for objects.
    """
    blocks, heading = {}, None
    lines = CONTRACT.read_text(encoding="utf-8").split("\n")
    i = 0
    while i < len(lines):
        if lines[i].startswith("#"):
            heading = lines[i].lstrip("# ").strip()
        elif lines[i].strip() == "```json":
            j = i + 1
            while lines[j].strip() != "```":
                j += 1
            blocks[heading] = json.loads("\n".join(lines[i + 1:j]))
            i = j
        i += 1
    return blocks


MINIMAL = contract_json_blocks()["3.4 Minimal valid envelope"]
EXAMPLE_A = contract_json_blocks()[
    "13.1 Example A — new unlinked list from a synthetic table"]


def envelopes():
    """Both complete envelopes. Section 13.2 is a fragment, not an envelope."""
    return [(MINIMAL, "minimal envelope"), (EXAMPLE_A, "example A")]


class EnvelopeTest(unittest.TestCase):
    """Section 3. The canvas dimensions are strings - defect L-14."""

    def test_canvas_is_a_string_with_px(self):
        for env in [E6] + [e for e, _ in envelopes()]:
            self.assertEqual(env["panel_width"], LIST["canvas"]["panel_width"])
            self.assertEqual(env["panel_height"], LIST["canvas"]["panel_height"])
            self.assertIsInstance(env["panel_width"], str)
            self.assertTrue(env["panel_width"].endswith("px"))
            self.assertEqual(env["panel"]["panel_width"], env["panel_width"])

    def test_e5_canvas_matches(self):
        env = load_e5()
        self.assertEqual(env["panel_width"], LIST["canvas"]["panel_width"])
        self.assertEqual(env["panel_height"], LIST["canvas"]["panel_height"])

    def test_counts_equal_array_lengths(self):
        for env in [E6] + [e for e, _ in envelopes()]:
            panel = env["panel"]
            for key in ("single_objects", "containers", "graphics"):
                self.assertEqual(env["counts"][key], len(panel[key]),
                                 "%s count disagrees with the array" % key)

    def test_graphics_is_empty(self):
        for env in [E6] + [e for e, _ in envelopes()]:
            self.assertEqual(env["panel"]["graphics"], [])

    def test_format_and_version(self):
        for env in [E6] + [e for e, _ in envelopes()]:
            self.assertEqual(env["format"], "iwmac-designer-panel")
            self.assertEqual(env["version"], 1)


class ObjectConstantTest(unittest.TestCase):
    """Section 4.2. The seven constant fields - defect L-13."""

    CONSTANTS = LIST["bindings"]["object_constants"]

    def assert_constants(self, env, label):
        for obj in objects(env):
            for field in ("id", "linked", "link_name", "sub_group", "unit_ref"):
                self.assertEqual(obj[field], self.CONSTANTS[field],
                                 "%s: %s.%s" % (label, obj["obj_id"], field))

    def test_e6_constants(self):
        self.assert_constants(E6, "E6")

    def test_e5_constants(self):
        self.assert_constants(load_e5(), "E5")

    def test_examples_use_the_production_constants(self):
        for env, label in envelopes():
            self.assert_constants(env, label)

    def test_link_tag_is_NA_only_on_dividers_and_stripes(self):
        na_ids = set(self.CONSTANTS["link_tag"]["NA_on"])
        self.assertTrue(na_ids, "the NA_on list must not be empty")
        for env, label in [(E6, "E6")] + envelopes():
            for obj in objects(env):
                expected = "NA" if obj["obj_id"] in na_ids else ""
                self.assertEqual(obj["link_tag"], expected,
                                 "%s: %s.link_tag" % (label, obj["obj_id"]))

    def test_unlinked_objects_carry_the_literal_alias(self):
        alias = self.CONSTANTS["alias_text_when_unlinked"]
        for env, label in [(E6, "E6")] + envelopes():
            for obj in objects(env):
                if not obj["driver_id"]:
                    self.assertEqual(obj["alias_text"], alias, label)

    def test_every_object_has_all_17_fields(self):
        expected = RULES["global_invariants"]["object_fields"]
        for env, label in [(E6, "E6")] + envelopes():
            for obj in objects(env):
                self.assertEqual(list(obj.keys()), expected, label)


class GeneratedOutputSafetyTest(unittest.TestCase):
    """Section 4.2 and section 12 checks 24-28. The invariant that replaced the
    GLOBAL unlinked contract for this panel type."""

    def test_examples_invent_no_identifier(self):
        for env, label in envelopes():
            self.assertEqual(env["source_plant_id"], "", label)
            self.assertEqual(env["panel"]["plant_id"], "", label)
            for obj in objects(env):
                self.assertEqual(obj["driver_id"], "", label)
                self.assertEqual(obj["unit_id"], "", label)

    def test_no_assembled_bacnet_driver_id(self):
        pattern = re.compile(r"device\d+_\d+_\d+_\d+_\d+_85$")
        for env, _ in envelopes():
            for obj in objects(env):
                self.assertIsNone(pattern.search(obj["driver_id"] or ""))


class ContainerTest(unittest.TestCase):
    """Section 5. The container constants - defect L-12."""

    CONSTANTS = LIST["containers"]["constants"]

    def containers_of(self, env):
        return env["panel"]["containers"]

    def assert_container_shape(self, env, label):
        expected_fields = RULES["global_invariants"]["container_fields"]
        for i, container in enumerate(self.containers_of(env)):
            self.assertEqual(list(container.keys()), expected_fields, label)
            for field, value in self.CONSTANTS.items():
                self.assertEqual(container[field], value,
                                 "%s: container %d field %s" % (label, i, field))
            self.assertEqual(container["unique_id"], "custom_%d" % i, label)
            self.assertEqual(container["name"], "objects_container_%d" % i, label)

    def test_e6_containers(self):
        self.assert_container_shape(E6, "E6")

    def test_e5_containers(self):
        self.assert_container_shape(load_e5(), "E5")

    def test_examples(self):
        for env, label in envelopes():
            self.assert_container_shape(env, label)

    def test_container_zindex_is_an_integer_and_object_zindex_a_string(self):
        for env, label in [(E6, "E6")] + envelopes():
            for container in self.containers_of(env):
                self.assertIsInstance(container["zIndex"], int, label)
                for item in container["items"]:
                    self.assertIsInstance(item["zIndex"], str, label)

    def test_field_count_is_16(self):
        self.assertEqual(RULES["global_invariants"]["container_field_count"], 16)
        self.assertEqual(len(RULES["global_invariants"]["container_fields"]), 16)


class GeometryTest(unittest.TestCase):
    """Section 8. Row pitch, group gaps, divider height."""

    def test_row_deltas_are_only_20_or_40(self):
        for env, label in [(E6, "E6")] + envelopes():
            t = tops(env)
            deltas = set(t[i + 1] - t[i] for i in range(len(t) - 1))
            self.assertTrue(deltas <= {20, 40}, "%s: %s" % (label, sorted(deltas)))

    def test_e5_row_deltas(self):
        t = tops(load_e5())
        deltas = collections.Counter(t[i + 1] - t[i] for i in range(len(t) - 1))
        self.assertEqual(set(deltas), {20, 40})

    def test_first_row_top(self):
        expected = LIST["geometry"]["rows"]["first_row_top"]
        for env, label in [(E6, "E6")] + envelopes():
            self.assertEqual(tops(env)[0], expected, label)

    def test_divider_height_formula(self):
        """height = last_row_top + row_height - divider_top - 2, i.e. top - 66."""
        row_height = LIST["geometry"]["rows"]["row_height"]
        for env, label in ((E6, "E6"), (EXAMPLE_A, "example A")):
            dividers = [o for o in env["panel"]["single_objects"]
                        if o["obj_id"] == "number_v3_header_appgrey"]
            self.assertTrue(dividers, label)
            expected = tops(env)[-1] + row_height - 87 - 2
            for divider in dividers:
                self.assertEqual(divider["posHeight"], expected,
                                 "%s: divider at x %s" % (label, divider["posLeft"]))

    def test_e5_divider_height_formula(self):
        env = load_e5()
        dividers = [o for o in env["panel"]["single_objects"]
                    if o["obj_id"] == "number_v3_header_appgrey"]
        expected = tops(env)[-1] + LIST["geometry"]["rows"]["row_height"] - 87 - 2
        self.assertEqual(set(d["posHeight"] for d in dividers), {expected})

    def test_geometry_fields_are_integers(self):
        for env, label in [(E6, "E6")] + envelopes():
            for obj in objects(env):
                for field in ("posWidth", "posHeight", "posLeft", "posTop"):
                    self.assertIsInstance(obj[field], int,
                                          "%s: %s.%s" % (label, obj["obj_id"], field))

    def test_e5_group_count_is_two(self):
        """Defect L-15: this was written as three."""
        env = load_e5()
        measured = LIST["groups"]["measured"]["E5"]
        self.assertEqual(len(group_starts(env)), measured["groups"])
        self.assertEqual(group_starts(env), measured["group_first_row_tops"])
        self.assertEqual(sum(measured["group_sizes"]), len(tops(env)))

    def test_e6_group_measurements(self):
        measured = LIST["groups"]["measured"]["E6"]
        self.assertEqual(group_starts(E6), measured["group_first_row_tops"])
        self.assertEqual(sum(measured["group_sizes"]), len(tops(E6)))
        self.assertEqual(tops(E6)[-1], measured["last_row_top"])


class StripeTest(unittest.TestCase):
    """Section 8.7. The stripe is an author highlight, not a group marker."""

    def stripes(self, env):
        return [o for o in env["panel"]["single_objects"]
                if o["obj_id"] == "number_v3_header_grey50"]

    def test_stripe_geometry(self):
        spec = LIST["groups"]["stripe"]
        for env, label in ((E6, "E6"), (EXAMPLE_A, "example A")):
            for stripe in self.stripes(env):
                self.assertEqual(stripe["posLeft"], spec["pos_left"], label)
                self.assertEqual([stripe["posWidth"], stripe["posHeight"]],
                                 spec["size"], label)
                self.assertEqual(stripe["zIndex"], spec["zIndex"], label)
                self.assertEqual(stripe["link_tag"], spec["link_tag"], label)

    def test_every_stripe_sits_two_above_a_row(self):
        for env, label in ((E6, "E6"), (EXAMPLE_A, "example A")):
            row_tops = set(tops(env))
            for stripe in self.stripes(env):
                self.assertIn(stripe["posTop"] + 2, row_tops, label)

    def test_generated_output_emits_one_stripe_per_group(self):
        """The ADVISORY generation rule - example A must follow it even though
        production does not."""
        env = EXAMPLE_A
        stripe_tops = [s["posTop"] for s in self.stripes(env)]
        self.assertEqual(sorted(stripe_tops),
                         sorted(t - 2 for t in group_starts(env)))
        self.assertEqual(len(stripe_tops), len(set(stripe_tops)),
                         "generated output must not stack duplicate stripes")

    def test_production_does_not_follow_that_rule(self):
        """Pins the disagreement, so a later 'fix' to E6 is caught."""
        stripe_tops = set(s["posTop"] + 2 for s in self.stripes(E6))
        starts = set(group_starts(E6))
        self.assertTrue(starts - stripe_tops, "E6 used to leave 6 groups unstriped")
        self.assertTrue(stripe_tops - starts, "E6 used to stripe 2 mid-group rows")
        counts = collections.Counter(s["posTop"] for s in self.stripes(E6))
        self.assertEqual(set(counts.values()), {14},
                         "every E6 stripe position carried exactly 14 copies")


class ColumnRoleTest(unittest.TestCase):
    """Section 7.3. Role-based matching, never array index."""

    ROLES = LIST["columns"]["roles"]

    def test_header_geometry_is_identical_in_both_exports(self):
        e5 = load_e5()
        def headers(env):
            return sorted((o["tag_text"], o["posLeft"], o["posTop"])
                          for o in env["panel"]["single_objects"]
                          if o["obj_id"] == "number_v3_label_12px_bold")
        self.assertEqual(headers(e5), headers(E6))

    def test_header_x_matches_the_rules_file(self):
        placed = {(o["posLeft"], o["tag_text"])
                  for o in E6["panel"]["single_objects"]
                  if o["obj_id"] == "number_v3_label_12px_bold"}
        for role in self.ROLES:
            self.assertIn((role["header_left_x"], role["header_text"]), placed,
                          "left header for role %s" % role["role"])
            self.assertIn((role["header_right_x"], role["header_text"]), placed,
                          "right header for role %s" % role["role"])

    def test_cell_x_is_constant_per_item_name(self):
        seen = collections.defaultdict(set)
        for env in (E6,):
            for container in env["panel"]["containers"]:
                for item in container["items"]:
                    seen[item["name"]].add(item["posLeft"])
        for role in self.ROLES:
            for side in ("left", "right"):
                name = role["item_name_%s" % side]
                expected = role["cell_%s_x" % side]
                if name in seen and expected is not None:
                    self.assertEqual(seen[name], {expected},
                                     "%s cell x for role %s" % (side, role["role"]))

    def test_right_half_offset_is_not_constant(self):
        """Defect L-4: 780 for the tag column, 789 for the other six."""
        offsets = {r["header_right_x"] - r["header_left_x"] for r in self.ROLES}
        self.assertEqual(offsets, {780, 789})

    def test_norwegian_characters_survive(self):
        texts = [r["header_text"] for r in self.ROLES]
        self.assertIn("SP.p\u00e5drag m3/h", texts)
        self.assertTrue(any("m3/h" in t for t in texts),
                        "header text keeps the ASCII 3 verbatim")


class CatalogueTest(unittest.TestCase):
    """Section 12 check 12. Every obj_id must exist in the palette."""

    def test_every_obj_id_is_in_the_catalogue(self):
        if not CATALOGUE.exists():
            self.skipTest("palette not present: %s" % CATALOGUE)
        palette = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        known = set(e["object_id"] for e in palette["all_design_objects"])
        self.assertEqual(len(known), 797, "palette dump changed size")
        for env, label in [(E6, "E6")] + envelopes():
            for obj in objects(env):
                self.assertIn(obj["obj_id"], known, label)


class ContractExampleTest(unittest.TestCase):
    """The worked examples are documentation an agent will copy verbatim."""

    def test_all_json_blocks_parse(self):
        self.assertEqual(len(contract_json_blocks()), 6)

    def test_example_a_matches_the_section_17_fixture_row(self):
        """Section 17 pins these numbers in prose; here they are executable."""
        self.assertEqual(EXAMPLE_A["counts"],
                         {"single_objects": 34, "containers": 4, "graphics": 0})
        dividers = [o for o in EXAMPLE_A["panel"]["single_objects"]
                    if o["obj_id"] == "number_v3_header_appgrey"]
        self.assertEqual(set(d["posHeight"] for d in dividers), {120})
        stripes = [o["posTop"] for o in EXAMPLE_A["panel"]["single_objects"]
                   if o["obj_id"] == "number_v3_header_grey50"]
        self.assertEqual(sorted(stripes), [104, 184])

    def test_object_names_are_sequential_within_single_objects(self):
        for env, label in envelopes():
            names = [o["name"] for o in env["panel"]["single_objects"]]
            self.assertEqual(names, ["object_%d" % n for n in range(len(names))],
                             label)


class RulesFileTest(unittest.TestCase):
    """The machine-readable extract must stay wired to the prose."""

    def test_list_panel_block_exists(self):
        self.assertIn("list_panel", RULES["panel_types"])
        self.assertEqual(LIST["owner_document"],
                         "LIST-PANEL-GENERATION-CONTRACT.md")

    def test_scope_tags_are_declared(self):
        for tag in ("LIST", "TEMPLATE-SPECIFIC"):
            self.assertIn(tag, RULES["scope_tags"])

    def test_unlinked_demo_contract_records_the_list_exception(self):
        exception = RULES["global_invariants"]["unlinked_demo_contract"]
        self.assertIn("scope_exception", exception)
        self.assertIn("list_panel", exception["scope_exception"])

    def test_evidence_ids_present(self):
        for evidence_id in ("E5", "E6", "E7", "E8"):
            self.assertIn(evidence_id, RULES["evidence"])

    def test_ventilation_precedence_names_both_contracts(self):
        rank3 = [p for p in RULES["source_precedence"] if p.get("rank") == 3][0]
        self.assertIn("VENTILATION-GEOMETRY-CONTRACT.md", rank3["source"])
        self.assertIn("LIST-PANEL-GENERATION-CONTRACT.md", rank3["source"])


if __name__ == "__main__":
    unittest.main()
