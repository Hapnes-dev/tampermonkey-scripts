// ==UserScript==
// @name         Modpoll Console
// @version      1.13.2
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

    const VERSION = '1.13.2';
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
        if (!spec.host) throw new Error(isSerialMode(spec.mode) ? 'No COM port given' : 'No IP address given');
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
        while (Date.now() < deadline) {
            await sleep(60);
            const chunk = readChunk();
            if (chunk.length !== lastLength) { lastLength = chunk.length; stableSince = Date.now(); }
            if (chunk.length) grew = true;
            // Knowing how many values were asked for turns the wait into a real
            // completion signal: a poll answers in about 130 ms, so waiting out a
            // settle window is most of what a block used to cost.
            if (options.expect && countValueLines(chunk) >= options.expect) return chunk;
            // This plant does not resolve a bare "modpoll": say so once, take the
            // full path, and run the same command again.
            if (exePath === EXE_BARE && RE_NOT_FOUND.test(chunk)) {
                exePath = EXE_FULL;
                log('modpoll is not on this plant\'s PATH — using ' + EXE_FULL, 'warn');
                return termRun(command.split(EXE_BARE + ' ').join(EXE_FULL + ' '), options);
            }
            if (options.stopOnError !== false && RE_FINAL_ERROR.test(chunk)) return chunk;
            if (grew && Date.now() - stableSince > options.settleMs) return chunk;
        }
        const chunk = readChunk();
        if (grew) return chunk;
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
            mergeValues(parsed.values);
            for (const d of parsed.diagnostics) if (!diagnostics.some(x => x.text === d.text)) diagnostics.push(d);
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
            values,
            // References the device refuses outright, isolated by halving a
            // refused block. An empty list means nothing was refused.
            unreadable,
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
            const scaled = p.scale.invert ? (raw ? 0 : 1) : raw * p.scale.factor;
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
    const PLANT_RPC_URL = '/services/iwmac_plant/settings.php';
    const RE_DRIVER_ID = /_0_(\d+)_(\d+)(?:\.(\d+))?$/;

    async function plantRpc(method, params) {
        const response = await fetch(PLANT_RPC_URL, {
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
    async function fetchPlantNames(unitId, plantOverride) {
        const plantId = Number(plantOverride || plantIdFromHost());
        if (!plantId) throw new Error('Could not read a plant id from the hostname');
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
        return { unitId, byRef, groups: groups.length, rows, undecodable, at: new Date().toISOString() };
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
    #${PANEL_ID} table.mpc-grid td.changed{color:#1b5fa8;font-weight:bold}
    #${PANEL_ID} table.mpc-grid td.bad{color:#c0392b}
    #${PANEL_ID} table.mpc-grid tr.mpc-clickable{cursor:pointer}
    #${PANEL_ID} table.mpc-grid tr.mpc-clickable:hover td{background:#eef4fb}
    /* The grid's own cells are nowrap, and white-space inherits — without this the
       detail view cannot wrap a single line of it. */
    #${PANEL_ID} table.mpc-grid tr.mpc-detail td{background:#f4f7fb;text-align:left;padding:8px 10px;white-space:normal}
    #${PANEL_ID} .mpc-detailbox{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:4px 22px}
    /* min-width:0 on both, or a long value refuses to wrap and runs over the
       column beside it. */
    #${PANEL_ID} .mpc-kv{display:flex;gap:8px;align-items:baseline;min-width:0;font:11.5px/1.5 Consolas,ui-monospace,monospace}
    #${PANEL_ID} .mpc-kv .mpc-k{color:#6a7180;width:118px;flex:0 0 118px}
    #${PANEL_ID} .mpc-kv .mpc-v{color:#1b1b1b;min-width:0;overflow-wrap:anywhere}
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
    let pointList = null;
    let plantNames = null;
    let lastVerification = null;
    let repeatTimer = null;
    // Printed reference -> the value seen on the previous pass, so a repeat run
    // can mark what moved.
    const watchPrevious = new Map();

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
        { label: 'hex', width: '9%', title: 'The same value as unsigned 16-bit hexadecimal' },
        { label: 'int16', width: '8%', title: 'Read as a signed 16-bit integer' },
        { label: 'Δ', width: '8%', title: 'Change since the previous pass of a repeated poll' },
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
        { label: 'Δ', width: '10%', title: 'Change since the previous pass of a repeated poll' },
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

    function setGridColumns(columns) {
        ui.gridColumns = columns;
        ui.gridCols.textContent = '';
        ui.gridHead.textContent = '';
        for (const c of columns) ui.gridCols.appendChild(el('col', { style: 'width:' + c.width }));
        ui.gridHead.appendChild(el('tr', {}, columns.map(c =>
            el('th', { textContent: c.label, title: c.title || c.label, style: c.align === 'left' ? 'text-align:left' : '' }))));
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

    /** Everything one register can be read as, for the row that expands on click. */
    function readingDetail(value, point, previous, fromPlant) {
        const u16 = value < 0 ? value + 65536 : value;
        const i16 = value > 32767 ? value - 65536 : value;
        const bits = (u16 >>> 0).toString(2).padStart(16, '0').replace(/(.{4})(?=.)/g, '$1 ');
        const chars = [u16 >> 8, u16 & 0xff]
            .map(code => (code >= 32 && code < 127) ? String.fromCharCode(code) : '·').join('');
        const rows = [
            ['raw', String(value)],
            ['hex', '0x' + (u16 >>> 0).toString(16).toUpperCase().padStart(4, '0')],
            ['binary', bits],
            ['unsigned / signed', u16 + ' / ' + i16],
            ['as two characters', chars],
            ['×0.1 / ×0.01', (value / 10).toFixed(1) + ' / ' + (value / 100).toFixed(2)],
        ];
        if (previous !== undefined && previous !== value) rows.push(['previous pass', previous + ' (changed by ' + (value - previous > 0 ? '+' : '') + (value - previous) + ')']);
        if (point) {
            rows.push(['point', point.name]);
            if (point.group) rows.push(['group', point.group]);
            rows.push(['datatype', point.datatype + (point.decoded.ok ? ' — table ' + point.decoded.table + ', ' + point.decoded.rawType + (point.decoded.step === 2 ? ', two registers' : '') : '')]);
            if (point.scaleKey) rows.push(['scale', point.scaleKey + (point.scale.known ? ' (×' + point.scale.factor + ')' : ' — not understood')]);
            if (point.unit) rows.push(['unit', point.unit]);
            if (point.rw) rows.push(['access', point.rw === 'rw' ? 'read/write in the list' : 'read only in the list']);
            if (point.rangeMin !== null || point.rangeMax !== null) {
                rows.push(['declared range', (point.rangeMin === null ? '…' : point.rangeMin) + ' to ' + (point.rangeMax === null ? '…' : point.rangeMax)]);
            }
            rows.push(['addresses', 'list ' + point.addr + ' · protocol ' + point.protocol + ' · modpoll ' + point.ref]);
        }
        if (fromPlant && fromPlant.length) {
            const u16 = value < 0 ? value + 65536 : value;
            rows.push(['plant parameters', fromPlant.length + ' on this register']);
            for (const entry of fromPlant) {
                // A bit parameter is worth showing against the bit it reads, so a
                // status word can be read off without counting in binary.
                const bitNote = entry.bit === null ? '' : ' — bit ' + entry.bit + ' is ' + ((u16 >> entry.bit) & 1);
                rows.push([
                    entry.bit === null ? 'plant says' : 'bit ' + entry.bit,
                    entry.name + (entry.plantValue ? ': ' + entry.plantValue : '') +
                        (entry.unit ? ' ' + entry.unit : '') + bitNote +
                        (entry.group ? '  [' + entry.group + ']' : ''),
                ]);
            }
            rows.push(['driver_id', fromPlant[0].driverId]);
            // The plant shows this register scaled, so the two numbers together
            // say what the scale is — which is the field a point list has to get
            // right and the one a document most often leaves out.
            const shown = Number(String(fromPlant[0].plantValue).replace(',', '.'));
            if (fromPlant[0].bit === null && !Number.isNaN(shown) && value !== 0) {
                const ratio = shown / value;
                const common = [1000, 100, 10, 1, 0.5, 0.1, 0.01, 0.001];
                const near = common.find(k => Math.abs(ratio - k) <= Math.abs(k) * 0.02);
                rows.push(['implied scale', near
                    ? '×' + near + ' — the plant shows ' + shown + ' where the register holds ' + value
                    : 'plant ' + shown + ' ÷ raw ' + value + ' = ' + ratio.toFixed(4) + ', no common scale']);
            }
        }
        return rows;
    }

    function toggleDetailRow(tr, value, point, previous, fromPlant) {
        const next = tr.nextElementSibling;
        if (next && next.classList.contains('mpc-detail')) { next.remove(); return; }
        for (const open of ui.gridBody.querySelectorAll('tr.mpc-detail')) open.remove();
        const cells = readingDetail(value, point, previous, fromPlant).map(([label, text]) =>
            el('div', { className: 'mpc-kv' }, [
                el('span', { className: 'mpc-k', textContent: label }),
                el('span', { className: 'mpc-v', textContent: text }),
            ]));
        const detail = el('tr', { className: 'mpc-detail' }, [
            el('td', { colSpan: (ui.gridColumns || REGISTER_COLUMNS).length }, [el('div', { className: 'mpc-detailbox' }, cells)]),
        ]);
        tr.parentNode.insertBefore(detail, tr.nextSibling);
    }

    function renderEmptyGrid(message) {
        if (!ui.gridBody) return;
        ui.gridBody.textContent = '';
        ui.gridBody.appendChild(el('tr', {}, [
            el('td', { className: 'mpc-empty', colSpan: (ui.gridColumns || REGISTER_COLUMNS).length, textContent: message }),
        ]));
    }

    function renderVerification(verification) {
        setGridColumns(POINT_COLUMNS);
        ui.gridBody.textContent = '';
        const frag = document.createDocumentFragment();
        for (const row of verification.rows) {
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
                tr.addEventListener('click', () => toggleDetailRow(tr, row.raw, p, undefined));
            }
            frag.appendChild(tr);
        }
        ui.gridBody.appendChild(frag);
        const s = verification.summary;
        ui.summary.textContent = s.points + ' points · ' + s.read + ' read, ' + s.zero + ' zero, ' +
            s.refused + ' refused, ' + s.noAnswer + ' no answer · ' + s.ranges + ' poll commands · ' + s.elapsedMs + ' ms';
    }

    function renderGrid(result) {
        const isBitTable = result.spec && (result.spec.table === '0' || result.spec.table === '1');
        setGridColumns(isBitTable ? BIT_COLUMNS : REGISTER_COLUMNS);
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
        const table = (result.spec && result.spec.table) || '4';
        const format = (result.spec && result.spec.format === '16-bit') ? '' : ((result.spec && result.spec.format) || '');
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
            const previous = watchPrevious.get(watchKey);
            const changed = previous !== undefined && previous !== v.v;
            watchPrevious.set(watchKey, v.v);
            const point = pointForReading(table, format, v.i);
            // A register the point list does not cover may still be named by the
            // plant's own parameter list, and several bits can share one register.
            const fromPlant = point ? null : plantNamesFor(table, format, v.i);
            if (point || fromPlant) named++;
            const scaled = point ? (point.scale.invert ? (v.v ? 0 : 1) : v.v * point.scale.factor) : null;
            const plantLabel = fromPlant
                ? fromPlant[0].name + (fromPlant.length > 1 ? '  (+' + (fromPlant.length - 1) + ' more)' : '')
                : '';
            // The plant is already showing this register scaled, which is the
            // scaled value nobody has to derive.
            const plantScaled = fromPlant ? Number(String(fromPlant[0].plantValue).replace(',', '.')) : NaN;
            const step = point ? point.decoded.step : 1;
            const sourceLabel = point
                ? point.datatype
                : (fromPlant ? fromPlant[0].group + (fromPlant.some(e => e.access === 'rw') ? ' · writable' : '') : '');
            const cells = isBitTable ? [
                { text: String(v.i) },
                { text: String(v.addr) },
                { text: point ? point.name : plantLabel, align: 'left' },
                { text: String(v.v), className: changed ? 'changed' : (v.v === 0 ? 'zero' : '') },
                { text: v.v ? 'ON' : 'OFF', className: changed ? 'changed' : (v.v === 0 ? 'zero' : '') },
                { text: changed ? ((v.v - previous > 0 ? '+' : '') + (v.v - previous)) : '', className: changed ? 'changed' : '' },
                { text: sourceLabel, align: 'left' },
            ] : [
                { text: String(v.i) },
                // A 32-bit value is read out of two registers, and saying which two
                // is the difference between a list that lines up and one that does not.
                { text: step === 2 ? v.addr + '–' + (v.addr + 1) : String(v.addr) },
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
                { text: '0x' + (u16 >>> 0).toString(16).toUpperCase().padStart(4, '0') },
                { text: String(i16) },
                { text: changed ? ((v.v - previous > 0 ? '+' : '') + (v.v - previous)) : '', className: changed ? 'changed' : '' },
                { text: sourceLabel, align: 'left' },
            ];
            const tr = el('tr', { className: 'mpc-clickable', title: 'Click for every reading of this register' },
                cells.map(c => el('td', {
                    textContent: c.text, className: c.className || '',
                    style: c.align === 'left' ? 'text-align:left' : '', title: c.title || c.text,
                })));
            tr.addEventListener('click', () => toggleDetailRow(tr, v.v, point, previous, fromPlant));
            frag.appendChild(tr);
        }
        ui.gridBody.appendChild(frag);
        const s = result.summary;
        ui.summary.textContent = s.returned + ' of ' + s.requested + ' registers, ' + s.nonZero + ' non-zero, ' +
            (s.returned ? 'range ' + s.min + '…' + s.max + ', ' : '') + s.blocks + ' command' + (s.blocks === 1 ? '' : 's') +
            ', ' + s.elapsedMs + ' ms' +
            (named ? ' · ' + named + ' named from the list' : (pointList ? ' · none matched the loaded list' : '')) +
            (rows.length > shown.length ? ' — showing the first 2000 rows' : '');
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

    /**
     * Take a parsed list into the panel: fill in whatever the file already knows
     * about reaching the device, and say what was understood and what was not.
     */
    function adoptPointList(list, filename) {
        pointList = list;
        const comm = list.comm || {};
        if (comm.mode) ui.mode.value = /tcp/i.test(comm.mode) ? 'tcp' : (/ascii/i.test(comm.mode) ? 'ascii' : 'rtu');
        if (comm.ip) ui.host.value = comm.ip;
        else if (comm.com_port) ui.host.value = comm.com_port;
        if (comm.port) ui.port.value = comm.port;
        if (comm.baudrate) ui.baudrate.value = String(comm.baudrate);
        if (comm.parity) ui.parity.value = String(comm.parity).toLowerCase();
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
        // Worth saying before the poll rather than after it fails: the Plant
        // Server polls the bus continuously and keeps the COM port open.
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
        const csvBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'CSV', title: 'The grid as it stands, for a spreadsheet' });
        csvBtn.addEventListener('click', () => {
            const rows = [(ui.gridColumns || REGISTER_COLUMNS).map(c => c.label)];
            for (const tr of ui.gridBody.querySelectorAll('tr')) {
                const cells = [...tr.children].map(td => td.textContent);
                if (cells.length === rows[0].length) rows.push(cells);
            }
            if (rows.length < 2) return log('Nothing in the grid to export');
            const csv = rows.map(r => r.map(c => /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(';')).join('\r\n');
            download('modpoll_' + nowStamp() + '.csv', csv, 'text/csv');
        });
        const reconnectBtn = el('button', { className: 'w2ui-btn mpc-b', textContent: 'Reconnect', title: 'Throw away the Plant Term session and take a fresh one' });
        reconnectBtn.addEventListener('click', async () => {
            reconnectBtn.disabled = true;
            try { await reconnectTerminal(); log('Plant Term reconnected', 'ok'); setDot(''); }
            catch (e) { log('ERROR: ' + e.message, 'err'); setDot('err'); }
            finally { reconnectBtn.disabled = false; }
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
            el('span', { className: 'mpc-spacer' }), scanBtn, copyBtn, saveBtn, csvBtn, probeBtn, reconnectBtn,
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
            try {
                log('Reading the plant\'s parameters for ' + unitId + '…');
                plantNames = await fetchPlantNames(unitId);
                log('Plant database: ' + plantNames.rows + ' parameters across ' + plantNames.groups +
                    ' groups, on ' + plantNames.byRef.size + ' registers' +
                    (plantNames.undecodable ? ' (' + plantNames.undecodable + ' without a decodable driver_id)' : ''), 'ok');
                if (lastResult) renderGrid(lastResult);
            } catch (e) { log('ERROR: ' + e.message, 'err'); }
            finally { plantNamesBtn.disabled = false; }
        });
        ui.listNote = el('span', { className: 'mpc-sum', textContent: 'No point list loaded' });
        form.appendChild(el('div', { className: 'mpc-actions' }, [
            loadListBtn, ui.verifyBtn, ui.reportBtn, ui.verifyJsonBtn, plantNamesBtn,
            el('span', { className: 'mpc-spacer' }), ui.listNote, ui.listFile,
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
        ui.gridCols = el('colgroup');
        ui.gridHead = el('thead');
        const table = el('table', { className: 'mpc-grid' }, [ui.gridCols, ui.gridHead, ui.gridBody]);
        setGridColumns(REGISTER_COLUMNS);
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
                '__modpoll.loadList(projectJson)           adopt a modbusgen project: points and system.comm',
                'await __modpoll.verify()                  poll every point in that list and judge the answers',
                '__modpoll.report()                        the verification as markdown parts, ready to upload',
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
