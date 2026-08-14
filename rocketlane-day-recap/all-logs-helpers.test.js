// Unit tests for the IWMAC "All logs" helpers in Rocketlane-Day-Recap.user.js.
// Run:  node --test rocketlane-day-recap/all-logs-helpers.test.js
//
// Requiring the userscript is safe: its IIFE returns immediately when GM_xmlhttpRequest is absent,
// so nothing browser-specific (location, GM storage) is touched under Node.
//
// The secret in the fixtures below is deliberately fake. Never paste a real plant credential into a
// test, a log, or any committed file — the whole point of maskAllLogsComment is that those values do
// not travel.

const test = require('node:test');
const assert = require('node:assert');

const H = require('./Rocketlane-Day-Recap.user.js');

const USER = 'thomas.kvalvag';

// One realistic day: pang clicks mirrored as PANG1, a handover note, two operations-log entries and
// one row belonging to a different user.
const RECORDS = [
    { recid: 1, date: '2026-08-14 08:12:03', plant_id: '4728', user: USER, system: 'PANG1', action: 'pma_local', comment: 'Launch phpMyAdmin' },
    { recid: 2, date: '2026-08-14 08:31:44', plant_id: '4728', user: USER, system: 'PANG1', action: 'direct_plant', comment: 'Launch Direct' },
    { recid: 3, date: '2026-08-14 09:02:10', plant_id: '4728', user: 'thomas.andersen', system: 'PANG1', action: 'designer4', comment: 'Launch Designer V4' },
    { recid: 4, date: '2026-08-14 10:05:00', plant_id: '5296', user: 'THOMAS.KVALVAG@kiona.com', system: 'NOTES', action: 'pang_note', comment: 'Handover: AK3 password=fake-not-a-real-password https://iwmac.zendesk.com/agent/tickets/123' },
    { recid: 5, date: '2026-08-14 10:40:00', plant_id: '5296', user: USER, system: 'OP_LOG_NEW', action: 'changed_alarm_settings', comment: 'Raised suction alarm limit on rack 2' },
    { recid: 6, date: '2026-08-14 11:15:00', plant_id: '9863', user: USER, system: 'OP_LOG', action: 'service', comment: 'Service logon' },
    { recid: 7, date: '2026-08-14 11:20:00', plant_id: '   ', user: USER, system: 'BATCH', action: 'batch', comment: 'no plant on this row' },
];

test('maskAllLogsComment redacts a credential but keeps the ticket URL', () => {
    const out = H.maskAllLogsComment('AK3 password=fake-not-a-real-password https://iwmac.zendesk.com/agent/tickets/123');
    assert.strictEqual(out, '[redacted] https://iwmac.zendesk.com/agent/tickets/123');
    assert.ok(!/fake-not-a-real-password/.test(out), 'the secret value must never survive masking');
});

test('maskAllLogsComment leaves an ordinary comment intact, collapsing whitespace', () => {
    assert.strictEqual(H.maskAllLogsComment('  Raised   suction alarm\nlimit  '), 'Raised suction alarm limit');
    assert.strictEqual(H.maskAllLogsComment(null), '');
});

test('maskAllLogsComment caps a very long comment', () => {
    const out = H.maskAllLogsComment('x'.repeat(400));
    assert.strictEqual(out.length, 180);
    assert.ok(out.endsWith('…'));
});

test('isPang1LogSystem recognises the pang mirror only', () => {
    assert.ok(H.isPang1LogSystem('PANG1'));
    assert.ok(H.isPang1LogSystem('pang'));
    assert.ok(!H.isPang1LogSystem('NOTES'));
    assert.ok(!H.isPang1LogSystem('OP_LOG_NEW'));
});

test('allLogsChipCode maps each system to a chip code', () => {
    assert.strictEqual(H.allLogsChipCode({ system: 'PANG1', action: 'pma_local' }), 'pma_local');
    assert.strictEqual(H.allLogsChipCode({ system: 'NOTES', action: 'anything' }), 'pang_note');
    assert.strictEqual(H.allLogsChipCode({ system: 'OP_LOG_NEW', action: 'change_duty_list' }), 'change_duty_list');
    assert.strictEqual(H.allLogsChipCode({ system: 'BACKUP', action: '' }), 'backup');
});

test('allLogsDateWindow covers one whole calendar day', () => {
    assert.deepStrictEqual(H.allLogsDateWindow('2026-08-14'), {
        date_from: '2026-08-14 00:00:00',
        date_to: '2026-08-14 23:59:59',
    });
});

test('filterAllLogsRecords keeps this user only and drops rows without a plant', () => {
    const kept = H.filterAllLogsRecords(RECORDS, USER);
    assert.deepStrictEqual(kept.map(r => r.recid), [1, 2, 4, 5, 6]);
    assert.deepStrictEqual(H.filterAllLogsRecords(RECORDS, ''), []);
});

test('visitsFromAllLogsRecords groups by plant and carries chips, notes and events', () => {
    const visits = H.visitsFromAllLogsRecords(RECORDS, USER, { 4728: 'COOP Extra Test' });
    assert.deepStrictEqual(visits.map(v => v.plant_id), ['4728', '5296', '9863']);

    const p4728 = visits[0];
    assert.strictEqual(p4728.name, 'COOP Extra Test');
    assert.deepStrictEqual(p4728.actions, ['pma_local', 'direct_plant']);
    assert.strictEqual(p4728.count, 2);
    assert.deepStrictEqual(p4728.all_logs_notes, [], 'PANG1 "Launch …" comments are never notes');
    assert.strictEqual(p4728._events.length, 2);
    assert.ok(p4728._events.every(e => e.click === true));
    assert.ok(p4728.first_ts < p4728.last_ts);

    const p5296 = visits[1];
    assert.deepStrictEqual(p5296.actions, ['pang_note', 'changed_alarm_settings']);
    assert.strictEqual(p5296.count, 2, 'no pang clicks on this plant, so the log rows stand in');
    assert.ok(p5296._events.every(e => e.click === true));
    assert.deepStrictEqual(p5296.all_logs_notes, [
        '[redacted] https://iwmac.zendesk.com/agent/tickets/123',
        'Raised suction alarm limit on rack 2',
    ]);
});

test('non-click rows do not inflate the click count when the plant has pang clicks', () => {
    const recs = [
        { date: '2026-08-14 08:00:00', plant_id: '4728', user: USER, system: 'PANG1', action: 'pma_local', comment: 'Launch phpMyAdmin' },
        { date: '2026-08-14 08:30:00', plant_id: '4728', user: USER, system: 'OP_LOG_NEW', action: 'change_duty_list', comment: 'Swapped duty order' },
        { date: '2026-08-14 08:45:00', plant_id: '4728', user: USER, system: 'NOTES', action: 'pang_note', comment: 'Called the customer' },
    ];
    const [v] = H.visitsFromAllLogsRecords(recs, USER);
    assert.strictEqual(v.count, 1, 'one pang click — the note and the op-log row are evidence, not clicks');
    assert.strictEqual(v._events.length, 3);
    assert.deepStrictEqual(v.all_logs_notes, ['Swapped duty order', 'Called the customer']);
});

test('formatAllLogsNotes joins up to the cap', () => {
    const many = Array.from({ length: 12 }, (_, i) => 'note ' + i);
    assert.strictEqual(H.formatAllLogsNotes([]), '');
    assert.strictEqual(H.formatAllLogsNotes(['a', 'b']), 'a\nb');
    assert.strictEqual(H.formatAllLogsNotes(many).split('\n').length, H.ALL_LOGS_NOTE_CAP);
});

test('mergeVisitEventLists unions by timestamp+action and sorts', () => {
    const a = [{ ts: 300, action: 'pma_local', click: true }, { ts: 100, action: 'direct_plant', click: true }];
    const b = [{ ts: 300, action: 'pma_local', click: true }, { ts: 200, action: 'pang_note', click: false }];
    const merged = H.mergeVisitEventLists(a, b);
    assert.deepStrictEqual(merged.map(e => e.ts), [100, 200, 300]);
    assert.strictEqual(merged.find(e => e.ts === 200).click, false);
});
