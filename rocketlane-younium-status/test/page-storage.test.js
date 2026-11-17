'use strict';
/* Rocketlane improvements 1.86.0: what is written where. Tampermonkey writes a script's whole set of values again on
 * every GM_setValue - 333 KB, about every 7 s, on 2026-11-17 - so the frequent writes and the big caches moved to the
 * page's own localStorage, and a value written again as it stands is not written. Runs the userscript's own parts:
 * GM_setValue (@@rlGmSetValue), the page's storage and the move out of Tampermonkey's (@@rlPageStore ..
 * @@rlPageMoveOut), and - against the 1.85.0 code from this repository's history - how a copy from before 1.86.0,
 * still open in another tab, is kept from running the Zendesk sync's rounds or the chat notifications beside it.
 * Since 1.86.1 also the chat notifications' check, which writes its record once instead of once per chat it opened.
 *   node --test "rocketlane-younium-status/test/*.test.js" */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join(__dirname, '..', 'rocketlane-younium-status.user.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const part = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i > 0 && j > i, a + ' is in the userscript'); return src.slice(i, j); };
const GMSET = part('  // @@rlGmSetValue:start', '  // @@rlGmSetValue:end');
const PAGE = part('  // @@rlPageStore:start', '  // @@rlPageMoveOut:end');
const fromHistory = (rev) => {
  try { return execFileSync('git', ['show', rev + ':rocketlane-younium-status/rocketlane-younium-status.user.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r\n/g, '\n'); } catch (_) { return null; }
};
// 1.85.0, the last version that kept the lock and the chat leader in Tampermonkey's storage
const OLD = fromHistory('ca1fd92');
// 1.86.0, the last version whose chat check wrote its record once for each chat it opened
const OLD186 = fromHistory('29696e1');

/** The text of the function that starts with `head` in `text`, to its closing brace. */
function fn(text, head) {
  const i = text.indexOf(head);
  assert.ok(i >= 0, head + ' is in the code');
  let depth = 0;
  for (let j = text.indexOf('{', i); j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  throw new Error('no end to ' + head);
}

/** Tampermonkey's storage as the script sees it, every write that reaches it counted, and the page's localStorage. */
function world({ gm = {}, local = {}, quota = Infinity } = {}) {
  const store = Object.assign({}, gm), page = Object.assign({}, local), writes = [], deleted = [];
  const size = () => Object.entries(page).reduce((n, [k, v]) => n + k.length + v.length, 0);
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(page, k) ? page[k] : null),
    setItem: (k, v) => {
      const was = page[k];
      page[k] = String(v);
      if (size() <= quota) return;
      if (was === undefined) delete page[k]; else page[k] = was;
      const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e;
    },
    removeItem: (k) => { delete page[k]; },
  };
  const api = new Function('tmSetValue', 'GM_getValue', 'GM_deleteValue', 'window', GMSET + PAGE + '\nreturn { GM_setValue, rlPageGet, rlPageSet };')(
    (k, v) => { writes.push(k); store[k] = v; }, (k, d) => (k in store ? store[k] : d), (k) => { deleted.push(k); delete store[k]; }, { localStorage });
  return { api, store, page, writes, deleted };
}

test('a string, number or boolean written again as it stands is not written; an object always is', () => {
  const { api, writes } = world({ gm: { state: '{"links":{}}', n: 5, on: true } });
  api.GM_setValue('state', '{"links":{}}');
  api.GM_setValue('n', 5);
  api.GM_setValue('on', true);
  assert.deepStrictEqual(writes, [], 'the same again: Tampermonkey not asked to write');
  api.GM_setValue('state', '{"links":{"a":1}}');
  api.GM_setValue('n', 6);
  api.GM_setValue('fresh', '');
  assert.deepStrictEqual(writes, ['state', 'n', 'fresh'], 'a change, and a key not there yet');
  const o = { tab: 'a' };
  api.GM_setValue('o', o);
  api.GM_setValue('o', o);
  api.GM_setValue('none', null);
  api.GM_setValue('none', null);
  assert.deepStrictEqual(writes.slice(3), ['o', 'o', 'none', 'none'], 'objects and null always: the one read back may be the caller\'s own, changed');
});

test('the page\'s storage: "rlimp:<key>", each value as it was given', () => {
  const { api, page } = world({ local: { accountMeta: '{}' } });
  api.rlPageSet('cache', '{"v":2}');
  api.rlPageSet('n', 0);
  api.rlPageSet('lock', { tab: 'x', busy: 0 });
  api.rlPageSet('on', true);
  api.rlPageSet('empty', '');
  assert.deepStrictEqual(page, { accountMeta: '{}', 'rlimp:cache': 's{"v":2}', 'rlimp:n': 'j0', 'rlimp:lock': 'j{"tab":"x","busy":0}', 'rlimp:on': 'jtrue', 'rlimp:empty': 's' });
  assert.deepStrictEqual([api.rlPageGet('cache'), api.rlPageGet('n', 5), api.rlPageGet('lock'), api.rlPageGet('on'), api.rlPageGet('empty', 'd'), api.rlPageGet('accountMeta', 'd'), api.rlPageGet('none', 'd')],
    ['{"v":2}', 0, { tab: 'x', busy: 0 }, true, '', 'd', 'd'], 'the page\'s own keys are not this script\'s');
  api.rlPageSet('lock', null);
  api.rlPageSet('n', undefined);
  assert.deepStrictEqual(Object.keys(page).sort(), ['accountMeta', 'rlimp:cache', 'rlimp:empty', 'rlimp:on'], 'null and undefined take a value away');
});

test('the page\'s storage full: this script\'s caches make room, Rocketlane\'s own values stay', () => {
  const { api, page } = world({ quota: 9000, local: { 'rlimp:rlHpProjectsCache': 's' + 'x'.repeat(5000), 'rlimp:rltlCacheV2': 's{}', 'rocketlane-own': 'y'.repeat(3000) } });
  assert.strictEqual(api.rlPageSet('zdsync_lock_v1', { tab: 'a'.repeat(1500) }), true, 'written once the caches gave way');
  assert.deepStrictEqual(Object.keys(page).sort(), ['rlimp:zdsync_lock_v1', 'rocketlane-own']);
  assert.strictEqual(api.rlPageSet('big', 'z'.repeat(20000)), false, 'what does not fit even so: refused, and no error');
  assert.strictEqual(page['rocketlane-own'].length, 3000);
});

test('1.86.0 moves the caches out of Tampermonkey\'s storage once; tokens, settings and links stay', () => {
  const gm = {
    rlHpProjectsCache: '{"v":2,"at":1}', rltlCacheV2: '{"v":2}', rlZdReplyAtCache: '{}', rltlMineCache: '{}',
    rlChatNotifyLive: '{"at":1}', rlChatNotifyLastPoll: 5, rlChatNotifyHeard: 7,
    zdsync_state_v1: '{"links":{}}', zdsync_lock_v1: { tab: 'x' }, rlChatNotifyLeader: '{"id":"x"}', ynAccessToken: 'tok', rlChatNotifyEnabled: true,
  };
  // the timeline cache is in the page already - written by a tab running 1.86.0 since: that one stays
  const first = world({ gm, local: { 'rlimp:rltlCacheV2': 's{"v":2,"newer":1}' } });
  assert.deepStrictEqual(first.deleted.slice().sort(), ['rlChatNotifyHeard', 'rlChatNotifyLastPoll', 'rlChatNotifyLive', 'rlHpProjectsCache', 'rlZdReplyAtCache', 'rltlCacheV2', 'rltlMineCache']);
  assert.deepStrictEqual(Object.keys(first.store).sort(), ['rlChatNotifyEnabled', 'rlChatNotifyLeader', 'ynAccessToken', 'zdsync_lock_v1', 'zdsync_state_v1'],
    'kept: the token, a setting, the links, and the two records older copies still read');
  assert.deepStrictEqual(first.page, { 'rlimp:rlHpProjectsCache': 's{"v":2,"at":1}', 'rlimp:rltlCacheV2': 's{"v":2,"newer":1}', 'rlimp:rlZdReplyAtCache': 's{}' },
    'the caches came along; the page\'s own newer one kept; nothing else copied');
  assert.deepStrictEqual(first.writes, [], 'nothing written to Tampermonkey\'s storage but the deletions');
  const next = world({ gm: first.store, local: first.page });
  assert.deepStrictEqual([next.deleted, next.writes], [[], []], 'the next page load: nothing left to move');
});

test('the Zendesk sync: a copy from before 1.86.0 keeps the rounds while it holds its lock, and is kept out after', async (t) => {
  if (!OLD) return t.skip('1.85.0 is not in this checkout\'s history');
  const glue = part('  function startZendeskChatSync(net) {', '  // @@ZDSYNC-END');
  const newer = fn(glue, 'async function olderKeptOut() {');
  const STANDING = /const STANDING = "([^"]+)", DAY = ([^;]+);/.exec(glue);
  assert.ok(STANDING, 'the standing lock\'s name and length are in the sync');
  const older = fn(OLD, '    async function claim() {');
  const store = {};
  const get = (k, d) => (k in store ? JSON.parse(JSON.stringify(store[k])) : d);
  const set = (k, v) => { store[k] = v; };
  const env = 'const LOCK_KEY = "zdsync_lock_v1", STANDING = ' + JSON.stringify(STANDING[1]) + ', DAY = ' + STANDING[2] + ';' +
    'const settle = () => Promise.resolve(); const frontMs = () => 15000, backMs = () => 60000;';
  const keepOut = new Function('get', 'set', env + newer + '\nreturn olderKeptOut;')(get, set);
  const oldClaim = (tabId, visible) => new Function('get', 'set', 'tabId', 'visible', env + older + '\nreturn claim;')(get, set, tabId, () => visible)();

  // the older copy runs a round: its lock is taken, and renewed every round
  assert.strictEqual(await oldClaim('old-tab', false), true, 'an older copy alone: it runs the rounds');
  assert.strictEqual(await keepOut(), false, 'while it holds its lock, no round here: both would post the same messages');
  assert.strictEqual(store.zdsync_lock_v1.tab, 'old-tab', 'and its lock left as it is');
  // its round still going when its lock has run out: still left to it
  store.zdsync_lock_v1 = Object.assign({}, store.zdsync_lock_v1, { until: Date.now() - 1000, busy: Date.now() - 60000 });
  assert.strictEqual(await keepOut(), false, 'a round that may still be going is not run beside');
  // gone (closed, reloaded, or still for long): the standing lock, for a day
  store.zdsync_lock_v1 = Object.assign({}, store.zdsync_lock_v1, { busy: 0 });
  assert.strictEqual(await keepOut(), true);
  const standing = store.zdsync_lock_v1;
  assert.deepStrictEqual([standing.tab, standing.visible, standing.until - Date.now() > 23 * 3600 * 1000], [STANDING[1], true, true]);
  // the older copy, in front or behind, takes no round again - and writes nothing
  for (const visible of [true, false]) {
    assert.strictEqual(await oldClaim('old-tab', visible), false, 'an older copy ' + (visible ? 'in front' : 'behind') + ' keeps out');
    assert.strictEqual(store.zdsync_lock_v1, standing);
  }
  // renewed twice a day, not every round
  assert.strictEqual(await keepOut(), true);
  assert.strictEqual(store.zdsync_lock_v1, standing, 'not written again while it holds for more than half a day');
  store.zdsync_lock_v1 = Object.assign({}, standing, { until: Date.now() + 11 * 3600 * 1000 });
  assert.strictEqual(await keepOut(), true);
  assert.ok(store.zdsync_lock_v1.until - Date.now() > 23 * 3600 * 1000, 'renewed when less than half a day is left');
});

test('chat notifications: a copy from before 1.86.0 leading in Tampermonkey\'s storage leaves the lead to the standing record', (t) => {
  if (!OLD) return t.skip('1.85.0 is not in this checkout\'s history');
  const helpers = part('  // @@rlChatNotifyHelpers:start', '  // @@rlChatNotifyHelpers:end');
  const keepOlderOut = fn(src, 'function rlCnKeepOlderOut() {');
  const standingId = /const RL_CN_STANDING = "([^"]+)";/.exec(src)[1];
  const store = {};
  const GM_getValue = (k, d) => (k in store ? store[k] : d);
  const GM_setValue = (k, v) => { store[k] = v; };
  const make = (code, version, tabId) => new Function('GM_getValue', 'GM_setValue', 'RL_CN_VERSION', 'rlCnTabId',
    'const RL_CN_GM_LEADER = "rlChatNotifyLeader", RL_CN_STANDING = ' + JSON.stringify(standingId) + ', RL_CN_LEADER_STALE_MS = 150 * 1000;\n' +
    helpers + '\n' + code)(GM_getValue, GM_setValue, version, tabId);
  const oldLead = make(fn(OLD, 'function rlCnReadLeader() {') + fn(OLD, 'function rlCnHoldsLead() {') + '\nreturn rlCnHoldsLead;', '1.85.0', 'old-tab');
  const keepOut = make(keepOlderOut + '\nreturn rlCnKeepOlderOut;', '1.86.0', 'new-tab');

  oldLead();
  assert.strictEqual(oldLead(), true, 'an older copy alone leads, in Tampermonkey\'s storage');
  keepOut();
  const record = JSON.parse(store.rlChatNotifyLeader);
  assert.deepStrictEqual([record.id, record.v, record.at - Date.now() > 23 * 3600 * 1000], [standingId, '1.86.0', true]);
  assert.strictEqual(oldLead(), false, 'at its next tick it leaves the lead to the newer version');
  assert.strictEqual(oldLead(), false, 'and does not take it back');
  assert.strictEqual(store.rlChatNotifyLeader, JSON.stringify(record), 'nor writes there');
  keepOut();
  assert.strictEqual(store.rlChatNotifyLeader, JSON.stringify(record), 'renewed twice a day, not every tick');
});

/**
 * One full check of five owned projects' chats, run with the rlCnCheck in `text` (and its GM_setValue, helpers and
 * record), at `now`. Returns what it wrote to Tampermonkey's storage and what it showed, in order.
 *   p1/101: one new message          p2/102: still unread, nothing new: looked at again after 5 min
 *   p3/103: two new, and one's own   p4/104: seen for the first time: noted, and in the one summary
 *   p5/105: its messages fail to load: left as it was
 */
async function chatCheck(text, store, now) {
  const slice = (a, b) => { const i = text.indexOf(a), j = text.indexOf(b); assert.ok(i > 0 && j > i, a + ' is in the code'); return text.slice(i, j); };
  const consts = ['RL_CN_GM_STATE', 'RL_CN_REFETCH_MS', 'RL_CN_PER_CHAT'].map((k) => new RegExp('const ' + k + ' = [^;]+;').exec(text)[0]).join('\n');
  const unread = { 101: 2, 102: 1, 103: 3, 104: 2, 105: 1 };
  const msg = (commentId, createdAt, createdBy) => ({ commentId, createdAt, createdBy, messageType: 'USER_MESSAGE' });
  const comments = {
    101: [msg('a1', 1000, 7), msg('a2', 2000, 7)],
    102: [msg('b1', 1000, 7)],
    103: [msg('c1', 1000, 1), msg('c2', 3000, 7), msg('c3', 3100, 8)],
    104: [msg('d1', 500, 7), msg('d2', 600, 7)],
  };
  const gmRocketlaneGet = async (p) => {
    let m = /^\/projects\/p(\d)\/project-conversations$/.exec(p);
    if (m) return [{ conversationId: 100 + Number(m[1]), unreadMessages: unread[100 + Number(m[1])], partOfConversation: true }];
    m = /^\/projects\/p\d\/project-conversations\/(\d+)\/conversations$/.exec(p);
    if (m && comments[m[1]]) return { comments: comments[m[1]] };
    throw new Error('HTTP 502');
  };
  const log = [];
  const check = new Function('tmSetValue', 'GM_getValue', 'Date', 'rlHpReadCurrentUserId', 'rlZdMapWithConcurrency', 'gmRocketlaneGet',
    'rlCnAnnounce', 'rlCnNotify', 'rlCnChatUrl',
    slice('  // @@rlGmSetValue:start', '  // @@rlGmSetValue:end') + slice('  // @@rlChatNotifyHelpers:start', '  // @@rlChatNotifyHelpers:end') +
    consts + '\n' + fn(text, 'function rlCnReadState() {') + '\n' + fn(text, 'function rlCnWriteState(s) {') + '\n' +
    fn(text, 'async function rlCnCheck(projects, full) {') + '\nreturn rlCnCheck;')(
    (k, v) => { log.push('write ' + k); store[k] = v; }, (k, d) => (k in store ? store[k] : d), { now: () => now },
    () => '1', (items, n, f) => Promise.all(items.map(f)), gmRocketlaneGet,
    (project, conv, fresh) => log.push('announce ' + conv.conversationId + ': ' + fresh.map((m) => m.commentId).join(' ')),
    (opts) => log.push('notify ' + opts.tag), () => 'url');
  await check([1, 2, 3, 4, 5].map((n) => ({ id: 'p' + n, name: 'Project ' + n })), true);
  return log;
}

test('chat notifications: a check writes its record once, before it shows anything (1.86.1)', async () => {
  const before = JSON.stringify({
    101: { at: 1000, unread: 1, fetchedAt: 0 }, 102: { at: 1000, unread: 1, fetchedAt: 0 },
    103: { at: 1000, unread: 3, fetchedAt: 0 }, 105: { at: 1000, unread: 1, fetchedAt: 0 }, 999: { at: 1000, unread: 0, fetchedAt: 0 },
  });
  const now = 20 * 60 * 1000;
  const store = { rlChatNotifyState: before };
  const log = await chatCheck(src, store, now);
  assert.deepStrictEqual(log, ['write rlChatNotifyState', 'announce 101: a2', 'announce 103: c2 c3', 'notify rl-chat-summary'],
    'one write, and before the first notification, so another tab never announces the same messages');
  const after = store.rlChatNotifyState;
  assert.deepStrictEqual(JSON.parse(after), {
    101: { at: 2000, unread: 2, fetchedAt: now }, 102: { at: 1000, unread: 1, fetchedAt: now },
    103: { at: 3100, unread: 3, fetchedAt: now }, 104: { at: 600, unread: 2, fetchedAt: now }, 105: { at: 1000, unread: 1, fetchedAt: 0 },
  }, 'every chat opened is in it, the one that failed as it was, and the chat of a project no longer mine is forgotten');
  assert.deepStrictEqual(await chatCheck(src, store, now + 60 * 1000), [], 'a check that changes nothing writes nothing');

  if (!OLD186) return;
  const old = { rlChatNotifyState: before };
  const oldLog = await chatCheck(OLD186, old, now);
  assert.strictEqual(oldLog.filter((l) => l.startsWith('write ')).length, 5, '1.86.0 wrote once for each chat it opened, and once more at the end');
  assert.deepStrictEqual(oldLog.filter((l) => !l.startsWith('write ')), log.slice(1), 'the same notifications as 1.86.0');
  assert.strictEqual(old.rlChatNotifyState, after, 'and the same record');
});
