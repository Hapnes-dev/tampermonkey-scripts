/*
 * Back-to-back reads through a simulated Plant Term, with the console's own driver and polling engine.
 *
 * Plant 10275, 2026-11-20: three __modpoll.read() calls of an EM270 at slave 1 on COM1, one after the other. The
 * first returned 2392 and 0; the second and third returned no value, no error and no note - the shape of a run the
 * console ended itself, not one the device ended. A 6 s pause between reads hid it. This test drives the shipped
 * termRun / readRegisters / probeRefs / raw against a shell that behaves as Plant Term was seen to behave:
 *
 *   - commands run one line at a time, in the order they were sent, a line sent while another runs waiting its turn;
 *   - output reaches the page in batches, as the frame relays it, one div per line;
 *   - modpoll prints its banner and configuration at once and its answer when the device replies, so a serial run
 *     goes quiet in the middle; here the quiet is longer when the COM port was let go a moment ago. That last part is
 *     a model, not a measurement: it is one explanation that fits a 6 s pause curing the fault on 10275;
 *   - a line whose last program fails ends with Plant Term's own "Progam stopped with exit code 1".
 *
 * Variants change what is not known for certain: whether the command is echoed by the shell, by the terminal when
 * it is sent, or when it starts; whether stdout arrives as printed or only at exit with stderr ahead of it; how
 * often the frame relays, and whether an error line can land after the stdout relayed with it; and a terminal that
 * trims its oldest lines.
 *
 * Since 1.71.0 a run wakes on the transcript changing (a MutationObserver) and its timers run in a worker, because
 * in a hidden tab Chrome let the old 60 ms poll fire once a minute. The simulated frame has an observer (one variant
 * has none), and scenarioHidden runs reads again with the page's timers throttled, with and without a worker.
 *
 * Each expectation prints PASS or FAIL; the exit code is non-zero on any FAIL. `--quick` runs the main model only.
 * `--src <file>` runs another copy of the userscript (for example HEAD's, to watch the old driver fail the same
 * checks). Run: node test/terminal-check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const srcAt = argv.indexOf('--src');
const SRC = srcAt >= 0 ? path.resolve(argv[srcAt + 1]) : path.join(__dirname, '..', 'Modpoll-Console.user.js');
const quick = argv.includes('--quick');
// A Windows checkout (core.autocrlf) has CRLF; the markers lift() looks for are written with \n.
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

function lift(start, end) {
    const a = src.indexOf(start);
    const b = src.indexOf(end, a + 1);
    if (a < 0 || b < 0) throw new Error('could not lift ' + JSON.stringify(start.slice(0, 40)) + ' from ' + SRC);
    return src.slice(a, b);
}

// ------------------------------------------------------------------ the console, as shipped

/*
 * env replaces what the page gives the console: its timers (a hidden tab's are throttled, see hiddenTimers) and the
 * Worker constructor (Node has none, so by default the console runs on page timers alone).
 */
function loadConsole(plantTerm, env) {
    const e = Object.assign({ setTimeout, clearTimeout, Worker: undefined }, env || {});
    const body = [
        lift("    const EXE_BARE = 'modpoll';", '    // ---------------------------------------------------- Plant Term driver'),
        lift('    const termState = {', '    // -------------------------------------------------------- polling engine'),
        lift('    let abortRequested = false;', '    /*\n     * The map a full scan found'),
        // 1.72.0: a value that looks like a placeholder, and Diagnose.
        lift('    function suspectValue(v, format) {', '    /** Runs of consecutive numbers as "430-445, 448". */'),
        lift('    // ------------------------------------------------------------ diagnosis', '    // ------------------------------------------------ what may leave the browser'),
    ].join('\n');
    const factory = new Function('plantTerm', 'globalThis', 'setTimeout', 'clearTimeout', 'Worker', [
        "const window = globalThis; const location = { hostname: '10275.plants.iwmac.local' };",
        "const document = { getElementById: () => null, createElement: () => ({}) };",
        'const isSerialMode = mode => mode === "rtu" || mode === "ascii";',
        'const logged = []; const log = (text, level) => { logged.push((level || "") + " " + text); };',
        'const logCommand = () => false; const mirrorTerminal = () => {}; const chainSegments = () => [];',
        'const enrichValue = () => ({});',
        body,
        'termState.t = plantTerm.t; termState.outEl = plantTerm.out;',
        // raw() as the API has it: the typed command, made safe, run, parsed.
        'async function raw(typed) {',
        '    const command = ensureDevicePath(ensurePollOnce(typed));',
        '    assertReadOnly(command);',
        '    const out = await termRun(command, { timeoutMs: 25000, fullOutput: true });',
        '    const parsed = parseModpoll(out);',
        '    return { ok: parsed.values.length > 0 && !parsed.fatal, values: parsed.values, diagnostics: parsed.diagnostics, raw: out };',
        '}',
        'return { readRegisters, probeRefs, termRun, raw, logged, termState, diagnoseDevice, suspectValue, DIAG_MAX_ATTEMPTS };',
    ].join('\n'));
    return factory(plantTerm, globalThis, e.setTimeout, e.clearTimeout, e.Worker);
}

/*
 * A hidden tab's timers, scaled down: Chrome runs a chain of timers in a page hidden for five minutes once a minute,
 * each at the first wake-up after it is due; here the wake-ups are alignMs apart. Plant Term's frame is not slowed:
 * the simulation's own timers stand for its network, whose events a hidden tab still gets at once.
 */
function hiddenTimers(alignMs) {
    return {
        setTimeout: (fn, ms) => {
            const at = Math.ceil((Date.now() + (ms || 0)) / alignMs) * alignMs;
            return setTimeout(fn, Math.max(0, at - Date.now()));
        },
        clearTimeout: handle => clearTimeout(handle),
    };
}

// A dedicated worker: its timers keep time while the page's are throttled. It echoes [id, ms] back after ms, which
// is all the console's worker does.
class TickWorker {
    constructor() { this.onmessage = null; this.onerror = null; }
    postMessage(data) { setTimeout(() => { if (this.onmessage) this.onmessage({ data }); }, data[1]); }
}

// ------------------------------------------------------------------ the simulated Plant Term

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PROMPT = 'C:\\iwmac\\sys_tools\\plant_term>';

/*
 * Devices on the bus, by slave address: a function (table, ref) -> value, or 'refuse' for a register outside the
 * map. A missing slave never answers. A block is refused whole if any register in it is refused.
 */
const DEVICES = {
    1: (table, ref) => (table === '4' && ref >= 1 && ref <= 120 ? (ref === 1 ? 2392 : 0) : 'refuse'),   // EM270: 2392, 0, 0, ...
    2: (table, ref) => ((ref >= 1 && ref <= 60) || (ref >= 100 && ref <= 160) ? 1000 + ref : 'refuse'),  // strict
    4: (table, ref) => (ref >= 1 && ref <= 400 ? 3 * ref : 'refuse'),                                     // every value distinct
    5: (table, ref) => (ref === 7 ? 'lose' : 500 + ref),   // whatever asks for 7 gets a reply that leaves no trace
};

function makePlantTerm(opts) {
    const o = Object.assign({
        echo: 'shell',        // 'shell': cmd prints prompt + command into its output; 'send': the terminal echoes it when
                              // exec is called; 'start': the terminal echoes it when the line starts; 'none'
        stdout: 'live',       // 'live': as printed; 'exit': stdout only at exit, stderr at once and ahead of it
        relayMs: 150,         // how often the frame hands new output to the terminal
        stderrLast: false,    // a relay batch puts stderr after stdout - an error can land past the end tag
        firstPrefix: true,    // the first line a command prints comes behind "<cwd>->", as on plant 10275:
                              // "C:\iwmac\sys_tools\plant_term->#mpc:r..." - 1.70.0 missed exactly this
        lineMs: 120,          // from a line being sent to the shell starting it
        limit: 0,             // keep only the newest N lines (0: everything)
        restMs: 3000,         // a COM port closed less than this ago ... (a model: on 10275 a 6 s pause hid the fault)
        restPenaltyMs: 500,   // ... takes this much longer to open: longer than the 300 ms the console used to wait
        replyMs: 140,         // a 9600-baud answer
        refuseMs: 600,        // a device saying no
        timeoutMs: 1000,      // modpoll's own reply time-out
        observer: true,       // the frame's window has a MutationObserver (false: a page without one)
        route: null,          // (where) -> what a modpoll pointed there meets (1.72.0, Diagnose): { device }, { held },
                              // { noPort }, { unreachable } or { garbled }; null: DEVICES by slave, as before
    }, opts || {});
    const lines = [];
    /*
     * The frame's MutationObserver, as far as the console uses it: observe() the transcript, a callback after each
     * change to it (once per batch, as a microtask, as the browser delivers it), disconnect(). It counts how many
     * are connected, so a check can say whether each run let go of its own.
     */
    const observers = new Set();
    const observing = { created: 0, live: 0, maxLive: 0 };
    class FrameObserver {
        constructor(callback) { this.callback = callback; observing.created++; }
        observe(target) {
            if (target !== out) throw new Error('observing something other than the transcript');
            if (!observers.has(this)) { observers.add(this); observing.live = observers.size; }
            observing.maxLive = Math.max(observing.maxLive, observers.size);
        }
        disconnect() { observers.delete(this); observing.live = observers.size; }
    }
    const out = {
        isConnected: true,
        ownerDocument: o.observer ? { defaultView: { MutationObserver: FrameObserver } } : null,
        get firstElementChild() { return lines.length ? node(0) : null; },
    };
    const node = i => ({
        get innerText() { return lines[i]; },
        get nextElementSibling() { return i + 1 < lines.length ? node(i + 1) : null; },
    });
    const append = texts => {
        if (!texts.length) return;
        for (const t of texts) lines.push(t);
        if (o.limit && lines.length > o.limit) lines.splice(0, lines.length - o.limit);
        for (const ob of observers) queueMicrotask(() => { if (observers.has(ob)) ob.callback([]); });
    };
    let pending = [];
    let fresh = false;   // the next line printed is the command's first
    const emit = (text, kind) => {
        if (fresh && o.firstPrefix) text = PROMPT.slice(0, -1) + '->' + text;
        fresh = false;
        pending.push({ text, kind: kind || 'out' });
    };
    const relay = setInterval(() => {
        if (!pending.length) return;
        let batch = pending;
        pending = [];
        if (o.stderrLast) batch = batch.filter(l => l.kind !== 'err').concat(batch.filter(l => l.kind === 'err'));
        append(batch.map(l => l.text));
    }, o.relayMs);

    const portClosedAt = {};
    const stats = { lines: 0, runs: 0, maxQueue: 0 };
    const queue = [];
    let running = false;

    async function modpoll(segment) {
        stats.runs++;
        const tokens = segment.split(/\s+/);
        const arg = flag => { const at = tokens.indexOf(flag); return at >= 0 ? tokens[at + 1] : undefined; };
        const host = tokens[tokens.length - 1];
        const slave = Number(arg('-a'));
        const table = String(arg('-t') || '4').split(':')[0];
        const ref = Number(arg('-r'));
        const count = Number(arg('-c') || 1);
        const stdout = [];
        const err = [];
        const say = text => (o.stdout === 'live' ? emit(text) : stdout.push(text));
        say('modpoll - FieldTalk(tm) Modbus(R) Polling Utility');
        say('Copyright (c) 2002-2004 FOCUS Software Engineering Pty Ltd');
        say('Getopt Library Copyright (C) 1987-1997  Free Software Foundation, Inc.');
        say('');
        say('Protocol configuration: Modbus RTU');
        say('Slave configuration: Address = ' + slave + ', start reference = ' + ref + ', count = ' + count);
        say('Serial port configuration: ' + host + ', 9600, 8, 1, none');
        say('Data type: 16-bit register, output (holding) register table');
        say('');
        await sleep(60 + (Date.now() - (portClosedAt[host] || 0) < o.restMs ? o.restPenaltyMs : 0));
        // Where the command is pointed decides what it meets (1.72.0).
        const mode = arg('-m') || 'rtu';
        const serial = mode === 'rtu' || mode === 'ascii';
        const where = {
            mode, host, slave, table,
            port: serial ? null : Number(arg('-p') || 502),
            baud: serial ? String(arg('-b') || '19200') : null,
            parity: serial ? String(arg('-p') || 'even') : null,
            stop: serial ? String(arg('-s') || '1') : null,
        };
        stats.where = (stats.where || []).concat([Object.assign({ segment }, where)]);
        const route = o.route ? (o.route(where) || {}) : { device: DEVICES[slave] };
        let code = 0;
        if (route.held || route.noPort || route.unreachable) {
            err.push(route.held ? 'Serial port already open!' : (route.noPort ? 'Port or socket open error!' : "Can't reach slave!"));
            code = 1;
            for (const line of err) emit(line, 'err');
            await sleep(30);
            if (o.stdout === 'exit') for (const line of stdout) emit(line);
            return code;
        }
        say('Protocol opened successfully.');
        say('Polling slave (Ctrl-C to stop) ...');
        const device = route.device;
        if (route.garbled) {
            await sleep(o.replyMs);
            err.push('Checksum error!');
        } else if (!device) {
            await sleep(o.timeoutMs);
            err.push('Reply time-out!');
        } else {
            const values = [];
            for (let n = 0; n < count; n++) values.push(device(table, ref + n));
            if (values.includes('lose')) {
                await sleep(o.replyMs);   // modpoll goes quiet: no value, no error line, as if its reply were lost
            } else if (values.includes('illegal function')) {
                await sleep(o.refuseMs);
                err.push('Illegal Function exception response!');
            } else if (values.includes('refuse')) {
                await sleep(o.refuseMs);
                err.push('Illegal Data Address exception response!');
            } else {
                await sleep(o.replyMs);
                values.forEach((v, n) => say('[' + (ref + n) + ']: ' + v));
            }
        }
        // stderr is written the moment it happens; in 'exit' mode it reaches the page ahead of the stdout that
        // was held back until the program ended.
        for (const line of err) emit(line, 'err');
        await sleep(30);
        portClosedAt[host] = Date.now();
        if (o.stdout === 'exit') for (const line of stdout) emit(line);
        return code;
    }

    async function runLine(cmd) {
        stats.lines++;
        if (o.echo === 'start') append([PROMPT + cmd]);
        await sleep(o.lineMs);
        if (o.echo === 'shell') emit(PROMPT + cmd);
        fresh = true;
        let code = 0;
        const segments = cmd.split(' & ');
        for (let k = 0; k < segments.length; k++) {
            const seg = segments[k].trim();
            if (/^echo /.test(seg)) { emit(seg.slice(5) + (k < segments.length - 1 ? ' ' : '')); code = 0; continue; }
            if (/^modpoll/.test(seg)) { code = await modpoll(seg); continue; }
            emit("'" + seg.split(' ')[0] + "' is not recognized as an internal or external command,");
            code = 1;
        }
        emit('');
        if (code) { emit('Progam stopped with exit code ' + code); }
    }

    const t = {
        get_prompt: () => PROMPT,
        exec(cmd) {
            if (o.echo === 'send') append([PROMPT + cmd]);
            queue.push(cmd);
            stats.maxQueue = Math.max(stats.maxQueue, queue.length + (running ? 1 : 0));
            if (!running) {
                running = true;
                (async () => {
                    while (queue.length) await runLine(queue.shift());
                    running = false;
                })();
            }
        },
    };
    return {
        t, out, stats, lines, observing,
        stop: () => clearInterval(relay),
        get busy() { return running || pending.length > 0; },
    };
}

// ------------------------------------------------------------------ checks

let failures = 0;
const check = (name, ok, detail) => {
    if (!ok) failures++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : '\n        ' + detail));
};
const RTU = { mode: 'rtu', host: 'COM1', table: '4', base: 'printed', baudrate: '9600', databits: '8', stopbits: '1', parity: 'none' };
const shape = r => (r.values.length ? r.values.map(v => v.i + '=' + v.v).join(',') : '-') +
    ' | refused ' + ((r.unreadable || []).join(',') || '-') +
    ' | no answer ' + ((r.noAnswer || []).join(',') || '-') +
    ' | unsettled ' + ((r.unsettled || []).join(',') || '-') +
    ' | ' + (r.diagnostics.map(d => d.text).join(' / ') || 'no diagnostics');
const saysRefused = r => r.diagnostics.some(d => /refus/i.test(d.text));
const idle = async term => { const until = Date.now() + 15000; while (term.busy && Date.now() < until) await sleep(50); };
// Each run watches the transcript through an observer of its own and lets it go when it ends (1.71.0). Runs go one
// line at a time, so no more than one is ever connected.
const checkObservers = (label, term) => {
    const o = term.observing;
    if (!o.created) return;   // a page without MutationObserver, or a console from before 1.71
    check(label + ': every run disconnects its transcript observer, and no two are connected at once',
        o.live === 0 && o.maxLive === 1, o.created + ' created, ' + o.live + ' still connected, at most ' + o.maxLive + ' at once');
};

async function scenarioBackToBack(label, model) {
    const term = makePlantTerm(model);
    const c = loadConsole(term);
    try {
        // 1. The EM270, three times in a row, as on plant 10275.
        const got = [];
        for (let i = 0; i < 3; i++) got.push(await c.readRegisters(Object.assign({}, RTU, { slave: 1, start: 1, count: 2 })));
        const each = got.map(r => r.values.map(v => v.v).join(','));
        check(label + ': three back-to-back reads of a healthy meter each return 2392,0',
            each.every(x => x === '2392,0') && got.every(r => !r.diagnostics.length),
            got.map(shape).join('\n        '));

        // 2. A slave that is not there: no answer, never a refusal - and the meter right after it still answers.
        const absent = await c.readRegisters(Object.assign({}, RTU, { slave: 3, start: 1, count: 2 }));
        check(label + ': a slave that never answers is reported as no answer, not as refusing',
            !absent.values.length && !(absent.unreadable || []).length && !saysRefused(absent) &&
            (absent.noAnswer || []).join(',') === '1,2', shape(absent));
        const after = await c.readRegisters(Object.assign({}, RTU, { slave: 1, start: 1, count: 2 }));
        check(label + ': the meter answers right after a time-out', after.values.map(v => v.v).join(',') === '2392,0', shape(after));

        // 3. A real refusal is still a refusal, and isolated to the references refused.
        const strict = await c.readRegisters(Object.assign({}, RTU, { slave: 2, start: 55, count: 10 }));
        check(label + ': a strict device refuses 61-64 and answers 55-60',
            strict.values.map(v => v.i).join(',') === '55,56,57,58,59,60' && (strict.unreadable || []).join(',') === '61,62,63,64' &&
            !(strict.noAnswer || []).length, shape(strict));

        // 4. Two reads started together: one line at a time, each with its own answer.
        const [x, y] = await Promise.all([
            c.readRegisters(Object.assign({}, RTU, { slave: 1, start: 1, count: 2 })),
            c.readRegisters(Object.assign({}, RTU, { slave: 4, start: 10, count: 3 })),
        ]);
        check(label + ': two reads started at once each get their own answer',
            x.values.map(v => v.v).join(',') === '2392,0' && y.values.map(v => v.v).join(',') === '30,33,36', shape(x) + '\n        ' + shape(y));
    } finally { await idle(term); term.stop(); }
    checkObservers(label, term);
}

async function scenarioWide(label, model) {
    const term = makePlantTerm(model);
    const c = loadConsole(term);
    try {
        // Four blocks on one chained line, read twice in a row: 300 values, each the device's own.
        for (let pass = 1; pass <= 2; pass++) {
            const r = await c.readRegisters(Object.assign({}, RTU, { slave: 4, start: 1, count: 300 }));
            const right = r.values.length === 300 && r.values.every(v => v.v === 3 * v.i);
            check(label + ': 300 registers in chained blocks, pass ' + pass, right && !r.diagnostics.length,
                r.values.length + ' values; ' + (r.diagnostics.map(d => d.text).join(' / ') || 'no diagnostics'));
        }
        // A reply that leaves no trace: asked again alone, twice, then unsettled - never refused, never no answer.
        const lost = await c.readRegisters(Object.assign({}, RTU, { slave: 5, start: 5, count: 5 }));
        check(label + ': a reply that leaves no trace is unsettled, the rest of the block read',
            lost.values.map(v => v.i).join(',') === '5,6,8,9' && (lost.unsettled || []).join(',') === '7' &&
            !(lost.unreadable || []).length && !(lost.noAnswer || []).length && !saysRefused(lost), shape(lost));
        // probeRefs, as a scan asks, twice in a row.
        const probes = [1, 61, 100, 161].map(ref => ({ table: '4', ref }));
        const p1 = await c.probeRefs(Object.assign({}, RTU, { slave: 2, timeoutMs: 25000 }), probes);
        const p2 = await c.probeRefs(Object.assign({}, RTU, { slave: 2, timeoutMs: 25000 }), probes);
        const said = p => Object.keys(p).sort().map(k => k + (p[k].answered ? '=' + p[k].value : '=no')).join(' ');
        check(label + ': probes back to back answer the same', said(p1) === said(p2) && said(p1) === '4:1=1001 4:100=1100 4:161=no 4:61=no',
            said(p1) + ' then ' + said(p2));
        // A typed command, twice in a row.
        const t1 = await c.raw('modpoll -m rtu -a 1 -t 4 -r 1 -c 2 -b 9600 -d 8 -s 1 -p none COM1');
        const t2 = await c.raw('modpoll -m rtu -a 1 -t 4 -r 1 -c 2 -b 9600 -d 8 -s 1 -p none COM1');
        check(label + ': a typed command twice in a row answers both times',
            t1.values.map(v => v.v).join(',') === '2392,0' && t2.values.map(v => v.v).join(',') === '2392,0',
            JSON.stringify(t1.values) + ' then ' + JSON.stringify(t2.values));
    } finally { await idle(term); term.stop(); }
    checkObservers(label, term);
}

/*
 * The same reads in a hidden tab (1.71.0). On plant 10275 a 60 ms wait took 909 ms in a hidden tab and two reads took
 * 55 s and 60 s: the console looked at the transcript on a timer, and Chrome let that timer fire once a minute. Every
 * step runs three times, each on a fresh Plant Term: in a visible tab; in a hidden one, whose page timers wake only
 * every ALIGN ms while a worker's keep time; and in a hidden one whose page cannot have a worker. A step may take no
 * longer hidden than visible, give or take the relay's phase. Without the worker that holds for every run that
 * prints a value or an error; a run that prints neither waits out its 400 ms for a late error line on the page's
 * throttled timer, and only has to come back right.
 */
async function scenarioHidden(label, model) {
    const ALIGN = 3000;
    const em270 = Object.assign({}, RTU, { slave: 1, start: 1, count: 2 });
    const probes = [1, 61, 100, 161].map(ref => ({ table: '4', ref }));
    const said = p => Object.keys(p).sort().map(k => k + (p[k].answered ? '=' + p[k].value : '=no')).join(' ');
    const meter = r => r.values.map(v => v.v).join(',') === '2392,0';
    // name, the step, whether its answer is right, whether it prints a value or an error on every line it sends
    const steps = [
        ['read 1 of the EM270', c => c.readRegisters(em270), meter, true],
        ['read 2 of the EM270', c => c.readRegisters(em270), meter, true],
        ['read 3 of the EM270', c => c.readRegisters(em270), meter, true],
        ['a reply that leaves no trace', c => c.readRegisters(Object.assign({}, RTU, { slave: 5, start: 5, count: 5 })),
            r => r.values.map(v => v.i).join(',') === '5,6,8,9' && (r.unsettled || []).join(',') === '7', false],
        ['probes of a strict device', c => c.probeRefs(Object.assign({}, RTU, { slave: 2, timeoutMs: 25000 }), probes),
            p => said(p) === '4:1=1001 4:100=1100 4:161=no 4:61=no', true],
        ['a typed command', c => c.raw('modpoll -m rtu -a 1 -t 4 -r 1 -c 2 -b 9600 -d 8 -s 1 -p none COM1'), meter, true],
    ];
    const modes = [
        { name: 'visible', env: {} },
        { name: 'hidden', env: Object.assign(hiddenTimers(ALIGN), { Worker: TickWorker }) },
        { name: 'hidden, no worker', env: hiddenTimers(ALIGN) },
    ];
    const took = {};
    for (const mode of modes) {
        const term = makePlantTerm(model);
        const c = loadConsole(term, mode.env);
        const right = [];
        took[mode.name] = [];
        try {
            for (const [name, step, ok] of steps) {
                const t0 = Date.now();
                const r = await step(c);
                took[mode.name].push(Date.now() - t0);
                if (!ok(r)) right.push(name + ': ' + (r.values ? shape(r) : said(r)));
            }
        } finally { await idle(term); term.stop(); }
        check(label + ', ' + mode.name + ': every step comes back right', !right.length, right.join('\n        '));
        checkObservers(label + ', ' + mode.name, term);
    }
    // The relay hands output over every relayMs whatever the tab does, so two runs of one step differ by its phase.
    const slack = v => v * 1.25 + 400;
    steps.forEach(([name, , , prompt], i) => {
        const v = took.visible[i];
        const h = took.hidden[i];
        const n = took['hidden, no worker'][i];
        check(label + ': ' + name + ' takes no longer in a hidden tab (' + v + ' ms visible, ' + h + ' ms hidden)', h <= slack(v));
        if (prompt) {
            check(label + ': ' + name + ' takes no longer in a hidden tab without a worker (' + v + ' ms visible, ' + n + ' ms hidden)',
                n <= slack(v));
        }
    });
}

/*
 * Diagnose (1.72.0) against a small plant whose every fault is known, one case per cause. What it must get right:
 * the verdict, a suggestion only from a read that answered with it, and nothing but one-register reads on the way.
 */
async function scenarioDiagnose(label) {
    const COM1_BUS = { 1: (t, r) => (t === '4' && r >= 1 && r <= 120 ? (r === 1 ? 2392 : 0) : 'refuse'), 4: (t, r) => 3 * r };
    const route = w => {
        if (w.mode === 'rtu') {
            const port = String(w.host).replace(/^\\\\\.\\/, '').toUpperCase();
            if (port === 'COM2') return { held: true };                            // the Plant Server's
            if (['COM1', 'COM3', 'COM4'].indexOf(port) < 0) return { noPort: true };
            if (port === 'COM1') return w.baud === '9600' && w.parity === 'none' ? { device: COM1_BUS[w.slave] } : {};
            if (port === 'COM3') {                                                 // a device reset to 19200 8E1
                if (w.slave !== 7 || w.baud !== '19200') return {};
                return w.parity === 'even' ? { device: (t, r) => 700 + r } : { garbled: true };
            }
            return {};                                                             // COM4: nothing on it at all
        }
        if (w.host === '192.168.10.100') {                                         // input registers only
            if (w.port !== 502) return { unreachable: true };
            return { device: (t, r) => (t === '3' && r >= 1 && r <= 50 ? 100 + r : (t === '4' ? 'illegal function' : 'refuse')) };
        }
        if (w.host === '192.168.10.30' && w.mode === 'enc') {                      // COM2's gateway, serial port 2
            return w.port === 4002 ? { device: w.slave === 5 ? (t, r) => 500 + r : null } : { unreachable: true };
        }
        if (w.host === '192.168.10.50') return { device: w.slave === 2 ? (t, r) => 50 + r : null };   // a gateway: only unit 2
        return { unreachable: true };
    };
    const term = makePlantTerm({ route, timeoutMs: 150, replyMs: 20, refuseMs: 40, lineMs: 15, relayMs: 20, restMs: 0 });
    const c = loadConsole(term);
    const rtu = (host, slave, more) => Object.assign({ mode: 'rtu', host, slave, table: '4', start: 1, baudrate: '9600', parity: 'none', databits: '8', stopbits: '1' }, more || {});
    const tcp = (host, slave, more) => Object.assign({ mode: 'tcp', host, port: 502, slave, table: '4', start: 1 }, more || {});
    const units = [
        { unit_id: 'E01', mode: 'rtu', host: 'COM1', slave: 1, baudrate: '9600', parity: 'none', databits: '8', stopbits: '1', driver_addr: '1', bus: { com: 'COM1', gateway: '', serial: true } },
        { unit_id: 'X09', mode: 'rtu', host: 'COM1', slave: 9, baudrate: '9600', parity: 'none', databits: '8', stopbits: '1', driver_addr: '4_9', bus: { com: 'COM1', gateway: '', serial: true } },
        { unit_id: 'P05', mode: 'rtu', host: 'COM2', slave: 5, baudrate: '9600', parity: 'none', databits: '8', stopbits: '1', driver_addr: '5', bus: { com: 'COM2', gateway: '192.168.10.30', serial: true } },
    ];
    const run = (spec, unitId, more) => c.diagnoseDevice(spec, Object.assign({
        units, unit: units.find(u => u.unit_id === unitId) || null, comPorts: async () => [{ port: 'COM1' }, { port: 'COM2' }, { port: 'COM3' }, { port: 'COM4' }],
    }, more || {}));
    const said = d => d.verdict + ' | ' + d.headline + ' | ' + (d.suggestion ? JSON.stringify(d.suggestion) : 'no suggestion') + ' | ' +
        d.attempts.map(a => a.n + ':' + a.outcome).join(' ');
    try {
        let d = await run(rtu('COM1', 1), 'E01');
        check(label + ': a healthy meter answers on the first read, and nothing more is tried',
            d.verdict === 'answers' && d.tried === 1 && d.confidence === 'high', said(d));

        d = await run(rtu('COM1', 1, { start: 121 }), 'E01');
        check(label + ': a register just past the map: refused, the one before it answers - a lead with low confidence, not a fact',
            d.verdict === 'register refused, neighbour answers' && d.suggestion && d.suggestion.start === 120 && d.confidence === 'low', said(d));

        d = await run(tcp('192.168.10.100', 1, { table: '4', start: 10 }), null);
        check(label + ': holding refused as an illegal function, the input table answers: wrong table, high confidence',
            d.verdict === 'wrong table' && d.suggestion && d.suggestion.table === '3' && d.confidence === 'high', said(d));

        d = await run(rtu('COM2', 5), 'P05');
        check(label + ': a COM port the Plant Server holds: its gateway in ENC answers on 4002 - suggested, with the caveat',
            d.verdict === 'reachable through the gateway' && d.suggestion && d.suggestion.mode === 'enc' && d.suggestion.port === 4002 &&
            d.suggestion.host === '192.168.10.30' && d.confidence === 'medium' && d.next.some(n => /another device/i.test(n)), said(d));

        d = await run(rtu('COM9', 1), null);
        check(label + ': a COM port that does not exist: said, with the ports this plant server has',
            d.verdict === 'port did not open' && d.tried === 1 && (d.comPorts || []).join(',') === 'COM1,COM2,COM3,COM4', said(d));

        d = await run(rtu('COM3', 7), null);
        check(label + ': a device answering at 19200 8E1, not 9600 8N1: found, and the settings suggested with high confidence',
            d.verdict === 'found at other settings' && d.suggestion && d.suggestion.baudrate === '19200' && d.suggestion.parity === 'even' && d.confidence === 'high', said(d));

        d = await run(rtu('COM1', 9), 'X09');
        check(label + ': a silent address on a working bus: the neighbour proves the bus, and the address in the plant\'s own string answers',
            d.verdict === 'found at another address' && d.suggestion && d.suggestion.slave === 4 &&
            d.findings.some(f => /The bus works/.test(f)), said(d));

        d = await run(tcp('192.168.10.99', 1), null);
        check(label + ': nothing takes a connection: unreachable, one read, no suggestion', d.verdict === 'unreachable' && d.tried === 1 && !d.suggestion, said(d));

        d = await run(tcp('192.168.10.100', 1, { port: 503, table: '3', start: 10 }), null);
        check(label + ': the wrong TCP port: 502 answers, suggested with high confidence',
            d.verdict === 'wrong port' && d.suggestion && d.suggestion.port === 502 && d.confidence === 'high', said(d));

        d = await run(tcp('192.168.10.50', 1), null);
        check(label + ': a gateway that serves unit 2 only: the connection works, unit 2 answers - medium confidence, it could be another device',
            d.verdict === 'found at another address' && d.suggestion && d.suggestion.slave === 2 && d.confidence === 'medium', said(d));

        d = await run(rtu('COM4', 3), null);
        check(label + ': a bus with nothing on it: silent, within the budget of ' + c.DIAG_MAX_ATTEMPTS + ' reads',
            d.verdict === 'silent' && d.tried <= c.DIAG_MAX_ATTEMPTS && !d.suggestion, said(d));

        // Every command any diagnosis sent: one register, polled once, never slave 0, nothing after the host.
        const sent = (term.stats.where || []).map(w => w.segment);
        const unsafe = sent.filter(s => {
            const tokens = s.trim().split(/\s+/);
            const at = flag => tokens.indexOf(flag);
            return at('-1') < 0 || tokens[at('-c') + 1] !== '1' || tokens[at('-a') + 1] === '0' ||
                at('-a') < 0 || /^-/.test(tokens[tokens.length - 1]);
        });
        check(label + ': every one of the ' + sent.length + ' commands reads one register once: -1, -c 1, never slave 0',
            sent.length > 0 && unsafe.length === 0, unsafe.slice(0, 3).join('\n        '));

        check(label + ': a value at the ends of the signed range, or all bits set in hex, is a placeholder; an ordinary one is not',
            !!c.suspectValue(-32768, '') && c.suspectValue(-32768, '').code === '0x8000' && c.suspectValue(32767, '').code === '0x7FFF' &&
            c.suspectValue(65535, 'hex').code === '0xFFFF' && c.suspectValue(-999, '').strength === 'weak' &&
            !c.suspectValue(2392, '') && !c.suspectValue(-4010, '') && !c.suspectValue(-1, '') && !c.suspectValue(23.5, 'float') &&
            c.suspectValue(2147483647, 'int').strength === 'strong',
            JSON.stringify([c.suspectValue(-32768, ''), c.suspectValue(-1, ''), c.suspectValue(65535, 'hex')]));
    } finally {
        await idle(term);
        term.stop();
    }
}

(async () => {
    console.log('terminal-check: ' + path.relative(process.cwd(), SRC));
    const main = { echo: 'shell', stdout: 'live', relayMs: 150 };
    await scenarioBackToBack('plant-like', main);
    await scenarioWide('plant-like', main);
    await scenarioHidden('plant-like', main);
    await scenarioDiagnose('diagnose');
    if (!quick) {
        await scenarioBackToBack('a page without MutationObserver', { echo: 'shell', stdout: 'live', relayMs: 150, observer: false });
        await scenarioHidden('errors relayed after stdout', { echo: 'shell', stdout: 'exit', relayMs: 300, stderrLast: true });
        await scenarioBackToBack('echoed on send', { echo: 'send', stdout: 'live', relayMs: 150 });
        await scenarioBackToBack('echoed when it starts, stdout at exit', { echo: 'start', stdout: 'exit', relayMs: 250 });
        await scenarioBackToBack('no echo, no prefix, fast relay', { echo: 'none', stdout: 'live', relayMs: 40, firstPrefix: false });
        await scenarioBackToBack('stdout at exit, slow relay', { echo: 'shell', stdout: 'exit', relayMs: 400 });
        await scenarioBackToBack('errors relayed after stdout', { echo: 'shell', stdout: 'exit', relayMs: 300, stderrLast: true });
        await scenarioWide('a terminal that keeps 150 lines', { echo: 'shell', stdout: 'live', relayMs: 150, limit: 150 });
    }
    console.log(failures ? '\n' + failures + ' FAILED' : '\nAll passed.');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e && e.stack || e); process.exit(2); });
