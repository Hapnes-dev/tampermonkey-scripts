"""Does Save JSON say what an agent needs after a scan? Checked against the shipped code.

Lifts the export - and everything it enriches a row with - out of
Modpoll-Console.user.js and runs it in Node with a scan in hand and no poll at
all, the case the button is most likely to meet, against a unit whose plant
parameters cover the shapes a point list has to get right: a scaled 16-bit
register, a float over two registers, a 32-bit counter, a status word read by
bits, a register that moved between the sweep and the second read, and
parameters on registers the scan did not find. Each expectation is printed as
PASS or FAIL and the script exits non-zero on any FAIL.

Lives beside the script it tests. Run: python export-check.py
"""
import io
import os
import subprocess
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "Modpoll-Console.user.js"
src = io.open(SRC, encoding="utf-8", newline="").read()


def lift(start, end):
    return src[src.index(start):src.index(end)]


js = "globalThis.window = globalThis; globalThis.location = { hostname: '2349.plants.iwmac.local' };\n"
js += "const VERSION = 'test'; const REPORT_CHUNK_LIMIT = 30000;\n"
js += "let lastVerification = null, _unitsCache = null;\n"
js += "let lastResult = null, lastScan = null, pointList = null, plantNames = null;\n"
js += "const resultFilename = () => 'modpoll_test.json';\n"
js += lift("    const REGISTER_TABLES = [", "\n    // Serial defaults per driver family")
js += lift("    const FORMATS = [", "\n    const TOOLBOX_SQL_URL")
# The point-list parser and everything it decodes with - roundScaled and
# scaleFactorOf among them - so the list in the fixture is parsed by the real one.
js += lift("    const DATATYPE_EXCEPTIONS = {", "\n    /**\n     * Points become poll ranges")
# The real lookups from a reading to its list point and its plant parameters.
js += lift("    function plantNamesFor(table, format, ref) {", "\n    /**\n     * What one register is, in the order someone asks it")
# enrichValue, asRanges, impliedScale, the 32-bit decoding, the suggestion, and the export itself.
js += lift("    function enrichValue(value, table, format) {", "\n    /**\n     * One block of text describing a poll")
js += lift("    /**\n     * Everything the console knows, as a document", "\n    /*\n     * Where does this device actually keep anything?")
js += "const plantIdFromHost = () => '2349';\n"
js += "const watchDelta = new Map();\n"
js += r"""
// --- the unit, as the plant describes it ------------------------------------
const byRef = new Map();
const put = (table, ref, ...entries) => {
    byRef.set(table + '||' + ref, entries.map(e => Object.assign({
        unit: '', bit: null, group: 'Status', access: 'r', table, ref, protocol: ref - 1,
        driverId: '2349_EKC_ekc_0_9_0_' + ({ '4': 3, '3': 4, '1': 2, '0': 1 })[table] + '_' + (ref - 1) + (e.bit === undefined || e.bit === null ? '' : '.' + e.bit),
    }, e)));
};
put('4', 1001, { name: 'Sug trykk', plantValue: '3.4', unit: 'bar' });                       // 16-bit, register 34 -> x0.1
put('4', 1003, { name: 'Romtemp', plantValue: '21,5', unit: '°C' });                          // float over 1003-1004, high word first
put('4', 1006, { name: 'Alarm relay', plantValue: 'On', bit: 0 }, { name: 'Defrost', plantValue: 'On', bit: 3 });
put('4', 1008, { name: 'Energy', plantValue: '123456', unit: 'kWh' });                         // int32 over 1008-1009, high word first
put('4', 1012, { name: 'Setpoint', plantValue: '-5', unit: '°C', access: 'rw', group: 'Setpoints' });  // negative, writable
put('4', 1500, { name: 'Ghost setpoint', plantValue: '5' });                                   // inside the swept map, never answered
put('4', 5000, { name: 'Far away', plantValue: '7' });                                         // beyond the swept map
put('0', 3, { name: 'Coil x', plantValue: '1' });                                             // a table that gave no answer
plantNames = { unitId: 'ID01', byRef, groups: 2, rows: 9, undecodable: 0, at: new Date().toISOString() };

// --- a list with a point at the float's first register, declared 16-bit ------
pointList = parsePointList({
    options: { subtract_one: false },
    points: [
        { tag: 'T1', text: 'Romtemp', datatype: 'A_Hold_I16_N', addr: 1002, scale: 'x0.1', unit: '°C', rw: 'r', group: 'g' },
        { tag: 'T2', text: 'Missing', datatype: 'A_Hold_I16_N', addr: 1499, rw: 'r', group: 'g' },
        { tag: 'T3', text: 'Coil', datatype: 'Coil_X_N', addr: 2, rw: 'rw', group: 'g' },
    ],
});

// --- a scan, no poll: 1 386 registers across two tables, the plant-2349 figure,
// with a hole at 1490-1510 the device refused, as a strict one does.
const values = [];
for (let i = 1; i <= 921; i++) { const ref = 1000 + i; if (ref >= 1490 && ref <= 1510) continue; values.push({ table: '4', i: ref, addr: ref - 1, v: i % 7 ? i : 0 }); }
for (let i = 1; i <= 486; i++) values.push({ table: '3', i, addr: i - 1, v: i % 5 ? i * 2 : 0 });
const at = (table, ref) => values.find(v => v.table === table && v.i === ref);
at('4', 1001).v = 34;
at('4', 1003).v = 16812; at('4', 1004).v = 0;          // 0x41AC 0x0000 = 21.5f
at('4', 1006).v = 9;                                   // bits 0 and 3 set
at('4', 1008).v = 1; at('4', 1009).v = -7616;          // 0x0001 0xE240 = 123456, the low word as modpoll prints it
at('4', 1012).v = -50;
for (const v of values) v.again = v.v;
at('4', 1010).again = 77;                              // moved between the two reads
at('4', 1010).changed = true;
lastScan = {
    at: new Date().toISOString(), host: '192.168.10.30', slave: 9, elapsedMs: 61000,
    tables: { '4': { answers: true }, '3': { answers: true }, '1': { answers: false }, '0': { answers: false } },
    sweep: { '4': { answered: 900, first: 1001, last: 1921 }, '3': { answered: 486, first: 1, last: 486 } },
    reread: { at: new Date().toISOString(), runs: 2, reread: 1386, changed: 1, changedRanges: { '4': '1010' }, commands: 16, elapsedMs: 1200, secondsAfterStart: 60 },
    // The width verdicts a scan ends with: the holding map holds both kinds,
    // the input map reads as floats from 101 and a float read proved it.
    formats: {
        '4': { regions: [{ from: 1001, to: 1921, format: 'mixed', wordOrder: 'high word first', alignStart: 1001, confidence: 'plant',
            pairs: { plausible: 2, tested: 440 }, evidence: 'the plant reads 3 registers here at a 16-bit scale and 2 pairs as 32-bit — see each row' }] },
        '3': { regions: [{ from: 1, to: 486, format: 'float32', wordOrder: 'high word first', alignStart: 101, confidence: 'wire',
            pairs: { plausible: 190, tested: 240 }, evidence: '190 of 240 pairs from 101 read as floats, high word first; a float read printed the same numbers' }] },
    },
    modpoll: { bigEndianFlag: 'high word first', measured: true, table: '3', ref: 101, pairs: 4, compared: 4, matchedInOrder: 4 },
    suggestedSpec: { table: '4', format: '', bigEndian: false, base: 'printed', start: 1001, count: 921, assumedFlag: false, why: ['holding registers hold the most values'] },
    values,
};

const doc = exportResult(lastResult);
const text = exportText(doc);
const row = ref => doc.scanReadings.find(r => r.table === '4' && r.ref === ref);
const row3 = ref => doc.scanReadings.find(r => r.table === '3' && r.ref === ref);
const param = (table, ref) => doc.plantParameters.find(r => r.table === table && r.ref === ref);
const point = tag => doc.listPoints.find(r => r.name.indexOf(tag) === 0);
const checks = [];
const check = (what, ok, detail) => checks.push({ what, ok: !!ok, detail });

check('scanReadings carry every scanned register', doc.scanReadings.length === 1386, doc.scanReadings.length);
check('a scaled 16-bit register: impliedScale x0.1, suggest A_Hold_I16_N x0.1',
    row(1001).impliedScale === 'x0.1' && row(1001).suggest && row(1001).suggest.datatype === 'A_Hold_I16_N' && row(1001).suggest.scale === 'x0.1',
    JSON.stringify({ impliedScale: row(1001).impliedScale, suggest: row(1001).suggest }));
check('a float over two registers: wide confirmed by the plant, high word first',
    row(1003).wide && row(1003).wide[0].as === 'float32' && row(1003).wide[0].wordOrder === 'high word first' && row(1003).wide[0].confirmed && Math.abs(row(1003).wide[0].value - 21.5) < 1e-6,
    JSON.stringify(row(1003).wide));
check('... suggests A_Hold_F_N', row(1003).suggest && row(1003).suggest.datatype === 'A_Hold_F_N', JSON.stringify(row(1003).suggest));
check('... and notes that the list declares it 16-bit',
    (row(1003).notes || []).some(n => /32-bit point/.test(n)) && (row(1003).notes || []).some(n => /list declares A_Hold_I16_N/.test(n)),
    JSON.stringify(row(1003).notes));
check('a status word: suggest Bit_Hold with one entry per bit, and each bit\'s state read',
    row(1006).suggest && row(1006).suggest.datatype === 'Bit_Hold' && row(1006).suggest.bits.length === 2 &&
        row(1006).plant[0].reads === 1 && row(1006).plant[1].reads === 1,
    JSON.stringify({ suggest: row(1006).suggest, plant: row(1006).plant }));
check('a 32-bit counter: wide confirmed as an integer, high word first = 123456, suggest I_Hold_U32_N',
    row(1008).wide && row(1008).wide.some(w => w.as === 'int32' && w.wordOrder === 'high word first' && w.value === 123456 && w.confirmed) &&
        row(1008).suggest && row(1008).suggest.datatype === 'I_Hold_U32_N',
    JSON.stringify({ wide: row(1008).wide, suggest: row(1008).suggest }));
check('a negative writable setpoint: I16, rw, x0.1',
    row(1012).suggest && row(1012).suggest.datatype === 'A_Hold_I16_N' && row(1012).suggest.rw === 'rw' && row(1012).suggest.scale === 'x0.1',
    JSON.stringify(row(1012).suggest));
check('a register that moved: reread, changed and delta on the row',
    row(1010).reread === 77 && row(1010).changed === true && row(1010).delta === 77 - row(1010).raw,
    JSON.stringify({ raw: row(1010).raw, reread: row(1010).reread, changed: row(1010).changed, delta: row(1010).delta }));
check('an unmoved register carries reread and no changed', row(1002).reread === row(1002).raw && row(1002).changed === undefined,
    JSON.stringify({ raw: row(1002).raw, reread: row(1002).reread, changed: row(1002).changed }));
check('no float candidates invented on ordinary rows — not even below a real float, whose high word would fit the other order',
    doc.scanReadings.filter(r => r.wide && r.wide.some(w => w.candidate)).length === 0,
    doc.scanReadings.filter(r => r.wide && r.wide.some(w => w.candidate)).map(r => r.ref + ' ' + JSON.stringify(r.wide)).join('; '));
check('plantParameters: a hole inside the swept map is named as one', param('4', 1500) && /hole/.test(param('4', 1500).scan), param('4', 1500) && param('4', 1500).scan);
check('plantParameters: beyond the swept map is named as such', param('4', 5000) && /beyond/.test(param('4', 5000).scan), param('4', 5000) && param('4', 5000).scan);
check('plantParameters: a silent table is named as such', param('0', 3) && /no answer at all/.test(param('0', 3).scan), param('0', 3) && param('0', 3).scan);
check('plantParameters holds only what no reading carries', doc.plantParameters.length === 3, doc.plantParameters.length);
check('listPoints: a point the scan answered carries its raw value', point('T1') && point('T1').scan === 'answered' && point('T1').scanRaw === 16812, JSON.stringify(point('T1')));
check('listPoints: a point in a hole says so', point('T2') && /hole/.test(point('T2').scan), point('T2') && point('T2').scan);
check('listPoints: a point in a silent table says so', point('T3') && /no answer at all/.test(point('T3').scan), point('T3') && point('T3').scan);
check('scan block carries the second read', doc.scan && doc.scan.reread && doc.scan.reread.changed === 1, JSON.stringify(doc.scan && doc.scan.reread));
check('scan block carries the width verdicts, the measured flag and the poll the form was set to',
    doc.scan.formats && doc.scan.formats['3'] && doc.scan.modpoll && doc.scan.modpoll.measured && doc.scan.suggestedSpec && doc.scan.suggestedSpec.table === '4',
    JSON.stringify({ modpoll: doc.scan.modpoll, suggestedSpec: doc.scan.suggestedSpec }));
check('a row in a wire-proved float region: regionFormat, and a datatype suggested from the verdict alone at the start of a pair',
    row3(101).regionFormat === 'float32, high word first (wire)' && row3(101).suggest && row3(101).suggest.datatype === 'A_Input_F_N' && !row3(101).suggest.name,
    JSON.stringify({ regionFormat: row3(101).regionFormat, suggest: row3(101).suggest }));
check('... the second half of a pair carries the verdict and no suggestion', row3(102).regionFormat === 'float32, high word first (wire)' && row3(102).suggest === undefined,
    JSON.stringify({ regionFormat: row3(102).regionFormat, suggest: row3(102).suggest }));
check('a row in a mixed region carries the verdict and no suggestion from it', row(1002).regionFormat === 'mixed, high word first (plant)' && row(1002).suggest === undefined,
    JSON.stringify({ regionFormat: row(1002).regionFormat, suggest: row(1002).suggest }));
check('... while a plant-named row in it keeps its own suggestion', row(1003).suggest && row(1003).suggest.datatype === 'A_Hold_F_N' && row(1003).suggest.name === 'Romtemp',
    JSON.stringify(row(1003).suggest));
check('summary from the scan says how many changed', doc.summary && doc.summary.source === 'scan' && doc.summary.changed === 1, JSON.stringify(doc.summary));
check('device rests on the scan', doc.device.readingSource === 'scan' && doc.device.host === '192.168.10.30', JSON.stringify(doc.device));
check('names: the list names the row it covers, so the list is the source named', doc.names === 'point list', doc.names);
check('howToUse explains reread, wide, suggest and scan.formats', ['reread', 'wide', 'suggest', 'scan.formats'].every(k => doc.howToUse.some(line => line.indexOf(k) === 0)), '');
check('the file parses', (() => { try { JSON.parse(text); return true; } catch (e) { return false; } })(), text.length + ' chars');

let failed = 0;
for (const c of checks) {
    if (!c.ok) failed++;
    console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.what + (c.ok ? '' : '\n      ' + String(c.detail)));
}
console.log((failed ? failed + ' FAILED' : 'all ' + checks.length + ' passed') + ' — file ' + text.length + ' characters, ' +
    doc.scanReadings.filter(r => r.suggest).length + ' suggestions, ' + doc.scanReadings.filter(r => r.wide).length + ' rows with a 32-bit reading');
process.exit(failed ? 1 : 0);
"""

out = Path(os.environ.get("TEMP", ".")) / "mpc-export-check.js"
io.open(out, "w", encoding="utf-8").write(js)
r = subprocess.run(["node", str(out)], capture_output=True, text=True, encoding="utf-8")
print(r.stdout or "")
if r.stderr:
    print(r.stderr[:3000])
sys.exit(r.returncode)
