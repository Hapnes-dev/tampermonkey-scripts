// ==UserScript==
// @name         Rocketlane Day Recap
// @version      4.27
// @description  On Rocketlane My Timesheet, pick a date and see all IWMAC plants you visited that day, plus a 🔧 badge when the plant's config changed during your visit. Uses pang's get_history + changes/commits APIs.
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
    const KEY_USER_PLANTS  = 'user_plants';    // { username: [plant_id...] } — plants this user has been found on; grows the fast Search scope
    const SCRIPT_VERSION   = '4.25';
    const KEY_WORKDAY_HOURS    = 'workday_hours';
    const DEFAULT_WORKDAY_HOURS = 7.5;
    const ROUND_TO_MIN         = 5; // round each plant's normalized minutes to nearest 5 min
    // Time-spent estimator: cross-plant attribution.
    // Pang only logs discrete clicks, not real "active work" time, so any estimate is an
    // approximation. We build ONE chronological timeline of every action across ALL plants for the
    // day. The gap between each click and the next is credited to the plant you had OPEN across it
    // (the earlier click's plant) — but capped at ACTIVE_CAP_MS, so normal sparse-clicking work
    // (reading logs, waiting on a restart, configuring) is billed in full, while a real break
    // (lunch, meeting, a restart you walked away from) counts at most the cap instead of inflating
    // the plant. The day's last click gets a TAIL_MS wrap-up. Result: time tracks active engagement
    // per plant, robust to how often you happen to click. (A 10-min cutoff used to chop every normal
    // pause down to 2 min, scoring a ~7h day as ~1.6h and skewing the per-plant split toward whoever
    // clicked fastest — this 30-min cap bills genuine pauses as the work they are.)
    const ACTIVE_CAP_MS = 30 * 60 * 1000; // each gap counts at most 30 min (normal work pauses count; real breaks are capped)
    const TAIL_MS       = 10 * 60 * 1000; // wrap-up credited to the day's very last click
    // ---- Config-change ("commits") overlay: changes.qxs / services/changes/commits.php ----
    // A plant's config snapshots are logged as commits {date, username:":system:", ...} — ALL
    // automatic (no human author), so we can't say WHO changed a plant. But a commit landing inside
    // your active window on a plant is strong evidence YOU did real config work there (vs a plant you
    // only clicked through). Pad the window a touch (saves often commit a few min after the last
    // click) and ignore commits outside it (e.g. nightly auto-snapshots). Display-only — never feeds
    // the time estimate.
    const CHANGE_PAD_LEAD_MS = 2 * 60 * 1000; // count commits from 2 min before your first action…
    const CHANGE_PAD_TAIL_MS = 6 * 60 * 1000; // …through 6 min after your last (catches save-triggered commits)
    const LOG = (...args) => console.log('[Day Recap v' + SCRIPT_VERSION + ']', ...args);
    const KEY_NAMES_PURGED = 'plant_names_purged_v44'; // bump to re-run cleanup; v44 evicts "Ukjent anlegg" titles
    const PANEL_ID = 'rl-day-recap-panel';
    const BTN_ID   = 'rl-day-recap-fab';
    const PARALLEL = 8;
    const SCAN_PARALLEL = 20;  // concurrent get_history requests — same server concurrency whether batched or not
    const HISTORY_BATCH_MAX = 30; // max plant_ids per batched get_history request (JSON-RPC batch; bounds response size)
    const MAX_CACHED_DATES = 400; // per-user cap on cached date results (a full scan caches every date you worked)
    const FULL_INVENTORY_MIN = 7000;
    const TRUSTED_PLANT_NAMES = {
        '8179': 'COOP Extra Glommen Brygge',
    };

    const host = location.hostname;

    // Tampermonkey runs this script sandboxed (it uses @grant GM_*), so `window` is NOT the page's
    // window — page JS globals like `module_plants` live on unsafeWindow. Always read page state via
    // PAGE. (This was the long-standing Full-scan bug: harvestNow read window.module_plants, which is
    // undefined in the sandbox, so coll.data was never harvested, all_plants stayed empty, and Full
    // scan silently fell back to the recent list. localStorage/document are shared, so recent worked.)
    const PAGE = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

    // pang answers on both http and https. Use whichever origin we last saw a real pang tab served
    // from (recorded by syncFromPang); default to http for the first run before any sync. The
    // Rocketlane panel's history lookups + harvest tab then target the user's actual protocol.
    function pangBase() {
        const o = String(GM_getValue(KEY_PANG_ORIGIN, '') || '');
        return o.startsWith('http') && o.includes('tools.iwmac.local') ? o : 'http://tools.iwmac.local';
    }

    // GM_xmlhttpRequest can silently fail against the internal HTTPS cert (Tampermonkey validates it
    // even though the browser accepts it for page loads) — so a https origin makes get_history return
    // NOTHING and Search/Full scan come up empty. Probe for an origin that actually works for
    // GM_xmlhttpRequest (try http first — reliable, serves identical data); cached per page session.
    let _apiOriginP = null;
    function gmProbeOrigin(origin) {
        return new Promise(resolve => {
            try {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: origin + '/services/pang/actions.php',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    data: JSON.stringify([{ jsonrpc: '2.0', method: 'get_history', params: { plant_id: '203' }, id: 0 }]),
                    timeout: 8000,
                    onload: r => { try { const d = JSON.parse(r.responseText); resolve(Array.isArray(d) ? !!(d[0] && Array.isArray(d[0].result)) : Array.isArray(d && d.result)); } catch { resolve(false); } },
                    onerror: () => resolve(false),
                    ontimeout: () => resolve(false),
                });
            } catch { resolve(false); }
        });
    }
    function apiOrigin() {
        if (!_apiOriginP) _apiOriginP = (async () => {
            for (const o of ['http://tools.iwmac.local', 'https://tools.iwmac.local']) {
                if (await gmProbeOrigin(o)) return o;
            }
            return pangBase(); // both probes failed — fall back to last-seen origin
        })();
        return _apiOriginP;
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
            const coll = PAGE.module_plants?.coll?.data;
            const bodys = PAGE.module_plants?.plants_table?.tableData?.bodys;
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
                pangColl: () => ({ len: PAGE.module_plants?.coll?.data?.length, sample: PAGE.module_plants?.coll?.data?.[0]?.name }),
            };
        } catch {}

        let attempts = 0;
        let lastLen = -1;
        let stableTicks = 0;
        const tryHarvest = () => {
            attempts++;
            try {
                const len = PAGE.module_plants?.coll?.data?.length || 0;
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
    async function gmFetchHistoryBatch(plantIds) {
        const base = await apiOrigin();
        return new Promise(resolve => {
            const reqs = plantIds.map((pid, i) => ({ jsonrpc: '2.0', method: 'get_history', params: { plant_id: String(pid) }, id: i }));
            GM_xmlhttpRequest({
                method: 'POST',
                url: base + '/services/pang/actions.php',
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

    // Same shape as gmFetchHistoryBatch, but for the config-change log behind changes.qxs:
    // POST /services/changes/commits.php, method get_commits. Returns { plant_id: commits[] }, each
    // commit { id, date, username, address } (username is always ":system:" — automatic snapshots).
    // Same server as actions.php, so apiOrigin()'s http-first choice applies (GM_xmlhttpRequest can't
    // use the internal https cert). Like get_history there's no server-side date filter — each plant
    // returns its full commit history, which we filter to the visit window client-side.
    async function gmFetchCommitsBatch(plantIds) {
        const base = await apiOrigin();
        return new Promise(resolve => {
            const reqs = plantIds.map((pid, i) => ({ jsonrpc: '2.0', method: 'get_commits', params: { plant_id: String(pid) }, id: i }));
            GM_xmlhttpRequest({
                method: 'POST',
                url: base + '/services/changes/commits.php',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                data: JSON.stringify(reqs),
                timeout: 60000,
                onload: r => {
                    const out = {};
                    try {
                        const parsed = JSON.parse(r.responseText);
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

    // Remember the plants a user has been found on, so the fast Search can include them next time —
    // a full scan is then only needed to discover brand-new plants.
    function rememberUserPlants(username, visits) {
        if (!username || !visits || !visits.length) return;
        const all = GM_getValue(KEY_USER_PLANTS, {});
        const set = new Set((all[username] || []).map(String));
        let added = 0;
        for (const v of visits) { const id = String(v.plant_id); if (id && !set.has(id)) { set.add(id); added++; } }
        if (added) { all[username] = [...set]; GM_setValue(KEY_USER_PLANTS, all); }
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
        // then credit each gap (capped at ACTIVE_CAP_MS) to the plant that was open across it.
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

    // Like loadVisitsForDate, but extracts the user's visits for EVERY date in one pass. A full scan
    // already downloads every plant's complete history, so grouping all dates costs nothing extra —
    // we then cache them all so browsing any of those dates is instant. Returns
    // { dates: { iso: visits[] }, usersOnSelected, username, scanned }.
    async function loadUserHistoryAllDates(plantIds, selectedIso, onProgress) {
        const username = effectiveUsername();
        const names = GM_getValue(KEY_PLANT_NAMES, {});
        if (!plantIds || plantIds.length === 0) return { dates: {}, usersOnSelected: [], username, scanned: 0 };
        const usersOnSelected = new Map();           // for the "pick your name" chooser on the selected date
        const byDate = new Map();                    // iso -> (plant_id -> { actions:Set, ts:[] })
        const batchSize = Math.max(1, Math.min(HISTORY_BATCH_MAX, Math.ceil(plantIds.length / SCAN_PARALLEL)));
        const batches = [];
        for (let i = 0; i < plantIds.length; i += batchSize) batches.push(plantIds.slice(i, i + batchSize));
        let donePlants = 0;
        await pMap(batches, async (batch) => {
            const histByPlant = await gmFetchHistoryBatch(batch);
            // (no await below — safe to mutate the shared maps directly)
            for (const pid of batch) {
                for (const e of (histByPlant[pid] || [])) {
                    const iso = pangDateToISODate(e.date);
                    const nu = normalizeUser(e.user);
                    if (iso === selectedIso && nu && !usersOnSelected.has(nu)) usersOnSelected.set(nu, e.user);
                    if (nu !== username) continue;
                    let pm = byDate.get(iso); if (!pm) { pm = new Map(); byDate.set(iso, pm); }
                    let rec = pm.get(pid); if (!rec) { rec = { actions: new Set(), ts: [] }; pm.set(pid, rec); }
                    rec.actions.add(e.action); rec.ts.push(tsFromPangDate(e.date));
                }
            }
            donePlants += batch.length;
            onProgress?.(donePlants, plantIds.length);
        }, SCAN_PARALLEL);
        const dates = {};
        for (const [iso, pm] of byDate) {
            const visits = [];
            const events = [];
            for (const [pid, rec] of pm) {
                const ts = rec.ts.sort((a, b) => a - b);
                for (const t of ts) events.push({ plant_id: pid, ts: t });
                visits.push({ plant_id: pid, name: cachedPlantName(names, pid), first_ts: ts[0], last_ts: ts[ts.length - 1], actions: [...rec.actions], count: ts.length });
            }
            const mins = attributeTime(events);
            for (const v of visits) v.estimated_minutes = mins[v.plant_id] || 0;
            visits.sort((a, b) => a.first_ts - b.first_ts);
            dates[iso] = visits;
        }
        return { dates, usersOnSelected: [...usersOnSelected.values()], username, scanned: plantIds.length };
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
        // Deterministic order: by ts, tie-broken by plant_id so two clicks in the same second
        // never reorder run-to-run.
        const sorted = [...events].sort((a, b) =>
            (a.ts - b.ts) || String(a.plant_id).localeCompare(String(b.plant_id)));
        for (let i = 0; i < sorted.length; i++) {
            const cur = sorted[i];
            const next = sorted[i + 1];
            // Gap to the next click anywhere (clamp negative jitter to 0), or the tail credit for the
            // day's very last click. Bill it to the plant that was open across it, capped at
            // ACTIVE_CAP_MS so a real break doesn't get billed as work on that plant.
            const gap = next ? Math.max(0, next.ts - cur.ts) : TAIL_MS;
            const credit = Math.min(gap, ACTIVE_CAP_MS);
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
        #${PANEL_ID} .row .actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; align-items: center; }
        #${PANEL_ID} .row .time { color: #6f6f6f; font-size: 12px; white-space: nowrap; text-align: right; }
        #${PANEL_ID} .row .estimate { color: #0f62fe; font-size: 11px; font-weight: 600; margin-top: 2px; }
        #${PANEL_ID} .row .chg { display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px; background: #defbe6; color: #0e6027; font-weight: 600; white-space: nowrap; cursor: help; }
        #${PANEL_ID} .row .act { font-size: 10px; line-height: 1.6; padding: 0 6px; border-radius: 10px; white-space: nowrap; cursor: default; }
        #${PANEL_ID} .row .act-edit   { background: #d0e2ff; color: #0043ce; }
        #${PANEL_ID} .row .act-server { background: #ffe0b3; color: #8a3800; }
        #${PANEL_ID} .row .act-vnc    { background: #e8daff; color: #6929c4; }
        #${PANEL_ID} .row .act-access { background: #d9fbfb; color: #005d5d; }
        #${PANEL_ID} .row .act-diag   { background: #f2f4f8; color: #525252; }
        #${PANEL_ID} .row .act-other  { background: #f2f4f8; color: #525252; }
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
        #${PANEL_ID} .warn button[data-action="run-full"] { background: #0f62fe; color: #fff; }
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
                <button data-action="resync" title="Refresh this date — re-scan just the selected date and update its cache">↻</button>
            </div>
            <div class="controls" style="border-top: 1px solid #f0f0f0; padding-top: 6px;">
                <button data-action="fullscan" title="Scans ALL ~7,600 IWMAC plants so visits made via plant-admin/designer are found too. Slow (~1 min) and briefly opens pang; the result is cached per date.">🔍 Full scan</button>
                <span style="font-size: 11px; color: #6f6f6f; flex: 1; line-height: 1.3;">Search = recent + plants you've visited before (fast). Full scan = all ~7,600 plants (~1 min, cached).</span>
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
        let scanSeq = 0;       // bumped on every scan / date-change; a run only renders if it's still the latest

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
            let source = ' · recent + your plants';
            if (lastFromCache) source = ` · cached full scan ${tsToLocalTime(lastCacheTs)}`;
            else if (lastMode === 'full') source = ' · full scan';
            else if (lastMode === 'refresh') source = ' · refreshed';
            totalEl.innerHTML =
                `<span>${escapeHtml(lastUsername || '')} · ${isoToNorwegianDate(lastIso)}${escapeHtml(source)}</span>` +
                `<span>${lastVisits.length} plant${lastVisits.length === 1 ? '' : 's'} of ${lastScanned} scanned${stillMissing ? ` · ${stillMissing} unnamed` : ''}${totalLabel}</span>`;
            ensureChangesEnriched();
        };

        // Lazily overlay config-change ("commits") info onto the date on screen, decoupled from the
        // scan/cache layer: fetch commits only for the plants shown, correlate each to that plant's
        // active window, and repaint 🔧 badges. Runs once per shown set; bails if the user switches
        // date/scan mid-fetch (scanSeq + lastVisits identity guard).
        const ensureChangesEnriched = async () => {
            const visits = lastVisits;
            if (!visits || !visits.length || visits._changesDone) return;
            visits._changesDone = true;
            const seq = scanSeq;
            const ids = [...new Set(visits.map(v => String(v.plant_id)))];
            const commits = {};
            for (let i = 0; i < ids.length; i += HISTORY_BATCH_MAX) {
                Object.assign(commits, await gmFetchCommitsBatch(ids.slice(i, i + HISTORY_BATCH_MAX)));
            }
            if (seq !== scanSeq || visits !== lastVisits) return; // a newer view is showing
            let any = false;
            for (const v of visits) {
                const start = v.first_ts - CHANGE_PAD_LEAD_MS;
                const end   = (v.last_ts || v.first_ts) + CHANGE_PAD_TAIL_MS;
                const hits = (commits[v.plant_id] || [])
                    .map(c => tsFromPangDate(c.date))
                    .filter(t => t >= start && t <= end)
                    .sort((a, b) => a - b);
                v.changes_in_window = hits.length;
                v.change_times = hits.map(tsToLocalTime);
                if (hits.length) any = true;
            }
            if (any) applyAndRender(); // repaint with badges
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
        // Write one or many dates to the cache. A full scan passes every date it found (browsing any
        // of them is then instant); ↻ passes just the one date it refreshed. Keyed by username + date.
        const writeCacheDates = (username, datesObj, scanned) => {
            if (!username || !datesObj) return;
            const cache = GM_getValue(KEY_SCAN_CACHE, {});
            if (!cache[username]) cache[username] = {};
            const now = Date.now();
            for (const iso in datesObj) cache[username][iso] = { scanned_at: now, scanned, visits: (datesObj[iso] || []).map(cacheVisit) };
            // Keep the most-recent MAX_CACHED_DATES dates per user (by date) so storage stays bounded.
            const keys = Object.keys(cache[username]).sort();
            if (keys.length > MAX_CACHED_DATES) keys.slice(0, keys.length - MAX_CACHED_DATES).forEach(d => delete cache[username][d]);
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

        // Quick (recent-only) scan found nothing. The visit is very likely on a plant you didn't open
        // in pang (plant-admin/designer), which only a Full scan covers — so offer that prominently
        // instead of a dead-end "nothing logged". If others were active that day on your recent
        // plants, also offer the name picker (in case it's a username mismatch).
        const renderQuickEmpty = (users) => {
            const recent = (GM_getValue(KEY_KNOWN_PLANTS, []) || []).map(String);
            const mine = (GM_getValue(KEY_USER_PLANTS, {})[effectiveUsername()] || []).map(String);
            const knownN = new Set([...recent, ...mine]).size;
            const sorted = [...new Set(users || [])].sort((a, b) => a.localeCompare(b));
            const pick = sorted.length
                ? `<p style="margin-top:10px;">Wrong name? Activity that day came from:</p><div class="userpick">${sorted.map(u => `<button data-user="${escapeHtml(u)}">${escapeHtml(u)}</button>`).join('')}</div>`
                : '';
            list.innerHTML = `
                <div class="warn">
                    <strong>Nothing among your known plants</strong>
                    <p>No visits for ${isoToNorwegianDate(dateInput.value)} among your ~${knownN} recent + previously-visited plants. If you worked on a brand-new plant (not opened in pang, e.g. via plant-admin/designer), it's only found by a full scan.</p>
                    <div><button data-action="run-full">🔍 Run Full scan (all plants)</button></div>
                    ${pick}
                </div>`;
            list.querySelector('[data-action=run-full]').addEventListener('click', () => doScan('full'));
            list.querySelectorAll('.userpick button').forEach(b => b.addEventListener('click', () => {
                GM_setValue(KEY_USER_OVERRIDE, b.dataset.user);
                doScan('quick');
            }));
        };

        // Core scan. mode 'quick' = your ~50 recent plants (fast); 'full' = all ~7,600 (slow, cached).
        const doScan = async (mode) => {
            const seq = ++scanSeq; // if a newer scan / date-change starts, this run stops touching the UI
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
                if (seq !== scanSeq) return; // superseded (e.g. you changed the date) — abandon this run
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
                    // Quick scope = recent plants ∪ every plant this user has been found on before
                    // (accumulated from past scans) — fast, and it catches plant-admin visits you've
                    // already made without needing a full scan.
                    const recent = (GM_getValue(KEY_KNOWN_PLANTS, []) || []).map(String);
                    const mine = (GM_getValue(KEY_USER_PLANTS, {})[effectiveUsername()] || []).map(String);
                    plantIds = [...new Set([...recent, ...mine])];
                    if (plantIds.length === 0) {
                        list.innerHTML = `<div class="empty">No recent plants found for you. Use 🔍 Full scan, or open <a href="${pangBase()}/pang.qxs" target="_blank">pang</a> and visit a few plants first.</div>`;
                        return;
                    }
                }
                list.innerHTML = `<div class="empty">Querying pang across ${plantIds.length} plant${plantIds.length === 1 ? '' : 's'}…${mode === 'full' ? '<br><small>full scan — about a minute; caches the whole period</small>' : ''}</div>`;
                const iso = dateInput.value;
                const onProg = (done, total) => { progress.style.width = Math.round(done / total * 100) + '%'; };
                let visits, username, scanned, usersOnDate;
                if (mode === 'full') {
                    // A full scan already pulls every plant's complete history, so extract the user's
                    // visits for EVERY date in one pass and cache them all — browsing any of those dates
                    // (e.g. the rest of the month) is then instant. Then display the selected date.
                    const all = await loadUserHistoryAllDates(plantIds, iso, onProg);
                    if (seq !== scanSeq) return;
                    username = all.username; scanned = all.scanned; usersOnDate = all.usersOnSelected;
                    visits = all.dates[iso] || [];
                    if (username) {
                        writeCacheDates(username, all.dates, scanned); // cache every date this scan found
                        const fp = new Set();
                        for (const d in all.dates) for (const v of all.dates[d]) fp.add(v.plant_id);
                        rememberUserPlants(username, [...fp].map(id => ({ plant_id: id })));
                    }
                } else {
                    const r = await loadVisitsForDate(iso, plantIds, onProg);
                    if (seq !== scanSeq) return;
                    visits = r.visits; username = r.username; scanned = r.scanned; usersOnDate = r.usersOnDate;
                    rememberUserPlants(username, visits);
                    if (mode === 'refresh' && username) writeCacheDates(username, { [iso]: visits }, scanned); // ↻ updates only this date
                }
                progress.style.width = '100%';

                // Resolve any missing plant names via direct admin-page fetch (only the matched plants).
                const missingIds = visits.filter(v => !v.name).map(v => v.plant_id);
                if (missingIds.length > 0) {
                    list.innerHTML = `<div class="empty">Looking up ${missingIds.length} plant name${missingIds.length === 1 ? '' : 's'}…</div>`;
                    progress.style.width = '0%';
                    await fetchMissingPlantNames(missingIds, onProg);
                    refillNames(visits);
                }
                if (seq !== scanSeq) return; // a newer scan / date-change won — don't overwrite its result

                lastVisits    = visits;
                lastIso       = iso;
                lastUsername  = username;
                lastScanned   = scanned;
                lastMode      = mode;
                lastFromCache = false;
                // 0 matches but other people were active → likely your username didn't match the
                // data's format. Offer the picker instead of a misleading "nothing logged".
                const ambiguousEmpty = visits.length === 0 && (usersOnDate || []).length > 0;
                if (mode === 'quick' && visits.length === 0) {
                    // Quick scope came up empty → nudge toward Full scan (your visit may be on a
                    // brand-new plant), plus a name picker if others were active that day.
                    renderQuickEmpty(usersOnDate);
                } else if (ambiguousEmpty) {
                    renderUserPicker(usersOnDate, mode, username);
                } else {
                    applyAndRender();
                }
            } catch (e) {
                if (seq === scanSeq) list.innerHTML = `<div class="empty">Scan error — please try again.<br><small>${escapeHtml(String((e && e.message) || e))}</small></div>`;
            } finally {
                if (seq === scanSeq) {
                    searchBtn.disabled = false;
                    fullscanBtn.disabled = false;
                    resyncBtn.disabled = false;
                    setTimeout(() => { if (seq === scanSeq) progress.style.width = '0%'; }, 800);
                }
            }
        };

        // Default view on open / date change: show cached full-scan data for that date if present
        // (instant + complete), else a quick recent-only scan.
        const openDefault = async () => {
            const seq = ++scanSeq;
            const iso = dateInput.value;
            const username = effectiveUsername();
            const cached = username ? readCache(username, iso) : null;
            if (cached) {
                if (seq !== scanSeq) return;
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
        resyncBtn.addEventListener('click', () => doScan('refresh')); // re-scan just the selected date (your plants) and update its cache
        dateInput.addEventListener('change', openDefault);
        panel.querySelector('[data-action=close]').addEventListener('click', () => panel.remove());
        openDefault();
        return panel;
    }

    // pang action codes → friendly label + category (labels read straight from the pang UI).
    // Category drives the chip colour so a visit's nature reads at a glance; the raw code stays in
    // each chip's tooltip. Green is intentionally avoided here — it's reserved for the 🔧 changes badge.
    const ACTION_META = {
        designer4:             { label: 'Designer V4',      cat: 'edit' },
        designer3:             { label: 'Designer V3',      cat: 'edit' },
        designer:              { label: 'VV designer',      cat: 'edit' },
        ak3_setup:             { label: 'AK3 setup',        cat: 'edit' },
        upload:                { label: 'Backup',           cat: 'edit' },
        file_upload:           { label: 'File upload',      cat: 'edit' },
        restart_plant_server:  { label: 'Restart plant',    cat: 'server' },
        start_plant_server:    { label: 'Start plant',      cat: 'server' },
        stop_plant_server:     { label: 'Stop plant',       cat: 'server' },
        restart:               { label: 'Restart PC',       cat: 'server' },
        start_vnc:             { label: 'Start VNC',        cat: 'vnc' },
        stop_vnc:              { label: 'Stop VNC',         cat: 'vnc' },
        start_vnc_next_ping:   { label: 'VNC: next ping',   cat: 'vnc' },
        start_vnc_next_upload: { label: 'VNC: next upload', cat: 'vnc' },
        direct_plant:          { label: 'Direct',           cat: 'access' },
        direct_v3:             { label: 'Direct V3',        cat: 'access' },
        proxy_plant:           { label: 'Proxy',            cat: 'access' },
        pma_local:             { label: 'phpMyAdmin',       cat: 'access' },
        client_admin:          { label: 'Client admin',     cat: 'access' },
        sys_tools:             { label: 'System tools',     cat: 'diag' },
        get_status:            { label: 'Get status',       cat: 'diag' },
        screen_dump:           { label: 'Screen dump',      cat: 'diag' },
    };
    // Chip order: most work-significant category first, so the row reads "what they did" at a glance.
    const ACTION_CAT_ORDER = ['edit', 'server', 'vnc', 'access', 'diag', 'other'];

    // Render a plant's action list as friendly, category-coloured chips (deduped + grouped by category).
    function actionChips(actions) {
        if (!actions || !actions.length) return '';
        const seen = new Set();
        const chips = [];
        for (const a of actions) {
            const code = String(a);
            if (seen.has(code)) continue;
            seen.add(code);
            const meta = ACTION_META[code] || { label: code, cat: 'other' };
            chips.push({ code, label: meta.label, cat: meta.cat });
        }
        chips.sort((x, y) =>
            (ACTION_CAT_ORDER.indexOf(x.cat) - ACTION_CAT_ORDER.indexOf(y.cat)) ||
            x.label.localeCompare(y.label));
        return chips.map(c =>
            `<span class="act act-${c.cat}" title="${escapeHtml(c.code)}">${escapeHtml(c.label)}</span>`
        ).join('');
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
                ? `Distributed share of your workday total. Raw estimate ≈ ${fmtMinutes(v.estimated_minutes || 0)}.`
                : `Estimated from your clicks: time on each plant counts until you click elsewhere, and any pause over 30 min counts as a break, not work. Approximation only — pang logs clicks, not active time.`;
            const estimate = shown
                ? `<div class="estimate" title="${escapeHtml(tooltip)}">${prefix}${fmtMinutes(shown)}</div>`
                : '';
            const nChg = v.changes_in_window || 0;
            const chgBadge = nChg > 0
                ? ` <span class="chg" title="${escapeHtml(`Plant config committed at ${(v.change_times || []).join(', ')} during your visit — an automatic system snapshot (no author is logged), but it lands inside your active window: a strong sign you configured this plant, not just viewed it.`)}">🔧 ${nChg} change${nChg === 1 ? '' : 's'}</span>`
                : '';
            div.innerHTML = `
                <a href="${url}" target="_blank">${escapeHtml(v.plant_id)}</a>
                <div class="name">
                    ${escapeHtml(v.name || '(name not yet captured)')}
                    <div class="actions">${actionChips(v.actions)}${chgBadge}</div>
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