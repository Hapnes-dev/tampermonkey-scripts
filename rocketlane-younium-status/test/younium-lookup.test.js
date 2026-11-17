'use strict';
/* The Younium status lookup (sections 1-2 of Rocketlane improvements), taken from the userscript as it stands and run
 * against an in-memory Younium where every request takes the same time - as every Tampermonkey request took 16-25 s on
 * 2026-11-17, when the chip spun for 200 s. Checks that the verdict is the one the lookup always gave, that it needs
 * three rounds of requests instead of nine, and that a request Tampermonkey loses is sent again.
 *   node --test "rocketlane-younium-status/test/*.test.js" */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join(__dirname, '..', 'rocketlane-younium-status.user.js');
const START = '  // 1. Younium auth core', END = '  // 3. Shared helpers';
const sectionOf = (src) => {
  src = src.replace(/\r\n/g, '\n');
  const a = src.indexOf(START), b = src.indexOf(END);
  assert.ok(a > 0 && b > a, 'sections 1-2 are in the userscript');
  // back to the banner line above each marker
  return src.slice(src.lastIndexOf('\n', src.lastIndexOf('\n', a - 1) - 1) + 1, src.lastIndexOf('\n', src.lastIndexOf('\n', b - 1) - 1) + 1);
};
const NOW = sectionOf(fs.readFileSync(FILE, 'utf8'));
// the lookup as it was before 1.85.0, for the same answers
let BEFORE = null;
try { BEFORE = sectionOf(execFileSync('git', ['show', '644e832^:rocketlane-younium-status/rocketlane-younium-status.user.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 << 20 })); } catch (_) { BEFORE = null; }

/** An in-memory Younium for plant 10263 as it stood on 2026-11-17: the store order, and the subscription agreement in
 *  Draft carrying the IWMAC product. Every request answers after `latency` ms; `lose` names requests never answered. */
function younium({ latency = 50, lose = new Set(), entity = 'AS' } = {}) {
  const orders = {
    o1: { id: 'o1', orderNumber: 'O-015949', description: 'Extra Laksvollen', status: 9, orderType: 1, isLastVersion: true,
      effectiveStartDate: '2026-09-01T00:00:00Z', modified: '2026-11-10T08:00:00Z', products: [{ productName: 'Kiona Edge kontroller' }] },
    o2: { id: 'o2', orderNumber: 'Draft', description: '10263 EXTRA Laksvollen - Abonnementsavtale', status: 5, orderType: 0, isLastVersion: true,
      effectiveStartDate: '2026-10-01T00:00:00Z', modified: '2026-11-01T08:00:00Z', products: [{ productName: 'IWMAC Abonnement' }] },
  };
  const calls = [];
  let inflight = 0, maxInflight = 0, rounds = 0, lastStart = -1;
  const W = {
    calls, orders,
    get maxInflight() { return maxInflight; },
    get rounds() { return rounds; },
    GM_xmlhttpRequest(o) {
      const u = new URL(o.url), p = u.pathname, body = o.data ? JSON.parse(o.data) : null;
      const label = o.method + ' ' + p;
      calls.push(label);
      // a "round" is a new batch of requests sent after the previous ones were answered
      if (inflight === 0) rounds++;
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      const answer = (status, json) => setTimeout(() => { inflight--; o.onload({ status, responseText: JSON.stringify(json) }); }, latency);
      const handle = { aborted: false, abort() { this.aborted = true; } };
      const key = label + (lose.has(label) ? '' : '#');
      if (lose.has(label)) { lose.delete(label); return handle; }   // never answered - once
      void key;
      if (u.host.startsWith('auth.')) { answer(200, { accessToken: 'tok', expiresIn: 86400 }); return handle; }
      if (p === '/api/applicationlegalentity/current') { answer(200, { id: entity, name: 'Kiona ' + entity }); return handle; }
      if (p === '/api/data/query/order') {
        const plant = (body.conditions || []).find((c) => c.fieldName === 'plant_id');
        const rows = plant && plant.value === '10263' ? Object.values(orders).map((x) => ({ ...x })) : [];
        answer(200, { result: rows.sort((a, b) => Date.parse(b.effectiveStartDate) - Date.parse(a.effectiveStartDate)) });
        return handle;
      }
      if (p === '/api/order/invoicesForHistory') { answer(200, body.orderNumber === 'O-015949' ? [{ posted: true, status: 1 }] : []); return handle; }
      if (p.startsWith('/api/eventlog/order/id/')) { answer(200, [{ created: '2026-11-01T08:00:00Z', userName: 'Thomas' }]); return handle; }
      const m = /^\/api\/order\/(\w+)$/.exec(p);
      if (m) { answer(200, orders[m[1]]); return handle; }
      answer(404, {});
      return handle;
    },
  };
  return W;
}

/** The section in a little world: Tampermonkey's storage and requests, the page's window and storage. */
function load(section, Y, gm = {}, lostMs) {
  const store = Object.assign({ ynRegion: 'eu', ynAccessToken: 'tok', ynAccessTokenExpiresAt: Date.now() + 3600000 }, gm);
  const local = {};
  const win = { localStorage: { getItem: (k) => (k in local ? local[k] : null), setItem: (k, v) => { local[k] = String(v); } } };
  let src = section;
  if (lostMs) src = src.replace(/const YN_LOST_MS = [^;]+;/, 'const YN_LOST_MS = ' + lostMs + ';');
  const f = new Function('GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', 'window', 'rlWhenDomReady', 'YOUNIUM_API', 'ynOrderUrl', 'console',
    src + '\nreturn { computeYouniumStatusByPlantId, ynRunForPlant };');
  const quiet = { log() {}, warn() {}, debug() {} };
  return { api: f((k, d) => (k in store ? store[k] : d), (k, v) => { store[k] = v; }, (o) => Y.GM_xmlhttpRequest(o), win, () => {}, 'https://api.younium.com',
    (id) => 'https://eu.younium.com/orders/' + id, quiet), store };
}
const plain = (v) => JSON.parse(JSON.stringify(Object.assign({}, v, { lastCheckedAt: null })));

test('10263: the same verdict as before 1.85.0, in three rounds of requests instead of nine', async (t) => {
  const Y = younium({ latency: 40 });
  const { api, store } = load(NOW, Y, { ynPlantEntity: JSON.stringify({ 10263: { id: 'AS', at: Date.now() } }) });
  const t0 = Date.now();
  const v = await api.computeYouniumStatusByPlantId('10263', '10263 - Extra Laksvollen: New store');
  const took = Date.now() - t0;
  assert.strictEqual(v.label, 'Younium: ⚠ Activate subscription in Younium', 'the chip it showed on 2026-11-17');
  assert.strictEqual(v.subscriptionStatus, 'Draft (not activated)');
  assert.strictEqual(v.orderNumber, 'O-015949');
  assert.strictEqual(Y.rounds, 3, 'entity + search, the orders, the logs and invoices: ' + Y.calls.join(' | '));
  assert.ok(took < 40 * 5, 'about three request times, not ten: ' + took + ' ms');
  assert.strictEqual(Y.calls.filter((c) => c === 'POST /api/data/query/order').length, 1, 'searched once');
  assert.strictEqual(Y.calls.filter((c) => c === 'GET /api/order/o1').length, 1, 'the main order fetched once');
  assert.strictEqual(Y.calls.filter((c) => c === 'GET /api/applicationlegalentity/current').length, 1, 'the entity read once');
  assert.strictEqual(JSON.parse(store.ynPlantEntity)['10263'].id, 'AS', 'still remembered in its entity');
  if (!BEFORE) return t.skip('the previous version is not in this checkout\'s history');
  const Y0 = younium({ latency: 40 });
  const before = load(BEFORE, Y0, { ynPlantEntity: JSON.stringify({ 10263: { id: 'AS', at: Date.now() } }) });
  const v0 = await before.api.computeYouniumStatusByPlantId('10263', '10263 - Extra Laksvollen: New store');
  // before: nine, one after another - 182 s on 2026-11-17, at ~20 s a request
  assert.strictEqual(Y0.rounds, 9, 'before: one request after another - ' + Y0.calls.join(' | '));
  assert.deepStrictEqual(plain(v), plain(v0), 'the same verdict, every field');
});

test('a plant whose orders sit in another entity: switched to as before, its answer used, the session put back', async () => {
  const Y = younium({ latency: 5, entity: 'SE' });
  const { api, store } = load(NOW, Y, { ynPlantEntity: JSON.stringify({ 10263: { id: 'AS', at: Date.now() } }) });
  // the session is in Sweden, the plant remembered in Norway: the lookup there is not used, the switch is made
  let switched = 0;
  const orig = Y.GM_xmlhttpRequest;
  Y.GM_xmlhttpRequest = (o) => {
    const p = new URL(o.url).pathname;
    if (p.startsWith('/api/auth/legalentity/')) { switched++; Y.calls.push('POST ' + p); setTimeout(() => o.onload({ status: 200, responseText: '{}' }), 5); return {}; }
    return orig(o);
  };
  const v = await api.computeYouniumStatusByPlantId('10263', '10263 - Extra Laksvollen: New store');
  assert.strictEqual(v.label, 'Younium: ⚠ Activate subscription in Younium');
  assert.strictEqual(switched, 2, 'to the plant\'s entity and back');
  assert.strictEqual(JSON.parse(store.ynPlantEntity)['10263'].id, 'AS');
});

test('a request Tampermonkey loses is given up and sent again: the lookup finishes', async () => {
  const Y = younium({ latency: 5, lose: new Set(['GET /api/order/o1']) });
  const { api } = load(NOW, Y, {}, 120);
  const t0 = Date.now();
  const v = await api.computeYouniumStatusByPlantId('10263', '10263 - Extra Laksvollen: New store');
  assert.strictEqual(v.label, 'Younium: ⚠ Activate subscription in Younium', 'answered after the second try');
  assert.strictEqual(Y.calls.filter((c) => c === 'GET /api/order/o1').length, 2, 'sent twice');
  assert.ok(Date.now() - t0 >= 120, 'after the limit, not before');
});

test('a lost token refresh does not hold every later request for good', async () => {
  const Y = younium({ latency: 5, lose: new Set(['POST /frontegg/identity/resources/auth/v1/user/token/refresh']) });
  // no token yet: the first request needs the refresh, which Tampermonkey loses once
  const { api } = load(NOW, Y, { ynAccessToken: '', ynAccessTokenExpiresAt: 0 }, 120);
  const v = await api.computeYouniumStatusByPlantId('10263', '10263 - Extra Laksvollen: New store');
  assert.strictEqual(v.label, 'Younium: ⚠ Activate subscription in Younium');
});
