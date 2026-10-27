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
 * Who may talk to the port: only the userscript. A request must come to 127.0.0.1 or localhost by that very name (no
 * DNS rebinding), carry the X-IWDIE-Bridge header (a web page cannot send it without a CORS preflight, which is
 * refused) and no web page's Origin; after the attach, the session's token. The port is bound to the loopback only.
 *
 * No dependencies. Node 18 or later.
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NAME = 'iwmac-vectorcraft', VERSION = '1.7.1', PROTOCOL = 1;
const PORT = parseInt(process.env.IWDIE_BRIDGE_PORT || '47913', 10);
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 64 * 1024 * 1024;

// the userscript's pure helpers, where it lies beside this folder (roles of objects in an export)
let script = null;
try { script = require(path.join(__dirname, '..', 'IWMAC-Designer-Import-Export.user.js')); } catch (e) { script = null; }

const log = (...a) => process.stderr.write('[' + NAME + '] ' + a.join(' ') + '\n');

/* ---------------- the page: the VectorCraft tab's userscript ---------------- */

let page = null;            // {session, context, at, seen, waiting, waitTimer}
const queue = [];           // commands for the page, in order
const sent = new Map();     // id -> a command the page has
const takenOver = [];       // sessions another tab replaced: told so, they do not take Claude back by themselves
let nextId = 1, portState = 'starting';
let readJob = null;         // the edit job whose scene Claude read last: only that drawing may be changed
const TAKEN = 'another VectorCraft tab attached';

const NOT_ATTACHED = 'No VectorCraft tab is attached. In the IWMAC Designer, open the panel and click "Edit in VectorCraft…"; ' +
  'the tab finds this server by itself within 15 s (its banner shows Claude: connected). The userscript must be 1.64.0 or later, ' +
  'and Tampermonkey must be allowed to reach 127.0.0.1.';

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
  reply(res, 200, { cmd: { id: cmd.id, name: cmd.name, args: cmd.args } });
}

function detach(why) {
  if (!page) return;
  if (page.waiting) { reply(page.waiting, 409, { error: why }); page.waiting = null; clearTimeout(page.waitTimer); }
  page = null;
  for (const cmd of [...queue, ...sent.values()]) { clearTimeout(cmd.timer); cmd.reject(new Error('the VectorCraft tab went away: ' + why)); }
  queue.length = 0;
  sent.clear();
}

/** One call to the page. -> Promise<result> */
function ask(name, args, ms) {
  return new Promise((resolve, reject) => {
    if (!page) { reject(new Error(NOT_ATTACHED)); return; }
    const cmd = { id: nextId++, name, args: args || {}, resolve, reject };
    cmd.timer = setTimeout(() => {
      const i = queue.indexOf(cmd);
      if (i >= 0) queue.splice(i, 1);
      sent.delete(cmd.id);
      reject(new Error('the VectorCraft tab did not answer in ' + Math.round(ms / 1000) + ' s. Is it open, with its tab in front? ' +
        'VectorCraft draws, and so saves, only while its tab shows.'));
    }, ms);
    queue.push(cmd);
    pump();
  });
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
    reply(res, 200, { server: 'iwmac-vc-mcp', version: VERSION, protocol: PROTOCOL, attached: !!page });
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
      page = { session: crypto.randomBytes(24).toString('hex'), context: ctx, at: Date.now(), seen: Date.now(), waiting: null, waitTimer: null };
      log('attached: plant', ctx.job.plant, 'panel', JSON.stringify(ctx.job.panel));
      reply(res, 200, { session: page.session });
    }, e => reply(res, 400, { error: e.message }));
    return;
  }
  if (!mine) { reply(res, 409, { error: takenOver.includes(String(req.headers['x-iwdie-session'] || '')) ? TAKEN : 'no such session' }); return; }
  page.seen = Date.now();
  if (req.method === 'GET' && url.pathname === '/bridge/next') {
    if (page.waiting) { reply(page.waiting, 200, { cmd: null }); clearTimeout(page.waitTimer); }
    page.waiting = res;
    const wait = Math.max(1, Math.min(30, parseInt(url.searchParams.get('wait') || '25', 10)));
    page.waitTimer = setTimeout(() => { if (page && page.waiting === res) { page.waiting = null; reply(res, 200, { cmd: null }); } }, wait * 1000);
    req.on('close', () => { if (page && page.waiting === res) { page.waiting = null; clearTimeout(page.waitTimer); } });
    pump();
    return;
  }
  if (req.method === 'POST' && url.pathname === '/bridge/result') {
    readBody(req).then(body => {
      const cmd = body && sent.get(body.id);
      if (!cmd) { reply(res, 404, { error: 'no such call' }); return; }
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
// one bridge per computer: a second Claude Code session finds the port taken, says so, and takes it over when the
// first one ends
const RETRY_MS = Math.max(100, parseInt(process.env.IWDIE_BRIDGE_RETRY_MS || '10000', 10));
server.on('listening', () => { portState = 'listening'; log('bridge on 127.0.0.1:' + PORT); });
server.on('error', e => {
  const taken = e && e.code === 'EADDRINUSE';
  portState = taken ? 'in use: another Claude Code session most likely has this bridge; this one takes the port over when that session ends'
    : 'unusable: ' + e.message;
  log('port', PORT, portState);
  if (taken) setTimeout(() => { server.close(); server.listen(PORT, '127.0.0.1'); }, RETRY_MS).unref();
});
server.listen(PORT, '127.0.0.1');
// a tab that stopped asking is gone
setInterval(() => { if (page && !page.waiting && Date.now() - page.seen > 90000) detach('it stopped asking'); }, 15000).unref();

/* ---------------- what the tools answer from the context ---------------- */

const lower = s => String(s == null ? '' : s).toLowerCase();
const fold = s => lower(s).replace(/æ/g, 'ae').replace(/[øö]/g, 'o').replace(/[åä]/g, 'a').replace(/[\s_\-.]+/g, '');
const words = q => lower(q).split(/\s+/).filter(Boolean);
const hits = (hay, q) => words(q).every(w => lower(hay).includes(w) || fold(hay).includes(fold(w)));

function status() {
  if (!page) return { attached: false, port: PORT + ' ' + portState, help: NOT_ATTACHED };
  const c = page.context, P = c.params;
  return {
    attached: true, plant: c.job.plant, panel: c.job.panel, document: c.job.name, size: c.size, userscript: c.version,
    // VectorCraft opened by itself (userscript 1.87.0): no Designer behind it
    mode: c.job.solo ? 'by itself: no Designer behind this drawing - the user’s Ctrl+S saves it as a panel file, which Insert JSON… → '
      + 'Replace puts on the panel' : undefined,
    library: { file: c.library && c.library.file, symbols: c.library ? Object.keys(c.library.symbols || {}).length : 0 },
    objects: c.objects ? c.objects.rows.length : 0,
    units: P && P.units ? P.units.slice(0, 40) : [], unitsNote: P ? (P.failed && P.failed.length ? 'rows not read for ' + P.failed.join(', ') : undefined)
      : c.job.solo ? 'no parameter rows: this drawing by itself has none - open an Export JSON of the plant on the start card for them'
      : 'no parameter rows came with this edit: link an object on the panel to a unit, or tick units in the Parameter Selector, then Edit in VectorCraft again',
    sceneRead: readJob === c.job.id, lastSeen: Math.round((Date.now() - page.seen) / 1000) + ' s ago'
  };
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

function find(a) {
  if (!page) throw new Error(NOT_ATTACHED);
  const c = page.context, what = a.what, q = a.query || '', limit = Math.max(1, Math.min(500, a.limit || 40));
  if (what === 'symbols') {
    const syms = (c.library && c.library.symbols) || {};
    // the template a symbol comes from (userscript 1.72.0): Maskin, or Oversikt - the floor plan's cases in light blue
    // (Kjøl...) and dark blue (Frys...) and the rest of its kit; an older userscript sends none, and all are Maskin's
    const setOf = n => syms[n].set || 'Maskin';
    const rows = Object.keys(syms).filter(n => !q || hits(n + ' ' + syms[n].what + ' ' + setOf(n), q))
      .filter(n => !a.set || lower(setOf(n)) === lower(a.set))
      .filter(n => a.all || (syms[n].object === undefined ? syms[n].offered : !syms[n].object))
      .map(n => [n, syms[n].sizes.map(s => s[0] + 'x' + s[1]).join(' '),
        // an arrangement of the Oversikt template (userscript 1.75.0): placed whole, its cases named
        syms[n].what + (syms[n].group ? ' [arrangement: ' + syms[n].group + ' pieces, ' + syms[n].names + ' names]' : ''),
        Object.keys((c.ports || {})[n] || {}).join(' '), setOf(n)]);
    return { cols: ['name', 'sizes', 'what', 'ports (besides top bottom left right)', 'set'], rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit),
      note: Object.keys(syms).length ? undefined : 'no library came with this tab: the userscript is older than 1.70.0 - the user updates it in Tampermonkey, then Edit in VectorCraft again' };
  }
  if (what === 'objects') {
    const rows = ((c.objects && c.objects.rows) || []).filter(r => !q || hits(r.join(' '), q));
    return { cols: c.objects ? c.objects.cols : [], rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit) };
  }
  if (what === 'parameters') {
    const P = c.params;
    if (!P || !P.rows) return { rows: [], note: 'no parameter rows came with this edit (see iwmac_status)' };
    const units = P.units || [], name = {}, out = [];
    units.forEach(u => { name[u[0]] = u[1]; });
    const unitOk = u => !a.unit || lower(u) === lower(a.unit) || lower(name[u]) === lower(a.unit);
    Object.keys(P.rows).forEach(u => {
      if (!unitOk(u)) return;
      const twice = {};
      P.rows[u].forEach(r => { const k = lower(String(r[0]).trim()); twice[k] = (twice[k] || 0) + 1; });
      P.rows[u].forEach(r => {
        if (q && !hits(r[0] + ' ' + r[2] + ' ' + r[1] + ' ' + r[5], q)) return;
        const alias = String(r[0]).replace(/\s+/g, ' ').trim(), plain = /^[\w æøåÆØÅ.,%°()+#'-]+$/;
        const bind = alias && plain.test(alias) && plain.test(name[u] || '') && twice[lower(alias)] === 1 ? alias + ' @ ' + name[u] : '[' + r[1] + ']';
        out.push([name[u] || u, u, r[2], alias, r[4], r[3], r[5], r[1], bind]);
      });
    });
    // kinds: the object this panel shows a value, an alarm and a state with - place a parameter's row as that
    return { cols: ['unit', 'unit_id', 'group', 'alias', 'rw', 'type', 'eng', 'driver_id', 'bind'], rows: out.slice(0, limit), more: Math.max(0, out.length - limit),
      kinds: P.kinds || undefined };
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
    const p = (c.ports || {})[a.query] || null;
    return { symbol: a.query, ports: p, sides: ['top', 'bottom', 'left', 'right'], note: 'each port: [u, v] on the box at turn 0 and the way a pipe leaves it' };
  }
  throw new Error('what is symbols, objects, parameters, cases or ports');
}

/* ---------------- an Export JSON, read on this computer ---------------- */

function readExport(a) {
  const file = String(a.path || '');
  if (!/\.json$/i.test(file)) throw new Error('give the path of an Export JSON file (.json)');
  const st = fs.statSync(file);
  if (st.size > 120 * 1024 * 1024) throw new Error('the file is over 120 MB');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const env = j && j.panel && typeof j.panel === 'object' ? j : null, panel = env ? env.panel : Array.isArray(j) ? j[0] : j;
  if (!panel || !Array.isArray(panel.single_objects)) throw new Error('no panel in it (single_objects)');
  const ov = env && env.overview, part = a.part || 'summary', limit = Math.max(1, Math.min(2000, a.limit || 300)), q = a.query || '';
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
      // (userscript 1.83.0) a picture of pixels read at export as Edit in VectorCraft reads it: what that made, and where
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
  if (part === 'units') return ov.units;
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
  if (part === 'style') return ov.style || null;
  if (part === 'picture') return ov.picture || null;
  if (part === 'symbols') return (ov.parts && ov.parts.components) || null;
  throw new Error('part is summary, objects, units, parameters, signals, style, picture or symbols');
}

/* ---------------- the tools ---------------- */

const TOOLS = [
  { name: 'iwmac_status', description: 'Whether a VectorCraft tab with an IWMAC panel is attached, and what it holds: plant, panel, size, the kept symbol library, the plant units whose parameter rows came along. Call it first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'iwmac_scene', description: 'The drawing open in VectorCraft, as rows: cid (an id that lasts), kind (symbol, object, pill, pipe, text, group, rect, shape), name, box x y w h in panel pixels, and a note (an object\'s binding, a pipe\'s circuit, colour and points). facts: true adds the drawing\'s own layout: rows of like symbols and their spacing, the info column, the circuits, where values sit by each symbol, the text size. Filter with layer, kind, near [x,y,w,h], query, limit (150).',
    inputSchema: { type: 'object', properties: { layer: { type: 'string' }, kind: { type: 'string' }, near: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, query: { type: 'string' }, limit: { type: 'integer' }, facts: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'iwmac_preview', description: 'A picture of the drawing as it stands (JPEG): the whole panel, or box [x,y,w,h] in panel pixels to look closer. max is the longer side in pixels (1000). Each IWMAC object shows as its look in a dashed blue box; a value or text box reads 12.3, the Designer\'s design-time value, not a reading.',
    inputSchema: { type: 'object', properties: { box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }, max: { type: 'integer' } }, additionalProperties: false } },
  { name: 'iwmac_find', description: 'Search what can be placed. what: symbols (every component VectorCraft offers - the house symbols, pipe pieces and colour samples - with the template each comes from, sizes and ports; set: Maskin or Oversikt keeps one template\'s: Oversikt is the floor plan kit, its cases light blue for cooling (KjølDisk, KjølGavl, KjølSirkel, KjølRom ...) and dark blue for freezer (FrysDisk ...), and Inngang, Handlevogn, Kasse, SelvbetjentKasse, Kondensator2-4, Plugg, Nål; and its arrangements, placed whole: islands, rows and checkouts as the template lays them out (KjølØy3Stående, FrysØyRund, KjølHjørnerad, Kassepar ..., marked [arrangement] in what); all: true adds those an IWMAC object shows, which a drawing should not place), objects (the IWMAC objects the IWMAC menu offers, with obj_id, role and size: values, labels, LEDs, alarms, compressors, fans, pumps, valves, AK-PC strips ...), parameters (the plant\'s rows, with the bind text a placeholder takes; unit narrows it), cases (an Oversikt\'s case controllers: each unit\'s value, alarm, cooling and defrost rows as bind texts, for a case op\'s roles - or give the op unit), ports (one symbol\'s connection points, query = its name).',
    inputSchema: { type: 'object', properties: { what: { type: 'string', enum: ['symbols', 'objects', 'parameters', 'cases', 'ports'] }, query: { type: 'string' }, unit: { type: 'string' }, set: { type: 'string', enum: ['Maskin', 'Oversikt'] }, limit: { type: 'integer' }, all: { type: 'boolean' } }, required: ['what'], additionalProperties: false } },
  { name: 'iwmac_edit', description: 'Change the drawing. ops, in order, each {op, ...}: symbol {name, at, w?, h?, turn?, flip?, ref?, label?, labels?} (the name of an arrangement places it whole, one group, with a label object where each of its cases is named: labels the names in reading order - null skips one, false none - else the template\'s own K1/F1); bank {name, count, at, spacing?, axis?, refs?, labels?} (near one of a row of the same symbol, along it, it carries that row on); object {obj_id, at, bind?, text?, ref?}; value {bind, at, dark?, label?, ref?} (a value on its pill); pill {at, dark?}; box {at, w, h}, rx?, fill?, stroke?, layer? (layer Bakgrunn: a panel of the information column; never draw anything under an IWMAC object - it draws itself; only a value stands on its pill, which value makes); pipe {points|d, circuit?, colour?, width?}; connect {from, to, circuit?} (routed between ports); text {text, at, size?, anchor?}; move {target, dx?, dy?, at?}; delete {target}; set_text {target, text}; bind {target, bind}; align {targets, how}; distribute {targets, axis, gap?}. An Oversikt (userscript 1.84.0): case {kind: cold|freezer, rect [x,y,w,h] | at+w+h, label, unit? | roles? {value, alarm, cooling, defrost: bind text or null}, wall?, caption?, room?, plug?, more?, ref?} draws the case in the template\'s blue and places its cluster (value, bell, cooling, defrost where his live panels hang them by how the case stands) and its name as a label object - as Copilot\'s oversikt.py does, number for number; room {rect, name} a grey room with its name inside; cluster {target, unit?|roles?, label?} a cluster on a case already drawn; name {text, over: [targets] | at} a name over a group of cases; legend {} the Symbolforklaring column; an arrangement symbol op takes cases: [name or {label, unit|roles, cluster?} or null, ...] in its names\' order, or clusters: true; (userscript 1.105.0) scale (0.25-4) or module [w, h] (its plain case module\'s size) sizes it, clusters: "first" or [places] gives only those cases a cluster and a name, a case {cluster: false} is its box only, and a name keeps off a wall\'s runs - as oversikt.py does. at is {x,y} (top left), {cx,cy}, or {near: target, side: right|left|above|below|on, gap?, align?: start|center|end}; free: true finds the nearest free place. A target is {cid}, {ref} (placed earlier in this edit), {object: name} (a panel object by its own name, object_N) or {find: {kind?, symbol?, obj_id?, text?, name?, layer?, circuit?, bind?, near?: [x, y], within?}} (the one thing that matches, nearest near, within 30 px); from/to add port (in, out, branch, tip, top, bottom, left, right). circuit: HP, Liquid, MT suction, LT suction, Heat recovery. dry_run: true plans without changing anything. The result opens in VectorCraft as a new document; the version before stays in its tab.',
    inputSchema: { type: 'object', properties: { ops: { type: 'array', items: { type: 'object' } }, dry_run: { type: 'boolean' }, partial: { type: 'boolean' }, preview: { type: 'boolean' } }, required: ['ops'], additionalProperties: false } },
  { name: 'iwmac_check', description: 'What is wrong with the drawing before the user syncs it: objects off the panel or on each other, symbols missing from the library or shown by objects, values without a pill, symbols overlapping, pipes that are not orthogonal, flow arrows not on a pipe running their way, drawn numbers or states, placeholders bound to no parameter of the plant.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'iwmac_undo', description: 'Open again the version before Claude\'s last edit in this tab.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'iwmac_export', description: 'Read an IWMAC Export JSON file on this computer, without its picture: part summary (default), objects, units, parameters (unit, query), signals, style, picture (the outline of the drawn picture: pills, pipes, panels, figures, words), symbols. Works with no VectorCraft tab.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, part: { type: 'string' }, unit: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer' } }, required: ['path'], additionalProperties: false } }
];

const INSTRUCTIONS = 'Reads and edits the IWMAC Designer panel open in VectorCraft. The user opens a panel in the IWMAC Designer and ' +
  'clicks Edit in VectorCraft; that tab attaches to this server (iwmac_status). Read the drawing with iwmac_scene (facts: true for its ' +
  'layout conventions) and look at it with iwmac_preview. Find house symbols, IWMAC objects and the plant\'s parameters with iwmac_find. ' +
  'Change it with iwmac_edit - one batch of ops per request, dry_run first for a large one; each edit opens as a new document and ' +
  'iwmac_undo goes back. Run iwmac_check before telling the user it is done. You cannot sync: the user reviews and presses Ctrl+S in ' +
  'VectorCraft. Load the iwmac-vectorcraft skill for IWMAC\'s layout rules, symbols, objects and bindings before drawing. ' +
  'For an Oversikt floor plan, case ops draw each case with its cluster and name in one go; iwmac_find cases gives their rows.';

const text = v => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] });

/** Before a change: the drawing open now must be the one Claude read. Another tab may have taken over since, with
 *  another plant's panel, where the cids Claude holds name other things. */
function sameDrawing() {
  if (!page) throw new Error(NOT_ATTACHED);
  const job = page.context.job;
  if (readJob !== job.id) {
    throw new Error(readJob ? 'The VectorCraft tab attached now holds plant ' + job.plant + ', panel ' + JSON.stringify(job.panel) +
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

async function call(name, a) {
  a = a || {};
  switch (name) {
    case 'iwmac_status': return text(status());
    case 'iwmac_scene': {
      const job = page ? page.context.job.id : null;
      const r = await ask('scene', a, 120000);
      if (page && page.context.job.id === job) readJob = job;
      return text(r);
    }
    case 'iwmac_preview': {
      const r = await ask('preview', a, 90000);
      return { content: [{ type: 'image', data: r.data, mimeType: r.mime || 'image/jpeg' }, { type: 'text', text: JSON.stringify({ width: r.width, height: r.height, box: r.box, document: r.document }) }] };
    }
    case 'iwmac_find': return text(find(a));
    case 'iwmac_edit': {
      sameDrawing();
      const f = fillUnits(a.ops);
      const r = await ask('edit', { ops: f.ops, dry_run: !!a.dry_run, partial: !!a.partial }, 180000);
      if (r && f.notes.length) r.notes = (Array.isArray(r.notes) ? r.notes : []).concat(f.notes);
      if (a.preview && r && r.applied) {
        const p = await ask('preview', {}, 90000);
        return { content: [{ type: 'text', text: JSON.stringify(r) }, { type: 'image', data: p.data, mimeType: p.mime || 'image/jpeg' }] };
      }
      return text(r);
    }
    case 'iwmac_check': return text(await ask('check', {}, 120000));
    case 'iwmac_undo': sameDrawing(); return text(await ask('undo', {}, 90000));
    case 'iwmac_export': return text(readExport(a));
    default: throw new Error('no tool ' + name);
  }
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
      try { result = await call(params && params.name, params && params.arguments); }
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
process.stdin.on('end', () => { detach('the server stopped'); server.close(); process.exit(0); });
