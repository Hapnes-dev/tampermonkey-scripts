// ==UserScript==
// @name         SQL Equipment Import
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @version      9.4
// @description  Floating panel on phpMyAdmin: search any plant's equipment by unit_name / grp_name / driver_type / regulator_type / order_no and fetch it live via the Toolbox plant-SQL API (settings, order_no, processes and the iw_par_/iw_set_ tables are rebuilt into a template with 3 example units), or load a .sql from disk. Edit unit rows + Modbus settings (RTU/TCP, multi-IP), emit the full SQL ready to paste into the plant DB.
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
    // Toolbox plant-SQL API (same proxy the topology/AK3 scripts use): POST
    // {plant_id, sql_command} and it runs the SQL on that plant's own MariaDB.
    // Statements joined with ';' run as one batch and come back as results[i].
    const PLANT_SQL_URL = 'http://toolbox.iwmac.local:8505/plant-sql/';
    const PLANT_SCHEMA = 'iw_plant_server3';
    // Toolbox local MariaDB (same API family) — holds the fleet equipment index
    // that powers searching WITHOUT a plant id. Each successful per-plant load
    // refreshes that plant's slice, so the index grows with use.
    const TOOLBOX_SQL_URL = 'http://toolbox.iwmac.local:8505/toolbox-sql/';
    // The index lives in this tool's own `sql_equipment_import.templates` table
    // — created for the v2.0 DB-backed templates that v3.0 dropped, empty ever
    // since. Reusing it means fleet search needs NO manual DDL: the toolbox-sql
    // API blocks CREATE, so a dedicated table could only be made by hand.
    // Index rows are marked by the `eqidx:` name prefix and never collide with
    // template rows. Column use per equipment (plant_id, driver_type, order_no):
    //   name         eqidx:<plant_id>:<driver_type>:<order_no>   (unique key)
    //   display_name <plant_id>
    //   driver_type  <driver_type>
    //   sql_text     search haystack, line-separated:
    //                order_no \n regulator types \n unit count \n unit names \n grp names
    //   notes        human marker for anyone browsing the table
    const IDX_TABLE = 'sql_equipment_import.templates';
    const IDX_PREFIX = 'eqidx:';
    const IDX_NOTE = 'SQL Equipment Import fleet index row (not a template)';
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
    #seii-drivers{border:1px solid #bbb;border-radius:3px;max-height:220px;overflow-y:auto;margin-top:3px;display:none;background:#fff}
    #seii-drivers.show{display:block}
    #seii-drivers .drv{padding:4px 8px;cursor:pointer;border-bottom:1px solid #eee;font:12px monospace}
    #seii-drivers .drv:hover{background:#2b6cb0;color:#fff}
    #seii-drivers .drv .meta{opacity:.65;font-size:11px}
    #seii-drivers .drv:hover .meta{opacity:.9}
    #seii-drivers .drv.sub{padding-left:24px}
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
        <label>Search equipment</label>
        <div class="row" id="seii-plantrow">
          <input id="seii-plant" placeholder="plant id (blank = fleet)" style="flex:0 0 120px" title="Blank = search every indexed plant; enter a plant id to browse just that plant">
          <button id="seii-plantload" style="padding:2px 8px;cursor:pointer;white-space:nowrap;width:auto">Load equipment</button>
          <a id="seii-sap" href="${SEARCH_ALL_PLANTS_URL}" target="_blank" title="The toolbox all-plants search (db_main) — covers plants the fleet index does not">🔎 all plants</a>
        </div>
        <div class="row" style="margin-top:3px">
          <input id="seii-search" placeholder="search unit_name, grp_name, driver_type, regulator_type, order_no…" autocomplete="off">
        </div>
        <div id="seii-drivers"></div>

        <label class="small" style="margin-top:8px">…or load a .sql from disk</label>
        <input type="file" id="seii-file" accept=".sql,text/plain">
        <div id="seii-fileinfo" class="small">Type in the search bar to search the whole indexed fleet — or enter a plant id to browse one plant, or load a .sql from disk.</div>

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

    function makeRunId() {
        // Random part FIRST: the API dashboard truncates the id to its first
        // characters, and plant pages are plain http where crypto.randomUUID
        // does not exist — a timestamp-led fallback made every session display
        // as "mt…". crypto.getRandomValues works fine on http.
        let rnd;
        try {
            const b = new Uint8Array(5);
            crypto.getRandomValues(b);
            rnd = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            rnd = Math.random().toString(36).slice(2, 12);
        }
        return rnd + '-' + Date.now().toString(36);
    }
    // X-Caller + a per-plant X-Run-Id, same convention as AK3-Autoscan and
    // Topology Copy, so one fetch reads as one operation in the Toolbox log.
    let _runId = makeRunId();
    let _runIdPlant = null;
    function ensureRunIdForPlant(plantId) {
        const pid = String(plantId || '');
        if (pid && _runIdPlant !== pid) { _runId = makeRunId(); _runIdPlant = pid; }
        return _runId;
    }

    function gmPostJson(url, payload) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest not granted'));
            GM_xmlhttpRequest({
                method: 'POST', url, timeout: 90000,
                // The plant-SQL API is header-identified only — never let browser
                // cookies (e.g. the Streamlit session on the same host) ride along.
                anonymous: true,
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

    // Same batching contract as plantSql, but against the toolbox local MariaDB.
    async function toolboxSql(statements) {
        const stmts = Array.isArray(statements) ? statements : [statements];
        const out = [];
        for (let i = 0; i < stmts.length; i += 8) {
            const chunk = stmts.slice(i, i + 8);
            const res = await gmPostJson(TOOLBOX_SQL_URL, { sql_command: chunk.join(';\n') });
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
    // LIKE literals: wildcards/backslashes in the text are escaped so they match
    // literally (q() then doubles the backslash, which the string literal undoes,
    // leaving LIKE with an escaped wildcard). `likeQ` matches anywhere,
    // `likePrefixQ` anchors to the start.
    const likeEsc = (s) => String(s).replace(/[\\%_]/g, c => '\\' + c);
    const likeQ = (s) => q('%' + likeEsc(s) + '%');
    const likePrefixQ = (s) => q(likeEsc(s) + '%');

    function getPlantIdFromHost() {
        // phpMyAdmin lives on the plant server itself: "6176.plants.iwmac.local"
        const m = (location.hostname || '').match(/^(\d+)\./);
        return m ? m[1] : '';
    }

    function setPlantInfo(html, cls) {
        $('seii-fileinfo').innerHTML = cls ? `<span class="${cls}">${html}</span>` : html;
    }

    // One entry per driver process, each with its equipment (one per order_no —
    // an order_no is one param list, i.e. one regulator/device model). The
    // aggregated unames/grps/regs strings exist so the search bar can match
    // unit_name, grp_name, driver_type, regulator_type and order_no.
    let PLANT_DRIVERS = []; // [{driver_type, n, regs, unames, grps, orders: [{order_no, n, regs, unames, grps}]}]
    let _loadBusy = false;
    let _driversLoadedFor = null; // plant id the current PLANT_DRIVERS belongs to

    const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

    function renderDrivers() {
        const f = ($('seii-search').value || '').trim().toLowerCase();
        const box = $('seii-drivers');
        const hit = (...vals) => vals.some(v => String(v || '').toLowerCase().includes(f));
        const html = [];
        for (const d of PLANT_DRIVERS) {
            // A driver-name match shows the whole group; an equipment-level match
            // (unit_name / grp_name / regulator_type / order_no) narrows the
            // sub-rows to just the equipment that actually matched.
            const drvMatch = !f || hit(d.driver_type);
            const subs = drvMatch ? d.orders : d.orders.filter(o => hit(o.order_no, o.regs, o.unames, o.grps));
            if (!drvMatch && !subs.length) continue;
            const multi = d.orders.length > 1;
            // Unit NAMES are searchable but deliberately not displayed —
            // the rows show only counts and regulator types.
            html.push(`<div class="drv" data-drv="${escapeHtml(d.driver_type)}"><b>${escapeHtml(d.driver_type)}</b>` +
                ` <span class="meta">— ${d.n} unit${d.n === 1 ? '' : 's'}` +
                (multi ? ` — ${d.orders.length} equipment — fetches ALL of them`
                       : (d.regs ? ' — ' + escapeHtml(d.regs) : '')) +
                '</span></div>');
            if (multi) {
                for (const o of subs) {
                    html.push(`<div class="drv sub" data-drv="${escapeHtml(d.driver_type)}" data-order="${escapeHtml(o.order_no)}">` +
                        `↳ ${escapeHtml(o.order_no || '(no order_no)')}` +
                        ` <span class="meta">— ${o.n} unit${o.n === 1 ? '' : 's'}${o.regs ? ' — ' + escapeHtml(o.regs) : ''}</span></div>`);
                }
            }
        }
        box.innerHTML = html.join('') || '<div class="drv"><span class="meta">no equipment matches the search</span></div>';
        box.classList.add('show');
    }

    async function loadPlantDrivers() {
        const pid = $('seii-plant').value.trim();
        const box = $('seii-drivers');
        if (_loadBusy) return;
        box.innerHTML = ''; box.classList.remove('show');
        if (!/^\d+$/.test(pid)) { setPlantInfo('Enter a numeric plant id first (use 🔎 all plants to find a donor plant).', 'err'); return; }
        setPlantInfo('Fetching equipment list from plant ' + escapeHtml(pid) + '…');
        const listSql = (withRegs) =>
            `SELECT driver_type, order_no, COUNT(*) AS n` +
            (withRegs ? `, LEFT(GROUP_CONCAT(DISTINCT regulator_type ORDER BY regulator_type SEPARATOR ', '), 300) AS regs` : '') +
            `, LEFT(GROUP_CONCAT(DISTINCT unit_name ORDER BY unit_name SEPARATOR ', '), 500) AS unames` +
            `, LEFT(GROUP_CONCAT(DISTINCT grp_name ORDER BY grp_name SEPARATOR ', '), 300) AS grps` +
            ` FROM ${PLANT_SCHEMA}.iw_sys_plant_units WHERE driver_type <> '' AND unit_id <> 'SERVER'` +
            ` GROUP BY driver_type, order_no ORDER BY driver_type, order_no`;
        _loadBusy = true;
        try {
            let rs;
            try { rs = await plantSql(pid, listSql(true)); }
            catch (e) {
                // Very old plants predate the regulator_type column.
                if (/regulator_type/i.test(e.message || '')) rs = await plantSql(pid, listSql(false));
                else throw e;
            }
            const rows = (rs[0] && rs[0].data) || [];
            const byDrv = new Map();
            for (const r of rows) {
                const key = String(r.driver_type);
                if (!byDrv.has(key)) byDrv.set(key, { driver_type: key, n: 0, regsList: [], unamesList: [], grpsList: [], orders: [] });
                const d = byDrv.get(key);
                const n = Number(r.n) || 0;
                d.n += n;
                d.orders.push({
                    order_no: String(r.order_no == null ? '' : r.order_no), n,
                    regs: String(r.regs || ''), unames: String(r.unames || ''), grps: String(r.grps || ''),
                });
                if (r.regs) d.regsList.push(String(r.regs));
                if (r.unames) d.unamesList.push(String(r.unames));
                if (r.grps) d.grpsList.push(String(r.grps));
            }
            PLANT_DRIVERS = [...byDrv.values()].map(d => ({
                driver_type: d.driver_type, n: d.n, orders: d.orders,
                regs: [...new Set(d.regsList.join(', ').split(', ').filter(Boolean))].slice(0, 8).join(', '),
                unames: d.unamesList.join(', '),
                grps: d.grpsList.join(', '),
            }));
            if (!PLANT_DRIVERS.length) { _driversLoadedFor = null; setPlantInfo('Plant ' + escapeHtml(pid) + ' has no equipment in iw_sys_plant_units.', 'err'); return; }
            _driversLoadedFor = pid;
            renderDrivers();
            setPlantInfo(`<span class="ok">${PLANT_DRIVERS.length} drivers / ${rows.length} equipment on plant ${escapeHtml(pid)}.</span> <span class="small">Search above, then click an ↳ equipment row to fetch just that one; the driver row fetches everything on it.</span>`);
            // Refresh this plant's slice of the fleet index in the background.
            upsertIndex(pid, rows).catch(e => console.debug('[SQL Equipment Import] index refresh skipped:', e.message || e));
        } catch (err) {
            _driversLoadedFor = null;
            setPlantInfo('Equipment list failed: ' + escapeHtml(err.message || String(err)), 'err');
        } finally {
            _loadBusy = false;
        }
    }

    // ---- fleet index: search every indexed plant without knowing a plant id ----
    // Any index failure latches for the session: repeated failing calls trip the
    // API's error protection and then surface as misleading connection-level
    // "network error"s, so one clean failure is reported and no more are made.
    let _idxDown = null; // null = fine, string = why it is disabled

    const idxKey = (pid, drv, ord) =>
        (IDX_PREFIX + pid + ':' + String(drv) + ':' + String(ord)).slice(0, 150);

    async function upsertIndex(pid, rows) {
        if (_idxDown) return;
        const p = Number(pid);
        // Rewrite this plant's slice: DELETE drops equipment that is gone, the
        // upsert refreshes the rest. Chunked so no statement gets near the
        // API's 64KB SQL cap.
        const stmts = [`DELETE FROM ${IDX_TABLE} WHERE name LIKE ${likePrefixQ(IDX_PREFIX + p + ':')}`];
        for (let i = 0; i < rows.length; i += 25) {
            const vals = rows.slice(i, i + 25).map(r => {
                const drv = String(r.driver_type || '').slice(0, 50);
                const ord = String(r.order_no == null ? '' : r.order_no);
                const hay = [ord, String(r.regs || ''), String(Number(r.n) || 0),
                             String(r.unames || ''), String(r.grps || '')].join('\n');
                return `(${q(idxKey(p, drv, ord))}, ${q(String(p))}, ${q(drv)}, ${q(hay)}, ${q(IDX_NOTE)}, NOW())`;
            });
            stmts.push(`INSERT INTO ${IDX_TABLE} (name, display_name, driver_type, sql_text, notes, created_at) VALUES\n${vals.join(',\n')}\n` +
                `ON DUPLICATE KEY UPDATE display_name=VALUES(display_name), driver_type=VALUES(driver_type), sql_text=VALUES(sql_text), notes=VALUES(notes)`);
        }
        try { await toolboxSql(stmts); }
        catch (e) { _idxDown = e.message || String(e); throw e; }
    }

    async function searchFleetIndex(qraw) {
        const pat = likeQ(qraw);
        // Only the first 3 haystack lines come back (order_no, regulators,
        // unit count) — the unit/grp names are searched server-side but never
        // transferred or displayed.
        const sql = `SELECT display_name AS plant_id, driver_type, SUBSTRING_INDEX(sql_text, '\\n', 3) AS head FROM ${IDX_TABLE}` +
            ` WHERE name LIKE ${likePrefixQ(IDX_PREFIX)} AND (driver_type LIKE ${pat} OR sql_text LIKE ${pat})` +
            ` ORDER BY CAST(display_name AS UNSIGNED) DESC, driver_type LIMIT 60`;
        const rs = await toolboxSql(sql);
        return ((rs[0] && rs[0].data) || []).map(r => {
            const head = String(r.head || '').split('\n');
            return {
                plant_id: String(r.plant_id || ''),
                driver_type: String(r.driver_type || ''),
                order_no: head[0] || '',
                regs: head[1] || '',
                n_units: Number(head[2]) || 0,
            };
        });
    }

    function renderFleetResults(rows) {
        const box = $('seii-drivers');
        box.innerHTML = rows.map(r => {
            const pid = r.plant_id;
            if (!/^\d+$/.test(pid)) return '';
            return `<div class="drv" data-plant="${pid}" data-drv="${escapeHtml(r.driver_type)}" data-order="${escapeHtml(r.order_no)}">` +
                `<b>${escapeHtml(r.driver_type)}</b>${r.order_no ? ' ↳ ' + escapeHtml(r.order_no) : ''}` +
                ` <span class="meta">— plant ${pid} — ${r.n_units} unit${r.n_units === 1 ? '' : 's'}` +
                `${r.regs ? ' — ' + escapeHtml(clip(r.regs, 60)) : ''}</span></div>`;
        }).join('') || '<div class="drv"><span class="meta">no indexed equipment matches — the index covers plants this tool has loaded</span></div>';
        box.classList.add('show');
    }

    // orderNo === null → the whole driver (every equipment on it); an order_no
    // string (may be '') → only that equipment: its units, its iw_sys_order_no
    // row and its own par/groups/set tables. Settings + the process row belong
    // to the hosting driver process and are included either way.
    async function fetchDriverTemplate(plantId, driverType, orderNo) {
        const what = escapeHtml(driverType) + (orderNo !== null ? ' · ' + escapeHtml(orderNo || '(no order_no)') : '');
        const p = (msg) => setPlantInfo('Fetching <b>' + what + '</b> from plant ' + escapeHtml(plantId) + ' — ' + msg);
        const S = PLANT_SCHEMA;
        const dq = q(driverType);
        const unitWhere = ` WHERE driver_type=${dq}` + (orderNo !== null ? ` AND order_no=${q(orderNo)}` : '');
        // Only ever placed inside "--" SQL comments: collapse whitespace so a
        // hostile driver_type/order_no with a newline cannot smuggle a live SQL
        // line in, and drop quotes — parseBlock is quote-aware but not
        // comment-aware, so a stray apostrophe in a comment corrupts parsing.
        const commentSafe = (s) => String(s).replace(/\s+/g, ' ').replace(/['"`]/g, '').trim();
        const drvLabel = commentSafe(driverType);
        const equipLabel = drvLabel
            + (orderNo !== null ? ' · ' + (commentSafe(orderNo) || '(no order_no)') : '');

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
        // Column names get backtick-wrapped into SQL — a name that is not a plain
        // identifier means the API/DB is feeding us something hostile. Stop.
        for (const t of Object.keys(sysCols)) {
            for (const c of sysCols[t]) {
                if (!isSafeIdent(c)) throw new Error('Unexpected column name from API: ' + t + '.' + c);
            }
        }
        // CAST everything AS CHAR: datetimes arrive as '2016-04-21 07:21:45'
        // instead of the API's JSON date form, and numbers quote back safely.
        const castList = (cols) => cols.map(c => `CAST(\`${c}\` AS CHAR) AS \`${c}\``).join(', ');
        const selCast = (tbl, where) => `SELECT ${castList(sysCols[tbl])} FROM ${S}.\`${tbl}\`${where}`;

        const sysSel = [
            selCast('iw_sys_plant_units', unitWhere + ' ORDER BY unit_id'),
            selCast('iw_sys_plant_settings', ` WHERE owner=${dq} ORDER BY setting`),
        ];
        if (sysCols.iw_sys_order_no) {
            sysSel.push(selCast('iw_sys_order_no', orderNo !== null
                ? ` WHERE order_no=${q(orderNo)}`
                : ` WHERE order_no IN (SELECT DISTINCT order_no FROM ${S}.iw_sys_plant_units WHERE driver_type=${dq})`));
        }
        if (sysCols.iw_sys_processes) sysSel.push(selCast('iw_sys_processes', ` WHERE process_name=${dq}`));
        const sysRes = await plantSql(plantId, sysSel);
        const units = (sysRes[0] && sysRes[0].data) || [];
        const settings = (sysRes[1] && sysRes[1].data) || [];
        const orders = (sysCols.iw_sys_order_no && sysRes[2] && sysRes[2].data) || [];
        const procs = (sysCols.iw_sys_processes && sysRes[3] && sysRes[3].data) || [];
        if (!units.length) throw new Error('No units for ' + driverType + (orderNo !== null ? ' / order_no ' + (orderNo || "''") : '') + ' on plant ' + plantId);

        // The donor's real unit rows never enter the template — like the curated
        // templates, it ships three generic example units (P01 / Pos 01 / 0_1 …)
        // that the form renumbers. Every other column (grp_name, driver_type,
        // regulator_type, order_no, view_order, …) is carried from the donor's
        // first unit of the selection, so the driver linkage stays intact.
        const uCols = sysCols.iw_sys_plant_units;
        const firstUnit = units[0];
        const exampleUnits = [1, 2, 3].map(i => {
            const r = {};
            for (const c of uCols) r[c] = firstUnit[c];
            const nn = String(i).padStart(2, '0');
            if ('unit_id' in r) r.unit_id = 'P' + nn;
            if ('unit_name' in r) r.unit_name = 'Pos ' + nn;
            if ('driver_addr' in r) r.driver_addr = '0_' + i;
            if ('driver_adr' in r) r.driver_adr = '0_' + i;
            if ('active' in r) r.active = '1';
            if ('blockout' in r) r.blockout = '0';
            return r;
        });

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
            for (const t of Object.keys(tblCols)) {
                for (const c of tblCols[t]) {
                    if (!isSafeIdent(c.column_name)) throw new Error('Unexpected column name from API: ' + t + '.' + c.column_name);
                }
            }
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
        // Every fragment of the DDL is either matched against a strict shape or
        // re-escaped before it lands in the output — information_schema text is
        // still API input, and the generated SQL gets pasted into phpMyAdmin.
        const COLTYPE_RE = /^[a-z0-9_]+(\([0-9]+(,[0-9]+)?\))?( unsigned)?( zerofill)?$|^(enum|set)\('(?:[^'\\]|''|\\.)*'(?:,'(?:[^'\\]|''|\\.)*')*\)$/i;
        function colDefSql(c) {
            if (!COLTYPE_RE.test(String(c.column_type))) throw new Error('Unexpected column type from API: ' + c.column_name + ' ' + c.column_type);
            let s = '`' + c.column_name + '` ' + c.column_type;
            const nullable = String(c.is_nullable).toUpperCase() === 'YES';
            if (!nullable) s += ' NOT NULL';
            const d = c.column_default;
            if (d === null || d === undefined) {
                if (nullable) s += ' DEFAULT NULL';
            } else if (/^current_timestamp(\(\))?$/i.test(d)) {
                s += ' DEFAULT CURRENT_TIMESTAMP';
            } else if (/^'[\s\S]*'$/.test(d)) {
                // Newer MariaDB returns defaults SQL-quoted — unquote and
                // re-escape rather than trusting the raw text into the DDL.
                s += ' DEFAULT ' + q(d.slice(1, -1).replace(/''/g, "'"));
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
                if (!isSafeIdent(name)) throw new Error('Unexpected index name from API: ' + t + '.' + name);
                const parts = byIdx[name]
                    .sort((a, b) => Number(a.seq_in_index) - Number(b.seq_in_index))
                    .map(r => {
                        if (!isSafeIdent(r.column_name)) throw new Error('Unexpected index column from API: ' + t + '.' + r.column_name);
                        const sp = parseInt(r.sub_part, 10);
                        return '`' + r.column_name + '`' + (Number.isFinite(sp) && sp > 0 ? '(' + sp + ')' : '');
                    });
                if (name === 'PRIMARY') lines.push('PRIMARY KEY (' + parts.join(',') + ')');
                else if (String(byIdx[name][0].non_unique) === '0') lines.push('UNIQUE KEY `' + name + '` (' + parts.join(',') + ')');
                else lines.push('KEY `' + name + '` (' + parts.join(',') + ')');
            }
            const meta = tblMeta[t];
            const engine = String(meta.engine || 'MyISAM');
            const charset = String(meta.table_collation || 'latin1_swedish_ci').split('_')[0];
            if (!isSafeIdent(engine) || !isSafeIdent(charset)) throw new Error('Unexpected engine/charset from API for ' + t);
            let tail = ') ENGINE=' + engine + ' DEFAULT CHARSET=' + charset;
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
        parts.push('-- Fetched live from plant ' + plantId + ', driver ' + equipLabel + ', by ' + X_CALLER);
        parts.push('-- Donor unit rows are not copied (' + units.length + ' on the donor) - 3 example units are generated instead.');
        if (missing.length) parts.push('-- WARNING: linked tables missing on the source plant, not included: ' + missing.join(', '));
        if (!orders.length) parts.push('-- WARNING: no iw_sys_order_no rows found for this driver, so no iw_par_/iw_set_ tables are included.');
        parts.push('');
        parts.push(insertBlock('iw_sys_plant_units', uCols, exampleUnits, true));
        if (settings.length) parts.push('\n' + insertBlock('iw_sys_plant_settings', sysCols.iw_sys_plant_settings, settings, true));
        else parts.push('\n-- (no iw_sys_plant_settings rows with owner ' + drvLabel + ' on the source plant)');
        if (orders.length) parts.push('\n' + insertBlock('iw_sys_order_no', sysCols.iw_sys_order_no, orders, true));
        if (procs.length) parts.push('\n' + insertBlock('iw_sys_processes', sysCols.iw_sys_processes, procs, true));
        for (const t of existing) {
            parts.push('\n' + createTableSql(t));
            const block = insertBlock(t, tblCols[t].map(c => c.column_name), tblData[t], false);
            if (block) parts.push('\n' + block);
        }
        return parts.join('\n') + '\n';
    }

    // The plant field starts BLANK so searching defaults to the whole fleet.
    // On a plant server the local plant id is offered as a hint rather than
    // filled in, so browsing one plant stays one click away.
    (function () {
        const local = getPlantIdFromHost();
        const el = $('seii-plant');
        if (!local) return;
        el.title = 'Blank = search the whole indexed fleet. This plant is ' + local + '.';
        const hint = document.createElement('a');
        hint.id = 'seii-thisplant';
        hint.href = '#';
        hint.textContent = 'this plant (' + local + ')';
        hint.title = 'Browse only this plant';
        hint.onclick = (e) => {
            e.preventDefault();
            el.value = local;
            loadPlantDrivers();
        };
        $('seii-plantrow').appendChild(hint);
    })();
    $('seii-plantload').onclick = (e) => { e.preventDefault(); loadPlantDrivers(); };
    $('seii-plant').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadPlantDrivers(); } });
    // Typing in the search bar: with a plant id it loads that plant on first use
    // and then filters the loaded list live; with the plant field BLANK it
    // searches the fleet index on the toolbox instead — no plant id needed.
    // Both match unit_name, grp_name, driver_type, regulator_type and order_no.
    let _fleetTimer = null;
    let _fleetSeq = 0;
    $('seii-search').addEventListener('input', () => {
        const pid = $('seii-plant').value.trim();
        const qv = $('seii-search').value.trim();
        if (/^\d+$/.test(pid)) {
            if (_driversLoadedFor !== pid) { if (!_loadBusy) loadPlantDrivers(); return; }
            renderDrivers();
            return;
        }
        clearTimeout(_fleetTimer);
        if (qv.length < 2) {
            $('seii-drivers').classList.remove('show');
            if (!qv) setPlantInfo('Type to search the whole indexed fleet, or enter a plant id to browse one plant.');
            return;
        }
        _fleetTimer = setTimeout(async () => {
            if (_idxDown) {
                setPlantInfo('Fleet search is unavailable this session: ' + escapeHtml(_idxDown) +
                    ' <span class="small">Enter a plant id to browse one plant, or reload the page to retry.</span>', 'err');
                return;
            }
            const seq = ++_fleetSeq;
            setPlantInfo('Searching indexed fleet for “' + escapeHtml(qv) + '”…');
            try {
                const rows = await searchFleetIndex(qv);
                if (seq !== _fleetSeq) return; // a newer search superseded this one
                renderFleetResults(rows);
                setPlantInfo(`<span class="ok">${rows.length}${rows.length === 60 ? '+' : ''} indexed equipment match.</span> <span class="small">Click one to fetch it live from its plant. The index covers plants this tool has loaded.</span>`);
            } catch (err) {
                if (seq !== _fleetSeq) return;
                _idxDown = err.message || String(err);
                setPlantInfo('Fleet search failed: ' + escapeHtml(_idxDown), 'err');
            }
        }, 350);
    });
    let _fetchBusy = false;
    $('seii-drivers').addEventListener('click', async (e) => {
        const it = e.target.closest('.drv');
        if (!it || !it.dataset.drv || _fetchBusy) return;
        // A fleet-search hit carries its own plant id — adopt it into the field
        // so the fetch and any follow-up browsing target that plant.
        if (it.dataset.plant && /^\d+$/.test(it.dataset.plant)) $('seii-plant').value = it.dataset.plant;
        // Re-validate: the field may have been edited after Load drivers.
        const pid = $('seii-plant').value.trim();
        if (!/^\d+$/.test(pid)) { setPlantInfo('Enter a numeric plant id first.', 'err'); return; }
        const drv = it.dataset.drv;
        // data-order distinguishes one equipment ('' is a real order_no value)
        // from the whole-driver row, which has no data-order attribute at all.
        const orderNo = it.hasAttribute('data-order') ? it.getAttribute('data-order') : null;
        _fetchBusy = true;
        try {
            const sql = await fetchDriverTemplate(pid, drv, orderNo);
            loadSqlText('plant ' + pid + ' · ' + drv + (orderNo !== null ? ' · ' + (orderNo || '(no order_no)') : ''), sql);
            $('seii-drivers').classList.remove('show');
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
            $('seii-status').innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
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
            $('seii-status').innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
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
            $('seii-status').innerHTML = `<span class="err">${escapeHtml(e.message)}</span>`;
        }
    };
})();
