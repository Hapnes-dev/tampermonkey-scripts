// ==UserScript==
// @name         IWMAC Topology Copy
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @version      1.24
// @description  Copy the IWMAC sys_tools topology to clipboard, export to a real .xlsx, or auto-add live connection-detail columns (type/address/port/baud/parity/driver addr) into the page grid whenever you open Topology (auto-collapses when done, with an already-shown safety guard) — all merging page tree + Toolbox SQL API.
// @match        *://*.plants.iwmac.local:8080/secure/sys_tools/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      toolbox.iwmac.local
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-topology-copy/IWMAC-Topology-Copy.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/iwmac-topology-copy/IWMAC-Topology-Copy.user.js
// ==/UserScript==

(function () {
    'use strict';

    const COPY_BTN_ID   = 'iwmac-topo-copy-btn';
    const EXPORT_BTN_ID = 'iwmac-topo-export-btn';
    const DETAIL_BTN_ID = 'iwmac-topo-detail-btn';

    // Identifies this script to the Toolbox API, the same way AK3-Autoscan does.
    // X-Caller is constant. X-Run-Id groups every request for one plant under a
    // single run, so the Excel export, the Show Details fetch and the BACnet-less
    // retry read as one operation in the Toolbox log rather than three unrelated
    // ones. A new ID is minted only when the plant changes.
    const X_CALLER = 'IWMAC Topology Copy';
    function makeUuid() {
        return (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    }
    let _runId = makeUuid();
    let _runIdPlant = null;
    function ensureRunIdForPlant(plantId) {
        const pid = String(plantId || '');
        if (pid && _runIdPlant !== pid) {
            _runId = makeUuid();
            _runIdPlant = pid;
            console.debug('[IWMAC Topology] New X-Run-Id for plant ' + pid + ': ' + _runId);
        }
        return _runId;
    }

    // Extra columns injected into the live grid by "Show Details" (field must match the
    // record property we set in onShowDetails).
    const DETAIL_COLS = [
        { field: 'conn_type',   text: 'Connection type', size: '150px' },
        { field: 'address',     text: 'Address',         size: '180px' },
        { field: 'comm_port',   text: 'Comm port',       size: '85px'  },
        { field: 'baudrate',    text: 'Baudrate',        size: '85px'  },
        { field: 'parity',      text: 'Parity',          size: '70px'  },
        { field: 'driver_addr', text: 'Driver addr',     size: '100px' },
    ];

    function buildToolbarButton(tdId, captionId, iconChar, captionText, onClick) {
        const td = document.createElement('td');
        td.id = tdId;
        td.valign = 'middle';
        td.style.cssText = 'padding-right:8px;';
        td.innerHTML = `
            <div>
                <table cellpadding="0" cellspacing="0" class="w2ui-button">
                    <tbody><tr><td>
                        <table cellpadding="1" cellspacing="0"><tbody><tr>
                            <td><div class="w2ui-tb-image"><span style="display:inline-block;font-size:14px;line-height:14px;">${iconChar}</span></div></td>
                            <td id="${captionId}" class="w2ui-tb-text w2ui-tb-caption" nowrap="nowrap">${captionText}</td>
                        </tr></tbody></table>
                    </td></tr></tbody>
                </table>
            </div>`;
        const btn = td.querySelector('table.w2ui-button');
        btn.addEventListener('mouseenter', () => btn.classList.add('over'));
        btn.addEventListener('mouseleave', () => btn.classList.remove('over', 'down'));
        btn.addEventListener('mousedown',  () => btn.classList.add('down'));
        btn.addEventListener('mouseup',    () => btn.classList.remove('down'));
        btn.addEventListener('click', onClick);
        return td;
    }

    // Build w2ui-style toolbar buttons and inject them into the topology toolbar's right-aligned cell.
    function makeButton() {
        const host = document.getElementById('tb_grid_topology_toolbar_right');
        if (!host) return;

        if (!document.getElementById(COPY_BTN_ID)) {
            const copyTd = buildToolbarButton(
                COPY_BTN_ID, COPY_BTN_ID + '-cap',
                '&#128203;', 'Copy Topology', onCopy
            );
            host.parentNode.insertBefore(copyTd, host);
        }
        if (!document.getElementById(EXPORT_BTN_ID)) {
            const expTd = buildToolbarButton(
                EXPORT_BTN_ID, EXPORT_BTN_ID + '-cap',
                '&#128190;', 'Export to Excel', onExport
            );
            host.parentNode.insertBefore(expTd, host);
        }
        if (!document.getElementById(DETAIL_BTN_ID)) {
            const detTd = buildToolbarButton(
                DETAIL_BTN_ID, DETAIL_BTN_ID + '-cap',
                '&#128268;', 'Show Details', onShowDetails
            );
            host.parentNode.insertBefore(detTd, host);
        }
    }

    // Persistent caption swap (no auto-revert) — used for the "Loading…" state while the
    // API call is in flight. Stores the original text so a later flash() reverts correctly.
    function setCaption(captionId, msg, color) {
        const cap = document.getElementById(captionId);
        if (!cap) return;
        if (!cap.dataset.origText) cap.dataset.origText = cap.textContent;
        cap.textContent = msg;
        cap.style.color = color || '';
        cap.style.fontWeight = color ? 'bold' : '';
    }

    // Persistent "already done" state for the Show Details button after a successful run.
    // Also rewrites origText so any later flash() reverts back to this instead of "Show Details".
    function markShown(captionId, filled) {
        const cap = document.getElementById(captionId);
        if (!cap) return;
        const txt = '✓ Details shown' + (filled ? ` (${filled})` : '');
        cap.textContent = txt;
        cap.style.color = '#2e7d32';
        cap.style.fontWeight = 'bold';
        cap.dataset.origText = txt;
    }

    function flash(captionId, msg, ok, durationMs) {
        const cap = document.getElementById(captionId);
        if (!cap) return;
        const orig = cap.dataset.origText || cap.textContent;
        cap.dataset.origText = orig;
        const origColor = cap.style.color;
        cap.textContent = msg;
        cap.style.color = ok ? '#2e7d32' : '#c62828';
        cap.style.fontWeight = 'bold';
        setTimeout(() => {
            cap.textContent = orig;
            cap.style.color = origColor;
            cap.style.fontWeight = '';
        }, durationMs || 1500);
    }

    function expandAll() {
        // Use the grid's own toolbar action so virtualized rows render.
        try {
            const w2 = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).w2ui;
            if (w2 && w2.grid_topology_toolbar && typeof w2.grid_topology_toolbar.click === 'function') {
                w2.grid_topology_toolbar.click('open_all');
                return true;
            }
        } catch (e) {}
        const fallback = document.querySelector('#tb_grid_topology_toolbar_item_open_all table.w2ui-button');
        if (fallback) { fallback.click(); return true; }
        return false;
    }

    function collapseAll() {
        // Mirror of expandAll using the grid's own "Close all" toolbar action.
        try {
            const w2 = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).w2ui;
            if (w2 && w2.grid_topology_toolbar && typeof w2.grid_topology_toolbar.click === 'function') {
                w2.grid_topology_toolbar.click('close_all');
                return true;
            }
        } catch (e) {}
        const fallback = document.querySelector('#tb_grid_topology_toolbar_item_close_all table.w2ui-button');
        if (fallback) { fallback.click(); return true; }
        return false;
    }

    function scrapeRows() {
        const rows = document.querySelectorAll('#grid_grid_topology_records tr.w2ui-record');
        const out = [];
        const lastByDepth = {};
        rows.forEach(tr => {
            const treeCellDiv = tr.querySelector('td[col="0"] > div');
            if (!treeCellDiv) return;
            const spans = treeCellDiv.querySelectorAll('span.w2ui-show-children').length;
            const depth = Math.max(0, spans - 1);
            const tree = treeCellDiv.getAttribute('title') || '';
            const name = tr.querySelector('td[col="1"] > div')?.getAttribute('title') || '';
            const owner = tr.querySelector('td[col="2"] > div')?.getAttribute('title') || '';
            const status = tr.querySelector('td[col="3"] > div')?.textContent.trim() || '';
            lastByDepth[depth] = tree;
            const parent = depth > 0 ? (lastByDepth[depth - 1] || '') : '';
            out.push({ depth, tree, name, owner, status, parent });
        });
        return out;
    }

    function buildTSV(rows) {
        const lines = ['Tree\tUnit name\tOwner\tStatus'];
        for (const r of rows) {
            const indented = '  '.repeat(r.depth) + r.tree;
            lines.push([indented, r.name, r.owner, r.status].join('\t'));
        }
        return lines.join('\n');
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function buildHTML(rows) {
        const tableStyle = 'border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;';
        const thStyle = 'border:1px solid #999;padding:4px 8px;background:#eee;text-align:left;';
        const tdStyle = 'border:1px solid #ccc;padding:3px 8px;';
        const indent = '    '; // non-breaking spaces survive HTML pasting
        let html = `<table style="${tableStyle}"><thead><tr>` +
            `<th style="${thStyle}">Tree</th>` +
            `<th style="${thStyle}">Unit name</th>` +
            `<th style="${thStyle}">Owner</th>` +
            `<th style="${thStyle}">Status</th>` +
            `</tr></thead><tbody>`;
        for (const r of rows) {
            const isGroup = !r.name && !r.owner && !r.status;
            const rowBg = isGroup ? 'background:#f5f5f5;font-weight:bold;' : '';
            const treeCell = indent.repeat(r.depth) + esc(r.tree);
            html += `<tr style="${rowBg}">` +
                `<td style="${tdStyle}">${treeCell}</td>` +
                `<td style="${tdStyle}">${esc(r.name)}</td>` +
                `<td style="${tdStyle}">${esc(r.owner)}</td>` +
                `<td style="${tdStyle}">${esc(r.status)}</td>` +
                `</tr>`;
        }
        html += '</tbody></table>';
        return html;
    }

    async function writeRichClipboard(html, tsv) {
        // Preferred: write both HTML (for Zendesk / Gmail / Word) and plain text (for Excel / Notepad).
        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
            try {
                await navigator.clipboard.write([new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([tsv], { type: 'text/plain' })
                })]);
                return true;
            } catch (e) { /* fall through */ }
        }
        // Fallback: synthetic copy event with both formats.
        try {
            const handler = (e) => {
                e.preventDefault();
                e.clipboardData.setData('text/html', html);
                e.clipboardData.setData('text/plain', tsv);
            };
            document.addEventListener('copy', handler, { once: true });
            const ok = document.execCommand('copy');
            return ok;
        } catch (e) { return false; }
    }

    async function onCopy() {
        const cap = COPY_BTN_ID + '-cap';
        expandAll();
        await new Promise(r => setTimeout(r, 350));
        const rows = scrapeRows();
        if (!rows.length) { flash(cap, 'No rows found', false); return; }
        const tsv = buildTSV(rows);
        const html = buildHTML(rows);
        try {
            const ok = await writeRichClipboard(html, tsv);
            if (!ok) {
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(html, { type: 'text', mimetype: 'text/html' });
                } else {
                    await navigator.clipboard.writeText(tsv);
                }
            }
            flash(cap, `Copied ${rows.length} rows`, true);
        } catch (e) {
            console.error('Clipboard write failed', e);
            flash(cap, 'Copy failed', false);
        }
    }

    function getPlantLabel() {
        // Header shows e.g. "6176 - Extra Moi"
        const el = document.querySelector('.plant_info');
        const raw = (el && el.textContent || '').trim();
        return raw.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_') || 'topology';
    }

    function xmlEsc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
        }[c]));
    }

    function colLetter(n) { // 1 -> A
        let s = '';
        while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
        return s;
    }

    // -- Tiny stored-zip writer (no external dependency, Excel accepts uncompressed xlsx) --
    const CRC_TBL = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TBL[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function makeZip(files) {
        const enc = new TextEncoder();
        const parts = [], central = []; let offset = 0;
        for (const f of files) {
            const nameBytes = enc.encode(f.name);
            const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
            const c = crc32(data);
            const lfh = new ArrayBuffer(30 + nameBytes.length);
            const dv = new DataView(lfh);
            dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
            dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);
            dv.setUint32(14, c, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
            dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
            new Uint8Array(lfh, 30).set(nameBytes);
            parts.push(new Uint8Array(lfh)); parts.push(data);
            const cdh = new ArrayBuffer(46 + nameBytes.length);
            const cv = new DataView(cdh);
            cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
            cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
            cv.setUint32(16, c, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
            cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
            cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
            new Uint8Array(cdh, 46).set(nameBytes);
            central.push(new Uint8Array(cdh));
            offset += 30 + nameBytes.length + data.length;
        }
        let cdSize = 0; for (const c of central) cdSize += c.length;
        const eocd = new ArrayBuffer(22);
        const ev = new DataView(eocd);
        ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
        ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
        ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
        return new Blob([...parts, ...central, new Uint8Array(eocd)],
            { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    // Derive the connection columns for one leaf unit from its API row + its depth-1 parent
    // tree label. Shared by the Excel export and the in-grid "Show Details" feature so both
    // present identical values.
    //   • Address from the parent label when the page tree carries network info:
    //       Parent "COMx - IP" → Moxa converter (IP)   Parent "COMx" → Physical port
    //       Parent contains an IP → use IP[:port] (covers BACnet groupings)   else api.resolved_address
    //   • Connection type — tree position wins over driver type:
    //       Under a COMx parent → Modbus RTU (an FX16 under a Moxa COM still speaks RTU to the
    //       Moxa, which bridges to TCP). Otherwise known TCP-only drivers (FX16, …) → Modbus TCP.
    //   • Comm port — prefer the API value, else the number from "COMx" in the parent.
    function deriveConnection(api, parentLbl) {
        api = api || {};
        parentLbl = parentLbl || '';
        const isSerialParent = /\bCOM\s*\d+/i.test(parentLbl);

        let address = api.resolved_address || '';
        if (isSerialParent) {
            const ipMatch = parentLbl.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
            address = ipMatch ? `Moxa converter (${ipMatch[1]})` : 'Physical port';
        } else {
            const ipPortMatch = parentLbl.match(/\b(\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?)\b/);
            if (ipPortMatch) address = ipPortMatch[1];
        }

        let connectionType = api.connection_type || '';
        const tcpOnlyDrivers = ['FX16'];
        if (isSerialParent) {
            connectionType = 'Modbus RTU';
        } else if (tcpOnlyDrivers.includes((api.driver_type || '').toUpperCase())) {
            connectionType = 'Modbus TCP';
        }

        let commPort = api.comm_port || '';
        if (!commPort) {
            const comMatch = parentLbl.match(/\bCOM\s*(\d+)/i);
            if (comMatch) commPort = comMatch[1];
        }

        return {
            connectionType,
            address,
            commPort,
            baudrate: api.baudrate || '',
            parity: api.parity || '',
            driverAddr: api.driver_addr || '',
        };
    }

    // Real .xlsx with outlineLevel per row so Excel shows native +/- collapse buttons in the gutter.
    // apiByUnitId: optional map from UPPER(unit_id) → API row, merged onto leaf rows as extra columns.
    function buildXlsx(rows, apiByUnitId) {

        const maxDepth = rows.reduce((m, r) => Math.max(m, r.depth), 0);
        const hasApi = !!(apiByUnitId && Object.keys(apiByUnitId).length);

        const headers = hasApi
            ? ['Tree', 'Unit name', 'Owner', 'Status', 'Connection type', 'Address', 'Comm port', 'Baudrate', 'Parity', 'Driver addr']
            : ['Tree', 'Unit name', 'Owner', 'Status'];
        const colCount = headers.length;
        let sheetRows = '';

        // Header row (style s="1" = bold + grey)
        sheetRows += `<row r="1">` + headers.map((h, i) =>
            `<c r="${colLetter(i + 1)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEsc(h)}</t></is></c>`
        ).join('') + `</row>`;

        rows.forEach((r, idx) => {
            const rowNum = idx + 2;
            const isGroup = !r.name && !r.owner && !r.status;
            const styleAttr = isGroup ? ' s="2"' : '';
            const outlineAttr = ` outlineLevel="${r.depth}"`;
            const indentedTree = '    '.repeat(r.depth) + r.tree;
            const base = [indentedTree, r.name, r.owner, r.status];
            let extra = ['', '', '', '', '', ''];
            if (hasApi && !isGroup) {
                const api = apiByUnitId[(r.tree || '').trim().toUpperCase()] || {};
                const d = deriveConnection(api, r.parent);
                extra = [d.connectionType, d.address, d.commPort, d.baudrate, d.parity, d.driverAddr];
            }
            const values = hasApi ? base.concat(extra) : base;
            const cells = values.map((v, i) =>
                `<c r="${colLetter(i + 1)}${rowNum}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`
            ).join('');
            sheetRows += `<row r="${rowNum}"${outlineAttr}>${cells}</row>`;
        });

        const colsXml = hasApi ? `<cols>
<col min="1" max="1" width="36" customWidth="1"/>
<col min="2" max="2" width="32" customWidth="1"/>
<col min="3" max="3" width="14" customWidth="1"/>
<col min="4" max="4" width="10" customWidth="1"/>
<col min="5" max="5" width="22" customWidth="1"/>
<col min="6" max="6" width="22" customWidth="1"/>
<col min="7" max="7" width="10" customWidth="1"/>
<col min="8" max="8" width="10" customWidth="1"/>
<col min="9" max="9" width="10" customWidth="1"/>
<col min="10" max="10" width="14" customWidth="1"/>
</cols>` : `<cols>
<col min="1" max="1" width="36" customWidth="1"/>
<col min="2" max="2" width="32" customWidth="1"/>
<col min="3" max="3" width="14" customWidth="1"/>
<col min="4" max="4" width="10" customWidth="1"/>
</cols>`;

        const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>
<sheetFormatPr defaultRowHeight="15" outlineLevelRow="${maxDepth}"/>
${colsXml}
<sheetData>${sheetRows}</sheetData>
</worksheet>`;

        const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEEEEE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
</styleSheet>`;

        const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

        const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

        const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Topology" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

        const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

        return makeZip([
            { name: '[Content_Types].xml',         data: contentTypes },
            { name: '_rels/.rels',                 data: rootRels },
            { name: 'xl/workbook.xml',             data: workbookXml },
            { name: 'xl/_rels/workbook.xml.rels',  data: workbookRels },
            { name: 'xl/styles.xml',               data: stylesXml },
            { name: 'xl/worksheets/sheet1.xml',    data: sheetXml },
        ]);
    }

    function getPlantIdFromHost() {
        // Hostname is e.g. "6176.plants.iwmac.local"
        const host = location.hostname || '';
        const m = host.match(/^(\d+)\./);
        return m ? m[1] : '';
    }

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
                    catch (e) { reject(new Error('Bad JSON from API: ' + r.responseText.substring(0, 200))); }
                },
                onerror: e => reject(new Error('API network error (X-Run-Id ' + _runId + ')')),
                ontimeout: () => reject(new Error('API timeout (X-Run-Id ' + _runId + ')')),
            });
        });
    }

    // Only a minority of plants run the BACnet scanner, so its table is usually absent.
    // Referencing a missing table makes MySQL fail the whole statement, which the Toolbox
    // records as a genuine error — noise that hides the errors worth looking at.
    const BACNET_SCHEMA = 'iw_bacnet2_scanner';
    const BACNET_TABLE  = 'iw_bacnet_devices';

    // SQL adapted from the topology-export query. Literal ';' replaced with CHAR(59) so the
    // toolbox API's safety validator doesn't split it as multiple statements.
    function buildPlantUnitsSql(includeBacnet) {
        const bacnetExpr = includeBacnet
            ? `COALESCE(NULLIF(bd.ip_address, ''), NULLIF(u.driver_adr_extra, ''))`
            : `NULLIF(u.driver_adr_extra, '')`;
        const bacnetJoin = includeBacnet
            ? `LEFT JOIN ${BACNET_SCHEMA}.${BACNET_TABLE} AS bd ON bd.object_instance=SUBSTRING_INDEX(u.driver_addr,'_',-1) AND u.driver_type LIKE 'BACNET%'`
            : '';
        return `SELECT plant_id.value AS plant_id, plant_name.value AS plant_name, u.unit_id, u.unit_name, u.driver_type, u.driver_addr,
            CASE WHEN u.driver_type LIKE 'BACNET%' THEN 'Bacnet'
                 WHEN u.driver_type='AK2' THEN 'Danfoss AK2 TCP/IP'
                 WHEN u.driver_type='AK3' THEN 'Danfoss AK3 XML'
                 WHEN mb_mode.value='0' THEN 'Modbus RTU'
                 WHEN mb_mode.value='1' THEN 'Modbus ASCII'
                 WHEN mb_mode.value='2' THEN 'Modbus TCP'
                 ELSE u.driver_type END AS connection_type,
            CASE WHEN u.driver_type LIKE 'BACNET%' THEN ${bacnetExpr}
                 WHEN u.driver_type='AK2' THEN tcpip_server.value
                 WHEN u.driver_type='AK3' THEN SUBSTRING_INDEX(SUBSTRING_INDEX(REPLACE(REPLACE(xml_service_addr.value,'https://',''),'http://',''),'/',1),':',1)
                 WHEN mb_mode.value='2' AND LOCATE(CONCAT(CHAR(10),SUBSTRING_INDEX(u.driver_addr,'_',1),CHAR(59)),CONCAT(CHAR(10),REPLACE(mb_tcp_servers.value,CHAR(13),'')))>0
                     THEN SUBSTRING_INDEX(SUBSTRING_INDEX(CONCAT(CHAR(10),REPLACE(mb_tcp_servers.value,CHAR(13),'')),CONCAT(CHAR(10),SUBSTRING_INDEX(u.driver_addr,'_',1),CHAR(59)),-1),CHAR(59),1)
                 ELSE '' END AS resolved_address,
            CASE WHEN mb_mode.value IN ('0','1') THEN comm_port.value ELSE '' END AS comm_port,
            CASE WHEN mb_mode.value IN ('0','1') THEN comm_baudrate.value ELSE '' END AS baudrate,
            CASE WHEN mb_mode.value IN ('0','1') THEN
                CASE LOWER(comm_parity.value) WHEN '0' THEN 'None' WHEN 'n' THEN 'None' WHEN 'none' THEN 'None'
                    WHEN '1' THEN 'Odd' WHEN 'o' THEN 'Odd' WHEN 'odd' THEN 'Odd'
                    WHEN '2' THEN 'Even' WHEN 'e' THEN 'Even' WHEN 'even' THEN 'Even'
                    WHEN '3' THEN 'Mark' WHEN 'm' THEN 'Mark' WHEN 'mark' THEN 'Mark'
                    WHEN '4' THEN 'Space' WHEN 's' THEN 'Space' WHEN 'space' THEN 'Space'
                    ELSE '' END
                ELSE '' END AS parity
            FROM iw_plant_server3.iw_sys_plant_units AS u
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS plant_id ON plant_id.setting='plant_id' AND plant_id.owner='ALL'
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS plant_name ON plant_name.setting='plant_name' AND plant_name.owner='ALL'
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS mb_mode ON mb_mode.setting='mb_mode' AND mb_mode.owner=u.driver_type
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS mb_tcp_servers ON mb_tcp_servers.setting='mb_tcp_servers' AND mb_tcp_servers.owner=u.driver_type
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS comm_port ON comm_port.setting='comm_port' AND comm_port.owner=u.driver_type
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS comm_baudrate ON comm_baudrate.setting='comm_baudrate' AND comm_baudrate.owner=u.driver_type
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS comm_parity ON comm_parity.setting='comm_parity' AND comm_parity.owner=u.driver_type
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS tcpip_server ON tcpip_server.setting='tcpip_server' AND tcpip_server.owner=u.driver_type
            LEFT JOIN iw_plant_server3.iw_sys_plant_settings AS xml_service_addr ON xml_service_addr.setting='xml_service_addr' AND xml_service_addr.owner=u.driver_type
            ${bacnetJoin}
            WHERE u.active='1' AND LEFT(u.unit_id,3)<>'VV_' AND LEFT(u.unit_name,3)<>'VV_' AND UPPER(TRIM(u.unit_id))<>'SERVER'
            ORDER BY u.driver_type, u.unit_id`;
    }

    // plantId → does the BACnet scanner table exist. Asked once per plant; table
    // existence does not change while a tab is open.
    const _bacnetTable = new Map();

    // Ask information_schema instead of finding out the hard way. information_schema
    // is always present, and it reports a missing schema as a count of 0 rather than
    // an error, so this probe cannot itself produce the error it exists to prevent.
    async function hasBacnetTable(url, plantId) {
        const key = String(plantId);
        if (_bacnetTable.has(key)) return _bacnetTable.get(key);
        const sql = `SELECT COUNT(*) AS n FROM information_schema.TABLES
            WHERE TABLE_SCHEMA='${BACNET_SCHEMA}' AND TABLE_NAME='${BACNET_TABLE}'`;
        let present = false;
        try {
            const res = await gmPostJson(url, { plant_id: plantId, sql_command: sql });
            const row = res.body && res.body.success && res.body.results
                && res.body.results[0] && res.body.results[0].data && res.body.results[0].data[0];
            // The API returns counts as strings ("0" / "1"), so compare numerically.
            present = !!row && Number(row.n) > 0;
        } catch (e) {
            // If the probe itself fails, assume absent: the BACnet address fallback is
            // worth less than the error we are trying not to generate.
            console.debug('[IWMAC Topology] BACnet probe failed, assuming absent:', e);
        }
        _bacnetTable.set(key, present);
        console.debug('[IWMAC Topology] BACnet scanner table on plant ' + key + ': ' +
            (present ? 'present' : 'absent'));
        return present;
    }

    async function fetchUnitsApi(plantId) {
        const url = 'http://toolbox.iwmac.local:8505/plant-sql/';
        ensureRunIdForPlant(plantId);
        async function call(includeBacnet) {
            return gmPostJson(url, { plant_id: plantId, sql_command: buildPlantUnitsSql(includeBacnet) });
        }
        const includeBacnet = await hasBacnetTable(url, plantId);
        let res = await call(includeBacnet);
        const ok = res.body && res.body.success;
        if (!ok) {
            const err = (res.body && (res.body.error || res.body.message)) || '';
            // Safety net only: the probe said the table was there but the join failed anyway
            // (dropped since, or not readable). Cannot fire on a plant that probed absent.
            if (includeBacnet && /iw_bacnet|doesn.?t exist/i.test(err)) {
                _bacnetTable.set(String(plantId), false);
                res = await call(false);
            } else {
                throw new Error(err || ('HTTP ' + res.status));
            }
        }
        if (!res.body || !res.body.success) {
            throw new Error((res.body && (res.body.error || res.body.message)) || 'API call failed');
        }
        const dataRows = (res.body.results && res.body.results[0] && res.body.results[0].data) || [];
        const map = {};
        for (const row of dataRows) {
            const k = String(row.unit_id || '').trim().toUpperCase();
            if (k) map[k] = row;
        }
        return map;
    }

    async function onExport() {
        const cap = EXPORT_BTN_ID + '-cap';
        expandAll();
        await new Promise(r => setTimeout(r, 350));
        const rows = scrapeRows();
        if (!rows.length) { flash(cap, 'No rows found', false); return; }

        // Try to fetch API in parallel; degrade gracefully if it fails.
        let apiMap = null;
        const plantId = getPlantIdFromHost();
        if (plantId) {
            try { apiMap = await fetchUnitsApi(plantId); }
            catch (e) {
                console.warn('[IWMAC Topology] API fetch failed, exporting topology only:', e);
                flash(cap, 'API failed: ' + (e.message || e) + ' — topology only', false, 4000);
            }
        }

        // The page grid is virtualized — for big plants, many rows aren't in the DOM at scrape time.
        // Append any API rows whose unit_id wasn't found in the scraped tree, grouped by connection_type
        // under a synthetic "Additional units" section so they still get the outline structure.
        let addedCount = 0;
        if (apiMap) {
            const scrapedIds = new Set(
                rows.filter(r => r.depth >= 2 || r.name || r.owner || r.status)
                    .map(r => String(r.tree || '').trim().toUpperCase())
                    .filter(Boolean)
            );
            const missing = [];
            for (const [uid, api] of Object.entries(apiMap)) {
                if (!scrapedIds.has(uid)) missing.push(api);
            }
            if (missing.length) {
                const groupLabel = 'Additional units';
                rows.push({ depth: 0, tree: groupLabel, name: '', owner: '', status: '', parent: '' });
                const byType = {};
                for (const m of missing) {
                    const k = m.connection_type || '(unknown)';
                    (byType[k] = byType[k] || []).push(m);
                }
                for (const ct of Object.keys(byType).sort()) {
                    rows.push({ depth: 1, tree: ct, name: '', owner: '', status: '', parent: groupLabel });
                    for (const m of byType[ct].sort((a, b) => String(a.unit_id).localeCompare(String(b.unit_id)))) {
                        rows.push({
                            depth: 2,
                            tree: m.unit_id || '',
                            name: m.unit_name || '',
                            owner: m.driver_type || '',
                            status: '',
                            parent: ct,
                        });
                        addedCount++;
                    }
                }
            }
        }

        try {
            const blob = buildXlsx(rows, apiMap);
            const url = URL.createObjectURL(blob);
            const today = new Date().toISOString().slice(0, 10);
            const a = document.createElement('a');
            a.href = url;
            a.download = `topology_${getPlantLabel()}_${today}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            const apiCount = apiMap ? Object.keys(apiMap).length : 0;
            const parts = [`Exported ${rows.length} rows`];
            if (apiCount) parts.push(`merged ${apiCount} API`);
            if (addedCount) parts.push(`+${addedCount} added`);
            flash(cap, parts.join(', '), true);
        } catch (e) {
            console.error('[IWMAC Topology] Export failed', e);
            flash(cap, 'Export failed: ' + (e && e.message ? e.message : e), false, 5000);
        }
    }

    function getTopologyGrid() {
        const w2 = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).w2ui;
        return (w2 && w2.grid_topology) || null;
    }

    function addDetailColumns(grid) {
        DETAIL_COLS.forEach(c => {
            if (!grid.columns.find(x => x.field === c.field)) {
                grid.columns.push({ field: c.field, text: c.text, size: c.size, sortable: true });
            }
        });
    }

    // After expandAll(), leaf rows may flatten into grid.records asynchronously (some plants
    // only materialise a connection node's child units once the node is opened). Poll briefly
    // until the leaf count settles, or until the time budget runs out.
    function waitForLeaves(grid, maxMs) {
        const step = 100, budget = maxMs || 2500;
        return new Promise(resolve => {
            let last = -1, stable = 0, elapsed = 0;
            const tick = () => {
                const count = grid.records.filter(r => r.unit_id).length;
                stable = (count === last) ? stable + 1 : 0;
                last = count;
                elapsed += step;
                if ((count > 0 && stable >= 2) || elapsed >= budget) return resolve(count);
                setTimeout(tick, step);
            };
            setTimeout(tick, step);
        });
    }

    function detailsShown(grid) {
        return !!(grid.__iwmacDetailsShown && grid.columns.some(c => c.field === 'conn_type'));
    }

    // Inject the API-derived connection columns straight into the live w2ui topology grid and
    // expand every node so the enriched rows are visible. Works on the grid's own records +
    // columns arrays and calls refresh() (never raw DOM) so the virtualized tree stays in sync.
    // opts.auto = true when fired by the Topology-open auto-trigger (stays quiet on skips/errors).
    async function onShowDetails(opts) {
        opts = opts || {};
        const cap = DETAIL_BTN_ID + '-cap';
        const grid = getTopologyGrid();
        if (!grid || !Array.isArray(grid.records)) { if (!opts.auto) flash(cap, 'Grid not found', false); return; }

        // Safety: never re-run work that's already on screen. A manual click just confirms it;
        // the auto-trigger stays silent. (Re-opening Topology resets this — see the click hook.)
        if (detailsShown(grid)) { if (!opts.auto) flash(cap, 'Already shown', true); return; }
        if (grid.__iwmacBusy) return; // a run is already in flight on this grid

        const plantId = getPlantIdFromHost();
        if (!plantId) { if (!opts.auto) flash(cap, 'No plant id in host', false); return; }

        grid.__iwmacBusy = true;
        setCaption(cap, 'Loading…', '#1565c0');
        try {
            const apiMap = await fetchUnitsApi(plantId);

            // Expand every node FIRST: some plants only flatten a connection node's child units
            // into grid.records once that node is open, so we must expand before populating.
            // (We collapse again at the end — the populated values persist on the records.)
            expandAll();
            await waitForLeaves(grid);

            addDetailColumns(grid);

            // recid → record, so each leaf can read its depth-1 parent (connection) tree label.
            const byRecid = {};
            grid.records.forEach(r => { byRecid[r.recid] = r; });

            let filled = 0;
            grid.records.forEach(r => {
                if (!r.unit_id) return; // group / connection nodes have no unit of their own
                const parent = byRecid[r.w2ui && r.w2ui.parent_recid];
                const api = apiMap[String(r.unit_id).trim().toUpperCase()];
                const d = deriveConnection(api, parent ? parent.tree : '');
                r.conn_type   = d.connectionType;
                r.address     = d.address;
                r.comm_port   = d.commPort;
                r.baudrate    = d.baudrate;
                r.parity      = d.parity;
                r.driver_addr = d.driverAddr;
                if (api) filled++;
            });

            grid.refresh();
            collapseAll(); // expansion was only needed to flatten + populate the leaves — tidy back up
            grid.__iwmacDetailsShown = true;
            markShown(cap, filled);
        } catch (e) {
            console.error('[IWMAC Topology] Show Details failed:', e);
            flash(cap, 'API failed: ' + (e && e.message ? e.message : e), false, 5000);
        } finally {
            grid.__iwmacBusy = false;
        }
    }

    // --- Auto-run "Show Details" whenever the user opens the Topology view ---
    // Clicking the Topology sidebar node clears the per-grid guards, so re-opening always does
    // a fresh run (handles the case where w2ui reuses the same grid object across navigations).
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('#node_topology')) {
            const g = getTopologyGrid();
            if (g) { g.__iwmacDetailsShown = false; g.__iwmacAutoTried = false; }
        }
    }, true);

    // Fire once per freshly-loaded topology grid: as soon as the grid + toolbar exist and the
    // details aren't already shown. __iwmacAutoTried guards against re-firing every poll tick
    // (and against an API-failure retry storm); a fresh/re-opened grid clears it again.
    function maybeAutoDetails() {
        const grid = getTopologyGrid();
        const toolbar = document.getElementById('tb_grid_topology_toolbar_right');
        if (!grid || !toolbar || !Array.isArray(grid.records) || !grid.records.length) return;
        if (grid.__iwmacAutoTried || grid.__iwmacBusy || detailsShown(grid)) return;
        grid.__iwmacAutoTried = true;
        onShowDetails({ auto: true });
    }

    // Toolbar is rebuilt by w2ui when navigating between sidebar nodes — keep retrying.
    function ensureButton() {
        makeButton();
        maybeAutoDetails();
    }
    setInterval(ensureButton, 750);
    if (document.body) ensureButton();
    else window.addEventListener('DOMContentLoaded', ensureButton);
})();
