"""Regression tests for binary-filter + BACnet ualarm Ventilasjon rules.

Sanitized fixtures: plant prefix NNNNN, no live driver ids, no customer names.
Geometry for the filter cluster is CASE-4743-360008 scoped (E29), not global.

Run from iwmac-designer-reference/:
    python -m unittest tests.test_ventilation_bacnet_case -v
"""

from __future__ import annotations

import copy
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "ventilation-binary-filter"
CANONICAL = FIXTURE_DIR / "canonical.json"
SIBLING = FIXTURE_DIR / "sibling-sidebar.json"
PROFILE = "PROFILE-BINARY-FILTER-BACNET"


def _load(path):
    spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validator = _load(ROOT / "validate-ventilation-panel.py")
migrate_mod = _load(ROOT / "migrate-ventilation-bacnet-alarms.py")
clone_mod = _load(ROOT / "clone-ventilation-sidebar-geometry.py")
RULES = validator.load_rules()
PALETTE = validator.load_palette()


def obj(**fields):
    row = {
        "obj_id": "number_v3_label_11px_norm",
        "name": "object_0",
        "id": "driver_id",
        "posWidth": 50,
        "posHeight": 1,
        "posLeft": 0,
        "posTop": 0,
        "zIndex": "1100",
        "tag_text": "",
        "linked": "true",
        "link_name": "link_name",
        "link_tag": "",
        "sub_group": "",
        "driver_id": "",
        "unit_id": "",
        "unit_ref": "",
        "alias_text": "new text",
    }
    row.update(fields)
    return row


def wrap(objects, panel_name="360.008 Ventilasjon"):
    for index, item in enumerate(objects):
        item["name"] = "object_%d" % index
    return {
        "format": "iwmac-designer-panel",
        "version": 1,
        "exported_at": "2026-08-13T00:00:00.000Z",
        "generator": "PROFILE-BINARY-FILTER-BACNET fixture",
        "source_plant_id": "NNNNN",
        "panel_name": panel_name,
        "panel_width": "1400px",
        "panel_height": "750px",
        "counts": {
            "single_objects": len(objects),
            "containers": 0,
            "graphics": 0,
        },
        "background_embedded": False,
        "panel": {
            "plant_id": "NNNNN",
            "panel_name": panel_name,
            "panel_width": "1400px",
            "panel_height": "750px",
            "org_image_name": "00-blank-sidebar-1400x750",
            "image_name": "",
            "saved_by": "copilot",
            "single_objects": objects,
            "containers": [],
            "graphics": [],
        },
    }


def sidebar_rows(system="360.08"):
    return [
        obj(obj_id="number_v3_header_grey75", posWidth=250, posHeight=20,
            posLeft=1150, posTop=0, zIndex="5", tag_text="Status og vendere"),
        obj(obj_id="number_v3_label_11px_norm", posLeft=1243, posTop=24,
            tag_text="Driftsmodus"),
        obj(obj_id="number_v3_custom_json_obj", posWidth=230, posHeight=20,
            posLeft=1160, posTop=36, zIndex="110", tag_text=" ",
            driver_id="NNNNN_BACNET_U01_0_1_0_19_4", unit_id="U01",
            alias_text="%s Årsak til aktuell driftsmodus" % system),
        obj(obj_id="number_v3_label_11px_norm", posLeft=1175, posTop=59,
            tag_text="Systemvender"),
        obj(obj_id="number_v3_60px_json_obj", posWidth=100, posHeight=20,
            posLeft=1160, posTop=73, zIndex="110", tag_text=" ",
            driver_id="NNNNN_BACNET_U01_0_1_0_19_1", unit_id="U01",
            alias_text="%s Systemvender" % system),
        obj(obj_id="number_v3_label_11px_norm", posLeft=1305, posTop=59,
            tag_text="Alarm"),
        obj(obj_id="V3_led_16px_circ_grey_red", posWidth=16, posHeight=16,
            posLeft=1317, posTop=75, zIndex="375", tag_text="",
            driver_id="NNNNN_BACNET_U01_0_1_0_5_1", unit_id="U01",
            alias_text="%s Alarm" % system),
        obj(obj_id="number_v3_label_11px_norm", posLeft=1172, posTop=95,
            tag_text="Alarmkvittering"),
        obj(obj_id="number_v3_60px_json_obj", posWidth=100, posHeight=20,
            posLeft=1160, posTop=108, zIndex="110", tag_text=" ",
            driver_id="NNNNN_BACNET_U01_0_1_0_19_2", unit_id="U01",
            alias_text="%s Alarmkvittering" % system),
        obj(obj_id="number_v3_header_grey75", posWidth=250, posHeight=20,
            posLeft=1150, posTop=165, zIndex="5", tag_text="Vifteregulering"),
        obj(obj_id="number_v3_label_11px_norm", posLeft=1260, posTop=190,
            posWidth=50, posHeight=20, tag_text="Tilluft"),
        obj(obj_id="number_v3_label_11px_norm", posLeft=1330, posTop=190,
            posWidth=50, posHeight=20, tag_text="Avtrekk"),
        obj(obj_id="number_v3_label_11px_norm", posLeft=1160, posTop=210,
            tag_text="Sp. høyfart m³/h:"),
        obj(obj_id="number_v3_60px_dark_no_conn", posWidth=62, posHeight=22,
            posLeft=1260, posTop=205, zIndex="110", tag_text=" ",
            driver_id="NNNNN_BACNET_U01_0_1_0_2_10", unit_id="U01",
            alias_text="%s Settpunkt høyfart tilluft" % system),
        obj(obj_id="number_v3_header_grey75", posWidth=250, posHeight=20,
            posLeft=1150, posTop=357, zIndex="5", tag_text="Temperaturregulering"),
        obj(obj_id="number_v3_label_11px_norm", posLeft=1160, posTop=385,
            tag_text="kjøling avtrekk"),
    ]


def canonical_objects():
    return [
        obj(obj_id="number_v3_exhaust_pipe_horisontal", posWidth=1025, posHeight=18,
            posLeft=24, posTop=200, zIndex="5", tag_text=" "),
        obj(obj_id="number_v3_fresh_pipe_horisontal", posWidth=270, posHeight=18,
            posLeft=24, posTop=442, zIndex="5", tag_text=" "),
        obj(obj_id="number_v3_supply_pipe_horisontal", posWidth=720, posHeight=18,
            posLeft=327, posTop=442, zIndex="5", tag_text=" "),
        obj(obj_id="number_v3_filter_only", posWidth=90, posHeight=83,
            posLeft=129, posTop=413, zIndex="110", tag_text="QD40"),
        obj(obj_id="number_v3_filter_only", posWidth=90, posHeight=83,
            posLeft=466, posTop=169, zIndex="110", tag_text="QD50"),
        obj(obj_id="bacnet_ualarm_v1", posWidth=35, posHeight=31,
            posLeft=152, posTop=387, zIndex="375", tag_text="",
            driver_id="NNNNN_BACNET_U01_0_1_0_3_135.Ualarm", unit_id="U01",
            alias_text="360.08 -QD40 Filtervakt Tilluft"),
        obj(obj_id="bacnet_ualarm_v1", posWidth=35, posHeight=31,
            posLeft=489, posTop=141, zIndex="375", tag_text="",
            driver_id="NNNNN_BACNET_U01_0_1_0_3_136.Ualarm", unit_id="U01",
            alias_text="360.08 -QD50 Filtervakt Avtrekk"),
        obj(obj_id="V3_58px_fan_right_nrm", posWidth=59, posHeight=59,
            posLeft=795, posTop=421, zIndex="40", tag_text="JV40",
            driver_id="NNNNN_BACNET_U01_0_1_0_4_2", unit_id="U01",
            alias_text="360.08 -JV40 Tilluftsvifte Start"),
        obj(obj_id="bacnet_ualarm_v1", posWidth=35, posHeight=31,
            posLeft=818, posTop=395, zIndex="375", tag_text="",
            driver_id="NNNNN_BACNET_U01_0_1_0_4_2.Ualarm", unit_id="U01",
            alias_text="360.08 -JV40 Tilluftsvifte Start"),
        obj(obj_id="number_v3_R_45px_con_down", posWidth=46, posHeight=38,
            posLeft=985, posTop=417, zIndex="110", tag_text="RT40 °C",
            driver_id="NNNNN_BACNET_U01_0_1_0_0_2", unit_id="U01",
            alias_text="360.08 -RT40 Tilluftstemp."),
        obj(obj_id="number_360_room", posWidth=100, posHeight=339,
            posLeft=1044, posTop=159, zIndex="40", tag_text=" "),
    ] + sidebar_rows()


def load_canonical():
    return json.loads(CANONICAL.read_text(encoding="utf-8"))


def run(document, profile=PROFILE, sibling=None):
    sibling_doc = sibling
    if sibling is None and SIBLING.exists():
        sibling_doc = json.loads(SIBLING.read_text(encoding="utf-8"))
    return validator.validate(document, profile_name=profile, rules=RULES,
                              palette=PALETTE, sibling_doc=sibling_doc)


def errors(document, **kwargs):
    return [f for f in run(document, **kwargs) if f.severity == "error"]


def rules_fired(findings):
    return {f.rule for f in findings}


def objects_of(document):
    return validator.objects_of(validator.envelope_of(document))


def find(document, **criteria):
    hits = [o for o in objects_of(document)
            if all((str(o.get(k) or "").strip() == str(v).strip())
                   for k, v in criteria.items())]
    if len(hits) != 1:
        raise AssertionError("expected one match for %r, found %d" % (criteria, len(hits)))
    return hits[0]


class CanonicalFixtureTest(unittest.TestCase):
    def test_canonical_validates_clean(self):
        found = errors(load_canonical())
        self.assertEqual([], [str(f) for f in found])

    def test_utf8_labels_survive_roundtrip(self):
        document = load_canonical()
        dumped = json.loads(json.dumps(document, ensure_ascii=False))
        texts = {(o.get("tag_text") or "") for o in objects_of(dumped)}
        self.assertIn("Sp. høyfart m³/h:", texts)
        self.assertIn("kjøling avtrekk", texts)
        self.assertIn("RT40 °C", texts)
        self.assertEqual([], [str(f) for f in errors(dumped)])


class BinaryFilterTest(unittest.TestCase):
    def test_binary_filter_with_ualarm_passes(self):
        self.assertEqual([], [str(f) for f in errors(load_canonical())])

    def test_diff_press_filter_fails_on_binary_profile(self):
        document = load_canonical()
        find(document, tag_text="QD40")["obj_id"] = "numberV3_filter_with_diff_press"
        found = errors(document)
        self.assertIn("V-P09", rules_fired(found))


class FilterClusterPatchTest(unittest.TestCase):
    def test_resized_filter_during_position_patch_fails(self):
        source = load_canonical()
        candidate = copy.deepcopy(source)
        filt = find(candidate, tag_text="QD40")
        filt["posWidth"] = 140
        filt["posHeight"] = 40
        findings = validator.validate_pair(
            source, candidate, PROFILE, rules=RULES, palette=PALETTE,
            patch_scope="filter-cluster-move")
        fired = {f.rule for f in findings if f.severity == "error"}
        self.assertTrue({"V-C04", "V-G08"} & fired, findings)

    def test_filter_moved_without_alarm_fails(self):
        source = load_canonical()
        candidate = copy.deepcopy(source)
        find(candidate, tag_text="QD40")["posLeft"] = 200
        findings = validator.validate_pair(
            source, candidate, PROFILE, rules=RULES, palette=PALETTE,
            patch_scope="filter-cluster-move")
        fired = {f.rule for f in findings if f.severity == "error"}
        self.assertIn("V-C05", fired, findings)


class DuplicateAlarmTest(unittest.TestCase):
    def test_generic_plus_bacnet_on_same_filter_fails(self):
        document = load_canonical()
        filt = find(document, tag_text="QD40")
        extra = obj(obj_id="V3_R_34px_circular_alarm_nrm", posWidth=34, posHeight=34,
                    posLeft=filt["posLeft"] + 20, posTop=filt["posTop"] - 30,
                    zIndex="375", tag_text="",
                    alias_text="Alarm,-Filter alarm for supply filter")
        objects_of(document).append(extra)
        env = validator.envelope_of(document)
        env["counts"]["single_objects"] = len(objects_of(document))
        for index, item in enumerate(objects_of(document)):
            item["name"] = "object_%d" % index
        found = errors(document)
        self.assertIn("V-G05", rules_fired(found))

    def test_two_ualarms_same_driver_on_one_filter_fails(self):
        document = load_canonical()
        alarm = find(document, alias_text="360.08 -QD40 Filtervakt Tilluft")
        clone = copy.deepcopy(alarm)
        clone["posLeft"] = alarm["posLeft"] + 6
        objects_of(document).append(clone)
        env = validator.envelope_of(document)
        env["counts"]["single_objects"] = len(objects_of(document))
        for index, item in enumerate(objects_of(document)):
            item["name"] = "object_%d" % index
        found = errors(document)
        self.assertIn("V-G09", rules_fired(found))


class UalarmDriverTest(unittest.TestCase):
    def test_double_ualarm_suffix_fails(self):
        document = load_canonical()
        alarm = find(document, alias_text="360.08 -QD40 Filtervakt Tilluft")
        alarm["driver_id"] = alarm["driver_id"] + ".Ualarm"
        found = errors(document)
        self.assertIn("V-G09", rules_fired(found))
        self.assertTrue(any("Ualarm.Ualarm" in f.message for f in found), found)

    def test_wrong_base_driver_on_fan_fails(self):
        document = load_canonical()
        alarm = find(document, obj_id="bacnet_ualarm_v1",
                     alias_text="360.08 -JV40 Tilluftsvifte Start")
        alarm["driver_id"] = "NNNNN_BACNET_U01_0_1_0_2_10.Ualarm"
        found = errors(document)
        self.assertIn("V-G09", rules_fired(found))

    def test_sidebar_setpoint_ualarm_fails(self):
        document = load_canonical()
        setpoint = find(document, alias_text="360.08 Settpunkt høyfart tilluft")
        extra = obj(obj_id="bacnet_ualarm_v1", posWidth=35, posHeight=31,
                    posLeft=setpoint["posLeft"] + 23, posTop=setpoint["posTop"] - 26,
                    zIndex="375", tag_text="",
                    driver_id=setpoint["driver_id"] + ".Ualarm", unit_id="U01",
                    alias_text=setpoint["alias_text"])
        objects_of(document).append(extra)
        env = validator.envelope_of(document)
        env["counts"]["single_objects"] = len(objects_of(document))
        for index, item in enumerate(objects_of(document)):
            item["name"] = "object_%d" % index
        found = errors(document)
        self.assertIn("V-P12", rules_fired(found))


class UnsupportedValueTest(unittest.TestCase):
    def test_rt600_inside_room_box_fails(self):
        document = load_canonical()
        extra = obj(obj_id="number_v3_R_45px_con_down", posWidth=46, posHeight=38,
                    posLeft=1050, posTop=180, zIndex="110", tag_text="RT600 °C",
                    driver_id="NNNNN_BACNET_U01_0_1_0_0_99", unit_id="U01",
                    alias_text="360.08 RT600")
        objects_of(document).append(extra)
        env = validator.envelope_of(document)
        env["counts"]["single_objects"] = len(objects_of(document))
        for index, item in enumerate(objects_of(document)):
            item["name"] = "object_%d" % index
        found = errors(document)
        self.assertIn("V-P10", rules_fired(found))


class SidebarCloneTest(unittest.TestCase):
    def test_cloned_sidebar_geometry_passes(self):
        document = load_canonical()
        sibling = json.loads(SIBLING.read_text(encoding="utf-8"))
        found = errors(document, sibling=sibling)
        self.assertNotIn("V-P11", rules_fired(found), found)

    def test_displaced_sidebar_label_fails(self):
        document = load_canonical()
        find(document, tag_text="Systemvender")["posLeft"] = 1190
        sibling = json.loads(SIBLING.read_text(encoding="utf-8"))
        found = errors(document, sibling=sibling)
        self.assertIn("V-P11", rules_fired(found))

    def test_clone_helper_copies_geometry_not_bindings(self):
        target = load_canonical()
        find(target, tag_text="Systemvender")["posLeft"] = 1190
        sibling = json.loads(SIBLING.read_text(encoding="utf-8"))
        cloned, report = clone_mod.clone_sidebar(target, sibling)
        self.assertGreater(report["copied"], 0)
        self.assertEqual(find(cloned, tag_text="Systemvender")["posLeft"], 1175)
        self.assertEqual(find(cloned, alias_text="360.08 Systemvender")["driver_id"],
                         "NNNNN_BACNET_U01_0_1_0_19_1")


class MigrateIdempotenceTest(unittest.TestCase):
    def test_running_migration_twice_is_stable(self):
        source = load_canonical()
        fan = find(source, tag_text="JV40")
        generic = obj(obj_id="V3_R_34px_circular_alarm_nrm", posWidth=34, posHeight=34,
                      posLeft=fan["posLeft"] + 12, posTop=fan["posTop"] - 19,
                      zIndex="375", tag_text="",
                      alias_text="Alarm,-Common Alarm - supply fan")
        # Start from a panel whose fan ualarm is replaced by a generic bell.
        objects = [o for o in objects_of(source)
                   if o.get("alias_text") != "360.08 -JV40 Tilluftsvifte Start"
                   or o.get("obj_id") != "bacnet_ualarm_v1"]
        objects.append(generic)
        start = wrap(copy.deepcopy(objects))
        first, report1 = migrate_mod.migrate(start, dx=23, dy=-26)
        second, report2 = migrate_mod.migrate(first, dx=23, dy=-26)
        self.assertGreaterEqual(report1["added"], 1)
        self.assertEqual(report2["added"], 0)
        self.assertEqual(objects_of(first), objects_of(second))


class PatchScopeTest(unittest.TestCase):
    def test_alarm_and_sidebar_scope_holds_when_only_those_changed(self):
        source = load_canonical()
        candidate = copy.deepcopy(source)
        find(candidate, tag_text="Systemvender")["posLeft"] = 1175
        extra = obj(obj_id="bacnet_ualarm_v1", posWidth=35, posHeight=31,
                    posLeft=1008, posTop=391, zIndex="375", tag_text="",
                    driver_id="NNNNN_BACNET_U01_0_1_0_0_2.Ualarm", unit_id="U01",
                    alias_text="360.08 -RT40 Tilluftstemp.")
        objects_of(candidate).append(extra)
        env = validator.envelope_of(candidate)
        env["counts"]["single_objects"] = len(objects_of(candidate))
        for index, item in enumerate(objects_of(candidate)):
            item["name"] = "object_%d" % index
        findings = validator.validate_pair(
            source, candidate, PROFILE, rules=RULES, palette=PALETTE,
            patch_scope="alarm-and-sidebar",
            sibling_doc=json.loads(SIBLING.read_text(encoding="utf-8")))
        scope_errors = [f for f in findings if f.severity == "error" and f.rule == "V-C03"]
        self.assertEqual([], [str(f) for f in scope_errors])

    def test_unauthorized_process_move_fails_alarm_and_sidebar_scope(self):
        source = load_canonical()
        candidate = copy.deepcopy(source)
        find(candidate, tag_text="JV40")["posLeft"] = 500
        findings = validator.validate_pair(
            source, candidate, PROFILE, rules=RULES, palette=PALETTE,
            patch_scope="alarm-and-sidebar")
        fired = {f.rule for f in findings if f.severity == "error"}
        self.assertIn("V-C03", fired)


def write_fixtures():
    """Regenerate sanitized JSON from the builders in this file."""
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    canonical = wrap(canonical_objects())
    sibling_objects = sidebar_rows(system="360.02")
    for row in sibling_objects:
        if row.get("driver_id"):
            row["driver_id"] = row["driver_id"].replace("_0_1_0_", "_0_2_0_")
            row["alias_text"] = (row.get("alias_text") or "").replace("360.08", "360.02")
    sibling = wrap(sibling_objects, panel_name="360.002 Ventilasjon")
    CANONICAL.write_text(json.dumps(canonical, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8")
    SIBLING.write_text(json.dumps(sibling, ensure_ascii=False, indent=2) + "\n",
                       encoding="utf-8")
    return CANONICAL, SIBLING


if __name__ == "__main__":
    if len(__import__("sys").argv) > 1 and __import__("sys").argv[1] == "--write-fixtures":
        paths = write_fixtures()
        print("wrote %s and %s" % paths)
    else:
        unittest.main()
