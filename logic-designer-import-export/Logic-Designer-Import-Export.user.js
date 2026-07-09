// ==UserScript==
// @name         Logic Designer Import/Export
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.5.0
// @description  Export/Import the current VV Designer sketch as JSON (with driver-id plant rebinding) + a Live Simulate panel: set input values yourself and re-simulate on every change, no prompt() spam — adds entries to the File menu.
// @author       hapnes-dev
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-import-export/Logic-Designer-Import-Export.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/logic-designer-import-export/Logic-Designer-Import-Export.user.js
// @match        http://internal.iwmac.local/vv_fbx.qxs*
// @match        https://internal.iwmac.local/vv_fbx.qxs*
// @run-at       document-idle
// @noframes
// @grant        unsafeWindow
// @grant        GM_addStyle
// ==/UserScript==

// ─── Pure helpers (top-level so Node tests can reach them) ──────────

// Wrap a paper.save() document in a portable export envelope.
// generator/requiresProcesses (v1.4+) are optional and only stamped when
// provided — v1.3-era files and hand-authored envelopes stay valid as-is.
function buildExportEnvelope({ sketch, sourcePlantId, sketchId, sketchName, generator, requiresProcesses }) {
  var envelope = {
    format: 'vv-fbx-sketch',
    version: 1,
    exported_at: new Date().toISOString(),
    source_plant_id: sourcePlantId != null ? String(sourcePlantId) : null,
    source_sketch_id: sketchId != null ? String(sketchId) : null,
    name: sketchName || null,
    block_count: sketch.blocks.length,
    connection_count: sketch.connections.length,
  };
  if (generator) envelope.generator = generator;
  if (requiresProcesses && requiresProcesses.length > 0) envelope.requires_processes = requiresProcesses;
  envelope.sketch = sketch; // big payload last, for human readers
  return envelope;
}

// Collect the published library processes a sketch depends on — the target
// plant's library must publish these keys for the import to resolve them.
// palette (optional, paper.blocks in the browser) enriches with the process's
// display name; process instances store theirs in data.alias_text (§21).
function listProcessDependencies(sketch, palette) {
  var seen = {};
  var out = [];
  for (var i = 0; i < sketch.blocks.length; i++) {
    var b = sketch.blocks[i];
    if (!b || b.compile_type !== 'process' || typeof b.type !== 'string' || seen[b.type]) continue;
    seen[b.type] = true;
    var def = palette && palette[b.type];
    var alias = (def && (def.alias_text || (def.data && def.data.alias_text))) ||
      (b.data && b.data.alias_text) || null;
    out.push({ type: b.type, alias_text: alias, current_revision: b.current_revision || null });
  }
  return out;
}

// Fill host housekeeping fields a hand-/AI-authored file may omit, on a DEEP
// COPY: override/runtime/properties default to {}, data to null, groups to [],
// and a missing func is filled from the palette definition when derivable.
// Real exports carry all of these and pass through unchanged.
function normalizeSketchForLoad(sketchIn, palette) {
  var sketch = JSON.parse(JSON.stringify(sketchIn));
  var filledFuncs = 0;
  var filledFields = 0;
  for (var i = 0; i < sketch.blocks.length; i++) {
    var b = sketch.blocks[i];
    if (!b || typeof b !== 'object') continue;
    if (b.override == null) { b.override = {}; filledFields++; }
    if (b.runtime == null) { b.runtime = {}; filledFields++; }
    if (b.properties == null) { b.properties = {}; filledFields++; }
    if (!('data' in b)) { b.data = null; filledFields++; }
    if (typeof b.func !== 'string' || !b.func) {
      var def = palette && palette[b.type];
      var func = def && (def.block_func || (def.data && def.data.block_func));
      if (typeof func === 'string' && func) { b.func = func; filledFuncs++; }
    }
  }
  if (!Array.isArray(sketch.groups)) { sketch.groups = []; filledFields++; }
  return { sketch: sketch, filledFuncs: filledFuncs, filledFields: filledFields };
}

// ─── Live-simulate helpers (pure) ────────────────────────────────────
// The host's client simulator asks the user for a value (via prompt) for every
// block whose palette sim function calls get_user_input — PARAMV, TAGVALUE,
// CALENDAR, TOGGLE_INTERVAL, … (CONST reads its configured initial_value).
// List those blocks on the canvas so a panel can collect the values up front.
function listSimInputBlocks(elements, palette) {
  var rows = [];
  for (var key in elements) {
    if (!/^\d+$/.test(key)) continue;
    var el = elements[key];
    if (!el || typeof el !== 'object') continue;
    var def = palette && palette[el.block_type];
    var sim = def && def.sim;
    if (typeof sim !== 'function' || String(sim).indexOf('get_user_input') === -1) continue;
    var label = (el.override && el.override.alias_text) || (el.data && el.data.alias_text) || el.alias_text || el.block_type;
    rows.push({ pointer: parseInt(key, 10), type: el.block_type, label: String(label) });
  }
  rows.sort(function (a, b) { return a.pointer - b.pointer; });
  return rows;
}

// The sinks worth summarising after a run: output-compiled blocks + WRITETOUNIT
// (compile_type "function" but semantically a sink).
function listSimOutputBlocks(elements) {
  var rows = [];
  for (var key in elements) {
    if (!/^\d+$/.test(key)) continue;
    var el = elements[key];
    if (!el || typeof el !== 'object') continue;
    if (el.compile_type !== 'output' && el.block_type !== 'WRITETOUNIT') continue;
    var label = (el.override && el.override.alias_text) || (el.data && el.data.alias_text) || el.alias_text || '';
    rows.push({ pointer: parseInt(key, 10), type: el.block_type, label: String(label) });
  }
  rows.sort(function (a, b) { return a.pointer - b.pointer; });
  return rows;
}

// Render a simulated value for humans: booleans/ALARM keep their meaning.
function formatSimValue(v) {
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  if (v === undefined) return '(not reached)';
  if (v === null) return '(null)';
  return String(v);
}

// Accept either the envelope or a bare paper.save() document.
// Returns { ok, sketch, envelope|null, error }.
function parseImportPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Not a JSON object.' };
  }
  var doc = null;
  var envelope = null;
  if (parsed.format === 'vv-fbx-sketch' && parsed.sketch) {
    envelope = parsed;
    doc = parsed.sketch;
  } else if (Array.isArray(parsed.blocks) && Array.isArray(parsed.connections)) {
    doc = parsed; // bare sketch document
  } else {
    return { ok: false, error: 'Unrecognized file — expected a VV sketch export or a raw sketch document.' };
  }
  if (!Array.isArray(doc.blocks) || !Array.isArray(doc.connections) || typeof doc.mode !== 'string') {
    return { ok: false, error: 'Sketch document is malformed (mode/blocks/connections missing).' };
  }
  return { ok: true, sketch: doc, envelope: envelope, error: null };
}

// Common wrong block-type names AIs emit → the real type.
var LDIO_TYPE_ALIASES = {
  EQUAL: 'LIKE', EQUALS: 'LIKE', NOTEQUAL: 'UNLIKE', NOT_EQUAL: 'UNLIKE',
  GREATERTHAN: 'BIGGERTHAN', GREATER_THAN: 'BIGGERTHAN', LESSTHAN: 'SMALLERTHAN', LESS_THAN: 'SMALLERTHAN',
  AND: 'COMP_AND', OR: 'COMP_OR', NOT: 'INVERT',
  CONSTANT: 'CONST', PARAM: 'PARAMV', PARAMETER: 'PARAMV', READ: 'PARAMV',
  DIGITAL_INPUT: 'PARAMV', ANALOG_INPUT: 'PARAMV', INPUT: 'PARAMV', SENSOR: 'PARAMV',
  WRITE: 'WRITETOUNIT', WRITEOUTUNIT: 'WRITETOUNIT', WRITE_TO_UNIT: 'WRITETOUNIT', DIGITAL_OUTPUT: 'WRITETOUNIT',
  TIMER: 'DELAY_VARIABLE', VARIABLE_DELAY: 'DELAY_VARIABLE', COUNTER: 'PULSE_COUNT',
  TAG: 'TAGVALUE', TAG_VALUE: 'TAGVALUE', VIRTUAL_OUTPUT: 'VIRTUALOUT',
};
var LDIO_NO_EQUIVALENT = {
  RISING_EDGE: 'no edge block — use PULSE_COUNT with block_func_args.type "flank_rising_edge"',
  FALLING_EDGE: 'no edge block — use PULSE_COUNT type "flank_falling_edge"',
  EDGE: 'no edge block — use PULSE_COUNT flank_* mode',
  TOGGLE: 'no toggle block — compose PULSE_COUNT(flank_rising_edge) → MOD ← CONST(2)',
  FLIPFLOP: 'no flip-flop block — set/reset memory is LATCH',
  FLIP_FLOP: 'no flip-flop block — set/reset memory is LATCH',
};

// Diagnose a parsed import payload against the host contract and return a
// human-readable, itemised report. Pure — knownTypes is passed in (use
// paper.blocks in the browser so process blocks on THIS plant are recognised).
// Returns { fatal: bool, errors: [str], warnings: [str], sketch|null }.
function diagnoseImport(parsed, knownTypes) {
  var errors = [], warnings = [];
  knownTypes = knownTypes || {};

  if (!parsed || typeof parsed !== 'object') {
    return { fatal: true, errors: ['The file is not a JSON object.'], warnings: warnings, sketch: null };
  }

  // Invented-schema signals (both real failures started here).
  ['schema', 'logic', 'steps', 'parameterBindings', 'inputs', 'outputs'].forEach(function (k) {
    if (k in parsed) errors.push('Top level has "' + k + '" — this is not the VV format. A sketch is only {"format":"vv-fbx-sketch","sketch":{mode,blocks,connections}} (or a bare {mode,blocks,connections}); every operation is a block + wire, there is no "' + k + '".');
  });

  var doc = null;
  if (parsed.format === 'vv-fbx-sketch' && parsed.sketch) doc = parsed.sketch;
  else if (Array.isArray(parsed.blocks) && Array.isArray(parsed.connections)) doc = parsed;
  else {
    errors.push('Unrecognized shape — needs {"format":"vv-fbx-sketch","sketch":{…}} or a bare {"mode","blocks","connections"} document' + (parsed.format ? ' (format is "' + parsed.format + '")' : ' (no "format" key)') + '.');
    return { fatal: true, errors: errors, warnings: warnings, sketch: null };
  }
  ['logic', 'steps', 'parameterBindings'].forEach(function (k) {
    if (k in doc) errors.push('sketch."' + k + '" is not a real field — express logic as blocks + connections.');
  });

  if (typeof doc.mode !== 'string') errors.push('sketch.mode is missing — add "mode":"function".');
  if (!Array.isArray(doc.blocks)) errors.push('sketch.blocks must be an array.');
  if (!Array.isArray(doc.connections)) errors.push('sketch.connections must be an array.');
  if (!Array.isArray(doc.blocks) || !Array.isArray(doc.connections)) {
    return { fatal: true, errors: errors, warnings: warnings, sketch: null };
  }

  // v1.4+ exports carry a process manifest — use it to name missing processes.
  var manifest = {};
  if (Array.isArray(parsed.requires_processes)) {
    parsed.requires_processes.forEach(function (p) { if (p && p.type) manifest[p.type] = p; });
  }

  var ids = {};
  doc.blocks.forEach(function (b, i) {
    var at = 'block #' + i + (b && b.type ? ' (' + b.type + ')' : '');
    if (!b || typeof b !== 'object') { errors.push(at + ' is not an object.'); return; }
    if (typeof b.id === 'string') errors.push(at + ' id "' + b.id + '" is text — block ids must be whole numbers (0,1,2,…).');
    else if (!Number.isInteger(b.id)) errors.push(at + ' has no integer id.');
    else if (ids[b.id]) errors.push(at + ' id ' + b.id + ' is used twice.');
    else ids[b.id] = b;

    if (typeof b.type !== 'string') errors.push(at + ' has no type.');
    else if (!(b.type in knownTypes)) {
      if (LDIO_TYPE_ALIASES[b.type]) errors.push(at + ' — "' + b.type + '" is not a VV block; use "' + LDIO_TYPE_ALIASES[b.type] + '".');
      else if (LDIO_NO_EQUIVALENT[b.type]) errors.push(at + ' — "' + b.type + '": ' + LDIO_NO_EQUIVALENT[b.type] + '.');
      else if (manifest[b.type]) errors.push(at + ' — the library process "' + (manifest[b.type].alias_text || b.type) + '" (' + b.type + ') is not published on this plant — link/publish it in the target library first.');
      else errors.push(at + ' — unknown block type "' + b.type + '" (not a system block, and no such process on this plant/library).');
    } else if (typeof b.func !== 'string' || !b.func) {
      warnings.push(at + ' has no "func" — import fills it from this plant\'s palette; add it for a portable file (validate-vv-sketch.js lists the correct value).');
    }
    if (b.data && typeof b.data === 'object') {
      if ('override' in b.data || 'runtime' in b.data || 'properties' in b.data)
        errors.push(at + ' has override/runtime/properties inside "data" — those are block-level fields, siblings of data.');
      if ((b.type === 'PARAMV' || b.type === 'WRITETOUNIT') && Array.isArray(b.data.driver_ids) && b.data.driver_ids.length === 0)
        warnings.push(at + ' has an empty driver_ids array — it will import unconfigured; bind it after import or set data to null.');
    }
  });

  doc.connections.forEach(function (c, i) {
    var at = 'wire #' + i;
    if (!c || typeof c !== 'object') { errors.push(at + ' is not an object.'); return; }
    if ('from' in c || 'to' in c) { errors.push(at + ' uses from/to — wires must be {"source":{"id":N,"put":N},"target":{"id":N,"put":N}}.'); return; }
    ['source', 'target'].forEach(function (side) {
      var s = c[side];
      if (!s || typeof s !== 'object') { errors.push(at + ' has no ' + side + '.'); return; }
      if ('block' in s || 'pin' in s || 'output' in s || 'input' in s) errors.push(at + '.' + side + ' uses block/pin/output/input — use numeric "id" and "put".');
      if (!Number.isInteger(s.id)) errors.push(at + '.' + side + ' needs an integer block id.');
      else if (!(s.id in ids)) errors.push(at + '.' + side + ' points at block id ' + s.id + ', which does not exist.');
      if (!Number.isInteger(s.put)) errors.push(at + '.' + side + ' needs a numeric pin index "put".');
    });
  });

  return { fatal: errors.length > 0, errors: errors, warnings: warnings, sketch: doc };
}

// Detect the plant prefix used by parameter bindings in a sketch document.
// Driver ids look like "3111_IWT_IWT_1_1_0_BAT_0" — the leading digits are the plant id.
function detectSourcePlantFromDriverIds(sketch) {
  for (var i = 0; i < sketch.blocks.length; i++) {
    var data = sketch.blocks[i].data;
    if (!data) continue;
    var ids = Array.isArray(data.driver_ids) ? data.driver_ids
      : (typeof data.driver_id === 'string' ? [data.driver_id] : []);
    for (var k = 0; k < ids.length; k++) {
      var m = /^(\d+)_/.exec(String(ids[k]));
      if (m) return m[1];
    }
  }
  return null;
}

// Count how many driver-id strings carry the given plant prefix.
function countRebindableDriverIds(sketch, fromPlant) {
  var prefix = fromPlant + '_';
  var count = 0;
  for (var i = 0; i < sketch.blocks.length; i++) {
    var data = sketch.blocks[i].data;
    if (!data) continue;
    if (Array.isArray(data.driver_ids)) {
      for (var k = 0; k < data.driver_ids.length; k++) {
        if (String(data.driver_ids[k]).indexOf(prefix) === 0) count++;
      }
    }
    if (typeof data.driver_id === 'string' && data.driver_id.indexOf(prefix) === 0) count++;
  }
  return count;
}

// Rewrite "<fromPlant>_…" driver ids to "<toPlant>_…" on a DEEP COPY of the
// sketch. Only touches the known binding fields (data.driver_ids[] and the
// legacy data.driver_id string) — nothing else is modified.
// Returns { sketch, rewritten }.
function rebindDriverIds(sketchIn, fromPlant, toPlant) {
  var sketch = JSON.parse(JSON.stringify(sketchIn));
  var prefix = fromPlant + '_';
  var rewritten = 0;
  for (var i = 0; i < sketch.blocks.length; i++) {
    var data = sketch.blocks[i].data;
    if (!data) continue;
    if (Array.isArray(data.driver_ids)) {
      for (var k = 0; k < data.driver_ids.length; k++) {
        var id = String(data.driver_ids[k]);
        if (id.indexOf(prefix) === 0) {
          data.driver_ids[k] = toPlant + '_' + id.slice(prefix.length);
          rewritten++;
        }
      }
    }
    if (typeof data.driver_id === 'string' && data.driver_id.indexOf(prefix) === 0) {
      data.driver_id = toPlant + '_' + data.driver_id.slice(prefix.length);
      rewritten++;
    }
  }
  return { sketch: sketch, rewritten: rewritten };
}

// List block types in the sketch whose bindings cannot be auto-rebound across
// plants (the user must reconfigure them via the host dialogs after import).
function listManualRebindWarnings(sketch) {
  var warnings = [];
  var calendars = 0, tagvalues = 0;
  for (var i = 0; i < sketch.blocks.length; i++) {
    var b = sketch.blocks[i];
    if ((b.type === 'CALENDAR' || b.type === 'CALENDAR_2_0') && b.data) calendars++;
    if (b.type === 'TAGVALUE' && b.data) tagvalues++;
  }
  if (calendars > 0) warnings.push(calendars + ' Calendar block(s) reference source-plant calendar ids');
  if (tagvalues > 0) warnings.push(tagvalues + ' Tag value block(s) carry source-plant unit bindings');
  return warnings;
}

// Block types present in the document but unknown to the target designer's
// palette (typically processes from a library not loaded on this plant).
function listUnknownBlockTypes(sketch, knownTypes) {
  var missing = {};
  for (var i = 0; i < sketch.blocks.length; i++) {
    var t = sketch.blocks[i].type;
    if (!(t in knownTypes)) missing[t] = true;
  }
  return Object.keys(missing);
}

// Build a safe filename for the export download.
function buildExportFilename(plantId, sketchName) {
  var safe = String(sketchName || 'canvas').replace(/[^a-z0-9_\-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'canvas';
  var d = new Date();
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  return 'vv-sketch_' + (plantId || 'plant') + '_' + safe + '_' + stamp + '.json';
}

// Skip the browser-only body when loaded under Node for tests.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (function () {
    'use strict';

    var SCRIPT_NAME = 'Logic Designer Import/Export';
    var VERSION = '1.5.0';
    var LOAD_FLAG = '__LDIO_LOADED';
    var W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : null) || window;
    if (W[LOAD_FLAG]) return;
    W[LOAD_FLAG] = true;

    // ─── Styles (GM_addStyle when sandboxed; <style> fallback otherwise) ──
    var CSS = '\
      .ldio-toast { position: fixed; bottom: 16px; right: 16px; z-index: 100000;\
        padding: 8px 12px; background: rgba(30,30,30,0.92); color: #fff;\
        font: 12px/1.3 sans-serif; border-radius: 4px;\
        box-shadow: 0 2px 8px rgba(0,0,0,0.3); pointer-events: none; }\
      .ldio-toast-error { background: rgba(140,30,30,0.92); }\
      .ldio-overlay { position: fixed; inset: 0; z-index: 99998;\
        background: rgba(0,0,0,0.35); }\
      .ldio-panel { position: fixed; top: 15%; left: 50%; transform: translateX(-50%);\
        z-index: 99999; width: 460px; max-width: 92vw; padding: 14px;\
        background: rgba(25,25,25,0.97); color: #d4d4d4; border-radius: 8px;\
        border: 1px solid rgba(255,255,255,0.14);\
        box-shadow: 0 8px 28px rgba(0,0,0,0.55);\
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }\
      .ldio-panel h3 { margin: 0 0 10px 0; font-size: 14px; color: #fff; }\
      .ldio-file-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }\
      .ldio-file-row input[type=file] { flex: 1; color: #d4d4d4; font-size: 12px; }\
      .ldio-drop { border: 2px dashed rgba(255,255,255,0.25); border-radius: 6px;\
        padding: 14px; text-align: center; color: #9a9a9a; margin-bottom: 10px; }\
      .ldio-drop.ldio-drop-hot { border-color: #ffa500; color: #ffa500; background: rgba(255,165,0,0.06); }\
      .ldio-panel textarea { width: 100%; box-sizing: border-box; height: 84px;\
        background: #1e1e1e; color: #d4d4d4; border: 1px solid rgba(255,255,255,0.15);\
        border-radius: 4px; padding: 6px 8px; font: 11px/1.4 monospace; resize: vertical; }\
      .ldio-btn-row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }\
      .ldio-btn { background: #2a2a2a; color: #d4d4d4; border: 1px solid rgba(255,255,255,0.15);\
        border-radius: 4px; padding: 6px 14px; font-size: 12px; cursor: pointer; }\
      .ldio-btn:hover { background: #383838; }\
      .ldio-btn-primary { background: #2c5d8e; border-color: #3d7ab3; }\
      .ldio-btn-primary:hover { background: #357ab8; }\
      .ldio-version { opacity: 0.45; font-size: 10px; }\
      .ldio-errpanel { width: 620px; }\
      .ldio-err-sub { font-size: 12px; color: #e6a5a5; margin-bottom: 8px; }\
      .ldio-err-list { max-height: 46vh; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; padding: 6px; background: #1a1a1a; }\
      .ldio-err-item { display: flex; gap: 8px; align-items: flex-start; padding: 4px; font-size: 12px; line-height: 1.4; border-bottom: 1px solid rgba(255,255,255,0.05); }\
      .ldio-err-item:last-child { border-bottom: 0; }\
      .ldio-err-dot { color: #ff6b6b; font-weight: 700; flex: 0 0 auto; }\
      .ldio-warn-item { color: #d9c07a; }\
      .ldio-warn-item .ldio-err-dot { color: #d9c07a; }\
      .ldio-sim-panel { position: fixed; top: 70px; right: 16px; left: auto; transform: none;\
        width: 380px; max-height: 82vh; display: flex; flex-direction: column; }\
      .ldio-sim-head { cursor: move; user-select: none; }\
      .ldio-sim-rows { overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;\
        background: #1a1a1a; padding: 4px; margin-bottom: 8px; flex: 0 1 auto; max-height: 34vh; }\
      .ldio-sim-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; font-size: 12px;\
        border-bottom: 1px solid rgba(255,255,255,0.05); }\
      .ldio-sim-row:last-child { border-bottom: 0; }\
      .ldio-sim-row .ldio-sim-ptr { color: #7aa7d9; flex: 0 0 auto; font-family: monospace; }\
      .ldio-sim-row .ldio-sim-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\
      .ldio-sim-row input[type=number] { width: 74px; background: #1e1e1e; color: #d4d4d4;\
        border: 1px solid rgba(255,255,255,0.15); border-radius: 3px; padding: 3px 5px; font-size: 12px; }\
      .ldio-sim-row input.ldio-sim-missing { border-color: #d9c07a; }\
      .ldio-sim-mini { padding: 2px 7px; font-size: 11px; }\
      .ldio-sim-result { overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;\
        background: #1a1a1a; padding: 6px; font-size: 12px; line-height: 1.45; max-height: 26vh; flex: 0 1 auto; }\
      .ldio-sim-result .ldio-sim-true { color: #7ad97a; }\
      .ldio-sim-result .ldio-sim-false { color: #ff8a8a; }\
      .ldio-sim-result .ldio-sim-msg { color: #d9c07a; }\
      .ldio-sim-ctl { display: flex; align-items: center; gap: 8px; margin: 4px 0 8px 0; font-size: 12px; flex-wrap: wrap; }\
    ';
    if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); }
    else { var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }

    // ─── Toast ──────────────────────────────────────────────────────
    function toast(message, kind) {
      var el = document.createElement('div');
      el.textContent = message;
      el.className = 'ldio-toast' + (kind === 'error' ? ' ldio-toast-error' : '');
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 4500);
    }

    // ─── Error panel — itemised import problems (with fixes) ─────────
    function showErrorPanel(headline, errors, warnings) {
      var overlay = document.createElement('div');
      overlay.className = 'ldio-overlay';
      var panel = document.createElement('div');
      panel.className = 'ldio-panel ldio-errpanel';
      function close() { overlay.remove(); panel.remove(); document.removeEventListener('keydown', onKey, true); }
      function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }
      overlay.addEventListener('click', close);

      var h = document.createElement('h3');
      h.textContent = headline;
      panel.appendChild(h);

      var sub = document.createElement('div');
      sub.className = 'ldio-err-sub';
      sub.textContent = (errors.length ? errors.length + (errors.length === 1 ? ' problem' : ' problems') : 'No blocking problems') +
        (warnings.length ? ' · ' + warnings.length + (warnings.length === 1 ? ' note' : ' notes') : '') +
        '. Nothing was imported — fix these and try again.';
      panel.appendChild(sub);

      var list = document.createElement('div');
      list.className = 'ldio-err-list';
      errors.forEach(function (e) {
        var row = document.createElement('div'); row.className = 'ldio-err-item';
        var dot = document.createElement('span'); dot.className = 'ldio-err-dot'; dot.textContent = '✗';
        var txt = document.createElement('span'); txt.textContent = e;
        row.appendChild(dot); row.appendChild(txt); list.appendChild(row);
      });
      warnings.forEach(function (w) {
        var row = document.createElement('div'); row.className = 'ldio-err-item ldio-warn-item';
        var dot = document.createElement('span'); dot.className = 'ldio-err-dot'; dot.textContent = '!';
        var txt = document.createElement('span'); txt.textContent = w;
        row.appendChild(dot); row.appendChild(txt); list.appendChild(row);
      });
      panel.appendChild(list);

      var btnRow = document.createElement('div');
      btnRow.className = 'ldio-btn-row';
      var hint = document.createElement('span');
      hint.className = 'ldio-version';
      hint.textContent = 'Tip: node validate-vv-sketch.js <file> gives the same checks in your editor.';
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button'; copyBtn.className = 'ldio-btn';
      copyBtn.textContent = 'Copy problems';
      copyBtn.addEventListener('click', function () {
        var text = headline + '\n' + errors.map(function (e) { return '- ' + e; }).join('\n') +
          (warnings.length ? '\n' + warnings.map(function (w) { return '(note) ' + w; }).join('\n') : '');
        var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); toast('Problem list copied.'); } catch (e) { /* ignore */ }
        ta.remove();
      });
      var okBtn = document.createElement('button');
      okBtn.type = 'button'; okBtn.className = 'ldio-btn ldio-btn-primary'; okBtn.style.marginLeft = '6px';
      okBtn.textContent = 'Close';
      okBtn.addEventListener('click', close);
      var btns = document.createElement('span'); btns.appendChild(copyBtn); btns.appendChild(okBtn);
      btnRow.appendChild(hint); btnRow.appendChild(btns);
      panel.appendChild(btnRow);

      document.body.appendChild(overlay);
      document.body.appendChild(panel);
      document.addEventListener('keydown', onKey, true);
    }

    // ─── Export ─────────────────────────────────────────────────────
    // Builds the current canvas's export envelope, or null (with a toast).
    function buildCurrentEnvelope() {
      var paper = W.logic_designer && W.logic_designer.paper;
      if (!paper) { toast('Designer not ready.', 'error'); return null; }
      var blockCount = Object.keys(paper.elements || {}).filter(function (k) { return /^\d+$/.test(k); }).length;
      if (blockCount === 0) { toast('Canvas is empty — nothing to export.'); return null; }

      // paper.save() clears the dirty flag as a side effect — preserve it.
      var wasChanged = paper.changed;
      var sketch = paper.save();
      paper.changed = wasChanged;

      var plantId = (W.query_string && W.query_string.plant_id) || null;
      return buildExportEnvelope({
        sketch: sketch,
        sourcePlantId: plantId,
        sketchId: W.application ? W.application.current_sketch : null,
        sketchName: W.application ? W.application.current_sketch_name : null,
        generator: 'LDIO v' + VERSION,
        requiresProcesses: listProcessDependencies(sketch, paper.blocks || {}),
      });
    }

    function doExport() {
      try {
        var envelope = buildCurrentEnvelope();
        if (!envelope) return;
        var blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = buildExportFilename(envelope.source_plant_id, envelope.name);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        toast('Exported ' + envelope.block_count + ' blocks / ' + envelope.connection_count + ' wires → ' + a.download);
      } catch (err) {
        console.error('[' + SCRIPT_NAME + '] export failed:', err);
        toast('Export failed (see console).', 'error');
      }
    }

    // ─── Copy as JSON text ──────────────────────────────────────────
    // navigator.clipboard is unavailable on plain http (insecure origin),
    // so the primary path is the execCommand fallback — which requires a
    // user gesture: we run synchronously inside the menu click (capture
    // handler), so the gesture is intact.
    function copyTextToClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).catch(function () { /* fall through to sync path below on next call */ });
        return true;
      }
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }

    function doCopyJson() {
      try {
        var envelope = buildCurrentEnvelope();
        if (!envelope) return null;
        var text = JSON.stringify(envelope, null, 2);
        var ok = copyTextToClipboard(text);
        if (ok) {
          toast('Copied ' + envelope.block_count + ' blocks / ' + envelope.connection_count + ' wires as JSON — paste into Import on the target plant.');
        } else {
          toast('Could not access the clipboard — use Export (file) instead.', 'error');
        }
        return text;
      } catch (err) {
        console.error('[' + SCRIPT_NAME + '] copy JSON failed:', err);
        toast('Copy failed (see console).', 'error');
        return null;
      }
    }

    // ─── Live simulate ──────────────────────────────────────────────
    // Drives the HOST's own client simulator (paper.simulator_step + the
    // per-block sim functions, §13 of the reference), but: input values come
    // from a panel instead of prompt() per block, the whole graph runs in one
    // go instead of Next-Next-Next, results STAY on the canvas (the host
    // auto-clears after 5 s), and every value change re-simulates live.
    // Contract live-probed 2026-07-09: get_user_input side effects
    // (stack_block_values + user_values + auto_proceed), simulator_start's
    // confirm()/defer, the step loop, and the 'Timed stop' 5 s auto-clear.
    var simState = {
      panel: null, rowsEl: null, resultEl: null, autoRunEl: null,
      values: {}, missing: [], msgs: [], debounce: null,
      hooked: false, hadOwnGUI: false, origGUI: null, origShow: null,
      hadOwnCb: false, origCb: null,
    };

    function simPaper() {
      var paper = W.logic_designer && W.logic_designer.paper;
      return (paper && paper.initialized) ? paper : null;
    }

    function simInstallHooks(paper) {
      if (simState.hooked) return;
      simState.hadOwnGUI = Object.prototype.hasOwnProperty.call(paper, 'get_user_input');
      simState.origGUI = paper.get_user_input;
      paper.get_user_input = function (block) {
        var raw = simState.values[block.pointer];
        var v = parseFloat(raw);
        if (isNaN(v)) { v = 0; if (simState.missing.indexOf(block.pointer) === -1) simState.missing.push(block.pointer); }
        this.simulation_stack_block_values[block.pointer] = v;
        this.simulation_user_values[block.pointer] = v;
        this.simulation_auto_proceed = true;
        return v;
      };
      // Route the host's info modals (alarm fired, sim errors) into the panel.
      if (W.system_dialogs && W.system_dialogs.information) {
        simState.origShow = W.system_dialogs.information.show;
        W.system_dialogs.information.show = function (m) { simState.msgs.push(String(m).replace(/<[^>]*>/g, '')); };
      }
      // Swallow simulation_* callbacks so the host's progress-bar UI stays out.
      simState.hadOwnCb = Object.prototype.hasOwnProperty.call(paper, 'callback');
      simState.origCb = paper.callback;
      paper.callback = function (e) {
        if (e && /^simulation_/.test(String(e.action))) return;
        return simState.origCb.call(this, e);
      };
      simState.hooked = true;
    }

    function simRemoveHooks(paper) {
      if (!simState.hooked) return;
      if (simState.hadOwnGUI) paper.get_user_input = simState.origGUI; else delete paper.get_user_input;
      if (simState.hadOwnCb) paper.callback = simState.origCb; else delete paper.callback;
      if (simState.origShow && W.system_dialogs && W.system_dialogs.information) {
        W.system_dialogs.information.show = simState.origShow;
      }
      simState.hooked = false;
    }

    // Remove sim visuals from the canvas and restore wire colours.
    function simClearCanvas(paper) {
      if (paper.simulation_stopper) { clearTimeout(paper.simulation_stopper); paper.simulation_stopper = null; }
      paper.__simulation_reset(true);
      paper.simulation_stack = null;
    }

    function simResultLine(text, cls) {
      var div = document.createElement('div');
      if (cls) div.className = cls;
      div.textContent = text;
      simState.resultEl.appendChild(div);
    }

    function simRunOnce() {
      var paper = simPaper();
      if (!paper) { toast('Designer not ready — open/start the application first.', 'error'); return; }
      if (!simState.panel || !simState.resultEl) { openSimPanel(); if (!simState.panel) return; }
      simState.resultEl.textContent = '';
      var blockCount = Object.keys(paper.elements || {}).filter(function (k) { return /^\d+$/.test(k); }).length;
      if (blockCount === 0) { simResultLine('Canvas is empty — nothing to simulate.'); return; }

      var check = paper.syntax_check(true);
      if (!check.ok) {
        simResultLine('Syntax check failed — fix these first:', 'ldio-sim-false');
        (check.errors || []).forEach(function (e) { simResultLine('  ' + e); });
        return;
      }

      simState.msgs = [];
      simState.missing = [];

      // Own setup — mirrors the host's simulator_start minus its confirm(),
      // deferred first step and callbacks (probed source, 2026-07-09). The
      // dirty flag is preserved across save()'s side effect (host loses it).
      var wasChanged = paper.changed;
      if (paper.simulation_stopper) { clearTimeout(paper.simulation_stopper); }
      paper.simulation_stopper = null;
      paper.__simulation_reset(true);
      for (var x = 0; x < paper.connections.length; x++) paper.connections[x].line.attr('stroke', '#EEE');
      paper.simulation_elements = [];
      paper.simulation_stack = paper.save(false);
      paper.changed = wasChanged;
      paper.simulation_steps = paper.simulation_stack.blocks.length;
      paper.simulation_stack_block_values = {};
      paper.simulation_user_values = {};
      paper.simulation_completed_blocks = [];
      paper.simulation_connections = [];
      paper.simulation_data = {};

      var cap = Math.max(200, paper.simulation_steps * 5);
      var guard = 0;
      try {
        while (paper.simulation_stack && paper.simulation_completed_blocks.length < paper.simulation_steps && guard++ < cap) {
          paper.simulator_step();
        }
      } catch (err) {
        simResultLine('Simulation stopped on a block error: ' + err.message, 'ldio-sim-false');
        simResultLine('(Usually an unconfigured block — configure it and rerun.)');
        return;
      }
      // The final step schedules the host's 5 s auto-clear — cancel it so the
      // values stay visible on the canvas until Stop/rerun.
      if (paper.simulation_stopper) { clearTimeout(paper.simulation_stopper); paper.simulation_stopper = null; }

      var done = paper.simulation_completed_blocks.length;
      var results = paper.simulation_stack_block_values || {};
      if (done < paper.simulation_steps) {
        simResultLine('Incomplete: ' + done + '/' + paper.simulation_steps + ' blocks evaluated (branch invalidated or a block returned no value).', 'ldio-sim-msg');
      }
      var outs = listSimOutputBlocks(paper.elements || {});
      if (outs.length === 0) simResultLine('No output blocks on the canvas.');
      outs.forEach(function (o) {
        var v = results[o.pointer];
        var cls = (v === true || v === 'ALARM') ? 'ldio-sim-true' : (v === false || v === 'FALSE' ? 'ldio-sim-false' : null);
        simResultLine(o.type + ' (' + o.pointer + ')' + (o.label ? ' ' + o.label : '') + '  →  ' + formatSimValue(v), cls);
      });
      simState.msgs.forEach(function (m) { simResultLine('⚠ ' + m, 'ldio-sim-msg'); });
      if (simState.missing.length) {
        simResultLine('Note: ' + simState.missing.length + ' input(s) had no value and defaulted to 0: block ' + simState.missing.join(', '), 'ldio-sim-msg');
      }
      // Flag the empty inputs in the rows list.
      var inputs = simState.rowsEl.querySelectorAll('input[data-ptr]');
      for (var i = 0; i < inputs.length; i++) {
        var ptr = parseInt(inputs[i].getAttribute('data-ptr'), 10);
        inputs[i].classList.toggle('ldio-sim-missing', simState.missing.indexOf(ptr) !== -1);
      }
    }

    function simQueueRun() {
      if (!simState.autoRunEl || !simState.autoRunEl.checked) return;
      if (simState.debounce) clearTimeout(simState.debounce);
      simState.debounce = setTimeout(function () { simState.debounce = null; simRunOnce(); }, 300);
    }

    function simBuildRows() {
      var paper = simPaper();
      simState.rowsEl.textContent = '';
      if (!paper) { simState.rowsEl.textContent = 'Designer not ready.'; return; }
      var rows = listSimInputBlocks(paper.elements || {}, paper.blocks || {});
      if (rows.length === 0) {
        simState.rowsEl.textContent = 'No input blocks need values (CONSTs use their configured value).';
        return;
      }
      rows.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'ldio-sim-row';
        var ptr = document.createElement('span');
        ptr.className = 'ldio-sim-ptr';
        ptr.textContent = '(' + r.pointer + ')';
        var label = document.createElement('span');
        label.className = 'ldio-sim-label';
        label.textContent = r.label + ' · ' + r.type;
        label.title = r.label + ' (' + r.type + ')';
        var input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.placeholder = '0';
        input.setAttribute('data-ptr', String(r.pointer));
        if (simState.values[r.pointer] !== undefined) input.value = simState.values[r.pointer];
        input.addEventListener('input', function () {
          simState.values[r.pointer] = input.value;
          simQueueRun();
        });
        var btn0 = document.createElement('button');
        btn0.type = 'button'; btn0.className = 'ldio-btn ldio-sim-mini'; btn0.textContent = '0';
        btn0.title = 'False / 0';
        btn0.addEventListener('click', function () { input.value = '0'; simState.values[r.pointer] = '0'; simQueueRun(); });
        var btn1 = document.createElement('button');
        btn1.type = 'button'; btn1.className = 'ldio-btn ldio-sim-mini'; btn1.textContent = '1';
        btn1.title = 'True / 1';
        btn1.addEventListener('click', function () { input.value = '1'; simState.values[r.pointer] = '1'; simQueueRun(); });
        row.appendChild(ptr); row.appendChild(label); row.appendChild(input); row.appendChild(btn0); row.appendChild(btn1);
        simState.rowsEl.appendChild(row);
      });
    }

    function closeSimPanel() {
      if (!simState.panel) return;
      var paper = simPaper();
      if (paper) { simClearCanvas(paper); simRemoveHooks(paper); }
      if (simState.debounce) { clearTimeout(simState.debounce); simState.debounce = null; }
      simState.panel.remove();
      simState.panel = null;
    }

    function openSimPanel() {
      var paper = simPaper();
      if (!paper) { toast('Designer not ready — open/start the application first.', 'error'); return; }
      if (simState.panel) { closeSimPanel(); }
      simInstallHooks(paper);

      var panel = document.createElement('div');
      panel.className = 'ldio-panel ldio-sim-panel';

      var h = document.createElement('h3');
      h.className = 'ldio-sim-head';
      h.textContent = 'Live simulate — set inputs, watch the flow';
      panel.appendChild(h);
      // Drag by the header.
      (function () {
        var sx = 0, sy = 0, px = 0, py = 0, dragging = false;
        h.addEventListener('mousedown', function (e) {
          dragging = true; sx = e.clientX; sy = e.clientY;
          var r = panel.getBoundingClientRect(); px = r.left; py = r.top;
          e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
          if (!dragging) return;
          panel.style.left = (px + e.clientX - sx) + 'px';
          panel.style.right = 'auto';
          panel.style.top = (py + e.clientY - sy) + 'px';
        });
        document.addEventListener('mouseup', function () { dragging = false; });
      })();

      var rows = document.createElement('div');
      rows.className = 'ldio-sim-rows';
      panel.appendChild(rows);

      var ctl = document.createElement('div');
      ctl.className = 'ldio-sim-ctl';
      var runBtn = document.createElement('button');
      runBtn.type = 'button'; runBtn.className = 'ldio-btn ldio-btn-primary';
      runBtn.textContent = '▶ Run';
      runBtn.addEventListener('click', simRunOnce);
      var autoLabel = document.createElement('label');
      var autoCb = document.createElement('input');
      autoCb.type = 'checkbox'; autoCb.checked = true; autoCb.style.verticalAlign = 'middle';
      autoLabel.appendChild(autoCb);
      autoLabel.appendChild(document.createTextNode(' auto re-run'));
      var refreshBtn = document.createElement('button');
      refreshBtn.type = 'button'; refreshBtn.className = 'ldio-btn';
      refreshBtn.textContent = '↻ Inputs';
      refreshBtn.title = 'Rebuild the input list after canvas edits (values are kept per block)';
      refreshBtn.addEventListener('click', simBuildRows);
      var stopBtn = document.createElement('button');
      stopBtn.type = 'button'; stopBtn.className = 'ldio-btn';
      stopBtn.textContent = '■ Clear';
      stopBtn.title = 'Remove the simulated values from the canvas';
      stopBtn.addEventListener('click', function () {
        var p2 = simPaper();
        if (p2) simClearCanvas(p2);
        simState.resultEl.textContent = '';
      });
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button'; closeBtn.className = 'ldio-btn';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', closeSimPanel);
      ctl.appendChild(runBtn); ctl.appendChild(autoLabel); ctl.appendChild(refreshBtn); ctl.appendChild(stopBtn); ctl.appendChild(closeBtn);
      panel.appendChild(ctl);

      var result = document.createElement('div');
      result.className = 'ldio-sim-result';
      panel.appendChild(result);

      var hint = document.createElement('div');
      hint.className = 'ldio-version';
      hint.style.marginTop = '6px';
      hint.textContent = 'Values render on the blocks; wires go green as the flow runs. Nothing touches the plant — client-side only. LDIO v' + VERSION;
      panel.appendChild(hint);

      document.body.appendChild(panel);
      simState.panel = panel;
      simState.rowsEl = rows;
      simState.resultEl = result;
      simState.autoRunEl = autoCb;
      simBuildRows();
    }

    // ─── Import panel ───────────────────────────────────────────────
    // v1.1.0: no programmatic input.click() at all. The menu opens a panel
    // holding a VISIBLE file input — the user's own click on it is a direct
    // gesture, so the OS picker always opens (this defeated v1.0.x, where
    // Chrome dropped the transient activation before input.click() ran).
    // The panel also accepts drag-and-drop and pasted JSON.
    var panelEls = null; // { overlay, panel, input, drop, textarea }

    function closeImportPanel() {
      if (!panelEls) return;
      panelEls.overlay.remove();
      panelEls.panel.remove();
      panelEls = null;
      document.removeEventListener('keydown', onPanelKeydown, true);
    }

    function onPanelKeydown(event) {
      if (event.key === 'Escape' && panelEls) {
        event.preventDefault();
        event.stopPropagation();
        closeImportPanel();
      }
    }

    function readFileAndImport(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        closeImportPanel();
        var parsed;
        try { parsed = JSON.parse(String(reader.result)); }
        catch (e) { toast('Not valid JSON: ' + e.message, 'error'); return; }
        applyImport(parsed);
      };
      reader.onerror = function () { toast('Could not read the file.', 'error'); };
      reader.readAsText(file);
    }

    function openImportPanel() {
      if (panelEls) { closeImportPanel(); }

      var overlay = document.createElement('div');
      overlay.className = 'ldio-overlay';
      overlay.addEventListener('click', closeImportPanel);

      var panel = document.createElement('div');
      panel.className = 'ldio-panel';

      var h = document.createElement('h3');
      h.textContent = 'Import sketch (JSON)';
      panel.appendChild(h);

      // 1) Visible file input — a direct user click, always opens the picker.
      var fileRow = document.createElement('div');
      fileRow.className = 'ldio-file-row';
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', function () {
        readFileAndImport(input.files && input.files[0]);
      });
      fileRow.appendChild(input);
      panel.appendChild(fileRow);

      // 2) Drag & drop zone.
      var drop = document.createElement('div');
      drop.className = 'ldio-drop';
      drop.textContent = '…or drop a vv-sketch .json file here';
      drop.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('ldio-drop-hot'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('ldio-drop-hot'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault(); e.stopPropagation();
        drop.classList.remove('ldio-drop-hot');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        readFileAndImport(f);
      });
      panel.appendChild(drop);

      // 3) Paste-JSON fallback.
      var textarea = document.createElement('textarea');
      textarea.placeholder = '…or paste the exported JSON here and press Import';
      textarea.spellcheck = false;
      panel.appendChild(textarea);

      var btnRow = document.createElement('div');
      btnRow.className = 'ldio-btn-row';
      var ver = document.createElement('span');
      ver.className = 'ldio-version';
      ver.textContent = 'LDIO v' + VERSION;
      var btns = document.createElement('span');
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ldio-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.marginRight = '6px';
      cancelBtn.addEventListener('click', closeImportPanel);
      var importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'ldio-btn ldio-btn-primary';
      importBtn.textContent = 'Import pasted JSON';
      importBtn.addEventListener('click', function () {
        var text = textarea.value.trim();
        if (!text) { toast('Paste JSON first, or pick a file above.'); return; }
        var parsed;
        try { parsed = JSON.parse(text); }
        catch (e) { toast('Not valid JSON: ' + e.message, 'error'); return; }
        closeImportPanel();
        applyImport(parsed);
      });
      btns.appendChild(cancelBtn);
      btns.appendChild(importBtn);
      btnRow.appendChild(ver);
      btnRow.appendChild(btns);
      panel.appendChild(btnRow);

      document.body.appendChild(overlay);
      document.body.appendChild(panel);
      document.addEventListener('keydown', onPanelKeydown, true);
      panelEls = { overlay: overlay, panel: panel, input: input, drop: drop, textarea: textarea };
    }

    function applyImport(parsed) {
      try {
        var paper = W.logic_designer && W.logic_designer.paper;
        if (!paper || !paper.initialized) { toast('Designer not ready — open/start the application first.', 'error'); return; }

        // Rich diagnostics: itemised, host-contract-aware, with fixes.
        var diag = diagnoseImport(parsed, paper.blocks || {});
        if (diag.fatal) {
          showErrorPanel('This file can\'t be imported', diag.errors, diag.warnings);
          return;
        }
        var sketch = diag.sketch;
        var envelope = (parsed && parsed.format === 'vv-fbx-sketch') ? parsed : null;
        // Non-fatal notes (e.g. empty driver_ids) — surface but continue.
        if (diag.warnings.length) toast(diag.warnings.length + ' note(s): ' + diag.warnings[0] + (diag.warnings.length > 1 ? ' (…)' : ''));

        // Fill housekeeping fields hand-authored files may omit (override/
        // runtime/properties/data/groups, missing funcs from the palette).
        // Real exports pass through unchanged.
        var norm = normalizeSketchForLoad(sketch, paper.blocks || {});
        sketch = norm.sketch;
        if (norm.filledFuncs > 0) toast('Filled ' + norm.filledFuncs + ' missing block func(s) from the palette.');

        // Plant rebinding: rewrite "<src>_" driver-id prefixes to this plant.
        var currentPlant = String((W.query_string && W.query_string.plant_id) || '');
        var sourcePlant = (envelope && envelope.source_plant_id) || detectSourcePlantFromDriverIds(sketch);
        var rebindNote = '';
        if (sourcePlant && currentPlant && String(sourcePlant) !== currentPlant) {
          var n = countRebindableDriverIds(sketch, String(sourcePlant));
          if (n > 0) {
            var doRebind = confirm('Sketch was exported from plant ' + sourcePlant + ' (this is plant ' + currentPlant + ').\n\n' +
              'Rewrite ' + n + ' parameter binding(s) "' + sourcePlant + '_…" → "' + currentPlant + '_…"?\n\n' +
              'OK = rewrite (use when the plants have the same unit layout)\n' +
              'Cancel = keep the original ids (reconfigure blocks manually)');
            if (doRebind) {
              var rb = rebindDriverIds(sketch, String(sourcePlant), currentPlant);
              sketch = rb.sketch;
              rebindNote = ' (' + rb.rewritten + ' bindings rebound to plant ' + currentPlant + ')';
            }
          }
          var warnings = listManualRebindWarnings(sketch);
          if (warnings.length > 0) {
            toast('Reconfigure after import: ' + warnings.join('; '), 'error');
          }
        }

        if (paper.changed) {
          if (!confirm('The canvas has unsaved changes. Replace it with the imported sketch?')) return;
        }

        paper.reset();
        paper.load(sketch);
        paper.changed = true; // imported content is unsaved by definition

        // This is NEW content on this plant — make Ctrl+S open the save-as
        // dialog instead of silently overwriting a previously open sketch.
        if (W.application) {
          W.application.current_sketch = null;
          W.application.current_sketch_name = null;
        }

        toast('Imported ' + sketch.blocks.length + ' blocks / ' + sketch.connections.length + ' wires' + rebindNote +
          '. Use File → Save sketch to store it on this plant.');
      } catch (err) {
        console.error('[' + SCRIPT_NAME + '] import failed:', err);
        toast('Import failed (see console).', 'error');
      }
    }

    // ─── Menu integration ───────────────────────────────────────────
    // The host rebuilds the whole menu on every mode change via
    // menu_main.creator.render(true). Patch render permanently: before each
    // render, append our Transfer section to the "file" level if missing.
    // Item ids get the parent prefix, so they surface as
    // "file_ldio_export" / "file_ldio_import".
    var ICON_EXPORT = '<li class="fa fa-fw fa-download" style="font-size:14px"></li>&nbsp;Export sketch (JSON)';
    var ICON_IMPORT = '<li class="fa fa-fw fa-upload" style="font-size:14px"></li>&nbsp;Import sketch (JSON)';
    var ICON_COPY = '<li class="fa fa-fw fa-copy" style="font-size:14px"></li>&nbsp;Copy sketch (JSON text)';
    var ICON_SIM = '<li class="fa fa-fw fa-play-circle" style="font-size:14px"></li>&nbsp;Live simulate (panel)';

    // Resolve a click target inside the dropdown to one of our item ids.
    function resolveOwnMenuItemId(target) {
      try {
        if (!target || !target.closest) return null;
        var itemEl = target.closest('.iw_oc_menu_dropdown_item');
        if (!itemEl) return null;
        var index = itemEl.getAttribute('data-index');
        var item = W.menu_main && W.menu_main.menu_items ? W.menu_main.menu_items[index] : null;
        if (!item) return null;
        if (item.id === 'file_ldio_export' || item.id === 'file_ldio_import' || item.id === 'file_ldio_copy' || item.id === 'file_ldio_sim') return item.id;
      } catch (err) { /* fall through */ }
      return null;
    }

    // Capture-phase click handler: keeps export inside the native gesture
    // (nice for the download) and opens the import panel immediately.
    var lastHandledAt = 0;
    function onCaptureClick(event) {
      var id = resolveOwnMenuItemId(event.target);
      if (!id) return;
      lastHandledAt = Date.now();
      if (id === 'file_ldio_import') openImportPanel();
      else if (id === 'file_ldio_export') doExport();
      else if (id === 'file_ldio_copy') doCopyJson();
      else if (id === 'file_ldio_sim') openSimPanel();
      // Do NOT stop the event — the host's handler still runs and closes the
      // dropdown; our on_menu wrap below swallows the unknown item id.
    }

    function installMenuHooks() {
      var creator = W.menu_main.creator;
      var origRender = creator.render;
      creator.render = function (clear) {
        try {
          var fileLevel = null;
          for (var i = 0; i < this.data.length; i++) {
            if (this.data[i].id === 'file') { fileLevel = this.data[i]; break; }
          }
          if (fileLevel) {
            var present = (fileLevel.sub || []).some(function (s) { return s.id === 'file_ldio_export'; });
            if (!present) {
              this.add_header(fileLevel, 'Transfer');
              this.add(fileLevel, ICON_EXPORT, 'ldio_export');
              this.add(fileLevel, ICON_IMPORT, 'ldio_import');
              this.add(fileLevel, ICON_COPY, 'ldio_copy');
              this.add_header(fileLevel, 'Simulate');
              this.add(fileLevel, ICON_SIM, 'ldio_sim');
            }
          }
        } catch (err) {
          console.error('[' + SCRIPT_NAME + '] menu injection failed:', err);
        }
        return origRender.call(this, clear);
      };

      // Fallback: if the capture handler didn't act (markup change, missed
      // event), the panel path still works from here — it needs no gesture.
      var origOnMenu = W.application.on_menu;
      W.application.on_menu = function (event) {
        if (event && (event.item_id === 'file_ldio_export' || event.item_id === 'file_ldio_import' || event.item_id === 'file_ldio_copy' || event.item_id === 'file_ldio_sim')) {
          if (Date.now() - lastHandledAt > 1000) {
            if (event.item_id === 'file_ldio_export') doExport();
            else if (event.item_id === 'file_ldio_copy') doCopyJson();
            else if (event.item_id === 'file_ldio_sim') openSimPanel();
            else openImportPanel();
          }
          return;
        }
        return origOnMenu.call(this, event);
      };

      document.addEventListener('click', onCaptureClick, true);

      // Rebuild once so the entries appear without needing a mode switch.
      try {
        if (W.logic_designer && W.logic_designer.paper && W.logic_designer.paper.initialized) {
          W.application.prepare_ui_menu(W.logic_designer.paper.mode);
        }
      } catch (err) { /* menu will pick the items up on the next natural rebuild */ }
    }

    // Wait for the host app to exist (it is created by inline page scripts).
    var installPoll = setInterval(function () {
      if (W.application && W.menu_main && W.menu_main.creator && W.logic_designer) {
        clearInterval(installPoll);
        installMenuHooks();
        console.log('[' + SCRIPT_NAME + '] v' + VERSION + ' installed.');
      }
    }, 300);

    // Expose internals for console debugging / live verification.
    W.__LDIO = { version: VERSION, doExport: doExport, doCopyJson: doCopyJson, openImportPanel: openImportPanel, applyImport: applyImport, openSimPanel: openSimPanel, simRunOnce: simRunOnce, closeSimPanel: closeSimPanel };
  })();
}

// ─── Node-only export footer (browser ignores this) ─────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildExportEnvelope: buildExportEnvelope,
    listProcessDependencies: listProcessDependencies,
    normalizeSketchForLoad: normalizeSketchForLoad,
    listSimInputBlocks: listSimInputBlocks,
    listSimOutputBlocks: listSimOutputBlocks,
    formatSimValue: formatSimValue,
    parseImportPayload: parseImportPayload,
    detectSourcePlantFromDriverIds: detectSourcePlantFromDriverIds,
    countRebindableDriverIds: countRebindableDriverIds,
    rebindDriverIds: rebindDriverIds,
    listManualRebindWarnings: listManualRebindWarnings,
    listUnknownBlockTypes: listUnknownBlockTypes,
    buildExportFilename: buildExportFilename,
    diagnoseImport: diagnoseImport,
  };
}
