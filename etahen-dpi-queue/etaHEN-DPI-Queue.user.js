// ==UserScript==
// @name         etaHEN DPI Upload Queue
// @namespace    https://github.com/Hapnes-dev/tampermonkey-scripts
// @version      1.0.1
// @description  Adds a batch upload queue to the etaHEN DPIv2 web interface: pick many PKG files (or paste many URLs) at once, drag them into the order you want, and the queue installs them one at a time with per-file progress, speed and ETA, a configurable wait between installs, pause/abort, and retry of failed items.
// @author       Thomas
// @homepageURL  https://gitlab.com/thomas.kvalvag/tampermonkey-scripts
// @supportURL   https://gitlab.com/thomas.kvalvag/tampermonkey-scripts/-/issues
// @updateURL    https://gitlab.com/thomas.kvalvag/tampermonkey-scripts/-/raw/main/etahen-dpi-queue/etaHEN-DPI-Queue.user.js
// @downloadURL  https://gitlab.com/thomas.kvalvag/tampermonkey-scripts/-/raw/main/etahen-dpi-queue/etaHEN-DPI-Queue.user.js
// @match        http://10.0.0.17:12800/*
// @include      /^https?:\/\/[^\/]+:12800\/.*$/
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

/*
 * The DPIv2 server exposes exactly two endpoints: POST /upload (multipart, one
 * `file` OR one `url` per request) and POST /cleartmp. There is no status or
 * progress endpoint — every other path 404s — so the queue can only observe the
 * upload itself. A SUCCESS response means "installation started", not
 * "installation finished", which is why a configurable wait sits between items.
 */

(function () {
    'use strict';

    // ---------------------------------------------------------------- guard

    const nativeForm = document.getElementById('uploadForm');
    const nativeFile = document.getElementById('file');
    const nativeUrl = document.getElementById('url');
    if (!nativeForm || !nativeFile || !nativeUrl) return;
    if (!/\/upload\/?$/.test(nativeForm.getAttribute('action') || '')) return;

    // ------------------------------------------------------------- storage

    const SETTINGS_KEY = 'dpiq.settings';
    const URLQUEUE_KEY = 'dpiq.urlqueue';

    const store = {
        get(key, fallback) {
            try {
                const raw = typeof GM_getValue === 'function'
                    ? GM_getValue(key, null)
                    : localStorage.getItem(key);
                return raw == null ? fallback : JSON.parse(raw);
            } catch (e) {
                return fallback;
            }
        },
        set(key, value) {
            const raw = JSON.stringify(value);
            try {
                if (typeof GM_setValue === 'function') GM_setValue(key, raw);
                else localStorage.setItem(key, raw);
            } catch (e) {
                /* storage is a convenience, never a requirement */
            }
        },
    };

    const defaults = {
        waitSeconds: 20,
        stopOnError: true,
        autoClearTmp: false,
        confirmStart: false,
    };
    const settings = Object.assign({}, defaults, store.get(SETTINGS_KEY, {}));
    const saveSettings = () => store.set(SETTINGS_KEY, settings);

    // --------------------------------------------------------------- state

    const STATUS = {
        queued: { label: 'Queued', cls: 'q-queued' },
        uploading: { label: 'Uploading', cls: 'q-active' },
        fetching: { label: 'Console downloading', cls: 'q-active' },
        waiting: { label: 'Installing', cls: 'q-active' },
        done: { label: 'Sent', cls: 'q-done' },
        failed: { label: 'Failed', cls: 'q-failed' },
        aborted: { label: 'Aborted', cls: 'q-failed' },
    };

    let nextId = 1;
    const state = {
        items: [],
        running: false,
        stopRequested: false,
        pauseRequested: false,
        currentXhr: null,
        waitTimer: null,
        waitResolve: null,
        queueStart: 0,
        bytesDoneBefore: 0,
    };

    const isPending = (it) => it.status === 'queued';
    const isBusy = (it) => it.status === 'uploading' || it.status === 'fetching' || it.status === 'waiting';

    // ------------------------------------------------------------ formatting

    function formatBytes(bytes) {
        if (!bytes && bytes !== 0) return '–';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    function formatSpeed(bytesPerSecond) {
        if (!isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '–';
        return formatBytes(bytesPerSecond) + '/s';
    }

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '–';
        if (seconds < 60) return Math.round(seconds) + ' s';
        if (seconds < 3600) return Math.round(seconds / 60) + ' min';
        const h = Math.floor(seconds / 3600);
        const m = Math.round((seconds % 3600) / 60);
        return h + ' h ' + m + ' min';
    }

    function shortName(name) {
        return name.length <= 64 ? name : name.slice(0, 40) + '…' + name.slice(-20);
    }

    // ------------------------------------------------------------ queue edits

    function addFiles(fileList) {
        const added = [];
        let duplicates = 0;
        let rejected = 0;
        for (const file of fileList) {
            if (!/\.pkg$/i.test(file.name)) {
                rejected++;
                continue;
            }
            const already = state.items.some(
                (i) => i.kind === 'file' && i.name === file.name && i.size === file.size,
            );
            if (already) {
                duplicates++;
                continue;
            }
            added.push({
                id: nextId++,
                kind: 'file',
                file,
                name: file.name,
                size: file.size,
                status: 'queued',
                loaded: 0,
                message: '',
            });
        }
        if (added.length) {
            state.items.push(...added);
            render();
        }
        const notes = [];
        if (added.length) notes.push(added.length + ' file(s) added to the queue.');
        if (duplicates) notes.push(duplicates + ' already queued.');
        if (rejected) notes.push(rejected + ' ignored — only .pkg is accepted.');
        if (notes.length) flash(notes.join(' '), added.length ? 'ok' : 'warn');
    }

    function addUrls(text) {
        const urls = text.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
        const added = [];
        let duplicates = 0;
        for (const url of urls) {
            if (!/^https?:\/\//i.test(url)) continue;
            if (state.items.some((i) => i.kind === 'url' && i.url === url) || added.some((i) => i.url === url)) {
                duplicates++;
                continue;
            }
            added.push({
                id: nextId++,
                kind: 'url',
                url,
                name: decodeURIComponent(url.split('/').pop() || url),
                size: 0,
                status: 'queued',
                loaded: 0,
                message: '',
            });
        }
        if (added.length) {
            state.items.push(...added);
            persistUrlQueue();
            render();
            flash(added.length + ' URL(s) added to the queue.' + (duplicates ? ' ' + duplicates + ' already queued.' : ''), 'ok');
        } else if (duplicates) {
            flash('Every one of those URLs is already in the queue.', 'warn');
        } else if (urls.length) {
            flash('No valid http:// or https:// URL found.', 'warn');
        }
    }

    function removeItem(id) {
        const idx = state.items.findIndex((i) => i.id === id);
        if (idx < 0) return;
        if (isBusy(state.items[idx])) {
            flash('That item is running — abort the queue first.', 'warn');
            return;
        }
        state.items.splice(idx, 1);
        persistUrlQueue();
        render();
    }

    function moveItem(id, delta) {
        const idx = state.items.findIndex((i) => i.id === id);
        const target = idx + delta;
        if (idx < 0 || target < 0 || target >= state.items.length) return;
        const [item] = state.items.splice(idx, 1);
        state.items.splice(target, 0, item);
        persistUrlQueue();
        render();
    }

    function moveBefore(dragId, targetId) {
        if (dragId === targetId) return;
        const from = state.items.findIndex((i) => i.id === dragId);
        if (from < 0) return;
        const [item] = state.items.splice(from, 1);
        const to = state.items.findIndex((i) => i.id === targetId);
        if (to < 0) state.items.push(item);
        else state.items.splice(to, 0, item);
        persistUrlQueue();
        render();
    }

    function sortQueue(mode) {
        const pending = state.items.filter(isPending);
        const rest = state.items.filter((i) => !isPending(i));
        const cmp = {
            name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
            sizeAsc: (a, b) => a.size - b.size,
            sizeDesc: (a, b) => b.size - a.size,
        }[mode];
        if (mode === 'reverse') pending.reverse();
        else pending.sort(cmp);
        state.items = rest.concat(pending);
        persistUrlQueue();
        render();
    }

    function clearFinished() {
        state.items = state.items.filter((i) => i.status !== 'done');
        persistUrlQueue();
        render();
    }

    function clearAll() {
        if (state.running) {
            flash('Stop the queue before clearing it.', 'warn');
            return;
        }
        state.items = [];
        persistUrlQueue();
        render();
    }

    function retryFailed() {
        let n = 0;
        for (const item of state.items) {
            if (item.status === 'failed' || item.status === 'aborted') {
                item.status = 'queued';
                item.loaded = 0;
                item.message = '';
                n++;
            }
        }
        if (n) render();
        return n;
    }

    function persistUrlQueue() {
        // File handles die with the page; URL items are cheap to keep.
        const urls = state.items
            .filter((i) => i.kind === 'url' && i.status !== 'done')
            .map((i) => i.url);
        store.set(URLQUEUE_KEY, urls);
    }

    // --------------------------------------------------------------- upload

    function uploadItem(item) {
        return new Promise((resolve) => {
            const fd = new FormData();
            // Mirror the native form exactly: both fields, in the page's order.
            if (item.kind === 'file') {
                fd.append('file', item.file, item.name);
                fd.append('url', '');
            } else {
                fd.append('file', new File([], ''));
                fd.append('url', item.url);
            }

            const xhr = new XMLHttpRequest();
            state.currentXhr = xhr;
            const started = Date.now();
            item.startedAt = started;

            xhr.upload.addEventListener('progress', (e) => {
                if (!e.lengthComputable) return;
                item.loaded = e.loaded;
                if (e.total && !item.size) item.size = e.total;
                item.speed = e.loaded / Math.max(0.001, (Date.now() - started) / 1000);
                paintItem(item);
                paintOverall();
            });

            const finish = (result) => {
                state.currentXhr = null;
                resolve(result);
            };

            xhr.addEventListener('load', () => {
                const body = (xhr.responseText || '').trim();
                if (xhr.status !== 200) {
                    finish({ ok: false, message: 'HTTP ' + xhr.status });
                } else if (/FAILED/i.test(body)) {
                    finish({ ok: false, message: body.slice(0, 300) });
                } else if (/SUCCESS/i.test(body)) {
                    finish({ ok: true, message: body.slice(0, 300) });
                } else {
                    // Unrecognised body — treat as a failure so the run stops and
                    // the console's own words end up in the row.
                    finish({ ok: false, message: body.slice(0, 300) || 'Empty response' });
                }
            });

            xhr.addEventListener('error', () => finish({ ok: false, message: 'Connection error' }));
            xhr.addEventListener('abort', () => finish({ ok: false, aborted: true, message: 'Aborted' }));

            xhr.open('POST', '/upload');
            xhr.send(fd);
        });
    }

    function waitBetween(seconds, item) {
        return new Promise((resolve) => {
            if (seconds <= 0) return resolve();
            let left = seconds;
            item.message = 'Giving the console ' + left + ' s to install…';
            paintItem(item);
            state.waitResolve = resolve;
            state.waitTimer = setInterval(() => {
                left--;
                if (left <= 0 || state.stopRequested) {
                    clearInterval(state.waitTimer);
                    state.waitTimer = null;
                    state.waitResolve = null;
                    item.message = '';
                    paintItem(item);
                    resolve();
                    return;
                }
                item.message = 'Giving the console ' + left + ' s to install…';
                paintItem(item);
            }, 1000);
        });
    }

    function cancelWait() {
        if (state.waitTimer) {
            clearInterval(state.waitTimer);
            state.waitTimer = null;
        }
        if (state.waitResolve) {
            const r = state.waitResolve;
            state.waitResolve = null;
            r();
        }
    }

    async function runQueue() {
        if (state.running) return;
        if (!state.items.some(isPending)) {
            flash('Nothing queued.', 'warn');
            return;
        }
        if (settings.confirmStart) {
            const pending = state.items.filter(isPending);
            const total = pending.reduce((n, i) => n + (i.size || 0), 0);
            const msg = 'Install ' + pending.length + ' package(s), ' + formatBytes(total) + ' in total?';
            if (!window.confirm(msg)) return;
        }

        state.running = true;
        state.stopRequested = false;
        state.pauseRequested = false;
        state.queueStart = Date.now();
        state.bytesDoneBefore = 0;
        render();

        while (!state.stopRequested && !state.pauseRequested) {
            const item = state.items.find(isPending);
            if (!item) break;

            item.status = item.kind === 'file' ? 'uploading' : 'fetching';
            item.loaded = 0;
            item.message = item.kind === 'url' ? 'The console is downloading this URL…' : '';
            render();

            const result = await uploadItem(item);

            if (result.ok) {
                item.status = 'done';
                item.loaded = item.size;
                item.message = result.message;
                state.bytesDoneBefore += item.size || 0;
                render();

                if (state.items.some(isPending) && !state.stopRequested && !state.pauseRequested) {
                    item.status = 'waiting';
                    paintItem(item);
                    await waitBetween(settings.waitSeconds, item);
                    item.status = 'done';
                    item.message = result.message;
                    paintItem(item);
                }
            } else {
                item.status = result.aborted ? 'aborted' : 'failed';
                item.message = result.message;
                render();
                if (result.aborted) break;
                if (settings.stopOnError) {
                    flash('Stopped: ' + item.name + ' — ' + result.message, 'err');
                    break;
                }
            }
        }

        state.running = false;
        state.stopRequested = false;
        state.pauseRequested = false;
        cancelWait();
        render();

        const left = state.items.filter(isPending).length;
        if (!left) {
            const failed = state.items.filter((i) => i.status === 'failed' || i.status === 'aborted').length;
            flash(failed ? 'Queue finished with ' + failed + ' failure(s).' : 'Queue finished — everything sent.', failed ? 'warn' : 'ok');
            if (settings.autoClearTmp && !failed) clearTmp();
        }
    }

    function pauseQueue() {
        if (!state.running) return;
        state.pauseRequested = true;
        cancelWait();
        flash('Pausing after the current item…', 'warn');
        render();
    }

    function stopQueue() {
        if (!state.running) return;
        state.stopRequested = true;
        cancelWait();
        if (state.currentXhr) state.currentXhr.abort();
    }

    function clearTmp() {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => flash('Clear temp files: ' + (xhr.responseText || '').trim().slice(0, 200), xhr.status === 200 ? 'ok' : 'err');
        xhr.onerror = () => flash('Clear temp files: connection error.', 'err');
        xhr.open('POST', '/cleartmp');
        xhr.send();
    }

    // ------------------------------------------------------------------- UI

    const style = document.createElement('style');
    style.textContent = `
        body { max-width: 980px !important; }
        #dpiq { border: 1px solid #ccc; border-radius: 5px; padding: 20px; margin-top: 24px; }
        #dpiq h3 { margin: 0 0 4px; }
        #dpiq .dpiq-sub { color: #666; font-size: .85em; margin: 0 0 14px; }
        #dpiq .dpiq-drop { border: 2px dashed #bbb; border-radius: 6px; padding: 14px; text-align: center;
            color: #666; font-size: .9em; margin-bottom: 12px; transition: background .15s, border-color .15s; }
        #dpiq .dpiq-drop.over { border-color: #4285f4; background: #eaf1fe; color: #1a56c4; }
        #dpiq .dpiq-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
        #dpiq textarea { width: 100%; box-sizing: border-box; padding: 8px; font-family: monospace; font-size: .85em;
            min-height: 54px; resize: vertical; }
        #dpiq .btn { background: #4285f4; color: #fff; border: 0; padding: 8px 13px; border-radius: 4px; cursor: pointer; font-size: .9em; }
        #dpiq .btn:disabled { background: #b9c7dd; cursor: not-allowed; }
        #dpiq .btn.sec { background: #eceff3; color: #333; }
        #dpiq .btn.sec:disabled { color: #999; }
        #dpiq .btn.warn { background: #ff9800; }
        #dpiq .btn.danger { background: #f44336; }
        #dpiq .btn.mini { padding: 3px 7px; font-size: .8em; }
        #dpiq .dpiq-sep { border-top: 1px solid #eee; margin: 14px 0; }
        #dpiq ol { list-style: none; margin: 0; padding: 0; }
        #dpiq li { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: 1px solid #e4e4e4;
            border-radius: 4px; margin-bottom: 5px; background: #fff; }
        #dpiq li.dragging { opacity: .4; }
        #dpiq li.drop-before { border-top: 2px solid #4285f4; }
        #dpiq li .idx { color: #999; font-size: .8em; min-width: 20px; text-align: right; }
        #dpiq li .grip { cursor: grab; color: #aaa; user-select: none; }
        #dpiq li .meta { flex: 1; min-width: 0; }
        #dpiq li .nm { font-size: .9em; word-break: break-all; }
        #dpiq li .sub { font-size: .78em; color: #777; margin-top: 2px; }
        #dpiq li .bar { height: 5px; background: #f0f0f0; border-radius: 3px; overflow: hidden; margin-top: 5px; display: none; }
        #dpiq li .bar > i { display: block; height: 100%; width: 0%; background: #4CAF50; transition: width .25s; }
        #dpiq li.is-active .bar { display: block; }
        #dpiq li .st { font-size: .76em; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
        #dpiq .q-queued { background: #eceff3; color: #555; }
        #dpiq .q-active { background: #e3f2fd; color: #1565c0; }
        #dpiq .q-done { background: #e8f5e9; color: #2e7d32; }
        #dpiq .q-failed { background: #ffebee; color: #c62828; }
        #dpiq .dpiq-overall { font-size: .85em; color: #444; margin: 10px 0 4px; }
        #dpiq .dpiq-overall .obar { height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; margin-top: 5px; }
        #dpiq .dpiq-overall .obar > i { display: block; height: 100%; width: 0%; background: #4285f4; transition: width .25s; }
        #dpiq .dpiq-empty { color: #888; font-size: .9em; font-style: italic; padding: 10px 2px; }
        #dpiq .dpiq-opts { font-size: .85em; color: #444; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
        #dpiq .dpiq-opts label { display: inline-flex; align-items: center; gap: 5px; margin: 0; }
        #dpiq .dpiq-opts input[type=number] { width: 62px; padding: 3px 5px; }
        #dpiq .dpiq-flash { margin-top: 10px; padding: 8px 10px; border-radius: 4px; font-size: .87em; display: none; }
        #dpiq .dpiq-flash.ok { background: #e8f5e9; border: 1px solid #4CAF50; color: #2e7d32; display: block; }
        #dpiq .dpiq-flash.warn { background: #fff8e1; border: 1px solid #ff9800; color: #e65100; display: block; }
        #dpiq .dpiq-flash.err { background: #ffebee; border: 1px solid #f44336; color: #c62828; display: block; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'dpiq';
    panel.innerHTML = `
        <h3>Batch install queue</h3>
        <p class="dpiq-sub">Pick as many PKG files as you like, drag them into the order you want, then start.
           They are sent to the console one at a time.</p>

        <div class="dpiq-drop" id="dpiqDrop">Drop .pkg files here, or
            <button class="btn sec mini" id="dpiqPick" type="button">choose files…</button>
        </div>
        <input type="file" id="dpiqInput" accept=".pkg" multiple hidden>

        <div class="dpiq-row">
            <textarea id="dpiqUrls" placeholder="…or paste PKG URLs, one per line (fastest — the console downloads them itself)"></textarea>
        </div>
        <div class="dpiq-row">
            <button class="btn sec" id="dpiqAddUrls" type="button">Add URLs</button>
            <span style="flex:1"></span>
            <button class="btn sec mini" id="dpiqSortName" type="button">Sort A→Z</button>
            <button class="btn sec mini" id="dpiqSortSmall" type="button">Smallest first</button>
            <button class="btn sec mini" id="dpiqSortBig" type="button">Largest first</button>
            <button class="btn sec mini" id="dpiqReverse" type="button">Reverse</button>
        </div>

        <div class="dpiq-sep"></div>

        <ol id="dpiqList"></ol>
        <div class="dpiq-empty" id="dpiqEmpty">The queue is empty.</div>

        <div class="dpiq-overall" id="dpiqOverall" style="display:none">
            <span id="dpiqOverallText"></span>
            <div class="obar"><i id="dpiqOverallBar"></i></div>
        </div>

        <div class="dpiq-row" style="margin-top:14px">
            <button class="btn" id="dpiqStart" type="button">▶ Start queue</button>
            <button class="btn warn" id="dpiqPause" type="button" disabled>⏸ Pause</button>
            <button class="btn danger" id="dpiqStop" type="button" disabled>⏹ Abort</button>
            <span style="flex:1"></span>
            <button class="btn sec" id="dpiqRetry" type="button">↻ Retry failed</button>
            <button class="btn sec" id="dpiqClearDone" type="button">Clear finished</button>
            <button class="btn sec" id="dpiqClearAll" type="button">Clear all</button>
        </div>

        <div class="dpiq-opts">
            <label title="The console reports SUCCESS when the install starts, not when it ends. This pause gives it room before the next upload.">
                Wait between installs
                <input type="number" id="dpiqWait" min="0" max="600" step="5"> s
            </label>
            <label><input type="checkbox" id="dpiqStopOnError"> Stop the queue on the first failure</label>
            <label><input type="checkbox" id="dpiqAutoClear"> Clear temp files when the queue finishes</label>
            <label><input type="checkbox" id="dpiqConfirm"> Ask before starting</label>
        </div>

        <div class="dpiq-flash" id="dpiqFlash"></div>
    `;
    // Directly under the single-file form, above the Maintenance section.
    const container = nativeForm.closest('.container') || document.body;
    const maintenance = container.querySelector('.maintenance');
    if (maintenance) container.insertBefore(panel, maintenance);
    else container.appendChild(panel);

    const el = (id) => panel.querySelector('#' + id);
    const listEl = el('dpiqList');
    const emptyEl = el('dpiqEmpty');
    const flashEl = el('dpiqFlash');
    const overallEl = el('dpiqOverall');
    const overallText = el('dpiqOverallText');
    const overallBar = el('dpiqOverallBar');
    const rowRefs = new Map();

    let flashTimer = null;
    function flash(message, kind) {
        flashEl.className = 'dpiq-flash ' + (kind || 'ok');
        flashEl.textContent = message;
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashEl.className = 'dpiq-flash'; }, 9000);
    }

    // --------------------------------------------------------------- render

    function render() {
        rowRefs.clear();
        listEl.textContent = '';
        emptyEl.style.display = state.items.length ? 'none' : 'block';

        state.items.forEach((item, i) => {
            const li = document.createElement('li');
            li.dataset.id = String(item.id);
            li.draggable = !isBusy(item);
            if (isBusy(item)) li.classList.add('is-active');

            const idx = document.createElement('span');
            idx.className = 'idx';
            idx.textContent = (i + 1) + '.';

            const grip = document.createElement('span');
            grip.className = 'grip';
            grip.textContent = '⠿';
            grip.title = 'Drag to reorder';

            const meta = document.createElement('div');
            meta.className = 'meta';
            const nm = document.createElement('div');
            nm.className = 'nm';
            nm.textContent = (item.kind === 'url' ? '🌐 ' : '📦 ') + shortName(item.name);
            nm.title = item.kind === 'url' ? item.url : item.name;
            const sub = document.createElement('div');
            sub.className = 'sub';
            const bar = document.createElement('div');
            bar.className = 'bar';
            const fill = document.createElement('i');
            bar.appendChild(fill);
            meta.append(nm, sub, bar);

            const st = document.createElement('span');
            st.className = 'st ' + STATUS[item.status].cls;
            st.textContent = STATUS[item.status].label;

            const up = document.createElement('button');
            up.type = 'button';
            up.className = 'btn sec mini';
            up.textContent = '▲';
            up.title = 'Move up';
            up.disabled = i === 0;
            up.addEventListener('click', () => moveItem(item.id, -1));

            const down = document.createElement('button');
            down.type = 'button';
            down.className = 'btn sec mini';
            down.textContent = '▼';
            down.title = 'Move down';
            down.disabled = i === state.items.length - 1;
            down.addEventListener('click', () => moveItem(item.id, 1));

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'btn sec mini';
            del.textContent = '✕';
            del.title = 'Remove from the queue';
            del.addEventListener('click', () => removeItem(item.id));

            li.append(idx, grip, meta, st, up, down, del);
            listEl.appendChild(li);
            rowRefs.set(item.id, { li, sub, fill, st });
            paintItem(item);
        });

        const busy = state.running;
        el('dpiqStart').disabled = busy;
        el('dpiqPause').disabled = !busy;
        el('dpiqStop').disabled = !busy;
        el('dpiqClearAll').disabled = busy;
        paintOverall();
    }

    function paintItem(item) {
        const ref = rowRefs.get(item.id);
        if (!ref) return;

        ref.st.className = 'st ' + STATUS[item.status].cls;
        ref.st.textContent = STATUS[item.status].label;
        ref.li.classList.toggle('is-active', isBusy(item));

        const parts = [];
        if (item.size) parts.push(formatBytes(item.size));
        if (item.status === 'uploading' && item.size) {
            const pct = Math.round((item.loaded / item.size) * 100);
            const remaining = item.speed ? (item.size - item.loaded) / item.speed : NaN;
            parts.push(pct + '%');
            parts.push(formatSpeed(item.speed));
            parts.push(formatTime(remaining) + ' left');
            ref.fill.style.width = pct + '%';
        } else if (item.status === 'fetching' || item.status === 'waiting') {
            ref.fill.style.width = '100%';
        } else if (item.status === 'done') {
            ref.fill.style.width = '100%';
        }
        if (item.message) parts.push(item.message);
        ref.sub.textContent = parts.join(' · ');
    }

    function paintOverall() {
        const pending = state.items.filter((i) => isPending(i) || isBusy(i));
        if (!state.running && !pending.length) {
            overallEl.style.display = 'none';
            return;
        }
        overallEl.style.display = 'block';

        const total = state.items.reduce((n, i) => n + (i.size || 0), 0);
        // 'waiting' is a sent item serving out the install pause — count it as sent,
        // otherwise the totals dip backwards between every pair of packages.
        const done = state.items.reduce((n, i) => {
            if (i.status === 'done' || i.status === 'waiting') return n + (i.size || 0);
            if (i.status === 'uploading') return n + (i.loaded || 0);
            return n;
        }, 0);
        const doneCount = state.items.filter((i) => i.status === 'done' || i.status === 'waiting').length;

        const pct = total ? Math.min(100, (done / total) * 100) : 0;
        overallBar.style.width = pct.toFixed(1) + '%';

        const bits = [doneCount + ' / ' + state.items.length + ' sent'];
        if (total) bits.push(formatBytes(done) + ' of ' + formatBytes(total));
        if (state.running && state.queueStart) {
            const elapsed = (Date.now() - state.queueStart) / 1000;
            const speed = done / Math.max(0.001, elapsed);
            if (done > 0 && total > done) {
                bits.push(formatSpeed(speed));
                bits.push(formatTime((total - done) / speed) + ' left');
            }
        }
        overallText.textContent = bits.join(' · ');
    }

    // ----------------------------------------------------------- drag & drop

    let dragId = null;

    listEl.addEventListener('dragstart', (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        dragId = Number(li.dataset.id);
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(dragId)); } catch (err) { /* Firefox needs the call, not the value */ }
    });

    listEl.addEventListener('dragover', (e) => {
        if (dragId == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const li = e.target.closest('li');
        listEl.querySelectorAll('li.drop-before').forEach((n) => n.classList.remove('drop-before'));
        if (li && Number(li.dataset.id) !== dragId) li.classList.add('drop-before');
    });

    listEl.addEventListener('drop', (e) => {
        if (dragId == null) return;
        e.preventDefault();
        const li = e.target.closest('li');
        if (li) moveBefore(dragId, Number(li.dataset.id));
        dragId = null;
    });

    listEl.addEventListener('dragend', () => {
        dragId = null;
        listEl.querySelectorAll('li').forEach((n) => n.classList.remove('dragging', 'drop-before'));
    });

    const dropZone = el('dpiqDrop');
    ['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('over');
    }));
    dropZone.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    });
    // Dropping a file anywhere else would navigate away from the page.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    // -------------------------------------------------------------- wiring

    el('dpiqPick').addEventListener('click', () => el('dpiqInput').click());
    el('dpiqInput').addEventListener('change', (e) => {
        if (e.target.files.length) addFiles(e.target.files);
        e.target.value = '';
    });

    el('dpiqAddUrls').addEventListener('click', () => {
        const ta = el('dpiqUrls');
        addUrls(ta.value);
        ta.value = '';
    });

    el('dpiqSortName').addEventListener('click', () => sortQueue('name'));
    el('dpiqSortSmall').addEventListener('click', () => sortQueue('sizeAsc'));
    el('dpiqSortBig').addEventListener('click', () => sortQueue('sizeDesc'));
    el('dpiqReverse').addEventListener('click', () => sortQueue('reverse'));

    el('dpiqStart').addEventListener('click', runQueue);
    el('dpiqPause').addEventListener('click', pauseQueue);
    el('dpiqStop').addEventListener('click', stopQueue);
    el('dpiqClearDone').addEventListener('click', clearFinished);
    el('dpiqClearAll').addEventListener('click', clearAll);
    el('dpiqRetry').addEventListener('click', () => {
        const n = retryFailed();
        flash(n ? n + ' item(s) put back in the queue.' : 'Nothing failed.', n ? 'ok' : 'warn');
    });

    const waitInput = el('dpiqWait');
    waitInput.value = settings.waitSeconds;
    waitInput.addEventListener('change', () => {
        const v = Math.max(0, Math.min(600, Number(waitInput.value) || 0));
        settings.waitSeconds = v;
        waitInput.value = v;
        saveSettings();
    });

    const bindCheck = (id, key) => {
        const box = el(id);
        box.checked = !!settings[key];
        box.addEventListener('change', () => {
            settings[key] = box.checked;
            saveSettings();
        });
    };
    bindCheck('dpiqStopOnError', 'stopOnError');
    bindCheck('dpiqAutoClear', 'autoClearTmp');
    bindCheck('dpiqConfirm', 'confirmStart');

    window.addEventListener('beforeunload', (e) => {
        if (!state.running) return;
        e.preventDefault();
        e.returnValue = '';
        return '';
    });

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Batch queue: scroll to panel', () => panel.scrollIntoView({ behavior: 'smooth' }));
        GM_registerMenuCommand('Batch queue: forget saved URLs', () => {
            store.set(URLQUEUE_KEY, []);
            flash('Saved URL queue cleared. Items already listed stay until you remove them.', 'ok');
        });
    }

    // Restore whatever survived a reload — URLs only; File handles do not.
    const savedUrls = store.get(URLQUEUE_KEY, []);
    if (Array.isArray(savedUrls) && savedUrls.length) {
        addUrls(savedUrls.join('\n'));
        flash(savedUrls.length + ' URL(s) restored from the last session.', 'ok');
    } else {
        render();
    }
})();
