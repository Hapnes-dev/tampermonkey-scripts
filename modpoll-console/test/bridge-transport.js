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
 * Since 1.73.0 (claude-bridge/README.md, "Why the poll's headers go out at once"):
 * - Every request asks for early headers (X-MODPOLL-EARLY), and a request whose answer never ends is aborted by the
 *   console's own guard, since Tampermonkey stops its timeout once the headers are in.
 * - The bridge loop reads a refusal from a 200 poll's body exactly as it reads a 409, and says once in the console
 *   when the server is older than 1.73.0.
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

  // (1.73.0) Every request asks for the poll's headers at once.
  {
    const c = client(NEW);
    await c.bridgeHttp('GET', '/bridge/hello', undefined, 4000);
    c.BRIDGE.session = 'S1';
    await c.bridgeHttp('GET', '/bridge/next', undefined, 40000);
    check('1.73.0: every request carries X-MODPOLL-EARLY: 1',
      c.calls.length === 2 && c.calls.every((x) => x.headers['X-MODPOLL-EARLY'] === '1'), JSON.stringify(c.calls.map((x) => x.headers)));
  }

  // (1.73.0) Headers in, body never: Tampermonkey's timeout no longer counts, so the console's guard ends it.
  {
    let aborted = 0;
    const GM_xmlhttpRequest = () => ({ abort() { aborted++; } });   // answers nothing, ever
    const console = { info() {}, log() {}, warn() {} };
    const make = new Function('GM_xmlhttpRequest', 'console', 'self', code + '\nreturn { BRIDGE, bridgeHttp };');
    const api = make(GM_xmlhttpRequest, console, globalThis);
    const t0 = Date.now();
    let err = null;
    try { await api.bridgeHttp('GET', '/bridge/next', undefined, 10); } catch (e) { err = e; }
    const took = Date.now() - t0;
    check('guard: a poll that never ends is aborted and rejected', err && err.message === 'bridge timed out' && aborted === 1,
      JSON.stringify({ err: err && err.message, aborted }));
    check('guard: after its own limit plus 5 s', took >= 5000 && took < 7000, String(took));
  }

  // (1.73.0) The bridge loop: a refusal in a 200 poll's body is a refusal, and an old server is named once.
  {
    const loopCode = slice('    async function bridgeLoop() {', '    // ------------------------------------------------------------------ init');
    const run = async (answers) => {
      const notes = [];
      const asked = [];
      let n = 0;
      const GM_xmlhttpRequest = (d) => {
        const path = d.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '');
        asked.push(path);
        const a = answers[Math.min(n++, answers.length - 1)];
        setTimeout(() => d.onload({ status: a.status || 200, responseText: JSON.stringify(a.body) }), 0);
        return { abort() {} };
      };
      const console = { info: (m) => notes.push(String(m)), log() {}, warn() {} };
      const make = new Function('GM_xmlhttpRequest', 'console', 'self', 'sleep', 'bridgeRun', 'sanitizeDeep', 'bridgePlantId',
        code + loopCode + '\nreturn { BRIDGE, bridgeLoop };');
      let api = null;
      const sleep = () => { if (n >= answers.length) api.BRIDGE.stop = true; return Promise.resolve(); };
      api = make(GM_xmlhttpRequest, console, globalThis, sleep, async () => ({}), (x) => x, () => '1');
      // The loop ends when the scripted answers run out: the next sleep stops it.
      const done = api.bridgeLoop();
      const stopper = setInterval(() => { if (n >= answers.length) api.BRIDGE.stop = true; }, 5);
      await done;
      clearInterval(stopper);
      return { BRIDGE: api.BRIDGE, notes, asked };
    };

    const taken = await run([
      { body: { ok: true, protocol: 1, attached: false, early: true } },
      { body: { session: 'S1', protocol: 1 } },
      { body: { error: 'another tab attached' } },                       // 200: the early poll's refusal
    ]);
    check('loop: "another tab attached" in a 200 body lets the session go and waits as a displaced tab',
      taken.BRIDGE.session === null && taken.BRIDGE.displaced === true, JSON.stringify({ s: taken.BRIDGE.session, d: taken.BRIDGE.displaced }));
    check('loop: a 1.73.0 server is not called old', !taken.notes.some((m) => /older than 1\.73\.0/.test(m)), JSON.stringify(taken.notes));

    const replaced = await run([
      { body: { ok: true, protocol: 1, attached: false } },              // no `early`: a server older than 1.73.0
      { body: { session: 'S2', protocol: 1 } },
      { body: { error: 'replaced by a newer poll' } },
    ]);
    check('loop: "replaced by a newer poll" in a 200 body keeps the session and backs off',
      replaced.BRIDGE.session === 'S2' && replaced.BRIDGE.backoff > 1000, JSON.stringify({ s: replaced.BRIDGE.session, b: replaced.BRIDGE.backoff }));
    check('loop: an older server is named once in the console',
      replaced.notes.filter((m) => /older than 1\.73\.0/.test(m)).length === 1, JSON.stringify(replaced.notes));

    const old409 = await run([
      { body: { ok: true, protocol: 1, attached: false } },
      { body: { session: 'S3', protocol: 1 } },
      { status: 409, body: { error: 'no such session' } },              // an old server's refusal, as before
    ]);
    check('loop: a 409 still lets the session go', old409.BRIDGE.session === null && old409.BRIDGE.displaced !== true,
      JSON.stringify({ s: old409.BRIDGE.session, d: old409.BRIDGE.displaced }));
  }

  console.log(failed ? failed + ' failed' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})();
