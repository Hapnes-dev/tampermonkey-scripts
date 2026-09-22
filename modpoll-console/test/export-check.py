"""Does Save JSON carry a scan's readings? Checked against the shipped code.

Lifts exportResult/exportText out of Modpoll-Console.user.js and runs it in Node
with a scan in hand and no poll at all - the case the button is most likely to
meet, and the one that produced a file with the shape of the map and none of its
data until 1.42.0.

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
js += "let pointList = null, plantNames = null, lastVerification = null, _unitsCache = null;\n"
js += "let lastResult = null, lastScan = null;\n"
js += "const resultFilename = () => 'modpoll_test.json';\n"
js += lift("    const REGISTER_TABLES = [", "\n    // Serial defaults per driver family")
js += lift("    const FORMATS = [", "\n    const TOOLBOX_SQL_URL")
js += lift("    function roundScaled(value, decimals) {", '\n    /** "x0.1" and friends.')
js += lift("    /** Runs of consecutive numbers", "\n    /**\n     * One block of text describing a poll")
js += "const plantIdFromHost = () => '2349';\n"
js += "const pointForReading = () => null;\n"
js += "const plantNamesFor = (t, f, ref) => (ref === 1001 ? [{ name: 'Sug trykk', plantValue: '3.4', unit: 'bar', bit: null, group: 'Status', access: 'r', driverId: '2349_EKC_ekc_0_9_0_3_1000', protocol: 1000 }] : null);\n"
js += "const enrichValue = (v, table, format) => { const p = plantNamesFor(table, format, v.i); const e = p && p[0]; return { ref: v.i, addr: v.addr, raw: v.v, name: e ? e.name : '', unit: e ? e.unit : '', shown: e ? e.plantValue : '', type: e ? 'plant:' + e.group : '', writable: false, bits: 0, source: e ? 'plant' : '' }; };\n"
js += "const watchDelta = new Map();\n"
js += lift("    /**\n     * Everything the console knows, as a document", "\n    /*\n     * Where does this device actually keep anything?")
js += r"""
// A scan, no poll: 1 386 registers across two tables, the plant-2349 figure.
const values = [];
for (let i = 1; i <= 900; i++) values.push({ table: '4', i: 1000 + i, addr: 999 + i, v: i % 7 ? i : 0 });
for (let i = 1; i <= 486; i++) values.push({ table: '3', i, addr: i - 1, v: i % 5 ? i * 2 : 0 });
lastScan = { at: new Date().toISOString(), host: '192.168.10.30', slave: 9,
             tables: { '4': { answers: true }, '3': { answers: true } },
             sweep: { '4': { answered: 900 } }, values };

const doc = exportResult(lastResult);
const text = exportText(doc);
const byTable = {};
for (const r of doc.scanReadings) byTable[r.table] = (byTable[r.table] || 0) + 1;
const named = doc.scanReadings.filter(r => r.name).length;
const withPlant = doc.scanReadings.filter(r => r.plant).length;
const withHex = doc.scanReadings.filter(r => r.hex).length;
console.log(JSON.stringify({
    scanReadings: doc.scanReadings.length,
    byTable,
    pollReadings: doc.readings.length,
    named, withPlant, withHex,
    sample: doc.scanReadings.find(r => r.name) || null,
    device: doc.device,
    summaryReturned: doc.summary && doc.summary.returned,
    summarySource: doc.summary && doc.summary.source,
    names: doc.names,
    fileChars: text.length,
    parses: (() => { try { JSON.parse(text); return true; } catch (e) { return false; } })(),
}, null, 1));
"""

out = Path(os.environ.get("TEMP", ".")) / "mpc-export-check.js"
io.open(out, "w", encoding="utf-8").write(js)
r = subprocess.run(["node", str(out)], capture_output=True, text=True, encoding="utf-8")
print(r.stdout or r.stderr[:2000])
