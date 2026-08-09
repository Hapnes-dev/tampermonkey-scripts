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
CORPUS = ROOT / "reference_data" / "ventilation-panel-corpus.json"
GUIDE = ROOT / "VENTILATION-CORPUS.md"


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

    def test_ignores_injected_panel_unit_names_without_exact_join(self):
        panel = self.raw["plants"]["8045"]["panels"][0]
        panel["unit_ids"] = []
        panel["unit_names"] = ["Ventilasjon"]
        corpus = MODULE.build_corpus(self.raw)
        self.assertFalse(
            any(item["plant_id"] == "8045" for item in corpus["panels"])
        )

    def test_recomputes_panel_unit_names_from_exact_same_plant_join(self):
        plant = self.raw["plants"]["8045"]
        panel = plant["panels"][0]
        plant["units"] = [
            {"unit_id": "V99", "unit_name": "360.099Ventilasjon"},
            {"unit_id": "V98", "unit_name": "360.098 Ventilation"},
        ]
        panel["unit_ids"] = ["V99", "V98", "V99"]
        panel["unit_names"] = ["stale source name"]
        corpus = MODULE.build_corpus(self.raw)
        matched = next(
            item for item in corpus["panels"] if item["plant_id"] == "8045"
        )
        self.assertEqual(matched["discovery_reason"], "unit_name")
        self.assertEqual(matched["unit_ids"], ["V98", "V99"])
        self.assertEqual(
            matched["unit_names"],
            ["360.098 Ventilation", "360.099Ventilasjon"],
        )

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
        self.assertEqual(corpus["summary"]["partial_plants"], 1)

    def test_canonical_examples_stay_outside_batch_totals(self):
        corpus = MODULE.build_corpus(self.raw)
        production = corpus["canonical_examples"]["production"]
        demo = corpus["canonical_examples"]["generated_demo"]
        self.assertEqual(production["plant_id"], "9099")
        self.assertEqual(production["objects"], 102)
        self.assertEqual(production["linked_objects"], 57)
        self.assertEqual(production["unit_names"], ["360.001Ventilasjon"])
        self.assertTrue(production["outside_batch"])
        self.assertEqual(demo["objects"], 45)
        self.assertFalse(demo["included_in_production_totals"])
        self.assertFalse(demo["present_in_repository"])
        self.assertTrue(demo["violates_background_contract"])
        self.assertEqual(corpus["summary"]["attempted_plants"], 20)

    def test_generated_demo_is_not_a_retrievable_repository_file(self):
        """The demo record names a file that was never committed.

        If someone adds it, this test fails so the record and the surrounding
        documentation get corrected instead of silently going stale.
        """
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        demo = corpus["canonical_examples"]["generated_demo"]
        self.assertFalse(demo["present_in_repository"])
        matches = sorted(
            str(path.relative_to(ROOT))
            for path in ROOT.rglob(demo["name"])
        )
        self.assertEqual(matches, [])

    def test_documented_coverage_table_matches_repository_corpus(self):
        corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
        guide = GUIDE.read_text(encoding="utf-8")
        summary = corpus["summary"]
        expected = {
            "Attempted plants": summary["attempted_plants"],
            "Matched plants": summary["matched_plants"],
            "Zero-match plants": summary["zero_match_plants"],
            "Partial plants": summary["partial_plants"],
            "Failed plants": summary["failed_plants"],
            "Matched panels": summary["matched_panels"],
            "JSON panels": summary["json_panels"],
            "XML-only panels": summary["xml_only_panels"],
            "Visible panels": summary["visible_panels"],
            "Hidden panels": summary["hidden_panels"],
            "V2-bearing panels": summary["v2_bearing_panels"],
            "Discovery: both": sum(
                panel["discovery_reason"] == "both" for panel in corpus["panels"]
            ),
            "Discovery: unit_name": sum(
                panel["discovery_reason"] == "unit_name"
                for panel in corpus["panels"]
            ),
            "Discovery: panel_name": sum(
                panel["discovery_reason"] == "panel_name"
                for panel in corpus["panels"]
            ),
        }
        for label, value in expected.items():
            with self.subTest(label=label):
                matches = re.findall(
                    rf"^\|\s*{re.escape(label)}\s*\|\s*(\d+)\s*\|\s*$",
                    guide,
                    flags=re.MULTILINE,
                )
                self.assertEqual(matches, [str(value)])

    def test_zero_panels_with_unit_endpoint_error_is_partial(self):
        plant = self.raw["plants"]["8045"]
        plant["panels"] = []
        plant["unit_error"] = "HTTP 500"
        corpus = MODULE.build_corpus(self.raw)
        coverage = next(
            item for item in corpus["plants"] if item["plant_id"] == "8045"
        )
        self.assertEqual(coverage["outcome"], "partial")

    def test_failed_panel_is_not_matched_by_name(self):
        panel = self.raw["plants"]["8045"]["panels"][0]
        panel["name"] = "Ventilasjon"
        panel["source_format"] = None
        panel["fetch_error"] = "malformed XML"
        corpus = MODULE.build_corpus(self.raw)
        coverage = next(
            item for item in corpus["plants"] if item["plant_id"] == "8045"
        )
        self.assertFalse(
            any(item["plant_id"] == "8045" for item in corpus["panels"])
        )
        self.assertEqual(coverage["outcome"], "partial")
        self.assertEqual(
            corpus["summary"]["matched_panels"],
            corpus["summary"]["json_panels"]
            + corpus["summary"]["xml_only_panels"],
        )
        self.assertTrue(
            all(
                item["source_format"] in {"json", "xml_only"}
                for item in corpus["panels"]
            )
        )

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
const unitXmlBytes = Uint8Array.from(Buffer.from('<units>' +
  '<data><unit_id>V01</unit_id><unit_name>360.001Ventilasjon</unit_name></data>' +
  '<data><unit_id>V02</unit_id><unit_name>Kj\xf8l</unit_name></data>' +
  '<data><unit_id>V03</unit_id><unit_name>T\xf8rrkj\xf8ler</unit_name></data>' +
  '</units>', 'latin1'));
global.fetch = async url => {
  calls.push(url);
  if (url.includes('iw_load_units.php')) {
    return {
      ok: true,
      status: 200,
      text: async () => { throw new Error('unit inventory used response.text()'); },
      arrayBuffer: async () => unitXmlBytes.buffer
    };
  }
  return {
    ok: true,
    status: 200,
    text: async () => '[]',
    arrayBuffer: async () => { throw new Error('panel response used arrayBuffer()'); }
  };
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
                {"unit_id": "V02", "unit_name": "Kjøl"},
                {"unit_id": "V03", "unit_name": "Tørrkjøler"},
            ],
        )

    def test_runner_rejects_malformed_json_and_requires_real_panel_links(self):
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
  parseFromString(text, mediaType) {
    if (mediaType === 'application/xml' && text === '<root><data>') {
      return {
        querySelector: selector => selector === 'parsererror'
          ? new Element('parsererror', 'malformed')
          : null,
        getElementsByTagName: () => []
      };
    }
    const rows = Array.from(text.matchAll(/<data>([\s\S]*?)<\/data>/g), match => {
      const body = match[1];
      const value = tag => {
        const found = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
        return found ? found[1] : '';
      };
      const children = [
        'name', 'obj_id', 'object_name', 'iw_name', 'type', 'obj_type',
        'id', 'unit_id'
      ].map(tag => new Element(tag, value(tag)));
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

let scenario = 'panels';
const calls = [];
const response = text => ({
  ok: true,
  status: 200,
  text: async () => text,
  arrayBuffer: async () => Uint8Array.from(Buffer.from(text, 'utf8')).buffer
});
const unitJson = JSON.stringify([
  {unit_id: 'V01', unit_name: '360.001Ventilasjon'},
  {unit_id: 'V02', unit_name: '360.002 Ventilation'}
]);
const panelList = JSON.stringify([
  {id: '1', panel_name: 'Malformed', visible: '1'},
  {id: '2', panel_name: 'EmptyFallback', visible: '1'},
  {id: '3', panel_name: 'ZeroObjectXml', visible: '1'},
  {id: '4', panel_name: 'BrokenXml', visible: '1'},
  {id: '5', panel_name: 'JsonLinked', visible: '1'}
]);
const legacyXml = '<root>' +
  '<data><name>V2_old</name><id>driver_id</id><unit_id>STALE</unit_id></data>' +
  '<data><name>number_v3_label</name><id>real-xml</id><unit_id>UNIT_ID</unit_id></data>' +
  '<data><name>number_v3_label</name><id>UnDeFiNeD</id><unit_id>STALE2</unit_id></data>' +
  '<data><name>number_v3_label</name><id>real-xml</id><unit_id>#template</unit_id></data>' +
  '<data><name>V2_live</name><id>real-xml</id><unit_id>V02</unit_id></data>' +
  '</root>';
const jsonPanel = JSON.stringify({
  panel_name: 'JsonLinked',
  panel_width: '1400px',
  panel_height: '750px',
  single_objects: [
    {obj_id: 'number_v3_label', driver_id: 'driver_id', unit_id: 'STALE', linked: 'true'},
    {obj_id: 'number_v3_label', driver_id: 'real-json', unit_id: 'DRIVER_ID'},
    {obj_id: 'number_v3_label', driver_id: 'UNIT_ID', unit_id: 'STALE2'},
    {obj_id: 'number_v3_label', driver_id: 'real-json', unit_id: 'NuLl'},
    {obj_id: 'number_v3_label', driver_id: 'real-json', unit_id: '#template'},
    {obj_id: 'number_v3_label', driver_id: 'real-json', unit_id: ''}
  ],
  containers: [{items: [
    {obj_id: 'V2_live', driver_id: 'real-json', unit_id: 'V01'}
  ]}],
  graphics: []
});

global.fetch = async url => {
  calls.push({scenario, url});
  if (url.includes('iw_load_units.php')) return response(unitJson);
  if (url.includes('V3get_plant_designer_panels')) {
    return response(scenario === 'malformed-list' ? '[{"panel_name":' : panelList);
  }
  if (url.includes('format=json') && url.includes('name=Malformed')) {
    return response('{"panel_name":');
  }
  if (url.includes('format=json') && (
    url.includes('name=EmptyFallback') ||
    url.includes('name=ZeroObjectXml') ||
    url.includes('name=BrokenXml')
  )) {
    return response('[]');
  }
  if (url.includes('format=json') && url.includes('name=JsonLinked')) {
    return response(jsonPanel);
  }
  if (url.includes('format=image_data')) return response('');
  if (url.includes('name=EmptyFallback')) return response(legacyXml);
  if (url.includes('name=ZeroObjectXml')) return response('<root></root>');
  if (url.includes('name=BrokenXml')) return response('<root><data>');
  throw new Error('unexpected URL ' + url);
};

const source = fs.readFileSync(process.argv[1], 'utf8');
const run = eval(`(${source})`);
const page = {
  evaluate: async callback => callback([{id: '9099', name: 'Test plant'}])
};

async function survey(nextScenario) {
  scenario = nextScenario;
  return JSON.parse(await run(page));
}

(async () => {
  const panelResult = await survey('panels');
  const malformedListResult = await survey('malformed-list');
  const panels = panelResult.plants['9099'].panels;
  process.stdout.write(JSON.stringify({
    malformed: panels.find(panel => panel.name === 'Malformed'),
    fallback: panels.find(panel => panel.name === 'EmptyFallback'),
    zeroObjectXml: panels.find(panel => panel.name === 'ZeroObjectXml'),
    malformedXml: panels.find(panel => panel.name === 'BrokenXml'),
    jsonLinked: panels.find(panel => panel.name === 'JsonLinked'),
    malformedListError: malformedListResult.plants['9099'].error,
    malformedXmlRequests: calls.filter(
      call => call.url.includes('name=Malformed') && !call.url.includes('format=json')
    ).length
  }));
})().catch(error => {
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
        with self.subTest("malformed panel JSON"):
            self.assertIsNone(observed["malformed"]["source_format"])
            self.assertEqual(
                observed["malformed"]["fetch_error"], "malformed JSON"
            )
            self.assertEqual(observed["malformedXmlRequests"], 0)
        with self.subTest("valid empty JSON uses linked XML fallback"):
            self.assertEqual(observed["fallback"]["source_format"], "xml_only")
            self.assertEqual(observed["fallback"]["unit_ids"], ["V02"])
            self.assertEqual(
                observed["fallback"]["unit_names"], ["360.002 Ventilation"]
            )
            self.assertEqual(observed["fallback"]["n_v2"], 2)
        with self.subTest("well-formed zero-object panel XML"):
            self.assertEqual(observed["zeroObjectXml"]["source_format"], "xml_only")
            self.assertTrue(observed["zeroObjectXml"]["separator"])
            self.assertEqual(observed["zeroObjectXml"]["n_obj"], 0)
            self.assertIsNone(observed["zeroObjectXml"]["fetch_error"])
        with self.subTest("malformed panel XML"):
            self.assertIsNone(observed["malformedXml"]["source_format"])
            self.assertEqual(observed["malformedXml"]["fetch_error"], "malformed XML")
            self.assertEqual(observed["malformedXml"]["unit_ids"], [])
            self.assertEqual(observed["malformedXml"]["unit_names"], [])
        with self.subTest("JSON unit IDs require real drivers"):
            self.assertEqual(observed["jsonLinked"]["source_format"], "json")
            self.assertEqual(observed["jsonLinked"]["unit_ids"], ["V01"])
            self.assertEqual(
                observed["jsonLinked"]["unit_names"], ["360.001Ventilasjon"]
            )
            self.assertEqual(observed["jsonLinked"]["n_v2"], 1)
        with self.subTest("malformed panel list JSON"):
            self.assertEqual(observed["malformedListError"], "malformed JSON")
