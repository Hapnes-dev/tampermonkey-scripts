'use strict';
/* Rocketlane Chat Bridge 1.19.0: the Zendesk ⇄ General Chat sync moved to Rocketlane improvements 1.73.0, and this
 * script hands its links over once. The hand-over, taken from the userscript as it stands, with Tampermonkey's storage,
 * the page's localStorage and the timer stood in for.   node --test rocketlane-chat-bridge/test/ */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'rocketlane-chat-bridge.user.js'), 'utf8').replace(/\r\n/g, '\n');
const a = src.indexOf('// @@ZDSYNC-HANDOVER-START'), b = src.indexOf('// @@ZDSYNC-HANDOVER-END');
assert.ok(a > 0 && b > a, 'the hand-over markers are in the userscript');

const HANDOVER_KEY = 'rlimp_zdsync_handover_v1';
const STATE = JSON.stringify({ links: { '1210277:12352725': { projectId: '1210277', conversationId: '12352725', ticketId: '207248', zdMax: 9001, historyPosted: true } } });

/** One Rocketlane page with this script: its storage (shared by its tabs), the page's localStorage, its timers. */
function page(gm = {}, opts = {}) {
  const store = Object.assign({}, gm), local = {}, timers = [];
  const win = { localStorage: { getItem: (k) => (k in local ? local[k] : null), setItem: (k, v) => { local[k] = String(v); } } };
  win.top = opts.frame ? {} : win;
  win.self = win;
  const handOver = new Function('window', 'setTimeout', 'GM_getValue', 'GM_setValue', src.slice(a, b) + '\nreturn handOverZendeskChatSync;')(
    win, (fn, ms) => timers.push({ fn, ms }), (k, d) => (k in store ? store[k] : d), (k, v) => { store[k] = v; });
  return { store, local, timers, handOver, handover: () => (local[HANDOVER_KEY] ? JSON.parse(local[HANDOVER_KEY]) : null) };
}

test('the sync itself is gone from the Chat Bridge', () => {
  assert.ok(!/createZendeskChatSync|startZendeskChatSync|@@ZDSYNC-ENGINE/.test(src));
  assert.match(src, /try \{ handOverZendeskChatSync\(\); \}/, 'the hand-over runs on Rocketlane pages');
});

test('never used here: nothing handed over, and not looked at again', () => {
  const p = page();
  p.handOver();
  assert.strictEqual(p.handover(), null);
  assert.ok(p.store.zdsync_handed_over_v1 > 0);
  assert.ok(!('zdsync_enabled_v1' in p.store), 'nothing else touched');
});

test('on, with a link: turned off here and handed over at once when no older tab holds the round lock', () => {
  const p = page({ zdsync_enabled_v1: true, zdsync_state_v1: STATE, zdsync_view_title_v1: '', zdsync_not_now_v1: { '1:2': '3' } });
  p.handOver();
  const h = p.handover();
  assert.deepStrictEqual([h.v, h.enabled, h.state, h.view, h.notNow], [1, true, STATE, '', { '1:2': '3' }]);
  assert.strictEqual(p.store.zdsync_enabled_v1, false, 'off here: a tab still on 1.18.0 stops at its next round');
  assert.ok(p.store.zdsync_handed_over_v1 > 0);
  delete p.local[HANDOVER_KEY];   // taken by Rocketlane improvements
  p.handOver();                   // the next page
  assert.strictEqual(p.handover(), null, 'once only');
});

test('an older tab holds the round lock: off at once, handed over when the lock has run out, with what that tab saved last', () => {
  const p = page({ zdsync_enabled_v1: true, zdsync_state_v1: STATE, zdsync_lock_v1: { tab: 'old', until: Date.now() + 60000, visible: true } });
  p.handOver();
  assert.strictEqual(p.store.zdsync_enabled_v1, false);
  assert.strictEqual(p.handover(), null, 'not while the lock holds');
  assert.deepStrictEqual(p.timers.map((t) => t.ms), [5000]);
  // the older tab's last round saved its state; then its lock ran out
  const later = STATE.replace('9001', '9002');
  p.store.zdsync_state_v1 = later;
  p.store.zdsync_lock_v1 = { tab: 'old', until: Date.now() - 1, visible: true };
  p.timers.shift().fn();
  assert.strictEqual(p.handover().state, later);
  assert.strictEqual(p.handover().enabled, true, 'it was on, though it is off here now');
});

test('a page closed while it waited: the next one still hands over that the sync was on', () => {
  const p = page({ zdsync_enabled_v1: true, zdsync_state_v1: STATE, zdsync_lock_v1: { tab: 'old', until: Date.now() + 60000 } });
  p.handOver();
  p.timers.length = 0;            // that page is gone
  p.store.zdsync_lock_v1 = null;
  p.handOver();                   // the next page
  assert.strictEqual(p.handover().enabled, true);
  assert.strictEqual(p.handover().state, STATE);
});

test('another tab handed over while this one waited: no second copy', () => {
  const p = page({ zdsync_enabled_v1: true, zdsync_state_v1: STATE, zdsync_lock_v1: { tab: 'old', until: Date.now() + 60000 } });
  p.handOver();
  p.store.zdsync_handed_over_v1 = Date.now();
  p.store.zdsync_lock_v1 = null;
  p.timers.shift().fn();
  assert.strictEqual(p.handover(), null);
});

test('in a frame: nothing', () => {
  const p = page({ zdsync_enabled_v1: true, zdsync_state_v1: STATE }, { frame: true });
  p.handOver();
  assert.deepStrictEqual([p.handover(), p.store.zdsync_enabled_v1], [null, true]);
});
