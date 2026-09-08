// ==UserScript==
// @name         AK3 Auto Scan
// @version      9.0
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
        while (arr.length > 300) arr.shift();
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
            clickEl(target, (label || 'Lagre ip-adresser') + ' (click ' + i + '/' + maxAttempts + ')');
            try {
                const jq = window.jQuery || window.$;
                if (jq && typeof jq === 'function') jq('#ipSave').trigger('click');
            } catch (e) {}
            try {
                const form = target.closest('form');
                if (form && typeof form.requestSubmit === 'function') form.requestSubmit(target);
                else if (form) form.submit();
            } catch (e) { log('ipSave form submit fallback: ' + e.message); }
            // Wait briefly for confirmation between clicks; total wait grows over attempts.
            const perClickWait = 4000;
            const start = Date.now();
            while (Date.now() - start < perClickWait) {
                const msg = document.querySelector('#message');
                if (msg && msg.textContent.includes('IPer oppdatert')) {
                    log((label || 'ipSave click') + ' — confirmed after ' + i + ' click(s)');
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
    function clickEl(el, label) {
        log('Click → ' + (label || describe(el)));
        try { el.click(); } catch (e) {}
        // Dispatch a real MouseEvent too — some handlers don't react to .click().
        try {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (e) {}
        // If jQuery is present (it is on ak3_setup), also trigger via jQuery.
        try {
            const jq = window.jQuery || window.$;
            if (jq && typeof jq === 'function') jq(el).trigger('click');
        } catch (e) {}
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
    async function clickTab(id) {
        const li = await waitFor('li#' + id);
        clickEl(li, 'Tab: ' + (li.textContent || id).trim());
        await sleep(400);
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

                if (state.step === 'dbcheck') {
                    log('Opening DB Sjekk tab');
                    await clickTab('databasetest');

                    // Wait for the test-box results to appear in the DOM
                    await waitFor('.test-box', { timeout: 10000 });
                    await sleep(500);

                    // Check each database individually by inspecting its own test-box text
                    const testBoxes = document.querySelectorAll('.test-box p');
                    let server3Ok = false;
                    let scannerOk = false;
                    testBoxes.forEach(p => {
                        const txt = p.textContent;
                        if (txt.includes('iw_plant_server3') && isOkStatus(txt)) server3Ok = true;
                        if (txt.includes('iw_ak3_scanner') && isOkStatus(txt)) scannerOk = true;
                    });
                    log('DB status — iw_plant_server3: ' + (server3Ok ? 'OK' : 'NOT OK') +
                        ', iw_ak3_scanner: ' + (scannerOk ? 'OK' : 'NOT OK'));

                    if (server3Ok && scannerOk) {
                        log('Both databases OK — skipping creation');
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
                    setInput(local,  localIpToUse);
                    setInput(remote, remoteIpToUse);

                    log('Waiting for HTTPS checkbox...');
                    const https = await waitFor('input#httpsForm');
                    log('HTTPS checkbox found — checked: ' + https.checked);
                    setCheckbox(https, true, 'HTTPS checkbox');

                    log('Clicking "Test tilkobling til AK-SM850" (HTTPS on)');
                    {
                        const ipFormBtn0 = await waitFor('input#ipForm');
                        enableButton(ipFormBtn0);
                        clickEl(ipFormBtn0, 'Test tilkobling til AK-SM850');
                    }
                    // Poll continuously for up to 60s — slow plants can take a
                    // while to render the Save button after the HTTPS test.
                    let saveBtn = null;
                    {
                        const r = await waitForSaveOrInvalid(60000, 'ipSave/invalid after HTTPS test');
                        if (r.kind === 'save') saveBtn = r.el;
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
                            clickEl(ipFormBtn,
                                    'Test tilkobling til AK-SM850 (retry ' + attempt + ', HTTPS off)');
                            // NOTE: do NOT call form.submit() here — Test tilkobling is
                            // AJAX-only; submitting the form caused a real POST/navigation
                            // that reloaded the page back to the start of the workflow.
                            const waitMs = attempt === 1 ? 20000 : attempt === 2 ? 25000 : 30000;
                            const r = await waitForSaveOrInvalid(waitMs, 'ipSave/invalid after HTTP retry ' + attempt);
                            if (r.kind === 'save') saveBtn = r.el;
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
                        const https2 = await waitFor('input#httpsForm');
                        setCheckbox(https2, false, 'HTTPS checkbox');
                        await sleep(500);
                        {
                            const b = await waitFor('input#ipForm');
                            enableButton(b);
                            clickEl(b, 'Test tilkobling til AK-SM850 (retry)');
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

                    const getIframeDoc = () => {
                        const f = document.querySelector('#scanWindow iframe, iframe[src*="iframe/scan"]');
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
                    // A scan window left from an earlier scan can already read
                    // "100% / Scan done". Remember it, so that old result is not
                    // taken for this scan's completion: the window has to reset
                    // (or be replaced) first.
                    const preDoc = getIframeDoc();
                    const staleDone = !!(preDoc && readScan(preDoc).done);
                    if (staleDone) log('Scan window still shows a finished earlier scan — waiting for it to reset before trusting completion');

                    const scanBtn = await waitFor('input#scanButton');
                    clickEl(scanBtn, 'Scan anlegg');
                    log('Scan started — waiting for completion (up to 2 hours)');

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
                                if (sawReset && r.done) return resolve();
                            }
                            if (Date.now() - start > 7200000) return reject(new Error('scan timeout'));
                            setTimeout(tick, 500);
                        };
                        tick();
                    });
                    log('Scan completed');
                    await sleep(1200);
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
                    setState({ plantId, step: 'copyplant' });
                }
                else if (state.step === 'copyplant') {
                    log('Opening Kopier til anlegg tab');
                    await clickTab('copyplant');
                    log('Waiting for "Kopier og overskriv ALT" button');
                    clickEl(await waitFor('button#copy_db', { timeout: 600000 }),
                            'Kopier og overskriv ALT');
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
                    await sleep(500);
                    setState({ plantId, step: 'activate' });
                }
                else if (state.step === 'activate') {
                    log('Opening Aktiver anlegg tab');
                    await clickTab('activate');
                    log('Waiting for "Aktiver alle" button');
                    clickEl(await waitFor('button#activateAllButton', { timeout: 600000 }),
                            'Aktiver alle');
                    log('Waiting for "Enheter aktivert" confirmation');
                    await waitForText('#message', 'Enheter aktivert', { timeout: 600000 });
                    log('Devices activated');
                    await sleep(500);
                    const reverted = await revertToStandardMode(plantId);
                    clearState();
                    log('AK3 Scan Completed for plant ' + plantId +
                        (reverted ? '' : ' — WARNING: StandardMode revert failed, check packet settings manually'));
                    alert('AK3 Scan Completed ✔\nPlant ' + plantId +
                          (reverted ? '' : '\n\nWARNING: could not set StandardMode — check packet_timeout / packet_interval manually!'));
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
