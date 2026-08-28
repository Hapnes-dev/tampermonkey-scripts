// ==UserScript==
// @name         SQL Equipment Import
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @version      8.0
// @description  Floating panel on phpMyAdmin: pick a driver-template from a GitHub-hosted manifest, load a .sql file from disk, or fetch a live driver straight from any plant via the Toolbox plant-SQL API (units, settings, order_no, processes and the iw_par_/iw_set_ tables are rebuilt into a template). Edit unit rows + Modbus settings (RTU/TCP, multi-IP), emit the full SQL ready to paste into the plant DB.
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
// @connect      toolbox.iwmac.local
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
    // Toolbox plant-SQL API (same proxy the topology/AK3 scripts use): POST
    // {plant_id, sql_command} and it runs the SQL on that plant's own MariaDB.
    // Statements joined with ';' run as one batch and come back as results[i].
    const PLANT_SQL_URL = 'http://toolbox.iwmac.local:8505/plant-sql/';
    const PLANT_SCHEMA = 'iw_plant_server3';
    const SEARCH_ALL_PLANTS_URL = 'http://toolbox.iwmac.local:8501/search_all_plants';
    // The API rejects SELECTs above its max-rows setting, so page big tables.
    const FETCH_PAGE_ROWS = 5000;
    const X_CALLER = 'SQL Equipment Import';
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
    #seii-drivers{border:1px solid #bbb;border-radius:3px;max-height:180px;overflow-y:auto;margin-top:3px;display:none;background:#fff}
    #seii-drivers.show{display:block}
    #seii-drivers .drv{padding:4px 8px;cursor:pointer;border-bottom:1px solid #eee;font:12px monospace}
    #seii-drivers .drv:hover{background:#2b6cb0;color:#fff}
    #seii-drivers .drv .meta{opacity:.65;font-size:11px}
    #seii-drivers .drv:hover .meta{opacity:.9}
    #seii-plantrow a{font:11px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#2b6cb0;text-decoration:none;white-space:nowrap}
    #seii-plantrow a:hover{text-decoration:underline}
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

        <label style="margin-top:8px">…or fetch a live driver from a plant</label>
        <div class="row" id="seii-plantrow">
          <input id="seii-plant" placeholder="plant id" style="flex:0 0 90px">
          <button id="seii-plantload" style="padding:2px 8px;cursor:pointer;white-space:nowrap;width:auto">Load drivers</button>
          <input id="seii-drvfilter" placeholder="filter regulator / driver…" style="display:none">
          <a id="seii-sap" href="${SEARCH_ALL_PLANTS_URL}" target="_blank" title="Search regulators across all plants (toolbox) to find a donor plant id">🔎 all plants</a>
        </div>
        <div id="seii-drivers"></div>

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

    // ---------------- Fetch a live driver from a plant (Toolbox plant-SQL API) ----------------
    // Third template source: point the panel at any plant id, list that plant's
    // drivers straight out of its iw_sys_plant_units (driver_type + regulator
    // types + unit count), pick one, and the script rebuilds a full template —
    // units, settings (owner = driver_type), iw_sys_order_no, iw_sys_processes,
    // and every linked iw_par_<link>_groups/_param + iw_set_<base> table. The
    // CREATE TABLE statements are reassembled from information_schema because
    // the API only accepts SELECT/INSERT/UPDATE/DELETE (no SHOW CREATE TABLE).
    // The result feeds loadSqlText(), so the normal form flow takes over.
    // The 🔎 all-plants link opens the toolbox Streamlit search to find a donor
    // plant id — its all-plants dataset (db_main) has no HTTP API to query from
    // here, so cross-plant regulator search stays in that tool.

    function makeUuid() {
        return (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    }
    // X-Caller + a per-plant X-Run-Id, same convention as AK3-Autoscan and
    // Topology Copy, so one fetch reads as one operation in the Toolbox log.
    let _runId = makeUuid();
    let _runIdPlant = null;
    function ensureRunIdForPlant(plantId) {
        const pid = String(plantId || '');
        if (pid && _runIdPlant !== pid) { _runId = makeUuid(); _runIdPlant = pid; }
        return _runId;
    }

    function gmPostJson(url, payload) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest not granted'));
            GM_xmlhttpRequest({
                method: 'POST', url, timeout: 90000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-Caller': X_CALLER,
                    'X-Run-Id': _runId,
                },
                data: JSON.stringify(payload),
                onload: r => {
                    try { resolve({ status: r.status, body: JSON.parse(r.responseText) }); }
                    catch (e) {
                        // Proxy errors (504 etc.) come back as HTML — flatten to text.
                        const plain = String(r.responseText).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                        reject(new Error('Toolbox API: ' + (plain.substring(0, 160) || ('HTTP ' + r.status))));
                    }
                },
                onerror: () => reject(new Error('Toolbox API network error — are you on the IWMAC network?')),
                ontimeout: () => reject(new Error('Toolbox API timeout')),
            });
        });
    }

    // Run one or more SELECTs on a plant's own MariaDB. `statements` may be a
    // string or an array; arrays run as one semicolon-batch but are chunked so
    // a driver with many linked tables cannot blow the API's SQL-length cap.
    // Returns one result entry ({data: [...]}) per statement, in order.
    async function plantSql(plantId, statements) {
        ensureRunIdForPlant(plantId);
        const stmts = Array.isArray(statements) ? statements : [statements];
        const out = [];
        for (let i = 0; i < stmts.length; i += 8) {
            const chunk = stmts.slice(i, i + 8);
            const res = await gmPostJson(PLANT_SQL_URL, { plant_id: String(plantId), sql_command: chunk.join(';\n') });
            const body = res.body;
            if (!body || !body.success) {
                throw new Error((body && (body.error || body.message)) || ('HTTP ' + res.status));
            }
            const results = body.results || [];
            if (results.length !== chunk.length) throw new Error('Toolbox API returned ' + results.length + ' results for ' + chunk.length + ' statements');
            out.push(...results);
        }
        return out;
    }

    const isSafeIdent = (s) => /^[A-Za-z0-9_]+$/.test(String(s));

    function getPlantIdFromHost() {
        // phpMyAdmin lives on the plant server itself: "6176.plants.iwmac.local"
        const m = (location.hostname || '').match(/^(\d+)\./);
        return m ? m[1] : '';
    }

    function setPlantInfo(html, cls) {
        $('seii-fileinfo').innerHTML = cls ? `<span class="${cls}">${html}</span>` : html;
    }

    let PLANT_DRIVERS = []; // [{driver_type, n, regs}] for the currently-loaded plant

    function renderDrivers() {
        const f = ($('seii-drvfilter').value || '').trim().toLowerCase();
        const box = $('seii-drivers');
        const items = PLANT_DRIVERS.filter(d =>
            !f || String(d.driver_type).toLowerCase().includes(f) || String(d.regs || '').toLowerCase().includes(f));
        box.innerHTML = items.map(d =>
            `<div class="drv" data-drv="${escapeHtml(d.driver_type)}"><b>${escapeHtml(d.driver_type)}</b>` +
            ` <span class="meta">— ${escapeHtml(String(d.n))} unit${String(d.n) === '1' ? '' : 's'}${d.regs ? ' — ' + escapeHtml(d.regs) : ''}</span></div>`
        ).join('') || '<div class="drv"><span class="meta">no drivers match the filter</span></div>';
        box.classList.add('show');
    }

    async function loadPlantDrivers() {
        const pid = $('seii-plant').value.trim();
        const box = $('seii-drivers');
        box.innerHTML = ''; box.classList.remove('show');
        $('seii-drvfilter').style.display = 'none';
        if (!/^\d+$/.test(pid)) { setPlantInfo('Enter a numeric plant id first (use 🔎 all plants to find a donor plant).', 'err'); return; }
        setPlantInfo('Fetching driver list from plant ' + escapeHtml(pid) + '…');
        const listSql = (withRegs) =>
            `SELECT driver_type, COUNT(*) AS n` +
            (withRegs ? `, LEFT(GROUP_CONCAT(DISTINCT regulator_type ORDER BY regulator_type SEPARATOR ', '), 300) AS regs` : '') +
            ` FROM ${PLANT_SCHEMA}.iw_sys_plant_units WHERE driver_type <> '' AND unit_id <> 'SERVER'` +
            ` GROUP BY driver_type ORDER BY driver_type`;
        try {
            let rs;
            try { rs = await plantSql(pid, listSql(true)); }
            catch (e) {
                // Very old plants predate the regulator_type column.
                if (/regulator_type/i.test(e.message || '')) rs = await plantSql(pid, listSql(false));
                else throw e;
            }
            PLANT_DRIVERS = (rs[0] && rs[0].data) || [];
            if (!PLANT_DRIVERS.length) { setPlantInfo('Plant ' + escapeHtml(pid) + ' has no drivers in iw_sys_plant_units.', 'err'); return; }
            $('seii-drvfilter').style.display = '';
            renderDrivers();
            setPlantInfo(`<span class="ok">${PLANT_DRIVERS.length} drivers on plant ${escapeHtml(pid)}.</span> <span class="small">Click one to fetch it as a template.</span>`);
        } catch (err) {
            setPlantInfo('Driver list failed: ' + escapeHtml(err.message || String(err)), 'err');
        }
    }

    async function fetchDriverTemplate(plantId, driverType) {
        const p = (msg) => setPlantInfo('Fetching <b>' + escapeHtml(driverType) + '</b> from plant ' + escapeHtml(plantId) + ' — ' + msg);
        const S = PLANT_SCHEMA;
        const dq = q(driverType);

        p('system tables…');
        // Column lists first — sys table layouts differ between plant generations
        // (driver_adr vs driver_addr, optional unit_extra), so never hardcode them.
        const SYS_TABLES = ['iw_sys_plant_units', 'iw_sys_plant_settings', 'iw_sys_order_no', 'iw_sys_processes'];
        const colsRes = await plantSql(plantId,
            `SELECT table_name, column_name FROM information_schema.columns ` +
            `WHERE table_schema=${q(S)} AND table_name IN (${SYS_TABLES.map(q).join(',')}) ORDER BY table_name, ordinal_position`);
        const sysCols = {};
        for (const r of (colsRes[0].data || [])) {
            (sysCols[r.table_name] = sysCols[r.table_name] || []).push(r.column_name);
        }
        for (const t of ['iw_sys_plant_units', 'iw_sys_plant_settings']) {
            if (!sysCols[t]) throw new Error('Source plant has no ' + t + ' table');
        }
        // CAST everything AS CHAR: datetimes arrive as '2016-04-21 07:21:45'
        // instead of the API's JSON date form, and numbers quote back safely.
        const castList = (cols) => cols.map(c => `CAST(\`${c}\` AS CHAR) AS \`${c}\``).join(', ');
        const selCast = (tbl, where) => `SELECT ${castList(sysCols[tbl])} FROM ${S}.\`${tbl}\`${where}`;

        const sysSel = [
            selCast('iw_sys_plant_units', ` WHERE driver_type=${dq} ORDER BY unit_id`),
            selCast('iw_sys_plant_settings', ` WHERE owner=${dq} ORDER BY setting`),
        ];
        if (sysCols.iw_sys_order_no) sysSel.push(selCast('iw_sys_order_no', ` WHERE order_no IN (SELECT DISTINCT order_no FROM ${S}.iw_sys_plant_units WHERE driver_type=${dq})`));
        if (sysCols.iw_sys_processes) sysSel.push(selCast('iw_sys_processes', ` WHERE process_name=${dq}`));
        const sysRes = await plantSql(plantId, sysSel);
        const units = (sysRes[0] && sysRes[0].data) || [];
        const settings = (sysRes[1] && sysRes[1].data) || [];
        const orders = (sysCols.iw_sys_order_no && sysRes[2] && sysRes[2].data) || [];
        const procs = (sysCols.iw_sys_processes && sysRes[3] && sysRes[3].data) || [];
        if (!units.length) throw new Error('No units with driver_type ' + driverType + ' on plant ' + plantId);

        // Order rows → the driver's parameter tables:
        // group_link 'x_groups' → iw_par_x_groups, db_link 'x_param' → iw_par_x_param,
        // and db_link minus its _param suffix → iw_set_x.
        const wanted = [];
        for (const o of orders) {
            const dbl = String(o.db_link || ''), grl = String(o.group_link || '');
            if (grl) wanted.push('iw_par_' + grl);
            if (dbl) {
                wanted.push('iw_par_' + dbl);
                wanted.push('iw_set_' + dbl.replace(/_param$/, ''));
            }
        }
        const tables = [...new Set(wanted)].filter(isSafeIdent);

        p('table definitions…');
        const tblMeta = {}, tblCols = {}, tblIdx = {};
        if (tables.length) {
            const inList = tables.map(q).join(',');
            const [metaR, colR, idxR] = await plantSql(plantId, [
                `SELECT table_name, engine, table_collation, table_comment FROM information_schema.tables WHERE table_schema=${q(S)} AND table_name IN (${inList})`,
                `SELECT table_name, column_name, column_type, is_nullable, column_default, extra FROM information_schema.columns WHERE table_schema=${q(S)} AND table_name IN (${inList}) ORDER BY table_name, ordinal_position`,
                `SELECT table_name, index_name, non_unique, seq_in_index, column_name, sub_part FROM information_schema.statistics WHERE table_schema=${q(S)} AND table_name IN (${inList}) ORDER BY table_name, index_name, seq_in_index`,
            ]);
            for (const r of (metaR.data || [])) tblMeta[r.table_name] = r;
            for (const r of (colR.data || [])) (tblCols[r.table_name] = tblCols[r.table_name] || []).push(r);
            for (const r of (idxR.data || [])) (tblIdx[r.table_name] = tblIdx[r.table_name] || []).push(r);
        }
        const existing = tables.filter(t => tblMeta[t] && tblCols[t]);
        const missing = tables.filter(t => !tblMeta[t] || !tblCols[t]);

        p('table data…');
        const dataSel = (t, offset) =>
            `SELECT ${tblCols[t].map(c => `CAST(\`${c.column_name}\` AS CHAR) AS \`${c.column_name}\``).join(', ')}` +
            ` FROM ${S}.\`${t}\` LIMIT ${FETCH_PAGE_ROWS}` + (offset ? ` OFFSET ${offset}` : '');
        const tblData = {};
        if (existing.length) {
            const firstRes = await plantSql(plantId, existing.map(t => dataSel(t, 0)));
            existing.forEach((t, i) => { tblData[t] = (firstRes[i] && firstRes[i].data) || []; });
            for (const t of existing) {
                // A table that filled a whole page may have more rows — keep paging.
                while (tblData[t].length > 0 && tblData[t].length % FETCH_PAGE_ROWS === 0) {
                    p('table data… (' + escapeHtml(t) + ': ' + tblData[t].length + '+ rows)');
                    const more = await plantSql(plantId, dataSel(t, tblData[t].length));
                    const rows = (more[0] && more[0].data) || [];
                    if (!rows.length) break;
                    tblData[t].push(...rows);
                }
            }
        }

        // ---- assemble the template text ----
        function colDefSql(c) {
            let s = '`' + c.column_name + '` ' + c.column_type;
            const nullable = String(c.is_nullable).toUpperCase() === 'YES';
            if (!nullable) s += ' NOT NULL';
            const d = c.column_default;
            if (d === null || d === undefined) {
                if (nullable) s += ' DEFAULT NULL';
            } else if (/^current_timestamp(\(\))?$/i.test(d)) {
                s += ' DEFAULT CURRENT_TIMESTAMP';
            } else if (/^'[\s\S]*'$/.test(d)) {
                s += ' DEFAULT ' + d; // newer MariaDB already returns the default SQL-quoted
            } else {
                s += ' DEFAULT ' + q(d);
            }
            if (c.extra && /auto_increment/i.test(c.extra)) s += ' AUTO_INCREMENT';
            return s;
        }
        function createTableSql(t) {
            const lines = tblCols[t].map(colDefSql);
            const byIdx = {};
            for (const r of (tblIdx[t] || [])) (byIdx[r.index_name] = byIdx[r.index_name] || []).push(r);
            for (const name of Object.keys(byIdx)) {
                const parts = byIdx[name]
                    .sort((a, b) => Number(a.seq_in_index) - Number(b.seq_in_index))
                    .map(r => '`' + r.column_name + '`' + (r.sub_part != null && r.sub_part !== '' ? '(' + r.sub_part + ')' : ''));
                if (name === 'PRIMARY') lines.push('PRIMARY KEY (' + parts.join(',') + ')');
                else if (String(byIdx[name][0].non_unique) === '0') lines.push('UNIQUE KEY `' + name + '` (' + parts.join(',') + ')');
                else lines.push('KEY `' + name + '` (' + parts.join(',') + ')');
            }
            const meta = tblMeta[t];
            const charset = String(meta.table_collation || 'latin1_swedish_ci').split('_')[0];
            let tail = ') ENGINE=' + (meta.engine || 'MyISAM') + ' DEFAULT CHARSET=' + charset;
            if (meta.table_comment) tail += ' COMMENT=' + q(meta.table_comment);
            return 'CREATE TABLE IF NOT EXISTS `' + t + '` (\n  ' + lines.join(',\n  ') + '\n' + tail + ';';
        }
        function insertBlock(tbl, cols, rows, nowDate) {
            if (!rows.length) return '';
            const colsSql = cols.map(c => '`' + c + '`').join(', ');
            const tuples = rows.map(r => '(' + cols.map(c => {
                if (nowDate && c === 'row_date') return 'NOW()';
                const v = r[c];
                return v === null || v === undefined ? "''" : q(v);
            }).join(', ') + ')');
            return 'REPLACE INTO `' + tbl + '` (' + colsSql + ') VALUES\n' + tuples.join(',\n') + ';';
        }

        const parts = [];
        parts.push('-- Fetched live from plant ' + plantId + ', driver ' + driverType + ', by ' + X_CALLER);
        if (missing.length) parts.push('-- WARNING: linked tables missing on the source plant, not included: ' + missing.join(', '));
        if (!orders.length) parts.push('-- WARNING: no iw_sys_order_no rows found for this driver, so no iw_par_/iw_set_ tables are included.');
        parts.push('');
        parts.push(insertBlock('iw_sys_plant_units', sysCols.iw_sys_plant_units, units, true));
        if (settings.length) parts.push('\n' + insertBlock('iw_sys_plant_settings', sysCols.iw_sys_plant_settings, settings, true));
        else parts.push('\n-- (no iw_sys_plant_settings rows with owner ' + driverType + ' on the source plant)');
        if (orders.length) parts.push('\n' + insertBlock('iw_sys_order_no', sysCols.iw_sys_order_no, orders, true));
        if (procs.length) parts.push('\n' + insertBlock('iw_sys_processes', sysCols.iw_sys_processes, procs, true));
        for (const t of existing) {
            parts.push('\n' + createTableSql(t));
            const block = insertBlock(t, tblCols[t].map(c => c.column_name), tblData[t], false);
            if (block) parts.push('\n' + block);
        }
        return parts.join('\n') + '\n';
    }

    $('seii-plant').value = getPlantIdFromHost();
    $('seii-plantload').onclick = (e) => { e.preventDefault(); loadPlantDrivers(); };
    $('seii-plant').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadPlantDrivers(); } });
    $('seii-drvfilter').addEventListener('input', renderDrivers);
    let _fetchBusy = false;
    $('seii-drivers').addEventListener('click', async (e) => {
        const it = e.target.closest('.drv');
        if (!it || !it.dataset.drv || _fetchBusy) return;
        const pid = $('seii-plant').value.trim();
        const drv = it.dataset.drv;
        _fetchBusy = true;
        try {
            const sql = await fetchDriverTemplate(pid, drv);
            loadSqlText('plant ' + pid + ' · ' + drv, sql);
            $('seii-drivers').classList.remove('show');
            $('seii-tpl').value = '';
            $('seii-search').value = '';
        } catch (err) {
            setPlantInfo('Fetch failed: ' + escapeHtml(err.message || String(err)), 'err');
        } finally {
            _fetchBusy = false;
        }
    });

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

    // ---------- Unit numbering ----------
    // A template numbers each unit in up to three places that have to agree: the
    // trailing number of unit_id, the same number wherever it appears inside
    // unit_name, and the unit slot of driver_addr. A "pattern" is the template's
    // own string with that number replaced by a slot, so a row number can be
    // substituted back while keeping the template's zero padding:
    // "U50" → "U01", "F50 Plug-In50" → "F01 Plug-In01".
    // Digit groups that are not the unit number — "350 Kjølemaskin",
    // "IR33 Universal … - 1" — are left exactly as the template wrote them.
    const NUM_SLOT = '\u0000';
    let NUMBERING = null; // { id, name } derived from the template's first unit

    function fillPattern(p, n) {
        if (!p) return '';
        return p.tpl.split(NUM_SLOT).join(String(n).padStart(p.width, '0'));
    }
    // Trailing number of a string, or null when it has none.
    function numOf(s) {
        const m = String(s == null ? '' : s).match(/(\d+)\D*$/);
        return m ? parseInt(m[1], 10) : null;
    }
    // Slot the trailing digit group; append a slot when there is no number.
    function patternFromLast(s) {
        const str = String(s == null ? '' : s);
        const m = str.match(/^([\s\S]*?)(\d+)(\D*)$/);
        if (!m) return { tpl: str + NUM_SLOT, width: 2 };
        return { tpl: m[1] + NUM_SLOT + m[3], width: m[2].length };
    }
    // Slot every digit group whose value is `num`; null when none of them is.
    function patternFromValue(s, num) {
        let width = 0, hit = false;
        const tpl = String(s == null ? '' : s).replace(/\d+/g, g => {
            if (parseInt(g, 10) !== num) return g;
            hit = true;
            width = Math.max(width, g.length);
            return NUM_SLOT;
        });
        return hit ? { tpl, width } : null;
    }
    // Best evidence of all: the template's own consecutive unit rows. A digit
    // group that advances by one from row to row is the unit counter; one that
    // repeats is part of the name ("Carel PR100" ×3, "PCO3"). Returns a fixed
    // pattern (width 0) when the rows carry no counter at all.
    function patternFromSeries(values) {
        // Two rows only: templates commonly restart their run further down
        // (IJsmall goes F50, F51, F52, F50), so testing every sampled row
        // would read the repeat as "no counter" and freeze the name. Trimmed,
        // because one template ships a trailing space on its first unit name.
        const rows = values.map(v => String(v == null ? '' : v).trim())
            .filter(v => v !== '').slice(0, 2);
        if (rows.length < 2) return null;
        const shape = s => s.replace(/\d+/g, NUM_SLOT);
        if (shape(rows[1]) !== shape(rows[0])) return null;
        const nums = rows.map(s => (s.match(/\d+/g) || []).map(g => parseInt(g, 10)));
        if (!nums[0].length) return null;
        const isCounter = nums[0].map((v, g) => nums[1][g] === v + 1);
        if (!isCounter.some(Boolean)) return { tpl: rows[0], width: 0 };
        let g = -1, width = 0;
        const tpl = rows[0].replace(/\d+/g, m => {
            g++;
            if (!isCounter[g]) return m;
            width = Math.max(width, m.length);
            return NUM_SLOT;
        });
        return { tpl, width };
    }
    // `ids` / `names` are the template's first few unit rows, most significant first.
    function setNumbering(ids, names) {
        const uid = ids[0] || '';
        const uname = names[0] || '';
        // A unit_id must stay unique, so never accept a fixed pattern for it.
        const idSeries = patternFromSeries(ids);
        const id = (idSeries && idSeries.width ? idSeries : null)
            || (uid ? patternFromLast(uid) : { tpl: 'U' + NUM_SLOT, width: 2 });
        const n = numOf(uid);
        let name = { tpl: '', width: 0 };
        if (uname) {
            name = patternFromSeries(names)
                || (n === null ? null : patternFromValue(uname, n))
                // Digits that are not the unit number are a model number
                // ("PCO3", "350 Kjølemaskin") — appending to them invents a
                // different model, so leave such a name exactly as written.
                || (/\d/.test(uname) ? { tpl: uname, width: 0 }
                    : { tpl: uname + NUM_SLOT, width: id.width });
        }
        NUMBERING = { id, name };
    }
    // Renumber every unit row, row 1 taking number `from`. `skipEl` is left
    // untouched so the field being typed into does not lose its caret.
    function renumberUnits(from, skipEl) {
        if (!NUMBERING) return;
        const isTcp = $('seii-set-mb_mode') && $('seii-set-mb_mode').value === '2';
        [...$('seii-units').children].forEach((div, i) => {
            const n = from + i;
            const idEl = div.querySelector('.seii-uid');
            const nameEl = div.querySelector('.seii-uname');
            const addrEl = div.querySelector('.seii-uaddr');
            if (idEl && idEl !== skipEl) idEl.value = fillPattern(NUMBERING.id, n);
            if (nameEl && nameEl !== skipEl) nameEl.value = fillPattern(NUMBERING.name, n);
            if (addrEl && addrEl !== skipEl) addrEl.value = isTcp ? `${i + 1}_1` : `0_${n}`;
            const ipEl = div.querySelector('.seii-uip');
            if (ipEl && isTcp && ipEl !== skipEl) ipEl.value = `192.168.10.${100 + i}`;
        });
    }

    function renderForm() {
        // Pre-parse existing mb_tcp_servers from template (if any) for per-unit IP defaults
        let tcpMap = {};
        if (CURRENT.settings) {
            const r = CURRENT.settings.rows.find(x => unq(x.setting) === 'mb_tcp_servers');
            if (r) tcpMap = parseTcpServers(unq(r.value));
        }

        // Units — always 3 default rows numbered 1, 2, 3, shaped by the template's
        // first row: "U50"/"F50 Plug-In50" → "U01"/"F01 Plug-In01", "U02"/"F02 Plug-In02", …
        const u = $('seii-units');
        u.innerHTML = '';
        const templateRows = (CURRENT.units && CURRENT.units.rows) || [];
        const templateRow = templateRows[0] || null;
        const sample = templateRows.slice(0, 4);
        setNumbering(
            sample.map(r => unq(r.unit_id || '')),
            sample.map(r => unq(r.unit_name || ''))
        );
        for (let i = 0; i < 3; i++) {
            addUnitRow({
                unit_id: fillPattern(NUMBERING.id, i + 1),
                unit_name: fillPattern(NUMBERING.name, i + 1),
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
        if (!last) {
            addUnitRow({ unit_id: '', unit_name: '', driver_addr: '', _raw: null });
            return;
        }
        const isTcp = $('seii-set-mb_mode') && $('seii-set-mb_mode').value === '2';
        const lastId = last.querySelector('.seii-uid').value;
        const n = numOf(lastId);
        // Follow the template's pattern while the last row still matches it, so
        // the number lands in the same place the template put it. Once the row
        // has been hand-edited into something else, fall back to plain increment.
        const onPattern = NUMBERING && n !== null && fillPattern(NUMBERING.id, n) === lastId;
        addUnitRow({
            unit_id: onPattern ? fillPattern(NUMBERING.id, n + 1) : incLastNum(lastId),
            unit_name: onPattern ? fillPattern(NUMBERING.name, n + 1) : incLastNum(last.querySelector('.seii-uname').value),
            driver_addr: isTcp
                ? incFirstNum(last.querySelector('.seii-uaddr').value)
                : (n === null ? incLastNum(last.querySelector('.seii-uaddr').value) : `0_${n + 1}`),
            ip: last.querySelector('.seii-uip') ? incLastNum(last.querySelector('.seii-uip').value || '192.168.10.099') : '',
            _raw: null,
        });
    };

    // Row 1 defines the block: retyping its unit_id re-derives the ID pattern and
    // renumbers every row below it, keeping unit_name and driver_addr in step.
    $('seii-units').addEventListener('input', (e) => {
        if (!e.target.classList.contains('seii-uid')) return;
        const div = e.target.closest('.row');
        if (!div || div !== $('seii-units').firstElementChild) return;
        const n = numOf(e.target.value);
        if (n === null) return; // still mid-typing, no number to key off yet
        NUMBERING = {
            id: patternFromLast(e.target.value),
            name: (NUMBERING && NUMBERING.name) || { tpl: '', width: 0 },
        };
        renumberUnits(n, e.target);
    });

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
            // RTU follows the row's own unit number so a hand-edited ID keeps its
            // address; TCP server prefixes stay contiguous from 1 by index.
            const n = numOf(div.querySelector('.seii-uid').value);
            if (addrEl) addrEl.value = isTcp ? `${i + 1}_1` : `0_${n === null ? i + 1 : n}`;
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
