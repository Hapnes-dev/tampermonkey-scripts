// ==UserScript==
// @name         Modpoll Console
// @version      1.0.0
// @description  Run modpoll from the IWMAC sys_tools page: pick a unit from the plant database, build a safe read-only command, poll through Plant Term in blocks of 99, and get the registers back as a table — plus a window.__modpoll API so an AI driving the browser gets structured JSON instead of terminal text
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/modpoll-console/Modpoll-Console.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/modpoll-console/Modpoll-Console.user.js
// @match        *://*.plants.iwmac.local:8080/secure/sys_tools/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      toolbox.iwmac.local
// @connect      toolbox.iwmac.local:8505
// @run-at       document-idle
// ==/UserScript==

/*
 * Modpoll Console
 * ===============
 *
 * The plant server already ships modpoll.exe and already exposes a shell through
 * Plant Term. What it does not do is make either of them pleasant to use, or safe
 * to automate: the terminal returns free text, the modpoll build on the plants is
 * a 2002-2004 FieldTalk one with two undocumented limits, and the interesting
 * question ("does this device actually hold what the point list claims") needs
 * dozens of polls whose output nobody wants to read line by line.
 *
 * This panel drives that loop from the sys_tools page, and exposes the same loop
 * as a promise API on the page so a browser-driving agent can call one function
 * and receive parsed registers instead of scraping a terminal buffer.
 *
 * Three field-established traps are handled here rather than left to the caller:
 *
 *   -r is 1-based.  The protocol address is the printed index minus one.
 *                   Every result row carries both numbers so a reading cannot
 *                   silently move by one register.
 *   -c caps at 99.  The binary's own -h says "1-100" and -c 100 answers
 *                   "modpoll: Invalid count parameter!". Ranges are split into
 *                   blocks of 99 automatically.
 *   -t follows the Modicon prefix, not the function code: 4 is a holding
 *                   register, 3 an input register, 1 a discrete input, 0 a coil.
 *
 * Polling is read-only by construction. modpoll writes when values are supplied
 * after the host argument, so every command — including one typed by hand into
 * the preview box — is tokenised and rejected if it carries a second positional
 * argument.
 */

(function () {
    'use strict';

    const VERSION = '1.0.0';
    const PANEL_ID = 'mpc-panel';
    const LAUNCH_ID = 'mpc-launch';
    const IFRAME_ID = 'iframe_plant_term';
    const MODPOLL_EXE = 'c:\\iwmac\\bin\\modpoll.exe';
    const MAX_COUNT = 99;
    const TOOLBOX_SQL_URL = 'http://toolbox.iwmac.local:8505/plant-sql/';
    const X_CALLER = 'Modpoll-Console';
    const PROMPT_RE = /plant_term>\s*$/;
    const STORE_KEY = 'mpc.form.v1';

    // With any @grant set the script runs sandboxed, so page globals (w2ui, the
    // iframe's jQuery) have to be reached through unsafeWindow.
    const pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    const REGISTER_TABLES = [
        { value: '4', label: '4 — Holding register (read/write, 4xxxx)' },
        { value: '3', label: '3 — Input register (read only, 3xxxx)' },
        { value: '1', label: '1 — Discrete input (1xxxx)' },
        { value: '0', label: '0 — Coil (0xxxx)' },
    ];

    // Serial defaults per driver family, carried over from the standalone
    // ModpollTool. They are a starting point only: the plant database is asked
    // first and wins whenever it has an answer.
    const EQUIPMENT_PRESETS = {
        ADAM: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        AKCC250: { baudrate: '38400', parity: 'even', databits: '8', stopbits: '1' },
        AKCC350: { baudrate: '38400', parity: 'even', databits: '8', stopbits: '1' },
        AKCC55: { baudrate: '38400', parity: 'even', databits: '8', stopbits: '1' },
        AKCC550A: { baudrate: '38400', parity: 'even', databits: '8', stopbits: '1' },
        AKPC420: { baudrate: '38400', parity: 'even', databits: '8', stopbits: '1' },
        CAREL: { baudrate: '19200', parity: 'none', databits: '8', stopbits: '2' },
        CORRIGO: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        CVM: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        DIXELL: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '2' },
        EM21: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        EM24: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        EM100: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        EM210: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        EM270: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        EM330: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        EM540: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        FLEXIT: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        IR33PLUS: { baudrate: '19200', parity: 'none', databits: '8', stopbits: '2' },
        KAMSTRUP: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        MPXPRO: { baudrate: '19200', parity: 'none', databits: '8', stopbits: '2' },
        NEMO96: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        REGIN: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        SWEGON: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
        UNISAB3: { baudrate: '19200', parity: 'none', databits: '8', stopbits: '1' },
        WM14: { baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' },
    };

    // ---------------------------------------------------------------- helpers

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function waitFor(probe, timeoutMs, what) {
        const deadline = Date.now() + timeoutMs;
        return new Promise((resolve, reject) => {
            (function tick() {
                let got = null;
                try { got = probe(); } catch (e) { got = null; }
                if (got) return resolve(got);
                if (Date.now() > deadline) return reject(new Error('Timed out waiting for ' + what));
                setTimeout(tick, 150);
            })();
        });
    }

    function el(tag, props, children) {
        const node = document.createElement(tag);
        Object.assign(node, props || {});
        for (const c of (children || [])) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        return node;
    }

    function plantIdFromHost() {
        const m = (location.hostname || '').match(/^(\d+)\./);
        return m ? m[1] : '';
    }

    function tail(text, n) {
        return String(text || '').slice(-(n || 400));
    }

    function nowStamp() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    }

    // ------------------------------------------------- command model + safety

    // Flags this build of modpoll understands, split by whether they consume the
    // next token. Anything outside both sets is treated as a positional argument,
    // which is how the write guard below spots a value being passed to a device.
    const FLAGS_WITH_VALUE = new Set(['-m', '-a', '-r', '-c', '-t', '-b', '-d', '-s', '-p', '-o', '-l']);
    const FLAGS_BOOLEAN = new Set(['-1', '-0', '-e', '-f', '-h', '-4', '-5', '-u']);

    function splitTokens(command) {
        const out = [];
        const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
        let m;
        while ((m = re.exec(String(command || ''))) !== null) out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
        return out;
    }

    /**
     * modpoll has no write flag: it writes when values follow the host argument.
     * So a command is read-only exactly when it carries at most two positional
     * tokens — the executable and the host (or COM port).
     */
    function assertReadOnly(command) {
        const tokens = splitTokens(command);
        const positionals = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (FLAGS_WITH_VALUE.has(t)) { i++; continue; }
            if (FLAGS_BOOLEAN.has(t)) continue;
            if (t.startsWith('-') && t.length > 1) continue; // unknown flag, not a value
            positionals.push(t);
        }
        if (positionals.length > 2) {
            throw new Error('Refused: a value after the host makes modpoll write to the device. ' +
                'Unexpected argument "' + positionals[2] + '".');
        }
        if (!/modpoll/i.test(positionals[0] || '')) {
            throw new Error('Refused: the command does not start with modpoll.exe.');
        }
        return true;
    }

    function normaliseSpec(input) {
        const spec = Object.assign({
            mode: 'tcp',
            host: '',
            port: 502,
            slave: 1,
            table: '4',
            start: 1,
            count: 1,
            base: 'printed',   // 'printed' = -r as typed, 'protocol' = add one
            baudrate: '9600',
            parity: 'none',
            databits: '8',
            stopbits: '1',
            timeoutMs: 25000,
        }, input || {});
        spec.slave = Number(spec.slave) || 1;
        spec.start = Number(spec.start) || 0;
        spec.count = Math.max(1, Number(spec.count) || 1);
        spec.port = Number(spec.port) || 502;
        spec.table = String(spec.table);
        spec.host = String(spec.host || '').trim();
        if (!spec.host) throw new Error(spec.mode === 'tcp' ? 'No IP address given' : 'No COM port given');
        return spec;
    }

    // The register a block starts at, expressed the way modpoll wants it (1-based).
    function printedRef(spec) {
        return spec.base === 'protocol' ? spec.start + 1 : spec.start;
    }

    function buildCommand(spec, overrides) {
        const s = Object.assign({}, spec, overrides || {});
        const args = [MODPOLL_EXE];
        args.push('-m', s.mode === 'tcp' ? 'tcp' : (s.mode === 'ascii' ? 'ascii' : 'rtu'));
        args.push('-a', String(s.slave));
        args.push('-t', String(s.table));
        args.push('-r', String(overrides && overrides.ref !== undefined ? overrides.ref : printedRef(s)));
        args.push('-c', String(Math.min(MAX_COUNT, s.count)));
        if (s.mode === 'tcp') {
            // In tcp mode -p is the TCP port on modpoll 3.x. Emitted only when the
            // port is not the default, so the common case stays the command shape
            // that is known to work on the plants.
            if (Number(s.port) && Number(s.port) !== 502) args.push('-p', String(s.port));
        } else {
            args.push('-b', String(s.baudrate));
            args.push('-d', String(s.databits));
            args.push('-s', String(s.stopbits));
            args.push('-p', String(s.parity));
        }
        args.push('-1');           // poll once; the panel handles repetition itself
        args.push(s.host);
        return args.join(' ');
    }

    function planBlocks(spec) {
        const blocks = [];
        let remaining = spec.count;
        let ref = printedRef(spec);
        while (remaining > 0) {
            const count = Math.min(MAX_COUNT, remaining);
            blocks.push({ ref, count });
            ref += count;
            remaining -= count;
        }
        return blocks;
    }

    // ------------------------------------------------------- output parsing

    const RE_VALUE = /^\s*\[(\d+)\]\s*:\s*(-?[0-9]+(?:\.[0-9]+)?)\s*$/;

    // Patterns worth surfacing. Everything else modpoll prints (banner, copyright,
    // the configuration echo) is noise that would only cost the reader context.
    const DIAGNOSTICS = [
        { re: /serial port already open/i, level: 'fatal', text: 'Serial port already open — another process holds the COM port' },
        { re: /port or socket open error/i, level: 'fatal', text: 'Port or socket open error — check the address and that the device is reachable' },
        { re: /can'?t reach slave/i, level: 'fatal', text: "Can't reach slave — check the IP address" },
        { re: /invalid count parameter/i, level: 'fatal', text: 'Invalid count parameter — the count cap is 99, not 100' },
        { re: /send time-?out/i, level: 'error', text: 'Send time-out' },
        { re: /time-?out|timeout/i, level: 'error', text: 'No response from device (timeout)' },
        { re: /checksum error/i, level: 'error', text: 'Checksum error — data corruption on the bus' },
        { re: /illegal function exception/i, level: 'warn', text: 'Illegal function exception — device answered, but not for this function' },
        { re: /illegal data address exception/i, level: 'warn', text: 'Illegal data address exception — device answered, register is outside its map' },
        { re: /illegal data value exception/i, level: 'warn', text: 'Illegal data value exception — device answered' },
        { re: /is not recognized as an internal or external command|cannot find the path/i, level: 'fatal', text: 'modpoll.exe not found at ' + MODPOLL_EXE },
    ];

    function parseModpoll(raw) {
        const lines = String(raw || '').split(/\r?\n/);
        const values = [];
        const diagnostics = [];
        let fatal = false;
        for (const line of lines) {
            const m = line.match(RE_VALUE);
            if (m) {
                const printed = Number(m[1]);
                values.push({ i: printed, addr: printed - 1, v: Number(m[2]) });
                continue;
            }
            for (const d of DIAGNOSTICS) {
                if (d.re.test(line)) {
                    if (!diagnostics.some(x => x.text === d.text)) diagnostics.push({ level: d.level, text: d.text, line: line.trim() });
                    if (d.level === 'fatal') fatal = true;
                    break;
                }
            }
        }
        return { values, diagnostics, fatal };
    }

    function summarise(values, requested, elapsedMs, blocks) {
        const nums = values.map(v => v.v);
        return {
            requested,
            returned: values.length,
            nonZero: nums.filter(n => n !== 0).length,
            min: nums.length ? Math.min.apply(null, nums) : null,
            max: nums.length ? Math.max.apply(null, nums) : null,
            blocks,
            elapsedMs: Math.round(elapsedMs),
        };
    }

    // ---------------------------------------------------- Plant Term driver

    const termState = { win: null, t: null, busy: false };

    function terminalOf(win) {
        try {
            const $el = win.jQuery('#my_top');
            if ($el && $el.length) {
                // Never construct a terminal here: calling .terminal() on an element
                // that has none would create an interpreter-less one and break the page.
                const existing = $el.data('terminal');
                if (existing) return existing;
            }
            if (win.jQuery.terminal && typeof win.jQuery.terminal.active === 'function') {
                return win.jQuery.terminal.active() || null;
            }
        } catch (e) { /* frame not ready yet */ }
        return null;
    }

    async function ensureTerminal() {
        if (termState.t && termState.win && !termState.win.closed) {
            try { termState.t.get_output(); return termState.t; } catch (e) { termState.t = null; }
        }
        const w2 = pageWin.w2ui;
        if (!w2 || !w2.sidebar) throw new Error('sys_tools sidebar not ready — let the page finish loading');
        if (!document.getElementById(IFRAME_ID)) w2.sidebar.click('plant_term');

        const ifr = await waitFor(() => document.getElementById(IFRAME_ID), 20000, 'the Plant Term iframe');
        const win = await waitFor(() => (ifr.contentWindow && ifr.contentWindow.jQuery) ? ifr.contentWindow : null, 20000, 'Plant Term to load');
        const t = await waitFor(() => terminalOf(win), 20000, 'the Plant Term shell');
        termState.win = win;
        termState.t = t;
        await connectShell(t);
        return t;
    }

    async function connectShell(t) {
        if (PROMPT_RE.test(tail(t.get_output()))) return;
        t.exec('');   // the page's own "Press enter to connect"
        try {
            await waitFor(() => PROMPT_RE.test(tail(t.get_output())) || null, 20000, 'Plant Term to connect');
        } catch (e) {
            throw new Error('Plant Term did not reach a prompt. This is usually the HTTP login for ' +
                location.hostname + '/secure/ having expired — open the plant in a normal tab, log in once, then retry.');
        }
    }

    /**
     * Run one command and return only what it printed. Output is read as the
     * difference against the buffer length captured before the command, so a
     * long-lived terminal does not have to be cleared between runs.
     */
    async function termRun(command, opts) {
        const options = Object.assign({ timeoutMs: 25000, settleMs: 1500 }, opts || {});
        const t = await ensureTerminal();
        const before = t.get_output().length;
        t.exec(command);
        const deadline = Date.now() + options.timeoutMs;
        let last = '';
        let stableSince = Date.now();
        while (Date.now() < deadline) {
            await sleep(200);
            const chunk = t.get_output().slice(before);
            if (chunk !== last) { last = chunk; stableSince = Date.now(); }
            if (chunk.trim() && PROMPT_RE.test(chunk)) return chunk;
            if (chunk.trim() && Date.now() - stableSince > options.settleMs) return chunk;
        }
        throw new Error('Plant Term did not finish within ' + Math.round(options.timeoutMs / 1000) + ' s. Partial output kept.');
    }

    // -------------------------------------------------------- polling engine

    let abortRequested = false;

    async function readRegisters(input, onProgress) {
        const spec = normaliseSpec(input);
        const blocks = planBlocks(spec);
        const started = performance.now();
        const values = [];
        const diagnostics = [];
        const commands = [];
        let fatal = false;

        for (let bi = 0; bi < blocks.length; bi++) {
            if (abortRequested) { diagnostics.push({ level: 'warn', text: 'Stopped by user', line: '' }); break; }
            const b = blocks[bi];
            const command = buildCommand(spec, { ref: b.ref, count: b.count });
            assertReadOnly(command);
            commands.push(command);
            if (onProgress) onProgress({ block: bi + 1, blocks: blocks.length, command });
            let raw;
            try {
                raw = await termRun(command, { timeoutMs: spec.timeoutMs });
            } catch (e) {
                diagnostics.push({ level: 'fatal', text: e.message, line: '' });
                fatal = true;
                break;
            }
            const parsed = parseModpoll(raw);
            for (const v of parsed.values) values.push(v);
            for (const d of parsed.diagnostics) if (!diagnostics.some(x => x.text === d.text)) diagnostics.push(d);
            if (parsed.fatal) { fatal = true; break; }
        }

        return {
            ok: values.length > 0 && !fatal,
            plant: plantIdFromHost(),
            at: new Date().toISOString(),
            spec: {
                mode: spec.mode, host: spec.host, port: spec.port, slave: spec.slave,
                table: spec.table, start: spec.start, count: spec.count, base: spec.base,
            },
            // Both numbers are carried per row: the index modpoll printed and the
            // protocol address it corresponds to. Everything downstream reads the
            // one it means rather than assuming.
            values,
            summary: summarise(values, spec.count, performance.now() - started, blocks.length),
            diagnostics,
            commands,
        };
    }

    /** The same result, shrunk for a caller that pays by the token. */
    function compactResult(result) {
        if (!result) return null;
        const first = result.values[0];
        return {
            ok: result.ok,
            spec: result.spec,
            summary: result.summary,
            firstPrinted: first ? first.i : null,
            firstAddr: first ? first.addr : null,
            contiguous: result.values.every((v, idx) => !idx || v.i === result.values[idx - 1].i + 1),
            v: result.values.map(v => v.v),
            diagnostics: result.diagnostics.map(d => d.level + ': ' + d.text),
        };
    }

    // --------------------------------------------- unit list from the plant DB

    let _runId = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());

    function gmPostJson(url, payload) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest not granted'));
            GM_xmlhttpRequest({
                method: 'POST', url, timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Caller': X_CALLER,
                    'X-Run-Id': _runId,
                },
                data: JSON.stringify(payload),
                onload: r => {
                    try { resolve({ status: r.status, body: JSON.parse(r.responseText) }); }
                    catch (e) { reject(new Error('Bad JSON from the plant-SQL API: ' + String(r.responseText).slice(0, 200))); }
                },
                onerror: () => reject(new Error('plant-SQL API network error (X-Run-Id ' + _runId + ')')),
                ontimeout: () => reject(new Error('plant-SQL API timeout (X-Run-Id ' + _runId + ')')),
            });
        });
    }

    // Adapted from the topology export query, narrowed to what a poll needs:
    // how the unit is reached, and with what serial settings. Literal semicolons
    // are CHAR(59) so the API's validator does not read the statement as several.
    const UNITS_SQL = `SELECT u.unit_id, u.unit_name, u.driver_type, u.driver_addr,
        CASE WHEN mb_mode.value='0' THEN 'Modbus RTU'
             WHEN mb_mode.value='1' THEN 'Modbus ASCII'
             WHEN mb_mode.value='2' THEN 'Modbus TCP'
             ELSE u.driver_type END AS connection_type,
        CASE WHEN mb_mode.value='2' AND LOCATE(CONCAT(CHAR(10),SUBSTRING_INDEX(u.driver_addr,'_',1),CHAR(59)),CONCAT(CHAR(10),REPLACE(mb_tcp_servers.value,CHAR(13),'')))>0
             THEN SUBSTRING_INDEX(SUBSTRING_INDEX(CONCAT(CHAR(10),REPLACE(mb_tcp_servers.value,CHAR(13),'')),CONCAT(CHAR(10),SUBSTRING_INDEX(u.driver_addr,'_',1),CHAR(59)),-1),CHAR(59),1)
             ELSE '' END AS resolved_address,
        CASE WHEN mb_mode.value IN ('0','1') THEN comm_port.value ELSE '' END AS comm_port,
        CASE WHEN mb_mode.value IN ('0','1') THEN comm_baudrate.value ELSE '' END AS baudrate,
        CASE WHEN mb_mode.value IN ('0','1') THEN
            CASE LOWER(comm_parity.value) WHEN '0' THEN 'none' WHEN 'n' THEN 'none' WHEN 'none' THEN 'none'
                WHEN '1' THEN 'odd' WHEN 'o' THEN 'odd' WHEN 'odd' THEN 'odd'
                WHEN '2' THEN 'even' WHEN 'e' THEN 'even' WHEN 'even' THEN 'even'
                ELSE '' END
            ELSE '' END AS parity
        FROM iw_plant_server3.iw_sys_plant_units AS u
        LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS mb_mode ON mb_mode.setting='mb_mode' AND mb_mode.owner=u.driver_type
        LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS mb_tcp_servers ON mb_tcp_servers.setting='mb_tcp_servers' AND mb_tcp_servers.owner=u.driver_type
        LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS comm_port ON comm_port.setting='comm_port' AND comm_port.owner=u.driver_type
        LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS comm_baudrate ON comm_baudrate.setting='comm_baudrate' AND comm_baudrate.owner=u.driver_type
        LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS comm_parity ON comm_parity.setting='comm_parity' AND comm_parity.owner=u.driver_type
        WHERE u.active='1' AND LEFT(u.unit_id,3)<>'VV_' AND UPPER(TRIM(u.unit_id))<>'SERVER'
        ORDER BY u.driver_type, u.unit_id`;

    let _unitsCache = null;

    /**
     * driver_addr is the plant's own addressing string. For Modbus TCP it is
     * "<server key>_<slave>", for RTU usually the slave number alone. The last
     * numeric segment is the slave address; it is offered as a filled-in field
     * the user can correct rather than as a fact.
     */
    function slaveFromDriverAddr(driverAddr) {
        const parts = String(driverAddr || '').split('_').filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
            if (/^\d+$/.test(parts[i])) return Number(parts[i]);
        }
        return 1;
    }

    function presetFor(driverType) {
        const key = String(driverType || '').toUpperCase();
        if (EQUIPMENT_PRESETS[key]) return EQUIPMENT_PRESETS[key];
        for (const name of Object.keys(EQUIPMENT_PRESETS)) {
            if (key.startsWith(name)) return EQUIPMENT_PRESETS[name];
        }
        return null;
    }

    async function fetchUnits(force) {
        if (_unitsCache && !force) return _unitsCache;
        const plantId = plantIdFromHost();
        if (!plantId) throw new Error('Could not read a plant id from the hostname');
        const res = await gmPostJson(TOOLBOX_SQL_URL, { plant_id: plantId, sql_command: UNITS_SQL });
        if (!res.body || !res.body.success) {
            throw new Error((res.body && (res.body.error || res.body.message)) || ('HTTP ' + res.status));
        }
        const rows = (res.body.results && res.body.results[0] && res.body.results[0].data) || [];
        _unitsCache = rows.map(r => {
            const preset = presetFor(r.driver_type) || {};
            return {
                unit_id: r.unit_id,
                unit_name: r.unit_name,
                driver_type: r.driver_type,
                driver_addr: r.driver_addr,
                connection: r.connection_type,
                mode: /TCP/i.test(r.connection_type || '') ? 'tcp' : (/ASCII/i.test(r.connection_type || '') ? 'ascii' : 'rtu'),
                host: r.resolved_address || (/TCP/i.test(r.connection_type || '') ? '' : (r.comm_port || '')),
                slave: slaveFromDriverAddr(r.driver_addr),
                baudrate: r.baudrate || preset.baudrate || '9600',
                parity: (r.parity || preset.parity || 'none').toLowerCase(),
                databits: preset.databits || '8',
                stopbits: preset.stopbits || '1',
            };
        });
        return _unitsCache;
    }

    // ------------------------------------------------------- binary self-probe

    let _usageCache = null;

    /**
     * Ask the binary itself what it supports. Plants do not all carry the same
     * build, and -h is the only source that cannot be out of date.
     */
    async function probeBinary(force) {
        if (_usageCache && !force) return _usageCache;
        const raw = await termRun(MODPOLL_EXE + ' -h', { timeoutMs: 15000, settleMs: 900 });
        _usageCache = {
            usage: raw.trim(),
            hasTcpPortFlag: /-p\s+#?\s*(tcp\s+)?port/i.test(raw),
            version: (raw.match(/modpoll\s+([0-9.]+)/i) || [])[1] || null,
        };
        return _usageCache;
    }

    // ------------------------------------------------------------------- UI

    const STYLE = `
    #${LAUNCH_ID}{position:fixed;right:18px;bottom:18px;z-index:99998;background:#8B5CF6;color:#fff;border:0;
        border-radius:22px;padding:10px 16px;font:600 13px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35)}
    #${LAUNCH_ID}:hover{background:#7C4DEF}
    #${PANEL_ID}{position:fixed;right:18px;bottom:68px;z-index:99999;width:640px;max-height:82vh;display:flex;flex-direction:column;
        background:#1A1D2E;color:#E7E9F3;border:1px solid #2D3348;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5);
        font:13px/1.45 system-ui,sans-serif}
    #${PANEL_ID} .mpc-head{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#22283A;border-radius:10px 10px 0 0;cursor:move}
    #${PANEL_ID} .mpc-title{font-weight:700;letter-spacing:.2px}
    #${PANEL_ID} .mpc-ver{opacity:.55;font-size:11px}
    #${PANEL_ID} .mpc-dot{width:9px;height:9px;border-radius:50%;background:#5A5A6E;margin-left:auto}
    #${PANEL_ID} .mpc-dot.ok{background:#10B981}#${PANEL_ID} .mpc-dot.warn{background:#F59E0B}#${PANEL_ID} .mpc-dot.err{background:#EF4444}
    #${PANEL_ID} .mpc-x{background:none;border:0;color:#9aa0b5;font-size:16px;cursor:pointer;padding:0 2px}
    #${PANEL_ID} .mpc-body{overflow:auto;padding:10px 12px 12px}
    #${PANEL_ID} .mpc-row{display:flex;gap:8px;align-items:center;margin-bottom:7px;flex-wrap:wrap}
    #${PANEL_ID} label{font-size:11px;opacity:.7;display:block;margin-bottom:2px}
    #${PANEL_ID} .mpc-f{display:flex;flex-direction:column}
    #${PANEL_ID} input,#${PANEL_ID} select{background:#2D3348;color:#E7E9F3;border:1px solid #3A4159;border-radius:5px;padding:5px 7px;font:12px system-ui,sans-serif}
    #${PANEL_ID} input:focus,#${PANEL_ID} select:focus{outline:1px solid #8B5CF6}
    #${PANEL_ID} .mpc-w60{width:60px}#${PANEL_ID} .mpc-w80{width:80px}#${PANEL_ID} .mpc-w130{width:130px}#${PANEL_ID} .mpc-grow{flex:1;min-width:120px}
    #${PANEL_ID} button.mpc-b{background:#2D3348;color:#E7E9F3;border:1px solid #3A4159;border-radius:5px;padding:6px 11px;font:600 12px system-ui,sans-serif;cursor:pointer}
    #${PANEL_ID} button.mpc-b:hover{border-color:#8B5CF6}
    #${PANEL_ID} button.mpc-b.pri{background:#8B5CF6;border-color:#8B5CF6}
    #${PANEL_ID} button.mpc-b[disabled]{opacity:.45;cursor:default}
    #${PANEL_ID} .mpc-cmd{width:100%;font-family:Consolas,monospace;font-size:11.5px}
    #${PANEL_ID} .mpc-note{font-size:11px;opacity:.65;margin:2px 0 8px}
    #${PANEL_ID} .mpc-log{margin-top:8px;max-height:110px;overflow:auto;font:11.5px Consolas,monospace;background:#151827;border:1px solid #2D3348;border-radius:6px;padding:6px 8px;white-space:pre-wrap}
    #${PANEL_ID} .mpc-log .err{color:#FF6B6B}#${PANEL_ID} .mpc-log .warn{color:#F59E0B}#${PANEL_ID} .mpc-log .ok{color:#10B981}
    #${PANEL_ID} table.mpc-grid{width:100%;border-collapse:collapse;margin-top:8px;font:11.5px Consolas,monospace}
    #${PANEL_ID} table.mpc-grid th{position:sticky;top:0;background:#22283A;text-align:right;padding:4px 6px;font-weight:600;border-bottom:1px solid #2D3348}
    #${PANEL_ID} table.mpc-grid td{text-align:right;padding:3px 6px;border-bottom:1px solid #22283A}
    #${PANEL_ID} table.mpc-grid tr:nth-child(even) td{background:#1E2233}
    #${PANEL_ID} table.mpc-grid td.zero{opacity:.4}
    #${PANEL_ID} .mpc-gridwrap{max-height:280px;overflow:auto;border:1px solid #2D3348;border-radius:6px}
    #${PANEL_ID} .mpc-sum{font-size:11.5px;opacity:.8;margin-top:6px}
    `;

    const ui = {};
    let lastResult = null;
    let repeatTimer = null;

    function log(text, level) {
        if (!ui.log) return;
        const line = el('div', { className: level || '', textContent: text });
        ui.log.appendChild(line);
        ui.log.scrollTop = ui.log.scrollHeight;
    }

    function setDot(state) {
        if (ui.dot) ui.dot.className = 'mpc-dot ' + (state || '');
    }

    function field(labelText, control) {
        return el('div', { className: 'mpc-f' }, [el('label', { textContent: labelText }), control]);
    }

    function readForm() {
        return {
            mode: ui.mode.value,
            host: ui.host.value,
            port: ui.port.value,
            slave: ui.slave.value,
            table: ui.table.value,
            start: ui.start.value,
            count: ui.count.value,
            base: ui.base.value,
            baudrate: ui.baudrate.value,
            parity: ui.parity.value,
            databits: ui.databits.value,
            stopbits: ui.stopbits.value,
            timeoutMs: Math.max(3000, (Number(ui.timeout.value) || 25) * 1000),
        };
    }

    function applyForm(values) {
        if (!values) return;
        for (const key of ['mode', 'host', 'port', 'slave', 'table', 'start', 'count', 'base', 'baudrate', 'parity', 'databits', 'stopbits']) {
            if (ui[key] && values[key] !== undefined && values[key] !== null) ui[key].value = values[key];
        }
        toggleSerial();
        refreshPreview();
    }

    function toggleSerial() {
        const serial = ui.mode.value !== 'tcp';
        ui.serialRow.style.display = serial ? '' : 'none';
        ui.portWrap.style.display = serial ? 'none' : '';
        ui.hostLabel.textContent = serial ? 'COM port' : 'IP address';
    }

    function refreshPreview() {
        if (ui.cmdDirty) return;
        try {
            const spec = normaliseSpec(readForm());
            const blocks = planBlocks(spec);
            ui.cmd.value = buildCommand(spec, { ref: blocks[0].ref, count: blocks[0].count });
            ui.blockNote.textContent = blocks.length > 1
                ? blocks.length + ' commands — the count is split into blocks of ' + MAX_COUNT + ', the preview shows the first'
                : '';
        } catch (e) {
            ui.cmd.value = '';
            ui.blockNote.textContent = e.message;
        }
    }

    function renderGrid(result) {
        ui.gridBody.textContent = '';
        const onlyNonZero = ui.filterZero.checked;
        const rows = result.values.filter(v => !onlyNonZero || v.v !== 0);
        const shown = rows.slice(0, 2000);
        const frag = document.createDocumentFragment();
        for (const v of shown) {
            const u16 = v.v < 0 ? v.v + 65536 : v.v;
            const i16 = v.v > 32767 ? v.v - 65536 : v.v;
            const tr = el('tr', {}, [
                el('td', { textContent: String(v.i) }),
                el('td', { textContent: String(v.addr) }),
                el('td', { textContent: String(v.v), className: v.v === 0 ? 'zero' : '' }),
                el('td', { textContent: '0x' + (u16 >>> 0).toString(16).toUpperCase().padStart(4, '0') }),
                el('td', { textContent: String(i16) }),
                el('td', { textContent: (v.v / 10).toFixed(1) }),
                el('td', { textContent: (v.v / 100).toFixed(2) }),
            ]);
            frag.appendChild(tr);
        }
        ui.gridBody.appendChild(frag);
        const s = result.summary;
        ui.summary.textContent = s.returned + ' of ' + s.requested + ' registers, ' + s.nonZero + ' non-zero, ' +
            (s.returned ? 'range ' + s.min + '…' + s.max + ', ' : '') + s.blocks + ' command' + (s.blocks === 1 ? '' : 's') +
            ', ' + s.elapsedMs + ' ms' + (rows.length > shown.length ? ' — showing the first 2000 rows' : '');
    }

    async function runOnce() {
        if (termState.busy) return;
        termState.busy = true;
        abortRequested = false;
        ui.run.disabled = true;
        ui.stop.disabled = false;
        setDot('warn');
        try {
            let result;
            if (ui.cmdDirty) {
                // A hand-edited command is run verbatim, after the same write check.
                const command = ui.cmd.value.trim();
                assertReadOnly(command);
                log('> ' + command);
                const raw = await termRun(command, { timeoutMs: readForm().timeoutMs });
                const parsed = parseModpoll(raw);
                result = {
                    ok: parsed.values.length > 0 && !parsed.fatal,
                    plant: plantIdFromHost(), at: new Date().toISOString(),
                    spec: { raw: command },
                    values: parsed.values,
                    summary: summarise(parsed.values, parsed.values.length, 0, 1),
                    diagnostics: parsed.diagnostics,
                    commands: [command],
                };
            } else {
                const form = readForm();
                GM_setValue(STORE_KEY, JSON.stringify(form));
                result = await readRegisters(form, p => log('> ' + p.command + '   [' + p.block + '/' + p.blocks + ']'));
            }
            lastResult = result;
            renderGrid(result);
            for (const d of result.diagnostics) log(d.level.toUpperCase() + ': ' + d.text, d.level === 'warn' ? 'warn' : (d.level === 'fatal' || d.level === 'error' ? 'err' : ''));
            if (result.ok) { setDot('ok'); log('OK — ' + result.summary.returned + ' registers', 'ok'); }
            else setDot('err');
        } catch (e) {
            setDot('err');
            log('ERROR: ' + e.message, 'err');
        } finally {
            termState.busy = false;
            ui.run.disabled = false;
            ui.stop.disabled = !repeatTimer;
        }
    }

    function startRepeat() {
        const every = Math.max(1, Number(ui.every.value) || 5) * 1000;
        if (repeatTimer) clearInterval(repeatTimer);
        repeatTimer = setInterval(() => { if (!termState.busy) runOnce(); }, every);
        ui.stop.disabled = false;
        log('Repeating every ' + (every / 1000) + ' s');
    }

    function stopAll() {
        abortRequested = true;
        if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
        ui.stop.disabled = true;
        log('Stopped');
    }

    function download(filename, text) {
        const blob = new Blob([text], { type: 'application/json' });
        const a = el('a', { href: URL.createObjectURL(blob), download: filename });
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function resultFilename() {
        const s = lastResult && lastResult.spec || {};
        return 'modpoll_' + (plantIdFromHost() || 'plant') + '_' + (s.host || 'raw') + '_' + nowStamp() + '.json';
    }

    async function loadUnits() {
        ui.units.disabled = true;
        log('Loading units from the plant database…');
        try {
            const units = await fetchUnits(true);
            ui.units.textContent = '';
            ui.units.appendChild(el('option', { value: '', textContent: units.length + ' units — pick one' }));
            for (const u of units) {
                const label = u.unit_id + ' · ' + (u.unit_name || '') + ' · ' + u.driver_type + ' · ' + (u.connection || '');
                ui.units.appendChild(el('option', { value: u.unit_id, textContent: label }));
            }
            log('Loaded ' + units.length + ' units', 'ok');
        } catch (e) {
            log('ERROR: ' + e.message, 'err');
        } finally {
            ui.units.disabled = false;
        }
    }

    function applyUnit(unitId) {
        const u = (_unitsCache || []).find(x => x.unit_id === unitId);
        if (!u) return;
        ui.mode.value = u.mode;
        ui.host.value = u.host || '';
        ui.slave.value = u.slave;
        ui.baudrate.value = u.baudrate;
        ui.parity.value = u.parity;
        ui.databits.value = u.databits;
        ui.stopbits.value = u.stopbits;
        ui.cmdDirty = false;
        toggleSerial();
        refreshPreview();
        log('Loaded ' + u.unit_id + ' (' + u.driver_type + ', ' + u.connection + ', driver_addr ' + u.driver_addr +
            ' — slave read as ' + u.slave + ', correct it if the plant addresses differently)');
    }

    function buildPanel() {
        document.head.appendChild(el('style', { textContent: STYLE }));

        const panel = el('div', { id: PANEL_ID });
        panel.style.display = 'none';

        ui.dot = el('span', { className: 'mpc-dot' });
        const close = el('button', { className: 'mpc-x', textContent: '×', title: 'Close' });
        close.addEventListener('click', () => { panel.style.display = 'none'; });
        const head = el('div', { className: 'mpc-head' }, [
            el('span', { className: 'mpc-title', textContent: 'Modpoll Console' }),
            el('span', { className: 'mpc-ver', textContent: 'v' + VERSION + ' · plant ' + (plantIdFromHost() || '?') }),
            ui.dot, close,
        ]);

        const body = el('div', { className: 'mpc-body' });

        // Unit picker
        ui.units = el('select', { className: 'mpc-grow' }, [el('option', { value: '', textContent: 'Units not loaded' })]);
        ui.units.addEventListener('change', () => applyUnit(ui.units.value));
        const loadBtn = el('button', { className: 'mpc-b', textContent: 'Load units' });
        loadBtn.addEventListener('click', loadUnits);
        body.appendChild(el('div', { className: 'mpc-row' }, [field('Unit (from the plant database)', ui.units), field(' ', loadBtn)]));

        // Connection
        ui.mode = el('select', { className: 'mpc-w80' }, [
            el('option', { value: 'tcp', textContent: 'TCP' }),
            el('option', { value: 'rtu', textContent: 'RTU' }),
            el('option', { value: 'ascii', textContent: 'ASCII' }),
        ]);
        ui.mode.addEventListener('change', () => { toggleSerial(); ui.cmdDirty = false; refreshPreview(); });
        ui.host = el('input', { className: 'mpc-grow', placeholder: '10.0.0.5' });
        ui.hostLabel = el('label', { textContent: 'IP address' });
        const hostWrap = el('div', { className: 'mpc-f mpc-grow' }, [ui.hostLabel, ui.host]);
        ui.port = el('input', { className: 'mpc-w80', value: '502' });
        ui.portWrap = field('TCP port', ui.port);
        ui.slave = el('input', { className: 'mpc-w60', value: '1' });
        body.appendChild(el('div', { className: 'mpc-row' }, [field('Mode', ui.mode), hostWrap, ui.portWrap, field('Slave (-a)', ui.slave)]));

        // Serial settings, shown for RTU and ASCII only
        ui.baudrate = el('select', { className: 'mpc-w80' }, ['1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'].map(v => el('option', { value: v, textContent: v })));
        ui.baudrate.value = '9600';
        ui.parity = el('select', { className: 'mpc-w80' }, ['none', 'even', 'odd'].map(v => el('option', { value: v, textContent: v })));
        ui.databits = el('select', { className: 'mpc-w60' }, ['8', '7'].map(v => el('option', { value: v, textContent: v })));
        ui.stopbits = el('select', { className: 'mpc-w60' }, ['1', '2'].map(v => el('option', { value: v, textContent: v })));
        ui.serialRow = el('div', { className: 'mpc-row' }, [
            field('Baud (-b)', ui.baudrate), field('Parity (-p)', ui.parity),
            field('Data bits (-d)', ui.databits), field('Stop bits (-s)', ui.stopbits),
        ]);
        body.appendChild(ui.serialRow);

        // Register range
        ui.table = el('select', { className: 'mpc-w130' }, REGISTER_TABLES.map(t => el('option', { value: t.value, textContent: t.label })));
        ui.table.value = '4';
        ui.base = el('select', { className: 'mpc-w130' }, [
            el('option', { value: 'printed', textContent: 'as modpoll prints it (-r)' }),
            el('option', { value: 'protocol', textContent: 'protocol address (adds 1)' }),
        ]);
        ui.start = el('input', { className: 'mpc-w80', value: '1' });
        ui.count = el('input', { className: 'mpc-w80', value: '10' });
        ui.timeout = el('input', { className: 'mpc-w60', value: '25' });
        body.appendChild(el('div', { className: 'mpc-row' }, [
            field('Table (-t)', ui.table), field('Start is', ui.base),
            field('Start (-r)', ui.start), field('Count (-c)', ui.count), field('Timeout s', ui.timeout),
        ]));

        for (const input of [ui.host, ui.port, ui.slave, ui.start, ui.count]) {
            input.addEventListener('input', () => { ui.cmdDirty = false; refreshPreview(); });
        }
        for (const sel of [ui.table, ui.base, ui.baudrate, ui.parity, ui.databits, ui.stopbits]) {
            sel.addEventListener('change', () => { ui.cmdDirty = false; refreshPreview(); });
        }

        // Command preview
        ui.cmd = el('input', { className: 'mpc-cmd' });
        ui.cmdDirty = false;
        ui.cmd.addEventListener('input', () => { ui.cmdDirty = true; ui.blockNote.textContent = 'Hand-edited — run as typed, blocks are not split'; });
        ui.blockNote = el('div', { className: 'mpc-note' });
        body.appendChild(field('Command (editable; read-only commands only)', ui.cmd));
        body.appendChild(ui.blockNote);

        // Actions
        ui.run = el('button', { className: 'mpc-b pri', textContent: 'Run' });
        ui.run.addEventListener('click', runOnce);
        ui.stop = el('button', { className: 'mpc-b', textContent: 'Stop', disabled: true });
        ui.stop.addEventListener('click', stopAll);
        ui.every = el('input', { className: 'mpc-w60', value: '5' });
        const repeat = el('button', { className: 'mpc-b', textContent: 'Repeat' });
        repeat.addEventListener('click', startRepeat);
        const copyBtn = el('button', { className: 'mpc-b', textContent: 'Copy for AI' });
        copyBtn.addEventListener('click', () => {
            if (!lastResult) return log('Nothing to copy yet');
            GM_setClipboard(JSON.stringify(compactResult(lastResult)));
            log('Compact result copied', 'ok');
        });
        const saveBtn = el('button', { className: 'mpc-b', textContent: 'Download JSON' });
        saveBtn.addEventListener('click', () => {
            if (!lastResult) return log('Nothing to save yet');
            download(resultFilename(), JSON.stringify(lastResult, null, 2));
        });
        const probeBtn = el('button', { className: 'mpc-b', textContent: 'Probe binary' });
        probeBtn.addEventListener('click', async () => {
            try {
                const info = await probeBinary(true);
                log('modpoll ' + (info.version || 'version unknown') + ' — ' + (info.hasTcpPortFlag ? '-p carries the TCP port in tcp mode' : 'no TCP port flag found in -h'), 'ok');
            } catch (e) { log('ERROR: ' + e.message, 'err'); }
        });
        body.appendChild(el('div', { className: 'mpc-row' }, [ui.run, ui.stop, repeat, field('every s', ui.every), copyBtn, saveBtn, probeBtn]));

        // Results
        ui.filterZero = el('input', { type: 'checkbox' });
        ui.filterZero.addEventListener('change', () => { if (lastResult) renderGrid(lastResult); });
        const filterLabel = el('label', { style: 'display:flex;align-items:center;gap:5px;opacity:.8' }, [ui.filterZero, document.createTextNode('Hide zero values')]);
        body.appendChild(el('div', { className: 'mpc-row' }, [filterLabel]));

        ui.gridBody = el('tbody');
        const table = el('table', { className: 'mpc-grid' }, [
            el('thead', {}, [el('tr', {}, ['printed', 'addr', 'value', 'hex', 'int16', '×0.1', '×0.01'].map(h => el('th', { textContent: h })))]),
            ui.gridBody,
        ]);
        body.appendChild(el('div', { className: 'mpc-gridwrap' }, [table]));
        ui.summary = el('div', { className: 'mpc-sum' });
        body.appendChild(ui.summary);

        ui.log = el('div', { className: 'mpc-log' });
        body.appendChild(ui.log);

        panel.appendChild(head);
        panel.appendChild(body);
        document.body.appendChild(panel);

        makeDraggable(panel, head);

        const launch = el('button', { id: LAUNCH_ID, textContent: '⚡ Modpoll' });
        launch.addEventListener('click', () => {
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
        });
        document.body.appendChild(launch);

        toggleSerial();
        try { applyForm(JSON.parse(GM_getValue(STORE_KEY, 'null'))); } catch (e) { /* first run */ }
        refreshPreview();
        log('Ready. Registers are read only; a value after the host is refused.');
        return panel;
    }

    function makeDraggable(panel, handle) {
        let startX = 0, startY = 0, baseLeft = 0, baseTop = 0, dragging = false;
        handle.addEventListener('mousedown', e => {
            if (e.target.classList.contains('mpc-x')) return;
            const r = panel.getBoundingClientRect();
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            startX = e.clientX; startY = e.clientY; baseLeft = r.left; baseTop = r.top;
            dragging = true;
            e.preventDefault();
        });
        window.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left = Math.max(0, baseLeft + e.clientX - startX) + 'px';
            panel.style.top = Math.max(0, baseTop + e.clientY - startY) + 'px';
        });
        window.addEventListener('mouseup', () => { dragging = false; });
    }

    // ------------------------------------------------------------ AI bridge

    /**
     * The page-level API. An agent driving this tab calls these instead of
     * reaching into the terminal: the promise resolves with parsed registers,
     * both address bases, a summary and the exact commands that were run.
     */
    const api = {
        version: VERSION,
        help() {
            return [
                'window.__modpoll — read-only Modbus polling through Plant Term.',
                '',
                'await __modpoll.devices()                 units from the plant database',
                'await __modpoll.read({host, slave, table, start, count, base, mode, port})',
                '                                          table: 4 holding, 3 input, 1 discrete, 0 coil',
                '                                          base:  "printed" (default, -r as given) | "protocol" (adds 1)',
                '                                          count over 99 is split into blocks automatically',
                'await __modpoll.readCompact(spec)         same, values as a bare array',
                'await __modpoll.raw("modpoll.exe …")      one command, parsed; writes are refused',
                'await __modpoll.probe()                   what this plant\'s modpoll -h reports',
                '__modpoll.last()                          the last full result',
                '__modpoll.stop()                          abort a running sweep',
                '',
                'Every value row carries i (the index modpoll printed) and addr (i - 1, the protocol address).',
            ].join('\n');
        },
        ready() { return !!(pageWin.w2ui && pageWin.w2ui.sidebar); },
        devices(opts) { return fetchUnits(!!(opts && opts.refresh)); },
        async read(spec) {
            abortRequested = false;
            const result = await readRegisters(spec);
            lastResult = result;
            try { if (ui.gridBody) renderGrid(result); } catch (e) { /* panel not open */ }
            return result;
        },
        async readCompact(spec) { return compactResult(await api.read(spec)); },
        async raw(command) {
            assertReadOnly(command);
            const raw = await termRun(command, { timeoutMs: 25000 });
            const parsed = parseModpoll(raw);
            return { ok: parsed.values.length > 0 && !parsed.fatal, command, values: parsed.values, diagnostics: parsed.diagnostics, raw };
        },
        probe(force) { return probeBinary(!!force); },
        last() { return lastResult; },
        lastCompact() { return compactResult(lastResult); },
        stop() { stopAll(); return true; },
        open() { const p = document.getElementById(PANEL_ID); if (p) p.style.display = 'flex'; return true; },
    };

    // A second route for callers that run in an isolated world and cannot see
    // page globals: post a request, listen for the matching response.
    window.addEventListener('message', async ev => {
        if (ev.source !== window) return;
        const req = ev.data;
        if (!req || req.__modpoll !== 'request' || !req.method) return;
        const reply = payload => window.postMessage(Object.assign({ __modpoll: 'response', id: req.id }, payload), '*');
        try {
            if (typeof api[req.method] !== 'function') throw new Error('Unknown method: ' + req.method);
            reply({ ok: true, result: await api[req.method].apply(api, req.args || []) });
        } catch (e) {
            reply({ ok: false, error: e.message });
        }
    });

    // ------------------------------------------------------------------ init

    function init() {
        if (document.getElementById(PANEL_ID)) return;
        buildPanel();
        try { pageWin.__modpoll = api; } catch (e) { window.__modpoll = api; }
        console.info('[Modpoll Console ' + VERSION + '] window.__modpoll ready — call __modpoll.help() for the API.');
    }

    // The sys_tools shell builds its sidebar after load; wait for it rather than
    // polling the DOM broadly.
    waitFor(() => (pageWin.w2ui && pageWin.w2ui.sidebar && document.body) || null, 30000, 'the sys_tools shell')
        .then(init)
        .catch(() => { /* not a sys_tools shell page, nothing to attach to */ });
})();
