// ==UserScript==
// @name         AK3 Auto Scan
// @version      9.3
// @description  Automate AK3 scanner setup workflow
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/ak3-autoscan/AK3-Autoscan.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/ak3-autoscan/AK3-Autoscan.user.js
// @match        http://*.plants.iwmac.local:8080/secure/ak3_setup/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setClipboard
// @connect      toolbox.iwmac.local
// @connect      toolbox.iwmac.local:8505
// @connect      tools.iwmac.local
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const X_CALLER = 'AK3-Autoscan';
    function makeUuid() {
        return (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    }
    let _runId = makeUuid();
    let _runIdPlant = null;
    // In-tab run control. `_running` guards against a second loop in the same
    // tab; `_abortRequested` makes every poll helper bail out, so an Abort takes
    // effect mid-wait instead of at the next step boundary.
    let _running = false;
    let _abortRequested = false;
    const ABORT_MSG = 'Auto Scan aborted by user';
    // A step that is resumed this many times without advancing is assumed to be
    // stuck in a reload loop; the run is stopped and AK3 reverted instead.
    const MAX_RESUMES_PER_STEP = 3;
    function ensureRunIdForPlant(plantId) {
        const pid = String(plantId || '');
        if (pid && _runIdPlant !== pid) {
            _runId = makeUuid();
            _runIdPlant = pid;
            try { log('New X-Run-Id for plant ' + pid + ': ' + _runId); } catch (e) {}
        }
        return _runId;
    }

    const LOCAL_IP  = '192.168.10.10';
    const REMOTE_IP = '192.168.10.20';

    // ---------- Per-plant storage scoping ----------
    // Tampermonkey GM_setValue is shared across ALL tabs running this script.
    // To allow scanning multiple plants in parallel without cross-talk, we
    // namespace every persisted key by the plant id from the current tab's host.
    // Each tab is bound to one plant via its URL, so per-plant keys give natural
    // per-tab isolation for state, logs, and the panel-closed flag.
    function getPlantIdFromHost() {
        const m = location.host.match(/^(\d+)\.plants\.iwmac\.local/);
        return m ? m[1] : null;
    }
    const TAB_PLANT_ID = getPlantIdFromHost();
    const stateKeyFor       = (pid) => 'ak3_state_'        + (pid || 'unknown');
    const logKeyFor         = (pid) => 'ak3_log_'          + (pid || 'unknown');
    const panelClosedKeyFor = (pid) => 'ak3_panel_closed_' + (pid || 'unknown');
    const STATE_KEY = stateKeyFor(TAB_PLANT_ID);
    const LOG_KEY   = logKeyFor(TAB_PLANT_ID);
    const PANEL_CLOSED_KEY = panelClosedKeyFor(TAB_PLANT_ID);
    const summaryKeyFor     = (pid) => 'ak3_summary_'      + (pid || 'unknown');
    const SUMMARY_KEY = summaryKeyFor(TAB_PLANT_ID);

    // One-time cleanup of pre-7.7 global keys so they don't linger in storage.
    try {
        if (GM_getValue('ak3_state', null) !== null)         GM_deleteValue('ak3_state');
        if (GM_getValue('ak3_log', null) !== null)           GM_deleteValue('ak3_log');
        if (GM_getValue('ak3_panel_closed', null) !== null)  GM_deleteValue('ak3_panel_closed');
    } catch (e) {}

    const getState = () => GM_getValue(STATE_KEY, null);
    // Every save re-stamps `ts` (shown as the run's age on resume) and carries
    // the trace id so a resumed run keeps its X-Run-Id. Steps save only
    // { plantId, step }, which intentionally drops `resumes` on every advance.
    function setState(s) {
        if (_abortRequested) return; // an aborted loop must not resurrect the run
        GM_setValue(STATE_KEY, { ...s, runId: _runId, ts: Date.now() });
        refreshControls();
    }
    function clearState() {
        GM_deleteValue(STATE_KEY);
        refreshControls();
    }

    // ---------- Run summary (feeds the completion card) ----------
    // Per plant, reset on every start, kept across reloads/resumes. Each step
    // records when it started and ended plus whatever the page said.
    const getSummary = () => GM_getValue(SUMMARY_KEY, null) || { steps: {} };
    function updateSummary(fn) {
        const s = getSummary();
        if (!s.steps) s.steps = {};
        fn(s);
        GM_setValue(SUMMARY_KEY, s);
        return s;
    }
    function stepStarted(step) {
        updateSummary((s) => {
            const st = s.steps[step] = s.steps[step] || {};
            if (!st.startedAt) st.startedAt = Date.now();
            st.visits = (st.visits || 0) + 1;
        });
    }
    function noteStep(step, patch) {
        updateSummary((s) => { s.steps[step] = Object.assign(s.steps[step] || {}, patch); });
    }
    function stepDone(step, patch) {
        updateSummary((s) => {
            s.steps[step] = Object.assign(s.steps[step] || {}, patch || {}, { endedAt: Date.now() });
        });
    }
    // The page's status line, as shown ("IPer oppdatert", "Enheter aktivert", ...).
    function msgText() {
        const el = document.querySelector('#message');
        return el ? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    }
    // The Scan tab lists what the scanner has found so far, one <li> each:
    //   <li>0_5 - <em>K 1 Meririrom</em> ( 084B4083_017X )</li>
    // Read before and after a scan, the difference is the new regulators.
    // Returns [] when the page has no such list.
    function readScanDeviceList() {
        const out = [];
        document.querySelectorAll('#content li').forEach((li) => {
            const txt = (li.textContent || '').replace(/\s+/g, ' ').trim();
            const m = txt.match(/^(\S+)\s+-\s+(.+?)\s*\(\s*([^()]+?)\s*\)$/);
            if (m) out.push({ key: m[1] + '|' + m[3], label: m[1] + ' ' + m[2] });
            else if (/^\S+\s+-\s+\S/.test(txt)) out.push({ key: txt, label: txt });
        });
        return out;
    }
    function ts() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    function log(...a) {
        const line = '[' + ts() + '] ' + a.map(x =>
            typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
        console.log('[AK3]', ...a);
        const arr = GM_getValue(LOG_KEY, []);
        arr.push(line);
        while (arr.length > 1500) arr.shift();
        GM_setValue(LOG_KEY, arr);
        renderDebugPanel();
    }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // waitForText that logs only the total elapsed time once the text appears.
    function waitForTextLogged(selector, text, opts, label) {
        const timeout = (opts && opts.timeout) || 30000;
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                if (_abortRequested) return reject(new Error(ABORT_MSG));
                const el = document.querySelector(selector);
                if (el && el.textContent.includes(text)) {
                    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
                    log((label || ('waited for "' + text + '"')) + ' — done in ' + elapsed + 's');
                    return resolve(el);
                }
                if (Date.now() - start > timeout) return reject(new Error('timeout text: ' + text));
                setTimeout(tick, 500);
            };
            tick();
        });
    }

    // Click the visible #ipSave button repeatedly until either #message contains
    // "IPer oppdatert" or we run out of attempts. The button can re-render after
    // each test/click, so we re-query every iteration. Returns true on success.
    async function clickIpSaveUntilConfirmed(maxAttempts, label) {
        for (let i = 1; i <= maxAttempts; i++) {
            if (_abortRequested) return false;
            const btn = findVisibleIpSave();
            if (!btn) {
                log((label || 'ipSave click') + ' — attempt ' + i + '/' + maxAttempts + ': button not visible, polling 5s');
                const reappeared = await waitForIpSaveButton(5000, 'ipSave re-find for click ' + i);
                if (!reappeared) continue;
            }
            const target = findVisibleIpSave();
            if (!target) continue;
            enableButton(target);
            try { target.scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
            await sleep(150);
            // Attempts 1–2: one native click. 3–4: add the synthetic MouseEvent
            // and the jQuery trigger. 5+: also submit the enclosing form, if any
            // — dead where #ipSave sits outside the form (plant 10232), a page
            // reload (pausing the run) where it does not.
            clickEl(target, (label || 'Lagre ip-adresser') + ' (click ' + i + '/' + maxAttempts + ')');
            if (i >= 3) { clickSynthetic(target); clickJQuery(target); }
            if (i >= 5) {
                try {
                    const form = target.closest('form');
                    if (form && typeof form.requestSubmit === 'function') form.requestSubmit(target);
                    else if (form) form.submit();
                } catch (e) { log('ipSave form submit fallback: ' + e.message); }
            }
            // Wait briefly for confirmation between clicks; total wait grows over attempts.
            const perClickWait = 4000;
            const start = Date.now();
            while (Date.now() - start < perClickWait) {
                const msg = document.querySelector('#message');
                if (msg && msg.textContent.includes('IPer oppdatert')) {
                    log((label || 'ipSave click') + ' — confirmed after ' + i + ' click(s)');
                    noteStep('ipconfig', { saveClicks: i });
                    return true;
                }
                await sleep(250);
            }
            log((label || 'ipSave click') + ' — attempt ' + i + ' did not confirm yet, will retry');
        }
        return false;
    }

    // True when the remoteIp input has the 'invalid' class (red border on the
    // page) — a fast indicator that the connection test failed and we should
    // try again with HTTPS off instead of waiting for the Save button.
    function isRemoteIpInvalid() {
        const el = document.querySelector('input#remoteIp');
        return !!(el && el.classList && el.classList.contains('invalid'));
    }

    // Wait for either the visible Save button OR remoteIp.invalid, whichever
    // comes first. Returns { kind: 'save', el } | { kind: 'invalid' } | { kind: 'timeout' }.
    function waitForSaveOrInvalid(totalMs, label) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                if (_abortRequested) return resolve({ kind: 'timeout' });
                const el = findVisibleIpSave();
                if (el) {
                    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
                    log((label || 'save/invalid watch') + ' — Save button found in ' + elapsed + 's');
                    return resolve({ kind: 'save', el });
                }
                if (isRemoteIpInvalid()) {
                    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
                    log((label || 'save/invalid watch') + ' — remoteIp marked invalid after ' + elapsed + 's');
                    return resolve({ kind: 'invalid' });
                }
                const now = Date.now();
                if (now - start > totalMs) {
                    log((label || 'save/invalid watch') + ' — timed out after ' + ((now - start) / 1000).toFixed(1) + 's');
                    return resolve({ kind: 'timeout' });
                }
                setTimeout(tick, 250);
            };
            tick();
        });
    }

    function findVisibleIpSave() {
        // There can be more than one #ipSave in the DOM (templates, hidden forms).
        // Pick a visible one, preferring the one whose inline style indicates
        // pointer-events:auto / opacity:1 (the "ready to click" state shown after
        // a successful Test tilkobling).
        const all = document.querySelectorAll('button#ipSave, #ipSave');
        let firstVisible = null;
        for (const el of all) {
            if (el.tagName.toLowerCase() !== 'button') continue;
            if (el.offsetParent === null) continue; // hidden
            const cs = el.style;
            if (cs && cs.pointerEvents === 'auto' && cs.opacity === '1') return el;
            if (!firstVisible) firstVisible = el;
        }
        return firstVisible;
    }
    function waitForIpSaveButton(totalMs, label) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                if (_abortRequested) return resolve(null);
                const el = findVisibleIpSave();
                if (el) {
                    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
                    log((label || 'ipSave button search') + ' — found in ' + elapsed + 's (' + describe(el) + ')');
                    return resolve(el);
                }
                const now = Date.now();
                if (now - start > totalMs) {
                    const elapsed = ((now - start) / 1000).toFixed(1);
                    log((label || 'ipSave button search') + ' — gave up after ' + elapsed + 's');
                    return resolve(null);
                }
                setTimeout(tick, 250);
            };
            tick();
        });
    }

    function describe(el) {
        if (!el) return '<null>';
        const txt = (el.value || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const id  = el.id ? '#' + el.id : '';
        const cls = el.className && typeof el.className === 'string'
            ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
        return (txt ? '"' + txt + '" ' : '') + el.tagName.toLowerCase() + id + cls;
    }
    // One native click. Every listener type (addEventListener, on*, jQuery)
    // sees it; the only element that ignores it is a disabled one, which is
    // what enableButton() is for. Firing a synthetic MouseEvent and a jQuery
    // trigger on top — the 7.x–9.1 strategy — ran each handler three times on
    // ak3_setup: three partial loads per tab click (racing this script's DOM
    // reads), three scan iframes per "Scan anlegg", two copy/activate requests.
    // Those strategies survive only as escalation in clickVerified().
    function clickEl(el, label) {
        log('Click → ' + (label || describe(el)));
        try { el.click(); } catch (e) {}
    }
    function clickSynthetic(el) {
        try {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (e) {}
    }
    function clickJQuery(el) {
        try {
            const jq = window.jQuery || window.$;
            if (jq && typeof jq === 'function') jq(el).trigger('click');
        } catch (e) {}
    }
    // Click, then wait up to `ms` for effect() to become true. If it does not,
    // escalate to a synthetic MouseEvent and then a jQuery trigger, each with
    // the same wait. Returns true once the effect was seen.
    async function clickVerified(el, label, effect, ms) {
        const waitMs = ms || 1500;
        const name = label || describe(el);
        const seen = async () => {
            const start = Date.now();
            while (Date.now() - start < waitMs) {
                try { if (effect()) return true; } catch (e) {}
                if (_abortRequested) return false;
                await sleep(100);
            }
            try { return !!effect(); } catch (e) { return false; }
        };
        clickEl(el, label);
        if (await seen()) return true;
        if (_abortRequested) return false;
        log('No effect after native click on ' + name + ' — retrying with a synthetic MouseEvent');
        clickSynthetic(el);
        if (await seen()) return true;
        if (_abortRequested) return false;
        log('Still no effect — retrying via jQuery trigger');
        clickJQuery(el);
        if (await seen()) return true;
        log('WARNING: no visible effect from any click strategy on ' + name);
        return false;
    }
    // Put a checkbox into a known state. clickEl() must not be used on
    // checkboxes: each of its three click strategies toggles the box, so the
    // end state would depend on how many of them fire. One native click (the
    // page's handlers run once), then verify and force-set as a fallback.
    function setCheckbox(el, want, label) {
        if (!el) return false;
        const name = label || describe(el);
        if (el.checked !== want) {
            log('Checkbox → ' + (want ? 'on' : 'off') + ': ' + name);
            try { el.click(); } catch (e) {}
        }
        if (el.checked !== want) {
            el.checked = want;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('click',  { bubbles: true }));
            try {
                const jq = window.jQuery || window.$;
                if (jq && typeof jq === 'function') jq(el).trigger('change');
            } catch (e) {}
            log('Checkbox forced ' + (want ? 'on' : 'off') + ' (click did not stick): ' + name);
        }
        return el.checked === want;
    }

    // ---------- AK3 mode via direct SQL API (replaces pang.qxs round-trip) ----------
    function gmPost(url, body) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST', url: url,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Caller': X_CALLER,
                    'X-Run-Id': _runId
                },
                data: body,
                onload: (r) => {
                    try { resolve(JSON.parse(r.responseText)); }
                    catch (e) { reject(new Error('Bad JSON: ' + r.responseText.slice(0, 200))); }
                },
                onerror: () => reject(new Error('Network error: ' + url)),
                ontimeout: () => reject(new Error('Timeout: ' + url))
            });
        });
    }

    async function setAk3Mode(plantId, mode) {
        // mode: 'ScannerMode' (timeout=100, interval=400) or 'StandardMode' (timeout=10, interval=4000)
        const values = mode === 'ScannerMode'
            ? { timeout: '100', interval: '400' }
            : { timeout: '10',  interval: '4000' };
        const sql =
            "UPDATE `iw_plant_server3`.`iw_sys_plant_settings` " +
            "SET `value` = CASE " +
            "WHEN `setting` = 'packet_timeout' THEN '" + values.timeout + "' " +
            "WHEN `setting` = 'packet_interval' THEN '" + values.interval + "' " +
            "ELSE `value` END, `row_date` = NOW() " +
            "WHERE `owner` = 'AK3' " +
            "AND `setting` IN ('packet_timeout', 'packet_interval');";
        ensureRunIdForPlant(plantId);
        log('SQL: set AK3 ' + mode + ' for plant ' + plantId +
            ' (packet_timeout=' + values.timeout + ', packet_interval=' + values.interval + ')');
        const params = new URLSearchParams();
        params.append('plant_id', String(plantId));
        params.append('sql_command', sql);
        const data = await gmPost('http://toolbox.iwmac.local:8505/plant-sql/', params.toString());
        if (!data || !data.success) {
            throw new Error('AK3 mode update failed: ' + JSON.stringify(data).slice(0, 200));
        }
        log('AK3 mode set to ' + mode + ' OK');
        try { await logPmaLocal(plantId); }
        catch (e) { log('pma_local log failed (non-fatal): ' + e.message); }
    }

    // Best-effort revert used by every stop path (failure, abort, user decline,
    // completion). Never throws: a failed revert is logged loudly instead, so
    // the caller can still clear state and tell the user.
    async function revertToStandardMode(plantId) {
        try {
            await setAk3Mode(plantId, 'StandardMode');
            return true;
        } catch (e) {
            log('WARNING: failed to revert to StandardMode: ' + e.message +
                ' — packet_timeout/packet_interval may still be at ScannerMode values!');
            return false;
        }
    }

    // pma_local is logged once per run: the in-memory set covers this page
    // session, the `pmaLogged` flag in the saved state covers resumes after a
    // reload (setAk3Mode runs again on every resume).
    const _pmaLocalLogged = new Set();
    async function logPmaLocal(plantId) {
        ensureRunIdForPlant(plantId);
        const saved = getState();
        if (_pmaLocalLogged.has(String(plantId)) || (saved && saved.pmaLogged)) {
            log('pma_local already logged for this run, skipping');
            return;
        }
        _pmaLocalLogged.add(String(plantId));
        const payload = [{
            jsonrpc: '2.0', method: 'log',
            params: { plant_id: String(plantId), action: 'pma_local' },
            id: 0
        }];
        await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'http://tools.iwmac.local/services/pang/actions.php',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Accept': 'text/javascript, text/html, application/xml, text/xml, */*',
                    'X-Caller': X_CALLER,
                    'X-Run-Id': _runId
                },
                data: JSON.stringify(payload),
                onload: (r) => {
                    try {
                        const d = JSON.parse(r.responseText);
                        if (d && d.jsonrpc === '2.0' && d.result === true) {
                            log('pma_local logged');
                            const cur = getState();
                            if (cur) setState({ ...cur, pmaLogged: true });
                            resolve();
                        }
                        else reject(new Error('pma_local non-success: ' + r.responseText.slice(0, 200)));
                    } catch (e) { reject(new Error('pma_local bad JSON')); }
                },
                onerror: () => reject(new Error('pma_local network error'))
            });
        });
    }

    function injectDebugPanel() {
        if (document.getElementById('ak3-debug-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'ak3-debug-panel';
        Object.assign(panel.style, {
            position: 'fixed', top: '10px', right: '10px', width: '380px',
            maxHeight: '70vh', zIndex: 999998, background: 'rgba(17,24,39,.95)',
            color: '#e5e7eb', font: '11px/1.4 monospace',
            border: '1px solid #374151', borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,.4)', display: 'flex',
            flexDirection: 'column'
        });
        panel.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;' +
            'padding:6px 8px;background:#1f2937;border-radius:6px 6px 0 0;">' +
            '<strong style="color:#10b981">AK3 Debug</strong>' +
            '<span>' +
            '<button id="ak3-debug-resume" title="Resume the saved run at its current step" ' +
            'style="margin-right:4px;cursor:pointer;background:#16a34a;color:#fff;border:none;' +
            'padding:2px 8px;border-radius:3px;font-weight:700;">▶ Resume</button>' +
            '<button id="ak3-debug-abort" title="Stop the run: AK3 back to StandardMode, saved run cleared" ' +
            'style="margin-right:4px;cursor:pointer;background:#b45309;color:#fff;border:none;' +
            'padding:2px 8px;border-radius:3px;font-weight:700;">■ Abort</button>' +
            '<button id="ak3-debug-clear" style="margin-right:4px;cursor:pointer;' +
            'background:#374151;color:#fff;border:none;padding:2px 6px;border-radius:3px;">clear</button>' +
            '<button id="ak3-debug-toggle" style="margin-right:4px;cursor:pointer;background:#374151;color:#fff;' +
            'border:none;padding:2px 6px;border-radius:3px;">−</button>' +
            '<button id="ak3-debug-close" title="Close debug window" ' +
            'style="cursor:pointer;background:#dc2626;color:#fff;border:none;' +
            'padding:4px 12px;border-radius:3px;font-weight:700;font-size:14px;">× Close</button>' +
            '</span></div>' +
            '<pre id="ak3-debug-body" style="margin:0;padding:8px;overflow:auto;' +
            'flex:1;white-space:pre-wrap;word-break:break-word;"></pre>';
        document.body.appendChild(panel);
        panel.querySelector('#ak3-debug-clear').onclick = () => {
            GM_setValue(LOG_KEY, []);
            renderDebugPanel();
        };
        const body = panel.querySelector('#ak3-debug-body');
        panel.querySelector('#ak3-debug-toggle').onclick = (e) => {
            const hidden = body.style.display === 'none';
            body.style.display = hidden ? 'block' : 'none';
            e.target.textContent = hidden ? '−' : '+';
        };
        panel.querySelector('#ak3-debug-close').onclick = () => {
            GM_setValue(PANEL_CLOSED_KEY, true);
            panel.remove();
        };
        panel.querySelector('#ak3-debug-resume').onclick = () => {
            if (TAB_PLANT_ID) resumeRun(TAB_PLANT_ID);
        };
        panel.querySelector('#ak3-debug-abort').onclick = () => {
            if (!TAB_PLANT_ID) return;
            if (confirm('[AK3] Abort Auto Scan for plant ' + TAB_PLANT_ID + '?\n\n' +
                        'AK3 goes back to StandardMode and the saved run is cleared.')) abortRun(TAB_PLANT_ID);
        };
        renderDebugPanel();
        refreshControls();
    }
    // Keep the menu button label and the panel's Resume / Abort buttons in step
    // with the saved state and whether a loop is running in this tab.
    function refreshControls() {
        const s = getState();
        const li = document.getElementById('ak3-autoscan');
        if (li) li.textContent = _running ? '⏳ Auto Scan running…' : (s ? '▶ Resume Auto Scan' : '▶ Auto Scan');
        const resume = document.getElementById('ak3-debug-resume');
        const abort  = document.getElementById('ak3-debug-abort');
        if (resume) resume.style.display = (s && !_running) ? '' : 'none';
        if (abort)  abort.style.display  = s ? '' : 'none';
    }

    // ---------- Completion card ----------
    // Replaces the bare alert(): per-step timings and results, the IPs used,
    // DB and scan outcome, the AK3 mode, a Copy-summary button, plus a title
    // prefix and a desktop notification so a background tab still shows it.
    const STEP_ORDER  = ['dbcheck', 'ipconfig', 'scan', 'default_links', 'copyplant', 'activate'];
    const STEP_LABELS = { dbcheck: 'DB check', ipconfig: 'IP config', scan: 'Scan',
                          default_links: 'Default links', copyplant: 'Copy to plant', activate: 'Activate' };
    function fmtDur(ms) {
        if (!Number.isFinite(ms) || ms < 0) return '?';
        const total = Math.round(ms / 1000);
        const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
        return (h ? h + 'h ' : '') + ((h || m) ? m + 'm ' : '') + sec + 's';
    }
    function fmtClock(t) {
        if (!t) return '?';
        const d = new Date(t), p = (n) => String(n).padStart(2, '0');
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    function stepResult(step, st) {
        if (!st) return 'not recorded';
        const parts = [];
        if (step === 'dbcheck') {
            parts.push(st.created ? 'iw_ak3_scanner created'
                     : (st.server3Ok && st.scannerOk) ? 'both databases present' : 'checked');
            if (st.created && st.message) parts.push(st.message);
        } else if (step === 'ipconfig') {
            if (st.localIp)  parts.push('server ' + st.localIp + (st.localSource === 'page' ? '' : ' (default)'));
            if (st.remoteIp) parts.push('AK-SM850 ' + st.remoteIp + (st.remoteSource === 'page' ? '' : ' (default)'));
            if (st.transport) parts.push(st.transport + (st.testAttempts > 1 ? ' after ' + st.testAttempts + ' tests' : ''));
            if (st.manual) parts.push('fixed manually');
            if (!parts.length) parts.push(st.message || 'saved');
        } else if (step === 'scan') {
            if (st.scanStartedAt && st.scanEndedAt) parts.push('scanned in ' + fmtDur(st.scanEndedAt - st.scanStartedAt));
            if (typeof st.devicesAfter === 'number') {
                parts.push(st.devicesAfter + ' regulator' + (st.devicesAfter === 1 ? '' : 's'));
                if (st.newCount > 0) {
                    const names = st.newDevices || [];
                    parts.push(st.newCount + ' new: ' + names.join(', ') + (st.newCount > names.length ? ', …' : ''));
                } else {
                    parts.push('no new regulators added');
                }
                if (st.goneCount > 0) parts.push(st.goneCount + ' no longer listed');
            } else {
                parts.push(st.report || (st.lastPercent != null ? st.lastPercent + '%' : 'done'));
            }
        } else if (step === 'copyplant') {
            // The page says "Database kopiert. Husk å restart pc!"; the reminder
            // is shown on its own line as RESTART_REMINDER instead.
            parts.push((st.message || 'copied').replace(/\s*Husk å restart pc!?\s*/i, '').trim() || 'copied');
            if (st.confirmed) parts.push('dialog confirmed');
        } else {
            parts.push(st.message || 'done');
        }
        return parts.join(' · ');
    }
    function summaryText(plantId, s) {
        const lines = [];
        lines.push('AK3 Scan Completed — plant ' + plantId + ' (' + location.host + ')');
        lines.push('Started ' + fmtClock(s.startedAt) + ', finished ' + fmtClock(s.finishedAt) +
                   ', total ' + fmtDur(s.finishedAt - s.startedAt));
        lines.push('AK3 mode: ' + (s.reverted === false
            ? 'WARNING — StandardMode revert failed, check packet_timeout / packet_interval'
            : 'StandardMode restored'));
        lines.push('Run ' + (s.runId || '?') + (s.resumes ? ', resumed ' + s.resumes + '×' : ''));
        lines.push('Next: ' + RESTART_REMINDER);
        for (const step of STEP_ORDER) {
            const st = (s.steps || {})[step];
            const dur = st && st.startedAt && st.endedAt ? fmtDur(st.endedAt - st.startedAt) : '?';
            lines.push('- ' + STEP_LABELS[step] + ': ' + dur + ' — ' + stepResult(step, st));
        }
        return lines.join('\n');
    }
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const RESTART_REMINDER = 'Remember to restart IWMAC Escape!';
    // Clipboard on an http:// page: navigator.clipboard does not exist outside
    // secure contexts, so prefer GM_setClipboard, then the legacy execCommand
    // path (needs a user gesture, which the button click is), then the API.
    function copyText(text) {
        try {
            if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return Promise.resolve(true); }
        } catch (e) {}
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0' });
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            if (ok) return Promise.resolve(true);
        } catch (e) {}
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text).then(() => true, () => false);
            }
        } catch (e) {}
        return Promise.resolve(false);
    }
    function showCompletionCard(plantId, s) {
        const total = fmtDur(s.finishedAt - s.startedAt);
        const modeOk = s.reverted !== false;
        try {
            const old = document.getElementById('ak3-complete-backdrop');
            if (old) old.remove();
            const cell = 'padding:6px 8px;border-top:1px solid #1f2937;';
            const rows = STEP_ORDER.map((step) => {
                const st = (s.steps || {})[step];
                const dur = st && st.startedAt && st.endedAt ? fmtDur(st.endedAt - st.startedAt) : '—';
                return '<tr><td style="' + cell + 'white-space:nowrap;font-weight:600;">' + esc(STEP_LABELS[step]) + '</td>' +
                       '<td style="' + cell + 'white-space:nowrap;color:#9ca3af;">' + esc(dur) + '</td>' +
                       '<td style="' + cell + 'word-break:break-word;">' + esc(stepResult(step, st)) + '</td></tr>';
            }).join('');
            const el = document.createElement('div');
            el.id = 'ak3-complete-backdrop';
            el.setAttribute('style', 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);' +
                'display:flex;align-items:center;justify-content:center;font:13px/1.45 system-ui,"Segoe UI",sans-serif;');
            el.innerHTML =
                '<div id="ak3-complete-card" role="dialog" aria-labelledby="ak3-complete-title" ' +
                'style="width:min(600px,94vw);max-height:90vh;overflow:auto;background:#111827;color:#e5e7eb;' +
                'border:1px solid #374151;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.6);">' +
                  '<div style="display:flex;align-items:center;gap:14px;padding:16px 20px;background:#16a34a;color:#fff;border-radius:10px 10px 0 0;">' +
                    '<div style="font-size:30px;line-height:1;">✔</div>' +
                    '<div><div id="ak3-complete-title" style="font-size:19px;font-weight:700;">AK3 Scan Completed</div>' +
                    '<div style="opacity:.92;">Plant ' + esc(plantId) + ' · ' + esc(location.host) + '</div></div>' +
                  '</div>' +
                  '<div style="padding:14px 20px 6px;">' +
                    '<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin-bottom:12px;">' +
                      '<span style="color:#9ca3af;">Duration</span><span><b>' + esc(total) + '</b> · ' +
                        esc(fmtClock(s.startedAt)) + ' → ' + esc(fmtClock(s.finishedAt)) + '</span>' +
                      '<span style="color:#9ca3af;">AK3 mode</span><span style="color:' + (modeOk ? '#34d399' : '#fbbf24') + ';font-weight:600;">' +
                        (modeOk ? 'StandardMode restored ✔'
                                : 'WARNING — StandardMode revert failed, check packet_timeout / packet_interval manually') + '</span>' +
                      '<span style="color:#9ca3af;">Run</span><span style="font-family:monospace;">' + esc(String(s.runId || '?').slice(0, 8)) + '</span>' +
                      (s.resumes ? '<span style="color:#9ca3af;">Resumed</span><span>' + esc(s.resumes) + '×</span>' : '') +
                      '<span style="color:#9ca3af;">Next</span><span style="color:#fbbf24;font-weight:700;">⚠ ' + esc(RESTART_REMINDER) + '</span>' +
                    '</div>' +
                    '<table style="width:100%;border-collapse:collapse;">' +
                      '<thead><tr style="color:#9ca3af;text-align:left;"><th style="padding:4px 8px;font-weight:600;">Step</th>' +
                      '<th style="padding:4px 8px;font-weight:600;">Time</th><th style="padding:4px 8px;font-weight:600;">Result</th></tr></thead>' +
                      '<tbody>' + rows + '</tbody></table>' +
                    '<pre id="ak3-complete-logview" style="display:none;margin:12px 0 0;padding:8px;max-height:40vh;overflow:auto;' +
                      'background:#0b1220;border:1px solid #374151;border-radius:6px;font:11px/1.4 monospace;white-space:pre-wrap;word-break:break-word;"></pre>' +
                  '</div>' +
                  '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px 16px;">' +
                    '<button id="ak3-complete-copylog" style="display:none;cursor:pointer;background:#374151;color:#fff;border:none;padding:8px 14px;border-radius:6px;">Copy log</button>' +
                    '<button id="ak3-complete-copy" style="cursor:pointer;background:#374151;color:#fff;border:none;padding:8px 14px;border-radius:6px;">Copy summary</button>' +
                    '<button id="ak3-complete-log" style="cursor:pointer;background:#374151;color:#fff;border:none;padding:8px 14px;border-radius:6px;">Show log</button>' +
                    '<button id="ak3-complete-close" style="cursor:pointer;background:#16a34a;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-weight:700;">Close</button>' +
                  '</div>' +
                '</div>';
            document.body.appendChild(el);
            const origTitle = document.title;
            document.title = '✔ AK3 done · ' + plantId;
            const onKey = (e) => { if (e.key === 'Escape') close(); };
            const close = () => {
                el.remove();
                document.removeEventListener('keydown', onKey);
                if (document.title.startsWith('✔ AK3 done')) document.title = origTitle;
            };
            document.addEventListener('keydown', onKey);
            el.querySelector('#ak3-complete-close').onclick = close;
            // The full run log, inside the card (the debug panel sits under the
            // backdrop, so re-opening it there would look like nothing happened).
            const logView = el.querySelector('#ak3-complete-logview');
            const logBtn = el.querySelector('#ak3-complete-log');
            const copyLogBtn = el.querySelector('#ak3-complete-copylog');
            const fullLog = () => GM_getValue(LOG_KEY, []).join('\n');
            logBtn.onclick = () => {
                const show = logView.style.display === 'none';
                if (show) { logView.textContent = fullLog(); logView.scrollTop = logView.scrollHeight; }
                logView.style.display = show ? 'block' : 'none';
                copyLogBtn.style.display = show ? '' : 'none';
                logBtn.textContent = show ? 'Hide log' : 'Show log';
            };
            const copyWith = (btn, idle, text) => {
                copyText(text).then((ok) => {
                    btn.textContent = ok ? 'Copied ✔' : 'Copy failed';
                    setTimeout(() => { btn.textContent = idle; }, 2000);
                });
            };
            el.querySelector('#ak3-complete-copy').onclick = (e) => copyWith(e.target, 'Copy summary', summaryText(plantId, s));
            copyLogBtn.onclick = (e) => copyWith(e.target, 'Copy log', 'AK3 Auto Scan log — plant ' + plantId + '\n' + fullLog());
            el.querySelector('#ak3-complete-close').focus();
        } catch (e) {
            log('Completion card failed to render (' + e.message + ') — falling back to alert');
            alert('AK3 Scan Completed ✔\nPlant ' + plantId + ' — ' + total +
                  (modeOk ? '' : '\n\nWARNING: could not set StandardMode — check packet_timeout / packet_interval manually!'));
        }
        try {
            if (typeof GM_notification === 'function') {
                GM_notification({
                    title: 'AK3 Scan Completed — plant ' + plantId,
                    text: 'Finished in ' + total + '. ' + (modeOk ? 'AK3 is back in StandardMode.' : 'WARNING: StandardMode revert failed!') +
                          ' ' + RESTART_REMINDER,
                    timeout: 0
                });
            }
        } catch (e) {}
    }
    function renderDebugPanel() {
        const body = document.getElementById('ak3-debug-body');
        if (!body) return;
        const arr = GM_getValue(LOG_KEY, []);
        body.textContent = arr.join('\n');
        body.scrollTop = body.scrollHeight;
    }

    function waitFor(selector, { timeout = 30000 } = {}) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                if (_abortRequested) return reject(new Error(ABORT_MSG));
                const el = document.querySelector(selector);
                if (el) return resolve(el);
                if (Date.now() - start > timeout) return reject(new Error('timeout: ' + selector));
                setTimeout(tick, 200);
            };
            tick();
        });
    }
    function waitForText(selector, text, { timeout = 30000 } = {}) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                if (_abortRequested) return reject(new Error(ABORT_MSG));
                const el = document.querySelector(selector);
                if (el && el.textContent.includes(text)) return resolve(el);
                if (Date.now() - start > timeout) return reject(new Error('timeout text: ' + text));
                setTimeout(tick, 200);
            };
            tick();
        });
    }
    // Terminal stop: clear the saved run, then tell the user. Callers revert
    // AK3 to StandardMode *before* calling this — alert() is modal and would
    // hold the revert until the dialog is dismissed. Does not throw.
    function stopRun(msg) {
        clearState();
        log('STOPPED: ' + msg);
        alert('[AK3] STOPPED: ' + msg);
    }
    // "OK" as a whole word and not negated — "IKKE OK" / "NOT OK" also contain
    // the substring "OK", which is what a plain includes('OK') would match.
    function isOkStatus(txt) {
        const t = String(txt || '');
        return /(^|[^A-Za-z])OK(?![A-Za-z])/.test(t) && !/\b(ikke|not)\s+OK\b/i.test(t);
    }
    function setInput(el, value) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('keyup',  { bubbles: true }));
        el.dispatchEvent(new Event('blur',   { bubbles: true }));
        try {
            const jq = window.jQuery || window.$;
            if (jq && typeof jq === 'function') jq(el).trigger('input').trigger('change').trigger('keyup').trigger('blur');
        } catch (e) {}
    }
    function enableButton(el) {
        if (!el) return;
        try {
            el.disabled = false;
            el.removeAttribute('disabled');
            el.removeAttribute('aria-disabled');
            el.classList.remove('disabled');
            el.style.pointerEvents = 'auto';
            el.style.opacity = '1';
        } catch (e) {}
    }
    // Click a menu tab and wait for #content to be replaced by the tab's
    // partial. A hidden probe appended to the old content disappears when the
    // page's $('#content').load() swaps the HTML — even when the same tab is
    // reloaded — which is the one reliable "the click registered" signal this
    // page gives. Callers still waitFor() the elements they need.
    async function clickTab(id) {
        const li = await waitFor('li#' + id);
        const content = document.getElementById('content');
        let probe = null;
        if (content) {
            probe = document.createElement('span');
            probe.className = 'ak3-tab-probe';
            probe.style.display = 'none';
            content.appendChild(probe);
        }
        const loaded = () => !probe || !probe.isConnected;
        await clickVerified(li, 'Tab: ' + (li.textContent || id).trim(), loaded, 6000);
        if (probe && probe.isConnected) probe.remove();
        await sleep(150);
    }

    // Read an IPv4 out of the "<h2>... config satt til <em>...</em></h2>" hint,
    // matching by the title prefix ('Server config satt til' or
    // 'AK-SM850 config satt til'). Handles both bare IPs and IPs embedded in
    // URLs (e.g. "http://10.230.4.126/html/xml.cgi"). Returns null if absent.
    function detectConfiguredIp(titlePrefix) {
        const h2s = document.querySelectorAll('#content h2');
        for (const h of h2s) {
            if (!h.textContent.includes(titlePrefix)) continue;
            const em = h.querySelector('em');
            const src = (em ? em.textContent : h.textContent) || '';
            const m = src.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
            if (m) return m[1];
        }
        return null;
    }

    // ---------- Inject Auto Scan button into side menu ----------
    function injectMenuButton() {
        const menu = document.getElementById('mainmenu');
        if (!menu || document.getElementById('ak3-autoscan')) return;
        const li = document.createElement('li');
        li.id = 'ak3-autoscan';
        li.textContent = '▶ Auto Scan';
        Object.assign(li.style, {
            background: '#16a34a', color: '#fff', fontWeight: '700',
            cursor: 'pointer', padding: '8px', marginBottom: '6px',
            borderRadius: '4px', textAlign: 'center'
        });
        li.onclick = async () => {
            const plantId = getPlantIdFromHost();
            if (!plantId) return alert('No plant id in host');
            if (_running) {
                if (confirm('[AK3] Auto Scan is running for plant ' + plantId + '.\n\n' +
                            'Abort it now? (AK3 goes back to StandardMode, the saved run is cleared)')) {
                    await abortRun(plantId);
                }
                return;
            }
            const saved = getState();
            if (saved && saved.plantId === plantId) {
                const ageMin = Math.round((Date.now() - (saved.ts || 0)) / 60000);
                if (confirm('[AK3] A saved Auto Scan for plant ' + plantId + ' is paused at step "' +
                            saved.step + '" (' + ageMin + ' min ago).\n\n' +
                            'OK = resume it\nCancel = start over from the beginning')) {
                    return resumeRun(plantId);
                }
            }
            await startRun(plantId);
        };
        menu.insertBefore(li, menu.firstChild);
        refreshControls();
    }

    // ---------- Run control: start / resume / abort ----------
    async function startRun(plantId) {
        _abortRequested = false;
        GM_setValue(LOG_KEY, []);
        GM_deleteValue(PANEL_CLOSED_KEY);
        injectDebugPanel();
        _runId = makeUuid();
        _runIdPlant = String(plantId);
        log('Auto Scan started for plant ' + plantId + ' (run ' + _runId + ')');
        GM_setValue(SUMMARY_KEY, { startedAt: Date.now(), runId: _runId, resumes: 0, steps: {} });
        // State first, so the pma_local flag and the trace id are persisted by
        // the ScannerMode call; on failure stopRun() clears it again.
        setState({ plantId, step: 'dbcheck' });
        try {
            await setAk3Mode(plantId, 'ScannerMode');
        } catch (e) {
            stopRun('Failed to set ScannerMode: ' + e.message);
            return;
        }
        runAk3Setup();
    }

    // Nothing resumes by itself on page load (a reload loop in an early
    // version made that a deliberate choice). A saved run is offered for
    // resumption via the panel / menu button, and each step may be resumed at
    // most MAX_RESUMES_PER_STEP times before the run is stopped instead.
    async function resumeRun(plantId) {
        if (_running) return;
        const saved = getState();
        if (!saved || saved.plantId !== plantId) return alert('[AK3] No saved run to resume for plant ' + plantId);
        _abortRequested = false;
        GM_deleteValue(PANEL_CLOSED_KEY);
        injectDebugPanel();
        const resumes = (saved.resumes || 0) + 1;
        if (resumes > MAX_RESUMES_PER_STEP) {
            log('Step "' + saved.step + '" has been resumed ' + (resumes - 1) +
                ' times without advancing — stopping to avoid a reload loop');
            await revertToStandardMode(plantId);
            stopRun('Step "' + saved.step + '" keeps restarting after page reloads. Check the plant manually.');
            return;
        }
        if (saved.runId) { _runId = saved.runId; _runIdPlant = String(plantId); }
        log('Resuming Auto Scan at step "' + saved.step + '" (resume ' + resumes + '/' + MAX_RESUMES_PER_STEP + ')');
        updateSummary((s) => {
            s.startedAt = s.startedAt || saved.ts || Date.now();
            s.runId = s.runId || _runId;
            s.resumes = (s.resumes || 0) + 1;
        });
        setState({ ...saved, resumes });
        try {
            // Whatever caused the reload may also have reset the AK3 packet
            // settings (creating iw_ak3_scanner does) — re-apply ScannerMode.
            await setAk3Mode(plantId, 'ScannerMode');
        } catch (e) {
            await revertToStandardMode(plantId);
            stopRun('Failed to re-apply ScannerMode on resume: ' + e.message);
            return;
        }
        runAk3Setup();
    }

    async function abortRun(plantId) {
        _abortRequested = true;
        log('Abort requested — reverting AK3 to StandardMode and clearing the saved run');
        await revertToStandardMode(plantId);
        clearState();
        const banner = document.getElementById('ak3-manual-banner');
        if (banner) banner.remove();
        log('Auto Scan aborted for plant ' + plantId);
    }

    // ---------- Main workflow on ak3_setup (step-driven, resumable) ----------
    async function runAk3Setup() {
        const plantId = getPlantIdFromHost();
        if (!plantId) return;
        if (_running) { log('Auto Scan is already running in this tab — ignoring second start'); return; }
        let state = getState();
        if (!state || state.plantId !== plantId) return;
        _running = true;
        refreshControls();

        try {
            while (true) {
                if (_abortRequested) return;
                state = getState();
                if (!state) return;
                log('=== Step: ' + state.step + ' ===');
                stepStarted(state.step);

                if (state.step === 'dbcheck') {
                    log('Opening DB Sjekk tab');
                    await clickTab('databasetest');

                    // Wait for the test-box results to appear in the DOM
                    await waitFor('.test-box', { timeout: 10000 });
                    await sleep(500);

                    // Each database has its own .test-box, server-rendered with
                    // class "ok" or "error". The text is the fallback for page
                    // versions without those classes.
                    const testBoxes = document.querySelectorAll('.test-box');
                    let server3Ok = false;
                    let scannerOk = false;
                    testBoxes.forEach((box) => {
                        const txt = box.textContent || '';
                        const ok = box.classList.contains('ok') ? true
                                 : box.classList.contains('error') ? false
                                 : isOkStatus(txt);
                        if (txt.includes('iw_plant_server3') && ok) server3Ok = true;
                        if (txt.includes('iw_ak3_scanner') && ok) scannerOk = true;
                    });
                    log('DB status — iw_plant_server3: ' + (server3Ok ? 'OK' : 'NOT OK') +
                        ', iw_ak3_scanner: ' + (scannerOk ? 'OK' : 'NOT OK'));

                    if (server3Ok && scannerOk) {
                        log('Both databases OK — skipping creation');
                        noteStep('dbcheck', { server3Ok, scannerOk, created: false });
                    } else {
                        // Wait for the "Lag database" button to appear
                        let dbCreated = false;
                        try {
                            const createBtn = await waitFor('button#create_scan_db', { timeout: 10000 });
                            log('Scanner database missing — clicking "Lag database iw_ak3_scanner"');
                            clickEl(createBtn, 'Lag database iw_ak3_scanner');
                            log('Waiting for "Database opprettet" confirmation');
                            await waitForText('#message', 'Database opprettet', { timeout: 30000 });
                            log('Database created successfully');
                            dbCreated = true;
                        } catch (e) {
                            log('No create button found — continuing anyway');
                        }
                        noteStep('dbcheck', { server3Ok, scannerOk, created: dbCreated, message: msgText() });
                        // Creating iw_ak3_scanner regenerates the AK3 plant settings, which
                        // wipes the ScannerMode packet values (timeout=100/interval=400) set on
                        // Auto-Scan start. Re-apply ScannerMode now so the scan polls fast.
                        if (dbCreated) {
                            log('Re-applying ScannerMode after iw_ak3_scanner creation (DB create resets AK3 packet settings)');
                            await setAk3Mode(plantId, 'ScannerMode');
                            log('ScannerMode re-applied after DB creation');
                        }
                    }

                    await sleep(500);
                    stepDone('dbcheck');
                    setState({ plantId, step: 'ipconfig' });
                }
                else if (state.step === 'ipconfig') {
                    log('Opening IP Config tab');
                    await clickTab('ipconfig');
                    const local  = await waitFor('input#localIp');
                    const remote = await waitFor('input#remoteIp');

                    // Prefer IPs already shown in the page's "config satt til" hints.
                    // Fall back to hardcoded defaults only when no IP is present.
                    const detectedLocal  = detectConfiguredIp('Server config satt til');
                    const detectedRemote = detectConfiguredIp('AK-SM850 config satt til');
                    const localIpToUse   = detectedLocal  || LOCAL_IP;
                    const remoteIpToUse  = detectedRemote || REMOTE_IP;
                    log('localIp '  + (detectedLocal  ? 'detected on page' : 'using default') + ' = ' + localIpToUse);
                    log('remoteIp ' + (detectedRemote ? 'detected on page' : 'using default') + ' = ' + remoteIpToUse);
                    noteStep('ipconfig', {
                        localIp: localIpToUse,   localSource:  detectedLocal  ? 'page' : 'default',
                        remoteIp: remoteIpToUse, remoteSource: detectedRemote ? 'page' : 'default'
                    });
                    setInput(local,  localIpToUse);
                    setInput(remote, remoteIpToUse);

                    log('Waiting for HTTPS checkbox...');
                    const https = await waitFor('input#httpsForm');
                    log('HTTPS checkbox found — checked: ' + https.checked);
                    setCheckbox(https, true, 'HTTPS checkbox');

                    log('Clicking "Test tilkobling til AK-SM850" (HTTPS on)');
                    {
                        // The page's handler disables the button synchronously
                        // while the test runs — the "click registered" signal.
                        const ipFormBtn0 = await waitFor('input#ipForm');
                        enableButton(ipFormBtn0);
                        await clickVerified(ipFormBtn0, 'Test tilkobling til AK-SM850',
                            () => ipFormBtn0.disabled === true, 1500);
                    }
                    // Poll continuously for up to 60s — slow plants can take a
                    // while to render the Save button after the HTTPS test.
                    let saveBtn = null;
                    {
                        const r = await waitForSaveOrInvalid(60000, 'ipSave/invalid after HTTPS test');
                        if (r.kind === 'save') { saveBtn = r.el; noteStep('ipconfig', { transport: 'HTTPS', testAttempts: 1 }); }
                        else if (r.kind === 'invalid') log('remoteIp invalid → HTTPS test failed, will disable HTTPS and retry');
                    }

                    // If Save button still isn't there, HTTPS probably failed the test.
                    // Force HTTPS off, re-click Test tilkobling (up to 5 retries), look again.
                    if (!saveBtn) {
                        log('Save button not visible after double-check — HTTPS test likely failed, disabling HTTPS');
                        const h = await waitFor('input#httpsForm');
                        setCheckbox(h, false, 'HTTPS checkbox');
                        log('HTTPS checkbox now checked=' + h.checked);
                        for (let attempt = 1; attempt <= 5 && !saveBtn; attempt++) {
                            // Short-circuit: maybe the button appeared between the
                            // last poll and now — don't re-submit Test if it's there.
                            saveBtn = findVisibleIpSave();
                            if (saveBtn) { log('ipSave appeared just before retry ' + attempt + ' — skipping re-test'); break; }
                            const ipFormBtn = await waitFor('input#ipForm');
                            enableButton(ipFormBtn);
                            if (ipFormBtn.disabled) log('ipForm still reports disabled after enable');
                            await clickVerified(ipFormBtn,
                                    'Test tilkobling til AK-SM850 (retry ' + attempt + ', HTTPS off)',
                                    () => ipFormBtn.disabled === true, 1500);
                            // NOTE: do NOT call form.submit() here — Test tilkobling is
                            // AJAX-only; submitting the form caused a real POST/navigation
                            // that reloaded the page back to the start of the workflow.
                            const waitMs = attempt === 1 ? 20000 : attempt === 2 ? 25000 : 30000;
                            const r = await waitForSaveOrInvalid(waitMs, 'ipSave/invalid after HTTP retry ' + attempt);
                            if (r.kind === 'save') { saveBtn = r.el; noteStep('ipconfig', { transport: 'HTTP', testAttempts: attempt + 1 }); }
                            else if (r.kind === 'invalid') log('remoteIp invalid on HTTP retry ' + attempt + ' — will retry');
                        }
                    }
                    if (!saveBtn) {
                        saveBtn = await waitForIpSaveButton(15000, 'ipSave final wait');
                        if (!saveBtn) throw new Error('Save button (ipSave) did not appear after test');
                    }
                    log('Save button confirmed present — clicking up to 8 times until IPer oppdatert');
                    let ok = await clickIpSaveUntilConfirmed(8, 'Lagre ip-adresser i scanner database');

                    if (!ok) {
                        log('First save did not confirm — retrying with HTTPS off');
                        noteStep('ipconfig', { transport: 'HTTP', saveRetry: true });
                        const https2 = await waitFor('input#httpsForm');
                        setCheckbox(https2, false, 'HTTPS checkbox');
                        await sleep(500);
                        {
                            const b = await waitFor('input#ipForm');
                            enableButton(b);
                            await clickVerified(b, 'Test tilkobling til AK-SM850 (retry)',
                                () => b.disabled === true, 1500);
                        }
                        // Always go through findVisibleIpSave (via waitForIpSaveButton):
                        // a bare querySelector('#ipSave') can return a hidden template.
                        let saveBtn2 = await waitForIpSaveButton(25000, 'ipSave after save-retry test');
                        if (!saveBtn2) saveBtn2 = await waitForIpSaveButton(15000, 'ipSave after save-retry test (final)');
                        if (saveBtn2) {
                            log('Save button confirmed present (retry) — clicking up to 8 times');
                            ok = await clickIpSaveUntilConfirmed(8, 'Lagre ip-adresser (retry)');
                        } else {
                            log('Save button (ipSave) still not visible — falling through to the manual fallback');
                        }
                        if (!ok) {
                            try {
                                await waitForTextLogged('#message', 'IPer oppdatert', { timeout: 30000 },
                                    'waiting for IPer oppdatert (retry)');
                                log('IP addresses confirmed updated (retry)');
                                ok = true;
                            } catch {}
                        }
                    }
                    if (!ok) {
                        log('Automatic IP setup failed — waiting for user to fix manually');
                        noteStep('ipconfig', { manual: true });
                        // Show a non-blocking banner so the user knows what to do.
                        let banner = document.getElementById('ak3-manual-banner');
                        if (!banner) {
                            banner = document.createElement('div');
                            banner.id = 'ak3-manual-banner';
                            Object.assign(banner.style, {
                                position: 'fixed', top: '10px', left: '50%',
                                transform: 'translateX(-50%)', zIndex: 999999,
                                background: '#f59e0b', color: '#000',
                                padding: '10px 16px', borderRadius: '6px',
                                fontWeight: '700', boxShadow: '0 2px 8px rgba(0,0,0,.3)'
                            });
                            banner.textContent = 'AK3: Set the correct IP addresses manually and click Test tilkobling til AK-SM850 then Lagre ip-adresser i scanner database. Auto Scan is waiting for "IPer oppdatert"...';
                            document.body.appendChild(banner);
                        }
                        // Wait indefinitely for the success message to appear.
                        await waitForText('#message', 'IPer oppdatert', { timeout: 24 * 3600 * 1000 });
                        banner.remove();
                        const cont = confirm('IPer oppdatert ✓\n\nContinue Auto Scan?');
                        if (!cont) {
                            log('User chose not to continue after the manual IP fix — reverting to StandardMode and stopping');
                            await revertToStandardMode(plantId);
                            clearState();
                            return;
                        }
                        ok = true;
                        // Refresh state timestamp so auto-resume stays valid.
                        setState({ plantId, step: 'ipconfig' });
                    }
                    stepDone('ipconfig', { message: msgText() });
                    setState({ plantId, step: 'scan' });
                    await sleep(500);
                }
                else if (state.step === 'ipconfig_wait') {
                    log('Page reloaded during IP config — resuming');
                    setState({ plantId, step: 'ipconfig' });
                }
                else if (state.step === 'scan') {
                    log('Opening Scan tab');
                    await clickTab('scan');
                    await sleep(500);
                    const devicesBefore = readScanDeviceList();
                    log('Scan tab lists ' + devicesBefore.length + ' regulator(s) before this scan');
                    noteStep('scan', { devicesBefore: devicesBefore.length });

                    // The page appends an iframe per "Scan anlegg" click and never
                    // removes old ones, so the newest (last) one is this scan.
                    const scanFrames = () => document.querySelectorAll('#scanWindow iframe, iframe[src*="iframe/scan"]');
                    const getIframeDoc = () => {
                        const frames = scanFrames();
                        const f = frames[frames.length - 1];
                        try { return f && (f.contentDocument || f.contentWindow.document); }
                        catch { return null; }
                    };
                    const readScan = (doc) => {
                        const pct = doc.querySelector('#percent');
                        const doneEl = doc.querySelector('#done');
                        const m = pct && pct.textContent.match(/(\d{1,3})\s*%/);
                        return {
                            percent: m ? parseInt(m[1], 10) : null,
                            done: !!((pct && pct.textContent.includes('100%')) ||
                                     (doneEl && doneEl.offsetParent !== null &&
                                      doneEl.textContent.includes('Scan done')))
                        };
                    };
                    // Whatever the scan window says when it is done (counts, "Scan done").
                    const scanReport = (doc) => {
                        try { return ((doc.body && doc.body.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 160); }
                        catch (e) { return ''; }
                    };
                    // A scan window left from an earlier scan can already read
                    // "100% / Scan done". Remember it, so that old result is not
                    // taken for this scan's completion: the window has to reset
                    // (or be replaced) first.
                    const preDoc = getIframeDoc();
                    const staleDone = !!(preDoc && readScan(preDoc).done);
                    if (staleDone) log('Scan window still shows a finished earlier scan — waiting for it to reset before trusting completion');

                    const scanBtn = await waitFor('input#scanButton');
                    const framesBefore = scanFrames().length;
                    // The handler hides the button and appends the scan iframe.
                    await clickVerified(scanBtn, 'Scan anlegg',
                        () => scanFrames().length > framesBefore || scanBtn.offsetParent === null, 3000);
                    log('Scan started — waiting for completion (up to 2 hours)');
                    noteStep('scan', { scanStartedAt: Date.now() });

                    await new Promise((resolve, reject) => {
                        const start = Date.now();
                        let sawReset = !staleDone;
                        let lastLoggedPct = -10;
                        const tick = () => {
                            if (_abortRequested) return reject(new Error(ABORT_MSG));
                            const doc = getIframeDoc();
                            if (doc) {
                                const r = readScan(doc);
                                if (!sawReset && (doc !== preDoc || !r.done)) sawReset = true;
                                if (sawReset && r.percent !== null && r.percent >= lastLoggedPct + 10) {
                                    lastLoggedPct = r.percent;
                                    log('Scan progress ' + r.percent + '% (' + ((Date.now() - start) / 60000).toFixed(1) + ' min)');
                                }
                                if (sawReset && r.done) {
                                    noteStep('scan', { scanEndedAt: Date.now(), lastPercent: r.percent, report: scanReport(doc) });
                                    return resolve();
                                }
                            }
                            if (Date.now() - start > 7200000) return reject(new Error('scan timeout'));
                            setTimeout(tick, 500);
                        };
                        tick();
                    });
                    log('Scan completed');
                    {
                        const rep = (getSummary().steps.scan || {}).report;
                        if (rep) log('Scan window text: ' + rep);
                    }
                    await sleep(1200);
                    // Re-open the Scan tab: its "tidligere funnet" list now includes
                    // what this scan found — the regulator count and the new ones
                    // for the completion card.
                    let devicesAfter = [];
                    try {
                        await clickTab('scan');
                        await sleep(300);
                        devicesAfter = readScanDeviceList();
                    } catch (e) { log('Could not re-read the Scan tab device list: ' + e.message); }
                    if (devicesAfter.length || devicesBefore.length) {
                        const beforeKeys = new Set(devicesBefore.map((d) => d.key));
                        const afterKeys = new Set(devicesAfter.map((d) => d.key));
                        const added = devicesAfter.filter((d) => !beforeKeys.has(d.key));
                        const gone = devicesBefore.filter((d) => !afterKeys.has(d.key));
                        log('Scan result: ' + devicesAfter.length + ' regulator(s) listed, ' + added.length + ' new' +
                            (added.length ? ' (' + added.map((d) => d.label).join(', ') + ')' : '') +
                            (gone.length ? ', ' + gone.length + ' no longer listed' : ''));
                        stepDone('scan', { devicesAfter: devicesAfter.length, newCount: added.length,
                                           newDevices: added.slice(0, 12).map((d) => d.label), goneCount: gone.length });
                    } else {
                        log('No regulator list found on the Scan tab — the card shows the scan window text instead');
                        stepDone('scan');
                    }
                    setState({ plantId, step: 'default_links' });
                }
                else if (state.step === 'default_links') {
                    log('Opening Default links tab');
                    await clickTab('default_links');
                    log('Waiting for "Sett alle til første med Therm" button');
                    clickEl(await waitFor('button#selectTherm', { timeout: 600000 }),
                            'Sett alle til første med "Therm" i navn');
                    await sleep(600);
                    clickEl(await waitFor('button#save_default_links', { timeout: 600000 }),
                            'Lagre default links');
                    log('Waiting for "Default links oppdatert" confirmation');
                    await waitForText('#message', 'Default links oppdatert', { timeout: 600000 });
                    log('Default links updated');
                    noteStep('default_links', { message: msgText() });
                    log('Waiting for loading message to disappear (up to 1 hour)...');
                    await new Promise((resolve, reject) => {
                        const start = Date.now();
                        const tick = () => {
                            if (_abortRequested) return reject(new Error(ABORT_MSG));
                            const content = document.querySelector('#content');
                            if (!content || !content.textContent.includes('Vennligst vent mens default links laster')) {
                                return resolve();
                            }
                            if (Date.now() - start > 3600000) return reject(new Error('default links loading timeout'));
                            setTimeout(tick, 500);
                        };
                        tick();
                    });
                    log('Loading complete — ready to continue');
                    await sleep(500);
                    stepDone('default_links');
                    setState({ plantId, step: 'copyplant' });
                }
                else if (state.step === 'copyplant') {
                    log('Opening Kopier til anlegg tab');
                    await clickTab('copyplant');
                    log('Waiting for "Kopier og overskriv ALT" button');
                    const copyBtn = await waitFor('button#copy_db', { timeout: 600000 });
                    // The handler disables the button and relabels it "Vennligst vent".
                    await clickVerified(copyBtn, 'Kopier og overskriv ALT',
                        () => copyBtn.disabled === true || /vent/i.test(copyBtn.textContent || ''), 1500);
                    // The confirm dialog may render a moment after the click; a
                    // synchronous querySelector would miss it and the copy would
                    // never be confirmed.
                    let maybeOk = null;
                    try { maybeOk = await waitFor('button.pang-confirm-ok', { timeout: 3000 }); } catch (e) {}
                    if (maybeOk) { clickEl(maybeOk, 'Confirm OK (copy db)'); await sleep(300); }
                    else log('No confirm dialog within 3s — assuming the copy started directly');
                    log('Waiting for "Database kopiert" confirmation');
                    await waitForText('#message', 'Database kopiert', { timeout: 600000 });
                    log('Database copied');
                    stepDone('copyplant', { message: msgText(), confirmed: !!maybeOk });
                    await sleep(500);
                    setState({ plantId, step: 'activate' });
                }
                else if (state.step === 'activate') {
                    log('Opening Aktiver anlegg tab');
                    await clickTab('activate');
                    log('Waiting for "Aktiver alle" button');
                    const activateBtn = await waitFor('button#activateAllButton', { timeout: 600000 });
                    // The handler disables the button before posting.
                    await clickVerified(activateBtn, 'Aktiver alle', () => activateBtn.disabled === true, 1500);
                    log('Waiting for "Enheter aktivert" confirmation');
                    await waitForText('#message', 'Enheter aktivert', { timeout: 600000 });
                    log('Devices activated');
                    stepDone('activate', { message: msgText() });
                    await sleep(500);
                    const reverted = await revertToStandardMode(plantId);
                    clearState();
                    const summary = updateSummary((s) => { s.finishedAt = Date.now(); s.reverted = reverted; });
                    log('AK3 Scan Completed for plant ' + plantId + ' in ' + fmtDur(summary.finishedAt - summary.startedAt) +
                        (reverted ? '' : ' — WARNING: StandardMode revert failed, check packet settings manually'));
                    log('Summary:\n' + summaryText(plantId, summary));
                    showCompletionCard(plantId, summary);
                    return;
                }
                else {
                    log('Unknown step "' + state.step + '" — stopping');
                    await revertToStandardMode(plantId);
                    stopRun('Unknown step "' + state.step + '"');
                    return;
                }
            }
        } catch (e) {
            if (_abortRequested) { log('Run loop stopped: ' + e.message); return; }
            log('Workflow failed: ' + e.message + ' — reverting AK3 to StandardMode');
            const reverted = await revertToStandardMode(plantId);
            if (reverted) log('Revert to StandardMode OK after failure');
            stopRun(e.message);
        } finally {
            _running = false;
            refreshControls();
        }
    }

    // ---------- Router ----------
    // Nothing runs by itself on page load. The scan iframe lives under the same
    // @match path, so the script loads there too: the #mainmenu gate keeps the
    // UI (and the per-load log line) out of that frame. If a saved run exists
    // for this plant, the panel comes back with Resume / Abort even when it was
    // dismissed on the previous load — a paused run must stay visible.
    if (TAB_PLANT_ID && document.getElementById('mainmenu')) {
        injectMenuButton();
        const saved = getState();
        if (saved) {
            GM_deleteValue(PANEL_CLOSED_KEY);
            injectDebugPanel();
            const ageMin = Math.round((Date.now() - (saved.ts || 0)) / 60000);
            log('Page loaded with a saved run at step "' + saved.step + '" (' + ageMin +
                ' min old) — not running. Use ▶ Resume or ■ Abort.');
        }
    }
})();
