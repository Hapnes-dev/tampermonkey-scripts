"""Does Save JSON say what an agent needs after a scan? Checked against the shipped code.

Lifts the export - and everything it enriches a row with - out of
Modpoll-Console.user.js and runs it in Node with a scan in hand and no poll at
all, the case the button is most likely to meet, against a unit whose plant
parameters cover the shapes a point list has to get right: a scaled 16-bit
register, a float over two registers, a 32-bit counter, a status word read by
bits, a register that moved between the sweep and the second read, and
parameters on registers the scan did not find. Then the same scan with IWMAC's
own side of the unit in hand - its driver set differently from how the device
answered, its definitions, its log - for the comparisons and the findings; and
the driver log's reader on lines as plant 3694's driver wrote them. Each
expectation is printed as PASS or FAIL and the script exits non-zero on any FAIL.

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
js += "let lastResult = null, lastScan = null, pointList = null, plantNames = null, iwmacContext = null;\n"
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
# The driver log's reader and the two parsers of IWMAC's own settings.
js += lift("    // What a driver's log line reports, by the wording", "\n    /** \"3_0_F_W_")
js += lift("    /** \"3_0_F_W_", "\n    async function collectIwmacContext")
js += lift("    /** A driver's settings read as the connection they describe. */", "\n    // ------------------------------------------------------- binary self-probe")
# What a verification looks like on its way out.
js += lift("    /**\n     * A verification as it may leave the browser", "\n    /** One markdown file per part")
# What may be put into SQL.
js += lift("    const RE_SQL_NAME = ", "\n    async function plantSql")
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

// --- the same scan, now with IWMAC's own side of the unit read -----------------
// The driver is set to 19200 where modpoll got answers at 9600; the unit is in
// ERROR with timeouts in its log; another driver claims the same COM port; two
// units share an address; and one parameter is defined unsigned where the
// device holds a negative number.
// The parameter table keys a definition by the short driver_id; the unit's
// parameters and the driver log carry the whole one.
const did = (ref, bit) => '0_3_' + (ref - 1) + (bit === undefined ? '' : '.' + bit);
const fullId = (ref, bit) => '2349_EKC_ekc_0_9_' + did(ref, bit);
const def = (rawType, scaleKey, extra) => Object.assign({
    elementId: 'e' + Math.random(), access: 'r', unit: '', format: '',
    scale: scaleKey === 'x0.1' ? { mode: '1', rawMin: '0', rawMax: '1000', engMin: '0', engMax: '100' } : { mode: '', rawMin: '', rawMax: '', engMin: '', engMax: '' },
    datatype: { readFunction: 3, readAddr: 0, rawType, swap: 'N', writeFunction: null }, active: true,
}, extra || {});
const definitions = {};
definitions[did(1001)] = def('I16', 'x0.1');
definitions[did(1003)] = def('F', '');
definitions[did(1006, 0)] = def('U16', ''); definitions[did(1006, 3)] = def('U16', '');
definitions[did(1008)] = def('U32', '');
definitions[did(1012)] = def('U16', 'x0.1');                       // wrong: the device holds -50
definitions[did(1500)] = def('I16', '', { onlineIndicator: true });   // the online indicator, in the hole
lastScan.spec = { mode: 'rtu', host: '\\\\.\\COM16', port: null, slave: 9, baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' };
lastScan.tables['0'] = { answers: true };
for (let i = 1; i <= 40; i++) values.push({ table: '0', i, addr: i - 1, v: 0, again: 0 });   // coils that answer and hold nothing
iwmacContext = {
    unitId: 'ID01', collectedAt: new Date().toISOString(), unavailable: [],
    status: { unitStatus: 'ERROR', lastComm: '', unitAddr: '0_9', table: 'ekc' },
    registration: { unitId: 'ID01', unitName: 'EKC 1', driver: 'EKC', driverAddr: '0_9', table: 'ekc', active: true },
    driver: {
        owner: 'EKC', module: { running: true, secondsInState: 300 }, plantServerRunning: true, process: { name: 'EKC', path: 'iw_mb.exe', manualStart: false },
        settings: { mb_mode: '0', comm_port: '16', comm_baudrate: '19200', comm_parity: '0', comm_data_bits: '8', comm_stop_bits: '1' },
        connection: { mode: 'rtu', serial: true, slave: 9, serverKey: '0', comPort: 'COM16', comPortRaw: '16', baudrate: '19200', parity: 'none', databits: '8', stopbits: '1' },
    },
    parameters: { table: 'ekc', definitions, count: 7, inactive: 0 },
    bus: {
        unitsOnDriver: [{ unitId: 'ID01', driverAddr: '0_9', active: true }, { unitId: 'ID02', driverAddr: '0_9', active: true }],
        driversOnSamePort: [{ owner: 'OTHER', mbMode: '0', activeUnits: 2 }],
    },
    log: {
        source: 'test', owner: 'EKC', lines: 12, lastStart: '2026-09-24T10:00:00.000Z', counts: { timeout: 9, offline: 2, started: 1 },
        current: { since: '2026-09-24T10:00:00.000Z', after: 'the driver last started', counts: { timeout: 6, offline: 1 } },
        otherUnits: { ID07: { lines: 4, kinds: { offline: 2, online: 2 } } },
        byDriverId: {
            [fullId(1001)]: { errors: 3, kinds: { timeout: 3 }, last: { at: '2026-09-24T11:00:00.000Z', text: 'Time Out Error' } },
            [fullId(1012)]: { errors: 1, kinds: { timeout: 1 }, last: { at: '2026-09-23T11:00:00.000Z', text: 'Time Out Error' } },   // before the start
        },
        recent: ['a', 'b'],
    },
};
plantNames.system = [{ name: 'Communication error', shown: '1', unit: '', group: 'System', driverId: '2349_EKC_ekc_0_9_0_COM_ERR' }];
const doc2 = exportResult(null);
const text2 = exportText(doc2);
const r2 = ref => doc2.scanReadings.find(r => r.table === '4' && r.ref === ref);
const finding = id => doc2.findings.find(f => f.id === id);
check('schemaVersion 2, with overview, findings, fieldGuide, communication and iwmac',
    doc2.schemaVersion === 2 && doc2.overview && Array.isArray(doc2.findings) && doc2.fieldGuide && doc2.communication && doc2.iwmac, Object.keys(doc2).join(','));
check('empty coils leave scanReadings for scanEmpty as ranges; the one the plant and the list name keeps its row',
    doc2.scanReadings.filter(r => r.table === '0').map(r => r.ref).join() === '3' &&
    doc2.scanEmpty.some(e => e.table === '0' && e.count === 39 && e.ranges === '1-2,4-40'), JSON.stringify(doc2.scanEmpty));
check('overview counts the registers that answered, empty ones included', doc2.overview.device.registersAnswering === 1386 + 40, JSON.stringify(doc2.overview.device));
check('IWMAC decodes 1001 as I16 x0.1 = 3.4 and agrees with its 3.4', r2(1001).plant[0].iwmac.expected === 3.4 && r2(1001).plant[0].iwmac.agrees === true,
    JSON.stringify(r2(1001).plant[0].iwmac));
check('IWMAC decodes 1003-1004 as a float = 21.5 and agrees with its "21,5"', r2(1003).plant[0].iwmac.expected === 21.5 && r2(1003).plant[0].iwmac.agrees === true,
    JSON.stringify(r2(1003).plant[0].iwmac));
check('a bit parameter decodes to its bit', r2(1006).plant[1].iwmac.expected === 1, JSON.stringify(r2(1006).plant[1].iwmac));
check('a parameter defined unsigned where the device holds -50 disagrees', r2(1012).plant[0].iwmac.agrees === false && r2(1012).plant[0].iwmac.expected === 6548.6,
    JSON.stringify(r2(1012).plant[0].iwmac));
check('the log\'s errors for a parameter ride on it', r2(1001).plant[0].iwmac.logErrors && r2(1001).plant[0].iwmac.logErrors.count === 3, JSON.stringify(r2(1001).plant[0].iwmac.logErrors));
check('communication compares field by field: baud differs, COM16 matches \\\\.\\COM16',
    doc2.communication.comparison.find(c => c.field === 'baudrate').same === false && doc2.communication.comparison.find(c => c.field === 'comPort').same === true,
    JSON.stringify(doc2.communication.comparison));
check('finding: connection settings differ, and it is an error', finding('connection-settings-differ') && finding('connection-settings-differ').severity === 'error',
    JSON.stringify(finding('connection-settings-differ')));
check('finding: the device answers but IWMAC is not receiving', !!finding('iwmac-not-receiving'), doc2.findings.map(f => f.id).join(','));
check('finding: another driver on the same COM port', !!finding('port-shared-by-drivers'), doc2.findings.map(f => f.id).join(','));
check('finding: two units at one address', !!finding('duplicate-unit-address'), doc2.findings.map(f => f.id).join(','));
// Coil 3 answers now, so of the three unanswered before, 1500 and 5000 are left.
check('finding: IWMAC polls registers the device did not answer', finding('mapped-registers-not-answering') && finding('mapped-registers-not-answering').evidence.count === 2,
    JSON.stringify(finding('mapped-registers-not-answering')));
check('finding: IWMAC shows a value its own definition does not give', finding('iwmac-value-differs') && finding('iwmac-value-differs').evidence.count === 1,
    JSON.stringify(finding('iwmac-value-differs')));
check('findings are sorted errors first', doc2.findings.every((f, i, a) => i === 0 || ['error', 'warning', 'info'].indexOf(a[i - 1].severity) <= ['error', 'warning', 'info'].indexOf(f.severity)),
    doc2.findings.map(f => f.severity).join(','));
check('definitions keyed 0_3_1000 are found for the unit\'s 2349_EKC_ekc_0_9_0_3_1000', r2(1001).plant[0].iwmac.datatype === 'I16' && r2(1001).plant[0].iwmac.scale === 'x0.1',
    JSON.stringify(r2(1001).plant[0].iwmac));
check('finding: the online indicator sits on a register the device does not answer', finding('online-indicator-not-answering') &&
    finding('online-indicator-not-answering').evidence.parameters[0].ref === 1500, JSON.stringify(finding('online-indicator-not-answering')));
check('finding: other units on the driver fail too', !!finding('other-units-failing'), doc2.findings.map(f => f.id).join(','));
check('parameters-with-driver-errors counts only errors since the driver last started', finding('parameters-with-driver-errors') &&
    finding('parameters-with-driver-errors').evidence.count === 1, JSON.stringify(finding('parameters-with-driver-errors')));
check('iwmac-not-receiving quotes the log since the last start', /6 timeout, 1 offline in the driver log since the driver last started/.test(finding('iwmac-not-receiving').detail),
    finding('iwmac-not-receiving').detail);
check('overview names the unit\'s table from its registration', doc2.overview.unit.table === 'ekc', JSON.stringify(doc2.overview.unit));

// --- the driver log, read for one unit -----------------------------------------
// Lines as plant 3694's TIANJINEX3 wrote them, newest first: this unit's items
// at 0_11 and another unit's at 0_13 on the same driver, both units' OFFLINE,
// a start, and this unit coming back online after an old timeout.
const ms = m => new Date(Date.UTC(2026, 8, 24, 10, m)).toISOString();
const entries = [
    { at: ms(50), level: 3, text: 'Block (norm, 0) item 3694_TIANJINEX3_tianjin_sure_inst_ex3_0_11_0_3_62 >> Modbus read error >> Time Out Error' },
    { at: ms(49), level: 3, text: 'Block (norm, 0) item 3694_TIANJINEX3_tianjin_sure_inst_ex3_0_13_0_3_62 >> Modbus read error >> Time Out Error' },
    { at: ms(48), level: 3, text: 'Unit ID02 is OFFLINE' },
    { at: ms(47), level: 3, text: 'Block (norm, 0) item 3694_TIANJINEX3_tianjin_sure_inst_ex3_0_11_0_3_40001 >> Modbus read error >> Time Out Error' },
    { at: ms(40), level: 0, text: 'Unit ID01 is ONLINE' },
    { at: ms(30), level: 3, text: 'Block (norm, 0) item 3694_TIANJINEX3_tianjin_sure_inst_ex3_0_11_0_3_30 >> Modbus read error >> Time Out Error' },
    { at: ms(20), level: 0, text: 'Open ok, (IP address: 192.168.10.100, ID: 1, 1000)' },
    { at: ms(10), level: 0, text: 'Application TIANJINEX3 started.' },
    { at: ms(5), level: 1, text: 'Write failed 19423 = 1.00' },
];
const read = readDriverLog({ source: 'test', entries }, {
    owner: 'TIANJINEX3', unitId: 'ID01', table: 'tianjin_sure_inst_ex3',
    tablePrefix: '3694_TIANJINEX3_tianjin_sure_inst_ex3_', unitPrefix: '3694_TIANJINEX3_tianjin_sure_inst_ex3_0_11_',
});
check('driver log: another unit\'s items and OFFLINE are counted apart, by unit and by address',
    read.otherUnits && read.otherUnits.ID02 && read.otherUnits.ID02.kinds.offline === 1 && read.otherUnits['address 0_13'] && read.otherUnits['address 0_13'].kinds.timeout === 1,
    JSON.stringify(read.otherUnits));
check('driver log: current starts where this unit last came back online, after the start', read.current.since === ms(40) &&
    read.current.after === 'this unit last came back online' && read.current.counts.timeout === 2, JSON.stringify(read.current));
check('driver log: the whole window keeps the earlier timeout, the start, the connection and the failed write',
    read.counts.timeout === 3 && read.counts.started === 1 && read.counts.portOpened === 1 && read.counts.writeFailed === 1 && read.lastStart === ms(10), JSON.stringify(read.counts));
check('driver log: failed items are this unit\'s only, by full driver_id', Object.keys(read.byDriverId).length === 3 &&
    read.byDriverId['3694_TIANJINEX3_tianjin_sure_inst_ex3_0_11_0_3_40001'].kinds.timeout === 1, Object.keys(read.byDriverId).join(', '));
check('shortDriverId drops the unit prefix, even at unit address 0_9', shortDriverId('2349_EKC_ekc_0_9_0_3_1000') === '0_3_1000' &&
    shortDriverId('2349_OJEXHAUST_exhausto_OJ_v610_1_1_0_4_11') === '0_4_11' && shortDriverId('x_0_1_0_3_5.2') === '0_3_5.2' && shortDriverId('0_4_0') === '0_4_0',
    [shortDriverId('2349_EKC_ekc_0_9_0_3_1000'), shortDriverId('x_0_1_0_3_5.2')].join());
const tcp = describeDriverConnection({ mb_mode: '2', mb_tcp_servers: '1;192.168.10.100;502;1000;2;1000\r\n', mb_request_timeout: '1000', mb_request_retries: '2', comm_port: '3' }, '1_1');
check('a TCP driver: the server the unit\'s address names, and no COM port', tcp.mode === 'tcp' && tcp.host === '192.168.10.100' && tcp.port === 502 && tcp.slave === 1 &&
    tcp.serial === false && tcp.comPort === undefined && tcp.requestTimeoutMs === 1000, JSON.stringify(tcp));
const rtu = describeDriverConnection({ mb_mode: '0', comm_port: '16', comm_baudrate: '9600', comm_parity: '2', comm_data_bits: '8', comm_stop_bits: '1', packet_timeout: '1' }, '0_11');
check('a serial driver: COM16, 9600 even, slave 11', rtu.comPort === 'COM16' && rtu.parity === 'even' && rtu.slave === 11 && rtu.packetTimeout === 1, JSON.stringify(rtu));
const dt = parseDriverIdExtra('3_44101_I16_W_-_-_-_-');
check('driver_id_extra: 3_44101_I16_W — function 3, address 44101, I16 word-swapped, no write', dt.readFunction === 3 && dt.readAddr === 44101 && dt.rawType === 'I16' &&
    dt.swap === 'W' && dt.writeFunction === null, JSON.stringify(dt));
check('the IWMAC-side file parses', (() => { try { JSON.parse(text2); return true; } catch (e) { return false; } })(), text2.length + ' chars');

// --- what may leave the browser ---------------------------------------------------
// The clean fixture first: the sanitizer must not touch a thing in it. Only the two
// lines that explain [redacted] may carry the word.
const outside = d => JSON.stringify(Object.assign({}, d, { privacy: null, howToUse: null }));
check('a clean export carries no redaction outside the lines that explain it', outside(doc).indexOf('[redacted]') < 0 && outside(doc2).indexOf('[redacted]') < 0,
    (outside(doc2).match(/.{60}\[redacted\].{20}/) || [''])[0]);
check('text that only looks like a secret passes untouched', [
    'http://2349.plants.iwmac.local:8080/secure/sys_tools/', '2026-09-24T10:00:00.000Z', 'Open ok, (IP address: 192.168.10.100, ID: 1, 1000)',
    'Block (norm, 0) item 3694_TIANJINEX3_tianjin_sure_inst_ex3_0_11_0_3_62 >> Modbus read error >> Time Out Error',
    'modpoll -m tcp -a 1 -r 1 -c 99 -t 4 -p 502 192.168.10.100', 'Bypass damper', 'Passive defrost', 'Feilkode 3', 'key: value count 5',
].every(s => redactText(s) === s), '');
check('URL logins, Authorization and Cookie headers and key=value secrets are redacted', [
    ['GET http://admin:hunter2@10.0.0.5/cgi', 'GET http://[redacted]@10.0.0.5/cgi'],
    ['http://someone:s3cret@2349.plants.iwmac.local:8080/secure/', 'http://[redacted]@2349.plants.iwmac.local:8080/secure/'],
    ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: [redacted]'],
    ['Cookie: PHPSESSID=abc123; w2ui=1', 'Cookie: [redacted]'],
    ['login failed, password=hunter2 user=admin', 'login failed, password=[redacted] user=[redacted]'],
    ['token: "eyJhbGciOi"', 'token: [redacted]'],
].every(([a, b]) => redactText(a) === b), [
    'GET http://admin:hunter2@10.0.0.5/cgi', 'Authorization: Basic dXNlcjpwYXNz', 'login failed, password=hunter2 user=admin',
].map(redactText).join(' | '));

// IWMAC's side as it would arrive from an older collection, secrets and all: a
// driver's login in its settings, a log line with a URL login, a list whose comm
// block carries a password, and a register the plant names as a password.
iwmacContext.driver.settings = Object.assign({}, iwmacContext.driver.settings, { username: 'svc', password: 'hunter2', auth_key_service: 'k'.repeat(32) });
iwmacContext.log.recent = ['2026-09-24T10:00:00.000Z [error, other] GET http://admin:hunter2@10.0.0.5/cgi failed', '2026-09-24T10:01:00.000Z [info, other] password=hunter2'];
pointList.comm = { host: '192.168.10.30', port: 502, password: 'hunter2' };
put('4', 1100, { name: 'Passord service', plantValue: '1234' });
at('4', 1100).v = 1234; at('4', 1100).again = 1234;
const doc3 = exportResult(null);
const text3 = exportText(doc3);
const r3 = ref => doc3.scanReadings.find(r => r.table === '4' && r.ref === ref);
check('driver settings: username, password and API key withheld, the polling settings kept', doc3.iwmac.driver.settings.password === '[redacted]' &&
    doc3.iwmac.driver.settings.username === '[redacted]' && doc3.iwmac.driver.settings.auth_key_service === '[redacted]' &&
    doc3.iwmac.driver.settings.comm_baudrate === '19200' && doc3.iwmac.driver.settings.comm_port === '16', JSON.stringify(doc3.iwmac.driver.settings));
check('the driver log\'s lines lose the URL login and the password', doc3.iwmac.log.recent.join(' ').indexOf('hunter2') < 0 && /\[redacted\]@10\.0\.0\.5/.test(doc3.iwmac.log.recent[0]),
    doc3.iwmac.log.recent.join(' | '));
check('a list\'s comm block keeps host and port and loses its password', doc3.list.comm.password === '[redacted]' && doc3.list.comm.host === '192.168.10.30' && doc3.list.comm.port === 502,
    JSON.stringify(doc3.list.comm));
check('a register named as a password keeps its address and name, never its value', r3(1100) && r3(1100).raw === '[redacted]' && r3(1100).plant[0].shown === '[redacted]' &&
    r3(1100).withheld && r3(1100).addr === 1099 && r3(1100).plant[0].name === 'Passord service' && JSON.stringify(r3(1100)).indexOf('1234') < 0,
    JSON.stringify(r3(1100)));
check('privacy says how many registers were withheld', doc3.privacy && doc3.privacy.withheldRegisters === 1, JSON.stringify(doc3.privacy));
check('no secret of the fixture survives anywhere in the file', ['hunter2', 'kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk', '"svc"'].every(s => text3.indexOf(s) < 0), '');
check('the file with secrets withheld still parses', (() => { try { JSON.parse(text3); return true; } catch (e) { return false; } })(), text3.length + ' chars');

// Save verification and Save report take the same road.
const vf = verificationForExport({
    at: 'x', device: { host: '10.0.0.5', slave: 1, raw: 'modpoll http://u:p@h' }, list: { table: 't' },
    rows: [{ point: { name: 'Service password', ref: 5 }, status: 'read', raw: 4321, scaled: 4321 }, { point: { name: 'Supply temp', ref: 6 }, status: 'read', raw: 215, scaled: 21.5 }],
});
check('a verification leaves with the password point\'s value withheld and the rest intact', vf.rows[0].raw === '[redacted]' && vf.rows[0].scaled === '[redacted]' &&
    vf.rows[1].raw === 215 && vf.rows[1].scaled === 21.5 && vf.device.raw === 'modpoll http://[redacted]@h', JSON.stringify(vf));

// What reaches SQL: a unit id any page script can choose through __modpoll.names().
// The Toolbox API splits statements on a literal semicolon, so quoting is not enough.
const refusedSql = v => { try { sqlText(v); return false; } catch (e) { return true; } };
check('a unit id with a semicolon, a quote or a space is not a plain token', ["A'; SELECT * FROM mysql.user; -- ", 'ID01;', 'ID 01', "ID'01"].every(v => !RE_SQL_VALUE.test(v)) &&
    ['V01', 'ID01', 'VV_1', 'EM270-2', 'A.1'].every(v => RE_SQL_VALUE.test(v)), '');
check('sqlText refuses a semicolon or a control character outright, and still doubles a quote', refusedSql('a;b') && refusedSql('a\nb') && sqlText("O'Brien") === "O''Brien", '');

// The sanitizer on hostile shapes: nesting without end, a Map, a Date.
let deep = { v: 'x' };
for (let i = 0; i < 200; i++) deep = { next: deep };
const deepOut = (() => { try { return JSON.stringify(sanitizeDeep(deep)); } catch (e) { return 'threw ' + e.message; } })();
check('a document nested 200 deep is cut, not a stack overflow', deepOut.indexOf('nested too deep') >= 0, deepOut.slice(0, 80));
const kept = sanitizeDeep({ m: new Map([['password', 'x'], ['a', 'http://u:p@h/']]), d: new Date(0) });
check('Maps and Dates keep their shape through the sanitizer', kept.m instanceof Map && kept.m.get('password') === '[redacted]' && kept.m.get('a') === 'http://[redacted]@h/' &&
    kept.d instanceof Date, '');

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
