// ==UserScript==
// @name         Oneflow + HubSpot Copy Products
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @version      2.4.1
// @description  Adds a copy button on Oneflow (copies product description + quantity from the tilbud PDF) and on HubSpot deal pages (copies the Line items card) as rich HTML with bold headers + bullet list.
// @author       hapnes-dev
// @match        https://app.oneflow.com/*
// @match        https://*.oneflow.com/*
// @match        https://app.hubspot.com/*
// @match        https://app-eu1.hubspot.com/*
// @match        https://*.hubspot.com/*
// @match        https://*.rocketlane.com/*
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/oneflow-copy-products/oneflow-copy-products.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/oneflow-copy-products/oneflow-copy-products.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // Shared helpers
    // ---------------------------------------------------------------------

    function escapeHtml(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    const COPY_SVG = '<svg fill="none" aria-hidden="true" height="24px" width="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"></rect><path d="M16 8V5.5C16 4.67157 15.3284 4 14.5 4H5.5C4.67157 4 4 4.67157 4 5.5V14.5C4 15.3284 4.67157 16 5.5 16H8" stroke="currentColor" stroke-width="1.5"></path></svg>';
    const CHECK_SVG = '<svg fill="none" aria-hidden="true" height="24px" width="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.5L10 17.5L19 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
    const ERROR_SVG = '<svg fill="none" aria-hidden="true" height="24px" width="24px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>';

    function svgAt(markup, size) {
        if (!size) return markup;
        return markup
            .replace(/height="[^"]*"/, 'height="' + size + '"')
            .replace(/width="[^"]*"/, 'width="' + size + '"');
    }

    async function copyRich(html, plain) {
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': new Blob([html], { type: 'text/html' }),
                        'text/plain': new Blob([plain], { type: 'text/plain' }),
                    }),
                ]);
                return true;
            } catch (e) {
                // fall through to execCommand path
            }
        }

        const holder = document.createElement('div');
        holder.contentEditable = 'true';
        holder.innerHTML = html;
        Object.assign(holder.style, {
            position: 'fixed',
            left: '-9999px',
            top: '0',
            opacity: '0',
        });
        document.body.appendChild(holder);
        const range = document.createRange();
        range.selectNodeContents(holder);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        sel.removeAllRanges();
        document.body.removeChild(holder);

        if (!ok && typeof GM_setClipboard === 'function') {
            GM_setClipboard(plain, 'text');
            ok = true;
        }
        return ok;
    }

    // ---------------------------------------------------------------------
    // Oneflow
    // ---------------------------------------------------------------------

    const ONEFLOW = (function () {
        const BTN_ID = 'of-copy-products-btn';

        function parsePct(style, key) {
            const m = (style || '').match(new RegExp(key + ':\\s*([\\d.]+)%'));
            return m ? parseFloat(m[1]) : null;
        }

        function buildRows() {
            // Multi-page PDFs: every react-pdf page has its own 0-100% top
            // space, so we must group rows per page and concatenate in page
            // order.  Collecting across all pages in one map corrupts the
            // layout (rows from page 3 land on top of page 2 at the same
            // top percentage).
            const pages = document.querySelectorAll('.react-pdf__Page__textContent');
            if (!pages.length) return [];

            const rows = [];
            pages.forEach((page, pageIndex) => {
                const spans = page.querySelectorAll('span[role="presentation"]');
                if (!spans.length) return;
                const byTop = new Map();
                for (const s of spans) {
                    const style = s.getAttribute('style');
                    const top = parsePct(style, 'top');
                    const left = parsePct(style, 'left');
                    if (top == null || left == null) continue;
                    const key = (Math.round(top * 4) / 4).toFixed(2);
                    if (!byTop.has(key)) byTop.set(key, []);
                    byTop.get(key).push({ left, top, text: s.textContent });
                }
                const pageRows = [...byTop.entries()]
                    .map(([k, items]) => ({
                        pageIndex,
                        top: parseFloat(k),
                        items: items.sort((a, b) => a.left - b.left),
                    }))
                    .sort((a, b) => a.top - b.top);
                rows.push(...pageRows);
            });
            return rows;
        }

        // Locate the header row ("Beskrivelse ... Antall ...") and read the
        // left-edge of each column so we can classify cells by position on any
        // PDF layout instead of relying on fixed percentages.
        function detectColumns(rows) {
            let headerRow = null;
            for (const r of rows) {
                const txt = r.items.map(i => i.text).join('').replace(/\s+/g, ' ').trim();
                if (/Beskrivelse/i.test(txt) && /Antall/i.test(txt)) {
                    headerRow = r;
                    break;
                }
            }
            if (!headerRow) return null;

            const findCol = (re) => {
                const hit = headerRow.items.find(i => re.test(i.text));
                return hit ? hit.left : null;
            };
            // Reconstruct the full text of a header cell that may have been
            // split across multiple spans (e.g. "Rabattert" + "Pris/stk").
            const findColByJoined = (re) => {
                const txts = headerRow.items.map(i => i.text);
                for (let i = 0; i < headerRow.items.length; i++) {
                    for (let len = 1; len <= 4 && i + len <= headerRow.items.length; len++) {
                        const joined = txts.slice(i, i + len).join(' ').replace(/\s+/g, ' ').trim();
                        if (re.test(joined)) return headerRow.items[i].left;
                    }
                }
                return null;
            };
            const descLeft = findCol(/Beskrivelse/i);
            const prisLeft = findColByJoined(/^Pris\s*\/\s*stk/i);
            const rabattLeft = findCol(/^Rabatt$/i);
            const rabattertLeft = findColByJoined(/^Rabattert\s*Pris\s*\/\s*stk/i);
            const antallLeft = findCol(/^Antall/i);
            const sumLeft = findCol(/^Sum/i);
            if (descLeft == null || antallLeft == null) return null;

            // First non-description column is whichever one sits closest to,
            // but right of, the Beskrivelse column.
            const candidates = [prisLeft, rabattLeft, rabattertLeft, antallLeft]
                .filter(v => v != null && v > descLeft);
            const firstNonDescLeft = candidates.length ? Math.min(...candidates) : antallLeft;

            return {
                headerTop: headerRow.top,
                descLeft,
                antallLeft,
                // Description = spans left of the first non-desc column.
                // Keeps Pris/stk, Rabatt, Rabattert Pris/stk, Sum out.
                descMaxLeft: firstNonDescLeft - 2,
                // Any span whose left-edge sits inside [antallLeft-2 .. sumLeft-2]
                // is considered the quantity cell.
                antallMinLeft: antallLeft - 2,
                antallMaxLeft: (sumLeft != null ? sumLeft : antallLeft + 10) - 2,
            };
        }

        // Recognise pure price / discount / quantity tokens without swallowing
        // bare digits that are part of a description like "3 x OJ Master".
        function isPriceLikeToken(t) {
            const s = (t || '').trim();
            if (!s) return false;
            // "3 140,00", "419,00", "3,14"  (Norwegian price with comma decimal)
            if (/^\d{1,3}(?:[ .]\d{3})*,\d{2}$/.test(s)) return true;
            // "30%", "12.5%"
            if (/^\d+(?:[.,]\d+)?\s*%$/.test(s)) return true;
            // "1 pcs", "13 pcs"
            if (/^\d+\s*pcs$/i.test(s)) return true;
            return false;
        }

        // Rows that appear on continuation pages but are not part of the
        // table (page header / footer, Oneflow ID etc.).
        function isNonTableRow(text) {
            return (
                /^Tilbud\s+Tilbudsdato/i.test(text) ||
                /^Generelle\s+Salgs/i.test(text) ||
                /^Oneflow\s+ID\b/i.test(text) ||
                /^Side\s+\d+\s*\/\s*\d+/i.test(text) ||
                /^Signert\b/i.test(text) ||
                /^Kundeinformasjon\b/i.test(text) ||
                /^Tilbud\s+\d{5,}/i.test(text) ||
                /^--\s*\d+\s+of\s+\d+\s*--/i.test(text)
            );
        }

        function extractItems() {
            const rows = buildRows();
            if (!rows.length) return [];
            try {
                const pageCount = document.querySelectorAll('.react-pdf__Page__textContent').length;
                console.debug('[oneflow-copy] PDF pages rendered:', pageCount, 'rows:', rows.length);
            } catch (e) {}

            const cols = detectColumns(rows);

            const items = [];
            let started = false;

            for (const row of rows) {
                const rowText = row.items.map(i => i.text).join('').replace(/\s+/g, ' ').trim();

                if (!started) {
                    if (/Beskrivelse/i.test(rowText) && /Antall/i.test(rowText)) {
                        started = true;
                    }
                    continue; // header / pre-table rows never become items
                }

                // Only stop at a real total/summary row.  Anchor to the
                // start of the row so a stray "Listepris" / "Totalsum" inside
                // a description or a page header on a continuation page
                // doesn't abort the whole extraction half-way through.
                if (/^(Installasjonkostnader|Listepris|Sum\s*eks\.?\s*mva|Totalsum|Sluttsum)\b/i.test(rowText)) {
                    try { console.debug('[oneflow-copy] stop at summary row:', rowText); } catch (e) {}
                    break;
                }
                if (isNonTableRow(rowText)) continue;
                // Skip the repeated column-header row that Oneflow prints at
                // the top of every continuation page.
                if (/^Beskrivelse\b/i.test(rowText) && /Antall/i.test(rowText)) continue;

                const descMaxLeft = cols ? cols.descMaxLeft : 45;
                const qtyMin = cols ? cols.antallMinLeft : 74;
                const qtyMax = cols ? cols.antallMaxLeft : 84;

                let desc = row.items
                    .filter(i => i.left < descMaxLeft && !isPriceLikeToken(i.text))
                    .map(i => i.text)
                    .join('')
                    .replace(/\s+/g, ' ')
                    .trim();

                const antallItem = row.items.find(
                    i => i.left >= qtyMin && i.left <= qtyMax && /\d+\s*pcs/i.test(i.text)
                );
                const antall = antallItem ? antallItem.text.trim() : '';

                // Fallback for group-header rows (e.g. "IWMAC Product: Images")
                // that sit at the very bottom of a page and sometimes don't
                // line up with the detected description column.
                const headerFromRow = rowText.match(/^(IWMAC\s+(?:Product|Modul):\s*[^0-9]+?)(?=\s*(?:\d|$))/i);
                if (!desc && headerFromRow && !antall) {
                    desc = headerFromRow[1].trim();
                }

                if (!desc && !antall) continue;

                const isHeader = /^IWMAC\s+(Product|Modul):/i.test(desc);
                // Only these prefixes indicate a "main" item.  Anything else
                // (e.g. "3 x OJ Master", "360.02 Sosiale rom", "Emicon VP x 2",
                // "Brannsentral - Previdia Max", "Oversiktsbilde for lysstyring",
                // "HW i abo") is a sub-description of the preceding main item.
                const mainPrefix = /^(IWMAC|Integration|Per|Freight)\b/i;

                if (!desc && antall && items.length) {
                    // Antall-only row.  Walk back through consecutive
                    // no-antall bullets until we hit a header or a bullet
                    // that already has an antall, then attach to the first
                    // bullet in that block (the main description).
                    let idx = items.length - 1;
                    while (idx > 0) {
                        const prev = items[idx - 1];
                        if (prev.type !== 'bullet' || prev.antall) break;
                        idx--;
                    }
                    if (items[idx] && items[idx].type === 'bullet') {
                        items[idx].antall = antall;
                    }
                } else if (isHeader) {
                    items.push({ type: 'header', desc });
                } else if (desc && antall && !mainPrefix.test(desc)) {
                    // Row has both a description and an antall, but the
                    // description is actually a sub-line that visually
                    // shares a row with the parent's price cell (e.g.
                    // "3 x OJ Master 9 644,00 30% 6 750,80 4 pcs 27 003,20").
                    // Re-attach the antall to the nearest preceding main
                    // bullet that has no antall yet, and push this row as
                    // a plain sub-description (no quantity).
                    let idx = items.length - 1;
                    while (idx >= 0) {
                        const cur = items[idx];
                        if (cur.type === 'header') { idx = -1; break; }
                        if (cur.antall) { idx = -1; break; }
                        if (mainPrefix.test(cur.desc)) break;
                        idx--;
                    }
                    if (idx >= 0 && items[idx] && items[idx].type === 'bullet' && !items[idx].antall) {
                        items[idx].antall = antall;
                        items.push({ type: 'bullet', desc, antall: '' });
                    } else {
                        items.push({ type: 'bullet', desc, antall });
                    }
                } else if (desc) {
                    items.push({ type: 'bullet', desc, antall });
                }
            }

            // Merge lowercase continuation rows ("external sensor 2m") into the
            // previous bullet, inserting before any existing " | N pcs".
            for (let i = items.length - 1; i > 0; i--) {
                const cur = items[i];
                const prev = items[i - 1];
                if (
                    cur.type === 'bullet' &&
                    prev.type === 'bullet' &&
                    !cur.antall &&
                    /^[a-zæøå]/.test(cur.desc)
                ) {
                    prev.desc = prev.desc + ' ' + cur.desc;
                    items.splice(i, 1);
                }
            }

            return items;
        }

        // Preferred path: hit the same session API the SPA uses.  Box type 13
        // is the product table; each content.data entry has key="product" and
        // a value with name + count.  count===0 means the product was not
        // selected (e.g. unchecked freebie) so we skip it to match the PDF.
        async function fetchProductsViaApi() {
            const m = location.pathname.match(/\/documents\/(\d+)/);
            if (!m) return null;
            const id = m[1];
            try {
                const r = await fetch('/api/agreements/' + id, {
                    credentials: 'include',
                    headers: { 'Accept': 'application/json' },
                });
                if (!r.ok) return null;
                const j = await r.json();
                if (!j || !Array.isArray(j.boxes)) return null;
                const items = [];
                for (const box of j.boxes) {
                    if (box.type !== 13) continue;
                    const data = (box.content && box.content.data) || [];
                    for (const d of data) {
                        if (d.key !== 'product' || !d.value) continue;
                        const name = (d.value.name || '').trim();
                        const count = Number(d.value.count) || 0;
                        if (!name) continue;
                        if (count <= 0) continue;
                        items.push({
                            type: 'bullet',
                            desc: name,
                            antall: count + ' pcs',
                        });
                    }
                }
                return items;
            } catch (e) {
                try { console.debug('[oneflow-copy] api fetch failed:', e); } catch (_) {}
                return null;
            }
        }

        // Fallback for documents that render as native Oneflow content
        // instead of a react-pdf preview (no .react-pdf__Page__textContent).
        function extractFromNativeContent() {
            const wrappers = document.querySelectorAll('[class*="_ProductTableWrapper_"]');
            const items = [];
            for (const wrapper of wrappers) {
                const rows = wrapper.querySelectorAll('[class*="_TableRow_"]');
                for (const row of rows) {
                    if (/_HeaderRow_/.test(row.className)) continue;
                    const nameCell = row.querySelector('[class*="_ProductNameCell_"]');
                    if (!nameCell) continue;
                    const desc = (nameCell.textContent || '').replace(/\s+/g, ' ').trim();
                    if (!desc) continue;

                    const qtyCell = row.querySelector('[class*="_ProductQuantityCell_"]');
                    let antall = '';
                    if (qtyCell) {
                        const numInput = qtyCell.querySelector('input[type="number"]');
                        const radio = qtyCell.querySelector('input[type="radio"]');
                        const checkbox = qtyCell.querySelector('input[type="checkbox"]');
                        if (numInput && numInput.value) {
                            const m = numInput.value.match(/^\s*(\d+)/);
                            if (m) antall = m[1] + ' pcs';
                        } else if (radio && radio.checked) {
                            antall = '1 pcs';
                        } else if (checkbox && checkbox.checked) {
                            antall = '1 pcs';
                        } else {
                            const m = (qtyCell.textContent || '').match(/(\d+)\s*pcs/i);
                            if (m) antall = m[1] + ' pcs';
                        }
                    }
                    items.push({ type: 'bullet', desc, antall });
                }
            }
            return items;
        }

        // A "sub" bullet is a description line without its own quantity and
        // that doesn't start with one of the main product prefixes.  We attach
        // it to the previous main bullet so output reads
        //   • Main product — 2 pcs
        //       - sub description
        function nestItems(items) {
            const MAIN = /^(IWMAC|Integration|Per|Freight)\b/i;
            const out = [];
            for (const it of items) {
                if (it.type === 'header') {
                    out.push(it);
                    continue;
                }
                const isMain = !!it.antall || MAIN.test(it.desc);
                if (isMain) {
                    out.push(Object.assign({ subs: [] }, it));
                } else {
                    const last = out[out.length - 1];
                    if (last && last.type === 'bullet' && last.subs) {
                        last.subs.push(it);
                    } else {
                        out.push(Object.assign({ subs: [] }, it));
                    }
                }
            }
            return out;
        }

        function stripSubPrefix(s) {
            return (s || '').replace(/^[-–—•]\s*/, '');
        }

        function itemsToHtml(items) {
            const nested = nestItems(items);
            let html = '<p><strong>Oneflow document info:</strong></p>';
            let inList = false;
            const openList = () => {
                if (!inList) { html += '<ul>'; inList = true; }
            };
            const closeList = () => {
                if (inList) { html += '</ul>'; inList = false; }
            };

            for (const it of nested) {
                if (it.type === 'header') {
                    closeList();
                    html += '<p><strong>' + escapeHtml(it.desc) + '</strong></p>';
                } else {
                    openList();
                    const tail = it.antall
                        ? ' &mdash; <strong>' + escapeHtml(it.antall) + '</strong>'
                        : '';
                    html += '<li>' + escapeHtml(it.desc) + tail;
                    if (it.subs && it.subs.length) {
                        html += '<ul>';
                        for (const sub of it.subs) {
                            html += '<li>' + escapeHtml(stripSubPrefix(sub.desc)) + '</li>';
                        }
                        html += '</ul>';
                    }
                    html += '</li>';
                }
            }
            closeList();
            return html;
        }

        function itemsToPlain(items) {
            const nested = nestItems(items);
            const lines = [];
            nested.forEach((it, idx) => {
                if (it.type === 'header') {
                    if (idx > 0) lines.push('');
                    lines.push(it.desc);
                } else {
                    lines.push('• ' + it.desc + (it.antall ? ' — ' + it.antall : ''));
                    if (it.subs) {
                        for (const sub of it.subs) {
                            lines.push('    - ' + stripSubPrefix(sub.desc));
                        }
                    }
                }
            });
            return 'Oneflow document info:\n' + lines.join('\n');
        }

        function flashButton(btn, ok) {
            btn.innerHTML = ok ? CHECK_SVG : ERROR_SVG;
            btn.style.color = ok ? '#0a7d3b' : '#c0392b';
            setTimeout(() => {
                btn.innerHTML = COPY_SVG;
                btn.style.color = '';
            }, 1500);
        }

        // react-pdf lazy-renders pages on scroll: every `._PdfPage_` placeholder
        // only gets its `.react-pdf__Page__textContent` once it is scrolled into
        // view.  Force-render every page before extracting so multi-page
        // offers don't stop at the end of page 1.
        function ensureAllPagesRendered() {
            return new Promise((resolve) => {
                const pages = [...document.querySelectorAll('._PdfPage_iv0eo_10, [class*="_PdfPage_"]')];
                if (!pages.length) { resolve(); return; }

                const scroller =
                    document.querySelector('._Scrollable_vt0q8_62') ||
                    pages[0].closest('[class*="_Scrollable_"]') ||
                    document.scrollingElement;
                const originalScrollTop = scroller ? scroller.scrollTop : 0;

                const isRendered = (p) => !!p.querySelector('.react-pdf__Page__textContent span[role="presentation"]');

                let i = 0;
                const step = () => {
                    if (i >= pages.length) {
                        if (scroller) scroller.scrollTop = originalScrollTop;
                        resolve();
                        return;
                    }
                    const page = pages[i];
                    if (isRendered(page)) { i++; step(); return; }

                    try { page.scrollIntoView({ block: 'center', behavior: 'instant' }); }
                    catch (e) { page.scrollIntoView({ block: 'center' }); }

                    const start = Date.now();
                    const waitForPage = () => {
                        if (isRendered(page)) { i++; step(); return; }
                        if (Date.now() - start > 2500) { i++; step(); return; }
                        setTimeout(waitForPage, 80);
                    };
                    setTimeout(waitForPage, 80);
                };
                step();
            });
        }

        function buildButton(referenceTab) {
            const btn = document.createElement('button');
            btn.id = BTN_ID;
            btn.type = 'button';
            btn.title = 'Copy products (description + quantity)';
            btn.setAttribute('aria-label', 'Copy products');
            if (referenceTab && referenceTab.className) {
                btn.className = referenceTab.className.replace(/_ActiveTabTrigger[^ ]*/g, '').trim();
            }
            btn.innerHTML = COPY_SVG;
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    // PDF is the canonical signed document and carries
                    // section headers ("IWMAC Modul: ..."), so prefer it when
                    // present.  API + native DOM are fallbacks for docs that
                    // have no PDF render (newer "native content" Oneflow docs).
                    await ensureAllPagesRendered();
                    let items = extractItems();
                    if (!items.length) items = (await fetchProductsViaApi()) || [];
                    if (!items.length) items = extractFromNativeContent();
                    if (!items.length) {
                        flashButton(btn, false);
                        return;
                    }
                    const html = itemsToHtml(items);
                    const plain = itemsToPlain(items);
                    const ok = await copyRich(html, plain);
                    flashButton(btn, ok);
                } finally {
                    btn.disabled = false;
                }
            });
            return btn;
        }

        function injectButton() {
            if (document.getElementById(BTN_ID)) return;
            const tabs = document.querySelector('[role="tablist"][aria-orientation="vertical"]');
            if (!tabs) return;
            const referenceTab = tabs.querySelector('button[role="tab"]');
            tabs.appendChild(buildButton(referenceTab));
        }

        return { injectButton };
    })();

    // ---------------------------------------------------------------------
    // HubSpot
    // ---------------------------------------------------------------------

    const HUBSPOT = (function () {
        const BTN_ID = 'hs-copy-line-items-btn';

        function findLineItemsCard() {
            const titles = document.querySelectorAll('span[data-selenium-test="crm-card-title"]');
            for (const t of titles) {
                if (!/line items/i.test(t.textContent || '')) continue;
                let n = t;
                while (n && n !== document.body) {
                    if (n.querySelector && n.querySelector('[data-test-id="line-items-card-line-item"]')) {
                        return n;
                    }
                    n = n.parentElement;
                }
                return t.closest('[class*="ExpandableWrapper"]') || t.parentElement;
            }
            return null;
        }

        function extractItems(card) {
            const rows = card.querySelectorAll('[data-test-id="line-items-card-line-item"]');
            const items = [];
            for (const row of rows) {
                const nameNode =
                    row.querySelector(
                        '[data-test-id="line-items-card-line-item-name-quantity"] .TruncateString__TruncateStringInner-gODLZE span'
                    ) ||
                    row.querySelector(
                        '[data-test-id="line-items-card-line-item-name-quantity"] p span > span'
                    );
                const qtyNode = row.querySelector('[data-test-id="line-items-card-line-item-quantity"]');

                const desc = (nameNode ? nameNode.textContent : '').replace(/\s+/g, ' ').trim();
                const qty = qtyNode ? (qtyNode.textContent || '').replace(/\s+/g, '').trim() : '';

                if (!desc && !qty) continue;
                items.push({ desc, qty });
            }
            return items;
        }

        function itemsToHtml(items) {
            let html = '<p><strong>HubSpot line items:</strong></p><ul>';
            for (const it of items) {
                const tail = it.qty
                    ? ' &mdash; <strong>' + escapeHtml(it.qty) + '</strong>'
                    : '';
                html += '<li>' + escapeHtml(it.desc) + tail + '</li>';
            }
            html += '</ul>';
            return html;
        }

        function itemsToPlain(items) {
            const body = items
                .map(it => '• ' + it.desc + (it.qty ? ' — ' + it.qty : ''))
                .join('\n');
            return 'HubSpot line items:\n' + body;
        }

        function renderButtonContent(btn, state) {
            let svg = svgAt(COPY_SVG, '16');
            let label = 'Copy';
            if (state === 'ok') { svg = svgAt(CHECK_SVG, '16'); label = 'Copied'; }
            else if (state === 'err') { svg = svgAt(ERROR_SVG, '16'); label = 'Failed'; }
            btn.innerHTML =
                '<span style="display:inline-flex;align-items:center;gap:4px;">' +
                svg + '<span>' + label + '</span></span>';
        }

        function flashButton(btn, ok) {
            renderButtonContent(btn, ok ? 'ok' : 'err');
            btn.style.color = ok ? '#0a7d3b' : '#c0392b';
            setTimeout(() => {
                renderButtonContent(btn, 'idle');
                btn.style.color = '';
            }, 1500);
        }

        function buildButton(referenceLink, card) {
            const btn = document.createElement('button');
            btn.id = BTN_ID;
            btn.type = 'button';
            btn.title = 'Copy line items (description + quantity)';
            btn.setAttribute('aria-label', 'Copy line items');
            if (referenceLink && referenceLink.className) {
                btn.className = referenceLink.className;
            }
            Object.assign(btn.style, {
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 8px',
                marginRight: '4px',
                font: 'inherit',
            });
            renderButtonContent(btn, 'idle');
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const items = extractItems(card);
                if (!items.length) {
                    flashButton(btn, false);
                    return;
                }
                const html = itemsToHtml(items);
                const plain = itemsToPlain(items);
                const ok = await copyRich(html, plain);
                flashButton(btn, ok);
            });
            return btn;
        }

        function removeStaleButton() {
            const existing = document.getElementById(BTN_ID);
            if (!existing) return;
            const card = existing.closest('[class*="ExpandableWrapper"]');
            if (!card || !card.querySelector('span[data-selenium-test="crm-card-title"]')) {
                existing.remove();
            }
        }

        function injectButton() {
            removeStaleButton();
            if (document.getElementById(BTN_ID)) return;
            const card = findLineItemsCard();
            if (!card) return;

            const actions = card.querySelector('span[data-selenium-test="crm-card-actions"]');
            if (!actions) return;

            const editLink = actions.querySelector('a[data-test-id^="line-items-card-action"]');
            const flexContainer = editLink ? editLink.parentElement : null;

            const btn = buildButton(editLink, card);

            if (flexContainer && editLink) {
                flexContainer.insertBefore(btn, editLink);
            } else {
                actions.insertBefore(btn, actions.firstChild);
            }
        }

        return { injectButton };
    })();

    // ---------------------------------------------------------------------
    // Rocketlane: make the ag-grid cell-editor popup bigger and resizable
    // ---------------------------------------------------------------------

    const ROCKETLANE = (function () {
        const STYLE_ID = 'rl-popup-editor-resize-style';
        const TOOLTIP_ID = 'rl-custom-cell-tooltip';
        const DEFAULT_W = 640;
        const DEFAULT_H = 420;
        const TIP_MAX_W = 640;
        const TIP_MAX_H = 420;

        function injectStyle() {
            if (document.getElementById(STYLE_ID)) return;
            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = `
                /* make ag-grid's default dark tooltip invisible (keep
                   layout so the library doesn't retry positioning) */
                .ag-tooltip,
                .ag-tooltip-custom {
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
                /* neutralize only dedicated tooltip components while our
                   own comment tooltip is active.  We keep them rendered
                   but invisible so the host library doesn't keep
                   re-creating / re-positioning them (which causes
                   flicker). */
                body.rl-tooltip-active [role="tooltip"]:not(#${TOOLTIP_ID}),
                body.rl-tooltip-active [data-tippy-root],
                body.rl-tooltip-active [class*="tippy-box"],
                body.rl-tooltip-active .tippy-content {
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
                /* floating light-blue outline anchored over the hovered cell */
                #rl-hover-focus-box {
                    position: fixed;
                    pointer-events: none;
                    border: 2px solid #60a5fa;
                    background: rgba(96, 165, 250, 0.08);
                    border-radius: 3px;
                    box-sizing: border-box;
                    z-index: 2147483646;
                    opacity: 0;
                    visibility: hidden;
                    /* no position transitions: snap to the cell to avoid
                       perceived blink when mouseover fires repeatedly */
                    transition: opacity 100ms ease;
                }
                #rl-hover-focus-box.is-visible {
                    opacity: 1;
                    visibility: visible;
                }
                /* custom hover tooltip matching the popup editor style */
                #${TOOLTIP_ID} {
                    position: fixed;
                    z-index: 2147483647;
                    background: #fff;
                    color: #1a1a1a;
                    border-radius: 6px;
                    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
                    padding: 12px 16px;
                    max-width: ${TIP_MAX_W}px;
                    max-height: ${TIP_MAX_H}px;
                    overflow: auto;
                    overscroll-behavior: contain;
                    font-size: 13px;
                    line-height: 1.45;
                    box-sizing: border-box;
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none;
                    transition: opacity 140ms ease, visibility 140ms;
                    user-select: text;
                    -webkit-user-select: text;
                }
                #${TOOLTIP_ID}.is-visible {
                    opacity: 1;
                    visibility: visible;
                    pointer-events: auto;
                }
                #${TOOLTIP_ID} * {
                    user-select: text;
                    -webkit-user-select: text;
                }
                #${TOOLTIP_ID} p { margin: 0 0 6px; }
                #${TOOLTIP_ID} p:last-child { margin-bottom: 0; }
                #${TOOLTIP_ID} ul,
                #${TOOLTIP_ID} ol { margin: 4px 0 6px; padding-left: 22px; }
                #${TOOLTIP_ID} li { margin: 2px 0; }
                .ag-popup-editor [data-field-type="MultiLineText"],
                .ag-popup-editor [data-field-type="RichText"] {
                    max-width: 95vw;
                    max-height: 90vh;
                    min-width: 320px;
                    min-height: 240px;
                    resize: both !important;
                    overflow: hidden !important;
                    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
                    border-radius: 6px;
                    background: #fff;
                    box-sizing: border-box !important;
                    padding: 0 !important;
                    position: relative !important;
                }
                .ag-popup-editor [data-field-type="MultiLineText"] > *,
                .ag-popup-editor [data-field-type="RichText"] > * {
                    position: absolute !important;
                    inset: 0 !important;
                    width: auto !important;
                    height: auto !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    box-sizing: border-box !important;
                    display: block !important;
                }
                .ag-popup-editor [data-field-type="MultiLineText"] [id^="editor_"],
                .ag-popup-editor [data-field-type="RichText"] [id^="editor_"] {
                    position: absolute !important;
                    inset: 0 !important;
                    width: auto !important;
                    height: auto !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    box-sizing: border-box !important;
                    display: block !important;
                    max-height: none !important;
                    min-height: 0 !important;
                }
                .ag-popup-editor [data-field-type="MultiLineText"] .ck-editor__editable_inline,
                .ag-popup-editor [data-field-type="MultiLineText"] .ck.ck-editor__editable,
                .ag-popup-editor [data-field-type="RichText"] .ck-editor__editable_inline,
                .ag-popup-editor [data-field-type="RichText"] .ck.ck-editor__editable {
                    position: absolute !important;
                    inset: 0 !important;
                    width: auto !important;
                    height: auto !important;
                    margin: 0 !important;
                    overflow-y: auto !important;
                    overflow-x: hidden !important;
                    max-height: none !important;
                    min-height: 0 !important;
                    resize: none !important;
                    box-sizing: border-box !important;
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        }

        function applyInlineSize(wrapper) {
            if (!wrapper || wrapper.dataset.rlResized === '1') return;
            const fieldType = wrapper.getAttribute('data-field-type') || '';
            // Only resize genuine comment / rich-text popups.  Leave plain
            // single-line text, number and other small editors alone so
            // Rocketlane can size and position them normally.
            if (!/MultiLineText|RichText/i.test(fieldType)) return;
            wrapper.dataset.rlResized = '1';
            wrapper.style.setProperty('width', DEFAULT_W + 'px');
            wrapper.style.setProperty('height', DEFAULT_H + 'px');

            const popup = wrapper.closest('.ag-popup-editor');
            if (popup) {
                const rect = popup.getBoundingClientRect();
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                if (rect.left + DEFAULT_W > vw - 8) {
                    const newLeft = Math.max(8, vw - DEFAULT_W - 16);
                    popup.style.left = newLeft + 'px';
                }
                if (rect.top + DEFAULT_H > vh - 8) {
                    const newTop = Math.max(8, vh - DEFAULT_H - 16);
                    popup.style.top = newTop + 'px';
                }
            }
        }

        function scanPopups() {
            const wrappers = document.querySelectorAll(
                '.ag-popup-editor [data-field-type]'
            );
            wrappers.forEach(applyInlineSize);
        }

        function reanchorFocusBox() {
            if (!hoverKey || !focusBoxEl) return;
            if (!focusBoxEl.classList.contains('is-visible')) return;
            const cells = document.querySelectorAll('.ag-cell');
            for (const c of cells) {
                if (cellKey(c) === hoverKey) {
                    if (c !== hoverCell) hoverCell = c;
                    showFocusBox(c);
                    break;
                }
            }
        }

        let tipEl = null;
        let focusBoxEl = null;
        let hoverCell = null;
        let hoverKey = null;
        let hideTimer = null;

        // Stable identifier for a cell that survives ag-grid DOM recycling.
        function cellKey(cell) {
            if (!cell) return null;
            const row = cell.closest('[row-id]') ||
                        cell.closest('.ag-row');
            const colId = cell.getAttribute('col-id') || '';
            const rowId = row ? (row.getAttribute('row-id') ||
                                  row.getAttribute('row-index') || '') : '';
            if (!rowId && !colId) return null;
            return rowId + '|' + colId;
        }

        function cancelHide() {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        }
        function scheduleHide(delay) {
            cancelHide();
            hideTimer = setTimeout(() => {
                hideTimer = null;
                hideTip();
            }, delay != null ? delay : 120);
        }

        function ensureTip() {
            if (tipEl && document.body.contains(tipEl)) return tipEl;
            tipEl = document.createElement('div');
            tipEl.id = TOOLTIP_ID;
            tipEl.addEventListener('mouseenter', cancelHide);
            tipEl.addEventListener('mouseleave', (e) => {
                const to = e.relatedTarget;
                const toCell = to && to.closest && to.closest('.ag-cell');
                if (toCell && cellKey(toCell) === hoverKey) return;
                scheduleHide(120);
            });
            // Keep wheel/touch scroll inside the tooltip so the grid behind
            // doesn't scroll and close the tooltip.
            tipEl.addEventListener('wheel', (e) => { e.stopPropagation(); }, { passive: true });
            tipEl.addEventListener('touchmove', (e) => { e.stopPropagation(); }, { passive: true });

            // Click-through behavior: if the user clicks (not drags) on the
            // tooltip we treat it as a click on the underlying cell, so the
            // edit popup opens.  A drag is left alone so text can be selected
            // and copied from the tooltip.
            let downPos = null;
            tipEl.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                const c = currentHoverCellEl();
                downPos = { x: e.clientX, y: e.clientY, cell: c };
            });
            tipEl.addEventListener('mouseup', (e) => {
                const d = downPos;
                downPos = null;
                if (!d || e.button !== 0) return;
                if (Math.abs(e.clientX - d.x) > 3 || Math.abs(e.clientY - d.y) > 3) return;
                // Swallow the real click; we'll dispatch our own on the cell.
                e.preventDefault();
                e.stopPropagation();
                const cell = d.cell || currentHoverCellEl();
                if (!cell) { hideTip(); return; }
                openCellEditor(cell);
            });
            tipEl.addEventListener('click', (e) => {
                // Prevent the native click on the tooltip from reaching anyone
                // when we forwarded it; harmless otherwise.
                e.stopPropagation();
            }, true);

            document.body.appendChild(tipEl);
            return tipEl;
        }

        function currentHoverCellEl() {
            if (hoverCell && document.body.contains(hoverCell)) return hoverCell;
            if (!hoverKey) return null;
            const cells = document.querySelectorAll('.ag-cell');
            for (const c of cells) if (cellKey(c) === hoverKey) return c;
            return null;
        }

        function openCellEditor(cell) {
            hideTip();
            // Temporarily neutralize the tooltip so elementFromPoint returns
            // the real cell under the cursor / cell center.
            const rect = cell.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const prevPE = tipEl ? tipEl.style.pointerEvents : '';
            if (tipEl) tipEl.style.pointerEvents = 'none';
            const target = document.elementFromPoint(cx, cy) || cell;
            if (tipEl) tipEl.style.pointerEvents = prevPE;

            // HTMLElement.click() fires a real click event that React /
            // ag-grid delegation picks up reliably.
            if (typeof target.click === 'function') {
                try { target.click(); } catch (_) { /* ignore */ }
            }
            // Some grids require a double-click to enter edit mode.
            const mk = (type) => new MouseEvent(type, {
                bubbles: true, cancelable: true, composed: true, view: window,
                clientX: cx, clientY: cy, screenX: cx, screenY: cy,
                button: 0, buttons: 0, detail: type === 'dblclick' ? 2 : 1,
            });
            target.dispatchEvent(mk('dblclick'));
        }

        function ensureFocusBox() {
            if (focusBoxEl && document.body.contains(focusBoxEl)) return focusBoxEl;
            focusBoxEl = document.createElement('div');
            focusBoxEl.id = 'rl-hover-focus-box';
            document.body.appendChild(focusBoxEl);
            return focusBoxEl;
        }

        function showFocusBox(cell) {
            const box = ensureFocusBox();
            const rect = cell.getBoundingClientRect();
            const left = Math.round(rect.left);
            const top = Math.round(rect.top);
            const width = Math.round(rect.width);
            const height = Math.round(rect.height);
            if (box._rlLeft !== left) {
                box.style.left = left + 'px';
                box._rlLeft = left;
            }
            if (box._rlTop !== top) {
                box.style.top = top + 'px';
                box._rlTop = top;
            }
            if (box._rlWidth !== width) {
                box.style.width = width + 'px';
                box._rlWidth = width;
            }
            if (box._rlHeight !== height) {
                box.style.height = height + 'px';
                box._rlHeight = height;
            }
            if (!box.classList.contains('is-visible')) {
                box.classList.add('is-visible');
            }
        }

        function hideFocusBox() {
            if (focusBoxEl) focusBoxEl.classList.remove('is-visible');
        }


        function cellHasRichContent(cell) {
            if (!cell) return false;
            // only genuine rich-text / multi-line comment cells,
            // never icon / badge / progress / status cells
            const rich = cell.querySelector(
                '[class*="rich-text-editor"], .ck-content, [class*="multi-line-text"]'
            );
            if (!rich) return false;
            const text = rich.textContent.replace(/\s+/g, ' ').trim();
            // ignore "empty" placeholder renderings like "", "—", "-", "n/a".
            if (text.length < 2) return false;
            if (/^[\-\u2013\u2014\u2022\s.]+$/.test(text)) return false;
            return true;
        }

        function getCellHtml(cell) {
            const rich = cell.querySelector(
                '[class*="rich-text-editor"] .ck-content, .ck-content, [class*="rich-text-editor"]'
            );
            if (rich && rich.innerHTML.trim()) return rich.innerHTML;
            const inner = cell.querySelector('.ag-cell-value') || cell;
            return inner.innerHTML;
        }

        function positionTip(tip, cell) {
            const rect = cell.getBoundingClientRect();
            tip.style.left = '-9999px';
            tip.style.top = '0px';
            const tw = Math.min(TIP_MAX_W, tip.offsetWidth);
            const th = Math.min(TIP_MAX_H, tip.offsetHeight);
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let left = rect.left;
            let top = rect.bottom + 4;
            if (left + tw > vw - 8) left = Math.max(8, vw - tw - 8);
            if (top + th > vh - 8) top = Math.max(8, rect.top - th - 4);
            tip.style.left = left + 'px';
            tip.style.top = top + 'px';
        }

        function showTipFor(cell) {
            cancelHide();
            const tip = ensureTip();
            const key = cellKey(cell);
            hoverCell = cell;
            showFocusBox(cell);
            // Only re-render content when we move to a different logical cell.
            if (key !== hoverKey) {
                hoverKey = key;
                tip.innerHTML = getCellHtml(cell);
                positionTip(tip, cell);
            }
            tip.classList.add('is-visible');
            document.body.classList.add('rl-tooltip-active');
        }

        function hideTip() {
            if (tipEl) tipEl.classList.remove('is-visible');
            hideFocusBox();
            document.body.classList.remove('rl-tooltip-active');
            hoverCell = null;
            hoverKey = null;
        }

        function isInTip(node) {
            return tipEl && node && (node === tipEl || tipEl.contains(node));
        }

        function onMouseOver(e) {
            const t = e.target;
            if (isInTip(t)) { cancelHide(); return; }

            const cell = t.closest && t.closest('.ag-cell');
            if (!cell) {
                scheduleHide(120);
                return;
            }

            // don't show tooltip while an editor popup is open
            if (document.querySelector('.ag-popup-editor')) {
                hideTip();
                return;
            }
            const key = cellKey(cell);
            if (key && key === hoverKey) {
                cancelHide();
                hoverCell = cell;
                showFocusBox(cell);
                return;
            }
            if (!cellHasRichContent(cell)) {
                scheduleHide(120);
                return;
            }
            showTipFor(cell);
        }

        function onMouseOut(e) {
            const to = e.relatedTarget;
            if (isInTip(to)) { cancelHide(); return; }
            const toCell = to && to.closest && to.closest('.ag-cell');
            if (toCell && cellKey(toCell) === hoverKey) { cancelHide(); return; }
            scheduleHide(120);
        }

        function onMouseDown(e) {
            // Do nothing unless our tooltip is actually on screen - we never
            // want to interfere with normal cell click / edit behavior.
            if (!tipEl || !tipEl.classList.contains('is-visible')) return;
            // Clicks inside the tooltip are handled by the tooltip's own
            // mouseup listener (drag = text selection, click = open editor).
            if (isInTip(e.target)) return;
            hideTip();
        }

        function onWheel(e) {
            if (!tipEl || !tipEl.classList.contains('is-visible')) return;
            const target = e.target;
            const inTip = isInTip(target);
            let inCell = false;
            if (!inTip && target && target.closest) {
                const cell = target.closest('.ag-cell');
                inCell = !!(cell && cellKey(cell) === hoverKey);
            }
            if (!inTip && !inCell) return;
            // If cursor is over our cell, redirect wheel to the tooltip
            // and prevent the grid from scrolling (which would close it).
            if (inCell) {
                tipEl.scrollTop += e.deltaY;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            // If cursor is over the tooltip, let the tooltip scroll normally
            // but stop the event from bubbling to the grid.
            e.stopPropagation();
        }

        function installHover() {
            if (installHover._done) return;
            installHover._done = true;
            document.addEventListener('mouseover', onMouseOver, true);
            document.addEventListener('mouseout', onMouseOut, true);
            document.addEventListener('wheel', onWheel, { capture: true, passive: false });
            document.addEventListener('scroll', (e) => {
                if (isInTip(e.target)) return;
                hideTip();
            }, true);
            // Hide the tooltip on mousedown outside it; leave mousedown
            // inside the tooltip alone so text selection / copy works.
            document.addEventListener('mousedown', onMouseDown, true);
            window.addEventListener('blur', hideTip);
        }

        return { injectStyle, scanPopups, installHover, reanchorFocusBox, hideTip };
    })();

    // ---------------------------------------------------------------------
    // Router: pick the right injector for the current host
    // ---------------------------------------------------------------------

    const host = location.hostname;
    const isHubSpot = /hubspot\.com$/i.test(host);
    const isOneflow = /oneflow\.com$/i.test(host);
    const isRocketlane = /rocketlane\.com$/i.test(host);

    if (isRocketlane) {
        ROCKETLANE.injectStyle();
        ROCKETLANE.installHover();
    }

    const tick = () => {
        if (isHubSpot) HUBSPOT.injectButton();
        if (isOneflow) ONEFLOW.injectButton();
        if (isRocketlane) {
            ROCKETLANE.scanPopups();
            ROCKETLANE.reanchorFocusBox();
            if (document.querySelector('.ag-popup-editor')) ROCKETLANE.hideTip();
        }
    };

    // Debounce so a burst of DOM mutations during e.g. a cell click doesn't
    // cause hundreds of synchronous scans and starve the host app's handlers.
    let tickScheduled = false;
    const scheduleTick = () => {
        if (tickScheduled) return;
        tickScheduled = true;
        requestAnimationFrame(() => {
            tickScheduled = false;
            try { tick(); } catch (_) { /* ignore */ }
        });
    };

    const obs = new MutationObserver(scheduleTick);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    tick();
})();
