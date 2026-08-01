#!/usr/bin/env node
// Audit the vv-designer-reference documentation claims against a scraped
// production corpus. Every check encodes an invariant stated in
// vv-designer-reference/CLAUDE.md (section references in each check).
//
// Usage:  node audit-docs-vs-corpus.js <corpus-dir>
// The corpus dir holds sketch docs named  p<plant>_s<sketch>.json  with shape
// {plant_id, project, sketch_id, name, state, compile_state, sketch:{mode,
//  require_plant_revision, blocks, connections, groups}} — the shape the
// cross-plant scrape (reference CLAUDE.md §17.1) produces. Raw corpora stay
// OUT of the repo; point this at your local scrape directory.
//
// Exit 0 = every documented claim holds; exit 1 = a claim is violated
// (fix the docs or the validator — the fleet is the ground truth).
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.argv[2];
if (!DIR || !fs.existsSync(DIR)) {
  console.error('usage: node audit-docs-vs-corpus.js <corpus-dir>');
  process.exit(2);
}

const files = fs.readdirSync(DIR).filter((f) => /^[px]\d+_s\d+\.json$/.test(f));
const claims = [];
const claim = (name, ref) => {
  // `evals` makes the vacuity probe part of the tool rather than a separate script:
  // a claim whose predicate never fires passes trivially, and a 0 here is the tell.
  const c = { name, ref, violations: 0, evals: 0, samples: [] };
  claims.push(c);
  return (cond, sample) => {
    c.evals++;
    if (!cond) {
      c.violations++;
      if (c.samples.length < 3) c.samples.push(sample);
    }
  };
};

const cAlarmPri = claim('ALARM pri is only a/b/c', '§6 ALARM');
const cAlarmDest = claim('ALARM destination is only general/ew/cw', '§6 ALARM');
const cToggle = claim('TOGGLE_INTERVAL bfa keys are exactly {interval, offset}', '§6 TOGGLE_INTERVAL');
const cToggleUnit = claim('TOGGLE_INTERVAL interval unit is sec|min|hour|day|week|month|year', '§6');
const cSelector = claim('SELECTOR data keys are within {output_type}', '§6 SELECTOR');
const cConstMode = claim('CONST mode is single/repeat/absent', '§6 CONST');
const cWtuCount = claim('WRITETOUNIT count is 1 (or a small int; never a string)', '§6/§21 v6');
const cShift = claim('SHIFT_REGISTER mode is "0"|"1"', '§6 SHIFT_REGISTER');
const cDelayVar = claim('DELAY_VARIABLE data is null', '§6 DELAY_VARIABLE');
const cAvgKey = claim('AVG_IN_PERIOD uses key "period" (not "periode")', '§6 AVG_IN_PERIOD');
const cPvKey = claim('PERIODE_VALUE uses key "periode" (not "period")', '§6 PERIODE_VALUE');
const cOneWire = claim('each input pin has at most one wire', '§2/§20.0');
const cSelfLoop = claim('no self-loop wires', '§21 v8 hard invariants');
const cIntIds = claim('block ids are integers', '§8');
const cCoordinates = claim('x/y are finite numbers (negative values are production-valid)', '§21 v16 correction');
const cByRefTarget = claim('by_refference sits on the target endpoint only', '§8');
const cFormulaIC = claim('FORMULA input_count (when set) equals wired inputs', '§21 v7 / validator');
const cPulseConst = claim('PULSE_COUNT input 1 is fed by CONST/PROCESSIN', '§20.4');
const cMode = claim('project sketches are mode "function"', '§9/§21 v5');
const cGroupShape = claim('non-empty groups carry {id, blocks[], alias_text, open, box}', '§8');
const cAcyclic = claim('connection graph is acyclic', '§3.3 / §21 v18');
const cEndpointBlocks = claim('every wire endpoint resolves to a block in the same sketch', '§3.3');
const cPutNumbers = claim('connection put values are JS numbers', '§3.3');
const cConnectionKeys = claim('connection objects carry only source/target/alias_text', '§3.3');
const cEndpointKeys = claim('wire endpoints carry only id/put (+ by_refference on target)', '§3.3');
const cVariadicIC = claim('input_count (when set) equals wired inputs on every variadic type, in compiling sketches', '§21 v18');
const cInputCountShape = claim('properties.input_count is always the {alias_text,value} object form, never a bare number', '§21 v18');
const cOutputNotSource = claim('WRITETOUNIT / VIRTUALOUT / ALARM are never a wire source', '§21 v18');
const cInputNotTarget = claim('CONST / PARAMV / CALENDAR / TAGVALUE / CALENDAR_2_0 / CRITERIA are never a wire target', '§21 v18');
const cByRefFunction = claim('by_refference targets are function-compile_type blocks only', '§21 v18');
const cPropsShape = claim('properties is an array, an object, or absent — never another type', '§8.1 / §21 v19');
const cPropsEmptyArray = claim('an array-shaped properties is always EMPTY; an object-shaped one is always non-empty', '§8.1 / §21 v19');
const cPropsEnvelope = claim('every properties value is the {alias_text, value} object envelope', '§8.1 / §21 v19');
const cRprFloor = claim('sketch require_plant_revision equals max(block required_plant_revision) where any block declares one', '§20.5 / §21 v19');

for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const sk = doc.sketch;
  if (!sk || !Array.isArray(sk.blocks)) continue;
  const at = f;
  cMode(sk.mode === 'function', at + ' mode=' + sk.mode);
  const byId = new Map();
  for (const b of sk.blocks) byId.set(b.id, b);
  // NOTE the two spellings: the sketch key is `require_plant_revision`,
  // the block key is `requirED_plant_revision`.
  let maxBlockRpr = null;

  for (const b of sk.blocks) {
    const d = b.data;
    cIntIds(Number.isInteger(b.id), at + ' id=' + JSON.stringify(b.id));
    cCoordinates(Number.isFinite(b.x) && Number.isFinite(b.y), at + ' #' + b.id + ' x=' + JSON.stringify(b.x) + ' y=' + JSON.stringify(b.y));
    if (b.properties !== undefined) {
      const isArray = Array.isArray(b.properties);
      const isObject = b.properties !== null && typeof b.properties === 'object' && !isArray;
      cPropsShape(isArray || isObject, at + ' #' + b.id + ' properties=' + JSON.stringify(b.properties).slice(0, 40));
      // The two shapes carry disjoint meaning: `[]` is "unset", `{…}` is "set".
      // A non-empty array or an empty object would break that reading.
      if (isArray) cPropsEmptyArray(b.properties.length === 0, at + ' #' + b.id + ' non-empty array');
      if (isObject) {
        const keys = Object.keys(b.properties);
        cPropsEmptyArray(keys.length > 0, at + ' #' + b.id + ' empty object');
        for (const k of keys) {
          const v = b.properties[k];
          // Exactly {alias_text, value} — a permissive `'value' in v` would pass
          // {alias_text, value, extra}, which the corpus never produces.
          const vKeys = v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().join(',') : null;
          cPropsEnvelope(vKeys === 'alias_text,value', at + ' #' + b.id + ' ' + k + '=' + JSON.stringify(v).slice(0, 40));
        }
      }
    }
    if (typeof b.required_plant_revision === 'number' &&
      (maxBlockRpr === null || b.required_plant_revision > maxBlockRpr)) {
      maxBlockRpr = b.required_plant_revision;
    }
    if ((b.type === 'ALARM' || b.type === 'ALARM_OBJECT' || b.type === 'ALARM_OBJECT_EXTENDED') && d) {
      if (d.pri !== undefined) cAlarmPri(['a', 'b', 'c'].includes(String(d.pri).toLowerCase()), at + ' pri=' + d.pri);
      if (d.alarm_destination !== undefined) cAlarmDest(['general', 'ew', 'cw'].includes(String(d.alarm_destination)), at + ' dest=' + d.alarm_destination);
    }
    if (b.type === 'TOGGLE_INTERVAL' && d && d.block_func_args) {
      const keys = Object.keys(d.block_func_args).sort().join(',');
      cToggle(keys === 'interval,offset', at + ' keys=' + keys);
      cToggleUnit(['sec', 'min', 'hour', 'day', 'week', 'month', 'year'].includes(d.block_func_args.interval), at + ' unit=' + d.block_func_args.interval);
    }
    if (b.type === 'SELECTOR' && d && typeof d === 'object') {
      cSelector(Object.keys(d).every((k) => k === 'output_type'), at + ' keys=' + Object.keys(d).join(','));
    }
    if (b.type === 'CONST' && d && d.mode !== undefined) {
      cConstMode(['single', 'repeat'].includes(String(d.mode)), at + ' mode=' + d.mode);
    }
    if (b.type === 'WRITETOUNIT' && d && d.count !== undefined) {
      cWtuCount(Number.isInteger(d.count) && d.count >= 1 && d.count <= 50, at + ' count=' + JSON.stringify(d.count));
    }
    if (b.type === 'SHIFT_REGISTER' && d && d.mode !== undefined) {
      cShift(d.mode === '0' || d.mode === '1' || d.mode === 0 || d.mode === 1, at + ' mode=' + JSON.stringify(d.mode));
    }
    if (b.type === 'DELAY_VARIABLE') cDelayVar(d == null, at + ' data=' + JSON.stringify(d).slice(0, 40));
    if (b.type === 'AVG_IN_PERIOD' && d && d.block_func_args) {
      cAvgKey(!('periode' in d.block_func_args), at);
    }
    if (b.type === 'PERIODE_VALUE' && d && d.block_func_args) {
      cPvKey(!('period' in d.block_func_args) || 'periode' in d.block_func_args, at);
    }
    if (b.type === 'FORMULA' && b.properties && !Array.isArray(b.properties) &&
      b.properties.input_count && b.properties.input_count.value !== undefined) {
      const declared = parseInt(b.properties.input_count.value, 10);
      const wired = sk.connections.filter((c) => c.target && c.target.id === b.id).length;
      if (Number.isInteger(declared)) cFormulaIC(declared === wired, at + ' #' + b.id + ' ' + declared + ' vs ' + wired);
    }
    const inputCount = b.properties && !Array.isArray(b.properties) ? b.properties.input_count : undefined;
    if (inputCount !== undefined) {
      cInputCountShape(inputCount !== null && typeof inputCount === 'object' && !Array.isArray(inputCount) &&
        'alias_text' in inputCount && 'value' in inputCount, at + ' #' + b.id + ' input_count=' + JSON.stringify(inputCount));
      // Non-compiling WIP sketches can retain stale input_count values, so this
      // fleet law deliberately applies only to sketches that compile.
      if (doc.compile_state === '1') {
        const declared = parseInt(inputCount && inputCount.value, 10);
        const wired = new Set(sk.connections.filter((c) => c.target && c.target.id === b.id)
          .map((c) => c.target.put)).size;
        cVariadicIC(Number.isInteger(declared) && declared === wired, at + ' #' + b.id + ' ' + declared + ' vs ' + wired);
      }
    }
    if (b.type === 'PULSE_COUNT') {
      const feeder = sk.connections.find((c) => c.target && c.target.id === b.id && c.target.put === 1);
      if (feeder && byId.has(feeder.source.id)) {
        const src = byId.get(feeder.source.id);
        cPulseConst(src.type === 'CONST' || src.type === 'PROCESSIN', at + ' src=' + src.type);
      }
    }
  }

  // Gate on the BLOCK side only. Gating on the sketch value being numeric too
  // would let a revision-bearing sketch with a missing/string stamp skip the
  // check silently while other sketches keep the claim non-vacuous.
  if (maxBlockRpr !== null) {
    cRprFloor(sk.require_plant_revision === maxBlockRpr,
      at + ' sketch=' + JSON.stringify(sk.require_plant_revision) + ' maxBlock=' + maxBlockRpr);
  }

  const seen = new Set();
  for (const c of sk.connections) {
    const connectionKeys = c && typeof c === 'object' ? Object.keys(c) : [];
    cConnectionKeys(c && typeof c === 'object' && connectionKeys.every((k) => ['source', 'target', 'alias_text'].includes(k)),
      at + ' keys=' + connectionKeys.join(','));
    cEndpointBlocks(Boolean(c && c.source && c.target && byId.has(c.source.id) && byId.has(c.target.id)),
      at + ' source=' + JSON.stringify(c && c.source && c.source.id) + ' target=' + JSON.stringify(c && c.target && c.target.id));
    cPutNumbers(Boolean(c && c.source && c.target && typeof c.source.put === 'number' && typeof c.target.put === 'number'),
      at + ' source.put=' + JSON.stringify(c && c.source && c.source.put) + ' target.put=' + JSON.stringify(c && c.target && c.target.put));
    const sourceKeys = c && c.source && typeof c.source === 'object' ? Object.keys(c.source) : [];
    const targetKeys = c && c.target && typeof c.target === 'object' ? Object.keys(c.target) : [];
    cEndpointKeys(Boolean(c && c.source && c.target &&
      sourceKeys.every((k) => ['id', 'put'].includes(k)) &&
      targetKeys.every((k) => ['id', 'put', 'by_refference'].includes(k))),
    at + ' source keys=' + sourceKeys.join(',') + ' target keys=' + targetKeys.join(','));
    if (!c.source || !c.target) continue;
    const key = c.target.id + ':' + c.target.put;
    cOneWire(!seen.has(key), at + ' ' + key);
    seen.add(key);
    cSelfLoop(c.source.id !== c.target.id, at + ' #' + c.source.id);
    // Evaluated on EVERY wire, not only on a violation — an assert-on-violation
    // can never fire against a clean corpus, so its PASS would be vacuous.
    cByRefTarget(!('by_refference' in c.source), at + ' #' + c.source.id + ' by_ref on source');
    if (byId.has(c.source.id)) {
      const src = byId.get(c.source.id);
      cOutputNotSource(!['WRITETOUNIT', 'VIRTUALOUT', 'ALARM'].includes(src.type), at + ' #' + src.id + ' source=' + src.type);
    }
    if (byId.has(c.target.id)) {
      const target = byId.get(c.target.id);
      cInputNotTarget(!['CONST', 'PARAMV', 'CALENDAR', 'TAGVALUE', 'CALENDAR_2_0', 'CRITERIA'].includes(target.type), at + ' #' + target.id + ' target=' + target.type);
      if (c.target.by_refference === true) {
        cByRefFunction(target.compile_type === 'function', at + ' #' + target.id + ' compile_type=' + JSON.stringify(target.compile_type));
      }
    } else if (c.target.by_refference === true) {
      cByRefFunction(false, at + ' unresolved target=' + JSON.stringify(c.target.id));
    }
  }

  const adjacency = new Map(sk.blocks.map((b) => [b.id, []]));
  for (const c of sk.connections) {
    if (c && c.source && c.target && adjacency.has(c.source.id) && adjacency.has(c.target.id)) {
      adjacency.get(c.source.id).push(c.target.id);
    }
  }
  const colors = new Map();
  let closingEdge = null;
  for (const startId of adjacency.keys()) {
    if ((colors.get(startId) || 0) !== 0) continue;
    colors.set(startId, 1);
    const stack = [{ id: startId, next: 0 }];
    while (stack.length && !closingEdge) {
      const frame = stack[stack.length - 1];
      const nextIds = adjacency.get(frame.id);
      if (frame.next >= nextIds.length) {
        colors.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const nextId = nextIds[frame.next++];
      const nextColor = colors.get(nextId) || 0;
      if (nextColor === 1) {
        closingEdge = [frame.id, nextId];
      } else if (nextColor === 0) {
        colors.set(nextId, 1);
        stack.push({ id: nextId, next: 0 });
      }
    }
    if (closingEdge) break;
  }
  cAcyclic(!closingEdge, at + ' closing edge #' + (closingEdge && closingEdge[0]) + ' -> #' + (closingEdge && closingEdge[1]));

  if (sk.groups && Array.isArray(sk.groups) && sk.groups.length) {
    for (const g of sk.groups) {
      cGroupShape(g && Array.isArray(g.blocks) && 'alias_text' in g && 'open' in g && g.box && typeof g.box === 'object', at + ' group=' + JSON.stringify(g).slice(0, 60));
    }
  }
}

let failed = 0;
let vacuous = 0;
console.log('audited', files.length, 'sketches\n');
for (const c of claims) {
  const ok = c.violations === 0;
  if (!ok) failed++;
  if (c.evals === 0) vacuous++;
  const status = c.evals === 0 ? 'VACUOUS' : ok ? 'PASS  ' : 'FAIL  ';
  console.log(status + ' ' + c.name + '   [' + c.ref + ']  ' + c.evals + ' eval(s)' +
    (ok ? '' : '  — ' + c.violations + ' violation(s)'));
  if (!ok) c.samples.forEach((s) => console.log('        e.g. ' + s));
}
// A vacuous claim is not a holding claim — count it against the total too, or the
// tally reads "34/34 hold" on the same run that reports a vacuity failure.
console.log('\n' + (claims.length - failed - vacuous) + '/' + claims.length +
  ' documented claims hold' + (vacuous ? ' (' + vacuous + ' vacuous)' : ''));
// A claim that never evaluated passed trivially — that is a defect in the audit,
// not evidence about the fleet, so it fails the run just like a violation does.
console.log(vacuous
  ? 'VACUITY PROBE FAILED — ' + vacuous + ' claim(s) never evaluated'
  : 'vacuity probe: every claim evaluated at least once');
process.exit(failed || vacuous ? 1 : 0);
