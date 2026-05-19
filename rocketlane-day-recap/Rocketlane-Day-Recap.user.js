// ==UserScript==
// @name         Rocketlane Day Recap
// @version      4.10
// @description  On Rocketlane My Timesheet, pick a date and see all IWMAC plants you visited that day. Uses pang's get_history API across known plants.
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-day-recap/Rocketlane-Day-Recap.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-day-recap/Rocketlane-Day-Recap.user.js
// @match        https://kiona.rocketlane.com/timesheets/*
// @match        http://*.plants.iwmac.local:8080/*
// @match        http://tools.iwmac.local/pang.qxs*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      tools.iwmac.local
// @connect      iwmac.local
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const KEY_KNOWN_PLANTS = 'known_plants';   // [plant_id, ...]
    const KEY_PLANT_NAMES  = 'plant_names';    // { plant_id: name }
    const KEY_USERNAME     = 'pang_username';
    const KEY_LAST_HARVEST = 'last_harvest_ts'; // ms timestamp of most recent successful harvest write
    const KEY_HARVEST_DONE = 'harvest_done_ts'; // set when syncFromPang considers itself complete
    const KEY_NAME_LOOKUP_IDS = 'name_lookup_ids'; // [plant_id, ...] requested by Rocketlane for a targeted pang sync
    const SCRIPT_VERSION   = '4.10';
    const KEY_WORKDAY_HOURS    = 'workday_hours';
    const DEFAULT_WORKDAY_HOURS = 7.5;
    const ROUND_TO_MIN         = 5; // round each plant's normalized minutes to nearest 5 min
    // Time-spent estimator: cross-plant attribution.
    // Pang only logs discrete clicks, not real "active work" time, so any estimate is an
    // approximation. We build ONE chronological timeline of every action across ALL plants
    // for the day, then for each consecutive pair (a, b) we credit the gap (b.ts − a.ts)
    // to plant_a — capped at MAX_GAP_MS so a long absence (lunch, end-of-day) isn't
    // attributed to whichever plant you last touched. The day's last action gets a small
    // tail buffer. Result: total estimated time ≤ wall-clock span and is split across
    // plants in proportion to how long each plant "owned" the timeline.
    const MAX_GAP_MS     = 30 * 60 * 1000;
    const TAIL_BUFFER_MS =  5 * 60 * 1000;
    const LOG = (...args) => console.log('[Day Recap v' + SCRIPT_VERSION + ']', ...args);
    const KEY_NAMES_PURGED = 'plant_names_purged_v44'; // bump to re-run cleanup; v44 evicts "Ukjent anlegg" titles
    const PANEL_ID = 'rl-day-recap-panel';
    const BTN_ID   = 'rl-day-recap-fab';
    const PARALLEL = 8;
    const FULL_INVENTORY_MIN = 7000;
    const TRUSTED_PLANT_NAMES = {
        '8179': 'COOP Extra Glommen Brygge',
    };

    const host = location.hostname;

    // Names that v3.6 may have scraped from plant-admin error pages. None of these
    // are real IWMAC plant names, so we treat them as "no name captured yet".
    const BAD_NAME_RE = /^(forbidden|unauthorized|access denied|not found|bad gateway|service unavailable|gateway timeout|401|403|404|5\d\d|error|index of|nginx|apache|iis|welcome to)/i;
    const BAD_NAME_FRAGMENT_RE = /\b(ukjent anlegg|unknown plant)\b/i;
    // Generic IWMAC template defaults that some plants' settings DB still carries (project_name,
    // server_name, plant_server_name) when no real plant name was set. These slipped into the
    // cache from an old SQL fallback. They are NOT real plant names — evict them.
    const BAD_NAME_EXACT = new Set([
        'iwmac supermarket',
        'iwmac operation center',
        'iwmac plant server',
        'iwmac',
        'plant admin: next generation',
        'plant admin',
    ]);
    function looksLikeBadName(s) {
        if (typeof s !== 'string') return true;
        const t = s.trim();
        if (!t) return true;
        if (t.length > 120) return true; // real names are short
        if (BAD_NAME_RE.test(t)) return true;
        if (BAD_NAME_FRAGMENT_RE.test(t)) return true;
        if (BAD_NAME_EXACT.has(t.toLowerCase())) return true;
        return false;
    }
    function goodPlantName(s) {
        const t = String(s || '').replace(/\s+/g, ' ').trim();
        return t && !looksLikeBadName(t) ? t : '';
    }
    function cachedPlantName(names, id) {
        return goodPlantName(names?.[String(id)]);
    }
    function applyTrustedPlantNames(names, plantIds = []) {
        let added = 0;
        for (const rawId of plantIds) {
            const id = String(rawId);
            const trusted = TRUSTED_PLANT_NAMES[id];
            if (trusted && !cachedPlantName(names, id)) {
                names[id] = trusted;
                added++;
            }
        }
        return added;
    }

    // One-time cleanup: drop any names that v3.6's admin-page scraper poisoned the cache with.
    function purgeBadNamesOnce() {
        if (GM_getValue(KEY_NAMES_PURGED, false)) return;
        const names = GM_getValue(KEY_PLANT_NAMES, {});
        let removed = 0;
        for (const id of Object.keys(names)) {
            if (looksLikeBadName(names[id])) {
                delete names[id];
                removed++;
            }
        }
        GM_setValue(KEY_PLANT_NAMES, names);
        GM_setValue(KEY_NAMES_PURGED, true);
        if (removed) console.log(`Day Recap: purged ${removed} junk plant names from cache`);
    }
    purgeBadNamesOnce();

    // ---------- Plant page: capture name ----------
    function recordPlantName() {
        const m = host.match(/^(\d+)\.plants\.iwmac\.local$/);
        if (!m) return;
        const plant_id = m[1];
        const name = (document.querySelector('h1')?.textContent || document.title || '').trim();
        const names = GM_getValue(KEY_PLANT_NAMES, {});
        // Only persist the name if it looks like a real plant name. Plant-admin pages often
        // serve "Forbidden" / login error pages whose <title> we do NOT want in the cache.
        if (name && !looksLikeBadName(name) && names[plant_id] !== name) {
            names[plant_id] = name;
            GM_setValue(KEY_PLANT_NAMES, names);
        }
        // Also add to known_plants so it gets queried next time
        const known = new Set(GM_getValue(KEY_KNOWN_PLANTS, []));
        if (!known.has(plant_id)) {
            known.add(plant_id);
            GM_setValue(KEY_KNOWN_PLANTS, [...known]);
        }
    }

    // ---------- Pang page: pull recent list + username + plant names ----------
    function syncFromPang() {
        LOG('syncFromPang() called on', location.href);
        const isSyncTab = window.name === 'rl_pang_sync' || (location.hash && location.hash.includes('rl-sync'));
        const lookupIds = (() => {
            const raw = GM_getValue(KEY_NAME_LOOKUP_IDS, []);
            return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
        })();
        const finish = () => {
            LOG('finish() — marking harvest done. names_count:', Object.keys(GM_getValue(KEY_PLANT_NAMES, {})).length);
            if (lookupIds.length > 0) GM_setValue(KEY_NAME_LOOKUP_IDS, []);
            // Always signal harvest completion for any Rocketlane caller polling on this key.
            GM_setValue(KEY_HARVEST_DONE, Date.now());
            if (isSyncTab) {
                setTimeout(() => { try { window.close(); } catch {} }, 250);
            }
        };
        try {
            const raw = localStorage.getItem('pang.recent');
            if (raw) {
                const recent = JSON.parse(raw);
                const known = new Set(GM_getValue(KEY_KNOWN_PLANTS, []));
                for (const id of recent) known.add(String(id));
                GM_setValue(KEY_KNOWN_PLANTS, [...known]);
            }
            const u = localStorage.getItem('pang.login.username');
            if (u) GM_setValue(KEY_USERNAME, JSON.parse(u));
        } catch (e) { console.warn('Day Recap: sync failed', e); }

        // Harvest plant_id → name from pang.
        // module_plants.coll.data holds the authoritative full plant inventory (~7600 plants),
        // populated by a websocket all_plants event. The collection grows as plants stream in,
        // so we must wait until either:
        //   (a) the length stabilises (3 consecutive ticks with no growth), OR
        //   (b) the length is clearly "full" (>1000 entries — far more than the rendered top-50)
        // before declaring sync done. The previous version exited on first sight which often
        // captured only the initial 50 rendered rows.
        const harvestNow = () => {
            const coll = window.module_plants?.coll?.data;
            const bodys = window.module_plants?.plants_table?.tableData?.bodys;
            const names = GM_getValue(KEY_PLANT_NAMES, {});
            let added = 0;
            const consume = (id, name) => {
                if (!id || !name) return;
                if (looksLikeBadName(name)) return;
                const sid = String(id);
                if (names[sid] !== name) { names[sid] = name; added++; }
            };
            if (Array.isArray(coll)) for (const p of coll) consume(p?.plant_id, p?.name);
            if (Array.isArray(bodys)) for (const r of bodys) consume(r?.user?.plant_id, r?.user?.name);
            // Fallback for the currently rendered pang table/window. This covers cases where
            // the full collection is still streaming but the searched plant is already visible.
            document.querySelectorAll('#comp_module_plants_plants_table tbody.qxsTable_body tr').forEach(tr => {
                const cells = tr.querySelectorAll('td');
                consume(cells[3]?.textContent?.trim(), cells[4]?.textContent?.trim());
            });
            document.querySelectorAll('.qxs_window_header_caption').forEach(el => {
                const m = (el.textContent || '').match(/\bPlant\s*-\s*(\d+)\s*-\s*(.+)$/i);
                if (m) consume(m[1], m[2].trim());
            });
            if (added) {
                GM_setValue(KEY_PLANT_NAMES, names);
                GM_setValue(KEY_LAST_HARVEST, Date.now());
                LOG('harvestNow added', added, 'names. coll_len=', coll?.length, 'bodys_len=', bodys?.length, 'total cached=', Object.keys(names).length);
            } else {
                LOG('harvestNow: 0 added. coll_len=', coll?.length, 'bodys_len=', bodys?.length, 'cached=', Object.keys(names).length);
            }
            return added;
        };

        // Expose for manual triggering from DevTools (any pang tab).
        try {
            (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).__rlRecap = {
                version: SCRIPT_VERSION,
                harvest: () => harvestNow(),
                pangColl: () => ({ len: window.module_plants?.coll?.data?.length, sample: window.module_plants?.coll?.data?.[0]?.name }),
            };
        } catch {}

        let attempts = 0;
        let lastLen = -1;
        let stableTicks = 0;
        const tryHarvest = () => {
            attempts++;
            try {
                const len = window.module_plants?.coll?.data?.length || 0;
                harvestNow(); // always merge whatever's there now
                const names = GM_getValue(KEY_PLANT_NAMES, {});

                if (lookupIds.length > 0 && lookupIds.every(id => cachedPlantName(names, id))) {
                    finish();
                    return;
                }

                if (len > 0) {
                    if (len === lastLen) stableTicks++;
                    else { stableTicks = 0; lastLen = len; }
                    // Done once the full inventory is present, or after a larger collection
                    // has stopped growing. The old >1000 shortcut missed plants like 3168.
                    if (len >= FULL_INVENTORY_MIN || (len >= 1000 && stableTicks >= 8)) { finish(); return; }
                }
            } catch {}
            if (attempts < 120) setTimeout(tryHarvest, 250); // up to ~30s
            else finish();
        };
        tryHarvest();

        // On the user's regular pang tab (not our hidden sync popup), keep watching for changes
        // so newly added plants get into the cache without manual ↻ clicks.
        if (!isSyncTab) {
            setInterval(harvestNow, 30000);
        }
    }

    // From Rocketlane: open pang in a background tab via GM_openInTab (NOT subject to popup
    // blockers — uses the Tampermonkey extension API). The pang tab's userscript runs syncFromPang,
    // which writes KEY_HARVEST_DONE when complete. We poll that timestamp and close the tab once
    // we see it advance past our start time.
    function autoSyncFromPang(timeoutMs = 30000, lookupIds = []) {
        return new Promise(resolve => {
            const beforeNames = Object.keys(GM_getValue(KEY_PLANT_NAMES, {})).length;
            const beforeKnown = GM_getValue(KEY_KNOWN_PLANTS, []).length;
            const startedAt = Date.now();
            const lookupList = Array.isArray(lookupIds) ? [...new Set(lookupIds.map(String).filter(Boolean))] : [];
            GM_setValue(KEY_NAME_LOOKUP_IDS, lookupList);

            // Use GM_openInTab if available (preferred — bypasses popup blocker);
            // fall back to window.open with a name so syncFromPang's self-close still fires.
            let tabHandle = null;
            try {
                if (typeof GM_openInTab === 'function') {
                    // active:false → don't steal focus; insert:true → open right next to current tab
                    tabHandle = GM_openInTab('http://tools.iwmac.local/pang.qxs#rl-sync', { active: false, insert: true, setParent: true });
                }
            } catch {}
            if (!tabHandle) {
                tabHandle = window.open('http://tools.iwmac.local/pang.qxs', 'rl_pang_sync', 'width=420,height=300,left=0,top=0');
            }
            if (!tabHandle) { resolve(false); return; }

            const tick = setInterval(() => {
                const harvestDone = GM_getValue(KEY_HARVEST_DONE, 0) > startedAt;
                const tabClosed = (() => {
                    try { return tabHandle.closed === true; } catch { return false; }
                })();
                const timedOut = Date.now() - startedAt > timeoutMs;
                if (harvestDone || tabClosed || timedOut) {
                    clearInterval(tick);
                    // Give the harvest a brief moment to finalise its GM writes before we close.
                    setTimeout(() => {
                        try { tabHandle.close(); } catch {}
                        const names = GM_getValue(KEY_PLANT_NAMES, {});
                        const namesAfter = Object.keys(names).length;
                        const knownAfter = GM_getValue(KEY_KNOWN_PLANTS, []).length;
                        const lookupResolved = lookupList.length > 0 && lookupList.every(id => cachedPlantName(names, id));
                        resolve(lookupResolved || namesAfter > beforeNames || knownAfter > beforeKnown);
                    }, 400);
                }
            }, 250);
        });
    }

    // ---------- Rocketlane: panel ----------
    function extractPlantNameFromHtml(plant_id, html) {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');

        for (const caption of doc.querySelectorAll('.qxs_window_header_caption')) {
            const m = (caption.textContent || '').match(/\bPlant\s*-\s*(\d+)\s*-\s*(.+)$/i);
            if (m && m[1] === String(plant_id)) return m[2].trim();
        }

        for (const tr of doc.querySelectorAll('#comp_module_plants_plants_table tbody.qxsTable_body tr')) {
            const cells = tr.querySelectorAll('td');
            const id = cells[3]?.textContent?.trim();
            const name = cells[4]?.textContent?.trim();
            if (id === String(plant_id) && name) return name;
        }

        const raw = (doc.querySelector('h1')?.textContent || doc.querySelector('title')?.textContent || '').trim();
        return raw || null;
    }

    // Fast targeted name fetch: hit the plant's admin page directly and read exact
    // plant table/window content first, then <h1>/<title>. Some proxy responses are
    // only the generic pang shell, so the generic title is filtered by looksLikeBadName().
    function gmFetchPlantName(plant_id) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `http://${encodeURIComponent(plant_id)}.plants.iwmac.local:8080/`,
                timeout: 6000,
                onload: r => {
                    try {
                        const raw = extractPlantNameFromHtml(plant_id, r.responseText).replace(/\s+/g, ' ').trim();
                        resolve(raw && !looksLikeBadName(raw) ? raw : null);
                    } catch { resolve(null); }
                },
                onerror:   () => resolve(null),
                ontimeout: () => resolve(null),
            });
        });
    }

    // Resolve names for the given plant_ids in parallel. Writes to the cache and
    // returns the count of names actually added.
    async function fetchMissingPlantNames(plantIds, onProgress) {
        if (!plantIds || plantIds.length === 0) return 0;
        const names = GM_getValue(KEY_PLANT_NAMES, {});
        let added = applyTrustedPlantNames(names, plantIds);
        const todo = plantIds.filter(id => !cachedPlantName(names, id));
        if (todo.length === 0) {
            if (added > 0) GM_setValue(KEY_PLANT_NAMES, names);
            return added;
        }
        await pMap(todo, async (pid) => {
            const name = await gmFetchPlantName(pid);
            if (name && names[pid] !== name) {
                names[pid] = name;
                added++;
            }
        }, PARALLEL, onProgress);

        let unresolved = todo.filter(pid => !cachedPlantName(names, pid));
        if (unresolved.length > 0) {
            await autoSyncFromPang(12000, unresolved);
            const refreshed = GM_getValue(KEY_PLANT_NAMES, {});
            unresolved = unresolved.filter(pid => cachedPlantName(refreshed, pid) && !cachedPlantName(names, pid));
            for (const pid of unresolved) {
                names[pid] = cachedPlantName(refreshed, pid);
                added++;
            }
        }

        if (added > 0) GM_setValue(KEY_PLANT_NAMES, names);
        return added;
    }

    function gmFetchHistory(plant_id) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'http://tools.iwmac.local/services/pang/actions.php',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: JSON.stringify([{ jsonrpc: '2.0', method: 'get_history', params: { plant_id: String(plant_id) }, id: 0 }]),
                onload: r => {
                    try {
                        const d = JSON.parse(r.responseText);
                        resolve(Array.isArray(d.result) ? d.result : []);
                    } catch { resolve([]); }
                },
                onerror: () => resolve([]),
                ontimeout: () => resolve([]),
                timeout: 15000,
            });
        });
    }

    // Run f(item) over items with limited parallelism. Calls onProgress(done, total).
    async function pMap(items, f, parallel, onProgress) {
        const results = new Array(items.length);
        let i = 0, done = 0;
        const workers = Array.from({ length: Math.min(parallel, items.length) }, async () => {
            while (i < items.length) {
                const idx = i++;
                results[idx] = await f(items[idx], idx);
                done++;
                onProgress?.(done, items.length);
            }
        });
        await Promise.all(workers);
        return results;
    }

    function normalizeUser(u) {
        return String(u || '').toLowerCase().split('@')[0].trim();
    }

    function tsFromPangDate(s) {
        // "2026-04-27 11:46:07" — treat as local time
        return new Date(s.replace(' ', 'T')).getTime();
    }

    function pangDateToISODate(s) {
        return s.slice(0, 10);
    }

    function todayISO() {
        // Today's date in Norway (Europe/Oslo)
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: NO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        return parts; // en-CA emits YYYY-MM-DD
    }

    async function loadVisitsForDate(isoDate, onProgress) {
        const username = normalizeUser(GM_getValue(KEY_USERNAME, 'thomas.kvalvag'));
        const known = GM_getValue(KEY_KNOWN_PLANTS, []);
        const names = GM_getValue(KEY_PLANT_NAMES, {});

        if (known.length === 0) return { visits: [], username, scanned: 0 };

        const all = await pMap(known, async (pid) => {
            const entries = await gmFetchHistory(pid);
            const matches = entries.filter(e => {
                if (pangDateToISODate(e.date) !== isoDate) return false;
                return normalizeUser(e.user) === username;
            });
            if (matches.length === 0) return null;
            matches.sort((a, b) => tsFromPangDate(a.date) - tsFromPangDate(b.date));
            const actions = [...new Set(matches.map(m => m.action))];
            const timestamps = matches.map(m => tsFromPangDate(m.date));
            return {
                plant_id: pid,
                name: cachedPlantName(names, pid),
                first_ts: timestamps[0],
                last_ts:  timestamps[timestamps.length - 1],
                actions,
                count: matches.length,
                _timestamps: timestamps,
            };
        }, PARALLEL, onProgress);

        const visits = all.filter(Boolean).sort((a, b) => a.first_ts - b.first_ts);

        // Cross-plant time attribution: flatten every action timestamp into one timeline,
        // then credit each gap to the plant of the action that opened it (capped at MAX_GAP_MS).
        const allEvents = [];
        for (const v of visits) {
            for (const ts of v._timestamps) allEvents.push({ plant_id: v.plant_id, ts });
        }
        const minsByPlant = attributeTime(allEvents);
        for (const v of visits) {
            v.estimated_minutes = minsByPlant[v.plant_id] || 0;
            delete v._timestamps;
        }

        return { visits, username, scanned: known.length };
    }

    const NO_TZ = 'Europe/Oslo';
    const noTimeFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: NO_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
    const noDateFmt = new Intl.DateTimeFormat('nb-NO', { timeZone: NO_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

    function tsToLocalTime(ts) {
        return noTimeFmt.format(new Date(ts));
    }
    function isoToNorwegianDate(iso) {
        // iso = "YYYY-MM-DD" — display as "DD.MM.YYYY"
        if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
        const [y, m, d] = iso.split('-');
        return `${d}.${m}.${y}`;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // Build a cross-plant attribution of estimated time spent.
    // Input: array of { plant_id, ts } across ALL plants for the day.
    // Output: { [plant_id]: minutes_estimated }
    function attributeTime(events) {
        const out = {};
        if (!events || events.length === 0) return out;
        const sorted = [...events].sort((a, b) => a.ts - b.ts);
        for (let i = 0; i < sorted.length; i++) {
            const cur = sorted[i];
            const next = sorted[i + 1];
            const gap = next ? Math.min(next.ts - cur.ts, MAX_GAP_MS) : TAIL_BUFFER_MS;
            out[cur.plant_id] = (out[cur.plant_id] || 0) + gap;
        }
        // Convert ms → rounded minutes
        for (const id of Object.keys(out)) out[id] = Math.max(1, Math.round(out[id] / 60000));
        return out;
    }

    function fmtMinutes(m) {
        if (!m) return '0m';
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return mm ? `${h}h ${mm}m` : `${h}h`;
    }

    // Normalize raw per-plant minutes so they sum to targetMinutes, rounded to roundTo (5 min).
    // Largest plant absorbs any leftover so the sum is exact.
    function normalizeMinutes(visits, targetMinutes, roundTo) {
        if (!visits.length || !targetMinutes) return;
        const totalRaw = visits.reduce((s, v) => s + (v.estimated_minutes || 0), 0);
        if (totalRaw <= 0) {
            // No raw signal: split target evenly across plants
            const each = roundTo * Math.max(1, Math.round((targetMinutes / visits.length) / roundTo));
            for (const v of visits) v.normalized_minutes = each;
            const drift = targetMinutes - visits.length * each;
            if (visits[0]) visits[0].normalized_minutes += drift;
            return;
        }
        // Proportional scaling
        let runningSum = 0;
        const scaled = visits.map(v => {
            const raw = v.estimated_minutes || 0;
            const exact = (raw / totalRaw) * targetMinutes;
            const rounded = roundTo * Math.max(roundTo === 0 ? 0 : 1, Math.round(exact / roundTo));
            runningSum += rounded;
            return rounded;
        });
        // Fix rounding drift by adjusting the visit with the largest raw share.
        const drift = targetMinutes - runningSum;
        if (drift !== 0) {
            let maxIdx = 0;
            for (let i = 1; i < visits.length; i++) {
                if ((visits[i].estimated_minutes || 0) > (visits[maxIdx].estimated_minutes || 0)) maxIdx = i;
            }
            scaled[maxIdx] = Math.max(roundTo, scaled[maxIdx] + drift);
        }
        for (let i = 0; i < visits.length; i++) visits[i].normalized_minutes = scaled[i];
    }

    const css = `
        #${BTN_ID} {
            position: fixed; bottom: 20px; right: 20px; z-index: 2147483640;
            background: #0f62fe; color: #fff; border: none; border-radius: 24px;
            padding: 10px 16px; font: 600 13px/1.2 'IBM Plex Sans', system-ui, sans-serif;
            box-shadow: 0 6px 18px rgba(0,0,0,.25); cursor: pointer;
        }
        #${BTN_ID}:hover { background: #0043ce; }
        #${PANEL_ID} {
            position: fixed; bottom: 70px; right: 20px; width: 460px; max-height: 75vh;
            background: #fff; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.25);
            font: 13px/1.4 'IBM Plex Sans', system-ui, sans-serif; color: #161616;
            z-index: 2147483641; display: flex; flex-direction: column; overflow: hidden;
        }
        #${PANEL_ID} header {
            padding: 10px 14px; background: #161616; color: #fff;
            display: flex; align-items: center; gap: 8px;
        }
        #${PANEL_ID} header strong { flex: 1; font-size: 14px; }
        #${PANEL_ID} header button {
            background: transparent; color: #fff; border: 1px solid #555;
            border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px;
        }
        #${PANEL_ID} .controls {
            padding: 10px 14px; border-bottom: 1px solid #e0e0e0;
            display: flex; gap: 8px; align-items: center;
        }
        #${PANEL_ID} .controls input[type=date] {
            flex: 1; padding: 6px 8px; border: 1px solid #c6c6c6; border-radius: 4px; font-size: 13px;
        }
        #${PANEL_ID} .controls button {
            padding: 6px 10px; background: #0f62fe; color: #fff; border: none;
            border-radius: 4px; cursor: pointer; font-weight: 600;
        }
        #${PANEL_ID} .controls button:disabled { background: #c6c6c6; cursor: wait; }
        #${PANEL_ID} .results { overflow: auto; padding: 4px 0; flex: 1; }
        #${PANEL_ID} .row {
            padding: 8px 14px; border-bottom: 1px solid #f0f0f0;
            display: flex; gap: 10px; align-items: baseline;
        }
        #${PANEL_ID} .row a {
            color: #0f62fe; text-decoration: none; font-weight: 600; min-width: 56px;
        }
        #${PANEL_ID} .row a:hover { text-decoration: underline; }
        #${PANEL_ID} .row .name { flex: 1; }
        #${PANEL_ID} .row .actions { color: #525252; font-size: 11px; }
        #${PANEL_ID} .row .time { color: #6f6f6f; font-size: 12px; white-space: nowrap; text-align: right; }
        #${PANEL_ID} .row .estimate { color: #0f62fe; font-size: 11px; font-weight: 600; margin-top: 2px; }
        #${PANEL_ID} .empty { padding: 20px; text-align: center; color: #6f6f6f; font-size: 12px; }
        #${PANEL_ID} .total {
            padding: 8px 14px; background: #f4f4f4; border-top: 1px solid #e0e0e0;
            font-size: 12px; color: #525252; display: flex; justify-content: space-between;
        }
        #${PANEL_ID} .progress { height: 3px; background: #e0e0e0; }
        #${PANEL_ID} .progress > div { height: 100%; background: #0f62fe; transition: width .15s; }
    `;

    function injectStyle() {
        if (document.getElementById('rl-day-recap-style')) return;
        const s = document.createElement('style');
        s.id = 'rl-day-recap-style';
        s.textContent = css;
        document.head.appendChild(s);
    }

    function buildPanel() {
        if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID);
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <header>
                <strong>Plants visited</strong>
                <button data-action="close">×</button>
            </header>
            <div class="controls">
                <input type="date" value="${todayISO()}">
                <button data-action="search">Search</button>
                <button data-action="resync" title="Re-sync recent plant list from pang">↻</button>
            </div>
            <div class="controls" style="border-top: 1px solid #f0f0f0; padding-top: 6px;">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #525252; flex: 1;">
                    Workday total
                    <input type="number" data-field="workday" step="0.5" min="0" max="24" value="${(GM_getValue(KEY_WORKDAY_HOURS, DEFAULT_WORKDAY_HOURS) || 0)}" style="width: 60px; padding: 4px 6px; border: 1px solid #c6c6c6; border-radius: 4px; font-size: 13px;">
                    h
                </label>
                <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; color: #525252;" title="When on, minutes per plant are scaled so they sum to your workday total.">
                    <input type="checkbox" data-field="normalize" ${GM_getValue('workday_normalize', true) ? 'checked' : ''}>
                    Distribute to total
                </label>
            </div>
            <div class="progress"><div style="width:0%"></div></div>
            <div class="results"></div>
            <div class="total"></div>
        `;
        document.body.appendChild(panel);

        const dateInput     = panel.querySelector('input[type=date]');
        const searchBtn     = panel.querySelector('[data-action=search]');
        const resyncBtn     = panel.querySelector('[data-action=resync]');
        const workdayInput  = panel.querySelector('[data-field=workday]');
        const normalizeChk  = panel.querySelector('[data-field=normalize]');
        const list          = panel.querySelector('.results');
        const totalEl       = panel.querySelector('.total');
        const progress      = panel.querySelector('.progress > div');

        let lastVisits = null;
        let lastIso = null;
        let lastUsername = null;
        let lastScanned = 0;

        const applyAndRender = () => {
            if (!lastVisits) return;
            const useNorm = !!normalizeChk.checked;
            const hours = parseFloat(workdayInput.value);
            const targetMin = (useNorm && isFinite(hours) && hours > 0) ? Math.round(hours * 60) : 0;
            // Reset any previous normalized values, then re-apply if asked
            for (const v of lastVisits) v.normalized_minutes = null;
            if (targetMin > 0) normalizeMinutes(lastVisits, targetMin, ROUND_TO_MIN);
            renderVisits(list, lastVisits, lastIso, lastScanned);
            const stillMissing = lastVisits.filter(v => !v.name).length;
            const displayTotal = targetMin > 0
                ? lastVisits.reduce((s, v) => s + (v.normalized_minutes || 0), 0)
                : lastVisits.reduce((s, v) => s + (v.estimated_minutes || 0), 0);
            const totalLabel = displayTotal ? ` · ${targetMin > 0 ? '' : '≈ '}${fmtMinutes(displayTotal)}` : '';
            totalEl.innerHTML =
                `<span>${escapeHtml(lastUsername || '')} · ${isoToNorwegianDate(lastIso)}</span>` +
                `<span>${lastVisits.length} plant${lastVisits.length === 1 ? '' : 's'} of ${lastScanned} scanned${stillMissing ? ` · ${stillMissing} unnamed` : ''}${totalLabel}</span>`;
        };

        workdayInput.addEventListener('change', () => {
            const v = parseFloat(workdayInput.value);
            if (isFinite(v) && v >= 0) GM_setValue(KEY_WORKDAY_HOURS, v);
            applyAndRender();
        });
        normalizeChk.addEventListener('change', () => {
            GM_setValue('workday_normalize', !!normalizeChk.checked);
            applyAndRender();
        });

        const ensureKnown = async () => {
            const known = GM_getValue(KEY_KNOWN_PLANTS, []);
            if (known.length > 0) return true;
            list.innerHTML = '<div class="empty">Fetching your recent plants from pang…<br><small>(briefly opens pang in a small window)</small></div>';
            const ok = await autoSyncFromPang();
            return ok;
        };

        // Refresh names on visits in-place from current cache (after a resync)
        const refillNames = (visits) => {
            const names = GM_getValue(KEY_PLANT_NAMES, {});
            for (const v of visits) {
                if (!v.name && cachedPlantName(names, v.plant_id)) v.name = cachedPlantName(names, v.plant_id);
            }
        };

        let autoResyncDone = false;

        const run = async () => {
            searchBtn.disabled = true;
            resyncBtn.disabled = true;
            totalEl.textContent = '';
            progress.style.width = '0%';
            try {
                const ok = await ensureKnown();
                if (!ok) {
                    list.innerHTML = '<div class="empty">Could not fetch plant list. Make sure pop-ups are allowed for kiona.rocketlane.com, or open <a href="http://tools.iwmac.local/pang.qxs" target="_blank">pang</a> manually.</div>';
                    return;
                }
                list.innerHTML = '<div class="empty">Querying pang…</div>';
                const iso = dateInput.value;
                const { visits, username, scanned } = await loadVisitsForDate(iso, (done, total) => {
                    progress.style.width = Math.round(done / total * 100) + '%';
                });
                progress.style.width = '100%';

                // If any visit has no plant name AND we haven't already auto-resynced this panel,
                // resolve them via direct admin-page fetch (fast: only the missing plants,
                // in parallel — no pang tab and no waiting for the full 7600-plant inventory).
                const missingIds = visits.filter(v => !v.name).map(v => v.plant_id);
                if (missingIds.length > 0 && !autoResyncDone) {
                    autoResyncDone = true;
                    list.innerHTML = `<div class="empty">Looking up ${missingIds.length} plant name${missingIds.length === 1 ? '' : 's'}…</div>`;
                    progress.style.width = '0%';
                    await fetchMissingPlantNames(missingIds, (done, total) => {
                        progress.style.width = Math.round(done / total * 100) + '%';
                    });
                    refillNames(visits);
                }

                lastVisits   = visits;
                lastIso      = iso;
                lastUsername = username;
                lastScanned  = scanned;
                applyAndRender();
            } finally {
                searchBtn.disabled = false;
                resyncBtn.disabled = false;
                setTimeout(() => { progress.style.width = '0%'; }, 800);
            }
        };

        const resync = async () => {
            resyncBtn.disabled = true;
            searchBtn.disabled = true;
            // Manual resync = full pang harvest (refreshes the recent-plants list AND any
            // names we don't already have). Slow path; only used when the user explicitly
            // clicks ↻. For the in-search auto-resync we use the fast targeted fetch above.
            list.innerHTML = '<div class="empty">Re-syncing recent plants from pang…</div>';
            await autoSyncFromPang();
            await run();
        };

        searchBtn.addEventListener('click', run);
        resyncBtn.addEventListener('click', resync);
        dateInput.addEventListener('change', run);
        panel.querySelector('[data-action=close]').addEventListener('click', () => panel.remove());
        run();
        return panel;
    }

    function renderVisits(list, visits, isoDate, scanned) {
        list.innerHTML = '';
        if (scanned === 0) {
            list.innerHTML = `<div class="empty">No plants known yet. Open <a href="http://tools.iwmac.local/pang.qxs" target="_blank">pang</a> once so the script can pick up your recent plants.</div>`;
            return;
        }
        if (visits.length === 0) {
            list.innerHTML = `<div class="empty">Nothing logged for ${isoToNorwegianDate(isoDate)} across ${scanned} known plants.</div>`;
            return;
        }
        visits.forEach(v => {
            const url = `http://tools.iwmac.local/pang.qxs?plant_id=${encodeURIComponent(v.plant_id)}`;
            const div = document.createElement('div');
            div.className = 'row';
            const timeRange = v.last_ts && v.last_ts !== v.first_ts
                ? `${tsToLocalTime(v.first_ts)}–${tsToLocalTime(v.last_ts)}`
                : tsToLocalTime(v.first_ts);
            const shown = v.normalized_minutes != null ? v.normalized_minutes : v.estimated_minutes;
            const prefix = v.normalized_minutes != null ? '' : '≈ ';
            const tooltip = v.normalized_minutes != null
                ? `Distributed share of your workday total. Raw estimate from action density: ≈ ${fmtMinutes(v.estimated_minutes || 0)}.`
                : `Estimated time spent on this plant — built from a single chronological timeline of every action across all your plants for the day; each gap (≤30 min) is credited to the plant that opened it. Approximation only; pang doesn't log idle vs. active.`;
            const estimate = shown
                ? `<div class="estimate" title="${escapeHtml(tooltip)}">${prefix}${fmtMinutes(shown)}</div>`
                : '';
            div.innerHTML = `
                <a href="${url}" target="_blank">${escapeHtml(v.plant_id)}</a>
                <div class="name">
                    ${escapeHtml(v.name || '(name not yet captured)')}
                    <div class="actions">${escapeHtml(v.actions.join(', '))}</div>
                </div>
                <div class="time">
                    ${timeRange}
                    ${estimate}
                </div>
            `;
            list.appendChild(div);
        });
    }

    function isRocketlaneTimesheetsPage() {
        return location.origin === 'https://kiona.rocketlane.com' &&
            (location.pathname === '/timesheets' || location.pathname.startsWith('/timesheets/'));
    }

    function removeRocketlaneUi() {
        document.getElementById(BTN_ID)?.remove();
        document.getElementById(PANEL_ID)?.remove();
    }

    function syncRocketlaneUi() {
        if (!isRocketlaneTimesheetsPage()) {
            removeRocketlaneUi();
            return;
        }
        injectStyle();
        buildButton();
    }

    function buildButton() {
        if (document.getElementById(BTN_ID)) return;
        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.textContent = '🏭 Plants visited';
        btn.addEventListener('click', () => {
            const existing = document.getElementById(PANEL_ID);
            if (existing) existing.remove();
            else buildPanel();
        });
        document.body.appendChild(btn);
    }

    function initRocketlane() {
        syncRocketlaneUi();
        const observer = new MutationObserver(() => {
            if (document.body) syncRocketlaneUi();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        // Debug helper. From DevTools console: window.__rlRecap.dump('3168')
        try {
            (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).__rlRecap = {
                version: SCRIPT_VERSION,
                dump(plant_id) {
                    const names = GM_getValue(KEY_PLANT_NAMES, {});
                    const known = GM_getValue(KEY_KNOWN_PLANTS, []);
                    const out = {
                        version: SCRIPT_VERSION,
                        username: GM_getValue(KEY_USERNAME, '(none)'),
                        known_count: known.length,
                        names_count: Object.keys(names).length,
                        last_harvest: new Date(GM_getValue(KEY_LAST_HARVEST, 0)).toISOString(),
                        last_done: new Date(GM_getValue(KEY_HARVEST_DONE, 0)).toISOString(),
                    };
                    if (plant_id) {
                        const id = String(plant_id);
                        out.plant = { id, in_known: known.includes(id), name: cachedPlantName(names, id) || null };
                    }
                    return out;
                },
                resync: () => autoSyncFromPang(),
                clearNames: () => { GM_setValue(KEY_PLANT_NAMES, {}); return 'cleared'; },
            };
        } catch (e) {}
    }

    // ---------- Dispatch ----------
    if (host.endsWith('.plants.iwmac.local')) {
        recordPlantName();
    } else if (host === 'tools.iwmac.local') {
        syncFromPang();
    } else if (host === 'kiona.rocketlane.com') {
        initRocketlane();
    }
})();