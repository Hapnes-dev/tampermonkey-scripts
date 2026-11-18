/*
 * The road the bridge requests take (1.69.0), tested on the real bridgeHttp sliced out of the shipped userscript and
 * run against a stand-in for GM_xmlhttpRequest that answers as a new server, an old server, or no server would.
 *
 * - Every request is anonymous, so Tampermonkey makes it in its service worker and the 25 s poll no longer holds up
 *   every other userscript request in the browser.
 * - A server older than 1.69.0 refuses that request's extension Origin with 403 "not for you": the request is asked
 *   again the old way, once noted in the console, and later requests go the old way straight away.
 * - When the server goes away, the next one is tried on the fast road again.
 *
 * Run: node test/bridge-transport.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'Modpoll-Console.user.js');
const text = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

function slice(start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + 1);
  if (a === -1 || b === -1) { console.error('could not slice ' + JSON.stringify(start.slice(0, 40))); process.exit(1); }
  return text.slice(a, b);
}

const code =
  slice('    const BRIDGE = {', '    const BRIDGE_TABLE') +
  slice('    /*\n     * (1.69.0) Every request to the bridge is anonymous.', '    /**\n     * One register, one pass.');

let failed = 0;
function check(name, cond, detail) {
  if (!cond) failed++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail === undefined ? '' : ': ' + detail));
}

/** A fresh copy of the bridge client, talking to `server(details) -> {status, body} | 'down'`. */
function client(server) {
  const calls = [];
  const notes = [];
  const GM_xmlhttpRequest = (d) => {
    calls.push({ anonymous: d.anonymous, method: d.method, url: d.url, headers: Object.assign({}, d.headers), data: d.data });
    setTimeout(() => {
      const r = server(d);
      if (r === 'down') d.onerror({});
      else d.onload({ status: r.status, responseText: JSON.stringify(r.body) });
    }, 0);
  };
  const console = { info: (m) => notes.push(String(m)), log() {}, warn() {} };
  const self = globalThis;
  const make = new Function('GM_xmlhttpRequest', 'console', 'self', code + '\nreturn { BRIDGE, bridgeHttp };');
  const api = make(GM_xmlhttpRequest, console, self);
  return Object.assign(api, { calls, notes });
}

const NEW = () => ({ status: 200, body: { ok: true } });
const OLD = (d) => (d.anonymous ? { status: 403, body: { error: 'not for you' } } : { status: 200, body: { ok: true } });

(async () => {
  // A 1.69.0 server: one anonymous request, nothing noted.
  {
    const c = client(NEW);
    const r = await c.bridgeHttp('GET', '/bridge/hello', undefined, 4000);
    check('new server: answered', r && r.ok === true);
    check('new server: one request, anonymous', c.calls.length === 1 && c.calls[0].anonymous === true, JSON.stringify(c.calls));
    check('new server: nothing noted', c.notes.length === 0);
    check('new server: the bridge header goes along', c.calls[0].headers['X-MODPOLL-BRIDGE'] === '1');
  }

  // An older server: refused once, asked again the old way with the same request, then the old way straight away.
  {
    let server = 'old';
    const c = client((d) => (server === 'down' ? 'down' : server === 'old' ? OLD(d) : NEW(d)));
    c.BRIDGE.session = 'S1';
    const r = await c.bridgeHttp('POST', '/bridge/result', { id: 'x', result: 1 }, 20000);
    check('old server: answered after the fallback', r && r.ok === true);
    check('old server: anonymous first, then not', c.calls.length === 2 && c.calls[0].anonymous === true && c.calls[1].anonymous === false,
      JSON.stringify(c.calls.map((x) => x.anonymous)));
    check('old server: the same request asked again', c.calls[1].method === 'POST' && c.calls[1].url === c.calls[0].url &&
      c.calls[1].data === c.calls[0].data && c.calls[1].headers['X-MODPOLL-SESSION'] === 'S1');
    check('old server: noted once', c.notes.length === 1 && /older than 1\.69\.0/.test(c.notes[0]), JSON.stringify(c.notes));
    await c.bridgeHttp('GET', '/bridge/next', undefined, 40000);
    check('old server: the next request goes the old way at once', c.calls.length === 3 && c.calls[2].anonymous === false);
    check('old server: still noted only once', c.notes.length === 1);

    // The server goes away (Claude Code restarted) and a 1.69.0 one takes the port: the fast road again, at once.
    server = 'down';
    let err = null;
    try { await c.bridgeHttp('GET', '/bridge/hello', undefined, 4000); } catch (e) { err = e; }
    check('server gone: unreachable', err && err.message === 'bridge unreachable');
    server = 'new';
    c.calls.length = 0;
    const r2 = await c.bridgeHttp('GET', '/bridge/hello', undefined, 4000);
    check('new server back: one anonymous request', r2 && r2.ok === true && c.calls.length === 1 && c.calls[0].anonymous === true,
      JSON.stringify(c.calls.map((x) => x.anonymous)));
  }

  // Other refusals are the server's word, not the road's: no second request.
  {
    const c = client(() => ({ status: 409, body: { error: 'no such session' } }));
    let err = null;
    try { await c.bridgeHttp('GET', '/bridge/next', undefined, 40000); } catch (e) { err = e; }
    check('409: rejected with the server\'s reason', err && err.message === 'no such session' && err.status === 409);
    check('409: asked once', c.calls.length === 1);
  }
  {
    const c = client(() => ({ status: 403, body: { error: 'something else' } }));
    let err = null;
    try { await c.bridgeHttp('GET', '/bridge/hello', undefined, 4000); } catch (e) { err = e; }
    check('another 403: not retried', err && c.calls.length === 1 && c.BRIDGE.legacyTransport === false);
  }

  console.log(failed ? failed + ' failed' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})();
