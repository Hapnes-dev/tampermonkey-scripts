"""Scan device against simulated devices, the shipped scan and the previous one.

Lifts the command model, the polling engine and the scan out of the userscript
and runs them in Node with Plant Term replaced by a simulated device: a strict
one that refuses any block touching an unmapped register, and a lenient one
that answers 0 for whatever is not mapped. The same is done for the script as
committed at HEAD, so a change to the scan is measured against what it
replaces on the same maps: what each finds, what each misses, and what each
costs in modpoll invocations.

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
    js += "const log = () => {}; const mirrorTerminal = () => {};\n"
    js += "const enrichValue = () => ({}); const pointForReading = () => null; const plantNamesFor = () => null;\n"
    js += lift(src, "    const EXE_BARE", "    // ---------------------------------------------------- Plant Term driver")
    js += lift(src, "    /** Runs of consecutive numbers", "    function impliedScale")
    js += "const COST = { lines: 0, invocations: 0, refusals: 0 };\n"
    js += "let DEVICE = null;\n"
    js += r"""
    // Plant Term, replaced: one chained command line in, what modpoll would
    // have printed out, and a count of what it cost.
    async function termRun(command) {
        COST.lines++;
        const out = [];
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
            if (answer === null) { COST.refusals++; out.push('Illegal Data Address exception response!'); continue; }
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
    for (const [name, device] of Object.entries(devices)) {
        DEVICE = device;
        COST.lines = 0; COST.invocations = 0; COST.refusals = 0;
        const started = Date.now();
        // Progress, where the scan reports it: the bar must never go backwards
        // and must end at 100 %, and every phase must have been announced.
        const events = [];
        const report = await scanDevice({ mode: 'tcp', host: '10.0.0.5', slave: 1 }, true, p => events.push(p));
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
        lines.push('  cost: ' + COST.lines + ' shell lines, ' + COST.invocations + ' modpoll runs, ' + COST.refusals + ' refusals, ' + (Date.now() - started) + ' ms of simulation');
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
