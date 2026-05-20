// ==UserScript==
// @name         SQL Equipment Import
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @version      7.5
// @description  Floating panel on phpMyAdmin: pick a driver-template from a GitHub-hosted manifest (or load a .sql file from disk), edit unit rows + Modbus settings (RTU/TCP, multi-IP), emit the full SQL ready to paste into the plant DB. No backend, no DB.
// @author       hapnes-dev
// @match        *://*.plants.iwmac.local:*/secure/phpMyAdmin/*
// @run-at       document-end
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/sql/sql.min.js
// @resource     CM_CSS https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css
// @resource     CM_THEME https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/eclipse.min.css
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/SQL-Equipment-Import.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/SQL-Equipment-Import.user.js
// ==/UserScript==

(function () {
    'use strict';
    if (window.top !== window) return;

    // Inject CodeMirror CSS (loaded via @resource)
    try {
        if (typeof GM_getResourceText === 'function' && typeof GM_addStyle === 'function') {
            GM_addStyle(GM_getResourceText('CM_CSS'));
            GM_addStyle(GM_getResourceText('CM_THEME'));
            GM_addStyle('.CodeMirror{height:100%;font:13px Consolas,monospace}');
        }
    } catch (e) { /* CodeMirror optional — falls back to plain textarea */ }

    // ---------------- Config ----------------
    const REPO_BASE = 'https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/sql-equipment-import/templates';
    const MANIFEST_URL = REPO_BASE + '/manifest.json';
    const EDITABLE_SETTINGS = ['mb_mode', 'comm_port', 'comm_baudrate', 'comm_parity'];
    const PARITY_OPTS = [
        ['0', 'N (None)'], ['1', 'O (Odd)'], ['2', 'E (Even)'],
    ];
    const MB_MODE_OPTS = [['0', 'RTU'], ['2', 'TCP']];
    const BAUDRATE_OPTS = ['9600', '19200', '38400', '57600', '115200'];

    // ---------------- SQL helpers ----------------
    const sqlEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
    const q = (v) => "'" + sqlEsc(v) + "'";

    // ---------------- HTTP (GitHub raw) ----------------
    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            // cache-buster so freshly-pushed files are visible immediately
            const u = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
            GM_xmlhttpRequest({
                method: 'GET', url: u, timeout: 30000,
                responseType: 'arraybuffer',
                overrideMimeType: 'text/plain; charset=utf-8',
                onload: r => {
                    if (r.status >= 200 && r.status < 300) {
                        try {
                            const buf = r.response || r.responseText;
                            if (!(buf instanceof ArrayBuffer)) { resolve(String(buf)); return; }
                            const u8 = new Uint8Array(buf);
                            // Try strict UTF-8 first. If the file is latin1 (older
                            // phpMyAdmin exports of Norwegian text like "Grønt"),
                            // strict decode throws on the bare 0xF8 byte; fall back
                            // to windows-1252 (latin1 superset) so æøå render right.
                            try {
                                resolve(new TextDecoder('utf-8', { fatal: true }).decode(u8));
                            } catch (_) {
                                resolve(new TextDecoder('windows-1252').decode(u8));
                            }
                        } catch (e) { reject(e); }
                    } else reject(new Error(`HTTP ${r.status} fetching ${url}`));
                },
                onerror: () => reject(new Error('Network error fetching ' + url)),
                ontimeout: () => reject(new Error('Timeout fetching ' + url)),
            });
        });
    }

    function extractTuples(s) {
        const out = []; let i = 0, depth = 0, start = -1, inStr = false;
        while (i < s.length) {
            const c = s[i];
            if (inStr) {
                if (c === "'" && s[i + 1] === "'") { i += 2; continue; }
                if (c === "'") inStr = false;
                i++; continue;
            }
            if (c === "'") { inStr = true; i++; continue; }
            if (c === '(') { if (depth === 0) start = i + 1; depth++; i++; continue; }
            if (c === ')') { depth--; if (depth === 0) out.push(s.slice(start, i)); i++; continue; }
            i++;
        }
        return out;
    }
    function splitFields(t) {
        const out = []; let cur = '', inStr = false, paren = 0, i = 0;
        while (i < t.length) {
            const c = t[i];
            if (inStr) {
                if (c === "'" && t[i + 1] === "'") { cur += "''"; i += 2; continue; }
                if (c === "'") inStr = false;
                cur += c; i++; continue;
            }
            if (c === "'") { inStr = true; cur += c; i++; continue; }
            if (c === '(') { paren++; cur += c; i++; continue; }
            if (c === ')') { paren--; cur += c; i++; continue; }
            if (c === ',' && paren === 0) { out.push(cur.trim()); cur = ''; i++; continue; }
            cur += c; i++;
        }
        if (cur.trim()) out.push(cur.trim());
        return out;
    }
    function unq(v) {
        v = (v || '').trim();
        if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") {
            return v.slice(1, -1).replace(/''/g, "'");
        }
        return v;
    }
    const DEFAULT_COLS = {
        iw_sys_plant_units: ['row_date', 'active', 'blockout', 'unit_id', 'unit_name', 'grp_name', 'driver_type', 'driver_addr', 'regulator_type', 'order_no', 'view_order', 'driver_adr_extra'],
        iw_sys_plant_settings: ['row_date', 'setting', 'owner', 'value', 'eng_unit', 'help_text', 'help_link'],
    };
    // Find the index of the statement-terminating ';' that is NOT inside a string
    // or paren. Returns -1 if not found.
    function findStmtEnd(s, start) {
        let i = start, depth = 0, inStr = false;
        while (i < s.length) {
            const c = s[i];
            if (inStr) {
                if (c === "'" && s[i + 1] === "'") { i += 2; continue; }
                if (c === "'") inStr = false;
                i++; continue;
            }
            if (c === "'") { inStr = true; i++; continue; }
            if (c === '(') { depth++; i++; continue; }
            if (c === ')') { depth--; i++; continue; }
            if (c === ';' && depth === 0) return i;
            i++;
        }
        return -1;
    }

    function parseBlock(sqlText, table) {
        // Locate the header: REPLACE/INSERT INTO `table` [ ( cols ) ] VALUES
        const reHead = new RegExp(
            `(?:REPLACE|INSERT)\\s+INTO\\s+\`${table}\`\\s*(?:\\(([^)]+)\\))?\\s*VALUES\\s*`,
            'i'
        );
        const mh = reHead.exec(sqlText);
        if (!mh) return null;
        const valuesStart = mh.index + mh[0].length;
        const stmtEnd = findStmtEnd(sqlText, valuesStart);
        if (stmtEnd < 0) return null;
        const valuesText = sqlText.slice(valuesStart, stmtEnd);

        let cols;
        if (mh[1]) cols = mh[1].split(',').map(s => s.trim().replace(/`/g, ''));
        else cols = (DEFAULT_COLS[table] || []).slice();

        const tuples = extractTuples(valuesText);
        const maxLen = tuples.reduce((a, t) => Math.max(a, splitFields(t).length), 0);
        while (cols.length < maxLen) cols.push('col_' + (cols.length + 1));
        const rows = tuples.map(t => {
            const f = splitFields(t);
            const o = {};
            cols.forEach((c, i) => o[c] = f[i] != null ? f[i].trim() : '');
            return o;
        });
        const raw = sqlText.slice(mh.index, stmtEnd + 1);
        return { start: mh.index, end: stmtEnd + 1, cols, tuples, rows, raw };
    }

    // ---------------- UI ----------------
    const css = `
    #seii-panel{position:fixed;top:12px;right:80px;width:460px;height:auto;min-width:360px;min-height:120px;max-width:98vw;max-height:96vh;z-index:2147483647;background:#fff;border:1px solid #888;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.25);font:12px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#222;resize:both;overflow:hidden;display:flex;flex-direction:column}
    #seii-panel .hdr{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:#2b6cb0;color:#fff;border-radius:6px 6px 0 0;cursor:move;user-select:none}
    #seii-panel .hdr b{font-size:13px}
    #seii-panel .hdr button{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:3px;padding:1px 7px;cursor:pointer;margin-left:4px}
    #seii-panel .body{padding:10px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column}
    #seii-panel #seii-form{display:flex;flex-direction:column;flex:1;min-height:0}
    #seii-panel #seii-form.show{display:flex}
    #seii-panel #seii-out{flex:1;min-height:120px}
    #seii-panel.collapsed .body{display:none}
    #seii-panel.collapsed{width:auto;height:auto;min-height:0;resize:none}
    #seii-panel label{display:block;font-weight:600;margin:6px 0 2px}
    #seii-panel input,#seii-panel select,#seii-panel textarea{width:100%;box-sizing:border-box;padding:4px 6px;font:12px monospace;border:1px solid #bbb;border-radius:3px}
    #seii-panel textarea{font-family:Consolas,monospace;font-size:11px;min-height:160px;resize:vertical;white-space:pre}
    #seii-panel .row{display:flex;gap:4px;margin-bottom:3px;align-items:center}
    #seii-panel .row input{flex:1}
    #seii-panel .row button{width:28px}
    #seii-panel .actions{display:flex;gap:6px;margin-top:10px}
    #seii-panel .actions button{flex:1;padding:5px;cursor:pointer;border:1px solid #888;border-radius:3px;background:#f0f0f0}
    #seii-panel .actions button.primary{background:#2b6cb0;color:#fff;border-color:#2b6cb0}
    #seii-panel .status{margin-top:6px;min-height:14px}
    #seii-panel .ok{color:#2f855a;font-weight:600}
    #seii-panel .err{color:#c53030;font-weight:600}
    #seii-panel .small{font-size:11px;color:#666}
    #seii-toggle{position:fixed;top:12px;right:80px;z-index:2147483647;background:#2b6cb0;color:#fff;border:0;border-radius:4px;padding:4px 9px;cursor:pointer;font:12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.25);display:none}
    #seii-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483647;display:none;align-items:center;justify-content:center}
    #seii-modal.show{display:flex}
    #seii-modal .box{background:#fff;width:90vw;height:90vh;border-radius:6px;display:flex;flex-direction:column;overflow:hidden}
    #seii-modal .mhdr{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#2b6cb0;color:#fff;font:13px -apple-system,Segoe UI,Roboto,Arial,sans-serif}
    #seii-modal .mhdr button{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);border-radius:3px;padding:2px 10px;cursor:pointer;margin-left:6px;font:12px -apple-system,Segoe UI,Roboto,Arial,sans-serif}
    #seii-modal textarea{flex:1;border:0;padding:10px;font:12px Consolas,monospace;white-space:pre;resize:none;outline:none}
    #seii-suggest{position:absolute;top:100%;left:0;right:36px;background:#fff;border:1px solid #888;border-top:0;max-height:220px;overflow-y:auto;z-index:10;display:none}
    #seii-suggest.show{display:block}
    #seii-suggest .item{padding:4px 8px;cursor:pointer;font:12px monospace;border-bottom:1px solid #eee}
    #seii-suggest .item:hover,#seii-suggest .item.active{background:#2b6cb0;color:#fff}
    `;
    document.documentElement.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

    const panel = document.createElement('div');
    panel.id = 'seii-panel';
    panel.innerHTML = `
      <div class="hdr">
        <b>SQL Equipment Import</b>
        <span>
          <button id="seii-collapse" title="Collapse / expand">▸</button>
          <button id="seii-hide" title="Hide">×</button>
        </span>
      </div>
      <div class="body">
        <label>Driver template</label>
        <div class="row" style="position:relative">
          <input id="seii-search" placeholder="Search templates…" autocomplete="off" style="flex:1">
          <button id="seii-reload" title="Reload manifest" style="padding:2px 8px;cursor:pointer">↻</button>
          <div id="seii-suggest"></div>
        </div>
        <select id="seii-tpl" style="margin-top:3px;width:100%"><option value="">— loading… —</option></select>

        <label class="small" style="margin-top:8px">…or load a .sql from disk</label>
        <input type="file" id="seii-file" accept=".sql,text/plain">
        <div id="seii-fileinfo" class="small">Pick a template above, or load a file from disk.</div>

        <div id="seii-form" style="display:none">
          <label>Unit rows <span class="small">(rename / add / remove)</span></label>
          <div id="seii-units"></div>
          <button id="seii-addunit" class="small" style="margin-top:3px;padding:2px 8px;cursor:pointer">+ Add unit</button>

          <div id="seii-settings"></div>

          <div id="seii-tcpwrap" style="display:none">
            <label>mb_tcp_servers <span class="small">(rows auto-numbered: 1;ip;..., 2;ip;...)</span></label>
            <div id="seii-ips"></div>
            <button id="seii-addip" class="small" style="margin-top:3px;padding:2px 8px;cursor:pointer">+ Add IP</button>
          </div>

          <label>SQL command</label>
          <select id="seii-cmd">
            <option value="INSERT INTO" selected>INSERT INTO</option>
            <option value="REPLACE INTO">REPLACE INTO</option>
          </select>

          <div class="actions">
            <button id="seii-gen" class="primary">Generate SQL</button>
            <button id="seii-copy">Copy</button>
            <button id="seii-edit" title="Open large editor">Edit ⛶</button>
          </div>
          <div id="seii-status" class="status"></div>

          <label>SQL output</label>
          <textarea id="seii-out" readonly placeholder="Click Generate SQL…"></textarea>
        </div>
      </div>
    `;
    document.documentElement.appendChild(panel);
    const toggle = document.createElement('button');
    toggle.id = 'seii-toggle'; toggle.textContent = 'SQL Import';
    document.documentElement.appendChild(toggle);

    const modal = document.createElement('div');
    modal.id = 'seii-modal';
    modal.innerHTML = `
      <div class="box">
        <div class="mhdr">
          <b>SQL editor</b>
          <span>
            <button id="seii-mcopy">Copy</button>
            <button id="seii-mclose">Close</button>
          </span>
        </div>
        <textarea id="seii-medit" spellcheck="false"></textarea>
      </div>`;
    document.documentElement.appendChild(modal);

    const $ = id => document.getElementById(id);
    $('seii-hide').onclick = () => { panel.style.display = 'none'; toggle.style.display = 'block'; };
    toggle.onclick = () => { panel.style.display = ''; toggle.style.display = 'none'; };

    // Default: panel is collapsed when you visit a page; click ▸ (or the title bar) to expand.
    panel.classList.add('collapsed');
    function setCollapsed(c) {
        panel.classList.toggle('collapsed', c);
        $('seii-collapse').textContent = c ? '▸' : '▾';
    }
    $('seii-collapse').onclick = () => setCollapsed(!panel.classList.contains('collapsed'));

    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    // ---------- Drag ----------
    (function () {
        const hdr = panel.querySelector('.hdr');
        let sx, sy, ox, oy, drag = false;
        hdr.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON') return;
            drag = true; const r = panel.getBoundingClientRect();
            sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!drag) return;
            panel.style.left = (ox + e.clientX - sx) + 'px';
            panel.style.top = (oy + e.clientY - sy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { drag = false; });
    })();

    // ---------- Template state ----------
    let CURRENT = null; // { name, sqlText, units, settings }
    let MANIFEST = []; // [{name, display_name, driver_type, file}]

    function loadSqlText(name, sqlText, opts) {
        CURRENT = { name, sqlText, passThrough: !!(opts && opts.passThrough) };
        CURRENT.units = parseBlock(sqlText, 'iw_sys_plant_units');
        CURRENT.settings = parseBlock(sqlText, 'iw_sys_plant_settings');
        $('seii-fileinfo').innerHTML =
            `<span class="ok">Loaded ${escapeHtml(name)}</span> ` +
            `<span class="small">(${sqlText.length} bytes, ${CURRENT.units ? CURRENT.units.rows.length : 0} unit rows${CURRENT.passThrough ? ', pass-through' : ''})</span>`;
        renderForm();
        $('seii-form').style.display = '';
        $('seii-out').value = '';
        $('seii-status').textContent = '';
        applyPassThroughVisibility();
    }

    function applyPassThroughVisibility() {
        const pt = CURRENT && CURRENT.passThrough;
        const ids = ['seii-units', 'seii-addunit', 'seii-settings'];
        for (const id of ids) {
            const el = $(id); if (!el) continue;
            el.style.display = pt ? 'none' : '';
        }
        // Legacy mb_tcp_servers section is ALWAYS hidden — IPs live in the unit rows now
        const tcpwrap = $('seii-tcpwrap'); if (tcpwrap) tcpwrap.style.display = 'none';
        // Hide the "Unit rows" + "SQL command" labels too via parent walks
        document.querySelectorAll('#seii-form > label').forEach(l => {
            const t = l.textContent.trim();
            if (pt && (t.startsWith('Unit rows') || t === 'SQL command')) l.style.display = 'none';
            else l.style.display = '';
        });
        const cmd = $('seii-cmd'); if (cmd) cmd.style.display = pt ? 'none' : '';
    }

    function renderTemplateOptions(filter) {
        const sel = $('seii-tpl');
        const f = (filter || '').trim().toLowerCase();
        const items = MANIFEST.map((t, i) => ({ t, i }))
            .filter(({ t }) => !f || t.display_name.toLowerCase().includes(f) || (t.driver_type || '').toLowerCase().includes(f) || (t.file || '').toLowerCase().includes(f));
        sel.innerHTML = `<option value="">${items.length ? '— pick template —' : '— no matches —'}</option>` +
            items.map(({ t, i }) => `<option value="${i}">${escapeHtml(t.display_name)} (${escapeHtml(t.driver_type)})</option>`).join('');
    }

    async function loadManifest() {
        const sel = $('seii-tpl');
        sel.innerHTML = '<option value="">— loading… —</option>';
        try {
            const txt = await gmFetch(MANIFEST_URL);
            const json = JSON.parse(txt);
            MANIFEST = (json && json.templates) || [];
            renderTemplateOptions($('seii-search').value);
            $('seii-fileinfo').innerHTML = `<span class="ok">${MANIFEST.length} templates available.</span> Pick one above, or load from disk.`;
        } catch (e) {
            sel.innerHTML = '<option value="">— manifest load failed —</option>';
            $('seii-fileinfo').innerHTML = `<span class="err">Manifest load failed: ${escapeHtml(e.message)}.</span> You can still load a .sql from disk below.`;
        }
    }

    function renderSuggest(filter) {
        const box = $('seii-suggest');
        const f = (filter || '').trim().toLowerCase();
        if (!f) { box.classList.remove('show'); box.innerHTML = ''; return; }
        const items = MANIFEST.map((t, i) => ({ t, i }))
            .filter(({ t }) => t.display_name.toLowerCase().includes(f) || (t.driver_type || '').toLowerCase().includes(f) || (t.file || '').toLowerCase().includes(f))
            .slice(0, 12);
        if (!items.length) { box.classList.remove('show'); box.innerHTML = ''; return; }
        box.innerHTML = items.map(({ t, i }) => `<div class="item" data-idx="${i}">${escapeHtml(t.display_name)} <span style="opacity:.6">(${escapeHtml(t.driver_type)})</span></div>`).join('');
        box.classList.add('show');
    }
    async function pickTemplate(idx) {
        const t = MANIFEST[+idx]; if (!t) return;
        $('seii-tpl').value = String(idx);
        $('seii-suggest').classList.remove('show');
        $('seii-fileinfo').textContent = 'Fetching ' + t.file + '…';
        try {
            const txt = await gmFetch(REPO_BASE + '/' + encodeURIComponent(t.file));
            loadSqlText(t.file, txt, { passThrough: !!t.pass_through });
            $('seii-search').value = t.display_name;
        } catch (e) {
            $('seii-fileinfo').innerHTML = `<span class="err">Fetch failed: ${escapeHtml(e.message)}</span>`;
        }
    }
    $('seii-search').addEventListener('input', () => {
        renderTemplateOptions($('seii-search').value);
        renderSuggest($('seii-search').value);
    });
    $('seii-search').addEventListener('focus', () => renderSuggest($('seii-search').value));
    $('seii-search').addEventListener('blur', () => setTimeout(() => $('seii-suggest').classList.remove('show'), 150));
    $('seii-search').addEventListener('keydown', e => {
        const box = $('seii-suggest'); const items = [...box.querySelectorAll('.item')]; if (!items.length) return;
        const cur = items.findIndex(it => it.classList.contains('active'));
        if (e.key === 'ArrowDown') { e.preventDefault(); const n = (cur + 1) % items.length; items.forEach(i => i.classList.remove('active')); items[n].classList.add('active'); items[n].scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); const n = (cur - 1 + items.length) % items.length; items.forEach(i => i.classList.remove('active')); items[n].classList.add('active'); items[n].scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { e.preventDefault(); const pick = cur >= 0 ? items[cur] : items[0]; pickTemplate(pick.dataset.idx); }
        else if (e.key === 'Escape') { box.classList.remove('show'); }
    });
    $('seii-suggest').addEventListener('mousedown', e => {
        const it = e.target.closest('.item'); if (!it) return;
        e.preventDefault(); pickTemplate(it.dataset.idx);
    });

    $('seii-reload').onclick = (e) => { e.preventDefault(); loadManifest(); };

    $('seii-tpl').onchange = async () => {
        const idx = $('seii-tpl').value;
        if (idx === '' || idx === '__local__') return;
        const t = MANIFEST[+idx]; if (!t) return;
        $('seii-fileinfo').textContent = 'Fetching ' + t.file + '…';
        try {
            const txt = await gmFetch(REPO_BASE + '/' + encodeURIComponent(t.file));
            loadSqlText(t.file, txt, { passThrough: !!t.pass_through });
        } catch (e) {
            $('seii-fileinfo').innerHTML = `<span class="err">Fetch failed: ${escapeHtml(e.message)}</span>`;
        }
    };

    loadManifest();

    $('seii-file').addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        const fr = new FileReader();
        // Read as bytes so we can auto-detect UTF-8 vs latin1 (Norwegian SQL
        // exports from older phpMyAdmin are often latin1; reading them as
        // utf-8 mangles æ ø å).
        fr.onload = () => {
            const u8 = new Uint8Array(fr.result);
            let txt;
            try { txt = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
            catch (_) { txt = new TextDecoder('windows-1252').decode(u8); }
            const sel = $('seii-tpl');
            sel.querySelectorAll('option[data-local="1"]').forEach(o => o.remove());
            const opt = document.createElement('option');
            opt.value = '__local__'; opt.dataset.local = '1';
            opt.textContent = f.name + ' (local file)';
            sel.insertBefore(opt, sel.firstChild);
            sel.value = '__local__';
            loadSqlText(f.name, txt);
        };
        fr.readAsArrayBuffer(f);
    });

    function parseTcpServers(value) {
        // "1;ip;port;...\r\n2;ip;..." or similar → map of serverIdx -> ip (1-based in source, 0-based in driver_addr)
        const map = {};
        if (!value) return map;
        const parts = String(value).replace(/\\r\\n/g, '\n').split(/[\r\n]+/);
        for (const line of parts) {
            const cols = line.split(';');
            if (cols.length >= 2 && /^\d+$/.test(cols[0].trim())) {
                const idx = parseInt(cols[0], 10) - 1; // 1-based to 0-based
                map[idx] = cols[1].trim();
            }
        }
        return map;
    }

    function renderForm() {
        // Pre-parse existing mb_tcp_servers from template (if any) for per-unit IP defaults
        let tcpMap = {};
        if (CURRENT.settings) {
            const r = CURRENT.settings.rows.find(x => unq(x.setting) === 'mb_tcp_servers');
            if (r) tcpMap = parseTcpServers(unq(r.value));
        }

        // Units — always 3 default rows. Use the template's first row to detect prefix patterns
        // (e.g. "E099"/"Energi 99" → prefix "E"/"Energi "), then number from 01, 02, 03.
        const u = $('seii-units');
        u.innerHTML = '';
        const templateRows = (CURRENT.units && CURRENT.units.rows) || [];
        const templateRow = templateRows[0] || null;
        const firstId = templateRow ? unq(templateRow.unit_id || '') : '';
        const firstName = templateRow ? unq(templateRow.unit_name || '') : '';
        // Strip trailing digits to get the prefix: "E099" → "E", "Energi 99" → "Energi "
        const idPrefix = (firstId.match(/^(.*?)\d*$/) || ['', ''])[1] || 'U';
        const namePrefix = (firstName.match(/^(.*?)\d*$/) || ['', ''])[1] || '';
        for (let i = 0; i < 3; i++) {
            const n = String(i + 1).padStart(2, '0');
            addUnitRow({
                unit_id: idPrefix + n,
                unit_name: namePrefix ? namePrefix + n : '',
                driver_addr: `0_${i + 1}`,
                ip: '',
                _raw: templateRow,
            });
        }

        // Settings
        const s = $('seii-settings');
        s.innerHTML = '';
        if (CURRENT.settings) {
            const owner = unq(CURRENT.settings.rows[0] ? CURRENT.settings.rows[0].owner : '');
            CURRENT.settings.owner = owner;
            for (const key of EDITABLE_SETTINGS) {
                const r = CURRENT.settings.rows.find(x => unq(x.setting) === key);
                const cur = r ? unq(r.value) : '';
                const id = 'seii-set-' + key;
                let html = `<label>${key}</label>`;
                if (key === 'mb_mode') {
                    html += `<select id="${id}">${MB_MODE_OPTS.map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v} — ${t}</option>`).join('')}</select>`;
                } else if (key === 'comm_parity') {
                    html += `<select id="${id}">${PARITY_OPTS.map(([v, t]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${v} — ${t}</option>`).join('')}</select>`;
                } else if (key === 'comm_baudrate') {
                    const opts = BAUDRATE_OPTS.includes(cur) || !cur ? BAUDRATE_OPTS : [cur, ...BAUDRATE_OPTS];
                    html += `<select id="${id}">${opts.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
                } else {
                    html += `<input type="text" id="${id}" value="${escapeHtml(cur)}">`;
                }
                const div = document.createElement('div');
                div.dataset.settingKey = key;
                div.innerHTML = html;
                s.appendChild(div);
            }
            $('seii-set-mb_mode').addEventListener('change', () => {
                renumberDriverAddr($('seii-set-mb_mode').value === '2');
                syncTcpVisible();
            });
            // Always default to RTU on every template load
            $('seii-set-mb_mode').value = '0';
            syncTcpVisible();
        }

        // TCP IPs
        $('seii-ips').innerHTML = '';
        addIpRow('192.168.10.100');
    }

    function addUnitRow(u) {
        const div = document.createElement('div');
        div.className = 'row';
        div.innerHTML = `
          <input class="seii-uid" placeholder="unit_id" value="${escapeHtml(u.unit_id)}" style="flex:0 0 70px">
          <input class="seii-uname" placeholder="unit_name" value="${escapeHtml(u.unit_name)}">
          <input class="seii-uaddr" placeholder="driver_addr" value="${escapeHtml(u.driver_addr)}" style="flex:0 0 70px">
          <input class="seii-uip" placeholder="ip address" value="${escapeHtml(u.ip || '')}" style="flex:0 0 130px;display:none">
          <button class="seii-urm" title="Remove">−</button>`;
        div.dataset.raw = u._raw ? JSON.stringify(u._raw) : '';
        $('seii-units').appendChild(div);
        div.querySelector('.seii-urm').onclick = () => {
            if ($('seii-units').children.length > 1) div.remove();
        };
        syncTcpVisible();
    }
    function incLastNum(s) {
        return String(s).replace(/(\d+)(\D*)$/, (_, n, tail) => {
            const next = String(+n + 1).padStart(n.length, '0');
            return next + tail;
        });
    }
    function incFirstNum(s) {
        return String(s).replace(/(\D*)(\d+)/, (_, head, n) => {
            const next = String(+n + 1).padStart(n.length, '0');
            return head + next;
        });
    }
    $('seii-addunit').onclick = (e) => {
        e.preventDefault();
        const rows = $('seii-units').children;
        const last = rows[rows.length - 1];
        if (last) {
            const isTcp = $('seii-set-mb_mode') && $('seii-set-mb_mode').value === '2';
            const incAddr = isTcp ? incFirstNum : incLastNum;
            addUnitRow({
                unit_id: incLastNum(last.querySelector('.seii-uid').value),
                unit_name: incLastNum(last.querySelector('.seii-uname').value),
                driver_addr: incAddr(last.querySelector('.seii-uaddr').value),
                ip: last.querySelector('.seii-uip') ? incLastNum(last.querySelector('.seii-uip').value || '192.168.10.099') : '',
                _raw: null,
            });
        } else {
            addUnitRow({ unit_id: '', unit_name: '', driver_addr: '', _raw: null });
        }
    };

    function addIpRow(ip) {
        const div = document.createElement('div');
        div.className = 'row';
        div.innerHTML = `<input class="seii-ip" placeholder="192.168.10.100" value="${escapeHtml(ip || '')}"><button class="seii-iprm" title="Remove">−</button>`;
        $('seii-ips').appendChild(div);
        div.querySelector('.seii-iprm').onclick = () => {
            if ($('seii-ips').children.length > 1) div.remove();
        };
    }
    $('seii-addip').onclick = (e) => { e.preventDefault(); addIpRow(''); };

    function renumberDriverAddr(isTcp) {
        const rows = [...$('seii-units').children];
        rows.forEach((div, i) => {
            const addrEl = div.querySelector('.seii-uaddr');
            if (addrEl) addrEl.value = isTcp ? `${i + 1}_1` : `0_${i + 1}`;
            const ipEl = div.querySelector('.seii-uip');
            if (ipEl && isTcp) ipEl.value = `192.168.10.${100 + i}`;
        });
    }

    function syncTcpVisible() {
        const v = $('seii-set-mb_mode') ? $('seii-set-mb_mode').value : '0';
        const isTcp = v === '2';
        $('seii-tcpwrap').style.display = 'none';
        for (const key of ['comm_port', 'comm_baudrate', 'comm_parity']) {
            const wrap = document.querySelector(`#seii-settings [data-setting-key="${key}"]`);
            if (wrap) wrap.style.display = isTcp ? 'none' : '';
        }
        document.querySelectorAll('#seii-units .seii-uip').forEach(el => el.style.display = isTcp ? '' : 'none');
    }

    // ---------- Generate output ----------
    function buildOutput() {
        if (!CURRENT) throw new Error('Load a .sql file first.');
        if (CURRENT.passThrough) return CURRENT.sqlText;
        const cmd = $('seii-cmd') ? $('seii-cmd').value : 'INSERT INTO';
        let out = CURRENT.sqlText.replace(/\b(?:REPLACE|INSERT)\s+INTO\b/gi, cmd);

        const units = [...$('seii-units').children].map(div => ({
            unit_id: div.querySelector('.seii-uid').value.trim(),
            unit_name: div.querySelector('.seii-uname').value.trim(),
            driver_addr: div.querySelector('.seii-uaddr').value.trim(),
            ip: div.querySelector('.seii-uip') ? div.querySelector('.seii-uip').value.trim() : '',
            _raw: div.dataset.raw ? JSON.parse(div.dataset.raw) : null,
        })).filter(u => u.unit_id);
        if (!units.length) throw new Error('At least one unit row is required.');

        const settingsValues = {};
        for (const k of EDITABLE_SETTINGS) {
            const el = $('seii-set-' + k);
            if (el) settingsValues[k] = el.value.trim();
        }
        const owner = (CURRENT.settings && CURRENT.settings.owner) || '';
        const isTcp = settingsValues.mb_mode === '2';
        // Build mb_tcp_servers from per-unit IPs (one entry per unique server index from driver_addr)
        const serverMap = new Map();
        for (const u of units) {
            const m = u.driver_addr.match(/^(\d+)/);
            if (!m) continue;
            const idx = parseInt(m[1], 10);
            if (u.ip && !serverMap.has(idx)) serverMap.set(idx, u.ip);
        }
        const orderedIdx = [...serverMap.keys()].sort((a, b) => a - b);
        const tcpServers = orderedIdx.map((idx, i) => `${i + 1};${serverMap.get(idx)};502;1000;2;500`).join('\\r\\n');

        // 1) Replace iw_sys_plant_units block — remove from its original spot and move to the top
        if (CURRENT.units) {
            const cols = CURRENT.units.cols;
            const templateRaw = units.slice().reverse().find(u => u._raw)?._raw
                || (CURRENT.units.rows[CURRENT.units.rows.length - 1] || {});
            const rebuilt = units.map(u => {
                const raw = u._raw || templateRaw;
                const vals = cols.map(col => {
                    if (col === 'row_date') return /NOW\(\)/i.test(raw[col] || '') ? raw[col] : "NOW()";
                    if (col === 'unit_id') return q(u.unit_id);
                    if (col === 'unit_name') return q(u.unit_name);
                    if (col === 'driver_addr' || col === 'driver_adr') return q(u.driver_addr);
                    return raw[col] != null && raw[col] !== '' ? raw[col] : "''";
                });
                return '(' + vals.join(', ') + ')';
            });
            const colsSql = cols.map(c => '`' + c + '`').join(', ');
            const block = `${cmd} \`iw_sys_plant_units\` (${colsSql}) VALUES\n${rebuilt.join(',\n')};`;
            const u2 = parseBlock(out, 'iw_sys_plant_units');
            if (u2) {
                // Remove from original position, then prepend (with trailing blank line for readability)
                out = out.slice(0, u2.start) + out.slice(u2.end);
                out = block + '\n\n' + out.replace(/^\s+/, '');
            } else {
                out = block + '\n\n' + out.replace(/^\s+/, '');
            }
        }

        // 2) Patch settings (only the editable ones), and inject mb_tcp_servers if TCP
        const settingsBlock = parseBlock(out, 'iw_sys_plant_settings');
        if (settingsBlock) {
            const cols = settingsBlock.cols;
            const rows = settingsBlock.rows.map(r => ({ ...r }));
            for (const k of EDITABLE_SETTINGS) {
                const idx = rows.findIndex(x => unq(x.setting) === k);
                if (idx >= 0) rows[idx].value = q(settingsValues[k]);
            }
            if (isTcp) {
                // tcpServers contains literal '\r\n' escape sequences that MariaDB should
                // interpret as real CR+LF — DON'T double the backslashes (only escape quotes).
                const qServers = (s) => "'" + String(s).replace(/'/g, "''") + "'";
                const idx = rows.findIndex(x => unq(x.setting) === 'mb_tcp_servers');
                if (idx >= 0) {
                    rows[idx].value = qServers(tcpServers);
                } else {
                    const tpl = {};
                    cols.forEach(c => tpl[c] = "''");
                    if ('row_date' in tpl) tpl.row_date = 'NOW()';
                    if ('setting' in tpl) tpl.setting = q('mb_tcp_servers');
                    if ('owner' in tpl) tpl.owner = q(owner);
                    if ('value' in tpl) tpl.value = qServers(tcpServers);
                    if ('help_text' in tpl) tpl.help_text = q('ID;IPadr;IPport;ConnTout;ConnRetries;RequestTout');
                    rows.push(tpl);
                }
            }
            const lines = rows.map(r => '(' + cols.map(c => r[c] != null && r[c] !== '' ? r[c] : "''").join(', ') + ')');
            const colsSql = cols.map(c => '`' + c + '`').join(', ');
            const block = `${cmd} \`iw_sys_plant_settings\` (${colsSql}) VALUES\n${lines.join(',\n')};`;
            out = out.slice(0, settingsBlock.start) + block + out.slice(settingsBlock.end);
        }

        return out;
    }

    $('seii-gen').onclick = () => {
        try {
            const sql = buildOutput();
            $('seii-out').value = sql;
            $('seii-status').innerHTML = '<span class="ok">SQL generated.</span>';
        } catch (e) {
            $('seii-status').innerHTML = `<span class="err">${e.message}</span>`;
        }
    };
    let cmEditor = null;
    function getEditorValue() { return cmEditor ? cmEditor.getValue() : $('seii-medit').value; }
    function setEditorValue(v) { if (cmEditor) cmEditor.setValue(v); else $('seii-medit').value = v; }

    $('seii-edit').onclick = () => {
        try {
            let s = $('seii-out').value;
            if (!s) { s = buildOutput(); $('seii-out').value = s; }
            modal.classList.add('show');
            if (typeof CodeMirror !== 'undefined') {
                if (!cmEditor) {
                    cmEditor = CodeMirror.fromTextArea($('seii-medit'), {
                        mode: 'text/x-sql',
                        lineNumbers: true,
                        theme: 'eclipse',
                        lineWrapping: false,
                        viewportMargin: Infinity,
                    });
                }
                cmEditor.setValue(s);
                setTimeout(() => { cmEditor.refresh(); cmEditor.focus(); }, 0);
            } else {
                $('seii-medit').value = s;
                $('seii-medit').readOnly = false;
                $('seii-medit').focus();
            }
        } catch (e) {
            $('seii-status').innerHTML = `<span class="err">${e.message}</span>`;
        }
    };
    $('seii-mclose').onclick = () => {
        $('seii-out').value = getEditorValue();
        modal.classList.remove('show');
    };
    $('seii-mcopy').onclick = () => {
        GM_setClipboard(getEditorValue());
        $('seii-mcopy').textContent = 'Copied!';
        setTimeout(() => $('seii-mcopy').textContent = 'Copy', 1200);
    };
    // Close on backdrop click — but only when BOTH mousedown AND mouseup happen
    // on the backdrop itself. Without this, a text-selection drag that starts
    // inside the editor and ends outside it closes the modal (because the
    // browser fires `click` on the common ancestor — modal).
    let mdOnBackdrop = false;
    modal.addEventListener('mousedown', e => { mdOnBackdrop = (e.target === modal); });
    modal.addEventListener('mouseup', e => {
        if (mdOnBackdrop && e.target === modal) $('seii-mclose').click();
        mdOnBackdrop = false;
    });

    $('seii-copy').onclick = () => {
        try {
            let s = $('seii-out').value;
            if (!s) { s = buildOutput(); $('seii-out').value = s; }
            GM_setClipboard(s);
            $('seii-status').innerHTML = '<span class="ok">Copied to clipboard.</span>';
        } catch (e) {
            $('seii-status').innerHTML = `<span class="err">${e.message}</span>`;
        }
    };
})();
