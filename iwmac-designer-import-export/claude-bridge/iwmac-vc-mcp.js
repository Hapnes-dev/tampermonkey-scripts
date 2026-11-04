#!/usr/bin/env node
/*
 * iwmac-vc-mcp.js - lets Claude read and change the IWMAC Designer panel open in VectorCraft.
 *
 * Claude Code starts it as an MCP server: newline-delimited JSON-RPC 2.0 on stdio. It also listens on 127.0.0.1 (port
 * 47913, or IWDIE_BRIDGE_PORT), where the IWMAC Designer Import/Export userscript, running in the VectorCraft tab that
 * the Designer's "Edit in VectorCraft" opened, finds it, attaches and takes Claude's calls one at a time: the drawing's
 * scene, a preview, an edit, a check, an undo. The userscript makes every change in that tab, opens it in VectorCraft as
 * a new document and keeps the version before. Nothing here or there syncs to the Designer: the user reviews and presses
 * Ctrl+S. Reading an Export JSON file (iwmac_export) needs no tab.
 *
 * Who may talk to the port: only the userscript, and (1.9.0) another session's server of this same file. A request must
 * come to 127.0.0.1 or localhost by that very name (no DNS rebinding), carry the X-IWDIE-Bridge header (a web page cannot
 * send it without a CORS preflight, which is refused) and no web page's Origin; after the attach, the session's token. A
 * second Claude Code session finds the port taken and sends its calls through the server that holds it, with the key
 * that server wrote to this user's temp folder. The port is bound to the loopback only.
 *
 * No dependencies. Node 18 or later.
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'iwmac-vectorcraft', VERSION = '1.11.0', PROTOCOL = 1;
// the userscript that answers an edit's check and preview in the same call, and says whether its tab shows; and (1.10.0)
// the one that opens a file and gives the drawing as a panel file
const TAB_MIN = '1.111.0', OPEN_MIN = '1.112.0';
const PORT = parseInt(process.env.IWDIE_BRIDGE_PORT || '47913', 10);
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 64 * 1024 * 1024;
const KEY_FILE = path.join(os.tmpdir(), 'iwmac-vc-mcp-' + PORT + '.key');
const SELF = 'pid:' + process.pid;
// every wait of this server times this (1.9.0): the tests run it fast
const SCALE = Math.max(0.001, parseFloat(process.env.IWDIE_BRIDGE_TIME_SCALE || '1') || 1);
// (1.10.0) the Copilot kit's skills (the private tampermonkey-scripts-documents, beside this repository, or IWDIE_KIT),
// whose builders, checks and readers iwmac_build, iwmac_snapshot and iwmac_trace run; and the Python that runs them
const PY = process.env.IWDIE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
function findKit() {
  const cands = [];
  if (process.env.IWDIE_KIT) cands.push(process.env.IWDIE_KIT, path.join(process.env.IWDIE_KIT, 'copilot-skill'));
  let d = __dirname;
  for (let i = 0; i < 6; i++) {
    d = path.dirname(d);
    cands.push(path.join(d, 'tampermonkey-scripts-documents', 'iwmac-designer-import-export', 'copilot-skill'));
  }
  return cands.find(c => { try { return fs.existsSync(path.join(c, 'iwmac-overview-picture', 'scripts', 'check.py')); } catch (e) { return false; } }) || null;
}
const KIT = findKit();

// the userscript's pure helpers, where it lies beside this folder (roles of objects in an export, the menu's search words)
let script = null;
try { script = require(path.join(__dirname, '..', 'IWMAC-Designer-Import-Export.user.js')); } catch (e) { script = null; }

const log = (...a) => process.stderr.write('[' + NAME + '] ' + a.join(' ') + '\n');

/** Whether version a is older than b, number by number. */
function older(a, b) {
  const x = String(a || '').split('.').map(n => parseInt(n, 10) || 0), y = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); }
  return false;
}

/* ---------------- the page: the VectorCraft tab's userscript ---------------- */

let page = null;            // {session, context, at, seen, vis, visAt, waiting, waitTimer, working}
const queue = [];           // commands for the page, in order
const sent = new Map();     // id -> a command the page has
const late = new Map();     // id -> a command whose time ran out while the page had it: its answer is still taken (1.9.0)
const news = [];            // what such answers said, told with the next call of the session that made it
const takenOver = [];       // sessions another tab replaced: told so, they do not take Claude back by themselves
const readJobs = new Map(); // caller -> the edit job whose scene that session read last: only that drawing may be changed
let nextId = 1, portState = 'starting', listening = false, key = null;
let proxy = null;           // (1.9.0) the server that holds the port, when another session's does: {version, pid}
const TAKEN = 'another VectorCraft tab attached';

const NOT_ATTACHED = 'No VectorCraft tab is attached. In the IWMAC Designer, open the panel and click "Edit in VectorCraft…" (or open ' +
  'VectorCraft by itself and a panel file from its start card); the tab finds this server by itself within seconds (its banner shows ' +
  'Claude: connected). The userscript must be 1.64.0 or later, and Tampermonkey must be allowed to reach 127.0.0.1.';
const BEHIND = 'The VectorCraft tab is behind another tab, where Chrome stops drawing it, so VectorCraft can neither save the drawing ' +
  'nor open a new version. Nothing was changed. Ask the user to bring the VectorCraft tab to the front, then try again.';

/** What the port says, where this server could not take it. */
function portNote() {
  return listening || proxy ? '' : ' This server has no port: ' + PORT + ' ' + portState + '.';
}

function reply(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null); } catch (e) { reject(new Error('not JSON')); }
    });
    req.on('error', reject);
  });
}

function pump() {
  if (!page || !page.waiting || !queue.length) return;
  const cmd = queue.shift(), res = page.waiting;
  page.waiting = null;
  clearTimeout(page.waitTimer);
  sent.set(cmd.id, cmd);
  // (1.9.0) handed over is heard from: a tab busy with it sends nothing else until it answers or beats
  page.seen = Date.now();
  reply(res, 200, { cmd: { id: cmd.id, name: cmd.name, args: cmd.args } });
}

function detach(why) {
  if (!page) return;
  if (page.waiting) { reply(page.waiting, 409, { error: why }); page.waiting = null; clearTimeout(page.waitTimer); }
  page = null;
  for (const cmd of [...queue, ...sent.values()]) { clearTimeout(cmd.timer); cmd.reject(new Error('the VectorCraft tab went away: ' + why)); }
  queue.length = 0;
  sent.clear();
  late.clear();
}

/** A change needs the tab in front: VectorCraft draws, and so saves and opens, only there. */
const needsFront = (name, args) => (name === 'edit' && !(args && args.dry_run)) || name === 'undo';

/** One call to the page. -> Promise<result> */
function ask(name, args, ms, caller) {
  ms = Math.max(50, Math.round(ms * SCALE));
  return new Promise((resolve, reject) => {
    if (!page) { reject(new Error(NOT_ATTACHED + portNote())); return; }
    // (1.9.0) the tab said it is behind another tab: no waiting for a time to run out
    if (page.vis === false && needsFront(name, args)) { reject(new Error(BEHIND)); return; }
    const cmd = { id: nextId++, name, args: args || {}, resolve, reject, caller: caller || SELF };
    cmd.timer = setTimeout(() => {
      const i = queue.indexOf(cmd);
      if (i >= 0) queue.splice(i, 1);
      // the tab has it: its answer, when it comes, is told with the next call (1.9.0)
      if (sent.delete(cmd.id)) late.set(cmd.id, { name, caller: cmd.caller, at: Date.now() });
      reject(new Error('the VectorCraft tab did not answer in ' + Math.round(ms / 1000) + ' s. ' + (page && page.vis === false
        ? 'It is behind another tab, where Chrome stops drawing it: ask the user to bring it to the front.'
        : 'Is it open, with its tab in front? VectorCraft draws, and so saves, only while its tab shows.') +
        (i < 0 ? ' If it answers after all, the next call says what came of it.' : '')));
    }, ms);
    queue.push(cmd);
    pump();
  });
}

/** What a late answer said, in a line. */
function lateLine(l, body) {
  const r = body && body.result;
  if (!body || !body.ok) return 'the earlier ' + l.name + ' that ran out of time failed after all: ' + String((body && body.error) || 'no reason given');
  if (l.name === 'edit' && r && r.applied) {
    return 'the earlier edit that ran out of time was made after all: it is open as ' + r.document + (Array.isArray(r.added) ? ' (' + r.added.length + (r.added.length === 1 ? ' thing' : ' things') + ' added)' : '') +
      ' - read the scene before another edit, and do not make it again';
  }
  if (l.name === 'undo' && r) return 'the earlier undo that ran out of time was made after all: ' + r.document + ' is open';
  return 'the earlier ' + l.name + ' that ran out of time answered after all';
}

const server = http.createServer((req, res) => {
  const host = String(req.headers.host || ''), origin = req.headers.origin;
  const okHost = host === '127.0.0.1:' + PORT || host === 'localhost:' + PORT;
  const okOrigin = !origin || /^(chrome|moz|safari-web)-extension:\/\//.test(String(origin));
  if (!okHost || !okOrigin || req.headers['x-iwdie-bridge'] !== String(PROTOCOL) || req.method === 'OPTIONS') {
    reply(res, 403, { error: 'forbidden' });
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  const mine = page && req.headers['x-iwdie-session'] === page.session;
  if (req.method === 'GET' && url.pathname === '/bridge/hello') {
    // `tool`: another session's server may send its calls here (1.9.0)
    reply(res, 200, { server: 'iwmac-vc-mcp', version: VERSION, protocol: PROTOCOL, attached: !!page, tool: true, pid: process.pid });
    return;
  }
  // (1.9.0) another Claude Code session's call, sent by its own server of this file: with the key this one wrote
  if (req.method === 'POST' && url.pathname === '/bridge/tool') {
    const given = String(req.headers['x-iwdie-key'] || '');
    if (!key || given.length !== key.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) { reply(res, 403, { error: 'forbidden' }); return; }
    readBody(req).then(body => {
      const caller = 'proxy:' + String((body && body.caller) || 'other');
      return call(body && body.name, (body && body.args) || {}, caller)
        .then(result => reply(res, 200, { result }),
          e => reply(res, 200, { result: { content: [{ type: 'text', text: 'Error: ' + (e && e.message ? e.message : String(e)) }], isError: true } }));
    }, e => reply(res, 400, { error: e.message }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/bridge/attach') {
    readBody(req).then(body => {
      const ctx = body && body.context;
      if (!ctx || ctx.protocol !== PROTOCOL || !ctx.job) { reply(res, 400, { error: 'a context of protocol ' + PROTOCOL + ' is needed' }); return; }
      if (page) {
        takenOver.push(page.session);
        if (takenOver.length > 20) takenOver.shift();
        detach(TAKEN);
      }
      page = { session: crypto.randomBytes(24).toString('hex'), context: ctx, at: Date.now(), seen: Date.now(), vis: undefined, visAt: 0, waiting: null, waitTimer: null, working: '' };
      log('attached: plant', ctx.job.plant, 'panel', JSON.stringify(ctx.job.panel), 'userscript', ctx.version);
      reply(res, 200, { session: page.session, server: VERSION });
    }, e => reply(res, 400, { error: e.message }));
    return;
  }
  if (!mine) { reply(res, 409, { error: takenOver.includes(String(req.headers['x-iwdie-session'] || '')) ? TAKEN : 'no such session' }); return; }
  page.seen = Date.now();
  if (req.method === 'GET' && url.pathname === '/bridge/next') {
    const v = url.searchParams.get('vis');
    if (v === '0' || v === '1') { page.vis = v === '1'; page.visAt = Date.now(); }
    page.working = '';
    if (page.waiting) { reply(page.waiting, 200, { cmd: null }); clearTimeout(page.waitTimer); }
    page.waiting = res;
    const wait = Math.max(1, Math.min(30, parseInt(url.searchParams.get('wait') || '25', 10)));
    page.waitTimer = setTimeout(() => { if (page && page.waiting === res) { page.waiting = null; reply(res, 200, { cmd: null }); } }, wait * 1000);
    req.on('close', () => { if (page && page.waiting === res) { page.waiting = null; clearTimeout(page.waitTimer); } });
    pump();
    return;
  }
  // (1.9.0) the tab's state between calls: whether it shows, and that a long call still runs
  if (req.method === 'POST' && url.pathname === '/bridge/beat') {
    readBody(req).then(body => {
      if (body && typeof body.vis === 'boolean') { page.vis = body.vis; page.visAt = Date.now(); }
      if (body && typeof body.working === 'string') page.working = body.working;
      reply(res, 200, { ok: true });
    }, e => reply(res, 400, { error: e.message }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/bridge/result') {
    readBody(req).then(body => {
      const cmd = body && sent.get(body.id);
      if (!cmd) {
        // (1.9.0) one whose time ran out: what it says is kept for the next call of the session that asked
        const l = body && late.get(body.id);
        if (l) {
          late.delete(body.id);
          news.push({ caller: l.caller, line: lateLine(l, body) });
          if (news.length > 20) news.shift();
          reply(res, 200, { ok: true, late: true });
          return;
        }
        reply(res, 404, { error: 'no such call' });
        return;
      }
      sent.delete(body.id);
      clearTimeout(cmd.timer);
      if (body.ok) cmd.resolve(body.result); else cmd.reject(new Error(String(body.error || 'the tab could not do it')));
      reply(res, 200, { ok: true });
    }, e => reply(res, 400, { error: e.message }));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/bridge/detach') { detach('the tab left'); reply(res, 200, { ok: true }); return; }
  reply(res, 404, { error: 'not found' });
});

/* ---------------- one port, shared by the sessions on this computer ---------------- */

// (1.9.0) A second Claude Code session finds the port taken. If the server there is one of these (1.9.0 or later), its
// calls go through that one, with the key it wrote; either way it takes the port over when that session ends.
const RETRY_MS = Math.max(100, parseInt(process.env.IWDIE_BRIDGE_RETRY_MS || '10000', 10));

function bridgeGet(p, ms) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method: 'GET', path: p, timeout: ms || 2500,
      headers: { Host: '127.0.0.1:' + PORT, 'X-IWDIE-Bridge': String(PROTOCOL) } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(data); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    r.end();
  });
}

/** Who holds the port: another of these, and whether it takes calls from this one. */
function probeHolder() {
  return bridgeGet('/bridge/hello', 2500).then(r => {
    const j = r.json;
    if (r.status !== 200 || !j || j.server !== 'iwmac-vc-mcp') {
      proxy = null;
      portState = 'in use by something else than this bridge: free port ' + PORT + ', or set IWDIE_BRIDGE_PORT for both ends';
      return;
    }
    if (!j.tool) {
      proxy = null;
      portState = 'in use: another Claude Code session most likely has this bridge (its server ' + (j.version || 'old') +
        ' is too old to share it); this one takes the port over when that session ends';
      return;
    }
    proxy = { version: j.version, pid: j.pid };
    portState = 'in use: another Claude Code session’s server (' + j.version + ', pid ' + j.pid + ') holds it; this session’s calls go through it';
  }, () => {
    proxy = null;
    portState = 'in use: another Claude Code session most likely has this bridge; this one takes the port over when that session ends';
  }).then(() => log('port', PORT, portState));
}

/** A tool call sent to the server that holds the port. -> Promise<MCP result> */
function forward(name, args) {
  let k = '';
  try { k = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) { k = ''; }
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ name, args, caller: SELF }));
    const r = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/bridge/tool', timeout: 240000,
      headers: { Host: '127.0.0.1:' + PORT, 'X-IWDIE-Bridge': String(PROTOCOL), 'X-IWDIE-Key': k, 'Content-Type': 'application/json', 'Content-Length': body.length } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
        if (res.statusCode === 200 && j && j.result) resolve(j.result);
        else reject(new Error('the server holding port ' + PORT + ' refused the call (' + res.statusCode + (j && j.error ? ': ' + j.error : '') + ')'));
      });
    });
    r.on('timeout', () => r.destroy(new Error('the server holding port ' + PORT + ' did not answer')));
    r.on('error', reject);
    r.end(body);
  });
}

server.on('listening', () => {
  listening = true;
  proxy = null;
  portState = 'listening';
  key = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(KEY_FILE, key, { mode: 0o600 }); } catch (e) { log('no key file', KEY_FILE, e.message, '- other sessions cannot share this port'); }
  log('bridge on 127.0.0.1:' + PORT);
});
server.on('error', e => {
  const taken = e && e.code === 'EADDRINUSE';
  listening = false;
  if (!taken) { portState = 'unusable: ' + e.message; log('port', PORT, portState); return; }
  probeHolder();
  setTimeout(() => { server.close(); server.listen(PORT, '127.0.0.1'); }, RETRY_MS).unref();
});
server.listen(PORT, '127.0.0.1');
// a tab that stopped asking is gone; one busy with a call is not, unless it was not heard from for ten minutes (1.9.0)
setInterval(() => {
  if (!page) return;
  const quiet = Date.now() - page.seen;
  if (!page.waiting && !sent.size && quiet > 90000 * SCALE) detach('it stopped asking');
  else if (sent.size && quiet > 600000 * SCALE) detach('it was not heard from for ten minutes');
}, Math.max(20, 15000 * SCALE)).unref();

function dropKey() {
  if (!key) return;
  try { if (fs.readFileSync(KEY_FILE, 'utf8').trim() === key) fs.unlinkSync(KEY_FILE); } catch (e) {}
}
process.on('exit', dropKey);

/* ---------------- what the tools answer from the context ---------------- */

const lower = s => String(s == null ? '' : s).toLowerCase();
const fold = s => lower(s).replace(/æ/g, 'ae').replace(/[øö]/g, 'o').replace(/[åä]/g, 'a').replace(/[\s_\-.]+/g, '');
const words = q => lower(q).split(/\s+/).filter(Boolean);
const hits = (hay, q) => words(q).every(w => lower(hay).includes(w) || fold(hay).includes(fold(w)));

/** (1.9.0) A query as the IWMAC menu takes one: its words in any of their forms and synonyms (tank finds a Beholder), each
 *  somewhere in the text - or, with no userscript beside this file, each word as it is. -> (hay) => boolean */
function matcher(q) {
  if (!q) return () => true;
  if (script && script.vcSearchWords && script.vcSearchHas && script.vcSearchFold) {
    const w = script.vcSearchWords(q);
    if (!w.length) return () => true;
    return hay => script.vcSearchHas(script.vcSearchFold(hay), w) || hits(hay, q);
  }
  return hay => hits(hay, q);
}

function status(caller) {
  if (!page) return { attached: false, port: PORT + ' ' + portState, server: VERSION, help: NOT_ATTACHED, kit: KIT ? 'found' : 'not found (IWDIE_KIT)' };
  const c = page.context, P = c.params;
  return {
    attached: true, plant: c.job.plant, panel: c.job.panel, document: c.job.name, size: c.size, userscript: c.version, server: VERSION,
    update: older(c.version, TAB_MIN) ? 'userscript ' + c.version + ' is older than ' + TAB_MIN + ': an edit\'s check and preview then cost a call each, and a tab ' +
      'behind another is found only when its time runs out - the user updates it in Tampermonkey' : undefined,
    // VectorCraft opened by itself (userscript 1.87.0): no Designer behind it
    mode: c.job.solo ? 'by itself: no Designer behind this drawing - the user’s Ctrl+S saves it as a panel file, which Insert JSON… → '
      + 'Replace puts on the panel' : undefined,
    tab: page.vis === false ? 'behind another tab: an edit needs it in front' : page.vis === true ? 'in front' : undefined,
    library: { file: c.library && c.library.file, symbols: c.library ? Object.keys(c.library.symbols || {}).length : 0 },
    kit: KIT ? 'found: iwmac_build, iwmac_snapshot and iwmac_trace run its scripts' : 'not found: set IWDIE_KIT to the copilot-skill folder of tampermonkey-scripts-documents',
    objects: c.objects ? c.objects.rows.length : 0,
    units: P && P.units ? P.units.slice(0, 40) : [], unitsNote: P ? (P.failed && P.failed.length ? 'rows not read for ' + P.failed.join(', ') : undefined)
      : c.job.solo ? 'no parameter rows: this drawing by itself has none - open an Export JSON of the plant on the start card for them'
      : 'no parameter rows came with this edit: link an object on the panel to a unit, or tick units in the Parameter Selector, then Edit in VectorCraft again',
    sceneRead: readJobs.get(caller || SELF) === c.job.id, lastSeen: Math.round((Date.now() - page.seen) / 1000) + ' s ago'
  };
}

/** The few status fields a scene carries (1.9.0), so no status call is needed before it. */
function brief() {
  if (!page) return undefined;
  const c = page.context, P = c.params;
  return { plant: c.job.plant, panel: c.job.panel, size: c.size, userscript: c.version, units: P && P.units ? P.units.length : 0,
    rows: P && P.rows ? Object.keys(P.rows).length : 0, solo: c.job.solo ? true : undefined, update: older(c.version, TAB_MIN) ? 'update the userscript to ' + TAB_MIN : undefined };
}

/** The text a placeholder binds a unit's row by: `alias @ unit` where the alias is plain and the unit has it once, else
 *  `[driver_id]`. */
function bindOf(P, u, r) {
  const name = {}, twice = {};
  (P.units || []).forEach(x => { name[x[0]] = x[1]; });
  (P.rows[u] || []).forEach(x => { const k = lower(String(x[0]).trim()); twice[k] = (twice[k] || 0) + 1; });
  const alias = String(r[0]).replace(/\s+/g, ' ').trim(), plain = /^[\w æøåÆØÅ.,%°()+#'-]+$/;
  return alias && plain.test(alias) && plain.test(name[u] || '') && twice[lower(alias)] === 1 ? alias + ' @ ' + name[u] : '[' + r[1] + ']';
}

/** A case's cluster rows (userscript 1.84.0): its value, its alarm, its cooling and its defrost, picked from a unit's rows
 *  by their aliases as the house's case controllers name them - AK-CC: u56 Display air, --- High t.alarm, u58 Comp1/LLSV,
 *  u60 Def. relay. A second section's rows (... B, ...2) are left for the user to ask for. -> {role: [alias, bind]} */
const ROLE_RE = {
  value: [/^u56\b/i, /display\s*air(?!\s*2)/i, /air\s*temp/i, /^s4\b/i],
  alarm: [/high\s*t(emp)?\.?\s*alarm(?!.*\bb\b)/i, /^-+\s*high\s*t(emp)?\.?(?!.*\bb\b)/i],
  cooling: [/^u58\b/i, /\bllsv\b/i, /comp\s*1\b/i],
  defrost: [/^u60\b/i, /def(rost)?\.?\s*relay/i]
};
function caseRoles(P, u) {
  const rows = (P && P.rows && P.rows[u]) || [], out = {};
  Object.keys(ROLE_RE).forEach(role => {
    for (const re of ROLE_RE[role]) {
      const r = rows.find(x => re.test(String(x[0]).trim()));
      if (r) { out[role] = [String(r[0]).trim(), bindOf(P, u, r)]; break; }
    }
  });
  return out;
}

/** A unit of the edit's context by its id or its name. -> unit_id | null */
function unitOf(P, q) {
  if (!P || !P.units || q === undefined || q === null) return null;
  const u = P.units.find(x => lower(x[0]) === lower(q)) || P.units.find(x => lower(x[1]) === lower(q)) || P.units.find(x => fold(x[1]) === fold(q));
  return u ? u[0] : null;
}

/** (1.11.0) A family's ports the userscript gives by what it is (a vessel top and bottom, a pump or plain valve left to
 *  right), where its table measures none. */
function portsByName(n) { return script && script.cbPortsByName ? script.cbPortsByName(n) : null; }

function find(a) {
  if (!page) throw new Error(NOT_ATTACHED + portNote());
  // (1.9.0) several searches in one call: each a query, or {what, query, unit, set}
  if (Array.isArray(a.queries)) {
    return { results: a.queries.slice(0, 40).map(q => {
      const one = Object.assign({}, a, typeof q === 'object' && q ? q : { query: String(q) });
      delete one.queries;
      try { return Object.assign({ q: typeof q === 'object' && q ? (q.query || q.what) : q }, find(one)); } catch (e) { return { q, error: e.message }; }
    }) };
  }
  const c = page.context, what = a.what, q = a.query || '', limit = Math.max(1, Math.min(500, a.limit || 40));
  if (what === 'symbols') {
    const syms = (c.library && c.library.symbols) || {}, m = matcher(q);
    // the template a symbol comes from (userscript 1.72.0): Maskin, or Oversikt - the floor plan's cases in light blue
    // (Kjøl...) and dark blue (Frys...) and the rest of its kit; an older userscript sends none, and all are Maskin's
    const setOf = n => syms[n].set || 'Maskin';
    // (userscript 1.110.0) and the components the house named, from its other templates: `house` their layer
    const rows = Object.keys(syms).filter(n => !q || m(n + ' ' + syms[n].what + ' ' + setOf(n) + ' ' + (syms[n].house || '')))
      .filter(n => !a.set || lower(setOf(n)) === lower(a.set))
      .filter(n => a.all || (syms[n].object === undefined ? syms[n].offered : !syms[n].object))
      .map(n => [n, syms[n].sizes.map(s => s[0] + 'x' + s[1]).join(' '),
        // an arrangement of the Oversikt template (userscript 1.75.0): placed whole, its cases named
        syms[n].what + (syms[n].group ? ' [arrangement: ' + syms[n].group + ' pieces, ' + syms[n].names + ' names]' : '') +
          (syms[n].house ? ' [house: ' + syms[n].house + ']' : ''),
        Object.keys((c.ports || {})[n] || portsByName(n) || {}).join(' '), setOf(n)]);
    // those whose name holds the query first
    if (q) {
      const f = fold(q);
      rows.sort((x, y) => (fold(y[0]).includes(f) ? 1 : 0) - (fold(x[0]).includes(f) ? 1 : 0));
    }
    return { cols: ['name', 'sizes', 'what', 'ports (besides top bottom left right)', 'set'], rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit),
      note: Object.keys(syms).length ? undefined : 'no library came with this tab: the userscript is older than 1.70.0 - the user updates it in Tampermonkey, then Edit in VectorCraft again' };
  }
  if (what === 'objects') {
    const m = matcher(q);
    const rows = ((c.objects && c.objects.rows) || []).filter(r => !q || m(r.join(' ')));
    return { cols: c.objects ? c.objects.cols : [], rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
  }
  if (what === 'parameters') {
    const P = c.params;
    if (!P || !P.rows) return { units: [], note: 'no parameter rows came with this edit (see iwmac_status)' };
    const units = P.units || [], name = {}, out = [];
    let n = 0, more = 0;
    units.forEach(u => { name[u[0]] = u[1]; });
    const unitOk = u => !a.unit || lower(u) === lower(a.unit) || lower(name[u]) === lower(a.unit);
    Object.keys(P.rows).forEach(u => {
      if (!unitOk(u)) return;
      const rows = [];
      P.rows[u].forEach(r => {
        if (q && !hits(r[0] + ' ' + r[2] + ' ' + r[1] + ' ' + r[5], q)) return;
        if (n >= limit) { more++; return; }
        n++;
        rows.push([r[2], String(r[0]).replace(/\s+/g, ' ').trim(), r[4], r[3], r[5], r[1], bindOf(P, u, r)]);
      });
      if (rows.length) out.push({ unit: name[u] || u, unit_id: u, rows });
    });
    // (1.9.0) grouped by unit, each unit said once; kinds: the object this panel shows a value, an alarm and a state with
    return { cols: ['group', 'alias', 'rw', 'type', 'eng', 'driver_id', 'bind'], units: out, more, kinds: P.kinds || undefined };
  }
  if (what === 'cases') {
    // (userscript 1.84.0) the units whose rows carry a case's cluster: the bind text of each role, for a case op's roles,
    // or give the case op unit and its roles are filled from these
    const P = c.params;
    if (!P || !P.rows) return { rows: [], note: 'no parameter rows came with this edit (see iwmac_status): tick the case controllers in the Parameter Selector, then Edit in VectorCraft again; or read an Export JSON with iwmac_export' };
    const name = {};
    (P.units || []).forEach(x => { name[x[0]] = x[1]; });
    const out = [], other = [];
    Object.keys(P.rows).forEach(u => {
      if (q && !hits(u + ' ' + (name[u] || ''), q)) return;
      const r = caseRoles(P, u);
      if (!r.value && !r.alarm) { other.push(name[u] || u); return; }
      out.push([name[u] || u, u].concat(['value', 'alarm', 'cooling', 'defrost'].map(k => r[k] ? r[k][1] : '')));
    });
    return { cols: ['unit', 'unit_id', 'value', 'alarm', 'cooling', 'defrost'], rows: out.slice(0, limit), more: Math.max(0, out.length - limit),
      not_cases: other.length ? other.slice(0, 40) : undefined,
      note: 'a case op with unit: <unit_id or name> takes these; an empty cell is a role that unit has no row for, left out' };
  }
  if (what === 'ports') {
    const p = (c.ports || {})[a.query] || portsByName(a.query) || null;
    return { symbol: a.query, ports: p, sides: ['top', 'bottom', 'left', 'right'], note: 'each port: [u, v] on the box at turn 0 and the way a pipe leaves it' };
  }
  throw new Error('what is symbols, objects, parameters, cases or ports');
}

/* ---------------- an Export JSON, read on this computer ---------------- */

// (1.9.0) the last files read, by path, size and time: a part after the summary is not parsed again
const exportCache = new Map();
function loadExport(file) {
  const st = fs.statSync(file);
  if (st.size > 120 * 1024 * 1024) throw new Error('the file is over 120 MB');
  const k = path.resolve(file), was = exportCache.get(k);
  if (was && was.size === st.size && was.mtime === st.mtimeMs) return was.json;
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  exportCache.set(k, { size: st.size, mtime: st.mtimeMs, json });
  if (exportCache.size > 4) exportCache.delete(exportCache.keys().next().value);
  return json;
}

/** Every `rows` list in a part cut to `limit`, with how many more there were. */
function cut(v, limit) {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v;
  const out = {};
  Object.keys(v).forEach(k => {
    if (k === 'rows' && Array.isArray(v.rows) && v.rows.length > limit) { out.rows = v.rows.slice(0, limit); out.more = v.rows.length - limit; }
    else out[k] = k === 'rows' ? v[k] : cut(v[k], limit);
  });
  return out;
}

function readExport(a) {
  const file = String(a.path || '');
  if (!/\.json$/i.test(file)) throw new Error('give the path of an Export JSON file (.json)');
  const j = loadExport(file);
  const env = j && j.panel && typeof j.panel === 'object' ? j : null, panel = env ? env.panel : Array.isArray(j) ? j[0] : j;
  if (!panel || !Array.isArray(panel.single_objects)) throw new Error('no panel in it (single_objects)');
  const ov = env && env.overview, part = a.part || 'summary', limit = Math.max(1, Math.min(2000, a.limit || 100)), q = a.query || '';
  const role = id => script && script.roleOf ? script.roleOf(id) : '';
  const objs = [];
  panel.single_objects.forEach(o => objs.push(o));
  (panel.containers || []).forEach(c => (c.items || []).forEach(o => objs.push(Object.assign({}, o, { posLeft: (+c.left || 0) + (+o.posLeft || 0), posTop: (+c.top || 0) + (+o.posTop || 0) }))));
  if (part === 'summary') {
    const roles = {};
    objs.forEach(o => { const r = role(o.obj_id) || 'other'; roles[r] = (roles[r] || 0) + 1; });
    return {
      format: env ? env.format : 'bare panel', generator: env && env.generator, exported_at: env && env.exported_at,
      plant: panel.plant_id, panel: panel.panel_name, size: [panel.panel_width, panel.panel_height],
      objects: objs.length, roles, linked: objs.filter(o => /^\d+_/.test(String(o.driver_id || ''))).length,
      background: env && env.background ? { mime: env.background.mime, w: env.background.width, h: env.background.height } : (panel.image_svg ? 'image_svg' : panel.image_data ? 'embedded' : 'none'),
      // (1.83.0) a picture of pixels read at export as Edit in VectorCraft reads it: what that made, and where
      optimised: env && env.ai_guide && env.ai_guide.artwork && env.ai_guide.artwork.optimised ? env.ai_guide.artwork.optimised : null,
      overview: ov ? {
        plant: ov.plant, units: ov.units ? ov.units.rows.length : 0,
        parameters: ov.parameters && ov.parameters.units ? ov.parameters.units.map(u => [u.unit_id, u.name || '', u.rows || 0]) : [],
        signals: ov.signals && ov.signals.rows ? ov.signals.rows.length : 0,
        symbols: ov.parts && ov.parts.components && ov.parts.components.symbols ? ov.parts.components.symbols.rows.length : 0,
        picture: ov.picture ? Object.keys(ov.picture) : null, style: ov.style ? Object.keys(ov.style) : null
      } : 'none: exported before userscript 1.62.0',
      parts: ['objects', 'units', 'parameters', 'signals', 'style', 'picture', 'symbols']
    };
  }
  if (part === 'objects') {
    const rows = objs.filter(o => !q || hits([o.obj_id, o.tag_text, o.alias_text, o.unit_id].join(' '), q)).map(o => [o.name, o.obj_id, role(o.obj_id),
      +o.posLeft || 0, +o.posTop || 0, +o.posWidth || 0, +o.posHeight || 0, o.zIndex, o.tag_text, o.unit_id, o.alias_text, o.driver_id]);
    return { cols: ['name', 'obj_id', 'role', 'x', 'y', 'w', 'h', 'z', 'tag_text', 'unit_id', 'alias_text', 'driver_id'], rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
  }
  if (!ov) throw new Error('this export has no overview block (userscript 1.62.0 or later writes one)');
  if (part === 'units') return cut(ov.units, limit);
  if (part === 'signals') {
    const s = ov.signals || { cols: [], rows: [] }, rows = (s.rows || []).filter(r => !q || hits(r.join(' '), q));
    return { cols: s.cols, rows: rows.slice(0, limit), kinds: s.kinds, more: Math.max(0, rows.length - limit) };
  }
  if (part === 'parameters') {
    const P = ov.parameters || {}, out = [];
    (P.units || []).forEach(u => {
      if (a.unit && lower(u.unit_id) !== lower(a.unit) && lower(u.name) !== lower(a.unit)) return;
      Object.keys(u.groups || {}).forEach(g => (u.groups[g] || []).forEach(r => {
        if (q && !hits(g + ' ' + r.join(' '), q)) return;
        out.push([u.unit_id, g].concat(r));
      }));
    });
    return { cols: ['unit_id', 'group'].concat(P.cols || []), rows: out.slice(0, limit), more: Math.max(0, out.length - limit), left_out: P.left_out };
  }
  if (part === 'style') return cut(ov.style || null, limit);
  if (part === 'picture') return cut(ov.picture || null, limit);
  if (part === 'symbols') return cut((ov.parts && ov.parts.components) || null, limit);
  throw new Error('part is summary, objects, units, parameters, signals, style, picture or symbols');
}

/* ---------------- the kit's scripts, run here (1.10.0) ---------------- */

/** A kit script run with Python, its output kept (the last megabyte). -> Promise<{code, out}> */
function runPy(script, args, ms) {
  return new Promise(resolve => {
    let out = '', done = false;
    const ch = spawn(PY, [script].concat(args), { cwd: os.tmpdir(), windowsHide: true,
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }) });
    const keep = c => { out += c; if (out.length > 2000000) out = out.slice(-1000000); };
    const t = setTimeout(() => { if (!done) { out += '\n[stopped after ' + Math.round(ms / 1000) + ' s]'; ch.kill(); } }, ms);
    ch.stdout.on('data', keep);
    ch.stderr.on('data', keep);
    ch.on('error', e => { if (done) return; done = true; clearTimeout(t); resolve({ code: -1, out: out + '\n' + e.message + ' (is ' + PY + ' on the PATH? IWDIE_PYTHON names another)' }); });
    ch.on('close', code => { if (done) return; done = true; clearTimeout(t); resolve({ code, out }); });
  });
}

/** What a kit script said, in short: its ERROR and WARN lines first, their counts, and its last lines. */
function said(text, n) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(Boolean);
  const err = lines.filter(l => /^ERROR\b/.test(l)), warn = lines.filter(l => /^WARN\b/.test(l));
  return { errors: err.length, warnings: warn.length, findings: err.concat(warn).slice(0, n || 30),
    more: Math.max(0, err.length + warn.length - (n || 30)), last: lines.filter(l => !/^(ERROR|WARN)\b/.test(l)).slice(-12) };
}

function kitScript(rel) {
  if (!KIT) throw new Error('the Copilot kit is not beside this repository: set IWDIE_KIT to the copilot-skill folder of tampermonkey-scripts-documents, then restart Claude Code');
  const f = path.join(KIT, rel);
  if (!fs.existsSync(f)) throw new Error('the kit has no ' + rel);
  return f;
}

/** A picture file read for a reply or a look: PNG or JPEG, at most `max` bytes. -> {data, mime} | null */
function pictureFile(f, max) {
  try {
    const st = fs.statSync(f);
    if (!st.isFile() || st.size > (max || 6 * 1024 * 1024)) return null;
    const mime = /\.jpe?g$/i.test(f) ? 'image/jpeg' : /\.png$/i.test(f) ? 'image/png' : null;
    return mime ? { data: fs.readFileSync(f).toString('base64'), mime } : null;
  } catch (e) { return null; }
}

/** A preview's options as the tab takes them: an underlay given as a file read here. -> object | undefined */
function previewSpec(p) {
  if (!p) return undefined;
  if (p === true) return true;
  const o = Object.assign({}, p);
  if (o.underlay && typeof o.underlay === 'object' && o.underlay.path) {
    const pic = pictureFile(String(o.underlay.path), 12 * 1024 * 1024);
    if (!pic) throw new Error('underlay.path is no PNG or JPEG of at most 12 MB: ' + o.underlay.path);
    o.underlay = { data: pic.data, mime: pic.mime, box: o.underlay.box, opacity: o.underlay.opacity };
  }
  return o;
}

function needTab(min, what) {
  if (!page) throw new Error(NOT_ATTACHED + portNote());
  if (older(page.context.version, min)) throw new Error(what + ' needs userscript ' + min + ' or later in the VectorCraft tab; it runs ' + page.context.version + ': the user updates it in Tampermonkey');
}

function work(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

/** A panel file opened in the tab (iwmac_open), from a path or a document already read. */
async function openFile(a, caller, doc, name) {
  needTab(OPEN_MIN, 'iwmac_open');
  sameDrawing(caller);
  if (!doc) {
    const f = String(a.path || '');
    if (!/\.json$/i.test(f)) throw new Error('give the path of a panel JSON or an edit file (.json)');
    if (fs.statSync(f).size > 60 * 1024 * 1024) throw new Error('the file is over 60 MB');
    doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    name = path.basename(f);
  }
  const r = await ask('open', { name, doc, objects: a.objects === 'keep' ? 'keep' : undefined, check: a.check !== false, preview: previewSpec(a.preview) }, 240000, caller);
  if (r && r.check && Array.isArray(r.check.found)) r.check.found = grouped(r.check.found);
  return r;
}

const BUILDERS = {
  system: 'iwmac-overview-picture/scripts/build.py', rack: 'iwmac-overview-picture/scripts/rack.py',
  compose: 'iwmac-overview-picture/scripts/compose.py', oversikt: 'iwmac-overview-picture/scripts/oversikt.py',
  energi: 'iwmac-overview-picture/scripts/energi.py', vent: 'iwmac-overview-picture/scripts/vent_build.py'
};

/** A kit builder run on a spec (iwmac_build): the panel file written, its check said, a preview drawn by the kit, and the
 *  result opened in the tab as a version of its own when one is attached. -> {result, images} */
async function build(a, caller) {
  const type = String(a.type || '');
  if (!BUILDERS[type]) throw new Error('type is ' + Object.keys(BUILDERS).join(', ') + ' (references/ in the kit say what each spec holds)');
  const script = kitScript(BUILDERS[type]), dir = work('iwmac-build-');
  let spec = a.spec_path ? String(a.spec_path) : null;
  if (!spec) {
    if (!a.spec || typeof a.spec !== 'object') throw new Error('give spec (the builder\'s spec as an object) or spec_path');
    spec = path.join(dir, type + '-spec.json');
    fs.writeFileSync(spec, JSON.stringify(a.spec, null, 1));
  }
  const out = a.out ? path.resolve(String(a.out)) : path.join(dir, type + '.json');
  const args = [spec, out];
  if (a.export) args.push('--export', String(a.export));
  if (a.base && type === 'oversikt') args.push('--base', String(a.base));
  const r = await runPy(script, args, Math.round(300000 * Math.max(SCALE, 0.05)));
  const result = { type, spec, built: fs.existsSync(out) ? out : null, exit: r.code, said: said(r.out) };
  if (!result.built) { result.note = 'the builder wrote no panel: fix the spec by what it said'; return { result, images: [] }; }
  const images = [];
  if (a.preview !== false) {
    const png = out.replace(/\.json$/i, '') + '-preview.png';
    const pv = await runPy(kitScript('iwmac-overview-picture/scripts/preview.py'), [out, '--out', png, '--scale', '0.75'], 120000);
    const pic = pictureFile(png);
    if (pic) images.push({ type: 'image', data: pic.data, mimeType: pic.mime }); else result.preview = said(pv.out).last.join(' ');
  }
  if (a.open !== false && page) {
    try {
      const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
      result.opened = await openFile({ objects: a.objects, check: a.check, preview: a.live_preview }, caller, doc, path.basename(out));
      const lp = result.opened && result.opened.preview;
      if (lp) { delete result.opened.preview; images.push(image(lp)); }
    } catch (e) { result.opened = 'not opened: ' + e.message; }
  } else if (a.open !== false) result.opened = 'not opened: no VectorCraft tab is attached - the user opens ' + out + ' with Open IWMAC JSON…';
  return { result, images };
}

// the first panel file each drawing was taken as, which later snapshots are judged against (check.py --baseline)
const baselines = new Map();

/** The drawing as a panel file (iwmac_snapshot), checked by the kit's check.py and drawn by its preview.py. */
async function snapshot(a, caller) {
  needTab(OPEN_MIN, 'iwmac_snapshot');
  const r = await ask('snapshot', {}, 120000, caller);
  const job = page ? page.context.job : {};
  const dir = a.path ? path.dirname(path.resolve(String(a.path))) : path.join(os.tmpdir(), 'iwmac-snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const file = a.path ? path.resolve(String(a.path)) : path.join(dir, String(r.name || 'snapshot.json').replace(/[^\w.\-]+/g, '_'));
  fs.writeFileSync(file, r.text);
  const result = { file, document: r.document, insert_would_refuse: r.refused || undefined }, images = [];
  const key = String(job.id || ''), base = baselines.get(key);
  if (a.check !== false && KIT) {
    const type = a.type || (/oversikt/i.test(job.panel || '') ? 'oversikt' : /energi/i.test(job.panel || '') ? 'energi' : /vent/i.test(job.panel || '') ? 'ventilation' : null);
    const args = [file].concat(type ? ['--type', type] : []).concat(a.export ? ['--export', String(a.export)] : []).concat(base && a.baseline !== false ? ['--baseline', base] : []);
    const c = await runPy(kitScript('iwmac-overview-picture/scripts/check.py'), args, 180000);
    result.check = Object.assign({ type: type || 'maskin-pid', against: base && a.baseline !== false ? base : undefined }, said(c.out));
  } else if (a.check !== false) result.check = 'not run: the kit is not beside this repository (IWDIE_KIT)';
  if (!base) baselines.set(key, file);
  if (a.preview !== false && KIT) {
    const png = file.replace(/\.json$/i, '') + '-preview.png';
    await runPy(kitScript('iwmac-overview-picture/scripts/preview.py'), [file, '--out', png, '--scale', '0.75'], 120000);
    const pic = pictureFile(png);
    if (pic) images.push({ type: 'image', data: pic.data, mimeType: pic.mime });
  }
  return { result, images };
}

/** A source read by the kit's readers (iwmac_trace): a P&ID or maker's drawing with vector lines (source_trace.py), a
 *  floor plan PDF (plan_read.py), or a picture of a plan (plan_redraw.py trace). */
async function trace(a) {
  const file = path.resolve(String(a.file || ''));
  if (!fs.existsSync(file)) throw new Error('no file ' + file);
  const kind = a.kind || (/\.pdf$/i.test(file) ? 'pid' : /\.(png|jpe?g|gif|bmp|webp)$/i.test(file) ? 'picture' : '');
  const dir = work('iwmac-trace-'), result = { file, kind, dir }, images = [];
  const pageArgs = a.page ? ['--page', String(a.page)] : [], boxArgs = Array.isArray(a.box) && a.box.length === 4 ? ['--box', a.box.join(',')] : [];
  let r;
  if (kind === 'pid') {
    const json = path.join(dir, 'trace.json');
    r = await runPy(kitScript('iwmac-overview-picture/scripts/source_trace.py'), [file].concat(pageArgs, boxArgs,
      Array.isArray(a.fit) && a.fit.length === 4 ? ['--fit', a.fit.join(',')] : [], ['--json', json]), 240000);
    result.json = fs.existsSync(json) ? json : null;
  } else if (kind === 'plan') {
    const json = path.join(dir, 'plan.json'), draft = path.join(dir, 'draft-spec.json');
    r = await runPy(kitScript('iwmac-overview-picture/scripts/plan_read.py'), [file].concat(pageArgs, boxArgs, ['--json', json, '--draft', draft]), 240000);
    result.json = fs.existsSync(json) ? json : null;
    result.draft = fs.existsSync(draft) ? draft : null;
  } else if (kind === 'picture') {
    r = await runPy(kitScript('iwmac-overview-picture/scripts/plan_redraw.py'), ['trace', file, '--out', dir], 240000);
    ['pieces.json', 'straight.png', 'pieces.png'].forEach(n => { if (fs.existsSync(path.join(dir, n))) result[n.replace('.', '_')] = path.join(dir, n); });
    const pic = pictureFile(path.join(dir, 'pieces.png'), 3 * 1024 * 1024);
    if (pic) images.push({ type: 'image', data: pic.data, mimeType: pic.mime });
  } else throw new Error('kind is pid (a P&ID or maker\'s drawing with vector lines), plan (a floor plan PDF) or picture (a plan that is only a picture)');
  result.exit = r.code;
  result.said = said(r.out, 40);
  result.output = String(r.out).split(/\r?\n/).filter(Boolean).slice(0, Math.max(10, Math.min(200, a.lines || 60)));
  return { result, images };
}

/* ---------------- the tools ---------------- */

const RO = { readOnlyHint: true, openWorldHint: false };
const LOOK = { box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, max: { type: 'integer' }, labels: { type: 'boolean' }, diff: { type: 'boolean' },
  underlay: { type: 'object', properties: { path: { type: 'string' }, box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, opacity: { type: 'number' } }, required: ['path'], additionalProperties: false } };
const PREVIEW = { anyOf: [{ type: 'boolean' }, { type: 'object', properties: LOOK, additionalProperties: false }] };
const TOOLS = [
  { name: 'iwmac_status', description: 'Whether a VectorCraft tab with an IWMAC panel is attached, and what it holds: plant, panel, size, the kept symbol library, the plant units whose parameter rows came along, whether the tab is in front. iwmac_scene carries the same in short: call this only when something fails.',
    annotations: Object.assign({ title: 'IWMAC: status' }, RO), inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'iwmac_scene', description: 'The drawing open in VectorCraft, as rows: cid (an id that lasts), kind (symbol, object, pill, pipe, text, group, rect, shape), name, box x y w h in panel pixels, and a note (an object\'s binding; a pipe\'s circuit, its colour and width where not the circuit\'s, its points). facts: true adds the drawing\'s own layout: rows of like symbols and their spacing, the info column, the circuits, where values sit by each symbol, the text size. preview: true (or {box, max}) adds a picture of it in the same call. status: the plant, panel and units in short. Filter with layer, kind, near [x,y,w,h], query (words, with the IWMAC menu\'s synonyms: tank finds a Beholder), limit (150). The first call of a session: {facts: true, preview: true}.',
    annotations: Object.assign({ title: 'IWMAC: read the drawing' }, RO),
    inputSchema: { type: 'object', properties: { layer: { type: 'string' }, kind: { type: 'string' }, near: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, query: { type: 'string' }, limit: { type: 'integer' }, facts: { type: 'boolean' }, preview: PREVIEW }, additionalProperties: false } },
  { name: 'iwmac_preview', description: 'A picture of the drawing as it stands (JPEG): the whole panel, or box [x,y,w,h] in panel pixels to look closer. max is the longer side in pixels (1000). Each IWMAC object shows as its look in a dashed blue box; a value or text box reads 12.3, the Designer\'s design-time value, not a reading. labels: true writes each thing\'s cid on it (objects blue, pipes brown); underlay {path, box?, opacity?} lays a picture - the source the drawing follows, a house template, the plant\'s old panel - over it at box [x,y,w,h] in panel pixels (the whole panel by default), 0.4 opaque; diff: true shows in red what changed since the version before Claude\'s last edit. The same options go in an edit\'s or a scene\'s preview. A picture costs about 700 tokens: look as often as it helps.',
    annotations: Object.assign({ title: 'IWMAC: look at the drawing' }, RO),
    inputSchema: { type: 'object', properties: LOOK, additionalProperties: false } },
  { name: 'iwmac_find', description: 'Search what can be placed. what: symbols (every component VectorCraft offers - the house symbols, pipe pieces and colour samples - with the template each comes from, sizes and ports; set: Maskin or Oversikt keeps one template\'s: Oversikt is the floor plan kit, its cases light blue for cooling (KjølDisk, KjølGavl, KjølSirkel, KjølRom ...) and dark blue for freezer (FrysDisk ...), and Inngang, Handlevogn, Kasse, SelvbetjentKasse, Kondensator2-4, Plugg, Nål; and its arrangements, placed whole: islands, rows and checkouts as the template lays them out (KjølØy3Stående, FrysØyRund, KjølHjørnerad, Kassepar ..., marked [arrangement] in what); and the components of the other house templates, each by its own name (set Maskin, marked [house: its layer] in what: AerotemperNed, Energimåler, TankITank, Oljeutskiller, VVKVBlokk, EnergimålingBlokk, Varmekurve ... - search them by any word of what they are, synonyms too); all: true adds those an IWMAC object shows, which a drawing should not place), objects (the IWMAC objects the IWMAC menu offers, with obj_id, role and size: values, labels, LEDs, alarms, compressors, fans, pumps, valves, AK-PC strips ...), parameters (the plant\'s rows grouped by unit, with the bind text a placeholder takes; unit narrows it), cases (an Oversikt\'s case controllers: each unit\'s value, alarm, cooling and defrost rows as bind texts, for a case op\'s roles - or give the op unit), ports (one symbol\'s connection points, query = its name). queries: [...] runs several searches in one call, each a query text for the same what, or {what, query, unit, set}.',
    annotations: Object.assign({ title: 'IWMAC: find symbols, objects, parameters' }, RO),
    inputSchema: { type: 'object', properties: { what: { type: 'string', enum: ['symbols', 'objects', 'parameters', 'cases', 'ports'] }, query: { type: 'string' }, queries: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object' }] } }, unit: { type: 'string' }, set: { type: 'string', enum: ['Maskin', 'Oversikt'] }, limit: { type: 'integer' }, all: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'iwmac_edit', description: 'Change the drawing: one batch of ops, all planned before anything is made - an op that cannot be planned stops the whole batch and nothing changes (partial: true makes the rest). ops, in order, each {op, ...}: symbol {name, at, w?, h?, turn?, flip?, ref?, label?, labels?} (the name of an arrangement places it whole, one group, with a label object where each of its cases is named: labels the names in reading order - null skips one, false none - else the template\'s own K1/F1); bank {name, count, at, spacing?, axis?, refs?, labels?} (near one of a row of the same symbol, along it, it carries that row on; compressors 80 apart by default); object {obj_id, at, bind?, text?, ref?}; value {bind, at, dark?, label?, ref?} (a value on its pill, its caption 2.6 px left of the pill); pill {at, dark?}; box {at, w, h}, rx?, fill?, stroke?, layer? (layer Bakgrunn: a panel of the information column; never draw anything under an IWMAC object - it draws itself; only a value stands on its pill, which value makes); pipe {points|d, circuit?, colour?, width?, breaks?: "auto", arrow?: mid|start|end}; connect {from, to, circuit?, breaks?, arrow?} (routed between ports round what stands in the way, never into a port from behind, crossing few pipes and lying on none; a port left out: the pair of own ports that joins best, said in the notes; a pipe as either end: a tee onto it; no circuit given: the one of the pipe it joins); header {y | x, joins: [targets, port?], from?, to?, circuit?, breaks?} (one straight header and a riser from each join\'s port onto it); text {text, at, size?, anchor?}; move {target, dx?, dy?, at?, carry?} (its tag above it, its values and the pipe ends at it come along - carry: false moves it alone); delete {target, heal?} (a pipe taken out: the breaks other pipes made for it closed again); set_text {target, text}; bind {target, bind}; align {targets, how}; distribute {targets, axis, gap?}. A symbol\'s at may also be {port: {cid|ref, port}, as?, gap?} (its own port as on that port) or {on: {cid|ref of a pipe}, point?: [x, y]} (on the pipe at that point, turned along it, the pipe cut between its in and out). value {for: target, bind} stands where the drawing\'s own values stand by that kind of symbol; at {info: true} the information column\'s next row. breaks: "auto" breaks a pipe 6 px either side of each other circuit\'s pipe it crosses, as the house draws a crossing; arrow: mid sets a flow arrow 7 px beside its longest run, end or start 10 px past that end. A bind is the text iwmac_find parameters gives, or {unit, alias} (or {unit, query}, or {driver_id}) and this server finds the row. An Oversikt (userscript 1.84.0): case {kind: cold|freezer, rect [x,y,w,h] | at+w+h, label, unit? | roles? {value, alarm, cooling, defrost: bind text or null}, wall?, caption?, room?, plug?, more?, ref?} draws the case in the template\'s blue and places its cluster (value, bell, cooling, defrost where his live panels hang them by how the case stands) and its name as a label object - as Copilot\'s oversikt.py does, number for number; room {rect, name} a grey room with its name inside; cluster {target, unit?|roles?, label?} a cluster on a case already drawn; name {text, over: [targets] | at} a name over a group of cases; legend {} the Symbolforklaring column; an arrangement symbol op takes cases: [name or {label, unit|roles, cluster?} or null, ...] in its names\' order, or clusters: true; (userscript 1.105.0) scale or module [w, h] (its plain case module\'s size) sizes it, clusters: "first" or [places] gives only those cases a cluster and a name, a case {cluster: false} is its box only, and a name keeps off a wall\'s runs - as oversikt.py does. at is {x,y} (top left), {cx,cy}, or {near: target, side: right|left|above|below|on, gap?, align?: start|center|end}; free: true finds the nearest free place. A target is {cid}, {ref} (placed earlier in this edit), {object: name} (a panel object by its own name, object_N) or {find: {kind?, symbol?, obj_id?, text?, name?, layer?, circuit?, bind?, near?: [x, y], within?}} (the one thing that matches, nearest near, within 30 px); from/to add port (in, out, branch, tip, top, bottom, left, right). circuit: HP, Liquid, MT suction, LT suction, Heat recovery; on the water and air side Hot water (tur), Warm water (retur), Water (cold), Coldest water, Brine, Feed, Oil, Supply air, Intake air, Extract air, Exhaust air (ducts 3 px). The answer: added (every thing placed - bank members, labels and pills too - with its cid and box: no scene needed after it), refs, notes, and check: the findings this edit brought (check: false leaves it out); preview: true or {box, max} adds the new version\'s picture. dry_run: true plans without making anything - rarely needed, an edit that fails changes nothing. The result opens in VectorCraft as a new document; the version before stays in its tab.',
    annotations: { title: 'IWMAC: change the drawing', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: { ops: { type: 'array', items: { type: 'object' } }, dry_run: { type: 'boolean' }, partial: { type: 'boolean' }, check: { type: 'boolean' }, preview: PREVIEW }, required: ['ops'], additionalProperties: false } },
  { name: 'iwmac_check', description: 'What is wrong with the whole drawing before the user syncs it: objects off the panel or on each other, symbols missing from the library or shown by objects, values without a pill, symbols overlapping, pipes that are not orthogonal, flow arrows not on a pipe running their way, drawn numbers or states, placeholders bound to no parameter of the plant. An edit already says what it brought; this is for the drawing as a whole.',
    annotations: Object.assign({ title: 'IWMAC: check the drawing' }, RO), inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'iwmac_undo', description: 'Open again the version before Claude\'s last edit in this tab.',
    annotations: { title: 'IWMAC: undo the last edit', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'iwmac_build', description: 'Build a whole picture the house way with the Copilot kit\'s own builder, here on this computer, and open it in the VectorCraft tab as a version of its own: type system (build.py: a refrigeration system from a spec), rack (rack.py: a CO2 booster rack; its "template": "781A" the house rack skeleton), compose (compose.py: a system panel of units, banks, blocks and pipes), oversikt (oversikt.py: a store floor plan\'s cases, clusters and names; base: a panel the user has, its links and moves kept), energi (energi.py: an energy meter tree), vent (vent_build.py: an air handler). spec is the builder\'s spec as an object (the kit\'s references and assets/ examples say what each holds), or spec_path a file; export the plant\'s Export JSON to link its rows. The answer: the panel file, what the builder\'s check said (ERROR and WARN lines), the kit\'s own preview, and what opening it did - the file\'s objects are new on the panel, and Ctrl+S would put it there as Insert JSON… → Replace; objects: "keep" keeps the panel\'s own placeholders instead. open: false only writes the file. A new picture, or anything bigger than a small change, is built this way and then touched up with iwmac_edit.',
    annotations: { title: 'IWMAC: build a picture with the kit', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['system', 'rack', 'compose', 'oversikt', 'energi', 'vent'] }, spec: { type: 'object' }, spec_path: { type: 'string' },
      export: { type: 'string' }, base: { type: 'string' }, out: { type: 'string' }, open: { type: 'boolean' }, objects: { type: 'string', enum: ['file', 'keep'] }, preview: { type: 'boolean' }, live_preview: PREVIEW, check: { type: 'boolean' } }, required: ['type'], additionalProperties: false } },
  { name: 'iwmac_open', description: 'Open a file in the VectorCraft tab as a version of its own: a panel JSON (a builder\'s, an export of this or another panel) - its drawing, its objects as placeholders - or an edit file Copilot wrote (made on this drawing as an edit). Another panel\'s objects are new on this one, and Ctrl+S would put the file on the panel as Insert JSON… → Replace; objects: "keep" keeps the panel\'s own placeholders instead. Like an edit, the answer carries the check and (preview) a picture; iwmac_undo goes back.',
    annotations: { title: 'IWMAC: open a panel or edit file', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, objects: { type: 'string', enum: ['file', 'keep'] }, check: { type: 'boolean' }, preview: PREVIEW }, required: ['path'], additionalProperties: false } },
  { name: 'iwmac_snapshot', description: 'The drawing as it stands as a panel file (its picture, its placeholders as objects, the bound ones linked), written on this computer without syncing, then judged by the Copilot kit\'s check.py - its 40-odd rules on overlaps, the house style, natives, links - against the first snapshot of this drawing (only what is new since), and drawn by the kit\'s preview.py. type: the picture type check.py judges by (maskin-pid, maskin, system, unit, oversikt, energi, kurve, ventilation, wireless; guessed from the panel\'s name). path: where to write it.',
    annotations: Object.assign({ title: 'IWMAC: the drawing through the kit\'s check' }, RO),
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, type: { type: 'string' }, export: { type: 'string' }, baseline: { type: 'boolean' }, check: { type: 'boolean' }, preview: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'iwmac_trace', description: 'Read a source with the Copilot kit\'s readers, on this computer: kind pid (a P&ID, a maker\'s or a system drawing with vector lines: source_trace.py - its lines by colour fitted to the panel, fit [x0,y0,x1,y1] the panel area, box the part of the page), plan (a floor plan PDF: plan_read.py - its rooms, cases and words, and a draft spec for oversikt.py), picture (a plan that is only a picture, a scan or a photo: plan_redraw.py trace - walls straightened and measured, its pieces drawn). page and box choose the part. The answer: what it read, the files it wrote (the JSON to build from), and a picture where it draws one. A raster P&ID (600 dpi tiles) goes through the iwmac-panel-drawing skill\'s compose_pdf.py and trace_lines.py instead.',
    annotations: Object.assign({ title: 'IWMAC: read a source' }, RO),
    inputSchema: { type: 'object', properties: { file: { type: 'string' }, kind: { type: 'string', enum: ['pid', 'plan', 'picture'] }, page: { type: 'integer' }, box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
      fit: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, lines: { type: 'integer' } }, required: ['file'], additionalProperties: false } },
  { name: 'iwmac_export', description: 'Read an IWMAC Export JSON file on this computer, without its picture: part summary (default), objects, units, parameters (unit, query), signals, style, picture (the outline of the drawn picture: pills, pipes, panels, figures, words), symbols. limit (100) cuts every list. Works with no VectorCraft tab.',
    annotations: Object.assign({ title: 'IWMAC: read an Export JSON' }, RO),
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, part: { type: 'string' }, unit: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer' } }, required: ['path'], additionalProperties: false } }
];

const INSTRUCTIONS = 'Reads and edits the IWMAC Designer panel open in VectorCraft. The user opens a panel in the IWMAC Designer and ' +
  'clicks Edit in VectorCraft; that tab attaches to this server. A new picture, or anything bigger than a small change, is built with ' +
  'iwmac_build (the Copilot kit\'s own builders, drawn the house way and checked) and opened in the tab; iwmac_open opens a panel or ' +
  'edit file there; iwmac_trace reads a source (a P&ID, a plan); iwmac_snapshot runs the kit\'s check.py on the drawing as it stands. ' +
  'Start with one iwmac_scene {facts: true, preview: true}: the drawing\'s ' +
  'rows, its own layout conventions, the plant and panel, and a picture, in one call. Find house symbols, IWMAC objects and the plant\'s ' +
  'parameters with iwmac_find (queries: [...] for several at once). Change it with iwmac_edit - one batch of ops per request; it answers ' +
  'with every added thing\'s cid and box and the check\'s findings for what it brought, and preview: true adds the picture, so no dry run, ' +
  'scene or check is needed around it; each edit opens as a new document and iwmac_undo goes back. Fix what the edit\'s check found, ' +
  'then tell the user. You cannot sync: the user reviews and presses Ctrl+S in VectorCraft. Load the iwmac-vectorcraft skill for ' +
  'IWMAC\'s layout rules, symbols, objects and bindings before drawing. For an Oversikt floor plan, case ops draw each case with its ' +
  'cluster and name in one go; iwmac_find cases gives their rows.';

const text = v => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] });
const image = p => ({ type: 'image', data: p.data, mimeType: p.mime || 'image/jpeg' });

/** Before a change: the drawing open now must be the one this session read. Another tab may have taken over since, with
 *  another plant's panel, where the cids Claude holds name other things. */
function sameDrawing(caller) {
  if (!page) throw new Error(NOT_ATTACHED + portNote());
  const job = page.context.job, read = readJobs.get(caller || SELF);
  if (read !== job.id) {
    throw new Error(read ? 'The VectorCraft tab attached now holds plant ' + job.plant + ', panel ' + JSON.stringify(job.panel) +
      ' - not the drawing you read. Nothing was changed. Read it with iwmac_scene first, and make sure it is the panel the user means.'
      : 'Read the drawing with iwmac_scene before changing it (plant ' + job.plant + ', panel ' + JSON.stringify(job.panel) + '). Nothing was changed.');
  }
}

/** An edit's cases with `unit` (userscript 1.84.0): each role the op does not give itself filled with the bind text of
 *  that unit's row (caseRoles); what could not be is said. -> {ops, notes} */
function fillUnits(ops) {
  const notes = [], P = page && page.context.params;
  const fill = (o, where) => {
    if (!o || typeof o !== 'object' || o.unit === undefined || o.unit === null || o.unit === '') return o;
    const out = Object.assign({}, o), u = unitOf(P, o.unit);
    delete out.unit;
    if (!u) { notes.push(where + ': no rows came for unit ' + JSON.stringify(o.unit) + ' - its cluster is placed unbound (iwmac_status says which units came)'); return out; }
    const r = caseRoles(P, u), given = o.roles && typeof o.roles === 'object' ? o.roles : null, roles = {};
    ['value', 'alarm', 'cooling', 'defrost'].forEach(k => {
      if (given && Object.prototype.hasOwnProperty.call(given, k)) { if (given[k] !== false) roles[k] = given[k]; return; }
      if (r[k]) roles[k] = r[k][1];
    });
    if (!roles.value && !roles.alarm) notes.push(where + ': unit ' + JSON.stringify(o.unit) + ' has no case rows (value, alarm) - its cluster is placed unbound');
    out.roles = Object.keys(roles).length ? roles : undefined;
    return out;
  };
  const out = (ops || []).map((o, i) => {
    if (!o || typeof o !== 'object') return o;
    if ((o.op === 'case' || o.op === 'cluster') && o.unit !== undefined) return fill(o, 'op ' + (i + 1));
    if (o.op === 'symbol' && Array.isArray(o.cases)) return Object.assign({}, o, { cases: o.cases.map((e, j) => e && typeof e === 'object' ? fill(e, 'op ' + (i + 1) + ' case ' + (j + 1)) : e) });
    return o;
  });
  return { ops: out, notes };
}

/** (1.9.0) A bind given as {unit, alias}, {unit, query} or {driver_id}: the plant's row found here and its bind text put
 *  in its place, as iwmac_find parameters would give it. -> {text} or {why} */
function bindFor(spec) {
  const P = page && page.context.params;
  if (spec.driver_id !== undefined && spec.driver_id !== null && spec.driver_id !== '') return { text: '[' + String(spec.driver_id) + ']' };
  if (!P || !P.rows) return { why: 'no parameter rows came with this edit (iwmac_status says why)' };
  const u = unitOf(P, spec.unit);
  if (!u) return { why: 'no rows came for unit ' + JSON.stringify(spec.unit) };
  const rows = P.rows[u] || [], want = lower(String(spec.alias || '').replace(/\s+/g, ' ').trim());
  let r = want ? rows.filter(x => lower(String(x[0]).replace(/\s+/g, ' ').trim()) === want) : [];
  if (!r.length && (spec.query || spec.alias)) r = rows.filter(x => hits(x[0] + ' ' + x[2] + ' ' + x[1], spec.query || spec.alias));
  if (r.length === 1) return { text: bindOf(P, u, r[0]) };
  if (!r.length) return { why: 'unit ' + JSON.stringify(spec.unit) + ' has no row ' + JSON.stringify(spec.alias || spec.query) };
  return { why: r.length + ' rows of unit ' + JSON.stringify(spec.unit) + ' match ' + JSON.stringify(spec.alias || spec.query) + ': ' +
    r.slice(0, 6).map(x => String(x[0]).trim() + ' [' + x[1] + '] (' + x[2] + ')').join(', ') + ' - give the alias exactly, or {driver_id}' };
}

/** Every bind of an edit given as an object, resolved (bindFor). A value's or an object's that finds no row is placed
 *  unbound and said; a bind op's stops the edit, which then changes nothing. -> {ops, notes} */
function fillBinds(ops) {
  const notes = [], stops = [];
  const one = (v, where, strict) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const b = bindFor(v);
    if (b.text !== undefined) return b.text;
    (strict ? stops : notes).push(where + ': ' + b.why + (strict ? '' : ' - placed unbound'));
    return strict ? v : '';
  };
  const roles = (r, where) => {
    if (!r || typeof r !== 'object') return r;
    const out = {};
    Object.keys(r).forEach(k => { out[k] = one(r[k], where + ' ' + k); });
    return out;
  };
  const out = (ops || []).map((o, i) => {
    if (!o || typeof o !== 'object') return o;
    const w = 'op ' + (i + 1), c = Object.assign({}, o);
    if (c.bind && typeof c.bind === 'object') c.bind = one(c.bind, w, c.op === 'bind');
    if (c.roles) c.roles = roles(c.roles, w);
    if (Array.isArray(c.cases)) c.cases = c.cases.map((e, j) => e && typeof e === 'object' && e.roles ? Object.assign({}, e, { roles: roles(e.roles, w + ' case ' + (j + 1)) }) : e);
    if (Array.isArray(c.values)) c.values = c.values.map((v, j) => one(v, w + ' value ' + (j + 1)));
    return c;
  });
  if (stops.length) throw new Error(stops.join('; ') + '. Nothing was changed.');
  return { ops: out, notes };
}

/** (1.9.0) Findings in few lines: of a rule found more than eight times, the first six and a count of the rest. */
function grouped(list) {
  if (!Array.isArray(list)) return list;
  const by = {}, out = [];
  list.forEach(f => { (by[f.rule] = by[f.rule] || []).push(f); });
  Object.keys(by).forEach(rule => {
    const fs2 = by[rule];
    if (fs2.length <= 8) { fs2.forEach(f => out.push(f)); return; }
    fs2.slice(0, 6).forEach(f => out.push(f));
    out.push({ level: fs2[6].level, rule, what: 'and ' + (fs2.length - 6) + ' more like these', cids: fs2.slice(6).map(f => (f.cids || [])[0]).filter(Boolean).slice(0, 40) });
  });
  return out;
}

/** What late answers said for this caller, told once. */
function newsFor(caller) {
  const mine = [];
  for (let i = news.length - 1; i >= 0; i--) if (news[i].caller === caller) { mine.unshift(news[i].line); news.splice(i, 1); }
  return mine;
}

async function call(name, a, caller) {
  a = a || {};
  caller = caller || SELF;
  const told = newsFor(caller);
  const r = await call1(name, a, caller);
  if (told.length) r.content.unshift({ type: 'text', text: 'Note: ' + told.join('; ') + '.' });
  return r;
}

async function call1(name, a, caller) {
  switch (name) {
    case 'iwmac_status': return text(status(caller));
    case 'iwmac_scene': {
      const job = page ? page.context.job.id : null;
      const args = Object.assign({}, a);
      if (args.preview) args.preview = previewSpec(args.preview);
      const r = await ask('scene', args, 120000, caller);
      if (page && page.context.job.id === job) readJobs.set(caller, job);
      if (r && typeof r === 'object') r.status = brief();
      const p = r && r.preview;
      if (p) { delete r.preview; return { content: [{ type: 'text', text: JSON.stringify(r) }, image(p)] }; }
      return text(r);
    }
    case 'iwmac_preview': {
      const r = await ask('preview', previewSpec(Object.assign({}, a)), 90000, caller);
      return { content: [image(r), { type: 'text', text: JSON.stringify({ width: r.width, height: r.height, box: r.box, document: r.document, labels: r.labels, diff: r.diff }) }] };
    }
    case 'iwmac_find': return text(find(a));
    case 'iwmac_edit': {
      sameDrawing(caller);
      const f = fillUnits(a.ops), b = fillBinds(f.ops);
      const r = await ask('edit', { ops: b.ops, dry_run: !!a.dry_run, partial: !!a.partial, check: a.check !== false, preview: a.dry_run ? undefined : previewSpec(a.preview) }, 180000, caller);
      const notes = f.notes.concat(b.notes);
      if (r && notes.length) r.notes = (Array.isArray(r.notes) ? r.notes : []).concat(notes);
      if (r && r.check && Array.isArray(r.check.found)) r.check.found = grouped(r.check.found);
      let p = r && r.preview;
      if (p) delete r.preview;
      // a userscript before 1.111.0 answers neither: the picture then costs a call of its own
      else if (a.preview && r && r.applied) p = await ask('preview', typeof a.preview === 'object' ? previewSpec(a.preview) : {}, 90000, caller);
      if (r && r.applied && !r.check && a.check !== false && page && older(page.context.version, TAB_MIN)) r.check = 'not made: userscript ' + page.context.version + ' is older than ' + TAB_MIN + ' - call iwmac_check';
      return p ? { content: [{ type: 'text', text: JSON.stringify(r) }, image(p)] } : text(r);
    }
    case 'iwmac_check': {
      const r = await ask('check', {}, 120000, caller);
      if (r && Array.isArray(r.findings)) r.findings = grouped(r.findings);
      return text(r);
    }
    case 'iwmac_undo': sameDrawing(caller); return text(await ask('undo', {}, 90000, caller));
    case 'iwmac_export': return text(readExport(a));
    case 'iwmac_open': {
      const r = await openFile(a, caller);
      const p = r && r.preview;
      if (p) { delete r.preview; return { content: [{ type: 'text', text: JSON.stringify(r) }, image(p)] }; }
      return text(r);
    }
    case 'iwmac_build': case 'iwmac_snapshot': case 'iwmac_trace': {
      const got = name === 'iwmac_build' ? await build(a, caller) : name === 'iwmac_snapshot' ? await snapshot(a, caller) : await trace(a);
      return { content: [{ type: 'text', text: JSON.stringify(got.result) }].concat(got.images) };
    }
    default: throw new Error('no tool ' + name);
  }
}

/** A tool call: here, or (1.9.0) through the server that holds the port when another session's does. */
async function route(name, a) {
  if (!listening && proxy && name !== 'iwmac_export' && name !== 'iwmac_trace') {
    try {
      const r = await forward(name, a || {});
      if (name === 'iwmac_status' && r && r.content && r.content[0] && !r.isError) {
        let s = null;
        try { s = JSON.parse(r.content[0].text); } catch (e) { s = null; }
        if (s) { s.port = PORT + ' ' + portState; s.shared = true; r.content[0].text = JSON.stringify(s); }
      }
      return r;
    } catch (e) {
      // that server went away: this one looks again, and takes the port when it can
      proxy = null;
      portState = 'in use, but its server did not answer (' + e.message + '): this one takes the port over when it can';
      probeHolder();
    }
  }
  return call(name, a, SELF);
}

/* ---------------- MCP over stdio ---------------- */

function out(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handle(msg) {
  const { id, method, params } = msg;
  const isCall = id !== undefined && id !== null;
  try {
    let result;
    if (method === 'initialize') {
      const want = params && params.protocolVersion;
      result = { protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0], capabilities: { tools: { listChanged: false } },
        serverInfo: { name: NAME, version: VERSION }, instructions: INSTRUCTIONS };
    } else if (method === 'ping') result = {};
    else if (method === 'tools/list') result = { tools: TOOLS };
    else if (method === 'tools/call') {
      try { result = await route(params && params.name, params && params.arguments); }
      catch (e) { result = { content: [{ type: 'text', text: 'Error: ' + (e && e.message ? e.message : String(e)) }], isError: true }; }
    } else if (method === 'resources/list') result = { resources: [] };
    else if (method === 'prompts/list') result = { prompts: [] };
    else if (method === 'logging/setLevel') result = {};
    else if (!isCall) return;   // a notification
    else { out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'no method ' + method } }); return; }
    if (isCall) out({ jsonrpc: '2.0', id, result });
  } catch (e) {
    if (isCall) out({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e && e.message ? e.message : e) } });
  }
}

let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffered += chunk;
  let nl;
  while ((nl = buffered.indexOf('\n')) >= 0) {
    const line = buffered.slice(0, nl).trim();
    buffered = buffered.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
    if (Array.isArray(msg)) msg.forEach(m => handle(m)); else handle(msg);
  }
});
process.stdin.on('end', () => { detach('the server stopped'); dropKey(); server.close(); process.exit(0); });
