'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'IWMAC-Designer-Import-Export.user.js');
const README = path.join(ROOT, 'README.md');
const REFERENCE = path.join(ROOT, 'iwmac-designer-reference', 'CLAUDE.md');
const api = require(SCRIPT);

const SVG = '<svg viewBox="0 0 2 2" xmlns="http://www.w3.org/2000/svg"><path d="M0 0L2 2Z" /></svg>';
const SVG_URL = 'data:image/svg+xml;base64,' + Buffer.from(SVG, 'utf8').toString('base64');
const PNG_URL = 'data:image/png;base64,AA==';
const decodeUtf8 = bytes => Buffer.from(bytes).toString('utf8');

function envelope(imageData) {
  const panel = {
    plant_id: '9099', panel_name: 'Maskin', panel_width: '1400px', panel_height: '750px',
    single_objects: [{obj_id: 'number_v3_value_only'}], containers: [], graphics: []
  };
  if (imageData) {
    panel.converted = 'true';
    panel.image_data = imageData;
  }
  return api.buildEnvelope(panel, {exported_at: '2026-08-09T00:00:00.000Z'});
}

async function run() {
  // The two version strings must not drift: Tampermonkey updates on the header
  // @version, while the UI and the export envelope report IWDIE_VERSION.
  const headerVersion = /^\/\/ @version\s+(\S+)/m.exec(fs.readFileSync(SCRIPT, 'utf8'));
  assert.ok(headerVersion, 'no @version header found');
  assert.equal(api.IWDIE_VERSION, headerVersion[1]);
  assert.equal(envelope(null).version, 1);
  assert.equal(api.sanitizeName('Maskin Panel'), 'maskin-panel');
  assert.equal(api.parsePayload(envelope(null)).doc.panel_name, 'Maskin');
  assert.deepEqual(api.validateSvg(SVG), []);

  const svgDownloads = [];
  const svgResult = await api.completeExport(envelope(SVG_URL), {
    decodeUtf8,
    traceRaster: async () => { throw new Error('raster tracer must not run for SVG'); },
    download: (env, note) => svgDownloads.push({env, note})
  });
  assert.equal(svgResult.env.panel.image_svg_trace, SVG);
  assert.equal(svgDownloads.length, 1);
  assert.equal(svgDownloads[0].env.panel.image_svg_trace, SVG);

  const rasterDownloads = [];
  const rasterResult = await api.completeExport(envelope(PNG_URL), {
    decodeUtf8,
    traceRaster: async dataUrl => {
      assert.equal(dataUrl, PNG_URL);
      return SVG;
    },
    download: (env, note) => rasterDownloads.push({env, note})
  });
  assert.equal(rasterResult.env.panel.image_svg_trace, SVG);
  assert.equal(rasterDownloads.length, 1);
  assert.match(rasterDownloads[0].note, /1 paths/);

  let failedDownloads = 0;
  await assert.rejects(
    api.completeExport(envelope(PNG_URL), {
      decodeUtf8,
      traceRaster: async () => { throw new Error('worker and fallback failed'); },
      download: () => { failedDownloads += 1; }
    }),
    /worker and fallback failed/
  );
  assert.equal(failedDownloads, 0);

  await assert.rejects(
    api.completeExport(envelope(PNG_URL), {
      decodeUtf8,
      traceRaster: async () => '',
      download: () => { failedDownloads += 1; }
    }),
    /valid SVG/
  );
  assert.equal(failedDownloads, 0);

  let noBackgroundTraceCalls = 0;
  const noBackgroundDownloads = [];
  const noBackgroundEnv = envelope(null);
  noBackgroundEnv.panel.image_svg_trace = SVG;
  const noBackgroundResult = await api.completeExport(noBackgroundEnv, {
    decodeUtf8,
    traceRaster: async () => { noBackgroundTraceCalls += 1; return SVG; },
    download: (env, note) => noBackgroundDownloads.push({env, note})
  });
  assert.equal(noBackgroundTraceCalls, 0);
  assert.equal(noBackgroundDownloads.length, 1);
  assert.equal(noBackgroundResult.env.panel.image_svg_trace, undefined);

  let invalidSvgDownloads = 0;
  await assert.rejects(
    api.completeExport(envelope('data:image/svg+xml;base64,%%%'), {
      decodeUtf8,
      traceRaster: async () => SVG,
      download: () => { invalidSvgDownloads += 1; }
    }),
    /SVG background/
  );
  assert.equal(invalidSvgDownloads, 0);

  await assert.rejects(
    api.completeExport(envelope(SVG_URL), {
      decodeUtf8: () => { throw new Error('invalid UTF-8'); },
      traceRaster: async () => SVG,
      download: () => { invalidSvgDownloads += 1; }
    }),
    /could not be decoded/
  );
  assert.equal(invalidSvgDownloads, 0);

  // v1.11.0 — an object-less panel is a background-only export, not an error.
  assert.equal(api.countDocItems(null), 0);
  assert.equal(api.countDocItems({single_objects: [], containers: [], graphics: []}), 0);
  assert.equal(api.countDocItems({single_objects: [1], containers: [1, 2], graphics: []}), 3);
  assert.equal(api.countDocItems(envelope(PNG_URL).panel), 1);

  // The verbatim save names the file after whatever the bytes already are.
  assert.equal(api.backgroundExt(PNG_URL), 'png');
  assert.equal(api.backgroundExt(SVG_URL), 'svg');
  assert.equal(api.backgroundExt('image/jpeg'), 'jpg');
  assert.equal(api.backgroundExt('http://legacy.iwmac.local/img/oversikt.JPG?v=3'), 'jpg');
  assert.equal(api.backgroundExt('http://legacy.iwmac.local/img/oversikt.gif'), 'gif');
  assert.equal(api.backgroundExt(''), 'png', 'an unknown background still gets a usable name');
  assert.equal(api.backgroundMime('svg'), 'image/svg+xml');
  assert.equal(api.backgroundMime('jpg'), 'image/jpeg');
  assert.equal(api.backgroundMime('png'), 'image/png');
  assert.match(api.buildBackgroundFilename('10240', 'Oversikt', 'png', new Date('2026-08-11T09:15:00Z')),
    /^iwmac-bg_10240_oversikt_\d{8}-\d{4}\.png$/);

  // The background-only envelope is still a valid, re-importable document:
  // real geometry, empty object arrays, artwork embedded.
  const emptyPanel = {
    plant_id: '10240', panel_name: 'Oversikt', panel_width: '1400px', panel_height: '750px',
    single_objects: [], containers: [], graphics: [], converted: 'true', image_data: PNG_URL
  };
  const emptyEnv = api.buildEnvelope(emptyPanel, {exported_at: '2026-08-11T00:00:00.000Z'});
  assert.equal(api.countDocItems(emptyEnv.panel), 0);
  assert.equal(emptyEnv.background_embedded, true);
  assert.equal(emptyEnv.panel_width, '1400px');
  assert.equal(api.docHasBackground(emptyEnv.panel), true);
  assert.equal(api.parsePayload(emptyEnv).doc.panel_name, 'Oversikt');
  // and it carries no trace, because the empty path never runs one
  assert.equal(emptyEnv.panel.image_svg_trace, undefined);

  const source = fs.readFileSync(SCRIPT, 'utf8');
  // the old dead-end must be gone from the export path, and the collector must
  // be the thing that got a choice — not the message reworded elsewhere
  assert.match(source, /function collectCurrentDoc\(allowEmpty\)/);
  assert.match(source, /buildEnvelopeAsync\(true\)/);
  assert.match(source, /iwdieCountDocItems\(env\.panel\) === 0\) return exportBackgroundOnly\(env\)/);
  assert.match(source, /function exportBackgroundOnly/);
  assert.match(source, /function fetchBackgroundBytes/);
  // both files, one message — two hostOk() calls would overwrite each other
  assert.match(source, /downloadEnvelope\(env, '', true\)/);
  assert.match(source, /if \(!quiet\) hostOk\('Exported '/);
  assert.equal(/Canvas is empty[^\n]*load a panel first/.test(source), true,
    'the empty-canvas message still exists for the truly-empty case');
  assert.match(source, /no objects and no background picture/);
  assert.match(source, /iwdie_ai_raw/);

  for (const removed of ['GM_setClipboard', 'doCopyJson', 'copyTextToClipboard', 'iwdie_copy_btn', 'Also include a VECTOR TRACE']) {
    assert.equal(source.includes(removed), false, `userscript still contains ${removed}`);
  }
  assert.equal(source.includes('window.__IWDIE.doExport()'), true);
  assert.equal(source.includes('window.__IWDIE.openImportPanel()'), true);
  assert.equal(source.includes('window.__IWDIE.doExportBackgroundAi()'), true);
  assert.equal(source.includes('OK = include the trace'), false);

  const readme = fs.readFileSync(README, 'utf8');
  for (const removed of ['Copy JSON', 'GM_setClipboard', 'doCopyJson', 'The fourth button']) {
    assert.equal(readme.includes(removed), false, `README still contains ${removed}`);
  }
  assert.match(readme, /three stacked buttons/);
  assert.match(readme, /automatically includes[^\n]*image_svg_trace/i);
  assert.match(readme, /does not download/i);
  assert.match(readme, /Exporting a panel that has no objects yet \(v1\.11\.0\)/);
  assert.match(readme, /byte-for-byte/);
  assert.match(readme, /No vector trace runs on this path/i);

  const reference = fs.readFileSync(REFERENCE, 'utf8');
  assert.equal(reference.includes('doCopyJson'), false);
  assert.match(reference, /Export JSON \/ Insert JSON \/ Background/);
  assert.match(reference, /automatically includes[^\n]*image_svg_trace/i);
  assert.match(reference, /does not download/i);
  assert.match(reference, /Object-less panel on export \(v1\.11\.0\)/);
  assert.match(reference, /No vector trace on this path/i);

  console.log('IWMAC export trace tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
