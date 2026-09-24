// ==UserScript==
// @name         Modpoll Console
// @version      1.46.1
// @description  Run modpoll from the IWMAC sys_tools page: pick a unit from the plant database, build a safe read-only command, poll through Plant Term in blocks of 99, and get the registers back as a table — plus a window.__modpoll API so an AI driving the browser gets structured JSON instead of terminal text
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/modpoll-console/Modpoll-Console.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/modpoll-console/Modpoll-Console.user.js
// @match        *://*.plants.iwmac.local:8080/secure/sys_tools/*
// @grant        GM_setValue
// @grant        GM_getValue
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
 * argument. The same pass admits only the three spellings of the executable the
 * tool itself emits, and only tokens made of the characters a modpoll argument
 * can contain: the command runs in a shell on the plant server, and a quote, a
 * pipe, a redirect or a line break inside an argument is not a poll.
 */

(function () {
    'use strict';

    // The installed copy answers with the version its manager sees, so the head,
    // the export file, the report and the API can never say one number while the
    // header says another — which they did, for ten releases. The literal is
    // only for a copy evaluated straight into a page.
    const VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '1.46.1';
    const PANEL_ID = 'mpc-panel';
    const HOST_ID = 'mpc-host';
    const SIDEBAR_ID = 'modpoll_console';
    const IFRAME_ID = 'iframe_plant_term';
    const PLANT_TERM_URL = '/secure/plant_term/';
    // Plant Term resolves a bare "modpoll", and a command line that says so is far
    // easier to read — and to paste into a ticket. The full path stays as a
    // fallback for a plant whose PATH does not carry it; the swap happens by
    // itself, once, the first time the shell says it cannot find the command.
    const EXE_BARE = 'modpoll';
    const EXE_FULL = 'c:\\iwmac\\bin\\modpoll.exe';
    let exePath = EXE_BARE;
    const MAX_COUNT = 99;
    // The shell runs chained commands in one round trip: three full blocks came
    // back in 221 ms against a plant, where three separate runs cost about 3 s.
    // Four is a deliberate ceiling — roughly 400 lines, which the terminal holds
    // comfortably.
    const CHAIN_MAX = 4;
    // A chained line also has to stay short. A line long enough to be cut on its
    // way through the shell turns the tail of it into something modpoll never
    // meant to run.
    const CHAIN_CHARS = 420;
    const MARK = '#mpc';

    // 32-bit formats consume two registers per value, and -c counts values rather
    // than registers. The endian flag is per format: -i for integers, -f for floats.
    const FORMATS = [
        { value: '', label: '16-bit', step: 1, endianFlag: null },
        { value: 'int', label: '32-bit int', step: 2, endianFlag: '-i' },
        { value: 'float', label: '32-bit float', step: 2, endianFlag: '-f' },
        { value: 'mod', label: '32-bit mod 10000', step: 2, endianFlag: '-i' },
        { value: 'hex', label: '16-bit hex', step: 1, endianFlag: null },
    ];
    const formatOf = value => FORMATS.find(f => f.value === (value || '')) || FORMATS[0];
    const TOOLBOX_SQL_URL = 'http://toolbox.iwmac.local:8505/plant-sql/';
    const X_CALLER = 'Modpoll-Console';
    const STORE_KEY = 'mpc.form.v1';

    // With any @grant set the script runs sandboxed, so page globals (w2ui, the
    // iframe's jQuery) have to be reached through unsafeWindow.
    const pageWin = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    // Labelled by Modicon prefix, which is what -t follows. The short label keeps
    // the select inside its grid cell; the long one is the option's tooltip.
    const REGISTER_TABLES = [
        { value: '4', label: '4 — Holding 4xxxx', title: 'Holding register, read/write (4xxxx)' },
        { value: '3', label: '3 — Input 3xxxx', title: 'Input register, read only (3xxxx)' },
        { value: '1', label: '1 — Discrete 1xxxx', title: 'Discrete input (1xxxx)' },
        { value: '0', label: '0 — Coil 0xxxx', title: 'Coil (0xxxx)' },
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

    /*
     * Settings go through the userscript manager when it is there. It is not
     * always there: the script is also evaluated straight into a page — by an
     * agent driving the console, or while testing a change — and a bare
     * GM_getValue then throws where it stands. Losing a remembered window height
     * is not worth losing the panel over, so storage degrades quietly.
     */
    function storeGet(key, fallback) {
        try { if (typeof GM_getValue === 'function') return GM_getValue(key, fallback); } catch (e) { /* no manager */ }
        try { const raw = localStorage.getItem(key); return raw === null ? fallback : raw; } catch (e) { return fallback; }
    }

    function storeSet(key, value) {
        try { if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; } } catch (e) { /* no manager */ }
        try { localStorage.setItem(key, String(value)); } catch (e) { /* nowhere to keep it */ }
    }

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

    function nowStamp() {
        const d = new Date(), p = n => String(n).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    }

    // ------------------------------------------------- command model + safety

    // Flags this build of modpoll understands, split by whether they consume the
    // next token. Anything outside both sets is treated as a positional argument,
    // which is how the write guard below spots a value being passed to a device.
    const FLAGS_WITH_VALUE = new Set(['-m', '-a', '-r', '-c', '-t', '-b', '-d', '-s', '-p', '-o', '-l']);
    // -i and -f are the endian flags; this build has no -0.
    const FLAGS_BOOLEAN = new Set(['-1', '-i', '-e', '-f', '-h', '-4', '-5', '-u']);
    // Every argument modpoll takes is one bare word: a flag, a number, a table
    // with its format, a mode, a parity, an address or a path. None needs a
    // quote, a space, a pipe, a redirect or a variable, so a token carrying any
    // of those is not an argument — it is an attempt on the shell the command
    // runs in, which is a shell on the plant server.
    const RE_TOKEN = /^[\w.:\\\/-]+$/;
    // The executable is one of the three spellings the tool itself emits. A
    // path that merely contains "modpoll" — a UNC share, a copy left somewhere
    // else on the plant — is not run.
    const EXE_ALLOWED = new Set(['modpoll', 'modpoll.exe', EXE_FULL.toLowerCase()]);

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
     *
     * Commands may be chained with '&' to save round trips, so each segment is
     * checked on its own, and the only non-modpoll segment allowed is the echo
     * marker that separates one block's output from the next.
     */
    function assertReadOnly(command) {
        const segments = String(command).split('&').map(s => s.trim()).filter(Boolean);
        if (segments.length > 1) {
            for (const segment of segments) assertSegmentReadOnly(segment);
            return true;
        }
        return assertSegmentReadOnly(String(command).trim());
    }

    /**
     * Put -1 into a command that lacks it. Without it modpoll polls every second
     * for ever: the output drowns the shell, the COM port stays taken, and every
     * later command appears to return nothing at all. A hand-typed command is
     * exactly where that happens, so it is added rather than refused — and said
     * out loud.
     */
    function ensurePollOnce(command) {
        return String(command).split('&').map(segment => {
            const text = segment.trim();
            if (!/modpoll/i.test(text)) return segment;
            if (/(^|\s)-1(\s|$)/.test(text) || /(^|\s)-h(\s|$)/.test(text)) return segment;
            return segment.replace(/(modpoll(?:\.exe)?)/i, '$1 -1');
        }).join('&');
    }

    /**
     * Windows opens COM1-COM9 by name, but COM10 and above only through the device
     * namespace: `\\.\COM16`. modpoll hands the name straight to Windows, so a bare
     * COM16 fails with "Port or socket open error" — which reads exactly like a port
     * the Plant Server holds, and was taken for one on plant 3694 (2026-09-23) until
     * Thomas pointed at the name. A port that really is held answers "Serial port
     * already open" instead. COM1-COM9 keep the bare name, the shape known to work.
     */
    const RE_BARE_COM = /^COM(\d+)$/i;
    function serialPortArg(host) {
        const m = RE_BARE_COM.exec(String(host == null ? '' : host).trim());
        return m && Number(m[1]) >= 10 ? '\\\\.\\COM' + m[1] : String(host);
    }

    /** The same rewrite for a hand-typed command: every bare COM10+ token in a modpoll segment. */
    function ensureDevicePath(command) {
        return String(command).split('&').map(segment => {
            if (!/modpoll/i.test(segment)) return segment;
            return segment.replace(/(^|\s)COM(\d+)(?=\s|$)/gi,
                (all, lead, n) => (Number(n) >= 10 ? lead + '\\\\.\\COM' + n : all));
        }).join('&');
    }

    function assertSegmentReadOnly(command) {
        if (new RegExp('^echo\\s+' + MARK + '[\\w:.-]*$').test(command)) return true;
        // A line break or a control character has no place in a command line at
        // all; a shell reading one may well take what follows as the next line.
        if (/[\x00-\x1f\x7f]/.test(command)) throw new Error('Refused: the command contains a line break or a control character.');
        const tokens = splitTokens(command);
        for (const t of tokens) {
            if (!RE_TOKEN.test(t)) {
                throw new Error('Refused: "' + t + '" is not something modpoll takes — quotes, spaces inside an argument, ' +
                    'pipes, redirects and variables are never part of a poll.');
            }
        }
        const positionals = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (FLAGS_WITH_VALUE.has(t)) { i++; continue; }
            // Behind the host, a token that looks like a number is a value modpoll
            // would write — "-7" every bit as much as "7", and "-1" too. Ahead of
            // the host "-1" is the poll-once flag; the position tells them apart,
            // so it is settled before the flag sets get a say. Without this, any
            // negative value slipped through as an unknown flag.
            if (positionals.length >= 2 && /^-?(\d|\.\d)/.test(t)) { positionals.push(t); continue; }
            if (FLAGS_BOOLEAN.has(t)) continue;
            if (t.startsWith('-') && t.length > 1) continue; // unknown flag, not a value
            positionals.push(t);
        }
        if (positionals.length > 2) {
            throw new Error('Refused: a value after the host makes modpoll write to the device. ' +
                'Unexpected argument "' + positionals[2] + '".');
        }
        if (!EXE_ALLOWED.has(String(positionals[0] || '').toLowerCase())) {
            throw new Error('Refused: the command must start with modpoll, modpoll.exe or ' + EXE_FULL + ' — nothing else is run.');
        }
        return true;
    }

    /** none, even or odd from whatever spelling arrived: n/e/o, N/E/O, 0/1/2. */
    function normaliseParity(value) {
        const text = String(value == null ? '' : value).trim().toLowerCase();
        // The digits follow the plant database, where 0 is none, 1 odd, 2 even.
        const known = { '': 'none', none: 'none', n: 'none', 0: 'none', even: 'even', e: 'even', 2: 'even', odd: 'odd', o: 'odd', 1: 'odd' };
        if (known[text] === undefined) throw new Error('Parity must be none, even or odd, not "' + value + '"');
        return known[text];
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
            format: '',        // '' 16-bit, or int / float / mod / hex
            bigEndian: false,  // -i for 32-bit integers, -f for 32-bit floats
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
        spec.mode = String(spec.mode || 'tcp').trim().toLowerCase();
        if (['tcp', 'rtu', 'enc', 'ascii'].indexOf(spec.mode) < 0) throw new Error('Mode must be tcp, rtu, enc or ascii, not "' + spec.mode + '"');
        spec.host = String(spec.host || '').trim();
        if (!spec.host) throw new Error(isSerialMode(spec.mode) ? 'No COM port given' : 'No IP address given');
        // Said here, in the words of the field, rather than by the command guard
        // in the words of the shell. The form's selects can only produce valid
        // serial settings; the API and a point list's comm block can produce
        // anything, and an empty -p value would swallow the host token after it.
        if (!RE_TOKEN.test(spec.host)) throw new Error('"' + spec.host + '" contains characters that cannot be part of an address or a port name');
        spec.baudrate = String(spec.baudrate == null ? '9600' : spec.baudrate).trim();
        if (!/^\d+$/.test(spec.baudrate)) throw new Error('Baud rate must be a number, not "' + spec.baudrate + '"');
        spec.parity = normaliseParity(spec.parity);
        spec.databits = String(spec.databits == null ? '8' : spec.databits).trim();
        if (spec.databits !== '7' && spec.databits !== '8') throw new Error('Data bits must be 7 or 8, not "' + spec.databits + '"');
        spec.stopbits = String(spec.stopbits == null ? '1' : spec.stopbits).trim();
        if (spec.stopbits !== '1' && spec.stopbits !== '2') throw new Error('Stop bits must be 1 or 2, not "' + spec.stopbits + '"');
        // The binary answers "Invalid reference parameter!" below 1; say so here
        // rather than spending a round trip to be told.
        if (printedRef(spec) < 1) throw new Error('Start reference must be 1 or higher — modpoll counts from 1');
        // A format suffix only exists for the register tables.
        if (spec.format && spec.table !== '3' && spec.table !== '4') spec.format = '';
        return spec;
    }

    // The register a block starts at, expressed the way modpoll wants it (1-based).
    function printedRef(spec) {
        return spec.base === 'protocol' ? spec.start + 1 : spec.start;
    }

    function buildCommand(spec, overrides) {
        const s = Object.assign({}, spec, overrides || {});
        const fmt = formatOf(s.format);
        const args = [exePath];
        // -1 first, not last. Without it modpoll polls every second forever, and a
        // command line that gets cut short on its way through the shell would
        // otherwise leave a process flooding the terminal for everyone — which is
        // exactly what happened once on plant 2313. Truncation now costs the host
        // argument instead, and modpoll simply refuses to start.
        args.push('-1');
        const mode = ['tcp', 'enc', 'ascii', 'rtu'].indexOf(s.mode) >= 0 ? s.mode : 'rtu';
        args.push('-m', mode);
        args.push('-a', String(s.slave));
        args.push('-t', String(s.table) + (fmt.value ? ':' + fmt.value : ''));
        if (s.bigEndian && fmt.endianFlag) args.push(fmt.endianFlag);
        args.push('-r', String(overrides && overrides.ref !== undefined ? overrides.ref : printedRef(s)));
        args.push('-c', String(Math.min(MAX_COUNT, s.count)));
        if (!isSerialMode(mode)) {
            // Over a network -p is the TCP port. Emitted only when it is not the
            // default, so the common case keeps the command shape known to work on
            // the plants; a serial gateway almost always needs it.
            if (Number(s.port) && Number(s.port) !== 502) args.push('-p', String(s.port));
        } else {
            args.push('-b', String(s.baudrate));
            args.push('-d', String(s.databits));
            args.push('-s', String(s.stopbits));
            args.push('-p', String(s.parity));
        }
        args.push(isSerialMode(mode) ? serialPortArg(s.host) : s.host);
        return args.join(' ');
    }

    /**
     * -c counts values, not registers, and a 32-bit format spends two registers
     * per value — so the next block starts count * step references along.
     */
    function planBlocks(spec) {
        const step = formatOf(spec.format).step;
        const blocks = [];
        let remaining = spec.count;
        let ref = printedRef(spec);
        while (remaining > 0) {
            const count = Math.min(MAX_COUNT, remaining);
            blocks.push({ ref, count });
            ref += count * step;
            remaining -= count;
        }
        return blocks;
    }

    // ------------------------------------------------------- output parsing

    // Decimal, float (the 32-bit formats print six decimals) or the hex format's
    // 0xABCD. Anything else on a value line is left unparsed rather than guessed at.
    const RE_VALUE = /^\s*\[(\d+)\]\s*:\s*(0x[0-9a-fA-F]+|-?[0-9]+(?:\.[0-9]+)?)\s*$/;

    // Patterns worth surfacing. Everything else modpoll prints (banner, copyright,
    // the configuration echo) is noise that would only cost the reader context.
    const DIAGNOSTICS = [
        // A held port. On a plant that is nearly always the Plant Server, which polls
        // the bus continuously. Freeing it means stopping the Plant Server, which
        // also stops temperature logging and alarms — the operator's call, never
        // the tool's.
        { re: /serial port already open/i, level: 'fatal', text: 'Serial port already open — another process holds the COM port, usually the Plant Server (stopping it stops logging and alarms)' },
        // Not a held port: the name did not open. Measured on plant 3694: bare COM16
        // and COM17 gave this, \\.\COM16 gave "already open" while a driver held it.
        { re: /port or socket open error/i, level: 'fatal', text: 'Port or socket open error — on a COM port the name did not open: the port does not exist on this machine, or it is above COM9 and was not written \\\\.\\COMn (a port the Plant Server holds says "Serial port already open" instead); on TCP, check the address' },
        { re: /can'?t reach slave/i, level: 'fatal', text: "Can't reach slave — check the IP address" },
        { re: /invalid count parameter/i, level: 'fatal', text: 'Invalid count parameter — the count cap is 99, not 100' },
        { re: /invalid reference parameter/i, level: 'fatal', text: 'Invalid reference parameter — -r counts from 1, and stops at 65536' },
        // Both spellings are the binary's own: it prints "Unknwon" and "Progam".
        { re: /unkn[wo]{2}n error/i, level: 'error', text: 'Unknown error — on TCP this is usually a slave address the gateway does not serve' },
        { re: /unrecognized option|missing option parameter/i, level: 'fatal', text: 'Unrecognized option — this build does not take that flag' },
        { re: /send time-?out/i, level: 'error', text: 'Send time-out' },
        { re: /time-?out|timeout/i, level: 'error', text: 'No response from device (timeout)' },
        { re: /checksum error/i, level: 'error', text: 'Checksum error — data corruption on the bus' },
        { re: /illegal function exception/i, level: 'warn', text: 'Illegal function exception — device answered, but not for this function' },
        { re: /illegal data address exception/i, level: 'warn', text: 'Illegal data address exception — device answered, register is outside its map' },
        { re: /illegal data value exception/i, level: 'warn', text: 'Illegal data value exception — device answered' },
        { re: /is not recognized as an internal or external command|cannot find the path/i, level: 'fatal', text: 'modpoll not found — neither on the PATH nor at ' + EXE_FULL },
    ];

    // What modpoll prints on every run and nobody needs to read.
    // Banner noise, plus this console's own marks: the run tag, and the tail of a
    // command line the terminal wrapped onto a second row — which is an echo of
    // what was sent, not something the device said.
    const RE_BANNER = new RegExp('^\\s*(modpoll\\s|Copyright|Getopt|Protocol configuration|Slave configuration|' +
        'Serial port configuration|TCP/IP configuration|Data type|Protocol opened|Polling slave|--|C:\\\\|&\\s|' +
        MARK + '|\\s*$)', 'i');

    function parseModpoll(raw) {
        const lines = String(raw || '').split(/\r?\n/);
        const values = [];
        const diagnostics = [];
        // Anything that is neither a value, a known error nor banner noise. When a
        // poll comes back empty these are the only clue there is, so they are kept
        // rather than dropped.
        const notes = [];
        let fatal = false;
        for (const line of lines) {
            if (line.trim().indexOf(MARK) === 0) continue;   // chain separator
            const m = line.match(RE_VALUE);
            if (m) {
                const printed = Number(m[1]);
                const raw = m[2];
                const value = /^0x/i.test(raw) ? parseInt(raw, 16) : Number(raw);
                values.push({ i: printed, addr: printed - 1, v: value });
                continue;
            }
            let matched = false;
            for (const d of DIAGNOSTICS) {
                if (d.re.test(line)) {
                    if (!diagnostics.some(x => x.text === d.text)) diagnostics.push({ level: d.level, text: d.text, line: line.trim() });
                    if (d.level === 'fatal') fatal = true;
                    matched = true;
                    break;
                }
            }
            if (!matched && line.trim() && !RE_BANNER.test(line) && notes.indexOf(line.trim()) < 0) notes.push(line.trim());
        }
        return { values, diagnostics, notes, fatal };
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

    const termState = { win: null, t: null, outEl: null, busy: false };

    /*
     * Reading the shell is not what jQuery Terminal's API suggests. get_output()
     * returns only what the terminal itself echoed — on Plant Term that is the two
     * connect lines and nothing else, 56 characters that never contain a command's
     * result or the prompt. Everything the shell sends is rendered as one div per
     * line inside #my_top .terminal-output, so that element is the transcript and
     * its child count is the cursor into it.
     */
    function terminalOf(win) {
        const jq = win.jQuery || win.$;
        if (!jq) return null;
        try {
            const $el = jq('#my_top');
            let t = null;
            if ($el && $el.length) {
                // Never construct a terminal here: calling .terminal() on an element
                // that has none would create an interpreter-less one and break the page.
                t = $el.data('terminal') || null;
            }
            if (!t && jq.terminal && typeof jq.terminal.active === 'function') t = jq.terminal.active() || null;
            if (!t) return null;
            const outEl = win.document.querySelector('#my_top .terminal-output');
            if (!outEl) return null;
            return { t, outEl };
        } catch (e) { /* frame not ready yet */ }
        return null;
    }

    function isConnected(t) {
        try { return /plant_term>/i.test(String(t.get_prompt() || '')); } catch (e) { return false; }
    }

    async function ensureTerminal() {
        if (termState.t && termState.outEl && termState.outEl.isConnected) {
            try { termState.t.get_prompt(); return termState; } catch (e) { termState.t = null; }
        }
        const w2 = pageWin.w2ui;
        if (!w2 || !w2.sidebar) throw new Error('sys_tools sidebar not ready — let the page finish loading');

        // The shell creates every tool's iframe up front, parked at about:blank, and
        // navigates it only when that tool is opened. Testing for the element is
        // therefore not a test for a loaded Plant Term: point the frame at it
        // directly, which also leaves the main panel on this console.
        let ifr = document.getElementById(IFRAME_ID);
        if (!ifr && typeof pageWin.my_do_action === 'function') pageWin.my_do_action('plant_term');
        ifr = await waitFor(() => document.getElementById(IFRAME_ID), 10000, 'the Plant Term iframe');
        if (!ifr.src || /about:blank/i.test(ifr.src)) ifr.src = PLANT_TERM_URL;

        const win = await waitFor(() => {
            const w = ifr.contentWindow;
            return (w && (w.jQuery || w.$)) ? w : null;
        }, 25000, 'Plant Term to load');
        const parts = await waitFor(() => terminalOf(win), 20000, 'the Plant Term shell');
        termState.win = win;
        termState.t = parts.t;
        termState.outEl = parts.outEl;
        await connectShell(parts.t);
        return termState;
    }

    /**
     * Throw the session away and take a fresh one. The frame is sent back to
     * about:blank first, because pointing it at the same URL it already holds
     * does not always reload it.
     */
    async function reconnectTerminal() {
        const ifr = document.getElementById(IFRAME_ID);
        termState.t = null;
        termState.outEl = null;
        if (ifr) {
            ifr.src = 'about:blank';
            await sleep(400);
            ifr.src = PLANT_TERM_URL;
        }
        await sleep(600);
        return ensureTerminal();
    }

    async function connectShell(t) {
        if (isConnected(t)) return;
        t.exec('');   // the page's own "Press enter to connect"
        try {
            await waitFor(() => isConnected(t) || null, 20000, 'Plant Term to connect');
        } catch (e) {
            throw new Error('Plant Term did not reach a prompt. This is usually the HTTP login for ' +
                location.hostname + '/secure/ having expired — open the plant in a normal tab, log in once, then retry.');
        }
    }

    /**
     * Run one command and return only the lines it printed. The transcript is read
     * by child index rather than by string length, so nothing has to be cleared
     * between runs and a line rewritten in place cannot shift the cursor.
     *
     * A remote shell gives no completion signal, so a command counts as finished
     * when its output has stopped growing for settleMs. modpoll answers in well
     * under a second; the default leaves room for a slow bus without making every
     * block wait on the timeout.
     */
    // Lines that mean this command is over: a device exception, a rejected
    // argument, or the process reporting its exit ("Progam" is the binary's typo).
    const RE_FINAL_ERROR = /exception response|unkn[wo]{2}n error|invalid \w+ parameter|unrecognized option|prog(r)?am stopped with exit code/i;
    const RE_NOT_FOUND = /is not recognized as an internal or external command|cannot find the path/i;
    const countValueLines = text => (String(text).match(/\[\d+\]\s*:/g) || []).length;
    // Refusals as they land, for progress: each is a block the device has just
    // spent ~630 ms saying no to, which is exactly the stretch a bar goes still.
    const countRefusalLines = text => (String(text).match(/exception response/gi) || []).length;
    // Probe markers, whole lines only — the echoed command line carries every
    // marker of a chained run at once, and must not count as any of them.
    const countMarkerLines = text => (String(text).match(new RegExp('^\\s*' + MARK + ':\\d+:\\d+\\s*$', 'gm')) || []).length;
    let runCounter = 0;

    /*
     * What a scan costs, counted where every command passes: one entry per
     * command line sent to Plant Term, with how many modpoll runs it held, how
     * long it took and how it ended. Null except while something measures —
     * a scan starts it and hangs the totals on its report as `cost`, which is
     * how a reader can tell a slow device (refusals at a second or more each)
     * from a slow shell, and what an optimisation actually saved.
     */
    let costLedger = null;

    function startCostLedger() {
        costLedger = {
            startedAt: new Date().toISOString(), commandLines: 0, modpollRuns: 0, ms: 0, valuesRead: 0,
            exceptions: 0, timeouts: 0, portErrors: 0, otherErrors: 0, slowestLineMs: 0,
        };
        return costLedger;
    }

    function finishCostLedger() {
        const l = costLedger;
        costLedger = null;
        if (!l) return null;
        l.ms = Math.round(l.ms);
        l.slowestLineMs = Math.round(l.slowestLineMs);
        l.msPerModpollRun = l.modpollRuns ? Math.round(l.ms / l.modpollRuns) : null;
        return l;
    }

    function recordCost(ledger, command, output, ms) {
        const text = String(output || '');
        const count = re => (text.match(re) || []).length;
        ledger.commandLines++;
        ledger.modpollRuns += (String(command).match(/modpoll(\.exe)?\s+-/gi) || []).length;
        ledger.ms += ms;
        ledger.slowestLineMs = Math.max(ledger.slowestLineMs, ms);
        ledger.valuesRead += countValueLines(text);
        ledger.exceptions += count(/exception response/gi);
        ledger.timeouts += count(/time-?out/gi);
        ledger.portErrors += count(/Port or socket open error|Serial port already open/gi);
        ledger.otherErrors += count(/Unkn[wo]{2}n error|Can'?t reach slave|CRC|Invalid frame|checksum/gi);
    }

    async function termRun(command, opts) {
        const started = performance.now();
        let output;
        try {
            output = await termRunInner(command, opts);
            return output;
        } finally {
            if (costLedger) recordCost(costLedger, command, output, performance.now() - started);
        }
    }

    async function termRunInner(command, opts) {
        const options = Object.assign({ timeoutMs: 25000, settleMs: 300 }, opts || {});
        // modpoll writes its errors to stderr at once and flushes its banner only
        // when the process exits, so a run that stops at the first error line has
        // the truth but not the whole of it. A command run as typed is read for
        // what it printed, not only for its values, and waits for all of it.
        if (options.fullOutput) options.settleMs = Math.max(options.settleMs, 1500);
        const state = await ensureTerminal();
        const outEl = state.outEl;
        // The terminal renders every space as a non-breaking one, so innerText hands
        // back U+00A0. Left alone, no pattern containing a space can match, and a
        // device answering "Illegal Data Address exception response!" reads as a
        // silent empty result instead of an answer. Split/join rather than a regex,
        // so the character is stated once and cannot be mangled by an editor.
        const NBSP = String.fromCharCode(160);
        const clean = text => String(text).split(NBSP).join(' ').split('\r').join('');

        /*
         * Where this run's output starts has to be marked in the transcript
         * itself. Anchoring on the element that was last before the command
         * fails once jQuery Terminal trims its oldest lines — the anchor is gone,
         * and reading "everything" then returns values from earlier commands as
         * if they were this command's answer. Echoing a tag unique to this run
         * and reading after its last occurrence cannot be confused that way.
         */
        const runTag = MARK + ':r' + (++runCounter);
        const readAll = () => {
            const parts = [];
            let node = outEl.firstElementChild;
            while (node) { parts.push(node.innerText); node = node.nextElementSibling; }
            return clean(parts.join('\n'));
        };

        /*
         * Output is accumulated as it arrives, not read once at the end. A long
         * chained run prints more lines than the terminal keeps, so by the time
         * it finishes its first block may already have scrolled out of the
         * buffer — and on a plant that is exactly the sweep worth doing. Lines
         * are collected on every poll and deduplicated, so trimming costs
         * nothing as long as a line survives one polling interval.
         */
        const before = new Set(readAll().split('\n').map(l => l.trim()).filter(Boolean));
        let collected = '';
        let previous = '';
        const absorbNewLines = text => {
            // Degraded path: keep whatever was not on screen when the run began.
            // Two commands in one run can legitimately print the same line, so
            // this is only used when growth can no longer be tracked.
            const kept = String(text).split('\n').filter(line => {
                const key = line.trim();
                return key && !before.has(key) && collected.indexOf(line) < 0;
            });
            if (kept.length) collected += (collected ? '\n' : '') + kept.join('\n');
        };
        const harvest = () => {
            const all = readAll();
            const at = all.lastIndexOf(runTag);
            if (at < 0) { absorbNewLines(all); return; }
            const chunk = all.slice(at + runTag.length);
            if (chunk.indexOf(previous) === 0) {
                // Normal path: the run's own output, still whole, has grown.
                collected += chunk.slice(previous.length);
            } else {
                absorbNewLines(chunk);
            }
            previous = chunk;
        };
        const readChunk = () => { harvest(); return collected; };

        state.t.exec('echo ' + runTag + ' & ' + command);
        const deadline = Date.now() + options.timeoutMs;
        let lastLength = -1;
        let stableSince = Date.now();
        let grew = false;
        // The run tag's own echo is not output. Counting it as output starts the
        // settle window before the device has said anything, which a TCP poll
        // survives — it answers inside the window — and a serial one does not:
        // 19200 baud with a second of turnaround looked like a command that
        // printed nothing at all.
        const deviceOutput = text => String(text).split('\n')
            .filter(line => line.trim() && line.trim().indexOf(MARK) !== 0).join('\n');
        let lastChunkLength = -1;
        while (Date.now() < deadline) {
            await sleep(60);
            const chunk = readChunk();
            const body = deviceOutput(chunk);
            if (body.length !== lastLength) { lastLength = body.length; stableSince = Date.now(); }
            if (body.length) grew = true;
            // Whoever is waiting can watch the output arrive. A chained line of
            // probes on a strict device is several refusals at ~630 ms each,
            // and the markers between them say which one the shell is on — a
            // caller showing progress gets that instead of one update per line.
            if (options.onOutput && chunk.length !== lastChunkLength) {
                lastChunkLength = chunk.length;
                try { options.onOutput(chunk); } catch (e) { /* a progress callback must not stop a poll */ }
            }
            // Knowing how many values were asked for turns the wait into a real
            // completion signal: a poll answers in about 130 ms, so waiting out a
            // settle window is most of what a block used to cost.
            if (options.expect && countValueLines(chunk) >= options.expect) { mirrorTerminal(chunk); return chunk; }
            // This plant does not resolve a bare "modpoll": say so once, take the
            // full path, and run the same command again.
            if (exePath === EXE_BARE && RE_NOT_FOUND.test(chunk)) {
                exePath = EXE_FULL;
                log('modpoll is not on this plant\'s PATH — using ' + EXE_FULL, 'warn');
                return termRunInner(command.split(EXE_BARE + ' ').join(EXE_FULL + ' '), options);
            }
            if (options.stopOnError !== false && !options.fullOutput && RE_FINAL_ERROR.test(chunk)) { mirrorTerminal(chunk); return chunk; }
            if (grew && Date.now() - stableSince > options.settleMs) { mirrorTerminal(chunk); return chunk; }
        }
        const chunk = readChunk();
        if (grew) { mirrorTerminal(chunk); return chunk; }
        // A shell that answers nothing at all is usually a dead session rather
        // than a slow device — the page keeps its prompt either way, so silence
        // is the only symptom. Reload the frame once and try again.
        if (options.reconnect !== false) {
            log('Plant Term answered nothing — reconnecting', 'warn');
            await reconnectTerminal();
            return termRunInner(command, Object.assign({}, options, { reconnect: false }));
        }
        throw new Error('Plant Term printed nothing within ' + Math.round(options.timeoutMs / 1000) +
            ' s of running the command, before and after reconnecting. Another session may be flooding it.');
    }

    // -------------------------------------------------------- polling engine

    let abortRequested = false;

    /**
     * Chained blocks are separated by echo markers, so an exception can be
     * attributed to the block that caused it rather than to the whole run.
     */
    function splitByMarker(raw) {
        const segments = [];
        let current = null;
        for (const rawLine of String(raw).split(/\r?\n/)) {
            const line = rawLine.trim();
            const mark = line.match(new RegExp('^' + MARK + ':(\\d+)$'));
            if (mark) { current = { ref: Number(mark[1]), lines: [] }; segments.push(current); continue; }
            if (current) current.lines.push(rawLine);
        }
        return segments.map(s => ({ ref: s.ref, text: s.lines.join('\n') }));
    }

    /** One command line for a set of blocks, each preceded by its marker. */
    function chainBlocks(spec, blocks) {
        const parts = [];
        for (const b of blocks) {
            const command = buildCommand(spec, { ref: b.ref, count: b.count });
            assertReadOnly(command);
            parts.push('echo ' + MARK + ':' + b.ref, command);
        }
        const line = parts.join(' & ');
        assertReadOnly(line);
        return line;
    }

    /**
     * How many of these blocks may share one command line, given both the segment
     * ceiling and the character budget.
     */
    function chainableCount(spec, blocks, limit) {
        const max = Math.min(limit || CHAIN_MAX, blocks.length);
        for (let n = max; n > 1; n--) {
            if (chainBlocks(spec, blocks.slice(0, n)).length <= CHAIN_CHARS) return n;
        }
        return 1;
    }

    async function readRegisters(input, onProgress) {
        const spec = normaliseSpec(input);
        const blocks = planBlocks(spec);
        const started = performance.now();
        const values = [];
        const diagnostics = [];
        const commands = [];
        let fatal = false;

        const step = formatOf(spec.format).step;
        const missingRuns = [];  // parts of a block that did not come back
        const unreadable = [];   // single references the device refuses
        const notes = [];        // anything printed that was neither a value nor a known error

        // What a block asked for, against what arrived. A gap can mean the device
        // refused the read or that the terminal dropped the line before it could
        // be collected; either way the answer is to ask again for the gap.
        const gapsOf = (block, have) => {
            const runs = [];
            let run = null;
            for (let n = 0; n < block.count; n++) {
                const ref = block.ref + n * step;
                if (have.has(ref)) { run = null; continue; }
                if (run && run.ref + run.count * step === ref) run.count++;
                else { run = { ref, count: 1 }; runs.push(run); }
            }
            return runs;
        };

        const mergeValues = list => {
            for (const v of list) {
                const at = values.findIndex(x => x.i === v.i);
                if (at >= 0) values[at] = v; else values.push(v);
            }
        };

        for (let bi = 0; bi < blocks.length && !fatal;) {
            if (abortRequested) { diagnostics.push({ level: 'warn', text: 'Stopped by user', line: '' }); break; }
            const group = blocks.slice(bi, bi + chainableCount(spec, blocks.slice(bi)));
            bi += group.length;
            let expect = 0;
            for (const b of group) {
                commands.push(buildCommand(spec, { ref: b.ref, count: b.count }));
                expect += b.count;
            }
            const line = chainBlocks(spec, group);
            const announced = {
                // bi has already moved past this group, so it is the count done.
                block: bi, blocks: blocks.length,
                command: group.length > 1
                    ? group.length + ' blocks in one run, -r ' + group[0].ref + ' to -r ' + group[group.length - 1].ref
                    : commands[commands.length - 1],
            };
            if (onProgress) onProgress(announced);
            let raw;
            try {
                // One error must not cut a chained run short: the later blocks in
                // the same line are still coming. While it runs, the same caller
                // hears what has arrived so far — marked partial, so it is
                // progress to show and not a new command to count.
                raw = await termRun(line, {
                    timeoutMs: spec.timeoutMs, expect, stopOnError: group.length === 1,
                    onOutput: onProgress ? chunk => onProgress(Object.assign({}, announced, {
                        partial: true, arriving: countValueLines(chunk), refusals: countRefusalLines(chunk),
                    })) : undefined,
                });
            } catch (e) {
                diagnostics.push({ level: 'fatal', text: e.message, line: '' });
                fatal = true;
                break;
            }
            const parsed = parseModpoll(raw);
            // Keyed by printed index: if the terminal trimmed its buffer mid-sweep,
            // a chunk can start earlier than its own block did, and no register may
            // appear twice in the result.
            mergeValues(parsed.values);
            for (const d of parsed.diagnostics) if (!diagnostics.some(x => x.text === d.text)) diagnostics.push(d);
            for (const note of parsed.notes) if (notes.indexOf(note) < 0 && notes.length < 6) notes.push(note);
            if (parsed.fatal) { fatal = true; break; }

            // Which references actually came back. Absence is the signal rather
            // than a nearby exception line: modpoll writes exceptions to stderr,
            // which the shell flushes ahead of the matching stdout, so an error
            // line cannot be tied to the command that produced it. Values can —
            // stdout is flushed when each process exits, in order.
            const have = new Set(parsed.values.map(v => v.i));
            for (const b of group) for (const gap of gapsOf(b, have)) missingRuns.push(gap);
        }

        /*
         * Ask again for whatever is missing. A gap that comes back on the second
         * attempt was a dropped line; a gap that stays empty is the device
         * refusing, and halving isolates which references it refuses. Modbus
         * refuses a read whole, so a single unmapped register otherwise costs its
         * entire 99-register block. Each refusal costs about half a second on the
         * wire, so the budget is a hard stop rather than a suggestion.
         */
        let budget = spec.recover === false ? 0 : 40;
        let queue = missingRuns.slice();
        while (queue.length && budget > 0 && !abortRequested && !fatal) {
            const attempt = queue.splice(0, chainableCount(spec, queue));
            budget -= attempt.length;
            const announced = { recovering: attempt.length, command: 're-asking for ' + attempt.length + ' gap(s)' };
            if (onProgress) onProgress(announced);
            let raw;
            try {
                raw = await termRun(chainBlocks(spec, attempt), {
                    timeoutMs: spec.timeoutMs, stopOnError: false,
                    onOutput: onProgress ? chunk => onProgress(Object.assign({}, announced, {
                        partial: true, arriving: countValueLines(chunk), refusals: countRefusalLines(chunk),
                    })) : undefined,
                });
            } catch (e) { diagnostics.push({ level: 'warn', text: 'Recovery stopped: ' + e.message, line: '' }); break; }
            const parsed = parseModpoll(raw);
            mergeValues(parsed.values);
            const have = new Set(parsed.values.map(v => v.i));
            for (const run of attempt) {
                const stillMissing = gapsOf(run, have);
                if (!stillMissing.length) continue;
                if (run.count === 1) { unreadable.push(run.ref); continue; }
                // Nothing at all came back: halve, so a single refused reference
                // inside the run can be found. Otherwise chase the gaps.
                if (stillMissing.length === 1 && stillMissing[0].count === run.count) {
                    const left = Math.floor(run.count / 2);
                    queue.push({ ref: run.ref, count: left }, { ref: run.ref + left * step, count: run.count - left });
                } else {
                    for (const gap of stillMissing) queue.push(gap);
                }
            }
        }
        if (unreadable.length) {
            diagnostics.push({
                level: 'warn',
                text: unreadable.length + ' reference' + (unreadable.length === 1 ? '' : 's') +
                    ' the device refuses: ' + unreadable.slice(0, 8).join(', ') +
                    (unreadable.length > 8 ? '…' : '') + ' (printed index)',
                line: '',
            });
        }
        if (queue.length && budget <= 0) {
            diagnostics.push({ level: 'warn', text: 'Gave up chasing missing references after 40 attempts', line: '' });
        }
        values.sort((a, b) => a.i - b.i);

        return {
            ok: values.length > 0 && !fatal,
            plant: plantIdFromHost(),
            at: new Date().toISOString(),
            spec: {
                mode: spec.mode, host: spec.host, port: spec.port, slave: spec.slave,
                table: spec.table, start: spec.start, count: spec.count, base: spec.base,
                format: spec.format || '16-bit', registersPerValue: formatOf(spec.format).step,
            },
            // Both numbers are carried per row: the index modpoll printed and the
            // protocol address it corresponds to. Everything downstream reads the
            // one it means rather than assuming.
            // Each reading carries whatever is known about it — name, unit, what
            // the plant shows, whether it is writable — so a caller reading the
            // JSON does not have to join it against anything.
            values: values.map(v => Object.assign({}, v, (() => {
                const named = enrichValue(v, spec.table, spec.format);
                const extra = {};
                if (named.name) { extra.name = named.name; extra.source = named.source; }
                if (named.unit) extra.unit = named.unit;
                if (named.shown !== '' && named.shown !== null) extra.shown = named.shown;
                if (named.type) extra.type = named.type;
                if (named.writable) extra.writable = true;
                return extra;
            })())),
            // References the device refuses outright, isolated by halving a
            // refused block. An empty list means nothing was refused.
            unreadable,
            // Kept for the case that matters most: a poll that returned nothing and
            // said nothing this code recognises.
            notes,
            summary: summarise(values, spec.count, performance.now() - started, blocks.length),
            diagnostics,
            commands,
        };
    }

    /**
     * Ask a list of references one register each, several per round trip, and say
     * for each whether the device answered. Chaining makes this cheap: thirteen
     * references came back in 2.5 s on a plant, where one round trip each would
     * have cost 14.
     */
    async function probeRefs(spec, probes, onProgress) {
        const results = {};
        // Each probe is a table and a reference, so one run can ask all four
        // tables at once instead of one table at a time — as many as fit inside
        // the character budget for a single command line.
        const list = probes.map(p => (typeof p === 'object' ? p : { table: spec.table, ref: p }));
        let answered = 0;
        for (let i = 0; i < list.length;) {
            if (onProgress) onProgress(i, list.length, { answered });
            const from = i;
            const parts = [];
            const group = [];
            while (i < list.length) {
                const probe = list[i];
                const segment = ['echo ' + MARK + ':' + probe.table + ':' + probe.ref,
                    buildCommand(Object.assign({}, spec, { table: probe.table }), { ref: probe.ref, count: 1 })];
                const wouldBe = parts.concat(segment).join(' & ').length;
                if (group.length && wouldBe > CHAIN_CHARS) break;
                parts.push(segment[0], segment[1]);
                group.push(probe);
                i++;
            }
            const line = parts.join(' & ');
            assertReadOnly(line);
            // The shell runs the line in order and each probe echoes its marker
            // before its modpoll starts, so the markers on screen say how many
            // of this line's probes are finished — one fewer than the markers —
            // and the value lines say how many of those answered. On a strict
            // device that is a tick every ~630 ms instead of one per line.
            let finished = -1;
            const watch = onProgress ? chunk => {
                const done = Math.max(0, Math.min(group.length, countMarkerLines(chunk) - 1));
                if (done === finished) return;
                finished = done;
                onProgress(from + done, list.length, { answered: answered + countValueLines(chunk), partial: true });
            } : undefined;
            let raw = await termRun(line, { timeoutMs: spec.timeoutMs, stopOnError: false, onOutput: watch });
            // Every probe echoes its own marker, so a missing marker means output
            // was lost rather than refused. One retry settles which it was.
            const markers = (raw.match(new RegExp(MARK + ':\\d+:\\d+', 'g')) || []).length;
            if (markers < group.length) raw = await termRun(line, { timeoutMs: spec.timeoutMs, stopOnError: false, onOutput: watch });
            let current = null;
            for (const rawLine of String(raw).split(/\r?\n/)) {
                const line2 = rawLine.trim();
                const mark = line2.match(new RegExp('^' + MARK + ':([\\d:]+)$'));
                if (mark) { current = mark[1]; results[current] = { answered: false }; continue; }
                if (current === null) continue;
                const value = line2.match(RE_VALUE);
                // Only a value counts as an answer. An error line's position in the
                // transcript says nothing about which probe produced it.
                if (value) results[current] = { answered: true, value: Number(value[2]) };
            }
            answered = Object.keys(results).filter(key => results[key].answered).length;
        }
        return results;
    }

    /*
     * Which references to ask first. Sparse, because every refusal costs about
     * 630 ms on the wire — but placed where maps actually begin: at 1, at the
     * round hundreds and thousands a document counts from, and one past each,
     * since "address 1000" in a document is reference 1001. The ladder this
     * replaces was six decades, and a map beginning at protocol address 1000 —
     * as common a start as there is — fell between 1000 and 10000 and was never
     * found. The bit tables get the short ladder; coil and discrete-input maps
     * sit low.
     */
    const SCAN_LADDER = [1, 2, 10, 100, 101, 200, 500, 1000, 1001, 2000, 2001, 3000, 4000, 4001, 5000, 8192, 10000, 10001, 20000, 32768, 40001];
    const SCAN_LADDER_BITS = [1, 2, 10, 100, 1000, 1001, 10000];
    const SCAN_TABLES = ['4', '3', '1', '0'];
    const scanLadderOf = table => (table === '0' || table === '1') ? SCAN_LADDER_BITS : SCAN_LADDER;

    /**
     * What does this device actually answer? Which of the four tables respond,
     * and where — as regions, because a map is often several areas with nothing
     * between them, and a sweep that starts at the lowest and stops at the first
     * stretch of nothing never reaches the second. A run of ladder probes that
     * answer is one region; the refused probe before it bounds the region from
     * below, and halving between the two finds the exact first readable
     * reference, where that region's sweep starts. A device that answers 0 for
     * an unmapped register and one that raises an exception both exist, so what
     * is reported is what was observed.
     */
    async function scanDevice(input, deep, onProgress) {
        // A new scan is a new action: a Stop that ended the last one must not end
        // this one before it starts.
        abortRequested = false;
        const spec = normaliseSpec(Object.assign({}, input, { count: 1, format: '' }));
        const started = performance.now();
        // Where the time went, phase by phase — the numbers any speed-up is
        // judged by, carried on the report as `phases`.
        const phases = [];
        let phaseAt = started;
        const mark = name => { const now = performance.now(); phases.push({ phase: name, ms: Math.round(now - phaseAt) }); phaseAt = now; };
        /*
         * Progress, as a fraction and a line of text. The ladder and the
         * narrowing are countable and take the first three tenths; the sweep is
         * not — it runs until a region's answers stop — so it takes most of the
         * rest, shared across the tables that answered, each table's share
         * advancing with every command and completing when its sweep ends; the
         * second read of what was found, which is countable again, takes the
         * last few hundredths. Every fraction is monotone, and none is 1 before
         * the scan is.
         */
        const SWEEP_FROM = 0.3, SWEEP_TO = 0.92;
        const tell = (fraction, text, extra) => { if (onProgress) onProgress(Object.assign({ fraction, text }, extra || {})); };
        const tableLabel = table => (REGISTER_TABLES.find(t => t.value === table) || {}).label || ('table ' + table);

        // One chained pass over every table and every rung of its ladder. Every
        // answer is kept, value and all: the sweep uses them to know a chunk is
        // not empty, and they are readings in their own right.
        const probes = [];
        for (const table of SCAN_TABLES) for (const ref of scanLadderOf(table)) probes.push({ table, ref });
        const first = await probeRefs(spec, probes, (done, total, info) =>
            tell(0.2 * (done / total), 'Probing reference ' + Math.min(done + 1, total) + ' of ' + total + ' across the four tables' +
                (info && info.answered ? ' — ' + info.answered + ' answering' : ''), { phase: 'probe' }));
        const answered = (table, ref) => !!((first[table + ':' + ref] || {}).answered);
        const known = {};
        for (const table of SCAN_TABLES) known[table] = new Map();
        const learn = results => {
            for (const key of Object.keys(results)) {
                if (!results[key].answered) continue;
                const [table, ref] = key.split(':');
                known[table].set(Number(ref), results[key].value);
            }
        };
        learn(first);
        mark('ladder');

        const regions = {};
        for (const table of SCAN_TABLES) {
            const ladder = scanLadderOf(table);
            regions[table] = [];
            let open = null;
            ladder.forEach((ref, i) => {
                if (answered(table, ref)) {
                    // Below reference 1 there is nothing, so the first rung has 0
                    // as its refused neighbour and settles at once.
                    if (!open) open = { low: i ? ladder[i - 1] : 0, high: ref, probes: [ref], until: null };
                    else open.probes.push(ref);
                } else if (open) {
                    open.until = ref;
                    regions[table].push(open);
                    open = null;
                }
            });
            if (open) regions[table].push(open);
        }

        // Narrow every region's lower edge together, one chained run per halving.
        // How many halvings that takes is known from the widest gap before the
        // first one is sent, so this phase can say how far along it is rather
        // than how many edges are left — which on a single edge was 0 % until
        // it was 100 %.
        const edges = [];
        for (const table of SCAN_TABLES) for (const region of regions[table]) edges.push({ table, region });
        const unsettled = () => edges.filter(e => e.region.high - e.region.low > 1);
        const widest = edges.reduce((m, e) => Math.max(m, e.region.high - e.region.low), 0);
        const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, widest))));
        let round = 0;
        while (unsettled().length && !abortRequested) {
            const step = unsettled().map(e => ({ table: e.table, ref: Math.floor((e.region.low + e.region.high) / 2), edge: e }));
            const say = (done, total) => tell(0.2 + 0.1 * Math.min(1, (round + done / Math.max(1, total)) / rounds),
                'Finding where each region starts — halving ' + Math.min(round + 1, rounds) + ' of about ' + rounds + ', ' +
                    step.length + ' edge' + (step.length === 1 ? '' : 's') + ' still to settle', { phase: 'narrow' });
            const probed = await probeRefs(spec, step.map(s => ({ table: s.table, ref: s.ref })), (done, total) => say(done, total));
            learn(probed);
            for (const s of step) {
                if ((probed[s.table + ':' + s.ref] || {}).answered) s.edge.region.high = s.ref; else s.edge.region.low = s.ref;
            }
            round++;
        }
        mark('narrow');

        const tables = {};
        for (const table of SCAN_TABLES) {
            const ladder = scanLadderOf(table);
            const rs = regions[table];
            const hits = ladder.filter(ref => answered(table, ref));
            const firstReadable = rs.length ? rs[0].high : null;
            tables[table] = {
                answers: rs.length > 0,
                firstReadable,
                // Stated in both bases, since that is the distinction this whole
                // tool exists to keep straight.
                firstReadableAddr: firstReadable === null ? null : firstReadable - 1,
                regions: rs.map(r => ({ from: r.high, fromAddr: r.high - 1, probesAnswering: r.probes, nextRefusedProbe: r.until })),
                sample: hits.slice(0, 3).map(ref => ref + '=' + first[table + ':' + ref].value),
                refused: ladder.filter(ref => first[table + ':' + ref] && !answered(table, ref)).slice(0, 6),
            };
        }
        const report = { host: spec.host, slave: spec.slave, at: new Date().toISOString(), tables };

        // Then read each region until its answers stop, so the scan ends with the
        // registers themselves rather than only where they start.
        if (deep) {
            report.sweep = {};
            report.values = [];
            const lowest = refs => refs.reduce((m, r) => (m === null || r < m ? r : m), null);
            const highest = refs => refs.reduce((m, r) => (m === null || r > m ? r : m), null);
            const sweeping = SCAN_TABLES.filter(table => tables[table].answers);
            // A chunk is not one round trip on a strict device, it is dozens —
            // chaseRun halves its way around every gap at ~630 ms a refusal, with
            // sweepForValues previously reporting back only once the whole chunk
            // was settled. That is what froze the bar for minutes. Ticking on
            // every command sweepForValues issues, not once it is done with a
            // chunk, is what makes it move the whole time instead — and inside
            // a command, on every value or refusal that lands.
            let commandsSoFar = 0;
            // Ticks, not chunks, are what "how much of this share is spent" is
            // measured in now; a strict chunk's dozens of ticks would have blown
            // past a chunk-scaled half-life in one step.
            const SWEEP_TICK_HALF_LIFE = 24;
            for (const table of SCAN_TABLES) {
                if (!tables[table].answers || abortRequested) continue;
                const total = { answered: 0, nonZero: 0, refs: [], withValues: [], regions: [], chunks: 0 };
                const seen = new Set();
                const share = (SWEEP_TO - SWEEP_FROM) / sweeping.length;
                const before = SWEEP_FROM + share * sweeping.indexOf(table);
                // Total work left in a table's sweep is unknowable until it stops
                // — so the share only ever creeps towards its end, asymptotically,
                // and is snapped to exactly once the table's last region actually
                // finishes (below), rather than trusting the creep to arrive there
                // on its own. A partial tick — output landing mid-command — moves
                // the text, not the count: it is the same command still running.
                let workSoFar = 0;
                const sweepTick = t => {
                    if (!t.partial) { commandsSoFar++; workSoFar++; }
                    const landing = t.partial && (t.arriving || t.refusals)
                        ? ' (' + (t.arriving ? '+' + t.arriving + ' arriving' : '') + (t.arriving && t.refusals ? ', ' : '') +
                            (t.refusals ? t.refusals + ' refused' : '') + ')'
                        : '';
                    tell(before + share * (workSoFar / (workSoFar + SWEEP_TICK_HALF_LIFE)),
                        'Sweeping ' + tableLabel(table) + ' near ' + t.ref + ' — ' + t.found + ' found' + landing + ', ' + commandsSoFar +
                            ' command' + (commandsSoFar === 1 ? '' : 's') + ' sent',
                        { phase: 'sweep', table, ref: t.ref, found: t.found, commands: commandsSoFar, chunkStart: !!t.chunkStart, partial: !!t.partial });
                };
                for (const region of regions[table]) {
                    if (abortRequested) break;
                    // A sweep that ran on through the next region found its start
                    // already — found, not merely passed over.
                    if (seen.has(region.high)) continue;
                    const swept = await sweepForValues(spec, table, region.high, known[table], sweepTick);
                    total.chunks += swept.chunks;
                    let inRegion = 0;
                    let nonZeroInRegion = 0;
                    for (const value of swept.values) {
                        if (seen.has(value.i)) continue;
                        seen.add(value.i);
                        inRegion++;
                        total.refs.push(value.i);
                        if (value.v !== 0) { nonZeroInRegion++; total.withValues.push(value.i); }
                        report.values.push(Object.assign({ table }, value));
                    }
                    total.answered += inRegion;
                    total.nonZero += nonZeroInRegion;
                    total.regions.push({
                        from: region.high, first: swept.first, last: swept.last, answered: inRegion, nonZero: nonZeroInRegion,
                        stoppedAt: swept.stoppedAt, stoppedBecause: swept.stoppedBecause,
                    });
                }
                report.sweep[table] = {
                    answered: total.answered, nonZero: total.nonZero,
                    first: lowest(total.refs), last: highest(total.refs),
                    ranges: asRanges(total.refs), withValues: asRanges(total.withValues),
                    // The same runs in the other base, since a modbusgen list
                    // prints protocol addresses and the reader will be writing one.
                    addrRanges: asRanges(total.refs.map(r => r - 1)), withValuesAddr: asRanges(total.withValues.map(r => r - 1)),
                    regions: total.regions, chunks: total.chunks,
                };
                // The table is actually done now, rather than merely close by
                // whatever the asymptote last happened to reach.
                tell(before + share, tableLabel(table) + ' swept — ' + total.answered + ' registers found', { phase: 'sweep', table });
            }
            mark('sweep');

            // Then everything found, once more. A register that reads
            // differently a minute later is being measured; one that reads the
            // same is a setpoint, a configuration word, or a measurement that
            // happened to hold still — and telling the two kinds apart is half
            // of what a reader deciding on a datatype and a scale needs. Cheap:
            // only what answered is asked, in its own runs, so nothing is refused.
            if (report.values.length && !abortRequested) {
                report.reread = await rereadFound(spec, report.values, (done, total, t) =>
                    tell(SWEEP_TO + 0.06 * (done / Math.max(1, total)),
                        'Reading every found register again — run ' + Math.min(done + 1, total) + ' of ' + total +
                            (t && t.changed ? ', ' + t.changed + ' changed so far' : ''),
                        { phase: 'reread', partial: !!(t && t.partial) }));
                report.reread.secondsAfterStart = Math.round((performance.now() - started) / 1000);
                mark('reread');
            }

            // Then judge what each region holds, prove the word order on the
            // wire where a region reads as floats, and say what the form
            // should poll — so Run, straight after this, gets the numbers out.
            report.formats = judgeFormats(report);
            const floatRegions = [];
            for (const table of Object.keys(report.formats)) {
                for (const r of report.formats[table].regions) if (r.format === 'float32') floatRegions.push({ table, verdict: r });
            }
            if (floatRegions.length && !abortRequested) {
                floatRegions.sort((a, b) => b.verdict.pairs.plausible - a.verdict.pairs.plausible);
                const best = floatRegions[0];
                const vals = new Map(report.values.filter(v => v.table === best.table).map(v => [v.i, v.v]));
                try {
                    report.modpoll = await checkWordOrderOnWire(spec, best.table, best.verdict, vals, bigEndian =>
                        tell(bigEndian ? 0.98 : 0.99, 'Reading ' + tableLabel(best.table) + ' from ' + best.verdict.alignStart + ' as floats ' +
                            (bigEndian ? 'with -f' : 'without -f') + ' to settle the word order', { phase: 'format' }));
                } catch (e) {
                    report.modpoll = { bigEndianFlag: null, measured: false, error: e.message };
                }
                if (report.modpoll && report.modpoll.matchedInOrder) {
                    best.verdict.confidence = 'wire';
                    best.verdict.evidence += '; a float read printed the same numbers';
                }
            }
            mark('format');
            report.suggestedSpec = suggestSpec(report);
        }
        report.elapsedMs = Math.round(performance.now() - started);
        report.phases = phases;
        // The connection exactly as this scan used it — the half of a
        // communication fault the device side can prove: these settings got
        // answers (or did not). The export sets them beside IWMAC's own.
        const serialScan = spec.mode === 'rtu' || spec.mode === 'ascii';
        report.spec = {
            mode: spec.mode, host: spec.host, port: serialScan ? null : spec.port, slave: spec.slave,
            baudrate: serialScan ? spec.baudrate : null, parity: serialScan ? spec.parity : null,
            databits: serialScan ? spec.databits : null, stopbits: serialScan ? spec.stopbits : null,
        };
        tell(1, abortRequested ? 'Scan stopped' : 'Scan complete', { phase: 'done' });
        return report;
    }

    /*
     * What an agent needs to improve a point list is not the grid and not the raw
     * JSON: it is every reading with its name, both address bases, what the plant
     * shows for it and what that implies about the scale — plus the shape of the
     * answer, which ranges answered, which were refused, where the zeros are.
     * Dense lines carry that in a fraction of the tokens a JSON array would, and
     * a header makes the block self-describing when it is pasted somewhere else.
     */
    function enrichValue(value, table, format) {
        const point = pointForReading(table, format, value.i);
        const fromPlant = point ? null : plantNamesFor(table, format, value.i);
        const entry = fromPlant && fromPlant[0];
        const scaled = point
            ? (point.scale.invert ? (value.v ? 0 : 1) : roundScaled(value.v * point.scale.factor, point.decimals))
            : null;
        return {
            ref: value.i,
            addr: value.addr,
            raw: value.v,
            name: point ? point.name : (entry ? entry.name : ''),
            unit: point ? (point.unit || '') : (entry ? entry.unit : ''),
            shown: scaled !== null ? scaled : (entry ? entry.plantValue : ''),
            type: point ? point.datatype : (entry ? 'plant:' + entry.group : ''),
            writable: point ? point.rw === 'rw' : !!(fromPlant && fromPlant.some(e => e.access === 'rw')),
            bits: fromPlant ? fromPlant.filter(e => e.bit !== null).length : 0,
            source: point ? 'list' : (entry ? 'plant' : ''),
        };
    }

    /** Runs of consecutive numbers as "430-445, 448". */
    function asRanges(numbers) {
        const sorted = [...new Set(numbers)].sort((a, b) => a - b);
        const parts = [];
        let start = null, previous = null;
        for (const n of sorted) {
            if (start === null) { start = previous = n; continue; }
            if (n === previous + 1) { previous = n; continue; }
            parts.push(start === previous ? String(start) : start + '-' + previous);
            start = previous = n;
        }
        if (start !== null) parts.push(start === previous ? String(start) : start + '-' + previous);
        return parts.join(',');
    }

    /*
     * Two 16-bit registers read as one 32-bit value, every way a driver could:
     * high word first — modbusgen's `_N`, modpoll's -i/-f — and low word first,
     * `_W`; as an IEEE float and as an integer, signed and unsigned. modpoll
     * printed each register on its own, so nothing here touches the wire: it
     * is the same bits, rearranged.
     */
    function decodePair(first, second) {
        const word = v => ((v < 0 ? v + 65536 : v) & 0xFFFF);
        const view = new DataView(new ArrayBuffer(4));
        const as = (hi, lo) => {
            view.setUint16(0, hi);
            view.setUint16(2, lo);
            return { float: view.getFloat32(0), int32: view.getInt32(0), uint32: view.getUint32(0) };
        };
        return { highFirst: as(word(first), word(second)), lowFirst: as(word(second), word(first)) };
    }

    /**
     * Is this float the kind a register holds? Finite, of a size an
     * engineering value has, and round at five significant digits — 21.5 or
     * 850 passes; two unrelated 16-bit registers read together give 1.2e-38 or
     * 3.4e+25, or a mantissa using every digit it has.
     */
    function plausibleFloat(x) {
        if (!Number.isFinite(x) || x === 0) return false;
        const size = Math.abs(x);
        if (size < 1e-3 || size >= 1e6) return false;
        return Math.abs(x - Number(x.toPrecision(5))) <= size * 2e-6;
    }

    function impliedScale(raw, shown) {
        const value = Number(String(shown).replace(',', '.'));
        if (!raw || Number.isNaN(value) || value === 0) return null;
        const ratio = value / raw;
        const common = [1000, 100, 10, 1, 0.5, 0.1, 0.01, 0.001];
        const near = common.find(k => Math.abs(ratio - k) <= Math.abs(k) * 0.02);
        return near ? 'x' + near : null;
    }

    /** How many decimals a displayed number states: "21,5" one, "850" none. */
    function decimalsOf(shown) {
        const m = String(shown == null ? '' : shown).trim().match(/[.,](\d+)$/);
        return m ? m[1].length : 0;
    }

    /**
     * What a register and its neighbour decode to as one 32-bit value, and how
     * far that can be trusted. Confirmed when the plant shows the number the
     * pair decodes to — the plant displays the register through its driver, so
     * the number it shows is the number the driver made of these bits — and a
     * candidate when only the bit pattern is plausible, floats only, since any
     * two words make some integer. Nothing when neither. A 16-bit reading the
     * plant's own scale already explains is not brought here at all: the
     * simplest reading that fits is the one to report.
     */
    function wideReading(raw, nextRaw, plantShown) {
        if (typeof raw !== 'number' || typeof nextRaw !== 'number') return null;
        const pair = decodePair(raw, nextRaw);
        const orders = [
            { wordOrder: 'high word first', suffix: '_N', d: pair.highFirst },
            { wordOrder: 'low word first', suffix: '_W', d: pair.lowFirst },
        ];
        const findings = [];
        const shownText = plantShown == null ? '' : String(plantShown).trim();
        const shown = Number(shownText.replace(',', '.'));
        if (shownText && !Number.isNaN(shown) && shown !== 0) {
            const tolerance = Math.max(Math.abs(shown) * 1e-4, 0.5 * Math.pow(10, -decimalsOf(shownText)));
            const u16 = raw < 0 ? raw + 65536 : raw;
            for (const o of orders) {
                if (Number.isFinite(o.d.float) && Math.abs(o.d.float - shown) <= tolerance) {
                    findings.push({ as: 'float32', wordOrder: o.wordOrder, suffix: o.suffix, value: roundScaled(o.d.float, decimalsOf(shownText) + 2), confirmed: 'the plant shows ' + shownText });
                }
                for (const [as, n] of [['int32', o.d.int32], ['uint32', o.d.uint32]]) {
                    // A 32-bit value equal to the register's own 16-bit reading
                    // is the neighbour being zero, not a 32-bit point.
                    if (n === raw || n === u16) continue;
                    const scale = impliedScale(n, shownText);
                    if (scale) findings.push({ as, wordOrder: o.wordOrder, suffix: o.suffix, value: n, scale, confirmed: 'the plant shows ' + shownText });
                }
            }
        }
        if (findings.length) return findings;
        for (const o of orders) {
            if (plausibleFloat(o.d.float)) findings.push({ as: 'float32', wordOrder: o.wordOrder, suffix: o.suffix, value: roundScaled(o.d.float, 4), candidate: true });
        }
        return findings.length ? findings : null;
    }

    // Engineering units the plant prints on an analog value. Energy (Wh, kWh)
    // is left out on purpose: it is a counter, integral. A unit outside this
    // list is not evidence either way; the scale and the decimals still are.
    const ANALOG_UNITS = new Set(['°c', 'c', '°f', 'f', 'k', 'deg', '°', 'bar', 'mbar', 'bar(g)', 'pa', 'kpa', 'mpa', 'psi', '%', '%rh', 'rh',
        'w', 'kw', 'mw', 'va', 'kva', 'mva', 'var', 'kvar', 'mvar', 'v', 'kv', 'mv', 'a', 'ma', 'ka', 'hz', 'ohm',
        'm3', 'm3/h', 'l/s', 'l/min', 'l/h', 'm/s', 'ppm', 'ppb', 'lux', 'kg', 'mm', 'm', 'meter', 'rpm', 'deci-celsius', 'percent']);

    /**
     * The one 32-bit reading to build a suggestion on, when several are
     * confirmed: a float over an integer, since an integer that happens to be
     * the plant's value at some scale is the weaker coincidence; and unsigned
     * over signed when both give the same number, since a value that has not
     * gone negative is a counter more often than not, and U32 holds twice as
     * much of one.
     */
    function pickWide(wide) {
        const confirmed = (wide || []).filter(w => w.confirmed);
        if (!confirmed.length) return null;
        const float = confirmed.find(w => w.as === 'float32');
        if (float) return float;
        const unsigned = confirmed.find(w => w.as === 'uint32' && confirmed.some(o => o.as === 'int32' && o.wordOrder === w.wordOrder && o.value === w.value));
        return unsigned || confirmed[0];
    }

    /** The scan's verdict for the region one register sits in, if the scan judged any. */
    function scanRegionAt(report, table, ref) {
        const regions = (report && report.formats && report.formats[table] && report.formats[table].regions) || [];
        return regions.find(r => ref >= r.from && ref <= r.to) || null;
    }

    /**
     * The point a modbusgen list would carry for this register, in the list's
     * own vocabulary — datatype key, scale key, unit, rw, group, addr — from
     * what the plant and the device have shown, with the basis of every choice
     * stated, since each one is an inference a reader may overrule. Only where
     * the plant has a parameter on the register: a value alone says nothing
     * about what it is.
     */
    function suggestPoint(table, addr, raw, fromPlant, wide, changed) {
        const first = fromPlant && fromPlant[0];
        if (!first) return null;
        const basis = [];
        const bits = fromPlant.filter(e => e.bit !== null);
        const rw = fromPlant.some(e => e.access === 'rw') ? 'rw' : 'r';
        const shownText = first.bit === null ? String(first.plantValue == null ? '' : first.plantValue).trim() : '';
        const shown = Number(shownText.replace(',', '.'));
        const hasShown = shownText !== '' && !Number.isNaN(shown);
        const unit = String(first.unit || '').trim();
        let datatype;
        let scale = '';
        if (table === '0') { datatype = 'Coil_X_N'; basis.push('a coil'); }
        else if (table === '1') { datatype = 'Digital_X_N'; basis.push('a discrete input'); }
        else {
            const family = table === '4' ? 'Hold' : 'Input';
            const confirmed = pickWide(wide);
            if (bits.length) {
                datatype = 'Bit_' + family;
                basis.push('the plant reads ' + bits.length + ' bit' + (bits.length === 1 ? '' : 's') + ' of this register — one point per bit, each with its bit');
            } else if (confirmed) {
                const rawType = confirmed.as === 'float32' ? 'F' : (confirmed.as === 'int32' ? 'I32' : 'U32');
                if (confirmed.scale && confirmed.scale !== 'x1') scale = confirmed.scale;
                // A float is analog by nature; a 32-bit integer is a counter
                // unless a scale or the unit says otherwise.
                const analog32 = confirmed.as === 'float32' || !!scale || ANALOG_UNITS.has(unit.toLowerCase());
                datatype = (analog32 ? 'A_' : 'I_') + family + '_' + rawType + confirmed.suffix;
                basis.push('protocol addresses ' + addr + ' and ' + (addr + 1) + ' read as ' + confirmed.as + ', ' + confirmed.wordOrder +
                    ', give ' + confirmed.value + (confirmed.scale ? ' (' + confirmed.scale + ')' : '') + ' — ' + confirmed.confirmed + '; one point at the lower address');
            } else {
                const implied = hasShown ? impliedScale(raw, shownText) : null;
                if (implied && implied !== 'x1') { scale = implied; basis.push('the plant shows ' + shownText + ' where the register holds ' + raw + ', so ' + implied); }
                else if (implied) basis.push('the plant shows the register unscaled');
                const unsigned = hasShown && shown > 32767 && raw < 0;
                const negative = raw < 0 || (hasShown && shown < 0);
                const width = unsigned ? 'U16' : 'I16';
                basis.push(unsigned ? 'the plant shows ' + shownText + ' where the register reads ' + raw + ' signed, so it is unsigned'
                    : (negative ? 'a negative value was seen, so signed' : 'no negative value seen; I16 also covers 0 to 32767 and is the safer default'));
                const analog = (implied && implied !== 'x1') || (hasShown && !Number.isInteger(shown)) || ANALOG_UNITS.has(unit.toLowerCase());
                datatype = (analog ? 'A_' : 'I_') + family + '_' + width + '_N';
                basis.push(analog
                    ? 'analog: ' + (implied && implied !== 'x1' ? 'scaled' : (hasShown && !Number.isInteger(shown) ? 'shown with decimals' : 'unit ' + unit))
                    : 'integral: a whole number with no scale' + (unit ? ', unit ' + unit : ''));
            }
        }
        if (changed) basis.push('the value changed between the sweep and the second read — being measured, not a setpoint');
        const out = { addr, datatype, rw, basis };
        if (bits.length) out.bits = bits.map(e => ({ bit: e.bit, name: e.name, rw: e.access }));
        else out.name = first.name;
        if (scale) out.scale = scale;
        if (unit) out.unit = unit;
        if (first.group) out.group = first.group;
        return out;
    }

    /**
     * One block of text describing a poll, meant to be read by whoever has to
     * decide what the point list should say.
     */
    function describeForAI(result, limit) {
        if (!result) return 'No poll has been run.';
        const spec = result.spec || {};
        const table = String(spec.table || '4');
        const format = spec.format === '16-bit' ? '' : (spec.format || '');
        const rows = result.values.map(v => enrichValue(v, table, format));
        const cap = limit || 250;
        const shown = rows.slice(0, cap);

        const tableName = (REGISTER_TABLES.find(t => t.value === table) || {}).title || ('table ' + table);
        const head = [
            'MODPOLL plant ' + (result.plant || '?') + ' ' + (spec.host || '?') +
                (spec.port && spec.port !== 502 ? ':' + spec.port : '') + ' slave ' + spec.slave +
                ' -t' + table + (format ? ':' + format : '') + '  ' + result.at,
            tableName + '. ref is what modpoll prints, addr is the protocol address, ref = addr + 1.' +
                (formatOf(format).step === 2 ? ' Each value spans two registers.' : ''),
            'raw is the register as read; shown is what the plant or the list makes of it.',
            'names: ' + (rows.some(r => r.source === 'list') ? 'point list' : (rows.some(r => r.source === 'plant') ? 'plant database' : 'none loaded')),
        ];

        const body = shown.map(r => {
            const bits = [
                r.ref, r.addr, r.raw,
                r.shown === '' || r.shown === null ? '-' : r.shown + (r.unit ? r.unit : ''),
                r.name || '-',
            ];
            const flags = [];
            if (r.writable) flags.push('rw');
            if (r.bits) flags.push(r.bits + 'bits');
            if (r.type) flags.push(r.type);
            const scale = impliedScale(r.raw, r.shown);
            if (scale && r.source === 'plant') flags.push('implies ' + scale);
            return bits.join(' ') + (flags.length ? '  [' + flags.join('|') + ']' : '');
        });

        const zeros = rows.filter(r => r.raw === 0).map(r => r.ref);
        const unnamed = rows.filter(r => !r.name).map(r => r.ref);
        const scales = {};
        for (const r of rows) {
            const scale = r.source === 'plant' ? impliedScale(r.raw, r.shown) : null;
            if (scale) scales[scale] = (scales[scale] || 0) + 1;
        }
        const tail = [
            'answered: ' + asRanges(rows.map(r => r.ref)) + ' (' + rows.length + ' of ' + (result.summary ? result.summary.requested : rows.length) + ')',
        ];
        if (result.unreadable && result.unreadable.length) tail.push('refused by the device: ' + asRanges(result.unreadable));
        if (zeros.length) tail.push('read zero: ' + asRanges(zeros));
        if (unnamed.length) tail.push('no name known: ' + asRanges(unnamed));
        if (Object.keys(scales).length) {
            tail.push('scales implied by the plant: ' +
                Object.keys(scales).map(k => k + ' on ' + scales[k] + ' point' + (scales[k] === 1 ? '' : 's')).join(', '));
        }
        for (const d of result.diagnostics || []) tail.push(d.level + ': ' + d.text);
        for (const command of (result.commands || []).slice(0, 3)) tail.push('cmd: ' + command);
        if (rows.length > shown.length) tail.push('(' + (rows.length - shown.length) + ' further rows not shown)');

        return head.join('\n') + '\n\n' + body.join('\n') + '\n\n' + tail.join('\n');
    }

    /**
     * Everything the console knows, as a document an agent can be handed cold —
     * what Save JSON writes.
     *
     * The reader is a Copilot agent asked to check or correct a modbusgen point
     * list, so every register carries every side of itself the console has:
     * what the device answered just now and what it answered the time before;
     * what the loaded list says it is; what IWMAC maps there and showed for it,
     * driver_id and all. The plant's parameters come whole — every one the unit
     * has, polled or not — because what the plant reads is the other half of
     * what a list has to match. The last verification comes with its offset
     * check. The last scan comes two ways: the shape of it — which tables
     * answered, the regions, the sweep summary — in `scan`, as before, and
     * every register it actually read in `scanReadings`, which used to be
     * thrown away entirely; a device only ever scanned, never polled, used to
     * export the shape of its map and none of its data, which is the one thing
     * this file exists to hand over. Where two sides of a register disagree,
     * the reading carries a note saying so: an observation for the reader to
     * judge, never a conclusion.
     *
     * Every reading — a poll's or a scan's — is enriched at save time, not
     * taken from the result as it was read: the names are often loaded after
     * the poll, and the grid re-reads them live while the raw result never
     * did. The conventions are spelled out inside the document, and
     * exportParts splits it into files under the knowledge-file ceiling, each
     * repeating the header so it stands alone.
     */
    function exportResult(result) {
        const spec = (result && result.spec) || {};
        const table = String(spec.table || '4');
        const format = spec.format === '16-bit' ? '' : (spec.format || '');
        const polledStep = formatOf(format).step;
        const wide = polledStep === 2;
        const tableLabel = t => (REGISTER_TABLES.find(x => x.value === String(t)) || {}).label || ('table ' + t);
        const asNumber = shown => Number(String(shown == null ? '' : shown).replace(',', '.'));

        // IWMAC's own view of the unit — its driver, how it defines each
        // parameter, its health — when it was collected for the last scan
        // (collectIwmacContext). Every comparison that needs it is skipped when
        // it was not, and the findings say which parts are missing.
        const iwCandidate = (typeof iwmacContext !== 'undefined' && iwmacContext) || (lastScan && lastScan.iwmac) || null;
        // Never another unit's: names loaded for a different unit since make it stale.
        const iw = iwCandidate && (!plantNames || iwCandidate.unitId === plantNames.unitId) ? iwCandidate : null;
        const defs = iw && iw.parameters ? iw.parameters.definitions : null;
        const logByDriverId = iw && iw.log ? (iw.log.byDriverId || {}) : {};

        // With the register's value in hand, a bit parameter also says what its
        // bit reads — the detail view counts that out, the file should too — and
        // every parameter says what IWMAC's own definition makes of the register.
        const plantRow = (e, raw, nextRaw, moving) => {
            const row = { name: e.name, shown: e.plantValue, unit: e.unit, group: e.group, access: e.access, driverId: e.driverId };
            if (e.bit !== null) {
                row.bit = e.bit;
                if (typeof raw === 'number') row.reads = ((raw < 0 ? raw + 65536 : raw) >> e.bit) & 1;
            }
            // The table defines a parameter by its short driver_id, 0_4_11; the
            // unit's parameters carry the whole one, plant, driver, table and
            // address first — and so does the driver's log.
            const def = defs ? (defs[shortDriverId(e.driverId)] || defs[e.driverId]) : null;
            if (def) row.iwmac = compareWithIwmac(def, e, raw, nextRaw, !!moving, logByDriverId[e.driverId]);
            else if (defs) row.iwmac = { defined: false };
            return row;
        };

        // Every 16-bit reading in hand, by table and reference, so a row can
        // see its neighbour: a 32-bit value is two of them, and the file is the
        // one place that can say which two.
        const rawAt = new Map();
        const scanAt = new Map();
        for (const v of (lastScan && lastScan.values ? lastScan.values : [])) { rawAt.set(v.table + '|' + v.i, v); scanAt.set(v.table + '|' + v.i, v); }
        if (result && !wide) for (const v of result.values) if (!rawAt.has(table + '|' + v.i)) rawAt.set(table + '|' + v.i, Object.assign({ table }, v));
        const nextRawOf = (t, ref) => { const n = rawAt.get(t + '|' + (ref + 1)); return n ? n.v : undefined; };

        // Why a register the plant reads was not among what the scan found —
        // each one an address for the reader to check.
        const scanStatusOf = (t, ref) => {
            if (!lastScan || !lastScan.tables) return undefined;
            const scanned = lastScan.tables[t];
            if (!scanned) return 'table not scanned';
            if (!scanned.answers) return 'the table gave no answer at all';
            const swept = lastScan.sweep && lastScan.sweep[t];
            if (!swept || swept.first === null) return 'the table was not swept';
            if (ref >= swept.first && ref <= swept.last) return 'no answer inside the swept map (' + swept.first + '-' + swept.last + ') — a hole, or the wrong address';
            return ref < swept.first ? 'below the first register the scan found, ' + swept.first : 'beyond the last register the scan found, ' + swept.last;
        };
        const listRow = p => {
            const row = {
                addr: p.addr, protocol: p.protocol, ref: p.ref, name: p.name, datatype: p.datatype,
                scale: p.scaleKey || '', unit: p.unit, decimals: p.decimals, rw: p.rw, group: p.group,
            };
            if (p.bit !== null) row.bit = p.bit;
            if (p.rangeMin !== null || p.rangeMax !== null) row.range = [p.rangeMin, p.rangeMax];
            if (p.decoded.ok) { row.table = p.decoded.table; row.format = p.decoded.format || '16-bit'; row.registers = p.decoded.step; }
            else row.notPolled = p.decoded.reason;
            return row;
        };

        // pointForReading matches the width of the poll on purpose, which is right
        // for naming a reading and wrong for noticing that the list and the poll
        // disagree about the width: a point declared 32-bit would be invisible to
        // a 16-bit poll, and so would the note saying so. This index is blind to
        // the width, and the notes read from it.
        const listedAt = new Map();
        for (const p of (pointList ? pointList.points : [])) {
            if (p.decoded.ok && !listedAt.has(p.decoded.table + '|' + p.ref)) listedAt.set(p.decoded.table + '|' + p.ref, p);
        }

        // Registers whose plant parameters ride on a reading — a poll's or a
        // scan's — so the whole-unit section can leave them out without the
        // unit losing them.
        const carried = new Set();

        /*
         * One reading, enriched exactly the way an agent needs it: what it is
         * named, what the list and the plant say, and where those disagree.
         * readings and scanReadings share this instead of each keeping their
         * own copy, because everything here generalises across a poll and a
         * scan cleanly except two things a poll has that a scan does not — one
         * fixed table and format for every row (`step`, in place of reading
         * the closed-over polledStep/wide directly), and the chance that it
         * has been read before (`withDelta`, watch mode's own bookkeeping).
         */
        const buildReadingRow = (v, rowTable, rowFormat, step, withDelta) => {
            const rowWide = step === 2;
            const point = pointForReading(rowTable, rowFormat, v.i);
            const listed = point || listedAt.get(rowTable + '|' + v.i) || null;
            const fromPlant = plantNamesFor(rowTable, rowFormat, v.i);
            if (fromPlant) carried.add(rowTable + '|' + v.i);
            const r = enrichValue(v, rowTable, rowFormat);
            const out = { ref: r.ref, addr: r.addr, raw: r.raw };
            // The number read every way, as the detail view shows it — only for a
            // value that is one register, since a 32-bit one is already decoded.
            if (!rowWide) {
                const u16 = r.raw < 0 ? r.raw + 65536 : r.raw;
                out.hex = '0x' + u16.toString(16).toUpperCase().padStart(4, '0');
                if (r.raw > 32767) out.int16 = r.raw - 65536;
            }
            // What it answered the time before, when it has been read twice —
            // only a poll takes part in watch mode's delta bookkeeping.
            if (withDelta) {
                const key = rowTable + '|' + rowFormat + '|' + v.i;
                if (watchDelta.has(key) && watchDelta.get(key) !== null) {
                    out.delta = watchDelta.get(key);
                    out.previous = roundScaled(r.raw - out.delta);
                }
            }
            if (r.name) { out.name = r.name; out.source = r.source; }
            if (r.unit) out.unit = r.unit;
            if (r.shown !== '' && r.shown !== null) out.shown = r.shown;
            if (r.type) out.type = r.type;
            if (r.writable) out.writable = true;
            if (listed) out.list = listRow(listed);
            if (fromPlant) out.plant = fromPlant.map(e => plantRow(e, r.raw, rowWide ? undefined : nextRawOf(rowTable, v.i), !!v.changed));
            const first = fromPlant && fromPlant[0];
            const implied = first && first.bit === null ? impliedScale(r.raw, first.plantValue) : null;
            if (implied) out.impliedScale = implied;
            // The register and its neighbour as one 32-bit value, where the
            // plant's own scale does not already explain the register — a
            // 16-bit reading that fits is the simplest reading, and wins.
            let wideFound = null;
            if (!rowWide && !implied) {
                wideFound = wideReading(r.raw, nextRawOf(rowTable, v.i), first && first.bit === null ? first.plantValue : null);
                if (wideFound) out.wide = wideFound;
            }
            // A scan reads everything it found a second time; what moved is
            // being measured. Only a scan row has this — a poll's second
            // reading is watch mode's, above.
            if (typeof v.again === 'number') {
                out.reread = v.again;
                if (v.changed) { out.changed = true; out.delta = roundScaled(v.again - v.v); }
            }
            const suggest = suggestPoint(rowTable, r.addr, r.raw, fromPlant, wideFound, !!v.changed);
            if (suggest) out.suggest = suggest;
            // The scan's verdict for the region this register sits in — and, for
            // a register with no plant parameter at the start of a pair in a
            // region the plant or the wire proved 32-bit, the datatype that
            // verdict alone implies. No name, no scale, no access: those need
            // the plant or the document.
            const region = withDelta ? null : scanRegionAt(lastScan, rowTable, v.i);
            if (region && region.format !== '16-bit') {
                out.regionFormat = region.format + (region.wordOrder ? ', ' + region.wordOrder : '') + ' (' + region.confidence + ')';
                const wideRegion = region.format === 'float32' || region.format === 'int32' || region.format === 'uint32';
                const aligned = (v.i - region.alignStart) % 2 === 0;
                if (!out.suggest && wideRegion && aligned && (region.confidence === 'wire' || region.confidence === 'plant')) {
                    const family = rowTable === '4' ? 'Hold' : 'Input';
                    const rawType = region.format === 'float32' ? 'F' : (region.format === 'int32' ? 'I32' : 'U32');
                    out.suggest = {
                        addr: r.addr,
                        datatype: (region.format === 'float32' ? 'A_' : 'I_') + family + '_' + rawType + (region.wordOrder === 'low word first' ? '_W' : '_N'),
                        basis: [
                            'region ' + region.from + '-' + region.to + ' reads as ' + region.format + ', ' + region.wordOrder + ' (' + region.confidence + '): ' + region.evidence,
                            'no plant parameter on this register — name, scale and access are not known from here',
                        ],
                    };
                }
            }

            // Where two sides disagree. Observations, not conclusions.
            const notes = [];
            const confirmedWide = pickWide(wideFound);
            if (confirmedWide) {
                notes.push('a 32-bit point: protocol addresses ' + r.addr + ' and ' + (r.addr + 1) + ' read as ' + confirmedWide.as + ', ' +
                    confirmedWide.wordOrder + ', give ' + confirmedWide.value + ' — ' + confirmedWide.confirmed);
                if (listed && listed.decoded.ok && listed.decoded.step !== 2) {
                    notes.push('the list declares ' + listed.datatype + ' (one register) where the plant\'s value fits a 32-bit ' + confirmedWide.as);
                }
            }
            if (listed && implied && listed.scale.known && ('x' + listed.scale.factor) !== implied) {
                notes.push('the list scales by x' + listed.scale.factor + ', the plant implies ' + implied);
            }
            if (listed && first && listed.unit && first.unit && listed.unit.trim().toLowerCase() !== first.unit.trim().toLowerCase()) {
                notes.push('the list says unit "' + listed.unit + '", the plant "' + first.unit + '"');
            }
            if (listed && !fromPlant && plantNames) {
                const elsewhere = REGISTER_TABLES.map(t => t.value).filter(t => t !== rowTable && plantNames.byRef.has(t + '||' + v.i));
                if (elsewhere.length) {
                    notes.push('the plant maps protocol address ' + r.addr + ' in ' + elsewhere.map(tableLabel).join(' and ') +
                        ', the list has it in ' + tableLabel(rowTable));
                }
            }
            if (listed && listed.decoded.step !== step) {
                notes.push((withDelta ? 'polled' : 'scanned') + ' as ' + (rowWide ? '32-bit' : '16-bit') + ', the list declares ' + listed.datatype +
                    (listed.decoded.step === 2 ? ' (two registers)' : ' (one register)'));
            }
            if (point && typeof out.shown === 'number') {
                if (point.rangeMin !== null && out.shown < point.rangeMin) notes.push('below the list range, ' + point.rangeMin);
                if (point.rangeMax !== null && out.shown > point.rangeMax) notes.push('above the list range, ' + point.rangeMax);
            }
            const plantNumber = first && first.bit === null ? asNumber(first.plantValue) : NaN;
            if (r.raw === 0 && !Number.isNaN(plantNumber) && plantNumber !== 0) {
                notes.push('reads 0 now; the plant showed ' + first.plantValue + ' when its names were read');
            }
            if (notes.length) out.notes = notes;
            return out;
        };

        const readings = (result ? result.values : []).map(v => buildReadingRow(v, table, format, polledStep, true));
        // A scan reading carries its own table — a scan crosses all four, a
        // poll never does — and is always one 16-bit register: scanDevice
        // reads a table one register at a time to find the map, never wide.
        const allScanRows = (lastScan && lastScan.values ? lastScan.values : []).map(v =>
            Object.assign({ table: v.table }, buildReadingRow(v, v.table, '', 1, false)));
        // A register that answered 0, that nothing names, that did not move and
        // that nothing else was said about is evidence of one thing — the address
        // answers — and a row each made a lenient device's file hundreds of
        // kilobytes of that. Such registers are listed as ranges in scanEmpty
        // instead; every other scanned register keeps its row.
        const informative = r => r.raw !== 0 || r.plant || r.list || r.changed || r.suggest || r.regionFormat || r.notes || r.wide;
        const scanReadings = allScanRows.filter(informative);
        const emptyByTable = {};
        for (const r of allScanRows) if (!informative(r)) (emptyByTable[r.table] = emptyByTable[r.table] || []).push(r.ref);
        const scanEmpty = Object.keys(emptyByTable).sort().map(t => ({ table: t, tableName: tableLabel(t), count: emptyByTable[t].length, ranges: asRanges(emptyByTable[t]) }));

        /*
         * A float's high word makes a candidate twice: high word first on its
         * own row, and low word first on the row below, where it is the high
         * word of that pair too. One high word, one candidate: where two
         * readings share it, the one the plant confirmed stands, and failing
         * that the rounder value — 21.5 over 21.5000038.
         */
        const byHighWord = new Map();
        for (const r of readings.concat(scanReadings)) {
            for (const w of (r.wide || [])) {
                const key = (r.table || table) + '|' + (w.wordOrder === 'high word first' ? r.ref : r.ref + 1);
                if (!byHighWord.has(key)) byHighWord.set(key, []);
                byHighWord.get(key).push({ row: r, w });
            }
        }
        for (const claims of byHighWord.values()) {
            if (claims.length < 2) continue;
            const keep = claims.slice().sort((a, b) => (!!b.w.confirmed - !!a.w.confirmed) || (String(a.w.value).length - String(b.w.value).length))[0];
            for (const c of claims) {
                if (c === keep || c.w.confirmed) continue;
                c.row.wide = c.row.wide.filter(w => w !== c.w);
                if (!c.row.wide.length) delete c.row.wide;
            }
        }
        const scales = {};
        for (const r of readings) if (r.impliedScale) scales[r.impliedScale] = (scales[r.impliedScale] || 0) + 1;

        // Every parameter IWMAC holds for the unit that is not already on a
        // readings or scanReadings row. Said once: with the poll or the scan
        // covering the unit, this is empty and the file is half the size it
        // would be saying everything twice.
        const plantParameters = [];
        if (plantNames) {
            for (const [key, entries] of plantNames.byRef) {
                const [t, , ref] = key.split('|');
                if (carried.has(t + '|' + ref)) continue;
                // After a scan, a parameter here is a register IWMAC reads that
                // the device did not answer for — say where it fell.
                const scan = scanStatusOf(t, Number(ref));
                for (const e of entries) {
                    const row = Object.assign({ table: t, ref: Number(ref), addr: e.protocol }, plantRow(e, undefined, undefined, false));
                    if (scan) row.scan = scan;
                    plantParameters.push(row);
                }
            }
            const bitOf = row => (row.bit === undefined ? -1 : row.bit);
            plantParameters.sort((a, b) => a.table.localeCompare(b.table) || a.ref - b.ref || bitOf(a) - bitOf(b));
        }
        const unitInfo = plantNames ? (_unitsCache || []).find(u => u.unit_id === plantNames.unitId) : null;
        const tableInfo = REGISTER_TABLES.find(t => t.value === table) || {};
        const verification = lastVerification;

        // device and summary read the last poll's spec and result — fine while
        // either exists, even a stale one next to a fresher scan, but with no
        // poll at all they used to say nothing and say it silently: every
        // device field null or defaulted (valueFormat '16-bit' as if one had
        // run), summary null, no hint that the document's only evidence is a
        // scan sitting a few keys down. readingSource names which it is;
        // host/slave fall back to the scan's own; table/format/command stay
        // null rather than claiming table 4 for a scan that covered all four.
        const readingSource = result ? 'poll' : (lastScan ? 'scan' : 'none');
        const device = result ? {
            host: spec.host || null, port: spec.port || null, slave: spec.slave || null, mode: spec.mode || null,
            table, tableName: tableInfo.title || null,
            valueFormat: format || '16-bit', registersPerValue: wide ? 2 : 1,
            command: spec.raw || null, readingSource,
        } : {
            host: (lastScan && lastScan.host) || null,
            port: (lastScan && lastScan.spec && lastScan.spec.port) || null,
            slave: (lastScan && lastScan.slave) || null,
            mode: (lastScan && lastScan.spec && lastScan.spec.mode) || null,
            table: null, tableName: null, valueFormat: null, registersPerValue: null, command: null, readingSource,
        };
        // summary's fields are a poll's own — requested, blocks, elapsedMs mean
        // nothing for a scan — so a scan does not get a fake one of those; it
        // gets its own, honestly labelled, rather than leaving a reader to
        // wonder why a document full of scanReadings has no summary at all.
        let summary = result ? result.summary : null;
        if (!result && lastScan && lastScan.values && lastScan.values.length) {
            const nums = lastScan.values.map(v => v.v);
            summary = {
                requested: null, returned: nums.length, nonZero: nums.filter(n => n !== 0).length,
                changed: lastScan.reread ? lastScan.reread.changed : null,
                min: Math.min.apply(null, nums), max: Math.max.apply(null, nums),
                blocks: null, elapsedMs: lastScan.elapsedMs || null, source: 'scan',
            };
        }
        // The loaded list against the scan: whether the device answered for
        // each point's register, and what it held — a verification's answer
        // without a verification, for whatever the sweep covered.
        const listWithScan = p => {
            const row = listRow(p);
            if (!lastScan || !p.decoded.ok) return row;
            const found = scanAt.get(p.decoded.table + '|' + p.ref);
            if (found) {
                row.scan = 'answered';
                row.scanRaw = found.v;
                if (typeof found.again === 'number' && found.changed) row.scanChanged = true;
            } else {
                row.scan = scanStatusOf(p.decoded.table, p.ref) || 'not scanned';
            }
            return row;
        };

        // The connection modpoll used beside the one IWMAC's driver is set to.
        const used = result ? {
            mode: spec.mode || null, host: spec.host || null, port: spec.mode === 'tcp' || spec.mode === 'enc' ? spec.port || 502 : null, slave: spec.slave || null,
            baudrate: spec.baudrate || null, parity: spec.parity || null, databits: spec.databits || null, stopbits: spec.stopbits || null,
        } : (lastScan && lastScan.spec) || null;
        const configured = iw && iw.driver ? iw.driver.connection || null : null;
        const comparison = compareConnections(used, configured);
        const deviceAnswered = readings.length > 0 || allScanRows.length > 0;
        const findings = buildFindings({
            iw, rows: readings.concat(scanReadings), plantParameters, comparison, scan: lastScan, names: plantNames, deviceAnswered,
        });
        const plantCompared = [];
        for (const r of readings.concat(scanReadings)) for (const p of (r.plant || [])) if (p.iwmac && p.iwmac.agrees !== undefined) plantCompared.push(p.iwmac.agrees);
        const count = sev => findings.filter(x => x.severity === sev).length;

        return {
            format: 'modpoll-console/export',
            version: VERSION,
            schemaVersion: 2,
            plant: (result && result.plant) || plantIdFromHost() || null,
            at: (result && result.at) || new Date().toISOString(),
            // Read these two first: what the evidence below adds up to.
            overview: {
                unit: plantNames ? {
                    id: plantNames.unitId,
                    name: unitInfo ? unitInfo.unit_name : (iw && iw.registration ? iw.registration.unitName : null),
                    driver: iw && iw.driver ? iw.driver.owner : (unitInfo ? unitInfo.driver_type : null),
                    table: iw && iw.registration ? iw.registration.table : (iw && iw.parameters ? iw.parameters.table : null),
                } : null,
                device: {
                    answeredModpoll: deviceAnswered,
                    connectionUsed: used,
                    registersAnswering: readings.length + allScanRows.length,
                    registersHoldingValues: readings.concat(allScanRows).filter(r => r.raw !== 0).length,
                    tablesAnswering: lastScan && lastScan.tables ? Object.keys(lastScan.tables).filter(t => lastScan.tables[t].answers).map(tableLabel) : null,
                },
                iwmac: plantNames ? {
                    parameters: plantNames.rows,
                    comparedWithDevice: plantCompared.length,
                    agree: plantCompared.filter(x => x === true).length,
                    disagree: plantCompared.filter(x => x === false).length,
                    withoutValue: plantCompared.filter(x => x === null).length,
                    notAnsweredByDevice: plantParameters.filter(p => p.scan && p.scan !== 'answered').length,
                    unitStatus: iw && iw.status ? iw.status.unitStatus : null,
                    driverRunning: iw && iw.driver && iw.driver.module ? iw.driver.module.running : null,
                    contextCollected: !!iw,
                } : null,
                findings: { errors: count('error'), warnings: count('warning'), info: count('info'), ids: findings.map(x => x.id) },
            },
            findings,
            howToUse: [
                'Start with overview and findings: findings are the problems the evidence shows, most serious first, each with what ' +
                    'proves it and a suggested action. Every other section is the evidence they are drawn from.',
                'communication sets the connection modpoll used (and got answers with, or not) beside the one IWMAC\'s driver is set ' +
                    'to, field by field. iwmac is IWMAC\'s own side of the unit: its registration and table, every driver setting, ' +
                    'whether the driver module runs, the unit\'s status and last contact, and the Plant Server log lines of its driver: ' +
                    'log.current counts only what came after the driver last started or this unit last came back online, and ' +
                    'log.otherUnits holds the lines of other units on the same driver, never counted against this one.',
                'plant[].iwmac on a reading row is one IWMAC parameter\'s own definition — datatype (raw type and swap: _W low word ' +
                    'first, _R bytes swapped), scale, format, access — and expected, what that definition makes of the register ' +
                    'modpoll just read. agrees compares expected with shown, the value IWMAC displayed. false on a register that did ' +
                    'not move is a definition reading the register differently from the device, or an old value; null means IWMAC ' +
                    'shows nothing for it.',
                'One device on one IWMAC plant read with modpoll, and everything the console knows about its registers, for an ' +
                    'agent checking or correcting a modbusgen point list.',
                'Five sections, one row per line: readings, scanReadings, plantParameters, listPoints, verificationRows. When ' +
                    'split into files named _partNofM for a knowledge set, each file repeats this header and carries one slice of ' +
                    'one section (part.section, part.rows, part.firstRef to part.lastRef), and part.contents maps every section to ' +
                    'its parts.',
                'readings: one register per line as the device answered just now, for a range someone asked for — a poll. ref is ' +
                    'what modpoll prints and what -r takes; addr is the protocol address, ref - 1; a modbusgen list prints addr, or ' +
                    'addr + 1 when options.subtract_one is true. previous and delta are the answer the time before. list is the ' +
                    'entry the loaded list has for the register; plant is every IWMAC parameter reading it, one per bit where ' +
                    'several share it; impliedScale is shown divided by raw when that is a common factor; notes are where two ' +
                    'sides disagree — the list, the plant, the device — and are leads, never conclusions.',
                'scanReadings: what Scan device found while it was discovering the map, not a range anyone chose — every register ' +
                    'between the first one a table answers and wherever the sweep stopped, table included since one scan crosses ' +
                    'all four. Enriched the same way as readings, minus previous/delta, which only a repeated poll has. A ' +
                    'scanReadings row is exactly as live an answer as a readings row — both are the device responding just now — ' +
                    'but it proves the same and no more: a value, nothing about a datatype or a scale by itself. Read its ' +
                    'impliedScale and notes with the same caution as a poll\'s.',
                'reread, changed and delta on a scanReadings row: the same register read again once the sweep was done ' +
                    '(scan.reread says how long after the scan began and how many moved). changed marks a value being measured; ' +
                    'unchanged is a setpoint, a configuration word, or a measurement that held still for that long.',
                'wide on a 16-bit row: the register and the next one decoded as one 32-bit value, high word first (modbusgen _N) ' +
                    'and low word first (_W), as a float and as an integer. confirmed names the plant value the pair decodes to; ' +
                    'candidate means only the bit pattern looks like a float. Nothing on the wire proves a width — this is the ' +
                    'same bits rearranged — so a candidate on its own is a lead to poll with -t 4:float, not a datatype.',
                'suggest: the point a modbusgen list would carry for a register the plant has a parameter on — datatype from the ' +
                    'shipped datatypes table, scale key, unit, rw, group, addr — with basis stating every inference behind it. ' +
                    'plant[].reads is the state of that bit in the register as read. Check suggest against the vendor document; ' +
                    'it is what the plant and the device showed, not what the device is.',
                'scan.formats: per table and region, whether it holds 16-bit or 32-bit values and in which word order — judged ' +
                    'from the bits (pattern), settled by the plant\'s displayed values (plant), or proved by a float read that ' +
                    'printed the same numbers (wire); mixed means both kinds, see each row\'s wide. scan.modpoll says what -f/-i ' +
                    'produce on this plant, measured. scan.suggestedSpec is the poll the console set the form to afterwards. ' +
                    'regionFormat on a row names its region\'s verdict; a suggest without a name comes from that verdict alone.',
                'plantParameters: every parameter IWMAC holds for this unit that is not already on a readings or scanReadings row; ' +
                    'those two sections plus this one are the whole unit. driverId ends in _0_<function>_<protocol address>[.<bit>]: ' +
                    'function 1 reads coils (table 0), 2 discrete inputs (table 1), 3 holding registers (table 4), 4 input ' +
                    'registers (table 3). shown is the value IWMAC displayed when its names were read (unit.namesReadAt), not now. ' +
                    'After a scan, scan on a row says why the device did not answer for that register — a hole inside the swept ' +
                    'map, below or beyond it, or a table that gave no answer — each one an address to check against the list.',
                'listPoints: the loaded modbusgen list as parsed, with the table and width each datatype decodes to. After a ' +
                    'scan, scan and scanRaw say whether the sweep found the point\'s register and what it held.',
                'verification and verificationRows: the last Verify list run. Per point: read, zero, refused (the device has no such ' +
                    'register), no answer, not polled (the datatype did not decode); the offset check scores whether the whole list ' +
                    'sits better a register or two along. Ranges anywhere are runs of ref, as "430-445,448".',
                'device.readingSource says what evidence this document actually rests on: "poll" when readings came from one just ' +
                    'now, "scan" when only scanReadings does, "none" when neither ran. summary.source says the same for summary ' +
                    'when it was built from a scan rather than a poll.',
                'scanEmpty: registers the scan found answering 0 with nothing else to say about them — no IWMAC parameter, no list ' +
                    'point, no change between the two reads — as ranges per table instead of one row each. They answer; they hold nothing.',
                'scan.spec is the connection the scan used, scan.phases how long each phase took, scan.cost what the commands cost: ' +
                    'modpoll runs, refusals (exceptions), timeouts and the time per run — a device slow to refuse makes a scan slow.',
            ],
            fieldGuide: {
                ref: 'the register as modpoll prints it and -r takes it: 1-based',
                addr: 'the protocol address, ref - 1: what a Modbus frame carries and what IWMAC\'s driver_id ends in',
                table: '4 holding registers (function 3), 3 input registers (function 4), 1 discrete inputs (function 2), 0 coils (function 1)',
                raw: 'the 16-bit value modpoll printed, signed; hex is the same bits',
                shown: 'the value IWMAC displayed for a parameter when the unit\'s parameters were read',
                'plant[].driverId': 'IWMAC\'s parameter id: <plant>_<driver>_<table>_<unit address>_0_<function>_<addr>[.<bit>]',
                'plant[].iwmac.expected': 'the register decoded with IWMAC\'s own datatype and scale for that parameter',
                'plant[].iwmac.agrees': 'expected against shown: true, false, or null when IWMAC shows nothing',
                'plant[].iwmac.onlineIndicator': 'IWMAC judges the unit online by this parameter (iw_set onl_ind): if its register does not answer, the unit goes OFFLINE',
                'iwmac.log.current': 'the driver log\'s counts since the driver last started or this unit last came back online — the present, not history',
                'list': 'the loaded modbusgen list\'s point for the register; its addr is ref when subtract_one is true, addr when false',
                suggest: 'the modbusgen point the device and IWMAC together suggest — a lead to check against the vendor document',
                'communication.comparison[].same': 'true when modpoll and IWMAC use the same value for that setting; null when one side is unknown',
            },
            communication: {
                usedByModpoll: used,
                configuredInIwmac: configured,
                comparison,
                note: configured ? 'modpoll\'s settings are the ones the device just answered (or did not) with; IWMAC\'s are its driver\'s.'
                    : 'IWMAC\'s driver settings were not read — see iwmac.unavailable.',
            },
            iwmac: iw ? {
                collectedAt: iw.collectedAt,
                registration: iw.registration || null,
                status: iw.status || null,
                system: plantNames && plantNames.system ? plantNames.system : null,
                driver: iw.driver ? {
                    owner: iw.driver.owner, connection: iw.driver.connection || null, process: iw.driver.process || null,
                    module: iw.driver.module || null, plantServerRunning: iw.driver.plantServerRunning === undefined ? null : iw.driver.plantServerRunning,
                    settings: iw.driver.settings || null,
                } : null,
                parameters: iw.parameters ? { table: iw.parameters.table, defined: iw.parameters.count || 0, inactive: iw.parameters.inactive || 0 } : null,
                bus: iw.bus || null,
                log: iw.log ? {
                    source: iw.log.source || null, owner: iw.log.owner, lines: iw.log.lines, from: iw.log.from, to: iw.log.to,
                    lastStart: iw.log.lastStart || null, counts: iw.log.counts, current: iw.log.current || null,
                    otherUnits: iw.log.otherUnits || null,
                    parametersWithErrors: Object.keys(iw.log.byDriverId || {}).length, recent: (iw.log.recent || []).slice(0, 25),
                } : null,
                unavailable: iw.unavailable || [],
            } : null,
            device,
            unit: plantNames ? Object.assign(
                { id: plantNames.unitId },
                unitInfo ? {
                    name: unitInfo.unit_name, driverType: unitInfo.driver_type, driverAddr: unitInfo.driver_addr,
                    connection: unitInfo.connection, host: unitInfo.host, slave: unitInfo.slave,
                } : {},
                { parameters: plantNames.rows, groups: plantNames.groups, undecodable: plantNames.undecodable, namesReadAt: plantNames.at }
            ) : null,
            // Both reading sections count: a device only ever scanned still has
            // names on its scanReadings rows, and saying 'none' over that would
            // be exactly the silently-describes-nothing failure this export
            // used to have.
            names: readings.concat(scanReadings).some(r => r.source === 'list') ? 'point list'
                : (readings.concat(scanReadings).some(r => r.source === 'plant') ? 'plant database' : 'none'),
            list: pointList ? {
                file: pointList.file || null, points: pointList.points.length, undecodable: pointList.undecodable,
                subtractOne: pointList.subtractOne, table: pointList.table || null, plant: pointList.plant || null, comm: pointList.comm || null,
            } : null,
            answered: {
                count: readings.length,
                requested: result && result.summary ? result.summary.requested : readings.length,
                ranges: asRanges(readings.map(r => r.ref)),
            },
            refused: asRanges((result && result.unreadable) || []),
            readZero: asRanges(readings.filter(r => r.raw === 0).map(r => r.ref)),
            unnamed: asRanges(readings.filter(r => !r.name).map(r => r.ref)),
            impliedScales: scales,
            summary,
            diagnostics: (result && result.diagnostics) || [],
            notes: (result && result.notes) || [],
            commands: (result && result.commands) || [],
            scan: lastScan ? {
                at: lastScan.at, host: lastScan.host, slave: lastScan.slave, elapsedMs: lastScan.elapsedMs || null,
                spec: lastScan.spec || null, phases: lastScan.phases || null, cost: lastScan.cost || null,
                tables: lastScan.tables, sweep: lastScan.sweep || null, reread: lastScan.reread || null,
                formats: lastScan.formats || null, modpoll: lastScan.modpoll || null, suggestedSpec: lastScan.suggestedSpec || null,
            } : null,
            scanEmpty,
            verification: verification ? {
                at: verification.at, device: verification.device, list: verification.list, summary: verification.summary,
                offsets: verification.offsets, offsetVerdict: verification.offsetVerdict, diagnostics: verification.diagnostics,
            } : null,
            readings,
            scanReadings,
            plantParameters,
            listPoints: pointList ? pointList.points.map(listWithScan) : [],
            verificationRows: verification ? verification.rows.map(row => {
                const p = row.point;
                const out = { addr: p.addr, ref: p.ref, name: p.name, datatype: p.datatype, status: row.status };
                if (row.raw !== undefined) out.raw = row.raw;
                if (row.scaled !== undefined) out.scaled = row.scaled;
                if (row.flags && row.flags.length) out.flags = row.flags;
                if (row.note) out.note = row.note;
                return out;
            }) : [],
        };
    }

    // ---------------------------------- the device against IWMAC's own setup

    // The kinds of driver log line that mean the driver did not get its answer.
    const LOG_TROUBLE = ['timeout', 'invalidResponse', 'exception', 'readError', 'offline', 'portFailed', 'tcpError'];

    /** A driver_id as the parameter table has it: 0_<function>_<address>[.<bit>], the unit's prefix dropped. */
    function shortDriverId(id) {
        const m = String(id == null ? '' : id).match(/(?:^|_)(0_\d+_\d+(?:\.\d+)?)$/);
        return m ? m[1] : String(id == null ? '' : id);
    }

    /** IWMAC's scale columns in words: '' (none), 'x0.1', or the linear map it stores. */
    function describeIwmacScale(scale) {
        if (!scale || scale.mode === '' || scale.mode === null || scale.mode === undefined || scale.mode === '0') return '';
        if (String(scale.mode) === '2') return 'driver factor 2';
        const rmin = Number(scale.rawMin), rmax = Number(scale.rawMax), emin = Number(scale.engMin), emax = Number(scale.engMax);
        if ([rmin, rmax, emin, emax].some(Number.isNaN) || rmax === rmin) return 'scale ' + scale.mode;
        if (rmin === 0 && emin === 0) return 'x' + roundScaled(emax / rmax, 8);
        return 'linear raw ' + rmin + '..' + rmax + ' -> ' + emin + '..' + emax;
    }

    /**
     * The register as IWMAC's own parameter definition reads it: its raw type,
     * its byte or word swap, its bit, its linear scale. What that gives is what
     * IWMAC should be showing for the value modpoll just read — so where the two
     * differ, either IWMAC's value is old, or IWMAC decodes the register
     * differently from how the device means it.
     */
    function decodeLikeIwmac(def, raw, nextRaw, bit) {
        if (!def || !def.datatype || !def.datatype.rawType) return { ok: false, why: 'no datatype in the definition' };
        if (typeof raw !== 'number') return { ok: false, why: 'no reading' };
        const u16 = x => (x < 0 ? x + 65536 : x) & 0xFFFF;
        const type = String(def.datatype.rawType).toUpperCase();
        const swap = String(def.datatype.swap || 'N').toUpperCase();
        let value;
        if (bit !== null && bit !== undefined) {
            value = (u16(raw) >> bit) & 1;
        } else if (type === 'I16' || type === 'U16') {
            let w = u16(raw);
            if (swap === 'R') w = ((w & 0xFF) << 8) | (w >> 8);
            value = type === 'I16' && w > 32767 ? w - 65536 : w;
        } else if (type === 'I32' || type === 'U32' || type === 'F') {
            if (typeof nextRaw !== 'number') return { ok: false, why: 'the next register was not read, and this is a 32-bit ' + type };
            const hi = swap === 'W' ? u16(nextRaw) : u16(raw);
            const lo = swap === 'W' ? u16(raw) : u16(nextRaw);
            const bits = ((hi << 16) >>> 0) + lo;
            if (type === 'U32') value = bits >>> 0;
            else if (type === 'I32') value = bits | 0;
            else {
                const view = new DataView(new ArrayBuffer(4));
                view.setUint32(0, bits >>> 0);
                value = view.getFloat32(0);
                if (!Number.isFinite(value)) return { ok: false, why: 'the two registers do not decode to a finite float', bits: '0x' + (bits >>> 0).toString(16).toUpperCase().padStart(8, '0') };
            }
        } else {
            return { ok: false, why: 'raw type ' + type + ' is not decoded here' };
        }
        const s = def.scale || {};
        if (String(s.mode) === '1') {
            const rmin = Number(s.rawMin), rmax = Number(s.rawMax), emin = Number(s.engMin), emax = Number(s.engMax);
            if (![rmin, rmax, emin, emax].some(Number.isNaN) && rmax !== rmin) value = emin + (value - rmin) * (emax - emin) / (rmax - rmin);
        } else if (String(s.mode) === '2') {
            return { ok: false, why: 'driver factor 2 is applied inside the driver' };
        }
        return { ok: true, value: roundScaled(value, 6) };
    }

    /** One IWMAC parameter's definition beside the register as read, compared. */
    function compareWithIwmac(def, entry, raw, nextRaw, moving, logEntry) {
        const dt = def.datatype || {};
        const out = {
            datatype: dt.rawType ? dt.rawType + (dt.swap && dt.swap !== 'N' ? '_' + dt.swap : '') : (def.datatypeText || null),
            scale: describeIwmacScale(def.scale), format: def.format || '', access: def.access || '',
        };
        if (dt.writeFunction) out.writeFunction = dt.writeFunction;
        if (def.active === false) out.active = false;
        if (def.onlineIndicator) out.onlineIndicator = true;
        if (def.updateFreq) out.updateFreq = def.updateFreq;
        if (def.alarmType) out.alarmType = def.alarmType;
        if (logEntry) out.logErrors = { count: logEntry.errors, kinds: logEntry.kinds, last: logEntry.last };
        if (typeof raw !== 'number') return out;
        const decoded = decodeLikeIwmac(def, raw, nextRaw, entry.bit);
        if (!decoded.ok) { out.expected = null; out.why = decoded.why; return out; }
        out.expected = decoded.value;
        const shownText = String(entry.plantValue == null ? '' : entry.plantValue).trim();
        const shownNumber = Number(shownText.replace(',', '.'));
        if (!shownText) {
            out.agrees = null;
            out.note = 'IWMAC shows no value — it has not received this parameter';
        } else if (Number.isNaN(shownNumber)) {
            out.note = 'IWMAC shows a word; ' + decoded.value + ' is the state it stands for';
        } else {
            const tolerance = Math.max(0.5 * Math.pow(10, -decimalsOf(shownText)), Math.abs(decoded.value) * 1e-6);
            out.agrees = Math.abs(shownNumber - decoded.value) <= tolerance + 1e-9;
            if (!out.agrees && moving) out.note = 'the register moved during the scan — a live value, so a difference is expected';
        }
        return out;
    }

    /** modpoll's connection beside IWMAC's driver, field by field. */
    function compareConnections(used, configured) {
        if (!used || !configured) return [];
        const bare = v => String(v == null ? '' : v).replace(/^\\\\\.\\/, '').trim().toLowerCase();
        const fields = configured.serial
            ? [['mode', used.mode, configured.mode], ['comPort', used.host, configured.comPort], ['slave', used.slave, configured.slave],
                ['baudrate', used.baudrate, configured.baudrate], ['parity', used.parity, configured.parity],
                ['databits', used.databits, configured.databits], ['stopbits', used.stopbits, configured.stopbits]]
            : [['mode', used.mode === 'enc' ? 'tcp' : used.mode, configured.mode], ['host', used.host, configured.host],
                ['port', used.port, configured.port], ['slave', used.slave, configured.slave]];
        return fields.map(([field, a, b]) => ({
            field, modpoll: a === undefined ? null : a, iwmac: b === undefined ? null : b,
            same: a === null || a === undefined || b === null || b === undefined ? null : bare(a) === bare(b),
        }));
    }

    /**
     * Problems the evidence shows, each stated once with what proves it and what
     * to do — the part of the file an agent should read first. Every finding is
     * an inference from the sections below it, and names them.
     */
    function buildFindings(input) {
        const f = [];
        const add = (severity, id, title, detail, evidence, action) => f.push({ id, severity, title, detail, evidence: evidence || {}, suggestedAction: action || '' });
        const { iw, rows, plantParameters, comparison, scan, names, deviceAnswered } = input;
        if (!names) {
            add('warning', 'unit-not-identified', 'No IWMAC unit matched this device',
                'The export has no IWMAC parameters, so nothing here compares the device with IWMAC.',
                {}, 'Pick the unit in the unit list, or check that host and slave match the unit\'s driver address, then scan again.');
        }
        if (iw && iw.unavailable && iw.unavailable.length) {
            add('info', 'iwmac-context-partial', 'Part of IWMAC\'s setup could not be read',
                'These parts are missing from iwmac and every comparison that needs them is skipped.', { unavailable: iw.unavailable },
                'Run the scan from the installed userscript with GM_xmlhttpRequest granted and the Toolbox reachable.');
        }
        if (iw && iw.driver && iw.driver.plantServerRunning === false) {
            add('info', 'plant-server-stopped', 'The Plant Server was stopped',
                'No driver polls while it is stopped, so IWMAC\'s values and status are from before the stop.', {},
                'Start the Plant Server before judging IWMAC\'s values.');
        } else if (iw && iw.driver && iw.driver.module && iw.driver.module.running === false) {
            add('error', 'driver-not-running', 'The unit\'s driver is not running',
                'Driver ' + iw.driver.owner + ' is not among the running Plant Server modules, so IWMAC polls nothing on this unit.',
                { module: iw.driver.module, process: iw.driver.process || null }, 'Check the driver\'s process registration and restart the Plant Server.');
        }
        const differ = (comparison || []).filter(c => c.same === false);
        if (differ.length && deviceAnswered) {
            add('error', 'connection-settings-differ', 'IWMAC\'s driver is not set up the way the device answered',
                differ.map(c => c.field + ': the device answered modpoll at ' + c.modpoll + ', IWMAC is set to ' + c.iwmac).join('; ') + '.',
                { differences: differ }, 'Change the driver setting to the value modpoll used, or confirm the device\'s own setting, then restart the Plant Server.');
        }
        if (iw && iw.bus) {
            const conflicts = (iw.bus.driversOnSamePort || []).filter(d => d.activeUnits > 0 && (d.mbMode === null || String(d.mbMode) === '0' || String(d.mbMode) === '1'));
            if (conflicts.length) {
                add('error', 'port-shared-by-drivers', 'Another driver is set to the same COM port',
                    'Only one process can hold a COM port, so one of these drivers cannot open it: ' + conflicts.map(d => d.owner + ' (' + d.activeUnits + ' active units)').join(', ') + '.',
                    { port: iw.driver && iw.driver.connection ? iw.driver.connection.comPort : null, drivers: conflicts },
                    'Put every unit on that bus under one driver, or move one driver to its own port.');
            }
            const seen = {};
            for (const u of (iw.bus.unitsOnDriver || []).filter(x => x.active)) (seen[u.driverAddr] = seen[u.driverAddr] || []).push(u.unitId);
            const dupes = Object.keys(seen).filter(k => seen[k].length > 1).map(k => ({ driverAddr: k, units: seen[k] }));
            if (dupes.length) {
                add('error', 'duplicate-unit-address', 'Two active units share one driver address',
                    dupes.map(d => d.units.join(' and ') + ' at ' + d.driverAddr).join('; ') + ' — both are polled at the same slave.',
                    { duplicates: dupes }, 'Deactivate the unit that is not installed, or correct its address.');
            }
        }
        const status = iw && iw.status ? iw.status.unitStatus : null;
        // Only what the log says since the driver last started, or since this
        // unit last came back online: an error from before either is history.
        const current = iw && iw.log ? (iw.log.current || { counts: iw.log.counts || {} }) : { counts: {} };
        const log = current.counts || {};
        const logTrouble = LOG_TROUBLE.filter(k => log[k]);
        const commErr = names && names.system ? names.system.find(s => /COM_ERR$/.test(s.driverId)) : null;
        const commErrOn = commErr && /^[1-9]/.test(String(commErr.shown || '').trim());
        const plantRows = [];
        for (const r of rows) for (const p of (r.plant || [])) plantRows.push({ r, p });
        const blank = plantRows.filter(x => String(x.p.shown == null ? '' : x.p.shown).trim() === '');
        const troubled = (status && status !== 'OK') || commErrOn || logTrouble.length > 0 ||
            (plantRows.length >= 5 && blank.length >= plantRows.length * 0.8);
        if (deviceAnswered && troubled && !(iw && iw.driver && iw.driver.plantServerRunning === false)) {
            add('error', 'iwmac-not-receiving', 'The device answers modpoll, but IWMAC\'s driver is not getting answers',
                'modpoll read the device during this scan, while IWMAC shows ' +
                    [status && status !== 'OK' ? 'unit status ' + status : '', commErrOn ? 'a communication error' : '',
                        logTrouble.length ? logTrouble.map(k => log[k] + ' ' + k).join(', ') + ' in the driver log since ' + (current.after || 'the log began') : '',
                        blank.length ? blank.length + ' of ' + plantRows.length + ' parameters without a value' : '']
                        .filter(Boolean).join(', ') + '.',
                { unitStatus: status, communicationError: commErr ? commErr.shown : null, log: current, blankParameters: blank.length, parameters: plantRows.length },
                'Compare communication.comparison first. If every setting matches, the difference is in how the driver talks: try its request timeout and packet_timeout, check whether another process or driver holds the port, and check the RS-485 adapter.');
        }
        const otherTrouble = iw && iw.log && iw.log.otherUnits ? Object.keys(iw.log.otherUnits).filter(u => LOG_TROUBLE.some(k => iw.log.otherUnits[u].kinds[k])) : [];
        if (otherTrouble.length) {
            add('info', 'other-units-failing', 'Other units on the same driver have errors in its log',
                otherTrouble.length + ' other units or addresses on driver ' + iw.log.owner + ' have timeouts, errors or went offline in the log window. Errors on every unit of a bus point at the bus — port, settings, wiring, adapter; errors on one unit only point at that unit — its address, its settings, its list.',
                { units: otherTrouble.slice(0, 12).map(u => Object.assign({ unit: u }, iw.log.otherUnits[u])) }, 'Weigh this unit\'s own findings against it.');
        }
        const indicators = (plantParameters || []).filter(p => p.scan && p.scan !== 'answered' && p.iwmac && p.iwmac.onlineIndicator);
        if (indicators.length) {
            add('error', 'online-indicator-not-answering', 'IWMAC judges the unit online by a register the device does not answer',
                indicators.length + ' parameters marked as the unit\'s online indicator (iw_set onl_ind) point at registers the scan found no answer for, so the driver can take the unit OFFLINE while the device is answering everything else.',
                { parameters: indicators.slice(0, 8).map(p => ({ table: p.table, ref: p.ref, addr: p.addr, name: p.name, driverId: p.driverId, scan: p.scan })) },
                'Correct the address of that parameter, or move the online indicator to a register the device answers.');
        }
        const notAnswering = (plantParameters || []).filter(p => p.scan && p.scan !== 'answered');
        if (notAnswering.length) {
            add('error', 'mapped-registers-not-answering', 'IWMAC polls registers the device did not answer',
                notAnswering.length + ' IWMAC parameters point at registers the scan found no answer for — a wrong address, table or base, or equipment that is not fitted.',
                { count: notAnswering.length, sample: notAnswering.slice(0, 12).map(p => ({ table: p.table, ref: p.ref, addr: p.addr, name: p.name, scan: p.scan })) },
                'Check these addresses against the vendor document; if they are all one register off, correct the list\'s base rather than each point.');
        }
        const mismatched = plantRows.filter(x => x.p.iwmac && x.p.iwmac.agrees === false && !/moved/.test(x.p.iwmac.note || ''));
        if (mismatched.length) {
            add('warning', 'iwmac-value-differs', 'IWMAC shows a different value from what its own definition gives',
                mismatched.length + ' parameters: the register decoded with IWMAC\'s datatype and scale does not give the value IWMAC displays — an old value, or a definition that reads the register differently from the device.',
                { count: mismatched.length, sample: mismatched.slice(0, 12).map(x => ({ table: x.r.table || null, ref: x.r.ref, name: x.p.name, raw: x.r.raw, shown: x.p.shown, expected: x.p.iwmac.expected, datatype: x.p.iwmac.datatype, scale: x.p.iwmac.scale })) },
                'Poll one of these registers twice; if the raw value is stable and IWMAC still differs, check the datatype, word order and scale in the list.');
        }
        const undecodable = plantRows.filter(x => x.p.iwmac && x.p.iwmac.expected === null && /finite float/.test(x.p.iwmac.why || ''));
        if (undecodable.length) {
            add('warning', 'float-does-not-decode', 'Registers IWMAC reads as floats do not hold floats in that word order',
                undecodable.length + ' parameters are defined as 32-bit floats, and their two registers do not decode to a number.',
                { count: undecodable.length, sample: undecodable.slice(0, 8).map(x => ({ ref: x.r.ref, name: x.p.name, datatype: x.p.iwmac.datatype })) },
                'Check the word order (_N against _W) and whether the register is a float at all.');
        }
        const inactive = iw && iw.parameters ? iw.parameters.inactive : 0;
        if (inactive) {
            add('info', 'inactive-parameters', 'Parameters IWMAC does not poll', inactive + ' parameters of the table are inactive (iw_set active = 0) and are never read.',
                { count: inactive }, 'Only a concern if one of them should be showing a value.');
        }
        const errored = iw && iw.log ? Object.keys(iw.log.byDriverId || {})
            .filter(id => !current.since || !iw.log.byDriverId[id].last || iw.log.byDriverId[id].last.at >= current.since) : [];
        if (errored.length) {
            add('warning', 'parameters-with-driver-errors', 'The driver log names parameters of this unit that failed',
                errored.length + ' parameters of this unit appear in the driver log with read errors since ' + (current.after || 'the log began') + '.',
                { count: errored.length, sample: errored.slice(0, 12).map(id => Object.assign({ driverId: id }, iw.log.byDriverId[id])) },
                'Read these registers with modpoll; an exception means the address is wrong, a timeout means the device did not answer the driver.');
        }
        const unread = rows.filter(r => r.raw !== 0 && !(r.plant && r.plant.length) && typeof r.ref === 'number');
        if (unread.length) {
            add('info', 'values-iwmac-does-not-read', 'Registers holding values that IWMAC does not read',
                unread.length + ' registers answered with a non-zero value and have no IWMAC parameter — points the list may be missing, or ones deliberately left out.',
                { count: unread.length, ranges: rangesByTable(unread) }, 'Look these up in the vendor document before adding any.');
        }
        if (scan && scan.cost && scan.cost.exceptions && scan.cost.msPerModpollRun && scan.cost.msPerModpollRun > 900) {
            add('info', 'slow-refusals', 'The device is slow to refuse',
                'The scan averaged ' + scan.cost.msPerModpollRun + ' ms per modpoll run over ' + scan.cost.exceptions + ' refusals — most of the scan\'s time.',
                { cost: scan.cost }, 'Nothing to fix; it is why a scan of this device takes minutes.');
        }
        const order = { error: 0, warning: 1, info: 2 };
        return f.sort((a, b) => order[a.severity] - order[b.severity]);
    }

    function rangesByTable(rows) {
        const by = {};
        for (const r of rows) (by[r.table || 'poll'] = by[r.table || 'poll'] || []).push(r.ref);
        const out = {};
        for (const t of Object.keys(by)) out[t] = asRanges(by[t]);
        return out;
    }

    /**
     * The document as files, each under the knowledge-file ceiling and each
     * complete on its own. The header — everything but the big sections below —
     * repeats in every part; a part carries one slice of one section, one row
     * per line, so a reader can count rows and cite them.
     */
    const EXPORT_SECTIONS = ['readings', 'scanReadings', 'plantParameters', 'listPoints', 'verificationRows'];
    // The knowledge-file ceiling is 36 000 characters. The markdown report keeps
    // 6 000 of headroom because it estimates; this measures the assembled part,
    // so it can go closer — and every 2 000 characters is six more readings a
    // part, which on a unit of a thousand registers is two files fewer against
    // a cap of twenty.
    const EXPORT_CHUNK_LIMIT = 34000;

    /**
     * The whole document as one file — what Save JSON writes: the header
     * pretty-printed, each section one row per line so a reader can count and
     * cite rows, nothing split. Splitting is for a knowledge set with a
     * per-file ceiling, and exportParts does it on request.
     */
    function exportText(doc) {
        const body = {};
        for (const key of Object.keys(doc)) body[key] = EXPORT_SECTIONS.indexOf(key) < 0 ? doc[key] : '@@' + key + '@@';
        let text = JSON.stringify(body, null, 1);
        for (const section of EXPORT_SECTIONS) {
            const rows = (doc[section] || []).map(row => JSON.stringify(row));
            text = text.replace('"@@' + section + '@@"', rows.length ? '[\n' + rows.join(',\n') + '\n]' : '[]');
        }
        return text;
    }

    function exportParts(doc, baseName) {
        const header = {};
        for (const key of Object.keys(doc)) if (EXPORT_SECTIONS.indexOf(key) < 0) header[key] = doc[key];
        // What a part costs before its rows: the header, the part block at its
        // widest, and the section's brackets — measured on the assembled text.
        const frameOf = section => JSON.stringify(Object.assign(
            { part: { n: 999, of: 999, section, rows: 99999, contents: {}, firstRef: 999999, lastRef: 999999 } },
            header, { [section]: '@@ROWS@@' }), null, 1).length + 300;
        const slices = [];
        for (const section of EXPORT_SECTIONS) {
            const rows = (doc[section] || []).map(row => JSON.stringify(row));
            const frame = frameOf(section);
            let chunk = [];
            let size = 0;
            const flush = () => { if (chunk.length) slices.push({ section, rows: chunk }); chunk = []; size = 0; };
            for (const line of rows) {
                if (chunk.length && frame + size + line.length + 2 > EXPORT_CHUNK_LIMIT) flush();
                chunk.push(line);
                size += line.length + 2;
            }
            flush();
        }
        if (!slices.length) slices.push({ section: null, rows: [] });
        const contents = {};
        slices.forEach((slice, index) => { if (slice.section) (contents[slice.section] = contents[slice.section] || []).push(index + 1); });
        const base = baseName || resultFilename().replace(/\.json$/, '');
        return slices.map((slice, index) => {
            const part = { n: index + 1, of: slices.length, section: slice.section, rows: slice.rows.length, contents };
            if (slice.rows.length) {
                const firstRef = JSON.parse(slice.rows[0]).ref;
                const lastRef = JSON.parse(slice.rows[slice.rows.length - 1]).ref;
                if (firstRef !== undefined) { part.firstRef = firstRef; part.lastRef = lastRef; }
            }
            const body = Object.assign({ part }, header);
            if (slice.section) body[slice.section] = '@@ROWS@@';
            const text = JSON.stringify(body, null, 1).replace('"@@ROWS@@"', '[\n' + slice.rows.join(',\n') + '\n]');
            return {
                name: base + (slices.length > 1 ? '_part' + (index + 1) + 'of' + slices.length : '') + '.json',
                section: slice.section,
                rows: slice.rows.length,
                text,
            };
        });
    }

    /*
     * Where does this device actually keep anything? Probing says where a region
     * starts; this reads onwards until the answers run out.
     *
     * A strict device refuses a block whole, so one unmapped register inside 99
     * cost the whole block — and three such blocks in a row used to end the
     * sweep, which on a map with holes ended it almost at once. Now every
     * missing run of a chunk is judged before it is chased: a run holding a
     * reference already known to answer — a ladder rung, a halving probe — has
     * holes in it, and a run touching an answered register on either side is
     * the map's edge; both are chased with recovery, which halves them until
     * the holes and the edge are isolated, each run on its own budget. A run
     * touching nothing is empty space, and halving it would only confirm that
     * at a refusal per level — which is what used to spend the budget before
     * the edges got theirs. A chunk that comes back with nothing and holds
     * nothing known gets three single reads inside it first, so an island the
     * ladder missed still has a chance.
     *
     * Stopping: two consecutive empty chunks means the region has ended — it
     * was three until 1.46.0, and on plant 2349's OJ exhaust, where a refusal
     * costs ~1.8 s more than an answer, the third chunk and its three single
     * reads were ~13 s per table spent re-confirming what the look-ahead past
     * the edge (up to 128 registers) and the second chunk had already said. A
     * lenient device answers 0 for everything unmapped and never goes empty, so
     * it stops after five consecutive chunks of nothing but zeros past the last
     * value seen — about two thousand registers of nothing — or at the chunk
     * budget. Nothing stops at 6000 any more: a map at 8192 is a map, and
     * modpoll reads to 65536.
     *
     * `tick` is called around every command this function issues — the chunk's
     * own read, and every read and probeRefs call chaseRun makes chasing a gap
     * — not once the chunk is settled. A chunk that comes back whole is one
     * tick; a chunk on a strict device with a hole in it can be dozens, each
     * one a refusal paid for on the wire, and it is exactly that stretch a
     * caller watching only chunk boundaries would see nothing from. Between
     * commands it is called again, marked partial, as values and refusals
     * land on the terminal, so even one command is not a silence.
     */
    const SWEEP_CEILING = 65536;
    const SWEEP_CHUNK = MAX_COUNT * CHAIN_MAX;
    const SWEEP_MAX_CHUNKS = 60;
    const SWEEP_EMPTY_STOP = 2;
    const SWEEP_ZERO_STOP = 5;

    async function sweepForValues(spec, table, from, known, tick) {
        const found = new Map();                       // ref -> value row
        const answers = new Set((known || new Map()).keys());
        for (const [ref, value] of (known || new Map())) found.set(ref, { i: ref, addr: ref - 1, v: value });
        let ref = Math.max(1, from);
        let emptyRuns = 0;
        let zeroRuns = 0;
        let chunks = 0;
        let refused = 0;
        let fresh = 0;
        let fatal = null;
        let stoppedBecause = 'reached the end of the address space';
        // True only for a chunk's own opening read. Everything chaseRun does in
        // response to what that read found — the binary searches, the
        // look-aheads — is work the chunk caused, not a new chunk starting, so
        // only the opening read is flagged as one; every call still ticks.
        let chunkStart = false;
        // One tick per command sent, and a partial one for every value or
        // refusal that lands while it runs — the latter says "still alive"
        // without counting as a second command.
        const note = (ref, atChunkStart, partial) => {
            if (!tick) return;
            tick({
                ref, found: found.size, chunkStart: !!atChunkStart, partial: !!partial,
                arriving: partial ? (partial.arriving || 0) : 0, refusals: partial ? (partial.refusals || 0) : 0,
            });
        };
        const probeNote = ref => (done, total, info) => note(ref, false, info && info.partial ? { arriving: info.answered } : null);
        const read = (start, count) => {
            note(start, chunkStart);
            chunkStart = false;
            return readRegisters(Object.assign({}, spec, {
                table, format: '', base: 'printed', start, count, recover: false,
            }), p => { if (p.partial) note(start, false, p); });
        };
        const take = result => {
            for (const value of result.values) {
                if (!found.has(value.i)) fresh++;
                found.set(value.i, value);
                answers.add(value.i);
            }
            const dead = result.diagnostics.find(d => d.level === 'fatal');
            if (dead) fatal = dead.text;
        };
        // One question: does the device answer all of [start, start + count)?
        // Whatever it did answer is kept either way.
        const asks = async (start, count) => {
            if (count <= 0 || abortRequested || fatal) return false;
            const result = await read(start, count);
            take(result);
            return result.values.length === count;
        };
        /*
         * The map's edge, from an anchor that answers. Rightwards: how many
         * registers past the anchor still answer, found by halving the
         * extension — each question asks only the part not yet known to answer,
         * so a strict device that refuses whole is asked about seven times for
         * a block, not dozens. Leftwards is the mirror, for an island found
         * from its far side.
         */
        const extendRight = async (start, limit) => {
            if (await asks(start, limit)) return limit;
            let lo = 0, hi = limit;                    // [start, start + lo) answers; [start, start + hi) does not
            while (hi - lo > 1 && !abortRequested && !fatal) {
                const mid = Math.floor((lo + hi) / 2);
                if (await asks(start + lo, mid - lo)) lo = mid; else hi = mid;
            }
            return lo;
        };
        const extendLeft = async (anchor, limit) => {
            if (await asks(anchor - limit, limit)) return limit;
            let lo = 0, hi = limit;                    // [anchor - lo, anchor) answers
            while (hi - lo > 1 && !abortRequested && !fatal) {
                const mid = Math.floor((lo + hi) / 2);
                if (await asks(anchor - mid, mid - lo)) lo = mid; else hi = mid;
            }
            return lo;
        };
        // Past a refusal, before calling the map ended: single reads at doubling
        // distances, one chained line. A reserved register or a short gap is
        // crossed; the first answer says where to search back for the resumption.
        const lookAhead = async (x, end) => {
            const at = [1, 2, 4, 8, 16, 32, 64, 128].map(d => x + d).filter(r => r <= end);
            if (!at.length || abortRequested || fatal) return null;
            const inside = await probeRefs(spec, at.map(r => ({ table, ref: r })), probeNote(x));
            for (const r of at) {
                const hit = inside[table + ':' + r];
                if (hit && hit.answered) {
                    if (!found.has(r)) fresh++;
                    found.set(r, { i: r, addr: r - 1, v: hit.value });
                    answers.add(r);
                    return r;
                }
            }
            return null;
        };
        // Runs of consecutive references inside a chunk that nothing has answered for.
        const gapsIn = (start, count) => {
            const runs = [];
            let run = null;
            for (let r = start; r < start + count; r++) {
                if (answers.has(r)) { run = null; continue; }
                if (run && run.ref + run.count === r) run.count++;
                else { run = { ref: r, count: 1 }; runs.push(run); }
            }
            return runs;
        };
        const knownInside = run => { for (let r = run.ref; r < run.ref + run.count; r++) if (known && known.has(r)) return r; return null; };
        /*
         * A missing run is judged before it is chased. One touching an answered
         * register on its left is the map continuing: extend from there. One
         * holding a reference known to answer has the map somewhere inside:
         * search back to where that stretch starts, then extend from it. One
         * touching an answered register on its right is an island's tail: search
         * back from that side. One touching nothing is empty space, which the
         * chunk's own blind reads have already tested, and is left alone.
         */
        const chaseRun = async run => {
            const start = run.ref;
            const end = run.ref + run.count - 1;
            let cursor = null;
            const inside = knownInside(run);
            if (answers.has(start - 1)) cursor = start;
            else if (inside !== null) { await extendLeft(inside, inside - start); cursor = inside + 1; }
            else if (answers.has(end + 1)) { await extendLeft(end + 1, run.count); return; }
            else return;
            while (cursor <= end && !abortRequested && !fatal) {
                const got = await extendRight(cursor, end - cursor + 1);
                const x = cursor + got;                // the first reference that did not answer
                if (x > end) return;
                const resumed = await lookAhead(x, end);
                if (resumed === null) {
                    if (answers.has(end + 1)) await extendLeft(end + 1, end - x + 1);
                    return;
                }
                await extendLeft(resumed, resumed - x - 1);
                cursor = resumed + 1;
            }
        };
        while (ref <= SWEEP_CEILING && !abortRequested) {
            if (chunks >= SWEEP_MAX_CHUNKS) { stoppedBecause = 'chunk budget spent'; break; }
            const count = Math.min(SWEEP_CHUNK, SWEEP_CEILING - ref + 1);
            chunkStart = true;
            fresh = 0;
            const first = await read(ref, count);
            chunks++;
            take(first);
            if (fatal) { stoppedBecause = fatal; break; }
            if (!first.values.length && !gapsIn(ref, count).some(run => knownInside(run) !== null)) {
                const at = [ref + 5, ref + Math.floor(count / 2), ref + count - 6].filter(r => r >= ref && r < ref + count);
                const inside = await probeRefs(spec, at.map(r => ({ table, ref: r })), probeNote(ref));
                for (const r of at) {
                    const hit = inside[table + ':' + r];
                    if (hit && hit.answered && !found.has(r)) { found.set(r, { i: r, addr: r - 1, v: hit.value }); answers.add(r); fresh++; }
                }
            }
            for (const run of gapsIn(ref, count)) {
                if (abortRequested || fatal) break;
                if (knownInside(run) !== null || answers.has(run.ref - 1) || answers.has(run.ref + run.count)) await chaseRun(run);
            }
            if (fatal) { stoppedBecause = fatal; break; }
            ref += count;
            if (fresh) {
                emptyRuns = 0;
                let anyValue = false;
                for (const [r, value] of found) if (r >= ref - count && r < ref && value.v !== 0) { anyValue = true; break; }
                zeroRuns = anyValue ? 0 : zeroRuns + 1;
                if (zeroRuns >= SWEEP_ZERO_STOP) { stoppedBecause = SWEEP_ZERO_STOP * SWEEP_CHUNK + ' registers of zeros in a row'; break; }
            } else {
                emptyRuns++;
                zeroRuns = 0;
                refused += first.diagnostics.some(d => /exception/i.test(d.text)) ? 1 : 0;
                if (emptyRuns >= SWEEP_EMPTY_STOP) { stoppedBecause = 'no answer for ' + SWEEP_EMPTY_STOP * SWEEP_CHUNK + ' registers in a row'; break; }
            }
        }
        if (abortRequested) stoppedBecause = 'stopped by user';
        // Only what lies inside the range this sweep covered is its own. The
        // known answers it was seeded with reach beyond that — a ladder rung in
        // the next region — and claiming one would have that region skipped as
        // already found, with everything past its rung never read.
        const values = [...found.values()].filter(v => v.i >= Math.max(1, from) && v.i < ref).sort((a, b) => a.i - b.i);
        const refs = values.map(v => v.i);
        const nonZero = values.filter(v => v.v !== 0);
        const lowest = list => list.reduce((m, r) => (m === null || r < m ? r : m), null);
        const highest = list => list.reduce((m, r) => (m === null || r > m ? r : m), null);
        return {
            table,
            answered: found.length,
            nonZero: nonZero.length,
            first: lowest(refs),
            last: highest(refs),
            ranges: asRanges(refs),
            withValues: asRanges(nonZero.map(v => v.i)),
            values,
            refusedBlocks: refused,
            stoppedAt: ref,
            stoppedBecause,
            chunks,
        };
    }

    /*
     * Everything a sweep found, read once more, so a reading that moved can be
     * told from one that held still. Only the registers that answered are
     * asked, run by run — a strict device refuses a block whole, so a run never
     * spans a hole — and recovery stays off, since nothing here should be
     * refused. The values are annotated in place: `again` is the second
     * reading, `changed` says it differed from the first.
     */
    async function rereadFound(spec, values, onProgress) {
        const startedAt = performance.now();
        const original = new Map();
        const byTable = {};
        for (const v of values) {
            original.set(v.table + '|' + v.i, v);
            (byTable[v.table] = byTable[v.table] || []).push(v.i);
        }
        const runs = [];
        for (const table of Object.keys(byTable)) {
            let run = null;
            for (const ref of [...new Set(byTable[table])].sort((a, b) => a - b)) {
                if (run && run.ref + run.count === ref) run.count++;
                else { run = { table, ref, count: 1 }; runs.push(run); }
            }
        }
        let reread = 0;
        let changed = 0;
        let commands = 0;
        const changedRefs = {};
        for (let i = 0; i < runs.length && !abortRequested; i++) {
            const run = runs[i];
            if (onProgress) onProgress(i, runs.length, { changed });
            let result;
            try {
                result = await readRegisters(Object.assign({}, spec, {
                    table: run.table, format: '', base: 'printed', start: run.ref, count: run.count, recover: false,
                }), p => { if (p.partial && onProgress) onProgress(i, runs.length, { changed, partial: true, arriving: p.arriving }); });
            } catch (e) { break; }
            commands += result.commands.length;
            for (const v of result.values) {
                const was = original.get(run.table + '|' + v.i);
                if (!was) continue;
                reread++;
                was.again = v.v;
                if (v.v !== was.v) {
                    was.changed = true;
                    changed++;
                    (changedRefs[run.table] = changedRefs[run.table] || []).push(v.i);
                }
            }
        }
        const changedRanges = {};
        for (const table of Object.keys(changedRefs)) changedRanges[table] = asRanges(changedRefs[table]);
        return {
            at: new Date().toISOString(),
            runs: runs.length, reread, changed, changedRanges, commands,
            elapsedMs: Math.round(performance.now() - startedAt),
            stopped: abortRequested,
        };
    }

    /*
     * What a region holds — 16-bit values, or 32-bit ones, and in which word
     * order — judged from the values already read, without touching the wire.
     * Every aligned pair is decoded both ways: a region of floats decodes
     * plausibly in one order at one alignment and badly in the other three,
     * while a region of 16-bit values decodes badly in all four. The plant's
     * own displayed values, when the unit's names are loaded, settle it
     * outright: a value a pair decodes to is a 32-bit point, a value the
     * register's own scale explains is a 16-bit one. Integers cannot be told
     * from the bits — any two words make some integer — so a 32-bit integer
     * verdict only ever comes from the plant. A verdict is per region, and a
     * region can hold both kinds; then it is called mixed, and the export's
     * per-row decoding is the finer answer.
     */
    function judgeFormats(report) {
        const formats = {};
        for (const table of Object.keys(report.sweep || {})) {
            const vals = new Map();
            for (const v of report.values || []) if (v.table === table) vals.set(v.i, v.v);
            formats[table] = { regions: [] };
            for (const region of report.sweep[table].regions || []) {
                if (region.first === null || region.first === undefined) continue;
                formats[table].regions.push(Object.assign({ from: region.first, to: region.last }, judgeRegion(table, region.first, region.last, vals)));
            }
        }
        return formats;
    }

    function judgeRegion(table, first, last, vals) {
        if (table === '0' || table === '1') {
            return { format: '16-bit', wordOrder: null, alignStart: first, confidence: 'table', pairs: null, plant: null, evidence: 'a bit table' };
        }
        // What the plant says, register by register, where its names are loaded.
        const plant = { confirmed16: 0, confirmed32: {}, refs32: [] };
        const shownAt = ref => {
            try {
                const entries = typeof plantNamesFor === 'function' ? plantNamesFor(table, '', ref) : null;
                const e = entries && entries[0];
                return e && e.bit === null ? e.plantValue : null;
            } catch (e) { return null; }
        };
        for (let r = first; r <= last; r++) {
            if (!vals.has(r)) continue;
            const shown = shownAt(r);
            if (shown === null || shown === undefined || shown === '') continue;
            if (impliedScale(vals.get(r), shown)) { plant.confirmed16++; continue; }
            if (!vals.has(r + 1)) continue;
            const wide = pickWide(wideReading(vals.get(r), vals.get(r + 1), shown));
            if (!wide) continue;
            const key = wide.as + '|' + wide.wordOrder;
            plant.confirmed32[key] = (plant.confirmed32[key] || 0) + 1;
            plant.refs32.push({ ref: r, as: wide.as, wordOrder: wide.wordOrder });
        }
        // What the bits say: every alignment and order, floats only.
        const trials = [];
        for (const align of [0, 1]) {
            for (const [wordOrder, key] of [['high word first', 'highFirst'], ['low word first', 'lowFirst']]) {
                let plausible = 0, tested = 0;
                for (let r = first + align; r + 1 <= last; r += 2) {
                    if (!vals.has(r) || !vals.has(r + 1)) continue;
                    const a = vals.get(r), b = vals.get(r + 1);
                    if (a === 0 && b === 0) continue;
                    tested++;
                    if (plausibleFloat(decodePair(a, b)[key].float)) plausible++;
                }
                trials.push({ align, wordOrder, plausible, tested, score: tested ? plausible / tested : 0 });
            }
        }
        trials.sort((x, y) => (y.plausible - x.plausible) || (y.score - x.score));
        const best = trials[0];
        const pairs = { plausible: best.plausible, tested: best.tested, wordOrder: best.wordOrder, alignStart: first + best.align };
        const s = n => (n === 1 ? '' : 's');
        const floats = best.plausible + ' of ' + best.tested + ' pair' + s(best.tested) + ' from ' + (first + best.align) + ' read as floats, ' + best.wordOrder;

        const total32 = Object.values(plant.confirmed32).reduce((sum, n) => sum + n, 0);
        if (total32 && !plant.confirmed16) {
            // The plant confirms 32-bit points and nothing 16-bit: its word.
            const top = Object.keys(plant.confirmed32).sort((x, y) => plant.confirmed32[y] - plant.confirmed32[x])[0];
            const [as, wordOrder] = top.split('|');
            const refs = plant.refs32.filter(p => p.as === as && p.wordOrder === wordOrder).map(p => p.ref);
            const even = refs.filter(r => (r - first) % 2 === 0).length;
            return {
                format: as, wordOrder, alignStart: first + (even >= refs.length / 2 ? 0 : 1), confidence: 'plant', pairs, plant,
                evidence: 'the plant shows ' + plant.confirmed32[top] + ' value' + s(plant.confirmed32[top]) + ' that a pair of registers decodes to as ' + as + ', ' + wordOrder +
                    (best.plausible ? '; ' + floats : ''),
            };
        }
        if (total32 && plant.confirmed16) {
            return {
                format: 'mixed', wordOrder: best.wordOrder, alignStart: first + best.align, confidence: 'plant', pairs, plant,
                evidence: 'the plant reads ' + plant.confirmed16 + ' register' + s(plant.confirmed16) + ' here at a 16-bit scale and ' + total32 + ' pair' + s(total32) + ' as 32-bit — see each row',
            };
        }
        if (plant.confirmed16 && best.score < 0.6) {
            return {
                format: '16-bit', wordOrder: null, alignStart: first, confidence: 'plant', pairs, plant,
                evidence: 'the plant shows ' + plant.confirmed16 + ' register' + s(plant.confirmed16) + ' here at a 16-bit scale' + (best.plausible ? '; ' + best.plausible + ' pair' + s(best.plausible) + ' would read as floats' : ''),
            };
        }
        if (best.plausible >= 3 && best.score >= 0.6) {
            return {
                format: 'float32', wordOrder: best.wordOrder, alignStart: first + best.align, confidence: 'pattern', pairs, plant,
                evidence: floats + (plant.confirmed16 ? ' — but the plant shows ' + plant.confirmed16 + ' register' + s(plant.confirmed16) + ' at a 16-bit scale' : ''),
            };
        }
        if (best.plausible >= 2 && best.score >= 0.3) {
            return {
                format: 'mixed', wordOrder: best.wordOrder, alignStart: first + best.align, confidence: 'pattern', pairs, plant,
                evidence: floats + ' — some 32-bit values among 16-bit ones, or coincidence; see each row',
            };
        }
        return {
            format: '16-bit', wordOrder: null, alignStart: first, confidence: 'pattern', pairs, plant,
            evidence: best.plausible ? best.plausible + ' of ' + best.tested + ' pair' + s(best.tested) + ' would read as floats, too few for a float map' : 'no pair of registers reads as a float',
        };
    }

    /*
     * Which word order modpoll's -f produces on this plant, measured rather
     * than assumed: the first few pairs of a float region are read as floats
     * with the flag and without, and whichever read prints the numbers the
     * words decode to says what the flag means. Two short reads. The same
     * pass proves the region on the wire — the printed floats are the ones
     * the console decoded, so polling it that way is what gets the values out.
     */
    async function checkWordOrderOnWire(spec, table, verdict, vals, onProgress) {
        const pairs = [];
        for (let r = verdict.alignStart; pairs.length < 4 && r + 1 <= verdict.to; r += 2) {
            if (!vals.has(r) || !vals.has(r + 1)) break;
            pairs.push({ ref: r, d: decodePair(vals.get(r), vals.get(r + 1)) });
        }
        if (!pairs.length) return null;
        const readAs = async bigEndian => {
            if (onProgress) onProgress(bigEndian);
            const result = await readRegisters(Object.assign({}, spec, {
                table, format: 'float', bigEndian, base: 'printed', start: pairs[0].ref, count: pairs.length, recover: false,
            }));
            return new Map(result.values.map(v => [v.i, v.v]));
        };
        const withFlag = await readAs(true);
        const without = await readAs(false);
        const near = (x, y) => typeof x === 'number' && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= Math.max(Math.abs(y) * 1e-4, 1e-5);
        const hits = { flagHigh: 0, flagLow: 0, plainHigh: 0, plainLow: 0 };
        let compared = 0;
        for (const p of pairs) {
            const high = p.d.highFirst.float, low = p.d.lowFirst.float;
            if (!plausibleFloat(high) && !plausibleFloat(low)) continue;
            compared++;
            if (near(withFlag.get(p.ref), high)) hits.flagHigh++;
            if (near(withFlag.get(p.ref), low)) hits.flagLow++;
            if (near(without.get(p.ref), high)) hits.plainHigh++;
            if (near(without.get(p.ref), low)) hits.plainLow++;
        }
        let bigEndianFlag = null;
        if (hits.flagHigh && !hits.flagLow) bigEndianFlag = 'high word first';
        else if (hits.flagLow && !hits.flagHigh) bigEndianFlag = 'low word first';
        else if (hits.plainLow && !hits.plainHigh) bigEndianFlag = 'high word first';
        else if (hits.plainHigh && !hits.plainLow) bigEndianFlag = 'low word first';
        // Did a float read, in the region's own order, print what the words decode to?
        const matchedInOrder = verdict.wordOrder === 'high word first' ? Math.max(hits.flagHigh, hits.plainHigh) : Math.max(hits.flagLow, hits.plainLow);
        return {
            bigEndianFlag, measured: bigEndianFlag !== null, table, ref: pairs[0].ref, pairs: pairs.length, compared, matchedInOrder,
            printedWithFlag: pairs.map(p => (withFlag.has(p.ref) ? withFlag.get(p.ref) : null)),
            printedWithout: pairs.map(p => (without.has(p.ref) ? without.get(p.ref) : null)),
        };
    }

    /*
     * The poll to set the form to once a scan is done: the table holding the
     * most values, its densest run of them — values in a row, small gaps
     * bridged, rather than a whole region with its empty stretches, which on
     * a strict device would be refused block by block — read at the width and
     * word order the region was judged to have. So Run, straight after Scan
     * device, prints the numbers rather than the halves of them.
     */
    function suggestSpec(report) {
        const sweep = report.sweep || {};
        const tables = Object.keys(sweep).filter(t => sweep[t].answered > 0);
        if (!tables.length) return null;
        tables.sort((a, b) => (sweep[b].nonZero - sweep[a].nonZero) || (SCAN_TABLES.indexOf(a) - SCAN_TABLES.indexOf(b)));
        const table = tables[0];
        const values = (report.values || []).filter(v => v.table === table);
        let refs = values.filter(v => v.v !== 0).map(v => v.i);
        if (!refs.length) refs = values.map(v => v.i);
        refs.sort((a, b) => a - b);
        // Runs of values, a gap of up to eight registers bridged — the same
        // bridging a verification uses, and enough for a float's zero low
        // words and the odd reserved register.
        const runs = [];
        let run = null;
        for (const ref of refs) {
            if (run && ref - run.last <= 9) { run.last = ref; run.count++; }
            else { run = { first: ref, last: ref, count: 1 }; runs.push(run); }
        }
        runs.sort((a, b) => (b.count - a.count) || (a.first - b.first));
        const best = runs[0];
        if (!best) return null;
        const verdict = ((report.formats && report.formats[table] && report.formats[table].regions) || [])
            .find(r => best.first >= r.from && best.first <= r.to) || { format: '16-bit' };
        const wide = verdict.format === 'float32' || verdict.format === 'int32' || verdict.format === 'uint32';
        const format = verdict.format === 'float32' ? 'float' : (wide ? 'int' : '');
        const measured = !!(report.modpoll && report.modpoll.measured);
        const flagMeans = measured ? report.modpoll.bigEndianFlag : 'high word first';
        // A 32-bit read starts on a pair boundary and ends on one.
        let start = best.first;
        let end = best.last;
        if (wide) {
            start = best.first > verdict.alignStart ? verdict.alignStart + Math.ceil((best.first - verdict.alignStart) / 2) * 2 : verdict.alignStart;
            if ((end - start + 1) % 2) end++;
        }
        const registers = Math.max(1, end - start + 1);
        const count = wide ? Math.max(1, Math.min(990, Math.floor(registers / 2))) : Math.min(1980, registers);
        const label = (REGISTER_TABLES.find(t => t.value === table) || {}).label || ('table ' + table);
        const why = [
            label + ' holds the most values (' + sweep[table].nonZero + ')',
            'references ' + best.first + '-' + best.last + ' hold ' + best.count + ' of them in a row' + (runs.length > 1 ? ', the densest of ' + runs.length + ' runs' : ''),
            wide ? verdict.format + ', ' + verdict.wordOrder + ' — ' + verdict.evidence
                : 'read as 16-bit — ' + (verdict.evidence || 'no verdict on the width'),
        ];
        if (wide) why.push(measured ? 'modpoll\'s -f/-i flag gives ' + flagMeans + ' on this plant, measured' : 'modpoll\'s -f/-i flag assumed to give high word first — not measured');
        return { table, format, bigEndian: wide && verdict.wordOrder === flagMeans, base: 'printed', start, count, assumedFlag: wide && !measured, why };
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
            unreadable: result.unreadable || [],
            v: result.values.map(v => v.v),
            diagnostics: result.diagnostics.map(d => d.level + ': ' + d.text),
        };
    }

    // ------------------------------------------------ modbusgen point lists

    /*
     * A modbusgen project file already says everything a verification needs: how
     * the documentation numbered the addresses (options.subtract_one), which
     * register table and raw type each point uses (datatype), what it should be
     * called, what it is scaled by, and often how to reach the device
     * (system.comm). Reading it here turns "poll some registers" into "check this
     * list against this device".
     *
     * The datatype name is decoded by its grammar, which covers all but a handful
     * of the shipped keys; the rest are named below. A key that decodes to
     * nothing is reported as undecodable rather than guessed at — a wrong table
     * would quietly poll the wrong half of the device.
     */
    const DATATYPE_EXCEPTIONS = {
        Bit_Hold: { func: 3, raw: 'X', swap: 'N' },
        Bit_Input: { func: 4, raw: 'X', swap: 'N' },
        Nibble_Hold: { func: 3, raw: 'U16', swap: 'N' },
        Nibble_Input: { func: 4, raw: 'U16', swap: 'N' },
        FLOAT: { func: 3, raw: 'I16', swap: 'N' },
        BYTE: { func: 3, raw: 'U16', swap: 'N' },
        WORD: { func: 3, raw: 'U16', swap: 'N' },
        Virt: { func: 0, raw: '', swap: 'N' },
    };

    // modpoll's -t follows the Modicon prefix, the function code does not.
    const FUNC_TO_TABLE = { 1: '0', 2: '1', 3: '4', 4: '3' };
    const RAW_TO_FORMAT = {
        I16: { format: '', step: 1 }, U16: { format: '', step: 1 },
        rI16: { format: '', step: 1 }, rU16: { format: '', step: 1 },
        X: { format: '', step: 1 }, D: { format: '', step: 1 },
        I32: { format: 'int', step: 2 }, U32: { format: 'int', step: 2 },
        F: { format: 'float', step: 2 },
    };

    function decodeDatatype(name) {
        const key = String(name || '').trim();
        let spec = DATATYPE_EXCEPTIONS[key];
        if (!spec) {
            const parts = key.split('_');
            const family = (parts[0] === 'Coil' || parts[0] === 'Digital') ? parts[0] : parts[1];
            const func = { Coil: 1, Digital: 2, Hold: 3, Inp: 4, Input: 4 }[family];
            if (func) spec = { func, raw: parts.length > 2 ? parts[parts.length - 2] : 'X', swap: parts[parts.length - 1] };
        }
        if (!spec || !FUNC_TO_TABLE[spec.func]) return { ok: false, reason: 'datatype "' + key + '" not decoded' };
        const raw = RAW_TO_FORMAT[spec.raw];
        if (!raw) return { ok: false, reason: 'raw type "' + spec.raw + '" cannot be polled directly', table: FUNC_TO_TABLE[spec.func] };
        return {
            ok: true,
            table: FUNC_TO_TABLE[spec.func],
            format: raw.format,
            step: raw.step,
            // Word order R means the slave presents 32-bit values the other way
            // round. Mapping that onto -i/-f is an assumption the report states.
            bigEndian: spec.swap === 'R',
            rawType: spec.raw,
        };
    }

    /**
     * 434 × 0.1 is 43.400000000000006 in binary floating point, and a reading
     * printed like that is noise pretending to be precision. The list's own
     * decimals decide when it states them; twelve significant digits is enough
     * to clean up the rest without inventing any.
     */
    function roundScaled(value, decimals) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return value;
        return decimals === null || decimals === undefined
            ? Number(value.toPrecision(12))
            : Number(value.toFixed(decimals));
    }

    /** "x0.1" and friends. A key this does not know leaves the value unscaled. */
    function scaleFactorOf(key) {
        const text = String(key == null ? '' : key).trim();
        if (!text) return { factor: 1, known: true };
        const m = text.match(/^x([0-9.]+)$/i);
        if (m) return { factor: Number(m[1]), known: true };
        if (/^inv$/i.test(text)) return { factor: 1, known: true, invert: true };
        const plain = Number(text);
        if (!Number.isNaN(plain) && text !== '') return { factor: plain, known: true };
        return { factor: 1, known: false };
    }

    function parsePointList(json) {
        const doc = typeof json === 'string' ? JSON.parse(json) : json;
        if (!doc || !Array.isArray(doc.points)) throw new Error('Not a modbusgen project: no points array');
        const subtractOne = !!(doc.options && doc.options.subtract_one);
        const points = doc.points.map((p, index) => {
            let decoded = decodeDatatype(p.datatype);
            const scale = scaleFactorOf(p.scale);
            // The list prints an address; subtract_one says whether that counts
            // from one. modpoll counts from one too, so the reference is the
            // protocol address plus one either way.
            const protocol = subtractOne ? Number(p.addr) - 1 : Number(p.addr);
            // A point can be unpollable without its datatype being at fault: an
            // address that maps below protocol 0 has nowhere to be read from.
            // Saying so per point beats failing the whole verification, which is
            // what a list written one register too low would otherwise do.
            if (decoded.ok && protocol < 0) {
                decoded = { ok: false, reason: 'address ' + p.addr + ' maps to protocol ' + protocol + ', below the first register' };
            }
            return {
                index,
                addr: Number(p.addr),
                protocol,
                ref: protocol + 1,
                bit: p.bit === undefined || p.bit === null ? null : Number(p.bit),
                name: [p.tag, p.text].filter(Boolean).join(' ') || ('point ' + index),
                group: p.group || '',
                datatype: p.datatype || '',
                decoded,
                scaleKey: p.scale || '',
                scale,
                unit: p.unit || '',
                decimals: p.decimals === undefined ? null : p.decimals,
                rw: p.rw || '',
                rangeMin: p.range_min === undefined || p.range_min === null || p.range_min === '' ? null : Number(p.range_min),
                rangeMax: p.range_max === undefined || p.range_max === null || p.range_max === '' ? null : Number(p.range_max),
            };
        });
        const comm = (doc.system && doc.system.comm) || null;
        return {
            table: doc.table || '',
            plant: doc.plant == null ? '' : String(doc.plant),
            driver: doc.driver || null,
            subtractOne,
            comm,
            points,
            undecodable: points.filter(p => !p.decoded.ok).length,
        };
    }

    /**
     * Points become poll ranges: same table and format, sorted, and merged while
     * the gap is small enough that reading across it is cheaper than a second
     * command. A block never exceeds the count cap.
     */
    function planPointRanges(points, maxGap, pad) {
        const gap = maxGap === undefined ? 8 : maxGap;
        const padding = pad === undefined ? 0 : pad;
        const byKind = {};
        for (const p of points) {
            if (!p.decoded.ok) continue;
            const key = p.decoded.table + '|' + p.decoded.format;
            (byKind[key] = byKind[key] || []).push(p);
        }
        const ranges = [];
        for (const key of Object.keys(byKind)) {
            const [table, format] = key.split('|');
            const step = formatOf(format).step;
            const refs = byKind[key].map(p => p.ref).sort((a, b) => a - b);
            let start = refs[0], last = refs[0];
            // Padding buys the neighbours on either side, which is what an offset
            // check needs: a shifted reading can only be compared against the
            // registers the shift would land on.
            const flush = () => {
                const from = Math.max(1, start - padding * step);
                const to = last + padding * step;
                ranges.push({
                    table, format,
                    ref: from,
                    count: Math.min(MAX_COUNT, Math.floor((to - from) / step) + 1),
                });
            };
            for (const ref of refs.slice(1)) {
                const wouldCount = Math.floor((ref - start) / step) + 1;
                if (ref - last > gap * step || wouldCount > MAX_COUNT) { flush(); start = ref; }
                last = ref;
            }
            flush();
        }
        return ranges;
    }

    /**
     * Poll every point in a list and say, per point, what the device answered.
     * The judgements stay mechanical: a point is suspicious when the device
     * refuses it, or when its scaled value falls outside a range the list itself
     * declares. Anything softer is left to the reader.
     */
    async function verifyPointList(list, spec, onProgress) {
        const started = performance.now();
        const ranges = planPointRanges(list.points, 8, OFFSET_WINDOW);
        const readings = new Map();      // table|format|ref -> value
        const refused = new Set();
        const commands = [];
        const diagnostics = [];

        for (let i = 0; i < ranges.length; i++) {
            if (abortRequested) { diagnostics.push({ level: 'warn', text: 'Stopped by user', line: '' }); break; }
            const range = ranges[i];
            if (onProgress) onProgress({ range: i + 1, ranges: ranges.length, ref: range.ref, count: range.count });
            let result;
            try {
                result = await readRegisters(Object.assign({}, spec, {
                    table: range.table, format: range.format, base: 'printed',
                    start: range.ref, count: range.count,
                }));
            } catch (e) {
                // One unreadable range must not cost the verification of the rest.
                diagnostics.push({ level: 'error', text: 'Range -r ' + range.ref + ' -c ' + range.count + ': ' + e.message, line: '' });
                continue;
            }
            for (const value of result.values) readings.set(range.table + '|' + range.format + '|' + value.i, value.v);
            for (const ref of result.unreadable || []) refused.add(range.table + '|' + range.format + '|' + ref);
            for (const command of result.commands) commands.push(command);
            for (const d of result.diagnostics) if (!diagnostics.some(x => x.text === d.text)) diagnostics.push(d);
        }

        const keyOf = (p, shift) => p.decoded.table + '|' + p.decoded.format + '|' + (p.ref + (shift || 0));
        const rows = list.points.map(p => {
            if (!p.decoded.ok) return { point: p, status: 'not polled', note: p.decoded.reason };
            const key = keyOf(p, 0);
            if (refused.has(key)) return { point: p, status: 'refused', note: 'the device refuses this reference' };
            if (!readings.has(key)) return { point: p, status: 'no answer', note: 'no value came back for this reference' };
            const raw = readings.get(key);
            const scaled = p.scale.invert ? (raw ? 0 : 1) : roundScaled(raw * p.scale.factor, p.decimals);
            const flags = [];
            if (!p.scale.known) flags.push('scale key "' + p.scaleKey + '" not understood, value shown raw');
            if (p.rangeMin !== null && scaled < p.rangeMin) flags.push('below the list range (' + p.rangeMin + ')');
            if (p.rangeMax !== null && scaled > p.rangeMax) flags.push('above the list range (' + p.rangeMax + ')');
            if (p.decoded.step === 2) flags.push('32-bit word order assumed ' + (p.decoded.bigEndian ? 'big-endian (-i/-f)' : 'little-endian'));
            return { point: p, status: raw === 0 ? 'zero' : 'read', raw, scaled, flags };
        });

        /*
         * Does the whole list sit better one or two references along? Two signals,
         * because either alone is weak. A declared engineering range rules out a
         * wildly wrong reading, but plant ranges are wide and a neighbouring
         * register often fits one too. How many points read non-zero separates
         * them: a list pointed at the right registers mostly finds values, and one
         * pointed a register off finds the gaps between them.
         */
        const polled = list.points.filter(p => p.decoded.ok);
        const withRange = polled.filter(p => p.rangeMin !== null || p.rangeMax !== null);
        const offsets = [];
        for (let shift = -OFFSET_WINDOW; shift <= OFFSET_WINDOW; shift++) {
            let inRange = 0, scored = 0, nonZero = 0, seen = 0;
            for (const p of polled) {
                const key = keyOf(p, shift);
                if (!readings.has(key)) continue;
                seen++;
                const value = readings.get(key);
                if (value !== 0) nonZero++;
                if (p.rangeMin === null && p.rangeMax === null) continue;
                scored++;
                const scaled = value * p.scale.factor;
                const okLow = p.rangeMin === null || scaled >= p.rangeMin;
                const okHigh = p.rangeMax === null || scaled <= p.rangeMax;
                if (okLow && okHigh) inRange++;
            }
            offsets.push({ shift, seen, scored, inRange, nonZero, score: inRange + nonZero });
        }
        const zero = offsets.find(o => o.shift === 0) || { score: 0 };
        const best = offsets.slice().sort((a, b) => (b.score - a.score) || (Math.abs(a.shift) - Math.abs(b.shift)))[0];

        return {
            at: new Date().toISOString(),
            plant: plantIdFromHost(),
            list: { table: list.table, plant: list.plant, subtractOne: list.subtractOne, points: list.points.length, undecodable: list.undecodable },
            device: { mode: spec.mode, host: spec.host, port: spec.port, slave: spec.slave },
            rows,
            summary: {
                points: rows.length,
                read: rows.filter(r => r.status === 'read').length,
                zero: rows.filter(r => r.status === 'zero').length,
                refused: rows.filter(r => r.status === 'refused').length,
                noAnswer: rows.filter(r => r.status === 'no answer').length,
                notPolled: rows.filter(r => r.status === 'not polled').length,
                flagged: rows.filter(r => r.flags && r.flags.length).length,
                ranges: ranges.length,
                elapsedMs: Math.round(performance.now() - started),
            },
            offsets,
            // Only worth saying when there are enough points to mean anything and
            // the winning shift beats staying put by more than one point;
            // otherwise the scores are noise.
            offsetVerdict: (polled.length >= 5 && best && best.shift !== 0 && best.score >= zero.score + 2)
                ? best : null,
            commands,
            diagnostics,
        };
    }

    // ------------------------------------------- a report an agent can read

    /*
     * The point of polling a list is usually to correct it, and the correcting is
     * increasingly done by an agent reading a knowledge file rather than by
     * someone scrolling a grid. So the report is written for that reader: every
     * row states all three address bases, the status is a fixed vocabulary, the
     * conventions are spelled out at the top of every part, and each part stands
     * alone under the 36 000-character ceiling a SharePoint-backed agent will
     * only read whole.
     */
    const REPORT_CHUNK_LIMIT = 30000;
    // How far either way an offset check looks, and therefore how many extra
    // registers each poll range carries so the comparison has something to read.
    const OFFSET_WINDOW = 3;

    function reportHeader(verification, part, parts) {
        const v = verification;
        const s = v.summary;
        return [
            '# Modbus verification — ' + (v.list.table || 'point list') + ' against ' + v.device.host +
                ' slave ' + v.device.slave + (parts > 1 ? ' (part ' + part + ' of ' + parts + ')' : ''),
            '',
            'Polled ' + v.at + ' from IWMAC plant ' + v.plant + ' with Modpoll Console ' + VERSION + '.',
            'Every reading below was taken with modpoll against the live device. Nothing here was written to it.',
            '',
            '## How to read this',
            '',
            '- **addr** is the address as the point list prints it. **protocol** is the Modbus protocol address',
            '  (addr − 1 where the list counts from one: subtract_one is ' + v.list.subtractOne + ').',
            '  **ref** is the 1-based reference modpoll prints, always protocol + 1.',
            '- **raw** is the register as the device returned it; **scaled** is raw multiplied by the list\'s scale key.',
            '- **status** is one of: `read` (a non-zero value came back), `zero` (the device answered 0),',
            '  `refused` (the device refuses that reference — it is outside its map), `no answer`',
            '  (nothing came back), `not polled` (the datatype could not be decoded).',
            '- A device answering `zero` is not proof of a wrong address: many devices answer 0 for',
            '  anything unmapped, and many mapped registers legitimately read 0.',
            '',
            '## Summary',
            '',
            '| points | read | zero | refused | no answer | not polled | flagged | poll commands | elapsed |',
            '|---|---|---|---|---|---|---|---|---|',
            '| ' + [s.points, s.read, s.zero, s.refused, s.noAnswer, s.notPolled, s.flagged, s.ranges, s.elapsedMs + ' ms'].join(' | ') + ' |',
            '',
        ].join('\n');
    }

    function offsetSection(verification) {
        const lines = ['## Offset check', ''];
        if (!verification.offsets.some(o => o.seen)) {
            lines.push('Not scored: nothing came back to compare.');
            lines.push('');
            return lines.join('\n');
        }
        lines.push('Each candidate shift is scored twice: how many points land inside the engineering range their',
            'list entry declares, and how many read non-zero at all. Ranges on a plant are wide enough that a',
            'neighbouring register often fits one too, so the non-zero count is what usually separates them.', '');
        lines.push('| shift | points read | inside their range (of scored) | non-zero | total |', '|---|---|---|---|---|');
        for (const o of verification.offsets) {
            lines.push('| ' + (o.shift > 0 ? '+' + o.shift : o.shift) + ' | ' + o.seen + ' | ' +
                o.inRange + ' of ' + o.scored + ' | ' + o.nonZero + ' | ' + o.score + ' |');
        }
        lines.push('');
        lines.push(verification.offsetVerdict
            ? '**A shift of ' + (verification.offsetVerdict.shift > 0 ? '+' : '') + verification.offsetVerdict.shift +
              ' registers scores better than the list as written.** Treat this as a lead, not a conclusion: confirm against a ' +
              'setpoint whose value is already known before moving every address.'
            : 'No shift scores better than the list as written.');
        lines.push('');
        return lines.join('\n');
    }

    function pointRow(row) {
        const p = row.point;
        const cell = value => (value === undefined || value === null || value === '') ? '' : String(value);
        return '| ' + [
            p.addr, p.protocol, p.ref,
            p.name.replace(/\|/g, '/'),
            p.datatype,
            p.scaleKey,
            cell(row.raw),
            row.scaled === undefined ? '' : (p.decimals ? row.scaled.toFixed(p.decimals) : cell(row.scaled)),
            p.unit,
            row.status,
            (row.flags && row.flags.length ? row.flags.join('; ') : (row.note || '')).replace(/\|/g, '/'),
        ].join(' | ') + ' |';
    }

    /** One markdown file per part, each complete on its own. */
    function buildCopilotReport(verification) {
        const tableHead = [
            '## Points',
            '',
            '| addr | protocol | ref | name | datatype | scale | raw | scaled | unit | status | notes |',
            '|---|---|---|---|---|---|---|---|---|---|---|',
        ].join('\n');

        const attention = verification.rows.filter(r => r.status === 'refused' || r.status === 'no answer' ||
            r.status === 'not polled' || (r.flags && r.flags.some(f => /range/.test(f))));
        const attentionSection = ['', '## Points needing attention', ''].concat(
            attention.length
                ? attention.map(r => '- **' + r.point.name + '** (addr ' + r.point.addr + ', ref ' + r.point.ref + '): ' +
                    r.status + (r.note ? ' — ' + r.note : '') + (r.flags && r.flags.length ? ' — ' + r.flags.join('; ') : ''))
                : ['None: every point was polled and every value sits inside the range its list entry declares.']
        ).join('\n');

        const rows = verification.rows.map(pointRow);
        const fixed = offsetSection(verification) + tableHead + '\n';
        const parts = [];
        let current = [];
        let size = 0;
        for (const row of rows) {
            if (size + row.length + fixed.length + attentionSection.length > REPORT_CHUNK_LIMIT && current.length) {
                parts.push(current); current = []; size = 0;
            }
            current.push(row); size += row.length + 1;
        }
        if (current.length) parts.push(current);

        return parts.map((chunk, index) => ({
            name: 'modpoll-verify_' + (verification.list.table || 'list') + '_' + verification.device.host.replace(/\./g, '-') +
                '_' + nowStamp() + (parts.length > 1 ? '_part' + (index + 1) : '') + '.md',
            text: reportHeader(verification, index + 1, parts.length) + offsetSection(verification) +
                tableHead + '\n' + chunk.join('\n') + '\n' + (index === parts.length - 1 ? attentionSection + '\n' : ''),
        }));
    }

    // ----------------------------------------------- the Plant Server itself

    /*
     * Reaching a serial device means taking its COM port, and the Plant Server
     * holds every one of them because it polls the buses continuously. Stopping
     * it is therefore part of the job — and it is also the most consequential
     * thing anyone does from this page: temperature logging stops, and so do
     * alarms, on a live store.
     *
     * So the console uses the plant's own controls rather than inventing any: the
     * same plant_cmd.php commands the sys_tools page posts when someone clicks
     * Stop or Start there, which are the same ones IWMAC Escape offers locally.
     * Nothing here fires without a second, explicit click, nothing restarts by
     * itself, and a stop this console performed stays on the screen — including
     * after a reload — until the Plant Server is running again.
     */
    const PLANT_CMD_URL = 'plant_cmd.php';
    const PROCESS_INFO_URL = 'plant_data.php?cmd=process_info';
    const STOP_MARK_KEY = 'mpc.plantStoppedAt.v1';

    async function plantCommand(cmd, extra) {
        const response = await fetch(plantUrl(PLANT_CMD_URL), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ cmd }, extra || {})),
            cache: 'no-cache',
        });
        const text = await response.text();
        if (!response.ok) throw new Error('plant_cmd.php answered HTTP ' + response.status + ': ' + text.slice(0, 120));
        return text.trim();
    }

    /** Which plant modules are running, from the page's own status endpoint. */
    async function fetchPlantProcesses() {
        const response = await fetch(plantUrl(PROCESS_INFO_URL), { cache: 'no-cache' });
        const body = await response.json();
        const records = (body && body.records) || [];
        return {
            modules: records.map(r => ({ module: r.module, running: Number(r.status) === 1, since: r.statetime })),
            running: records.filter(r => Number(r.status) === 1).length,
            total: records.length,
        };
    }

    // ------------------------------------------- the bus each unit sits on

    /*
     * sys_tools already knows the topology, and its grid is on this page: which
     * bus every unit hangs off, and whether that bus is an IP or a COM port. A
     * label like "COM1 - 192.168.10.30" is both — a serial port on the plant
     * server that is itself a gateway at that address, which matters because the
     * Plant Server holds the COM port and cannot be asked to share it.
     */
    async function fetchTopologyBuses() {
        const grid = pageWin.w2ui && pageWin.w2ui.grid_topology;
        if (!grid || typeof pageWin.load_grid_data !== 'function') return new Map();
        if (!grid.records.length) {
            pageWin.load_grid_data('topology');
            try { await waitFor(() => grid.records.length || null, 20000, 'the topology grid'); }
            catch (e) { return new Map(); }
        }
        const buses = new Map();
        const walk = (nodes, bus) => {
            for (const node of nodes || []) {
                if (node.unit_id) buses.set(String(node.unit_id).toUpperCase(), bus);
                walk(node.w2ui && node.w2ui.children, node.unit_id ? bus : node.tree);
            }
        };
        walk(grid.records, '');
        return buses;
    }

    /** "COM1 - 192.168.10.30" → both halves; a bare address → just the host. */
    function readBusLabel(label) {
        const text = String(label || '').trim();
        const pair = text.match(/^(COM\d+)\s*-\s*(\S+)$/i);
        if (pair) return { com: pair[1], gateway: pair[2], serial: true };
        if (/^COM\d+$/i.test(text)) return { com: text, gateway: '', serial: true };
        if (/^[\d.]+$/.test(text) || /[a-z]/i.test(text)) return { com: '', gateway: text, serial: false };
        return { com: '', gateway: '', serial: false };
    }

    // ------------------------------------- names from the plant's own database

    /*
     * The plant serves its own configuration over a JSON-RPC endpoint on the same
     * origin as this page, which means no cross-origin helper and no external
     * service: get_regulators lists the units, get_groups and get_parameters give
     * every parameter the plant has for one of them — its alias text, its unit,
     * its current value, and its driver_id.
     *
     * The driver_id is the part that matters. modbusgen writes it as
     * "0_<read_func>_<protocol address>", with ".<bit>" appended for a bit inside
     * a register, behind a prefix naming the plant, driver and table. So
     * "2313_VENT_vent_1_1_0_1_100" is read function 1 — coils — at protocol
     * address 100, which is modpoll's reference 101.
     */
    /**
     * A relative URL resolves against the document's, credentials and all, and
     * fetch refuses to build a request from one that carries them:
     * "Request cannot be constructed from a URL that includes credentials". A
     * plant opened as http://user:pass@2349.plants… therefore cannot call its own
     * endpoints, and Chrome hides that part of the address bar, so the page looks
     * ordinary while every call fails. Resolve and strip.
     */
    function plantUrl(path) {
        try {
            const url = new URL(path, location.href);
            url.username = '';
            url.password = '';
            return url.toString();
        } catch (e) {
            return path;
        }
    }

    const PLANT_RPC_URL = '/services/iwmac_plant/settings.php';
    const RE_DRIVER_ID = /_0_(\d+)_(\d+)(?:\.(\d+))?$/;

    async function plantRpc(method, params) {
        const response = await fetch(plantUrl(PLANT_RPC_URL), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
            cache: 'no-cache',
        });
        const body = await response.json();
        if (body && body.error) throw new Error(String(body.error.message || body.error));
        return body ? body.result : null;
    }

    /** The plant's own unit list. Works without any cross-origin permission. */
    async function fetchPlantRegulators(plantOverride) {
        const plantId = Number(plantOverride || plantIdFromHost());
        if (!plantId) throw new Error('Could not read a plant id from the hostname');
        const result = await plantRpc('get_regulators', { plant: plantId });
        const regulators = (result && result.regulators) || {};
        return Object.keys(regulators).map(key => {
            const r = regulators[key];
            return {
                unit_id: r.unit_id, unit_name: r.unit_name, driver_type: r.unit_type,
                driver_addr: r.unit_addr, status: r.unit_status,
            };
        });
    }

    // The plant returns display HTML — tags around an alarm state, and entities
    // for the units, so a temperature arrives as "&deg;C". Decoding through an
    // element handles every entity rather than the three worth hard-coding.
    const entityDecoder = document.createElement('textarea');
    function stripTags(html) {
        entityDecoder.innerHTML = String(html == null ? '' : html).replace(/<[^>]*>/g, '');
        return entityDecoder.value.replace(/ /g, ' ').trim();
    }

    function parseParameterCsvLine(line) {
        const fields = [];
        let value = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (quoted) {
                if (ch === '"' && line[i + 1] === '"') { value += '"'; i++; }
                else if (ch === '"') quoted = false;
                else value += ch;
            } else if (ch === '"') quoted = true;
            else if (ch === ',') { fields.push(value); value = ''; }
            else value += ch;
        }
        fields.push(value);
        return fields;
    }

    /**
     * Every parameter the plant holds for one unit, indexed by the register it
     * reads. Several parameters can share a register — one per bit — so the index
     * holds a list per reference rather than a single name.
     */
    const _namesCache = new Map();

    async function fetchPlantNames(unitId, plantOverride) {
        const plantId = Number(plantOverride || plantIdFromHost());
        if (!plantId) throw new Error('Could not read a plant id from the hostname');
        const cacheKey = plantId + '|' + unitId;
        if (_namesCache.has(cacheKey)) return _namesCache.get(cacheKey);
        const groups = (await plantRpc('get_groups', { plant: plantId, unit_id: unitId })) || [];
        const byRef = new Map();
        let rows = 0;
        let undecodable = 0;
        // A parameter whose driver_id names no register is the driver's own —
        // Communication error, Communication status — and is the unit's health
        // as IWMAC sees it: kept, not only counted.
        const system = [];
        for (const group of groups) {
            const result = await plantRpc('get_parameters', {
                plant: plantId, unit_id: unitId, group: group.id, preffered_group: '',
            }) || {};
            for (const side of ['read', 'write']) {
                for (const line of String(result[side] || '').split('\n')) {
                    const text = line.trim();
                    if (!text) continue;
                    rows++;
                    const fields = parseParameterCsvLine(text);
                    const driverId = fields[3] || '';
                    const match = driverId.match(RE_DRIVER_ID);
                    const table = match ? FUNC_TO_TABLE[Number(match[1])] : null;
                    if (!match || !table) {
                        undecodable++;
                        system.push({ name: fields[0] || '', shown: stripTags(fields[1]), unit: stripTags(fields[2]), group: group.alias_text || '', driverId });
                        continue;
                    }
                    const ref = Number(match[2]) + 1;
                    const key = table + '||' + ref;
                    const entry = {
                        name: fields[0] || '',
                        plantValue: stripTags(fields[1]),
                        unit: stripTags(fields[2]),
                        bit: match[3] === undefined ? null : Number(match[3]),
                        group: group.alias_text || '',
                        access: side === 'write' ? 'rw' : 'r',
                        driverId,
                        table,
                        ref,
                        protocol: Number(match[2]),
                    };
                    if (!byRef.has(key)) byRef.set(key, []);
                    byRef.get(key).push(entry);
                }
            }
        }
        const names = { unitId, byRef, groups: groups.length, rows, undecodable, system, at: new Date().toISOString() };
        _namesCache.set(cacheKey, names);
        return names;
    }

    // --------------------------------------------- unit list from the plant DB

    // Identifies this script to the Toolbox API the way AK3-Autoscan, Topology
    // Copy and SQL Equipment Import do. X-Caller is constant. X-Run-Id groups
    // every request for one plant under one run — the unit list, the scan's
    // look at IWMAC's setup, the driver log — so the Toolbox log reads them as
    // one operation; a new one is minted only when the plant_id changes, which
    // in a tab bound to one plant by its URL means once per tab.
    const makeRunId = () => ((typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID() : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)));
    let _runId = makeRunId();
    let _runIdPlant = null;
    function ensureRunIdForPlant(plantId) {
        const pid = String(plantId || '');
        if (pid && _runIdPlant !== pid) {
            _runId = makeRunId();
            _runIdPlant = pid;
            console.debug('[Modpoll Console] New X-Run-Id for plant ' + pid + ': ' + _runId);
        }
        return _runId;
    }

    function gmPostJson(url, payload) {
        const runId = ensureRunIdForPlant(payload && payload.plant_id);
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest not granted'));
            GM_xmlhttpRequest({
                method: 'POST', url, timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Caller': X_CALLER,
                    'X-Run-Id': runId,
                },
                data: JSON.stringify(payload),
                onload: r => {
                    try { resolve({ status: r.status, body: JSON.parse(r.responseText) }); }
                    catch (e) { reject(new Error('Bad JSON from the plant-SQL API: ' + String(r.responseText).slice(0, 200))); }
                },
                onerror: () => reject(new Error('plant-SQL API network error (X-Run-Id ' + runId + ')')),
                ontimeout: () => reject(new Error('plant-SQL API timeout (X-Run-Id ' + runId + ')')),
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

    /**
     * The unit list, from whichever source can answer. The plant's own RPC is on
     * this origin and always available; the Toolbox query adds what it alone
     * knows — the resolved IP, the baud rate, the parity — and is allowed to fail.
     */
    async function fetchUnits(force) {
        if (_unitsCache && !force) return _unitsCache;
        const plantId = plantIdFromHost();
        if (!plantId) throw new Error('Could not read a plant id from the hostname');

        let rows = [];
        try {
            const res = await gmPostJson(TOOLBOX_SQL_URL, { plant_id: plantId, sql_command: UNITS_SQL });
            if (!res.body || !res.body.success) {
                throw new Error((res.body && (res.body.error || res.body.message)) || ('HTTP ' + res.status));
            }
            rows = (res.body.results && res.body.results[0] && res.body.results[0].data) || [];
        } catch (e) {
            log('Toolbox unit query unavailable (' + e.message + ') — using the plant\'s own list', 'warn');
            rows = await fetchPlantRegulators();
        }
        const buses = await fetchTopologyBuses();
        _unitsCache = rows.map(r => {
            const preset = presetFor(r.driver_type) || {};
            const bus = readBusLabel(buses.get(String(r.unit_id || '').toUpperCase()));
            // The topology decides serial or network, because it is the only
            // source that says which bus the unit actually hangs off.
            const serial = bus.serial || /RTU|ASCII/i.test(r.connection_type || '');
            return {
                bus,
                unit_id: r.unit_id,
                unit_name: r.unit_name,
                driver_type: r.driver_type,
                driver_addr: r.driver_addr,
                connection: r.connection_type || (bus.serial ? 'Modbus RTU' : (bus.gateway ? 'Modbus TCP' : '')),
                mode: serial ? (/ASCII/i.test(r.connection_type || '') ? 'ascii' : 'rtu') : 'tcp',
                host: serial ? (bus.com || r.comm_port || '') : (r.resolved_address || bus.gateway || ''),
                slave: slaveFromDriverAddr(r.driver_addr),
                baudrate: r.baudrate || preset.baudrate || '9600',
                parity: (r.parity || preset.parity || 'none').toLowerCase(),
                databits: preset.databits || '8',
                stopbits: preset.stopbits || '1',
            };
        });
        return _unitsCache;
    }

    // ------------------------------------------ the IWMAC side of one unit

    /*
     * What IWMAC itself knows about the unit a scan is for — the other half of
     * every comparison the export makes. modpoll says what the device answers;
     * this says how IWMAC is set up to ask and what it made of the answers:
     *
     *   registration   unit id, name, driver, driver address, parameter table, active
     *   driver         every setting of the driver (serial or TCP, timeouts, retries),
     *                  its process and whether that module is running now
     *   parameters     how IWMAC defines each parameter: raw type, word swap, scale,
     *                  format, access, and whether it is polled at all
     *   health         the unit's status and last contact, its Communication error and
     *                  status parameters, and the Plant Server log lines of its driver
     *   bus            the other units on the same driver, and other drivers set to
     *                  the same COM port
     *
     * Each part is read on its own and may fail on its own. The plant's own pages
     * always answer; the Toolbox plant-SQL API needs GM_xmlhttpRequest. A part that
     * could not be read is named in `unavailable`, never silently left out.
     */
    let iwmacContext = null;
    const RE_SQL_NAME = /^[A-Za-z0-9_]+$/;
    const sqlText = value => String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/'/g, "''");

    async function plantSql(sql) {
        const res = await gmPostJson(TOOLBOX_SQL_URL, { plant_id: plantIdFromHost(), sql_command: sql });
        if (!res.body || !res.body.success) throw new Error((res.body && (res.body.error || res.body.message)) || ('HTTP ' + res.status));
        return (res.body.results && res.body.results[0] && res.body.results[0].data) || [];
    }

    /** The Plant Server log, the same text sys_tools shows under Logs, newest line first. */
    async function fetchPlantLog() {
        const response = await fetch(plantUrl('plant_files.php'), {
            method: 'POST', body: JSON.stringify({ category: 'sql', cmd: 'sql_plant_log' }), cache: 'no-cache',
        });
        if (!response.ok) throw new Error('plant_files.php answered HTTP ' + response.status);
        return String(await response.text());
    }

    /*
     * One driver's lines of the Plant Server log, newest first. The plant keeps
     * the log in a table per month — ix_dyn_plant_log_YYYY_MM (row_msec, owner,
     * msg_type, value), the current month in iw_plant_server3 and older ones in
     * iw_dyn_logs_archive — so a driver's lines can be asked for by owner.
     * plant_files.php, which the Logs view shows, is the last 500 lines of every
     * module together, and on plant 2349 PHP-APP's line per virtual value filled
     * all 500 within ninety minutes: not one driver line was left in it. It is
     * the fallback for when the Toolbox is out of reach, and says so.
     */
    const DRIVER_LOG_LINES = 400;

    async function fetchDriverLog(owner) {
        const month = d => d.getFullYear() + '_' + String(d.getMonth() + 1).padStart(2, '0');
        const now = new Date();
        const select = (table, limit) => plantSql('SELECT row_msec, msg_type, value FROM ' + table + " WHERE owner = '" + owner + "' ORDER BY row_msec DESC LIMIT " + limit);
        try {
            const current = 'iw_plant_server3.ix_dyn_plant_log_' + month(now);
            const rows = await select(current, DRIVER_LOG_LINES);
            const sources = [current];
            if (rows.length < DRIVER_LOG_LINES / 2) {
                // Early in a month the driver's last start may be in the previous one.
                const previous = 'iw_dyn_logs_archive.ix_dyn_plant_log_' + month(new Date(now.getFullYear(), now.getMonth() - 1, 1));
                try { rows.push(...await select(previous, DRIVER_LOG_LINES - rows.length)); sources.push(previous); } catch (e) { /* not archived yet */ }
            }
            return {
                source: sources.join(' + '),
                entries: rows.map(r => ({ at: new Date(Number(r.row_msec)).toISOString(), level: Number(r.msg_type) || 0, text: String(r.value == null ? '' : r.value).trim() })),
            };
        } catch (e) {
            const entries = [];
            for (const line of (await fetchPlantLog()).split(/\r?\n/)) {
                const f = line.split('\t');
                if (f.length < 4 || String(f[1] || '').trim() !== owner) continue;
                const local = new Date(String(f[0]).trim().replace(' ', 'T').replace(/(\.\d{3})\d*$/, '$1'));
                entries.push({ at: Number.isNaN(local.getTime()) ? String(f[0]).trim() : local.toISOString(), level: Number(String(f[2]).trim()) || 0, text: f.slice(3).join(' ').trim() });
            }
            return { source: 'plant_files.php, the last 500 lines of the whole Plant Server log — the log table was out of reach (' + e.message + ')', entries };
        }
    }

    // What a driver's log line reports, by the wording the IWMAC drivers use —
    // "Block (norm, 0) item <driver_id> >> Modbus read error >> Time Out Error",
    // "Unit ID01 is OFFLINE", "Open ok, (IP address: …)", "Write failed 19423 = 1.00".
    // The first that matches names the line.
    const LOG_KINDS = [
        { kind: 'timeout', re: /time ?out/i },
        { kind: 'invalidResponse', re: /invalid returned device response|invalid (frame|response)|crc/i },
        { kind: 'exception', re: /exception|illegal data|illegal function/i },
        { kind: 'readError', re: /read error/i },
        { kind: 'offline', re: /is OFFLINE/i },
        { kind: 'online', re: /is ONLINE/i },
        { kind: 'writeFailed', re: /write failed/i },
        { kind: 'write', re: /param write:/i },
        { kind: 'portOpened', re: /Open comm port.*SUCCESS|^Open ok/i },
        { kind: 'portFailed', re: /Open comm port.*(FAIL|ERROR)|could not open|open (failed|error)/i },
        { kind: 'tcpError', re: /TCP\/IP connection error|connect(ion)? (failed|refused|error)/i },
        { kind: 'serverLinkLost', re: /WS: Server lost/i },
        { kind: 'started', re: /Application \S+ started/i },
        { kind: 'closed', re: /Close OK/i },
    ];
    const LOG_LEVELS = { 0: 'info', 1: 'warning', 2: 'warning', 3: 'error' };

    /**
     * The driver's log read for one unit. A driver serves every unit on its bus,
     * so a line naming another unit — its OFFLINE, a failed item at its address
     * — is counted apart, under otherUnits, and never against this one. `current`
     * counts only what came after the driver last started or this unit last came
     * back online, whichever is later: errors from before either are history.
     */
    function readDriverLog(log, who) {
        const { owner, unitId, table, unitPrefix, tablePrefix } = who;
        const mine = [];
        const otherUnits = {};
        const byDriverId = {};
        for (const e of (log.entries || [])) {
            const hit = LOG_KINDS.find(k => k.re.test(e.text));
            const entry = Object.assign({ kind: hit ? hit.kind : 'other' }, e);
            const unitLine = entry.text.match(/\bUnit (\S+) is (?:OFFLINE|ONLINE)/i);
            const item = (entry.text.match(/\bitem (\S+)/) || [])[1] || null;
            let other = null;
            if (unitLine && unitId && unitLine[1] !== unitId) other = unitLine[1];
            else if (item && unitPrefix && item.indexOf(unitPrefix) !== 0) {
                other = tablePrefix && item.indexOf(tablePrefix) === 0
                    ? 'address ' + item.slice(tablePrefix.length).replace(/_0_\d+_\d+(?:\.\d+)?$/, '')
                    : item.replace(/_0_\d+_\d+(?:\.\d+)?$/, '');
            } else if (item && !unitPrefix && table && item.indexOf('_' + table + '_') < 0) other = item.replace(/_0_\d+_\d+(?:\.\d+)?$/, '');
            if (other) {
                const o = otherUnits[other] || (otherUnits[other] = { lines: 0, kinds: {} });
                o.lines++;
                o.kinds[entry.kind] = (o.kinds[entry.kind] || 0) + 1;
                continue;
            }
            mine.push(entry);
            if (item && LOG_TROUBLE.indexOf(entry.kind) >= 0) {
                const agg = byDriverId[item] || (byDriverId[item] = { errors: 0, kinds: {}, last: null });
                agg.errors++;
                agg.kinds[entry.kind] = (agg.kinds[entry.kind] || 0) + 1;
                if (!agg.last || entry.at > agg.last.at) agg.last = { at: entry.at, text: entry.text.replace(/.*>>\s*/, '') };
            }
        }
        const count = list => list.reduce((c, e) => { c[e.kind] = (c[e.kind] || 0) + 1; return c; }, {});
        // Newest first: the first start and the first online met are the latest.
        const lastStart = (mine.find(e => e.kind === 'started') || {}).at || null;
        const lastOnline = (mine.find(e => e.kind === 'online') || {}).at || null;
        const since = lastOnline && (!lastStart || lastOnline > lastStart) ? lastOnline : lastStart;
        const current = since ? mine.filter(e => e.at >= since) : mine;
        return {
            source: log.source, owner, lines: mine.length,
            from: mine.length ? mine[mine.length - 1].at : null, to: mine.length ? mine[0].at : null,
            lastStart, counts: count(mine),
            current: {
                since, after: !since ? 'the whole window' : (since === lastStart ? 'the driver last started' : 'this unit last came back online'),
                counts: count(current),
            },
            otherUnits: Object.keys(otherUnits).length ? otherUnits : null,
            byDriverId,
            // Newest first, as the log itself is — enough to see the last start,
            // the connection opening and the errors after it, not the month.
            recent: mine.slice(0, 40).map(e => e.at + ' [' + (LOG_LEVELS[e.level] || e.level) + ', ' + e.kind + '] ' + e.text.replace(/\s+/g, ' ').slice(0, 180)),
        };
    }

    /** "3_0_F_W_-_-_-_-" — read function, address, raw type, swap, then the same for writes. */
    function parseDriverIdExtra(extra) {
        const p = String(extra || '').split('_');
        if (p.length < 4) return null;
        const num = v => (v === '-' || v === '' || v === undefined ? null : Number(v));
        return {
            readFunction: num(p[0]), readAddr: num(p[1]), rawType: p[2] === '-' ? null : p[2], swap: p[3] === '-' ? null : p[3],
            writeFunction: num(p[4]), writeAddr: num(p[5]), writeRawType: p[6] && p[6] !== '-' ? p[6] : null,
        };
    }

    async function collectIwmacContext(unitId) {
        const ctx = { unitId, collectedAt: new Date().toISOString(), unavailable: [] };
        const miss = (what, e) => ctx.unavailable.push(what + ': ' + (e && e.message ? e.message : String(e)));
        const plantId = Number(plantIdFromHost());

        // Status and last contact, from the plant's own list — no permission needed.
        try {
            const regs = ((await plantRpc('get_regulators', { plant: plantId })) || {}).regulators || {};
            const r = Object.values(regs).find(x => x.unit_id === unitId);
            // unit_type is the regulator family ("OJ"), not the parameter table.
            if (r) ctx.status = { unitStatus: r.unit_status || null, lastComm: r.last_comm || null, unitAddr: r.unit_addr || null, unitType: r.unit_type || null, order: r.unit_order };
        } catch (e) { miss('unit status (get_regulators)', e); }

        // Registration, and through it the driver and the parameter table.
        let owner = null, table = null;
        try {
            const rows = await plantSql("SELECT unit_id, unit_name, driver_type, driver_addr, grp_name, active, regulator_type, order_no FROM iw_plant_server3.iw_sys_plant_units WHERE unit_id = '" + sqlText(unitId) + "'");
            if (rows[0]) {
                const u = rows[0];
                owner = RE_SQL_NAME.test(u.driver_type || '') ? u.driver_type : null;
                table = RE_SQL_NAME.test(u.grp_name || '') ? u.grp_name : null;
                ctx.registration = { unitId: u.unit_id, unitName: u.unit_name, driver: u.driver_type, driverAddr: u.driver_addr, table: u.grp_name, active: String(u.active) === '1', regulatorType: u.regulator_type || '', orderNo: u.order_no || '' };
            } else ctx.registration = null;
        } catch (e) { miss('unit registration (Toolbox plant-SQL)', e); }

        if (owner) {
            ctx.driver = { owner };
            try {
                const rows = await plantSql("SELECT setting, value FROM iw_plant_server3.iw_sys_plant_settings WHERE owner = '" + owner + "' ORDER BY setting");
                const settings = {};
                for (const r of rows) settings[r.setting] = r.value;
                ctx.driver.settings = settings;
                ctx.driver.connection = describeDriverConnection(settings, ctx.registration && ctx.registration.driverAddr);
            } catch (e) { miss('driver settings (Toolbox plant-SQL)', e); }
            try {
                const rows = await plantSql("SELECT process_name, path, man_start FROM iw_plant_server3.iw_sys_processes WHERE process_name = '" + owner + "'");
                ctx.driver.process = rows[0] ? { name: rows[0].process_name, path: rows[0].path, manualStart: String(rows[0].man_start) === '1' } : null;
            } catch (e) { miss('driver process registration (Toolbox plant-SQL)', e); }
            try {
                const processes = await fetchPlantProcesses();
                const m = processes.modules.find(x => x.module === owner);
                ctx.driver.module = m ? { running: m.running, stateTime: m.since === undefined ? null : m.since } : { running: false, note: 'no module of this name among the Plant Server\'s processes' };
                const master = processes.modules.find(x => x.module === 'MASTER');
                ctx.driver.plantServerRunning = master ? master.running : null;
            } catch (e) { miss('module status (process_info)', e); }
            try {
                ctx.bus = { unitsOnDriver: [], driversOnSamePort: [] };
                const units = await plantSql("SELECT unit_id, unit_name, driver_addr, grp_name, active FROM iw_plant_server3.iw_sys_plant_units WHERE driver_type = '" + owner + "' ORDER BY driver_addr");
                ctx.bus.unitsOnDriver = units.map(u => ({ unitId: u.unit_id, unitName: u.unit_name, driverAddr: u.driver_addr, table: u.grp_name, active: String(u.active) === '1' }));
                const conn = ctx.driver.connection;
                if (conn && conn.serial && conn.comPort !== null) {
                    const others = await plantSql("SELECT owner, value FROM iw_plant_server3.iw_sys_plant_settings WHERE setting = 'comm_port' AND owner <> '" + owner + "' AND value = '" + sqlText(conn.comPortRaw) + "'");
                    for (const o of others) {
                        if (!RE_SQL_NAME.test(o.owner || '')) continue;
                        const mode = await plantSql("SELECT value FROM iw_plant_server3.iw_sys_plant_settings WHERE owner = '" + o.owner + "' AND setting = 'mb_mode'");
                        const active = await plantSql("SELECT COUNT(*) AS n FROM iw_plant_server3.iw_sys_plant_units WHERE driver_type = '" + o.owner + "' AND active = '1'");
                        ctx.bus.driversOnSamePort.push({ owner: o.owner, mbMode: mode[0] ? mode[0].value : null, activeUnits: Number(active[0] && active[0].n) || 0 });
                    }
                }
            } catch (e) { miss('bus (Toolbox plant-SQL)', e); }
        }

        // How IWMAC defines every parameter of the unit's table, and whether it polls it.
        if (table) {
            ctx.parameters = { table, definitions: {} };
            try {
                const rows = await plantSql('SELECT element_id, driver_id, driver_id_extra, att, eng_unit, format, scale, raw_min, raw_max, eng_min, eng_max, parameter_type, application FROM iw_plant_server3.iw_par_' + table + '_param');
                for (const r of rows) {
                    ctx.parameters.definitions[r.driver_id] = {
                        elementId: r.element_id, access: r.att, unit: r.eng_unit, format: r.format,
                        scale: { mode: r.scale, rawMin: r.raw_min, rawMax: r.raw_max, engMin: r.eng_min, engMax: r.eng_max },
                        datatype: parseDriverIdExtra(r.driver_id_extra), datatypeText: r.driver_id_extra,
                        parameterType: r.parameter_type, application: r.application,
                    };
                }
                ctx.parameters.count = rows.length;
            } catch (e) { miss('parameter definitions iw_par_' + table + '_param (Toolbox plant-SQL)', e); }
            try {
                const rows = await plantSql('SELECT element_id, active, onl_ind, update_freq, alarm_type FROM iw_plant_server3.iw_set_' + table);
                const byElement = {};
                for (const r of rows) byElement[r.element_id] = r;
                let inactive = 0;
                for (const def of Object.values(ctx.parameters.definitions)) {
                    const s = byElement[def.elementId];
                    if (!s) { def.active = null; continue; }
                    def.active = String(s.active) === '1';
                    // The parameter the driver judges the unit online by.
                    if (String(s.onl_ind) === '1') def.onlineIndicator = true;
                    if (s.update_freq) def.updateFreq = s.update_freq;
                    if (s.alarm_type && String(s.alarm_type) !== '0') def.alarmType = s.alarm_type;
                    if (!def.active) inactive++;
                }
                ctx.parameters.inactive = inactive;
            } catch (e) { miss('parameter settings iw_set_' + table + ' (Toolbox plant-SQL)', e); }
        }

        // What the driver has written to the Plant Server log.
        if (owner) {
            const driverAddr = ctx.registration ? ctx.registration.driverAddr : null;
            const tablePrefix = table ? plantId + '_' + owner + '_' + table + '_' : null;
            try {
                ctx.log = readDriverLog(await fetchDriverLog(owner), {
                    owner, unitId, table, tablePrefix, unitPrefix: tablePrefix && driverAddr ? tablePrefix + driverAddr + '_' : null,
                });
            } catch (e) { miss('driver log (Plant Server log table or plant_files.php)', e); }
        }
        return ctx;
    }

    /** A driver's settings read as the connection they describe. */
    function describeDriverConnection(settings, driverAddr) {
        const s = settings || {};
        const mode = { 0: 'rtu', 1: 'ascii', 2: 'tcp' }[String(s.mb_mode)] || null;
        const parity = { 0: 'none', 1: 'odd', 2: 'even', 3: 'mark', 4: 'space' }[String(s.comm_parity)] || (s.comm_parity || null);
        const portNumber = String(s.comm_port || '').replace(/^.*COM/i, '');
        const addrParts = String(driverAddr || '').split('_').filter(Boolean);
        const out = {
            mode, serial: mode === 'rtu' || mode === 'ascii',
            slave: addrParts.length ? Number(addrParts[addrParts.length - 1]) : null,
            serverKey: addrParts.length > 1 ? addrParts[0] : null,
            requestTimeoutMs: s.mb_request_timeout !== undefined ? Number(s.mb_request_timeout) : null,
            requestRetries: s.mb_request_retries !== undefined ? Number(s.mb_request_retries) : null,
        };
        if (out.serial) {
            Object.assign(out, {
                comPort: /^\d+$/.test(portNumber) ? 'COM' + portNumber : (s.comm_port || null), comPortRaw: s.comm_port || '',
                baudrate: s.comm_baudrate !== undefined ? String(s.comm_baudrate) : null, parity,
                databits: s.comm_data_bits !== undefined ? String(s.comm_data_bits) : null,
                stopbits: s.comm_stop_bits !== undefined ? String(s.comm_stop_bits) : null,
                packetTimeout: s.packet_timeout !== undefined ? Number(s.packet_timeout) : null,
                rs485Mode: s.enablers485mode !== undefined ? String(s.enablers485mode) : null,
            });
        } else if (mode === 'tcp') {
            // mb_tcp_servers: one line per server, "key;ip;port;connect timeout;retries;…".
            const servers = String(s.mb_tcp_servers || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
                const f = l.split(';');
                return { key: f[0], host: f[1] || null, port: f[2] ? Number(f[2]) : 502, connectTimeoutMs: f[3] ? Number(f[3]) : null, connectRetries: f[4] ? Number(f[4]) : null };
            });
            out.servers = servers;
            const own = servers.find(x => x.key === out.serverKey) || null;
            out.host = own ? own.host : null;
            out.port = own ? own.port : null;
        }
        return out;
    }

    // ------------------------------------------------------- binary self-probe

    let _usageCache = null;

    /**
     * Ask the binary itself what it supports. Plants do not all carry the same
     * build, and -h is the only source that cannot be out of date.
     */
    async function probeBinary(force) {
        if (_usageCache && !force) return _usageCache;
        const raw = await termRun(exePath + ' -h', { timeoutMs: 15000, settleMs: 900 });
        _usageCache = {
            usage: raw.trim(),
            hasTcpPortFlag: /-p\s+#?\s*(tcp\s+)?port/i.test(raw),
            version: (raw.match(/modpoll\s+([0-9.]+)/i) || [])[1] || null,
        };
        return _usageCache;
    }

    // ------------------------------------------------------------------- UI

    /*
     * Layout rules, in one place because they are the whole reason the panel reads
     * as a form rather than a pile of controls:
     *
     *   - every control is border-box, so a declared width is the width on screen;
     *   - the form is one 12-column grid, so controls in different rows share
     *     column edges instead of each row packing itself;
     *   - labels have a fixed height, so every control in a row starts at the same
     *     baseline whether its label wraps or not;
     *   - one control height (--h) for inputs, selects and buttons alike;
     *   - the body scrolls vertically only. Nothing may cause a sideways scrollbar.
     */
    const STYLE = `
    #${PANEL_ID}{--h:27px;--gap:8px;--line:#c8ccd4;--label:#6a7180;--focus:#5b9dd9;
        height:100%;display:flex;flex-direction:column;overflow:hidden;
        font:12px/1.4 Arial,Helvetica,sans-serif;color:#1b1b1b;background:#fff}
    #${PANEL_ID} *,#${PANEL_ID} *::before,#${PANEL_ID} *::after{box-sizing:border-box}
    #${PANEL_ID} .mpc-head{display:flex;align-items:center;gap:8px;padding:6px 10px;flex:0 0 auto;
        background:linear-gradient(#fbfbfb,#f1f1f1);border-bottom:1px solid var(--line)}
    #${PANEL_ID} .mpc-title{font-weight:bold;font-size:12px}
    #${PANEL_ID} .mpc-ver{color:var(--label);font-size:11px}
    #${PANEL_ID} .mpc-dot{width:9px;height:9px;border-radius:50%;background:#c3c7cf;margin-left:auto;flex:0 0 auto;
        border:1px solid rgba(0,0,0,.15)}
    #${PANEL_ID} .mpc-dot.ok{background:#4caf50}#${PANEL_ID} .mpc-dot.warn{background:#f0ad4e}#${PANEL_ID} .mpc-dot.err{background:#d9534f}
    /* The table's own corner control, past the last column heading. The zone is
       only there to give it something to be pinned to: absolute inside the
       scrolling table would scroll away with the rows. The right offset is set
       from script, because the scrollbar it has to clear comes and goes. */
    #${PANEL_ID} .mpc-gridzone{grid-column:span 12;position:relative;min-width:0}
    #${PANEL_ID} .mpc-expand{position:absolute;top:3px;right:4px;z-index:2;
        width:20px;height:19px;padding:0;line-height:0;cursor:pointer;color:#79808c;
        display:flex;align-items:center;justify-content:center;
        background:#f6f7f9;border:1px solid var(--line);border-radius:3px}
    #${PANEL_ID} .mpc-expand:hover{color:#1b5fa8;background:#eef4fb;border-color:#8a9099}
    #${PANEL_ID} .mpc-expand svg{width:12px;height:12px;display:block}
    /* Expanded: the table's zone is the whole page inside this tab, over the
       shell and the rest of the console. Not the browser's fullscreen — the
       chrome and the desktop stay. The table fills the zone by flex; the grip's
       inline cap is lifted by script while this rule is in force. */
    #${PANEL_ID} .mpc-gridzone.mpc-full{position:fixed;inset:0;z-index:2147483000;
        display:flex;flex-direction:column;background:#fff}
    #${PANEL_ID} .mpc-gridzone.mpc-full .mpc-gridwrap{flex:1 1 auto;min-height:0;max-height:none;border-radius:0}
    #${PANEL_ID} .mpc-body{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:10px 12px 12px}

    /* The 12-column form grid. A field declares how many columns it takes, so
       controls in different rows share column edges instead of each row packing
       itself. Labels have a fixed height, so every control starts at one baseline. */
    /* Capped: the main panel is as wide as the browser window, and a form stretched
       across 2300 px stops reading as a form. */
    #${PANEL_ID} .mpc-form{display:grid;grid-template-columns:repeat(12,1fr);gap:var(--gap);align-items:end;max-width:1120px}
    #${PANEL_ID} .mpc-f{grid-column:span 3;min-width:0;display:flex;flex-direction:column}
    #${PANEL_ID} .mpc-f>label{font-size:10.5px;color:var(--label);height:15px;line-height:15px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #${PANEL_ID} input,#${PANEL_ID} select{height:var(--h);width:100%;background:#fff;color:#1b1b1b;
        border:1px solid var(--line);border-radius:3px;font:12px/1 Arial,Helvetica,sans-serif;padding:0 7px}
    #${PANEL_ID} select{cursor:pointer;padding:0 4px 0 6px}
    #${PANEL_ID} input::placeholder{color:#a3a8b3}
    #${PANEL_ID} input:focus,#${PANEL_ID} select:focus{outline:none;border-color:var(--focus);box-shadow:0 0 0 2px rgba(91,157,217,.22)}
    /* Buttons keep w2ui's own look — .w2ui-btn supplies the colours, this only
       fixes the metrics so they line up with the inputs beside them. */
    #${PANEL_ID} button.mpc-b{height:var(--h);padding:0 12px;font:12px/1 Arial,Helvetica,sans-serif;
        white-space:nowrap;cursor:pointer;margin:0}
    #${PANEL_ID} .mpc-f>button.mpc-b{width:100%}
    #${PANEL_ID} button.mpc-b[disabled]{opacity:.45;cursor:default}
    #${PANEL_ID} button.mpc-b.pri{background:#3f7fbf;border-color:#36699d;color:#fff;font-weight:bold}
    #${PANEL_ID} button.mpc-b.pri:hover:not([disabled]){background:#356fa8}

    #${PANEL_ID} .mpc-span2{grid-column:span 2}#${PANEL_ID} .mpc-span3{grid-column:span 3}
    #${PANEL_ID} .mpc-span4{grid-column:span 4}#${PANEL_ID} .mpc-span5{grid-column:span 5}
    #${PANEL_ID} .mpc-span6{grid-column:span 6}#${PANEL_ID} .mpc-span8{grid-column:span 8}
    #${PANEL_ID} .mpc-span9{grid-column:span 9}#${PANEL_ID} .mpc-span12{grid-column:span 12}
    #${PANEL_ID} .mpc-hidden{display:none}

    #${PANEL_ID} .mpc-sep{grid-column:span 12;height:1px;background:#e4e6ea;margin:3px 0 1px}
    #${PANEL_ID} .mpc-banner{grid-column:span 12;padding:7px 10px;border-radius:4px;font-size:12px;
        background:#fdecea;border:1px solid #f0b4ae;color:#8a2a20}
    #${PANEL_ID} button.mpc-b.danger{background:#c0392b;border-color:#a5301f;color:#fff;font-weight:bold}
    #${PANEL_ID} button.mpc-b.danger:hover:not([disabled]){background:#a5301f}
    /* Under the action row while something long runs: a thin bar and one line
       saying what is happening. Hidden the rest of the time. */
    #${PANEL_ID} .mpc-progress{grid-column:span 12;display:flex;align-items:center;gap:10px;font-size:11px;color:#4a4f5a;min-height:16px}
    #${PANEL_ID} .mpc-progress.mpc-hidden{display:none}
    #${PANEL_ID} .mpc-bar{flex:1 1 auto;height:6px;border-radius:3px;background:#e4e6ea;overflow:hidden}
    #${PANEL_ID} .mpc-bar>div{height:100%;width:0;background:#3f7fbf;transition:width .15s linear}
    #${PANEL_ID} .mpc-ptext{flex:0 0 auto;max-width:62%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #${PANEL_ID} .mpc-actions{grid-column:span 12;display:flex;gap:var(--gap);align-items:flex-end;flex-wrap:wrap}
    #${PANEL_ID} .mpc-actions .mpc-f{width:78px}
    #${PANEL_ID} .mpc-actions .mpc-spacer{flex:1 1 auto}
    #${PANEL_ID} .mpc-cmd{font-family:Consolas,ui-monospace,monospace;font-size:11.5px}
    #${PANEL_ID} .mpc-note{grid-column:span 12;font-size:11px;color:var(--label);margin:-3px 0 0;min-height:14px}
    #${PANEL_ID} .mpc-check{grid-column:span 6;display:flex;align-items:center;gap:6px;font-size:11.5px;
        color:#3a3f4a;height:var(--h);cursor:pointer}
    #${PANEL_ID} .mpc-check input{width:14px;height:14px;padding:0;accent-color:#3f7fbf}

    #${PANEL_ID} .mpc-gridwrap{max-height:340px;overflow-y:auto;overflow-x:hidden;
        border:1px solid var(--line);border-radius:3px;background:#fff}
    #${PANEL_ID} table.mpc-grid{width:100%;table-layout:fixed;border-collapse:collapse;font:11.5px Consolas,ui-monospace,monospace}
    #${PANEL_ID} table.mpc-grid th{position:sticky;top:0;z-index:1;background:linear-gradient(#fbfbfb,#eff0f2);
        text-align:right;padding:5px 8px;font:bold 11px Arial,Helvetica,sans-serif;color:#4a4f5a;
        border-bottom:1px solid var(--line)}
    #${PANEL_ID} table.mpc-grid td{text-align:right;padding:3px 8px;border-bottom:1px solid #eceef1;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${PANEL_ID} table.mpc-grid tbody tr:nth-child(even) td{background:#f7f8fa}
    #${PANEL_ID} table.mpc-grid td.zero{color:#a3a8b3}
    #${PANEL_ID} table.mpc-grid td.changed{color:#1b5fa8;font-weight:bold}
    #${PANEL_ID} table.mpc-grid td.bad{color:#c0392b}
    #${PANEL_ID} table.mpc-grid tr.mpc-clickable{cursor:pointer}
    #${PANEL_ID} table.mpc-grid tr.mpc-clickable:hover td{background:#eef4fb}
    /* The grid's own cells are nowrap, and white-space inherits — without this the
       detail view cannot wrap a single line of it. */
    #${PANEL_ID} table.mpc-grid tr.mpc-detail td{background:#e9eef6;text-align:left;padding:8px 10px;white-space:normal}
    /* The row the detail belongs to stays marked while it is open. */
    #${PANEL_ID} table.mpc-grid tbody tr.mpc-selected td{background:#dbe8f8}
    /* One card: the name and the value it means at the top, in a size that can
       be read from across the desk; the facts below in columns that each read
       downwards; anything the sides disagree on called out on its own. A blue
       edge and a shadow lift it off the grid it sits in. */
    #${PANEL_ID} .mpc-detailbox{display:flex;flex-direction:column;gap:9px;padding:10px 12px 11px 14px;max-width:1120px;
        background:#fff;border:1px solid #c9d6e8;border-left:4px solid #3f7fbf;border-radius:5px;box-shadow:0 2px 8px rgba(30,60,100,.12)}
    #${PANEL_ID} .mpc-dtop{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
    #${PANEL_ID} .mpc-dname{flex:1 1 320px;min-width:0}
    #${PANEL_ID} .mpc-dhead{font:bold 14px/1.3 Arial,Helvetica,sans-serif;color:#1b1b1b;overflow-wrap:anywhere}
    #${PANEL_ID} .mpc-dbadges{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
    #${PANEL_ID} .mpc-badge{display:inline-block;padding:1px 8px;border-radius:10px;font:11px/1.6 Arial,Helvetica,sans-serif;
        background:#eef0f4;color:#4a4f5a;border:1px solid #dfe3e9;white-space:nowrap}
    #${PANEL_ID} .mpc-badge.blue{background:#e6f0fb;color:#1b5fa8;border-color:#c5d9f1}
    #${PANEL_ID} .mpc-badge.green{background:#e8f5e9;color:#2e7d32;border-color:#c8e6c9}
    #${PANEL_ID} .mpc-badge.amber{background:#fff4e0;color:#9a5b00;border-color:#f3d9a4}
    #${PANEL_ID} .mpc-badge.mono{font-family:Consolas,ui-monospace,monospace}
    #${PANEL_ID} .mpc-dvalue{flex:0 0 auto;text-align:right;min-width:160px}
    #${PANEL_ID} .mpc-dlead{font:bold 26px/1.1 Consolas,ui-monospace,monospace;color:#1b5fa8;margin:0;white-space:nowrap}
    #${PANEL_ID} .mpc-dlead small{display:block;margin-top:4px;font:12px/1.3 Arial,Helvetica,sans-serif;font-weight:normal;color:#79808c;white-space:normal}
    #${PANEL_ID} .mpc-dactions{display:flex;gap:6px;flex-wrap:wrap;align-items:center;flex:1 1 100%}
    #${PANEL_ID} .mpc-dactions .mpc-spacer{flex:1 1 auto}
    #${PANEL_ID} .mpc-dcols{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:10px;align-items:start}
    /* A 1px gap over a grey backing reads as gridlines, which is what separates
       one pair from the next without drawing a border around each of them. */
    #${PANEL_ID} .mpc-dsec{display:flex;flex-direction:column;gap:1px;min-width:0;
        background:#e3e6ec;border:1px solid #dfe3e9;border-radius:4px;overflow:hidden}
    #${PANEL_ID} .mpc-dsec h5{margin:0;padding:4px 10px;background:#eef0f4;
        font:bold 10.5px Arial,Helvetica,sans-serif;letter-spacing:.4px;text-transform:uppercase;color:#79808c}
    /* min-width:0 on both, or a long value refuses to wrap and runs over the
       column beside it. */
    #${PANEL_ID} .mpc-kv{display:flex;gap:10px;align-items:baseline;min-width:0;padding:5px 10px;background:#fcfdfe;
        font:12px/1.55 Arial,Helvetica,sans-serif}
    #${PANEL_ID} .mpc-kv .mpc-k{color:#79808c;width:108px;flex:0 0 108px}
    #${PANEL_ID} .mpc-kv .mpc-v{color:#1b1b1b;min-width:0;overflow-wrap:anywhere}
    #${PANEL_ID} .mpc-kv .mpc-v.mono{font-family:Consolas,ui-monospace,monospace}
    #${PANEL_ID} .mpc-kv .mpc-v.hl{color:#1b5fa8;font-weight:bold}
    #${PANEL_ID} .mpc-kv .mpc-v.dim{color:#79808c}
    #${PANEL_ID} .mpc-dnotes{display:flex;flex-direction:column;gap:4px}
    #${PANEL_ID} .mpc-dnote{padding:5px 10px;border-radius:4px;font:12px/1.45 Arial,Helvetica,sans-serif;
        background:#fff4e0;border:1px solid #f3d9a4;color:#6b4300}
    #${PANEL_ID} .mpc-dnote.blue{background:#e6f0fb;border-color:#c5d9f1;color:#1b5fa8}
    #${PANEL_ID} .mpc-dnote.green{background:#e8f5e9;border-color:#c8e6c9;color:#2e7d32}
    #${PANEL_ID} table.mpc-grid td.mpc-empty{text-align:center;padding:16px;color:#9aa0ac;font:12px Arial,Helvetica,sans-serif}
    #${PANEL_ID} .mpc-sum{grid-column:span 12;font-size:11.5px;color:#4a4f5a;min-height:16px}
    #${PANEL_ID} .mpc-log{grid-column:span 12;height:220px;overflow-y:auto;overflow-x:hidden;
        font:11.5px/1.5 Consolas,ui-monospace,monospace;background:#fafbfc;border:1px solid var(--line);border-radius:3px;
        padding:6px 9px;white-space:pre-wrap;word-break:break-word;color:#3a3f4a}
    #${PANEL_ID} .mpc-log .err{color:#c0392b}#${PANEL_ID} .mpc-log .warn{color:#b9770e}#${PANEL_ID} .mpc-log .ok{color:#1e7e34}
    /* The terminal's own words, set apart from this console's reading of them. */
    #${PANEL_ID} .mpc-log .mirror{color:#5a6070}
    /* Drag the strip under a pane to give it more room; double-click to toggle. */
    #${PANEL_ID} .mpc-grip{grid-column:span 12;height:11px;margin-top:-3px;cursor:ns-resize;
        display:flex;align-items:center;justify-content:center}
    #${PANEL_ID} .mpc-grip::after{content:'';width:64px;height:3px;border-radius:2px;background:#c8ccd4}
    #${PANEL_ID} .mpc-grip:hover::after{background:#8a9099}
    #${PANEL_ID} .mpc-grip.dragging::after{background:#3f7fbf}
    `;

    const ui = {};
    let lastResult = null;
    // Redraws whatever the grid is showing — a poll, a scan, a verification —
    // so a filter change applies to that and not to the last poll. The zero
    // filter used to redraw the poll grid whichever view was up, which after a
    // scan meant nothing happened, or the poll grid came back over the scan.
    let redrawGrid = null;
    let lastScan = null;
    let pointList = null;
    let plantNames = null;
    let lastVerification = null;
    let repeatTimer = null;
    // True between Repeat and Stop, so a pass can stay quiet about what the first
    // one already said.
    let repeating = false;
    // Printed reference -> the value seen on the previous poll, so a re-read can
    // mark what moved. The delta is kept alongside rather than recomputed,
    // because the grid is also redrawn without a new poll — a filter toggle —
    // and recomputing then would compare a value against itself and report
    // every register as steady.
    const watchPrevious = new Map();
    const watchDelta = new Map();
    // The result whose values are already in watchPrevious.
    let deltaSource = null;

    function log(text, level) {
        if (!ui.log) return;
        // Follow the tail unless the reader has scrolled up to look at something.
        // A repeat adds a line a second, and yanking the view back down on each
        // one made the log unreadable for exactly as long as it was interesting.
        const following = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 4;
        const line = el('div', { className: level || '', textContent: text });
        ui.log.appendChild(line);
        if (following) ui.log.scrollTop = ui.log.scrollHeight;
    }

    /**
     * Everything the shell printed, as it printed it. The console's own reading
     * of the output is an interpretation; when a poll does something unexpected
     * the terminal text is the only thing that settles it, and going to look at
     * Plant Term to find it is a detour.
     */
    /**
     * The strip under the table and under the log: drag it down for more room,
     * double-click to swap between the default height and a tall one. Both
     * heights are remembered, because someone who made room to read a long list
     * or a long reply wants the same room next time.
     *
     * The table is capped rather than fixed, so three rows still take only the
     * room three rows need — which is why the drag moves `max-height` there and
     * `height` on the log.
     */
    const PANES = {
        log: {
            node: 'log', key: 'mpc.logHeight.v1', prop: 'height',
            def: 220, tall: 520, min: 90, max: 900,
            title: 'Drag to resize the log; hold at the bottom to keep it growing; double-click to make it tall',
        },
        grid: {
            node: 'gridWrap', key: 'mpc.gridHeight.v1', prop: 'maxHeight',
            def: 340, tall: 760, min: 120, max: 1400,
            title: 'Drag to resize the table; hold at the bottom to keep it growing; double-click to make it tall',
        },
    };

    // The property is what the drag moves, not the rendered box: a table shorter
    // than its cap would otherwise make the first drag jump to the row count.
    function paneHeight(spec) {
        const node = ui[spec.node];
        if (!node) return spec.def;
        return parseFloat(getComputedStyle(node)[spec.prop]) || spec.def;
    }

    function setPaneHeight(spec, pixels, remember) {
        const node = ui[spec.node];
        if (!node) return 0;
        const height = Math.max(spec.min, Math.min(spec.max, Math.round(pixels)));
        node.style[spec.prop] = height + 'px';
        if (remember !== false) storeSet(spec.key, String(height));
        // A shorter table may have gained a scrollbar, or a taller one lost it.
        placeExpandButton();
        return height;
    }

    /**
     * Keep the grip where the hand is. The body is itself a scroll container, so
     * growing a pane pushes its bottom edge — and the grip with it — past the
     * visible area: the drag then continues blind, and the room just made is
     * below the fold. Scrolling the body by however far the grip has gone over
     * the edge holds it still under the cursor while the pane grows above it.
     */
    function keepGripInView(grip) {
        const body = ui.body;
        if (!body || !grip) return;
        const edge = body.getBoundingClientRect();
        const strip = grip.getBoundingClientRect();
        if (strip.bottom > edge.bottom) body.scrollTop += strip.bottom - edge.bottom;
        else if (strip.top < edge.top) body.scrollTop -= edge.top - strip.top;
    }

    /*
     * Growing a pane pushes its grip toward the bottom of the body, and once the
     * cursor is there the hand has nowhere further to go. So a drag held in the
     * bottom edge zone keeps growing on its own, at a steady rate, until the hand
     * moves back up or the pane reaches its ceiling — the edge-scroll a file
     * manager does when a drag reaches the end of the list. The lowest grip sits
     * inside that zone whenever the body is scrolled to the bottom, so pressing
     * it and holding is enough.
     */
    const EDGE_ZONE = 28;    // pixels above the body's bottom edge that count as the edge
    const EDGE_SPEED = 0.3;  // pixels per millisecond while the hand is held there — by the clock, not the frame, so a fast monitor does not creep faster

    function makeGrip(spec) {
        const grip = el('div', { className: 'mpc-grip', title: spec.title });
        let startY = 0;
        let startHeight = 0;
        let lastY = 0;
        let crept = 0;      // growth the edge added beyond where the hand went
        let timer = null;
        let lastTick = 0;
        /*
         * The grip stays under the hand, both ways. Growing pushes it down;
         * shrinking is the subtler case: with the body scrolled to its end the
         * grip is the end of the content, so shortening the pane shortens the
         * content, the scroll position is clamped, and everything shifts down —
         * the pane shrinks from its top edge while the grip stays pinned at the
         * bottom and the hand rises away from it. A runway of blank padding
         * below the content, for the duration of the drag, gives the scroll the
         * room it needs, and the body is then scrolled by exactly the distance
         * between the grip and the hand.
         */
        const follow = () => {
            const body = ui.body;
            if (!body) return;
            const edge = body.getBoundingClientRect();
            const strip = grip.getBoundingClientRect();
            const target = Math.min(Math.max(lastY, edge.top + 6), edge.bottom - 6);
            body.scrollTop += (strip.top + strip.height / 2) - target;
        };
        const runway = on => { if (ui.body) ui.body.style.paddingBottom = on ? ui.body.clientHeight + 'px' : ''; };
        const resize = remember => {
            setPaneHeight(spec, startHeight + (lastY - startY) + crept, remember);
            follow();
        };
        // On a timer rather than an animation frame: there is no paint to keep
        // in step with, and a frame callback starves wherever the page is not
        // being painted, which a timer does not.
        const creep = () => {
            const now = performance.now();
            const elapsed = lastTick ? now - lastTick : 0;
            lastTick = now;
            if (ui.body && lastY >= ui.body.getBoundingClientRect().bottom - EDGE_ZONE) {
                const before = paneHeight(spec);
                const step = EDGE_SPEED * Math.min(elapsed, 100);
                crept += step;
                resize(false);
                // At the ceiling the pane stops, so the count must too — or letting
                // go would snap it by however long the hand kept pressing.
                if (paneHeight(spec) === before) crept -= step;
            }
        };
        const stop = () => {
            grip.classList.remove('dragging');
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            window.removeEventListener('blur', onBlur);
            if (timer) clearInterval(timer);
            timer = null;
            runway(false);
        };
        const onMove = event => { lastY = event.clientY; resize(false); };
        const onUp = event => { lastY = event.clientY; resize(true); stop(); };
        // A window losing focus mid-drag never sees the mouseup; the pane would
        // otherwise creep to its ceiling on its own.
        const onBlur = () => { resize(true); stop(); };
        grip.addEventListener('mousedown', event => {
            startY = lastY = event.clientY;
            startHeight = paneHeight(spec);
            crept = 0;
            lastTick = 0;
            grip.classList.add('dragging');
            runway(true);
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
            window.addEventListener('blur', onBlur);
            timer = setInterval(creep, 16);
            event.preventDefault();
        });
        grip.addEventListener('dblclick', () => {
            const current = paneHeight(spec);
            setPaneHeight(spec, current < spec.tall - 20 ? spec.tall : spec.def);
            keepGripInView(grip);
        });
        return grip;
    }

    /**
     * The table takes the whole page and nothing more: its zone becomes a fixed
     * overlay over the shell's header and sidebar and over the rest of the
     * console, inside this browser tab. Not the form, not the log — expanding
     * is done in order to read a long register list, and those only take rows
     * from it. Not the native Fullscreen API either: that would swallow the
     * browser's own chrome and the desktop behind it, and the console is a tool
     * in a tab, not a presentation.
     *
     * The zone's height is the viewport's, so the table fills it by flex rather
     * than by measurement, and a resize is the browser's problem. The one thing
     * in the way is the grip's cap, which is an inline style and would beat the
     * expanded rule: it is lifted for the duration and put back exactly on the
     * way out. The grip itself is under the overlay, so nothing can change the
     * cap while it is lifted.
     */
    let preExpandCap = null;

    function isExpanded() {
        return !!ui.gridZone && ui.gridZone.classList.contains('mpc-full');
    }

    /*
     * Four corner brackets, pointing out to expand and in to come back. Drawn
     * rather than set in a glyph, because the corner has room for about twelve
     * pixels and no font is guaranteed to have ⛶ in it.
     */
    const ICON_SIDES = 'fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round';
    const ICON_EXPAND = '<svg viewBox="0 0 12 12" aria-hidden="true"><path style="' + ICON_SIDES +
        '" d="M1 4.3V1h3.3M7.7 1H11v3.3M11 7.7V11H7.7M4.3 11H1V7.7"/></svg>';
    const ICON_CONTRACT = '<svg viewBox="0 0 12 12" aria-hidden="true"><path style="' + ICON_SIDES +
        '" d="M1 4.3h3.3V1M7.7 1v3.3H11M11 7.7H7.7V11M4.3 11V7.7H1"/></svg>';

    /**
     * The control sits in the table's top right corner, past the last heading.
     * Clear of the table's own scrollbar, or it would land on top of it: what
     * offsetWidth has and clientWidth does not is the scrollbar plus the two
     * borders, which is exactly the gap to leave.
     */
    // The button is 20 wide and offset 4; the rest is the gap to the heading.
    const EXPAND_CORNER_ROOM = 28;

    function placeExpandButton() {
        if (!ui.expand || !ui.gridWrap) return;
        ui.expand.style.right = (ui.gridWrap.offsetWidth - ui.gridWrap.clientWidth + 2) + 'px';
    }

    function syncExpandButton() {
        if (!ui.expand) return;
        const on = isExpanded();
        ui.expand.innerHTML = on ? ICON_CONTRACT : ICON_EXPAND;
        ui.expand.title = on
            ? 'Back to the console — Escape does the same'
            : 'Read the table on the whole page';
        // A table that fills the page may have lost its scrollbar, or gained one.
        placeExpandButton();
    }

    function setExpanded(on) {
        const zone = ui.gridZone;
        if (!zone || !ui.gridWrap) return;
        if (on) {
            if (preExpandCap === null) preExpandCap = ui.gridWrap.style.maxHeight;
            ui.gridWrap.style.maxHeight = '';
            zone.classList.add('mpc-full');
        } else {
            zone.classList.remove('mpc-full');
            if (preExpandCap !== null) {
                ui.gridWrap.style.maxHeight = preExpandCap;
                preExpandCap = null;
            }
        }
        syncExpandButton();
    }

    function watchExpanded() {
        // This is not the browser's own fullscreen, so Escape is ours to honour.
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && isExpanded()) setExpanded(false);
        });
    }

    const MIRROR_LINE_CAP = 200;
    // Always on: what Plant Term printed is the evidence behind every row in the
    // grid, so there is no reading of a poll that is better off without it.
    function mirrorTerminal(chunk) {
        if (!ui.log) return;
        const lines = String(chunk || '').split('\n')
            .map(l => l.replace(/\s+$/, ''))
            // A repeat prints the same banner every pass, which says nothing the
            // first one did not. Only what is new to this pass is worth a line.
            .filter(l => l.trim() && l.trim().indexOf(MARK) !== 0 && !(repeating && RE_BANNER.test(l)));
        if (!lines.length) return;
        for (const line of lines.slice(0, MIRROR_LINE_CAP)) log('  ' + line, 'mirror');
        if (lines.length > MIRROR_LINE_CAP) log('  …' + (lines.length - MIRROR_LINE_CAP) + ' further lines', 'mirror');
    }

    /**
     * The progress strip: a fraction and a line of text while something long
     * runs, gone when it is over. Whatever is finished stays on the strip for a
     * moment at 100 %, so an eye that was elsewhere sees that it ended.
     */
    let progressHideTimer = null;
    // Between two real updates the bar keeps moving on a timer — a timer, not
    // a frame callback, since frames stop wherever the page is not painted —
    // towards where the next update is likely to land: one more step of the
    // size the last one took, slowing as it gets there. A device saying no
    // for a second at a time then reads as slow rather than dead. The creep
    // never crosses the next real update, never reaches the end on its own,
    // and the bar never goes backwards: a real update behind the creep is
    // caught up to, not shown. The elapsed time beside the text is the other
    // sign of life, and it costs nothing to be honest about.
    let progressTimer = null;
    let progressActive = false;
    let progressShownAt = 0;
    let progressTarget = 0;      // the last fraction reported
    let progressDrawn = 0;       // what the bar shows
    let progressStep = 0.02;     // how far the last real update moved it
    let progressLabel = '';
    function progressElapsed() {
        const s = Math.max(0, Math.floor((Date.now() - progressShownAt) / 1000));
        return s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : s + ' s';
    }
    function drawProgress() {
        ui.progressFill.style.width = (Math.max(0, Math.min(1, progressDrawn)) * 100).toFixed(1) + '%';
        ui.progressText.textContent = (progressLabel ? progressLabel + ' · ' : '') + progressElapsed();
    }
    function creepProgress() {
        if (!progressActive) return;
        if (progressTarget < 1) {
            const ceiling = Math.min(0.985, progressTarget + progressStep);
            if (progressDrawn < ceiling) progressDrawn += (ceiling - progressDrawn) * 0.05;
        }
        drawProgress();
    }
    function showProgress(fraction, text) {
        if (!ui.progress) return;
        clearTimeout(progressHideTimer);
        const f = Math.max(0, Math.min(1, Number(fraction) || 0));
        if (!progressActive) {
            progressActive = true;
            progressShownAt = Date.now();
            progressTarget = 0;
            progressDrawn = 0;
            progressStep = 0.02;
            ui.progress.classList.remove('mpc-hidden');
        }
        if (f > progressTarget) progressStep = Math.max(0.004, Math.min(0.06, f - progressTarget));
        progressTarget = Math.max(progressTarget, f);
        progressDrawn = Math.max(progressDrawn, progressTarget);
        progressLabel = text || '';
        drawProgress();
        if (!progressTimer) progressTimer = setInterval(creepProgress, 100);
    }
    function hideProgress(afterMs) {
        if (!ui.progress) return;
        clearTimeout(progressHideTimer);
        clearInterval(progressTimer);
        progressTimer = null;
        progressActive = false;
        if (afterMs) progressHideTimer = setTimeout(() => ui.progress.classList.add('mpc-hidden'), afterMs);
        else ui.progress.classList.add('mpc-hidden');
    }

    function setDot(state) {
        if (ui.dot) ui.dot.className = 'mpc-dot ' + (state || '');
    }

    // A labelled control occupying `span` of the form's twelve columns. The label
    // is always present — a blank one keeps a lone button on the same baseline as
    // the fields beside it.
    function field(labelText, control, span) {
        return el('div', { className: 'mpc-f mpc-span' + (span || 3) }, [
            el('label', { textContent: labelText, title: labelText.trim() }),
            control,
        ]);
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
            format: ui.format.value,
            bigEndian: ui.bigEndian.checked,
            baudrate: ui.baudrate.value,
            parity: ui.parity.value,
            databits: ui.databits.value,
            stopbits: ui.stopbits.value,
            timeoutMs: Math.max(3000, (Number(ui.timeout.value) || 25) * 1000),
        };
    }

    function applyForm(values) {
        if (!values) return;
        for (const key of ['mode', 'host', 'port', 'slave', 'table', 'start', 'count', 'base', 'format', 'baudrate', 'parity', 'databits', 'stopbits']) {
            if (ui[key] && values[key] !== undefined && values[key] !== null) ui[key].value = values[key];
        }
        ui.bigEndian.checked = !!values.bigEndian;
        toggleSerial();
        refreshPreview();
    }

    const isSerialMode = mode => mode === 'rtu' || mode === 'ascii';

    function toggleSerial() {
        const serial = isSerialMode(ui.mode.value);
        for (const wrap of ui.serialFields) wrap.classList.toggle('mpc-hidden', !serial);
        ui.portWrap.classList.toggle('mpc-hidden', serial);
        // The host field takes the port's two columns when there is no port to show,
        // so the row still ends on the grid's right edge.
        ui.hostWrap.className = 'mpc-f ' + (serial ? 'mpc-span8' : 'mpc-span6');
        ui.hostLabel.textContent = serial ? 'COM port' : 'IP address';
        ui.host.placeholder = serial ? 'COM3' : '10.0.0.5';
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

    // The grid serves two readings: registers as polled, and points as verified.
    // Columns are declared rather than hard-coded so the two can share one table.
    const REGISTER_COLUMNS = [
        { label: 'printed', width: '7%', title: 'The index modpoll printed — -r counts from 1' },
        { label: 'addr', width: '7%', title: 'Protocol address, the printed index minus one' },
        { label: 'name', width: '25%', align: 'left', title: 'From the loaded point list, matched on this reference' },
        { label: 'value', width: '9%', title: 'The register as the device returned it' },
        { label: 'scaled', width: '9%', title: "Value multiplied by the list's scale key, or what the plant itself shows — a number or a state text" },
        { label: 'unit', width: '6%', title: 'Engineering unit from the list' },
        { label: 'hex', width: '9%', title: 'The register as hexadecimal — four digits for a 16-bit read, eight for a 32-bit integer. Blank where the bit pattern cannot be recovered from what modpoll printed, which is every float' },
        { label: 'int16', width: '8%', title: 'Filled only when the register reads differently as a signed 16-bit integer, which means it came back above 32767' },
        { label: 'Δ', width: '8%', title: 'Change since this register was last polled. Blank until it has been read twice, 0 when it was read again and held still' },
        { label: 'type', width: '12%', align: 'left', title: 'Datatype from the list' },
    ];
    // Coils and discrete inputs answer 0 or 1. Hexadecimal, a signed reading and a
    // scale are all noise on a bit, so that table gets its own, shorter set.
    const BIT_COLUMNS = [
        { label: 'printed', width: '8%', title: 'The index modpoll printed — -r counts from 1' },
        { label: 'addr', width: '8%', title: 'Protocol address, the printed index minus one' },
        { label: 'name', width: '38%', align: 'left', title: 'From the loaded point list or the plant database' },
        { label: 'bit', width: '8%', title: 'The value as returned: 1 or 0' },
        { label: 'state', width: '12%', title: 'The same bit as words' },
        { label: 'Δ', width: '10%', title: 'Change since this bit was last polled. Blank until it has been read twice, 0 when it was read again and held still' },
        { label: 'source', width: '16%', align: 'left', title: 'Datatype from a point list, or the plant group' },
    ];
    const POINT_COLUMNS = [
        { label: 'addr', width: '7%', title: 'The address as the point list prints it' },
        { label: 'ref', width: '7%', title: "modpoll's 1-based reference for that address" },
        { label: 'name', width: '24%', align: 'left', title: 'Tag and alias text from the list' },
        { label: 'type', width: '13%', align: 'left', title: 'Datatype key, which decides the table and the raw type' },
        { label: 'raw', width: '9%', title: 'The register as the device returned it' },
        { label: 'scaled', width: '9%', title: "Raw multiplied by the list's scale key" },
        { label: 'unit', width: '6%', title: 'Engineering unit from the list' },
        { label: 'status', width: '10%', title: 'read, zero, refused, no answer or not polled' },
        { label: 'note', width: '15%', align: 'left', title: 'Why a point is flagged, or why it was not polled' },
    ];

    const FIND_COLUMNS = [
        { label: 'ref', width: '8%', title: "modpoll's 1-based reference — what to put in Start" },
        { label: 'addr', width: '8%', title: 'Protocol address' },
        { label: 'name', width: '40%', align: 'left', title: 'Alias text that matched' },
        { label: 'table', width: '14%', title: 'Which table it lives in' },
        { label: 'value now', width: '14%', title: 'What the plant currently shows for it' },
        { label: 'where from', width: '16%', align: 'left', title: 'Point list or plant database, and the group' },
    ];

    /**
     * Going the other way: from a name to a register. A number goes straight
     * through as a reference, so pasting either half of what you know works.
     */
    function findByName(query) {
        const text = String(query || '').trim().toLowerCase();
        if (!text) return [];
        const matches = [];
        const add = m => { if (matches.length < 200) matches.push(m); };

        if (pointList) {
            for (const p of pointList.points) {
                if (!p.decoded.ok) continue;
                const hay = (p.name + ' ' + p.group + ' ' + p.datatype).toLowerCase();
                if (hay.indexOf(text) < 0 && String(p.ref) !== text && String(p.addr) !== text) continue;
                add({
                    ref: p.ref, addr: p.protocol, name: p.name, table: p.decoded.table, format: p.decoded.format,
                    group: p.group, unit: p.unit, value: '', source: 'list', writable: p.rw === 'rw',
                });
            }
        }
        if (plantNames) {
            for (const [key, entries] of plantNames.byRef) {
                const [table, , ref] = key.split('|');
                for (const entry of entries) {
                    const hay = (entry.name + ' ' + entry.group).toLowerCase();
                    if (hay.indexOf(text) < 0 && String(ref) !== text && String(entry.protocol) !== text) continue;
                    add({
                        ref: Number(ref), addr: entry.protocol, name: entry.name + (entry.bit === null ? '' : ' (bit ' + entry.bit + ')'),
                        table, format: '', group: entry.group, unit: entry.unit,
                        value: entry.plantValue, source: 'plant', writable: entry.access === 'rw',
                    });
                }
            }
        }
        return matches.sort((a, b) => a.table.localeCompare(b.table) || a.ref - b.ref);
    }

    function setGridColumns(columns) {
        ui.gridColumns = columns;
        ui.gridCols.textContent = '';
        ui.gridHead.textContent = '';
        for (const c of columns) ui.gridCols.appendChild(el('col', { style: 'width:' + c.width }));
        ui.gridHead.appendChild(el('tr', {}, columns.map((c, i) => {
            const rules = [];
            if (c.align === 'left') rules.push('text-align:left');
            // The corner control is pinned over the end of this row, so the last
            // heading makes room for it instead of being covered by it.
            if (i === columns.length - 1) rules.push('padding-right:' + EXPAND_CORNER_ROOM + 'px');
            return el('th', { textContent: c.label, title: c.title || c.label, style: rules.join(';') });
        })));
        // A different column set is a different row count, so the scrollbar the
        // corner control has to clear may have come or gone with it.
        placeExpandButton();
    }

    /*
     * A register on its own says very little. When a point list is loaded, every
     * reading it covers can be named, typed and scaled, and that holds for an
     * ordinary poll as much as for a verification — the list is the only place
     * that knows what 190 in register 432 means.
     */
    /** What the plant itself calls this register, if its parameters are loaded. */
    function plantNamesFor(table, format, ref) {
        if (!plantNames || format) return null;      // the plant's own list is 16-bit
        return plantNames.byRef.get(String(table) + '||' + ref) || null;
    }

    function pointForReading(table, format, ref) {
        if (!pointList) return null;
        const key = String(table) + '|' + String(format || '') + '|' + ref;
        if (!pointList.byRef) {
            pointList.byRef = new Map();
            for (const p of pointList.points) {
                if (!p.decoded.ok) continue;
                pointList.byRef.set(p.decoded.table + '|' + p.decoded.format + '|' + p.ref, p);
            }
        }
        return pointList.byRef.get(key) || null;
    }

    /**
     * What one register is, in the order someone asks it: what it is called
     * and what its value means — large, since that is the answer — then a
     * row of badges with the facts that decide a point (where, access, scale,
     * the datatype it suggests, whether it moved); then the facts in columns
     * that each read downwards: how to reach it, the number read every way
     * that applies, what the plant says, what the list says, and the point
     * the two together suggest; and last, on their own, the places where
     * the sides disagree. Explanations sit in tooltips rather than beside
     * the values, so a reader who knows them is not made to read them.
     *
     * `extra` carries what a scan row knows and a poll row does not: the
     * second read, the region's width verdict, the next register's value for
     * the 32-bit reading, and what modpoll's -f means on this plant.
     */
    function readingDetailSections(value, point, previous, fromPlant, table, ref, format, extra) {
        const x = extra || {};
        const fmt = formatOf(format);
        const wide = fmt.step === 2;
        const u16 = value < 0 ? value + 65536 : value;
        const i16 = value > 32767 ? value - 65536 : value;
        const entry = fromPlant && fromPlant[0];
        const first = entry && entry.bit === null ? entry : null;
        const bits = (fromPlant || []).filter(p => p.bit !== null);
        const tableInfo = REGISTER_TABLES.find(t => t.value === String(table)) || {};
        const tableName = tableInfo.title || ('table ' + table);
        const tableShort = (tableInfo.label || ('table ' + table)).replace(/^\d+ — /, '');
        const sections = [];
        const badges = [];
        const notes = [];

        // --- the answer: what it is called, and what its value means ---------
        const name = (point && point.name) || (entry && entry.name) || '';
        const unit = (point && point.unit) || (entry && entry.unit) || '';
        const meaning = point
            ? (point.scale.invert ? (value ? 'off' : 'on') : roundScaled(value * point.scale.factor, point.decimals))
            : (first ? first.plantValue : '');
        const hasMeaning = !(meaning === '' || meaning === null || meaning === undefined);
        const implied = first && !wide ? impliedScale(value, first.plantValue) : null;
        const wideFound = !wide && !implied && typeof x.nextRaw === 'number' ? wideReading(value, x.nextRaw, first ? first.plantValue : null) : null;
        const confirmedWide = pickWide(wideFound);
        const region = x.region && x.region.format !== '16-bit' ? x.region : null;
        const regionWide = region && (region.format === 'float32' || region.format === 'int32' || region.format === 'uint32');
        const aligned = region ? (ref - region.alignStart) % 2 === 0 : true;
        // What the pair reads as, in the region's order, when the scan judged
        // the region 32-bit and this register starts a pair.
        let pairValue = null;
        if (regionWide && aligned && typeof x.nextRaw === 'number') {
            const d = decodePair(value, x.nextRaw)[region.wordOrder === 'low word first' ? 'lowFirst' : 'highFirst'];
            pairValue = region.format === 'float32' ? (plausibleFloat(d.float) ? roundScaled(d.float, 4) : null) : (region.format === 'int32' ? d.int32 : d.uint32);
        }
        const changed = typeof x.again === 'number' && x.again !== value;
        // A status word means its bits, not its number: say which are set.
        const setBits = [];
        if (!wide) for (let b = 0; b < 16; b++) if ((u16 >> b) & 1) setBits.push(b);
        const bitNote = bits.length
            ? (setBits.length ? 'bit' + (setBits.length === 1 ? ' ' : 's ') + setBits.join(', ') + ' set' : 'no bit set') + ' — 0x' + (u16 >>> 0).toString(16).toUpperCase().padStart(4, '0')
            : null;
        sections.push({
            headline: name || ('Reference ' + ref + (tableShort ? ' — ' + tableShort.toLowerCase() : '')),
            lead: hasMeaning ? meaning + (unit ? ' ' + unit : '') : (pairValue !== null ? String(pairValue) : String(value)),
            leadNote: hasMeaning ? 'register holds ' + value
                : (pairValue !== null ? region.format + ' over ' + ref + '-' + (ref + 1) + ', register holds ' + value : (bitNote || 'raw, as modpoll printed it')),
        });

        // --- badges: the facts that decide a point --------------------------
        badges.push({ text: tableShort, tone: 'grey', title: tableName });
        badges.push({ text: 'ref ' + ref, tone: 'grey', mono: true, title: 'What modpoll prints, and what -r takes' });
        badges.push({ text: 'addr ' + (ref - 1), tone: 'grey', mono: true, title: 'The protocol address — what a document usually means, and what a modbusgen list prints' });
        if (fromPlant && fromPlant.length) {
            badges.push({ text: fromPlant.some(p => p.access === 'rw') ? 'writable in the plant' : 'read only in the plant', tone: fromPlant.some(p => p.access === 'rw') ? 'green' : 'grey' });
        } else if (point && point.rw) {
            badges.push({ text: point.rw === 'rw' ? 'read/write in the list' : 'read only in the list', tone: point.rw === 'rw' ? 'green' : 'grey' });
        }
        if (implied) badges.push({ text: 'scale ' + implied.replace(/^x/, '×'), tone: 'blue', title: 'Implied by the plant: it shows ' + first.plantValue + ' where the register holds ' + value });
        if (point && point.scaleKey) badges.push({ text: 'list ' + point.scaleKey, tone: 'grey', title: 'The scale key in the loaded list' });
        if (bits.length) badges.push({ text: bits.length + ' bit' + (bits.length === 1 ? '' : 's') + ' read by the plant', tone: 'blue' });
        if (confirmedWide) badges.push({ text: confirmedWide.as + ' with ' + (ref + 1), tone: 'blue', mono: true, title: 'The plant shows ' + first.plantValue + ', which this register and the next decode to, ' + confirmedWide.wordOrder });
        else if (region) badges.push({ text: region.format + (region.wordOrder ? ', ' + region.wordOrder.replace(' word first', ' first') : ''), tone: region.confidence === 'wire' || region.confidence === 'plant' ? 'blue' : 'grey', title: 'The scan\'s verdict for registers ' + region.from + '-' + region.to + ' (' + region.confidence + '): ' + region.evidence });
        if (typeof x.again === 'number') {
            badges.push(changed
                ? { text: 'moved: ' + value + ' → ' + x.again, tone: 'amber', mono: true, title: 'Read again after the sweep and different — a value being measured' }
                : { text: 'same on 2nd read', tone: 'grey', title: 'Read again after the sweep and unchanged — a setpoint, a configuration word, or a measurement that held still' });
        }
        const suggest = !wide ? suggestPoint(String(table), ref - 1, value, fromPlant, wideFound, changed) : null;
        if (suggest) badges.push({ text: suggest.datatype, tone: 'blue', mono: true, title: 'The modbusgen datatype the plant and the device suggest — see the point below' });
        badges.push({ text: point ? 'named by the list' : (entry ? 'named by the plant' : 'no name known'), tone: 'grey' });

        // --- where it is ------------------------------------------------------
        const reach = [
            ['table', tableName, false, 'modpoll\'s -t follows the Modicon prefix: 4 holding, 3 input, 1 discrete, 0 coil'],
            ['reference', String(ref), true, 'What modpoll prints, and what -r takes — one more than the protocol address'],
            ['protocol address', String(ref - 1), true, 'What a document usually means, and what a modbusgen list prints (or one more, with subtract_one)'],
        ];
        if (point) reach.push(['in the list', String(point.addr) + (point.protocol !== point.addr ? '  (protocol ' + point.protocol + ')' : ''), true, 'The address as the loaded list writes it']);
        if (entry) reach.push(['driver_id', entry.driverId, true, 'IWMAC\'s own key for the parameter: …_0_<read function>_<protocol address>[.<bit>]']);
        reach.push(['command', ui.cmd ? ui.cmd.value : '', true, 'What Run would send — one register, read only']);
        sections.push({ title: 'Where it is', rows: reach });

        // --- the number, read every way that applies --------------------------
        // modpoll prints a 32-bit value already decoded: an integer can still
        // be shown at its full width, while a float's bit pattern is gone and
        // only the decimal remains. Signed against unsigned is only worth a
        // line when they differ, and a guessed division only when nothing
        // better is known about the scale.
        const grouped = b => b.replace(/(.{4})(?=.)/g, '$1 ');
        const asNumbers = [['raw', String(value), true, 'As modpoll printed it']];
        if (!wide) {
            asNumbers.push(['hexadecimal', '0x' + (u16 >>> 0).toString(16).toUpperCase().padStart(4, '0'), true]);
            asNumbers.push(['binary', grouped((u16 >>> 0).toString(2).padStart(16, '0')), true, 'Bit 15 first; a status word is read from the right, bit 0 last']);
            if (u16 !== i16 || value < 0) asNumbers.push(['unsigned / signed', u16 + ' / ' + i16, true, 'The same bits as a U16 and as an I16 — they differ above 32767']);
            if (!implied && !point && !bits.length && !confirmedWide && !regionWide && value !== 0) {
                asNumbers.push(['÷10 / ÷100', (value / 10).toFixed(1) + ' / ' + (value / 100).toFixed(2), true, 'The two commonest scales, for a register nothing names']);
            }
            const chars = [u16 >> 8, u16 & 0xff];
            if (chars.every(code => code >= 32 && code < 127)) asNumbers.push(['as two characters', chars.map(code => String.fromCharCode(code)).join(''), true, 'A string point spends two characters per register']);
        } else if (fmt.value === 'int' && Number.isInteger(value)) {
            const u32 = value >>> 0;
            asNumbers.push(
                ['hexadecimal', '0x' + u32.toString(16).toUpperCase().padStart(8, '0'), true],
                ['binary', grouped(u32.toString(2).padStart(32, '0')), true],
                ['unsigned / signed', u32 + ' / ' + (value | 0), true],
            );
        } else {
            asNumbers.push(['read as', fmt.label + ', decoded by modpoll from two registers', false, 'The bit pattern is not in what modpoll printed']);
        }
        if (regionWide) {
            asNumbers.push(aligned
                ? ['with ' + (ref + 1), pairValue === null ? 'not a ' + region.format.replace('32', '') + ' — ?' : String(pairValue) + '  as ' + region.format + ', ' + region.wordOrder, true,
                    'This register and the next decoded as one, in the order the scan judged for registers ' + region.from + '-' + region.to]
                : ['pair', 'the second half of ' + (ref - 1) + '-' + ref + ' — click ' + (ref - 1) + ' for the value', false]);
        } else if (wideFound) {
            for (const w of wideFound.slice(0, 2)) {
                asNumbers.push(['with ' + (ref + 1), w.value + '  as ' + w.as + ', ' + w.wordOrder + (w.confirmed ? '  — ' + w.confirmed : '  — a candidate from the bits alone'), true,
                    'This register and the next decoded as one 32-bit value; nothing on the wire proves a width']);
            }
        }
        if (typeof x.again === 'number') {
            asNumbers.push(['second read', changed ? value + ' → ' + x.again + '  (' + (x.again - value > 0 ? '+' : '') + roundScaled(x.again - value) + ')' : x.again + '  — unchanged', true,
                'Read again once the sweep was done' + (x.secondsAfter ? ', about ' + x.secondsAfter + ' s after the scan began' : '')]);
        } else if (previous !== undefined && previous !== value) {
            asNumbers.push(['since last pass', previous + ' → ' + value + '  (' + (value - previous > 0 ? '+' : '') + roundScaled(value - previous) + ')', true, 'Watch mode: what the same register read the pass before']);
        }
        sections.push({ title: 'The number', rows: asNumbers });

        // --- what the plant says ------------------------------------------------
        if (fromPlant && fromPlant.length) {
            const rows = [];
            for (const p of fromPlant) {
                if (p.bit === null) rows.push(['parameter', p.name + (p.plantValue ? ':  ' + p.plantValue : '') + (p.unit ? ' ' + p.unit : ''), false, 'The value the plant showed when its names were read']);
                else rows.push(['bit ' + p.bit, p.name + '  — reads ' + ((u16 >> p.bit) & 1) + (p.plantValue ? '  (plant showed ' + p.plantValue + ')' : ''), false, 'This bit of the register, as read now']);
            }
            if (entry.group) rows.push(['group', entry.group]);
            if (entry.unit) rows.push(['unit', entry.unit]);
            rows.push(['access', fromPlant.some(p => p.access === 'rw') ? 'the plant holds it writable' : 'read only in the plant']);
            if (first) {
                const shown = Number(String(first.plantValue).replace(',', '.'));
                if (implied) rows.push(['implied scale', implied.replace(/^x/, '×') + '  — shows ' + first.plantValue + ' where the register holds ' + value, false, 'The field a vendor document most often leaves out']);
                else if (!Number.isNaN(shown) && value !== 0 && !confirmedWide) rows.push(['implied scale', 'none common: ' + first.plantValue + ' ÷ ' + value + ' = ' + (shown / value).toFixed(4), false]);
            }
            sections.push({ title: 'What the plant says', rows });
        }

        // --- what the point list says ------------------------------------------
        if (point) {
            const rows = [
                ['datatype', point.datatype + (point.decoded.ok
                    ? '  — ' + tableName.toLowerCase() + ', ' + point.decoded.rawType + (point.decoded.step === 2 ? ', two registers per value' : '')
                    : '  — not decoded'), true],
            ];
            if (point.group) rows.push(['group', point.group]);
            if (point.scaleKey) rows.push(['scale', point.scaleKey + (point.scale.known ? '  (×' + point.scale.factor + ')' : '  — key not understood')]);
            if (point.unit) rows.push(['unit', point.unit]);
            if (point.rw) rows.push(['access', point.rw === 'rw' ? 'read and write' : 'read only']);
            if (point.rangeMin !== null || point.rangeMax !== null) {
                rows.push(['declared range', (point.rangeMin === null ? '…' : point.rangeMin) + ' to ' + (point.rangeMax === null ? '…' : point.rangeMax)]);
            }
            sections.push({ title: 'What the point list says', rows });
        }

        // --- the point the plant and the device suggest ------------------------
        if (suggest) {
            const rows = [['datatype', suggest.datatype, true, 'From the shipped datatypes table']];
            rows.push(['addr', String(suggest.addr), true, 'The protocol address a modbusgen list prints']);
            if (suggest.scale) rows.push(['scale', suggest.scale, true]);
            if (suggest.unit) rows.push(['unit', suggest.unit]);
            rows.push(['rw', suggest.rw, true]);
            if (suggest.group) rows.push(['group', suggest.group]);
            if (suggest.bits) for (const b of suggest.bits) rows.push(['bit ' + b.bit, b.name + '  (' + b.rw + ')']);
            for (const why of suggest.basis) rows.push(['because', why, false]);
            sections.push({ title: 'Suggested point — a lead, not a conclusion', rows });
        }

        // --- where the sides disagree ------------------------------------------
        if (point && implied && point.scale.known && ('x' + point.scale.factor) !== implied) {
            notes.push({ text: 'The list scales by x' + point.scale.factor + '; the plant implies ' + implied + ' — it shows ' + first.plantValue + ' where the register holds ' + value + '.', tone: 'amber' });
        }
        if (point && first && point.unit && first.unit && point.unit.trim().toLowerCase() !== first.unit.trim().toLowerCase()) {
            notes.push({ text: 'The list says unit "' + point.unit + '", the plant "' + first.unit + '".', tone: 'amber' });
        }
        if (confirmedWide) {
            notes.push({ text: 'A 32-bit point: registers ' + ref + ' and ' + (ref + 1) + ' read as ' + confirmedWide.as + ', ' + confirmedWide.wordOrder + ', give ' + confirmedWide.value + ' — ' + confirmedWide.confirmed + '.' +
                (point && point.decoded.ok && point.decoded.step !== 2 ? ' The list declares ' + point.datatype + ', one register.' : ''), tone: point && point.decoded.ok && point.decoded.step !== 2 ? 'amber' : 'blue' });
        } else if (region) {
            notes.push({ text: 'The scan judged registers ' + region.from + '-' + region.to + ' ' + region.format + (region.wordOrder && region.format !== '16-bit' ? ', ' + region.wordOrder : '') + ' (' + region.confidence + '): ' + region.evidence + '.', tone: 'blue' });
        }
        if (point && typeof meaning === 'number') {
            if (point.rangeMin !== null && meaning < point.rangeMin) notes.push({ text: 'Below the range the list declares, ' + point.rangeMin + '.', tone: 'amber' });
            if (point.rangeMax !== null && meaning > point.rangeMax) notes.push({ text: 'Above the range the list declares, ' + point.rangeMax + '.', tone: 'amber' });
        }
        if (first && value === 0) {
            const shown = Number(String(first.plantValue).replace(',', '.'));
            if (!Number.isNaN(shown) && shown !== 0) notes.push({ text: 'Reads 0 now; the plant showed ' + first.plantValue + ' when its names were read.', tone: 'amber' });
        }
        if (changed) notes.push({ text: 'Moved between the sweep and the second read (' + value + ' → ' + x.again + '): a value being measured, not a setpoint.', tone: 'green' });

        // What the actions poll: this register, at the width its region has.
        const aim = regionWide
            ? { table: String(table), ref: aligned ? ref : ref - 1, format: region.format === 'float32' ? 'float' : 'int', bigEndian: region.wordOrder === (x.flagMeans || 'high word first') }
            : { table: String(table), ref, format: format || '' };
        return { sections, badges, notes, aim };
    }

    function toggleDetailRow(tr, value, point, previous, fromPlant, table, ref, format, extra) {
        const next = tr.nextElementSibling;
        const close = () => {
            for (const open of ui.gridBody.querySelectorAll('tr.mpc-detail')) open.remove();
            for (const marked of ui.gridBody.querySelectorAll('tr.mpc-selected')) marked.classList.remove('mpc-selected');
        };
        if (next && next.classList.contains('mpc-detail')) { close(); return; }
        close();

        const model = readingDetailSections(value, point, previous, fromPlant, table, ref, format, extra);
        const head = model.sections[0];
        const box = el('div', { className: 'mpc-detailbox' });

        // The top: name and badges on the left, the value large on the right,
        // and the actions under both.
        const nameBlock = el('div', { className: 'mpc-dname' }, [el('div', { className: 'mpc-dhead', textContent: head.headline })]);
        const badgeRow = el('div', { className: 'mpc-dbadges' });
        for (const b of model.badges) badgeRow.appendChild(el('span', { className: 'mpc-badge ' + (b.tone || 'grey') + (b.mono ? ' mono' : ''), textContent: b.text, title: b.title || '' }));
        nameBlock.appendChild(badgeRow);
        const valueBlock = el('div', { className: 'mpc-dvalue' }, [
            el('div', { className: 'mpc-dlead', textContent: head.lead }, [el('small', { textContent: head.leadNote || '' })]),
        ]);
        const actions = el('div', { className: 'mpc-dactions' });
        const command = ui.cmd ? ui.cmd.value : '';
        const pollBtn = el('button', { className: 'w2ui-btn mpc-b pri', textContent: 'Poll this register', title: 'Read it now, on its own, at this width' });
        pollBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            aimAtRegister(model.aim);
            if (typeof runOnce === 'function') runOnce();
        });
        const watchBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Watch', title: 'Read it every second until Stop' });
        watchBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            aimAtRegister(model.aim);
            if (typeof startRepeat === 'function') startRepeat();
        });
        const copyBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Copy command', title: command });
        copyBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            const text = ui.cmd ? ui.cmd.value : command;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => log('Copied: ' + text, 'ok'), () => log('Could not copy — the command is in the box above', 'warn'));
            } else {
                log('Could not copy — the command is in the box above', 'warn');
            }
        });
        const closeBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Close', title: 'Close this card' });
        closeBtn.addEventListener('click', ev => { ev.stopPropagation(); close(); });
        for (const b of [pollBtn, watchBtn, copyBtn, el('span', { className: 'mpc-spacer' }), closeBtn]) actions.appendChild(b);
        box.appendChild(el('div', { className: 'mpc-dtop' }, [nameBlock, valueBlock, actions]));

        // The facts, in columns.
        const cols = el('div', { className: 'mpc-dcols' });
        for (const section of model.sections.slice(1)) {
            const sec = el('div', { className: 'mpc-dsec' }, [el('h5', { textContent: section.title })]);
            for (const [label, text, mono, tip] of section.rows) {
                sec.appendChild(el('div', { className: 'mpc-kv', title: tip || '' }, [
                    el('span', { className: 'mpc-k', textContent: label }),
                    el('span', { className: 'mpc-v' + (mono ? ' mono' : '') + (label === 'because' ? ' dim' : ''), textContent: String(text) }),
                ]));
            }
            cols.appendChild(sec);
        }
        box.appendChild(cols);

        if (model.notes.length) {
            const notes = el('div', { className: 'mpc-dnotes' });
            for (const n of model.notes) notes.appendChild(el('div', { className: 'mpc-dnote ' + (n.tone || 'amber'), textContent: n.text }));
            box.appendChild(notes);
        }

        const detail = el('tr', { className: 'mpc-detail' }, [
            el('td', { colSpan: (ui.gridColumns || REGISTER_COLUMNS).length }, [box]),
        ]);
        // A click inside the card must not fall through to the row and close it.
        detail.addEventListener('click', ev => ev.stopPropagation());
        tr.classList.add('mpc-selected');
        tr.parentNode.insertBefore(detail, tr.nextSibling);
        // Opened near the bottom of the grid, the card would sit out of sight.
        try { detail.scrollIntoView({ block: 'nearest' }); } catch (e) { /* older engines */ }
    }

    function renderEmptyGrid(message) {
        if (!ui.gridBody) return;
        ui.gridBody.textContent = '';
        ui.gridBody.appendChild(el('tr', {}, [
            el('td', { className: 'mpc-empty', colSpan: (ui.gridColumns || REGISTER_COLUMNS).length, textContent: message }),
        ]));
        placeExpandButton();
    }

    const SCAN_COLUMNS = [
        { label: 'table', width: '11%', title: 'Which table the register lives in' },
        { label: 'ref', width: '6%', title: "modpoll's 1-based reference" },
        { label: 'addr', width: '6%', title: 'Protocol address' },
        { label: 'name', width: '27%', align: 'left', title: 'From the plant database or the loaded list' },
        { label: 'value', width: '8%', title: 'What the register held during the sweep' },
        { label: '2nd read', width: '8%', title: 'The same register read again once the sweep was done — a value that moved is being measured' },
        { label: 'as 32-bit', width: '10%', title: 'In a region judged to hold 32-bit values: this register and the next decoded as one, in the region\'s word order; ↑ marks the second half of a pair' },
        { label: 'shown', width: '10%', title: 'What the plant makes of it' },
        { label: 'unit', width: '5%' },
        { label: 'where from', width: '9%', align: 'left' },
    ];

    /** What a scanned register decodes to inside its region's verdict, if that verdict is 32-bit. */
    function decodedInRegion(report, table, ref, raw, nextRaw) {
        const region = scanRegionAt(report, table, ref);
        if (!region || region.format === '16-bit') return { region, text: '', aligned: true };
        const aligned = (ref - region.alignStart) % 2 === 0;
        if (!aligned) return { region, text: '↑', aligned };
        if (typeof nextRaw !== 'number') return { region, text: '', aligned };
        const d = decodePair(raw, nextRaw)[region.wordOrder === 'low word first' ? 'lowFirst' : 'highFirst'];
        if (region.format === 'int32') return { region, text: String(d.int32), aligned };
        if (region.format === 'uint32') return { region, text: String(d.uint32), aligned };
        // float32, or mixed: the float where it is one, a question mark where it is not.
        return { region, text: plausibleFloat(d.float) ? String(roundScaled(d.float, 4)) : (region.format === 'float32' ? '?' : ''), aligned };
    }

    /** Everything a scan found, most interesting first: the registers holding data. */
    function renderScan(report) {
        redrawGrid = () => renderScan(report);
        setGridColumns(SCAN_COLUMNS);
        ui.gridBody.textContent = '';
        const values = (report.values || []).slice();
        if (!values.length) {
            renderEmptyGrid('The scan found no registers holding values');
            ui.summary.textContent = '';
            return;
        }
        // Counted before the filter: hiding the zeros must not make the scan
        // look as if fewer registers answered. What moved between the two
        // reads comes first — it is what a reader is looking for.
        const all = values
            .map(v => Object.assign({ table: v.table, again: v.again, changed: !!v.changed }, enrichValue(v, v.table, '')))
            .sort((a, b) => (b.changed - a.changed) || ((a.raw === 0) - (b.raw === 0)) || a.table.localeCompare(b.table) || a.ref - b.ref);
        const onlyNonZero = ui.filterZero.checked;
        const rows = all.filter(r => !onlyNonZero || r.raw !== 0 || r.changed);
        const shown = rows.slice(0, 2000);
        const rawAt = new Map(values.map(v => [v.table + '|' + v.i, v.v]));
        const flagMeans = (report.modpoll && report.modpoll.measured) ? report.modpoll.bigEndianFlag : 'high word first';
        const frag = document.createDocumentFragment();
        for (const r of shown) {
            const tableName = (REGISTER_TABLES.find(t => t.value === r.table) || {}).label || r.table;
            const decoded = decodedInRegion(report, r.table, r.ref, r.raw, rawAt.get(r.table + '|' + (r.ref + 1)));
            const cells = [
                { text: tableName },
                { text: String(r.ref) },
                { text: String(r.addr) },
                { text: r.name || '', align: 'left' },
                { text: String(r.raw), className: r.raw === 0 ? 'zero' : '' },
                { text: typeof r.again === 'number' ? String(r.again) : '', className: r.changed ? 'changed' : (r.again === 0 ? 'zero' : '') },
                { text: decoded.text, className: decoded.text === '↑' || decoded.text === '?' ? 'zero' : '' },
                { text: r.shown === '' || r.shown === null ? '' : String(r.shown) },
                { text: r.unit || '' },
                { text: r.source || '', align: 'left' },
            ];
            const tr = el('tr', { className: 'mpc-clickable', title: 'Click to put this register in the command box, and to see every reading of it' },
                cells.map(c => el('td', {
                    textContent: c.text, className: c.className || '',
                    style: c.align === 'left' ? 'text-align:left' : '', title: c.text,
                })));
            tr.addEventListener('click', () => {
                // Aimed at the region's width: a float is read as a float, from
                // the first register of its pair.
                const region = decoded.region;
                const wide = region && (region.format === 'float32' || region.format === 'int32' || region.format === 'uint32');
                const command = wide
                    ? aimAtRegister({ table: r.table, ref: decoded.aligned ? r.ref : r.ref - 1, format: region.format === 'float32' ? 'float' : 'int', bigEndian: region.wordOrder === flagMeans })
                    : aimAtRegister({ table: r.table, ref: r.ref, format: '' });
                log('> ' + command + '   ← ' + (r.name || 'reference ' + r.ref) + ', ready to run');
                toggleDetailRow(tr, r.raw, pointForReading(r.table, '', r.ref), undefined, plantNamesFor(r.table, '', r.ref), r.table, r.ref, '', {
                    again: r.again, region: decoded.region, nextRaw: rawAt.get(r.table + '|' + (r.ref + 1)), flagMeans,
                    secondsAfter: report.reread ? report.reread.secondsAfterStart : null,
                });
            });
            frag.appendChild(tr);
        }
        ui.gridBody.appendChild(frag);
        const nonZero = all.filter(r => r.raw !== 0).length;
        const named = all.filter(r => r.name).length;
        const changed = all.filter(r => r.changed).length;
        const reread = all.filter(r => typeof r.again === 'number').length;
        ui.summary.textContent = all.length + ' registers answered, ' + nonZero + ' holding a value, ' +
            named + ' named' + (reread ? ', ' + changed + ' changed on the second read' : '') + (onlyNonZero ? ' — zeros hidden' : '') +
            (rows.length > shown.length ? ' — showing the first 2000' : '');
    }

    /** Matches in the grid, each one a click away from being polled. */
    function renderFindResults(matches, query) {
        // Names, not readings: the zero filter has nothing to apply to here.
        redrawGrid = null;
        setGridColumns(FIND_COLUMNS);
        ui.gridBody.textContent = '';
        if (!matches.length) {
            // Two different answers wear the same face: nothing matched, and
            // nothing could have matched because no names are loaded.
            const sources = [];
            if (pointList) sources.push(pointList.points.length + ' points from the list');
            if (plantNames) sources.push(plantNames.rows + ' parameters from the plant for ' + plantNames.unitId);
            renderEmptyGrid(sources.length
                ? 'Nothing called "' + query + '" in ' + sources.join(' and ') +
                    '. The plant names things in its own words — try part of one, or a reference number.'
                : 'No names are loaded yet. Pick a unit above, or press Names from plant, and the search has something to look in.');
            ui.summary.textContent = '';
            return;
        }
        const frag = document.createDocumentFragment();
        for (const m of matches) {
            const tableName = (REGISTER_TABLES.find(t => t.value === m.table) || {}).label || m.table;
            const cells = [
                { text: String(m.ref) },
                { text: String(m.addr) },
                { text: m.name, align: 'left' },
                { text: tableName },
                { text: m.value ? m.value + (m.unit ? ' ' + m.unit : '') : '' },
                { text: m.source + (m.group ? ' · ' + m.group : '') + (m.writable ? ' · writable' : ''), align: 'left' },
            ];
            const tr = el('tr', { className: 'mpc-clickable', title: 'Click to poll this register' },
                cells.map(c => el('td', {
                    textContent: c.text, style: c.align === 'left' ? 'text-align:left' : '', title: c.text,
                })));
            tr.addEventListener('click', () => pollMatch(m));
            frag.appendChild(tr);
        }
        ui.gridBody.appendChild(frag);
        ui.summary.textContent = matches.length + ' match' + (matches.length === 1 ? '' : 'es') +
            ' for "' + query + '" — click one to poll it';
    }

    /**
     * Point the form at one register and build its command. Clicking a row in any
     * list means "this one": the command box then holds exactly the command for
     * it, ready to run, edit or copy into a ticket.
     */
    function aimAtRegister(register) {
        ui.table.value = register.table;
        ui.format.value = register.format || '';
        if (register.bigEndian !== undefined) ui.bigEndian.checked = !!register.bigEndian;
        ui.base.value = 'printed';
        ui.start.value = String(register.ref);
        ui.count.value = '1';
        ui.cmdDirty = false;
        refreshPreview();
        return ui.cmd.value;
    }

    /**
     * The form, set to the poll the scan judged right — table, width, word
     * order, start and count — and the command box with it, so Run is the
     * next click. Said in the log with the reasons, so a wrong guess can be
     * seen for one.
     */
    function applyScanToForm(report) {
        const s = report.suggestedSpec;
        if (!s) { log('The scan found nothing to point the form at', 'warn'); return; }
        applyForm({ table: s.table, format: s.format, bigEndian: s.bigEndian, base: s.base, start: s.start, count: s.count });
        ui.cmdDirty = false;
        log('Form set from the scan: ' + ui.cmd.value, 'ok');
        for (const line of s.why) log('    ' + line);
        if (s.assumedFlag) log('    the word-order flag was not measured on this plant — if Run prints nonsense, toggle "Slave is big-endian"', 'warn');
        log('    Run polls it; a click on a scan row aims at that register instead, at its region\'s width');
    }

    /** The same, and read it, so a search ends in a value. */
    async function pollMatch(match) {
        aimAtRegister(match);
        log('Polling ' + match.name + ' — ' + (REGISTER_TABLES.find(t => t.value === match.table) || {}).label +
            ', reference ' + match.ref + ' (protocol ' + match.addr + ')');
        await runOnce();
    }

    function renderVerification(verification) {
        redrawGrid = () => renderVerification(verification);
        setGridColumns(POINT_COLUMNS);
        ui.gridBody.textContent = '';
        const onlyNonZero = ui.filterZero.checked;
        const frag = document.createDocumentFragment();
        for (const row of verification.rows) {
            if (onlyNonZero && row.raw === 0) continue;
            const p = row.point;
            const cells = [
                String(p.addr), String(p.ref), p.name, p.datatype,
                row.raw === undefined ? '' : String(row.raw),
                row.scaled === undefined ? '' : (p.decimals ? row.scaled.toFixed(p.decimals) : String(row.scaled)),
                p.unit || '', row.status,
                (row.flags && row.flags.length ? row.flags.join('; ') : (row.note || '')),
            ];
            const tr = el('tr', { className: 'mpc-clickable', title: 'Click for every reading of this register' },
                cells.map((text, i) => el('td', {
                    textContent: text,
                    className: (i === 4 && row.raw === 0) ? 'zero' : (i === 7 && (row.status === 'refused' || row.status === 'no answer') ? 'bad' : ''),
                    style: POINT_COLUMNS[i].align === 'left' ? 'text-align:left' : '',
                    title: text,
                })));
            if (row.raw !== undefined) {
                tr.addEventListener('click', () => {
                    aimAtRegister({ table: p.decoded.table, ref: p.ref, format: p.decoded.format, bigEndian: p.decoded.bigEndian });
                    toggleDetailRow(tr, row.raw, p, undefined, plantNamesFor(p.decoded.table, p.decoded.format, p.ref), p.decoded.table, p.ref, p.decoded.format);
                });
            }
            frag.appendChild(tr);
        }
        ui.gridBody.appendChild(frag);
        const s = verification.summary;
        ui.summary.textContent = s.points + ' points · ' + s.read + ' read, ' + s.zero + ' zero' +
            (onlyNonZero ? ' (hidden)' : '') + ', ' +
            s.refused + ' refused, ' + s.noAnswer + ' no answer · ' + s.ranges + ' poll commands · ' + s.elapsedMs + ' ms';
    }

    function renderGrid(result) {
        redrawGrid = () => renderGrid(result);
        const isBitTable = result.spec && (result.spec.table === '0' || result.spec.table === '1');
        setGridColumns(isBitTable ? BIT_COLUMNS : REGISTER_COLUMNS);
        ui.gridBody.textContent = '';
        const table = (result.spec && result.spec.table) || '4';
        const format = (result.spec && result.spec.format === '16-bit') ? '' : ((result.spec && result.spec.format) || '');
        // How wide a reading is follows the format it was polled with, not
        // whatever a loaded list says: -t4:int returns 32-bit values whether or
        // not a point list is loaded to agree about it.
        const wide = formatOf(format).step === 2;
        // Measured against the poll, not against what the filter left on screen:
        // a pass whose every value was hidden is still what the next one has to
        // be compared with. Done once per result, so a redraw — a filter toggle —
        // shows the deltas that poll produced instead of comparing the values it
        // has already recorded against themselves.
        if (result !== deltaSource) {
            for (const v of result.values) {
                const key = table + '|' + format + '|' + v.i;
                const previous = watchPrevious.get(key);
                watchDelta.set(key, previous === undefined ? null : roundScaled(v.v - previous));
                watchPrevious.set(key, v.v);
            }
            deltaSource = result;
        }
        const onlyNonZero = ui.filterZero.checked;
        const rows = result.values.filter(v => !onlyNonZero || v.v !== 0);
        const shown = rows.slice(0, 2000);
        if (!shown.length) {
            const allZero = result.values.length > 0;
            renderEmptyGrid(allZero ? 'Every register in this range read 0' : 'Nothing came back — see the log');
            ui.summary.textContent = allZero
                ? result.values.length + ' of ' + result.summary.requested + ' registers, all zero'
                : 'No values returned for the ' + result.summary.requested + ' register(s) asked for';
            return;
        }
        const frag = document.createDocumentFragment();
        let named = 0;
        for (const v of shown) {
            const u16 = v.v < 0 ? v.v + 65536 : v.v;
            const i16 = v.v > 32767 ? v.v - 65536 : v.v;
            // While repeating, a value that moved since the last pass is worth
            // seeing at a glance — that is most of what commissioning looks for.
            // Keyed by table and format as well as index: coil 1 and holding
            // register 1 are different registers, and comparing one against the
            // other reported changes that never happened.
            const watchKey = table + '|' + format + '|' + v.i;
            const delta = watchDelta.has(watchKey) ? watchDelta.get(watchKey) : null;
            const changed = delta !== null && delta !== 0;
            // The detail view reports what it moved from, and the delta is now
            // what survives a redraw, so the earlier value is derived from it.
            const previous = delta === null ? undefined : v.v - delta;
            // Three different things, and a blank cell used to be all three: this
            // register has not been read before, it has been and held still, it
            // moved. Only the last was ever shown, so on a plant where nothing
            // moves the column never said anything at all.
            const deltaCell = delta === null
                ? { text: '', title: 'First reading of this register — nothing to compare it against yet' }
                : (delta === 0
                    ? { text: '0', className: 'zero', title: 'Read again and unchanged' }
                    : { text: (delta > 0 ? '+' : '') + delta, className: 'changed', title: 'Moved since the previous poll' });
            const point = pointForReading(table, format, v.i);
            // A register the point list does not cover may still be named by the
            // plant's own parameter list, and several bits can share one register.
            const fromPlant = point ? null : plantNamesFor(table, format, v.i);
            if (point || fromPlant) named++;
            const scaled = point ? (point.scale.invert ? (v.v ? 0 : 1) : roundScaled(v.v * point.scale.factor, point.decimals)) : null;
            const plantLabel = fromPlant
                ? fromPlant[0].name + (fromPlant.length > 1 ? '  (+' + (fromPlant.length - 1) + ' more)' : '')
                : '';
            // The plant is already showing this register scaled, which is the
            // scaled value nobody has to derive.
            const plantScaled = fromPlant ? Number(String(fromPlant[0].plantValue).replace(',', '.')) : NaN;
            // modpoll prints a 32-bit value already decoded, so neither 16-bit
            // reading applies to it: four hex digits of a 32-bit integer is a
            // different number, and a float's bit pattern cannot be recovered
            // from the decimal at all. Both were being shown regardless.
            const hexText = !wide
                ? '0x' + (u16 >>> 0).toString(16).toUpperCase().padStart(4, '0')
                : (format === 'int' && Number.isInteger(v.v)
                    ? '0x' + (v.v >>> 0).toString(16).toUpperCase().padStart(8, '0')
                    : '');
            // Only when it says something the value column does not, which is
            // when the register came back above 32767.
            const i16Text = wide || i16 === v.v ? '' : String(i16);
            const sourceLabel = point
                ? point.datatype
                : (fromPlant ? fromPlant[0].group + (fromPlant.some(e => e.access === 'rw') ? ' · writable' : '') : '');
            const cells = isBitTable ? [
                { text: String(v.i) },
                { text: String(v.addr) },
                { text: point ? point.name : plantLabel, align: 'left' },
                { text: String(v.v), className: changed ? 'changed' : (v.v === 0 ? 'zero' : '') },
                { text: v.v ? 'ON' : 'OFF', className: changed ? 'changed' : (v.v === 0 ? 'zero' : '') },
                deltaCell,
                { text: sourceLabel, align: 'left' },
            ] : [
                { text: String(v.i) },
                // A 32-bit value is read out of two registers, and saying which two
                // is the difference between a list that lines up and one that does not.
                { text: wide ? v.addr + '–' + (v.addr + 1) : String(v.addr) },
                { text: point ? point.name : plantLabel, align: 'left' },
                { text: String(v.v), className: changed ? 'changed' : (v.v === 0 ? 'zero' : '') },
                {
                    // Whatever the plant shows, number or state text: "Auto" or
                    // "Alarm" against a raw 1 says more than an empty cell does.
                    text: scaled !== null
                        ? (point.decimals ? scaled.toFixed(point.decimals) : String(scaled))
                        : (fromPlant ? String(fromPlant[0].plantValue || '') : ''),
                    title: scaled === null && fromPlant ? 'What the plant itself shows for this parameter' : undefined,
                },
                { text: point ? (point.unit || '') : (fromPlant ? fromPlant[0].unit : '') },
                { text: hexText },
                { text: i16Text },
                deltaCell,
                { text: sourceLabel, align: 'left' },
            ];
            const tr = el('tr', { className: 'mpc-clickable', title: 'Click to put this register in the command box, and to see every reading of it' },
                cells.map(c => el('td', {
                    textContent: c.text, className: c.className || '',
                    style: c.align === 'left' ? 'text-align:left' : '', title: c.title || c.text,
                })));
            tr.addEventListener('click', () => {
                aimAtRegister({ table, ref: v.i, format });
                // The next register's value, for the 32-bit reading — only a
                // 16-bit poll has one to offer.
                const neighbour = wide ? undefined : result.values.find(o => o.i === v.i + 1);
                toggleDetailRow(tr, v.v, point, previous, fromPlant, table, v.i, format, { nextRaw: neighbour ? neighbour.v : undefined });
            });
            frag.appendChild(tr);
        }
        ui.gridBody.appendChild(frag);
        const s = result.summary;
        ui.summary.textContent = s.returned + ' of ' + s.requested + ' registers, ' + s.nonZero + ' non-zero, ' +
            (s.returned ? 'range ' + s.min + '…' + s.max + ', ' : '') + s.blocks + ' command' + (s.blocks === 1 ? '' : 's') +
            ', ' + s.elapsedMs + ' ms' +
            (named ? ' · ' + named + ' named from the list' : (pointList ? ' · none matched the loaded list' : '')) +
            (rows.length > shown.length ? ' — showing the first 2000 rows' : '');
        placeExpandButton();
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
                // A hand-edited command is run as typed, after the same write check
                // and with -1 put back if it was left out.
                const typed = ui.cmd.value.trim();
                const pollOnce = ensurePollOnce(typed);
                if (pollOnce !== typed) {
                    log('Added -1 so it polls once. Without it modpoll polls every second for ever: the shell fills up, ' +
                        'the port stays taken, and everything after it looks like it returned nothing.', 'warn');
                }
                const command = ensureDevicePath(pollOnce);
                if (command !== pollOnce) {
                    log('Wrote the COM port as \\\\.\\COMn. Windows opens ports above COM9 only by that name; ' +
                        'the bare name fails with "Port or socket open error", which looks like a held port but is not.', 'warn');
                }
                if (command !== typed) ui.cmd.value = command;
                assertReadOnly(command);
                log('> ' + command);
                const raw = await termRun(command, { timeoutMs: readForm().timeoutMs, fullOutput: true });
                const parsed = parseModpoll(raw);
                if (!parsed.values.length && !parsed.diagnostics.length) {
                    for (const line of parsed.notes.slice(0, 3)) log('  ' + line);
                }
                // What the typed command asked for, read off its own tokens, so the
                // grid, the detail view and the export take the table and the
                // width from the command instead of assuming a 16-bit holding
                // register — which put a float's hex in the grid and looked its
                // names up in the wrong table.
                const tokens = splitTokens(command);
                const argOf = flag => { const at = tokens.indexOf(flag); return at >= 0 ? String(tokens[at + 1] || '') : ''; };
                const [tableArg, formatArg] = argOf('-t').split(':');
                const hosts = tokens.filter((t, k) => !t.startsWith('-') && !(k > 0 && FLAGS_WITH_VALUE.has(tokens[k - 1])));
                result = {
                    ok: parsed.values.length > 0 && !parsed.fatal,
                    plant: plantIdFromHost(), at: new Date().toISOString(),
                    spec: {
                        raw: command,
                        table: /^[0134]$/.test(tableArg) ? tableArg : '4',
                        format: formatOf(formatArg).value || '16-bit',
                        mode: argOf('-m') || 'tcp', slave: Number(argOf('-a')) || 1, host: hosts[1] || '',
                    },
                    values: parsed.values,
                    summary: summarise(parsed.values, parsed.values.length, 0, 1),
                    diagnostics: parsed.diagnostics,
                    commands: [command],
                };
            } else {
                const form = readForm();
                storeSet(STORE_KEY, JSON.stringify(form));
                result = await readRegisters(form, p => {
                    // A poll of several blocks is long enough to watch; one block is not.
                    // Output landing mid-run moves the text, not the log.
                    const landing = p.partial && (p.arriving || p.refusals)
                        ? ' — ' + (p.arriving ? p.arriving + ' value' + (p.arriving === 1 ? '' : 's') + ' in' : '') +
                            (p.arriving && p.refusals ? ', ' : '') + (p.refusals ? p.refusals + ' refused' : '')
                        : '';
                    if (p.blocks > 1) showProgress(p.block / p.blocks, 'Block ' + p.block + ' of ' + p.blocks + landing);
                    else if (p.recovering) showProgress(1, 'Re-asking for ' + p.recovering + ' gap' + (p.recovering === 1 ? '' : 's') + landing);
                    if (p.partial || repeating) return;   // still the same command, or the command has not changed since the first pass
                    log('> ' + p.command + (p.blocks ? '   [' + p.block + '/' + p.blocks + ']' : ''));
                });
                hideProgress(1500);
            }
            lastResult = result;
            renderGrid(result);
            // Polled an address nobody named? If a unit on this plant answers at
            // that address, its names belong to this reading.
            if (!pointList && !plantNames) {
                const match = unitAtForm(_unitsCache || [], readForm());
                if (match) { await loadNamesFor(match.unit_id, true); renderGrid(result); }
            }
            for (const d of result.diagnostics) log(d.level.toUpperCase() + ': ' + d.text, d.level === 'warn' ? 'warn' : (d.level === 'fatal' || d.level === 'error' ? 'err' : ''));
            // Nothing came back and nothing explained it: show what the shell
            // actually printed, rather than leaving an empty grid to interpret.
            if (!result.values.length && !result.diagnostics.length) {
                const notes = result.notes || [];
                if (notes.length) for (const line of notes.slice(0, 3)) log('  ' + line, 'warn');
                else log('The command printed nothing at all. If a modpoll without -1 was started earlier it is still ' +
                    'polling and holding the port — Reconnect clears it.', 'warn');
            }
            if (result.ok) { setDot('ok'); if (!repeating) log('OK — ' + result.summary.returned + ' registers', 'ok'); }
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
        repeating = true;
        repeatTimer = setInterval(() => { if (!termState.busy) runOnce(); }, every);
        ui.stop.disabled = false;
        log('Repeating every ' + (every / 1000) + ' s — only what changes is logged from here; the grid marks the values that move');
    }

    function stopAll() {
        abortRequested = true;
        if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
        repeating = false;
        ui.stop.disabled = true;
        log('Stopped');
    }

    /**
     * Take a parsed list into the panel: fill in whatever the file already knows
     * about reaching the device, and say what was understood and what was not.
     */
    function adoptPointList(list, filename) {
        pointList = list;
        pointList.file = filename || null;
        const comm = list.comm || {};
        if (comm.mode) ui.mode.value = /tcp/i.test(comm.mode) ? 'tcp' : (/ascii/i.test(comm.mode) ? 'ascii' : 'rtu');
        if (comm.ip) ui.host.value = comm.ip;
        else if (comm.com_port) ui.host.value = comm.com_port;
        if (comm.port) ui.port.value = comm.port;
        if (comm.baudrate) ui.baudrate.value = String(comm.baudrate);
        // A list writes parity as N, E or O as often as by name; the select only
        // knows the names, and a value it does not know leaves it blank.
        if (comm.parity) {
            try { ui.parity.value = normaliseParity(comm.parity); }
            catch (e) { log('The list says parity "' + comm.parity + '", which is not a parity — left as it was', 'warn'); }
        }
        if (comm.stop_bits) ui.stopbits.value = String(comm.stop_bits);
        if (comm.data_bits) ui.databits.value = String(comm.data_bits);
        toggleSerial();
        refreshPreview();

        const refs = list.points.filter(p => p.decoded.ok).map(p => p.ref);
        ui.listNote.textContent = list.points.length + ' points' +
            (refs.length ? ', ref ' + Math.min.apply(null, refs) + '–' + Math.max.apply(null, refs) : '') +
            (list.undecodable ? ', ' + list.undecodable + ' undecodable' : '');
        ui.verifyBtn.disabled = false;
        log('Loaded ' + (filename || 'point list') + ': ' + list.points.length + ' points, addresses count from ' +
            (list.subtractOne ? 'one (subtract_one)' : 'zero') +
            (list.undecodable ? ' — ' + list.undecodable + ' datatype(s) not decoded, those points are not polled' : ''), 'ok');
        if (list.comm && (list.comm.ip || list.comm.com_port)) log('Connection taken from the list: ' + (list.comm.ip || list.comm.com_port));
    }

    /**
     * Run one of the plant's own commands, then show what the plant reports back.
     * A stop is remembered across reloads: the banner stays until the modules are
     * running again, because the worst outcome here is a plant left quiet by
     * someone who closed the tab and forgot.
     */
    async function runPlantCommand(cmd, label, isStop, extra) {
        try {
            log(label + ' — sending ' + cmd + ' to the plant…', isStop ? 'warn' : '');
            const answer = await plantCommand(cmd, extra);
            log(label + ': plant answered ' + (answer || '(nothing)'), 'ok');
            if (isStop) storeSet(STOP_MARK_KEY, JSON.stringify({ plant: plantIdFromHost(), at: Date.now() }));
            // The modules take a moment to settle either way.
            setTimeout(() => refreshPlantStatus(false), 1500);
            setTimeout(() => refreshPlantStatus(false), 6000);
        } catch (e) {
            log('ERROR: ' + label + ' failed: ' + e.message, 'err');
        }
    }

    function showPlantBanner(text, tone) {
        if (!ui.plantBanner) return;
        ui.plantBanner.textContent = text || '';
        ui.plantBanner.className = 'mpc-banner' + (text ? '' : ' mpc-hidden') + (tone ? ' ' + tone : '');
    }

    async function refreshPlantStatus(verbose) {
        try {
            const state = await fetchPlantProcesses();
            // Running or not, nothing finer. MASTER is the plant server itself; a
            // driver module being down is a different question from this one.
            const master = state.modules.find(m => m.module === 'MASTER');
            const stopped = master ? !master.running : state.running === 0;
            ui.plantStatus.textContent = 'Plant Server: ' + (stopped ? 'stopped' : 'running');
            let mark = null;
            try { mark = JSON.parse(storeGet(STOP_MARK_KEY, 'null')); } catch (e) { /* none */ }
            if (stopped) {
                const since = mark && mark.plant === plantIdFromHost()
                    ? ' — stopped from this console ' + Math.round((Date.now() - mark.at) / 60000) + ' minutes ago'
                    : '';
                showPlantBanner('Plant Server is stopped on plant ' + plantIdFromHost() + since +
                    '. Temperature logging and alarms are off until it is started again. Nothing here will start it for you.', 'danger');
            } else {
                showPlantBanner('');
                if (mark) storeSet(STOP_MARK_KEY, 'null');
            }
            if (verbose) log('Plant Server is ' + (stopped ? 'stopped' : 'running'), stopped ? 'warn' : 'ok');
            return state;
        } catch (e) {
            ui.plantStatus.textContent = 'Plant Server: status unavailable';
            if (verbose) log('ERROR: could not read the plant status: ' + e.message, 'err');
            return null;
        }
    }

    /** The plant's names for one unit, fetched once and kept. */
    async function loadNamesFor(unitId, quiet) {
        if (!unitId) return null;
        if (plantNames && plantNames.unitId === unitId) return plantNames;
        try {
            if (!quiet) log('Reading the plant\'s parameter names for ' + unitId + '…');
            plantNames = await fetchPlantNames(unitId);
            log(unitId + ': ' + plantNames.rows + ' parameters on ' + plantNames.byRef.size + ' registers, ' +
                plantNames.groups + ' groups' + (plantNames.undecodable ? ', ' + plantNames.undecodable + ' without a decodable driver_id' : ''), 'ok');
            // Whichever grid is up gets its names.
            if (lastResult) renderGrid(lastResult);
            else if (lastScan && lastScan.values) renderScan(lastScan);
            return plantNames;
        } catch (e) {
            log('Could not read the parameter names for ' + unitId + ': ' + e.message, 'warn');
            return null;
        }
    }

    /**
     * The names for whatever the form points at, found rather than asked for:
     * the unit chosen in the picker, or failing that the unit the plant
     * database has at this host and slave. A scan or an export without the
     * plant's parameters says what the device holds and nothing about what
     * IWMAC makes of it, which is half of what the export exists to say — so
     * this runs before a scan, and says so when it comes back empty-handed.
     */
    async function ensureNamesFor(form) {
        let unitId = ui.units ? ui.units.value : '';
        if (!unitId) {
            let units = _unitsCache;
            if (!units) {
                try { units = await fetchUnits(false); }
                catch (e) { units = null; log('Could not list the plant\'s units: ' + e.message, 'warn'); }
            }
            const unit = units ? unitAtForm(units, form) : null;
            if (unit) {
                unitId = unit.unit_id;
                log('The plant database has ' + unitId + ' (' + (unit.unit_name || unit.driver_type) + ') at ' + form.host + ' slave ' + form.slave);
            }
        }
        if (!unitId) {
            log('No unit in the plant database is at ' + form.host + ' slave ' + form.slave + ' — the scan will not be named and the ' +
                'export will carry no IWMAC parameters. Pick a unit from the list to attach them.', 'warn');
            return null;
        }
        return loadNamesFor(unitId);
    }

    /**
     * IWMAC's own side of the unit a scan named, read after the scan and hung
     * on its report — and its headline said in the log, so the panel shows what
     * Save JSON will: whether IWMAC's driver asks the way the device answered,
     * whether the driver runs, and whether its log shows it failing.
     */
    /**
     * IWMAC's side of the unit whose names are loaded, read now and kept for the
     * export. `used` is the connection modpoll talked to the device with — the
     * scan's, or the last poll's — so a driver set differently is said at once.
     */
    async function attachIwmacContext(report, used) {
        if (!plantNames) return null;
        try {
            iwmacContext = await collectIwmacContext(plantNames.unitId);
            if (report) report.iwmac = iwmacContext;
        } catch (e) {
            log('Could not read IWMAC\'s setup for ' + plantNames.unitId + ': ' + e.message, 'warn');
            return null;
        }
        const ctx = iwmacContext;
        const d = ctx.driver;
        if (d) {
            log('IWMAC: ' + plantNames.unitId + ' on driver ' + d.owner + (d.module ? (d.module.running ? ' (running)' : ' (not running)') : '') +
                (ctx.status ? ', unit status ' + ctx.status.unitStatus : '') + (ctx.registration ? ', table ' + ctx.registration.table : ''),
                d.module && !d.module.running ? 'warn' : '');
            const diff = compareConnections(used || (report && report.spec), d.connection).filter(c => c.same === false);
            if (diff.length) {
                log('IWMAC\'s driver is set differently from how the device answered: ' +
                    diff.map(c => c.field + ' ' + c.iwmac + ' (modpoll used ' + c.modpoll + ')').join(', '), 'warn');
            }
            if (ctx.log && ctx.log.current) {
                const counts = ctx.log.current.counts || {};
                const bad = LOG_TROUBLE.filter(k => counts[k]).map(k => counts[k] + ' ' + k);
                log('Driver log for ' + d.owner + ': ' + ctx.log.lines + ' lines of this unit and the driver' +
                    (bad.length ? ', ' + bad.join(', ') + ' since ' + ctx.log.current.after : ', no errors since ' + ctx.log.current.after), bad.length ? 'warn' : '');
            }
        }
        if (ctx.unavailable.length) log('Not read from IWMAC: ' + ctx.unavailable.join('; '), 'warn');
        return ctx;
    }

    async function runVerification() {
        if (!pointList || termState.busy) return;
        termState.busy = true;
        abortRequested = false;
        ui.verifyBtn.disabled = true;
        ui.stop.disabled = false;
        setDot('warn');
        try {
            const verification = await verifyPointList(pointList, readForm(), p => {
                showProgress(p.range / p.ranges, 'Verifying range ' + p.range + ' of ' + p.ranges + ' — -r ' + p.ref + ' -c ' + p.count);
                log('> range ' + p.range + '/' + p.ranges + ': -r ' + p.ref + ' -c ' + p.count);
            });
            lastVerification = verification;
            showProgress(1, 'Verification complete');
            hideProgress(2500);
            renderVerification(verification);
            for (const d of verification.diagnostics) log(d.level.toUpperCase() + ': ' + d.text, d.level === 'warn' ? 'warn' : 'err');
            const s = verification.summary;
            log(s.read + ' read, ' + s.zero + ' zero, ' + s.refused + ' refused, ' + s.noAnswer + ' no answer, ' +
                s.flagged + ' flagged — ' + s.elapsedMs + ' ms', s.refused || s.noAnswer ? 'warn' : 'ok');
            if (verification.offsetVerdict) {
                log('An offset of ' + (verification.offsetVerdict.shift > 0 ? '+' : '') + verification.offsetVerdict.shift +
                    ' scores better than the list as written — confirm against a known setpoint before moving anything', 'warn');
            }
            ui.reportBtn.disabled = false;
            ui.verifyJsonBtn.disabled = false;
            setDot(s.read ? 'ok' : 'err');
        } catch (e) {
            setDot('err');
            log('ERROR: ' + e.message, 'err');
            hideProgress();
        } finally {
            termState.busy = false;
            ui.verifyBtn.disabled = false;
            ui.stop.disabled = !repeatTimer;
        }
    }

    function download(filename, text, mime) {
        const blob = new Blob([text], { type: mime || 'application/json' });
        const a = el('a', { href: URL.createObjectURL(blob), download: filename });
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function resultFilename() {
        const s = lastResult && lastResult.spec || {};
        // A scan without a poll is still a device: name the file after it, and
        // after the unit when its names are loaded.
        const host = s.host || (lastScan && lastScan.host) || 'raw';
        const unit = plantNames && plantNames.unitId ? String(plantNames.unitId).replace(/[^\w.-]+/g, '-') + '_' : '';
        return 'modpoll_' + (plantIdFromHost() || 'plant') + '_' + unit + host + '_' + nowStamp() + '.json';
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
            // If the form already points at one of them, that is the unit in hand.
            const current = unitAtForm(units, readForm());
            if (current && !ui.units.value) { ui.units.value = current.unit_id; loadNamesFor(current.unit_id); }
        } catch (e) {
            log('ERROR: ' + e.message, 'err');
        } finally {
            ui.units.disabled = false;
        }
    }

    /**
     * The unit the form is pointed at. Several units can share a host — a TCP
     * gateway carries one per slave — so the slave decides between them, and the
     * host alone is trusted only when it names exactly one unit. Matching on the
     * host alone attached the first unit's names to whichever slave was polled.
     */
    function unitAtForm(units, form) {
        const host = String(form.host || '').trim();
        if (!host) return null;
        const atHost = units.filter(u => u.host && u.host === host);
        const slave = Number(form.slave) || 1;
        return atHost.find(u => Number(u.slave) === slave) || (atHost.length === 1 ? atHost[0] : null);
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
        // Worth saying before the poll rather than after it fails: the Plant
        // Server polls the bus continuously and keeps the COM port open.
        // Picking a unit is the point at which its names become useful — for the
        // grid, and for searching by what things are called. Asking for them then
        // is one round trip nobody has to remember to make.
        loadNamesFor(u.unit_id);
        if (u.bus && u.bus.serial) {
            log('This unit sits on ' + u.bus.com + ', which the Plant Server holds open. modpoll cannot have that port ' +
                'until the Plant Server is stopped — and stopping it stops temperature logging and alarms, so that is a ' +
                'decision for whoever owns the plant.', 'warn');
            if (u.bus.gateway) {
                log(u.bus.com + ' is a gateway at ' + u.bus.gateway + '. Try mode ENC against that address first — ' +
                    'RTU framing over TCP reaches the same bus without taking the port from anyone. Port 4001 upwards ' +
                    'is the usual mapping, one per serial port.', 'warn');
            }
        }
    }

    function buildPanel() {
        document.head.appendChild(el('style', { textContent: STYLE }));

        const panel = el('div', { id: PANEL_ID });

        ui.dot = el('span', { className: 'mpc-dot', title: 'Idle' });
        const head = el('div', { className: 'mpc-head' }, [
            el('span', { className: 'mpc-title', textContent: 'Modpoll' }),
            el('span', { className: 'mpc-ver', textContent: 'v' + VERSION + ' · plant ' + (plantIdFromHost() || '?') + ' · read only' }),
            ui.dot,
        ]);

        const body = ui.body = el('div', { className: 'mpc-body' });
        const form = el('div', { className: 'mpc-form' });
        body.appendChild(form);

        // --- unit picker: 9 + 3 columns ----------------------------------
        ui.units = el('select', {}, [el('option', { value: '', textContent: 'Units not loaded' })]);
        ui.units.addEventListener('change', () => applyUnit(ui.units.value));
        const loadBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Load units' });
        loadBtn.addEventListener('click', loadUnits);
        form.appendChild(field('Unit — from the plant database', ui.units, 9));
        form.appendChild(field(' ', loadBtn, 3));

        // --- connection: 2 + 6 + 2 + 2, or 2 + 8 + 2 without a TCP port ---
        // ENC is Modbus RTU framed inside a TCP connection, which is what a serial
        // gateway in TCP-server mode expects — and the only way to reach a serial
        // device without taking the COM port from the Plant Server.
        ui.mode = el('select', {}, ['tcp', 'rtu', 'enc', 'ascii'].map(v =>
            el('option', { value: v, textContent: v.toUpperCase(), title: v === 'enc' ? 'RTU framing over TCP, for a serial gateway' : v.toUpperCase() })));
        ui.mode.addEventListener('change', () => { toggleSerial(); ui.cmdDirty = false; refreshPreview(); });
        ui.host = el('input', { placeholder: '10.0.0.5' });
        ui.hostWrap = field('IP address', ui.host, 6);
        ui.hostLabel = ui.hostWrap.querySelector('label');
        ui.port = el('input', { value: '502' });
        ui.portWrap = field('TCP port', ui.port, 2);
        ui.slave = el('input', { value: '1' });
        form.appendChild(field('Mode', ui.mode, 2));
        form.appendChild(ui.hostWrap);
        form.appendChild(ui.portWrap);
        form.appendChild(field('Slave (-a)', ui.slave, 2));

        // --- serial settings: four equal columns, hidden in TCP mode ------
        ui.baudrate = el('select', {}, ['1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'].map(v => el('option', { value: v, textContent: v })));
        ui.baudrate.value = '9600';
        ui.parity = el('select', {}, ['none', 'even', 'odd'].map(v => el('option', { value: v, textContent: v })));
        ui.databits = el('select', {}, ['8', '7'].map(v => el('option', { value: v, textContent: v })));
        ui.stopbits = el('select', {}, ['1', '2'].map(v => el('option', { value: v, textContent: v })));
        ui.serialFields = [
            field('Baud (-b)', ui.baudrate, 3), field('Parity (-p)', ui.parity, 3),
            field('Data bits (-d)', ui.databits, 3), field('Stop bits (-s)', ui.stopbits, 3),
        ];
        for (const wrap of ui.serialFields) form.appendChild(wrap);

        // --- register range: 3 + 3 + 2 + 2 + 2 ----------------------------
        ui.table = el('select', {}, REGISTER_TABLES.map(t => el('option', { value: t.value, textContent: t.label, title: t.title })));
        ui.table.value = '4';
        ui.base = el('select', {}, [
            el('option', { value: 'printed', textContent: 'as modpoll prints' }),
            el('option', { value: 'protocol', textContent: 'protocol address' }),
        ]);
        ui.start = el('input', { value: '1' });
        ui.count = el('input', { value: '10' });
        ui.timeout = el('input', { value: '25' });
        ui.format = el('select', {}, FORMATS.map(f => el('option', { value: f.value, textContent: f.label })));
        ui.bigEndian = el('input', { type: 'checkbox', id: 'mpc-endian' });
        form.appendChild(field('Table (-t)', ui.table, 3));
        form.appendChild(field('Format', ui.format, 2));
        form.appendChild(field('Start is', ui.base, 3));
        form.appendChild(field('Start (-r)', ui.start, 2));
        form.appendChild(field('Count (-c)', ui.count, 2));
        // Timeout and the endian switch share the last row, which keeps the
        // twelve-column rhythm without a lonely field on its own line.
        form.appendChild(field('Timeout s', ui.timeout, 2));
        form.appendChild(el('label', { className: 'mpc-check mpc-span4', htmlFor: 'mpc-endian', title: 'Adds -i for 32-bit integers, -f for 32-bit floats' },
            [ui.bigEndian, el('span', { textContent: 'Slave is big-endian (32-bit only)' })]));

        for (const input of [ui.host, ui.port, ui.slave, ui.start, ui.count]) {
            input.addEventListener('input', () => { ui.cmdDirty = false; refreshPreview(); });
            // Enter runs, the way a terminal would.
            input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runOnce(); } });
        }
        for (const sel of [ui.table, ui.base, ui.format, ui.baudrate, ui.parity, ui.databits, ui.stopbits, ui.bigEndian]) {
            sel.addEventListener('change', () => { ui.cmdDirty = false; refreshPreview(); });
        }

        // --- command preview ----------------------------------------------
        ui.cmd = el('input', { className: 'mpc-cmd', spellcheck: false });
        ui.cmdDirty = false;
        ui.cmd.addEventListener('input', () => { ui.cmdDirty = true; ui.blockNote.textContent = 'Hand-edited — run as typed, blocks are not split'; });
        ui.blockNote = el('div', { className: 'mpc-note' });
        form.appendChild(field('Command — editable, read-only commands only', ui.cmd, 12));
        form.appendChild(ui.blockNote);

        // --- actions --------------------------------------------------------
        ui.run = el('button', { className: 'w2ui-btn mpc-b pri', textContent: 'Run' });
        ui.run.addEventListener('click', runOnce);
        ui.stop = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Stop', disabled: true });
        ui.stop.addEventListener('click', stopAll);
        // A second is what watching a value actually means; anything slower is a
        // decision, not a default.
        ui.every = el('input', { value: '1' });
        const repeat = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Repeat', title: 'Run again on an interval' });
        repeat.addEventListener('click', startRepeat);
        // The one export: everything known, as one file an agent can read — see
        // exportResult for what goes in. Splitting for a knowledge set is the
        // API's job, __modpoll.exportParts().
        const saveBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Save JSON',
            title: 'Everything known about these registers, as one file a Copilot agent can read: the readings now and before, ' +
                'the list, every parameter the plant maps and shows, the verification, the scan' });
        saveBtn.addEventListener('click', async () => {
            if (!lastResult && !plantNames && !pointList && !lastVerification && !lastScan) {
                return log('Nothing to save yet — run a poll, a scan or a verification, or load a list or a unit\'s names');
            }
            // A scan reads IWMAC's side of the unit and a poll does not, so a
            // file saved after a poll reads it here — without it the file cannot
            // set the device beside IWMAC's driver and definitions at all.
            if (plantNames && (!iwmacContext || iwmacContext.unitId !== plantNames.unitId)) {
                saveBtn.disabled = true;
                try { await attachIwmacContext(null, lastResult ? lastResult.spec : (lastScan && lastScan.spec)); }
                finally { saveBtn.disabled = false; }
            }
            const doc = exportResult(lastResult);
            const text = exportText(doc);
            const filename = resultFilename();
            download(filename, text);
            const sections = EXPORT_SECTIONS.filter(s => doc[s].length).map(s => doc[s].length + ' ' + s);
            log('Saved ' + filename + (sections.length ? ' — ' + sections.join(', ') : '') + ', ' + Math.round(text.length / 1000) + ' k characters' +
                (text.length > 36000 ? ' — over the 36 000 a knowledge file may hold; __modpoll.exportParts() splits it' : ''), 'ok');
        });
        const reconnectBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Reconnect', title: 'Throw away the Plant Term session and take a fresh one' });
        reconnectBtn.addEventListener('click', async () => {
            reconnectBtn.disabled = true;
            try { await reconnectTerminal(); log('Plant Term reconnected', 'ok'); setDot(''); }
            catch (e) { log('ERROR: ' + e.message, 'err'); setDot('err'); }
            finally { reconnectBtn.disabled = false; }
        });
        const scanBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Scan device', title: 'Find every register this device answers with, table by table' });
        scanBtn.addEventListener('click', async () => {
            if (termState.busy) return;
            scanBtn.disabled = true;
            termState.busy = true;
            abortRequested = false;
            ui.stop.disabled = false;
            setDot('warn');
            try {
                log('Scanning ' + ui.host.value + ' slave ' + ui.slave.value + ' — every table, every region it answers in, ' +
                    'holes isolated, up to reference ' + SWEEP_CEILING + ', then everything found read once more. Stop ends it early');
                showProgress(0, 'Starting the scan');
                // The unit's own parameters first, so what the scan finds is
                // named as it lands and the export can say what IWMAC reads —
                // without a separate click nobody remembers to make.
                showProgress(0, 'Reading the plant\'s parameter names for this unit');
                await ensureNamesFor(readForm());
                startCostLedger();
                const report = await scanDevice(readForm(), true, p => {
                    // The bar moves on every tick sweepForValues makes, several
                    // times inside one chunk on a strict device; the log stays at
                    // one line per chunk opened, or it would scroll past reading.
                    showProgress(p.fraction, p.text);
                    if (p.phase === 'sweep' && p.chunkStart) {
                        log('  reading ' + (REGISTER_TABLES.find(r => r.value === p.table) || {}).label +
                            ' from ' + p.ref + ' (' + p.found + ' found so far)');
                    }
                });
                report.cost = finishCostLedger();
                lastScan = report;
                showProgress(0.995, 'Reading IWMAC\'s own setup for this unit');
                await attachIwmacContext(report);
                for (const table of Object.keys(report.tables)) {
                    const t = report.tables[table];
                    const name = (REGISTER_TABLES.find(r => r.value === table) || {}).label || table;
                    const swept = report.sweep && report.sweep[table];
                    if (!t.answers) { log(name + ': no answer'); continue; }
                    log(name + ': answers from ' + t.firstReadable +
                        (swept ? ' — ' + swept.answered + ' registers, ' + swept.nonZero + ' holding a value' +
                            (swept.first !== null ? ', ' + swept.first + '–' + swept.last : '') +
                            (swept.regions.length > 1 ? ', in ' + swept.regions.length + ' regions' : '') : ''), 'ok');
                    if (swept && swept.withValues) log('    with values: ' + swept.withValues);
                    for (const region of (swept ? swept.regions : [])) {
                        log('    from ' + region.from + ': ' + region.answered + ' registers' +
                            (region.first !== null ? ' (' + region.first + '–' + region.last + ')' : '') + ', ' + region.nonZero + ' holding a value — ' +
                            region.stoppedBecause);
                    }
                }
                if (report.reread) {
                    const rr = report.reread;
                    log('Read everything found again ' + rr.secondsAfterStart + ' s after the scan began: ' + rr.changed + ' of ' + rr.reread +
                        ' registers changed' + (rr.changed ? ' — ' + Object.keys(rr.changedRanges).map(t =>
                            (REGISTER_TABLES.find(r => r.value === t) || {}).label + ' ' + rr.changedRanges[t]).join('; ') : '') +
                        (rr.stopped ? ' (stopped before the end)' : ''), rr.changed ? 'ok' : '');
                }
                for (const table of Object.keys(report.formats || {})) {
                    for (const r of report.formats[table].regions) {
                        log('    ' + (REGISTER_TABLES.find(t => t.value === table) || {}).label + ' ' + r.from + '-' + r.to + ': ' + r.format +
                            (r.wordOrder && r.format !== '16-bit' ? ', ' + r.wordOrder : '') + ' (' + r.confidence + ') — ' + r.evidence);
                    }
                }
                if (report.modpoll) {
                    log(report.modpoll.measured
                        ? 'modpoll\'s -f flag gives ' + report.modpoll.bigEndianFlag + ' on this plant — measured on ' +
                            (REGISTER_TABLES.find(t => t.value === report.modpoll.table) || {}).label + ' from ' + report.modpoll.ref
                        : 'Could not measure what modpoll\'s -f flag means here' + (report.modpoll.error ? ': ' + report.modpoll.error : ' — the float reads printed neither order'), report.modpoll.measured ? '' : 'warn');
                }
                log('Scan finished in ' + Math.round(report.elapsedMs / 1000) + ' s' +
                    (plantNames ? ' — Save JSON now carries ' + plantNames.rows + ' IWMAC parameters and a suggestion per named register' : ''), 'ok');
                renderScan(report);
                applyScanToForm(report);
                setDot('ok');
                hideProgress(2500);
            } catch (e) { log('ERROR: ' + e.message, 'err'); setDot('err'); hideProgress(); }
            finally {
                if (costLedger) finishCostLedger();
                scanBtn.disabled = false;
                termState.busy = false;
                ui.stop.disabled = !repeatTimer;
            }
        });
        form.appendChild(el('div', { className: 'mpc-actions' }, [
            ui.run, ui.stop, repeat, field('Every s', ui.every, 2),
            el('span', { className: 'mpc-spacer' }), scanBtn, saveBtn, reconnectBtn,
        ]));
        ui.progressFill = el('div');
        ui.progressText = el('span', { className: 'mpc-ptext' });
        ui.progress = el('div', { className: 'mpc-progress mpc-hidden' }, [
            el('div', { className: 'mpc-bar' }, [ui.progressFill]), ui.progressText,
        ]);
        form.appendChild(ui.progress);

        // --- the Plant Server ------------------------------------------------
        form.appendChild(el('div', { className: 'mpc-sep' }));
        ui.plantBanner = el('div', { className: 'mpc-banner mpc-hidden' });
        form.appendChild(ui.plantBanner);

        ui.plantStatus = el('span', { className: 'mpc-sum', textContent: 'Plant Server: not checked' });
        const statusBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Check', title: 'Which plant modules are running' });
        statusBtn.addEventListener('click', () => refreshPlantStatus(true));

        // Two clicks, never one: the first arms, the second fires, and walking
        // away disarms it again.
        ui.stopBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Stop Plant Server' });
        let armed = null;
        const disarm = () => {
            clearTimeout(armed);
            armed = null;
            ui.stopBtn.textContent = 'Stop Plant Server';
            ui.stopBtn.classList.remove('danger');
        };
        ui.stopBtn.addEventListener('click', async () => {
            if (!armed) {
                ui.stopBtn.textContent = 'Confirm: stop ' + (plantIdFromHost() || 'this plant') + ' — logging and alarms off';
                ui.stopBtn.classList.add('danger');
                armed = setTimeout(disarm, 8000);
                return;
            }
            disarm();
            await runPlantCommand('stop_plant_server', 'Stop Plant Server', true);
        });

        const startBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Start Plant Server' });
        startBtn.addEventListener('click', () => runPlantCommand('start_plant_server_norm', 'Start Plant Server', false));
        const startNogenBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Start -nogen', title: 'The second Start button IWMAC Escape offers' });
        startNogenBtn.addEventListener('click', () => runPlantCommand('start_plant_server_nogen', 'Start Plant Server (nogen)', false));

        form.appendChild(el('div', { className: 'mpc-actions' }, [
            statusBtn, ui.stopBtn, startBtn, startNogenBtn,
            el('span', { className: 'mpc-spacer' }), ui.plantStatus,
        ]));

        // --- point list ------------------------------------------------------
        form.appendChild(el('div', { className: 'mpc-sep' }));
        ui.listFile = el('input', { type: 'file', accept: '.json,application/json', className: 'mpc-hidden' });
        ui.listFile.addEventListener('change', () => {
            const file = ui.listFile.files && ui.listFile.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try { adoptPointList(parsePointList(String(reader.result)), file.name); }
                catch (e) { log('ERROR: ' + e.message, 'err'); }
            };
            reader.readAsText(file);
            ui.listFile.value = '';
        });
        const loadListBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Load point list', title: 'A modbusgen project JSON' });
        loadListBtn.addEventListener('click', () => ui.listFile.click());
        ui.verifyBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Verify list', disabled: true, title: 'Poll every point the list declares' });
        ui.verifyBtn.addEventListener('click', runVerification);
        ui.reportBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Save report', disabled: true, title: 'Markdown for a Copilot knowledge file' });
        ui.reportBtn.addEventListener('click', () => {
            if (!lastVerification) return;
            for (const part of buildCopilotReport(lastVerification)) download(part.name, part.text, 'text/markdown');
        });
        ui.verifyJsonBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Save verification', disabled: true });
        ui.verifyJsonBtn.addEventListener('click', () => {
            if (!lastVerification) return;
            download('modpoll-verify_' + nowStamp() + '.json', JSON.stringify(lastVerification, null, 2));
        });
        const plantNamesBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Names from plant', title: "Every parameter the plant holds for this unit, by the register it reads" });
        plantNamesBtn.addEventListener('click', async () => {
            const unitId = ui.units.value;
            if (!unitId) return log('Pick a unit first — load the unit list, then choose one', 'warn');
            plantNamesBtn.disabled = true;
            // Pressing it for the unit already loaded means refresh, not nothing.
            if (plantNames && plantNames.unitId === unitId) { plantNames = null; _namesCache.clear(); }
            try { await loadNamesFor(unitId); }
            finally { plantNamesBtn.disabled = false; }
        });
        ui.listNote = el('span', { className: 'mpc-sum', textContent: 'No point list loaded' });
        form.appendChild(el('div', { className: 'mpc-actions' }, [
            loadListBtn, ui.verifyBtn, ui.reportBtn, ui.verifyJsonBtn, plantNamesBtn,
            el('span', { className: 'mpc-spacer' }), ui.listNote, ui.listFile,
        ]));

        // --- find a register by what it is called -----------------------------
        ui.find = el('input', { placeholder: 'tilluft, setpunkt, 432 …', className: 'mpc-cmd' });
        let findTimer = null;
        let findMatches = [];
        const runFind = async announce => {
            const query = ui.find.value.trim();
            if (!query) {
                // Back to whatever was on screen before the search started.
                if (lastResult) renderGrid(lastResult); else renderEmptyGrid('No registers polled yet');
                return;
            }
            // Searching with nothing to search is the commonest way to see an
            // empty result. If a unit is chosen, fetch its names and carry on.
            if (!pointList && !plantNames && ui.units.value) await loadNamesFor(ui.units.value);
            findMatches = findByName(query);
            renderFindResults(findMatches, query);
            if (announce) {
                log(findMatches.length + ' match' + (findMatches.length === 1 ? '' : 'es') + ' for "' + query + '"',
                    findMatches.length ? 'ok' : 'warn');
            }
        };
        // Searching while typing, after a pause short enough not to be noticed and
        // long enough not to run on every keystroke. A single letter matches half
        // the plant, so it waits for two — unless it is a digit, which is already
        // a reference.
        ui.find.addEventListener('input', () => {
            clearTimeout(findTimer);
            findTimer = setTimeout(() => {
                const query = ui.find.value.trim();
                if (query.length === 1 && !/^\d$/.test(query)) return;
                runFind(false);
            }, 150);
        });
        ui.find.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            clearTimeout(findTimer);
            runFind(true);
            // One match and Enter means poll it: the search is finished either way.
            if (findMatches.length === 1) pollMatch(findMatches[0]);
        });
        const findBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Find register' });
        findBtn.addEventListener('click', () => runFind(true));
        form.appendChild(field('Find by alias text, or by a reference', ui.find, 9));
        form.appendChild(field(' ', findBtn, 3));

        // --- results ---------------------------------------------------------
        form.appendChild(el('div', { className: 'mpc-sep' }));
        ui.filterZero = el('input', { type: 'checkbox', id: 'mpc-hidezero' });
        ui.filterZero.addEventListener('change', () => { if (redrawGrid) redrawGrid(); });
        form.appendChild(el('label', { className: 'mpc-check mpc-span3', htmlFor: 'mpc-hidezero' },
            [ui.filterZero, el('span', { textContent: 'Hide zero values' })]));
        ui.summary = el('div', { className: 'mpc-sum', textContent: 'No poll run yet' });
        form.appendChild(el('div', { className: 'mpc-check mpc-span9', style: 'justify-content:flex-end' }, [ui.summary]));

        ui.gridBody = el('tbody');
        ui.gridCols = el('colgroup');
        ui.gridHead = el('thead');
        const table = el('table', { className: 'mpc-grid' }, [ui.gridCols, ui.gridHead, ui.gridBody]);
        setGridColumns(REGISTER_COLUMNS);
        // The corner control is pinned to the zone rather than added to the header
        // row: the header is rebuilt from scratch every time the column set
        // changes, and a th of its own would take width from the columns.
        ui.expand = el('button', { className: 'mpc-expand', type: 'button' });
        ui.expand.addEventListener('click', () => setExpanded(!isExpanded()));
        ui.gridWrap = el('div', { className: 'mpc-gridwrap' }, [table]);
        ui.gridZone = el('div', { className: 'mpc-gridzone' }, [ui.gridWrap, ui.expand]);
        form.appendChild(ui.gridZone);
        form.appendChild(makeGrip(PANES.grid));
        renderEmptyGrid('No registers polled yet');

        ui.log = el('div', { className: 'mpc-log' });
        form.appendChild(ui.log);
        form.appendChild(makeGrip(PANES.log));

        panel.appendChild(head);
        panel.appendChild(body);
        // The panel is kept detached until the sidebar item is clicked, and is moved
        // rather than rebuilt when the user leaves the tool and comes back, so the
        // form, the last result and a running repeat all survive the round trip.
        ui.panel = panel;

        toggleSerial();
        for (const spec of Object.values(PANES)) {
            const savedHeight = Number(storeGet(spec.key, 0));
            if (savedHeight) setPaneHeight(spec, savedHeight, false);
        }
        syncExpandButton();
        watchExpanded();
        // A stop this console made outlives the tab it was made in, so check on
        // load rather than waiting to be asked.
        try {
            const mark = JSON.parse(storeGet(STOP_MARK_KEY, 'null'));
            if (mark && mark.plant === plantIdFromHost()) refreshPlantStatus(false);
        } catch (e) { /* nothing recorded */ }
        try { applyForm(JSON.parse(storeGet(STORE_KEY, 'null'))); } catch (e) { /* first run */ }
        refreshPreview();
        log('Ready. Registers are read only; a value after the host is refused.');
        return panel;
    }

    // ------------------------------------------------- sys_tools integration

    /**
     * The console is a sys_tools tool, not an overlay: it gets its own item in the
     * Tools group, under Screen Dump, and renders into the same main panel every
     * other tool uses.
     */
    function addSidebarItem() {
        const sb = pageWin.w2ui && pageWin.w2ui.sidebar;
        if (!sb || typeof sb.insert !== 'function') return false;
        if (sb.get(SIDEBAR_ID)) return true;
        const sibling = sb.get('screen_dump') || sb.get('plant_term') || {};
        const node = { id: SIDEBAR_ID, text: 'Modpoll' };
        // Match whatever the neighbouring items use, so the new one does not stand out.
        if (sibling.icon) node.icon = sibling.icon;
        if (sibling.img) node.img = sibling.img;
        sb.insert('tools', null, node);
        return true;
    }

    /**
     * Sidebar clicks all funnel through the page's own my_do_action. Wrapping it
     * keeps the shell's routing intact and claims one extra action id.
     */
    function hookRouter() {
        const current = pageWin.my_do_action;
        if (typeof current !== 'function') return;
        // Unwrap first: a re-run — an agent re-evaluating the script into a live
        // page — must replace the previous hook rather than stack on it, or the
        // sidebar keeps opening the panel belonging to the copy that is gone.
        const original = current.__mpcOriginal || current;
        const wrapped = function (action) {
            if (action === SIDEBAR_ID) { showConsole(); return undefined; }
            return original.apply(this, arguments);
        };
        wrapped.__mpcWrapped = true;
        wrapped.__mpcOriginal = original;
        pageWin.my_do_action = wrapped;
    }

    function showConsole() {
        const layout = pageWin.w2ui && pageWin.w2ui.layout2;
        if (!layout || !ui.panel) return;
        // Opening the tool is enough of an instruction: fetch the unit list, and
        // with it the names, so nothing here waits to be asked twice.
        if (!ui.unitsRequested) { ui.unitsRequested = true; setTimeout(() => loadUnits(), 50); }
        layout.html('main', "<div id='" + HOST_ID + "' style='height:100%;width:100%'></div>");
        // w2ui swaps the panel's content asynchronously in some versions; retry
        // briefly rather than dropping the panel on the floor.
        waitFor(() => document.getElementById(HOST_ID), 4000, 'the main panel')
            .then(host => { if (ui.panel.parentElement !== host) host.appendChild(ui.panel); })
            .catch(() => log('Could not attach to the main panel', 'err'));
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
                '                                          format: "" 16-bit | int | float | mod | hex',
                '                                          bigEndian: true adds -i (int) or -f (float)',
                'await __modpoll.raw("modpoll.exe …")      one command, parsed; writes are refused',
                'await __modpoll.scan({host, slave})       every register the device answers for, read twice; names the unit first',
                '__modpoll.loadList(projectJson)           adopt a modbusgen project: points and system.comm',
                'await __modpoll.verify()                  poll every point in that list and judge the answers',
                '__modpoll.report()                        the verification as markdown parts, ready to upload',
                'await __modpoll.probe()                   what this plant\'s modpoll -h reports',
                '__modpoll.last()                          the last full result',
                '__modpoll.lastExport()                    everything known, as one document: readings now and before, list, plant map, verification, scan',
                '__modpoll.exportText()                    the same as the one file Save JSON writes',
                '__modpoll.exportParts()                   the same split into files under the knowledge-file ceiling, [{name, text}]',
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
        /**
         * The same poll as a block of text meant to be read: every reading with
         * its name, both address bases, what the plant shows, and the shape of
         * the answer — which references were refused, which read zero, which have
         * no name, and what the plant's own values imply about the scale.
         */
        async describe(spec) { return describeForAI(spec ? await api.read(spec) : lastResult); },
        lastDescribed() { return describeForAI(lastResult); },
        async raw(typed) {
            const pollOnce = ensurePollOnce(typed);
            if (pollOnce !== typed) log('Added -1 so it polls once — without it modpoll polls every second until the session is reconnected', 'warn');
            const command = ensureDevicePath(pollOnce);
            if (command !== pollOnce) log('Wrote the COM port as \\\\.\\COMn — Windows opens ports above COM9 only by that name', 'warn');
            assertReadOnly(command);
            const raw = await termRun(command, { timeoutMs: 25000, fullOutput: true });
            const parsed = parseModpoll(raw);
            return { ok: parsed.values.length > 0 && !parsed.fatal, command, values: parsed.values, diagnostics: parsed.diagnostics, raw };
        },
        probe(force) { return probeBinary(!!force); },
        /**
         * Which tables answer and where they start; with deep, also every register
         * they answer with, read on until the answers stop.
         */
        async scan(spec, deep) {
            // The unit's names first, as the button does, so the report and the
            // export that follows carry what IWMAC reads — unless the caller
            // has loaded names itself.
            if (!plantNames) { try { await ensureNamesFor(Object.assign(readForm(), spec || {})); } catch (e) { /* the scan stands without names */ } }
            startCostLedger();
            let report;
            try { report = await scanDevice(spec, deep !== false); }
            finally { const cost = finishCostLedger(); if (report) report.cost = cost; }
            lastScan = report;
            await attachIwmacContext(report);
            try { renderScan(report); } catch (e) { /* panel not built */ }
            return report;
        },
        /**
         * Name registers from the plant's own parameter list for a unit — alias
         * text, engineering unit, group, the value the plant currently shows, and
         * the bit when several parameters share a register.
         */
        async names(unitId, plantId) {
            plantNames = await fetchPlantNames(unitId, plantId);
            try { if (lastResult) renderGrid(lastResult); } catch (e) { /* panel not built */ }
            return { unit: unitId, parameters: plantNames.rows, registers: plantNames.byRef.size, groups: plantNames.groups, undecodable: plantNames.undecodable };
        },
        /** Which registers are called this, from whichever names are loaded. */
        find(query) {
            return findByName(query).map(m => ({
                ref: m.ref, addr: m.addr, name: m.name, table: m.table, group: m.group,
                unit: m.unit, plantValue: m.value, writable: m.writable, source: m.source,
            }));
        },
        nameFor(table, ref) {
            const found = plantNamesFor(String(table), '', Number(ref));
            return found ? found.map(e => ({ name: e.name, unit: e.unit, bit: e.bit, group: e.group, plantValue: e.plantValue })) : null;
        },
        units(plantId) { return fetchPlantRegulators(plantId); },
        /** Adopt a modbusgen project file: its points, and how to reach the device. */
        loadList(json, name) {
            const list = parsePointList(json);
            adoptPointList(list, name || 'list from the API');
            return { points: list.points.length, undecodable: list.undecodable, subtractOne: list.subtractOne, comm: list.comm };
        },
        /** Poll every point the loaded list declares and judge the answers. */
        async verify(spec) {
            if (!pointList) throw new Error('No point list loaded — call loadList first');
            abortRequested = false;
            const verification = await verifyPointList(pointList, normaliseSpec(Object.assign(readForm(), spec || {})));
            lastVerification = verification;
            try { renderVerification(verification); ui.reportBtn.disabled = false; ui.verifyJsonBtn.disabled = false; } catch (e) { /* panel not built */ }
            return verification;
        },
        /** The same verification as markdown parts, each under the 36 000-character ceiling. */
        report() { return lastVerification ? buildCopilotReport(lastVerification) : null; },
        lastVerification() { return lastVerification; },
        lastScan() { return lastScan; },
        /**
         * IWMAC's own side of the unit whose names are loaded — driver settings,
         * parameter definitions, module, bus, driver log — read now and kept for
         * the export. A scan does this by itself; a poll does not.
         */
        async iwmac() { return attachIwmacContext(null, lastResult ? lastResult.spec : (lastScan && lastScan.spec)); },
        last() { return lastResult; },
        lastCompact() { return compactResult(lastResult); },
        lastExport() { return exportResult(lastResult); },
        exportText() { return exportText(exportResult(lastResult)); },
        exportParts(baseName) { return exportParts(exportResult(lastResult), baseName); },
        stop() { stopAll(); return true; },
        open() { showConsole(); return true; },
    };
    // The page can see this object; it should not be able to swap a method on
    // it for one that skips the guard — every route to the shell stays inside.
    Object.freeze(api);

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
        if (ui.panel) return;
        buildPanel();
        addSidebarItem();
        hookRouter();
        try { pageWin.__modpoll = api; } catch (e) { window.__modpoll = api; }
        console.info('[Modpoll Console ' + VERSION + '] Tools → Modpoll in the sidebar; window.__modpoll.help() for the API.');
    }

    // The sys_tools shell builds its sidebar after load; wait for it rather than
    // polling the DOM broadly.
    waitFor(() => (pageWin.w2ui && pageWin.w2ui.sidebar && document.body) || null, 30000, 'the sys_tools shell')
        .then(init)
        .catch(() => { /* not a sys_tools shell page, nothing to attach to */ });
})();
