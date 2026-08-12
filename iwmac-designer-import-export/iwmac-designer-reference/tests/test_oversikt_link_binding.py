"""Regression tests for source-backed Oversikt link verification.

Run from ``iwmac-designer-reference``:

    python -m unittest tests.test_oversikt_link_binding -v

Fixtures are synthetic and masked. They reproduce the 2026-08-12 failure
shape, not any live plant: binding-looking fields on every object, most exact
driver ids present in a supplied parameter source, and a smaller stale subset.
"""

from __future__ import annotations

import copy
import csv
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape


ROOT = pathlib.Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "validate-oversikt-panel.py"
FIXTURES = ROOT / "tests" / "fixtures" / "oversikt-linking"
PANEL = FIXTURES / "verified-panel.json"
PARAMETERS = FIXTURES / "parameters.json"
CASES = FIXTURES / "incident-cases.json"
EXISTING_FIXTURE = ROOT / "reference_data" / "oversikt-10113-sanitized.json"
SQL_SAMPLE = ROOT / "reference_data" / "driver-parameters-sample.sql"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def objects(document):
    return document["panel"]["single_objects"]


def case_definition(case_id):
    return next(case for case in load(CASES)["cases"] if case["id"] == case_id)


def build_case(case_id):
    case = case_definition(case_id)
    document = load(PANEL)
    by_name = {obj["name"]: obj for obj in objects(document)}
    for mutation in case.get("mutations", []):
        by_name[mutation["object"]][mutation["field"]] = mutation["value"]
    if case.get("claim"):
        document["linking_status"] = case["claim"]
    if case.get("rename_start") is not None:
        for index, obj in enumerate(objects(document)):
            obj["name"] = f"object_{case['rename_start'] + index}"
    if case.get("reverse_array"):
        objects(document).reverse()
    return document


def write_json(directory, name, value):
    path = pathlib.Path(directory) / name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def run_cli(panel, parameters=None, compare_source=None, patch_scope=None):
    command = [sys.executable, str(VALIDATOR)]
    if compare_source is None:
        command.append(str(panel))
    else:
        command.extend(["--compare", str(compare_source), str(panel)])
    if parameters is not None:
        command.extend(["--parameters", str(parameters)])
    if patch_scope is not None:
        command.extend(["--patch-scope", patch_scope])
    command.extend(["--json-report", "--no-matrix"])
    completed = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    try:
        report = json.loads(completed.stdout)
    except json.JSONDecodeError:
        report = None
    return completed, report


def rule_ids(report, severity=None):
    findings = (report or {}).get("findings", [])
    return {
        finding["rule"]
        for finding in findings
        if severity is None or finding["severity"] == severity
    }


def write_minimal_xlsx(path, rows):
    """Write dependency-free inline-string XLSX input for parser coverage."""
    headers = [
        "driver_id", "unit_id", "unit_name", "alias_text", "application",
        "parameter_type", "hardware_datatype", "att", "eng_unit", "object_role",
    ]
    values = [headers] + [[str(row.get(header, "")) for header in headers] for row in rows]

    def column_name(index):
        name = ""
        while index:
            index, remainder = divmod(index - 1, 26)
            name = chr(65 + remainder) + name
        return name

    xml_rows = []
    for row_index, row in enumerate(values, 1):
        cells = []
        for column_index, value in enumerate(row, 1):
            ref = f"{column_name(column_index)}{row_index}"
            cells.append(
                f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
            )
        xml_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(xml_rows)}</sheetData></worksheet>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Parameters" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/></Relationships>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)


class SourceBackedBindingTest(unittest.TestCase):
    def test_exact_source_match_passes_source_and_semantic_stages(self):
        completed, report = run_cli(PANEL, PARAMETERS)
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        summary = report["binding_summary"]
        self.assertEqual(8, summary["intended"])
        self.assertEqual(8, summary["structurally_linked"])
        self.assertEqual(8, summary["source_resolved"])
        self.assertEqual(8, summary["semantically_verified"])
        self.assertEqual(0, summary["unresolved"])
        self.assertEqual("semantically verified", summary["status"])

    def test_linked_true_and_nonempty_driver_do_not_pass_alone(self):
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "structural-only.json",
                               build_case("structurally-linked-missing-source"))
            completed, report = run_cli(panel, PARAMETERS)
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertIn("O-B03", rule_ids(report, "error"))
        row = next(row for row in report["binding_verification_matrix"]
                   if row["object_identity"] == "object_0")
        self.assertTrue(row["structurally_linked"])
        self.assertFalse(row["driver_id_exact_match"])
        self.assertEqual("unresolved", row["verification_state"])

    def test_exact_driver_with_mismatched_unit_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "wrong-unit.json",
                               build_case("resolved-driver-wrong-unit"))
            completed, report = run_cli(panel, PARAMETERS)
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertIn("O-B04", rule_ids(report, "error"))

    def test_wrong_family_fails_even_when_suffix_matches(self):
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "wrong-family.json",
                               build_case("same-suffix-wrong-driver-family"))
            completed, report = run_cli(panel, PARAMETERS)
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertIn("O-B03", rule_ids(report, "error"))

    def test_correct_plant_prefix_with_wrong_controller_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "wrong-controller.json",
                               build_case("correct-plant-wrong-controller-index"))
            completed, report = run_cli(panel, PARAMETERS)
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertIn("O-B03", rule_ids(report, "error"))

    def test_similar_alias_bound_to_wrong_role_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "wrong-role.json",
                               build_case("similar-alias-wrong-role"))
            completed, report = run_cli(panel, PARAMETERS)
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertIn("O-B05", rule_ids(report, "error"))
        self.assertIn("O-B06", rule_ids(report, "error"))

    def test_ambiguous_semantic_tokens_stay_manual_not_auto_classified(self):
        panel = load(PANEL)
        parameters = load(PARAMETERS)
        target_driver = "NNNNN_AK3_AKC_0_11_1_0_60"
        next(obj for obj in objects(panel)
             if obj["driver_id"] == target_driver)["alias_text"] = "Defrost alarm"
        row = next(row for row in parameters["rows"]
                   if row["driver_id"] == target_driver)
        row["alias_text"] = "Defrost alarm"
        row["object_role"] = ""
        with tempfile.TemporaryDirectory() as temp:
            panel_path = write_json(temp, "ambiguous-role.json", panel)
            source_path = write_json(temp, "ambiguous-role-parameters.json", parameters)
            completed, report = run_cli(panel_path, source_path)
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertNotIn("O-B06", rule_ids(report, "error"))
        self.assertIn("O-B07", rule_ids(report, "warning"))
        self.assertIn("O-B08", rule_ids(report, "error"))

    def test_ambiguous_duplicate_parameter_rows_fail(self):
        parameters = load(PARAMETERS)
        parameters["rows"].append(copy.deepcopy(parameters["rows"][0]))
        with tempfile.TemporaryDirectory() as temp:
            source = write_json(temp, "ambiguous-parameters.json", parameters)
            completed, report = run_cli(PANEL, source)
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertIn("O-B02", rule_ids(report, "error"))

    def test_unreadable_parameter_source_fails_without_false_coverage(self):
        with tempfile.TemporaryDirectory() as temp:
            source = pathlib.Path(temp) / "parameters.json"
            source.write_text("{not json", encoding="utf-8")
            completed, report = run_cli(PANEL, source)
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertIn("O-B01", rule_ids(report, "error"))
        self.assertEqual("0/8", report["binding_summary"]["source_coverage"])
        self.assertEqual(8, report["binding_summary"]["unresolved"])

    def test_partial_match_reports_coverage_and_never_emits_completed_status(self):
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "partial.json", build_case("partial-six-of-eight"))
            completed, report = run_cli(panel, PARAMETERS)
        self.assertEqual(1, completed.returncode, completed.stderr)
        summary = report["binding_summary"]
        self.assertEqual(6, summary["source_resolved"])
        self.assertEqual(2, summary["unresolved"])
        self.assertEqual("unresolved", summary["status"])
        self.assertFalse(summary["completed_linking_claim_allowed"])
        self.assertNotEqual("linked-ready", summary["status"])
        self.assertIn("O-B08", rule_ids(report, "error"))

    def test_claimed_linked_ready_is_rejected_when_one_binding_is_unresolved(self):
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "bad-claim.json",
                               build_case("unresolved-claimed-linked-ready"))
            completed, report = run_cli(panel, PARAMETERS)
        self.assertEqual(1, completed.returncode, completed.stderr)
        stop = [finding for finding in report["findings"]
                if finding["rule"] == "O-B08"]
        self.assertTrue(stop)
        self.assertIn("must not be called finished", stop[0]["message"])

    def test_xlsx_parameter_workbook_is_supported_without_external_dependency(self):
        with tempfile.TemporaryDirectory() as temp:
            workbook = pathlib.Path(temp) / "parameters.xlsx"
            write_minimal_xlsx(workbook, load(PARAMETERS)["rows"])
            completed, report = run_cli(PANEL, workbook)
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        self.assertEqual(8, report["binding_summary"]["semantically_verified"])

    def test_csv_parameter_source_preserves_exact_rows(self):
        rows = load(PARAMETERS)["rows"]
        with tempfile.TemporaryDirectory() as temp:
            source = pathlib.Path(temp) / "parameters.csv"
            with source.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
            completed, report = run_cli(PANEL, source)
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        self.assertEqual(8, report["binding_summary"]["semantically_verified"])

    def test_repository_sql_parameter_sample_is_readable(self):
        path = ROOT / "parameter_source.py"
        spec = importlib.util.spec_from_file_location("parameter_source_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = module.load_parameter_source(SQL_SAMPLE)
        self.assertEqual("sql", source["kind"])
        self.assertEqual(14, len(source["rows"]))
        self.assertEqual(14, len({row["driver_id"] for row in source["rows"]}))


class ValidationModeAndIdentityTest(unittest.TestCase):
    def test_geometry_only_validation_still_works_without_parameters(self):
        completed, report = run_cli(PANEL)
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        self.assertNotIn("binding_summary", report)
        self.assertFalse(any(rule.startswith("O-B") for rule in rule_ids(report)))

    def test_existing_valid_fixture_still_passes_without_parameters(self):
        completed, report = run_cli(EXISTING_FIXTURE)
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        self.assertNotIn("binding_summary", report)

    def test_replacement_names_are_preserved_in_binding_matrix(self):
        replacement = build_case("replacement-object-10000-names")
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "replacement.json", replacement)
            completed, report = run_cli(panel, PARAMETERS)
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        identities = {row["object_identity"]
                      for row in report["binding_verification_matrix"]}
        self.assertEqual({f"object_{10000 + i}" for i in range(8)}, identities)
        self.assertIn("O-S04", rule_ids(report, "warning"))

    def test_reordered_exports_compare_by_controller_and_role_not_array_index(self):
        candidate = build_case("reordered-export-controller-role-match")
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "reordered.json", candidate)
            completed, report = run_cli(panel, PARAMETERS, compare_source=PANEL)
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        for rule in ("O-C01", "O-C02", "O-C05", "O-C07", "O-C08", "O-C09"):
            self.assertNotIn(rule, rule_ids(report))
        self.assertIn("O-C12", rule_ids(report, "warning"))
        grouping = [(row["controller_identity"], row["object_role"])
                    for row in report["binding_verification_matrix"]]
        self.assertEqual(
            [
                ("000:011", "alarm"),
                ("000:011", "value"),
                ("000:011", "cooling"),
                ("000:011", "defrost"),
                ("000:012", "alarm"),
                ("000:012", "value"),
                ("000:012", "cooling"),
                ("000:012", "defrost"),
            ],
            grouping,
        )

    def test_binding_repair_scope_preserves_geometry_names_and_order(self):
        stale = build_case("partial-six-of-eight")
        with tempfile.TemporaryDirectory() as temp:
            source = write_json(temp, "stale.json", stale)
            completed, report = run_cli(
                PANEL,
                PARAMETERS,
                compare_source=source,
                patch_scope="binding-repair",
            )
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        held = [finding for finding in report["findings"]
                if finding["rule"] == "O-C16"]
        self.assertEqual(1, len(held))
        self.assertEqual("info", held[0]["severity"])
        self.assertIn("held", held[0]["message"])
        self.assertNotIn("O-C12", rule_ids(report))

    def test_binding_repair_allows_source_proven_controller_identity_change(self):
        stale = load(PANEL)
        for obj in objects(stale)[4:]:
            obj["unit_id"] = "001:012"
            obj["driver_id"] = obj["driver_id"].replace("_AK3_", "_AK2_")
        with tempfile.TemporaryDirectory() as temp:
            source = write_json(temp, "stale-controller.json", stale)
            completed, report = run_cli(
                PANEL,
                PARAMETERS,
                compare_source=source,
                patch_scope="binding-repair",
            )
        self.assertEqual(0, completed.returncode, completed.stderr or completed.stdout)
        self.assertNotIn("O-C03", rule_ids(report, "error"))
        self.assertNotIn("O-C04", rule_ids(report, "error"))
        self.assertIn("O-C03", rule_ids(report, "info"))
        self.assertIn("O-C04", rule_ids(report, "info"))
        self.assertEqual(8, report["binding_summary"]["semantically_verified"])

    def test_binding_repair_scope_without_parameters_does_not_authorize_changes(self):
        stale = build_case("partial-six-of-eight")
        with tempfile.TemporaryDirectory() as temp:
            source = write_json(temp, "stale-without-evidence.json", stale)
            completed, report = run_cli(
                PANEL,
                compare_source=source,
                patch_scope="binding-repair",
            )
        self.assertEqual(1, completed.returncode, completed.stderr)
        self.assertIn("O-C08", rule_ids(report, "error"))
        self.assertNotIn("O-C08", rule_ids(report, "info"))

    def test_binding_repair_scope_does_not_hide_unverified_host_metadata(self):
        candidate = load(PANEL)
        objects(candidate)[0]["link_tag"] = "UNPROVEN-TAG"
        with tempfile.TemporaryDirectory() as temp:
            panel = write_json(temp, "metadata-change.json", candidate)
            completed, report = run_cli(
                panel,
                PARAMETERS,
                compare_source=PANEL,
                patch_scope="binding-repair",
            )
        self.assertEqual(1, completed.returncode, completed.stderr)
        scope = [finding for finding in report["findings"]
                 if finding["rule"] == "O-C16" and finding["severity"] == "error"]
        self.assertTrue(scope)
        self.assertTrue(any("link_tag" in finding["message"] for finding in scope))

    def test_fixture_manifest_covers_all_required_failure_shapes(self):
        case_ids = {case["id"] for case in load(CASES)["cases"]}
        self.assertEqual(
            {
                "structurally-linked-missing-source",
                "resolved-driver-wrong-unit",
                "same-suffix-wrong-driver-family",
                "correct-plant-wrong-controller-index",
                "similar-alias-wrong-role",
                "unresolved-claimed-linked-ready",
                "partial-six-of-eight",
                "replacement-object-10000-names",
                "reordered-export-controller-role-match",
            },
            case_ids,
        )

    def test_negative_builder_materializes_every_manifest_case(self):
        path = ROOT / "build-oversikt-linking-negatives.py"
        self.assertTrue(path.is_file(), f"missing fixture builder: {path}")
        spec = importlib.util.spec_from_file_location(
            "build_oversikt_linking_negatives", path
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(
            {case["id"] for case in load(CASES)["cases"]},
            set(module.NEGATIVES),
        )
        for case_id in module.NEGATIVES:
            with self.subTest(case=case_id):
                document = module.build(case_id)
                self.assertEqual(8, len(objects(document)))
                self.assertEqual(
                    case_definition(case_id).get("claim"),
                    document.get("linking_status"),
                )


if __name__ == "__main__":
    unittest.main()
