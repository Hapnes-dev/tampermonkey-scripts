"""Scan device against simulated devices, the shipped scan and the previous one.

Lifts the command model, the polling engine and the scan out of the userscript
and runs them in Node with Plant Term replaced by a simulated device: a strict
one that refuses any block touching an unmapped register, and a lenient one
that answers 0 for whatever is not mapped. The same is done for the script as
committed at HEAD, so a change to the scan is measured against what it
replaces on the same maps: what each finds, what each misses, and what each
costs in modpoll invocations.

One device is plant 2349's V01 ventilation controller with the map a full scan
found there, and the cost of every run is also given in seconds on a model
calibrated on that scan (223 s with 1.45.1): a shell line ~0.5 s, an answered
run ~0.1 s more, a refusal ~0.63 s — so a change's cost is read in the unit the
user waits in, phase by phase and by the kind of line that paid each refusal.
Every device is then scanned a second time, which a device scanned in full
before reads from its known map; V01 also has its map changed under it, which
that second read must notice and look for again.

Lives beside the script it tests. Run: python scan-simulation.py [--old-ref REF]
"""

import io
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "Modpoll-Console.user.js"
REL = "modpoll-console/Modpoll-Console.user.js"

old_ref = "HEAD"
if "--old-ref" in sys.argv:
    old_ref = sys.argv[sys.argv.index("--old-ref") + 1]


def lift(src, start, end):
    return src[src.index(start):src.index(end)]


def bundle(src, label):
    js = "(async () => {\n"
    js += "globalThis.window = globalThis; globalThis.location = { hostname: '2349.plants.iwmac.local' };\n"
    js += "const isSerialMode = mode => mode === 'rtu' || mode === 'ascii';\n"
    js += "const VERSION = 'sim'; const __store = new Map(); globalThis.localStorage = { getItem: k => (__store.has(k) ? __store.get(k) : null), setItem: (k, v) => __store.set(k, String(v)) };\n"
    js += "const log = () => {}; const mirrorTerminal = () => {};\n"
    js += "const enrichValue = () => ({}); const pointForReading = () => null; const plantNamesFor = () => null;\n"
    js += lift(src, "    const EXE_BARE", "    // ---------------------------------------------------- Plant Term driver")
    js += lift(src, "    /** Runs of consecutive numbers", "    function impliedScale")
    js += "const COST = { lines: 0, invocations: 0, refusals: 0, kinds: {} };\n"
    js += "let DEVICE = null; let plantNames = null; let pointList = null;\n"
    js += r"""
    // Plant Term, replaced: one chained command line in, what modpoll would
    // have printed out, and a count of what it cost.
    async function termRun(command) {
        COST.lines++;
        const out = [];
        // Which kind of line paid for a refusal: single-register probes (the
        // ladder, a look-ahead, an empty chunk's spot checks), block reads.
        const kind = /echo #mpc:\d+:\d+/.test(command) ? 'probe line' : (/-c (\d+)/.exec(command) || [])[1] === '1' ? 'single read' : 'block read';
        for (const segment of String(command).split('&').map(s => s.trim()).filter(Boolean)) {
            if (segment.startsWith('echo ')) { out.push(segment.slice(5)); continue; }
            COST.invocations++;
            const tokens = splitTokens(segment);
            const arg = flag => { const at = tokens.indexOf(flag); return at >= 0 ? tokens[at + 1] : undefined; };
            const [table, fmt] = String(arg('-t') || '4').split(':');
            const ref = Number(arg('-r') || 1);
            const count = Number(arg('-c') || 1);
            const wide = fmt === 'float' || fmt === 'int';
            const answer = DEVICE.read(table, ref, wide ? count * 2 : count);
            if (answer === null) { COST.refusals++; COST.kinds[kind] = (COST.kinds[kind] || 0) + 1; out.push('Illegal Data Address exception response!'); continue; }
            if (!wide) { answer.forEach((v, n) => out.push('[' + (ref + n) + ']: ' + v)); continue; }
            // 32-bit, as the plants' modpoll prints it: one line per value, two
            // registers each, and the high word first only with -f / -i — the
            // documented meaning, which the console measures rather than trusts.
            const big = tokens.indexOf('-f') >= 0 || tokens.indexOf('-i') >= 0;
            const view = new DataView(new ArrayBuffer(4));
            const word = v => ((v < 0 ? v + 65536 : v) & 0xFFFF);
            for (let n = 0; n + 1 < answer.length; n += 2) {
                const [hi, lo] = big ? [answer[n], answer[n + 1]] : [answer[n + 1], answer[n]];
                view.setUint16(0, word(hi));
                view.setUint16(2, word(lo));
                out.push('[' + (ref + n) + ']: ' + (fmt === 'float' ? view.getFloat32(0).toFixed(6) : String(view.getInt32(0))));
            }
        }
        return out.join('\n');
    }
    // A float as the two 16-bit words modpoll prints for its registers, signed
    // as modpoll prints them; and a map of registers holding a run of floats.
    const floatWords = (x, highFirst) => {
        const view = new DataView(new ArrayBuffer(4));
        view.setFloat32(0, x);
        const hi = view.getInt16(0), lo = view.getInt16(2);
        return highFirst ? [hi, lo] : [lo, hi];
    };
    const floatMap = (from, values, highFirst) => {
        const m = new Map();
        values.forEach((x, n) => { const [a, b] = floatWords(x, highFirst); m.set(from + 2 * n, a); m.set(from + 2 * n + 1, b); });
        return m;
    };
    const series = (n, first, step) => Array.from({ length: n }, (_, k) => first + k * step);
"""
    js += lift(src, "    let abortRequested = false;", "    /*\n     * What an agent needs to improve a point list")
    js += lift(src, "    const SWEEP_CEILING", "    /** The same result, shrunk")
    js += r"""
    const ranges = list => asRanges(list) || '-';
    const expand = spec => { const s = new Set(); for (const [a, b] of spec) for (let r = a; r <= b; r++) s.add(r); return s; };
    // Strict: refuses a block touching anything unmapped. Lenient: answers 0 for
    // anything unmapped, on every reference modpoll can ask for. A live
    // register counts the device's reads, so it never answers the same twice —
    // what the second pass over everything found has to notice.
    // A strict device's registers: bits in the bit tables, a live counter
    // where one is declared, the words of a float where a float map is, and
    // the reference itself everywhere else.
    function strictRead(table, ref, count) {
        this.reads++;
        const map = this.maps[table];
        const floats = this.floats && this.floats[table];
        const values = [];
        for (let r = ref; r < ref + count; r++) {
            if (!map.has(r)) return null;
            const live = this.live && this.live[table] && this.live[table].has(r);
            values.push(table === '0' || table === '1' ? (r % 2) : (live ? r + this.reads : (floats && floats.has(r) ? floats.get(r) : r)));
        }
        return values;
    }
    const devices = {
        'strict, three areas and a hole': {
            maps: { '4': expand([[1, 50], [1001, 1049], [1051, 1100], [8192, 8200]]), '3': expand([[2001, 2040]]), '1': new Set(), '0': expand([[1, 16]]) },
            // IWMAC's list knows two of the holding areas and nothing else: the
            // third, at 8192, and the input registers must still be found.
            listed: { '4': [[1, 50], [1001, 1100]] },
            live: { '4': new Set([1010, 8195]) },
            // Twenty floats, high word first, on the input registers.
            floats: { '3': floatMap(2001, series(20, 20.5, 0.25), true) },
            expectFormats: { '3|2001': 'float32, high word first', '4|1': '16-bit', '4|1001': '16-bit', '4|8192': '16-bit' },
            expectForm: '-t 4 -r 1001 -c 100',
            reads: 0,
            read: strictRead,
        },
        'strict, a float map': {
            maps: { '4': expand([[1001, 1200]]), '3': new Set(), '1': new Set(), '0': new Set() },
            // A hundred floats, high word first: the whole map is 32-bit.
            floats: { '4': floatMap(1001, series(100, 100, 1.5), true) },
            expectFormats: { '4|1001': 'float32, high word first' },
            expectForm: '-t 4:float -f -r 1001 -c 100',
            reads: 0,
            read: strictRead,
        },
        'lenient, values at 1-300, zeros elsewhere': {
            maps: { '4': expand([[1, 300]]), '3': new Set(), '1': new Set(), '0': new Set() },
            live: { '4': new Set([7]) },
            expectFormats: { '4|1': '16-bit' },
            expectForm: '-t 4 -r 1 -c 300',
            reads: 0,
            read(table, ref, count) {
                this.reads++;
                if (table !== '4') return null;
                if (ref + count - 1 > 65536) return null;
                const values = [];
                for (let r = ref; r < ref + count; r++) values.push(this.maps[table].has(r) ? (this.live[table].has(r) ? r + this.reads : r) : 0);
                return values;
            },
        },
        // Plant 2349's V01 ventilation controller (Modbus TCP) as a full scan
        // found it on 2026-09-24: strict, four small maps near the bottom of
        // each table, two single holes. Its real cost is what the estimate below
        // is calibrated on — 223 s for the scan 1.45.1 ran.
        'strict, plant 2349 V01 ventilation': {
            maps: { '4': expand([[2, 502]]), '3': expand([[1, 45], [47, 484]]), '1': expand([[3, 523]]), '0': expand([[1, 12], [14, 40]]) },
            // IWMAC's list for the unit reads the same registers.
            listed: { '4': [[2, 502]], '3': [[1, 484]], '1': [[3, 523]], '0': [[1, 40]] },
            // And later, after a firmware change, a holding map that ends at 399.
            changed: { '4': expand([[2, 399]]) },
            reads: 0,
            read: strictRead,
        },
        'strict, one map starting at protocol 1000': {
            maps: { '4': expand([[1001, 1120]]), '3': expand([[1001, 1040]]), '1': new Set(), '0': new Set() },
            // Twenty floats, low word first, on the input registers — the
            // other order, which the wire check has to tell apart.
            floats: { '3': floatMap(1001, series(20, -5, 2.5), false) },
            expectFormats: { '4|1001': '16-bit', '3|1001': 'float32, low word first' },
            expectForm: '-t 4 -r 1001 -c 120',
            reads: 0,
            read: strictRead,
        },
    };
    const lines = [];
    // What a scan costs on V01, calibrated on the 1.45.1 scan that took 223 s:
    // with this model's counts for that scan (128 lines, 90 answered runs, 232
    // refused), a shell line ~0.5 s, an answered run ~0.1 s on top and a
    // refused one ~0.63 s reproduce it within seconds — and 0.63 s is what a
    // refusal cost on plant 2313's controller too. One-off commands through
    // the console's raw() cost more (1.9 s, 4.0 s): they wait out a settle
    // window a scan's reads do not.
    const SECONDS = { line: 0.5, answer: 0.1, refusal: 0.63 };
    const estimate = c => c.lines * SECONDS.line + (c.invocations - c.refusals) * SECONDS.answer + c.refusals * SECONDS.refusal;
    for (const [name, device] of Object.entries(devices)) {
        // Each device at its own address, so each keeps its own map.
        const target = { mode: 'tcp', host: '10.0.' + (Object.keys(devices).indexOf(name) + 1) + '.5', slave: 1 };
        DEVICE = device;
        // IWMAC's parameters for the unit, where the device declares a list.
        plantNames = null;
        if (device.listed) {
            const byRef = new Map();
            for (const t of Object.keys(device.listed)) for (const [a, b] of device.listed[t]) for (let r = a; r <= b; r++) byRef.set(t + '||' + r, [{}]);
            plantNames = { unitId: 'U', byRef };
        }
        COST.lines = 0; COST.invocations = 0; COST.refusals = 0; COST.kinds = {};
        const started = Date.now();
        // Progress, where the scan reports it: the bar must never go backwards
        // and must end at 100 %, and every phase must have been announced.
        const events = [];
        // What each phase cost: COST as it stood when the phase was first announced.
        const phaseCost = [];
        const report = await scanDevice(target, true, p => {
            events.push(p);
            if (p.phase && (!phaseCost.length || phaseCost[phaseCost.length - 1].phase !== p.phase)) {
                phaseCost.push({ phase: p.phase, lines: COST.lines, invocations: COST.invocations, refusals: COST.refusals });
            }
        });
        lines.push('');
        lines.push('== ' + name + ' ==');
        if (events.length && events[0].fraction !== undefined) {
            let backwards = 0;
            for (let i = 1; i < events.length; i++) if (events[i].fraction < events[i - 1].fraction - 1e-9) backwards++;
            const phases = [...new Set(events.map(e => e.phase))];
            const last = events[events.length - 1];
            lines.push('  progress: ' + events.length + ' updates, phases ' + phases.join(' > ') +
                ', ends at ' + Math.round(last.fraction * 100) + ' % "' + last.text + '"' +
                (backwards ? ' — WENT BACKWARDS ' + backwards + ' time(s)' : ', never backwards'));
            // Per phase, since 1.42.0's whole point is that the sweep phase no
            // longer reports back once per chunk: on a strict device with a hole,
            // one chunk alone used to be the entire sweep update and is now
            // dozens of ticks, one per command chaseRun issued chasing it.
            const perPhase = {};
            for (const e of events) perPhase[e.phase] = (perPhase[e.phase] || 0) + 1;
            lines.push('  by phase: ' + Object.entries(perPhase).map(([k, v]) => k + ' ' + v).join(', '));
        } else {
            lines.push('  progress: ' + events.length + ' updates, no fractions (the previous scan reported chunks only)');
        }
        for (const table of ['4', '3', '1', '0']) {
            const expected = device.maps[table];
            const expectNonZero = new Set([...expected].filter(r => (table === '0' || table === '1') ? (r % 2) : true));
            const found = new Set((report.values || []).filter(v => v.table === table).map(v => v.i));
            const foundNonZero = new Set((report.values || []).filter(v => v.table === table && v.v !== 0).map(v => v.i));
            const target = name.startsWith('lenient') ? expectNonZero : expected;
            const got = name.startsWith('lenient') ? foundNonZero : found;
            const missing = [...target].filter(r => !got.has(r));
            const extra = [...got].filter(r => !target.has(r));
            const swept = report.sweep && report.sweep[table];
            const label = name.startsWith('lenient') ? 'values' : 'registers';
            lines.push('  table ' + table + ': ' + label + ' expected ' + target.size + ', found ' + got.size +
                (missing.length ? ' — MISSING ' + ranges(missing) : '') + (extra.length ? ' — EXTRA ' + ranges(extra) : '') +
                (swept && swept.regions ? '  [' + swept.regions.length + ' region(s): ' + swept.regions.map(r => r.from + ' → ' + r.stoppedBecause).join('; ') + ']' : ''));
        }
        // The second pass: every live register the device has must come back
        // as changed, and nothing else may.
        const liveExpected = [];
        for (const table of Object.keys(device.live || {})) for (const r of device.live[table]) if (device.maps[table].has(r)) liveExpected.push(table + ':' + r);
        if (report.reread) {
            const rr = report.reread;
            const changedFound = (report.values || []).filter(v => v.changed).map(v => v.table + ':' + v.i);
            const missed = liveExpected.filter(k => changedFound.indexOf(k) < 0);
            const spurious = changedFound.filter(k => liveExpected.indexOf(k) < 0);
            lines.push('  reread: ' + rr.runs + ' run(s), ' + rr.reread + ' registers read again, ' + rr.changed + ' changed' +
                (Object.keys(rr.changedRanges).length ? ' [' + Object.entries(rr.changedRanges).map(([t, s]) => 'table ' + t + ': ' + s).join('; ') + ']' : '') +
                (missed.length ? ' — MISSED live ' + missed.join(', ') : '') + (spurious.length ? ' — SPURIOUS ' + spurious.join(', ') : '') +
                (!missed.length && !spurious.length ? ' — every live register and nothing else' : ''));
        } else {
            lines.push('  reread: none (this scan read everything once)' + (liveExpected.length ? ' — ' + liveExpected.length + ' live register(s) not told apart' : ''));
        }
        // The width verdicts, against what each map was built to hold; the
        // measured meaning of -f; and the poll the form is set to.
        if (report.formats) {
            const verdicts = [];
            const wrong = [];
            for (const table of Object.keys(report.formats)) {
                for (const r of report.formats[table].regions) {
                    const said = r.format + (r.wordOrder && r.format !== '16-bit' ? ', ' + r.wordOrder : '');
                    const want = (device.expectFormats || {})[table + '|' + r.from];
                    verdicts.push('table ' + table + ' ' + r.from + '-' + r.to + ': ' + said + ' (' + r.confidence +
                        (r.pairs ? ', ' + r.pairs.plausible + '/' + r.pairs.tested + ' float pairs' : '') + ')');
                    if (want && want !== said) wrong.push('table ' + table + ' from ' + r.from + ' expected ' + want + ', got ' + said);
                }
            }
            lines.push('  formats: ' + (verdicts.join('; ') || 'no regions') + (wrong.length ? ' — WRONG: ' + wrong.join('; ') : ''));
            if (report.modpoll) {
                lines.push('  modpoll -f: ' + (report.modpoll.measured
                    ? report.modpoll.bigEndianFlag + ' — measured on table ' + report.modpoll.table + ' from ' + report.modpoll.ref + ', ' + report.modpoll.compared + ' pair(s) compared'
                    : 'not measured' + (report.modpoll.error ? ' (' + report.modpoll.error + ')' : '')));
            }
            const s = report.suggestedSpec;
            const form = s ? '-t ' + s.table + (s.format ? ':' + s.format : '') + (s.bigEndian ? ' ' + (s.format === 'float' ? '-f' : '-i') : '') + ' -r ' + s.start + ' -c ' + s.count : 'none';
            lines.push('  form: ' + form + (s && s.assumedFlag ? ' (flag assumed)' : '') +
                (device.expectForm && device.expectForm !== form ? ' — WRONG: expected ' + device.expectForm : (device.expectForm ? ' — as expected' : '')));
        } else {
            lines.push('  formats: none (this scan did not judge widths)');
        }
        lines.push('  cost: ' + COST.lines + ' shell lines, ' + COST.invocations + ' modpoll runs, ' + COST.refusals + ' refusals, ' + (Date.now() - started) + ' ms of simulation' +
            ' — about ' + Math.round(estimate(COST)) + ' s at V01\'s measured costs');
        const byPhase = [];
        for (let i = 0; i < phaseCost.length; i++) {
            const a = phaseCost[i], b = phaseCost[i + 1] || { lines: COST.lines, invocations: COST.invocations, refusals: COST.refusals };
            const c = { lines: b.lines - a.lines, invocations: b.invocations - a.invocations, refusals: b.refusals - a.refusals };
            if (c.lines) byPhase.push(a.phase + ' ' + Math.round(estimate(c)) + ' s (' + c.lines + ' lines, ' + c.invocations + ' runs, ' + c.refusals + ' refused)');
        }
        lines.push('  by phase: ' + byPhase.join('; '));
        lines.push('  refused on: ' + Object.entries(COST.kinds).map(([k, v]) => k + 's ' + v).join(', '));
        // The same device scanned again: from the map the first scan found,
        // where there is a map to read, and it must find exactly the same.
        const foundKeys = r => new Set((r.values || []).map(v => v.table + ':' + v.i));
        const firstKeys = foundKeys(report);
        COST.lines = 0; COST.invocations = 0; COST.refusals = 0; COST.kinds = {};
        const again = await scanDevice(target, true, () => {});
        const againKeys = foundKeys(again);
        const same = againKeys.size === firstKeys.size && [...firstKeys].every(k => againKeys.has(k));
        lines.push('  scanned again: ' + (again.mapFrom ? 'from the known map' : 'a full discovery') + ' — ' + COST.lines + ' lines, ' + COST.invocations + ' runs, ' +
            COST.refusals + ' refused, about ' + Math.round(estimate(COST)) + ' s; ' + (same ? 'the same ' + againKeys.size + ' registers' : 'DIFFERENT: ' + againKeys.size + ' against ' + firstKeys.size));
        if (device.changed) {
            // The map changed under it: reading the old map must notice and look again.
            for (const t of Object.keys(device.changed)) device.maps[t] = device.changed[t];
            COST.lines = 0; COST.invocations = 0; COST.refusals = 0; COST.kinds = {};
            const changedEvents = [];
            const third = await scanDevice(target, true, e => changedEvents.push(e));
            const expected = new Set(); for (const t of Object.keys(device.maps)) for (const r of device.maps[t]) expected.add(t + ':' + r);
            const got = foundKeys(third);
            const exact = got.size === expected.size && [...expected].every(k => got.has(k));
            lines.push('  after its map changed: ' + (third.mapFrom ? 'READ THE OLD MAP' : (changedEvents.some(e => e.mapChanged) ? 'noticed, looked again' : 'looked again')) +
                ' — ' + (exact ? 'found exactly the new map, ' + got.size + ' registers' : 'WRONG: ' + got.size + ' against ' + expected.size) + ', about ' + Math.round(estimate(COST)) + ' s');
        }
    }
    console.log(lines.join('\n'));
})().catch(e => { console.error('FAILED: ' + (e && e.stack || e)); process.exit(1); });
"""
    return js


new_src = io.open(SRC, encoding="utf-8", newline="").read()
old_src = subprocess.run(["git", "-C", str(HERE.parent.parent), "show", old_ref + ":" + REL],
                         capture_output=True, text=True, encoding="utf-8").stdout

for label, src in (("PREVIOUS (" + old_ref + ")", old_src), ("SHIPPED (working copy)", new_src)):
    print("#" * 72)
    print("# " + label)
    print("#" * 72)
    out = Path(os.environ.get("TEMP", ".")) / ("mpc-scan-" + label.split()[0].lower() + ".js")
    io.open(out, "w", encoding="utf-8").write(bundle(src, label))
    r = subprocess.run(["node", str(out)], capture_output=True, text=True, encoding="utf-8")
    print(r.stdout)
    if r.stderr:
        print(r.stderr[:2000])
