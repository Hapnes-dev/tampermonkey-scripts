/*
 * Exercise the real bridgeSweep from the userscript against a fake console, so the block read and its fallback are
 * tested without a browser or a device. The source is sliced out of the shipped file rather than retyped: a test of
 * a re-implementation would prove nothing about what actually runs.
 */
'use strict';
const fs = require('fs');

const path = require('path');
const SRC = path.join(__dirname, '..', 'Modpoll-Console.user.js');
const text = fs.readFileSync(SRC, 'utf8');

const START = '    /**\n     * One register, one pass. Returns { value, name }';
const END = '    /** A modbusgen datatype names its Modbus table;';
const a = text.indexOf(START);
const b = text.indexOf(END);
if (a === -1 || b === -1 || b < a) { console.error('could not slice the sweep out'); process.exit(1); }
const code = text.slice(a, b);

const BRIDGE_TABLE = { coil: '0', discrete: '1', input: '3', hold: '4' };

/**
 * A console that answers according to `rule`, counting every modpoll run.
 * rule(table, start, count) -> array of values, or null for a refusal.
 */
function makeApi(rule, log) {
  let form = null;
  return {
    async useUnit() {},
    setForm(f) { form = f; },
    async run() {
      const table = Object.keys(BRIDGE_TABLE).find(k => BRIDGE_TABLE[k] === form.table);
      const values = rule(table, form.start, form.count);
      log.push({ table, start: form.start, count: form.count, ok: values !== null });
      if (values === null) return { log: ['the host refuses'], grid: { rows: [] } };
      return {
        log: ['ok'],
        grid: { rows: values.map((v, i) => ({ value: String(v), name: 'reg' + (form.start + i) })) },
      };
    },
  };
}

function load(api) {
  const f = new Function('api', 'BRIDGE_TABLE', code + '\n;return { bridgeSweep, bridgeRuns };');
  return f(api, BRIDGE_TABLE);
}

const targets = [];
for (let r = 1; r <= 40; r++) targets.push({ table: 'input', ref: r });

function report(name, log, res, expectRuns) {
  const runs = log.length;
  const ok = runs === expectRuns;
  console.log(`${ok ? 'OK  ' : 'FEIL'}  ${name}`);
  console.log(`        modpoll-kjøringer: ${runs}  (ventet ${expectRuns})`);
  console.log(`        always ${res.always}, never ${res.never.length}, sometimes ${res.sometimes.length}` +
              (res.aborted ? `, avbrutt: ${res.aborted}` : ''));
  const blocks = log.filter(l => l.count > 1);
  if (blocks.length) console.log(`        blokker: ${blocks.map(l => l.start + '+' + l.count).join(', ')}`);
  return ok;
}

(async () => {
  let allOk = true;

  // 1. Everything answers: one block for the 40, plus the control.
  {
    const log = [];
    const api = makeApi((t, s, c) => Array.from({ length: c }, (_, i) => 100 + s + i), log);
    const { bridgeSweep } = load(api);
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    allOk &= report('alt svarer - én blokk', log, res, 2);
  }

  // 2. The device refuses any block but answers singles: must fall back, not condemn the range.
  {
    const log = [];
    const api = makeApi((t, s, c) => (c > 1 ? null : [100 + s]), log);
    const { bridgeSweep } = load(api);
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    allOk &= report('blokk nektes, enkle svarer - tilbakefall', log, res, 42);
  }

  // 3. One illegal register inside the range: the block fails, the fallback finds the one that is absent.
  {
    const log = [];
    const bad = 17;
    const api = makeApi((t, s, c) => {
      const refs = Array.from({ length: c }, (_, i) => s + i);
      if (refs.includes(bad)) return null;
      return refs.map(r => 100 + r);
    }, log);
    const { bridgeSweep } = load(api);
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    const onlyBad = res.never.length === 1 && res.never[0].ref === bad;
    console.log(`${onlyBad ? 'OK  ' : 'FEIL'}  ett ulovlig register i blokka - bare det blir "never"`);
    console.log(`        never: ${res.never.map(r => r.ref).join(', ') || '(ingen)'}, always ${res.always}`);
    console.log(`        modpoll-kjøringer: ${log.length}`);
    allOk &= onlyBad && res.always === 39;
  }

  // 4. Dead device: the early abort must stop it, not spend a read on every register.
  {
    const log = [];
    const api = makeApi(() => null, log);
    const { bridgeSweep } = load(api);
    const res = await bridgeSweep('V01', targets, 3, 1, 'input');
    const stopped = !!res.aborted && log.length <= 8;
    console.log(`${stopped ? 'OK  ' : 'FEIL'}  død enhet - tidlig avbrudd`);
    console.log(`        modpoll-kjøringer: ${log.length} (av 123 mulige), avbrutt: ${res.aborted}`);
    allOk &= stopped;
  }

  // 5. Labels from the grid row survive the block path.
  {
    const log = [];
    const api = makeApi((t, s, c) => Array.from({ length: c }, (_, i) => 100 + s + i), log);
    const { bridgeSweep } = load(api);
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    const labelled = res.always_rows.filter(r => r.label).length;
    console.log(`${labelled === 40 ? 'OK  ' : 'FEIL'}  navn følger med gjennom blokka: ${labelled}/40`);
    allOk &= labelled === 40;
  }

  console.log(allOk ? '\nAlle bestått.' : '\nNoe feilet.');
  process.exit(allOk ? 0 : 1);
})();
