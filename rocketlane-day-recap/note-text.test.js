// Unit tests for the timesheet note prose helpers in Rocketlane-Day-Recap.user.js (v4.111).
// Run:  node --test rocketlane-day-recap/note-text.test.js
//
// Requiring the userscript is safe: its IIFE returns immediately when GM_xmlhttpRequest is absent,
// so nothing browser-specific (location, GM storage) is touched under Node.
//
// These helpers decide what a booked time entry says about the work. Rocketlane's drawer shows only
// the note's FIRST line, so the assertions below care most about that line reading like a sentence a
// person would write, not like a field dump.

const test = require('node:test');
const assert = require('node:assert');

const H = require('./Rocketlane-Day-Recap.user.js');

test('bookAndList reads as English and is honest about overflow', () => {
    assert.strictEqual(H.bookAndList([], 3), '');
    assert.strictEqual(H.bookAndList(['a'], 3), 'a');
    assert.strictEqual(H.bookAndList(['a', 'b'], 3), 'a and b');
    assert.strictEqual(H.bookAndList(['a', 'b', 'c'], 3), 'a, b and c');
    assert.strictEqual(H.bookAndList(['a', 'b', 'c', 'd'], 3), 'a, b, c and 1 more');
    assert.strictEqual(H.bookAndList(['a', null, '', 'b'], 3), 'a and b', 'empty entries are dropped, not counted');
});

test('bookSentence capitalises, joins and terminates', () => {
    assert.strictEqual(H.bookSentence([]), '');
    assert.strictEqual(H.bookSentence(['added 2 units']), 'Added 2 units.');
    assert.strictEqual(H.bookSentence(['added 2 units', 'tuned Data Engine']), 'Added 2 units and tuned Data Engine.');
    assert.strictEqual(H.bookSentence(['a', 'b', 'c']), 'A, b and c.');
    assert.strictEqual(H.bookSentence(['already done.']), 'Already done.', 'no double full stop');
});

test('bookPlural', () => {
    assert.strictEqual(H.bookPlural(1, 'unit'), '1 unit');
    assert.strictEqual(H.bookPlural(3, 'unit'), '3 units');
    assert.strictEqual(H.bookPlural(0, 'unit'), '0 units');
});

test('summarizeIntegration turns a commissioning day into one sentence', () => {
    const s = H.summarizeIntegration({
        uAdd: 2,
        uAddNames: ['AK-CC55-017x 6 (000:006)', 'Belimo Energimåler (2)'],
        devAdd: ['080Z0202 041X'],
        devMod: ['Data Engine', 'Belimo'],
        virtVals: true,
        settNames: ['packet_interval'],
    });
    assert.strictEqual(
        s,
        'Added 2 units (AK-CC55-017x 6 and Belimo Energimåler), tuned parameters on Data Engine and Belimo, ' +
        'updated the virtual values and changed 1 plant setting (packet_interval).');
});

test('bookBareLabel drops the bus address so the summary does not nest parentheses', () => {
    assert.strictEqual(H.bookBareLabel('AK-CC55-017x 6 (000:006)'), 'AK-CC55-017x 6');
    assert.strictEqual(H.bookBareLabel('Belimo Energimåler (2)'), 'Belimo Energimåler');
    assert.strictEqual(H.bookBareLabel('Kjøttdisk'), 'Kjøttdisk', 'a plain name is left alone');
    assert.strictEqual(H.bookBareLabel('Kjøl (nord) 3'), 'Kjøl (nord) 3', 'only a TRAILING parenthetical goes');
});

test('summarizeIntegration reports renames and removals, and never double-counts a tuned new device', () => {
    assert.strictEqual(
        H.summarizeIntegration({ uRen: 2, renPairs: ['Kjøl 1 → Kjøttdisk', 'Frys 2 → Fryserom'], uDel: 1 }),
        'Renamed 2 units (Kjøl 1 → Kjøttdisk and Frys 2 → Fryserom) and removed 1 unit.');
    assert.strictEqual(
        H.summarizeIntegration({ devAdd: ['Belimo'], devMod: ['Belimo'] }),
        'Added Belimo.',
        'a device added this same day is not also reported as "tuned"');
});

test('summarizeIntegration is empty when nothing was measured', () => {
    assert.strictEqual(H.summarizeIntegration({}), '');
    assert.strictEqual(H.summarizeIntegration(null), '');
});

test('summarizeDrawing names a single panel and what changed in it', () => {
    assert.strictEqual(
        H.summarizeDrawing([{ panel: 'Oversikt_Øst', added: false, from: 4, to: 5, what: ['layout'] }], [], false),
        'Updated the "Oversikt_Øst" drawing in the Designer (layout edited, rev 4 → 5).');
    assert.strictEqual(
        H.summarizeDrawing([{ panel: 'Kjøl', added: true, from: null, to: null, what: [] }], [], false),
        'Created the "Kjøl" drawing in the Designer.');
});

test('summarizeDrawing lists several panels and flags the new ones', () => {
    const s = H.summarizeDrawing([
        { panel: 'Oversikt_Øst', added: false, from: 4, to: 5, what: ['layout'] },
        { panel: 'Kjøl', added: true, from: null, to: null, what: [] },
    ], [], false);
    assert.strictEqual(s, 'Worked on 2 drawings in the Designer — "Oversikt_Øst" and "Kjøl" (1 new one).');
});

test('summarizeDrawing falls back to names, then to a bare Designer session, then to nothing', () => {
    assert.strictEqual(
        H.summarizeDrawing([], ['Wireless Overview'], false),
        'Changed 1 drawing in the Designer — "Wireless Overview".');
    assert.strictEqual(
        H.summarizeDrawing([], [], true),
        "Worked in the Designer on the plant's drawings.");
    assert.strictEqual(H.summarizeDrawing([], [], false), '');
});

test('summarizeActions describes the session by its tools', () => {
    assert.strictEqual(
        H.summarizeActions([{ label: 'phpMyAdmin', count: 3 }, { label: 'VNC', count: 1 }]),
        'Worked on the plant via phpMyAdmin (×3) and VNC.');
    assert.strictEqual(H.summarizeActions([]), '');
});

test('composeEntryNote puts the summary on its own first line', () => {
    const note = H.composeEntryNote(
        'Updated the "Oversikt_Øst" drawing in the Designer (layout edited, rev 4 → 5).',
        ['Byttet føler i kjøledisk 3'],
        'Drawing changed: Oversikt_Øst: rev 4 → 5 · layout edited');
    const lines = note.split('\n');
    assert.strictEqual(lines[0], 'Updated the "Oversikt_Øst" drawing in the Designer (layout edited, rev 4 → 5).');
    assert.strictEqual(lines[1], '', 'blank line keeps the summary standing alone in the collapsed drawer');
    assert.strictEqual(lines[2], 'Log: Byttet føler i kjøledisk 3');
    assert.ok(note.endsWith('Drawing changed: Oversikt_Øst: rev 4 → 5 · layout edited'));
});

test('composeEntryNote drops missing blocks instead of leaving blank gaps', () => {
    assert.strictEqual(H.composeEntryNote('Set up the AK3 scanner.', [], ''), 'Set up the AK3 scanner.');
    assert.strictEqual(H.composeEntryNote('Summary.', [''], ''), 'Summary.');
    assert.strictEqual(H.composeEntryNote('Summary.', ['a', 'b'], ''), 'Summary.\n\nLog: a\nLog: b');
});
