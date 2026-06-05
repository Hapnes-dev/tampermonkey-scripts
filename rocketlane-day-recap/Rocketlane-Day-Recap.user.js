// ==UserScript==
// @name         Rocketlane Day Recap
// @version      4.18
// @description  On Rocketlane My Timesheet, pick a date and see all IWMAC plants you visited that day. Uses pang's get_history API across known plants.
// @namespace    https://github.com/hapnes-dev/tampermonkey-scripts
// @homepageURL  https://github.com/hapnes-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-day-recap/Rocketlane-Day-Recap.user.js
// @downloadURL  https://raw.githubusercontent.com/hapnes-dev/tampermonkey-scripts/main/rocketlane-day-recap/Rocketlane-Day-Recap.user.js
// @match        https://kiona.rocketlane.com/timesheets/*
// @match        http://*.plants.iwmac.local:8080/*
// @match        https://*.plants.iwmac.local:8080/*
// @match        http://tools.iwmac.local/pang.qxs*
// @match        https://tools.iwmac.local/pang.qxs*
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
    const KEY_ALL_PLANTS   = 'all_plants';     // [plant_id, ...] full pang inventory, captured during sync for scan-all mode
    const KEY_SCAN_CACHE   = 'full_scan_cache';// { username: { isoDate: { scanned_at, scanned, visits[] } } } — cached full-scan results
    const KEY_PANG_ORIGIN  = 'pang_origin';    // last-seen pang origin (http or https) so lookups match the user's setup
    const KEY_RECENT_DONE  = 'recent_done_ts'; // syncFromPang sets this once recent+username are read (early, pre-inventory)
    const KEY_USER_OVERRIDE = 'user_override'; // manual username pick (overrides auto-detected) — set via the "pick your name" chooser
    const SCRIPT_VERSION   = '4.18';
    const KEY_WORKDAY_HOURS    = 'workday_hours';
    const DEFAULT_WORKDAY_HOURS = 7.5;
    const ROUND_TO_MIN         = 5; // round each plant's normalized minutes to nearest 5 min
    // Time-spent estimator: cross-plant attribution.
    // Pang only logs discrete clicks, not real "active work" time, so any estimate is an
    // approximation. We build ONE chronological timeline of every action across ALL plants
    // for the day. For each consecutive pair (a, b) the gap (b.ts − a.ts) is credited to
    // plant_a only while it still looks like active work: a gap up to IDLE_CUTOFF_MS counts
    // in full, but a longer gap means you left (lunch, meeting, end of task) — we credit just
    // WRAP_BUFFER_MS for wrap-up and drop the rest, so a single glance right before a break
    // isn't billed as half an hour. The day's last action also gets WRAP_BUFFER_MS. Result:
    // total estimated time ≤ wall-clock span, weighted toward plants with sustained activity
    // rather than whichever plant you happened to touch right before a gap.
    const IDLE_CUTOFF_MS = 10 * 60 * 1000; // a gap longer than this = you left the plant
    const WRAP_BUFFER_MS =  2 * 60 * 1000; // wrap-up credited on an idle gap or the day's last action
    const LOG = (...args) => console.log('[Day Recap v' + SCRIPT_VERSION + ']', ...args);
    const KEY_NAMES_PURGED = 'plant_names_purged_v44'; // bump to re-run cleanup; v44 evicts "Ukjent anlegg" titles
    const PANEL_ID = 'rl-day-recap-panel';
    const BTN_ID   = 'rl-day-recap-fab';
    const PARALLEL = 8;
    const SCAN_PARALLEL = 20;  // concurrent get_history requests — same server concurrency whether batched or not
    const HISTORY_BATCH_MAX = 30; // max plant_ids per batched get_history request (JSON-RPC batch; bounds response size)
    const FULL_INVENTORY_MIN = 7000;
    const TRUSTED_PLANT_NAMES = {
        '8179': 'COOP Extra Glommen Brygge',
    };

    const host = location.hostname;

    // pang answers on both http and https. Use whichever origin we last saw a real pang tab served
    // from (recorded by syncFromPang); default to http for the first run before any sync. The
    // Rocketlane panel's history lookups + harvest tab then target the user's actual protocol.
    function pangBase() {
        const o = String(GM_getValue(KEY_PANG_ORIGIN, '') || '');
        return o.startsWith('http') && o.includes('tools.iwmac.local') ? o : 'http://tools.iwmac.local';
    }

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
        // Record the origin (http vs https) the user's pang is served from, so the Rocketlane
        // panel's history lookups and harvest tab target the same protocol.
        try { GM_setValue(KEY_PANG_ORIGIN, location.origin); } catch {}
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
            // Identity: prefer the auth cookie iw_security[username] — that's the server-side login
            // pang stamps into get_history's `user` field (e.g. "eivind.slordal@kiona.com"), so it
            // matches by construction. Fall back to the SPA's pang.login.username if unreadable.
            // (Only sets when non-empty, so a logged-out tab never clobbers a good value.)
            let user = '';
            const ck = document.cookie.match(/iw_security\[username\]=([^;]+)/);
            if (ck && ck[1]) { try { user = decodeURIComponent(ck[1]).trim(); } catch { user = ck[1].trim(); } }
            if (!user) { const u = localStorage.getItem('pang.login.username'); if (u) { try { user = JSON.parse(u); } catch { user = u; } } }
            if (user) GM_setValue(KEY_USERNAME, user);
        } catch (e) { console.warn('Day Recap: sync failed', e); }
        // Signal that recent + username are captured (early — before the slow inventory harvest),
        // so a lightweight cross-origin recent sync can close this tab without waiting for coll.data.
        try { GM_setValue(KEY_RECENT_DONE, Date.now()); } catch {}

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
            // Capture the full plant-id inventory so the Rocketlane panel (which has no access to
            // module_plants) can scan every plant, not just the recent list. The collection grows
            // as plants stream in, so keep the largest list we've seen — by finish() it's all ~7600.
            if (Array.isArray(coll) && coll.length >= 1000) {
                const ids = coll.map(p => String(p?.plant_id)).filter(Boolean);
                if (ids.length > GM_getValue(KEY_ALL_PLANTS, []).length) GM_setValue(KEY_ALL_PLANTS, ids);
            }
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
    // Lightweight cross-protocol recent/login harvest. pang's recent list + login live in
    // per-origin localStorage, so a colleague on http vs https has separate lists; syncFromPang
    // copies them into shared GM storage (known_plants unions, username is set if present). We open
    // BOTH origins (background) and close each as soon as it signals the recent read is done — no
    // waiting for the full ~7600-plant inventory stream. Unreachable origins just hit the timeout.
    function syncRecentBothOrigins(timeoutPerOrigin = 8000) {
        const origins = ['http://tools.iwmac.local', 'https://tools.iwmac.local'];
        const harvestOne = (origin) => new Promise(resolve => {
            const start = Date.now();
            let tab = null;
            try {
                if (typeof GM_openInTab === 'function') {
                    tab = GM_openInTab(origin + '/pang.qxs#rl-sync', { active: false, insert: true, setParent: true });
                }
            } catch {}
            if (!tab) { resolve(false); return; }
            const tick = setInterval(() => {
                const done = GM_getValue(KEY_RECENT_DONE, 0) > start;
                const timedOut = Date.now() - start > timeoutPerOrigin;
                if (done || timedOut) {
                    clearInterval(tick);
                    setTimeout(() => { try { tab.close(); } catch {} resolve(done); }, 200);
                }
            }, 200);
        });
        return (async () => {
            let any = false;
            for (const o of origins) { if (await harvestOne(o)) any = true; }
            return any;
        })();
    }

    function autoSyncFromPang(timeoutMs = 30000, lookupIds = [], active = false) {
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
                    // Name/recent syncs run in the background (active:false). The full-inventory
                    // harvest passes active:true: background tabs get timer-throttled and the
                    // ~7600-plant websocket stream often doesn't finish before the timeout, so we
                    // briefly foreground pang (~6s) to let module_plants.coll.data load fully,
                    // then it auto-closes. insert:true → open right next to the current tab.
                    tabHandle = GM_openInTab(pangBase() + '/pang.qxs#rl-sync', { active, insert: true, setParent: true });
                }
            } catch {}
            if (!tabHandle) {
                tabHandle = window.open(pangBase() + '/pang.qxs', 'rl_pang_sync', 'width=420,height=300,left=0,top=0');
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

    // Fetch get_history for many plants in ONE request via JSON-RPC batching. pang processes the
    // sub-requests sequentially server-side (same concurrency as a single call) but we save a
    // round-trip per plant. Returns { plant_id: entries[] }. There's no server-side date/user
    // filter, so each plant still returns its full history — we filter client-side.
    function gmFetchHistoryBatch(plantIds) {
        return new Promise(resolve => {
            const reqs = plantIds.map((pid, i) => ({ jsonrpc: '2.0', method: 'get_history', params: { plant_id: String(pid) }, id: i }));
            GM_xmlhttpRequest({
                method: 'POST',
                url: pangBase() + '/services/pang/actions.php',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: JSON.stringify(reqs),
                timeout: 60000,
                onload: r => {
                    const out = {};
                    try {
                        const parsed = JSON.parse(r.responseText);
                        // pang returns an array for multi-request batches, but a single object for a
                        // 1-request batch — normalise to a list and map by echoed id (positional fallback).
                        const list = Array.isArray(parsed) ? parsed : [parsed];
                        for (let k = 0; k < list.length; k++) {
                            const item = list[k];
                            const idx = (typeof item?.id === 'number') ? item.id : k;
                            const pid = plantIds[idx];
                            if (pid != null) out[pid] = Array.isArray(item?.result) ? item.result : [];
                        }
                    } catch {}
                    resolve(out);
                },
                onerror:   () => resolve({}),
                ontimeout: () => resolve({}),
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

    // The username we filter history by: a manual override (if the user picked their name) wins over
    // the auto-detected login. Normalized (lowercased, @domain stripped) to match get_history's
    // `user` field whether it's stored bare ("thomas.kvalvag") or as an email ("x@kiona.com").
    function effectiveUsername() {
        return normalizeUser(GM_getValue(KEY_USER_OVERRIDE, '') || GM_getValue(KEY_USERNAME, ''));
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

    async function loadVisitsForDate(isoDate, plantIds, onProgress) {
        const username = effectiveUsername();
        const names = GM_getValue(KEY_PLANT_NAMES, {});

        if (!plantIds || plantIds.length === 0) return { visits: [], username, scanned: 0, usersOnDate: [] };

        // Collect the distinct raw `user` values active on this date (any user) — used to offer a
        // "pick your name" chooser if the current username matched nothing (a format mismatch).
        const usersOnDate = new Map(); // normalized -> raw (first seen)
        // Batch get_history to cut round-trips. Size batches so small (recent) scans still fan out
        // ~SCAN_PARALLEL ways for parallel transfer, while big (full) scans use larger batches
        // (capped) to minimise request count. Server concurrency is the same either way.
        const batchSize = Math.max(1, Math.min(HISTORY_BATCH_MAX, Math.ceil(plantIds.length / SCAN_PARALLEL)));
        const batches = [];
        for (let i = 0; i < plantIds.length; i += batchSize) batches.push(plantIds.slice(i, i + batchSize));

        let donePlants = 0;
        const perBatch = await pMap(batches, async (batch) => {
            const histByPlant = await gmFetchHistoryBatch(batch);
            const found = [];
            for (const pid of batch) {
                const entries = histByPlant[pid] || [];
                const onDate = entries.filter(e => pangDateToISODate(e.date) === isoDate);
                for (const e of onDate) {
                    const nu = normalizeUser(e.user);
                    if (nu && !usersOnDate.has(nu)) usersOnDate.set(nu, e.user);
                }
                const matches = onDate.filter(e => normalizeUser(e.user) === username);
                if (matches.length === 0) continue;
                matches.sort((a, b) => tsFromPangDate(a.date) - tsFromPangDate(b.date));
                const actions = [...new Set(matches.map(m => m.action))];
                const timestamps = matches.map(m => tsFromPangDate(m.date));
                found.push({
                    plant_id: pid,
                    name: cachedPlantName(names, pid),
                    first_ts: timestamps[0],
                    last_ts:  timestamps[timestamps.length - 1],
                    actions,
                    count: matches.length,
                    _timestamps: timestamps,
                });
            }
            donePlants += batch.length;
            onProgress?.(donePlants, plantIds.length);
            return found;
        }, SCAN_PARALLEL);

        const visits = perBatch.flat().sort((a, b) => a.first_ts - b.first_ts);

        // Cross-plant time attribution: flatten every action timestamp into one timeline,
        // then credit each active gap (≤ IDLE_CUTOFF_MS) to the plant of the action that opened it.
        const allEvents = [];
        for (const v of visits) {
            for (const ts of v._timestamps) allEvents.push({ plant_id: v.plant_id, ts });
        }
        const minsByPlant = attributeTime(allEvents);
        for (const v of visits) {
            v.estimated_minutes = minsByPlant[v.plant_id] || 0;
            delete v._timestamps;
        }

        return { visits, username, scanned: plantIds.length, usersOnDate: [...usersOnDate.values()] };
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
            const gap = next ? next.ts - cur.ts : WRAP_BUFFER_MS;
            const credit = gap <= IDLE_CUTOFF_MS ? gap : WRAP_BUFFER_MS;
            out[cur.plant_id] = (out[cur.plant_id] || 0) + credit;
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
        #${PANEL_ID} .warn { padding: 14px; font-size: 12px; color: #161616; }
        #${PANEL_ID} .warn strong { font-size: 13px; }
        #${PANEL_ID} .warn p { margin: 8px 0; color: #525252; }
        #${PANEL_ID} .warn ul { margin: 8px 0 12px; padding-left: 18px; color: #525252; }
        #${PANEL_ID} .warn li { margin: 2px 0; }
        #${PANEL_ID} .warn button { padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 12px; }
        #${PANEL_ID} .warn button[data-action="fullscan-go"] { background: #0f62fe; color: #fff; }
        #${PANEL_ID} .warn button[data-action="fullscan-cancel"] { background: #e0e0e0; color: #161616; margin-left: 6px; }
        #${PANEL_ID} .warn .userpick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        #${PANEL_ID} .warn .userpick button { background: #e8e8e8; color: #161616; font-weight: 500; }
        #${PANEL_ID} .warn .userpick button:hover { background: #0f62fe; color: #fff; }
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
                <button data-action="fullscan" title="Scans ALL ~7,600 IWMAC plants so visits made via plant-admin/designer are found too. Slow (~1 min) and briefly opens pang; the result is cached per date.">🔍 Full scan</button>
                <span style="font-size: 11px; color: #6f6f6f; flex: 1; line-height: 1.3;">Search = your ~50 recent plants (fast). Full scan = all plants (~1 min, cached).</span>
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
        const fullscanBtn   = panel.querySelector('[data-action=fullscan]');
        const workdayInput  = panel.querySelector('[data-field=workday]');
        const normalizeChk  = panel.querySelector('[data-field=normalize]');
        const list          = panel.querySelector('.results');
        const totalEl       = panel.querySelector('.total');
        const progress      = panel.querySelector('.progress > div');

        let lastVisits = null;
        let lastIso = null;
        let lastUsername = null;
        let lastScanned = 0;
        let lastMode = 'quick';     // 'quick' | 'full' — how the shown data was gathered
        let lastFromCache = false;  // true when the shown data came from the full-scan cache
        let lastCacheTs = 0;

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
            // Source label so a sparse quick-scan result isn't mistaken for "visited nothing".
            let source = ' · recent only';
            if (lastFromCache) source = ` · cached full scan ${tsToLocalTime(lastCacheTs)}`;
            else if (lastMode === 'full') source = ' · full scan';
            totalEl.innerHTML =
                `<span>${escapeHtml(lastUsername || '')} · ${isoToNorwegianDate(lastIso)}${escapeHtml(source)}</span>` +
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

        // Ensure we know who you are + have your recent list. Both live in pang's per-origin
        // localStorage but get copied into shared GM storage; on first use we may have neither, so
        // harvest from BOTH http and https so it works whichever protocol your pang is on. Once
        // cached (and kept fresh as you use pang), this is a no-op.
        const ensureUserAndRecent = async () => {
            const haveUser = !!GM_getValue(KEY_USERNAME, '');
            const haveRecent = GM_getValue(KEY_KNOWN_PLANTS, []).length > 0;
            if (haveUser && haveRecent) return true;
            list.innerHTML = '<div class="empty">Syncing your recent plants &amp; pang login…<br><small>(briefly opens pang; covers both http and https)</small></div>';
            await syncRecentBothOrigins();
            return !!GM_getValue(KEY_USERNAME, '');
        };

        // Scan-all mode needs the full plant-id inventory. It's harvested into KEY_ALL_PLANTS
        // whenever a pang tab runs syncFromPang; if we don't have it yet (or only a partial list),
        // open pang briefly to populate it.
        const ensureAllPlants = async () => {
            const all = GM_getValue(KEY_ALL_PLANTS, []);
            if (all.length >= FULL_INVENTORY_MIN) return all;
            list.innerHTML = '<div class="empty">Loading the full plant inventory from pang…<br><small>(opens pang in the foreground for a few seconds, then closes itself — one-time)</small></div>';
            await autoSyncFromPang(45000, [], true); // foreground harvest: reliable, unlike a throttled background tab
            return GM_getValue(KEY_ALL_PLANTS, []);
        };

        // Refresh names on visits in-place from current cache (after a resync)
        const refillNames = (visits) => {
            const names = GM_getValue(KEY_PLANT_NAMES, {});
            for (const v of visits) {
                if (!v.name && cachedPlantName(names, v.plant_id)) v.name = cachedPlantName(names, v.plant_id);
            }
        };

        // ----- Full-scan result cache (keyed by username + date) -----
        // A full scan is ~7,600 requests / ~1 min, so we cache its result per date. Past dates
        // never change; today's can go stale as you keep working, which is why the footer shows
        // the cache time and a Full scan always re-runs and overwrites it.
        const cacheVisit = (v) => ({
            plant_id: v.plant_id, name: v.name, first_ts: v.first_ts, last_ts: v.last_ts,
            actions: v.actions, count: v.count, estimated_minutes: v.estimated_minutes,
        });
        const readCache = (username, iso) => GM_getValue(KEY_SCAN_CACHE, {})?.[username]?.[iso] || null;
        const writeCache = (username, iso, visits, scanned) => {
            const cache = GM_getValue(KEY_SCAN_CACHE, {});
            if (!cache[username]) cache[username] = {};
            cache[username][iso] = { scanned_at: Date.now(), scanned, visits: visits.map(cacheVisit) };
            // Keep only the 60 most-recently-scanned dates per user so storage stays bounded.
            const dates = Object.keys(cache[username]);
            if (dates.length > 60) {
                dates.map(d => [d, cache[username][d].scanned_at || 0])
                     .sort((a, b) => a[1] - b[1])
                     .slice(0, dates.length - 60)
                     .forEach(([d]) => delete cache[username][d]);
            }
            GM_setValue(KEY_SCAN_CACHE, cache);
        };

        // When the scan matched nothing but other people were active that day, the auto-detected
        // username is probably wrong (login stored differently than get_history logs it). Let the
        // user pick their real identity straight from the data; the choice is remembered.
        const renderUserPicker = (users, mode, currentNorm) => {
            const sorted = [...new Set(users)].sort((a, b) => a.localeCompare(b));
            const cur = currentNorm ? escapeHtml(currentNorm) : '(not detected)';
            list.innerHTML = `
                <div class="warn">
                    <strong>No plants matched you</strong>
                    <p>Filtering as <b>${cur}</b>, but nothing on ${isoToNorwegianDate(dateInput.value)} matched that name. If it's wrong, pick yourself from everyone active that day:</p>
                    <div class="userpick">${sorted.map(u => `<button data-user="${escapeHtml(u)}">${escapeHtml(u)}</button>`).join('')}</div>
                </div>`;
            list.querySelectorAll('.userpick button').forEach(b => b.addEventListener('click', () => {
                GM_setValue(KEY_USER_OVERRIDE, b.dataset.user);
                doScan(mode);
            }));
        };

        // Core scan. mode 'quick' = your ~50 recent plants (fast); 'full' = all ~7,600 (slow, cached).
        const doScan = async (mode) => {
            searchBtn.disabled = true;
            fullscanBtn.disabled = true;
            resyncBtn.disabled = true;
            totalEl.textContent = '';
            progress.style.width = '0%';
            try {
                // Make sure we have your login + recent list, harvested cross-protocol. If we still
                // can't detect you, we don't bail — the scan collects who was active that day and
                // offers a "pick your name" chooser (handled after the scan).
                await ensureUserAndRecent();
                let plantIds;
                if (mode === 'full') {
                    plantIds = await ensureAllPlants();
                    if (!plantIds || plantIds.length === 0) {
                        plantIds = GM_getValue(KEY_KNOWN_PLANTS, []); // inventory unavailable — fall back to recent
                    }
                    if (!plantIds || plantIds.length === 0) {
                        list.innerHTML = `<div class="empty">Could not load the plant inventory. Make sure pop-ups are allowed for kiona.rocketlane.com, or open <a href="${pangBase()}/pang.qxs" target="_blank">pang</a> manually.</div>`;
                        return;
                    }
                } else {
                    plantIds = GM_getValue(KEY_KNOWN_PLANTS, []);
                    if (!plantIds || plantIds.length === 0) {
                        list.innerHTML = `<div class="empty">No recent plants found for you. Use 🔍 Full scan, or open <a href="${pangBase()}/pang.qxs" target="_blank">pang</a> and visit a few plants first.</div>`;
                        return;
                    }
                }
                list.innerHTML = `<div class="empty">Querying pang across ${plantIds.length} plant${plantIds.length === 1 ? '' : 's'}…${mode === 'full' ? '<br><small>full scan — about a minute</small>' : ''}</div>`;
                const iso = dateInput.value;
                const { visits, username, scanned, usersOnDate } = await loadVisitsForDate(iso, plantIds, (done, total) => {
                    progress.style.width = Math.round(done / total * 100) + '%';
                });
                progress.style.width = '100%';

                // Resolve any missing plant names via direct admin-page fetch (only the matched plants).
                const missingIds = visits.filter(v => !v.name).map(v => v.plant_id);
                if (missingIds.length > 0) {
                    list.innerHTML = `<div class="empty">Looking up ${missingIds.length} plant name${missingIds.length === 1 ? '' : 's'}…</div>`;
                    progress.style.width = '0%';
                    await fetchMissingPlantNames(missingIds, (done, total) => {
                        progress.style.width = Math.round(done / total * 100) + '%';
                    });
                    refillNames(visits);
                }

                lastVisits    = visits;
                lastIso       = iso;
                lastUsername  = username;
                lastScanned   = scanned;
                lastMode      = mode;
                lastFromCache = false;
                // 0 matches but other people were active → likely your username didn't match the
                // data's format. Offer the picker instead of a misleading "nothing logged", and don't
                // cache this empty result (so re-scanning after you pick works).
                const ambiguousEmpty = visits.length === 0 && (usersOnDate || []).length > 0;
                if (mode === 'full' && !ambiguousEmpty) writeCache(username, iso, visits, scanned);
                if (ambiguousEmpty) renderUserPicker(usersOnDate, mode, username);
                else applyAndRender();
            } finally {
                searchBtn.disabled = false;
                fullscanBtn.disabled = false;
                resyncBtn.disabled = false;
                setTimeout(() => { progress.style.width = '0%'; }, 800);
            }
        };

        // Default view on open / date change: show cached full-scan data for that date if present
        // (instant + complete), else a quick recent-only scan.
        const openDefault = async () => {
            const iso = dateInput.value;
            const username = effectiveUsername();
            const cached = username ? readCache(username, iso) : null;
            if (cached) {
                lastVisits    = cached.visits.map(v => ({ ...v }));
                lastIso       = iso;
                lastUsername  = username;
                lastScanned   = cached.scanned;
                lastMode      = 'full';
                lastFromCache = true;
                lastCacheTs   = cached.scanned_at || 0;
                applyAndRender();
            } else {
                await doScan('quick');
            }
        };

        // Full scan is heavy — warn and require an explicit confirm before running it.
        const fullScanWithWarning = () => {
            list.innerHTML = `
                <div class="warn">
                    <strong>⚠️ Full scan — all plants</strong>
                    <p>Queries <b>all ~7,600 IWMAC plants</b> (one request each) to catch visits made through plant-admin/designer, not just the plants you opened in pang.</p>
                    <ul>
                        <li>Takes about <b>a minute</b></li>
                        <li>Briefly opens pang in the foreground, then closes it</li>
                        <li>The result is cached for this date</li>
                    </ul>
                    <div>
                        <button data-action="fullscan-go">Run full scan</button>
                        <button data-action="fullscan-cancel">Cancel</button>
                    </div>
                </div>`;
            list.querySelector('[data-action=fullscan-go]').addEventListener('click', () => doScan('full'));
            list.querySelector('[data-action=fullscan-cancel]').addEventListener('click', () => openDefault());
        };

        searchBtn.addEventListener('click', () => doScan('quick'));
        fullscanBtn.addEventListener('click', fullScanWithWarning);
        resyncBtn.addEventListener('click', async () => {
            resyncBtn.disabled = true;
            searchBtn.disabled = true;
            fullscanBtn.disabled = true;
            list.innerHTML = '<div class="empty">Re-syncing recent plants from pang (http + https)…</div>';
            await syncRecentBothOrigins();
            resyncBtn.disabled = false;
            searchBtn.disabled = false;
            fullscanBtn.disabled = false;
            await openDefault();
        });
        dateInput.addEventListener('change', openDefault);
        panel.querySelector('[data-action=close]').addEventListener('click', () => panel.remove());
        openDefault();
        return panel;
    }

    function renderVisits(list, visits, isoDate, scanned) {
        list.innerHTML = '';
        if (scanned === 0) {
            list.innerHTML = `<div class="empty">No plants known yet. Open <a href="${pangBase()}/pang.qxs" target="_blank">pang</a> once so the script can pick up your recent plants.</div>`;
            return;
        }
        if (visits.length === 0) {
            list.innerHTML = `<div class="empty">Nothing logged for ${isoToNorwegianDate(isoDate)} across ${scanned} known plants.</div>`;
            return;
        }
        visits.forEach(v => {
            const url = `${pangBase()}/pang.qxs?plant_id=${encodeURIComponent(v.plant_id)}`;
            const div = document.createElement('div');
            div.className = 'row';
            const timeRange = v.last_ts && v.last_ts !== v.first_ts
                ? `${tsToLocalTime(v.first_ts)}–${tsToLocalTime(v.last_ts)}`
                : tsToLocalTime(v.first_ts);
            const shown = v.normalized_minutes != null ? v.normalized_minutes : v.estimated_minutes;
            const prefix = v.normalized_minutes != null ? '' : '≈ ';
            const tooltip = v.normalized_minutes != null
                ? `Distributed share of your workday total. Raw estimate from action density: ≈ ${fmtMinutes(v.estimated_minutes || 0)}.`
                : `Estimated time spent on this plant — built from a single chronological timeline of every action across all your plants for the day; each active gap (≤10 min) is credited to the plant that opened it, while longer gaps count as time away. Approximation only; pang doesn't log idle vs. active.`;
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
                        all_plants_count: GM_getValue(KEY_ALL_PLANTS, []).length,
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