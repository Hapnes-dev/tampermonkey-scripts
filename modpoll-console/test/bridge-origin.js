/*
 * Who the bridge server lets in, asked of the real server: claude-bridge/modpoll-mcp.js is started on a spare port
 * and sent the requests a userscript, a web page and a rebinding attempt would send.
 *
 * Since 1.69.0 the userscript asks from Tampermonkey's service worker, whose requests carry the extension's Origin;
 * the server must take that and still refuse every web page's.
 *
 * Run: node test/bridge-origin.js
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

function hello(port, headers) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/bridge/hello', method: 'GET', headers }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    req.end();
  });
}

(async () => {
  const port = await sparePort();
  const child = spawn(process.execPath, [SERVER], {
    env: Object.assign({}, process.env, { MODPOLL_BRIDGE_PORT: String(port) }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let failed = 0;
  try {
    // Wait for it to listen.
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      const r = await hello(port, { 'X-MODPOLL-BRIDGE': '1' });
      if (r.status === 200) up = true; else await new Promise((res) => setTimeout(res, 100));
    }
    if (!up) { console.error('FAIL the server did not start on port ' + port); process.exitCode = 1; return; }

    const base = { 'X-MODPOLL-BRIDGE': '1' };
    const cases = [
      ['no Origin (the offscreen road, before 1.69.0)', base, 200],
      ['Origin null', Object.assign({ Origin: 'null' }, base), 200],
      ['Tampermonkey in Chrome (the service worker road, 1.69.0)', Object.assign({ Origin: 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo' }, base), 200],
      ['Tampermonkey in Firefox', Object.assign({ Origin: 'moz-extension://3f1c0b9e-0000-4000-8000-000000000000' }, base), 200],
      ['a web site', Object.assign({ Origin: 'https://evil.example' }, base), 403],
      ['a page on this machine', Object.assign({ Origin: 'http://127.0.0.1:8102' }, base), 403],
      ['a plant page', Object.assign({ Origin: 'http://3006.plants.iwmac.local:8080' }, base), 403],
      ['an Origin that only contains the word', Object.assign({ Origin: 'https://chrome-extension.example' }, base), 403],
      ['no bridge header', { Origin: 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo' }, 403],
      ['a wrong protocol number', { 'X-MODPOLL-BRIDGE': '2', Origin: 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo' }, 403],
      ['a rebinding Host', Object.assign({ Host: 'evil.example:' + port, Origin: 'chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo' }, base), 403],
    ];
    for (const [name, headers, want] of cases) {
      const r = await hello(port, headers);
      const ok = r.status === want;
      if (!ok) failed++;
      console.log((ok ? 'ok   ' : 'FAIL ') + name + ': ' + r.status + (ok ? '' : ' (wanted ' + want + ') ' + r.body));
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})();
