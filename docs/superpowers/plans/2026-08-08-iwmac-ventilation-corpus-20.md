# IWMAC Ventilation Corpus — 20-Plant Implementation Plan

> **For agentic workers:** Follow this plan task-by-task. Repository workflow overrides Superpowers worker routing: Claude coordinates, Codex implements in this isolated worktree, Claude reviews actual diffs and runs authenticated browser work. Do not invoke `superpowers:subagent-driven-development`.

**Goal:** Survey exactly 20 MENY plants using authenticated read-only requests, derive a machine-readable ventilation corpus, and update IWMAC Designer documentation with verified production conventions.

**Architecture:** A self-contained browser callback collects sanitized panel and unit metadata into one raw batch artifact. A Python standard-library builder deterministically matches ventilation by panel name and linked unit display name, validates the 20-plant batch, and emits the focused corpus. Human documentation summarizes generated data and keeps production plant 9099 separate from generated demo material.

**Tech Stack:** JavaScript executed in Thomas's authenticated real Chrome through `playwright-cli`; same-origin `fetch`; Python 3.12 standard library; `unittest`; JSON; Markdown; Git/GitHub CLI; Graphify; reviewed `claude-obsidian` WSL transaction workflow.

## Global Constraints

- Work only in `C:\Users\Thomas\Documents\Claude\repos\.worktrees\tampermonkey-ventilation-corpus` on branch `claude/ventilation-corpus-20`.
- Primary checkout is dirty and read-only for this task. Never reset, clean, stash, discard, copy over, or modify its existing survey work.
- Initial batch attempts exactly these 20 plants: `8001, 8002, 8016, 8045, 8049, 8075, 8076, 8088, 8098, 8124, 8132, 8146, 8150, 8158, 8205, 8214, 8232, 8239, 8272, 8289`.
- Plant names are: MENY Rona; MENY Bekkestua; MENY Støletorget; MENY Nanset; MENY Osloveien Hønefoss; Meny GS; MENY Slependen; MENY Romeriksenteret; MENY Stortorvet; MENY Alna; MENY Rasta; MENY Høvik; MENY Stovner; Meny Trekanten; MENY Brakerøya; MENY Langhus; MENY Askim; MENY Vollebekk; MENY Åssiden; MENY Fantoft.
- Browser activity is read-only. Allowed endpoints are `V3get_plant_designer_panels`, `iw_load_ctrls.php` JSON/image/XML reads, and `iw_load_units.php`. No POST, save, sync, upload, delete, or compile endpoint.
- Browser uses Thomas's existing authenticated real Chrome session. Never sign in or handle credentials on their behalf.
- Keep request pacing at least 120 ms between panels and 250 ms between plants.
- Match ventilation using both normalized panel names and linked unit display names. Stored `unit_id` alone never counts as a match.
- Include JSON-backed, XML-only, visible, hidden, modern V3, and legacy V2 records.
- Strip `saved_by`, raw panel payloads, cookies, tokens, browser state, and personal metadata from committed artifacts.
- Production and generated/demo records remain separate. Generated demo never contributes to production totals.
- Do not edit `IWMAC-Designer-Import-Export.user.js`; no `@version` bump or Downloads export scan is needed.
- No new production dependency.
- Every logical implementation task ends with a commit using `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Before final push, Claude reviews actual diff and reruns all checks. After push, refresh repository Graphify output, combined graph when counts are quoted, and vault commit pin/count claims through reviewed WSL transaction workflow.

## File Map

**Create**

- `iwmac-designer-import-export/iwmac-designer-reference/ventilation-survey-20.js` — authenticated read-only browser callback for exact 20-plant batch.
- `iwmac-designer-import-export/iwmac-designer-reference/build-ventilation-corpus.py` — deterministic sanitizer, matcher, validator, and corpus builder.
- `iwmac-designer-import-export/iwmac-designer-reference/tests/test_build_ventilation_corpus.py` — standard-library unit tests for matching, XML-only handling, privacy, and batch invariants.
- `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/ventilation-survey-fixture.json` — compact synthetic survey covering panel-name, unit-name, both, XML-only, hidden, V2, zero-match, and failed-plant cases.
- `iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json` — sanitized live raw source for exactly 20 plants. This additive batch artifact replaces no existing survey file.
- `iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json` — derived production ventilation records and batch coverage.

The approved design calls the general survey raw source and permits updating it when new records are added. This branch deliberately does not modify `reference_data/plant-panel-survey.json`: Thomas's primary checkout has a newer uncommitted fleet expansion, while this worktree is based on the older committed survey. Merging either copy here could overwrite or duplicate unrelated work. `plant-panel-survey-meny-20.json` is therefore the authoritative raw source for this bounded batch; a later deterministic merge into the general survey is separate work after the primary expansion lands.
- `iwmac-designer-import-export/iwmac-designer-reference/VENTILATION-CORPUS.md` — human guide, coverage, source selection, and limitations.

**Modify**

- `iwmac-designer-import-export/README.md` — link focused corpus from AI-generated panel/reference section.
- `iwmac-designer-import-export/iwmac-designer-reference/PANEL-TYPE-GUIDE.md` — expand ventilation section using verified 20-plant evidence and distinguish modern JSON from legacy/XML-only forms.
- `iwmac-designer-import-export/iwmac-designer-reference/PLANT-PANEL-CATALOG.md` — add compact MENY 20-plant batch section and named ventilation copy sources.
- `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md` — document matching method, corpus artifacts, and XML-only export limitation.

---

### Task 1: Deterministic Corpus Builder

**Files:**
- Create: `iwmac-designer-import-export/iwmac-designer-reference/build-ventilation-corpus.py`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/test_build_ventilation_corpus.py`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/ventilation-survey-fixture.json`

**Interfaces:**
- Consumes: raw survey JSON shaped as `{survey_date, fleet, batch, plants}` where `batch.plant_ids` contains exactly 20 unique string IDs and each plant has `name`, `units`, `panels`, and `error`.
- Produces: `build_corpus(raw: dict) -> dict`, `normalize_text(value: object) -> str`, `is_ventilation_name(value: object) -> bool`, and CLI `python build-ventilation-corpus.py INPUT OUTPUT`.
- Corpus schema: `{schema_version, generated_from, survey_date, fleet, batch, summary, plants, panels, canonical_examples}`.

- [ ] **Step 1: Write fixture covering all decisions**

Generate fixture with this complete deterministic script. Seven explicit records cover both discovery routes, JSON, XML-only, hidden, V2, zero-match, failed, and partial outcomes. Script generates remaining 13 zero-match records from exact ID/name list, so no fixture row is omitted or left for manual completion.

```python
import json
from pathlib import Path

plant_ids = [
    "8001", "8002", "8016", "8045", "8049", "8075", "8076", "8088",
    "8098", "8124", "8132", "8146", "8150", "8158", "8205", "8214",
    "8232", "8239", "8272", "8289",
]
zero_match_names = {
    "8088": "MENY Romeriksenteret",
    "8098": "MENY Stortorvet",
    "8124": "MENY Alna",
    "8132": "MENY Rasta",
    "8146": "MENY Høvik",
    "8150": "MENY Stovner",
    "8158": "Meny Trekanten",
    "8205": "MENY Brakerøya",
    "8214": "MENY Langhus",
    "8232": "MENY Askim",
    "8239": "MENY Vollebekk",
    "8272": "MENY Åssiden",
    "8289": "MENY Fantoft",
}

def json_panel(name="Oversikt", panel_id="1"):
    return {
        "name": name, "id": panel_id, "visible": "1", "source_format": "json",
        "w": "1000px", "h": "700px", "n_obj": 20, "n_cont": 0,
        "n_graph": 0, "n_items_total": 20, "n_linked": 20, "n_v2": 0,
        "max_x": 1000, "max_y": 700, "census": {}, "has_bg": True,
        "bg_kb": 20, "unit_ids": [], "unit_names": [], "fetch_error": None,
    }

plants = {
    "8001": {
        "name": "MENY Rona", "error": None, "unit_error": None,
        "units": [{"unit_id": "V01", "unit_name": "360.001 Ventilasjon"}],
        "panels": [{
            "name": "360.001 Ventilasjon", "id": "3", "visible": "1",
            "source_format": "json", "w": "1400px", "h": "750px",
            "n_obj": 102, "n_cont": 0, "n_graph": 0, "n_items_total": 102,
            "n_linked": 57, "n_v2": 0, "max_x": 1400, "max_y": 623,
            "census": {"number_v3_label_11px_norm": 16}, "has_bg": True,
            "bg_kb": 6, "unit_ids": ["V01"],
            "unit_names": ["360.001 Ventilasjon"], "fetch_error": None,
        }],
    },
    "8002": {
        "name": "MENY Bekkestua", "error": None, "unit_error": None,
        "units": [{"unit_id": "V02", "unit_name": "Ventilasjon butikk"}],
        "panels": [{
            "name": "Butikk", "id": "7", "visible": "4", "source_format": "json",
            "w": "1400px", "h": "750px", "n_obj": 80, "n_cont": 0,
            "n_graph": 0, "n_items_total": 80, "n_linked": 40, "n_v2": 0,
            "max_x": 1200, "max_y": 700, "census": {}, "has_bg": True,
            "bg_kb": 6, "unit_ids": ["V02"],
            "unit_names": ["Ventilasjon butikk"], "fetch_error": None,
        }],
    },
    "8016": {
        "name": "MENY Støletorget", "error": None, "unit_error": None,
        "units": [],
        "panels": [{
            "name": "VENTILATION", "id": "9", "visible": "4",
            "source_format": "xml_only", "n_obj": 44, "n_v2": 44,
            "separator": False, "unit_ids": [], "unit_names": [],
            "fetch_error": None,
        }],
    },
    "8045": {
        "name": "MENY Nanset", "error": None, "unit_error": None,
        "units": [], "panels": [json_panel()],
    },
    "8049": {
        "name": "MENY Osloveien Hønefoss", "error": "no panel list",
        "unit_error": None, "units": [], "panels": [],
    },
    "8075": {
        "name": "Meny GS", "error": None, "unit_error": "HTTP 500",
        "units": [], "panels": [json_panel("360.001 Ventilasjon", "4")],
    },
    "8076": {
        "name": "MENY Slependen", "error": None, "unit_error": None,
        "units": [], "panels": [json_panel()],
    },
}
for plant_id, plant_name in zero_match_names.items():
    plants[plant_id] = {
        "name": plant_name, "error": None, "unit_error": None,
        "units": [], "panels": [json_panel()],
    }

fixture = {
    "survey_date": "2026-08-08",
    "fleet": "MENY Norway — initial 20-plant batch",
    "batch": {"requested": 20, "plant_ids": plant_ids},
    "plants": {plant_id: plants[plant_id] for plant_id in plant_ids},
}
output = Path("iwmac-designer-import-export/iwmac-designer-reference/tests/fixtures/ventilation-survey-fixture.json")
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
```

Run script from worktree root and inspect generated fixture before writing tests.

- [ ] **Step 2: Write failing tests for normalization and classification**

```python
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_ventilation_corpus", ROOT / "build-ventilation-corpus.py")
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
        self.assertFalse(MODULE.is_ventilation_name("V01"))
        self.assertFalse(MODULE.is_ventilation_name("Varmegjenvinning"))

    def test_reports_panel_unit_and_both_reasons(self):
        corpus = MODULE.build_corpus(self.raw)
        reasons = {(p["plant_id"], p["panel_name"]): p["discovery_reason"] for p in corpus["panels"]}
        self.assertEqual(reasons[("8001", "360.001 Ventilasjon")], "both")
        self.assertEqual(reasons[("8002", "Butikk")], "unit_name")
        self.assertEqual(reasons[("8016", "VENTILATION")], "panel_name")

    def test_keeps_xml_hidden_v2_and_failed_plant_coverage(self):
        corpus = MODULE.build_corpus(self.raw)
        xml = next(p for p in corpus["panels"] if p["plant_id"] == "8016")
        self.assertEqual(xml["source_format"], "xml_only")
        self.assertEqual(xml["visibility"], "hidden")
        self.assertEqual(xml["v2_objects"], 44)
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

    def test_output_contains_no_private_fields(self):
        self.raw["plants"]["8001"]["saved_by"] = "private-user"
        corpus = MODULE.build_corpus(self.raw)
        encoded = json.dumps(corpus)
        self.assertNotIn("saved_by", encoded)
        self.assertNotIn("private-user", encoded)
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -v
```

Expected: import fails because `build-ventilation-corpus.py` does not exist.

- [ ] **Step 4: Implement minimal builder**

Implement these exact rules:

```python
VENTILATION_WORDS = re.compile(r"\b(?:ventilasjon|ventilation)\b")
PRIVATE_KEYS = {"saved_by", "cookie", "cookies", "token", "session", "image_data", "raw_json", "raw_xml"}

def normalize_text(value):
    text = unicodedata.normalize("NFKC", "" if value is None else str(value))
    return " ".join(text.casefold().split())

def is_ventilation_name(value):
    return bool(VENTILATION_WORDS.search(normalize_text(value)))
```

`build_corpus` must:

1. Reject a batch unless `batch.plant_ids` has exactly 20 unique IDs and `plants` has an outcome record for every ID.
2. Iterate plants in `batch.plant_ids` order and panels in source order.
3. Compute panel-name match from exact panel name.
4. Compute unit-name match only from `panel.unit_names`, already restricted by scraper to units linked from that panel's objects.
5. Emit `discovery_reason` as `both`, `panel_name`, or `unit_name`.
6. Map visibility `"1"` to `visible`; every other value to `hidden`.
7. Keep JSON stats, XML-only stats, exact names, exact unit IDs/names, census, background, and fetch-error summary. Omit unknown/raw/private fields by constructing output from an allowlist rather than copying input dictionaries.
8. Emit one plant coverage row per attempted plant with `outcome` `matched`, `zero_match`, `partial`, or `failed`. Precedence: `failed` when plant-level `error` exists and no panels returned; `partial` when any plant `error`, `unit_error`, or panel `fetch_error` exists and at least one panel returned; otherwise `matched` when one or more panels match; otherwise `zero_match`. Preserve sanitized error strings in plant coverage.
9. Derive summary counts for attempted, successful, failed, zero-match, matched plants, matched panels, JSON panels, XML-only panels, visible panels, hidden panels, and V2-bearing panels.
10. Include canonical production example for plant 9099 as documented evidence, marked `outside_batch: true`, and generated demo as `classification: generated_demo`, `included_in_production_totals: false`.

CLI writes pretty UTF-8 JSON with `ensure_ascii=False`, `indent=2`, trailing newline, and refuses output when validation fails.

- [ ] **Step 5: Run unit tests**

Run:

```bash
python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit builder and tests**

```bash
git add iwmac-designer-import-export/iwmac-designer-reference/build-ventilation-corpus.py iwmac-designer-import-export/iwmac-designer-reference/tests
git commit -m "feat: add deterministic ventilation corpus builder" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: Authenticated Read-Only 20-Plant Survey Runner

**Files:**
- Create: `iwmac-designer-import-export/iwmac-designer-reference/ventilation-survey-20.js`
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/tests/test_build_ventilation_corpus.py`

**Interfaces:**
- Consumes: one authenticated Designer page in Thomas's real Chrome; exact `PLANTS` array embedded in file.
- Produces: JSON string matching Task 1 raw schema. No server mutation.
- Uses GET only: panel list, panel JSON, image data, XML fallback, unit XML.

- [ ] **Step 1: Add static safety tests before runner exists**

Add tests that read runner source and assert exact batch and absence of mutation verbs/endpoints:

```python
    def test_browser_runner_is_exactly_20_and_read_only(self):
        source = (ROOT / "ventilation-survey-20.js").read_text(encoding="utf-8")
        for forbidden in ("method: 'POST'", 'method: "POST"', "iw_save_ctrls", "iw_sync", "iw_remove_panel", "V3_save_design_panel", "V3delete_designer_panels", "iw_upload_file"):
            self.assertNotIn(forbidden, source)
        expected = ["8001", "8002", "8016", "8045", "8049", "8075", "8076", "8088", "8098", "8124", "8132", "8146", "8150", "8158", "8205", "8214", "8232", "8239", "8272", "8289"]
        match = re.search(r"const PLANTS = (\[[\s\S]*?\]);", source)
        self.assertIsNotNone(match)
        plants = json.loads(match.group(1))
        self.assertEqual([p["id"] for p in plants], expected)
        self.assertEqual(len({p["id"] for p in plants}), 20)
```

Add `import re`.

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
python -m unittest iwmac-designer-import-export/iwmac-designer-reference/tests/test_build_ventilation_corpus.py -v
```

Expected: `FileNotFoundError` for `ventilation-survey-20.js`.

- [ ] **Step 3: Implement browser callback**

Use existing `survey-batch.js` conventions, but hard-code exact object array:

```js
const PLANTS = [
  {"id":"8001","name":"MENY Rona"},
  {"id":"8002","name":"MENY Bekkestua"},
  {"id":"8016","name":"MENY Støletorget"},
  {"id":"8045","name":"MENY Nanset"},
  {"id":"8049","name":"MENY Osloveien Hønefoss"},
  {"id":"8075","name":"Meny GS"},
  {"id":"8076","name":"MENY Slependen"},
  {"id":"8088","name":"MENY Romeriksenteret"},
  {"id":"8098","name":"MENY Stortorvet"},
  {"id":"8124","name":"MENY Alna"},
  {"id":"8132","name":"MENY Rasta"},
  {"id":"8146","name":"MENY Høvik"},
  {"id":"8150","name":"MENY Stovner"},
  {"id":"8158","name":"Meny Trekanten"},
  {"id":"8205","name":"MENY Brakerøya"},
  {"id":"8214","name":"MENY Langhus"},
  {"id":"8232","name":"MENY Askim"},
  {"id":"8239","name":"MENY Vollebekk"},
  {"id":"8272","name":"MENY Åssiden"},
  {"id":"8289","name":"MENY Fantoft"}
];
```

Inside `page.evaluate`, implement:

- `getText(relativeUrl)` using `fetch(base + relativeUrl, {credentials: 'same-origin'})`, rejecting non-2xx HTTP statuses.
- `getJson(relativeUrl)` returning parsed JSON or `null`.
- `parseUnits(payloadText)` must support both known response families without assuming one unverified XML shape:
  1. Try JSON first. Walk arrays plus object values recursively. Treat an object as a unit row when candidate ID keys `unit_id`, `id`, or `unit_ref` and candidate name keys `unit_name`, `name`, `alias_text`, or `aliastext` yield scalar values.
  2. Otherwise parse XML/HTML with `DOMParser`. Inspect `unit`, `data`, and `option` elements. Read ID/name from descendant tags with those same candidate names, then from same-named attributes; for `<option>`, use `value` as ID and trimmed text content as name.
  3. Discard rows missing ID or name, normalize values only for blank checks, preserve exact trimmed source strings, and deduplicate by the tuple `(unit_id, unit_name)`.
  4. When nonblank payload produces zero rows, return diagnostic `unit payload parsed zero rows` instead of silently treating inventory as empty.
- Unit request: `iw_load_units.php?cust_id=<plant>&driverId=`. If request or parsing fails, set sanitized `unit_error` and continue panel survey. No panel may gain `unit_names` from a plant-wide fuzzy match: join exact object `unit_id` values only.
- Panel list request: `designer_site/V3_objectHandler.php?function=V3get_plant_designer_panels&plant_id=<plant>`.
- JSON request and stats exactly as `survey-batch.js`, plus `source_format: "json"`, `unit_ids` sorted unique from all single objects and container items with real `unit_id`, and `unit_names` obtained by joining those IDs to parsed unit rows.
- Background request only for valid JSON panels.
- XML fallback request when JSON lacks `panel_name`; count `<data>` nodes, set `source_format: "xml_only"`, `n_obj`, `n_v2` from legacy object names/types matching current V2 heuristic, and `separator` when count is zero.
- Per-panel failures in `fetch_error`; plant failures in `error`; unit failures in `unit_error`.
- Top-level metadata exactly:

```js
{
  survey_date: "2026-08-08",
  fleet: "MENY Norway — initial 20-plant batch",
  method: "authenticated read-only GET panel list + unit XML + panel JSON/image/XML fallback",
  batch: {requested: 20, plant_ids: PLANTS.map(p => p.id)},
  plants: { /* keyed by plant id */ }
}
```

Return `JSON.stringify(result)`. Do not retain raw JSON, XML, image data, response headers, user identity, or cookies.

- [ ] **Step 4: Run static and unit tests**

Run:

```bash
python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -v
```

Expected: all tests pass.

- [ ] **Step 5: Review runner for network safety**

Run:

```bash
python -c "from pathlib import Path; s=Path('iwmac-designer-import-export/iwmac-designer-reference/ventilation-survey-20.js').read_text(encoding='utf-8'); forbidden=['POST','iw_save_ctrls','iw_sync','iw_remove_panel','V3_save_design_panel','V3delete_designer_panels','iw_upload_file']; print({x:s.count(x) for x in forbidden})"
```

Expected: every count is `0`.

- [ ] **Step 6: Commit runner**

```bash
git add iwmac-designer-import-export/iwmac-designer-reference/ventilation-survey-20.js iwmac-designer-import-export/iwmac-designer-reference/tests/test_build_ventilation_corpus.py
git commit -m "feat: add read-only 20-plant ventilation survey" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: Execute Live Survey and Build Corpus

**Files:**
- Create: `iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json`
- Create: `iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json`

**Interfaces:**
- Consumes: Task 2 browser callback and authenticated real Chrome page at `http://legacy.iwmac.local/iwmac_designer_v4/?plant_id=9099`.
- Produces: sanitized raw survey and deterministic corpus.

- [ ] **Step 1: Recheck worktree and primary checkout safety**

Run:

```bash
git -C "C:/Users/Thomas/Documents/Claude/repos/tampermonkey-scripts" status --short --branch
git status --short --branch
```

Expected: primary checkout still contains pre-existing dirty survey work; isolated worktree contains only planned branch work. Do not copy or reconcile primary files.

- [ ] **Step 2: Attach Playwright CLI to Thomas's real Chrome**

Use installed `playwright-cli` skill instructions. Attach through existing Chrome extension session, open or reuse authenticated Designer tab, and navigate to:

```text
http://legacy.iwmac.local/iwmac_designer_v4/?plant_id=9099
```

Verify page title contains `IWMAC Designer V5`. If session is unauthenticated, stop and ask Thomas to restore their own session; never enter credentials.

- [ ] **Step 3: Smoke-test unit parsing against live plant 9099**

Before starting 20-plant batch, run one read-only `iw_load_units.php?cust_id=9099&driverId=` request in authenticated page context and apply runner's `parseUnits` logic to response in memory. Print only response family (`json` or `xml`), parsed row count, and exact parsed row for `V01`; never write raw payload. Required evidence: at least one parsed row and `V01` has nonblank display name. If this fails, stop batch, inspect only structural key/tag names in memory, send correction through original Codex thread, rerun deterministic tests, then repeat this smoke test. Do not claim unit-name discovery from unverified parser output.

- [ ] **Step 4: Run exact browser callback once**

Run:

```bash
playwright-cli run-code --filename=iwmac-designer-import-export/iwmac-designer-reference/ventilation-survey-20.js
```

Capture returned JSON string outside repository first. Do not rerun successful plants merely to improve totals. If CLI emits wrapper text, extract only returned JSON object.

- [ ] **Step 5: Validate and save sanitized raw result**

Before writing repository file, validate:

```bash
python -c "import json,sys; d=json.load(open(sys.argv[1],encoding='utf-8')); ids=d['batch']['plant_ids']; assert len(ids)==20==len(set(ids)); assert set(ids)==set(d['plants']); print({'attempted':len(ids),'plant_errors':sum(bool(p.get('error')) for p in d['plants'].values()),'panel_errors':sum(bool(x.get('fetch_error')) for p in d['plants'].values() for x in p.get('panels',[]))})" TEMP_RESULT.json
```

Copy validated JSON to `reference_data/plant-panel-survey-meny-20.json` using pretty UTF-8 formatting. Do not save Playwright traces, browser profile, screenshots, or temporary response dumps under repository.

- [ ] **Step 6: Build focused corpus**

Run:

```bash
python iwmac-designer-import-export/iwmac-designer-reference/build-ventilation-corpus.py iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json
```

Expected: successful write, exactly 20 attempted plant coverage rows, explicit outcomes for every plant, and matched panels selected only by panel or linked-unit names.

- [ ] **Step 7: Validate privacy and corpus consistency**

Run:

```bash
python -m json.tool iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json > /dev/null
python -m json.tool iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json > /dev/null
python -c "import json,pathlib; paths=[pathlib.Path('iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json'),pathlib.Path('iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json')]; text='\n'.join(p.read_text(encoding='utf-8').casefold() for p in paths); banned=['saved_by','cookie','bearer ','sessionid','image_data']; found=[x for x in banned if x in text]; assert not found, found; c=json.loads(paths[1].read_text(encoding='utf-8')); assert c['summary']['attempted_plants']==20; assert len(c['plants'])==20; assert all(p['discovery_reason'] in {'panel_name','unit_name','both'} for p in c['panels']); print(c['summary'])"
```

Expected: both JSON files valid, no banned fields, 20 attempted plants, valid discovery reasons. Any failed requests remain explicit; do not describe batch as complete coverage when failures exist.

- [ ] **Step 8: Commit live data separately**

```bash
git add iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json
git commit -m "data: add initial 20-plant ventilation survey" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: Ventilation Guide and Existing Documentation

**Files:**
- Create: `iwmac-designer-import-export/iwmac-designer-reference/VENTILATION-CORPUS.md`
- Modify: `iwmac-designer-import-export/README.md`
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/PANEL-TYPE-GUIDE.md`
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/PLANT-PANEL-CATALOG.md`
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md`

**Interfaces:**
- Consumes: `ventilation-panel-corpus.json` summary and panel records.
- Produces: human guidance whose numeric claims are traceable to corpus fields.

- [ ] **Step 1: Generate evidence table before prose**

Run a Python one-liner that prints summary plus one line per matched panel:

```bash
python -c "import json; c=json.load(open('iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json',encoding='utf-8')); print(c['summary']); [print(p['plant_id'],p['plant_name'],p['panel_name'],p['discovery_reason'],p['source_format'],p.get('objects'),p.get('linked_objects'),p.get('v2_objects')) for p in c['panels']]"
```

Use only this output and canonical example fields for numeric claims. Do not infer missing values as zero.

- [ ] **Step 2: Write `VENTILATION-CORPUS.md`**

Include these sections:

1. Scope and exact 20 plant IDs.
2. Discovery: panel names plus panel-linked unit display names; `unit_id` alone excluded.
3. Coverage table with attempted, matched, zero-match, failed/partial, JSON, XML-only, visible/hidden, and V2-bearing counts.
4. Modern V3 object-drawn AHU pattern.
5. Legacy V2/XML-only pattern and current userscript export limitation.
6. Copy-source table ranked by suitability using object count, linked ratio, source format, dimensions, and errors—not object count alone.
7. Canonical plant 9099 production record: `360.001 Ventilasjon`, 1400×750, 102 objects, 57 linked, `V01`, zero V2/containers/graphics, approximately 6 KB blank/sidebar background, content extent 1400×623.
8. Generated demo separation: 45 unlinked objects, SVG background, no production bindings, excluded from totals.
9. Reproduction commands for survey callback and corpus builder.
10. Known limitations: authenticated session required; unit endpoint variation; XML cannot preserve container/graphics semantics; 20 plants are first batch, not fleet census; explicit failed/partial records.

- [ ] **Step 3: Update public README**

At existing live-fleet survey paragraph near `README.md:76`, add focused link to `VENTILATION-CORPUS.md` and machine corpus. State exact 20-plant initial MENY batch and avoid combining its counts with committed 41-plant Coop totals unless arithmetic is generated and failure-qualified.

- [ ] **Step 4: Update panel type guide**

At `PANEL-TYPE-GUIDE.md:46-60`:

- Preserve existing 41-plant Coop statistics as their own evidence set.
- Add MENY batch subsection sourced from new corpus.
- Explain panel-name and linked-unit-name discovery.
- Contrast modern V3 JSON panels with legacy V2/XML-only panels.
- Replace or extend best-copy-source list only when new panel has complete JSON, no fetch errors, useful dimensions, and strong linked ratio.

- [ ] **Step 5: Update plant catalog**

After Coop fleet summary, add `MENY ventilation batch — 20 attempted plants` section. Include compact rows only for matched panels plus a coverage row for each zero-match/failed plant. Link raw batch and focused corpus. Keep existing detailed Coop inventory unchanged.

- [ ] **Step 6: Update deep reference**

In `CLAUDE.md` section 17b near fleet survey:

- Link new guide, raw batch, and corpus.
- Document deterministic match rule.
- State XML-only panels can be surveyed but current userscript cannot export them until recompiled into JSON.
- State generated demo is not production evidence.
- Keep plant 9099 as canonical production example.

- [ ] **Step 7: Verify documentation numbers mechanically**

Add a test that loads corpus and checks every summary integer appears in `VENTILATION-CORPUS.md` coverage table using stable labels, then run:

```bash
python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -v
python -m json.tool iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json > /dev/null
python -m json.tool iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json > /dev/null
```

Expected: tests pass and JSON validates.

- [ ] **Step 8: Commit documentation**

```bash
git add iwmac-designer-import-export/README.md iwmac-designer-import-export/iwmac-designer-reference/VENTILATION-CORPUS.md iwmac-designer-import-export/iwmac-designer-reference/PANEL-TYPE-GUIDE.md iwmac-designer-import-export/iwmac-designer-reference/PLANT-PANEL-CATALOG.md iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md iwmac-designer-import-export/iwmac-designer-reference/tests/test_build_ventilation_corpus.py
git commit -m "docs: add production ventilation corpus guide" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 5: Independent Review, Push, and Knowledge-Layer Refresh

**Files:**
- Review all branch changes.
- Vault mutation only through `claude-obsidian` transaction workflow under WSL 2.
- Combined Graphify output at `C:\Users\Thomas\Documents\Claude\repos\graphify-out` remains uncommitted shared state and requires lock before writing.

**Interfaces:**
- Consumes: complete branch diff and test logs.
- Produces: reviewed pushed branch/PR, refreshed repo graph, combined graph if required, and vault source pin/count claims matching shipped commit.

- [ ] **Step 1: Claude reviews actual diff against acceptance criteria**

Run:

```bash
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- docs/superpowers iwmac-designer-import-export/README.md iwmac-designer-import-export/iwmac-designer-reference
```

Verify individually:

- exactly 20 attempted IDs and outcomes;
- both discovery routes;
- JSON/XML-only representation;
- explicit discovery reason and source format;
- plant 9099 exact canonical values;
- generated demo excluded from production totals;
- docs agree with JSON;
- no private/browser/temp material;
- no `.user.js` change;
- primary checkout untouched.

- [ ] **Step 2: Run full deterministic checks**

```bash
python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -v
python -m json.tool iwmac-designer-import-export/iwmac-designer-reference/reference_data/plant-panel-survey-meny-20.json > /dev/null
python -m json.tool iwmac-designer-import-export/iwmac-designer-reference/reference_data/ventilation-panel-corpus.json > /dev/null
git diff --check origin/main...HEAD
```

Expected: all tests pass, JSON valid, no whitespace errors.

- [ ] **Step 3: Codex performs independent read-only review**

Continue original Codex thread with sandbox `read-only`. Ask it to compare actual diff to spec, look for data/schema errors, privacy leaks, unsafe endpoints, doc-count drift, and missing tests. Claude verifies each finding against files and fixes confirmed issues through same Codex thread.

- [ ] **Step 4: Push branch and open PR**

Repository requires pushed changes. Run:

```bash
git push -u origin claude/ventilation-corpus-20
gh pr create --base main --head claude/ventilation-corpus-20 --title "docs: add 20-plant IWMAC ventilation corpus" --body-file PR_BODY.md
```

PR body summarizes scope, exact test commands, any plant/panel request failures, privacy checks, and data limitations. End body with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Delete local `PR_BODY.md` after PR creation if it is untracked and created solely for command input.

- [ ] **Step 5: Check CI**

```bash
gh pr checks --watch
```

Report any failure plainly. Do not merge with required checks failing. Merge only with Thomas's explicit action-time approval because merge changes public default branch and triggers downstream documentation obligations.

- [ ] **Step 6: Refresh repository Graphify output after shipped commit**

After merge/push to default branch, run from canonical checkout after preserving its dirty work:

```bash
graphify update .
```

Do not commit `graphify-out/`. If canonical checkout cannot safely move to shipped commit because of dirty files, run update in clean task worktree and keep generated graph local.

- [ ] **Step 7: Refresh combined graph when quoted counts changed**

Before writing shared `repos/graphify-out`, create/check lock `repos/.agent-locks/graphify-out.json` with agent, task, start time, and PID. Follow `docs/GRAPHIFY.md` merge command for current installed Graphify version. Remove own lock after success. Never run `graphify label`.

- [ ] **Step 8: Re-pin vault through reviewed WSL transaction**

Use installed wiki/`claude-obsidian` skill. Under WSL `Ubuntu-24.04`:

- re-pin `wiki/sources/GitHub - tampermonkey-scripts.md` to shipped commit;
- supersede old snapshot claim rather than overwriting historically true claim;
- update quoted Graphify counts and Tampermonkey catalog facts only when changed;
- stage, lint, review, apply, and verify transaction journal state `complete`.

Never overwrite vault files directly.

- [ ] **Step 9: Final report**

Report:

- 20 attempted plants and outcome counts;
- matched ventilation panel counts by JSON/XML-only and discovery reason;
- files changed;
- exact checks run and results;
- branch, commits, PR URL, CI state;
- any failed/partial requests or remaining limitations;
- Graphify and vault refresh result.
