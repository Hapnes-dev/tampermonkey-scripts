/* Diagnostics for rejected AI-authored panel files.
 * Run: node iwmac-designer-import-export/tests/test-import-diagnostics.js
 */
'use strict';
const assert = require('assert');
const api = require('../IWMAC-Designer-Import-Export.user.js');

/* The payload from the reported failure: Copilot could not open its knowledge
 * file, so it emitted a "specification" document with an invented format. */
const IMPROVISED = {
  format: 'IWMAC Designer demo specification',
  version: 1,
  source_document: 'CLAUDE.md',
  source_note: 'The enterprise search returned the reference document metadata and a detailed ' +
    'snippet, but opening the full file was unavailable. This JSON is therefore a safe demo ' +
    'specification, not a verified native Designer import export.'
};

function run() {
  /* 1. invented format ------------------------------------------------- */
  const r = api.parsePayload(IMPROVISED);
  assert.ok(r.errors && r.errors.length >= 2, 'invented format is rejected with an explanation');
  assert.ok(/must be exactly "iwmac-designer-panel"/.test(r.errors.join(' ')));
  assert.ok(r.diagnosis, 'a diagnosis is attached');
  assert.equal(r.diagnosis.improvised, true, 'the improvised-document signature is recognised');
  assert.ok(/wrote \*about\* a panel/.test(r.diagnosis.headline));
  assert.ok(r.diagnosis.facts.some(f => /single_objects\[\]: not found/.test(f)));
  assert.ok(r.diagnosis.facts.some(f => /source_document, source_note/.test(f)));
  const p = r.diagnosis.aiPrompt;
  assert.ok(/could not open your knowledge files/.test(p), 'names the real cause');
  assert.ok(/SAY SO AND STOP/.test(p));
  assert.ok(/"format": "iwmac-designer-panel"/.test(p), 'carries the required skeleton');
  assert.ok(/"saved_by": "copilot"/.test(p));
  assert.ok(/integer pixels/.test(p));

  /* an honest wrong-tool file is not slandered as improvised */
  const vv = api.parsePayload({ format: 'vv-fbx-sketch' });
  assert.ok(/wrong tool/.test(vv.errors[0]));
  assert.equal(vv.diagnosis.improvised, false);

  /* 2. truncated output ------------------------------------------------ */
  const cut = '{"format":"iwmac-designer-panel","version":1,"panel":{"single_objects":[{"obj_id":"number_v3_value_only"';
  const bad = api.diagnoseBadJson(cut, 'Unexpected end of JSON input');
  assert.ok(/incomplete/.test(bad.errors.join(' ')), 'truncation is named, not just "invalid JSON"');
  assert.ok(/cut off/.test(bad.diagnosis.headline));
  assert.ok(bad.diagnosis.facts.some(f => /unclosed brackets at end of text: 4/.test(f)));
  assert.ok(/Attach it as a downloadable \.json file/.test(bad.diagnosis.aiPrompt));
  assert.ok(/never add "\.\.\. \(truncated\)"/.test(bad.diagnosis.aiPrompt));

  /* string cut mid-value is detected even when brackets happen to balance */
  const midStr = api.diagnoseBadJson('{"panel_name":"360.001 Vent', 'Unterminated string');
  assert.ok(/stops in the middle of a string/.test(midStr.errors.join(' ')));

  /* markdown fence */
  const fenced = api.diagnoseBadJson('```json\n{"format":"iwmac-designer-panel"}\n```', 'Unexpected token `');
  assert.ok(/markdown code fence/.test(fenced.errors.join(' ')));

  /* prose preamble */
  const prose = api.diagnoseBadJson('Here is the panel you asked for:\n{"a":1}', 'Unexpected token H');
  assert.ok(/starts with prose/.test(prose.errors.join(' ')));

  /* a genuinely valid file produces no false truncation claim */
  const okJson = JSON.stringify({ format: 'iwmac-designer-panel' });
  const notCut = api.diagnoseBadJson(okJson, 'irrelevant');
  assert.ok(!/incomplete/.test(notCut.errors.join(' ')), 'balanced text is not called truncated');

  /* 3. right wrapper, broken objects ----------------------------------- */
  const doc = {
    panel_width: '1400px', panel_height: '750px', containers: [], graphics: [],
    single_objects: [
      { obj_id: 'number_v3_value_only', posLeft: 10, posTop: 10, posWidth: 80, posHeight: 24 },
      { posLeft: 20, posTop: 20, posWidth: 80, posHeight: 24 },              // no obj_id
      { obj_id: 'header_grey75', posLeft: 'center', posTop: 40, posWidth: 80, posHeight: 24 }
    ]
  };
  /* "120px" is NOT broken — parseInt reads it as 120, same as the host does. */
  assert.equal(api.validateDoc({
    single_objects: [{ obj_id: 'header_grey75', posLeft: '120px', posTop: 0, posWidth: 8, posHeight: 2 }]
  }).warnings.filter(w => /posLeft/.test(w)).length, 0, 'a "120px" string is accepted, not reported');
  const v = api.validateDoc(doc);
  const d = api.diagnoseDoc(doc, v.errors, v.warnings);
  assert.ok(/wrapper was accepted/.test(d.headline));
  assert.ok(d.facts.some(f => /objects with no obj_id: 1/.test(f)), 'names the offending index');
  assert.ok(d.facts.some(f => /objects with bad geometry: 2\.posLeft/.test(f)));
  assert.ok(d.facts.some(f => /single_objects\[\]: 3 objects/.test(f)));
  assert.ok(/DESIGN-OBJECT-CATALOG\.md/.test(d.aiPrompt));

  /* a well-formed doc still passes untouched */
  const good = api.parsePayload({
    format: 'iwmac-designer-panel', version: 1,
    panel: { single_objects: [{ obj_id: 'number_v3_value_only', posLeft: 1, posTop: 1, posWidth: 8, posHeight: 2 }] }
  });
  assert.ok(!good.errors, 'valid envelope is not rejected');
  assert.equal(api.validateDoc(good.doc).errors.length, 0);

  /* envelope with no panel inside */
  const noPanel = api.parsePayload({ format: 'iwmac-designer-panel', version: 1 });
  assert.ok(/"panel" must be an object/.test(noPanel.errors[0]));
  assert.ok(noPanel.diagnosis);

  /* background-only import (v1.10.0): a file whose only payload is artwork.
     Rejected by the normal rules, accepted with allowEmpty — and only that one
     rule is waived, so a malformed object in the file is still caught. */
  const artOnly = api.parsePayload({
    format: 'iwmac-designer-panel', version: 1,
    panel: {
      panel_width: '1400px', panel_height: '750px',
      converted: 'true', image_data: 'data:image/png;base64,AAAA',
      single_objects: [], containers: [], graphics: []
    }
  });
  assert.ok(!artOnly.errors, 'an artwork-only envelope parses');
  assert.ok(/document is empty/.test(api.validateDoc(artOnly.doc).errors.join(' ')),
    'without allowEmpty an object-free document is still rejected');
  assert.equal(api.validateDoc(artOnly.doc, { allowEmpty: true }).errors.length, 0,
    'allowEmpty accepts the object-free document');
  assert.ok(api.validateDoc({ single_objects: [{ posLeft: 1 }] }, { allowEmpty: true })
    .errors.some(e => /no "obj_id"/.test(e)),
    'allowEmpty waives only the emptiness rule');
  assert.equal(api.docHasBackground(artOnly.doc), true, 'embedded raster counts as artwork');
  assert.equal(api.docHasBackground({ image_svg: '<svg viewBox="0 0 1 1"></svg>' }), true,
    'authored SVG counts as artwork');
  assert.equal(api.docHasBackground({ converted: 'true' }), false, 'converted with no data is not artwork');
  assert.equal(api.docHasBackground(null), false);

  console.log('IWMAC import diagnostics tests passed');
}

run();
