/*
 * Exercise the real bridgeSweep from the userscript against a fake console, so the block read and its fallback are
 * tested without a browser or a device. The source is sliced out of the shipped file rather than retyped: a test of
 * a re-implementation would prove nothing about what actually runs.
 */
'use strict';
const fs = require('fs');

const path = require('path');
const SRC = path.join(__dirname, '..', 'Modpoll-Console.user.js');
// A Windows checkout (core.autocrlf) has CRLF; the markers below are written with \n.
const text = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

// From the bridge's unit context (1.72.0) to the end of bridgeSweep: everything a sweep runs.
const START = '    /*\n     * A unit as the bridge reads it (1.72.0)';
const END = '    /** A modbusgen datatype names its Modbus table;';
const a = text.indexOf(START);
const b = text.indexOf(END);
if (a === -1 || b === -1 || b < a) { console.error('could not slice the sweep out'); process.exit(1); }
const code = text.slice(a, b);

const BRIDGE_TABLE = { coil: '0', discrete: '1', input: '3', hold: '4' };

/**
 * The console's readRegisters as the bridge sees it (1.72.0), answering according to `rule` and counting every modpoll
 * run. rule(table, start, count) -> array of values, null for a refusal, 'silent' for no answer at all (a time-out) or
 * 'held' for a COM port the Plant Server holds. A block read (recover: false) comes back as modpoll left it; a single
 * register comes back judged, as the console's own recovery judges it.
 */
function makeEngine(rule, log) {
  const tableName = digit => Object.keys(BRIDGE_TABLE).find(k => BRIDGE_TABLE[k] === digit);
  return async function readRegisters(spec) {
    const table = tableName(spec.table);
    const values = rule(table, spec.start, spec.count);
    log.push({ table, start: spec.start, count: spec.count, ok: Array.isArray(values) });
    const result = { values: [], diagnostics: [], unreadable: [], noAnswer: [], unsettled: [] };
    const judged = spec.recover !== false && spec.count === 1;
    if (values === 'held') {
      result.diagnostics.push({ level: 'fatal', text: 'Serial port already open — the Plant Server holds this COM port', line: 'Serial port already open!' });
    } else if (values === null) {
      result.diagnostics.push({ level: 'warn', text: 'Illegal data address exception — device answered, register is outside its map', line: 'Illegal Data Address exception response!' });
      if (judged) result.unreadable.push(spec.start);
    } else if (values === 'silent') {
      result.diagnostics.push({ level: 'error', text: 'No response from device (timeout)', line: 'Reply time-out!' });
      if (judged) result.noAnswer.push(spec.start);
    } else {
      result.values = values.map((v, i) => Object.assign({ i: spec.start + i, addr: spec.start + i - 1, v },
        v === -32768 ? { suspect: { code: '0x8000', why: 'the lowest signed 16-bit value', strength: 'strong' } } : {}));
    }
    return result;
  };
}

/**
 * `cancelAfter` makes /bridge/cancelled start answering true once that many reads have happened, which is how a
 * modpoll_cancel reaches a sweep already running. Left null, the bridge is never asked to stop.
 */
function load(readRegisters, log, cancelAfter) {
  const bridgeHttp = async (method, path) => {
    if (path !== '/bridge/cancelled') throw new Error('the harness only answers /bridge/cancelled');
    return { cancelled: cancelAfter !== null && cancelAfter !== undefined && log.length >= cancelAfter };
  };
  const fetchUnits = async () => [{ unit_id: 'V01', mode: 'tcp', host: '192.168.10.100', slave: 1, baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' }];
  const fetchPlantNames = async () => ({ unitId: 'V01', byRef: new Map(Array.from({ length: 400 }, (_, i) => ['3||' + (i + 1), [{ name: 'reg' + (i + 1) }]])) });
  const portProblem = raw => (/serial port already open/i.test(raw) ? 'the port is held — by the Plant Server while it runs. Nothing was read.' : null);
  const normaliseSpec = s => s;
  // Up to 1.71 the bridge filled the person's form and pressed Poll. Any touch of the console's API now throws.
  const api = new Proxy({}, { get: (t, k) => () => { throw new Error('the bridge touched the console form: api.' + String(k)); } });
  const f = new Function('api', 'BRIDGE_TABLE', 'bridgeHttp', 'fetchUnits', 'fetchPlantNames', 'readRegisters', 'portProblem', 'normaliseSpec',
    code + '\n;return { bridgeSweep, bridgeRuns };');
  return f(api, BRIDGE_TABLE, bridgeHttp, fetchUnits, fetchPlantNames, readRegisters, portProblem, normaliseSpec);
}
const makeApi = makeEngine;   // the cases below name the fake by what it stood for

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
    const { bridgeSweep } = load(api, log);
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    allOk &= report('alt svarer - én blokk', log, res, 2);
  }

  // 2. The device refuses any block but answers singles: must fall back, not condemn the range.
  {
    const log = [];
    const api = makeApi((t, s, c) => (c > 1 ? null : [100 + s]), log);
    const { bridgeSweep } = load(api, log);
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
    const { bridgeSweep } = load(api, log);
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
    const { bridgeSweep } = load(api, log);
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
    const { bridgeSweep } = load(api, log);
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    const labelled = res.always_rows.filter(r => r.label).length;
    console.log(`${labelled === 40 ? 'OK  ' : 'FEIL'}  navn følger med gjennom blokka: ${labelled}/40`);
    allOk &= labelled === 40;
  }

  // 6. A cancel reaches a sweep that is already running, on the slow one-at-a-time path.
  {
    const log = [];
    const api = makeApi((t, s, c) => (c > 1 ? null : [100 + s]), log);   // refuses blocks, so it falls back
    const { bridgeSweep } = load(api, log, 12);                          // /bridge/cancelled turns true at 12 reads
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    const stopped = res.aborted === 'cancelled from Claude' && log.length < 42;
    console.log(`${stopped ? 'OK  ' : 'FEIL'}  avbrutt midt i tilbakefallet`);
    console.log(`        modpoll-kjøringer: ${log.length} (av 42), avbrutt: ${res.aborted}`);
    allOk &= stopped;
  }

  // 7. A device that times out is "no answer", never "refused" - in the rows and in the reason the sweep stopped.
  {
    const log = [];
    const api = makeApi(() => 'silent', log);
    const { bridgeSweep } = load(api, log);
    const res = await bridgeSweep('V01', targets, 2, 1, 'input');
    const said = JSON.stringify(res);
    const read = res.never.filter(r => r.of > 0);   // an aborted sweep lists the registers it never got to as well
    const honest = !!res.aborted && !/refus/i.test(said) && read.length > 0 &&
      read.every(r => r.missed && r.missed['no answer'] === r.of);
    console.log(`${honest ? 'OK  ' : 'FEIL'}  tidsavbrudd blir "no answer", aldri "refused"`);
    console.log(`        avbrutt: ${res.aborted}; never[0].missed: ${JSON.stringify(res.never[0] && res.never[0].missed)}`);
    allOk &= honest;
  }

  // 8. A register the device refuses keeps saying so.
  {
    const log = [];
    const bad = 17;
    const api = makeApi((t, s, c) => {
      const refs = Array.from({ length: c }, (_, i) => s + i);
      return refs.includes(bad) ? null : refs.map(r => 100 + r);
    }, log);
    const { bridgeSweep } = load(api, log);
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    const refused = res.never.length === 1 && res.never[0].missed && res.never[0].missed.refused === 1;
    console.log(`${refused ? 'OK  ' : 'FEIL'}  et nektet register står som refused`);
    console.log(`        never: ${JSON.stringify(res.never.map(r => ({ ref: r.ref, missed: r.missed })))}`);
    allOk &= refused;
  }

  // 9. A held COM port ends the sweep with what it is, rather than a column of "unknown" (1.72.0).
  {
    const log = [];
    const api = makeApi(() => 'held', log);
    const { bridgeSweep } = load(api, log);
    let said = null;
    try { await bridgeSweep('V01', targets, 2, 1, 'input'); } catch (e) { said = e.message; }
    const ended = !!said && /held/i.test(said) && log.length === 1;
    console.log(`${ended ? 'OK  ' : 'FEIL'}  en holdt COM-port avslutter med grunnen, etter én lesing`);
    console.log(`        modpoll-kjøringer: ${log.length}, sa: ${said}`);
    allOk &= ended;
  }

  // 10. A placeholder value carries its flag through the block path (1.72.0).
  {
    const log = [];
    const api = makeApi((t, s, c) => Array.from({ length: c }, (_, i) => (s + i === 5 ? -32768 : 100 + s + i)), log);
    const { bridgeSweep } = load(api, log);
    const res = await bridgeSweep('V01', targets, 1, 1, 'input');
    const flagged = res.always_rows.filter(r => r.suspect);
    const ok = flagged.length === 1 && flagged[0].ref === 5 && flagged[0].suspect === '0x8000';
    console.log(`${ok ? 'OK  ' : 'FEIL'}  plassholderverdi flagges: ${JSON.stringify(flagged)}`);
    allOk &= ok;
  }

  console.log(allOk ? '\nAlle bestått.' : '\nNoe feilet.');
  process.exit(allOk ? 0 : 1);
})();
