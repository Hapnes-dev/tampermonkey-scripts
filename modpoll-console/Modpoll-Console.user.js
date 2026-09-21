// ==UserScript==
// @name         Modpoll Console
// @version      1.3.2
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

    const VERSION = '1.3.2';
    const PANEL_ID = 'mpc-panel';
    const HOST_ID = 'mpc-host';
    const SIDEBAR_ID = 'modpoll_console';
    const IFRAME_ID = 'iframe_plant_term';
    const PLANT_TERM_URL = '/secure/plant_term/';
    const MODPOLL_EXE = 'c:\\iwmac\\bin\\modpoll.exe';
    const MAX_COUNT = 99;
    // The shell runs chained commands in one round trip: three full blocks came
    // back in 221 ms against a plant, where three separate runs cost about 3 s.
    // Four is a deliberate ceiling — roughly 400 lines, which the terminal holds
    // comfortably.
    const CHAIN_MAX = 4;
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

    function assertSegmentReadOnly(command) {
        if (new RegExp('^echo\\s+' + MARK + '[\\w:.-]*$').test(command)) return true;
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
        spec.host = String(spec.host || '').trim();
        if (!spec.host) throw new Error(spec.mode === 'tcp' ? 'No IP address given' : 'No COM port given');
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
        const args = [MODPOLL_EXE];
        args.push('-m', s.mode === 'tcp' ? 'tcp' : (s.mode === 'ascii' ? 'ascii' : 'rtu'));
        args.push('-a', String(s.slave));
        args.push('-t', String(s.table) + (fmt.value ? ':' + fmt.value : ''));
        if (s.bigEndian && fmt.endianFlag) args.push(fmt.endianFlag);
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
        { re: /port or socket open error/i, level: 'fatal', text: 'Port or socket open error — check the address and that the device is reachable' },
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
        { re: /is not recognized as an internal or external command|cannot find the path/i, level: 'fatal', text: 'modpoll.exe not found at ' + MODPOLL_EXE },
    ];

    function parseModpoll(raw) {
        const lines = String(raw || '').split(/\r?\n/);
        const values = [];
        const diagnostics = [];
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
    const countValueLines = text => (String(text).match(/\[\d+\]\s*:/g) || []).length;

    async function termRun(command, opts) {
        const options = Object.assign({ timeoutMs: 25000, settleMs: 300 }, opts || {});
        const state = await ensureTerminal();
        const outEl = state.outEl;
        const firstNew = outEl.children.length;
        // The terminal renders every space as a non-breaking one, so innerText hands
        // back U+00A0. Left alone, no pattern containing a space can match, and a
        // device answering "Illegal Data Address exception response!" reads as a
        // silent empty result instead of an answer. Split/join rather than a regex,
        // so the character is stated once and cannot be mangled by an editor.
        const NBSP = String.fromCharCode(160);
        const clean = text => String(text).split(NBSP).join(' ').split('\r').join('');
        // Anchored to an element rather than an index: jQuery Terminal trims its
        // oldest lines once its buffer is full, which would slide an index.
        const anchor = outEl.lastElementChild;
        const readChunk = () => {
            let node = (anchor && anchor.isConnected) ? anchor.nextElementSibling : outEl.firstElementChild;
            const parts = [];
            while (node) { parts.push(node.innerText); node = node.nextElementSibling; }
            return clean(parts.join('\n'));
        };

        state.t.exec(command);
        const deadline = Date.now() + options.timeoutMs;
        let lastLength = -1;
        let stableSince = Date.now();
        let grew = false;
        while (Date.now() < deadline) {
            await sleep(60);
            const chunk = readChunk();
            if (chunk.length !== lastLength) { lastLength = chunk.length; stableSince = Date.now(); }
            if (chunk.length) grew = true;
            // Knowing how many values were asked for turns the wait into a real
            // completion signal: a poll answers in about 130 ms, so waiting out a
            // settle window is most of what a block used to cost.
            if (options.expect && countValueLines(chunk) >= options.expect) return chunk;
            if (options.stopOnError !== false && RE_FINAL_ERROR.test(chunk)) return chunk;
            if (grew && Date.now() - stableSince > options.settleMs) return chunk;
        }
        const chunk = readChunk();
        if (grew) return chunk;
        throw new Error('Plant Term printed nothing within ' + Math.round(options.timeoutMs / 1000) +
            ' s of running the command.');
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

        for (let bi = 0; bi < blocks.length && !fatal; bi += CHAIN_MAX) {
            if (abortRequested) { diagnostics.push({ level: 'warn', text: 'Stopped by user', line: '' }); break; }
            const group = blocks.slice(bi, bi + CHAIN_MAX);
            const parts = [];
            let expect = 0;
            for (const b of group) {
                const command = buildCommand(spec, { ref: b.ref, count: b.count });
                assertReadOnly(command);
                commands.push(command);
                // The marker attributes an error line to the block that caused it;
                // values carry their own reference, so they need no help.
                parts.push('echo ' + MARK + ':' + b.ref, command);
                expect += b.count;
            }
            const line = parts.join(' & ');
            assertReadOnly(line);
            if (onProgress) {
                onProgress({
                    block: Math.min(bi + group.length, blocks.length), blocks: blocks.length,
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
            for (const v of parsed.values) {
                const at = values.findIndex(x => x.i === v.i);
                if (at >= 0) values[at] = v; else values.push(v);
            }
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
                format: spec.format || '16-bit', registersPerValue: formatOf(spec.format).step,
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

    /**
     * Ask a list of references one register each, several per round trip, and say
     * for each whether the device answered. Chaining makes this cheap: thirteen
     * references came back in 2.5 s on a plant, where one round trip each would
     * have cost 14.
     */
    async function probeRefs(spec, probes) {
        const results = {};
        // Single-register probes print little, so more of them fit in one run than
        // a block poll would.
        const PER_RUN = CHAIN_MAX * 3;
        // Each probe is a table and a reference, so one run can ask all four
        // tables at once instead of one table at a time.
        const list = probes.map(p => (typeof p === 'object' ? p : { table: spec.table, ref: p }));
        for (let i = 0; i < list.length; i += PER_RUN) {
            const group = list.slice(i, i + PER_RUN);
            const parts = [];
            for (const probe of group) {
                const key = probe.table + ':' + probe.ref;
                parts.push('echo ' + MARK + ':' + key,
                    buildCommand(Object.assign({}, spec, { table: probe.table }), { ref: probe.ref, count: 1 }));
            }
            const line = parts.join(' & ');
            assertReadOnly(line);
            const raw = await termRun(line, { timeoutMs: spec.timeoutMs, stopOnError: false });
            let current = null;
            for (const rawLine of String(raw).split(/\r?\n/)) {
                const line2 = rawLine.trim();
                const mark = line2.match(new RegExp('^' + MARK + ':([\\d:]+)$'));
                if (mark) { current = mark[1]; results[current] = { answered: false }; continue; }
                if (current === null) continue;
                const value = line2.match(RE_VALUE);
                if (value) { results[current] = { answered: true, value: Number(value[2]) }; continue; }
                if (/exception/i.test(line2)) results[current] = { answered: false, reason: 'exception' };
                else if (RE_FINAL_ERROR.test(line2)) results[current] = { answered: false, reason: line2.slice(0, 60) };
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
    async function scanDevice(input) {
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
        return { host: spec.host, slave: spec.slave, at: new Date().toISOString(), tables };
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
    #${PANEL_ID} .mpc-actions{grid-column:span 12;display:flex;gap:var(--gap);align-items:flex-end;flex-wrap:wrap}
    #${PANEL_ID} .mpc-actions .mpc-f{width:78px}
    #${PANEL_ID} .mpc-actions .mpc-spacer{flex:1 1 auto}
    #${PANEL_ID} .mpc-cmd{font-family:Consolas,ui-monospace,monospace;font-size:11.5px}
    #${PANEL_ID} .mpc-note{grid-column:span 12;font-size:11px;color:var(--label);margin:-3px 0 0;min-height:14px}
    #${PANEL_ID} .mpc-check{grid-column:span 6;display:flex;align-items:center;gap:6px;font-size:11.5px;
        color:#3a3f4a;height:var(--h);cursor:pointer}
    #${PANEL_ID} .mpc-check input{width:14px;height:14px;padding:0;accent-color:#3f7fbf}

    #${PANEL_ID} .mpc-gridwrap{grid-column:span 12;max-height:340px;overflow-y:auto;overflow-x:hidden;
        border:1px solid var(--line);border-radius:3px;background:#fff}
    #${PANEL_ID} table.mpc-grid{width:100%;table-layout:fixed;border-collapse:collapse;font:11.5px Consolas,ui-monospace,monospace}
    #${PANEL_ID} table.mpc-grid th{position:sticky;top:0;z-index:1;background:linear-gradient(#fbfbfb,#eff0f2);
        text-align:right;padding:5px 8px;font:bold 11px Arial,Helvetica,sans-serif;color:#4a4f5a;
        border-bottom:1px solid var(--line)}
    #${PANEL_ID} table.mpc-grid td{text-align:right;padding:3px 8px;border-bottom:1px solid #eceef1;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #${PANEL_ID} table.mpc-grid tbody tr:nth-child(even) td{background:#f7f8fa}
    #${PANEL_ID} table.mpc-grid td.zero{color:#a3a8b3}
    #${PANEL_ID} table.mpc-grid td.mpc-empty{text-align:center;padding:16px;color:#9aa0ac;font:12px Arial,Helvetica,sans-serif}
    #${PANEL_ID} .mpc-sum{grid-column:span 12;font-size:11.5px;color:#4a4f5a;min-height:16px}
    #${PANEL_ID} .mpc-log{grid-column:span 12;max-height:120px;overflow-y:auto;overflow-x:hidden;
        font:11.5px/1.5 Consolas,ui-monospace,monospace;background:#fafbfc;border:1px solid var(--line);border-radius:3px;
        padding:6px 9px;white-space:pre-wrap;word-break:break-word;color:#3a3f4a}
    #${PANEL_ID} .mpc-log .err{color:#c0392b}#${PANEL_ID} .mpc-log .warn{color:#b9770e}#${PANEL_ID} .mpc-log .ok{color:#1e7e34}
    `;

    const ui = {};
    let lastResult = null;
    let lastScan = null;
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

    function toggleSerial() {
        const serial = ui.mode.value !== 'tcp';
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

    function renderEmptyGrid(message) {
        if (!ui.gridBody) return;
        ui.gridBody.textContent = '';
        ui.gridBody.appendChild(el('tr', {}, [el('td', { className: 'mpc-empty', colSpan: 7, textContent: message })]));
    }

    function renderGrid(result) {
        ui.gridBody.textContent = '';
        const onlyNonZero = ui.filterZero.checked;
        const rows = result.values.filter(v => !onlyNonZero || v.v !== 0);
        const shown = rows.slice(0, 2000);
        if (!shown.length) {
            renderEmptyGrid(result.values.length ? 'Every register in this range read 0' : 'No registers returned — see the log');
            ui.summary.textContent = result.values.length + ' of ' + result.summary.requested + ' registers, all zero';
            return;
        }
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

        ui.dot = el('span', { className: 'mpc-dot', title: 'Idle' });
        const head = el('div', { className: 'mpc-head' }, [
            el('span', { className: 'mpc-title', textContent: 'Modpoll' }),
            el('span', { className: 'mpc-ver', textContent: 'v' + VERSION + ' · plant ' + (plantIdFromHost() || '?') + ' · read only' }),
            ui.dot,
        ]);

        const body = el('div', { className: 'mpc-body' });
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
        ui.mode = el('select', {}, ['tcp', 'rtu', 'ascii'].map(v => el('option', { value: v, textContent: v.toUpperCase() })));
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
        ui.every = el('input', { value: '5' });
        const repeat = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Repeat', title: 'Run again on an interval' });
        repeat.addEventListener('click', startRepeat);
        const copyBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Copy for AI', title: 'Compact JSON to the clipboard' });
        copyBtn.addEventListener('click', () => {
            if (!lastResult) return log('Nothing to copy yet');
            GM_setClipboard(JSON.stringify(compactResult(lastResult)));
            log('Compact result copied', 'ok');
        });
        const saveBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Save JSON', title: 'Download the full result' });
        saveBtn.addEventListener('click', () => {
            if (!lastResult) return log('Nothing to save yet');
            download(resultFilename(), JSON.stringify(lastResult, null, 2));
        });
        const probeBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Probe', title: "Run modpoll -h and report this plant's build" });
        probeBtn.addEventListener('click', async () => {
            try {
                const info = await probeBinary(true);
                log('modpoll ' + (info.version || 'version unknown') + ' — ' + (info.hasTcpPortFlag ? '-p carries the TCP port in tcp mode' : 'no TCP port flag found in -h'), 'ok');
            } catch (e) { log('ERROR: ' + e.message, 'err'); }
        });
        const scanBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Scan device', title: 'Which tables answer, and where the readable range starts' });
        scanBtn.addEventListener('click', async () => {
            scanBtn.disabled = true;
            try {
                log('Scanning ' + ui.host.value + ' slave ' + ui.slave.value + '…');
                const report = await scanDevice(readForm());
                for (const table of Object.keys(report.tables)) {
                    const t = report.tables[table];
                    const name = (REGISTER_TABLES.find(r => r.value === table) || {}).label || table;
                    log(t.answers
                        ? name + ': answers from ' + t.firstReadable + ' (' + t.sample.join(', ') + ')'
                        : name + ': no answer (' + (t.refused.length ? 'refused ' + t.refused.join(', ') : 'silent') + ')',
                        t.answers ? 'ok' : '');
                }
                lastScan = report;
            } catch (e) { log('ERROR: ' + e.message, 'err'); }
            finally { scanBtn.disabled = false; }
        });
        form.appendChild(el('div', { className: 'mpc-actions' }, [
            ui.run, ui.stop, repeat, field('Every s', ui.every, 2),
            el('span', { className: 'mpc-spacer' }), scanBtn, copyBtn, saveBtn, probeBtn,
        ]));

        // --- results ---------------------------------------------------------
        form.appendChild(el('div', { className: 'mpc-sep' }));
        ui.filterZero = el('input', { type: 'checkbox', id: 'mpc-hidezero' });
        ui.filterZero.addEventListener('change', () => { if (lastResult) renderGrid(lastResult); });
        form.appendChild(el('label', { className: 'mpc-check', htmlFor: 'mpc-hidezero' },
            [ui.filterZero, el('span', { textContent: 'Hide zero values' })]));
        ui.summary = el('div', { className: 'mpc-sum', textContent: 'No poll run yet' });
        form.appendChild(el('div', { className: 'mpc-check', style: 'justify-content:flex-end' }, [ui.summary]));

        ui.gridBody = el('tbody');
        const cols = ['13%', '13%', '15%', '15%', '14%', '15%', '15%'];
        const table = el('table', { className: 'mpc-grid' }, [
            el('colgroup', {}, cols.map(w => el('col', { style: 'width:' + w }))),
            el('thead', {}, [el('tr', {}, ['printed', 'addr', 'value', 'hex', 'int16', '×0.1', '×0.01'].map(h => el('th', { textContent: h })))]),
            ui.gridBody,
        ]);
        form.appendChild(el('div', { className: 'mpc-gridwrap' }, [table]));
        renderEmptyGrid('No registers polled yet');

        ui.log = el('div', { className: 'mpc-log' });
        form.appendChild(ui.log);

        panel.appendChild(head);
        panel.appendChild(body);
        // The panel is kept detached until the sidebar item is clicked, and is moved
        // rather than rebuilt when the user leaves the tool and comes back, so the
        // form, the last result and a running repeat all survive the round trip.
        ui.panel = panel;

        toggleSerial();
        try { applyForm(JSON.parse(GM_getValue(STORE_KEY, 'null'))); } catch (e) { /* first run */ }
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
        scan(spec) { return scanDevice(spec).then(report => { lastScan = report; return report; }); },
        lastScan() { return lastScan; },
        last() { return lastResult; },
        lastCompact() { return compactResult(lastResult); },
        stop() { stopAll(); return true; },
        open() { showConsole(); return true; },
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
