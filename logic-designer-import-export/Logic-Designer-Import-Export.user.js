// ==UserScript==
// @name         Logic Designer Import/Export
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.15.0
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

function simBlockLabel(b) {
  return (b && ((b.override && b.override.alias_text) || (b.data && b.data.alias_text))) || '';
}

// Explain the flow of one simulation run, step by step: evaluation order, and
// for every block which upstream blocks fed which input pin with what value.
// stack = the run's paper.save() snapshot; results = {pointer: value};
// order = simulation_completed_blocks (completion order); inputValues = the
// panel's user-set values keyed by pointer.
function buildSimFlowLines(stack, results, order, inputValues) {
  if (!stack || !Array.isArray(stack.blocks)) return [];
  var byId = {};
  stack.blocks.forEach(function (b) { byId[b.id] = b; });
  var lines = [];
  order.forEach(function (id, i) {
    var b = byId[id];
    if (!b) return;
    var label = simBlockLabel(b);
    var head = 'step ' + (i + 1) + ': ' + b.type + ' (' + id + ')' + (label ? ' "' + label + '"' : '') + ' = ' + formatSimValue(results[id]);
    var feeds = stack.connections.filter(function (c) { return c.target && c.target.id === id; });
    if (feeds.length === 0 && inputValues && (id in inputValues)) head += '   [panel input]';
    lines.push(head);
    feeds.sort(function (a, b2) { return a.target.put - b2.target.put; }).forEach(function (c) {
      var s = byId[c.source.id];
      var sl = simBlockLabel(s);
      lines.push('    in' + c.target.put + ' <- ' + (s ? s.type : '?') + ' (' + c.source.id + ')' + (sl ? ' "' + sl + '"' : '') +
        ' = ' + formatSimValue(results[c.source.id]) + (c.alias_text ? '   [pin: ' + c.alias_text + ']' : ''));
    });
  });
  var notRun = stack.blocks.filter(function (b) { return order.indexOf(b.id) === -1; });
  if (notRun.length) {
    lines.push('');
    lines.push('NOT EVALUATED (invalidated IF branch, or never reached):');
    notRun.forEach(function (b) {
      var l = simBlockLabel(b);
      lines.push('  ' + b.type + ' (' + b.id + ')' + (l ? ' "' + l + '"' : ''));
    });
  }
  return lines;
}

// Build the full, self-contained simulation log — made to be pasted to an AI
// so it can debug/improve the logic without access to the designer.
// run = {ok, syntaxErrors, stack, results, order, inputValues, missing, messages}
// meta = {version, plantId, sketchName, mode}
function buildSimulationLog(run, meta) {
  var L = [];
  L.push('=== VV DESIGNER - LIVE SIMULATE LOG (LDIO v' + (meta.version || '?') + ') ===');
  L.push('Plant: ' + (meta.plantId || '?') + ' | Sketch: ' + (meta.sketchName || '(unsaved)') + ' | Mode: ' + (meta.mode || '?'));
  L.push('This is a CLIENT-SIDE simulation of an IWMAC VV Designer function-block sketch');
  L.push('(blocks wired output->input; format reference: vv-designer-reference/AI-BRIEFING.txt');
  L.push('in https://github.com/hapnes-dev/tampermonkey-scripts). Values below are what each');
  L.push('block computed with the given inputs. Please analyse whether the logic behaves as');
  L.push('intended and point out what to change.');
  L.push('');
  var total = (run.stack && run.stack.blocks) ? run.stack.blocks.length : 0;
  if (!run.ok) {
    L.push('RESULT: FAILED — the simulation did not complete.');
    if (run.syntaxErrors && run.syntaxErrors.length) {
      L.push('Cause: the syntax check rejected the sketch, nothing was simulated. Errors:');
      run.syntaxErrors.forEach(function (e) { L.push('  - ' + e); });
    }
    if (run.error) L.push('Cause: ' + run.error);
    if (run.order && run.order.length) {
      L.push('It stopped after ' + run.order.length + '/' + total + ' blocks — the partial flow below shows how far it got.');
    }
  } else {
    L.push('RESULT: ' + (run.order.length === total ? 'COMPLETE' : 'INCOMPLETE') + ' (' + run.order.length + '/' + total + ' blocks evaluated)');
    if (run.order.length !== total) {
      L.push('(Blocks can be skipped legitimately when an IF/IF_ELSE invalidated their branch — see NOT EVALUATED under FLOW.)');
    }
  }
  L.push('');
  L.push('INPUTS (values set in the Live Simulate panel):');
  var anyInput = false;
  var byId = {};
  ((run.stack && run.stack.blocks) || []).forEach(function (b) { byId[b.id] = b; });
  Object.keys(run.inputValues || {}).forEach(function (ptr) {
    var b = byId[ptr];
    var label = simBlockLabel(b);
    L.push('  ' + (b ? b.type : '?') + ' (' + ptr + ')' + (label ? ' "' + label + '"' : '') + ' = ' + run.inputValues[ptr]);
    anyInput = true;
  });
  if (!anyInput) L.push('  (none)');
  if (run.missing && run.missing.length) {
    L.push('  NOTE: these input blocks had NO value and defaulted to 0: ' + run.missing.join(', '));
  }
  if (run.stack && run.order && run.order.length) {
    L.push('');
    L.push('FLOW' + (run.ok ? '' : ' (PARTIAL — the run failed before completing)') + ' (evaluation order; "inN <- ..." shows what fed each input pin):');
    buildSimFlowLines(run.stack, run.results, run.order, run.inputValues).forEach(function (l) { L.push('  ' + l); });
  }
  L.push('');
  L.push('MESSAGES (alarm popups / errors raised during the run):');
  if (run.messages && run.messages.length) run.messages.forEach(function (m) { L.push('  - ' + m); });
  else L.push('  (none)');
  L.push('');
  L.push('BLOCKS (id: TYPE "label" data=...):');
  ((run.stack && run.stack.blocks) || []).forEach(function (b) {
    var label = simBlockLabel(b);
    var data = '';
    try { data = b.data == null ? 'null' : JSON.stringify(b.data); } catch (e) { data = '(unserializable)'; }
    if (data.length > 220) data = data.slice(0, 220) + '…';
    L.push('  ' + b.id + ': ' + b.type + (label ? ' "' + label + '"' : '') + ' data=' + data);
  });
  L.push('WIRES (source output -> target input):');
  ((run.stack && run.stack.connections) || []).forEach(function (c) {
    var s = byId[c.source.id], t = byId[c.target.id];
    L.push('  ' + (s ? s.type : '?') + '(' + c.source.id + ') out' + c.source.put + ' -> in' + c.target.put + ' ' + (t ? t.type : '?') + '(' + c.target.id + ')' + (c.alias_text ? '   [pin: ' + c.alias_text + ']' : ''));
  });
  L.push('');
  L.push('(For the full importable sketch JSON: File > Transfer > Export sketch (JSON).)');
  return L.join('\n');
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
    var VERSION = '1.15.0';
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
        width: 400px; height: 500px; min-width: 330px; min-height: 280px;\
        max-width: 96vw; max-height: 94vh; display: flex; flex-direction: column;\
        resize: both; overflow: hidden; padding: 0; }\
      .ldio-sim-panel .ldio-sim-head { display: flex; align-items: center; gap: 8px;\
        cursor: move; user-select: none; margin: 0; padding: 10px 12px; font-size: 13px;\
        font-weight: 600; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.1);\
        background: rgba(255,255,255,0.03); flex: 0 0 auto; }\
      .ldio-sim-head span { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\
      .ldio-sim-x { flex: 0 0 auto; cursor: pointer; border: 0; background: transparent; color: #9a9a9a;\
        font: 15px/1 sans-serif; padding: 3px 8px; border-radius: 4px; }\
      .ldio-sim-x:hover { background: rgba(255,80,80,0.18); color: #ff8a8a; }\
      .ldio-sim-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0;\
        padding: 9px 12px 4px 12px; }\
      .ldio-sim-sec { flex: 0 0 auto; font-size: 10px; letter-spacing: 0.09em; text-transform: uppercase;\
        color: #8f8f8f; margin: 3px 0 4px 1px; }\
      .ldio-sim-rows { overflow-y: auto; border: 1px solid rgba(255,255,255,0.09); border-radius: 6px;\
        background: #1a1a1a; padding: 3px 5px; flex: 1 1 110px; min-height: 62px; }\
      .ldio-sim-row { display: flex; align-items: center; gap: 6px; padding: 4px; font-size: 12px;\
        border-bottom: 1px solid rgba(255,255,255,0.05); }\
      .ldio-sim-row:last-child { border-bottom: 0; }\
      .ldio-sim-row .ldio-sim-ptr { color: #7aa7d9; flex: 0 0 auto; font: 11px/1.2 Consolas, monospace; }\
      .ldio-sim-row .ldio-sim-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\
      .ldio-sim-row input[type=number] { width: 70px; background: #141414; color: #e8e8e8;\
        border: 1px solid rgba(255,255,255,0.16); border-radius: 4px; padding: 4px 6px; font-size: 12px; }\
      .ldio-sim-row input[type=number]:focus { outline: none; border-color: #3d7ab3; }\
      .ldio-sim-row input.ldio-sim-missing { border-color: #d9c07a; }\
      .ldio-sim-mini { padding: 3px 8px; font-size: 11px; border-radius: 4px; }\
      .ldio-sim-val { flex: 0 0 auto; min-width: 46px; text-align: right;\
        font: 11px/1.2 Consolas, monospace; color: #8fb8e0; }\
      .ldio-sim-val.ldio-sim-defaulted { color: #d9c07a; }\
      .ldio-sim-ctl { display: flex; align-items: center; gap: 6px; margin: 8px 0; font-size: 12px;\
        flex-wrap: wrap; flex: 0 0 auto; }\
      .ldio-sim-spring { flex: 1 1 auto; }\
      .ldio-btn-stop-on { background: #8e2c2c; border-color: #c04b4b; color: #fff; }\
      .ldio-btn-stop-on:hover { background: #a83636; }\
      .ldio-sim-result { overflow: auto; border: 1px solid rgba(255,255,255,0.09); border-radius: 6px;\
        background: #1a1a1a; padding: 7px 8px; font-size: 12px; line-height: 1.5; flex: 1.3 1 130px; min-height: 70px; }\
      .ldio-sim-result .ldio-sim-true { color: #7ad97a; }\
      .ldio-sim-result .ldio-sim-false { color: #ff8a8a; }\
      .ldio-sim-result .ldio-sim-msg { color: #d9c07a; }\
      .ldio-sim-flow { font: 11px/1.5 Consolas, monospace; white-space: pre; color: #bfcbd6;\
        margin-top: 7px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 7px; }\
      .ldio-sim-foot { flex: 0 0 auto; padding: 3px 12px 8px 12px; }\
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
      stopBtnEl: null, // turns red while simulated values are on the canvas
      dimEls: [], replayTimer: null, // flow-visualisation extras
      lastRun: null, // snapshot of the latest run, for Copy log / getSimLog
      // Live-view watcher state: with auto re-run on, the flow stays on the
      // canvas — re-simulated when the canvas changes, repainted if wiped —
      // until ■ Stop is clicked (stopped=true suppresses the repaint).
      lastRunFp: null, prevPollFp: null, watchTimer: null, stopped: false,
    };

    // Cheap change-detector: the exact save() document (structure, data,
    // positions), with the dirty flag preserved across save()'s side effect.
    function simCanvasFingerprint(paper) {
      var wasChanged = paper.changed;
      var doc = paper.save(false);
      paper.changed = wasChanged;
      return JSON.stringify(doc);
    }

    function simWatchTick() {
      var paper = simPaper();
      if (!paper || !simState.panel) return;
      var fp;
      try { fp = simCanvasFingerprint(paper); } catch (e) { return; }
      var autoRun = simState.autoRunEl && simState.autoRunEl.checked;
      if (fp !== simState.lastRunFp) {
        // Canvas changed since the last run — with auto re-run ON,
        // re-simulate once it settles (two equal polls), so a drag doesn't
        // spam reruns mid-move. With it off, the last result stays in the
        // panel but stale values are not repainted onto a changed sketch.
        if (autoRun && fp === simState.prevPollFp) {
          simState.stopped = false;
          simBuildRows();
          simQueueRun();
        }
      } else if (paper.simulation_stack === null && simState.lastRun && simState.lastRun.ok && !simState.stopped) {
        // Same sketch but the overlay was wiped (host cleared it) — repaint
        // REGARDLESS of the auto re-run checkbox: the flow values stay on
        // the canvas until ■ Stop.
        simRunOnce();
      }
      simState.prevPollFp = fp;
    }

    function simPaper() {
      var paper = W.logic_designer && W.logic_designer.paper;
      return (paper && paper.initialized) ? paper : null;
    }

    function simInstallHooks(paper) {
      if (simState.hooked) return;
      simState.hadOwnGUI = Object.prototype.hasOwnProperty.call(paper, 'get_user_input');
      simState.origGUI = paper.get_user_input;
      paper.get_user_input = function (block) {
        var ptr = block && block.pointer;
        var raw = simState.values[ptr];
        var v = parseFloat(raw);
        if (isNaN(v)) { v = 0; if (ptr != null && simState.missing.indexOf(ptr) === -1) simState.missing.push(ptr); }
        this.simulation_stack_block_values[ptr] = v;
        this.simulation_user_values[ptr] = v;
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

    // Reflect "simulated values are on the canvas" on the Stop button (red).
    function simSetActive(active) {
      if (simState.stopBtnEl) simState.stopBtnEl.classList.toggle('ldio-btn-stop-on', !!active);
    }

    // ── Flow visualisation on the canvas ─────────────────────────────
    // Wire colour = the value it carries (host reset animates back to the
    // normal orange, so colours never leak past Stop/clear).
    function simWireColor(v) {
      if (v === undefined) return '#BBBBBB';                    // never evaluated
      if (v === true || v === 'ALARM') return '#1FA31F';        // boolean TRUE
      if (v === false || v === 'FALSE') return '#D64545';       // boolean FALSE
      return '#2C7FB8';                                         // numeric/other
    }

    function simPaintFlow(paper, results) {
      for (var i = 0; i < paper.connections.length; i++) {
        var c = paper.connections[i];
        try {
          c.line.stop(); // kill the host's in-flight highlight animation
          c.line.attr('stroke', simWireColor(results[c.user.source]));
        } catch (e) { /* ignore */ }
      }
    }

    // Dark overlay on blocks the run never evaluated (invalidated IF branch
    // or unreachable) — kept in our own list so we control the cleanup.
    function simClearDims() {
      simState.dimEls.forEach(function (r) { try { r.remove(); } catch (e) { /* ignore */ } });
      simState.dimEls = [];
    }

    function simDimUnreached(paper) {
      simClearDims();
      var completed = {};
      (paper.simulation_completed_blocks || []).forEach(function (id) { completed[id] = 1; });
      Object.keys(paper.elements || {}).forEach(function (key) {
        if (!/^\d+$/.test(key) || completed[key]) return;
        var el = paper.elements[key];
        try {
          var bbox = el.set[el.main.set_id].getBBox(false);
          var r = paper.paper.rect(bbox.x - 2, bbox.y - 2, bbox.width + 4, bbox.height + 4, 4)
            .attr({ fill: '#000', opacity: 0.3, stroke: 'none' });
          simState.dimEls.push(r);
        } catch (e) { /* ignore */ }
      });
    }

    // Replay the LAST run visually: reveal each block's value box in
    // evaluation order and colour its outgoing wires as the signal spreads.
    // Pure playback — nothing is re-simulated.
    function simReplay() {
      var paper = simPaper();
      if (!paper) { toast('Designer not ready.', 'error'); return; }
      var fpNow;
      try { fpNow = simCanvasFingerprint(paper); } catch (e) { return; }
      if (!paper.simulation_stack || fpNow !== simState.lastRunFp || !simState.lastRun || !simState.lastRun.ok) {
        simRunOnce(); // need a fresh, matching run to play back
        if (!paper.simulation_stack || !simState.lastRun || !simState.lastRun.ok) return;
      }
      if (simState.replayTimer) { clearInterval(simState.replayTimer); simState.replayTimer = null; }
      var els = paper.simulation_elements || [];
      var order = simState.lastRun.order || [];
      var results = simState.lastRun.results || {};
      if (!els.length || !order.length) return;
      els.forEach(function (el) { try { el.hide(); } catch (e) { /* ignore */ } });
      for (var i = 0; i < paper.connections.length; i++) {
        try { paper.connections[i].line.stop(); paper.connections[i].line.attr('stroke', '#EEE'); } catch (e) { /* ignore */ }
      }
      var perBlock = Math.max(1, Math.floor(els.length / order.length));
      var idx = 0;
      simState.replayTimer = setInterval(function () {
        if (idx >= order.length) {
          clearInterval(simState.replayTimer);
          simState.replayTimer = null;
          els.forEach(function (el) { try { el.show(); } catch (e) { /* ignore */ } });
          simPaintFlow(paper, results);
          return;
        }
        for (var k = idx * perBlock; k < (idx + 1) * perBlock && k < els.length; k++) {
          try { els[k].show(); } catch (e) { /* ignore */ }
        }
        var id = order[idx];
        for (var w = 0; w < paper.connections.length; w++) {
          var c = paper.connections[w];
          if (c.user && c.user.source === id) {
            try { c.line.stop(); c.line.attr('stroke', simWireColor(results[id])); } catch (e) { /* ignore */ }
          }
        }
        idx++;
      }, 320);
    }

    // Remove sim visuals from the canvas and restore wire colours.
    function simClearCanvas(paper) {
      if (paper.simulation_stopper) { clearTimeout(paper.simulation_stopper); paper.simulation_stopper = null; }
      if (simState.replayTimer) { clearInterval(simState.replayTimer); simState.replayTimer = null; }
      simClearDims();
      paper.__simulation_reset(true);
      paper.simulation_stack = null;
      simSetActive(false);
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
      simState.stopped = false;
      simState.resultEl.textContent = '';
      var blockCount = Object.keys(paper.elements || {}).filter(function (k) { return /^\d+$/.test(k); }).length;
      if (blockCount === 0) {
        simResultLine('Canvas is empty — nothing to simulate.');
        try { simState.lastRunFp = simCanvasFingerprint(paper); } catch (e) { /* ignore */ }
        return;
      }

      var check = paper.syntax_check(true);
      if (!check.ok) {
        simResultLine('Syntax check failed — fix these first:', 'ldio-sim-false');
        (check.errors || []).forEach(function (e) { simResultLine('  ' + e); });
        // Still snapshot the sketch so Copy log can hand the structure +
        // errors to an AI even when nothing could be simulated.
        var wasChanged0 = paper.changed;
        var stack0 = paper.save(false);
        paper.changed = wasChanged0;
        simState.lastRunFp = JSON.stringify(stack0);
        simState.lastRun = {
          ok: false, error: null, syntaxErrors: (check.errors || []).slice(),
          stack: JSON.parse(JSON.stringify(stack0)),
          results: {}, order: [], inputValues: JSON.parse(JSON.stringify(simState.values)),
          missing: [], messages: [],
        };
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
      if (simState.replayTimer) { clearInterval(simState.replayTimer); simState.replayTimer = null; }
      simClearDims();
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
      // Structure snapshot up front, so a failed run can still be logged
      // (Copy log) with the sketch + how far it got.
      var stackCopy = JSON.parse(JSON.stringify(paper.simulation_stack));
      simState.lastRunFp = JSON.stringify(paper.simulation_stack);
      function failRun(errorText) {
        simState.lastRun = {
          ok: false, error: errorText, syntaxErrors: [],
          stack: stackCopy,
          results: JSON.parse(JSON.stringify(paper.simulation_stack_block_values || {})),
          order: (paper.simulation_completed_blocks || []).slice(),
          inputValues: JSON.parse(JSON.stringify(simState.values)),
          missing: simState.missing.slice(),
          messages: simState.msgs.slice(),
        };
      }

      var cap = Math.max(200, paper.simulation_steps * 5);
      var guard = 0;
      try {
        while (paper.simulation_stack && paper.simulation_completed_blocks.length < paper.simulation_steps && guard++ < cap) {
          paper.simulator_step();
        }
      } catch (err) {
        failRun('A block sim crashed: ' + err.message + ' (usually an unconfigured block).');
        simResultLine('FAILED — simulation stopped on a block error: ' + err.message, 'ldio-sim-false');
        simResultLine('(Usually an unconfigured block — configure it and rerun. ⧉ Log has the details.)');
        simState.msgs.forEach(function (m) { simResultLine('⚠ ' + m, 'ldio-sim-msg'); });
        simSetActive(paper.simulation_elements && paper.simulation_elements.length > 0);
        return;
      }
      // The host's simulator_stop() may have fired mid-run (a sim error path
      // nulls simulation_stack) — report instead of touching null state.
      if (!paper.simulation_stack) {
        failRun('The host stopped the simulation mid-run — a block sim reported an error (see MESSAGES).');
        simResultLine('FAILED — the host stopped the simulation mid-run (a block reported an error).', 'ldio-sim-false');
        simState.msgs.forEach(function (m) { simResultLine('⚠ ' + m, 'ldio-sim-msg'); });
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
      // Make the used values visible in the panel after every (re)run:
      // fill empty fields with the value the run actually used, and show a
      // "= value" badge per row (amber when it silently defaulted to 0).
      var inputs = simState.rowsEl.querySelectorAll('input[data-ptr]');
      for (var i = 0; i < inputs.length; i++) {
        var ptr = parseInt(inputs[i].getAttribute('data-ptr'), 10);
        var wasDefaulted = simState.missing.indexOf(ptr) !== -1;
        var used = results[ptr];
        if (inputs[i].value === '' && used !== undefined) {
          inputs[i].value = String(used);
          simState.values[ptr] = inputs[i].value;
        }
        inputs[i].classList.toggle('ldio-sim-missing', wasDefaulted);
        var badge = inputs[i].parentElement.querySelector('.ldio-sim-val');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'ldio-sim-val';
          badge.title = 'Value used in the last run';
          inputs[i].parentElement.appendChild(badge);
        }
        badge.textContent = '= ' + formatSimValue(used);
        badge.classList.toggle('ldio-sim-defaulted', wasDefaulted);
      }

      // Snapshot the run for Copy log, and explain the flow in the panel.
      simState.lastRun = {
        ok: true, error: null, syntaxErrors: [],
        stack: JSON.parse(JSON.stringify(paper.simulation_stack)),
        results: JSON.parse(JSON.stringify(results)),
        order: paper.simulation_completed_blocks.slice(),
        inputValues: JSON.parse(JSON.stringify(simState.values)),
        missing: simState.missing.slice(),
        messages: simState.msgs.slice(),
      };
      var flow = buildSimFlowLines(simState.lastRun.stack, simState.lastRun.results, simState.lastRun.order, simState.lastRun.inputValues);
      var flowEl = document.createElement('div');
      flowEl.className = 'ldio-sim-flow';
      flowEl.textContent = 'Flow — evaluation order:\n' + flow.join('\n');
      simState.resultEl.appendChild(flowEl);
      simPaintFlow(paper, results);
      simDimUnreached(paper);
      simSetActive(true);
    }

    // Full log of the latest run (also exposed as __LDIO.getSimLog()).
    function buildLastSimLog() {
      if (!simState.lastRun) return null;
      var paper = simPaper();
      return buildSimulationLog(simState.lastRun, {
        version: VERSION,
        plantId: (W.query_string && W.query_string.plant_id) || null,
        sketchName: W.application ? W.application.current_sketch_name : null,
        mode: paper ? paper.mode : null,
      });
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
          simState.stopped = false;
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

    function onSimPanelKeydown(e) {
      if (e.key === 'Escape' && simState.panel) {
        e.preventDefault();
        e.stopPropagation();
        closeSimPanel();
      }
    }

    // Every instance closes its own panel/watcher when any instance opens one.
    document.addEventListener('ldio-sim-close-all', function () { closeSimPanel(); });

    function closeSimPanel() {
      if (!simState.panel) return;
      var paper = simPaper();
      if (paper) { simClearCanvas(paper); simRemoveHooks(paper); }
      if (simState.debounce) { clearTimeout(simState.debounce); simState.debounce = null; }
      if (simState.watchTimer) { clearInterval(simState.watchTimer); simState.watchTimer = null; }
      document.removeEventListener('keydown', onSimPanelKeydown, true);
      simState.panel.remove();
      simState.panel = null;
    }

    function openSimPanel() {
      var paper = simPaper();
      if (!paper) { toast('Designer not ready — open/start the application first.', 'error'); return; }
      // Cross-instance close: ask every LDIO instance on the page (incl. a
      // superseded one after a script update) to shut down its own panel AND
      // watcher, then sweep any orphaned panel DOM whose owner is gone.
      document.dispatchEvent(new CustomEvent('ldio-sim-close-all'));
      document.querySelectorAll('.ldio-sim-panel').forEach(function (el) { el.remove(); });
      simInstallHooks(paper);

      var panel = document.createElement('div');
      panel.className = 'ldio-panel ldio-sim-panel';

      var h = document.createElement('h3');
      h.className = 'ldio-sim-head';
      var title = document.createElement('span');
      title.textContent = 'Live simulate';
      title.title = 'Set inputs, watch the flow on the canvas. Drag the header to move; drag the bottom-right corner to resize.';
      var xBtn = document.createElement('button');
      xBtn.type = 'button';
      xBtn.className = 'ldio-sim-x';
      xBtn.textContent = '✕';
      xBtn.title = 'Close (Esc) — restores the canvas';
      xBtn.addEventListener('click', closeSimPanel);
      h.appendChild(title);
      h.appendChild(xBtn);
      panel.appendChild(h);
      // Drag by the header (not from the close button).
      (function () {
        var sx = 0, sy = 0, px = 0, py = 0, dragging = false;
        h.addEventListener('mousedown', function (e) {
          if (e.target === xBtn) return;
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

      var body = document.createElement('div');
      body.className = 'ldio-sim-body';
      panel.appendChild(body);

      var secIn = document.createElement('div');
      secIn.className = 'ldio-sim-sec';
      secIn.textContent = 'Inputs';
      body.appendChild(secIn);

      var rows = document.createElement('div');
      rows.className = 'ldio-sim-rows';
      body.appendChild(rows);

      var ctl = document.createElement('div');
      ctl.className = 'ldio-sim-ctl';
      var runBtn = document.createElement('button');
      runBtn.type = 'button'; runBtn.className = 'ldio-btn ldio-btn-primary';
      runBtn.textContent = '▶ Run';
      runBtn.addEventListener('click', simRunOnce);
      var autoLabel = document.createElement('label');
      autoLabel.title = 'Re-simulate automatically on every value or canvas change. (The painted flow always stays on the canvas until ■ Stop, checked or not.)';
      var autoCb = document.createElement('input');
      autoCb.type = 'checkbox'; autoCb.checked = false; autoCb.style.verticalAlign = 'middle';
      autoLabel.appendChild(autoCb);
      autoLabel.appendChild(document.createTextNode(' auto re-run'));
      var refreshBtn = document.createElement('button');
      refreshBtn.type = 'button'; refreshBtn.className = 'ldio-btn';
      refreshBtn.textContent = '↻';
      refreshBtn.title = 'Rebuild the input list after canvas edits (values are kept per block)';
      refreshBtn.addEventListener('click', simBuildRows);
      var stopBtn = document.createElement('button');
      stopBtn.type = 'button'; stopBtn.className = 'ldio-btn';
      simState.stopBtnEl = stopBtn;
      stopBtn.textContent = '■ Stop';
      stopBtn.title = 'Stop: cancel a pending auto re-run and clear the simulated values from the canvas';
      stopBtn.addEventListener('click', function () {
        simState.stopped = true; // suppress the live-view repaint until Run/next change
        if (simState.debounce) { clearTimeout(simState.debounce); simState.debounce = null; }
        var p2 = simPaper();
        if (p2) simClearCanvas(p2);
        simState.resultEl.textContent = '';
        simResultLine('Stopped — simulated values cleared. Auto re-run resumes on the next change (or ▶ Run).');
      });
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button'; copyBtn.className = 'ldio-btn';
      copyBtn.textContent = '⧉ Log';
      copyBtn.title = 'Copy the full simulation log (inputs, flow, results, blocks, wires) — paste it to an AI to debug/improve the logic';
      copyBtn.addEventListener('click', function () {
        var text = buildLastSimLog();
        if (!text) { toast('Run a simulation first.'); return; }
        if (copyTextToClipboard(text)) toast('Simulation log copied — paste it to your AI.');
        else toast('Could not access the clipboard.', 'error');
      });
      var replayBtn = document.createElement('button');
      replayBtn.type = 'button'; replayBtn.className = 'ldio-btn';
      replayBtn.textContent = '🎬';
      replayBtn.title = 'Replay the last run in slow motion — watch the flow propagate block by block';
      replayBtn.addEventListener('click', simReplay);
      var spring = document.createElement('div');
      spring.className = 'ldio-sim-spring';
      ctl.appendChild(runBtn); ctl.appendChild(stopBtn); ctl.appendChild(replayBtn); ctl.appendChild(autoLabel); ctl.appendChild(spring); ctl.appendChild(copyBtn); ctl.appendChild(refreshBtn);
      body.appendChild(ctl);

      var secOut = document.createElement('div');
      secOut.className = 'ldio-sim-sec';
      secOut.textContent = 'Result';
      body.appendChild(secOut);

      var result = document.createElement('div');
      result.className = 'ldio-sim-result';
      body.appendChild(result);

      var hint = document.createElement('div');
      hint.className = 'ldio-version ldio-sim-foot';
      hint.textContent = 'Client-side only — nothing touches the plant · LDIO v' + VERSION;
      panel.appendChild(hint);

      document.body.appendChild(panel);
      document.addEventListener('keydown', onSimPanelKeydown, true);
      simState.panel = panel;
      simState.rowsEl = rows;
      simState.resultEl = result;
      simState.autoRunEl = autoCb;
      simState.stopped = false;
      simState.prevPollFp = null;
      simState.lastRunFp = null;
      simState.watchTimer = setInterval(simWatchTick, 800);
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
        var itemEl = target.closest('.iw_oc_menu_dropdown_item, .iw_oc_menu_level');
        if (!itemEl) return null;
        var index = itemEl.getAttribute('data-index');
        var item = W.menu_main && W.menu_main.menu_items ? W.menu_main.menu_items[index] : null;
        if (!item) return null;
        if (item.id === 'file_ldio_export' || item.id === 'file_ldio_import' || item.id === 'file_ldio_copy' || item.id === 'file_ldio_sim' || item.id === 'ldio_sim_top') return item.id;
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
      else if (id === 'file_ldio_sim' || id === 'ldio_sim_top') openSimPanel();
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
          // Top-level "Live Simulate" button, right of "Set Process Mode".
          // The host declares top-level entries as add(null, text, id) — our
          // wrap runs after prepare_ui_menu filled this.data, so appending
          // here lands last in the bar (= right of the mode toggle).
          var topPresent = (this.data || []).some(function (l) { return l && l.id === 'ldio_sim_top'; });
          if (!topPresent && (this.data || []).length > 0) this.add(null, 'Live Simulate', 'ldio_sim_top');
        } catch (err) {
          console.error('[' + SCRIPT_NAME + '] menu injection failed:', err);
        }
        return origRender.call(this, clear);
      };

      // Fallback: if the capture handler didn't act (markup change, missed
      // event), the panel path still works from here — it needs no gesture.
      var origOnMenu = W.application.on_menu;
      W.application.on_menu = function (event) {
        if (event && (event.item_id === 'file_ldio_export' || event.item_id === 'file_ldio_import' || event.item_id === 'file_ldio_copy' || event.item_id === 'file_ldio_sim' || event.item_id === 'ldio_sim_top')) {
          if (Date.now() - lastHandledAt > 1000) {
            if (event.item_id === 'file_ldio_export') doExport();
            else if (event.item_id === 'file_ldio_copy') doCopyJson();
            else if (event.item_id === 'file_ldio_sim' || event.item_id === 'ldio_sim_top') openSimPanel();
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
    W.__LDIO = { version: VERSION, doExport: doExport, doCopyJson: doCopyJson, openImportPanel: openImportPanel, applyImport: applyImport, openSimPanel: openSimPanel, simRunOnce: simRunOnce, closeSimPanel: closeSimPanel, getSimLog: buildLastSimLog };
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
    buildSimFlowLines: buildSimFlowLines,
    buildSimulationLog: buildSimulationLog,
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
