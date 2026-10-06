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
js += lift("    function impliedScale(raw, shown) {", "\n    /**\n     * What a register and its neighbour decode to")
# The COM ports the registry lists, and how one poll went (1.64).
js += lift("    /**\n     * The COM ports Windows lists", "\n    function summarise(")
js += lift("    const DATATYPE_EXCEPTIONS = {", "\n    /**\n     * Points become poll ranges")
js += lift("    const VIEW_TYPES = [", "\n    /**\n     * The picker in a grid's type cell.")
js += lift("    const SCALE_GROUPS = {", "\n    /**\n     * The picker in a grid's scaled cell.")
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
check('U32 (plant 11087), I32 and floats (plant 3694) are all marked measured',
    d([1, 2], 'U32', 'N').measured === true && d([1, 2], 'I32', 'N').measured === true && d([0, 16812], 'F', 'N').measured === true,
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
check('every view decodes: 16-bit from one word, 32-bit from two, 64-bit from four',
    VIEW_TYPES.every(t => decodeView(t, viewWords(t, r => (r === 190 ? 0 : 16812), 190)).ok),
    VIEW_TYPES.filter(t => !decodeView(t, viewWords(t, r => (r === 190 ? 0 : 16812), 190)).ok).map(t => t.key).join(' '));
check('a 32-bit view asks for the register and the next one', viewWords(viewTypeOf('U32_N'), r => r * 10, 190).join(',') === '1900,1910',
    viewWords(viewTypeOf('U32_N'), r => r * 10, 190).join(','));
check('viewValueText keeps integers whole and trims float noise', viewValueText(200000) === '200000' && viewValueText(21.500000953) === '21.5',
    viewValueText(21.500000953));

// 1.53: every datatype the table has a register reading for (docs/15 section 6).
const v = (key, words) => decodeView(viewTypeOf(key), words);
check('the ten views 1.50 shipped read exactly as before, through decodeWords',
    VIEW_TYPES.slice(0, 10).every(t => show(decodeView(t, [3392, 3])) === show(decodeWords([3392, 3], t.raw, t.swap))), '');
check('views are grouped by how many registers they span: 1, 2 or 4',
    VIEW_TYPES.every(t => [1, 2, 4].includes(t.regs)) && VIEW_TYPES.length === 35, String(VIEW_TYPES.length));
check('a 64-bit view asks for this register and the next three', viewWords(viewTypeOf('U64U32_N'), r => r * 10, 190).join(',') === '1900,1910,1920,1930',
    viewWords(viewTypeOf('U64U32_N'), r => r * 10, 190).join(','));
check('viewTypeOf resolves the new families from full datatype names',
    viewTypeOf('A_Hold_U64U32_N').key === 'U64U32_N' && viewTypeOf('I_Hold_STR4_N').key === 'STR4_N' &&
        viewTypeOf('I_Input_BCD4_N').key === 'BCD4' && viewTypeOf('I_Hold_rU16_N').key === 'rU16' &&
        viewTypeOf('I_Hold_CLK_R').key === 'CLK_R' && viewTypeOf('Bit_Hold').key === 'Bits' &&
        viewTypeOf('A_Hold_D_W').key === 'D_W' && viewTypeOf('A_Hold_U32_R').key === 'U32_R', '');
check('U16_W on one register reads as U16, and says why', v('U16_W', [0x0102]).value === 258 && /no word order/.test(v('U16_W', [0x0102]).note),
    show(v('U16_W', [0x0102])));
check('STR4_N reads the EX3 unit text high byte first: m3/h', v('STR4_N', [0x6D33, 0x2F68]).value === 'm3/h', show(v('STR4_N', [0x6D33, 0x2F68])));
check('STR4_R reads the same text with the bytes swapped', v('STR4_R', [0x336D, 0x682F]).value === 'm3/h', show(v('STR4_R', [0x336D, 0x682F])));
check('STR8_N reads the EX3 serial 35010007', v('STR8_N', [0x3335, 0x3031, 0x3030, 0x3037]).value === '35010007',
    show(v('STR8_N', [0x3335, 0x3031, 0x3030, 0x3037])));
check('BCD4 reads 0x1234 as 1234, and refuses a digit above 9',
    v('BCD4', [0x1234]).value === 1234 && v('BCD4', [0x12A4]).ok === false, show([v('BCD4', [0x1234]), v('BCD4', [0x12A4])]));
check('BCD35: bit 12 the thousand, bit 15 the sign - 0x1999 is 1999, 0x8123 is -123',
    v('BCD35', [0x1999]).value === 1999 && v('BCD35', [0x8123]).value === -123, show([v('BCD35', [0x1999]), v('BCD35', [0x8123])]));
check('rU16 reverses the bit order: 0x0001 is 32768, and rI16 reads that as -32768',
    v('rU16', [1]).value === 32768 && v('rI16', [1]).value === -32768, show([v('rU16', [1]), v('rI16', [1])]));
check('CLK_N shows 125 as 02:05, and CLK_R the same count with its bytes swapped',
    v('CLK_N', [125]).value === '02:05' && v('CLK_R', [0x7D00]).value === '02:05', show([v('CLK_N', [125]), v('CLK_R', [0x7D00])]));
check('Bits draws the word as its 16 bits and names the ones on',
    v('Bits', [0x0021]).value === '0000 0000 0010 0001' && v('Bits', [0x0021]).note === 'bits on: 0, 5', show(v('Bits', [0x0021])));
check('U32_R swaps the bytes of each word, in _N order: [0x0201, 0x0403] is 0x03040102',
    v('U32_R', [0x0201, 0x0403]).value === 0x03040102 && /not measured/.test(v('U32_R', [0x0201, 0x0403]).note), show(v('U32_R', [0x0201, 0x0403])));
check('U64U32_N puts four words low word first: [3392, 3, 0, 0] is 200000',
    v('U64U32_N', [3392, 3, 0, 0]).value === 200000, show(v('U64U32_N', [3392, 3, 0, 0])));
check('U64U32 shows what IWMAC keeps, the low 32 bits, and the whole number in the note',
    v('U64U32_N', [0, 0, 1, 0]).value === 0 && /4294967296/.test(v('U64U32_N', [0, 0, 1, 0]).note), show(v('U64U32_N', [0, 0, 1, 0])));
check('U64U32_W reads the first register as the most significant word', v('U64U32_W', [0, 0, 3, 3392]).value === 200000,
    show(v('U64U32_W', [0, 0, 3, 3392])));
check('I64I32_N keeps a negative number negative', v('I64I32_N', [-2, -1, -1, -1]).value === -2, show(v('I64I32_N', [-2, -1, -1, -1])));
check('D_W and D_N read 1.5 as a 64-bit float either way round',
    v('D_W', [0x3FF8, 0, 0, 0]).value === 1.5 && v('D_N', [0, 0, 0, 0x3FF8]).value === 1.5, show([v('D_W', [0x3FF8, 0, 0, 0]), v('D_N', [0, 0, 0, 0x3FF8])]));
check('a 64-bit view without its four words says so', v('D_N', [1, 2]).ok === false && /next 3/.test(v('D_N', [1, 2]).why), show(v('D_N', [1, 2])));
check('viewValueText shows a text view as its text', viewValueText('m3/h') === 'm3/h', viewValueText('m3/h'));

// 1.54: the full datatype names, as a list writes them, for the table being read.
const fn = (key, table) => fullNames(viewTypeOf(key), table).join(' ');
check('table 4 is _Hold_, with A_ and I_ for a numeric type: I16_W is A_Hold_I16_W and I_Hold_I16_W',
    fn('I16_W', '4') === 'A_Hold_I16_W I_Hold_I16_W', fn('I16_W', '4'));
check('table 3 is _Input_', fn('U32_N', '3') === 'A_Input_U32_N I_Input_U32_N', fn('U32_N', '3'));
check('BCD, CLK, STR and the reversed-bit types have I_ only',
    fn('BCD4', '4') === 'I_Hold_BCD4_N' && fn('CLK_R', '3') === 'I_Input_CLK_R' && fn('STR8_N', '4') === 'I_Hold_STR8_N' &&
        fn('rI16', '3') === 'I_Input_rI16_N', [fn('BCD4', '4'), fn('CLK_R', '3'), fn('STR8_N', '4'), fn('rI16', '3')].join(' | '));
check('Bits is Bit_Hold or Bit_Input', fn('Bits', '4') === 'Bit_Hold' && fn('Bits', '3') === 'Bit_Input', fn('Bits', '3'));
check('every full name resolves back to its own view', VIEW_TYPES.every(t => ['4', '3'].every(tb =>
    fullNames(t, tb).every(n => viewTypeOf(n) === t))),
    VIEW_TYPES.flatMap(t => fullNames(t, '4').filter(n => viewTypeOf(n) !== t)).join(' '));
check('viewName reads as the list writes it, then what it means',
    viewName(viewTypeOf('I16_R'), '4') === 'A_Hold_I16_R / I_Hold_I16_R — bytes swapped', viewName(viewTypeOf('I16_R'), '4'));
// Every name it shows is a row in modbusgen's table, when that repository sits beside this one.
const fs = require('fs');
const csvPath = String.raw`""" + str(Path(__file__).resolve().parents[3] / "modbus-list-generator" / "data" / "tables" / "datatypes.csv") + r"""`;
if (fs.existsSync(csvPath)) {
    const known = new Set(fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1).map(l => l.split(',')[0]));
    const shown = VIEW_TYPES.flatMap(t => [...fullNames(t, '4'), ...fullNames(t, '3')]);
    check('every full name shown is a datatype in modbusgen\'s table (' + shown.length + ' names)',
        shown.every(n => known.has(n)), shown.filter(n => !known.has(n)).join(' '));
}

// IWMAC's scalings (1.58): raw_min..raw_max onto eng_min..eng_max, the catalogue Supermarket-superuser
// offers plus modbusgen's keys, each reading shown with the decimals its scaling implies.
const at = (raw, name) => scaledBy(raw, scalingOf(name));
check('every scaling is four numbers that scale, found again by its label',
    SCALINGS.every(s => Number.isFinite(s.factor) && Number.isFinite(s.offset) && scalingOf(s.label) === s), SCALINGS.map(s => s.label).join(' | '));
const supermarket = ['Invert', 'MV-alarm', 'x000.1', 'x00.1', 'x0.1', 'x1', 'x10', 'x100', 'x1000', 'Kelvin to Celsius', 'Unit for energy flow rate',
    'L/h -> m3/h', 'L/h -> L/s', 'L/s -> L/h', 'L/s -> m3/h', '/5', 'CT-ratio: 1200/5A', 'CT-ratio: 1600/5A', 'CT-ratio: 2000/5A',
    'CT-ratio: 1200/1A', 'CT-ratio: 1600/1A', 'CT-ratio: 2000/1A', 'Raw value * 400 / 1000'];
check('the catalogue holds all 23 of Supermarket-superuser\'s presets', supermarket.every(l => scalingOf(l) && scalingOf(l).label === l),
    supermarket.filter(l => !scalingOf(l)).join(' | '));
check('every modbusgen key is in it, scaling as the list reads that key',
    Object.keys(LIST_SCALE_KEYS).every(k => { const s = scalingOf(k), f = scaleFactorOf(k); return s && s.factor === f.factor && s.offset === f.offset; }),
    Object.keys(LIST_SCALE_KEYS).filter(k => !scalingOf(k)).join(' '));
check('a modbusgen key finds its preset: x0.01 is x00.1, x3.6 is L/s -> m3/h, INV is Invert',
    scalingOf('x0.01').label === 'x00.1' && scalingOf('x3.6').label === 'L/s -> m3/h' && scalingOf('inv').label === 'Invert', '');
check('2000 under x0.1 shows 200.0', at(2000, 'x0.1').text === '200.0' && at(2000, 'x0.1').value === 200, show(at(2000, 'x0.1')));
check('2000 l/s under x3.6 shows 7200.0 - the m3/h the controller reports', at(2000, 'x3.6').text === '7200.0', show(at(2000, 'x3.6')));
check('222298115 under x0.01 shows 2222981.15 - what IWMAC showed for the _W setpoint',
    at(222298115, 'x0.01').text === '2222981.15', show(at(222298115, 'x0.01')));
check('a negative reading keeps its sign: -200 under x0.01 is -2.00', at(-200, 'x0.01').text === '-2.00', show(at(-200, 'x0.01')));
check('x1 shows a whole number', at(2000, 'x1').text === '2000', show(at(2000, 'x1')));
check('no reading, no value', at(undefined, 'x0.1') === null && at(NaN, 'x0.1') === null, '');
check('an offset: 293 K under Kelvin to Celsius is 19.85', at(293, 'Kelvin to Celsius').text === '19.85', show(at(293, 'Kelvin to Celsius')));
check('MV-alarm turns 2 into 1 and 1 into 0', at(2, 'MV-alarm').text === '1' && at(1, 'MV-alarm').text === '0', show([at(2, 'MV-alarm'), at(1, 'MV-alarm')]));
check('Invert is IWMAC\'s 1 - raw: 0 reads 1, 1 reads 0', at(0, 'Invert').text === '1' && at(1, 'Invert').text === '0', '');
check('a 1200/5A current transformer makes 2.5 A 600', at(2.5, 'CT-ratio: 1200/5A').text === '600', show(at(2.5, 'CT-ratio: 1200/5A')));
check('a factor that runs on is shown to six places: 6553 under x65 is 0.999908, 7200 l/h under L/h -> L/s is 2',
    at(6553, 'x65').text === '0.999908' && at(7200, 'L/h -> L/s').text === '2', show([at(6553, 'x65'), at(7200, 'L/h -> L/s')]));
const custom = scalingOf('raw 0..207 -> 0..20.7');
check('four numbers make a custom scaling, which reads back from its own label',
    custom && custom.custom && at(207, 'raw 0..207 -> 0..20.7').text === '20.7' && scalingOf(custom.label).factor === custom.factor &&
    scalingOf('raw 0…207 → 0…20.7') !== null && scalingOf('raw 0..1 -> 0..1e-8').factor === 1e-8, show(custom));
check('... and refuses what is not one: equal raw ends, words', scalingOf('raw 5..5 -> 0..1') === null && scalingOf('nonsense') === null && scalingOf('') === null, '');
check('a custom scaling that is a preset is found as it: 0..207 -> 0..20.7 is x0.1, 0..1 -> 1..0 is Invert',
    sameScaling(custom).label === 'x0.1' && sameScaling(scalingOf('raw 0..1 -> 1..0')).label === 'Invert', '');

// The list's keys, read through modbusgen's table rather than from their text.
check('x65 is 10/65536, x0036 is 1/277, x0.000001 is 1/100000 - not what their text says',
    scaleFactorOf('x65').factor === 10 / 65536 && scaleFactorOf('x0036').factor === 1 / 277 && scaleFactorOf('x0.000001').factor === 0.00001,
    show([scaleFactorOf('x65'), scaleFactorOf('x0036'), scaleFactorOf('x0.000001')]));
check('pa subtracts 30000: a register of 29500 is -500', applyScale(scaleFactorOf('pa'), 29500, null) === -500, show(scaleFactorOf('pa')));
check('the common keys scale as before: 207 x0.1 is 20.7, 222298115 x0.01 is 2222981.15, 2000 x3.6 is 7200',
    applyScale(scaleFactorOf('x0.1'), 207, 1) === 20.7 && applyScale(scaleFactorOf('x0.01'), 222298115, 2) === 2222981.15 &&
    applyScale(scaleFactorOf('x3.6'), 2000, 1) === 7200, '');
check('INV stays an inverted digital, and a key not in the table still says its factor',
    applyScale(scaleFactorOf('INV'), 1) === 0 && applyScale(scaleFactorOf('INV'), 0) === 1 && scaleFactorOf('x0.2').factor === 0.2 &&
    !scaleFactorOf('C2F').known, '');
check('what a scaling does, in short: ÷10, ×3.6, ÷277, raw − 30000, 1 − raw, raw − 273.15',
    scaleEffect(scaleFactorOf('x0.1')) === '÷10' && scaleEffect(scaleFactorOf('x3.6')) === '×3.6' && scaleEffect(scaleFactorOf('x0036')) === '÷277' &&
    scaleEffect(scaleFactorOf('pa')) === 'raw − 30000' && scaleEffect(scalingOf('Invert')) === '1 − raw' &&
    scaleEffect(scalingOf('Kelvin to Celsius')) === 'raw − 273.15',
    [scaleEffect(scaleFactorOf('x0.1')), scaleEffect(scaleFactorOf('x3.6')), scaleEffect(scaleFactorOf('x0036')), scaleEffect(scaleFactorOf('pa')),
        scaleEffect(scalingOf('Invert')), scaleEffect(scalingOf('Kelvin to Celsius'))].join(' | '));

// The card (1.57, 1.58): which scaling gives what IWMAC shows, and the big number under a chosen one.
const gives = (raw, shown) => SCALINGS.filter(s => scalingGives(raw, s, shown)).map(s => s.label).join(' | ');
check('207 under x0.1 gives the 20,7 the plant shows, and no other scaling does', gives(207, '20,7') === 'x0.1', gives(207, '20,7'));
check('a float the plant rounds still matches: 21.4999 under x1 gives 21.5', scalingGives(21.4999, scalingOf('x1'), '21.5'), '');
check('2000 l/s under x3.6 gives the 7200 m3/h shown', scalingGives(2000, scalingOf('x3.6'), '7200'), '');
check('an offset matches too: 293 under Kelvin to Celsius gives the 19,85 shown', scalingGives(293, scalingOf('Kelvin to Celsius'), '19,85'), '');
check('the match is to the decimals shown: 1 under x0.5 is not the 1 shown, under x1 it is',
    scalingGives(1, scalingOf('x1'), '1') && !scalingGives(1, scalingOf('x0.5'), '1'), '');
check('a zero, a state text or nothing shown matches no scaling',
    !scalingGives(0, scalingOf('x1'), '0') && !scalingGives(5, scalingOf('x1'), '0') && !scalingGives(1, scalingOf('x1'), 'Auto') &&
    !scalingGives(1, scalingOf('x1'), '') && !scalingGives(1, scalingOf('x1'), null), '');
const listPoint = { unit: '°C', scale: scaleFactorOf('x0.1'), decimals: 1 };
scaleOverrides.set('4|95', 'x3.6');
const underScale = viewedHeadline('4', 95, 207, listPoint, null, undefined, { raw: 207 });
check('a scaling chosen without a datatype makes the big number: 207 under x3.6 is 745.2 °C, named as the preset',
    underScale && underScale.lead === '745.2 °C' && underScale.note === 'under L/s -> m3/h (x3.6), display only · register holds 207', show(underScale));
check('a row with no scaled cell keeps the card\'s own big number', viewedHeadline('4', 95, 207, listPoint, null, undefined, undefined) === null, '');
check('a row with nothing to scale keeps it too', viewedHeadline('4', 95, 207, listPoint, null, undefined, { raw: undefined }) === null, '');
scaleOverrides.set('4|95', 'raw 0..1000 -> -273.15..726.85');
const underCustom = viewedHeadline('4', 95, 293, listPoint, null, undefined, { raw: 293 });
check('a custom scaling makes it too: 293 under raw 0..1000 -> -273.15..726.85 is 19.85 °C',
    underCustom && underCustom.lead === '19.85 °C' && /^under raw 0\.\.1000 -> -273\.15\.\.726\.85, display only/.test(underCustom.note), show(underCustom));
scaleOverrides.set('4|95', 'x3.6');
viewOverrides.set('4|95', 'U16');
const bothChosen = viewedHeadline('4', 95, 207, listPoint, null, ref => ({ 95: 2072 })[ref], { raw: 2072 });
check('with a datatype too, the scaling applies to what it reads: 2072 under x3.6 is 7459.2 °C, and the note says so',
    bothChosen && bothChosen.lead === '7459.2 °C' && /reads 2072 · under L\/s -> m3\/h \(x3\.6\) · register holds 207$/.test(bothChosen.note), show(bothChosen));
viewOverrides.clear();
scaleOverrides.clear();
check('nothing chosen, the card keeps its own big number', viewedHeadline('4', 95, 207, listPoint, null, undefined, { raw: 207 }) === null, '');


// The plant PC's COM ports, as "reg query HKLM\HARDWARE\DEVICEMAP\SERIALCOMM" prints them (1.64).
const regOut = 'HKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM\n    \\Device\\Npdrv1    REG_SZ    COM16\n' +
    '    \\Device\\Serial0    REG_SZ    COM1\n    \\Device\\Npdrv0    REG_SZ    COM3\n    \\Device\\VCP0    REG_SZ    COM5\n\nC:\\iwmac\\sys_tools\\plant_term>';
const ports = parseComPorts(regOut);
check('reg query gives the ports in number order, COM16 after COM5', ports.map(c => c.port).join(' ') === 'COM1 COM3 COM5 COM16', show(ports));
check('... each with what it is: the board\'s own, an NPort\'s virtual port, a USB adapter',
    ports.map(c => c.kind).join(',') === 'on board,NPort,USB,NPort' && ports[1].device === '\\Device\\Npdrv0', show(ports));
check('... and nothing from a shell that printed no ports', parseComPorts('ERROR: The system was unable to find the specified registry key or value.').length === 0, '');

// How one poll went, for Run's tally (1.64).
const out = r => passOutcome(r);
const answered = out({ values: [{ i: 1, v: 5 }], diagnostics: [] });
const silent = out({ values: [], diagnostics: [{ level: 'error', text: 'No response from device (timeout)' }] });
const crc = out({ values: [], diagnostics: [{ level: 'error', text: 'Checksum error — data corruption on the bus' }] });
const refused = out({ values: [], diagnostics: [{ level: 'warn', text: 'Illegal data address exception — device answered, register is outside its map' }] });
const noPort = out({ values: [], diagnostics: [{ level: 'fatal', text: 'Port or socket open error — …' }] });
check('a poll with values is answered, and nothing else', answered.responded && answered.answered && !answered.timeout && !answered.checksum, show(answered));
check('a time-out is no answer', silent.timeout && !silent.responded, show(silent));
check('a checksum error is counted as one, and as no answer', crc.checksum && !crc.responded, show(crc));
check('an exception is the device answering, as ModpollTool counts it', refused.exception && refused.responded && !refused.answered, show(refused));
check('a port that did not open is a connection error', noPort.connection && !noPort.responded, show(noPort));
check('a refused block, with no exception line, is an exception too', out({ values: [], diagnostics: [], unreadable: [5] }).exception, '');
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
    # On stdin, not as `node -e`: the lifted code outgrew Windows' 32 767-character
    # command line once the view catalogue covered every datatype (1.53.0).
    result = subprocess.run(["node", "-"], input=script, capture_output=True, text=True, encoding="utf-8")
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    code = code or result.returncode
sys.exit(code)
