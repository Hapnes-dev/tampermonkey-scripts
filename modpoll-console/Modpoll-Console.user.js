// ==UserScript==
// @name         Modpoll Console
// @version      1.38.0
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
    const VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '1.38.0';
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
        args.push(s.host);
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
        { re: /serial port already open/i, level: 'fatal', text: 'Serial port already open — another process holds the COM port' },
        // On a serial port this nearly always means the Plant Server has the port
        // open, since it polls the bus continuously. Freeing it means stopping the
        // Plant Server, which also stops temperature logging and alarms — the
        // operator's call, never the tool's.
        { re: /port or socket open error/i, level: 'fatal', text: 'Port or socket open error — on a COM port the Plant Server is usually holding it (stopping it stops logging and alarms); on TCP, check the address' },
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
    let runCounter = 0;

    async function termRun(command, opts) {
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
        while (Date.now() < deadline) {
            await sleep(60);
            const chunk = readChunk();
            const body = deviceOutput(chunk);
            if (body.length !== lastLength) { lastLength = body.length; stableSince = Date.now(); }
            if (body.length) grew = true;
            // Knowing how many values were asked for turns the wait into a real
            // completion signal: a poll answers in about 130 ms, so waiting out a
            // settle window is most of what a block used to cost.
            if (options.expect && countValueLines(chunk) >= options.expect) { mirrorTerminal(chunk); return chunk; }
            // This plant does not resolve a bare "modpoll": say so once, take the
            // full path, and run the same command again.
            if (exePath === EXE_BARE && RE_NOT_FOUND.test(chunk)) {
                exePath = EXE_FULL;
                log('modpoll is not on this plant\'s PATH — using ' + EXE_FULL, 'warn');
                return termRun(command.split(EXE_BARE + ' ').join(EXE_FULL + ' '), options);
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
            return termRun(command, Object.assign({}, options, { reconnect: false }));
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
            if (onProgress) {
                onProgress({
                    // bi has already moved past this group, so it is the count done.
                    block: bi, blocks: blocks.length,
                    command: group.length > 1
                        ? group.length + ' blocks in one run, -r ' + group[0].ref + ' to -r ' + group[group.length - 1].ref
                        : commands[commands.length - 1],
                });
            }
            let raw;
            try {
                // One error must not cut a chained run short: the later blocks in
                // the same line are still coming.
                raw = await termRun(line, { timeoutMs: spec.timeoutMs, expect, stopOnError: group.length === 1 });
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
            if (onProgress) onProgress({ recovering: attempt.length, command: 're-asking for ' + attempt.length + ' gap(s)' });
            let raw;
            try {
                raw = await termRun(chainBlocks(spec, attempt), { timeoutMs: spec.timeoutMs, stopOnError: false });
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
    async function probeRefs(spec, probes) {
        const results = {};
        // Each probe is a table and a reference, so one run can ask all four
        // tables at once instead of one table at a time — as many as fit inside
        // the character budget for a single command line.
        const list = probes.map(p => (typeof p === 'object' ? p : { table: spec.table, ref: p }));
        for (let i = 0; i < list.length;) {
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
            let raw = await termRun(line, { timeoutMs: spec.timeoutMs, stopOnError: false });
            // Every probe echoes its own marker, so a missing marker means output
            // was lost rather than refused. One retry settles which it was.
            const markers = (raw.match(new RegExp(MARK + ':\\d+:\\d+', 'g')) || []).length;
            if (markers < group.length) raw = await termRun(line, { timeoutMs: spec.timeoutMs, stopOnError: false });
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
        }
        return results;
    }

    /**
     * What does this device actually answer? Which of the four tables respond, and
     * where the readable range starts — found by doubling until an answer appears,
     * then halving back. A device that answers 0 for an unmapped register and one
     * that raises an exception both exist, so the answer is reported as observed
     * rather than interpreted.
     */
    async function scanDevice(input, deep, onProgress) {
        // A new scan is a new action: a Stop that ended the last one must not end
        // this one before it starts.
        abortRequested = false;
        const spec = normaliseSpec(Object.assign({ count: 1 }, input, { format: '' }));
        const TABLES = ['4', '3', '1', '0'];
        // Every invocation costs about 190 ms of process start, so the probe list
        // is short and the halving does the precision. Decades of range, not a
        // dense grid: 1 is included because a device whose map starts at protocol
        // address 0 refuses exactly that one reference.
        const REFS = [1, 2, 10, 100, 1000, 10000];

        // One pass over every table and reference, chained.
        const first = await probeRefs(spec, [].concat.apply([], TABLES.map(t => REFS.map(ref => ({ table: t, ref })))));
        const answeredBy = {};
        for (const table of TABLES) answeredBy[table] = REFS.filter(ref => (first[table + ':' + ref] || {}).answered);

        // Narrow each table's lower edge together, one chained run per halving.
        const bounds = {};
        for (const table of TABLES) {
            const hits = answeredBy[table];
            if (!hits.length) continue;
            bounds[table] = { low: Math.max(1, REFS[REFS.indexOf(hits[0]) - 1] || 1), high: hits[0] };
        }
        while (Object.keys(bounds).some(t => bounds[t].high - bounds[t].low > 1)) {
            const step = [];
            for (const table of Object.keys(bounds)) {
                const b = bounds[table];
                if (b.high - b.low > 1) step.push({ table, ref: Math.floor((b.low + b.high) / 2) });
            }
            const probed = await probeRefs(spec, step);
            for (const probe of step) {
                const hit = (probed[probe.table + ':' + probe.ref] || {}).answered;
                if (hit) bounds[probe.table].high = probe.ref; else bounds[probe.table].low = probe.ref;
            }
        }

        const tables = {};
        for (const table of TABLES) {
            const hits = answeredBy[table];
            const firstReadable = bounds[table] ? bounds[table].high : null;
            tables[table] = {
                answers: hits.length > 0,
                firstReadable,
                // Stated in both bases, since that is the distinction this whole
                // tool exists to keep straight.
                firstReadableAddr: firstReadable === null ? null : firstReadable - 1,
                sample: hits.slice(0, 3).map(ref => ref + '=' + first[table + ':' + ref].value),
                refused: REFS.filter(ref => first[table + ':' + ref] && !first[table + ':' + ref].answered).slice(0, 4),
            };
        }
        const report = { host: spec.host, slave: spec.slave, at: new Date().toISOString(), tables };

        // Then read each answering table until its answers stop, so the scan ends
        // with the registers themselves rather than only their starting point.
        if (deep) {
            report.sweep = {};
            report.values = [];
            for (const table of TABLES) {
                if (!tables[table].answers || abortRequested) continue;
                const swept = await sweepForValues(spec, table, tables[table].firstReadable, onProgress);
                report.sweep[table] = {
                    answered: swept.answered, nonZero: swept.nonZero,
                    first: swept.first, last: swept.last,
                    ranges: swept.ranges, withValues: swept.withValues,
                };
                for (const value of swept.values) report.values.push(Object.assign({ table }, value));
            }
        }
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

    function impliedScale(raw, shown) {
        const value = Number(String(shown).replace(',', '.'));
        if (!raw || Number.isNaN(value) || value === 0) return null;
        const ratio = value / raw;
        const common = [1000, 100, 10, 1, 0.5, 0.1, 0.01, 0.001];
        const near = common.find(k => Math.abs(ratio - k) <= Math.abs(k) * 0.02);
        return near ? 'x' + near : null;
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
     * check, and the last scan with what answered where. Where two sides of a
     * register disagree, the reading carries a note saying so: an observation
     * for the reader to judge, never a conclusion.
     *
     * Every reading is enriched at save time, not taken from the result as it
     * was read: the names are often loaded after the poll, and the grid
     * re-reads them live while the raw result never did. The conventions are
     * spelled out inside the document, and exportParts splits it into files
     * under the knowledge-file ceiling, each repeating the header so it stands
     * alone.
     */
    function exportResult(result) {
        const spec = (result && result.spec) || {};
        const table = String(spec.table || '4');
        const format = spec.format === '16-bit' ? '' : (spec.format || '');
        const polledStep = formatOf(format).step;
        const wide = polledStep === 2;
        const tableLabel = t => (REGISTER_TABLES.find(x => x.value === String(t)) || {}).label || ('table ' + t);
        const asNumber = shown => Number(String(shown == null ? '' : shown).replace(',', '.'));

        const plantRow = e => {
            const row = { name: e.name, shown: e.plantValue, unit: e.unit, group: e.group, access: e.access, driverId: e.driverId };
            if (e.bit !== null) row.bit = e.bit;
            return row;
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

        // Registers whose plant parameters ride on a reading, so the whole-unit
        // section can leave them out without the unit losing them.
        const carried = new Set();
        const readings = (result ? result.values : []).map(v => {
            const point = pointForReading(table, format, v.i);
            const listed = point || listedAt.get(table + '|' + v.i) || null;
            const fromPlant = plantNamesFor(table, format, v.i);
            if (fromPlant) carried.add(table + '|' + v.i);
            const r = enrichValue(v, table, format);
            const out = { ref: r.ref, addr: r.addr, raw: r.raw };
            // The number read every way, as the detail view shows it — only for a
            // value that is one register, since a 32-bit one is already decoded.
            if (!wide) {
                const u16 = r.raw < 0 ? r.raw + 65536 : r.raw;
                out.hex = '0x' + u16.toString(16).toUpperCase().padStart(4, '0');
                if (r.raw > 32767) out.int16 = r.raw - 65536;
            }
            // What it answered the time before, when it has been read twice.
            const key = table + '|' + format + '|' + v.i;
            if (watchDelta.has(key) && watchDelta.get(key) !== null) {
                out.delta = watchDelta.get(key);
                out.previous = roundScaled(r.raw - out.delta);
            }
            if (r.name) { out.name = r.name; out.source = r.source; }
            if (r.unit) out.unit = r.unit;
            if (r.shown !== '' && r.shown !== null) out.shown = r.shown;
            if (r.type) out.type = r.type;
            if (r.writable) out.writable = true;
            if (listed) out.list = listRow(listed);
            if (fromPlant) out.plant = fromPlant.map(plantRow);
            const first = fromPlant && fromPlant[0];
            const implied = first && first.bit === null ? impliedScale(r.raw, first.plantValue) : null;
            if (implied) out.impliedScale = implied;

            // Where two sides disagree. Observations, not conclusions.
            const notes = [];
            if (listed && implied && listed.scale.known && ('x' + listed.scale.factor) !== implied) {
                notes.push('the list scales by x' + listed.scale.factor + ', the plant implies ' + implied);
            }
            if (listed && first && listed.unit && first.unit && listed.unit.trim().toLowerCase() !== first.unit.trim().toLowerCase()) {
                notes.push('the list says unit "' + listed.unit + '", the plant "' + first.unit + '"');
            }
            if (listed && !fromPlant && plantNames) {
                const elsewhere = REGISTER_TABLES.map(t => t.value).filter(t => t !== table && plantNames.byRef.has(t + '||' + v.i));
                if (elsewhere.length) {
                    notes.push('the plant maps protocol address ' + r.addr + ' in ' + elsewhere.map(tableLabel).join(' and ') +
                        ', the list has it in ' + tableLabel(table));
                }
            }
            if (listed && listed.decoded.step !== polledStep) {
                notes.push('polled as ' + (wide ? '32-bit' : '16-bit') + ', the list declares ' + listed.datatype +
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
        });
        const scales = {};
        for (const r of readings) if (r.impliedScale) scales[r.impliedScale] = (scales[r.impliedScale] || 0) + 1;

        // Every parameter IWMAC holds for the unit that is not already on a
        // reading. Said once: with the poll covering the unit, this is empty and
        // the file is half the size it would be saying everything twice.
        const plantParameters = [];
        if (plantNames) {
            for (const [key, entries] of plantNames.byRef) {
                const [t, , ref] = key.split('|');
                if (carried.has(t + '|' + ref)) continue;
                for (const e of entries) plantParameters.push(Object.assign({ table: t, ref: Number(ref), addr: e.protocol }, plantRow(e)));
            }
            const bitOf = row => (row.bit === undefined ? -1 : row.bit);
            plantParameters.sort((a, b) => a.table.localeCompare(b.table) || a.ref - b.ref || bitOf(a) - bitOf(b));
        }
        const unitInfo = plantNames ? (_unitsCache || []).find(u => u.unit_id === plantNames.unitId) : null;
        const tableInfo = REGISTER_TABLES.find(t => t.value === table) || {};
        const verification = lastVerification;

        return {
            format: 'modpoll-console/export',
            version: VERSION,
            plant: (result && result.plant) || plantIdFromHost() || null,
            at: (result && result.at) || new Date().toISOString(),
            howToUse: [
                'One device on one IWMAC plant read with modpoll, and everything the console knows about its registers, for an ' +
                    'agent checking or correcting a modbusgen point list.',
                'Files named _partNofM share this header. Each carries one slice of one section (part.section, part.rows, ' +
                    'part.firstRef to part.lastRef) and part.contents maps every section to its parts. Given more than 20 files, ' +
                    'take the readings parts covering the registers in question.',
                'readings: one register per line as the device answered just now. ref is what modpoll prints and what -r takes; ' +
                    'addr is the protocol address, ref - 1; a modbusgen list prints addr, or addr + 1 when options.subtract_one is ' +
                    'true. previous and delta are the answer the time before. list is the entry the loaded list has for the ' +
                    'register; plant is every IWMAC parameter reading it, one per bit where several share it; impliedScale is ' +
                    'shown divided by raw when that is a common factor; notes are where two sides disagree — the list, the plant, ' +
                    'the device — and are leads, never conclusions.',
                'plantParameters: every parameter IWMAC holds for this unit that is not already on a reading; the two sections ' +
                    'together are the whole unit. driverId ends in _0_<function>_<protocol address>[.<bit>]: function 1 reads coils ' +
                    '(table 0), 2 discrete inputs (table 1), 3 holding registers (table 4), 4 input registers (table 3). shown is ' +
                    'the value IWMAC displayed when its names were read (unit.namesReadAt), not now.',
                'listPoints: the loaded modbusgen list as parsed, with the table and width each datatype decodes to.',
                'verification and verificationRows: the last Verify list run. Per point: read, zero, refused (the device has no such ' +
                    'register), no answer, not polled (the datatype did not decode); the offset check scores whether the whole list ' +
                    'sits better a register or two along. Ranges anywhere are runs of ref, as "430-445,448".',
            ],
            device: {
                host: spec.host || null, port: spec.port || null, slave: spec.slave || null, mode: spec.mode || null,
                table, tableName: tableInfo.title || null,
                valueFormat: format || '16-bit', registersPerValue: wide ? 2 : 1,
                command: spec.raw || null,
            },
            unit: plantNames ? Object.assign(
                { id: plantNames.unitId },
                unitInfo ? {
                    name: unitInfo.unit_name, driverType: unitInfo.driver_type, driverAddr: unitInfo.driver_addr,
                    connection: unitInfo.connection, host: unitInfo.host, slave: unitInfo.slave,
                } : {},
                { parameters: plantNames.rows, groups: plantNames.groups, undecodable: plantNames.undecodable, namesReadAt: plantNames.at }
            ) : null,
            names: readings.some(r => r.source === 'list') ? 'point list'
                : (readings.some(r => r.source === 'plant') ? 'plant database' : 'none'),
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
            summary: (result && result.summary) || null,
            diagnostics: (result && result.diagnostics) || [],
            notes: (result && result.notes) || [],
            commands: (result && result.commands) || [],
            scan: lastScan ? { at: lastScan.at, host: lastScan.host, slave: lastScan.slave, tables: lastScan.tables, sweep: lastScan.sweep || null } : null,
            verification: verification ? {
                at: verification.at, device: verification.device, list: verification.list, summary: verification.summary,
                offsets: verification.offsets, offsetVerdict: verification.offsetVerdict, diagnostics: verification.diagnostics,
            } : null,
            readings,
            plantParameters,
            listPoints: pointList ? pointList.points.map(listRow) : [],
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

    /**
     * The document as files, each under the knowledge-file ceiling and each
     * complete on its own. The header — everything but the four big sections —
     * repeats in every part; a part carries one slice of one section, one row
     * per line, so a reader can count rows and cite them.
     */
    const EXPORT_SECTIONS = ['readings', 'plantParameters', 'listPoints', 'verificationRows'];
    // The knowledge-file ceiling is 36 000 characters. The markdown report keeps
    // 6 000 of headroom because it estimates; this measures the assembled part,
    // so it can go closer — and every 2 000 characters is six more readings a
    // part, which on a unit of a thousand registers is two files fewer against
    // a cap of twenty.
    const EXPORT_CHUNK_LIMIT = 34000;

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
     * Where does this device actually keep anything? Probing which tables answer
     * says where to start; this reads onwards until the answers run out. Blocks
     * that come back empty are the signal to stop — three in a row means the map
     * has ended, which is cheaper than reading to some arbitrary ceiling and far
     * cheaper than isolating every refused reference on the way.
     */
    const SWEEP_CEILING = 6000;
    const SWEEP_MAX_BLOCKS = 80;
    const SWEEP_EMPTY_STOP = 3;

    async function sweepForValues(spec, table, from, onProgress) {
        const found = [];
        let ref = Math.max(1, from);
        let emptyRuns = 0;
        let blocks = 0;
        let refused = 0;
        while (ref <= SWEEP_CEILING && blocks < SWEEP_MAX_BLOCKS && emptyRuns < SWEEP_EMPTY_STOP && !abortRequested) {
            const count = Math.min(MAX_COUNT * CHAIN_MAX, SWEEP_CEILING - ref + 1);
            if (onProgress) onProgress({ table, ref, count, found: found.length });
            const result = await readRegisters(Object.assign({}, spec, {
                table, format: '', base: 'printed', start: ref, count, recover: false,
            }));
            if (result.values.length) {
                emptyRuns = 0;
                for (const value of result.values) found.push(value);
            } else {
                emptyRuns++;
                refused += result.diagnostics.some(d => /exception/i.test(d.text)) ? 1 : 0;
            }
            if (result.diagnostics.some(d => d.level === 'fatal')) break;
            blocks += Math.ceil(count / MAX_COUNT);
            ref += count;
        }
        const refs = found.map(v => v.i);
        const nonZero = found.filter(v => v.v !== 0);
        return {
            table,
            answered: found.length,
            nonZero: nonZero.length,
            first: refs.length ? Math.min.apply(null, refs) : null,
            last: refs.length ? Math.max.apply(null, refs) : null,
            ranges: asRanges(refs),
            withValues: asRanges(nonZero.map(v => v.i)),
            values: found,
            refusedBlocks: refused,
            stoppedAt: ref,
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
                    if (!match) { undecodable++; continue; }
                    const table = FUNC_TO_TABLE[Number(match[1])];
                    if (!table) { undecodable++; continue; }
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
        const names = { unitId, byRef, groups: groups.length, rows, undecodable, at: new Date().toISOString() };
        _namesCache.set(cacheKey, names);
        return names;
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
    #${PANEL_ID} table.mpc-grid tr.mpc-detail td{background:#f4f7fb;text-align:left;padding:8px 10px;white-space:normal}
    /* Sections read downwards; the flat grid this replaced read across. */
    #${PANEL_ID} .mpc-detailbox{display:flex;flex-direction:column;gap:2px;padding:2px 2px 6px;max-width:1120px}
    #${PANEL_ID} .mpc-dhead{font:bold 13px Arial,Helvetica,sans-serif;color:#1b1b1b}
    #${PANEL_ID} .mpc-dlead{font:13px Consolas,ui-monospace,monospace;color:#1b5fa8;margin-bottom:6px}
    /* A 1px gap over a grey backing reads as gridlines, which is what separates
       one pair from the next without drawing a border around each of them. */
    #${PANEL_ID} .mpc-dsec{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:1px;
        margin-bottom:8px;background:#e3e6ec;border:1px solid #dfe3e9;border-radius:4px;overflow:hidden}
    #${PANEL_ID} .mpc-dsec h5{grid-column:1/-1;margin:0;padding:4px 10px;background:#eef0f4;
        font:bold 10.5px Arial,Helvetica,sans-serif;letter-spacing:.4px;text-transform:uppercase;color:#79808c}
    /* min-width:0 on both, or a long value refuses to wrap and runs over the
       column beside it. */
    #${PANEL_ID} .mpc-kv{display:flex;gap:10px;align-items:baseline;min-width:0;padding:5px 10px;background:#fcfdfe;
        font:12px/1.55 Arial,Helvetica,sans-serif}
    #${PANEL_ID} .mpc-kv .mpc-k{color:#79808c;width:122px;flex:0 0 122px}
    #${PANEL_ID} .mpc-kv .mpc-v{color:#1b1b1b;min-width:0;overflow-wrap:anywhere}
    #${PANEL_ID} .mpc-kv .mpc-v.mono{font-family:Consolas,ui-monospace,monospace}
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
     * What one register is, in the order someone asks it: what it is called and
     * what that value means, then how to reach it, then the number read every
     * other way, then whatever the plant or the list knows about it. Sections
     * rather than one flat grid, because a flat grid is read across when it wants
     * to be read down.
     */
    function readingDetailSections(value, point, previous, fromPlant, table, ref, format) {
        const fmt = formatOf(format);
        const wide = fmt.step === 2;
        const u16 = value < 0 ? value + 65536 : value;
        const i16 = value > 32767 ? value - 65536 : value;
        const entry = fromPlant && fromPlant[0];
        const sections = [];

        const name = (point && point.name) || (entry && entry.name) || '';
        const unit = (point && point.unit) || (entry && entry.unit) || '';
        const meaning = point
            ? (point.scale.invert ? (value ? 'off' : 'on') : roundScaled(value * point.scale.factor, point.decimals))
            : (entry ? entry.plantValue : '');
        sections.push({
            headline: name || ('Reference ' + ref),
            lead: (meaning === '' || meaning === null ? String(value) : meaning + (unit ? ' ' + unit : '')) +
                (meaning === '' || meaning === null ? '' : '   (register holds ' + value + ')'),
        });

        const tableName = (REGISTER_TABLES.find(t => t.value === String(table)) || {}).title || ('table ' + table);
        const reach = [
            ['table', tableName],
            ['reference', String(ref) + '  — what modpoll prints, and what -r takes'],
            ['protocol address', String(ref - 1) + '  — what a document usually means'],
        ];
        if (point) reach.push(['address in the list', String(point.addr) + (point.protocol !== point.addr ? ' (protocol ' + point.protocol + ')' : '')]);
        reach.push(['command', ui.cmd ? ui.cmd.value : '', true]);
        sections.push({ title: 'Where it is', rows: reach });

        // Every way that applies. modpoll prints a 32-bit value already decoded:
        // an integer can still be shown at its full width, while a float's bit
        // pattern is gone and only the decimal remains — reading it as sixteen
        // bits printed the hex of whatever integer it happened to round to.
        const grouped = bits => bits.replace(/(.{4})(?=.)/g, '$1 ');
        const asNumbers = [['raw', String(value), true]];
        if (!wide) {
            const chars = [u16 >> 8, u16 & 0xff]
                .map(code => (code >= 32 && code < 127) ? String.fromCharCode(code) : '·').join('');
            asNumbers.push(
                ['hexadecimal', '0x' + (u16 >>> 0).toString(16).toUpperCase().padStart(4, '0'), true],
                ['binary', grouped((u16 >>> 0).toString(2).padStart(16, '0')), true],
                ['unsigned / signed', u16 + ' / ' + i16, true],
                ['÷10 / ÷100', (value / 10).toFixed(1) + ' / ' + (value / 100).toFixed(2), true],
                ['as two characters', chars, true],
            );
        } else if (fmt.value === 'int' && Number.isInteger(value)) {
            const u32 = value >>> 0;
            asNumbers.push(
                ['hexadecimal', '0x' + u32.toString(16).toUpperCase().padStart(8, '0'), true],
                ['binary', grouped(u32.toString(2).padStart(32, '0')), true],
                ['unsigned / signed', u32 + ' / ' + (value | 0), true],
                ['÷10 / ÷100', (value / 10).toFixed(1) + ' / ' + (value / 100).toFixed(2), true],
            );
        } else {
            asNumbers.push(['read as', fmt.label + ', decoded by modpoll from two registers — the bit pattern is not in what it printed']);
        }
        if (previous !== undefined && previous !== value) {
            asNumbers.push(['since last pass', previous + ' → ' + value + '  (' + (value - previous > 0 ? '+' : '') + (value - previous) + ')', true]);
        }
        sections.push({ title: 'The number, read every way', rows: asNumbers });

        if (point) {
            const fromList = [
                ['name', point.name],
                ['datatype', point.datatype + (point.decoded.ok
                    ? '  — ' + tableName.toLowerCase() + ', ' + point.decoded.rawType + (point.decoded.step === 2 ? ', two registers per value' : '')
                    : '  — not decoded')],
            ];
            if (point.group) fromList.push(['group', point.group]);
            if (point.scaleKey) fromList.push(['scale', point.scaleKey + (point.scale.known ? '  (×' + point.scale.factor + ')' : '  — key not understood')]);
            if (point.unit) fromList.push(['unit', point.unit]);
            if (point.rw) fromList.push(['access', point.rw === 'rw' ? 'read and write' : 'read only']);
            if (point.rangeMin !== null || point.rangeMax !== null) {
                fromList.push(['declared range', (point.rangeMin === null ? '…' : point.rangeMin) + ' to ' + (point.rangeMax === null ? '…' : point.rangeMax)]);
            }
            sections.push({ title: 'What the point list says', rows: fromList });
        }

        if (fromPlant && fromPlant.length) {
            const fromPlantRows = [];
            for (const p of fromPlant) {
                const label = p.bit === null ? 'parameter' : 'bit ' + p.bit;
                const bitState = p.bit === null ? '' : '  — reads ' + ((u16 >> p.bit) & 1);
                fromPlantRows.push([label, p.name + (p.plantValue ? ': ' + p.plantValue : '') + (p.unit ? ' ' + p.unit : '') + bitState]);
            }
            const first = fromPlant[0];
            if (first.group) fromPlantRows.push(['group', first.group]);
            fromPlantRows.push(['access', fromPlant.some(p => p.access === 'rw') ? 'the plant holds it writable' : 'read only in the plant']);
            const shown = Number(String(first.plantValue).replace(',', '.'));
            if (first.bit === null && !Number.isNaN(shown) && value !== 0) {
                const ratio = shown / value;
                const common = [1000, 100, 10, 1, 0.5, 0.1, 0.01, 0.001];
                const near = common.find(k => Math.abs(ratio - k) <= Math.abs(k) * 0.02);
                fromPlantRows.push(['implied scale', near
                    ? '×' + near + '  — the plant shows ' + shown + ' where the register holds ' + value
                    : 'plant ' + shown + ' ÷ raw ' + value + ' = ' + ratio.toFixed(4) + ', no common scale']);
            }
            fromPlantRows.push(['driver_id', first.driverId, true]);
            sections.push({ title: 'What the plant says', rows: fromPlantRows });
        }
        return sections;
    }

    function toggleDetailRow(tr, value, point, previous, fromPlant, table, ref, format) {
        const next = tr.nextElementSibling;
        if (next && next.classList.contains('mpc-detail')) { next.remove(); return; }
        for (const open of ui.gridBody.querySelectorAll('tr.mpc-detail')) open.remove();

        const box = el('div', { className: 'mpc-detailbox' });
        for (const section of readingDetailSections(value, point, previous, fromPlant, table, ref, format)) {
            if (section.headline !== undefined) {
                box.appendChild(el('div', { className: 'mpc-dhead', textContent: section.headline }));
                box.appendChild(el('div', { className: 'mpc-dlead', textContent: section.lead }));
                continue;
            }
            const grid = el('div', { className: 'mpc-dsec' }, [el('h5', { textContent: section.title })]);
            for (const [label, text, mono] of section.rows) {
                grid.appendChild(el('div', { className: 'mpc-kv' }, [
                    el('span', { className: 'mpc-k', textContent: label }),
                    el('span', { className: 'mpc-v' + (mono ? ' mono' : ''), textContent: String(text) }),
                ]));
            }
            box.appendChild(grid);
        }
        const detail = el('tr', { className: 'mpc-detail' }, [
            el('td', { colSpan: (ui.gridColumns || REGISTER_COLUMNS).length }, [box]),
        ]);
        tr.parentNode.insertBefore(detail, tr.nextSibling);
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
        { label: 'table', width: '13%', title: 'Which table the register lives in' },
        { label: 'ref', width: '8%', title: "modpoll's 1-based reference" },
        { label: 'addr', width: '8%', title: 'Protocol address' },
        { label: 'name', width: '33%', align: 'left', title: 'From the plant database or the loaded list' },
        { label: 'value', width: '10%', title: 'What the register held during the scan' },
        { label: 'shown', width: '12%', title: 'What the plant makes of it' },
        { label: 'unit', width: '7%' },
        { label: 'where from', width: '9%', align: 'left' },
    ];

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
        // look as if fewer registers answered.
        const all = values
            .map(v => Object.assign({ table: v.table }, enrichValue(v, v.table, '')))
            .sort((a, b) => (a.raw === 0) - (b.raw === 0) || a.table.localeCompare(b.table) || a.ref - b.ref);
        const onlyNonZero = ui.filterZero.checked;
        const rows = all.filter(r => !onlyNonZero || r.raw !== 0);
        const shown = rows.slice(0, 2000);
        const frag = document.createDocumentFragment();
        for (const r of shown) {
            const tableName = (REGISTER_TABLES.find(t => t.value === r.table) || {}).label || r.table;
            const cells = [
                { text: tableName },
                { text: String(r.ref) },
                { text: String(r.addr) },
                { text: r.name || '', align: 'left' },
                { text: String(r.raw), className: r.raw === 0 ? 'zero' : '' },
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
                const command = aimAtRegister({ table: r.table, ref: r.ref, format: '' });
                log('> ' + command + '   ← ' + (r.name || 'reference ' + r.ref) + ', ready to run');
                toggleDetailRow(tr, r.raw, pointForReading(r.table, '', r.ref), undefined, plantNamesFor(r.table, '', r.ref), r.table, r.ref, '');
            });
            frag.appendChild(tr);
        }
        ui.gridBody.appendChild(frag);
        const nonZero = all.filter(r => r.raw !== 0).length;
        const named = all.filter(r => r.name).length;
        ui.summary.textContent = all.length + ' registers answered, ' + nonZero + ' holding a value, ' +
            named + ' named' + (onlyNonZero ? ' — zeros hidden' : '') +
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
        ui.base.value = 'printed';
        ui.start.value = String(register.ref);
        ui.count.value = '1';
        ui.cmdDirty = false;
        refreshPreview();
        return ui.cmd.value;
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
                tr.addEventListener('click', () => toggleDetailRow(tr, row.raw, p, undefined, plantNamesFor(p.decoded.table, p.decoded.format, p.ref), p.decoded.table, p.ref, p.decoded.format));
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
                toggleDetailRow(tr, v.v, point, previous, fromPlant, table, v.i, format);
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
                const command = ensurePollOnce(typed);
                if (command !== typed) {
                    log('Added -1 so it polls once. Without it modpoll polls every second for ever: the shell fills up, ' +
                        'the port stays taken, and everything after it looks like it returned nothing.', 'warn');
                    ui.cmd.value = command;
                }
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
                    if (repeating) return;   // the command has not changed since the first pass
                    log('> ' + p.command + (p.blocks ? '   [' + p.block + '/' + p.blocks + ']' : ''));
                });
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
            if (lastResult) renderGrid(lastResult);
            return plantNames;
        } catch (e) {
            log('Could not read the parameter names for ' + unitId + ': ' + e.message, 'warn');
            return null;
        }
    }

    async function runVerification() {
        if (!pointList || termState.busy) return;
        termState.busy = true;
        abortRequested = false;
        ui.verifyBtn.disabled = true;
        ui.stop.disabled = false;
        setDot('warn');
        try {
            const verification = await verifyPointList(pointList, readForm(),
                p => log('> range ' + p.range + '/' + p.ranges + ': -r ' + p.ref + ' -c ' + p.count));
            lastVerification = verification;
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
        // The one export: everything known, as files an agent can read — see
        // exportResult for what goes in and exportParts for how it is split.
        const saveBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Save JSON',
            title: 'Everything known about these registers, as files a Copilot agent can read: the readings now and before, ' +
                'the list, every parameter the plant maps and shows, the verification, the scan — split under the knowledge-file ceiling' });
        saveBtn.addEventListener('click', () => {
            if (!lastResult && !plantNames && !pointList && !lastVerification && !lastScan) {
                return log('Nothing to save yet — run a poll, a scan or a verification, or load a list or a unit\'s names');
            }
            const doc = exportResult(lastResult);
            const parts = exportParts(doc);
            for (const part of parts) download(part.name, part.text);
            const sections = EXPORT_SECTIONS.filter(s => doc[s].length).map(s => doc[s].length + ' ' + s);
            log('Saved ' + parts.length + ' file' + (parts.length === 1 ? '' : 's') +
                (sections.length ? ' — ' + sections.join(', ') : '') +
                (parts.length > 1 ? ' — each under ' + EXPORT_CHUNK_LIMIT + ' characters with the full header, for a knowledge set' : ''), 'ok');
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
                log('Scanning ' + ui.host.value + ' slave ' + ui.slave.value + ' — Stop ends it early');
                const report = await scanDevice(readForm(), true,
                    p => log('  reading ' + (REGISTER_TABLES.find(r => r.value === p.table) || {}).label +
                        ' from ' + p.ref + ' (' + p.found + ' found so far)'));
                lastScan = report;
                for (const table of Object.keys(report.tables)) {
                    const t = report.tables[table];
                    const name = (REGISTER_TABLES.find(r => r.value === table) || {}).label || table;
                    const swept = report.sweep && report.sweep[table];
                    if (!t.answers) { log(name + ': no answer'); continue; }
                    log(name + ': answers from ' + t.firstReadable +
                        (swept ? ' — ' + swept.answered + ' registers, ' + swept.nonZero + ' holding a value' +
                            (swept.first !== null ? ', ' + swept.first + '–' + swept.last : '') : ''), 'ok');
                    if (swept && swept.withValues) log('    with values: ' + swept.withValues);
                }
                renderScan(report);
                setDot('ok');
            } catch (e) { log('ERROR: ' + e.message, 'err'); setDot('err'); }
            finally {
                scanBtn.disabled = false;
                termState.busy = false;
                ui.stop.disabled = !repeatTimer;
            }
        });
        form.appendChild(el('div', { className: 'mpc-actions' }, [
            ui.run, ui.stop, repeat, field('Every s', ui.every, 2),
            el('span', { className: 'mpc-spacer' }), scanBtn, saveBtn, reconnectBtn,
        ]));

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
                'await __modpoll.scan({host, slave})       which tables answer, and from which reference',
                '__modpoll.loadList(projectJson)           adopt a modbusgen project: points and system.comm',
                'await __modpoll.verify()                  poll every point in that list and judge the answers',
                '__modpoll.report()                        the verification as markdown parts, ready to upload',
                'await __modpoll.probe()                   what this plant\'s modpoll -h reports',
                '__modpoll.last()                          the last full result',
                '__modpoll.lastExport()                    everything known, as one document: readings now and before, list, plant map, verification, scan',
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
            const command = ensurePollOnce(typed);
            if (command !== typed) log('Added -1 so it polls once — without it modpoll polls every second until the session is reconnected', 'warn');
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
        scan(spec, deep) {
            return scanDevice(spec, deep !== false).then(report => {
                lastScan = report;
                try { renderScan(report); } catch (e) { /* panel not built */ }
                return report;
            });
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
        last() { return lastResult; },
        lastCompact() { return compactResult(lastResult); },
        lastExport() { return exportResult(lastResult); },
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
