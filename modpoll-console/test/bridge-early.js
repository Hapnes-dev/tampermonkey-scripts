/*
 * The poll's headers at once (1.73.0), asked of the real server: claude-bridge/modpoll-mcp.js is started on a spare
 * port and polled as a 1.73.0 console and as an older one would poll it.
 *
 * Why it matters: Tampermonkey 5.5.1 runs every GM_xmlhttpRequest in the browser through one lock, held until that
 * request's response headers arrive. A poll whose headers waited for its command held the lock for up to 25 s and
 * stalled every userscript request in the browser behind it (claude-bridge/README.md, "Why the poll's headers go out
 * at once").
 *
 * - A console that sends X-MODPOLL-EARLY gets the status line and headers at once, and the command, a newer poll's
 *   refusal or a takeover in the body afterwards, always with status 200.
 * - A console that does not gets exactly the old answers: nothing until the poll ends, and a refusal as a 409.
 *
 * Run: node test/bridge-early.js
 */
'use strict';
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const SERVER = path.join(__dirname, '..', 'claude-bridge', 'modpoll-mcp.js');

function sparePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

let port = 0;
const BASE = { 'X-MODPOLL-BRIDGE': '1' };

/** One request with a JSON body; resolves {status, json} when it ends. */
function call(method, p, headers, body) {
  return new Promise((resolve) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, BASE, headers || {}),
      agent: false }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', (e) => resolve({ status: 0, json: { error: e.message } }));
    if (data !== undefined) req.write(data);
    req.end();
  });
}

/**
 * A poll, timed: `headersAt` is when the status line and headers arrived, `endAt` when the body ended, both in ms
 * from the start. `done` resolves at the end.
 */
function poll(session, early) {
  const t0 = Date.now();
  const out = { headersAt: null, endAt: null, status: null, length: null, json: null };
  out.done = new Promise((resolve) => {
    const headers = Object.assign({}, BASE, { 'X-MODPOLL-SESSION': session });
    if (early) headers['X-MODPOLL-EARLY'] = '1';
    const req = http.request({ host: '127.0.0.1', port, path: '/bridge/next', method: 'GET', headers, agent: false }, (res) => {
      out.headersAt = Date.now() - t0;
      out.status = res.statusCode;
      out.length = res.headers['content-length'] === undefined ? null : Number(res.headers['content-length']);
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        out.endAt = Date.now() - t0;
        try { out.json = JSON.parse(b); } catch (e) { out.json = null; }
        resolve(out);
      });
    });
    req.on('error', (e) => { out.endAt = Date.now() - t0; out.json = { error: 'socket: ' + e.message }; resolve(out); });
    req.end();
  });
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, cond, detail) {
  if (!cond) failed++;
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || detail === undefined ? '' : ': ' + detail));
}

/** Claude's side: a command through /bridge/call, answered by whoever holds the poll. */
async function command(name) {
  return call('POST', '/bridge/call', {}, { name, args: {}, timeout_ms: 5000 });
}

async function answer(session, id, result) {
  return call('POST', '/bridge/result', { 'X-MODPOLL-SESSION': session }, { id, result });
}

(async () => {
  port = await sparePort();
  const child = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, { MODPOLL_BRIDGE_PORT: String(port) }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      const r = await call('GET', '/bridge/hello');
      if (r.status === 200) up = true; else await sleep(100);
    }
    if (!up) { console.error('FAIL the server did not start on port ' + port); process.exitCode = 1; return; }

    const hello = await call('GET', '/bridge/hello');
    check('hello says the server sends early headers', hello.json && hello.json.early === true, JSON.stringify(hello.json));

    const a = await call('POST', '/bridge/attach', {}, { plant: '1', client: 'tab-A' });
    const S = a.json && a.json.session;
    check('attached', a.status === 200 && !!S, JSON.stringify(a.json));

    // 1.73.0 console: headers at once, the command in the body later.
    {
      const p = poll(S, true);
      await sleep(300);
      check('early: headers within 300 ms, before any command', p.headersAt !== null && p.headersAt < 300 && p.endAt === null,
        JSON.stringify(p));
      check('early: status 200 and no Content-Length (the body is still open)', p.status === 200 && p.length === null,
        JSON.stringify({ status: p.status, length: p.length }));
      const c = command('status');
      const r = await p.done;
      check('early: the command arrives in the body', r.json && r.json.cmd && r.json.cmd.name === 'status', JSON.stringify(r.json));
      const ack = await answer(S, r.json.cmd.id, { ok: 1 });
      check('early: the result is taken', ack.status === 200, JSON.stringify(ack));
      const out = await c;
      check('early: Claude gets the result', out.json && out.json.result && out.json.result.ok === 1, JSON.stringify(out.json));
    }

    // Console 1.72 and older: nothing until the poll ends, then status and body together, as before.
    {
      const p = poll(S, false);
      await sleep(800);
      check('old: no headers while the poll waits', p.headersAt === null, JSON.stringify(p));
      const c = command('status');
      const r = await p.done;
      check('old: status 200 with a Content-Length when the command comes', r.status === 200 && r.length > 0,
        JSON.stringify({ status: r.status, length: r.length }));
      check('old: the command arrives', r.json && r.json.cmd && r.json.cmd.name === 'status', JSON.stringify(r.json));
      await answer(S, r.json.cmd.id, { ok: 2 });
      const out = await c;
      check('old: Claude gets the result', out.json && out.json.result && out.json.result.ok === 2, JSON.stringify(out.json));
    }

    // A newer poll replaces a waiting one. Early: 200 with the refusal in the body. Old: 409, as before.
    {
      const p1 = poll(S, true);
      await sleep(150);
      const p2 = poll(S, true);
      const r1 = await p1.done;
      check('early, replaced: 200 with the refusal in the body',
        r1.status === 200 && r1.json && r1.json.error === 'replaced by a newer poll', JSON.stringify(r1));
      await sleep(150);
      check('early, replaced: the newer poll has its headers and waits', p2.headersAt !== null && p2.endAt === null, JSON.stringify(p2));
      const p3 = poll(S, false);
      const r2 = await p2.done;
      check('early poll replaced by an old one: still 200, refusal in the body',
        r2.status === 200 && r2.json && r2.json.error === 'replaced by a newer poll', JSON.stringify(r2));
      const p4 = poll(S, false);
      const r3 = await p3.done;
      check('old, replaced: 409 as before', r3.status === 409 && r3.json && r3.json.error === 'replaced by a newer poll', JSON.stringify(r3));
      // End p4 with a command so nothing is left waiting.
      const c = command('status');
      const r4 = await p4.done;
      if (r4.json && r4.json.cmd) await answer(S, r4.json.cmd.id, { ok: 3 });
      await c;
    }

    // Another tab takes over while an early poll waits: the takeover is in the body.
    {
      const p = poll(S, true);
      await sleep(150);
      const b = await call('POST', '/bridge/attach', {}, { plant: '1', client: 'tab-B' });
      const r = await p.done;
      check('early, taken over: 200 with "another tab attached" in the body',
        r.status === 200 && r.json && r.json.error === 'another tab attached', JSON.stringify(r));
      const again = poll(S, true);
      const r2 = await again.done;
      check('the displaced tab\'s next poll: 409 at once, before any early headers',
        r2.status === 409 && r2.json && r2.json.error === 'another tab attached', JSON.stringify(r2));
      check('tab B attached', b.status === 200 && b.json && !!b.json.session, JSON.stringify(b.json));
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})();
