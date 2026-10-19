#!/usr/bin/env node
/*
 * modpoll-mcp.js - lets Claude read Modbus registers through the Modpoll Console.
 *
 * Claude Code starts it as an MCP server: newline-delimited JSON-RPC 2.0 on stdio. It also listens on 127.0.0.1
 * (port 47921, or MODPOLL_BRIDGE_PORT), where the Modpoll Console userscript - running in the plant's sys_tools tab
 * that the user already logged into - finds it, attaches, and takes Claude's calls one at a time.
 *
 * Why this shape rather than CDP or a direct HTTP client. modpoll runs on the plant PC behind Plant Term, an
 * interactive terminal in an iframe on a page under /secure/, so there is no request-response API to call. The two
 * ways to reach it are a browser that holds the session, or a client that holds the credentials. This takes the
 * first: the userscript is already inside the authenticated tab, so no password is stored anywhere and nothing here
 * ever sees one. It also avoids Playwright, whose file-chooser interception breaks the user's own file pickers.
 *
 * What it buys over driving the tab from outside: the loops run HERE. A sweep of forty registers, or five repeats of
 * one, is a single tool call and a single answer, instead of forty round trips against a 45-second evaluate ceiling.
 * That matters on a shared RS-485 bus, where one refusal proves nothing and only repetition separates "this register
 * does not exist" from "the bus was busy".
 *
 * Who may talk to the port: only the userscript. A request must arrive at 127.0.0.1 or localhost by that very name
 * (no DNS rebinding), carry X-MODPOLL-BRIDGE (a web page cannot send it without a CORS preflight, which is refused)
 * and no web page's Origin; after the attach, the session's token. The port is bound to the loopback only.
 *
 * Read-only throughout. The console refuses writes and so does this; there is no tool here that can change a plant.
 *
 * No dependencies. Node 18 or later.
 */
'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.MODPOLL_BRIDGE_PORT || 47921);
const PROTOCOL = 1;
const HDR_BRIDGE = 'x-modpoll-bridge';
const HDR_SESSION = 'x-modpoll-session';
const TAKEN = 'another tab attached';

const ATTACH_GRACE_MS = 30000;   // a page re-attaches on a backoff; 10-20 s measured after a server restart
let listening = false;           // false until the port is actually ours, so a failure cannot read as "no tab"
let listenError = null;
let page = null;                 // { session, waiting, waitTimer, plant }
const queue = [];                // commands Claude has asked for, not yet handed to the page
const sent = new Map();          // handed over, awaiting a result
const takenOver = [];            // sessions displaced by a newer tab, so they get a clear answer

// ---------------------------------------------------------------- the bridge

function reply(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 4e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}

function pump() {
  if (!page || !page.waiting || !queue.length) return;
  const cmd = queue.shift();
  const res = page.waiting;
  page.waiting = null;
  clearTimeout(page.waitTimer);
  sent.set(cmd.id, cmd);
  reply(res, 200, { cmd: { id: cmd.id, name: cmd.name, args: cmd.args } });
}

/**
 * Let go of the attached page. `keepWork` is the difference between the same tab reconnecting and a different tab
 * taking over: a reconnect loses nothing, because a command that was handed over never produced a result and can
 * simply go out again. Killing the queue on every attach is what made a single 409 cascade into a run of failures
 * reported as "another tab attached" when only one tab was ever open.
 */
function detach(why, { keepWork = false } = {}) {
  if (!page) return;
  if (page.waiting) { reply(page.waiting, 409, { error: why }); page.waiting = null; clearTimeout(page.waitTimer); }
  page = null;
  if (keepWork) {
    for (const cmd of [...sent.values()].reverse()) queue.unshift(cmd);
    sent.clear();
    return;
  }
  for (const cmd of [...queue, ...sent.values()]) {
    clearTimeout(cmd.timer);
    cmd.reject(new Error('the sys_tools tab went away: ' + why));
  }
  queue.length = 0;
  sent.clear();
}

/**
 * Wait for a tab, up to ms. A page that is already open re-attaches on its own backoff, which was measured at 10 to
 * 20 seconds after a server restart - so rejecting the moment nothing is attached made every first call after a
 * restart fail for no reason. Waiting costs nothing when a tab is already there.
 */
function waitForPage(ms) {
  if (page) return Promise.resolve(true);
  return new Promise((resolve) => {
    const until = Date.now() + ms;
    const tick = setInterval(() => {
      if (page || Date.now() > until) { clearInterval(tick); resolve(!!page); }
    }, 300);
  });
}

/** Ask the attached page to run one thing, and wait for its answer. */
function ask(name, args, ms) {
  return new Promise(async (resolve, reject) => {
    if (!listening) {
      reject(new Error(listenError || 'the bridge is not listening, so no tab can reach it'));
      return;
    }
    if (!await waitForPage(ATTACH_GRACE_MS)) {
      reject(new Error(
        `No sys_tools tab attached after ${Math.round(ATTACH_GRACE_MS / 1000)} s. Open the plant's sys_tools page ` +
        'in Chrome - http://<plant>.plants.iwmac.local:8080/secure/sys_tools/ - with Modpoll Console 1.65.0 or ' +
        'newer installed. It attaches by itself, on a backoff, so a tab opened just now can take a few seconds. ' +
        'If the page shows a login prompt, log in once in a normal tab first.'));
      return;
    }
    const cmd = {
      id: crypto.randomUUID(), name, args, resolve, reject,
      timer: setTimeout(() => {
        sent.delete(cmd.id);
        const i = queue.indexOf(cmd);
        if (i !== -1) queue.splice(i, 1);
        reject(new Error(`${name} got no answer in ${Math.round(ms / 1000)} s. A long sweep on a busy bus can exceed ` +
                         'this; narrow the range, or raise timeout_ms.'));
      }, ms),
    };
    queue.push(cmd);
    pump();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const host = String(req.headers.host || '').split(':')[0];
  const okHost = host === '127.0.0.1' || host === 'localhost';
  const origin = req.headers.origin;
  // A page's Origin is a web origin; the userscript sends none. Refusing it keeps any site that guesses the port out.
  const okOrigin = !origin || origin === 'null';
  if (!okHost || !okOrigin || req.headers[HDR_BRIDGE] !== String(PROTOCOL) || req.method === 'OPTIONS') {
    reply(res, 403, { error: 'not for you' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/bridge/hello') {
    reply(res, 200, { ok: true, protocol: PROTOCOL, attached: !!page, plant: page && page.plant });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/bridge/attach') {
    const body = await readBody(req);
    // A tab keeps one client id for its lifetime, so the same tab coming back is a reconnect rather than a takeover.
    const client = body.client ? String(body.client) : null;
    const reconnect = !!(page && client && page.client === client);
    if (page) {
      if (!reconnect) takenOver.push(page.session);
      detach(reconnect ? 'the same tab reconnected' : TAKEN, { keepWork: reconnect });
    }
    page = { session: crypto.randomUUID(), client, waiting: null, waitTimer: null, plant: body.plant || null };
    reply(res, 200, { session: page.session, protocol: PROTOCOL });
    return;
  }

  const mine = page && req.headers[HDR_SESSION] === page.session;

  if (req.method === 'GET' && url.pathname === '/bridge/next') {
    if (!mine) {
      reply(res, 409, {
        error: takenOver.includes(String(req.headers[HDR_SESSION] || '')) ? TAKEN : 'no such session',
      });
      return;
    }
    if (page.waiting) { reply(page.waiting, 409, { error: 'replaced by a newer poll' }); clearTimeout(page.waitTimer); }
    page.waiting = res;
    // Answer an idle poll before the browser gives up on it, so the page can simply ask again.
    page.waitTimer = setTimeout(() => {
      if (page && page.waiting === res) { page.waiting = null; reply(res, 200, { cmd: null }); }
    }, 25000);
    pump();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/bridge/result') {
    if (!mine) { reply(res, 409, { error: 'no such session' }); return; }
    const body = await readBody(req);
    const cmd = sent.get(body.id);
    if (cmd) {
      sent.delete(body.id);
      clearTimeout(cmd.timer);
      if (body.error) cmd.reject(new Error(String(body.error)));
      else cmd.resolve(body.result);
    }
    reply(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/bridge/detach') {
    if (mine) detach('the tab left');
    reply(res, 200, { ok: true });
    return;
  }

  reply(res, 404, { error: 'no such path' });
});

server.on('error', (e) => {
  // Not listening means no tab can ever reach this instance. Carrying on quietly made it answer every call with
  // "no tab attached", which sends the reader hunting for a browser problem that is not there. Say what happened,
  // and keep saying it: every tool call now fails with this reason rather than a misleading one.
  listening = false;
  listenError = e.code === 'EADDRINUSE'
    ? `Port ${PORT} is already in use, so this instance has no bridge. Usually that is a modpoll-bridge orphaned by ` +
      'an earlier Claude Code session: it still holds the port and the sys_tools tab still talks to it, so this ' +
      'session has no bridge at all while the browser looks perfectly attached. List them with\n' +
      "  powershell \"Get-CimInstance Win32_Process -Filter \\\"Name='node.exe'\\\" | ? { $_.CommandLine -like " +
      "'*modpoll-mcp*' } | select ProcessId,CreationDate\"\n" +
      'and stop the older one, then restart Claude Code. (MODPOLL_BRIDGE_PORT moves this instance instead.)'
    : `The bridge could not listen on ${PORT}: ${e.message}`;
  process.stderr.write(listenError + '\n');
});
server.on('listening', () => { listening = true; listenError = null; });
server.listen(PORT, '127.0.0.1');

// ---------------------------------------------------------------- the tools

const TOOLS = [
  {
    name: 'toolbox_plant_sql',
    description:
      'Run a SELECT against one plant\'s own MySQL through the Toolbox proxy. This reads what IWMAC has already ' +
      'polled and stored - which parameters are configured, bound and under which names - and it answers a ' +
      'different question from modpoll, which reads the device itself. Needs the IWMAC VPN. SELECT only. ' +
      'Useful tables: iw_plant_server3.iw_par_<table>_param is the template a list defines; ' +
      'iw_plant_server3.iw_gen_driver_parameters is what is actually bound per unit, and is what the parameter ' +
      'page shows.',
    inputSchema: {
      type: 'object',
      required: ['plant_id', 'sql'],
      properties: {
        plant_id: { type: 'string', description: 'The plant being worked on, e.g. 5689.' },
        sql: { type: 'string', description: 'One SELECT. Aggregate in SQL rather than returning thousands of rows.' },
      },
    },
  },
  {
    name: 'toolbox_sql',
    description: 'Run a SELECT against the Toolbox\'s own MariaDB (its tooling data, not a plant). SELECT only.',
    inputSchema: {
      type: 'object',
      required: ['sql'],
      properties: { sql: { type: 'string' } },
    },
  },
  {
    name: 'modpoll_status',
    description:
      'Whether a sys_tools tab is attached, which plant it is on, and which units that plant has. Call this first; ' +
      'every other tool needs an attached tab. Units come back as a count and a breakdown by connection, because ' +
      'the usual question is only whether a tab is there. Ask for "list" to pick a unit id out, with match to ' +
      'narrow it, and "full" only when a unit\'s own fields matter.',
    inputSchema: {
      type: 'object',
      properties: {
        units: {
          type: 'string', enum: ['count', 'list', 'full'],
          description: 'How much to say about the units. Defaults to count, or to list when match is given.',
        },
        match: {
          type: 'string',
          description: 'Keep only units whose id, name, driver or connection contains this, case-insensitively.',
        },
      },
    },
  },
  {
    name: 'modpoll_read',
    description:
      'Read Modbus registers from one unit. Set repeats above 1 on a shared RS-485 bus: a single refusal there means ' +
      'the bus was busy, not that the register is absent, and only repetition tells the two apart. A control register ' +
      'known to answer is read alongside each pass, so a run where everything refuses is reported as such rather ' +
      'than as a map full of holes.',
    inputSchema: {
      type: 'object',
      required: ['unit', 'table', 'start'],
      properties: {
        unit: { type: 'string', description: 'Unit id as the plant knows it, e.g. V02.' },
        table: { type: 'string', enum: ['coil', 'discrete', 'input', 'hold'], description: 'Which Modbus table.' },
        start: { type: 'integer', description: 'First register, as the PRINTED 1-based reference modpoll takes (-r).' },
        count: { type: 'integer', default: 1, description: 'How many, read one at a time.' },
        repeats: { type: 'integer', default: 1, description: 'Passes over the range. 3 to 5 settles a flaky bus.' },
        control: { type: 'integer', description: 'A printed reference known to answer, read once per pass as a control.' },
        control_table: {
          type: 'string', enum: ['coil', 'discrete', 'input', 'hold'],
          description: 'Which table the control lives in. Defaults to the table being read.',
        },
        timeout_ms: { type: 'integer', default: 240000 },
      },
    },
  },
  {
    name: 'modpoll_verify_list',
    description:
      'Read every point of a modbusgen project against the device and report which ones do not answer. This is the ' +
      'check that catches a list built from another controller of the same family: the registers that are absent are ' +
      'the ones that belong to the other map. Pass the project JSON itself.',
    inputSchema: {
      type: 'object',
      required: ['unit', 'project'],
      properties: {
        unit: { type: 'string' },
        project: { type: 'object', description: 'A modbusgen project document (the whole file, parsed).' },
        repeats: { type: 'integer', default: 2, description: 'Passes before a point is called absent.' },
        control: { type: 'integer', description: 'A printed reference known to answer, read once per pass as a control.' },
        control_table: {
          type: 'string', enum: ['coil', 'discrete', 'input', 'hold'],
          description: 'Which table the control lives in. A verify spans all four, so this cannot be guessed.',
        },
        timeout_ms: { type: 'integer', default: 900000 },
      },
    },
  },
  {
    name: 'modpoll_scan',
    description:
      'Sweep an address range and report what the device answers on. Use it to settle whether a controller has been ' +
      'reprogrammed since its register document was written: registers that answer but are in no document, and ' +
      'documented registers that never answer.',
    inputSchema: {
      type: 'object',
      required: ['unit', 'table', 'start', 'end'],
      properties: {
        unit: { type: 'string' },
        table: { type: 'string', enum: ['coil', 'discrete', 'input', 'hold'] },
        start: { type: 'integer', description: 'First printed reference.' },
        end: { type: 'integer', description: 'Last printed reference, inclusive.' },
        repeats: { type: 'integer', default: 2 },
        control: { type: 'integer', description: 'A printed reference known to answer, read once per pass as a control.' },
        control_table: {
          type: 'string', enum: ['coil', 'discrete', 'input', 'hold'],
          description: 'Which table the control lives in. Defaults to the table being scanned.',
        },
        timeout_ms: { type: 'integer', default: 900000 },
      },
    },
  },
];

// ---------------------------------------------------------------- Toolbox SQL
/*
 * The Toolbox answers two SQL APIs on the IWMAC VPN, and they reach a database rather than a device: what IWMAC has
 * already polled and stored. That is the other half of the picture. The 5689 job needed both - the database said
 * which rows were bound and under which names, and only the bus could say whether a register exists at all.
 *
 * Every call carries X-Caller and one X-Run-Id per plant, reused for that plant's whole run, because the Toolbox log
 * groups traffic by them. The ids are kept here for the life of the server, so a session's calls stay one run.
 *
 * SELECT only, enforced here. The API itself would take INSERT, UPDATE and DELETE; a plant's rows are the user's to
 * change, by a script he runs and reads first, never by a tool call.
 */
const TOOLBOX = 'http://toolbox.iwmac.local:8505';
const CALLER = 'Modpoll-Console';
const runIds = new Map();

function runIdFor(key) {
  if (!runIds.has(key)) runIds.set(key, crypto.randomUUID());
  return runIds.get(key);
}

async function toolboxSql(path, body, key) {
  if (!/^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i.test(body.sql_command || '')) {
    throw new Error('this tool is SELECT only. Writing to a plant is done by a script the user runs and reads first.');
  }
  const res = await fetch(TOOLBOX + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Caller': CALLER, 'X-Run-Id': runIdFor(key) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  }).catch((e) => {
    throw new Error(`the Toolbox did not answer (${e.message}). It is reachable on the IWMAC VPN only, so this ` +
                    'usually means the VPN is down rather than the API being out.');
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Toolbox answered HTTP ${res.status}: ${text.slice(0, 300)}`);
  let out;
  try { out = JSON.parse(text); } catch (e) { throw new Error('Toolbox answered something that is not JSON: ' + text.slice(0, 200)); }
  const first = (out.results || [{}])[0];
  return { rows: first.data || [], row_count: first.row_count, success: out.success, request_id: out.request_id };
}

/**
 * Check the call against the tool's own inputSchema before any of it reaches the bus.
 *
 * Nothing enforced this before, and the failure it allows is the worst kind here: a call naming an argument the tool
 * does not have - `refs` instead of `start` and `count` - ran anyway, read a register reference of NaN, and came
 * back with a confident "never answered" verdict for registers nobody had asked about. A wrong answer about which
 * registers a controller holds is worse than no answer, so a malformed call has to fail loudly instead.
 */
function checkArgs(tool, args) {
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const required = (tool.inputSchema && tool.inputSchema.required) || [];
  const known = Object.keys(props);
  for (const k of Object.keys(args || {})) {
    if (!known.includes(k)) throw new Error(`${tool.name} has no argument "${k}". It takes: ${known.join(', ')}.`);
  }
  for (const k of required) {
    if (args[k] === undefined || args[k] === null) {
      throw new Error(`${tool.name} needs "${k}": ${(props[k] || {}).description || 'see the tool schema'}`);
    }
  }
  for (const [k, v] of Object.entries(args || {})) {
    const p = props[k] || {};
    if (v === undefined || v === null) continue;
    if (p.type === 'integer' && !Number.isInteger(v)) throw new Error(`"${k}" must be a whole number, not ${JSON.stringify(v)}.`);
    if (p.type === 'string' && typeof v !== 'string') throw new Error(`"${k}" must be a string, not ${JSON.stringify(v)}.`);
    if (p.type === 'object' && typeof v !== 'object') throw new Error(`"${k}" must be an object, not ${JSON.stringify(v)}.`);
    if (p.enum && !p.enum.includes(v)) throw new Error(`"${k}" must be one of ${p.enum.join(', ')}, not ${JSON.stringify(v)}.`);
  }
}

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error('no such tool: ' + name);
  checkArgs(tool, args || {});

  if (name === 'toolbox_plant_sql') {
    if (!args.plant_id) throw new Error('plant_id is required; build it from the plant being worked on, never a constant');
    return toolboxSql('/plant-sql/', { plant_id: String(args.plant_id), sql_command: args.sql },
                      'plant:' + args.plant_id);
  }
  if (name === 'toolbox_sql') {
    return toolboxSql('/toolbox-sql/', { sql_command: args.sql }, 'toolbox');
  }

  /*
   * Status is asked mostly to find out whether there is a tab at all, and a plant of any size answered that with its
   * whole unit table - 58 units, about 5000 tokens, to say "attached". The units are still here when they are wanted:
   * one line each under "list", the raw objects under "full", and match narrows either.
   */
  if (name === 'modpoll_status') {
    const a = args || {};
    const shape = a.units || (a.match ? 'list' : 'count');
    const st = await ask('status', {}, 20000);
    const all = Array.isArray(st && st.units) ? st.units : [];
    const needle = a.match ? String(a.match).toLowerCase() : null;
    const units = needle
      ? all.filter((u) => [u.unit_id, u.unit_name, u.driver_type, u.connection]
          .some((f) => String(f || '').toLowerCase().includes(needle)))
      : all;

    const out = { attached: st && st.attached, console_version: st && st.console_version, plant: st && st.plant };
    out.unit_count = all.length;
    if (needle) out.matched = units.length;
    if (shape === 'full') {
      out.units = units;
    } else if (shape === 'list') {
      out.units = units.map((u) => [
        u.unit_id, u.unit_name, u.driver_type, u.connection,
        u.host ? u.host + (u.slave === undefined || u.slave === null ? '' : ' slave ' + u.slave) : null,
      ].filter(Boolean).join(' · '));
    } else {
      const tally = {};
      for (const u of units) {
        const k = String(u.connection || 'unknown');
        tally[k] = (tally[k] || 0) + 1;
      }
      out.by_connection = tally;
    }
    return out;
  }

  if (name === 'modpoll_read') {
    const a = Object.assign({ count: 1, repeats: 1, timeout_ms: 240000 }, args);
    return ask('read', {
      unit: a.unit, table: a.table, start: a.start, count: a.count, repeats: a.repeats,
      control: a.control, control_table: a.control_table || a.table,
    }, a.timeout_ms);
  }

  if (name === 'modpoll_verify_list') {
    const a = Object.assign({ repeats: 2, timeout_ms: 900000 }, args);
    const pts = (a.project && a.project.points) || [];
    if (!pts.length) throw new Error('that project document has no points[]');
    // The project's own offset decides what its addr means, and getting it wrong moves every point one register.
    const subtractOne = !!(a.project.options && a.project.options.subtract_one);
    return ask('verify', {
      unit: a.unit, points: pts, repeats: a.repeats, subtract_one: subtractOne,
      control: a.control, control_table: a.control_table,
    }, a.timeout_ms);
  }

  if (name === 'modpoll_scan') {
    const a = Object.assign({ repeats: 2, timeout_ms: 900000 }, args);
    if (a.end < a.start) throw new Error('end is before start');
    return ask('scan', {
      unit: a.unit, table: a.table, start: a.start, end: a.end, repeats: a.repeats,
      control: a.control, control_table: a.control_table || a.table,
    }, a.timeout_ms);
  }

  throw new Error('no such tool: ' + name);
}

// ---------------------------------------------------------------- MCP on stdio

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

// A tool call outlives the stdin line that asked for it. Counting the ones in flight keeps the process alive long
// enough to answer when stdin closes first, which is what happens whenever the server is driven from a pipe.
let inFlight = 0;
let stdinEnded = false;
function exitWhenIdle() { if (stdinEnded && inFlight === 0) process.exit(0); }

let buf = '';
process.stdin.on('data', async (chunk) => {
  buf += chunk;
  // The drain itself counts as work. Several requests can arrive in one chunk, and they are handled one at a time,
  // so a call finishing is not a reason to exit while lines behind it are still unread.
  inFlight++;
  try {
    await drain();
  } finally {
    inFlight--;
    exitWhenIdle();
  }
});

async function drain() {
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }

    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'modpoll-bridge', version: '1.0.0' },
      } });
      continue;
    }
    if (msg.method === 'notifications/initialized') continue;
    if (msg.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
      continue;
    }
    if (msg.method === 'tools/call') {
      inFlight++;
      try {
        const out = await callTool(msg.params.name, msg.params.arguments || {});
        send({ jsonrpc: '2.0', id: msg.id, result: {
          content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
        } });
      } catch (e) {
        send({ jsonrpc: '2.0', id: msg.id, result: {
          content: [{ type: 'text', text: 'ERROR: ' + e.message }], isError: true,
        } });
      } finally {
        inFlight--;
        exitWhenIdle();
      }
      continue;
    }
    if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'no such method' } });
  }
}

process.stdin.on('end', () => { stdinEnded = true; exitWhenIdle(); });
