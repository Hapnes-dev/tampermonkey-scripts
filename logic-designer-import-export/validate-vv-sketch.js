#!/usr/bin/env node
/*
 * validate-vv-sketch.js — mechanical validator for VV Designer sketch JSON.
 *
 * Validates a file produced for the "Logic Designer Import/Export" userscript
 * (format "vv-fbx-sketch", or a bare {mode, blocks, connections} document)
 * against the host contract of internal.iwmac.local/vv_fbx.qxs.
 *
 * Usage:   node validate-vv-sketch.js <file.json> [more.json …]
 * Exit:    0 = all files pass (warnings allowed), 1 = any file has errors.
 *
 * Every rule here corresponds to a live-verified host behavior — see
 * vv-designer-reference/CLAUDE.md §20 (incl. §20.8/§20.9, two real AI
 * failures this validator would have caught).
 */

'use strict';

// ─── The allowlist: every system block type + its load-critical fields ──
// func/compile_type per §4/§20.4 of the reference doc.
const SYSTEM_BLOCKS = {
  PROCESSIN: { func: 'processin', compile_type: 'reference' },
  CALENDAR: { func: 'calendar_value', compile_type: 'input' },
  CALENDAR_2_0: { func: 'calendar.run', compile_type: 'input' },
  TAGVALUE: { func: 'tagvalue', compile_type: 'input' },
  PARAMV: { func: 'paramv', compile_type: 'input' },
  CONST: { func: 'const', compile_type: 'input' },
  VARIABLE_INPUT: { func: 'variable_input', compile_type: 'input' },
  TOGGLE_INTERVAL: { func: 'toggle_interval.run', compile_type: 'function' },
  CRITERIA: { func: 'criterias.run', compile_type: 'function' },
  COMP_AND: { func: 'comp_and', compile_type: 'function' },
  COMP_OR: { func: 'comp_or', compile_type: 'function' },
  BIGGERTHAN: { func: 'biggerthan', compile_type: 'function' },
  BIGGERTHANOREQUAL: { func: 'biggerthanorequal', compile_type: 'function' },
  SMALLERTHAN: { func: 'smallerthan', compile_type: 'function' },
  SMALLERTHANOREQUAL: { func: 'smallerthanorequal', compile_type: 'function' },
  LIKE: { func: 'like', compile_type: 'function' },
  UNLIKE: { func: 'unlike', compile_type: 'function' },
  MIN: { func: 'comp_min', compile_type: 'function' },
  MIN_IN_PERIOD: { func: 'min_in_period', compile_type: 'function' },
  MAX: { func: 'comp_max', compile_type: 'function' },
  MAX_IN_PERIOD: { func: 'max_in_period', compile_type: 'function' },
  SUM: { func: 'multi_sum', compile_type: 'function' },
  SUM_IN_PERIOD: { func: 'sum_in_period', compile_type: 'function' },
  FORMULA: { func: 'formula', compile_type: 'function' },
  MULTIPLY: { func: 'multiply', compile_type: 'function' },
  DIVIDE: { func: 'divide', compile_type: 'function' },
  ADD: { func: 'add', compile_type: 'function' },
  SUBTRACT: { func: 'subtract', compile_type: 'function' },
  MOD: { func: 'mod', compile_type: 'function' },
  AVERAGE: { func: 'average', compile_type: 'function' },
  AVG_IN_PERIOD: { func: 'avg_in_period', compile_type: 'function' },
  DIFF: { func: 'diff', compile_type: 'function' },
  DELTA_T: { func: 'delta_t', compile_type: 'function' },
  INVERT: { func: 'invert', compile_type: 'function' },
  ABSOLUTE: { func: 'absolute', compile_type: 'function' },
  IF: { func: 'if', compile_type: 'condition' },
  IF_ELSE: { func: 'if_else', compile_type: 'condition' },
  PERIODE_VALUE: { func: 'counter_limit.run', compile_type: 'function' },
  CORRELATION: { func: 'correlation', compile_type: 'function' },
  PULSE_COUNT: { func: 'pulse_count', compile_type: 'function' },
  AVERAGE_PERIODE: { func: 'average_periode.run', compile_type: 'function' },
  IS_WITHIN_DATES: { func: 'is_within_dates', compile_type: 'function' },
  SELECTOR: { func: 'selector', compile_type: 'function' },
  INPUT_SELECTOR: { func: 'selector_ex.run', compile_type: 'function' },
  DELAY: { func: 'alarm_multi_delay', compile_type: 'function' },
  DELAY_VARIABLE: { func: 'alarm_multi_delay', compile_type: 'function' },
  AGE_OF_VALUE: { func: 'age_of_value', compile_type: 'function' },
  TIME_SINCE_VALUE_LIMIT: { func: 'time_since_value_limit.run', compile_type: 'function' },
  WEATHER: { func: 'weather.run_by_ccp_country', compile_type: 'function' },
  WEATHER_SUN: { func: 'weather_sun.run_by_place', compile_type: 'function' },
  SPOT_PRICE: { func: 'spotprice.run', compile_type: 'function' },
  SPOT_PRICE_NUM_HOURS: { func: 'spotprice.run_get_num_hours', compile_type: 'function' },
  SPOT_PRICE_ANALYSER: { func: 'spotprice.run_analyse', compile_type: 'function' },
  SPOT_PRICE_LOW: { func: 'spotprice.run_is_low_price', compile_type: 'function' },
  SPOT_PRICE_HIGH: { func: 'spotprice.run_is_high_price', compile_type: 'function' },
  RESET_INPUT: { func: 'reset_input.run', compile_type: 'function' },
  PID_CONTROLLER: { func: 'pid_controller.run', compile_type: 'function' },
  LATCH: { func: 'latch.run', compile_type: 'function' },
  DATE_TIME: { func: 'vv_datetime.run', compile_type: 'function' },
  HOURMETER: { func: 'hourmeter.run', compile_type: 'function' },
  OPTIMAL_START_STOP: { func: 'optimal_start_stop.run', compile_type: 'function' },
  SHIFT_REGISTER: { func: 'iw_shift_register.run', compile_type: 'function' },
  ALARM: { func: 'alarm', compile_type: 'output' },
  ALARM_OBJECT: { func: 'alarm_object', compile_type: 'output' },
  ALARM_OBJECT_EXTENDED: { func: 'alarm_object_extended', compile_type: 'output' },
  WRITETOUNIT: { func: 'set_unit_value', compile_type: 'function' },
  VIRTUALOUT: { func: 'virtualout', compile_type: 'output' },
  TEMP_VALUE: { func: 'tmp_value', compile_type: 'output' },
  PROCESSOUT: { func: 'processout', compile_type: 'reference' },
  VARIABLE_OUTPUT: { func: 'variable_output', compile_type: 'output' },
  TRANSFORM_MAPPED: { func: 'transform_mapped.run', compile_type: 'function' },
};

// Wrong names other AIs have actually invented (or predictably will) → real type.
const TYPE_ALIASES = {
  EQUAL: 'LIKE', EQUALS: 'LIKE', EQ: 'LIKE', COMPARE_EQUAL: 'LIKE',
  NOTEQUAL: 'UNLIKE', NOT_EQUAL: 'UNLIKE', NEQ: 'UNLIKE',
  GREATERTHAN: 'BIGGERTHAN', GREATER_THAN: 'BIGGERTHAN', GT: 'BIGGERTHAN',
  LESSTHAN: 'SMALLERTHAN', LESS_THAN: 'SMALLERTHAN', LT: 'SMALLERTHAN',
  AND: 'COMP_AND', OR: 'COMP_OR', NOT: 'INVERT', XOR: 'COMP_OR',
  CONSTANT: 'CONST', PARAM: 'PARAMV', PARAMETER: 'PARAMV', READ: 'PARAMV',
  DIGITAL_INPUT: 'PARAMV', ANALOG_INPUT: 'PARAMV', INPUT: 'PARAMV', SENSOR: 'PARAMV',
  WRITEOUTUNIT: 'WRITETOUNIT', WRITE_TO_UNIT: 'WRITETOUNIT', WRITEUNIT: 'WRITETOUNIT',
  WRITE: 'WRITETOUNIT', WRITEPULSE: 'WRITETOUNIT',
  DIGITAL_OUTPUT: 'WRITETOUNIT', ANALOG_OUTPUT: 'WRITETOUNIT',
  DELAY_VAR: 'DELAY_VARIABLE', VARIABLE_DELAY: 'DELAY_VARIABLE',
  TIMER: 'DELAY_VARIABLE', COUNTER: 'PULSE_COUNT',
  SR_LATCH: 'LATCH', SET_RESET: 'LATCH',
  ALARM_OBJ: 'ALARM_OBJECT', VIRTUAL_OUT: 'VIRTUALOUT', VIRTUAL_OUTPUT: 'VIRTUALOUT',
  TAG: 'TAGVALUE', TAG_VALUE: 'TAGVALUE',
};

// Concepts with NO VV block at all — the graph must be composed differently.
const NO_EQUIVALENT = {
  RISING_EDGE: 'VV has no standalone edge-detect block, but PULSE_COUNT has a rising-edge COUNT MODE: data {"block_func_args":{"periode":"day","type":"flank_rising_edge","periode_amount":1}} (types: over_or_equal_value|absolute_value|flank_rising_edge|flank_falling_edge|flank_changing_edge). Wire the signal to put 0 and a CONST level to put 1.',
  FALLING_EDGE: 'no standalone block — use PULSE_COUNT with block_func_args.type "flank_falling_edge" (see RISING_EDGE guidance).',
  EDGE: 'no standalone block — use PULSE_COUNT with block_func_args.type "flank_changing_edge" (see RISING_EDGE guidance).',
  EDGE_DETECT: 'no standalone block — see RISING_EDGE guidance (PULSE_COUNT flank_* count modes).',
  TOGGLE: 'VV has no toggle/flip-flop block. Verified composition: PULSE_COUNT (type "flank_rising_edge") → MOD ← CONST(2) flips 0/1 per rising edge (count resets each configured period). Set/reset memory = LATCH; time-based toggling = TOGGLE_INTERVAL.',
  FLIPFLOP: 'VV has no flip-flop block — see TOGGLE guidance (set/reset memory = LATCH).',
  FLIP_FLOP: 'VV has no flip-flop block — see TOGGLE guidance (set/reset memory = LATCH).',
  PULSE: 'no PULSE block — counting pulses/edges = PULSE_COUNT (flank_* modes); generating a timed pulse = TOGGLE_INTERVAL.',
};

// Blocks whose non-null data must carry block_func_args (period-family).
const NEEDS_BLOCK_FUNC_ARGS = ['PULSE_COUNT', 'PERIODE_VALUE', 'CORRELATION', 'AVG_IN_PERIOD', 'MIN_IN_PERIOD', 'MAX_IN_PERIOD', 'SUM_IN_PERIOD'];

// Minimum REQUIRED input pins per common block (optional pins excluded).
const REQUIRED_INPUTS = {
  COMP_AND: 2, COMP_OR: 2, BIGGERTHAN: 2, BIGGERTHANOREQUAL: 2, SMALLERTHAN: 2,
  SMALLERTHANOREQUAL: 2, LIKE: 2, UNLIKE: 2, MIN: 2, MAX: 2, AVERAGE: 2,
  MULTIPLY: 2, DIVIDE: 2, ADD: 2, SUBTRACT: 2, MOD: 2, DIFF: 2,
  INVERT: 1, ABSOLUTE: 1, IF: 2, IF_ELSE: 3, SELECTOR: 3,
  PULSE_COUNT: 2, DELAY_VARIABLE: 2, DELAY: 1, AGE_OF_VALUE: 1, LATCH: 2,
  ALARM: 1, ALARM_OBJECT: 2, VIRTUALOUT: 1, WRITETOUNIT: 1, TEMP_VALUE: 1,
  TRANSFORM_MAPPED: 1,
};

// Keys that signal an invented schema (each with the correct move).
const FORBIDDEN_TOPLEVEL = {
  schema: 'use "format": "vv-fbx-sketch" — there is no "schema" key',
  logic: 'there is no logic/steps model — express as sketch.blocks + sketch.connections',
  steps: 'there is no steps model — every operation is a block',
  parameterBindings: 'bindings live INSIDE each PARAMV/WRITETOUNIT block as data.driver_ids',
  inputs: 'user-tweakable values are CONST blocks, not an inputs[] array',
  outputs: 'results are VIRTUALOUT/ALARM blocks, not an outputs[] array',
};
const FORBIDDEN_BLOCK_KEYS = {
  blockType: 'the key is "type"',
  label: 'canvas label goes in override.alias_text',
  name: 'canvas label goes in override.alias_text',
  config: 'not a save-format field — the payload lives in "data"; expandable pin counts live in properties.input_count',
  expression: 'there is no expression language — wire comparator/logic blocks instead',
  severity: 'alarm severity is data.pri ("a"|"b"|"c") on an ALARM block',
  message: 'alarm text is data.alias_text on the ALARM block',
};
const FORBIDDEN_DATA_KEYS = {
  address: 'no "address" field — bind via data.driver_ids with a FULL parameter driver id (e.g. "5440_AK3_AKC_0_1_0_0_2576"); a unit id like "000:001" is a UNIT, not a parameter',
  reset_interval: 'no such field — period blocks are configured via block_func_args {"periode":"sec|min|hour|day|week|month|year","type":…,"periode_amount":N}; the count resets each configured period (there is no "never")',
  driverId: 'use driver_ids (snake_case, ARRAY): {"driver_ids":["<id>"]}',
  driverIdNo: 'not part of block data — drop it',
  elementId: 'not part of block data — drop it',
  paramLabel: 'not part of block data — put label in override.alias_text',
  paramType: 'not part of block data — drop it',
  access: 'not part of block data — drop it',
  rangeMin: 'not part of block data — drop it',
  rangeMax: 'not part of block data — drop it',
  value: 'CONST value is "initial_value"',
  valueType: 'CONST type is "type" ("integer"|"float"|"boolean"|"string")',
  priority: 'alarm priority is "pri" ("a"|"b"|"c")',
  message: 'alarm text is "alias_text"',
  writeValue: 'no such field — WRITETOUNIT writes the value arriving on its input pin',
  resetValue: 'no such field (see RESET_INPUT block for reset semantics)',
  durationMs: 'no such field — persistence is a DELAY_VARIABLE block with a CONST seconds input',
};

function validateSketchDocument(doc, report) {
  const err = report.error, warn = report.warn;

  if (typeof doc.mode !== 'string') {
    err('sketch.mode is REQUIRED and must be "function" or "process" (importer rejects the file without it)');
  } else if (doc.mode !== 'function' && doc.mode !== 'process') {
    err(`sketch.mode "${doc.mode}" invalid — must be "function" or "process"`);
  }
  if (!Array.isArray(doc.blocks)) { err('sketch.blocks must be an array'); return; }
  if (!Array.isArray(doc.connections)) { err('sketch.connections must be an array'); return; }
  if (doc.blocks.length === 0) warn('sketch has no blocks');
  if (!('require_plant_revision' in doc)) warn('sketch.require_plant_revision missing — set it (0 is a safe default)');
  if (!('groups' in doc)) warn('sketch.groups missing — add "groups": []');

  // ── blocks ──
  const ids = new Map(); // id -> block
  doc.blocks.forEach((b, i) => {
    const at = `blocks[${i}]`;
    if (!b || typeof b !== 'object') { err(`${at} is not an object`); return; }

    for (const k of Object.keys(FORBIDDEN_BLOCK_KEYS)) {
      if (k in b) err(`${at}.${k} is not a real field — ${FORBIDDEN_BLOCK_KEYS[k]}`);
    }

    if (!Number.isInteger(b.id)) {
      err(`${at}.id must be an INTEGER (got ${JSON.stringify(b.id)}) — host block ids are numeric`);
    } else if (ids.has(b.id)) {
      err(`${at}.id ${b.id} is duplicated`);
    } else {
      ids.set(b.id, b);
    }

    if (typeof b.type !== 'string') {
      err(`${at}.type missing/not a string`);
    } else if (!(b.type in SYSTEM_BLOCKS)) {
      if (b.type in TYPE_ALIASES) {
        err(`${at}.type "${b.type}" is NOT a real block type — use "${TYPE_ALIASES[b.type]}"`);
      } else if (b.type in NO_EQUIVALENT) {
        err(`${at}.type "${b.type}" is NOT a real block type and has no direct equivalent — ${NO_EQUIVALENT[b.type]}`);
      } else if (/^[a-z]/.test(b.type)) {
        err(`${at}.type "${b.type}" — block types are UPPERCASE palette keys (see the reference §4/§20.4)`);
      } else {
        warn(`${at}.type "${b.type}" is not a system block — only valid if it is a published process key in the target plant's library; the importer will warn`);
      }
    } else {
      const def = SYSTEM_BLOCKS[b.type];
      if (b.func === undefined) {
        err(`${at} (${b.type}) missing "func" — must be "${def.func}" (paper.load applies it verbatim; omitting breaks compile)`);
      } else if (b.func !== def.func && !(b.type === 'IS_WITHIN_DATES' && b.func === 'is_within_date')) {
        err(`${at} (${b.type}) func "${b.func}" wrong — must be "${def.func}"`);
      }
      if (b.compile_type !== undefined && b.compile_type !== def.compile_type && def.compile_type !== null) {
        warn(`${at} (${b.type}) compile_type "${b.compile_type}" — expected "${def.compile_type}"`);
      }
    }

    if (typeof b.x !== 'number' || typeof b.y !== 'number') err(`${at} needs numeric x/y canvas coordinates`);
    if (!('override' in b)) warn(`${at} missing "override" — use {} or {"alias_text":"…"}`);
    if (!('properties' in b)) warn(`${at} missing "properties" — use {}`);
    if (!('runtime' in b)) warn(`${at} missing "runtime" — use {}`);

    // per-type data checks
    const d = b.data;
    if (d && typeof d === 'object') {
      for (const k of Object.keys(FORBIDDEN_DATA_KEYS)) {
        if (k in d) err(`${at}.data.${k} is not a real field — ${FORBIDDEN_DATA_KEYS[k]}`);
      }
      if (b.type === 'PARAMV' || b.type === 'WRITETOUNIT') {
        if (!('driver_ids' in d) && !('driver_id' in d)) {
          err(`${at} (${b.type}).data needs driver_ids: ["<PLANT>_<DRIVER>_…"] (or leave data null to bind after import)`);
        } else if ('driver_ids' in d && !Array.isArray(d.driver_ids)) {
          err(`${at} (${b.type}).data.driver_ids must be an ARRAY of strings`);
        }
        if (b.type === 'WRITETOUNIT') warn(`${at} WRITETOUNIT writes to REAL hardware when deployed — confirm this is intended`);
      }
      if (b.type === 'CONST') {
        if (!('initial_value' in d)) err(`${at} (CONST).data needs "initial_value"`);
        if (!('type' in d)) err(`${at} (CONST).data needs "type" ("integer"|"float"|"boolean"|"string")`);
        else if (!['integer', 'float', 'boolean', 'string'].includes(d.type)) err(`${at} (CONST).data.type "${d.type}" invalid`);
        if (!('mode' in d)) warn(`${at} (CONST).data missing "mode" — use "single"`);
      }
      if (b.type === 'ALARM' || b.type === 'ALARM_OBJECT' || b.type === 'ALARM_OBJECT_EXTENDED') {
        if (!d.pri) err(`${at} (${b.type}).data needs "pri" ("a"|"b"|"c")`);
        else if (!['a', 'b', 'c'].includes(String(d.pri).toLowerCase())) err(`${at} (${b.type}).data.pri "${d.pri}" invalid — only "a", "b" or "c" exist`);
        if (!d.alarm_type) err(`${at} (${b.type}).data needs "alarm_type" ("general"|"system")`);
        if (!d.alarm_destination) err(`${at} (${b.type}).data needs "alarm_destination" ("general"|"ew"|"cw")`);
        if (!d.alias_text) warn(`${at} (${b.type}).data.alias_text (the alarm text) is empty`);
      }
      if (b.type === 'FORMULA' && d.formula) {
        const m = String(d.formula).match(/\binp(\d+)\b/g);
        if (!m) warn(`${at} (FORMULA) formula references no inp0…inpN-1 inputs`);
      }
      if (NEEDS_BLOCK_FUNC_ARGS.includes(b.type) && !('block_func_args' in d)) {
        err(`${at} (${b.type}).data must be {"block_func_args":{…}} — e.g. PULSE_COUNT: {"block_func_args":{"periode":"day","type":"flank_rising_edge","periode_amount":1}}`);
      }
    } else if (d == null) {
      const needsCfg = ['PARAMV', 'TAGVALUE', 'CALENDAR', 'CALENDAR_2_0', 'CONST', 'ALARM', 'ALARM_OBJECT', 'ALARM_OBJECT_EXTENDED', 'WRITETOUNIT', 'VIRTUALOUT', 'FORMULA', 'SELECTOR', 'PULSE_COUNT', 'PERIODE_VALUE', 'CORRELATION', 'AVG_IN_PERIOD', 'MIN_IN_PERIOD', 'MAX_IN_PERIOD', 'SUM_IN_PERIOD'];
      if (needsCfg.includes(b.type)) warn(`${at} (${b.type}) data is null — imports UNCONFIGURED (red); fine only if the user is meant to bind it after import`);
    }
  });

  // ── connections ──
  const wiredInputs = new Set();
  doc.connections.forEach((c, i) => {
    const at = `connections[${i}]`;
    if (!c || typeof c !== 'object') { err(`${at} is not an object`); return; }
    if ('from' in c || 'to' in c) {
      err(`${at} uses from/to — the host contract is {"source":{"id":<int>,"put":<int>},"target":{"id":<int>,"put":<int>}}`);
      return;
    }
    for (const side of ['source', 'target']) {
      const s = c[side];
      if (!s || typeof s !== 'object') { err(`${at}.${side} missing`); continue; }
      if ('block' in s || 'pin' in s) err(`${at}.${side} uses block/pin — use numeric "id" and "put"`);
      if (!Number.isInteger(s.id)) err(`${at}.${side}.id must be an integer block id (got ${JSON.stringify(s.id)})`);
      else if (!ids.has(s.id)) err(`${at}.${side}.id ${s.id} does not exist in blocks[]`);
      if (!Number.isInteger(s.put) || s.put < 0) err(`${at}.${side}.put must be a 0-based integer pin index (got ${JSON.stringify(s.put)})`);
    }
    if (c.target && Number.isInteger(c.target.id) && Number.isInteger(c.target.put)) {
      const key = c.target.id + ':' + c.target.put;
      if (wiredInputs.has(key)) err(`${at} target input ${key} already has a wire — each INPUT pin takes exactly one`);
      wiredInputs.add(key);
    }
  });

  // ── every required input pin wired? + special pin constraints ──
  for (const [id, b] of ids) {
    const need = REQUIRED_INPUTS[b.type];
    if (need === undefined) continue;
    for (let putIdx = 0; putIdx < need; putIdx++) {
      if (!wiredInputs.has(id + ':' + putIdx)) {
        err(`block ${id} (${b.type}) input pin ${putIdx} is not wired — syntax check will fail ("INPUT ${putIdx} is not connected")`);
      }
    }
    if (b.type === 'PULSE_COUNT') {
      const feeder = doc.connections.find((c) => c.target && c.target.id === id && c.target.put === 1);
      if (feeder && Number.isInteger(feeder.source && feeder.source.id)) {
        const src = ids.get(feeder.source.id);
        if (src && src.type !== 'CONST' && src.type !== 'PROCESSIN') {
          err(`block ${id} (PULSE_COUNT) input 1 "Logic True Level" REQUIRES a CONST (or PROCESSIN) source — got ${src.type}`);
        }
      }
    }
  }
}

function validateFile(path) {
  const errors = [], warnings = [];
  const report = { error: (m) => errors.push(m), warn: (m) => warnings.push(m) };
  let raw;
  try { raw = require('fs').readFileSync(path, 'utf8'); }
  catch (e) { errors.push('cannot read file: ' + e.message); return { errors, warnings }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { errors.push('not valid JSON: ' + e.message); return { errors, warnings }; }

  if (!parsed || typeof parsed !== 'object') { errors.push('top level is not an object'); return { errors, warnings }; }

  for (const k of Object.keys(FORBIDDEN_TOPLEVEL)) {
    if (k in parsed) report.error(`top-level "${k}" is an invented key — ${FORBIDDEN_TOPLEVEL[k]}`);
  }
  const sk = parsed.sketch;
  if (sk && typeof sk === 'object') {
    for (const k of Object.keys(FORBIDDEN_TOPLEVEL)) {
      if (k in sk && k !== 'inputs' && k !== 'outputs') report.error(`sketch.${k} is an invented key — ${FORBIDDEN_TOPLEVEL[k]}`);
    }
  }

  let doc = null;
  if (parsed.format === 'vv-fbx-sketch' && parsed.sketch) {
    doc = parsed.sketch;
    if (parsed.block_count !== undefined && Array.isArray(doc.blocks) && parsed.block_count !== doc.blocks.length)
      report.warn(`envelope block_count ${parsed.block_count} ≠ actual ${doc.blocks.length}`);
    if (parsed.connection_count !== undefined && Array.isArray(doc.connections) && parsed.connection_count !== doc.connections.length)
      report.warn(`envelope connection_count ${parsed.connection_count} ≠ actual ${doc.connections.length}`);
  } else if (Array.isArray(parsed.blocks) && Array.isArray(parsed.connections)) {
    doc = parsed; // bare document
  } else {
    report.error('unrecognized top level — must be {"format":"vv-fbx-sketch","sketch":{…}} or a bare {"mode","blocks","connections"} document' +
      (parsed.format ? ` (format is "${parsed.format}")` : ' (no "format" key)'));
    return { errors, warnings };
  }

  validateSketchDocument(doc, report);
  return { errors, warnings };
}

// ─── CLI ─────────────────────────────────────────────────────────────
if (require.main === module) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log('Usage: node validate-vv-sketch.js <sketch.json> [more.json …]');
    process.exit(2);
  }
  let anyErrors = false;
  for (const f of files) {
    const { errors, warnings } = validateFile(f);
    console.log('\n=== ' + f + ' ===');
    if (errors.length === 0 && warnings.length === 0) console.log('PASS — no issues.');
    else {
      errors.forEach((e, i) => console.log(`  ERROR ${i + 1}: ${e}`));
      warnings.forEach((w, i) => console.log(`  warn  ${i + 1}: ${w}`));
      console.log(errors.length ? `  RESULT: FAIL (${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'})`
        : `  RESULT: PASS with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
    }
    if (errors.length) anyErrors = true;
  }
  process.exit(anyErrors ? 1 : 0);
}

module.exports = { validateFile, SYSTEM_BLOCKS, TYPE_ALIASES, NO_EQUIVALENT };
