'use strict';
/* Rocketlane improvements 1.87.0: "Download all" (the Files popover, and the delivery wizard's documentation question)
 * fetches three files at a time instead of one (Thomas: "yes make download all fetch 3 at once"). Runs the
 * userscript's own rlFilesDownloadAll, and 1.86.1's from this repository's history, against stand-ins for
 * Tampermonkey's download and the browser's folder API.
 *   node --test "rocketlane-younium-status/test/*.test.js" */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join(__dirname, '..', 'rocketlane-younium-status.user.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const fromHistory = (rev) => {
  try { return execFileSync('git', ['show', rev + ':rocketlane-younium-status/rocketlane-younium-status.user.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r\n/g, '\n'); } catch (_) { return null; }
};
// 1.86.1, the last version that downloaded one file at a time
const OLD = fromHistory('611ff7f');

/** The text of the function that starts with `head` in `text`, to its closing brace. */
function fn(text, head) {
  const i = text.indexOf(head);
  assert.ok(i >= 0, head + ' is in the code');
  let depth = 0;
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  throw new Error('no end to ' + head);
}

/** rlFilesDownloadAll from `text`, with its helpers, against a world of stand-ins. */
function downloadAll(text, world) {
  const helpers = ['function rlFilesSanitizeFileName(', 'function rlFilesSanitizeFolderName(', 'function rlFilesUniqueName(']
    .map((h) => fn(text, h)).join('\n');
  const parallel = (text.match(/  const RL_FILES_DOWNLOAD_PARALLEL = \d+;/) || [''])[0];
  const body = fn(text, 'async function rlFilesDownloadAll(');
  return new Function('window', 'document', 'URL', 'console', 'rlFilesGetOrPickDownloadParentDir', 'gmRocketlaneDownloadAttachmentBlob',
    helpers + '\n' + parallel + '\n' + body + '\nreturn rlFilesDownloadAll;')(
    world.window, world.document, world.URL, { warn() {} }, world.pickParent, world.fetchBlob);
}

/**
 * A browser with a picked folder (or without the folder API), and a Tampermonkey whose downloads take `delays[id]` ms,
 * fail for ids in `bad`, and are counted while they run.
 */
function world({ delays = {}, bad = [], folderApi = true, pick = true } = {}) {
  const saved = {}, folders = [], clicks = [];
  let inFlight = 0, maxInFlight = 0, fetched = 0;
  const sub = {
    getFileHandle: async (name) => ({
      createWritable: async () => ({ write: async (blob) => { saved[name] = blob; }, close: async () => {} }),
    }),
  };
  const parent = { getDirectoryHandle: async (name) => { folders.push(name); return sub; } };
  return {
    saved, folders, clicks,
    stats: () => ({ maxInFlight, fetched }),
    window: folderApi ? { showDirectoryPicker() {} } : {},
    pickParent: async () => (pick ? parent : null),
    fetchBlob: async (id) => {
      fetched++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, delays[id] ?? 20));
      inFlight--;
      if (bad.includes(id)) throw new Error('HTTP 500');
      return { blob: 'bytes of ' + id };
    },
    document: {
      createElement: () => { const a = { click() { clicks.push({ name: a.download, at: Date.now() }); }, remove() {} }; return a; },
      body: { appendChild() {} },
    },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  };
}

const files = (spec) => spec.map(([id, name]) => ({ attachmentId: id, name }));

test('1.87.0 fetches three files at a time; 1.86.1 fetched one', async () => {
  assert.ok(OLD, '1.86.1 is in this repository\'s history');
  const list = files([['1', 'Plan.pdf'], ['2', 'Plan.pdf'], ['3', 'Skjema.xlsx'], ['4', 'Plan.pdf'], ['5', 'Bilde.jpg'], ['6', 'Notat.txt'], ['7', 'Avtale.pdf']]);
  const delays = { 1: 120, 2: 30, 3: 60, 4: 10, 5: 40, 6: 20, 7: 50 };
  const now = world({ delays }), then = world({ delays });
  const t0 = Date.now();
  const r = await downloadAll(src, now)(list, 'Extra Finnøy', () => {});
  const tNew = Date.now() - t0;
  const t1 = Date.now();
  const rOld = await downloadAll(OLD, then)(list, 'Extra Finnøy', () => {});
  const tOld = Date.now() - t1;
  assert.deepStrictEqual(r, { failed: 0, cancelled: false, blocked: false });
  assert.deepStrictEqual(rOld, r);
  assert.strictEqual(now.stats().maxInFlight, 3);
  assert.strictEqual(then.stats().maxInFlight, 1);
  // The same files under the same names, the same folder.
  assert.deepStrictEqual(now.saved, then.saved);
  assert.deepStrictEqual(Object.keys(now.saved).sort(), ['Avtale.pdf', 'Bilde.jpg', 'Notat.txt', 'Plan (1).pdf', 'Plan (2).pdf', 'Plan.pdf', 'Skjema.xlsx']);
  assert.strictEqual(now.folders.length, 1);
  assert.deepStrictEqual(now.folders, then.folders);
  assert.match(now.folders[0], /^Extra Finnøy \d{4}-\d{2}-\d{2}$/);
  // 330 ms of downloads one after another; three at a time takes well under two thirds of that.
  assert.ok(tNew < tOld * 0.67, 'three at a time took ' + tNew + ' ms, one at a time ' + tOld + ' ms');
});

test('files of the same name are numbered in the list\'s order, whichever arrives first', async () => {
  const w = world({ delays: { a: 90, b: 10, c: 50 } });
  await downloadAll(src, w)(files([['a', 'Plan.pdf'], ['b', 'Plan.pdf'], ['c', 'Plan.pdf']]), 'P', () => {});
  assert.deepStrictEqual(w.saved, { 'Plan.pdf': 'bytes of a', 'Plan (1).pdf': 'bytes of b', 'Plan (2).pdf': 'bytes of c' });
});

test('a failed file is counted and the rest are saved; the label counts every file once', async () => {
  const w = world({ bad: ['3'] });
  const labels = [];
  const list = files([['1', 'A.pdf'], ['2', 'B.pdf'], ['3', 'C.pdf'], [null, 'D.pdf'], ['5', 'E.pdf']]);
  const r = await downloadAll(src, w)(list, 'P', (t) => labels.push(t));
  assert.deepStrictEqual(r, { failed: 2, cancelled: false, blocked: false });
  assert.deepStrictEqual(Object.keys(w.saved).sort(), ['A.pdf', 'B.pdf', 'E.pdf']);
  assert.strictEqual(w.stats().fetched, 4, 'the file without an id is never fetched');
  assert.deepStrictEqual(labels, ['Downloading 0/5…', 'Downloading 1/5…', 'Downloading 2/5…', 'Downloading 3/5…', 'Downloading 4/5…', 'Downloading 5/5…']);
});

test('two files are fetched two at a time', async () => {
  const w = world();
  await downloadAll(src, w)(files([['1', 'A.pdf'], ['2', 'B.pdf']]), 'P', () => {});
  assert.strictEqual(w.stats().maxInFlight, 2);
  assert.strictEqual(Object.keys(w.saved).length, 2);
});

test('without the folder API the browser\'s downloads still start a quarter second apart', async () => {
  const w = world({ folderApi: false, delays: { 1: 5, 2: 5, 3: 5, 4: 5 } });
  const r = await downloadAll(src, w)(files([['1', 'A.pdf'], ['2', 'B.pdf'], ['3', 'A.pdf'], ['4', 'C.pdf']]), 'P', () => {});
  assert.deepStrictEqual(r, { failed: 0, cancelled: false, blocked: false });
  assert.strictEqual(w.clicks.length, 4);
  assert.deepStrictEqual(w.clicks.map((c) => c.name).sort(), ['A.pdf', 'A.pdf', 'B.pdf', 'C.pdf'], 'the browser numbers its own duplicates');
  for (let i = 1; i < w.clicks.length; i++) assert.ok(w.clicks[i].at - w.clicks[i - 1].at >= 240, 'click ' + i + ' came ' + (w.clicks[i].at - w.clicks[i - 1].at) + ' ms after the one before');
  assert.strictEqual(w.stats().maxInFlight, 3, 'the files themselves are still fetched three at a time');
});

test('a folder picker closed without a choice downloads nothing', async () => {
  const w = world({ pick: false });
  const r = await downloadAll(src, w)(files([['1', 'A.pdf']]), 'P', () => {});
  assert.deepStrictEqual(r, { failed: 0, cancelled: true, blocked: false });
  assert.strictEqual(w.stats().fetched, 0);
});
