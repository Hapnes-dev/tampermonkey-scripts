// Unit tests for the Rocketlane task matcher in Rocketlane-Day-Recap.user.js (RL_RECAP_MATCH).
// Run:  node --test rocketlane-day-recap/task-match.test.js
//
// Requiring the userscript is safe: its IIFE returns immediately when GM_xmlhttpRequest is absent.
//
// This is the most heuristic code in the script — it decides which existing Rocketlane task a day's
// work gets booked onto, and until v4.112 it had no tests at all. The cases below are modelled on the
// canonical "IWMAC 3.0" project template the matcher was calibrated against, so a change that breaks
// real matching shows up here rather than in Thomas's timesheet.

const test = require('node:test');
const assert = require('node:assert');

const H = require('./Rocketlane-Day-Recap.user.js');

// A project laid out like the standard template: Design/Integration/gateway work packages, plus the
// checklist and sales-order rows that must never be booking targets.
const T = (taskId, taskName, extra) => Object.assign({ taskId, taskName, done: false, phase: '' }, extra);
const TEMPLATE = [
    T(1, 'Design: Refrigeration'),
    T(2, 'Design: Ventilation'),
    T(3, 'Design: Wireless overview'),
    T(4, 'Integration: Refrigeration'),
    T(5, 'Integration: Ventilation'),
    T(6, 'Integration: Energy'),
    T(7, 'Server configured'),
    T(8, 'AK3 scanner'),
    T(9, 'Customers approval'),          // checklist — never a target
    T(10, 'Alarm test'),                 // checklist — never a target
    T(11, 'Per energy meter — 3 pcs'),   // sales-order quantity line — never a target
];
const texts = o => Object.assign({ tokStr: '', uStr: '', logStr: '', drawingNames: [] }, o);
const pick = (kind, t, tasks, used) => H.pickTask(tasks || TEMPLATE, kind, texts(t), used);

// ---- existing behaviour, pinned so the new tier cannot regress it ---------------------------------

test('device tokens decide the integration task', () => {
    assert.strictEqual(pick('integration', { tokStr: 'ak-cc 084b danfoss' }).taskName, 'Integration: Refrigeration');
    assert.strictEqual(pick('integration', { tokStr: 'corrigo exhausto' }).taskName, 'Integration: Ventilation');
    assert.strictEqual(pick('integration', { tokStr: 'cge em2' }).taskName, 'Integration: Energy');
});

test('a changed drawing name beats everything for the drawing category', () => {
    assert.strictEqual(pick('drawing', { drawingNames: ['Wireless overview'] }).taskName, 'Design: Wireless overview');
    // Norwegian graphic name bridges to the English task name.
    assert.strictEqual(pick('drawing', { drawingNames: ['360.001 Ventilasjon'] }).taskName, 'Design: Ventilation');
});

test('checklist and sales-order rows are never picked, even as a last-resort guess', () => {
    const only = [T(9, 'Customers approval'), T(10, 'Alarm test'), T(11, 'Per energy meter — 3 pcs')];
    assert.strictEqual(pick('integration', { tokStr: 'ak-cc' }, only), null,
        'a project with nothing but checklist/sales rows must fall through to a new activity');
});

test('a task already used by another category that day is not reused', () => {
    const used = new Set([4]);
    const got = pick('integration', { tokStr: 'ak-cc 084b danfoss' }, TEMPLATE, used);
    assert.ok(!got || got.taskId !== 4, 'Integration: Refrigeration was already taken');
});

test('setup work lands on gateway tasks', () => {
    const got = pick('setup', { tokStr: '' });
    assert.ok(got && /server|ak3/i.test(got.taskName), 'expected a gateway task, got ' + (got && got.taskName));
});

// ---- v4.112: the operations-log note as evidence --------------------------------------------------

test('the day\'s own log note decides when there is no commit evidence', () => {
    // No tokStr at all — before v4.112 this fell straight through to an alphabetical rescue guess.
    assert.strictEqual(pick('integration', { logStr: 'byttet føler i kjøledisk 3' }).taskName, 'Integration: Refrigeration');
    assert.strictEqual(pick('integration', { logStr: 'service på ventilasjonsanlegg' }).taskName, 'Integration: Ventilation');
    assert.strictEqual(pick('drawing', { logStr: 'tegnet om kjølemaskinen' }).taskName, 'Design: Refrigeration');
});

test('the log note does NOT override commit evidence', () => {
    // Commits say ventilation, the note mentions a fridge in passing. Tier 1 already decided.
    const got = pick('integration', { tokStr: 'corrigo exhausto', logStr: 'kunden spurte også om kjøledisken' });
    assert.strictEqual(got.taskName, 'Integration: Ventilation');
});

test('the log note outranks unit names, which are the known-misleading tier', () => {
    // MQTT projects rename wireless sensors to "Kjøttdisk"/"Fryserom" — that used to drag days into
    // refrigeration. An explicit note about ventilation work must win.
    const got = pick('integration', { uStr: 'kjøttdisk fryserom', logStr: 'justert aggregat og vgv' });
    assert.strictEqual(got.taskName, 'Integration: Ventilation');
});

test('ordinary Norwegian prose scores nothing rather than scoring wireless', () => {
    // The wireless keyword list carries 'ing ' for the ING sensor prefix. As a bare substring that
    // matches montering / bestilling / endring / innstilling, so almost any sentence would have
    // registered as wireless work. Prose mode requires the keyword to START a word.
    assert.deepStrictEqual(H.bookDiscWeights('Montering av ny bestilling, endring i innstilling', true), {});
    assert.deepStrictEqual(H.bookDiscWeights('Montering av ny bestilling, endring i innstilling'), { wireless: 1 },
        'substring mode still behaves as before — token strings depend on it');
    assert.deepStrictEqual(H.bookDiscWeights('ING 4021 sensor lagt til', true), { wireless: 1 },
        'a real ING token still scores');
});

test('prose mode reads Norwegian compounds, which is the whole point of a leading boundary', () => {
    for (const [text, disc] of [
        ['kjøledisk', 'refrig'], ['kjølemaskin', 'refrig'], ['energimåler', 'energy'],
        ['ventilasjonsanlegg', 'vent'], ['maskinrom', 'machine'], ['varmepumpe', 'heat'],
    ]) {
        const w = H.bookDiscWeights(text, true);
        assert.ok(w[disc] > 0, `${text} should score ${disc}, got ${JSON.stringify(w)}`);
    }
});

test('prose mode drops the "parameter" → energy accident', () => {
    assert.ok(!H.bookDiscWeights('justert parameter på maskinrom', true).energy);
    assert.ok(H.bookDiscWeights('justert parameter på maskinrom').energy, 'substring mode had this bug');
});

test('an empty log note changes nothing', () => {
    const withOut = pick('integration', { tokStr: 'ak-cc 084b danfoss' });
    const withEmpty = pick('integration', { tokStr: 'ak-cc 084b danfoss', logStr: '' });
    assert.strictEqual(withOut.taskId, withEmpty.taskId);
});

test('a log note with no discipline words falls through to the next tier', () => {
    const got = pick('integration', { uStr: 'corrigo', logStr: 'ringte kunden og avtalte nytt besøk' });
    assert.strictEqual(got.taskName, 'Integration: Ventilation', 'the note said nothing, so unit names still decide');
});
