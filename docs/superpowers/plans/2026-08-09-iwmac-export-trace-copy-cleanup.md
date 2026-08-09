# IWMAC Automatic Export Trace and Copy Cleanup Implementation Plan

> **For agentic workers:** Repository workflow overrides Superpowers worker routing: Claude coordinates, Codex implements this bounded change in the existing isolated worktree, and Claude reviews actual diffs and verification output. Do not invoke `superpowers:subagent-driven-development`.

**Goal:** Make Export JSON automatically include a valid `panel.image_svg_trace` whenever an embedded background exists, block the download if required tracing fails, and remove the Copy JSON/clipboard path completely.

**Architecture:** Add a small dependency-injected export policy above the browser body so Node can test trace decisions and download gating without a DOM. Browser-only code supplies UTF-8 decoding, raster loading/canvas extraction, existing worker tracing with existing main-thread fallback, and the real JSON downloader. Keep import normalization and Background to Illustrator paths unchanged.

**Tech Stack:** Tampermonkey userscript JavaScript; browser `Image`, Canvas, Web Worker, `TextDecoder`, Blob/download APIs; vendored ImageTracer 1.2.6; Node built-in `assert`; Python standard-library regression tests; Git/GitHub CLI; Graphify; reviewed `claude-obsidian` WSL transaction workflow.

## Global Constraints

- Work only in current isolated worktree on branch `worktree-iwmac-maskin-bank-docs`; preserve unrelated commits and untracked `graphify-out/`.
- Before editing or committing `IWMAC-Designer-Import-Export.user.js`, scan `C:\Users\Thomas\Downloads\` for matching Tampermonkey exports. If any matching export is newer than repository version, stop before editing and report its path/version so Claude can review and sync it first.
- Bump userscript `@version` and `IWDIE_VERSION` together from `1.6.0` to `1.6.1`.
- Keep envelope `version: 1` and `IWDIE_FORMAT_VERSION = 1`.
- Keep existing trace settings exactly: `numberofcolors: 16`, `ltres: 0.5`, `qtres: 0.5`, `pathomit: 4`, `rightangleenhance: true`, `roundcoords: 1`, `strokewidth: 0`, `linefilter: false`, `viewbox: true`, `desc: false`, and palette limit `24`.
- Keep worker tracing, transferable `ImageData`, and fresh-`ImageData` main-thread fallback. Build options before transfer.
- Do not change import behavior, `image_svg_trace` stripping on insert, Background to Illustrator behavior/chooser, generated reference data, or external dependencies.
- No trace confirmation during JSON export. Panels with no embedded background still export without `image_svg_trace`.
- Any required SVG decode/validation, tracer, image-load, image-size, canvas, pixel-read, worker-plus-fallback, or generated-SVG failure must show a clear error and must not download JSON.
- Remove Copy JSON button, `doCopyJson`, clipboard helper, `window.__IWDIE.doCopyJson`, `GM_setClipboard`, and clipboard-export documentation.
- Run `graphify update .` after source/docs changes. Never add, clean, delete, ignore, or commit `graphify-out/`.
- Every commit message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## File Map

**Create**

- `iwmac-designer-import-export/tests/test-export-trace.js` — dependency-free Node regression harness for version/format, automatic SVG/raster trace policy, download gating, no-background export, clipboard removal, documentation alignment, and existing pure-helper loading.

**Modify**

- `iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js` — version/grant/UI cleanup; pure trace/export orchestration; browser raster adapter; guarded JSON download; console and Node export surfaces.
- `iwmac-designer-import-export/README.md` — three-button workflow, mandatory automatic trace behavior, blocked failures, and cleaned integration/API documentation.
- `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md` — exact three-button/API surface and automatic trace/failure semantics while preserving separate Illustrator behavior.

**Do not modify**

- `iwmac-designer-import-export/iwmac-designer-reference/reference_data/**`
- Existing import implementation around `applyImportCore` except retaining its current `delete doc.image_svg_trace` behavior.
- Background to Illustrator implementation from `doExportBackgroundAi` through `openAiChooser`.

---

### Task 1: Add Testable Export Policy and Remove Clipboard Export

**Files:**
- Create: `iwmac-designer-import-export/tests/test-export-trace.js`
- Modify: `iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js:1-31,1671-2034,2390-2442`

**Interfaces:**
- `iwdiePrepareExportTrace(env, deps) -> Promise<{env, traceNote}>`
  - `deps.decodeUtf8(bytes: Uint8Array) -> string`
  - `deps.traceRaster(dataUrl: string) -> Promise<string>`
  - Resolves without a trace only when `panel.image_data` is absent or is not an embedded `data:image/...` URL.
  - Rejects when an embedded SVG cannot be decoded/validated or an embedded raster cannot produce valid SVG.
- `iwdieCompleteExport(env, deps) -> Promise<{env, traceNote}>`
  - Uses the same `decodeUtf8` and `traceRaster` dependencies.
  - Calls `deps.download(env, traceNote)` only after `iwdiePrepareExportTrace` resolves.
- Browser `traceRasterBackground(dataUrl) -> Promise<string>` supplies Image/Canvas/Worker behavior.
- Node exports add `prepareExportTrace` and `completeExport`; existing exports remain intact.

- [ ] **Step 1: Recheck repository ownership and baseline**

Run:

```bash
git status --short --branch
git diff --check
git log -5 --oneline
```

Expected: no tracked modifications before this task; deliberate untracked `graphify-out/` may remain. Stop if another process added tracked changes.

- [ ] **Step 2: Scan Downloads immediately before userscript editing**

Run from worktree root:

```bash
python - <<'PY'
from pathlib import Path
import re

repo = Path('iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js')
downloads = Path(r'C:\Users\Thomas\Downloads')
name_re = re.compile(r'^//\s*@name\s+IWMAC Designer Import/Export\s*$', re.M)
version_re = re.compile(r'^//\s*@version\s+([0-9]+(?:\.[0-9]+)*)\s*$', re.M)

def version(text, path):
    match = version_re.search(text)
    if not match:
        raise SystemExit(f'missing @version: {path}')
    return match.group(1), tuple(int(part) for part in match.group(1).split('.'))

repo_text = repo.read_text(encoding='utf-8-sig')
repo_version, repo_key = version(repo_text, repo)
matches = []
for path in downloads.glob('*.txt'):
    try:
        text = path.read_text(encoding='utf-8-sig')
    except UnicodeError:
        continue
    if not name_re.search(text):
        continue
    text_version, key = version(text, path)
    matches.append((key, text_version, path))

print(f'repo={repo_version}')
for _, text_version, path in sorted(matches, reverse=True):
    print(f'download={text_version} {path}')
newer = [(text_version, path) for key, text_version, path in matches if key > repo_key]
if newer:
    for text_version, path in newer:
        print(f'NEWER={text_version} {path}')
    raise SystemExit(2)
PY
```

Expected: `repo=1.6.0`, with no `NEWER=` line and exit code 0. Exit code 2 is a hard stop; do not edit repository file until Claude has reviewed and synced newer export with CRLF line endings.

- [ ] **Step 3: Write failing Node regression harness**

Create `iwmac-designer-import-export/tests/test-export-trace.js` with this complete harness:

```js
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
  assert.equal(api.IWDIE_VERSION, '1.6.1');
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

  const source = fs.readFileSync(SCRIPT, 'utf8');
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

  const reference = fs.readFileSync(REFERENCE, 'utf8');
  assert.equal(reference.includes('doCopyJson'), false);
  assert.match(reference, /Export JSON \/ Insert JSON \/ Background/);
  assert.match(reference, /automatically includes[^\n]*image_svg_trace/i);
  assert.match(reference, /does not download/i);

  console.log('IWMAC export trace tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run harness and verify intended failure**

Run:

```bash
node iwmac-designer-import-export/tests/test-export-trace.js
```

Expected: failure at `assert.equal(api.IWDIE_VERSION, '1.6.1')` because source remains `1.6.0`. This proves new harness is executing current userscript.

- [ ] **Step 5: Add pure trace validation and export orchestration**

Above vendored ImageTracer/browser body, after `iwdieBuildPalette`, add these pure functions. Keep ES5 function syntax to match userscript:

```js
function iwdieNormalizeTraceSvg(svg) {
  var s = String(svg == null ? '' : svg).trim();
  if (!s || iwdieValidateSvg(s).length > 0 || !/<\/svg>\s*$/i.test(s)) return null;
  return s;
}

function iwdiePrepareExportTrace(env, deps) {
  deps = deps || {};
  var panel = env && env.panel;
  if (!panel || typeof panel !== 'object') return Promise.reject(new Error('Export envelope has no panel document.'));
  var bg = String(panel.image_data || '');
  delete panel.image_svg_trace;
  if (!/^data:image\//i.test(bg)) return Promise.resolve({ env: env, traceNote: '' });

  if (iwdieIsSvgBackground(bg)) {
    return Promise.resolve().then(function () {
      var parsed = iwdieParseDataUrl(bg);
      if (!parsed || typeof deps.decodeUtf8 !== 'function') throw new Error('Embedded SVG background could not be decoded.');
      var svg;
      try { svg = deps.decodeUtf8(parsed.bytes); }
      catch (error) { throw new Error('Embedded SVG background could not be decoded: ' + error); }
      svg = iwdieNormalizeTraceSvg(svg);
      if (!svg) throw new Error('Embedded SVG background did not contain valid SVG.');
      panel.image_svg_trace = svg;
      return { env: env, traceNote: ' + vector structure' };
    });
  }

  if (typeof deps.traceRaster !== 'function') return Promise.reject(new Error('Background tracer is unavailable.'));
  return Promise.resolve().then(function () {
    return deps.traceRaster(bg);
  }).then(function (svg) {
    svg = iwdieNormalizeTraceSvg(svg);
    if (!svg) throw new Error('Vector trace did not produce valid SVG.');
    panel.image_svg_trace = svg;
    return {
      env: env,
      traceNote: ' + vector structure (' + ((svg.match(/<path\b/g) || []).length) + ' paths)'
    };
  });
}

function iwdieCompleteExport(env, deps) {
  deps = deps || {};
  return iwdiePrepareExportTrace(env, deps).then(function (result) {
    if (typeof deps.download !== 'function') throw new Error('Export downloader is unavailable.');
    deps.download(result.env, result.traceNote);
    return result;
  });
}
```

At Node export surface, expose:

```js
prepareExportTrace: iwdiePrepareExportTrace,
completeExport: iwdieCompleteExport,
```

Do not remove or rename existing Node exports.

- [ ] **Step 6: Replace callback/confirmation export flow with guarded Promise flow**

Inside browser body:

1. Rename section comment from `export / copy` to `export`.
2. Remove `finishExportWithTrace`, `copyTextToClipboard`, and `doCopyJson` completely.
3. Add `traceRasterBackground` before `doExport`. It must reject, never resolve without trace, for every failure:

```js
function traceRasterBackground(bg) {
  if (!IWDIE_TRACER) return Promise.reject(new Error('Background tracer is unavailable.'));
  toast('Tracing the background structure… the export downloads when done.', false, 6000);
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      if (!w || !h) { reject(new Error('Background image has no size.')); return; }
      var ctx, imgData, opts;
      try {
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('2D canvas context unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        imgData = ctx.getImageData(0, 0, w, h);
        opts = traceOptsFor(imgData);
      } catch (error) {
        reject(new Error('Could not read background image pixels for tracing: ' + error));
        return;
      }
      traceInWorker(imgData, opts).then(resolve).catch(function (workerError) {
        try {
          var fallbackData = ctx.getImageData(0, 0, w, h);
          resolve(IWDIE_TRACER.imagedataToSVG(fallbackData, opts));
        } catch (fallbackError) {
          reject(new Error('Vector trace failed in worker and main-thread fallback: ' + workerError + '; ' + fallbackError));
        }
      });
    };
    img.onerror = function () { reject(new Error('Background image failed to load.')); };
    img.src = bg;
  });
}
```

4. Move existing Blob/anchor JSON download block into `downloadEnvelope(env, traceNote)`, including existing filename, delayed URL revocation, and `hostOk` summary.
5. Implement `doExport` as:

```js
function doExport() {
  buildEnvelopeAsync().then(function (env) {
    if (!env) return null;
    return iwdieCompleteExport(env, {
      decodeUtf8: function (bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); },
      traceRaster: traceRasterBackground,
      download: downloadEnvelope
    });
  }).catch(function (error) {
    toast('Export blocked: ' + (error && error.message ? error.message : error) + '\nNo JSON was downloaded.', true, 9000);
  });
}
```

This resolved-chain placement is load-bearing: `downloadEnvelope` must never be called from the rejection handler.

- [ ] **Step 7: Remove clipboard UI/API/grant and bump version**

Apply these exact metadata/API changes:

```js
// @version      1.6.1
```

```js
var IWDIE_VERSION = '1.6.1';
```

- Delete only `// @grant        GM_setClipboard`; retain `unsafeWindow` and `GM_addStyle`.
- Delete Copy JSON button row and change fieldset comment to `Three stacked buttons`.
- Keep Export JSON, Insert JSON, and Background to Illustrator button markup/order unchanged.
- Remove `doCopyJson: doCopyJson` from `W.__IWDIE`.
- Update stale source comments saying `fourth button`, `4th button`, or `export / copy` to describe final button/current fieldset without changing CSS behavior.

- [ ] **Step 8: Run focused tests and syntax check**

Run:

```bash
node --check iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js
node iwmac-designer-import-export/tests/test-export-trace.js
```

Expected after source change: syntax check passes; harness now advances past version assertion but fails at README/reference assertions because documentation still advertises Copy JSON. This is intended until Task 2.

---

### Task 2: Align Public and Deep Documentation

**Files:**
- Modify: `iwmac-designer-import-export/README.md:1-100`
- Modify: `iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md:338-345,398`
- Test: `iwmac-designer-import-export/tests/test-export-trace.js`

**Interfaces:**
- Public button order: `Export JSON`, `Insert JSON…`, `Background → Illustrator`.
- Console API: `doExport`, `openImportPanel`, `applyImport`, `doExportBackgroundAi`, `_collect`.
- JSON export contract: embedded SVG is decoded into `panel.image_svg_trace`; embedded raster is worker-traced with color-aware options and main-thread fallback; failure blocks download; no-background export remains valid.

- [ ] **Step 1: Rewrite public README button/workflow text**

Make these bounded edits:

- Opening paragraph says `three stacked buttons` and lists only Export JSON, Insert JSON, Background to Illustrator.
- Workflow step 2 says Export JSON downloads the file; remove clipboard alternative.
- File-format trace paragraph says version 1.6.1 automatically includes `panel.image_svg_trace` whenever export embeds raster or SVG background, without confirmation. State raster uses worker plus main-thread fallback and color-aware palette; valid no-background panels omit trace; required trace failure shows an error and does not download JSON.
- Background to Illustrator heading text calls it third button, not fourth. Preserve its separate raster delivery chooser and all related details.
- Remove clipboard integration bullet.
- Console surface omits `doCopyJson` and retains the other five members.

Use wording containing these test anchors on one line each:

```text
three stacked buttons
automatically includes `panel.image_svg_trace`
does not download
```

- [ ] **Step 2: Rewrite deep reference ecosystem/API text**

At section 17 and console surface paragraph:

- Describe `Export JSON / Insert JSON / Background → Illustrator`.
- Remove `doCopyJson` from `window.__IWDIE`.
- State `doExport` v1.6.1 automatically includes `panel.image_svg_trace` for embedded SVG/raster backgrounds.
- State raster path still uses existing ImageTracer options, derived color palette, worker transfer, and fresh-pixel main-thread fallback.
- State SVG decode/validation or raster trace failure shows an error and does not download JSON.
- State panels without embedded backgrounds still export without trace.
- Preserve separate `doExportBackgroundAi` chooser description and import stripping behavior.

Use wording containing these test anchors on one line each:

```text
Export JSON / Insert JSON / Background
automatically includes `panel.image_svg_trace`
does not download
```

- [ ] **Step 3: Run focused and repository regression tests**

Run:

```bash
node --check iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js
node iwmac-designer-import-export/tests/test-export-trace.js
python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -v
git diff --check
```

Expected: Node syntax and export-trace harness pass; existing Python suite passes; no whitespace errors. Any failure blocks commit.

- [ ] **Step 4: Run explicit static cleanup checks**

Run:

```bash
python - <<'PY'
from pathlib import Path

script = Path('iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js').read_text(encoding='utf-8')
readme = Path('iwmac-designer-import-export/README.md').read_text(encoding='utf-8')
reference = Path('iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md').read_text(encoding='utf-8')
for token in ('GM_setClipboard', 'doCopyJson', 'copyTextToClipboard', 'iwdie_copy_btn', 'Also include a VECTOR TRACE'):
    assert token not in script, token
for token in ('Copy JSON', 'GM_setClipboard', 'doCopyJson', 'The fourth button'):
    assert token not in readme, token
assert 'doCopyJson' not in reference
assert script.count('@version      1.6.1') == 1
assert "var IWDIE_VERSION = '1.6.1';" in script
assert "var IWDIE_FORMAT_VERSION = 1;" in script
print('static cleanup checks passed')
PY
```

Expected: `static cleanup checks passed`.

- [ ] **Step 5: Refresh repository Graphify state**

Run:

```bash
graphify update .
```

Expected: successful incremental update. Leave `graphify-out/` untracked and unstaged.

- [ ] **Step 6: Claude reviews actual diff against approved spec**

Run:

```bash
git status --short --branch
git diff --stat
git diff -- iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js iwmac-designer-import-export/tests/test-export-trace.js iwmac-designer-import-export/README.md iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md
git diff --check
```

Verify individually:

- only three sidebar buttons remain, in approved order;
- no JSON-export confirmation remains;
- no-background path downloads without trace;
- SVG decode plus structural validation precedes download;
- raster tracer unavailability, image/canvas failure, worker-plus-fallback failure, and invalid output reject;
- download is called only after trace policy resolves;
- exact trace options/palette limit are unchanged;
- worker transfer still occurs and fallback reacquires `ImageData`;
- import still deletes `image_svg_trace`;
- Background to Illustrator chooser/path is behaviorally unchanged;
- version is 1.6.1 and envelope version is 1;
- no generated reference data changed;
- docs match source;
- `graphify-out/` is not staged.

- [ ] **Step 7: Repeat Downloads scan immediately before commit**

Rerun exact Python scan from Task 1 Step 2.

Expected now: `repo=1.6.1`; no matching Downloads export has a version greater than `1.6.1`. Any `NEWER=` line is a hard stop; do not commit until Claude reviews and syncs newer file.

- [ ] **Step 8: Commit implementation, tests, and docs**

Run:

```bash
git add iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js iwmac-designer-import-export/tests/test-export-trace.js iwmac-designer-import-export/README.md iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md
git diff --cached --check
git status --short
git commit -m "feat: always trace IWMAC panel exports" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

Expected: only four intended paths staged; `graphify-out/` remains untracked.

---

### Task 3: Final Review, Push, and Knowledge-Layer Refresh

**Files:**
- Review: approved spec, plan, source, test, and two documentation files.
- Shared combined graph: `C:\Users\Thomas\Documents\Claude\repos\graphify-out` only if shipped changes alter quoted graph counts; claim with `repos/.agent-locks/graphify-out.json` before writing.
- Vault mutation: only through reviewed `claude-obsidian` transaction workflow under WSL 2 Ubuntu 24.04.

**Interfaces:**
- GitHub branch push carries design/spec, plan, implementation, tests, and docs.
- Main-branch merge is shipped state for Tampermonkey raw update URL and vault source pin.
- Vault source pin must identify actual shipped commit, never an unmerged branch commit.

- [ ] **Step 1: Re-run final checks from committed tree**

Run:

```bash
node --check iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js
node iwmac-designer-import-export/tests/test-export-trace.js
python -m unittest discover -s iwmac-designer-import-export/iwmac-designer-reference/tests -v
git diff --check origin/main...HEAD
git status --short --branch
git log -5 --oneline
```

Expected: all checks pass; only deliberate untracked `graphify-out/`; implementation commit present.

- [ ] **Step 2: Inspect complete branch diff, including earlier approved spec/plan commits**

Run:

```bash
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- docs/superpowers/specs/2026-08-09-iwmac-export-trace-copy-design.md docs/superpowers/plans/2026-08-09-iwmac-export-trace-copy-cleanup.md iwmac-designer-import-export/IWMAC-Designer-Import-Export.user.js iwmac-designer-import-export/tests/test-export-trace.js iwmac-designer-import-export/README.md iwmac-designer-import-export/iwmac-designer-reference/CLAUDE.md
```

Reject out-of-scope edits, test-only behavior, or divergence from approved design. Preserve unrelated pre-existing commits on branch; report them explicitly in PR/push summary rather than rewriting history.

- [ ] **Step 3: Push current branch and open/update PR**

First inspect tracking state:

```bash
git branch -vv
git remote -v
gh pr list --head worktree-iwmac-maskin-bank-docs --state all
```

Then push without force:

```bash
git push -u origin worktree-iwmac-maskin-bank-docs
```

If no open PR exists, create one targeting `main`. PR body must list feature scope, exact test commands/results, version `1.6.1`, no-background behavior, failure blocking, and any unrelated branch commits already present. End body with:

```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Do not force-push. Do not claim Tampermonkey delivery until change is on `main`.

- [ ] **Step 4: Check CI and merge state**

Run:

```bash
gh pr checks --watch
```

Report failures plainly. Merge only with Thomas's action-time approval unless PR is already configured/authorized for automatic merge. After merge, record shipped main commit:

```bash
gh pr view --json url,state,mergeCommit,statusCheckRollup
```

- [ ] **Step 5: Refresh repository and combined Graphify after shipped commit**

Run `graphify update .` against a checkout containing shipped commit. Repository graph remains untracked.

If vault/source docs quote combined graph counts that changed, inspect `C:\Users\Thomas\Documents\Claude\repos\.agent-locks\` first, create `graphify-out.json` claim containing agent/task/start/PID, run current `graphify merge-graphs ... --out graphify-out\graph.json` procedure from `C:\Users\Thomas\Documents\Claude\docs\GRAPHIFY.md`, verify counts, then remove own claim. Never run `graphify label`.

- [ ] **Step 6: Re-pin vault through reviewed WSL transaction after merge**

Use installed wiki/`claude-obsidian` skill and WSL `Ubuntu-24.04`. Before writing, claim vault target under `repos/.agent-locks/`. Transaction must:

- re-pin `wiki/sources/GitHub - tampermonkey-scripts.md` to actual main merge commit;
- supersede prior snapshot claim rather than deleting historically true claim;
- update Tampermonkey Userscript Catalog version/API/button/trace facts made stale by this change;
- update quoted Graphify counts only from freshly verified graph;
- stage, lint, review, apply, and verify transaction journal reaches `state: complete`;
- remove own vault claim after success.

Never overwrite vault files directly. If PR is not merged, skip this step because main source pin remains true.

- [ ] **Step 7: Final report**

Report:

- changed files and resulting three-button/API behavior;
- version `1.6.1`, format version `1`;
- exact Node/Python/static/Graphify checks and results;
- branch, commits, PR URL, CI/merge state;
- whether Tampermonkey main URL now serves change;
- repository/combined Graphify refresh result;
- vault transaction ID/journal state, or explicit reason refresh was correctly deferred.
