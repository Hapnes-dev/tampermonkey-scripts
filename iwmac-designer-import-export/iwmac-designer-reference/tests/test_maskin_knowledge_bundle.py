"""Regression tests for the generated single-file Maskin knowledge bundle.

Run:
    python -m unittest tests.test_maskin_knowledge_bundle
from the iwmac-designer-reference directory.
"""

import json
import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "MASKIN-KNOWLEDGE-BUNDLE.md"
RULES = ROOT / "documentation-rules.json"
PREFLIGHT = ROOT / "MASKIN-COPILOT-PREFLIGHT.md"


def load_rules():
    return json.loads(RULES.read_text(encoding="utf-8"))


def preflight_rules():
    text = PREFLIGHT.read_text(encoding="utf-8")
    return [match.group(0).rstrip() for match in re.finditer(
        r"(?ms)^(\d{1,2}) .+?(?=^\d{1,2} |\Z)", text)]


class MaskinKnowledgeBundleTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.bundle = BUNDLE.read_text(encoding="utf-8")
        cls.rules = load_rules()
        cls.maskin = cls.rules["panel_types"]["maskin"]
        cls.profile = cls.rules["profiles"]["TEMPLATE-10229"]

    def test_bundle_matches_its_generator(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "build-maskin-knowledge.py"), "--check"],
            cwd=str(ROOT), capture_output=True, text=True)
        self.assertEqual(
            0, result.returncode,
            "run: python build-maskin-knowledge.py\n"
            + result.stdout + result.stderr)

    def test_every_maskin_obj_id_is_present(self):
        vocabulary = self.maskin["object_vocabulary"]
        self.assertEqual(11, len(vocabulary))
        for obj_id in vocabulary:
            with self.subTest(obj_id=obj_id):
                self.assertIn(obj_id, self.bundle)

    def test_every_role_cluster_name_is_present(self):
        for role in self.maskin["roles"]:
            with self.subTest(role=role):
                self.assertIn(role, self.bundle)

    def test_every_maskin_and_profile_key_is_present(self):
        for namespace, block in (
                ("panel_types.maskin", self.maskin),
                ("profiles.TEMPLATE-10229", self.profile)):
            for key in block:
                with self.subTest(namespace=namespace, key=key):
                    self.assertIn(key, self.bundle)

    def test_json_fences_stay_below_one_quarter_of_the_bundle(self):
        lines = self.bundle.splitlines()
        inside_json = False
        json_lines = 0
        for line in lines:
            if line == "```json":
                self.assertFalse(inside_json, "nested JSON fence")
                inside_json = True
            elif line == "```" and inside_json:
                inside_json = False
            elif inside_json:
                json_lines += 1
        self.assertFalse(inside_json, "unclosed JSON fence")
        self.assertLess(json_lines / len(lines), 0.25)

    def test_every_compressor_coordinate_is_present(self):
        measured = self.maskin["compressor_columns"]["measured"]
        for side, roles in measured.items():
            for role, details in roles.items():
                for cell in details["cells"]:
                    coordinate = "| {} | {} | {} |".format(
                        cell["left"], cell["top"], cell["zIndex"])
                    with self.subTest(side=side, role=role,
                                      compressor=cell["compressor"]):
                        self.assertIn(coordinate, self.bundle)

    def test_every_preflight_rule_is_verbatim_and_the_numbering_has_no_gap(self):
        """The count is not pinned: the preflight grows when a workflow is added.
        What is pinned is that it is contiguous from 1, that none is below the
        twenty that existed when this test was written, and that every one of
        them reaches the bundle unedited."""
        rules = preflight_rules()
        numbers = [int(re.match(r"(\d{1,2}) ", rule).group(1)) for rule in rules]
        self.assertEqual(list(range(1, len(rules) + 1)), numbers)
        self.assertGreaterEqual(len(rules), 20)
        for rule in rules:
            with self.subTest(rule=rule.splitlines()[0]):
                self.assertIn(rule, self.bundle)

    def test_the_decision_tree_leads_the_copilot_facing_content(self):
        """A to J decides which rules apply, so it precedes them - in the
        preflight and in the bundle generated from it."""
        text = PREFLIGHT.read_text(encoding="utf-8")
        tree = re.search(r"(?ms)^DECISION TREE\.(.*?)^END DECISION TREE$", text)
        self.assertIsNotNone(tree, "the preflight must carry the decision tree")
        body = tree.group(1)
        for letter in "ABCDEFGHIJ":
            with self.subTest(branch=letter):
                self.assertRegex(body, rf"(?m)^\s+{letter} [A-Z]")
        self.assertIn("DECISION TREE." + body.rstrip(), self.bundle)
        self.assertLess(
            self.bundle.index("DECISION TREE."),
            self.bundle.index("## Source precedence"),
            "the decision tree belongs near the beginning of the "
            "Copilot-facing content")
        self.assertLess(self.bundle.index("DECISION TREE."),
                        self.bundle.index("preflight rules — verbatim"))

    def test_the_removal_and_rerouting_workflow_reached_the_bundle(self):
        """The bundle is what a Copilot is handed. A workflow that exists only in
        the sibling documents is a workflow that agent does not have."""
        for marker in ("M-A10", "M-A15", "M-A17", "M-A19", "M-C06",
                       "artwork-only", "bypass", "junction ledger"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.bundle)

    def test_current_background_policy_has_no_old_prohibition(self):
        colour_rule = self.maskin["background"]["colour"]
        self.assertIn(colour_rule, self.bundle)
        lowered = self.bundle.casefold()
        for forbidden in (
                "light-skin-only policy",
                "the only sanctioned look",
                "never draw a dark-background maskin",
                "dark-background maskin was forbidden",
                "dark background is forbidden",
                "a dark background is a defect on colour grounds alone"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, lowered)
        self.assertIn(
            "a dark background is not a defect on colour grounds alone",
            lowered)

    def test_names_the_copy_source_and_negative_example(self):
        copy_source = pathlib.PurePosixPath(
            self.rules["evidence"]["E10"]["file"]).name
        negative_example = pathlib.PurePosixPath(
            self.rules["evidence"]["E11"]["file"]).name
        self.assertIn(copy_source, self.bundle)
        self.assertIn(negative_example, self.bundle)
        self.assertIn("### File to copy", self.bundle)
        self.assertIn("### Negative example", self.bundle)
        self.assertIn("NOT a geometry source", self.bundle)


if __name__ == "__main__":
    unittest.main()
