import importlib.util
import json
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "build_ventilation_corpus", ROOT / "build-ventilation-corpus.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)
FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "ventilation-survey-fixture.json"


class CorpusBuilderTests(unittest.TestCase):
    def setUp(self):
        self.raw = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_normalizes_case_and_norwegian_text(self):
        self.assertTrue(MODULE.is_ventilation_name("360.001 Ventilasjon"))
        self.assertTrue(MODULE.is_ventilation_name("VENTILATION"))
        self.assertTrue(MODULE.is_ventilation_name("360.001Ventilasjon"))
        self.assertFalse(MODULE.is_ventilation_name("V01"))
        self.assertFalse(MODULE.is_ventilation_name("Varmegjenvinning"))
        self.assertFalse(MODULE.is_ventilation_name("Forventilasjon"))

    def test_reports_panel_unit_and_both_reasons(self):
        corpus = MODULE.build_corpus(self.raw)
        reasons = {
            (p["plant_id"], p["panel_name"]): p["discovery_reason"]
            for p in corpus["panels"]
        }
        self.assertEqual(reasons[("8001", "360.001 Ventilasjon")], "both")
        self.assertEqual(reasons[("8002", "Butikk")], "unit_name")
        self.assertEqual(reasons[("8016", "Teknisk")], "unit_name")

    def test_keeps_xml_hidden_v2_and_failed_plant_coverage(self):
        corpus = MODULE.build_corpus(self.raw)
        xml = next(p for p in corpus["panels"] if p["plant_id"] == "8016")
        self.assertEqual(xml["source_format"], "xml_only")
        self.assertEqual(xml["visibility"], "hidden")
        self.assertEqual(xml["v2_objects"], 44)
        self.assertEqual(xml["unit_ids"], ["V03"])
        self.assertEqual(xml["unit_names"], ["360.003Ventilasjon"])
        failed = next(p for p in corpus["plants"] if p["plant_id"] == "8049")
        partial = next(p for p in corpus["plants"] if p["plant_id"] == "8075")
        self.assertEqual(failed["outcome"], "failed")
        self.assertEqual(partial["outcome"], "partial")

    def test_canonical_examples_stay_outside_batch_totals(self):
        corpus = MODULE.build_corpus(self.raw)
        production = corpus["canonical_examples"]["production"]
        demo = corpus["canonical_examples"]["generated_demo"]
        self.assertEqual(production["plant_id"], "9099")
        self.assertEqual(production["objects"], 102)
        self.assertEqual(production["linked_objects"], 57)
        self.assertTrue(production["outside_batch"])
        self.assertEqual(demo["objects"], 45)
        self.assertFalse(demo["included_in_production_totals"])
        self.assertEqual(corpus["summary"]["attempted_plants"], 20)

    def test_requires_exact_20_unique_attempts(self):
        self.raw["batch"]["plant_ids"].pop()
        with self.assertRaisesRegex(ValueError, "exactly 20"):
            MODULE.build_corpus(self.raw)

    def test_requires_requested_integer_20(self):
        for invalid in (19, True):
            with self.subTest(requested=invalid):
                self.raw["batch"]["requested"] = invalid
                with self.assertRaisesRegex(ValueError, "integer 20"):
                    MODULE.build_corpus(self.raw)

    def test_rejects_extra_plant_key(self):
        self.raw["plants"]["9999"] = {
            "name": "Unexpected",
            "error": None,
            "unit_error": None,
            "units": [],
            "panels": [],
        }
        with self.assertRaisesRegex(ValueError, "extra=.*9999"):
            MODULE.build_corpus(self.raw)

    def test_output_contains_no_private_fields(self):
        self.raw["plants"]["8001"]["saved_by"] = "private-user"
        corpus = MODULE.build_corpus(self.raw)
        encoded = json.dumps(corpus)
        self.assertNotIn("saved_by", encoded)
        self.assertNotIn("private-user", encoded)

    def test_browser_runner_is_exactly_20_and_read_only(self):
        source = (ROOT / "ventilation-survey-20.js").read_text(encoding="utf-8")
        for forbidden in (
            "method: 'POST'",
            'method: "POST"',
            "iw_save_ctrls",
            "iw_sync",
            "iw_remove_panel",
            "V3_save_design_panel",
            "V3delete_designer_panels",
            "iw_upload_file",
        ):
            self.assertNotIn(forbidden, source)
        expected = [
            "8001",
            "8002",
            "8016",
            "8045",
            "8049",
            "8075",
            "8076",
            "8088",
            "8098",
            "8124",
            "8132",
            "8146",
            "8150",
            "8158",
            "8205",
            "8214",
            "8232",
            "8239",
            "8272",
            "8289",
        ]
        match = re.search(r"const PLANTS = (\[[\s\S]*?\]);", source)
        self.assertIsNotNone(match)
        plants = json.loads(match.group(1))
        self.assertEqual([p["id"] for p in plants], expected)
        self.assertEqual(len({p["id"] for p in plants}), 20)
        self.assertIn("realUnitId(legacyValue(dataNode, 'unit_id'))", source)
        self.assertIn("unit_ids: Array.from(unitIds).sort()", source)
        self.assertIn("record.unit_ids = legacy.unit_ids", source)
        self.assertIn(
            "record.unit_names = joinedUnitNames(record.unit_ids, plant.units)",
            source,
        )

    def test_runner_uses_live_unit_route_and_parses_xml_data_rows(self):
        runner = ROOT / "ventilation-survey-20.js"
        harness = r"""
const fs = require('fs');

class Element {
  constructor(name, textContent = '', children = []) {
    this.localName = name;
    this.nodeName = name;
    this.textContent = textContent;
    this.children = children;
    this.attributes = [];
  }

  getElementsByTagName(tag) {
    const matches = [];
    const visit = element => {
      if (tag === '*' || element.localName === tag) matches.push(element);
      element.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }
}

class DOMParser {
  parseFromString(text) {
    const rows = Array.from(text.matchAll(/<data>([\s\S]*?)<\/data>/g), match => {
      const body = match[1];
      const value = tag => {
        const found = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return found ? found[1] : '';
      };
      const children = [
        new Element('unit_id', value('unit_id')),
        new Element('unit_name', value('unit_name'))
      ];
      return new Element('data', children.map(child => child.textContent).join(''), children);
    });
    const root = new Element('root', '', rows);
    return {
      querySelector: () => null,
      getElementsByTagName: tag => root.getElementsByTagName(tag)
    };
  }
}

global.DOMParser = DOMParser;
global.setTimeout = resolve => { resolve(); return 0; };

const calls = [];
const unitXml = '<units>' +
  '<data><unit_id>V01</unit_id><unit_name>360.001Ventilasjon</unit_name></data>' +
  '<data><unit_id>V02</unit_id><unit_name>Butikkjøling</unit_name></data>' +
  '</units>';
global.fetch = async url => {
  calls.push(url);
  const payload = url.includes('V3get_plant_designer_panels') ? '[]' : unitXml;
  return {ok: true, status: 200, text: async () => payload};
};

const source = fs.readFileSync(process.argv[1], 'utf8');
const run = eval(`(${source})`);
const page = {
  evaluate: async callback => callback([{id: '9099', name: 'Test plant'}])
};

run(page).then(serialized => {
  const result = JSON.parse(serialized);
  process.stdout.write(JSON.stringify({
    unit_url: calls.find(url => url.includes('iw_load_units.php')),
    units: result.plants['9099'].units
  }));
}).catch(error => {
  console.error(error);
  process.exit(1);
});
"""
        completed = subprocess.run(
            ["node", "-e", harness, str(runner)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        observed = json.loads(completed.stdout)
        self.assertEqual(
            observed["unit_url"],
            "/iwmac_designer_v4/designer_site/iw_load_units.php"
            "?cust_id=9099&driverId=driver_id",
        )
        self.assertEqual(
            observed["units"],
            [
                {"unit_id": "V01", "unit_name": "360.001Ventilasjon"},
                {"unit_id": "V02", "unit_name": "Butikkjøling"},
            ],
        )
