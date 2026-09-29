"""Word order and "view as": the decoder that stands in for iw_mb.exe, checked against plant 11087.

Lifts IWMAC_WORD_ORDER, decodeWords, decodeDatatype and the view catalogue out of
Modpoll-Console.user.js and runs them in Node on the registers plant 11087 returned on
2026-09-29, beside what IWMAC's own driver showed for them under each datatype: a
2000 l/s setpoint held low word first read as 2222981.15 under U32_W and correctly under
U32_N. So the suffixes are pinned to what the driver does, not to what the letters say.
Each expectation is printed as PASS or FAIL and the script exits non-zero on any FAIL.
Lives beside the script it tests. Run: python decode-check.py
"""
import io
import subprocess
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "Modpoll-Console.user.js"
src = io.open(SRC, encoding="utf-8", newline="").read()


def lift(start, end):
    return src[src.index(start):src.index(end)]


js = lift("    const IWMAC_WORD_ORDER = {", "\n    /*\n     * Two 16-bit registers read as one 32-bit value")
js += lift("    const DATATYPE_EXCEPTIONS = {", "\n    /**\n     * 434 × 0.1")
js += lift("    const VIEW_TYPES = [", "\n    /**\n     * The picker in a grid's type cell.")
js += r"""
let failed = 0;
const check = (name, ok, got) => {
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  -> ' + got));
    if (!ok) failed++;
};
const d = (words, type, swap) => decodeWords(words, type, swap);
const show = x => JSON.stringify(x);

// Plant 11087, 4x0171/0172 Börv.TF steg 1 (x0.01): the device holds 200000 low word first.
check('U32_N puts [3392, 3] together as 200000 - the 2000.00 l/s its 16-bit twin 4x0050 reads',
    d([3392, 3], 'U32', 'N').value === 200000, show(d([3392, 3], 'U32', 'N')));
check('U32_W puts the same words together as 222298115 - the 2222981.15 IWMAC showed under _W',
    d([3392, 3], 'U32', 'W').value === 222298115, show(d([3392, 3], 'U32', 'W')));
check('3x0191 SupplyFlow_m3/h [7192, 0] under _W is 471334912, as IWMAC showed',
    d([7192, 0], 'U32', 'W').value === 471334912, show(d([7192, 0], 'U32', 'W')));
check('... and 7192 under _N, the m3/h IWMAC showed once the list said _N',
    d([7192, 0], 'U32', 'N').value === 7192, show(d([7192, 0], 'U32', 'N')));
check('the word order comes from IWMAC_WORD_ORDER: N low word first, W high word first',
    d([1, 2], 'U32', 'N').wordOrder === 'low word first' && d([1, 2], 'U32', 'W').wordOrder === 'high word first',
    show([d([1, 2], 'U32', 'N'), d([1, 2], 'U32', 'W')]));
check('U32 is marked measured, I32 and floats assumed from it',
    d([1, 2], 'U32', 'N').measured === true && d([1, 2], 'I32', 'N').measured === false && d([0, 16812], 'F', 'N').measured === false,
    show([d([1, 2], 'U32', 'N'), d([1, 2], 'I32', 'N')]));
check('suffixForWordOrder: high word first is _W, low word first is _N',
    suffixForWordOrder('high word first') === '_W' && suffixForWordOrder('low word first') === '_N', '');
check('I32_W on [0xFFFF, 0xFFFE] is -2', d([-1, -2], 'I32', 'W').value === -2, show(d([-1, -2], 'I32', 'W')));
check('F_W on [16812, 0] is 21.5 (0x41AC0000)', d([16812, 0], 'F', 'W').value === 21.5, show(d([16812, 0], 'F', 'W')));
check('F_N on [0, 16812] is 21.5', d([0, 16812], 'F', 'N').value === 21.5, show(d([0, 16812], 'F', 'N')));
check('I16 keeps a negative word negative, U16 reads the same word unsigned',
    d([-200], 'I16', 'N').value === -200 && d([-200], 'U16', 'N').value === 65336, show([d([-200], 'I16', 'N'), d([-200], 'U16', 'N')]));
check('R swaps the bytes of a 16-bit word', d([0x0102], 'U16', 'R').value === 0x0201, show(d([0x0102], 'U16', 'R')));
check('a byte swap on a 32-bit value is not guessed',
    d([1, 2], 'U32', 'R').ok === false && /not been measured/.test(d([1, 2], 'U32', 'R').why), show(d([1, 2], 'U32', 'R')));
check('a 32-bit reading without the next word says so',
    d([3392], 'U32', 'N').ok === false && /next one/.test(d([3392], 'U32', 'N').why), show(d([3392], 'U32', 'N')));
check('hex shows both words in address order', d([3392, 3], 'U32', 'N').hex === '0x0D40 0x0003', show(d([3392, 3], 'U32', 'N')));
check('a raw type the decoder does not cover is refused, not guessed', d([5], 'X', 'N').ok === false, show(d([5], 'X', 'N')));

// A verification reads words and puts them together with decodeWords; decodeDatatype
// still steers a poll aimed with modpoll's own 32-bit format.
check('decodeDatatype keeps the swap letter',
    decodeDatatype('I_Input_U32_W').swap === 'W' && decodeDatatype('A_Hold_I16_N').swap === 'N', show(decodeDatatype('I_Input_U32_W')));
check('... and aims modpoll -i/-f only at _W, the suffix iw_mb.exe reads high word first',
    decodeDatatype('I_Input_U32_W').bigEndian === true && decodeDatatype('I_Input_U32_N').bigEndian === false &&
        decodeDatatype('A_Hold_I16_W').bigEndian === false,
    show([decodeDatatype('I_Input_U32_W'), decodeDatatype('I_Input_U32_N')]));

// The "view as" catalogue.
check('viewTypeOf resolves a view key, a raw type and a full datatype key',
    viewTypeOf('U32_N').key === 'U32_N' && viewTypeOf('I16').key === 'I16' &&
        viewTypeOf('A_Input_U32_W').key === 'U32_W' && viewTypeOf('i_hold_i16_n').key === 'I16', '');
check('viewTypeOf refuses what it cannot show', viewTypeOf('Coil_X_N') === null && viewTypeOf('') === null, '');
check('every view decodes: 16-bit from one word, 32-bit from two',
    VIEW_TYPES.every(t => decodeWords(viewWords(t, r => (r === 190 ? 0 : 16812), 190), t.raw, t.swap).ok), '');
check('a 32-bit view asks for the register and the next one', viewWords(viewTypeOf('U32_N'), r => r * 10, 190).join(',') === '1900,1910',
    viewWords(viewTypeOf('U32_N'), r => r * 10, 190).join(','));
check('viewValueText keeps integers whole and trims float noise', viewValueText(200000) === '200000' && viewValueText(21.500000953) === '21.5',
    viewValueText(21.500000953));

console.log(failed ? failed + ' failed' : 'all passed');
process.exit(failed ? 1 : 0);
"""

# A verification, end to end, against plant 11087's registers: the list parsed by the real
# parser, the ranges planned and the words put together by the real verifyPointList, and the
# device replaced by a map of what modpoll printed there.
js2 = "globalThis.window = globalThis; globalThis.location = { hostname: '11087.plants.iwmac.local' };\n"
js2 += "let abortRequested = false; const MAX_COUNT = 99; const OFFSET_WINDOW = 3;\n"
js2 += "const portProblem = () => null; const plantIdFromHost = () => '11087';\n"
js2 += lift("    const FORMATS = [", "\n    const TOOLBOX_SQL_URL")
js2 += lift("    const IWMAC_WORD_ORDER = {", "\n    /*\n     * Two 16-bit registers read as one 32-bit value")
js2 += lift("    const DATATYPE_EXCEPTIONS = {", "\n    /**\n     * Points become poll ranges")
js2 += lift("    function planPointRanges(", "\n    // ------------------------------------------- a report an agent can read")
js2 += r"""
// What modpoll printed on plant 11087, 2026-09-29; 16-bit words, signed as modpoll prints them.
const device = { '3|73': 220, '3|112': 2000, '3|191': 7210, '3|192': 0, '3|400': 3392, '3|401': 3, '3|969': -25536 };
const polled = [];
async function readRegisters(spec) {
    polled.push(spec.format + ':' + spec.table + ':' + spec.start + '+' + spec.count);
    const values = [];
    for (let i = spec.start; i < spec.start + spec.count; i++) values.push({ i, addr: i - 1, v: device[spec.table + '|' + i] || 0 });
    return { values, unreadable: [], commands: ['modpoll -1 -t ' + spec.table + ' -r ' + spec.start + ' -c ' + spec.count], diagnostics: [] };
}
let failed = 0;
const check = (name, ok, got) => {
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '  -> ' + got));
    if (!ok) failed++;
};
(async () => {
    const list = parsePointList({ options: { subtract_one: true }, points: [
        { datatype: 'A_Input_I16_N', addr: 73, text: 'Tilluftstemp.', scale: 'x0.1', decimals: 1 },
        { datatype: 'I_Input_U16_N', addr: 112, text: 'Akt.börv.TF' },
        { datatype: 'I_Input_U32_N', addr: 191, text: 'SupplyFlow_m3/h' },
        { datatype: 'A_Input_U32_W', addr: 400, text: 'Akt.börv.TF (3x0400)', scale: 'x0.01', decimals: 2 },
        { datatype: 'I_Input_U16_N', addr: 969, text: 'an unsigned word above 32767' },
    ] });
    const v = await verifyPointList(list, { mode: 'tcp', host: '192.168.1.40', port: 502, slave: 1 });
    const row = addr => v.rows.find(r => r.point.addr === addr);
    check('a verification reads every point as 16-bit words, never with modpoll\'s own 32-bit formats',
        polled.length > 0 && polled.every(p => p.indexOf(':') === 0), polled.join(' '));
    check('I_Input_U32_N reads 3x0191-0192 [7210, 0] low word first: 7210 m3/h', row(191).raw === 7210, JSON.stringify(row(191)));
    check('A_Input_U32_W reads 3x0400-0401 [3392, 3] as iw_mb.exe does under _W: 2222981.15, the value IWMAC showed',
        row(400).raw === 222298115 && row(400).scaled === 2222981.15, JSON.stringify(row(400)));
    check('... and says which word order it used, and that it is the driver\'s',
        (row(400).flags || []).some(f => /high word first as iw_mb\.exe reads _W/.test(f)), JSON.stringify(row(400).flags));
    check('16-bit points are unchanged: I16 x0.1 reads 22.0', row(73).raw === 220 && row(73).scaled === 22, JSON.stringify(row(73)));
    check('an unsigned 16-bit word above 32767 reads unsigned, not as modpoll printed it signed', row(969).raw === 40000, JSON.stringify(row(969)));
    check('the offset check still prefers the list where it is', v.offsetVerdict === null, JSON.stringify(v.offsets));
    check('the words are kept for "view as", and out of the JSON',
        v.wordAt instanceof Map && v.wordAt.get('3|400') === 3392 && JSON.stringify(v).indexOf('wordAt') < 0, '');
    check('a view on a verified point decodes from those words: 3x0400 as U32_N is 200000',
        decodeWords([v.wordAt.get('3|400'), v.wordAt.get('3|401')], 'U32', 'N').value === 200000, '');
    console.log(failed ? failed + ' failed' : 'all passed');
    process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FAIL  verification threw: ' + e.stack); process.exit(1); });
"""

code = 0
for script in (js, js2):
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True, encoding="utf-8")
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    code = code or result.returncode
sys.exit(code)
