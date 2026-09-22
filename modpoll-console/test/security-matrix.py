"""Security matrix for the Modpoll Console command guard.

Lifts the command model — constants, the guard, normaliseSpec, buildCommand,
planBlocks, the chaining — verbatim from the shipped userscript and runs it in
Node, so what is tested is the code that ships rather than a copy of it.

Four questions, each answered against that code:
  1. Does every command the form can produce still build and pass the guard?
  2. Do the command shapes the tool emits in the field still pass?
  3. Is every attack shape refused?
  4. Are the parity spellings a list or the API may send normalised?

Lives beside the script it tests. Run: python security-matrix.py
"""

import io
import os
import subprocess
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "Modpoll-Console.user.js"

src = io.open(SRC, encoding="utf-8", newline="").read()


def lift(start, end):
    return src[src.index(start):src.index(end)]


js = "globalThis.window = globalThis; globalThis.location = {hostname: '2349.plants.iwmac.local'};\n"
js += "const isSerialMode = mode => mode === 'rtu' || mode === 'ascii';\n"
js += lift("    const EXE_BARE", "    // ------------------------------------------------------- output parsing")
js += lift("    function splitByMarker", "    async function readRegisters")
js += r"""
let built = 0;
const refusedLegit = [], allowedAttack = [], wrongNorm = [];

// 1. Every combination the selects on the form can produce, built and guarded
//    the way readRegisters builds and guards it.
for (const mode of ['tcp', 'rtu', 'enc', 'ascii'])
 for (const format of ['', 'int', 'float', 'mod', 'hex'])
  for (const bigEndian of [false, true])
   for (const port of [502, 4001])
    for (const table of ['4', '3', '1', '0'])
     for (const count of [1, 99, 250])
      for (const [baudrate, parity, databits, stopbits] of [['9600', 'none', '8', '1'], ['19200', 'even', '7', '2'], ['38400', 'odd', '8', '2']]) {
        const host = isSerialMode(mode) ? 'COM3' : (port === 502 ? '192.168.10.100' : 'plant-gw.iwmac.local');
        try {
          const spec = normaliseSpec({ mode, host, port, slave: 1, table, start: 1, count, format, bigEndian, baudrate, parity, databits, stopbits });
          const blocks = planBlocks(spec);
          for (let bi = 0; bi < blocks.length;) {
            const n = chainableCount(spec, blocks.slice(bi));
            chainBlocks(spec, blocks.slice(bi, bi + n));
            bi += n;
            built++;
          }
        } catch (e) {
          refusedLegit.push(mode + ' ' + (format || '16') + ' t' + table + ' c' + count + ': ' + e.message);
        }
      }

// 2. Shapes the tool emits in the field: both executable spellings, the full
//    path fallback, an IPv6 host, a COM port above 9, a gateway on 4001, a
//    chained sweep, a chained probe.
for (const cmd of [
  'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100',
  'modpoll.exe -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100',
  'c:\\iwmac\\bin\\modpoll.exe -1 -m tcp -a 1 -t 4:float -r 1 -c 1 fe80::1',
  'MODPOLL -1 -m rtu -a 2 -t 3 -r 100 -c 5 -b 9600 -d 8 -s 1 -p none \\\\.\\COM10',
  'modpoll -1 -m enc -a 1 -t 4 -r 1 -c 1 -p 4001 192.168.10.30',
  'echo #mpc:1 & modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 99 192.168.10.100 & echo #mpc:100 & modpoll -1 -m tcp -a 1 -t 4 -r 100 -c 99 192.168.10.100',
  'echo #mpc:4:100 & modpoll -1 -m tcp -a 1 -t 4 -r 100 -c 1 192.168.10.100 & echo #mpc:3:100 & modpoll -1 -m tcp -a 1 -t 3 -r 100 -c 1 192.168.10.100',
]) {
  try { assertReadOnly(cmd); } catch (e) { refusedLegit.push('field shape: ' + cmd + ' -> ' + e.message); }
}

// 3. Attacks. Every one must be refused, whether typed as a command or passed
//    to the API as a spec.
const attacks = {
  'UNC executable':          '\\\\attacker\\share\\modpoll.exe -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100',
  'other path with modpoll': 'c:\\temp\\modpoll.exe -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100',
  'quoted pipe in -r':       'modpoll -1 -m tcp -a 1 -t 4 -r "1 | del c:\\x" -c 1 192.168.10.100',
  'newline inside quotes':   'modpoll -1 -m tcp -a 1 -t 4 -r "1\ndel c:\\x" -c 1 192.168.10.100',
  'CR inside quotes':        'modpoll -1 -m tcp -a 1 -t 4 -r "1\rdel" -c 1 192.168.10.100',
  'bare newline':            'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100\ndel c:\\x',
  'pipe':                    'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100 | del c:\\x',
  'redirect':                'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100 > c:\\x',
  '&& chain':                'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100 && del c:\\x',
  'variable as host':        'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 %COMSPEC%',
  'caret escape':            'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100^&del',
  'write +7':                'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100 7',
  'write -7':                'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100 -7',
  'write hex':               'modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100 0x10',
  'echo that is not a marker': 'echo hello & modpoll -1 -m tcp -a 1 -t 4 -r 1 -c 1 192.168.10.100',
  'spec: host with pipe':    { spec: { mode: 'tcp', host: '10.0.0.5 | del x', slave: 1 } },
  'spec: quoted host with newline': { spec: { mode: 'tcp', host: '"10.0.0.5\ndel x"', slave: 1 } },
  'spec: parity injection':  { spec: { mode: 'rtu', host: 'COM3', parity: 'none | del x' } },
  'spec: baud injection':    { spec: { mode: 'rtu', host: 'COM3', baudrate: '9600 & del x' } },
  'spec: mode injection':    { spec: { mode: 'tcp; del x', host: '10.0.0.5' } },
};
for (const [name, a] of Object.entries(attacks)) {
  try {
    if (typeof a === 'string') assertReadOnly(a);
    else { const spec = normaliseSpec(a.spec); chainBlocks(spec, planBlocks(spec)); }
    allowedAttack.push(name);
  } catch (e) { /* refused, as it should be */ }
}

// 4. Parity spellings a point list or the API may send.
for (const [given, want] of [['N', 'none'], ['E', 'even'], ['O', 'odd'], ['0', 'none'], ['1', 'odd'], ['2', 'even'], ['none', 'none'], ['EVEN', 'even'], [undefined, 'none']]) {
  try {
    const got = normaliseSpec({ mode: 'rtu', host: 'COM3', parity: given }).parity;
    if (got !== want) wrongNorm.push(given + ' -> ' + got);
  } catch (e) { wrongNorm.push(given + ' threw: ' + e.message); }
}

console.log('legit command lines built and guarded: ' + built);
console.log(refusedLegit.length ? 'LEGIT REFUSED:\n  ' + refusedLegit.join('\n  ') : 'legit refused: none');
console.log(allowedAttack.length ? 'ATTACKS ALLOWED: ' + allowedAttack.join(', ') : 'attacks allowed: none of ' + Object.keys(attacks).length);
console.log(wrongNorm.length ? 'PARITY WRONG: ' + wrongNorm.join(', ') : 'parity spellings: all 9 normalised');
process.exit(refusedLegit.length || allowedAttack.length || wrongNorm.length ? 1 : 0);
"""

out = Path(os.environ.get("TEMP", ".")) / "mpc-security.js"
io.open(out, "w", encoding="utf-8").write(js)
r = subprocess.run(["node", str(out)], capture_output=True, text=True)
print(r.stdout)
if r.stderr:
    print(r.stderr[:1500])
raise SystemExit(r.returncode)
